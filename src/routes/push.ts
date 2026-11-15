import { Hono } from 'hono';
import { Env } from '../types';
import { registerPushToken, unregisterPushToken } from '../lib/push';

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

export default push;
