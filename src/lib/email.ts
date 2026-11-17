import type { Env } from '../types';
import type { Notification } from './notifications';

// Email is sent through a Cloudflare `send_email` binding (see wrangler.toml).
// The binding is optional so `wrangler dev` keeps working without one; sends
// are logged and skipped when it is absent.
export type SendEmailBinding = {
  send(message: { from: string; to: string; raw: string | ArrayBuffer | ReadableStream }): Promise<void>;
};

const FROM_ADDRESS = 'newsletter@coffeencode.cc';
const SITE_ORIGIN = 'https://coffeencode.cc';

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

// Mirrors the site's coffee-brown palette (see SITE-DESIGN.md) with table
// markup and inline styles for email-client compatibility.
function renderEmailPage(pubName: string, preheader: string, bodyHtml: string, footerHtml: string) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(pubName)}</title></head>
<body style="margin:0;padding:0;background-color:#1d1310;">
  <span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1d1310;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#281914;border:1px solid #4b3a2a;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;border-bottom:1px solid #4b3a2a;">
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#ffffff;">${escapeHtml(pubName)}</p>
        </td></tr>
        <tr><td style="padding:24px 32px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:#f2ede4;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 32px 24px;border-top:1px solid #4b3a2a;font-family:Georgia,'Times New Roman',serif;font-size:13px;line-height:1.5;color:#b2ac88;">
          ${footerHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const buttonStyle = 'display:inline-block;margin-top:8px;padding:12px 22px;background-color:#b2ac88;color:#281914;text-decoration:none;border-radius:8px;font-weight:bold;';
const linkStyle = 'color:#b2ac88;';

export function verificationEmail(env: Env, verifyUrl: string) {
  const pubName = env.PUB_NAME || 'Coffee & Code';
  const html = renderEmailPage(
    pubName,
    'Confirm this email address for Coffee & Code story notifications.',
    `<h1 style="margin:0 0 12px;font-size:22px;color:#ffffff;">Confirm your email address</h1>
     <p style="margin:0 0 16px;">Someone added this address to ${escapeHtml(pubName)} story notifications. Confirm it to start receiving new stories from the people and tags that account follows.</p>
     <p style="margin:0 0 16px;"><a href="${escapeHtml(verifyUrl)}" style="${buttonStyle}">Confirm email address</a></p>
     <p style="margin:0;font-size:14px;color:#b2ac88;">If you did not request this, you can ignore this email — the address will not be used. The link expires in 24 hours.</p>`,
    `<a href="${SITE_ORIGIN}" style="${linkStyle}">${escapeHtml(pubName)}</a> · A small tech news publication on the AT Protocol`,
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
  const listHtml = items.map((item) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #4b3a2a;">
      <a href="${escapeHtml(item.url)}" style="font-size:18px;color:#ffffff;text-decoration:none;font-weight:bold;">${escapeHtml(item.title)}</a>
      <p style="margin:6px 0 0;font-size:14px;color:#b2ac88;">${escapeHtml(item.reason)}</p>
    </td></tr>`).join('');
  const heading = items.length === 1 ? '1 new story for you' : `${items.length} new stories for you`;
  const html = renderEmailPage(
    pubName,
    `${heading} from the people and tags you follow.`,
    `<h1 style="margin:0 0 8px;font-size:22px;color:#ffffff;">${escapeHtml(heading)}</h1>
     <p style="margin:0 0 8px;font-size:14px;color:#b2ac88;">From the authors and tags you follow on ${escapeHtml(pubName)}.</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${listHtml}</table>`,
    `You received this because email notifications are on for your ${escapeHtml(pubName)} account.`
      + ` <a href="${escapeHtml(manageUrl)}" style="${linkStyle}">Manage email settings</a> · <a href="${escapeHtml(unsubscribeUrl)}" style="${linkStyle}">Unsubscribe</a>`,
  );
  const text = `${heading}\n\n`
    + items.map((item) => `${item.title}\n${item.reason}\n${item.url}`).join('\n\n')
    + `\n\nManage email settings: ${manageUrl}\nUnsubscribe: ${unsubscribeUrl}`;
  const subject = items.length === 1
    ? `New story: ${items[0].title}`
    : `${items.length} new stories on ${pubName}`;
  return { subject, html, text };
}
