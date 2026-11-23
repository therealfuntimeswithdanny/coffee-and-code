import type { Env } from '../types';
import { loadNotificationsForUser, type Notification, type NotificationType } from './notifications';
import { sendWebPush, webPushConfigured, type WebPushKeys } from './webpush';

// Token and state records live in the PUSH_TOKENS KV namespace:
//   device:<pushToken>  -> { did, updatedAt }        one row per registered mobile device
//   web:<sha256(url)>   -> WebSubscription           one row per browser push subscription
//   state:<did>         -> { seen: string[] }         URIs already pushed to this account
const DEVICE_PREFIX = 'device:';
const WEB_PREFIX = 'web:';
const STATE_PREFIX = 'state:';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Notifications are diffed by URI; the set is capped so the KV record stays small.
const MAX_SEEN_URIS = 200;

export type PushDevice = { did: string; updatedAt: string };

// Per-browser toggles mapping notification types to on/off switches.
export type WebPushTopics = {
  comments: boolean;
  replies: boolean;
  likes: boolean;
  reads: boolean;
  newPosts: boolean;
};

export type WebSubscription = {
  did: string;
  endpoint: string;
  keys: WebPushKeys;
  topics: WebPushTopics;
  updatedAt: string;
};

export const DEFAULT_WEB_TOPICS: WebPushTopics = {
  comments: true,
  replies: true,
  likes: true,
  reads: true,
  newPosts: true,
};

const TOPIC_BY_TYPE: Record<NotificationType, keyof WebPushTopics> = {
  comment: 'comments',
  'comment.reply': 'replies',
  'comment.like': 'likes',
  'post.like': 'likes',
  'post.view': 'reads',
  'followed.post': 'newPosts',
};

export function normalizeTopics(value: unknown): WebPushTopics {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const pick = (key: keyof WebPushTopics) => typeof input[key] === 'boolean' ? input[key] as boolean : true;
  return {
    comments: pick('comments'),
    replies: pick('replies'),
    likes: pick('likes'),
    reads: pick('reads'),
    newPosts: pick('newPosts'),
  };
}

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

// KV keys have a 512-byte limit and endpoint URLs can exceed it, so browser
// subscriptions are keyed by the SHA-256 of the endpoint URL.
async function webKey(endpoint: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${WEB_PREFIX}${hex}`;
}

export async function registerWebSubscription(
  env: Env,
  did: string,
  endpoint: string,
  keys: WebPushKeys,
  topics?: unknown,
) {
  const record: WebSubscription = {
    did,
    endpoint,
    keys,
    topics: normalizeTopics(topics),
    updatedAt: new Date().toISOString(),
  };
  await env.PUSH_TOKENS.put(await webKey(endpoint), JSON.stringify(record));
  return record;
}

export async function unregisterWebSubscription(env: Env, endpoint: string) {
  const key = await webKey(endpoint);
  const existing = await env.PUSH_TOKENS.get(key);
  if (!existing) return false;
  await env.PUSH_TOKENS.delete(key);
  return true;
}

export async function loadWebSubscription(env: Env, endpoint: string) {
  return env.PUSH_TOKENS.get<WebSubscription>(await webKey(endpoint), 'json');
}

export async function saveWebTopics(env: Env, endpoint: string, topics: unknown) {
  const existing = await loadWebSubscription(env, endpoint);
  if (!existing) return null;
  existing.topics = normalizeTopics(topics);
  existing.updatedAt = new Date().toISOString();
  await env.PUSH_TOKENS.put(await webKey(endpoint), JSON.stringify(existing));
  return existing;
}

async function listDevices(env: Env) {
  const devices: Array<{ token: string; did: string }> = [];
  const webSubscriptions: WebSubscription[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PUSH_TOKENS.list({ prefix: DEVICE_PREFIX, cursor });
    for (const key of page.keys) {
      const device = await env.PUSH_TOKENS.get<PushDevice>(key.name, 'json');
      if (device?.did) devices.push({ token: key.name.slice(DEVICE_PREFIX.length), did: device.did });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  cursor = undefined;
  do {
    const page: KVNamespaceListResult<unknown, string> = await env.PUSH_TOKENS.list({ prefix: WEB_PREFIX, cursor });
    for (const key of page.keys) {
      const subscription = await env.PUSH_TOKENS.get<WebSubscription>(key.name, 'json');
      if (subscription?.did && subscription.endpoint && subscription.keys?.p256dh && subscription.keys?.auth) {
        subscription.topics = normalizeTopics(subscription.topics);
        webSubscriptions.push(subscription);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { devices, webSubscriptions };
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
  const { devices, webSubscriptions } = await listDevices(env);
  const webEnabled = webPushConfigured(env);
  const dids = [...new Set([
    ...devices.map((device) => device.did),
    ...webSubscriptions.map((subscription) => subscription.did),
  ])];
  for (const did of dids) {
    try {
      const notifications = await loadNotificationsForUser(env, did);
      const state = await env.PUSH_TOKENS.get<{ seen?: string[] }>(`${STATE_PREFIX}${did}`, 'json');
      const seen = new Set(state?.seen || []);
      const fresh = notifications.filter((notification) => !seen.has(notification.uri));
      const tokens = devices.filter((device) => device.did === did).map((device) => device.token);
      const subscriptions = webEnabled ? webSubscriptions.filter((subscription) => subscription.did === did) : [];
      if (state && fresh.length) {
        const batch = fresh.slice(0, 10);
        if (tokens.length) {
          await sendExpoPushes(env, batch.flatMap((notification) =>
            tokens.map((token) => ({ to: token, body: pushBodyFor(notification), uri: notification.uri }))));
        }
        for (const subscription of subscriptions) {
          for (const notification of batch) {
            if (!subscription.topics[TOPIC_BY_TYPE[notification.type]]) continue;
            const result = await sendWebPush(env, subscription, {
              title: 'Coffee & Code',
              body: pushBodyFor(notification),
              url: notification.documentPath || '/',
              tag: notification.uri,
            });
            if (result === 'gone') await unregisterWebSubscription(env, subscription.endpoint);
          }
        }
      }
      for (const notification of notifications.slice(0, MAX_SEEN_URIS)) seen.add(notification.uri);
      await env.PUSH_TOKENS.put(`${STATE_PREFIX}${did}`, JSON.stringify({ seen: [...seen].slice(0, MAX_SEEN_URIS) }));
    } catch (error) {
      console.error(`Push dispatch failed for ${did}:`, error);
    }
  }
}
