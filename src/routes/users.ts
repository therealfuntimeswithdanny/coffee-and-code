import { Hono, type Context } from 'hono';
import { Env, StandardDocument } from '../types';
import {
  fetchArticles,
  fetchAuthorProfile,
  fetchUserProfileFields,
  getPdsEndpoint,
  proxyAvatarUrl,
  proxyBlobUrl,
  proxyImageUrl,
  resolveAtprotoIdentifier,
} from '../lib/atproto';
import { renderLayout, browserRenderOgImage } from '../templates/layout';
import { externalLinkUrl } from '../lib/externalLinks';
import { fetchAuthorForumPosts } from './forum';

const users = new Hono<{ Bindings: Env }>();
const commentCollection = 'cc.coffeencode.comment';
const listCollection = 'cc.coffeencode.list';
const listItemCollection = 'cc.coffeencode.list.item';
const legacyListItemCollection = 'cc.coffeencode.cclist.item';
const listItemCollections = [listItemCollection, legacyListItemCollection];
const maxComments = 300;
const maxListItems = 500;

type UserListRecord = {
  uri: string;
  rkey: string;
  title: string;
  about?: string;
  icon?: string;
  image?: { ref: { $link: string }; mimeType?: string; size?: number };
  createdAt: string;
};

type UserListItem = {
  uri: string;
  rkey: string;
  collection: string;
  document: string;
  createdAt: string;
};

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

function validListRecord(uri: unknown, value: { title?: unknown; createdAt?: unknown } | undefined, rkey: unknown): uri is string {
  return validAtUri(uri)
    && typeof value?.title === 'string' && Boolean(value.title.trim()) && value.title.length <= 600
    && typeof value?.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && typeof rkey === 'string' && /^[a-zA-Z0-9._~:-]+$/.test(rkey);
}

function validListImage(image: unknown): image is { ref: { $link: string }; mimeType?: string; size?: number } {
  if (typeof image !== 'object' || image === null) return false;
  const value = image as { ref?: { $link?: unknown }; mimeType?: unknown; size?: unknown };
  return typeof value.ref?.$link === 'string' && Boolean(value.ref.$link)
    && (value.mimeType === undefined || (typeof value.mimeType === 'string' && value.mimeType.startsWith('image/')))
    && (value.size === undefined || (typeof value.size === 'number' && value.size <= 2_000_000));
}

function parseListRecord(uri: unknown, value: { title?: unknown; about?: unknown; icon?: unknown; image?: unknown; createdAt?: unknown } | undefined): UserListRecord | undefined {
  if (!validAtUri(uri)) return undefined;
  let rkey: string;
  try {
    rkey = uri.split('/').at(-1) || '';
  } catch { return undefined; }
  if (!validListRecord(uri, value, rkey)) return undefined;
  const icon = typeof value?.icon === 'string' ? value.icon.trim() : '';
  const about = typeof value?.about === 'string' ? value.about.trim() : '';
  const image = validListImage(value?.image) ? value!.image : undefined;
  return {
    uri,
    rkey,
    title: (value!.title as string).trim(),
    ...(about ? { about: about.slice(0, 2000) } : {}),
    ...(icon && (icon.length <= 8 || /^https:\/\//i.test(icon)) ? { icon } : {}),
    ...(image ? { image } : {}),
    createdAt: value!.createdAt as string,
  };
}

async function fetchUserLists(pds: string, did: string): Promise<UserListRecord[]> {
  const lists: UserListRecord[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set('repo', did);
    url.searchParams.set('collection', listCollection);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`List records returned ${response.status}`);
    const page = await response.json() as { records?: Array<{ uri?: unknown; value?: UserListRecord }>; cursor?: string };
    for (const record of page.records || []) {
      const list = parseListRecord(record.uri, record.value);
      if (list) lists.push(list);
    }
    if (!page.cursor || page.cursor === cursor || seenCursors.has(page.cursor) || !page.records?.length) break;
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor && lists.length < maxListItems);
  return lists.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, maxListItems);
}

export async function fetchListItems(pds: string, did: string, listUri: string): Promise<UserListItem[]> {
  const items: UserListItem[] = [];
  for (const collection of listItemCollections) {
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    do {
      const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
      url.searchParams.set('repo', did);
      url.searchParams.set('collection', collection);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        if (collection === legacyListItemCollection) break;
        throw new Error(`List item records returned ${response.status}`);
      }
      const page = await response.json() as {
        records?: Array<{ uri?: unknown; value?: { list?: unknown; document?: unknown; createdAt?: unknown } }>;
        cursor?: string;
      };
      for (const record of page.records || []) {
        const value = record.value;
        if (!validAtUri(record.uri) || value?.list !== listUri || !validAtUri(value?.document)
          || typeof value?.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) continue;
        const rkey = record.uri.split('/').at(-1) || '';
        if (!/^[a-zA-Z0-9._~:-]+$/.test(rkey)) continue;
        items.push({ uri: record.uri, rkey, collection, document: value.document, createdAt: value.createdAt });
      }
      if (!page.cursor || page.cursor === cursor || seenCursors.has(page.cursor) || !page.records?.length) break;
      seenCursors.add(page.cursor);
      cursor = page.cursor;
    } while (cursor && items.length < maxListItems);
  }
  const unique = new Map<string, UserListItem>();
  items.forEach((item) => { if (!unique.has(item.document)) unique.set(item.document, item); });
  return [...unique.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, maxListItems);
}

export async function fetchListRecord(pds: string, did: string, rkey: string): Promise<UserListRecord | undefined> {
  const url = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
  url.searchParams.set('repo', did);
  url.searchParams.set('collection', listCollection);
  url.searchParams.set('rkey', rkey);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 404 || response.status === 400) return undefined;
  if (!response.ok) throw new Error(`List record returned ${response.status}`);
  const record = await response.json() as { uri?: unknown; value?: { title?: unknown; about?: unknown; icon?: unknown; createdAt?: unknown } };
  return parseListRecord(record.uri, record.value);
}

function renderListIcon(list: UserListRecord, did: string, extraClass = '') {
  const blobCid = list.image?.ref?.$link;
  if (blobCid) return `<img class="list-page__icon${extraClass ? ` ${extraClass}` : ''}" src="${escapeHtml(proxyBlobUrl({ did, cid: blobCid }, 'avatar_small'))}" alt="" width="64" height="64" loading="lazy" decoding="async">`;
  const icon = list.icon;
  if (!icon) return `<span class="list-page__icon list-page__icon--empty${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true"><i class="fa-solid fa-list"></i></span>`;
  if (/^https:\/\//i.test(icon)) return `<img class="list-page__icon${extraClass ? ` ${extraClass}` : ''}" src="${escapeHtml(proxyImageUrl(icon))}" alt="" width="64" height="64" loading="lazy" decoding="async">`;
  return `<span class="list-page__icon list-page__icon--emoji${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true">${escapeHtml(icon)}</span>`;
}

async function resolveListOwner(c: Context<{ Bindings: Env }>, identifier: string) {
  const did = await resolveAtprotoIdentifier(identifier);
  if (!did) return { did: undefined, profile: undefined, pds: '' };
  const [profile, pds] = await Promise.all([
    fetchAuthorProfile(did, c.env.OWNER_PDS),
    getPdsEndpoint(did, c.env.OWNER_PDS),
  ]);
  return { did, profile, pds };
}

users.get('/:identifier/lists', async (c) => {
  let owner: Awaited<ReturnType<typeof resolveListOwner>>;
  try {
    owner = await resolveListOwner(c, c.req.param('identifier'));
  } catch (error) {
    console.error('Could not resolve list owner:', error);
    return c.html(renderLayout(c, 'Lists Unavailable', `
      <section class="not-found"><h1>Could not load these lists</h1>
      <p>The account provider could not be reached. Please try again later.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 502);
  }
  const { did, profile, pds } = owner;
  if (!did || !profile) {
    return c.html(renderLayout(c, 'Profile Not Found', `
      <section class="not-found"><h1>Profile not found</h1>
      <p>That handle could not be resolved to an account.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 404);
  }

  const canonicalPath = `/user/${encodeURIComponent(profile.handle)}/lists`;
  const currentUrl = new URL(c.req.url);
  if (currentUrl.pathname !== canonicalPath) {
    return c.redirect(`${canonicalPath}${currentUrl.search}`, 301);
  }

  let lists: UserListRecord[];
  try {
    lists = await fetchUserLists(pds, did);
  } catch (error) {
    console.error(`Could not load lists for ${did}:`, error);
    return c.html(renderLayout(c, 'Lists Unavailable', `
      <section class="not-found"><h1>Could not load these lists</h1>
      <p>The account’s repository could not be reached. Please try again later.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 502);
  }

  const name = profile.displayName || profile.handle;
  const items = lists.map((list) => {
    const href = `/user/${encodeURIComponent(profile.handle)}/list/${encodeURIComponent(list.rkey)}`;
    return `<li class="list-card">
      ${renderListIcon(list, did, 'list-card__icon')}
      <div class="list-card__body">
        <h2><a href="${escapeHtml(href)}">${escapeHtml(list.title)}</a></h2>
        ${list.about ? `<p>${escapeHtml(list.about)}</p>` : ''}
        <small>Created ${escapeHtml(formatCommentDate(list.createdAt))}</small>
      </div>
    </li>`;
  }).join('');
  const pageUrl = currentUrl.toString();
  const body = `
    <section class="user-page list-page" aria-labelledby="list-title">
      <header class="user-page__header">
        <div class="user-page__identity"><h1 id="list-title">Lists by ${escapeHtml(name)}</h1><p><a href="/user/${encodeURIComponent(profile.handle)}">@${escapeHtml(profile.handle)}</a></p></div>
      </header>
      ${lists.length ? `<ul class="list-index">${items}</ul>` : '<p class="empty-state">No public lists yet.</p>'}
    </section>`;
  const metaTags = `
    <meta name="description" content="${escapeHtml(`Public post lists curated by ${name} on Coffee & Code.`)}">
    <meta property="og:title" content="${escapeHtml(`Lists by ${name}`)} | Coffee and Code">
    <meta property="og:type" content="profile">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">`;
  return c.html(renderLayout(c, `Lists by ${escapeHtml(name)}`, body, metaTags));
});

users.get('/:identifier/list/:rkey', async (c) => {
  const rkey = c.req.param('rkey');
  if (!/^[a-zA-Z0-9._~:-]+$/.test(rkey)) {
    return c.html(renderLayout(c, 'List Not Found', `
      <section class="not-found"><h1>List not found</h1>
      <p>That list link is not valid.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 404);
  }
  let owner: Awaited<ReturnType<typeof resolveListOwner>>;
  try {
    owner = await resolveListOwner(c, c.req.param('identifier'));
  } catch (error) {
    console.error('Could not resolve list owner:', error);
    return c.html(renderLayout(c, 'List Unavailable', `
      <section class="not-found"><h1>Could not load this list</h1>
      <p>The account provider could not be reached. Please try again later.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 502);
  }
  const { did, profile, pds } = owner;
  if (!did || !profile) {
    return c.html(renderLayout(c, 'Profile Not Found', `
      <section class="not-found"><h1>Profile not found</h1>
      <p>That handle could not be resolved to an account.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 404);
  }

  const canonicalPath = `/user/${encodeURIComponent(profile.handle)}/list/${encodeURIComponent(rkey)}`;
  const currentUrl = new URL(c.req.url);
  if (currentUrl.pathname !== canonicalPath) {
    return c.redirect(`${canonicalPath}${currentUrl.search}`, 301);
  }

  let list: UserListRecord | undefined;
  let items: UserListItem[] = [];
  try {
    list = await fetchListRecord(pds, did, rkey);
    if (list) items = await fetchListItems(pds, did, list.uri);
  } catch (error) {
    console.error(`Could not load list ${rkey} for ${did}:`, error);
    return c.html(renderLayout(c, 'List Unavailable', `
      <section class="not-found"><h1>Could not load this list</h1>
      <p>The account’s repository could not be reached. Please try again later.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 502);
  }
  if (!list) {
    return c.html(renderLayout(c, 'List Not Found', `
      <section class="not-found"><h1>List not found</h1>
      <p>This list may have been removed or the link is incomplete.</p><a class="read-link" href="/user/${encodeURIComponent(profile.handle)}/lists">All lists by ${escapeHtml(profile.handle)}</a></section>
    `), 404);
  }

  let articles: StandardDocument[] = [];
  try {
    const publicationPds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
    articles = await fetchArticles(publicationPds, c.env.OWNER_DID);
  } catch (error) {
    console.error('Could not load stories for list items:', error);
  }
  const articlesByUri = new Map(articles.map((article) => [article.uri, article]));

  const name = profile.displayName || profile.handle;
  const itemHtml = items.map((item) => {
    const article = articlesByUri.get(item.document);
    const link = article?.path || externalLinkUrl(`https://pdsls.dev/${item.document}`);
    const title = article?.title || 'Story on AT Protocol';
    return `<li class="account-page__saved-item list-page__item">
      <a href="${escapeHtml(link)}">${escapeHtml(title)}<small>Added ${escapeHtml(formatCommentDate(item.createdAt))}</small></a>
      <button type="button" class="account-page__remove-save" data-list-remove-item data-item-rkey="${escapeHtml(item.rkey)}" data-item-collection="${escapeHtml(item.collection)}" data-item-title="${escapeHtml(title)}" hidden>
        <i class="fa-solid fa-trash-can" aria-hidden="true"></i> Remove
      </button>
    </li>`;
  }).join('');
  const pageUrl = currentUrl.toString();
  const body = `
    <section class="user-page list-page" aria-labelledby="list-title" data-list-page data-list-uri="${escapeHtml(list.uri)}" data-list-owner-did="${escapeHtml(did)}">
      <header class="list-page__header">
        ${renderListIcon(list, did)}
        <div class="list-page__heading">
          <h1 id="list-title">${escapeHtml(list.title)}</h1>
          <p class="list-page__owner">A list by <a href="/user/${encodeURIComponent(profile.handle)}">${escapeHtml(name)}</a></p>
        </div>
      </header>
      ${list.about ? `<p class="list-page__about">${escapeHtml(list.about)}</p>` : ''}
      <p class="list-page__status" data-list-status role="status" aria-live="polite"></p>
      <div class="section-heading"><span>${items.length} ${items.length === 1 ? 'post' : 'posts'}</span><button type="button" class="read-link list-page__share" data-list-share><i class="fa-solid fa-link" aria-hidden="true"></i> Copy share link</button></div>
      ${items.length ? `<ul class="list-page__items" data-list-items>${itemHtml}</ul>` : '<p class="empty-state" data-list-empty>This list has no posts yet.</p><ul class="list-page__items" data-list-items hidden></ul>'}
      <p class="list-page__manage" data-list-manage hidden><a class="read-link" href="/account/list">Manage your lists <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></p>
    </section>`;
  const metaTags = `
    <meta name="description" content="${escapeHtml(list.about || `A post list curated by ${name} on Coffee & Code.`)}">
    <meta property="og:title" content="${escapeHtml(list.title)} | Coffee and Code">
    <meta property="og:description" content="${escapeHtml(list.about || `A post list curated by ${name}.`)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <meta property="og:image" content="${escapeHtml(browserRenderOgImage(c))}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
    <link rel="alternate" type="application/rss+xml" title="${escapeHtml(`${list.title} — ${c.env.PUB_NAME}`)}" href="/user/${encodeURIComponent(profile.handle)}/list/${encodeURIComponent(list.rkey)}/rss.xml">`;
  return c.html(renderLayout(c, escapeHtml(list.title), body, metaTags));
});

users.get('/:identifier', async (c) => {
  let did: string | undefined;
  try {
    did = await resolveAtprotoIdentifier(c.req.param('identifier'));
  } catch (error) {
    console.error('Could not resolve user profile identifier:', error);
    return c.html(renderLayout(c, 'Profile Unavailable', `
      <section class="not-found"><h1>Could not find this profile</h1>
      <p>The account provider could not be reached. Please try again later.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 502);
  }
  if (!did) {
    return c.html(renderLayout(c, 'Profile Not Found', `
      <section class="not-found"><h1>Profile not found</h1>
      <p>That handle could not be resolved to an account.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 404);
  }

  const [profile, pds] = await Promise.all([
    fetchAuthorProfile(did, c.env.OWNER_PDS),
    getPdsEndpoint(did, c.env.OWNER_PDS),
  ]);
  if (!profile) {
    return c.html(renderLayout(c, 'Profile Not Found', `
      <section class="not-found"><h1>Profile not found</h1>
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
      <section class="not-found"><h1>Could not load this profile</h1>
      <p>The account’s repository could not be reached. Please try again later.</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
    `), 502);
  }

  let forumPosts: Awaited<ReturnType<typeof fetchAuthorForumPosts>> = [];
  try {
    forumPosts = await fetchAuthorForumPosts(profile.handle, c.env.OWNER_PDS);
  } catch (error) {
    console.error(`Could not load forum posts for ${did}:`, error);
  }

  let lists: UserListRecord[] = [];
  try {
    lists = await fetchUserLists(pds, did);
  } catch (error) {
    console.error(`Could not load lists for ${did}:`, error);
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
  const readerProfile = await fetchUserProfileFields(did, pds);
  const name = readerProfile.displayName || profile.displayName || profile.handle;
  const description = readerProfile.description || profile.description;
  const pronouns = readerProfile.pronouns || profile.pronouns;
  const avatar = profile.avatar ? proxyAvatarUrl(profile.avatar) : '';
  const banner = profile.banner ? proxyImageUrl(profile.banner, pds, 'banner_large') : '';
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
      <a class="user-comment__permalink" href="${externalLinkUrl(`https://pdsls.dev/${comment.uri}`)}">View comment record <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a></div>
    </article>`;
  }).join('');
  const shownComments = comments.length
    ? `<div class="user-comments">${commentItems}</div>`
    : '<p class="empty-state">No public comments yet.</p>';
  const shownForumPosts = forumPosts.length
    ? `<div class="user-forum-posts">${forumPosts.map((post) => `
        <article class="user-forum-post" data-block-author-did="${escapeHtml(did)}">
          <h3><a href="/forum/${encodeURIComponent(post.handle)}/${encodeURIComponent(post.rkey)}">${escapeHtml(post.title)}</a></h3>
          <time datetime="${escapeHtml(post.createdAt)}">${escapeHtml(formatCommentDate(post.createdAt))}</time>
        </article>`).join('')}</div>`
    : '<p class="empty-state">No forum posts yet.</p>';
  const shownLists = lists.length
    ? `<ul class="list-index">${lists.map((list) => `
        <li class="list-card">
          ${renderListIcon(list, did, 'list-card__icon')}
          <div class="list-card__body">
            <h2><a href="/user/${encodeURIComponent(profile.handle)}/list/${encodeURIComponent(list.rkey)}">${escapeHtml(list.title)}</a></h2>
            ${list.about ? `<p>${escapeHtml(list.about)}</p>` : ''}
            <small>Created ${escapeHtml(formatCommentDate(list.createdAt))}</small>
          </div>
        </li>`).join('')}</ul>`
    : '<p class="empty-state">No public lists yet.</p>';
  const publicationUri = authorArticle?.publicationUri;
  const pageUrl = new URL(c.req.url).toString();
  const body = `
    <section class="user-page author-page" aria-labelledby="user-title">
      ${banner ? `<img class="author-page__banner" src="${escapeHtml(banner)}" alt="" width="1200" height="400" decoding="async">` : ''}
      <header class="author-page__header">
        ${avatar ? `<img class="author-page__avatar" src="${escapeHtml(avatar)}" alt="" width="88" height="88" decoding="async">` : '<span class="author-page__avatar author-page__avatar--empty" aria-hidden="true"><i class="fa-solid fa-user"></i></span>'}
        <div><h1 id="user-title" data-author-verification-did="${escapeHtml(did)}">${escapeHtml(name)}</h1><p>@${escapeHtml(profile.handle)}${pronouns ? ` · ${escapeHtml(pronouns)}` : ''}</p></div>
      </header>
      <div class="author-follow" ${publicationUri ? `data-author-follow data-author-did="${escapeHtml(did)}" data-author-name="${escapeHtml(name)}" data-publication-uri="${escapeHtml(publicationUri)}"` : ''}>
        ${authorArticle?.author ? `<a class="author-page__profile-link" href="/author/${encodeURIComponent(authorArticle.author.handle)}">Open author profile <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>` : ''}
        <a class="author-page__profile-link" href="${externalLinkUrl(`https://bsky.app/profile/${encodeURIComponent(profile.handle)}`)}" target="_blank" rel="noopener noreferrer">View on Bluesky <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
        <button type="button" class="author-follow__button" data-block-user-did="${escapeHtml(did)}" data-block-user-name="${escapeHtml(name)}" hidden disabled>Block user</button>
        <button type="button" class="author-follow__button" data-author-follow-button${publicationUri ? '' : ' disabled'}>Follow</button>
        ${publicationUri ? `<span class="publication-subscribe" data-publication-subscribe data-publication-uri="${escapeHtml(publicationUri)}"><button type="button" class="author-follow__button publication-subscribe__button" data-publication-subscribe-button>Subscribe</button><span class="author-follow__status" data-publication-subscribe-status role="status" aria-live="polite"></span></span>` : ''}
        <a class="author-germ" data-germ-dm data-germ-did="${escapeHtml(did)}" href="#" target="_blank" rel="noopener noreferrer" hidden><img src="/logomarks/germ.png" alt="" width="18" height="18" aria-hidden="true">Message on Germ</a>
        <span class="author-follow__status" data-author-follow-status role="status" aria-live="polite">${publicationUri ? '' : 'Following is unavailable for this account.'}</span>
      </div>
      ${description ? `<p class="author-page__description">${escapeHtml(description)}</p>` : ''}
      <nav class="user-tabs" aria-label="Profile sections" data-user-tabs>
        <a href="#forum" class="user-tabs__tab" data-user-tab="forum">Forum <span>${forumPosts.length}</span></a>
        <a href="#comments" class="user-tabs__tab" data-user-tab="comments">Comments <span>${comments.length}</span></a>
        <a href="#lists" class="user-tabs__tab" data-user-tab="lists">Lists <span>${lists.length}</span></a>
      </nav>
      <section id="forum" class="user-page__activity" aria-labelledby="user-forum-title" data-user-panel="forum">
        <div class="section-heading"><span id="user-forum-title">Forum posts</span><span>${forumPosts.length}</span></div>
        ${forumPosts.length === 100 ? '<p class="user-page__comment-limit">Showing the latest 100 forum posts.</p>' : ''}
        ${shownForumPosts}
      </section>
      <section id="comments" class="user-page__activity" aria-labelledby="user-comments-title" data-user-panel="comments">
        <div class="section-heading"><span id="user-comments-title">Comments</span><span>${comments.length}</span></div>
        ${comments.length === 100 ? '<p class="user-page__comment-limit">Showing the latest 100 comments.</p>' : ''}
        ${shownComments}
      </section>
      <section id="lists" class="user-page__activity" aria-labelledby="user-lists-title" data-user-panel="lists">
        <div class="section-heading"><span id="user-lists-title">Lists</span><span>${lists.length}</span></div>
        ${shownLists}
      </section>
    </section>
    <script>
      (function () {
        var nav = document.querySelector('[data-user-tabs]');
        if (!nav) return;
        var tabs = Array.prototype.slice.call(nav.querySelectorAll('[data-user-tab]'));
        var panels = Array.prototype.slice.call(document.querySelectorAll('[data-user-panel]'));
        var names = tabs.map(function (tab) { return tab.getAttribute('data-user-tab'); });
        var activate = function (name) {
          if (names.indexOf(name) === -1) name = names[0];
          tabs.forEach(function (tab) {
            var active = tab.getAttribute('data-user-tab') === name;
            tab.setAttribute('aria-selected', String(active));
            tab.classList.toggle('user-tabs__tab--active', active);
          });
          panels.forEach(function (panel) {
            panel.hidden = panel.getAttribute('data-user-panel') !== name;
          });
        };
        tabs.forEach(function (tab) {
          tab.setAttribute('role', 'tab');
          tab.addEventListener('click', function (event) {
            event.preventDefault();
            var name = tab.getAttribute('data-user-tab');
            if (history.replaceState) history.replaceState(null, '', '#' + name);
            activate(name);
          });
        });
        activate(window.location.hash.replace('#', '') || names[0]);
        window.addEventListener('hashchange', function () {
          activate(window.location.hash.replace('#', ''));
        });
      })();
    </script>`;
  const metaTags = `
    <meta name="description" content="${escapeHtml(description || `Public profile and comments by ${name} on Coffee and Code.`)}">
    <meta property="og:title" content="${escapeHtml(name)} | Coffee and Code">
    <meta property="og:description" content="${escapeHtml(description || `Comments by ${name} on Coffee and Code.`)}">
    <meta property="og:type" content="profile">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    ${avatar ? `<meta property="og:image" content="${escapeHtml(avatar)}">` : `<meta property="og:image" content="${escapeHtml(browserRenderOgImage(c))}">`}
    <link rel="canonical" href="${escapeHtml(pageUrl)}">`;

  return c.html(renderLayout(c, escapeHtml(name), body, metaTags));
});

export default users;
