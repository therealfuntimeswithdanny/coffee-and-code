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
const MAX_SEEN_URIS = 200;
const VERIFY_TTL_SECONDS = 24 * 60 * 60;
const SITE_ORIGIN = 'https://coffeencode.cc';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SubscribedEmail = {
  address: string;
  verified: boolean;
  account: boolean; // true when the address came from the account's PDS session
  addedAt: string;
};

export type EmailSettings = {
  enabled: boolean;
  manageToken: string;
  emails: SubscribedEmail[];
};

type PendingVerify = { did: string; email: string };

const defaultSettings = (): EmailSettings => ({
  enabled: false,
  manageToken: crypto.randomUUID(),
  emails: [],
});

export function normalizeEmail(address: string) {
  return address.trim().toLowerCase();
}

export async function loadEmailSettings(env: Env, did: string): Promise<EmailSettings> {
  const stored = await env.PUSH_TOKENS.get<EmailSettings>(`${SETTINGS_PREFIX}${did}`, 'json');
  if (!stored || !Array.isArray(stored.emails)) return defaultSettings();
  return {
    enabled: stored.enabled === true,
    manageToken: typeof stored.manageToken === 'string' && stored.manageToken ? stored.manageToken : crypto.randomUUID(),
    emails: stored.emails
      .filter((entry) => entry && typeof entry.address === 'string' && EMAIL_PATTERN.test(entry.address))
      .map((entry) => ({
        address: normalizeEmail(entry.address),
        verified: entry.verified === true,
        account: entry.account === true,
        addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : new Date().toISOString(),
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

// Cron entry point: for each account with email notifications on, diff the
// notification feed for new followed-post items and mail a digest to every
// verified address. The first poll only seeds the seen set so a new
// subscription does not send a backlog.
export async function dispatchEmailNotifications(env: Env) {
  const dids = await listSubscribedDids(env);
  for (const did of dids) {
    try {
      const settings = await loadEmailSettings(env, did);
      const recipients = settings.emails.filter((entry) => entry.verified).map((entry) => entry.address);
      if (!settings.enabled || !recipients.length) continue;
      const notifications = await loadNotificationsForUser(env, did);
      const state = await env.PUSH_TOKENS.get<{ seen?: string[] }>(`${SEEN_PREFIX}${did}`, 'json');
      const seen = new Set(state?.seen || []);
      const fresh = notifications.filter((notification) => notification.type === 'followed.post' && !seen.has(notification.uri));
      if (state && fresh.length) {
        const message = followedPostsEmail(env, fresh.slice(0, 10), unsubscribeUrlFor(settings, did), manageUrlFor(settings, did));
        await Promise.all(recipients.map((to) => sendEmail(env, { to, ...message })));
      }
      for (const notification of notifications.filter((item) => item.type === 'followed.post').slice(0, MAX_SEEN_URIS)) {
        seen.add(notification.uri);
      }
      await env.PUSH_TOKENS.put(`${SEEN_PREFIX}${did}`, JSON.stringify({ seen: [...seen].slice(0, MAX_SEEN_URIS) }));
    } catch (error) {
      console.error(`Email dispatch failed for ${did}:`, error);
    }
  }
}
