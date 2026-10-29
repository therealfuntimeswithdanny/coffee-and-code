import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import {
  fetchArticles,
  fetchAuthorProfile,
  getPdsEndpoint,
  proxyAvatarUrl,
  proxyImageUrl,
  resolveAtprotoIdentifier,
} from '../lib/atproto';
import { renderLayout, browserRenderOgImage } from '../templates/layout';

const users = new Hono<{ Bindings: Env }>();
const commentCollection = 'cc.coffeencode.comment';
const maxComments = 300;

type UserCommentRecord = {
  uri?: string;
  value?: {
    text?: unknown;
    createdAt?: unknown;
    subject?: { uri?: unknown };
    reply?: { parent?: { uri?: unknown } };
  };
};

type UserComment = {
  uri: string;
  text: string;
  createdAt: string;
  subjectUri: string;
  parentUri?: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validAtUri(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 2048
    && /^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._~:-]+$/.test(value);
}

function formatCommentDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

async function fetchUserComments(pds: string, did: string): Promise<UserComment[]> {
  const records: UserComment[] = [];
  let cursor: string | undefined;

  while (records.length < maxComments) {
    const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set('repo', did);
    url.searchParams.set('collection', commentCollection);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Comment records returned ${response.status}`);
    const page = await response.json() as { records?: UserCommentRecord[]; cursor?: string };
    for (const record of page.records || []) {
      const value = record.value;
      const text = typeof value?.text === 'string' ? value.text.trim() : '';
      const subjectUri = value?.subject?.uri;
      const createdAt = value?.createdAt;
      const parentUri = value?.reply?.parent?.uri;
      if (!validAtUri(record.uri) || !text || text.length > 3000
        || !validAtUri(subjectUri)
        || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))
        || (parentUri !== undefined && !validAtUri(parentUri))) continue;
      records.push({
        uri: record.uri,
        text,
        createdAt,
        subjectUri,
        ...(typeof parentUri === 'string' ? { parentUri } : {}),
      });
    }
    if (!page.cursor || page.cursor === cursor || !page.records?.length) break;
    cursor = page.cursor;
  }

  return records
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);
}

users.get('/:identifier', async (c) => {
  let did: string | undefined;
  try {
    did = await resolveAtprotoIdentifier(c.req.param('identifier'));
  } catch (error) {
    console.error('Could not resolve user profile identifier:', error);
    return c.html(renderLayout(c, 'Profile Unavailable', `
      <section class="not-found"><p class="eyebrow">Profile unavailable</p><h1>Could not find this profile</h1>
      <p>The account provider could not be reached. Please try again later.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 502);
  }
  if (!did) {
    return c.html(renderLayout(c, 'Profile Not Found', `
      <section class="not-found"><p class="eyebrow">404</p><h1>Profile not found</h1>
      <p>That handle could not be resolved to an account.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 404);
  }

  const [profile, pds] = await Promise.all([
    fetchAuthorProfile(did, c.env.OWNER_PDS),
    getPdsEndpoint(did, c.env.OWNER_PDS),
  ]);
  if (!profile) {
    return c.html(renderLayout(c, 'Profile Not Found', `
      <section class="not-found"><p class="eyebrow">404</p><h1>Profile not found</h1>
      <p>This account does not have a readable Coffee &amp; Code or Bluesky profile.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 404);
  }

  const canonicalPath = `/user/${encodeURIComponent(profile.handle)}`;
  const currentUrl = new URL(c.req.url);
  if (currentUrl.pathname !== canonicalPath) {
    return c.redirect(`${canonicalPath}${currentUrl.search}`, 301);
  }

  let comments: UserComment[];
  try {
    comments = await fetchUserComments(pds, did);
  } catch (error) {
    console.error(`Could not load comments for ${did}:`, error);
    return c.html(renderLayout(c, 'Profile Unavailable', `
      <section class="not-found"><p class="eyebrow">Profile unavailable</p><h1>Could not load this profile</h1>
      <p>The account’s repository could not be reached. Please try again later.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 502);
  }

  let articles: StandardDocument[] = [];
  try {
    const publicationPds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
    articles = await fetchArticles(publicationPds, c.env.OWNER_DID);
  } catch (error) {
    console.error('Could not load stories for the user comment timeline:', error);
  }
  const articlesByUri = new Map(articles.map((article) => [article.uri, article]));
  const authorArticle = articles.find((article) => article.author?.did.toLowerCase() === did.toLowerCase());
  const name = profile.displayName || profile.handle;
  const avatar = profile.avatar ? proxyAvatarUrl(profile.avatar) : '';
  const banner = profile.banner ? proxyImageUrl(profile.banner, pds, 'feed_fullsize') : '';
  const commentItems = comments.map((comment) => {
    const article = articlesByUri.get(comment.subjectUri);
    const subjectLink = article?.path || `https://pdsls.dev/${comment.subjectUri}`;
    const subjectTitle = article?.title || 'a post on AT Protocol';
    const replyLabel = comment.parentUri ? 'Replied to a comment on' : 'Commented on';
    return `<article class="user-comment">
      <div class="user-comment__date"><time datetime="${escapeHtml(comment.createdAt)}">${escapeHtml(formatCommentDate(comment.createdAt))}</time></div>
      <div class="user-comment__body"><p class="user-comment__context">${replyLabel} <a href="${escapeHtml(subjectLink)}">${escapeHtml(subjectTitle)}</a></p>
      <p class="user-comment__text">${escapeHtml(comment.text)}</p>
      <a class="user-comment__permalink" href="${escapeHtml(subjectLink)}">Open post <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
      <a class="user-comment__permalink" href="https://pdsls.dev/${comment.uri}">View comment record <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a></div>
    </article>`;
  }).join('');
  const shownComments = comments.length
    ? `<div class="user-comments">${commentItems}</div>`
    : '<p class="empty-state">No public comments yet.</p>';
  const pageUrl = new URL(c.req.url).toString();
  const body = `
    <section class="user-page" aria-labelledby="user-title">
      ${banner ? `<div class="user-page__banner"><img src="${escapeHtml(banner)}" alt="" width="1200" height="400"></div>` : '<div class="user-page__banner user-page__banner--empty"></div>'}
      <header class="user-page__header">
        ${avatar ? `<img class="user-page__avatar" src="${escapeHtml(avatar)}" alt="" width="104" height="104">` : '<span class="user-page__avatar user-page__avatar--empty" aria-hidden="true"><i class="fa-solid fa-user"></i></span>'}
        <div class="user-page__identity"><h1 id="user-title" data-author-verification-did="${escapeHtml(did)}">${escapeHtml(name)}</h1><p>@${escapeHtml(profile.handle)}</p></div>
        ${authorArticle?.author ? `<a class="user-page__bluesky" href="/author/${encodeURIComponent(authorArticle.author.handle)}">Open author profile <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>` : ''}
        <a class="user-page__bluesky" href="https://bsky.app/profile/${encodeURIComponent(profile.handle)}" target="_blank" rel="noopener noreferrer">Bluesky profile <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
      </header>
      ${profile.description ? `<p class="user-page__description">${escapeHtml(profile.description)}</p>` : ''}
      ${profile.pronouns ? `<div class="user-page__details"><span>${escapeHtml(profile.pronouns)}</span></div>` : ''}
      <section class="user-page__activity" aria-labelledby="user-comments-title">
        <div class="section-heading"><span id="user-comments-title">Comments</span><span>${comments.length}</span></div>
        ${comments.length === 100 ? '<p class="user-page__comment-limit">Showing the latest 100 comments.</p>' : ''}
        ${shownComments}
      </section>
    </section>`;
  const metaTags = `
    <meta name="description" content="${escapeHtml(profile.description || `Public profile and comments by ${name} on Coffee and Code.`)}">
    <meta property="og:title" content="${escapeHtml(name)} | Coffee and Code">
    <meta property="og:description" content="${escapeHtml(profile.description || `Comments by ${name} on Coffee and Code.`)}">
    <meta property="og:type" content="profile">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    ${avatar ? `<meta property="og:image" content="${escapeHtml(avatar)}">` : `<meta property="og:image" content="${escapeHtml(browserRenderOgImage(c))}">`}
    <link rel="canonical" href="${escapeHtml(pageUrl)}">`;

  return c.html(renderLayout(c, escapeHtml(name), body, metaTags));
});

export default users;
