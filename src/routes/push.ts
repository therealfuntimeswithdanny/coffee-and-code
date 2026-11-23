import { Hono } from 'hono';
import { Env } from '../types';
import {
  loadWebSubscription,
  normalizeTopics,
  registerPushToken,
  registerWebSubscription,
  saveWebTopics,
  unregisterPushToken,
  unregisterWebSubscription,
} from '../lib/push';
import { webPushConfigured } from '../lib/webpush';

const push = new Hono<{ Bindings: Env }>();

const DID_PATTERN = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;
const EXPO_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]\s]+\]$/;

function parseBody(body: unknown) {
  if (typeof body !== 'object' || body === null) return null;
  const { did, token } = body as { did?: unknown; token?: unknown };
  if (typeof did !== 'string' || !DID_PATTERN.test(did)) return null;
  if (typeof token !== 'string' || !EXPO_TOKEN_PATTERN.test(token)) return null;
  return { did, token };
}

function parseEndpoint(value: unknown) {
  if (typeof value !== 'string' || value.length > 1024) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseWebKeys(value: unknown) {
  if (typeof value !== 'object' || value === null) return null;
  const { p256dh, auth } = value as { p256dh?: unknown; auth?: unknown };
  const keyPattern = /^[A-Za-z0-9_-]{8,256}$/;
  if (typeof p256dh !== 'string' || !keyPattern.test(p256dh)) return null;
  if (typeof auth !== 'string' || !keyPattern.test(auth)) return null;
  return { p256dh, auth };
}

push.post('/register', async (c) => {
  const parsed = parseBody(await c.req.json().catch(() => null));
  if (!parsed) return c.json({ error: 'A valid did and Expo push token are required.' }, 400);
  await registerPushToken(c.env, parsed.did, parsed.token);
  return c.json({ registered: true });
});

push.post('/unregister', async (c) => {
  const parsed = parseBody(await c.req.json().catch(() => null));
  if (!parsed) return c.json({ error: 'A valid did and Expo push token are required.' }, 400);
  const removed = await unregisterPushToken(c.env, parsed.did, parsed.token);
  return c.json({ registered: !removed });
});

// Browser (Web Push) subscriptions -------------------------------------------------

// The public key the page passes to pushManager.subscribe() as
// applicationServerKey.
push.get('/web/key', (c) => {
  if (!webPushConfigured(c.env)) return c.json({ error: 'Browser notifications are not configured on this site.' }, 503);
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

// Whether this browser's subscription is on file, and which categories it gets.
push.get('/web/subscription', async (c) => {
  const endpoint = parseEndpoint(c.req.query('endpoint'));
  if (!endpoint) return c.json({ error: 'A valid endpoint is required.' }, 400);
  const subscription = await loadWebSubscription(c.env, endpoint);
  if (!subscription) return c.json({ subscribed: false });
  return c.json({ subscribed: true, did: subscription.did, topics: subscription.topics });
});

push.post('/web/register', async (c) => {
  const body = await c.req.json().catch(() => null) as {
    did?: unknown; endpoint?: unknown; keys?: unknown; topics?: unknown;
  } | null;
  const endpoint = parseEndpoint(body?.endpoint);
  const keys = parseWebKeys(body?.keys);
  if (!body || typeof body.did !== 'string' || !DID_PATTERN.test(body.did) || !endpoint || !keys) {
    return c.json({ error: 'A valid did, endpoint, and encryption keys are required.' }, 400);
  }
  const subscription = await registerWebSubscription(c.env, body.did, endpoint, keys, body.topics);
  return c.json({ registered: true, topics: subscription.topics });
});

push.post('/web/unregister', async (c) => {
  const body = await c.req.json().catch(() => null) as { endpoint?: unknown } | null;
  const endpoint = parseEndpoint(body?.endpoint);
  if (!endpoint) return c.json({ error: 'A valid endpoint is required.' }, 400);
  await unregisterWebSubscription(c.env, endpoint);
  return c.json({ registered: false });
});

push.post('/web/topics', async (c) => {
  const body = await c.req.json().catch(() => null) as { endpoint?: unknown; topics?: unknown } | null;
  const endpoint = parseEndpoint(body?.endpoint);
  if (!endpoint) return c.json({ error: 'A valid endpoint is required.' }, 400);
  const subscription = await saveWebTopics(c.env, endpoint, body?.topics);
  if (!subscription) return c.json({ error: 'This browser is not subscribed yet.' }, 404);
  return c.json({ topics: normalizeTopics(subscription.topics) });
});

export default push;
