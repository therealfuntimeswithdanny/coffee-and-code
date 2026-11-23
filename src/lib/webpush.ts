import type { Env } from '../types';

// Minimal Web Push sender for Cloudflare Workers: VAPID-signed requests with
// RFC 8291 (aes128gcm) payload encryption, implemented on WebCrypto so no
// dependencies are needed. Required environment:
//   VAPID_PUBLIC_KEY   base64url uncompressed P-256 point (65 bytes)
//   VAPID_PRIVATE_KEY  base64url P-256 private scalar (32 bytes) — a secret
//   VAPID_SUBJECT      mailto: or https: contact URI (optional)
// Generate a pair with:
//   node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']).then(async k=>{const j=await crypto.subtle.exportKey('jwk',k.privateKey);const p=await crypto.subtle.exportKey('raw',k.publicKey);const b=b=>Buffer.from(b).toString('base64url');console.log('public:',b(p));console.log('private:',j.d)})"

const encoder = new TextEncoder();

export type WebPushKeys = { p256dh: string; auth: string };
export type WebPushResult = 'ok' | 'gone' | 'error';

const b64url = (bytes: Uint8Array | ArrayBuffer) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64urlDecode = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export function webPushConfigured(env: Env) {
  return typeof env.VAPID_PUBLIC_KEY === 'string' && /^[A-Za-z0-9_-]{80,}$/.test(env.VAPID_PUBLIC_KEY)
    && typeof env.VAPID_PRIVATE_KEY === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(env.VAPID_PRIVATE_KEY);
}

// VAPID identification: an ES256 JWT over { aud, exp, sub }, sent as
// `Authorization: vapid t=<jwt>,k=<public key>`.
async function vapidAuthorization(env: Env, endpoint: string) {
  const publicKey = b64urlDecode(env.VAPID_PUBLIC_KEY!);
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error('VAPID_PUBLIC_KEY must be a base64url uncompressed P-256 point.');
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64url(publicKey.slice(1, 33)),
    y: b64url(publicKey.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY,
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT || 'mailto:admin@coffeencode.cc',
  })));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(`${header}.${payload}`),
  );
  return `vapid t=${header}.${payload}.${b64url(signature)},k=${env.VAPID_PUBLIC_KEY}`;
}

// Encrypts one message as a single aes128gcm record:
//   salt(16) | rs(4) | idlen(1) | ephemeral public key(65) | AES-128-GCM(payload | 0x02)
async function encryptPayload(keys: WebPushKeys, payload: Uint8Array) {
  const subscriberPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  if (subscriberPublic.length !== 65 || subscriberPublic[0] !== 4) throw new Error('The subscription p256dh key is malformed.');

  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  ) as CryptoKeyPair;
  const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey) as ArrayBuffer);
  const subscriberKey = await crypto.subtle.importKey('raw', subscriberPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', $public: subscriberKey },
    ephemeral.privateKey,
    256,
  ));

  // RFC 8291 §3.3: mix the ECDH secret with the subscription's auth secret.
  const ikm = await hkdf(authSecret, sharedSecret, concat(encoder.encode('WebPush: info\0'), subscriberPublic, ephemeralPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const record = concat(payload, new Uint8Array([0x02])); // last-record delimiter
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    aesKey,
    record,
  ));

  const header = new Uint8Array(16 + 4 + 1 + ephemeralPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096); // record size
  header[20] = ephemeralPublic.length;
  header.set(ephemeralPublic, 21);
  return concat(header, ciphertext);
}

export async function sendWebPush(
  env: Env,
  subscription: { endpoint: string; keys: WebPushKeys },
  message: { title: string; body: string; url: string; tag?: string },
): Promise<WebPushResult> {
  try {
    const body = await encryptPayload(subscription.keys, encoder.encode(JSON.stringify(message)));
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(env, subscription.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
      },
      body,
    });
    if (response.status === 404 || response.status === 410) return 'gone';
    if (!response.ok) {
      console.error(`Web push to ${subscription.endpoint.slice(0, 60)}… failed (${response.status}).`);
      return 'error';
    }
    return 'ok';
  } catch (error) {
    console.error('Web push send failed:', error);
    return 'error';
  }
}
