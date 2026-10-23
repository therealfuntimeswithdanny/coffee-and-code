// workers/handle-service/src/index.ts
var DOMAIN = "coffeencode.cc";
var RESERVED = /* @__PURE__ */ new Set([
  "www",
  "account",
  "api",
  "admin",
  "auth",
  "blog",
  "cdn",
  "mail",
  "static",
  "handles"
]);
var CLAIM_COLLECTION = "cc.coffeencode.handle.claim";
var HANDLE_TTL_SECONDS = 60 * 60 * 24 * 365;
var CHALLENGE_TTL_SECONDS = 10 * 60;
function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}
    }
  });
}
function plain(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  });
}
function validateHandle(input) {
  if (typeof input !== "string") return;
  const handle = input.trim().toLowerCase();
  if (handle.length < 2 || handle.length > 20) return;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(handle)) return;
  if (RESERVED.has(handle)) return;
  return handle;
}
function validateDid(input) {
  if (typeof input !== "string") return;
  const did = input.trim();
  if (did.length > 256 || !/^did:(?:plc:[a-z2-7]{20,}|web:[a-z0-9.:%-]+)$/.test(did)) return;
  return did;
}
function validOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return origin === env.ALLOWED_ORIGIN ? origin : void 0;
}
async function readJson(request) {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
function handleFromHost(host) {
  const suffix = `.${DOMAIN}`;
  if (!host.endsWith(suffix)) return;
  const handle = host.slice(0, -suffix.length);
  if (!handle || handle.includes(".")) return;
  return validateHandle(handle);
}
async function publicPdsRecord(env, did, rkey) {
  const url = new URL("/xrpc/com.atproto.repo.getRecord", env.ACCOUNT_PDS);
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", CLAIM_COLLECTION);
  url.searchParams.set("rkey", rkey);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return;
  return await response.json();
}
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = validOrigin(request, env);
    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "600",
          Vary: "Origin"
        }
      });
    }
    if (request.method === "GET" && url.pathname === "/.well-known/atproto-did") {
      const handle = handleFromHost(url.hostname.toLowerCase());
      if (!handle) return plain("Not found", 404);
      const did = await env.HANDLES.get(`handle:${handle}`);
      return did ? plain(did) : plain("Not found", 404);
    }
    if (url.hostname.toLowerCase() !== `handles.${DOMAIN}`) return plain("Not found", 404);
    if (!origin) return json({ error: "Origin not allowed." }, 403);
    if (request.method === "POST" && url.pathname === "/claim/challenge") {
      const body = await readJson(request);
      if (!body) return json({ error: "A JSON body is required." }, 400, origin);
      const handle = validateHandle(body.handle);
      const did = validateDid(body.did);
      if (!handle || !did) return json({ error: "A valid handle and DID are required." }, 400, origin);
      const [existingDid, existingHandle] = await Promise.all([
        env.HANDLES.get(`did:${did}`),
        env.HANDLES.get(`handle:${handle}`)
      ]);
      if (existingDid) return json({ error: "This DID already has a Coffee & Code handle." }, 409, origin);
      if (existingHandle) return json({ error: "That handle is already taken." }, 409, origin);
      const id = crypto.randomUUID();
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
      const nonce = Array.from(nonceBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const challenge = { did, handle, nonce };
      await env.HANDLES.put(`challenge:${id}`, JSON.stringify(challenge), { expirationTtl: CHALLENGE_TTL_SECONDS });
      return json({ challengeId: id, nonce, collection: CLAIM_COLLECTION, expiresIn: CHALLENGE_TTL_SECONDS }, 201, origin);
    }
    if (request.method === "POST" && url.pathname === "/claim") {
      const body = await readJson(request);
      if (!body) return json({ error: "A JSON body is required." }, 400, origin);
      const handle = validateHandle(body.handle);
      const did = validateDid(body.did);
      const challengeId = typeof body.challengeId === "string" && /^[0-9a-f-]{36}$/i.test(body.challengeId) ? body.challengeId : void 0;
      const recordUri = typeof body.recordUri === "string" ? body.recordUri : "";
      const uriMatch = /^at:\/\/(did:[a-z0-9:.-]+)\/cc\.coffeencode\.handle\.claim\/([a-zA-Z0-9._~:-]+)$/.exec(recordUri);
      if (!handle || !did || !challengeId || !uriMatch || uriMatch[1] !== did) {
        return json({ error: "A valid handle, DID, challenge ID, and claim record URI are required." }, 400, origin);
      }
      const challengeJson = await env.HANDLES.get(`challenge:${challengeId}`);
      if (!challengeJson) return json({ error: "The verification challenge expired or was already used." }, 410, origin);
      const challenge = JSON.parse(challengeJson);
      if (challenge.did !== did || challenge.handle !== handle) {
        return json({ error: "The verification challenge does not match this DID and handle." }, 400, origin);
      }
      let record;
      try {
        record = await publicPdsRecord(env, did, uriMatch[2]);
      } catch {
        return json({ error: "Could not verify the account proof record." }, 502, origin);
      }
      if (record?.uri !== recordUri || record.value?.handle !== handle || record.value?.nonce !== challenge.nonce) {
        return json({ error: "The account proof record is missing or does not match this challenge." }, 403, origin);
      }
      const [existingDid, existingHandle] = await Promise.all([
        env.HANDLES.get(`did:${did}`),
        env.HANDLES.get(`handle:${handle}`)
      ]);
      if (existingDid) return json({ error: "This DID already has a Coffee & Code handle." }, 409, origin);
      if (existingHandle) return json({ error: "That handle has already been claimed." }, 409, origin);
      await env.HANDLES.put(`handle:${handle}`, did, { expirationTtl: HANDLE_TTL_SECONDS });
      await env.HANDLES.put(`did:${did}`, handle, { expirationTtl: HANDLE_TTL_SECONDS });
      await env.HANDLES.delete(`challenge:${challengeId}`);
      return json({ success: true, handle: `${handle}.${DOMAIN}`, did }, 201, origin);
    }
    return json({ error: "Not found." }, 404, origin);
  }
};
export {
  index_default as default
};
