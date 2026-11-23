import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import { renderSearchBar } from '../templates/searchBar';
import { getPdsEndpoint, isPdsAvailable, fetchArticles, searchArticles, resolveAtprotoIdentifier, proxyImageUrl, proxyAvatarUrl, type ArticlePagination } from '../lib/atproto';
import { renderLayout, browserRenderOgImage, browserRunScreenshotUrl } from '../templates/layout';
import { toPlainText, descriptionText, renderMarkdown, processImages, enhanceHtmlStructure } from '../lib/contentRenderer';
import { listDocs, getDoc, renderDocIcons, type DocEntry } from '../lib/docs';
import { routeExternalLinks } from '../lib/externalLinks';
import { externalLinkUrl } from '../lib/externalLinks';
import { renderLegalDocument } from '../lib/legal';
import { isForumModerator } from './forum';

const pages = new Hono<{ Bindings: Env }>();

pages.get('/notifications', (c) => {
  const body = `
    <section class="notifications-page" data-notifications-page aria-labelledby="notifications-title">
        <h1 id="notifications-title">Notifications</h1>
      <p class="notifications-page__intro">Keep up with new posts from authors and tags you follow, along with activity on your stories.</p>
      <p class="notifications-page__status" data-notifications-status role="status" aria-live="polite">Loading notifications…</p>
      <div class="notifications-page__inbox" data-notifications-inbox hidden>
        <div class="notifications-page__actions"><p data-notifications-read-status></p><div class="notifications-page__action-buttons"><button type="button" class="auth-signout" data-notifications-refresh>Refresh</button></div></div>
        <section aria-labelledby="notifications-unread-title">
          <div class="section-heading"><h2 id="notifications-unread-title">Unread</h2><span data-notifications-unread-count></span></div>
          <ul class="notifications-list" data-notifications-unread></ul>
          <p class="notifications-page__empty" data-notifications-unread-empty hidden>No unread notifications.</p>
        </section>
        <section aria-labelledby="notifications-read-title">
          <div class="section-heading"><h2 id="notifications-read-title">Read</h2><span data-notifications-read-count></span></div>
          <ul class="notifications-list" data-notifications-read></ul>
          <p class="notifications-page__empty" data-notifications-read-empty hidden>No read notifications yet.</p>
        </section>
      </div>
    </section>
    <style>
      .notifications-page { margin: 0 auto; max-width: 860px; }
      .notifications-page h1 { font-family: Lora, serif; font-size: clamp(2.8rem, 7vw, 5rem); letter-spacing: -.04em; line-height: 1.04; margin: 0; }
      .notifications-page__intro { color: var(--muted); font-size: 19px; line-height: 1.55; margin: 20px 0 34px; max-width: 680px; }
      .notifications-page__status, .notifications-page__empty { color: var(--muted); }
      .notifications-page__actions { align-items: center; display: flex; justify-content: space-between; gap: 16px; margin: 0 0 20px; }
      .notifications-page__action-buttons { display: flex; flex-wrap: wrap; gap: 10px; }
      .notifications-page__actions p { color: var(--muted); font-size: 14px; margin: 0; }
      .notifications-page .section-heading { align-items: baseline; }
      .notifications-page .section-heading h2 { font: inherit; font-size: 16px; letter-spacing: .1em; margin: 0; text-transform: uppercase; }
      .notifications-list { list-style: none; margin: 0; padding: 0; width: 100%; }
      .notification-item { align-items: start; border-bottom: 1px solid var(--line); display: grid; gap: 12px; grid-template-columns: 20px 40px minmax(0, 1fr); padding: 18px 4px; width: 100%; }
      .notification-item__icon { color: var(--muted); font-size: 17px; padding-top: 2px; text-align: center; }
      .notification-item__icon--like { color: #ed6b79; }
      .notification-item__avatar { background: var(--paper-deep); border-radius: 50%; height: 40px; object-fit: cover; width: 40px; }
      .notification-item__avatar--placeholder { align-items: center; color: var(--muted); display: inline-flex; justify-content: center; }
      .notification-item__content { min-width: 0; }
      .notification-item__summary { line-height: 1.5; margin: 0; }
      .notification-item__actor { color: var(--ink) !important; font-weight: 700; text-decoration: none !important; }
      .notification-item__story { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
      .notification-item__text { background: transparent; border: 0; color: var(--muted); margin: 2px 0 0; padding: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      .notification-item time { color: var(--muted); display: block; font-size: 12px; margin-top: 3px; }
      .notifications-page__inbox > section { margin-top: 36px; }
      @media (max-width: 600px) { .notifications-page h1 { font-size: clamp(2.6rem, 12vw, 4rem); }.notifications-page__actions { align-items: flex-start; flex-direction: column; } }
    </style>`;
  const metaTags = `
    <meta name="description" content="Comments on your Coffee &amp; Code stories and likes on those comments.">
    <meta property="og:title" content="Notifications | Coffee &amp; Code">
    <meta property="og:description" content="Comments and likes on your Coffee &amp; Code stories.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${new URL(c.req.url).origin}/notifications">
    <link rel="canonical" href="${new URL(c.req.url).origin}/notifications">
  `;
  return c.html(renderLayout(c, 'Notifications', body, metaTags));
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type ArchiveStory = Pick<StandardDocument, 'uri' | 'path' | 'title' | 'publishedAt' | 'cover' | 'description'>
  & { content?: string };
type ArchiveFilters = { q: string; author: string; year: string; sort: 'newest' | 'oldest'; image: boolean };
type ArchivePaginationState = {
  cursors: Record<string, string | null>;
  pending: ArchiveStory[];
  filterKey: string;
};

function renderArchiveStories(posts: ArchiveStory[], pds: string, origin: string) {
  return posts.map((post) => `
    <article class="archive-story${post.cover ? '' : ' archive-story--no-cover'}">
      ${post.cover ? `<a class="archive-story__image" href="${escapeHtml(post.path)}" aria-label="Read ${escapeHtml(post.title || 'Untitled')}">
        <img src="${escapeHtml(proxyImageUrl(post.cover, pds || origin, 'feed_small'))}" alt="" class="story-image" loading="lazy" decoding="async">
      </a>` : ''}
      <div>
        <p class="eyebrow">${escapeHtml(formatDate(post.publishedAt))}</p>
        <h3><a href="${escapeHtml(post.path)}">${escapeHtml(post.title || 'Untitled')}</a></h3>
        ${excerpt(post) ? `<p>${escapeHtml(excerpt(post))}</p>` : ''}
        <span class="view-counter">Reads <span data-at-uri="${escapeHtml(post.uri)}">—</span></span>
      </div>
      <a href="${escapeHtml(post.path)}" class="read-link">Read story <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
    </article>`).join('');
}

function archiveFilterKey(filters: ArchiveFilters) {
  return JSON.stringify(filters);
}

function readArchivePagination(value: unknown): ArchivePaginationState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const state = value as Record<string, unknown>;
  if (!state.cursors || typeof state.cursors !== 'object' || Array.isArray(state.cursors)
    || !Array.isArray(state.pending) || state.pending.length > 1000
    || typeof state.filterKey !== 'string' || state.filterKey.length > 2048) return undefined;
  const cursors = state.cursors as Record<string, unknown>;
  if (Object.keys(cursors).length > 32
    || Object.entries(cursors).some(([key, cursor]) => key.length > 512
      || (cursor !== null && (typeof cursor !== 'string' || cursor.length > 2048)))) return undefined;

  const pending: ArchiveStory[] = [];
  for (const value of state.pending) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const story = value as Record<string, unknown>;
    if (typeof story.uri !== 'string' || story.uri.length > 2048
      || !/^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/site\.standard\.document\/[a-zA-Z0-9._~:-]+$/.test(story.uri)
      || typeof story.path !== 'string' || !/^\/author\/[^/?#]+\/[^/?#]+$/.test(story.path)
      || typeof story.title !== 'string' || story.title.length > 2000
      || typeof story.publishedAt !== 'string' || !Number.isFinite(Date.parse(story.publishedAt))
      || (story.description !== undefined && (typeof story.description !== 'string' || story.description.length > 180))
      || (story.content !== undefined && (typeof story.content !== 'string' || story.content.length > 800))
      || (story.cover !== undefined && (typeof story.cover !== 'string' || story.cover.length > 4096))) return undefined;
    if (typeof story.cover === 'string') {
      try {
        const url = new URL(story.cover, 'https://coffeencode.cc');
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
      } catch {
        return undefined;
      }
    }
    pending.push({
      uri: story.uri,
      path: story.path,
      title: story.title,
      publishedAt: story.publishedAt,
      ...(typeof story.description === 'string' ? { description: story.description } : {}),
      ...(typeof story.content === 'string' ? { content: story.content } : {}),
      ...(typeof story.cover === 'string' ? { cover: story.cover } : {}),
    });
  }
  return { cursors: cursors as Record<string, string | null>, pending, filterKey: state.filterKey };
}

pages.post('/api/archive/more', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'The archive continuation is invalid. Reload the page and try again.' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return c.json({ error: 'The archive continuation is invalid. Reload the page and try again.' }, 400);
  }
  const request = payload as Record<string, unknown>;
  const state = readArchivePagination(request.state);
  const rawFilters = request.filters;
  if (!state || !rawFilters || typeof rawFilters !== 'object' || Array.isArray(rawFilters)) {
    return c.json({ error: 'The archive continuation is invalid. Reload the page and try again.' }, 400);
  }
  const filterValues = rawFilters as Record<string, unknown>;
  const filters: ArchiveFilters = {
    q: typeof filterValues.q === 'string' ? filterValues.q.trim() : '',
    author: typeof filterValues.author === 'string' ? filterValues.author : '',
    year: typeof filterValues.year === 'string' ? filterValues.year : '',
    sort: filterValues.sort === 'oldest' ? 'oldest' : 'newest',
    image: filterValues.image === true,
  };
  if (filters.q.length > 200
    || (filters.author && !/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(filters.author))
    || (filters.year && !/^\d{4}$/.test(filters.year))) {
    return c.json({ error: 'The archive filters are invalid.' }, 400);
  }
  if (state.filterKey !== archiveFilterKey(filters)) {
    return c.json({ error: 'Apply your updated filters before loading more stories.' }, 409);
  }

  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const nextCursors: NonNullable<ArticlePagination['nextCursors']> = {};
  const allPosts = await fetchArticles(pds, c.env.OWNER_DID, {
    pageSize: 30,
    cursors: state.cursors,
    nextCursors,
  });
  const searchedPosts = filters.q ? searchArticles(allPosts, filters.q) : allPosts;
  const filteredPosts = searchedPosts.filter((post) => {
    if (filters.author && post.author?.did !== filters.author) return false;
    if (filters.year && String(new Date(post.publishedAt).getFullYear()) !== filters.year) return false;
    return !filters.image || Boolean(post.cover);
  });
  const sortStories = (a: ArchiveStory, b: ArchiveStory) => {
    const difference = (Date.parse(a.publishedAt) || 0) - (Date.parse(b.publishedAt) || 0);
    return filters.sort === 'oldest' ? difference : -difference;
  };
  const candidateStories: ArchiveStory[] = [...state.pending, ...filteredPosts.map((post) => ({
    uri: post.uri,
    path: post.path,
    title: post.title,
    publishedAt: post.publishedAt,
    ...(post.description ? { description: excerpt(post) } : {}),
    ...(post.content ? { content: toPlainText(post.content).slice(0, 600) } : {}),
    ...(post.cover ? { cover: post.cover } : {}),
  }))];
  const uniqueStories = [...new Map(candidateStories.map((post) => [post.uri, post])).values()].sort(sortStories);
  const pageStories = uniqueStories.slice(0, 30);
  const pending = uniqueStories.slice(30);
  const nextState: ArchivePaginationState = {
    cursors: nextCursors,
    pending,
    filterKey: state.filterKey,
  };
  const hasMore = pending.length > 0
    || Object.values(nextCursors).some((cursor) => typeof cursor === 'string' && cursor.length > 0);

  return c.json({
    html: renderArchiveStories(pageStories, pds, new URL(c.req.url).origin),
    count: pageStories.length,
    state: hasMore ? nextState : null,
    hasMore,
  }, 200, { 'Cache-Control': 'no-store' });
});

pages.get('/api/invite-code', async (c) => {
  try {
    const response = await fetch('https://invite-code.coffeencode.cc/', {
      headers: { Accept: 'application/json', 'User-Agent': 'CoffeeAndCode (coffeencode.cc)' },
    });
    if (!response.ok) throw new Error(`Invite service returned ${response.status}`);
    const payload = await response.json() as { code?: unknown };
    if (typeof payload.code !== 'string' || !/^[a-zA-Z0-9-]{8,128}$/.test(payload.code)) {
      throw new Error('Invite service returned an invalid code');
    }
    return c.json({ code: payload.code }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Could not retrieve PDS invite code:', error);
    return c.json({ error: 'invite-code.coffeencode.cc retured an error, please check our Status page or reach out to support.' }, 502, { 'Cache-Control': 'no-store' });
  }
});

pages.get('/api/account/posts', async (c) => {
  const authorDid = c.req.query('author');
  if (authorDid && !/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(authorDid)) {
    return c.json({ error: 'A valid author DID is required.' }, 400);
  }
  let allArticles: StandardDocument[];
  let pds: string;
  try {
    pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
    allArticles = await fetchArticles(pds, c.env.OWNER_DID);
  } catch (error) {
    console.error('Could not load account posts:', error);
    return c.json({ error: 'Published posts are temporarily unavailable.' }, 503, { 'Cache-Control': 'no-store' });
  }
  if (!allArticles.length && !await isPdsAvailable(pds)) {
    return c.json({ error: 'Published posts are temporarily unavailable.' }, 503, { 'Cache-Control': 'no-store' });
  }
  const articles = authorDid
    ? allArticles.filter((post) => post.author?.did.toLowerCase() === authorDid.toLowerCase())
    : allArticles;
  return c.json(articles.map(({ uri, path, title, description, publishedAt, cover, author }) => ({
    uri,
    path,
    title,
    description: description || '',
    publishedAt,
    cover: cover ? proxyImageUrl(cover, pds, 'feed_small') : undefined,
    author: author
      ? {
          did: author.did,
          handle: author.handle,
          displayName: author.displayName || author.handle,
          avatar: author.avatar ? proxyAvatarUrl(author.avatar, 'avatar_thumb') : undefined,
        }
      : undefined,
  })), 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

pages.get('/api/authors/check', async (c) => {
  const identifier = (c.req.query('handle') || '').trim();
  const isDid = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(identifier);
  const isHandle = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(identifier);
  if (!isDid && !isHandle) return c.json({ error: 'A valid account handle is required.' }, 400);

  const authorDid = await resolveAtprotoIdentifier(identifier);
  if (!authorDid) return c.json({ isAuthor: false }, 200, { 'Cache-Control': 'public, max-age=60' });

  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const allArticles = await fetchArticles(pds, c.env.OWNER_DID);
  const isAuthor = allArticles.some((post) => post.author?.did.toLowerCase() === authorDid.toLowerCase());
  return c.json({ isAuthor }, 200, { 'Cache-Control': 'public, max-age=60' });
});

pages.get('/api/forum/moderators/check', async (c) => {
  const identifier = (c.req.query('handle') || '').trim();
  const isDid = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(identifier);
  const isHandle = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(identifier);
  if (!isDid && !isHandle) return c.json({ error: 'A valid account handle is required.' }, 400);

  try {
    const isModerator = await isForumModerator(identifier, c.env.OWNER_PDS);
    return c.json({ isModerator }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Could not check forum moderator status:', error);
    return c.json({ error: 'Forum moderator status is temporarily unavailable.' }, 502, { 'Cache-Control': 'no-store' });
  }
});

// Live status of the account providers offered on /auth, plus this site's own
// PDS. Each host is probed at /xrpc/_health; results are CDN-cached so logins
// don't stampede the providers.
const PDS_STATUS_HOSTS = ['account.coffeencode.cc', 'bsky.social', 'eurosky.social', 'blacksky.app'];
async function probePdsHost(host: string): Promise<'operational' | 'down'> {
  try {
    const res = await fetch(`https://${host}/xrpc/_health`, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: 'application/json' },
    });
    return res.ok ? 'operational' : 'down';
  } catch {
    return 'down';
  }
}
pages.get('/api/pds-status', async (c) => {
  const cacheHeaders = { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' };
  let ownerHost = 'account.coffeencode.cc';
  try { ownerHost = new URL(c.env.OWNER_PDS).hostname || ownerHost; } catch { /* keep fallback */ }

  // ?state=down|operational forces every host to that state for testing the
  // /auth page UI (visit /auth?state=down). Never cached.
  const forced = c.req.query('state');
  const hosts = Array.from(new Set([ownerHost, ...PDS_STATUS_HOSTS]));
  if (forced && ['operational', 'down'].includes(forced)) {
    const states = Object.fromEntries(hosts.map((h) => [h, forced]));
    return c.json({ host: ownerHost, states, forced: true }, 200, { 'Cache-Control': 'no-store' });
  }

  const probes = await Promise.all(hosts.map(async (h) => [h, await probePdsHost(h)] as const));
  const states = Object.fromEntries(probes);
  const ownerState = states[ownerHost] || 'unknown';
  return c.json({ host: ownerHost, state: ownerState, states }, 200, cacheHeaders);
});

pages.get('/auth', (c) => {
  const body = `
    <section class="auth-page" aria-labelledby="auth-title">
      <div class="auth-hero">
        <div class="auth-hero__intro">
          <h1 id="auth-title">Log in to Coffee &amp; Code</h1>
          <p class="auth-page__intro">Use the same identity you use for Bluesky, Blacksky, Eurosky, Pckt, Margin, Tangled. This app is built on the AT Protocol, an open social network. Where you're in full control of your data.</p>
          <ul class="auth-benefits">
            <li><i class="fa-solid fa-bookmark" aria-hidden="true"></i><div><strong>Build a reading list</strong><span>Save stories to your list and pick them back up on any device.</span></div></li>
            <li><i class="fa-solid fa-heart" aria-hidden="true"></i><div><strong>Like the work you enjoy</strong><span>Likes, dislikes, and reading history travel with your account.</span></div></li>
            <li><i class="fa-solid fa-comments" aria-hidden="true"></i><div><strong>Join the community</strong><span>Comment on stories, reply to other readers, and post in the forum.</span></div></li>
            <li><i class="fa-solid fa-bell" aria-hidden="true"></i><div><strong>Stay in the loop</strong><span>Follow authors and tags, and get notified about new matching stories.</span></div></li>
            <li><i class="fa-solid fa-feather" aria-hidden="true"></i><div><strong>Write with us</strong><span>Author accounts get a profile, drafts, and publishing tools.</span></div></li>
          </ul>
        </div>
        <div class="auth-card" data-auth-options>
          <div class="auth-welcome" data-auth-welcome hidden>
            <img class="auth-welcome__avatar" data-welcome-avatar alt="" hidden>
            <span class="auth-welcome__avatar auth-welcome__avatar--placeholder" data-welcome-placeholder><i class="fa-solid fa-user" aria-hidden="true"></i></span>
            <h2 class="auth-welcome__title">Welcome, <span data-welcome-name></span></h2>
            <p class="auth-welcome__handle">@<span data-welcome-handle></span><span data-welcome-pronouns hidden> · <span data-welcome-pronouns-value></span></span></p>
            <a class="login-button auth-option__button" data-welcome-continue href="/">Continue to Coffee &amp; Code</a>
          </div>
          <div class="auth-welcome" data-auth-signedout hidden>
            <span class="auth-welcome__avatar auth-welcome__avatar--placeholder"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i></span>
            <h2 class="auth-welcome__title">You've signed out</h2>
            <p class="auth-welcome__handle">Your identity and data stay on your own server — nothing is held here.</p>
            <a class="login-button auth-option__button" data-signedout-continue href="/auth">Sign back in</a>
          </div>
          <div class="account-switcher" data-account-switcher hidden></div>
          <p class="auth-card__heading">Continue with your AT Protocol account</p>
          <div class="auth-providers" data-auth-providers>
            <button type="button" class="auth-provider" aria-expanded="false" data-provider="account.coffeencode.cc"><img class="auth-provider__logo" src="/favicon.png" alt="" aria-hidden="true"><span class="auth-provider__copy"><strong>Continue with Coffee &amp; Code</strong><small>account.coffeencode.cc</small></span><i class="fa-solid fa-chevron-right auth-provider__chevron" aria-hidden="true"></i></button>
            <button type="button" class="auth-provider" aria-expanded="false" data-provider="bsky.social"><img class="auth-provider__logo" src="/logomarks/login/coffee-and-code-bsky.app-avatar.jpg" alt="" aria-hidden="true" loading="lazy"><span class="auth-provider__copy"><strong>Continue with Bluesky</strong><small>bsky.social</small></span><i class="fa-solid fa-chevron-right auth-provider__chevron" aria-hidden="true"></i></button>
            <button type="button" class="auth-provider" aria-expanded="false" data-provider="eurosky.social"><img class="auth-provider__logo" src="/logomarks/login/coffee-and-code-eurosky.social-avatar.jpg" alt="" aria-hidden="true" loading="lazy"><span class="auth-provider__copy"><strong>Continue with Eurosky</strong><small>eurosky.social</small></span><i class="fa-solid fa-chevron-right auth-provider__chevron" aria-hidden="true"></i></button>
            <button type="button" class="auth-provider" aria-expanded="false" data-provider="blacksky.app"><img class="auth-provider__logo" src="/logomarks/login/coffee-and-code-blackskyweb.xyz-avatar.jpg" alt="" aria-hidden="true" loading="lazy"><span class="auth-provider__copy"><strong>Continue with Blacksky</strong><small>blacksky.app</small></span><i class="fa-solid fa-chevron-right auth-provider__chevron" aria-hidden="true"></i></button>
            <button type="button" class="auth-provider" aria-expanded="false" data-provider=""><i class="fa-solid fa-at" aria-hidden="true"></i><span class="auth-provider__copy"><strong>Use a handle</strong><small>any AT Protocol account</small></span><i class="fa-solid fa-chevron-right auth-provider__chevron" aria-hidden="true"></i></button>
          </div>
          <form class="auth-form auth-handle-form" data-auth-form hidden>
            <label for="auth-handle" data-handle-label>Your handle</label>
            <input id="auth-handle" name="handle" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you.bsky.social" required>
            <p class="auth-handle-form__hint" data-handle-hint hidden></p>
            <button type="submit" class="login-button auth-option__button" data-handle-submit>Continue</button>
          </form>
          <div class="auth-card__divider"><span>Other ways to sign in</span></div>
          <details class="auth-row">
            <summary><i class="fa-solid fa-key" aria-hidden="true"></i> Use an app password</summary>
            <form class="auth-form" data-app-password-form>
              <label for="auth-app-identifier">Handle</label>
              <input id="auth-app-identifier" name="identifier" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you.bsky.social" required>
              <label for="auth-app-password">App password</label>
              <input id="auth-app-password" name="password" type="password" autocomplete="current-password" placeholder="xxxx-xxxx-xxxx-xxxx" required>
              <button type="submit" class="login-button auth-option__button">Sign in</button>
            </form>
            <p class="auth-page__resolution">Create an app password in your account provider’s settings (on Bluesky: Settings → App passwords). Signing in this way skips the permissions screen, so only use it on a device you trust.</p>
          </details>
          <button type="button" class="auth-provider auth-provider--create" data-create-coffee-account><i class="fa-solid fa-user-plus" aria-hidden="true"></i><span class="auth-provider__copy"><strong>Create a Coffee &amp; Code account</strong><small>hosted on our own infrastructure, works with thousands of apps</small></span><i class="fa-solid fa-chevron-right auth-provider__chevron" aria-hidden="true"></i></button>
          <p class="auth-page__resolution" data-invite-status aria-live="polite"></p>
          <div class="auth-invite" data-invite-panel hidden><code data-invite-code></code><button type="button" class="auth-signout" data-copy-invite>Copy invite code</button></div>
        </div>
      </div>
      <div class="auth-account" data-auth-account hidden>
        <p class="auth-account__status">Signed in as <strong data-auth-name></strong></p>
        <button type="button" class="auth-signout" data-auth-signout>Log out</button>
      </div>
      <p class="auth-page__error" data-auth-error role="alert" hidden></p>
    </section>
    <script type="module">
      (async () => {
        try {
          const forced = new URLSearchParams(location.search).get('state');
          const res = await fetch('/api/pds-status' + (forced ? '?state=' + encodeURIComponent(forced) : ''), { headers: { accept: 'application/json' } });
          if (!res.ok) return;
          const data = await res.json();
          const states = data.states || {};
          const disable = (btn) => {
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
            btn.classList.add('auth-provider--down');
            const sub = btn.querySelector('.auth-provider__copy small');
            if (sub) sub.textContent = 'Account host is currently down';
            btn.title = 'This account host is down — see status.coffeencode.cc';
          };
          for (const [host, state] of Object.entries(states)) {
            if (state !== 'down') continue;
            document.querySelectorAll('[data-provider="' + CSS.escape(host) + '"]').forEach(disable);
          }
          const createBtn = document.querySelector('[data-create-coffee-account]');
          if (createBtn && data.host && states[data.host] === 'down') disable(createBtn);
        } catch { /* leave buttons enabled if the status check itself fails */ }
      })();
    </script>
  `;

  return c.html(renderLayout(c, 'Log in', body));
});

pages.get('/account', (c) => {
  const main = `
          <section class="account-card account-page__viewed" aria-labelledby="saved-posts-title"><div class="account-card__header"><h2 id="saved-posts-title"><i class="fa-solid fa-bookmark" aria-hidden="true"></i> Reading list</h2><span class="account-card__count" data-saved-count></span></div><p class="account-page__viewed-status" data-saved-status role="status" aria-live="polite">Loading your saved posts…</p><ul data-saved-posts></ul></section>
          <section class="account-card account-page__viewed" aria-labelledby="viewed-posts-title"><div class="account-card__header"><h2 id="viewed-posts-title"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Recently viewed</h2></div><p class="account-page__viewed-status" data-viewed-status>Loading your viewed posts…</p><ul data-viewed-posts></ul></section>`;
  const secondary = `
          <section class="account-card account-page__viewed" aria-labelledby="followed-tags-title">
            <h2 id="followed-tags-title"><i class="fa-solid fa-users" aria-hidden="true"></i> Following</h2>
            <p class="account-page__viewed-status" data-tag-follows-status role="status" aria-live="polite">Loading who you follow…</p>
            <ul class="account-follows-list" data-tag-follows-list></ul>
            <h3 class="account-page__subheading"><i class="fa-solid fa-newspaper" aria-hidden="true"></i> Latest from your tags</h3>
            <ul class="account-page__tag-posts" data-tag-follows-posts></ul>
            <p class="account-page__blocks-note">Follow authors on their pages and tags from the <a href="/tags">tag directory</a> to see new matching stories here and get notified.</p>
          </section>
          <section class="account-card account-page__viewed account-page__preferences" aria-labelledby="appearance-title">
            <h2 id="appearance-title"><i class="fa-solid fa-palette" aria-hidden="true"></i> Appearance</h2>
            <div class="account-preferences" data-preferences>
              <fieldset>
                <legend>Theme</legend>
                <div class="account-preferences__options" role="radiogroup" aria-label="Theme">
                  <label><input type="radio" name="pref-theme" value="system"> System</label>
                  <label><input type="radio" name="pref-theme" value="dark"> Dark</label>
                  <label><input type="radio" name="pref-theme" value="light"> Light</label>
                </div>
              </fieldset>
              <fieldset>
                <legend>Site font</legend>
                <div class="account-preferences__options" role="radiogroup" aria-label="Site font">
                  <label><input type="radio" name="pref-ui-font" value="sans"> Sans</label>
                  <label><input type="radio" name="pref-ui-font" value="serif"> Serif</label>
                  <label><input type="radio" name="pref-ui-font" value="monospace"> Mono</label>
                  <label><input type="radio" name="pref-ui-font" value="system"> System</label>
                  <label><input type="radio" name="pref-ui-font" value="inter"> Inter</label>
                  <label><input type="radio" name="pref-ui-font" value="atkinson"> Atkinson</label>
                  <label><input type="radio" name="pref-ui-font" value="merriweather"> Merriweather</label>
                  <label><input type="radio" name="pref-ui-font" value="fraunces"> Fraunces</label>
                </div>
              </fieldset>
              <fieldset>
                <legend>Story font</legend>
                <div class="account-preferences__options" role="radiogroup" aria-label="Story font">
                  <label><input type="radio" name="pref-font" value="sans"> Sans</label>
                  <label><input type="radio" name="pref-font" value="serif"> Serif</label>
                  <label><input type="radio" name="pref-font" value="monospace"> Mono</label>
                  <label><input type="radio" name="pref-font" value="system"> System</label>
                  <label><input type="radio" name="pref-font" value="inter"> Inter</label>
                  <label><input type="radio" name="pref-font" value="atkinson"> Atkinson</label>
                  <label><input type="radio" name="pref-font" value="merriweather"> Merriweather</label>
                  <label><input type="radio" name="pref-font" value="fraunces"> Fraunces</label>
                </div>
              </fieldset>
              <label>Story text size
                <span class="account-preferences__size">
                  <input type="range" name="pref-font-size" min="14" max="26" step="1" value="19" data-pref-font-size>
                  <output data-pref-font-size-output for="pref-font-size">19px</output>
                </span>
              </label>
              <p class="account-preferences__status" data-preferences-status role="status" aria-live="polite"></p>
              <p class="account-preferences__note">Saved to your AT Protocol account and synced anywhere you sign in.</p>
            </div>
          </section>
          <section class="account-card account-page__viewed account-page__push" aria-labelledby="push-settings-title">
            <h2 id="push-settings-title"><i class="fa-solid fa-bell" aria-hidden="true"></i> Browser notifications</h2>
            <p class="account-page__viewed-status" data-push-status role="status" aria-live="polite">Checking this browser…</p>
            <div data-push-settings hidden>
              <label class="account-email__toggle"><input type="checkbox" data-push-enabled> Notify me in this browser</label>
              <fieldset data-push-topics>
                <legend>Notify me about</legend>
                <div class="account-preferences__options">
                  <label><input type="checkbox" data-push-topic="comments"> Comments on my stories</label>
                  <label><input type="checkbox" data-push-topic="replies"> Replies to my comments</label>
                  <label><input type="checkbox" data-push-topic="likes"> Likes</label>
                  <label><input type="checkbox" data-push-topic="reads"> Reads of my stories</label>
                  <label><input type="checkbox" data-push-topic="newPosts"> New stories from people and tags I follow</label>
                </div>
              </fieldset>
              <p class="account-page__blocks-note">Notifications reach this browser even when the site is closed. Turn them on in each browser you use.</p>
            </div>
          </section>
          ${accountEmailCard}
          <section class="account-card account-page__viewed account-page__blocks" aria-labelledby="blocked-accounts-title">
            <h2 id="blocked-accounts-title"><i class="fa-solid fa-ban" aria-hidden="true"></i> Blocked accounts</h2>
            <p class="account-page__viewed-status" data-blocks-status role="status" aria-live="polite">Loading your blocked accounts…</p>
            <ul data-blocks-list></ul>
            <p class="account-page__blocks-note">Coffee &amp; Code blocks hide this account’s forum posts and replies for you. Stories and comments remain visible. Bluesky blocks are managed separately in Bluesky settings.</p>
          </section>`;
  const body = accountPageShell('Your account', main, {
    secondary,
    signedOutMessage: 'Sign in to view your account and manage your interactions.',
  });
  return c.html(renderLayout(c, 'Your account', body));
});

const accountEmailCard = `
  <section class="account-card account-page__viewed account-page__email" aria-labelledby="email-settings-title">
    <h2 id="email-settings-title"><i class="fa-solid fa-envelope" aria-hidden="true"></i> Email notifications</h2>
    <p class="account-page__viewed-status" data-email-status role="status" aria-live="polite">Loading your email settings…</p>
    <div data-email-settings hidden>
      <label class="account-email__toggle"><input type="checkbox" data-email-enabled> Email me when people or tags I follow publish a story</label>
      <fieldset class="account-email__frequency" data-email-frequency>
        <legend>Delivery</legend>
        <div class="account-preferences__options" role="radiogroup" aria-label="Delivery frequency">
          <label><input type="radio" name="email-frequency" value="instant"> As they publish</label>
          <label><input type="radio" name="email-frequency" value="daily"> Daily brief</label>
          <label><input type="radio" name="email-frequency" value="weekly"> Weekly brief</label>
        </div>
      </fieldset>
      <ul class="account-email__list" data-email-list></ul>
      <p class="account-page__blocks-note">Choose where each tag and author is delivered on the <a href="/account/email">email routing page</a>, or use “Filters” on an address here.</p>
      <form class="account-email__form" data-email-form>
        <label>Email address<input name="email" type="email" maxlength="254" required autocomplete="email" placeholder="you@example.com"></label>
        <div class="account-profile-form__actions">
          <button class="auth-signout" type="submit"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add email</button>
          <button type="button" class="auth-signout" data-email-account-button hidden><i class="fa-solid fa-at" aria-hidden="true"></i> Use my account email</button>
        </div>
      </form>
      <p class="account-page__blocks-note">Your account email is ready right away. Any other address gets a confirmation link before it receives stories.</p>
    </div>
  </section>`;

function accountPageShell(
  title: string,
  main: string,
  options: { secondary?: string; signedOutMessage?: string; mainClass?: string; hideSidebar?: boolean } = {},
) {
  const secondary = options.secondary
    ? `<div class="account-layout__column account-layout__secondary">${options.secondary}</div>`
    : '';
  return `
    <section class="auth-page account-page" aria-labelledby="account-title" data-account-page>
      <h1 id="account-title">${title}</h1>
      <div class="auth-account" data-auth-account hidden>
        <div class="account-layout${options.hideSidebar ? ' account-layout--solo' : ''}">
        ${options.hideSidebar ? '' : accountProfileSidebar}
        <div class="account-layout__column account-layout__main${options.mainClass ? ` ${options.mainClass}` : ''}">
        ${main}
        </div>
        ${secondary}
        </div>
      </div>
      <div data-account-signed-out hidden><p class="auth-page__intro">${options.signedOutMessage || 'Sign in to view this page.'}</p><a class="login-button" href="/auth" data-login-link>Log in</a></div>
    </section>
  `;
}

const accountProfileSidebar = `
  <aside class="account-layout__column account-layout__sidebar" aria-label="Your profile">
    <section class="account-card" aria-labelledby="profile-card-title">
      <div class="account-page__profile"><img data-profile-avatar alt="" hidden><span data-profile-placeholder aria-hidden="true"><i class="fa-solid fa-user"></i></span><div><h2 id="profile-card-title" data-profile-name>Loading account…</h2><p data-profile-handle></p><p class="account-page__profile-meta" data-profile-pronouns hidden></p><p data-profile-bio></p></div></div>
      <form class="account-profile-form" data-user-profile-form hidden aria-labelledby="profile-form-title">
        <h3 id="profile-form-title" class="visually-hidden">Edit your Coffee &amp; Code profile</h3>
        <label>Display name<input name="displayName" maxlength="64" autocomplete="nickname"></label>
        <label>Pronouns<input name="pronouns" maxlength="40" placeholder="Optional"></label>
        <label>Bio<textarea name="description" maxlength="256" rows="4"></textarea></label>
        <div class="account-profile-form__actions"><button class="auth-signout" type="submit"><i class="fa-solid fa-check" aria-hidden="true"></i> Save profile</button><button class="account-author-form__cancel" type="button" data-cancel-user-profile>Cancel</button></div>
      </form>
      <p class="account-profile-form__status" data-user-profile-status role="status" aria-live="polite"></p>
      <div class="account-page__actions">
        <button type="button" class="auth-signout" data-edit-user-profile disabled><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit profile</button>
        <button type="button" class="auth-signout" data-auth-signout><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Log out</button>
      </div>
      <nav class="account-page__section-nav" aria-label="Account sections">
        <a href="/account"><i class="fa-solid fa-house" aria-hidden="true"></i> Overview</a>
        <a href="/account/saves"><i class="fa-solid fa-bookmark" aria-hidden="true"></i> Reading list</a>
        <a href="/account/reads"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Recently viewed</a>
        <a href="/account/list"><i class="fa-solid fa-list" aria-hidden="true"></i> Your lists</a>
        <a href="/account/feed"><i class="fa-solid fa-rss" aria-hidden="true"></i> Your feed</a>
        <a href="/account#followed-tags-title"><i class="fa-solid fa-users" aria-hidden="true"></i> Following</a>
        <a href="/account#appearance-title"><i class="fa-solid fa-palette" aria-hidden="true"></i> Appearance</a>
        <a href="/account#push-settings-title"><i class="fa-solid fa-bell" aria-hidden="true"></i> Browser notifications</a>
        <a href="/account#email-settings-title"><i class="fa-solid fa-envelope" aria-hidden="true"></i> Email notifications</a>
        <a href="/account/email"><i class="fa-solid fa-route" aria-hidden="true"></i> Email routing</a>
        <a href="/account#blocked-accounts-title"><i class="fa-solid fa-ban" aria-hidden="true"></i> Blocked accounts</a>
        <a href="/account/author" data-author-settings-link hidden><i class="fa-solid fa-feather" aria-hidden="true"></i> Author profile</a>
        <a href="/account/author/draft" data-author-settings-link hidden><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Drafts</a>
      </nav>
    </section>
    <section class="account-card account-switcher-card" data-account-switcher hidden aria-label="Switch account"></section>
  </aside>`;

pages.get('/account/saves', (c) => {
  const main = `
    <section class="account-card account-page__viewed" aria-labelledby="saved-posts-title">
      <div class="account-card__header"><h2 id="saved-posts-title"><i class="fa-solid fa-bookmark" aria-hidden="true"></i> Reading list</h2><span class="account-card__count" data-saved-count></span></div>
      <p class="account-page__viewed-status" data-saved-status role="status" aria-live="polite">Loading your saved posts…</p>
      <ul data-saved-posts></ul>
    </section>`;
  const body = accountPageShell('Reading list', main, { signedOutMessage: 'Sign in to see the stories you saved.' });
  return c.html(renderLayout(c, 'Reading list', body));
});

pages.get('/account/reads', (c) => {
  const main = `
    <section class="account-card account-page__viewed" aria-labelledby="viewed-posts-title">
      <div class="account-card__header"><h2 id="viewed-posts-title"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Recently viewed</h2></div>
      <p class="account-page__viewed-status" data-viewed-status role="status" aria-live="polite">Loading your viewed posts…</p>
      <ul data-viewed-posts></ul>
    </section>`;
  const body = accountPageShell('Recently viewed', main, { signedOutMessage: 'Sign in to see the stories you read.' });
  return c.html(renderLayout(c, 'Recently viewed', body));
});

pages.get('/account/list', (c) => {
  const main = `
      <section class="account-card account-page__viewed" aria-labelledby="account-lists-title" data-account-lists>
        <div class="account-card__header"><h2 id="account-lists-title"><i class="fa-solid fa-list" aria-hidden="true"></i> Your lists</h2><span class="account-card__count" data-lists-count></span></div>
        <p class="account-page__viewed-status" data-lists-status role="status" aria-live="polite">Loading your lists…</p>
        <ul data-lists-list></ul>
      </section>`;
  const secondary = `
      <section class="account-card account-page__viewed" aria-labelledby="list-form-title">
        <h2 id="list-form-title" data-list-form-title><i class="fa-solid fa-plus" aria-hidden="true"></i> Create a list</h2>
        <form class="account-profile-form account-list-form" data-list-form aria-labelledby="list-form-title">
          <label>Title<input name="title" maxlength="120" required placeholder="Required"></label>
          <label>About<textarea name="about" maxlength="2000" rows="3" placeholder="Optional — what belongs on this list?"></textarea></label>
          <label>Icon<input name="icon" maxlength="2048" placeholder="Optional — emoji or https image URL"></label>
          <div class="account-profile-form__actions">
            <button class="auth-signout" type="submit" data-list-submit>Create list</button>
            <button class="account-author-form__cancel" type="button" data-list-cancel hidden>Cancel</button>
          </div>
          <p class="account-profile-form__status" data-list-form-status role="status" aria-live="polite"></p>
        </form>
        <p class="account-page__blocks-note">Lists are saved to your AT Protocol account and are public. Add stories to a list from the story page, or share a list link with anyone.</p>
      </section>`;
  const body = accountPageShell('Your lists', main, { secondary, signedOutMessage: 'Sign in to create and manage your lists.' });
  return c.html(renderLayout(c, 'Your lists', body));
});

pages.get('/account/email', (c) => {
  const main = `
      <section class="account-card account-page__viewed account-page__email-routing" aria-labelledby="email-routing-title">
        <h2 id="email-routing-title"><i class="fa-solid fa-route" aria-hidden="true"></i> Email routing</h2>
        <p class="account-page__blocks-note">Choose which of your addresses receives stories about each tag and author you follow. An address set to “All stories” gets everything; one set to “Only selected” gets just its checked sources.</p>
        <p class="account-page__viewed-status" data-email-routing-status role="status" aria-live="polite">Loading your email routing…</p>
        <div class="email-routing" data-email-routing hidden></div>
        <div class="account-profile-form__actions"><button class="auth-signout" data-email-routing-save hidden><i class="fa-solid fa-check" aria-hidden="true"></i> Save routing</button></div>
      </section>`;
  const body = accountPageShell('Email routing', main, { secondary: accountEmailCard, signedOutMessage: 'Sign in to route story emails to your addresses.' });
  return c.html(renderLayout(c, 'Email routing', body));
});

pages.get('/account/feed', (c) => {
  const main = `
    <section class="account-card account-page__viewed" aria-labelledby="account-feed-title">
      <div class="account-card__header"><h2 id="account-feed-title"><i class="fa-solid fa-rss" aria-hidden="true"></i> Your feed</h2></div>
      <p class="account-page__viewed-status">Your personal feed is coming soon.</p>
    </section>`;
  const body = accountPageShell('Your feed', main, { signedOutMessage: 'Sign in to see your feed.' });
  return c.html(renderLayout(c, 'Your feed', body));
});

pages.get('/account/author', (c) => {
  const main = `
    <section class="account-card account-author-settings account-page__wide" data-author-settings hidden aria-labelledby="author-settings-title">
      <h2 id="author-settings-title"><i class="fa-solid fa-feather" aria-hidden="true"></i> Author profile</h2>
      <p class="account-author-settings__intro">Manage the profile shown on your Coffee &amp; Code author page.</p>
      <button type="button" class="auth-signout" data-edit-author-profile hidden><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit author profile</button>
      <form class="account-author-form" data-author-profile-form hidden>
        <div class="account-author-form__workspace">
          <div class="account-author-form__fields">
            <button type="button" class="account-author-form__sync" data-sync-bluesky-profile><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Sync from Bluesky profile</button>
            <p class="account-author-form__sync-note">Review synced details and save them to your Coffee &amp; Code author profile.</p>
            <label>Display name<input name="displayName" maxlength="100"></label>
            <label>Pronouns<input name="pronouns" maxlength="50" placeholder="Optional"></label>
            <label class="account-author-form__wide">Bio<textarea name="description" maxlength="1000" rows="5"></textarea></label>
            <label>Profile photo<input name="avatar" type="file" accept="image/*"></label>
            <label class="account-author-form__check"><input name="removeAvatar" type="checkbox"> Remove current photo</label>
            <label>Profile banner<input name="banner" type="file" accept="image/*"></label>
            <label class="account-author-form__check"><input name="removeBanner" type="checkbox"> Remove current banner</label>
            <fieldset class="account-author-form__pins account-author-form__wide"><legend><i class="fa-solid fa-thumbtack" aria-hidden="true"></i> Pinned posts</legend><p>Choose the stories to feature on your author page.</p><input type="search" class="account-search-input" data-author-posts-search placeholder="Search your stories…" aria-label="Search your stories"><p data-author-posts-status>Stories will load when you open the editor.</p><div data-author-post-picker></div></fieldset>
            <div class="account-author-form__actions account-author-form__wide"><button class="auth-signout" type="submit"><i class="fa-solid fa-check" aria-hidden="true"></i> Save profile</button><button class="account-author-form__cancel" type="button" data-cancel-author-edit>Cancel</button></div>
            <p class="account-author-form__status account-author-form__wide" data-author-profile-status role="status" aria-live="polite"></p>
          </div>
          <aside class="account-author-preview" aria-label="Author profile preview">
            <div class="account-author-preview__banner"><img data-author-preview-banner alt="" hidden><span data-author-preview-banner-placeholder>Author profile</span></div>
            <div class="account-author-preview__identity">
              <img class="account-author-preview__avatar" data-author-preview-avatar alt="" hidden>
              <span class="account-author-preview__avatar account-author-preview__avatar--placeholder" data-author-preview-avatar-placeholder aria-hidden="true"><i class="fa-solid fa-user"></i></span>
              <div><h3 data-author-preview-name></h3><p data-author-preview-handle></p></div>
            </div>
            <p class="account-author-preview__pronouns" data-author-preview-pronouns></p>
            <p class="account-author-preview__bio" data-author-preview-bio></p>
            <p class="account-author-preview__footnote">This is how your author profile will appear to readers.</p>
          </aside>
        </div>
      </form>
    </section>
    <section class="account-card account-page__viewed" data-author-gate hidden aria-labelledby="author-gate-title">
      <h2 id="author-gate-title">Author profile</h2>
      <p class="account-page__viewed-status">Author tools appear here once you have published a story on Coffee &amp; Code. <a href="/become-an-author">Learn how to become an author</a>.</p>
    </section>`;
  const body = accountPageShell('Author profile', main, { signedOutMessage: 'Sign in to manage your author profile.' });
  return c.html(renderLayout(c, 'Author profile', body));
});

const draftEditorStyles = `
  <style>
    .draft-editor-page { --doc-canvas: #1c110c; --doc-page: var(--paper); --doc-width: 860px; max-width: 1400px; }
    .draft-editor-page__bar { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
    .draft-editor-page__bar .read-link { font-size: 14px; }
    .draft-editor-page__status { color: var(--muted); font-size: 13px; margin-left: auto; }
    .draft-editor-page__actions { display: flex; gap: 8px; }
    .draft-preview-toggle { position: absolute; opacity: 0; pointer-events: none; }
    .draft-preview-toggle__btn { align-items: center; border: 1px solid var(--line-strong); color: var(--ink); cursor: pointer; display: inline-flex; font: 600 13px 'Source Sans 3', sans-serif; gap: 7px; padding: 9px 14px; }
    .draft-preview-toggle__btn:hover { color: var(--accent); }
    .draft-preview-toggle:checked ~ .draft-editor-page__bar .draft-preview-toggle__btn { background: var(--accent); color: var(--paper); }
    .draft-editor__grid { background: var(--doc-canvas); border: 1px solid var(--line); border-radius: 10px; display: grid; gap: 0; grid-template-columns: minmax(0, 1fr); padding: 14px clamp(8px, 3vw, 28px) 48px; }
    .draft-preview { display: none; }
    .draft-preview-toggle:checked ~ .draft-editor__grid { gap: 28px; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); }
    .draft-preview-toggle:checked ~ .draft-editor__grid .draft-preview { display: block; }
    @media (max-width: 900px) { .draft-preview-toggle:checked ~ .draft-editor__grid { grid-template-columns: 1fr; } }
    .draft-toolbar { align-items: center; background: var(--paper-deep); border: 1px solid var(--line); border-radius: 999px; box-shadow: 0 6px 18px rgba(0, 0, 0, .35); display: flex; flex-wrap: wrap; gap: 2px; grid-column: 1 / -1; justify-content: center; margin: 4px auto 18px; padding: 6px 10px; position: sticky; top: 88px; width: fit-content; max-width: 100%; z-index: 50; }
    @media (max-width: 760px) { .draft-toolbar { top: 70px; } }
    .draft-toolbar button { background: transparent; border: 0; border-radius: 6px; color: var(--ink); cursor: pointer; font: inherit; font-size: 14px; min-height: 32px; min-width: 32px; padding: 4px 8px; }
    .draft-toolbar button:hover { background: var(--paper); }
    .draft-toolbar button[aria-pressed="true"] { background: var(--paper); color: var(--accent); }
    .draft-toolbar__sep { border-left: 1px solid var(--line); height: 22px; margin: 0 4px; }
    .draft-editor__meta { min-width: 0; }
    .draft-editor__doc-settings { margin: 0 auto 22px; max-width: var(--doc-width); }
    .draft-editor__doc-settings summary { border: 1px dashed var(--line); border-radius: 6px; color: var(--muted); cursor: pointer; font-size: 12px; font-weight: 700; letter-spacing: .08em; list-style: none; padding: 10px 16px; text-align: center; text-transform: uppercase; }
    .draft-editor__doc-settings summary::-webkit-details-marker { display: none; }
    .draft-editor__doc-settings summary::before { content: '⚙ '; }
    .draft-editor__doc-settings summary:hover { border-color: var(--line-strong); color: var(--ink); }
    .draft-editor__doc-settings[open] summary { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom-style: solid; }
    .draft-editor__doc-body { border: 1px solid var(--line); border-radius: 6px; display: grid; gap: 14px; padding: 18px; }
    .draft-editor__meta-doc { display: contents; }
    .draft-editor__sheet { background: var(--doc-page); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 10px 30px rgba(0, 0, 0, .45); margin: 0 auto; max-width: var(--doc-width); min-height: 70vh; padding: clamp(24px, 6vw, 68px) clamp(20px, 8vw, 88px); }
    .draft-editor__meta-title { background: transparent; border: 0; color: var(--ink); font-family: Lora, serif; font-size: 32px; font-weight: 700; letter-spacing: -.02em; line-height: 1.2; padding: 0 0 10px; width: 100%; }
    .draft-editor__meta-title:focus { outline: none; }
    .draft-editor__meta-title::placeholder, .draft-editor__meta-description::placeholder { color: var(--muted); opacity: .55; }
    .draft-editor__meta-description { background: transparent; border: 0; border-bottom: 1px solid var(--line); color: var(--muted); font: inherit; font-size: 16px; line-height: 1.5; margin-bottom: 22px; padding: 0 0 14px; resize: none; width: 100%; }
    .draft-editor__meta-description:focus { color: var(--ink); outline: none; }
    .draft-editor__meta-grid { column-gap: 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); row-gap: 12px; }
    .draft-editor__meta-grid label, .draft-editor__meta-sources label { color: var(--muted); display: grid; font-size: 11px; font-weight: 700; gap: 4px; letter-spacing: .06em; text-transform: uppercase; }
    .draft-editor__meta-grid input, .draft-editor__meta-grid select, .draft-editor__meta-sources input, .draft-editor__meta-sources textarea { background: var(--paper); border: 1px solid var(--line); border-radius: 3px; color: var(--ink); font: inherit; font-size: 14px; letter-spacing: normal; padding: 7px 10px; text-transform: none; }
    .draft-editor__meta-grid input:focus, .draft-editor__meta-grid select:focus, .draft-editor__meta-sources input:focus, .draft-editor__meta-sources textarea:focus { border-color: var(--accent); outline: none; }
    .draft-editor__meta-grid input[type="file"] { font-size: 13px; padding: 5px 0; }
    .draft-editor__meta-check { align-items: center; align-self: end; display: flex !important; flex-direction: row; gap: 7px !important; letter-spacing: normal !important; padding-bottom: 8px; text-transform: none !important; }
    .draft-editor__meta-sources { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 4px; display: grid; gap: 10px; padding: 14px 16px; }
    .draft-editor__meta-sources h2 { font-size: 15px; margin: 0; }
    .draft-editor__meta-hint { color: var(--muted); font-size: 13px; margin: 0; }
    .draft-editor__meta-sources textarea { resize: vertical; }
    .draft-blocks { min-height: 40vh; }
    .draft-block { border-radius: 4px; margin: 2px 0; padding: 4px 6px; position: relative; }
    .draft-block:hover { background: var(--paper-deep); }
    .draft-block__editable { min-height: 1.4em; outline: none; overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.7; }
    .draft-block__editable:empty::before { color: var(--muted); content: attr(data-placeholder); pointer-events: none; }
    .draft-block[data-type="header"] .draft-block__editable { font-family: Lora, serif; font-weight: 700; line-height: 1.2; }
    .draft-block[data-level="1"] .draft-block__editable { font-size: 30px; }
    .draft-block[data-level="2"] .draft-block__editable { font-size: 25px; }
    .draft-block[data-level="3"] .draft-block__editable { font-size: 21px; }
    .draft-block[data-type="blockquote"] .draft-block__editable { border-left: 3px solid var(--accent); color: var(--muted); padding-left: 12px; }
    .draft-block[data-type="code"] .draft-block__editable { background: var(--paper-deep); font-family: ui-monospace, monospace; font-size: 14px; padding: 10px; white-space: pre-wrap; }
    .draft-block__fields { display: grid; gap: 8px; }
    .draft-block__fields input { font: inherit; width: 100%; }
    .draft-block__remove { background: transparent; border: 0; color: var(--muted); cursor: pointer; font-size: 15px; opacity: 0; padding: 2px 6px; position: absolute; right: 2px; top: 2px; }
    .draft-block:hover .draft-block__remove { opacity: 1; }
    .draft-block__item-row { align-items: baseline; display: flex; gap: 8px; }
    .draft-block__item-row::before { color: var(--muted); content: '•'; }
    .draft-block[data-type="orderedList"] .draft-block__item-row { counter-increment: draft-list-item; }
    .draft-block[data-type="orderedList"] .draft-block__item-row::before { content: counter(draft-list-item) '.'; }
    .draft-block[data-type="orderedList"] { counter-reset: draft-list-item; }
    .draft-block__item-row .draft-block__editable { flex: 1; }
    .draft-block__hr { border: 0; border-top: 1px solid var(--line-strong); margin: 12px 0; }
    .draft-block__image img { display: block; max-width: 100%; }
    .draft-block__video video { display: block; max-width: 100%; }
    .draft-editor__add { margin-top: 10px; }
    .draft-preview { align-self: start; background: var(--doc-page); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 10px 30px rgba(0, 0, 0, .45); margin-top: 52px; min-width: 0; padding: 30px; position: sticky; top: 150px; }
    .draft-preview h1.draft-preview__title { font-family: Lora, serif; font-size: 34px; line-height: 1.15; margin: 0 0 8px; overflow-wrap: anywhere; }
    .draft-preview__description { color: var(--muted); margin: 0 0 18px; }
    .draft-preview__cover { display: block; margin-bottom: 18px; max-width: 100%; }
    .draft-preview p { line-height: 1.65; margin: 0 0 14px; overflow-wrap: anywhere; white-space: pre-wrap; }
    .draft-preview h1, .draft-preview h2, .draft-preview h3 { font-family: Lora, serif; line-height: 1.25; margin: 20px 0 10px; overflow-wrap: anywhere; }
    .draft-preview blockquote { border-left: 3px solid var(--accent); color: var(--muted); margin: 0 0 14px; padding-left: 14px; white-space: pre-wrap; }
    .draft-preview pre { background: var(--paper-deep); font-size: 14px; overflow-x: auto; padding: 12px; white-space: pre-wrap; }
    .draft-preview code { font-family: ui-monospace, monospace; }
    .draft-preview ul, .draft-preview ol { margin: 0 0 14px; padding-left: 24px; }
    .draft-preview li { line-height: 1.6; margin: 4px 0; white-space: pre-wrap; }
    .draft-preview img, .draft-preview video { max-width: 100%; }
    .draft-preview figure { margin: 0 0 14px; }
    .draft-preview figcaption { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .draft-preview__button { background: var(--accent); color: var(--paper); display: inline-block; font-weight: 700; margin-bottom: 14px; padding: 10px 18px; }
    .draft-preview__card { border: 1px solid var(--line); display: block; margin-bottom: 14px; padding: 12px 14px; }
    .draft-preview__card span { color: var(--muted); display: block; font-size: 13px; }
    .draft-preview__embed { border: 1px solid var(--line); color: var(--muted); font-size: 14px; margin-bottom: 14px; padding: 12px 14px; }
    .draft-preview__math { font-family: ui-monospace, monospace; margin-bottom: 14px; text-align: center; }
    .draft-preview__embed-frame { border: 1px solid var(--line); display: block; margin-bottom: 14px; }
    .draft-preview__empty { color: var(--muted); }
    .draft-preview__sources { border-top: 1px solid var(--line); margin-top: 20px; padding-top: 14px; }
    .draft-preview__sources h2 { font-size: 15px; margin: 0 0 8px; }
    .draft-preview__sources ul { margin: 0; }
    .draft-preview__sources a { color: var(--accent); overflow-wrap: anywhere; }
    .draft-preview__sources span { color: var(--muted); font-size: 13px; }
    .draft-list__item { align-items: center; display: flex; gap: 12px; }
    .draft-list__item > a { flex: 1; min-width: 0; }
    .draft-list__title { display: block; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .draft-list__meta { color: var(--muted); display: block; font-size: 13px; }
    .draft-list__badge { border: 1px solid var(--line-strong); border-radius: 3px; color: var(--accent); display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .06em; padding: 1px 5px; text-transform: uppercase; }
    ::highlight(draft-spell) { text-decoration: underline wavy #e5484d 1.5px; text-decoration-skip-ink: none; }
    ::highlight(draft-grammar) { text-decoration: underline wavy #d9a441 1.5px; text-decoration-skip-ink: none; }
    .draft-spell-pop { background: var(--paper); border: 1px solid var(--line-strong); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .5); display: grid; font-size: 14px; gap: 2px; max-width: 300px; padding: 8px; position: fixed; z-index: 400; }
    .draft-spell-pop[hidden] { display: none; }
    .draft-spell-pop__kind { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .draft-spell-pop__message { color: var(--muted); font-size: 12px; line-height: 1.4; margin: 0 0 4px; }
    .draft-spell-pop__suggestion { background: transparent; border: 0; border-radius: 4px; color: var(--accent); cursor: pointer; font: inherit; font-weight: 700; padding: 5px 8px; text-align: left; }
    .draft-spell-pop__suggestion:hover { background: var(--paper-deep); color: var(--ink); }
    .draft-spell-pop__actions { border-top: 1px solid var(--line); display: flex; gap: 4px; margin-top: 4px; padding-top: 6px; }
    .draft-spell-pop__minor { background: transparent; border: 0; border-radius: 4px; color: var(--muted); cursor: pointer; font: inherit; font-size: 12px; padding: 4px 6px; }
    .draft-spell-pop__minor:hover { color: var(--ink); }
    .draft-publish-dialog { background: transparent; border: 0; max-width: min(520px, calc(100vw - 32px)); padding: 0; }
    .draft-publish-dialog::backdrop { background: rgba(10, 6, 4, .72); }
    .draft-publish-dialog__card { background: var(--paper); border: 1px solid var(--line-strong); border-radius: 10px; box-shadow: 0 24px 60px rgba(0, 0, 0, .55); padding: 26px; }
    .draft-publish-dialog__card h1 { font-family: Lora, serif; font-size: 27px; line-height: 1.15; margin: 0 0 10px; }
    .draft-publish-dialog__intro { color: var(--muted); font-size: 14px; line-height: 1.55; margin: 0 0 18px; }
    .draft-share-card { border: 1px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
    .draft-share-card__image { aspect-ratio: 1.91 / 1; background: var(--paper-deep); display: block; object-fit: cover; width: 100%; }
    .draft-share-card__body { display: grid; gap: 4px; padding: 12px 14px; }
    .draft-share-card__title { font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
    .draft-share-card__description { -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--muted); display: -webkit-box; font-size: 13px; line-height: 1.45; margin: 0; overflow: hidden; }
    .draft-share-card__meta { color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .06em; margin-top: 4px; text-transform: uppercase; }
    .draft-publish-dialog__actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 22px; }
    .draft-slash-menu { background: var(--paper); border: 1px solid var(--line-strong); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .5); display: grid; gap: 1px; max-height: 300px; overflow-y: auto; padding: 6px; position: fixed; width: 250px; z-index: 400; }
    .draft-slash-menu[hidden] { display: none; }
    .draft-slash-menu__item { align-items: center; background: transparent; border: 0; border-radius: 5px; color: var(--ink); cursor: pointer; display: flex; font: inherit; font-size: 14px; gap: 10px; padding: 7px 10px; text-align: left; }
    .draft-slash-menu__item i { color: var(--accent); font-size: 13px; text-align: center; width: 16px; }
    .draft-slash-menu__item:hover, .draft-slash-menu__item[aria-selected="true"] { background: var(--paper-deep); }
    .draft-slash-menu__empty { color: var(--muted); font-size: 13px; margin: 0; padding: 8px 10px; }
  </style>`;

pages.get('/account/author/draft', (c) => {
  const main = `
    <section class="account-card account-page__viewed" aria-labelledby="drafts-title" data-draft-list>
      <div class="account-card__header"><h2 id="drafts-title"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Drafts</h2><button type="button" class="auth-signout" data-draft-new><i class="fa-solid fa-plus" aria-hidden="true"></i> New draft</button></div>
      <p class="account-page__viewed-status" data-drafts-status role="status" aria-live="polite">Loading your drafts…</p>
      <ul data-drafts-list></ul>
      <p class="account-page__blocks-note">Drafts are stored in your AT Protocol account as <code>cc.coffeencode.author.draft</code> records and sync automatically while you write. Published posts appear too — editing one creates a draft copy of it.</p>
    </section>
    <section class="account-card account-page__viewed" data-draft-gate hidden aria-labelledby="draft-gate-title">
      <h2 id="draft-gate-title">Drafts</h2>
      <p class="account-page__viewed-status">Author tools appear here once you have published a story on Coffee &amp; Code. <a href="/become-an-author">Learn how to become an author</a>.</p>
    </section>`;
  const body = accountPageShell('Drafts', main, { signedOutMessage: 'Sign in to write and manage your drafts.' });
  return c.html(renderLayout(c, 'Drafts', `${draftEditorStyles}${body}`, '<meta name="robots" content="noindex">'));
});

pages.get('/account/author/draft/:rkey', (c) => {
  const rkey = c.req.param('rkey');
  if (!/^[a-zA-Z0-9._~:-]{1,512}$/.test(rkey)) {
    return c.html(renderLayout(c, 'Draft not found', '<section class="not-found"><h1>Draft not found</h1><p>This draft link is invalid.</p><a href="/account/author/draft" class="read-link">Back to drafts <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></section>'), 404);
  }
  const inner = `
    <section class="draft-editor-page" data-draft-editor data-draft-rkey="${escapeHtml(rkey)}" aria-labelledby="draft-editor-title">
      <input type="checkbox" id="draft-preview-toggle" class="draft-preview-toggle" aria-hidden="true" tabindex="-1">
      <div class="draft-editor-page__bar">
        <a class="read-link" href="/account/author/draft"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> All drafts</a>
        <label class="draft-preview-toggle__btn" for="draft-preview-toggle"><i class="fa-solid fa-eye" aria-hidden="true"></i> Preview</label>
        <span class="draft-editor-page__status" data-draft-status role="status" aria-live="polite">Loading draft…</span>
        <a class="read-link" data-draft-published-link hidden target="_blank" rel="noopener">Published <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
        <div class="draft-editor-page__actions">
          <button type="button" class="auth-signout" data-draft-import><i class="fa-solid fa-file-import" aria-hidden="true"></i> Import</button>
          <input type="file" data-draft-import-file accept=".md,.markdown,.mdx,.docx,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden>
          <button type="button" class="auth-signout" data-draft-settings aria-expanded="false"><i class="fa-solid fa-gear" aria-hidden="true"></i> Settings</button>
          <button type="button" class="auth-signout" data-draft-delete><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>
          <button type="button" class="auth-signout" data-draft-save><i class="fa-solid fa-check" aria-hidden="true"></i> Save</button>
          <button type="button" class="auth-signout" data-draft-publish><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Publish</button>
        </div>
      </div>
      <h1 id="draft-editor-title" class="visually-hidden">Edit draft</h1>
      <div class="draft-editor__grid" data-draft-workspace hidden>
        <div class="draft-toolbar" role="toolbar" aria-label="Formatting" data-draft-toolbar>
            <button type="button" data-cmd="bold" title="Bold" aria-label="Bold"><i class="fa-solid fa-bold" aria-hidden="true"></i></button>
            <button type="button" data-cmd="italic" title="Italic" aria-label="Italic"><i class="fa-solid fa-italic" aria-hidden="true"></i></button>
            <button type="button" data-cmd="underline" title="Underline" aria-label="Underline"><i class="fa-solid fa-underline" aria-hidden="true"></i></button>
            <button type="button" data-cmd="strikeThrough" title="Strikethrough" aria-label="Strikethrough"><i class="fa-solid fa-strikethrough" aria-hidden="true"></i></button>
            <button type="button" data-cmd="inlineCode" title="Inline code" aria-label="Inline code"><i class="fa-solid fa-code" aria-hidden="true"></i></button>
            <button type="button" data-cmd="link" title="Link" aria-label="Link"><i class="fa-solid fa-link" aria-hidden="true"></i></button>
            <span class="draft-toolbar__sep" aria-hidden="true"></span>
            <button type="button" data-block="text" title="Paragraph" aria-label="Paragraph"><i class="fa-solid fa-paragraph" aria-hidden="true"></i></button>
            <button type="button" data-block="header:1" title="Heading 1" aria-label="Heading 1">H1</button>
            <button type="button" data-block="header:2" title="Heading 2" aria-label="Heading 2">H2</button>
            <button type="button" data-block="header:3" title="Heading 3" aria-label="Heading 3">H3</button>
            <button type="button" data-block="blockquote" title="Quote" aria-label="Quote"><i class="fa-solid fa-quote-left" aria-hidden="true"></i></button>
            <button type="button" data-block="code" title="Code block" aria-label="Code block"><i class="fa-solid fa-file-code" aria-hidden="true"></i></button>
            <button type="button" data-block="unorderedList" title="Bulleted list" aria-label="Bulleted list"><i class="fa-solid fa-list-ul" aria-hidden="true"></i></button>
            <button type="button" data-block="orderedList" title="Numbered list" aria-label="Numbered list"><i class="fa-solid fa-list-ol" aria-hidden="true"></i></button>
            <span class="draft-toolbar__sep" aria-hidden="true"></span>
            <button type="button" data-block="horizontalRule" title="Divider" aria-label="Divider"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
            <button type="button" data-block="image" title="Image" aria-label="Image"><i class="fa-solid fa-image" aria-hidden="true"></i></button>
            <button type="button" data-block="video" title="Video" aria-label="Video"><i class="fa-solid fa-film" aria-hidden="true"></i></button>
            <button type="button" data-block="embed" title="Website embed" aria-label="Embed a website"><i class="fa-solid fa-window-restore" aria-hidden="true"></i></button>
            <button type="button" data-block="button" title="Button" aria-label="Button"><i class="fa-solid fa-square-check" aria-hidden="true"></i></button>
            <button type="button" data-block="website" title="Link card" aria-label="Link card"><i class="fa-solid fa-globe" aria-hidden="true"></i></button>
            <button type="button" data-block="bskyPost" title="Bluesky post" aria-label="Bluesky post"><i class="fa-brands fa-bluesky" aria-hidden="true"></i></button>
            <button type="button" data-block="math" title="Math" aria-label="Math">&#8721;</button>
            <button type="button" data-spellcheck title="Spell &amp; grammar check" aria-label="Spell and grammar check" aria-pressed="true"><i class="fa-solid fa-spell-check" aria-hidden="true"></i></button>
            <span class="draft-toolbar__sep" aria-hidden="true"></span>
            <button type="button" data-align="#textAlignLeft" title="Align left" aria-label="Align left"><i class="fa-solid fa-align-left" aria-hidden="true"></i></button>
            <button type="button" data-align="#textAlignCenter" title="Align center" aria-label="Align center"><i class="fa-solid fa-align-center" aria-hidden="true"></i></button>
            <button type="button" data-align="#textAlignRight" title="Align right" aria-label="Align right"><i class="fa-solid fa-align-right" aria-hidden="true"></i></button>
            <button type="button" data-align="#textAlignJustify" title="Justify" aria-label="Justify"><i class="fa-solid fa-align-justify" aria-hidden="true"></i></button>
          </div>
        <div class="draft-editor__meta">
          <details class="draft-editor__doc-settings" data-draft-settings-panel>
            <summary hidden>Document settings — tags, cover &amp; sources</summary>
            <div class="draft-editor__doc-body">
              <div class="draft-editor__meta-grid">
                <label>Tags<input name="draft-tags" placeholder="coffee, code, …" data-draft-field="tags"></label>
                <label>Publication<select name="draft-publication" data-draft-field="publication"><option value="" disabled selected>Loading publications…</option></select></label>
                <label>Cover image<input name="draft-cover" type="file" accept="image/*" data-draft-field="cover"></label>
                <label class="account-author-form__check draft-editor__meta-check"><input name="draft-cover-remove" type="checkbox" data-draft-field="coverRemove"> Remove current cover</label>
              </div>
              <section class="draft-editor__meta-sources" aria-labelledby="draft-sources-heading">
                <h2 id="draft-sources-heading"><i class="fa-solid fa-book-open" aria-hidden="true"></i> Sources</h2>
                <p class="draft-editor__meta-hint">These become the sources card shown alongside your published story.</p>
                <label>Source links — one URL per line<textarea name="draft-sources" rows="3" placeholder="https://example.com/article" data-draft-field="sources"></textarea></label>
                <label>Source document — URL or at:// URI (optional)<input name="draft-backlink" type="text" placeholder="https://docs.google.com/… or at://did:plc:…" data-draft-field="backlink"></label>
              </section>
            </div>
          </details>
          <div class="draft-editor__sheet">
            <input class="draft-editor__meta-title" name="draft-title" type="text" maxlength="5000" placeholder="Untitled story" aria-label="Title" spellcheck="true" data-draft-field="title">
            <textarea class="draft-editor__meta-description" name="draft-description" rows="2" maxlength="30000" placeholder="Add a short description…" aria-label="Description" spellcheck="true" data-draft-field="description"></textarea>
            <div class="draft-blocks" data-draft-blocks></div>
          </div>
        </div>
        <article class="draft-preview" data-draft-preview aria-label="Draft preview"></article>
      </div>
      <section class="account-card account-page__viewed" data-draft-gate hidden aria-labelledby="draft-gate-title">
        <h2 id="draft-gate-title">Drafts</h2>
        <p class="account-page__viewed-status">Author tools appear here once you have published a story on Coffee &amp; Code. <a href="/become-an-author">Learn how to become an author</a>.</p>
      </section>
      <dialog class="draft-publish-dialog" data-draft-publish-dialog aria-labelledby="draft-publish-dialog-title">
        <div class="draft-publish-dialog__card">
          <h1 id="draft-publish-dialog-title">Publish post</h1>
          <p class="draft-publish-dialog__intro">Publishing this post will publish it as a record on your account, and it will be shown on the Coffee &amp; Code home page.</p>
          <div class="draft-share-card" data-draft-publish-preview></div>
          <div class="draft-publish-dialog__actions">
            <button type="button" class="account-author-form__cancel" data-draft-publish-cancel>Cancel</button>
            <button type="button" class="auth-signout" data-draft-publish-confirm><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Publish</button>
          </div>
        </div>
      </dialog>
    </section>`;
  const body = accountPageShell('Edit draft', inner, { signedOutMessage: 'Sign in to edit this draft.', hideSidebar: true });
  return c.html(renderLayout(c, 'Edit draft', `${draftEditorStyles}${body}`, '<meta name="robots" content="noindex">'));
});

pages.get('/become-an-author', (c) => {
  const body = `
    <section class="author-invitation" aria-labelledby="author-invitation-title">
      <h1 id="author-invitation-title">Become an author</h1>
      <p class="author-invitation__intro">Have something you’d like to publish? DM me on <a href="${externalLinkUrl('https://bsky.app/profile/did:plc:l37td5yhxl2irrzrgvei4qay')}" target="_blank" rel="noopener noreferrer">Bluesky</a> with your document and a link to the publication. I’ll review it, and if it’s a good fit for Coffee &amp; Code, I’ll link to your publication.</p>
      <ol class="author-invitation__steps">
        <li>
          <h2>Create your publication</h2>
          <p>Sign in to <a href="${externalLinkUrl('https://leaflet.pub/')}" target="_blank" rel="noopener noreferrer">Leaflet</a> and create a publication with your account. This keeps your stories published under your account and attributed to you. Meaning you control everything.</p>
        </li>
        <li>
          <h2>Send me your post</h2>
          <p><a href="${externalLinkUrl('https://bsky.app/profile/did:plc:l37td5yhxl2irrzrgvei4qay')}" target="_blank" rel="noopener noreferrer">DM me on Bluesky</a> with a link to the <b>view link</b> to the post you want to publish. I’ll review it and let you know if it’s a good fit for Coffee &amp; Code.</p>
        </li>
        <li>
          <h2>Publish your stories</h2>
          <p>Once I have added your publication, publish stories to it through Leaflet. Stories in that publication can appear on <a href="/">coffeencode.cc</a> with your author profile.</p>
        </li>
      </ol>
    </section>
  `;

  const metaTags = `
    <meta name="description" content="Submit your work to Coffee &amp; Code by DMing your document and publication link for review.">
  `;
  return c.html(renderLayout(c, 'Become an Author', body, metaTags));
});

function formatDate(date?: string) {
  if (typeof date !== 'string' || !date) return '';
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function excerpt(post: Pick<StandardDocument, 'description'> & { content?: string }) {
  const text = descriptionText(
    typeof post.description === 'string' ? post.description : '',
    typeof post.content === 'string' ? post.content : '',
  );
  if (!text) return '';
  return text.length > 150 ? `${text.substring(0, 150).trimEnd()}…` : text;
}

pages.get('/authors', async (c) => {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const allPosts = await fetchArticles(pds, c.env.OWNER_DID);
  const authors = new Map<string, { author: NonNullable<StandardDocument['author']>; postCount: number }>();

  allPosts.forEach((post) => {
    if (!post.author) return;
    const key = post.author.handle.toLowerCase();
    const existing = authors.get(key);
    if (existing) {
      existing.postCount += 1;
    } else {
      authors.set(key, { author: post.author, postCount: 1 });
    }
  });

  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const origin = new URL(c.req.url).origin;
  const authorItems = [...authors.values()]
    .sort((a, b) => (a.author.displayName || a.author.handle).localeCompare(b.author.displayName || b.author.handle))
    .map(({ author, postCount }) => {
      const name = author.displayName || author.handle;
      const avatar = author.avatar ? proxyAvatarUrl(author.avatar) : '';
      return `<a class="author-card" href="/author/${encodeURIComponent(author.handle)}">
        ${avatar ? `<img src="${avatar}" alt="" class="author-card__avatar" width="64" height="64" loading="lazy" decoding="async">` : '<span class="author-card__avatar author-card__avatar--placeholder" aria-hidden="true"></span>'}
        <span class="author-card__details"><strong data-author-verification-did="${escapeHtml(author.did)}">${escapeHtml(name)}</strong><span>@${escapeHtml(author.handle)}</span><span>${postCount} ${postCount === 1 ? 'story' : 'stories'}</span></span>
      </a>`;
    })
    .join('');

  const body = `
    <section class="authors-page" aria-labelledby="authors-title">
      <header class="authors-page__header">
        <h1 id="authors-title">Authors</h1>
      </header>
      ${authorItems ? `<div class="author-grid">${authorItems}</div>` : '<p class="empty-state">No authors have published stories yet.</p>'}
      <p class="authors-page__invitation"><a class="read-link" href="/become-an-author">Become an author <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></p>
    </section>
  `;

  return c.html(renderLayout(c, 'Authors', body));
});

pages.get('/tags', async (c) => {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const allPosts = await fetchArticles(pds, c.env.OWNER_DID);
  const selectedTag = (c.req.query('tag') || '').trim();
  const tagQuery = (c.req.query('q') || '').trim().toLocaleLowerCase();
  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const tagCounts = new Map<string, { label: string; count: number }>();
  allPosts.forEach((post) => {
    const postTags = new Set((post.tags || []).map((tag) => tag.toLocaleLowerCase()));
    postTags.forEach((key) => {
      const label = (post.tags || []).find((tag) => tag.toLocaleLowerCase() === key) || key;
      const existing = tagCounts.get(key);
      tagCounts.set(key, { label: existing?.label || label, count: (existing?.count || 0) + 1 });
    });
  });
  const tags = [...tagCounts.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .filter(({ label }) => !tagQuery || label.toLocaleLowerCase().includes(tagQuery))
    .sort((a, b) => a.label.localeCompare(b.label));
  const selectedTagKey = selectedTag.toLocaleLowerCase();
  const matchingPosts = selectedTag
    ? allPosts.filter((post) => post.tags?.some((tag) => tag.toLocaleLowerCase() === selectedTagKey))
    : [];
  const tagLinks = tags.map(({ label, count }) => `
    <a class="tag-directory__item${selectedTagKey === label.toLocaleLowerCase() ? ' is-selected' : ''}" href="/tags?tag=${encodeURIComponent(label)}">
      <span>${escapeHtml(label)}</span><span>${count} ${count === 1 ? 'post' : 'posts'}</span>
    </a>`).join('');
  const postItems = renderArchiveStories(matchingPosts, pds, new URL(c.req.url).origin);
  const body = `
    <section class="tags-page" aria-labelledby="tags-title">
      <h1 id="tags-title">Browse by tag</h1>
      <p class="tags-page__intro">Find stories by the topics they cover.</p>
      <form class="tags-search" action="/tags" method="get">
        ${selectedTag ? `<input type="hidden" name="tag" value="${escapeHtml(selectedTag)}">` : ''}
        <label for="tag-search">Search tags</label>
        <input id="tag-search" type="search" name="q" value="${escapeHtml(c.req.query('q') || '')}" placeholder="For example, Apple or MacBook">
        <button type="submit" class="search-button">Search tags</button>
      </form>
      ${tagLinks ? `<nav class="tag-directory" aria-label="Available tags">${tagLinks}</nav>` : '<p class="empty-state">No tags match your search.</p>'}
      ${selectedTag ? `<section class="tag-results" aria-labelledby="tag-results-title"><div class="section-heading"><span id="tag-results-title">Posts tagged “${escapeHtml(selectedTag)}”</span><span>${matchingPosts.length}</span></div><div class="tag-follow" data-tag-follow data-tag="${escapeHtml(selectedTagKey)}"><button type="button" class="author-follow__button" data-tag-follow-button>Follow tag</button><span class="author-follow__status" data-tag-follow-status role="status" aria-live="polite"></span></div>${postItems ? `<div class="archive-grid">${postItems}</div>` : '<p class="empty-state">No posts use this tag.</p>'}</section>` : ''}
    </section>
  `;
  return c.html(renderLayout(c, 'Browse by Tag', body, '', 'Browse by Tag | Coffee & Code'));
});

pages.get('/author/:handle', async (c) => {
  const identifier = c.req.param('handle');
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const allPosts = await fetchArticles(pds, c.env.OWNER_DID);
  const authorPosts = allPosts.filter((post) => post.author?.did.toLowerCase() === identifier.toLowerCase()
    || post.author?.handle.toLowerCase() === identifier.toLowerCase());
  const author = authorPosts[0]?.author;
  const publicationUri = authorPosts.find((post) => post.publicationUri)?.publicationUri;

  if (!author) {
    return c.html(renderLayout(c, 'Author Not Found', '<section class="not-found"><h1>Author not found</h1><p>This author has not published in this publication.</p><a href="/archive" class="read-link">Browse archive <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></section>'), 404);
  }

  const authorCanonicalPath = `/author/${encodeURIComponent(author.handle)}`;
  const currentUrl = new URL(c.req.url);
  if (currentUrl.pathname !== authorCanonicalPath) {
    return c.redirect(`${authorCanonicalPath}${currentUrl.search}`, 301);
  }

  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const authorName = author.displayName || author.handle;
  const authorAvatar = author.avatar ? proxyAvatarUrl(author.avatar) : '';
  const authorBanner = author.banner ? proxyImageUrl(author.banner, pds, 'banner_large') : '';
  const archiveItems = renderArchiveStories(authorPosts, pds, new URL(c.req.url).origin);
  const pinnedPosts = new Set(author.pinnedPosts || []);
  const pinnedArticles = authorPosts.filter((post) => pinnedPosts.has(post.uri));
  const pinnedItems = pinnedArticles
    .map((post) => `
      <article class="author-pinned-card${post.cover ? '' : ' author-pinned-card--no-cover'}">
        ${post.cover ? `<a class="author-pinned-card__image" href="${escapeHtml(post.path)}" aria-label="Read ${escapeHtml(post.title || 'Untitled')}">
          <img src="${escapeHtml(proxyImageUrl(post.cover, pds, 'feed_small'))}" alt="" width="800" height="450" loading="lazy" decoding="async">
        </a>` : ''}
        <div class="author-pinned-card__content">
          <p class="eyebrow">${formatDate(post.publishedAt)}</p>
          <h3><a href="${escapeHtml(post.path)}">${escapeHtml(post.title || 'Untitled')}</a></h3>
          ${excerpt(post) ? `<p>${escapeHtml(excerpt(post))}</p>` : ''}
        </div>
      </article>`)
    .join('');
  const body = `
    <section class="author-page" aria-labelledby="author-title">
      ${authorBanner ? `<img src="${escapeHtml(authorBanner)}" alt="" class="author-page__banner" width="1200" height="400" decoding="async">` : ''}
      <header class="author-page__header">
        ${authorAvatar ? `<img src="${authorAvatar}" alt="" class="author-page__avatar" width="88" height="88" decoding="async">` : ''}
        <div><h1 id="author-title" data-author-verification-did="${escapeHtml(author.did)}">${escapeHtml(authorName)}</h1><p>@${escapeHtml(author.handle)}${author.pronouns ? ` · ${escapeHtml(author.pronouns)}` : ''}</p></div>
      </header>
      <div class="author-follow" ${publicationUri ? `data-author-follow data-author-did="${escapeHtml(author.did)}" data-publication-uri="${escapeHtml(publicationUri)}"` : ''}>
        <a class="author-page__profile-link" href="/user/${encodeURIComponent(author.handle)}">View user profile <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
        <button type="button" class="author-follow__button" data-block-user-did="${escapeHtml(author.did)}" data-block-user-name="${escapeHtml(authorName)}" hidden disabled>Block user</button>
        <button type="button" class="author-follow__button" data-author-follow-button${publicationUri ? '' : ' disabled'}>Follow</button>
        <span class="author-follow__status" data-author-follow-status role="status" aria-live="polite">${publicationUri ? '' : 'Following is unavailable for this author.'}</span>
      </div>
      ${author.description ? `<p class="author-page__description">${escapeHtml(author.description)}</p>` : ''}
      ${pinnedItems ? `<section class="author-page__pinned" aria-labelledby="author-pinned-title"><div class="section-heading"><span id="author-pinned-title">Pinned posts</span><span>${pinnedArticles.length}</span></div><div class="author-page__pinned-grid">${pinnedItems}</div></section>` : ''}
      <div class="section-heading"><span>Stories</span><span>${authorPosts.length}</span></div>
      <div class="archive-grid">${archiveItems}</div>
    </section>
  `;

  const pageUrl = new URL(c.req.url).toString();
  const metaTags = `
    <meta property="og:title" content="${escapeHtml(authorName)} | Coffee and Code.">
    <meta property="og:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta property="og:type" content="profile">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <meta property="og:image" content="${escapeHtml(browserRenderOgImage(c))}">
    <meta property="og:image:type" content="image/png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(authorName)} | Coffee and Code.">
    <meta name="twitter:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta name="twitter:image" content="${escapeHtml(browserRenderOgImage(c))}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  return c.html(renderLayout(c, authorName, body, metaTags));
});

pages.get('/archive', async (c) => {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const nextCursors: NonNullable<ArticlePagination['nextCursors']> = {};
  const allPosts = await fetchArticles(pds, c.env.OWNER_DID, { nextCursors });
  const query = (c.req.query('q') || '').trim();
  const authorFilter = c.req.query('author') || '';
  const yearFilter = c.req.query('year') || '';
  const sort = c.req.query('sort') === 'oldest' ? 'oldest' : 'newest';
  const imageOnly = c.req.query('image') === '1';
  const filters: ArchiveFilters = {
    q: query,
    author: authorFilter,
    year: yearFilter,
    sort,
    image: imageOnly,
  };
  const authorOptions = [...new Map(allPosts
    .filter((post) => post.author && typeof post.author.did === 'string')
    .map((post): [string, string] => [post.author!.did, String(post.author!.displayName || post.author!.handle || post.author!.did)]))]
    .map(([did, label]) => ({ did, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const yearOptions = [...new Set(allPosts
    .map((post) => typeof post.publishedAt === 'string' ? new Date(post.publishedAt).getFullYear() : NaN)
    .filter(Number.isFinite))]
    .sort((a, b) => b - a);
  const searchedPosts = query ? searchArticles(allPosts, query) : allPosts;
  const filteredPosts = searchedPosts.filter((post) => {
    if (authorFilter && post.author?.did !== authorFilter) return false;
    if (yearFilter && String(new Date(post.publishedAt).getFullYear()) !== yearFilter) return false;
    if (imageOnly && !post.cover) return false;
    return true;
  });
  const posts = [...filteredPosts].sort((a, b) => {
    const difference = (Date.parse(a.publishedAt) || 0) - (Date.parse(b.publishedAt) || 0);
    return sort === 'oldest' ? difference : -difference;
  });
  const archiveBaseUrl = new URL(c.req.url).origin;

  const archiveItems = renderArchiveStories(posts.map((post) => ({
    ...post,
  })), pds, archiveBaseUrl);
  const hasMore = Object.values(nextCursors).some((cursor) => typeof cursor === 'string' && cursor.length > 0);

  const searchForm = renderSearchBar({
    action: '/archive',
    label: 'Search stories',
    placeholder: 'Search stories by title, author, or keyword',
    query,
    className: 'archive-search-bar',
    selects: [
      {
        name: 'author',
        label: 'Author',
        value: authorFilter,
        options: [{ value: '', label: 'All' }, ...authorOptions.map(({ did, label }) => ({ value: did, label }))],
      },
      {
        name: 'year',
        label: 'Year',
        value: yearFilter,
        options: [{ value: '', label: 'Any' }, ...yearOptions.map((year) => ({ value: String(year), label: String(year) }))],
      },
      {
        name: 'sort',
        label: 'Order',
        value: sort,
        defaultValue: 'newest',
        options: [{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }],
      },
    ],
    toggles: [{ name: 'image', label: 'With images', value: '1', checked: imageOnly }],
  });

  const emptyMessage = allPosts.length ? 'No stories match these search filters.' : 'No stories have been published yet.';
  const gridOrEmpty = `<div class="archive-grid" data-archive-grid>${archiveItems}</div><p class="empty-state"${archiveItems ? ' hidden' : ''} data-archive-empty>${emptyMessage}</p>`;

  const body = `
    <section class="archive-page" aria-labelledby="archive-title" data-archive-pagination data-archive-cursor="${escapeHtml(JSON.stringify({ cursors: nextCursors, pending: [], filterKey: archiveFilterKey(filters) }))}">
      ${searchForm}
      <div class="section-heading"><span id="archive-title">Archive</span><span data-archive-count data-loaded-count="${posts.length}">${posts.length} ${posts.length === 1 ? 'story' : 'stories'} loaded</span></div>
      ${gridOrEmpty}
      <div class="archive-load-more"${hasMore ? '' : ' hidden'}>
        <button type="button" class="search-button archive-load-more__button" data-archive-load-more>Load 30 more stories</button>
        <p data-archive-load-status role="status" aria-live="polite"></p>
      </div>
    </section>
  `;

  const pageUrl = new URL(c.req.url).toString();
  const metaTags = `
    <meta property="og:title" content="Coffee and Code.">
    <meta property="og:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="Coffee and Code.">
    <meta name="twitter:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  return c.html(renderLayout(c, 'Archive', body, metaTags));
});

const COFFEE_FEED_URI = 'at://did:plc:z7hzwpuv5ytin56wecfxa4mx/app.bsky.feed.generator/following';
const isFeedPostUri = (uri: unknown): uri is string => typeof uri === 'string'
  && /^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/app\.bsky\.feed\.post\/[a-zA-Z0-9._~:-]+$/.test(uri);

async function hydrateFeedPosts(uris: string[], pinnedUris = new Set<string>()) {
  if (!uris.length) return [];
  const postsUrl = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts');
  uris.forEach((uri) => postsUrl.searchParams.append('uris', uri));
  const postsResponse = await fetch(postsUrl, { headers: { Accept: 'application/json' } });
  if (!postsResponse.ok) throw new Error(`Bluesky AppView returned ${postsResponse.status}`);
  const postPayload = await postsResponse.json() as { posts?: Array<Record<string, any>> };
  const postsByUri = new Map<string, Record<string, any>>((postPayload.posts || []).map((post) => [String(post.uri), post] as const));
  return uris.flatMap((uri) => {
    const post = postsByUri.get(uri);
    if (!post || typeof post.record?.text !== 'string') return [];
    const embed = post.embed;
    const images = Array.isArray(embed?.images) ? embed.images : Array.isArray(embed?.media?.images) ? embed.media.images : [];
    return [{
      uri,
      url: `https://bsky.app/profile/${encodeURIComponent(post.author?.handle || post.author?.did || '')}/post/${encodeURIComponent(uri.split('/').pop() || '')}`,
      author: {
        name: typeof post.author?.displayName === 'string' && post.author.displayName ? post.author.displayName : String(post.author?.handle || 'Bluesky user'),
        handle: String(post.author?.handle || ''),
        avatar: typeof post.author?.avatar === 'string' && post.author.avatar.startsWith('https://')
          ? proxyAvatarUrl(post.author.avatar, 'avatar_thumb')
          : '',
      },
      text: post.record.text.slice(0, 10000),
      createdAt: typeof post.record.createdAt === 'string' ? post.record.createdAt : '',
      reason: pinnedUris.has(uri) ? 'Pinned by Coffee & Code' : '',
      images: images.slice(0, 4).flatMap((image: Record<string, any>) => {
        const url = typeof image.thumb === 'string' ? image.thumb : typeof image.fullsize === 'string' ? image.fullsize : '';
        return url.startsWith('https://') ? [{ url, alt: typeof image.alt === 'string' ? image.alt.slice(0, 500) : '' }] : [];
      }),
    }];
  });
}

pages.post('/api/feed/posts', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid feed request.' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return c.json({ error: 'Invalid feed request.' }, 400);
  const request = payload as Record<string, unknown>;
  if (!Array.isArray(request.uris) || request.uris.length > 20 || !request.uris.every(isFeedPostUri)) {
    return c.json({ error: 'Invalid feed post list.' }, 400);
  }
  const uris = [...new Set(request.uris as string[])];
  const pinnedUris = Array.isArray(request.pinnedUris) && request.pinnedUris.length <= 20
    ? new Set(request.pinnedUris.filter(isFeedPostUri))
    : new Set<string>();
  try {
    const posts = await hydrateFeedPosts(uris, pinnedUris);
    return c.json({ posts }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Could not hydrate the Coffee & Code feed:', error);
    return c.json({ error: 'The feed is temporarily unavailable. Please try again shortly.' }, 502, { 'Cache-Control': 'no-store' });
  }
});

pages.get('/api/feed/posts', async (c) => {
  const cursor = c.req.query('cursor');
  if (cursor && (cursor.length > 512 || /[\r\n]/.test(cursor))) {
    return c.json({ error: 'Invalid feed cursor.' }, 400);
  }

  try {
    const skeletonUrl = new URL('https://feed.coffeencode.cc/xrpc/app.bsky.feed.getFeedSkeleton');
    skeletonUrl.searchParams.set('feed', COFFEE_FEED_URI);
    skeletonUrl.searchParams.set('limit', '20');
    if (cursor) skeletonUrl.searchParams.set('cursor', cursor);
    const skeletonResponse = await fetch(skeletonUrl, { headers: { Accept: 'application/json' } });
    if (!skeletonResponse.ok) throw new Error(`Feed service returned ${skeletonResponse.status}`);
    const skeleton = await skeletonResponse.json() as { cursor?: unknown; feed?: Array<{ post?: unknown; reason?: unknown }> };
    const items = Array.isArray(skeleton.feed) ? skeleton.feed : [];
    const uris = items.map((item) => item?.post).filter(isFeedPostUri).slice(0, 20);
    const pinnedUris = new Set(items.filter((item) => item?.reason).map((item) => item.post).filter(isFeedPostUri));
    const posts = await hydrateFeedPosts(uris, pinnedUris);
    return c.json({ posts, cursor: typeof skeleton.cursor === 'string' ? skeleton.cursor : null }, 200, { 'Cache-Control': 'public, max-age=30' });
  } catch (error) {
    console.error('Could not load the Coffee & Code feed:', error);
    return c.json({ error: 'The feed is temporarily unavailable. Please try again shortly.' }, 502, { 'Cache-Control': 'no-store' });
  }
});

pages.get('/feed', (c) => {
  const feedUrl = 'https://bsky.app/profile/did:plc:z7hzwpuv5ytin56wecfxa4mx/feed/following';
  const managerUrl = 'https://feed.coffeencode.cc/';
  const body = `
    <section class="feed-page" aria-labelledby="feed-title">
      <header class="feed-page__header">
        <h1 id="feed-title">A feed shaped by you.</h1>
        <p class="feed-page__intro">Keep up with the writers and people you choose. The Coffee &amp; Code feed brings their Bluesky posts together in one place, with controls for what appears in your timeline.</p>
        <div class="feed-page__actions">
          <a class="feed-page__primary" href="${feedUrl}" target="_blank" rel="noopener">Open the feed on Bluesky <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
          <a class="read-link" href="${managerUrl}" target="_blank" rel="noopener">Manage your feed <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
        </div>
      </header>
      <div class="section-heading"><span>Latest posts</span><span>From your Coffee &amp; Code feed</span></div>
      <p class="feed-page__status" data-feed-status role="status" aria-live="polite">Loading posts…</p>
      <div class="feed-page__posts" data-feed-posts></div>
      <button class="feed-page__more" type="button" data-feed-more hidden>Load more posts</button>
      <aside class="feed-page__note"><p>Your author list is stored in your AT Protocol account. Coffee &amp; Code reads it to build the feed you see.</p></aside>
    </section>
    <style>
      .feed-page { margin: 0 auto; max-width: 920px; }
      .feed-page__header { border-bottom: 1px solid var(--line); padding: 16px 0 42px; }
      .feed-page__header h1 { font-family: Lora, serif; font-size: clamp(2.7rem, 7vw, 5rem); letter-spacing: -.055em; line-height: 1.04; margin: 0; max-width: 760px; }
      .feed-page__intro { color: #e0d9c8; font-size: 20px; line-height: 1.65; margin: 20px 0 0; max-width: 720px; }
      .feed-page__actions { align-items: center; display: flex; flex-wrap: wrap; gap: 22px; margin-top: 28px; }
      .feed-page__primary { align-items: center; background: var(--accent); color: var(--paper); display: inline-flex; font-weight: 700; gap: 10px; min-height: 48px; padding: 11px 18px; text-decoration: none; }
      .feed-page__primary:hover { background: #d2cbb9; }
      .feed-page .section-heading { margin-top: 38px; }
      .feed-page__status { color: var(--muted); font-size: 16px; }
      .feed-page__post { border-bottom: 1px solid var(--line); padding: 23px 0; }
      .feed-page__post-header { align-items: center; display: flex; gap: 12px; }
      .feed-page__avatar { background: var(--paper-deep); border-radius: 50%; flex: 0 0 44px; height: 44px; object-fit: cover; width: 44px; }
      .feed-page__byline { display: grid; line-height: 1.3; min-width: 0; }
      .feed-page__byline strong { color: var(--ink); }
      .feed-page__byline span, .feed-page__byline time { color: var(--muted); font-size: 13px; }
      .feed-page__post-link { color: var(--muted); font-size: 13px; margin-left: auto; }
      .feed-page__post-text { color: #e0d9c8; font-size: 17px; line-height: 1.65; margin: 16px 0 0 56px; overflow-wrap: anywhere; white-space: pre-wrap; }
      .feed-page__images { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin: 14px 0 0 56px; }
      .feed-page__images img { aspect-ratio: 1.5; background: var(--paper-deep); height: 100%; max-height: 320px; object-fit: cover; width: 100%; }
      .feed-page__more { background: transparent; border: 1px solid var(--line-strong); color: var(--accent); cursor: pointer; font: inherit; font-weight: 700; margin-top: 22px; min-height: 46px; padding: 8px 16px; }
      .feed-page__more:hover { background: var(--paper-deep); }
      .feed-page__note p:last-child { color: var(--muted); font-size: 17px; line-height: 1.65; margin: 0; max-width: 700px; }
      .feed-page__note { background: var(--paper-deep); margin-top: 34px; padding: 22px 26px; }
      @media (max-width: 520px) { .feed-page__intro { font-size: 18px; }.feed-page__post-text, .feed-page__images { margin-left: 0; }.feed-page__note { padding: 18px; } }
    </style>
    <script type="module">
      (() => {
        const list = document.querySelector('[data-feed-posts]');
        const status = document.querySelector('[data-feed-status]');
        const more = document.querySelector('[data-feed-more]');
        if (!list || !status || !more) return;
        let cursor = null;
        let loading = false;
        const make = (tag, className, text) => {
          const element = document.createElement(tag);
          if (className) element.className = className;
          if (text) element.textContent = text;
          return element;
        };
        const load = async (append = false) => {
          if (loading) return;
          loading = true;
          more.disabled = true;
          status.textContent = append ? 'Loading more posts…' : 'Loading posts…';
          try {
            const auth = window.coffeeAndCodeAuth || await new Promise((resolve) => {
              window.addEventListener('coffee-and-code-auth-ready', () => resolve(window.coffeeAndCodeAuth), { once: true });
            });
            const viewerDid = await auth?.getDid();
            let response;
            let data;
            if (viewerDid) {
              const skeleton = await auth.getFeedSkeleton(append ? cursor : null);
              const items = Array.isArray(skeleton?.feed) ? skeleton.feed : [];
              response = await fetch('/api/feed/posts', {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  uris: items.map((item) => item.post),
                  pinnedUris: items.filter((item) => item.reason).map((item) => item.post),
                }),
              });
              data = { ...await response.json(), cursor: skeleton?.cursor || null };
            } else {
              const url = new URL('/api/feed/posts', window.location.origin);
              if (append && cursor) url.searchParams.set('cursor', cursor);
              response = await fetch(url, { headers: { Accept: 'application/json' } });
              data = await response.json();
            }
            if (!response.ok) throw new Error(data.error || 'The feed could not be loaded.');
            if (!append) list.replaceChildren();
            for (const post of data.posts || []) {
              const article = make('article', 'feed-page__post');
              const header = make('div', 'feed-page__post-header');
              if (post.author?.avatar) {
                const avatar = make('img', 'feed-page__avatar');
                avatar.src = post.author.avatar;
                avatar.alt = '';
                avatar.loading = 'lazy';
                header.append(avatar);
              }
              const byline = make('div', 'feed-page__byline');
              byline.append(make('strong', '', post.author?.name || 'Bluesky user'));
              if (post.author?.handle) byline.append(make('span', '', '@' + post.author.handle));
              if (post.createdAt && !Number.isNaN(Date.parse(post.createdAt))) {
                const time = make('time', '', new Date(post.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
                time.dateTime = post.createdAt;
                byline.append(time);
              }
              header.append(byline);
              const postLink = make('a', 'feed-page__post-link', 'View on Bluesky ↗');
              postLink.href = post.url;
              postLink.target = '_blank';
              postLink.rel = 'noopener';
              header.append(postLink);
              if (post.reason) article.append(make('p', 'eyebrow', post.reason));
              article.append(header);
              article.append(make('p', 'feed-page__post-text', post.text || ''));
              if (Array.isArray(post.images) && post.images.length) {
                const images = make('div', 'feed-page__images');
                for (const item of post.images) {
                  const image = make('img', '');
                  image.src = item.url;
                  image.alt = item.alt || '';
                  image.loading = 'lazy';
                  images.append(image);
                }
                article.append(images);
              }
              list.append(article);
            }
            cursor = data.cursor || null;
            more.hidden = !cursor || !(data.posts || []).length;
            status.textContent = list.children.length ? '' : viewerDid ? 'Your Coffee & Code feed has no posts yet. Add authors in the feed manager to get started.' : 'There are no public posts in the feed right now. Sign in to see your personalized feed.';
          } catch (error) {
            status.textContent = error instanceof Error ? error.message : 'The feed could not be loaded. Please try again.';
          } finally {
            loading = false;
            more.disabled = false;
          }
        };
        more.addEventListener('click', () => load(true));
        load();
      })();
    </script>
  `;
  const metaTags = '<meta name="description" content="Follow the writers and people you choose with the Coffee &amp; Code custom Bluesky feed.">';
  return c.html(renderLayout(c, 'Coffee & Code Feed', body, metaTags));
});

pages.get('/privacy', (c) => {
  const body = renderLegalDocument('privacy');

  const pageUrl = new URL(c.req.url).toString();
  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const metaTags = `
    <meta property="og:title" content="Coffee and Code.">
    <meta property="og:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="Coffee and Code.">
    <meta name="twitter:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  return c.html(renderLayout(c, 'Privacy policy', body, metaTags));
});

pages.get('/terms', (c) => {
  const body = renderLegalDocument('terms');

  const pageUrl = new URL(c.req.url).toString();
  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const metaTags = `
    <meta name="description" content="Terms for using Coffee &amp; Code and the Coffee &amp; Code Personal Data Server.">
    <meta property="og:title" content="Terms of service | Coffee and Code">
    <meta property="og:description" content="Terms for using Coffee &amp; Code and its hosted PDS.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  return c.html(renderLayout(c, 'Terms of service', body, metaTags));
});

// Unlinked landing page for the Android test build. Not in any nav or sitemap.
pages.get('/download', (c) => {
  const appVersion = '0.1';
  const apkUrl = 'https://storage.coffeencode.cc/download/mobile/CoffeeAndCode-android.apk';
  const body = `
    <section class="download-page" aria-labelledby="download-title">
      <p class="eyebrow">Coffee &amp; Code for Android</p>
      <h1 id="download-title">Get the app</h1>
      <p class="download-page__intro">The Coffee &amp; Code Android app is in testing. Download it to your device to try it out.</p>
      <a class="download-page__button" href="${apkUrl}">Download for Android</a>
      <p class="download-page__meta">Version ${appVersion} · This download takes you to storage.coffeencode.cc</p>
      <details class="download-page__help">
        <summary>How to install</summary>
        <ol>
          <li>Tap <strong>Download for Android</strong> above on your Android device. If the file ends up in Downloads without opening, find it in the Files app and tap it.</li>
          <li>Android will warn that installs from this source aren't allowed. Tap <strong>Settings</strong> in the prompt and enable <strong>Allow from this source</strong> for your browser or Files app, then go back.</li>
          <li>Tap <strong>Install</strong> on the package installer screen, then <strong>Open</strong>.</li>
          <li>If Google Play Protect shows a warning about an unrecognized app, choose <strong>More details → Install anyway</strong>. This is expected for test builds installed outside the Play Store — the app is signed by us.</li>
          <li>The app works without an account for reading; sign in with your AT Protocol (Bluesky-compatible) handle for likes, comments, and notifications.</li>
        </ol>
        <p><strong>Updating:</strong> there's no auto-updater yet — when a new version is announced, download the latest build here and install it over the top. Your data and sign-in carry over.</p>
        <p><strong>Transferring from a computer:</strong> if you downloaded on a desktop, move the file to your phone with a USB cable, Nearby Share, or by emailing it to yourself, then open it from Files.</p>
        <p>Spotted a bug? <a href="https://userinput.app/s/did:plc:l37td5yhxl2irrzrgvei4qay/3mxrdfzksld24" target="_blank" rel="noopener">Leave feedback</a>.</p>
      </details>
    </section>
    <style>
      .download-page { margin: 0 auto; max-width: 640px; padding-top: 48px; text-align: center; }
      .download-page .eyebrow { color: var(--accent); font-size: 13px; font-weight: 700; letter-spacing: .1em; margin: 0 0 14px; text-transform: uppercase; }
      .download-page h1 { font-family: Lora, serif; font-size: clamp(2.6rem, 7vw, 4.4rem); letter-spacing: -.045em; line-height: 1.05; margin: 0; }
      .download-page__intro { color: var(--muted); font-size: 18px; line-height: 1.55; margin: 22px auto 34px; max-width: 480px; }
      .download-page__button { background: var(--accent); border-radius: 6px; color: var(--paper); display: inline-block; font-size: 15px; font-weight: 700; letter-spacing: .06em; padding: 16px 36px; text-transform: uppercase; }
      .download-page__button:hover { color: var(--paper); filter: brightness(1.1); }
      .download-page__meta { color: var(--muted); font-size: 13px; margin: 14px 0 40px; }
      .download-page__help { border-top: 1px solid var(--line); color: var(--muted); font-size: 15px; line-height: 1.6; padding-top: 24px; text-align: left; }
      .download-page__help summary { color: var(--ink); cursor: pointer; font-weight: 600; }
      .download-page__help ol { margin: 14px 0; padding-left: 22px; }
      .download-page__help li { margin: 6px 0; }
      .download-page__help a { color: var(--accent); }
    </style>
  `;
  const pageUrl = new URL(c.req.url).toString();
  const metaTags = `
    <meta name="description" content="Download the Coffee &amp; Code Android app.">
    <meta name="robots" content="noindex">
    <meta property="og:title" content="Coffee &amp; Code for Android">
    <meta property="og:description" content="Download the Coffee &amp; Code Android app.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${pageUrl}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="Coffee &amp; Code for Android">
    <meta name="twitter:description" content="Download the Coffee &amp; Code Android app.">
    <link rel="canonical" href="${pageUrl}">
  `;
  return c.html(renderLayout(c, 'Coffee & Code for Android', body, metaTags));
});

type DocsSection = { key: string; label: string; icon: string; docs: DocEntry[] };

/** Groups docs by their frontmatter `section` (defaulting to the parent folder). */
function groupDocsBySection(docs: DocEntry[]): DocsSection[] {
  const sections = new Map<string, DocsSection>();
  for (const doc of docs) {
    const key = doc.section.toLocaleLowerCase();
    const section = sections.get(key) || { key, label: doc.section, icon: '', docs: [] };
    section.docs.push(doc);
    if (!section.icon && doc.sectionIcon) section.icon = doc.sectionIcon;
    sections.set(key, section);
  }
  for (const section of sections.values()) {
    if (!section.icon) section.icon = docsSectionIcon(section.label);
  }
  return [...sections.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Picks a sidebar icon for a docs section, atproto.com-style. */
function docsSectionIcon(label: string): string {
  const key = label.toLocaleLowerCase();
  if (key.includes('service') || key.includes('api')) return 'fa-solid fa-server';
  if (key.includes('guide') || key.includes('start')) return 'fa-solid fa-rocket';
  if (key.includes('deploy') || key.includes('host')) return 'fa-solid fa-cloud-arrow-up';
  if (key.includes('reference')) return 'fa-solid fa-book';
  if (key.includes('sdk')) return 'fa-solid fa-code';
  return 'fa-solid fa-folder-open';
}

function renderDocsSidebar(sections: DocsSection[], activeSlug?: string): string {
  const groups = sections.map((section) => {
    const hasActive = section.docs.some((doc) => doc.slug === activeSlug);
    return `
    <details class="docs-nav__section"${hasActive || !activeSlug ? ' open' : ''}>
      <summary><i class="${escapeHtml(section.icon)} docs-nav__icon" aria-hidden="true"></i><span>${escapeHtml(section.label)}</span><i class="fa-solid fa-chevron-right docs-nav__chevron" aria-hidden="true"></i></summary>
      <ul>${section.docs.map((doc) => `
        <li><a href="/docs/${encodeURIComponent(doc.slug)}"${doc.slug === activeSlug ? ' class="is-active" aria-current="page"' : ''}>${doc.icon ? `<i class="${escapeHtml(doc.icon)} docs-nav__item-icon" aria-hidden="true"></i>` : ''}${escapeHtml(doc.title)}</a></li>`).join('')}
      </ul>
    </details>`;
  }).join('');
  return `
    <nav class="docs-nav" aria-label="Documentation sections">
      <a class="docs-nav__home" href="/docs"${!activeSlug ? ' class="is-active" aria-current="page"' : ''}><i class="fa-solid fa-book-open" aria-hidden="true"></i> Docs home</a>
      ${groups}
    </nav>`;
}

const docsPageStyles = `
  <style>
    .page-content:has(.docs-layout) { width: calc(100% - 48px); max-width: none; }
    .docs-layout { display: grid; gap: clamp(28px, 4vw, 64px); grid-template-columns: 260px minmax(0, 1fr) 220px; width: 100%; }
    .docs-layout--landing { grid-template-columns: 260px minmax(0, 1fr); }

    /* Sidebar — collapsible sections, atproto.com-style */
    .docs-nav { align-self: start; font-size: 14px; position: sticky; top: 96px; }
    .docs-nav__home { align-items: center; border-radius: 8px; color: var(--ink); display: flex; font-weight: 700; gap: 10px; margin-bottom: 14px; padding: 8px 10px; text-decoration: none; }
    .docs-nav__home:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
    .docs-nav__home.is-active { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
    .docs-nav__home i { color: var(--accent); }
    .docs-nav__section { border-top: 1px solid var(--line); padding: 8px 0; }
    .docs-nav__section summary { align-items: center; border-radius: 8px; color: var(--ink); cursor: pointer; display: flex; font-weight: 700; gap: 10px; list-style: none; padding: 8px 10px; user-select: none; }
    .docs-nav__section summary::-webkit-details-marker { display: none; }
    .docs-nav__section summary:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
    .docs-nav__icon { color: var(--muted); font-size: 13px; width: 16px; }
    .docs-nav__chevron { color: var(--muted); font-size: 11px; margin-left: auto; transition: transform .15s ease; }
    .docs-nav__section[open] .docs-nav__chevron { transform: rotate(90deg); }
    .docs-nav__section ul { list-style: none; margin: 4px 0 6px; padding: 0 0 0 12px; }
    .docs-nav__section li { margin: 1px 0; }
    .docs-nav__section ul a { border-radius: 6px; color: var(--muted); display: block; font-size: 14px; line-height: 1.35; padding: 6px 10px; text-decoration: none; }
    .docs-nav__item-icon { font-size: 12px; margin-right: 7px; opacity: .75; }
    .docs-nav__section ul a:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); }
    .docs-nav__section ul a.is-active { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); font-weight: 600; }

    /* Article column */
    .docs-article { min-width: 0; }
    .docs-article .prose, .docs-article .prose p, .docs-article .prose li,
    .docs-article .prose figure, .docs-article .prose-image-figure,
    .docs-article .prose pre, .docs-article .prose table { max-width: none; }
    .docs-article .prose img, .docs-article .prose-image, .docs-article .prose-image-figure img { max-width: 100% !important; }
    .docs-article__back { color: var(--accent); display: inline-block; font-size: 13px; font-weight: 700; letter-spacing: .05em; margin-bottom: 26px; text-transform: uppercase; }
    .docs-article__header { border-bottom: 1px solid var(--line); margin-bottom: 30px; padding-bottom: 22px; }
    .docs-article__header .eyebrow { color: var(--accent); font-size: 13px; letter-spacing: .1em; margin: 0 0 8px; }
    .docs-article__header h1 { font-family: Lora, serif; font-size: clamp(2rem, 4vw, 2.9rem); letter-spacing: -.035em; line-height: 1.1; margin: 0; }
    .docs-article__dek { color: var(--muted); font-size: 17px; line-height: 1.5; margin: 12px 0 0; }
    .docs-article__date { color: var(--muted); font-size: 13px; margin: 12px 0 0; }
    .docs-article .prose h2, .docs-article .prose h3 { scroll-margin-top: 96px; }
    .docs-article__footer { border-top: 1px solid var(--line); font-size: 14px; margin-top: 44px; padding-top: 18px; text-align: right; }
    .docs-article__footer a { color: var(--accent); }
    .docs-pagenav { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; margin-top: 40px; }
    .docs-pagenav a { border: 1px solid var(--line); border-radius: 10px; color: var(--ink); display: block; padding: 14px 16px; text-decoration: none; }
    .docs-pagenav a:hover { border-color: var(--accent); }
    .docs-pagenav span { color: var(--muted); display: block; font-size: 12px; letter-spacing: .1em; margin-bottom: 4px; text-transform: uppercase; }
    .docs-pagenav strong { font-size: 15px; }
    .docs-pagenav .docs-pagenav__next { text-align: right; }
    .docs-pagenav .docs-pagenav__next:hover strong, .docs-pagenav .docs-pagenav__prev:hover strong { color: var(--accent); }

    /* Right column — on this page */
    .docs-notes { align-self: start; font-size: 13px; position: sticky; top: 96px; }
    .docs-notes h2 { border-left: 2px solid var(--line); color: var(--muted); font-size: 12px; letter-spacing: .12em; margin: 0 0 4px; padding-left: 12px; text-transform: uppercase; }
    .docs-notes ol { border-left: 2px solid var(--line); list-style: none; margin: 0; padding: 0; }
    .docs-notes li { line-height: 1.4; margin: 0; }
    .docs-notes a { color: var(--muted); display: block; padding: 5px 0 5px 12px; text-decoration: none; }
    .docs-notes a:hover { color: var(--ink); }

    /* Landing */
    .docs-landing__hero { border-bottom: 2px solid var(--ink); margin-bottom: 8px; padding-bottom: 24px; }
    .docs-landing__hero h1 { font-family: Lora, serif; font-size: clamp(2.4rem, 5vw, 3.6rem); letter-spacing: -.045em; line-height: 1.05; margin: 0; }
    .docs-landing__intro { color: var(--muted); font-size: clamp(1.05rem, 2vw, 1.25rem); line-height: 1.6; margin: 16px 0 0; max-width: 660px; }
    .docs-section { border-bottom: 1px solid var(--line); padding: 26px 0; }
    .docs-section > h2 { align-items: center; display: flex; font-family: Lora, serif; font-size: clamp(1.3rem, 3vw, 1.7rem); gap: 10px; letter-spacing: -.02em; margin: 0 0 6px; }
    .docs-section > h2 i { color: var(--accent); font-size: 18px; }
    .docs-section ul { list-style: none; margin: 0; padding: 0; }
    .docs-section li { border-top: 1px solid var(--line); padding: 16px 0; }
    .docs-section li:first-of-type { border-top: 0; }
    .docs-section__link { align-items: baseline; display: flex; gap: 14px; justify-content: space-between; }
    .docs-section__link > a { color: var(--ink); font-size: 18px; font-weight: 700; line-height: 1.3; text-decoration: none; }
    .docs-section__link > a:hover { color: var(--accent); }
    .docs-section__link time { color: var(--muted); flex: 0 0 auto; font-size: 13px; }
    .docs-section__link > a i { color: var(--accent); font-size: 12px; margin-left: 8px; }
    .docs-section p { color: var(--muted); line-height: 1.6; margin: 6px 0 0; max-width: 640px; }

    @media (max-width: 1080px) {
      .docs-layout, .docs-layout--landing { grid-template-columns: 1fr; }
      .docs-nav { border: 1px solid var(--line); border-radius: 12px; padding: 10px; position: static; }
      .docs-nav__home { margin-bottom: 4px; }
      .docs-notes { display: none; }
      .docs-pagenav { grid-template-columns: 1fr; }
      .docs-pagenav .docs-pagenav__next { text-align: left; }
    }
  </style>`;

pages.get('/docs', async (c) => {
  const docs = listDocs();
  const title = 'Developer Docs';
  const sections = groupDocsBySection(docs);
  const sectionHtml = sections.map((section) => `
    <section class="docs-section" aria-labelledby="docs-section-${escapeHtml(section.key || 'guides')}">
      <h2 id="docs-section-${escapeHtml(section.key || 'guides')}"><i class="${escapeHtml(section.icon)}" aria-hidden="true"></i>${escapeHtml(section.label)}</h2>
      <ul>${section.docs.map((doc) => `
        <li>
          <div class="docs-section__link"><a href="/docs/${encodeURIComponent(doc.slug)}">${doc.icon ? `<i class="${escapeHtml(doc.icon)}" aria-hidden="true"></i> ` : ''}${escapeHtml(doc.title)} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>${doc.updated ? `<time datetime="${escapeHtml(doc.updated)}">${escapeHtml(formatDate(doc.updated))}</time>` : ''}</div>
          ${doc.description ? `<p>${escapeHtml(doc.description)}</p>` : ''}
        </li>`).join('')}
      </ul>
    </section>`).join('');
  const body = `
    <div class="docs-layout docs-layout--landing">
      ${renderDocsSidebar(sections)}
      <div class="docs-landing">
        <header class="docs-landing__hero">
          <h1>${escapeHtml(title)}</h1>
          <p class="docs-landing__intro">Guides and references for building on and with Coffee &amp; Code.</p>
        </header>
        ${sectionHtml || '<p class="empty-state">Documentation is on the way — check back soon.</p>'}
      </div>
    </div>
    ${docsPageStyles}
  `;
  const pageUrl = new URL(c.req.url).toString();
  const metaTags = `
    <meta name="description" content="Developer documentation for Coffee & Code.">
    <meta property="og:title" content="${escapeHtml(title)} | Coffee and Code">
    <meta property="og:description" content="Developer documentation for Coffee & Code.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <meta property="og:image" content="${escapeHtml(browserRunScreenshotUrl(new URL(pageUrl).pathname))}">
    <meta property="og:image:type" content="image/png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${escapeHtml(browserRunScreenshotUrl(new URL(pageUrl).pathname))}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;
  return c.html(renderLayout(c, title, body, metaTags, `${title} | Coffee & Code`));
});

pages.get('/docs/:slug', async (c) => {
  const slug = c.req.param('slug');
  const doc = getDoc(slug);
  if (!doc) {
    return c.html(renderLayout(c, 'Doc Not Found', `
      <section class="not-found">
        <h1>Doc not found</h1>
        <p>The requested page could not be located in the developer docs.</p>
        <div class="not-found__actions">
          <a href="/docs" class="read-link">All docs <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
        </div>
      </section>
    `), 404);
  }

  const rawHtml = await renderMarkdown(renderDocIcons(doc.markdown));
  // Build an "On this page" TOC from ## / ### headings and tag the rendered
  // headings with matching ids (marked emits them in source order).
  const tocItems = [...doc.markdown.matchAll(/^(#{2,3})\s+(.+?)\s*#*$/gm)].map((m) => {
    const clean = m[2].replace(/:fa-[a-z0-9:-]+:/gi, '').replace(/[`*]/g, '').trim();
    return {
      level: m[1].length,
      text: clean,
      id: clean.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    };
  });
  let headingIndex = 0;
  const html = rawHtml.replace(/<h([23])>/g, (match, level) => {
    const item = tocItems[headingIndex++];
    return item && item.level === Number(level) ? `<h${level} id="${item.id}">` : match;
  });
  const requestOrigin = new URL(c.req.url).origin;
  const processed = processImages(html, (source) => proxyImageUrl(source, requestOrigin));
  const content = routeExternalLinks(enhanceHtmlStructure(processed));
  const tocHtml = tocItems.length ? `
    <aside class="docs-notes" aria-label="On this page">
      <h2>On this page</h2>
      <ol>${tocItems.map((item) => `<li${item.level === 3 ? ' style="padding-left:14px"' : ''}><a href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a></li>`).join('')}</ol>
    </aside>` : '';
  const allDocs = listDocs();
  const docIndex = allDocs.findIndex((item) => item.slug === doc.slug);
  const prevDoc = docIndex > 0 ? allDocs[docIndex - 1] : undefined;
  const nextDoc = docIndex >= 0 && docIndex < allDocs.length - 1 ? allDocs[docIndex + 1] : undefined;
  const pageNavHtml = (prevDoc || nextDoc) ? `
    <nav class="docs-pagenav" aria-label="More docs">
      ${prevDoc ? `<a class="docs-pagenav__prev" href="/docs/${encodeURIComponent(prevDoc.slug)}"><span>← Previous</span><strong>${escapeHtml(prevDoc.title)}</strong></a>` : '<span></span>'}
      ${nextDoc ? `<a class="docs-pagenav__next" href="/docs/${encodeURIComponent(nextDoc.slug)}"><span>Next →</span><strong>${escapeHtml(nextDoc.title)}</strong></a>` : '<span></span>'}
    </nav>` : '';
  const pageUrl = new URL(c.req.url).toString();
  const body = `
    <div class="docs-layout">
      ${renderDocsSidebar(groupDocsBySection(listDocs()), doc.slug)}
      <article class="docs-article">
        <a class="docs-article__back" href="/docs"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> All docs</a>
        <header class="docs-article__header">
          <h1>${escapeHtml(doc.title)}</h1>
          ${doc.description ? `<p class="docs-article__dek">${escapeHtml(doc.description)}</p>` : ''}
          ${formatDate(doc.updated) ? `<p class="docs-article__date">Updated ${escapeHtml(formatDate(doc.updated))}</p>` : ''}
        </header>
        <div class="prose">${content}</div>
        ${pageNavHtml}
      </article>
      ${tocHtml}
    </div>
    ${docsPageStyles}
  `;
  const metaTags = `
    <meta name="description" content="${escapeHtml(doc.description || doc.title)}">
    <meta property="og:title" content="${escapeHtml(doc.title)} | Coffee and Code Docs">
    <meta property="og:description" content="${escapeHtml(doc.description || 'Developer documentation for Coffee & Code.')}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <meta property="og:image" content="${escapeHtml(browserRunScreenshotUrl(new URL(pageUrl).pathname))}">
    <meta property="og:image:type" content="image/png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${escapeHtml(browserRunScreenshotUrl(new URL(pageUrl).pathname))}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;
  return c.html(renderLayout(c, doc.title, body, metaTags, `${doc.title} | Coffee & Code Docs`));
});

export default pages;
