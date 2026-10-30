import { Hono } from 'hono';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { Env } from '../types';
import { fetchAuthorProfile, getPdsEndpoint, proxyImageUrl, resolveAtprotoIdentifier } from '../lib/atproto';
import { renderLayout } from '../templates/layout';

const forum = new Hono<{ Bindings: Env }>();
const forumCollection = 'cc.coffeencode.forum.config';
const forumConfigDid = 'did:plc:z7hzwpuv5ytin56wecfxa4mx';
const forumConfigUri = `at://${forumConfigDid}/${forumCollection}/self`;
const postCollection = 'cc.coffeencode.forum.post';
const replyCollection = 'cc.coffeencode.forum.reply';
const voteCollection = 'cc.coffeencode.forum.vote';
const moderationCollection = 'cc.coffeencode.forum.moderation';
const constellationUrl = 'https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks';
const pageLimit = 50;
const recordLimit = 500;

type AtRecord = {
  uri?: string;
  cid?: string;
  value?: Record<string, unknown>;
};

type Backlink = { did: string; collection: string; rkey: string };
type BacklinkPage = { records?: Backlink[]; cursor?: string };
type ForumConfig = {
  name: string;
  description?: string;
  moderators: string[];
  rules: Array<{ title: string; description?: string }>;
  tags: string[];
  uri: string;
};
type ForumPost = {
  uri: string;
  cid: string;
  rkey: string;
  authorDid: string;
  handle: string;
  name: string;
  avatar?: string;
  title: string;
  content: string;
  createdAt: string;
  tags: string[];
  images: Array<{ cid: string; alt: string }>;
  score: number;
};
type ForumReply = {
  uri: string;
  cid: string;
  authorDid: string;
  handle: string;
  name: string;
  avatar?: string;
  parentUri: string;
  content: string;
  createdAt: string;
  images: Array<{ cid: string; alt: string }>;
  pds: string;
  score: number;
};
type ModerationState = { pinned: boolean; locked: boolean; hidden: boolean };
type ModerationRecord = {
  did: string;
  subjectUri: string;
  action: string;
  createdAt: string;
  uri: string;
};

const headers = {
  Accept: 'application/json',
  'User-Agent': 'CoffeeAndCode (coffeencode.cc; @coffeencode.bsky.social)',
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validDid(value: unknown): value is string {
  return typeof value === 'string' && /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(value);
}

function validAtUri(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 2048
    && /^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._~:-]+$/.test(value);
}

function validRkey(value: string) {
  return /^[a-zA-Z0-9._~:-]{1,512}$/.test(value);
}

function stringArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maximum);
}

function renderMarkdown(value: string) {
  const html = marked.parse(value);
  if (typeof html !== 'string') throw new Error('Markdown renderer returned an unexpected result.');
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'h1', 'h2', 'h3', 'h4', 'img', 'pre', 'code', 'hr', 'del',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title'],
      code: ['class'],
      pre: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer', target: '_blank' }),
    },
  });
}

async function getRecord(pds: string, did: string, collection: string, rkey: string): Promise<AtRecord | undefined> {
  const url = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
  url.searchParams.set('repo', did);
  url.searchParams.set('collection', collection);
  url.searchParams.set('rkey', rkey);
  const response = await fetch(url, { headers });
  if (response.status === 400 || response.status === 404) return undefined;
  if (!response.ok) throw new Error(`AT Protocol record lookup returned ${response.status}`);
  return await response.json() as AtRecord;
}

async function getForumConfig(fallbackPds: string): Promise<ForumConfig | undefined> {
  const pds = await getPdsEndpoint(forumConfigDid, fallbackPds);
  const record = await getRecord(pds, forumConfigDid, forumCollection, 'self');
  const value = record?.value;
  if (!value || typeof value.name !== 'string' || !value.name.trim()) return undefined;

  const moderators = stringArray(value.moderators, 50).filter(validDid);
  if (!moderators.some((did) => did.toLowerCase() === forumConfigDid.toLowerCase())) moderators.unshift(forumConfigDid);
  const rules = Array.isArray(value.rules)
    ? value.rules.flatMap((rule) => {
        if (!rule || typeof rule !== 'object' || !('title' in rule) || typeof rule.title !== 'string') return [];
        const description = 'description' in rule && typeof rule.description === 'string' ? rule.description : undefined;
        return [{ title: rule.title, description }];
      }).slice(0, 20)
    : [];
  return {
    name: value.name.trim().slice(0, 64),
    description: typeof value.description === 'string' ? value.description.slice(0, 20000) : undefined,
    moderators,
    rules,
    tags: stringArray(value.tags, 50).map((tag) => tag.slice(0, 32)),
    uri: forumConfigUri,
  };
}

export async function isForumModerator(identifier: string, fallbackPds: string): Promise<boolean> {
  const did = await resolveAtprotoIdentifier(identifier);
  if (!did) return false;
  const config = await getForumConfig(fallbackPds);
  if (!config) throw new Error('The forum configuration is unavailable.');
  return config.moderators.some((moderatorDid) => moderatorDid.toLowerCase() === did.toLowerCase());
}

async function getBacklinks(subject: string, source: string): Promise<Backlink[]> {
  const records: Backlink[] = [];
  let cursor: string | undefined;
  while (records.length < recordLimit) {
    const url = new URL(constellationUrl);
    url.searchParams.set('subject', subject);
    url.searchParams.set('source', source);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Forum index lookup returned ${response.status}`);
    const page = await response.json() as BacklinkPage;
    records.push(...(page.records || []).filter((item) =>
      validDid(item.did) && validRkey(item.rkey) && typeof item.collection === 'string'));
    if (!page.cursor || page.cursor === cursor || !page.records?.length) break;
    cursor = page.cursor;
  }
  return records.slice(0, recordLimit);
}

async function fetchModerations(config: ForumConfig, fallbackPds: string): Promise<ModerationRecord[]> {
  const backlinks = await getBacklinks(config.uri, `${moderationCollection}:forum`);
  const allowed = new Set(config.moderators.map((did) => did.toLowerCase()));
  const records: ModerationRecord[] = [];
  for (let offset = 0; offset < backlinks.length; offset += 8) {
    const batch = backlinks.slice(offset, offset + 8);
    const results = await Promise.all(batch.map(async (item) => {
      if (!allowed.has(item.did.toLowerCase())) return undefined;
      try {
        const pds = await getPdsEndpoint(item.did, fallbackPds);
        const record = await getRecord(pds, item.did, moderationCollection, item.rkey);
        const value = record?.value;
        const subjectUri = value?.subject && typeof value.subject === 'object'
          ? (value.subject as { uri?: unknown }).uri
          : undefined;
        const createdAt = value?.createdAt;
        if (value?.forum !== config.uri || !validAtUri(subjectUri)
          || typeof value.action !== 'string' || typeof createdAt !== 'string'
          || !Number.isFinite(Date.parse(createdAt))) return undefined;
        return {
          did: item.did,
          subjectUri,
          action: value.action,
          createdAt,
          uri: record?.uri || `at://${item.did}/${moderationCollection}/${item.rkey}`,
        };
      } catch (error) {
        console.error(`Could not read forum moderation record ${item.did}/${item.rkey}:`, error);
        return undefined;
      }
    }));
    records.push(...results.filter((item): item is ModerationRecord => !!item));
  }
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uri.localeCompare(b.uri));
}

function moderationStates(records: ModerationRecord[]) {
  const states = new Map<string, ModerationState>();
  const removed = new Set<string>();
  for (const record of records) {
    const state = states.get(record.subjectUri) || { pinned: false, locked: false, hidden: false };
    if (record.action === 'pin') state.pinned = true;
    if (record.action === 'unpin') state.pinned = false;
    if (record.action === 'lock') state.locked = true;
    if (record.action === 'unlock') state.locked = false;
    if (record.action === 'hide') state.hidden = true;
    if (record.action === 'unhide') state.hidden = false;
    if (record.action === 'remove') removed.add(record.subjectUri);
    if (removed.has(record.subjectUri)) state.hidden = true;
    states.set(record.subjectUri, state);
  }
  return states;
}

async function readPost(
  did: string,
  rkey: string,
  fallbackPds: string,
  expectedForum: string,
  includeScore = false,
): Promise<ForumPost | undefined> {
  const pds = await getPdsEndpoint(did, fallbackPds);
  const record = await getRecord(pds, did, postCollection, rkey);
  const value = record?.value;
  const uri = record?.uri || `at://${did}/${postCollection}/${rkey}`;
  if (!value || value.forum !== expectedForum || !validAtUri(uri) || !record?.cid || typeof value.title !== 'string'
    || !value.title.trim() || typeof value.content !== 'string'
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return undefined;

  const [profile, score] = await Promise.all([
    fetchAuthorProfile(did, fallbackPds),
    includeScore ? getVoteScore(uri, fallbackPds) : Promise.resolve(0),
  ]);
  if (!profile) return undefined;
  const images = Array.isArray(value.images)
    ? value.images.flatMap((image) => {
        if (!image || typeof image !== 'object' || !('image' in image)) return [];
        const blob = (image as { image?: { ref?: { $link?: unknown } }; alt?: unknown });
        return typeof blob.image?.ref?.$link === 'string' && typeof blob.alt === 'string'
          ? [{ cid: blob.image.ref.$link, alt: blob.alt }]
          : [];
      }).slice(0, 10)
    : [];
  return {
    uri,
    cid: record.cid,
    rkey,
    authorDid: did,
    handle: profile.handle,
    name: profile.displayName || profile.handle,
    avatar: profile.avatar,
    title: value.title.trim().slice(0, 300),
    content: value.content.slice(0, 300000),
    createdAt: value.createdAt,
    tags: stringArray(value.tags, 8).map((tag) => tag.slice(0, 32)),
    images,
    score,
  };
}

async function getVoteScore(uri: string, fallbackPds: string): Promise<number> {
  const backlinks = await getBacklinks(uri, `${voteCollection}:subject.uri`);
  const byAuthor = new Map<string, { direction: string; createdAt: string }>();
  for (let offset = 0; offset < backlinks.length; offset += 8) {
    const batch = backlinks.slice(offset, offset + 8);
    const results = await Promise.all(batch.map(async (item) => {
      try {
        const pds = await getPdsEndpoint(item.did, fallbackPds);
        const record = await getRecord(pds, item.did, voteCollection, item.rkey);
        const value = record?.value;
        const subject = value?.subject && typeof value.subject === 'object'
          ? (value.subject as { uri?: unknown }).uri
          : undefined;
        if (subject !== uri || (value?.direction !== 'up' && value?.direction !== 'down')
          || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return undefined;
        return { did: item.did, direction: value.direction, createdAt: value.createdAt };
      } catch (error) {
        console.error(`Could not read forum vote record ${item.did}/${item.rkey}:`, error);
        return undefined;
      }
    }));
    for (const result of results) {
      if (!result) continue;
      const current = byAuthor.get(result.did);
      if (!current || current.createdAt <= result.createdAt) {
        byAuthor.set(result.did, { direction: result.direction, createdAt: result.createdAt });
      }
    }
  }
  return [...byAuthor.values()].reduce((score, vote) => score + (vote.direction === 'up' ? 1 : -1), 0);
}

async function listForumPosts(config: ForumConfig, fallbackPds: string): Promise<ForumPost[]> {
  const backlinks = await getBacklinks(config.uri, `${postCollection}:forum`);
  const posts: ForumPost[] = [];
  for (let offset = 0; offset < backlinks.length; offset += 8) {
    const batch = backlinks.slice(offset, offset + 8);
    const results = await Promise.all(batch.map((item) => readPost(item.did, item.rkey, fallbackPds, config.uri)));
    posts.push(...results.filter((item): item is ForumPost => !!item));
  }
  return posts;
}

async function listReplies(postUri: string, fallbackPds: string): Promise<ForumReply[]> {
  const backlinks = await getBacklinks(postUri, `${replyCollection}:root.uri`);
  const replies: ForumReply[] = [];
  for (let offset = 0; offset < backlinks.length; offset += 8) {
    const batch = backlinks.slice(offset, offset + 8);
    const results = await Promise.all(batch.map(async (item): Promise<ForumReply | undefined> => {
      try {
        const pds = await getPdsEndpoint(item.did, fallbackPds);
        const record = await getRecord(pds, item.did, replyCollection, item.rkey);
        const value = record?.value;
        const uri = record?.uri || `at://${item.did}/${replyCollection}/${item.rkey}`;
        const root = value?.root && typeof value.root === 'object' ? (value.root as { uri?: unknown }).uri : undefined;
        const parent = value?.parent && typeof value.parent === 'object' ? (value.parent as { uri?: unknown }).uri : undefined;
        if (!record?.cid || !validAtUri(uri) || root !== postUri || !validAtUri(parent)
          || typeof value?.content !== 'string' || typeof value.createdAt !== 'string'
          || !Number.isFinite(Date.parse(value.createdAt))) return undefined;
        const profile = await fetchAuthorProfile(item.did, fallbackPds);
        if (!profile) return undefined;
        const images = Array.isArray(value.images)
          ? value.images.flatMap((image) => {
              if (!image || typeof image !== 'object' || !('image' in image)) return [];
              const blob = image as { image?: { ref?: { $link?: unknown } }; alt?: unknown };
              return typeof blob.image?.ref?.$link === 'string' && typeof blob.alt === 'string'
                ? [{ cid: blob.image.ref.$link, alt: blob.alt }]
                : [];
            }).slice(0, 4)
          : [];
        return {
          uri,
          cid: record.cid,
          authorDid: item.did,
          handle: profile.handle,
          name: profile.displayName || profile.handle,
          avatar: profile.avatar,
          parentUri: parent,
          content: value.content.slice(0, 100000),
          createdAt: value.createdAt,
          images,
          pds,
          score: await getVoteScore(uri, fallbackPds),
        };
      } catch (error) {
        console.error(`Could not read forum reply record ${item.did}/${item.rkey}:`, error);
        return undefined;
      }
    }));
    replies.push(...results.filter((item): item is ForumReply => !!item));
  }
  return replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uri.localeCompare(b.uri));
}

function imageMarkup(images: Array<{ cid: string; alt: string }>, did: string, pds: string) {
  if (!images.length) return '';
  return `<div class="forum-images">${images.map(({ cid, alt }) => {
    const source = proxyImageUrl(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`, pds, 'feed_fullsize');
    return `<figure><img src="${escapeHtml(source)}" alt="${escapeHtml(alt)}" loading="lazy"><figcaption>${escapeHtml(alt)}</figcaption></figure>`;
  }).join('')}</div>`;
}

function voteControls(subject: { uri: string; cid: string }, score: number) {
  return `<div class="forum-votes" data-forum-vote data-subject-uri="${escapeHtml(subject.uri)}" data-subject-cid="${escapeHtml(subject.cid)}">
    <button type="button" data-vote="up" aria-label="Upvote"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
    <span data-vote-score>${score}</span>
    <button type="button" data-vote="down" aria-label="Downvote"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>
  </div>`;
}

function moderatorControls(uri: string, cid: string, forumUri: string, state: ModerationState, moderators: string[]) {
  const options = [
    ['pin', state.pinned ? 'Unpin' : 'Pin'],
    ['lock', state.locked ? 'Unlock replies' : 'Lock replies'],
    ['hide', state.hidden ? 'Unhide' : 'Hide'],
    ['remove', 'Remove'],
  ] as const;
  return `<div class="forum-moderation" data-forum-moderation data-forum-uri="${escapeHtml(forumUri)}" data-subject-uri="${escapeHtml(uri)}" data-subject-cid="${escapeHtml(cid)}" data-moderators="${escapeHtml(moderators.join(','))}" data-pinned="${state.pinned}" data-locked="${state.locked}" data-hidden="${state.hidden}">
    ${options.map(([action, label]) => `<button type="button" data-moderation-action="${action}">${label}</button>`).join('')}
  </div>`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function errorPage(c: Parameters<typeof renderLayout>[0], title: string, message: string, status: 404 | 502 | 503) {
  return c.html(renderLayout(c, title, `
    <section class="not-found"><p class="eyebrow">${status}</p><h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p><a class="read-link" href="/">Back to Coffee &amp; Code</a></section>
  `), status);
}

async function configOrResponse(c: Parameters<typeof renderLayout>[0]) {
  try {
    const config = await getForumConfig(c.env.OWNER_PDS);
    if (!config) {
      return {
        response: errorPage(c, 'Forum unavailable', 'The forum configuration could not be found. Please try again later.', 503),
      };
    }
    return { config };
  } catch (error) {
    console.error('Could not load the forum configuration:', error);
    return { response: errorPage(c, 'Forum unavailable', 'The forum configuration could not be loaded. Please try again later.', 502) };
  }
}

forum.get('/', async (c) => {
  const setup = await configOrResponse(c);
  if (setup.response) return setup.response;
  const config = setup.config;
  if (!config) return errorPage(c, 'Forum unavailable', 'Forum configuration is missing.', 503);

  const queryTag = (c.req.query('tag') || '').trim().slice(0, 32);
  const query = (c.req.query('q') || '').trim().slice(0, 200);
  const sort = c.req.query('sort') === 'top' ? 'top' : 'new';
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  let posts: ForumPost[];
  let states: Map<string, ModerationState>;
  try {
    const [allPosts, moderations] = await Promise.all([
      listForumPosts(config, c.env.OWNER_PDS),
      fetchModerations(config, c.env.OWNER_PDS),
    ]);
    states = moderationStates(moderations);
    posts = allPosts.filter((post) => {
      const state = states.get(post.uri);
      const matchesTag = !queryTag || post.tags.some((tag) => tag.toLowerCase() === queryTag.toLowerCase());
      const searchText = `${post.title}\n${post.content}\n${post.tags.join(' ')}`.toLowerCase();
      return !state?.hidden && matchesTag && (!query || searchText.includes(query.toLowerCase()));
    });
    posts.sort((a, b) => Number(Boolean(states.get(b.uri)?.pinned)) - Number(Boolean(states.get(a.uri)?.pinned))
      || b.createdAt.localeCompare(a.createdAt));
    const toScore = sort === 'top' ? posts : posts.slice((page - 1) * pageLimit, page * pageLimit);
    for (let offset = 0; offset < toScore.length; offset += 8) {
      const batch = toScore.slice(offset, offset + 8);
      const scores = await Promise.all(batch.map((post) => getVoteScore(post.uri, c.env.OWNER_PDS)));
      batch.forEach((post, index) => { post.score = scores[index]; });
    }
  } catch (error) {
    console.error('Could not load forum posts:', error);
    return errorPage(c, 'Forum unavailable', 'Forum posts could not be loaded right now. Please try again later.', 502);
  }

  posts.sort((a, b) => {
    const aPinned = states.get(a.uri)?.pinned ? 1 : 0;
    const bPinned = states.get(b.uri)?.pinned ? 1 : 0;
    return bPinned - aPinned
      || (sort === 'top' ? b.score - a.score : 0)
      || b.createdAt.localeCompare(a.createdAt);
  });
  const pagePosts = posts.slice((page - 1) * pageLimit, page * pageLimit);
  const postCards = pagePosts.map((post) => {
    const state = states.get(post.uri) || { pinned: false, locked: false, hidden: false };
    const tags = post.tags.map((tag) => `<a href="/forum?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`).join('');
    return `<article class="forum-post-card">
      <div class="forum-post-card__byline">${post.avatar ? `<img src="${escapeHtml(post.avatar)}" alt="" width="34" height="34">` : ''}
        <a href="/user/${encodeURIComponent(post.handle)}">${escapeHtml(post.name)}</a><time datetime="${escapeHtml(post.createdAt)}">${escapeHtml(formatDate(post.createdAt))}</time>
        ${state.pinned ? '<span class="forum-badge">Pinned</span>' : ''}</div>
      <h2><a href="/forum/${encodeURIComponent(post.handle)}/${encodeURIComponent(post.rkey)}">${escapeHtml(post.title)}</a></h2>
      <div class="prose forum-post-card__excerpt">${renderMarkdown(post.content.slice(0, 520))}</div>
      <div class="forum-post-card__footer">${voteControls(post, post.score)}<span>${tags}</span></div>
      ${moderatorControls(post.uri, post.cid, config.uri, state, config.moderators)}
    </article>`;
  }).join('');
  const requestUrl = new URL(c.req.url);
  const body = `
    <section class="forum-page">
      <header class="forum-header">
        <p class="eyebrow">Coffee &amp; Code community</p><h1>${escapeHtml(config.name)}</h1>
        ${config.description ? `<div class="prose forum-description">${renderMarkdown(config.description)}</div>` : ''}
      </header>
      ${config.rules.length ? `<aside class="forum-rules"><h2>Community rules</h2><ol>${config.rules.map((rule) => `<li><strong>${escapeHtml(rule.title)}</strong>${rule.description ? `<p>${escapeHtml(rule.description)}</p>` : ''}</li>`).join('')}</ol></aside>` : ''}
      <div class="forum-index-actions"><a class="login-button" href="/forum/create">Start a discussion</a></div>
      <div class="archive-search forum-search">
        <form class="search-form" method="get" action="/forum">
          <label class="archive-search__query">Search discussions
            <input type="search" name="q" value="${escapeHtml(query)}" placeholder="Title, post text, or topic" class="search-input" autocomplete="off">
          </label>
          <div class="archive-search__filters forum-search__filters">
            <label>Topic
              <input type="search" name="tag" value="${escapeHtml(queryTag)}" list="forum-filter-tags" maxlength="32" placeholder="All topics">
              <datalist id="forum-filter-tags">${config.tags.map((tag) => `<option value="${escapeHtml(tag)}">`).join('')}</datalist>
            </label>
            <label>Order
              <select name="sort"><option value="new"${sort === 'new' ? ' selected' : ''}>Newest first</option><option value="top"${sort === 'top' ? ' selected' : ''}>Top</option></select>
            </label>
          </div>
          <div class="archive-search__actions"><button type="submit" class="search-button">Apply filters</button><a href="/forum" class="read-link">Clear</a></div>
        </form>
      </div>
      <div class="section-heading"><span>Discussions</span><span>${posts.length}</span></div>
      ${postCards ? `<div class="forum-post-list">${postCards}</div>` : '<p class="empty-state">No discussions yet. Be the first to post.</p>'}
      ${posts.length > page * pageLimit ? `<a class="read-link forum-next-page" href="${escapeHtml(`${requestUrl.pathname}?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(queryTag ? { tag: queryTag } : {}), sort, page: String(page + 1) })}`)}">Older discussions <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>` : ''}
    </section>`;
  const pageUrl = new URL('/forum', c.req.url).toString();
  const ogImage = new URL('/og/forum/og.png', c.req.url).toString();
  const description = config.description || `Community discussions at ${config.name}.`;
  const metaTags = `<meta name="description" content="${escapeHtml(description)}"><meta property="og:title" content="${escapeHtml(config.name)} — Forum"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${escapeHtml(pageUrl)}"><meta property="og:image" content="${escapeHtml(ogImage)}"><meta property="og:image:type" content="image/png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(config.name)} — Forum"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(ogImage)}"><link rel="canonical" href="${escapeHtml(pageUrl)}">`;
  return c.html(renderLayout(c, `${escapeHtml(config.name)} Forum`, body, metaTags));
});

forum.get('/create', async (c) => {
  const setup = await configOrResponse(c);
  if (setup.response) return setup.response;
  const config = setup.config;
  if (!config) return errorPage(c, 'Forum unavailable', 'Forum configuration is missing.', 503);
  const body = `
    <section class="forum-page forum-create-page" aria-labelledby="forum-create-title">
      <a class="read-link forum-back-link" href="/forum"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to forum</a>
      <header class="forum-header">
        <p class="eyebrow">${escapeHtml(config.name)}</p>
        <h1 id="forum-create-title">Start a discussion</h1>
        <p class="forum-create-intro">Share a project, ask a question, or start a conversation with the community.</p>
      </header>
      <form class="archive-search forum-editor" data-forum-post data-forum-uri="${escapeHtml(config.uri)}">
        <p class="forum-status" data-forum-status role="status"></p>
        <label class="archive-search__query">Title
          <input type="text" name="title" maxlength="300" placeholder="Give your discussion a clear title" required>
        </label>
        <label class="forum-editor__body">Your post
          <textarea name="content" rows="14" maxlength="100000" placeholder="Write your post in Markdown…" required></textarea>
        </label>
        <p class="forum-markdown-note">Markdown is supported. Links and formatting will be safely rendered.</p>
        <label>Topics (comma-separated)
          <input type="text" name="tags" list="forum-create-tags" maxlength="256" placeholder="For example: projects, web development">
          <datalist id="forum-create-tags">${config.tags.map((tag) => `<option value="${escapeHtml(tag)}">`).join('')}</datalist>
        </label>
        <label>Images
          <input name="images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple>
        </label>
        <label>Image alt text <span class="forum-field-hint">Add one description per image, one per line.</span>
          <textarea name="imageAlts" rows="3" placeholder="Describe each image for readers using assistive technology"></textarea>
        </label>
        <div class="forum-editor__actions">
          <button type="submit" class="search-button">Publish discussion</button>
          <a href="/forum" class="read-link">Cancel</a>
        </div>
      </form>
    </section>`;
  const metaTags = `<meta name="description" content="Start a discussion in ${escapeHtml(config.name)}."><meta property="og:title" content="Start a discussion — ${escapeHtml(config.name)}"><meta property="og:type" content="website">`;
  return c.html(renderLayout(c, 'Start a Discussion', body, metaTags));
});

forum.get('/:handle/:rkey', async (c) => {
  const handle = c.req.param('handle');
  const rkey = c.req.param('rkey');
  if (!validRkey(rkey)) return errorPage(c, 'Post not found', 'That forum post does not exist.', 404);
  const setup = await configOrResponse(c);
  if (setup.response) return setup.response;
  const config = setup.config;
  if (!config) return errorPage(c, 'Forum unavailable', 'Forum configuration is missing.', 503);

  let authorDid: string | undefined;
  try {
    authorDid = await resolveAtprotoIdentifier(handle);
  } catch (error) {
    console.error('Could not resolve forum post author:', error);
    return errorPage(c, 'Forum unavailable', 'The post author could not be reached. Please try again later.', 502);
  }
  if (!authorDid) return errorPage(c, 'Post not found', 'That forum post does not exist.', 404);

  let post: ForumPost | undefined;
  let replies: ForumReply[] = [];
  let states: Map<string, ModerationState>;
  try {
    const [candidate, moderations] = await Promise.all([
      readPost(authorDid, rkey, c.env.OWNER_PDS, config.uri, true),
      fetchModerations(config, c.env.OWNER_PDS),
    ]);
    if (candidate) post = candidate;
    states = moderationStates(moderations);
    if (post) replies = await listReplies(post.uri, c.env.OWNER_PDS);
  } catch (error) {
    console.error(`Could not load forum thread ${authorDid}/${rkey}:`, error);
    return errorPage(c, 'Forum unavailable', 'This discussion could not be loaded. Please try again later.', 502);
  }
  if (!post) return errorPage(c, 'Post not found', 'That forum post does not exist.', 404);
  const rootState = states.get(post.uri) || { pinned: false, locked: false, hidden: false };
  if (rootState.hidden) return errorPage(c, 'Post unavailable', 'This discussion is no longer available.', 404);
  const canonicalHandle = post.handle;
  if (handle !== canonicalHandle) return c.redirect(`/forum/${encodeURIComponent(canonicalHandle)}/${encodeURIComponent(rkey)}`, 301);

  const replyByParent = new Map<string, ForumReply[]>();
  const visibleReplyCount = replies.filter((reply) => !states.get(reply.uri)?.hidden).length;
  for (const reply of replies) {
    const parentState = states.get(reply.uri);
    if (parentState?.hidden) continue;
    const children = replyByParent.get(reply.parentUri) || [];
    children.push(reply);
    replyByParent.set(reply.parentUri, children);
  }
  const renderReplies = (parentUri: string, depth: number, ancestors: Set<string>): string => {
    if (depth > 12) return '';
    return (replyByParent.get(parentUri) || []).map((reply) => {
      if (ancestors.has(reply.uri)) return '';
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(reply.uri);
      const children = renderReplies(reply.uri, depth + 1, nextAncestors);
      const replyState = states.get(reply.uri) || { pinned: false, locked: false, hidden: false };
      return `<article class="forum-reply" id="reply-${encodeURIComponent(reply.uri)}" style="--reply-depth:${Math.min(depth, 5)}">
        <header><a href="/user/${encodeURIComponent(reply.handle)}">${escapeHtml(reply.name)}</a><time datetime="${escapeHtml(reply.createdAt)}">${escapeHtml(formatDate(reply.createdAt))}</time></header>
        <div class="prose">${renderMarkdown(reply.content)}</div>${imageMarkup(reply.images, reply.authorDid, reply.pds)}
        ${voteControls(reply, reply.score)}${moderatorControls(reply.uri, reply.cid, config.uri, replyState, config.moderators)}
        ${!rootState.locked ? `<button type="button" class="forum-reply-link" data-reply-to="${escapeHtml(reply.uri)}" data-reply-cid="${escapeHtml(reply.cid)}">Reply</button>` : ''}
        ${children ? `<div class="forum-replies">${children}</div>` : ''}
      </article>`;
    }).join('');
  };
  const postPds = await getPdsEndpoint(post.authorDid, c.env.OWNER_PDS);
  const postContent = `<article class="forum-thread" data-forum-thread data-forum-uri="${escapeHtml(config.uri)}" data-root-uri="${escapeHtml(post.uri)}" data-root-cid="${escapeHtml(post.cid)}" data-locked="${rootState.locked}">
    <a class="read-link" href="/forum"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> All discussions</a>
    <p class="eyebrow">${rootState.pinned ? 'Pinned discussion' : 'Community discussion'}</p>
    <h1>${escapeHtml(post.title)}</h1>
    <div class="forum-post-card__byline">${post.avatar ? `<img src="${escapeHtml(post.avatar)}" alt="" width="40" height="40">` : ''}
      <a href="/user/${encodeURIComponent(post.handle)}">${escapeHtml(post.name)}</a><time datetime="${escapeHtml(post.createdAt)}">${escapeHtml(formatDate(post.createdAt))}</time></div>
    <div class="prose forum-thread__content">${renderMarkdown(post.content)}</div>
    ${imageMarkup(post.images, post.authorDid, postPds)}
    <div class="forum-post-card__footer">${voteControls(post, post.score)}<span>${post.tags.map((tag) => `<a href="/forum?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`).join('')}</span></div>
    ${moderatorControls(post.uri, post.cid, config.uri, rootState, config.moderators)}
    <section class="forum-thread__replies" aria-labelledby="forum-replies-title">
      <div class="section-heading"><span id="forum-replies-title">Replies</span><span>${visibleReplyCount}</span></div>
      ${!rootState.locked ? `<form data-forum-reply class="forum-reply-form">
        <p class="forum-status" data-forum-status role="status"></p>
        <label>Reply <textarea name="content" rows="5" maxlength="30000" required></textarea></label>
        <label>Images <input name="images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple></label>
        <label>Image alt text (one line per selected image) <textarea name="imageAlts" rows="2"></textarea></label>
        <button type="submit" class="login-button">Post reply</button>
      </form>` : '<p class="forum-locked">Replies are locked by a forum moderator.</p>'}
      <div class="forum-replies">${renderReplies(post.uri, 1, new Set([post.uri]))}</div>
    </section>
  </article>`;
  const pageUrl = new URL(c.req.url).toString();
  const metaTags = `<meta name="description" content="${escapeHtml(post.content.slice(0, 160))}"><meta property="og:title" content="${escapeHtml(post.title)}"><meta property="og:type" content="article"><meta property="og:url" content="${escapeHtml(pageUrl)}"><link rel="canonical" href="${escapeHtml(pageUrl)}">`;
  return c.html(renderLayout(c, escapeHtml(post.title), postContent, metaTags));
});

export async function fetchAuthorForumPosts(
  identifier: string,
  fallbackPds: string,
): Promise<Array<{ uri: string; rkey: string; title: string; content: string; createdAt: string; handle: string }>> {
  const did = await resolveAtprotoIdentifier(identifier);
  if (!did) return [];
  const config = await getForumConfig(fallbackPds);
  if (!config) return [];
  const pds = await getPdsEndpoint(did, fallbackPds);
  const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
  url.searchParams.set('repo', did);
  url.searchParams.set('collection', postCollection);
  url.searchParams.set('limit', '100');
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Forum profile posts returned ${response.status}`);
  const data = await response.json() as { records?: Array<{ uri?: string; cid?: string; value?: Record<string, unknown> }> };
  const [moderations, candidates] = await Promise.all([
    fetchModerations(config, fallbackPds),
    Promise.all((data.records || []).map(async (record) => {
      const value = record.value;
      if (value?.forum !== config.uri || !validAtUri(record.uri) || !record.cid
        || typeof value.title !== 'string' || typeof value.content !== 'string'
        || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return undefined;
      return {
        uri: record.uri,
        cid: record.cid,
        rkey: record.uri.split('/').pop() || '',
        title: value.title.trim(),
        content: value.content.slice(0, 300000),
        createdAt: value.createdAt,
        handle: identifier,
      };
    })),
  ]);
  const states = moderationStates(moderations);
  return candidates.filter((post): post is NonNullable<typeof post> => !!post && !states.get(post.uri)?.hidden)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);
}

export default forum;
