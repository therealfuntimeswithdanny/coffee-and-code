import type { Env } from '../types';
import type { Notification } from './notifications';
import layoutTemplate from '../../cloudflare/email/templates/layout.html';
import verificationTemplate from '../../cloudflare/email/templates/verification.html';
import verificationFooterTemplate from '../../cloudflare/email/templates/verification-footer.html';
import digestTemplate from '../../cloudflare/email/templates/digest.html';
import digestItemTemplate from '../../cloudflare/email/templates/digest-item.html';
import digestFooterTemplate from '../../cloudflare/email/templates/digest-footer.html';

// Email is sent through a Cloudflare `send_email` binding (see wrangler.toml).
// The binding is optional so `wrangler dev` keeps working without one; sends
// are logged and skipped when it is absent.
export type SendEmailBinding = {
  send(message: { from: string; to: string; raw: string | ArrayBuffer | ReadableStream }): Promise<void>;
};

const FROM_ADDRESS = 'newsletter@coffeencode.cc';
const SITE_ORIGIN = 'https://coffeencode.cc';

// Templates in cloudflare/email/templates use {{name}} placeholders; every
// value passed here is already HTML-escaped or a trusted URL.
function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function encodeHeader(value: string) {
  // RFC 2047 encode when the header value contains non-ASCII characters.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

function buildMime(options: {
  fromName: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string;
}) {
  const boundary = `----cnc-${crypto.randomUUID()}`;
  const headers = [
    `From: ${encodeHeader(options.fromName)} <${FROM_ADDRESS}>`,
    `To: <${options.to}>`,
    `Subject: ${encodeHeader(options.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (options.unsubscribeUrl) {
    headers.push(`List-Unsubscribe: <${options.unsubscribeUrl}>`);
    headers.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  }
  const encode = (body: string) => btoa(unescape(encodeURIComponent(body)))
    .replace(/.{76}/g, '$&\r\n');
  return `${headers.join('\r\n')}\r\n\r\n`
    + `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encode(options.text)}\r\n`
    + `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encode(options.html)}\r\n`
    + `--${boundary}--\r\n`;
}

export async function sendEmail(env: Env, options: {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string;
}): Promise<boolean> {
  if (!env.EMAIL) {
    console.warn(`Email binding is not configured; skipped "${options.subject}" for ${options.to}.`);
    return false;
  }
  try {
    await env.EMAIL.send({
      from: FROM_ADDRESS,
      to: options.to,
      raw: buildMime({
        fromName: env.PUB_NAME || 'Coffee & Code',
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        unsubscribeUrl: options.unsubscribeUrl,
      }),
    });
    return true;
  } catch (error) {
    console.error(`Email send to ${options.to} failed:`, error);
    return false;
  }
}

// The shared chrome mirrors the site's coffee-brown palette (see
// SITE-DESIGN.md) with table markup and inline styles for email-client
// compatibility.
function renderEmailPage(pubName: string, preheader: string, bodyHtml: string, footerHtml: string) {
  return fill(layoutTemplate, { pubName, preheader, body: bodyHtml, footer: footerHtml });
}

export function verificationEmail(env: Env, verifyUrl: string) {
  const pubName = env.PUB_NAME || 'Coffee & Code';
  const body = fill(verificationTemplate, {
    pubName: escapeHtml(pubName),
    verifyUrl: escapeHtml(verifyUrl),
  });
  const footer = fill(verificationFooterTemplate, {
    pubName: escapeHtml(pubName),
    siteUrl: SITE_ORIGIN,
  });
  const html = renderEmailPage(
    escapeHtml(pubName),
    'Confirm this email address for Coffee & Code story notifications.',
    body,
    footer,
  );
  const text = `Confirm your email address\n\n`
    + `Someone added this address to ${pubName} story notifications. Confirm it within 24 hours to start receiving new stories:\n\n${verifyUrl}\n\n`
    + `If you did not request this, you can ignore this email — the address will not be used.`;
  return { subject: `Confirm your email for ${pubName} notifications`, html, text };
}

export function followedPostsEmail(env: Env, notifications: Notification[], unsubscribeUrl: string, manageUrl: string) {
  const pubName = env.PUB_NAME || 'Coffee & Code';
  const items = notifications.map((notification) => {
    const url = `${SITE_ORIGIN}${notification.documentPath || '/'}`;
    const actor = notification.actorName || notification.actorHandle || 'A followed author';
    const reason = notification.matchedTags?.length
      ? `Matches your followed ${notification.matchedTags.length === 1 ? 'tag' : 'tags'}: ${notification.matchedTags.join(', ')}`
      : `Published by ${actor}`;
    const title = notification.documentTitle || 'Untitled story';
    return {
      url, title, reason,
    };
  });
  const itemsHtml = items.map((item) => fill(digestItemTemplate, {
    url: escapeHtml(item.url),
    title: escapeHtml(item.title),
    reason: escapeHtml(item.reason),
  })).join('');
  const heading = items.length === 1 ? '1 new story for you' : `${items.length} new stories for you`;
  const body = fill(digestTemplate, {
    heading: escapeHtml(heading),
    pubName: escapeHtml(pubName),
    items: itemsHtml,
  });
  const footer = fill(digestFooterTemplate, {
    pubName: escapeHtml(pubName),
    manageUrl: escapeHtml(manageUrl),
    unsubscribeUrl: escapeHtml(unsubscribeUrl),
  });
  const html = renderEmailPage(escapeHtml(pubName), `${heading} from the people and tags you follow.`, body, footer);
  const text = `${heading}\n\n`
    + items.map((item) => `${item.title}\n${item.reason}\n${item.url}`).join('\n\n')
    + `\n\nManage email settings: ${manageUrl}\nUnsubscribe: ${unsubscribeUrl}`;
  const subject = items.length === 1
    ? `New story: ${items[0].title}`
    : `${items.length} new stories on ${pubName}`;
  return { subject, html, text };
}
