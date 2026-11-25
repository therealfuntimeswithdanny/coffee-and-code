import type { Env } from '../types';
import type { Notification } from './notifications';
import { renderContent, toPlainText } from './contentRenderer';
import verificationTemplate from '../../cloudflare/email/templates/verification.html';
import digestTemplate from '../../cloudflare/email/templates/digest.html';

// Email is sent through a Cloudflare `send_email` binding (see wrangler.toml).
// The binding is optional so `wrangler dev` keeps working without one; sends
// are logged and skipped when it is absent.
export type SendEmailBinding = {
  send(message: EmailMessage): Promise<void>;
};

const FROM_ADDRESS = 'newsletter@coffeencode.cc';
const SITE_ORIGIN = 'https://coffeencode.cc';

// Templates in cloudflare/email/templates are complete documents using
// {{name}} placeholders; every value passed here is already HTML-escaped or
// a trusted URL. A repeating block is written once at the bottom of the
// template between {{#item}} and {{/item}} markers and expanded by render().
function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

// Splits a template into its document and the {{#item}} repeating block.
function splitItemBlock(template: string) {
  const match = template.match(/\{\{#item\}\}([\s\S]*?)\{\{\/item\}\}/);
  return {
    document: match ? template.replace(match[0], '') : template,
    item: match ? match[1] : '',
  };
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
    // EmailMessage is a runtime-provided class, not a plain object.
    const { EmailMessage } = await import('cloudflare:email');
    const raw = buildMime({
      fromName: env.PUB_NAME || 'Coffee & Code',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      unsubscribeUrl: options.unsubscribeUrl,
    });
    await env.EMAIL.send(new EmailMessage(FROM_ADDRESS, options.to, raw));
    return true;
  } catch (error) {
    console.error(`Email send to ${options.to} failed:`, error);
    return false;
  }
}

export function verificationEmail(env: Env, verifyUrl: string) {
  const pubName = env.PUB_NAME || 'Coffee & Code';
  const html = fill(verificationTemplate, {
    pubName: escapeHtml(pubName),
    verifyUrl: escapeHtml(verifyUrl),
    siteUrl: SITE_ORIGIN,
  });
  const text = `Confirm your email address\n\n`
    + `Someone added this address to ${pubName} story notifications. Confirm it within 24 hours to start receiving new stories:\n\n${verifyUrl}\n\n`
    + `If you did not request this, you can ignore this email — the address will not be used.`;
  return { subject: `Confirm your email for ${pubName} notifications`, html, text };
}

export async function followedPostsEmail(env: Env, notifications: Notification[], unsubscribeUrl: string, manageUrl: string, options: { label?: string } = {}) {
  const pubName = env.PUB_NAME || 'Coffee & Code';
  const items = await Promise.all(notifications.map(async (notification) => {
    const url = `${SITE_ORIGIN}${notification.documentPath || '/'}`;
    const actor = notification.actorName || notification.actorHandle || 'A followed author';
    const reason = notification.matchedTags?.length
      ? `Matches your followed ${notification.matchedTags.length === 1 ? 'tag' : 'tags'}: ${notification.matchedTags.join(', ')}`
      : `Published by ${actor}`;
    const title = notification.documentTitle || 'Untitled story';
    let bodyHtml = '';
    let bodyText = '';
    if (notification.documentContent) {
      try {
        bodyHtml = await renderContent(notification.documentContent, notification.documentFormat, notification.documentMimeType);
      } catch {
        bodyHtml = '';
      }
      bodyText = toPlainText(notification.documentContent, notification.documentMimeType);
    }
    return {
      url, title, reason, bodyHtml, bodyText,
    };
  }));
  const digest = splitItemBlock(digestTemplate);
  const itemsHtml = items.map((item) => fill(digest.item, {
    url: escapeHtml(item.url),
    title: escapeHtml(item.title),
    reason: escapeHtml(item.reason),
    // Rendered story HTML is already sanitized by renderContent.
    body: item.bodyHtml,
  })).join('');
  const baseHeading = items.length === 1 ? 'A new story for you' : `${items.length} new stories for you`;
  const heading = options.label ? `Your ${options.label} — ${baseHeading}` : baseHeading;
  const html = fill(digest.document, {
    heading: escapeHtml(heading),
    pubName: escapeHtml(pubName),
    items: itemsHtml,
    manageUrl: escapeHtml(manageUrl),
    unsubscribeUrl: escapeHtml(unsubscribeUrl),
  });
  const text = `${heading}\n\n`
    + items.map((item) => `${item.title}\n${item.reason}\n\n${item.bodyText ? `${item.bodyText}\n\n` : ''}Read it here: ${item.url}`).join('\n\n---\n\n')
    + `\n\nManage email settings: ${manageUrl}\nUnsubscribe: ${unsubscribeUrl}`;
  const subject = items.length === 1
    ? items[0].title
    : `${items.length} new stories on ${pubName}`;
  return { subject, html, text };
}
