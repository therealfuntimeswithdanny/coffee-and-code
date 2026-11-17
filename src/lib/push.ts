import type { Env } from '../types';
import { loadNotificationsForUser, type Notification } from './notifications';

// Token and state records live in the PUSH_TOKENS KV namespace:
//   device:<pushToken>  -> { did, updatedAt }        one row per registered device
//   state:<did>         -> { seen: string[] }         URIs already pushed to this account
const DEVICE_PREFIX = 'device:';
const STATE_PREFIX = 'state:';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Notifications are diffed by URI; the set is capped so the KV record stays small.
const MAX_SEEN_URIS = 200;

export type PushDevice = { did: string; updatedAt: string };

export async function registerPushToken(env: Env, did: string, token: string) {
  await env.PUSH_TOKENS.put(`${DEVICE_PREFIX}${token}`, JSON.stringify({
    did,
    updatedAt: new Date().toISOString(),
  } satisfies PushDevice));
}

export async function unregisterPushToken(env: Env, did: string, token: string) {
  const existing = await env.PUSH_TOKENS.get<PushDevice>(`${DEVICE_PREFIX}${token}`, 'json');
  if (!existing || existing.did !== did) return false;
  await env.PUSH_TOKENS.delete(`${DEVICE_PREFIX}${token}`);
  return true;
}

async function listDevices(env: Env) {
  const devices: Array<{ token: string; did: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await env.PUSH_TOKENS.list({ prefix: DEVICE_PREFIX, cursor });
    for (const key of page.keys) {
      const device = await env.PUSH_TOKENS.get<PushDevice>(key.name, 'json');
      if (device?.did) devices.push({ token: key.name.slice(DEVICE_PREFIX.length), did: device.did });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return devices;
}

function pushBodyFor(notification: Notification) {
  const actor = notification.actorName || notification.actorHandle || 'Someone';
  switch (notification.type) {
    case 'comment': return `${actor} commented on “${notification.documentTitle}”`;
    case 'comment.reply': return `${actor} replied to your comment on “${notification.documentTitle}”`;
    case 'comment.like': return `${actor} liked your reply`;
    case 'post.like': return `${actor} liked “${notification.documentTitle}”`;
    case 'post.view': return `${actor} read “${notification.documentTitle}”`;
    case 'followed.post': return notification.matchedTags?.length
      ? `New story about ${notification.matchedTags.join(', ')}: “${notification.documentTitle}”`
      : `${actor} published “${notification.documentTitle}”`;
    case 'mention': return `${actor} mentioned you`;
    case 'quote': return `${actor} quoted your post`;
    case 'repost': return `${actor} reposted your post`;
    case 'follow': return `${actor} followed you`;
    default: return `${actor} interacted with your post`;
  }
}

type ExpoTicket = { status: 'ok' | 'error'; details?: { error?: string } };

async function sendExpoPushes(env: Env, messages: Array<{ to: string; body: string; uri: string }>) {
  const deadTokens: string[] = [];
  // Expo accepts at most 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk.map((message) => ({
          to: message.to,
          sound: 'default',
          title: 'Coffee & Code',
          body: message.body,
          data: { uri: message.uri },
        }))),
      });
      if (!response.ok) {
        console.error(`Expo push request failed (${response.status}).`);
        continue;
      }
      const result = await response.json() as { data?: ExpoTicket[] };
      (result.data || []).forEach((ticket, index) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          deadTokens.push(chunk[index].to);
        }
      });
    } catch (error) {
      console.error('Could not reach the Expo push service:', error);
    }
  }
  await Promise.all(deadTokens.map((token) => env.PUSH_TOKENS.delete(`${DEVICE_PREFIX}${token}`)));
}

// Cron entry point: poll each registered account's notification feed and push
// any URIs not already recorded. A first poll only seeds the seen set so a new
// registration is not flooded with backlog.
export async function dispatchPushNotifications(env: Env) {
  const devices = await listDevices(env);
  const dids = [...new Set(devices.map((device) => device.did))];
  for (const did of dids) {
    try {
      const notifications = await loadNotificationsForUser(env, did);
      const state = await env.PUSH_TOKENS.get<{ seen?: string[] }>(`${STATE_PREFIX}${did}`, 'json');
      const seen = new Set(state?.seen || []);
      const fresh = notifications.filter((notification) => !seen.has(notification.uri));
      const tokens = devices.filter((device) => device.did === did).map((device) => device.token);
      if (state && fresh.length && tokens.length) {
        await sendExpoPushes(env, fresh.slice(0, 10).flatMap((notification) =>
          tokens.map((token) => ({ to: token, body: pushBodyFor(notification), uri: notification.uri }))));
      }
      for (const notification of notifications.slice(0, MAX_SEEN_URIS)) seen.add(notification.uri);
      await env.PUSH_TOKENS.put(`${STATE_PREFIX}${did}`, JSON.stringify({ seen: [...seen].slice(0, MAX_SEEN_URIS) }));
    } catch (error) {
      console.error(`Push dispatch failed for ${did}:`, error);
    }
  }
}
