import type { Env } from '../types';
import { loadNotificationsForUser } from './notifications';
import { followedPostsEmail, sendEmail, verificationEmail } from './email';

// Email subscription records live in the PUSH_TOKENS KV namespace alongside
// the push data:
//   email:settings:<did>  -> EmailSettings     opted-in account preferences
//   email:verify:<token>  -> PendingVerify     address awaiting confirmation
//   email:seen:<did>      -> { seen: string[] } notification URIs already mailed
const SETTINGS_PREFIX = 'email:settings:';
const VERIFY_PREFIX = 'email:verify:';
const SEEN_PREFIX = 'email:seen:';
const PENDING_PREFIX = 'email:pending:';
const MAX_SEEN_URIS = 200;
const MAX_PENDING_ITEMS = 50;
const DIGEST_BATCH = 25;
// Each queued item gets up to this many delivery attempts per recipient
// (initial send plus retries on later cron runs) before it is dropped.
const MAX_SEND_ATTEMPTS = 4;
const VERIFY_TTL_SECONDS = 24 * 60 * 60;
const SITE_ORIGIN = 'https://coffeencode.cc';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailFrequency = 'instant' | 'daily' | 'weekly';

export type SubscribedEmail = {
  address: string;
  verified: boolean;
  account: boolean; // true when the address came from the account's PDS session
  addedAt: string;
  // Optional routing: when either list is non-empty the address only receives
  // stories matching one of its tags or one of its authors (did or handle).
  tags?: string[];
  authors?: string[];
};

export type EmailSettings = {
  enabled: boolean;
  frequency: EmailFrequency;
  manageToken: string;
  emails: SubscribedEmail[];
};

type PendingVerify = { did: string; email: string };

const sanitizeFilters = (values: unknown, maxLength: number): string[] | undefined => {
  if (!Array.isArray(values)) return undefined;
  const cleaned = [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && value.length <= maxLength))].slice(0, 20);
  return cleaned.length ? cleaned : undefined;
};

const defaultSettings = (): EmailSettings => ({
  enabled: false,
  frequency: 'instant',
  manageToken: crypto.randomUUID(),
  emails: [],
});

export function normalizeEmail(address: string) {
  return address.trim().toLowerCase();
}

export async function loadEmailSettings(env: Env, did: string): Promise<EmailSettings> {
  const stored = await env.PUSH_TOKENS.get<EmailSettings>(`${SETTINGS_PREFIX}${did}`, 'json');
  if (!stored || !Array.isArray(stored.emails)) return defaultSettings();
  const frequency: EmailFrequency = stored.frequency === 'daily' || stored.frequency === 'weekly' ? stored.frequency : 'instant';
  return {
    enabled: stored.enabled === true,
    frequency,
    manageToken: typeof stored.manageToken === 'string' && stored.manageToken ? stored.manageToken : crypto.randomUUID(),
    emails: stored.emails
      .filter((entry) => entry && typeof entry.address === 'string' && EMAIL_PATTERN.test(entry.address))
      .map((entry) => ({
        address: normalizeEmail(entry.address),
        verified: entry.verified === true,
        account: entry.account === true,
        addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : new Date().toISOString(),
        tags: sanitizeFilters(entry.tags, 32),
        authors: sanitizeFilters(entry.authors, 253),
      })),
  };
}

export async function saveEmailSettings(env: Env, did: string, settings: EmailSettings) {
  await env.PUSH_TOKENS.put(`${SETTINGS_PREFIX}${did}`, JSON.stringify(settings));
}

// The account's own PDS session email is treated as verified — the user
// proved control of it by signing in with the account.
export async function addAccountEmail(env: Env, did: string, address: string) {
  const settings = await loadEmailSettings(env, did);
  const normalized = normalizeEmail(address);
  const existing = settings.emails.find((entry) => entry.address === normalized);
  if (existing) {
    existing.verified = true;
    existing.account = true;
  } else {
    settings.emails.push({ address: normalized, verified: true, account: true, addedAt: new Date().toISOString() });
  }
  await saveEmailSettings(env, did, settings);
  return settings;
}

// Other addresses require a confirmation email before they receive anything.
export async function requestEmailVerification(env: Env, did: string, address: string) {
  const settings = await loadEmailSettings(env, did);
  const normalized = normalizeEmail(address);
  let entry = settings.emails.find((item) => item.address === normalized);
  if (!entry) {
    entry = { address: normalized, verified: false, account: false, addedAt: new Date().toISOString() };
    settings.emails.push(entry);
    await saveEmailSettings(env, did, settings);
  }
  if (entry.verified) return { alreadyVerified: true as const, sent: false };
  const token = crypto.randomUUID();
  await env.PUSH_TOKENS.put(`${VERIFY_PREFIX}${token}`, JSON.stringify({ did, email: normalized } satisfies PendingVerify), {
    expirationTtl: VERIFY_TTL_SECONDS,
  });
  const verifyUrl = `${SITE_ORIGIN}/email/verify?token=${encodeURIComponent(token)}`;
  const message = verificationEmail(env, verifyUrl);
  const sent = await sendEmail(env, { to: normalized, ...message });
  return { alreadyVerified: false as const, sent };
}

export async function confirmEmailVerification(env: Env, token: string) {
  const pending = await env.PUSH_TOKENS.get<PendingVerify>(`${VERIFY_PREFIX}${token}`, 'json');
  if (!pending || !pending.did || !EMAIL_PATTERN.test(pending.email || '')) return false;
  await env.PUSH_TOKENS.delete(`${VERIFY_PREFIX}${token}`);
  const settings = await loadEmailSettings(env, pending.did);
  const entry = settings.emails.find((item) => item.address === normalizeEmail(pending.email));
  if (!entry) settings.emails.push({ address: normalizeEmail(pending.email), verified: true, account: false, addedAt: new Date().toISOString() });
  else entry.verified = true;
  await saveEmailSettings(env, pending.did, settings);
  return true;
}

export async function removeEmail(env: Env, did: string, address: string) {
  const settings = await loadEmailSettings(env, did);
  const normalized = normalizeEmail(address);
  settings.emails = settings.emails.filter((entry) => entry.address !== normalized);
  await saveEmailSettings(env, did, settings);
  return settings;
}

export async function setEmailEnabled(env: Env, did: string, enabled: boolean) {
  const settings = await loadEmailSettings(env, did);
  settings.enabled = enabled;
  await saveEmailSettings(env, did, settings);
  return settings;
}

export async function setEmailFrequency(env: Env, did: string, frequency: EmailFrequency) {
  const settings = await loadEmailSettings(env, did);
  settings.frequency = frequency;
  await saveEmailSettings(env, did, settings);
  return settings;
}

export async function setEmailFilters(env: Env, did: string, address: string, filters: { tags?: string[]; authors?: string[] }) {
  const settings = await loadEmailSettings(env, did);
  const normalized = normalizeEmail(address);
  const entry = settings.emails.find((item) => item.address === normalized);
  if (!entry) return null;
  entry.tags = sanitizeFilters(filters.tags, 32);
  entry.authors = sanitizeFilters(filters.authors, 253);
  await saveEmailSettings(env, did, settings);
  return settings;
}

export function manageUrlFor(settings: EmailSettings, did: string) {
  return `${SITE_ORIGIN}/email/manage?did=${encodeURIComponent(did)}&token=${encodeURIComponent(settings.manageToken)}`;
}

export function unsubscribeUrlFor(settings: EmailSettings, did: string) {
  return `${SITE_ORIGIN}/email/unsubscribe?did=${encodeURIComponent(did)}&token=${encodeURIComponent(settings.manageToken)}`;
}

export async function unsubscribeByToken(env: Env, did: string, token: string) {
  const settings = await loadEmailSettings(env, did);
  if (settings.manageToken !== token) return null;
  settings.enabled = false;
  await saveEmailSettings(env, did, settings);
  return settings;
}

export function checkManageToken(settings: EmailSettings, token: string | undefined) {
  return typeof token === 'string' && token === settings.manageToken;
}

async function listSubscribedDids(env: Env) {
  const dids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PUSH_TOKENS.list({ prefix: SETTINGS_PREFIX, cursor });
    for (const key of page.keys) dids.push(key.name.slice(SETTINGS_PREFIX.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return dids;
}

type PendingDigestItem = {
  uri: string;
  title: string;
  path: string;
  matchedTags?: string[];
  actorDid?: string;
  actorHandle?: string;
  actorName?: string;
  content?: string;
  format?: string;
  mimeType?: string;
  // Delivery state: addresses that already received the item, and the number
  // of failed dispatch rounds. Items are dropped once every matching
  // recipient has them or the attempt budget is exhausted.
  sentTo?: string[];
  attempts?: number;
};

type PendingDigest = { items: PendingDigestItem[]; lastSent?: string };

// An address with no filters gets everything; filtered addresses only get the
// stories matching one of their tags or authors.
function matchesFilters(item: PendingDigestItem, entry: SubscribedEmail) {
  const tags = entry.tags || [];
  const authors = entry.authors || [];
  if (!tags.length && !authors.length) return true;
  const itemTags = (item.matchedTags || []).map((tag) => tag.toLowerCase());
  if (tags.some((tag) => itemTags.includes(tag))) return true;
  const authorKeys = [item.actorDid, item.actorHandle]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase());
  return authors.some((author) => authorKeys.includes(author));
}

const DIGEST_INTERVAL_MS: Record<Exclude<EmailFrequency, 'instant'>, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

// Cron entry point: for each account with email notifications on, diff the
// notification feed for new followed-post items and mail them to the verified
// addresses whose filters match. 'instant' sends every run; 'daily' and
// 'weekly' queue items and send a brief when the interval has elapsed. The
// first poll only seeds the seen set so a new subscription does not send a
// backlog.
export async function dispatchEmailNotifications(env: Env) {
  const dids = await listSubscribedDids(env);
  for (const did of dids) {
    try {
      const settings = await loadEmailSettings(env, did);
      const recipients = settings.emails.filter((entry) => entry.verified);
      if (!settings.enabled || !recipients.length) continue;
      const notifications = await loadNotificationsForUser(env, did);
      const state = await env.PUSH_TOKENS.get<{ seen?: string[] }>(`${SEEN_PREFIX}${did}`, 'json');
      const seen = new Set(state?.seen || []);
      const fresh = notifications.filter((notification) => notification.type === 'followed.post' && !seen.has(notification.uri));
      for (const notification of notifications.filter((item) => item.type === 'followed.post').slice(0, MAX_SEEN_URIS)) {
        seen.add(notification.uri);
      }
      await env.PUSH_TOKENS.put(`${SEEN_PREFIX}${did}`, JSON.stringify({ seen: [...seen].slice(0, MAX_SEEN_URIS) }));
      if (!state) continue; // first run only seeds the seen set

      const digest = await env.PUSH_TOKENS.get<PendingDigest>(`${PENDING_PREFIX}${did}`, 'json') || { items: [] };
      const pendingUris = new Set(digest.items.map((item) => item.uri));
      for (const notification of fresh) {
        if (pendingUris.has(notification.uri)) continue;
        digest.items.push({
          uri: notification.uri,
          title: notification.documentTitle || 'Untitled story',
          path: notification.documentPath || '/',
          matchedTags: notification.matchedTags,
          actorDid: notification.actorDid,
          actorHandle: notification.actorHandle,
          actorName: notification.actorName,
          content: notification.documentContent,
          format: notification.documentFormat,
          mimeType: notification.documentMimeType,
        });
      }
      digest.items = digest.items.slice(-MAX_PENDING_ITEMS);
      if (!digest.items.length) {
        await env.PUSH_TOKENS.put(`${PENDING_PREFIX}${did}`, JSON.stringify(digest));
        continue;
      }

      if (settings.frequency !== 'instant') {
        const interval = DIGEST_INTERVAL_MS[settings.frequency];
        const lastSent = digest.lastSent ? Date.parse(digest.lastSent) : 0;
        if (Date.now() - lastSent < interval) {
          await env.PUSH_TOKENS.put(`${PENDING_PREFIX}${did}`, JSON.stringify(digest));
          continue;
        }
      }

      const toNotification = (item: PendingDigestItem) => ({
        uri: item.uri,
        type: 'followed.post' as const,
        actorDid: item.actorDid || '',
        subjectUri: '',
        documentUri: '',
        documentTitle: item.title,
        documentPath: item.path,
        matchedTags: item.matchedTags,
        actorName: item.actorName,
        actorHandle: item.actorHandle,
        documentContent: item.content,
        documentFormat: item.format,
        documentMimeType: item.mimeType,
      });
      const batch = digest.items
        .filter((item) => (item.attempts || 0) < MAX_SEND_ATTEMPTS)
        .slice(0, DIGEST_BATCH);
      const unsubscribeUrl = unsubscribeUrlFor(settings, did);
      const manageUrl = manageUrlFor(settings, did);
      const digestLabel = settings.frequency === 'daily' ? 'daily brief' : settings.frequency === 'weekly' ? 'weekly brief' : undefined;
      const failed = new Set<PendingDigestItem>();
      await Promise.all(recipients.map(async (entry) => {
        const items = batch.filter((item) => !(item.sentTo || []).includes(entry.address)
          && matchesFilters(item, entry));
        if (!items.length) return;
        const message = await followedPostsEmail(env, items.map(toNotification), unsubscribeUrl, manageUrl, { label: digestLabel });
        const sent = await sendEmail(env, { to: entry.address, ...message });
        for (const item of items) {
          if (sent) item.sentTo = [...(item.sentTo || []), entry.address];
          else failed.add(item);
        }
      }));
      for (const item of failed) item.attempts = (item.attempts || 0) + 1;
      // Drop an item once every matching recipient received it or its failed
      // attempts are exhausted; anything else stays queued for the next run.
      digest.items = digest.items.filter((item) => (item.attempts || 0) < MAX_SEND_ATTEMPTS
        && recipients.some((entry) => !(item.sentTo || []).includes(entry.address)
          && matchesFilters(item, entry)));
      digest.lastSent = new Date().toISOString();
      await env.PUSH_TOKENS.put(`${PENDING_PREFIX}${did}`, JSON.stringify(digest));
    } catch (error) {
      console.error(`Email dispatch failed for ${did}:`, error);
    }
  }
}
