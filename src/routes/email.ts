import { Hono, type Context } from 'hono';
import { Env } from '../types';
import {
  addAccountEmail,
  checkManageToken,
  confirmEmailVerification,
  EMAIL_PATTERN,
  loadEmailSettings,
  normalizeEmail,
  removeEmail,
  requestEmailVerification,
  setEmailEnabled,
  setEmailFilters,
  setEmailFrequency,
  unsubscribeByToken,
} from '../lib/emailSubscriptions';
import { renderLayout } from '../templates/layout';
import { escapeHtml } from '../lib/email';

const email = new Hono<{ Bindings: Env }>();

const DID_PATTERN = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;

function parseDid(body: unknown) {
  if (typeof body !== 'object' || body === null) return null;
  const { did } = body as { did?: unknown };
  return typeof did === 'string' && DID_PATTERN.test(did) ? did : null;
}

function publicSettings(settings: Awaited<ReturnType<typeof loadEmailSettings>>) {
  return {
    enabled: settings.enabled,
    frequency: settings.frequency,
    emails: settings.emails.map((entry) => ({
      address: entry.address,
      verified: entry.verified,
      account: entry.account,
      tags: entry.tags || [],
      authors: entry.authors || [],
    })),
  };
}

email.get('/api/email/settings', async (c) => {
  const did = c.req.query('did') || '';
  if (!DID_PATTERN.test(did)) return c.json({ error: 'A valid did is required.' }, 400);
  const settings = await loadEmailSettings(c.env, did);
  return c.json(publicSettings(settings));
});

email.post('/api/email/settings', async (c) => {
  const body = await c.req.json().catch(() => null);
  const did = parseDid(body);
  const enabled = typeof (body as { enabled?: unknown } | null)?.enabled === 'boolean'
    ? (body as { enabled: boolean }).enabled
    : null;
  if (!did || enabled === null) return c.json({ error: 'A valid did and enabled flag are required.' }, 400);
  const settings = await setEmailEnabled(c.env, did, enabled);
  return c.json(publicSettings(settings));
});

email.put('/api/email/settings', async (c) => {
  const body = await c.req.json().catch(() => null);
  const did = parseDid(body);
  const frequency = (body as { frequency?: unknown } | null)?.frequency;
  if (!did || (frequency !== 'instant' && frequency !== 'daily' && frequency !== 'weekly')) {
    return c.json({ error: 'A valid did and frequency (instant, daily, or weekly) are required.' }, 400);
  }
  const settings = await setEmailFrequency(c.env, did, frequency);
  return c.json(publicSettings(settings));
});

// Per-address routing filters: tags and authors (handles or dids) limit which
// stories that address receives. Empty lists mean the address gets everything.
email.put('/api/email/addresses', async (c) => {
  const body = await c.req.json().catch(() => null);
  const did = parseDid(body);
  const address = (body as { email?: unknown } | null)?.email;
  const tags = (body as { tags?: unknown } | null)?.tags;
  const authors = (body as { authors?: unknown } | null)?.authors;
  if (!did || typeof address !== 'string' || !EMAIL_PATTERN.test(normalizeEmail(address))) {
    return c.json({ error: 'A valid did and email address are required.' }, 400);
  }
  if ((tags !== undefined && !Array.isArray(tags)) || (authors !== undefined && !Array.isArray(authors))) {
    return c.json({ error: 'Filters must be arrays of strings.' }, 400);
  }
  const settings = await setEmailFilters(c.env, did, address, {
    tags: tags as string[] | undefined,
    authors: authors as string[] | undefined,
  });
  if (!settings) return c.json({ error: 'That email address is not on your list.' }, 404);
  return c.json(publicSettings(settings));
});

// The client reads the signed-in account's email from its PDS session
// (com.atproto.server.getSession) and registers it here as already verified.
email.post('/api/email/account-email', async (c) => {
  const body = await c.req.json().catch(() => null);
  const did = parseDid(body);
  const address = (body as { email?: unknown } | null)?.email;
  if (!did || typeof address !== 'string' || !EMAIL_PATTERN.test(normalizeEmail(address))) {
    return c.json({ error: 'A valid did and email address are required.' }, 400);
  }
  const settings = await addAccountEmail(c.env, did, address);
  return c.json(publicSettings(settings));
});

email.post('/api/email/addresses', async (c) => {
  const body = await c.req.json().catch(() => null);
  const did = parseDid(body);
  const address = (body as { email?: unknown } | null)?.email;
  if (!did || typeof address !== 'string' || !EMAIL_PATTERN.test(normalizeEmail(address))) {
    return c.json({ error: 'A valid did and email address are required.' }, 400);
  }
  const result = await requestEmailVerification(c.env, did, address);
  const settings = await loadEmailSettings(c.env, did);
  return c.json({
    ...publicSettings(settings),
    verificationSent: result.sent,
    alreadyVerified: result.alreadyVerified,
  });
});

email.delete('/api/email/addresses', async (c) => {
  const body = await c.req.json().catch(() => null);
  const did = parseDid(body);
  const address = (body as { email?: unknown } | null)?.email;
  if (!did || typeof address !== 'string' || !EMAIL_PATTERN.test(normalizeEmail(address))) {
    return c.json({ error: 'A valid did and email address are required.' }, 400);
  }
  const settings = await removeEmail(c.env, did, address);
  return c.json(publicSettings(settings));
});

function emailResultPage(c: Context<{ Bindings: Env }>, title: string, message: string, linkHref: string, linkLabel: string) {
  const body = `
    <section class="auth-page">
      <h1>${escapeHtml(title)}</h1>
      <p class="auth-page__intro">${escapeHtml(message)}</p>
      <a class="login-button" href="${escapeHtml(linkHref)}">${escapeHtml(linkLabel)}</a>
    </section>`;
  return c.html(renderLayout(c, title, body));
}

email.get('/email/verify', async (c) => {
  const token = c.req.query('token') || '';
  if (!token) return emailResultPage(c, 'Link expired', 'This confirmation link is missing its token. Request a new verification email from your account settings.', '/account', 'Open account settings');
  const confirmed = await confirmEmailVerification(c.env, token);
  if (!confirmed) return emailResultPage(c, 'Link expired', 'This confirmation link has expired or was already used. Request a new verification email from your account settings.', '/account', 'Open account settings');
  return emailResultPage(c, 'Email confirmed', 'Your email address is confirmed. Turn on email notifications in your account settings to get new stories in your inbox.', '/account', 'Open account settings');
});

email.get('/email/unsubscribe', async (c) => {
  const did = c.req.query('did') || '';
  const token = c.req.query('token') || '';
  if (!DID_PATTERN.test(did) || !token) return emailResultPage(c, 'Unsubscribe failed', 'This unsubscribe link is invalid.', '/', 'Back to home');
  const settings = await unsubscribeByToken(c.env, did, token);
  if (!settings) return emailResultPage(c, 'Unsubscribe failed', 'This unsubscribe link is invalid or has changed. Sign in and update your email settings instead.', '/account', 'Open account settings');
  return emailResultPage(c, 'Unsubscribed', 'Email notifications are now off for your account. You can turn them back on any time from your account settings.', '/account', 'Open account settings');
});

email.get('/email/manage', async (c) => {
  const did = c.req.query('did') || '';
  const token = c.req.query('token') || '';
  if (!DID_PATTERN.test(did)) return c.redirect('/account');
  const settings = await loadEmailSettings(c.env, did);
  if (!checkManageToken(settings, token)) return emailResultPage(c, 'Link expired', 'This email settings link is no longer valid. Sign in to manage your email notifications.', '/account', 'Open account settings');
  return c.redirect('/account');
});

export default email;
