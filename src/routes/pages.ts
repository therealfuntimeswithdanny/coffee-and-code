import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import { renderSearchBar } from '../templates/searchBar';
import { getPdsEndpoint, isPdsAvailable, fetchArticles, searchArticles, resolveAtprotoIdentifier, proxyImageUrl, proxyAvatarUrl, type ArticlePagination } from '../lib/atproto';
import { renderLayout, browserRenderOgImage } from '../templates/layout';
import { toPlainText } from '../lib/contentRenderer';
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

pages.get('/feed', (c) => {
  const feedUri = 'at://did:plc:z7hzwpuv5ytin56wecfxa4mx/app.bsky.feed.generator/following';
  const blueskyFeedUrl = 'https://bsky.app/profile/did:plc:z7hzwpuv5ytin56wecfxa4mx/feed/following';
  const feedUrl = 'https://feed.coffeencode.cc';
  const pageUrl = new URL(c.req.url).toString();
  const body = `
    <section class="feed-page" aria-labelledby="feed-title">
      <h1 id="feed-title">A feed shaped by the authors you choose.</h1>
      <p class="feed-page__intro">Keep up with Coffee &amp; Code writers on Bluesky. Follow authors here, then see their latest posts together in one dedicated feed.</p>
      <div class="feed-page__actions">
        <a class="login-button" href="${blueskyFeedUrl}" target="_blank" rel="noopener noreferrer">Open the feed in Bluesky <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
        <a class="feed-page__manage" href="${feedUrl}" target="_blank" rel="noopener noreferrer">Sign in or manage follows <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
      </div>
      <section class="feed-page__details" aria-label="How the feed works">
        <article><span class="feed-page__number">01</span><div><h2>Choose your authors</h2><p>Sign in with your Bluesky handle on the feed service and follow Coffee &amp; Code authors. These follows are independent of your regular Bluesky follows.</p></div></article>
        <article><span class="feed-page__number">02</span><div><h2>Make it yours</h2><p>Set preferences for each author, filter posts by topic, and decide whether you want all posts or only posts linking to Coffee &amp; Code.</p></div></article>
        <article><span class="feed-page__number">03</span><div><h2>Read in Bluesky</h2><p>Open the feed in Bluesky to see recent posts from the authors you selected. You can also manage your follows by messaging <strong>@coffeencode.cc</strong> on Bluesky.</p></div></article>
      </section>
      <p class="feed-page__note">The feed is public on Bluesky. Your author follows and preferences are saved in your own AT Protocol account.</p>
      <a class="feed-page__uri" href="${blueskyFeedUrl}" aria-label="Coffee and Code following feed identifier">Feed identifier <code>${feedUri}</code></a>
    </section>
    <style>
      .feed-page { margin: 0 auto; max-width: 940px; }
      .feed-page h1 { font-family: Lora, serif; font-size: clamp(2.8rem, 7vw, 5.5rem); letter-spacing: -.04em; line-height: 1.03; margin: 0; max-width: 850px; }
      .feed-page__intro { color: var(--muted); font-size: clamp(1.15rem, 2.2vw, 1.4rem); line-height: 1.65; margin: 22px 0 25px; max-width: 700px; }
      .feed-page__actions { align-items: center; display: flex; flex-wrap: wrap; gap: 22px; }
      .feed-page__actions .login-button { gap: 12px; min-height: 48px; padding: 12px 18px; }
      .feed-page__manage { color: var(--accent); font-size: 15px; font-weight: 700; }
      .feed-page__manage i { margin-left: 6px; }
      .feed-page__details { border-top: 2px solid var(--ink); margin-top: 66px; }
      .feed-page__details article { align-items: start; border-bottom: 1px solid var(--line); display: grid; gap: 24px; grid-template-columns: 56px minmax(0, 1fr); padding: 25px 0; }
      .feed-page__number { color: var(--accent); font-size: 13px; font-weight: 700; letter-spacing: .12em; padding-top: 6px; }
      .feed-page__details h2 { font-family: Lora, serif; font-size: clamp(1.35rem, 3vw, 1.8rem); line-height: 1.2; margin: 0 0 8px; }
      .feed-page__details p { color: var(--muted); margin: 0; max-width: 700px; }
      .feed-page__details strong { color: var(--ink); }
      .feed-page__note { color: var(--muted); font-size: 14px; margin: 22px 0 0; }
      .feed-page__uri { color: var(--accent); display: inline-flex; flex-wrap: wrap; font-size: 12px; gap: 8px; margin-top: 26px; }
      .feed-page__uri code { color: var(--muted); overflow-wrap: anywhere; }
      @media (max-width: 600px) { .feed-page h1 { font-size: clamp(2.55rem, 12vw, 4rem); }.feed-page__details { margin-top: 46px; }.feed-page__details article { gap: 12px; grid-template-columns: 34px minmax(0, 1fr); padding: 20px 0; }.feed-page__actions { align-items: flex-start; flex-direction: column; gap: 16px; } }
    </style>`;
  const metaTags = `
    <meta name="description" content="Follow Coffee &amp; Code authors on Bluesky with a feed you can shape around the writers and topics you care about.">
    <meta property="og:title" content="Coffee &amp; Code Feed">
    <meta property="og:description" content="A Bluesky feed shaped by the Coffee &amp; Code authors you choose.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;
  return c.html(renderLayout(c, 'The Coffee & Code Feed', body, metaTags));
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
  return c.json(articles.map(({ uri, path, title, publishedAt, cover }) => ({ uri, path, title, publishedAt, cover })), 200, {
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

pages.get('/auth', (c) => {
  const body = `
    <section class="auth-page" aria-labelledby="auth-title">
      <h1 id="auth-title">Log in to Coffee &amp; Code</h1>
      <p class="auth-page__intro">Sign in with your AT Protocol handle.</p>
      <div class="auth-options" data-auth-options>
        <section class="auth-option auth-option--coffee" aria-labelledby="existing-account-title">
          <h2 id="existing-account-title">Sign in</h2>
          <form class="auth-form" data-auth-form>
            <label for="auth-handle">Handle</label>
            <input id="auth-handle" name="handle" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you.bsky.social" required>
            <button type="submit" class="login-button auth-option__button">Continue</button>
          </form>
          <p class="auth-page__resolution">AT Protocol is an open social networking protocol. Bluesky is built on it, so you can sign in here with your Bluesky handle. You can also use an account from another AT Protocol service. You’ll enter your password on your account provider’s site.</p>
          <button type="button" class="auth-create-button" data-create-coffee-account>Create a Coffee &amp; Code account</button>
          <p class="auth-page__resolution" data-invite-status aria-live="polite"></p>
          <div class="auth-invite" data-invite-panel hidden><code data-invite-code></code><button type="button" class="auth-signout" data-copy-invite>Copy invite code</button></div>
        </section>
      </div>
      <div class="auth-account" data-auth-account hidden>
        <p class="auth-account__status">Signed in as <strong data-auth-name></strong></p>
        <button type="button" class="auth-signout" data-auth-signout>Log out</button>
      </div>
      <p class="auth-page__permissions">Your account provider will show the permissions Coffee &amp; Code requests. Public likes, dislikes, views, saves, comments, and replies are saved to your AT Protocol account. Read our <a href="/terms">terms of service</a> and <a href="/privacy">privacy policy</a>.</p>
      <p class="auth-page__error" data-auth-error role="alert" hidden></p>
    </section>
  `;

  return c.html(renderLayout(c, 'Log in', body));
});

pages.get('/account', (c) => {
  const body = `
    <section class="auth-page account-page" aria-labelledby="account-title" data-account-page>
      <h1 id="account-title">Your account</h1>
      <div class="auth-account" data-auth-account hidden>
        <div class="account-layout">
        <aside class="account-layout__column account-layout__sidebar" aria-label="Your profile">
          <section class="account-card" aria-labelledby="profile-card-title">
            <div class="account-page__profile"><img data-profile-avatar alt="" hidden><span data-profile-placeholder aria-hidden="true"><i class="fa-solid fa-user"></i></span><div><h2 id="profile-card-title" data-profile-name>Loading account…</h2><p data-profile-handle></p><p class="account-page__profile-meta" data-profile-pronouns hidden></p><p data-profile-bio></p></div></div>
            <form class="account-profile-form" data-user-profile-form hidden aria-labelledby="profile-form-title">
              <h3 id="profile-form-title" class="visually-hidden">Edit your Coffee &amp; Code profile</h3>
              <label>Display name<input name="displayName" maxlength="64" autocomplete="nickname"></label>
              <label>Pronouns<input name="pronouns" maxlength="40" placeholder="Optional"></label>
              <label>Bio<textarea name="description" maxlength="256" rows="4"></textarea></label>
              <div class="account-profile-form__actions"><button class="auth-signout" type="submit">Save profile</button><button class="account-author-form__cancel" type="button" data-cancel-user-profile>Cancel</button></div>
            </form>
            <p class="account-profile-form__status" data-user-profile-status role="status" aria-live="polite"></p>
            <div class="account-page__actions">
              <button type="button" class="auth-signout" data-edit-user-profile disabled>Edit profile</button>
              <button type="button" class="auth-signout" data-auth-signout>Log out</button>
            </div>
            <nav class="account-page__section-nav" aria-label="Account sections">
              <a href="#saved-posts-title">Reading list</a>
              <a href="#viewed-posts-title">Recently viewed</a>
              <a href="#followed-tags-title">Followed tags</a>
              <a href="#blocked-accounts-title">Blocked accounts</a>
              <a href="#author-settings-title" data-author-settings-link hidden>Author profile</a>
            </nav>
          </section>
        </aside>
        <div class="account-layout__column account-layout__main">
          <section class="account-card account-page__viewed" aria-labelledby="saved-posts-title"><div class="account-card__header"><h2 id="saved-posts-title">Reading list</h2><span class="account-card__count" data-saved-count></span></div><p class="account-page__viewed-status" data-saved-status role="status" aria-live="polite">Loading your saved posts…</p><ul data-saved-posts></ul></section>
          <section class="account-card account-page__viewed" aria-labelledby="viewed-posts-title"><div class="account-card__header"><h2 id="viewed-posts-title">Recently viewed</h2></div><p class="account-page__viewed-status" data-viewed-status>Loading your viewed posts…</p><ul data-viewed-posts></ul></section>
        </div>
        <div class="account-layout__column account-layout__secondary">
          <section class="account-card account-page__viewed" aria-labelledby="followed-tags-title">
            <h2 id="followed-tags-title">Followed tags</h2>
            <p class="account-page__viewed-status" data-tag-follows-status role="status" aria-live="polite">Loading your followed tags…</p>
            <ul data-tag-follows-list></ul>
            <h3 class="account-page__subheading">Latest from your tags</h3>
            <ul class="account-page__tag-posts" data-tag-follows-posts></ul>
            <p class="account-page__blocks-note">Follow tags from the <a href="/tags">tag directory</a> to see new matching stories here and get notified.</p>
          </section>
          <section class="account-card account-page__viewed account-page__blocks" aria-labelledby="blocked-accounts-title">
            <h2 id="blocked-accounts-title">Blocked accounts</h2>
            <p class="account-page__viewed-status" data-blocks-status role="status" aria-live="polite">Loading your blocked accounts…</p>
            <ul data-blocks-list></ul>
            <p class="account-page__blocks-note">Coffee &amp; Code blocks hide this account’s forum posts and replies for you. Stories and comments remain visible. Bluesky blocks are managed separately in Bluesky settings.</p>
          </section>
        </div>
        <section class="account-card account-author-settings account-page__wide" data-author-settings hidden aria-labelledby="author-settings-title">
          <h2 id="author-settings-title">Author profile</h2>
          <p class="account-author-settings__intro">Manage the profile shown on your Coffee &amp; Code author page.</p>
          <button type="button" class="auth-signout" data-edit-author-profile hidden>Edit author profile</button>
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
                <fieldset class="account-author-form__pins account-author-form__wide"><legend>Pinned posts</legend><p>Choose the stories to feature on your author page.</p><input type="search" class="account-search-input" data-author-posts-search placeholder="Search your stories…" aria-label="Search your stories"><p data-author-posts-status>Stories will load when you open the editor.</p><div data-author-post-picker></div></fieldset>
                <div class="account-author-form__actions account-author-form__wide"><button class="auth-signout" type="submit">Save profile</button><button class="account-author-form__cancel" type="button" data-cancel-author-edit>Cancel</button></div>
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
          <div class="account-post-metadata" data-post-metadata>
            <h3 class="account-page__subheading" id="post-metadata-title">Post metadata</h3>
            <p class="account-post-metadata__intro">Attach sources and a backing document to stories published in your repository. Metadata appears on the story page.</p>
            <input type="search" class="account-search-input" data-post-metadata-search placeholder="Search your stories to edit metadata…" aria-label="Search your stories to edit metadata">
            <p class="account-post-metadata__status" data-post-metadata-status role="status" aria-live="polite"></p>
            <ul class="account-post-metadata__list" data-post-metadata-list></ul>
          </div>
        </section>
        </div>
      </div>
      <div data-account-signed-out hidden><p class="auth-page__intro">Sign in to view your account and manage your interactions.</p><a class="login-button" href="/auth" data-login-link>Log in</a></div>
    </section>
  `;

  return c.html(renderLayout(c, 'Your account', body));
});

function accountPageShell(title: string, inner: string, signedOutMessage = 'Sign in to view this page.') {
  return `
    <section class="auth-page account-page" aria-labelledby="account-title" data-account-page>
      <h1 id="account-title">${title}</h1>
      <div class="auth-account" data-auth-account hidden>
        ${inner}
      </div>
      <div data-account-signed-out hidden><p class="auth-page__intro">${signedOutMessage}</p><a class="login-button" href="/auth" data-login-link>Log in</a></div>
    </section>
  `;
}

const accountSubNav = `
  <nav class="account-page__section-nav" aria-label="Account pages">
    <a href="/account">Account</a>
    <a href="/account/saves">Reading list</a>
    <a href="/account/list">Lists</a>
    <a href="/account/reads">Recently viewed</a>
    <a href="/account/feed">Your feed</a>
    <a href="/account/author">Author profile</a>
  </nav>`;

pages.get('/account/saves', (c) => {
  const inner = `
    ${accountSubNav}
    <section class="account-card account-page__viewed" aria-labelledby="saved-posts-title">
      <div class="account-card__header"><h2 id="saved-posts-title">Reading list</h2><span class="account-card__count" data-saved-count></span></div>
      <p class="account-page__viewed-status" data-saved-status role="status" aria-live="polite">Loading your saved posts…</p>
      <ul data-saved-posts></ul>
    </section>`;
  const body = accountPageShell('Reading list', inner, 'Sign in to see the stories you saved.');
  return c.html(renderLayout(c, 'Reading list', body));
});

pages.get('/account/reads', (c) => {
  const inner = `
    ${accountSubNav}
    <section class="account-card account-page__viewed" aria-labelledby="viewed-posts-title">
      <div class="account-card__header"><h2 id="viewed-posts-title">Recently viewed</h2></div>
      <p class="account-page__viewed-status" data-viewed-status role="status" aria-live="polite">Loading your viewed posts…</p>
      <ul data-viewed-posts></ul>
    </section>`;
  const body = accountPageShell('Recently viewed', inner, 'Sign in to see the stories you read.');
  return c.html(renderLayout(c, 'Recently viewed', body));
});

pages.get('/account/list', (c) => {
  const inner = `
    ${accountSubNav}
    <section class="account-card account-page__viewed" aria-labelledby="account-lists-title" data-account-lists>
      <div class="account-card__header"><h2 id="account-lists-title">Your lists</h2><span class="account-card__count" data-lists-count></span></div>
      <p class="account-page__viewed-status" data-lists-status role="status" aria-live="polite">Loading your lists…</p>
      <ul data-lists-list></ul>
      <p class="account-page__blocks-note">Lists are saved to your AT Protocol account and are public. Add stories to a list from the story page, or share a list link with anyone.</p>
      <h3 class="account-page__subheading" id="list-create-title">Create a list</h3>
      <form class="account-profile-form account-list-form" data-list-form aria-labelledby="list-create-title">
        <label>Title<input name="title" maxlength="120" required placeholder="Required"></label>
        <label>About<textarea name="about" maxlength="2000" rows="3" placeholder="Optional — what belongs on this list?"></textarea></label>
        <label>Icon<input name="icon" maxlength="2048" placeholder="Optional — emoji or https image URL"></label>
        <div class="account-profile-form__actions"><button class="auth-signout" type="submit">Create list</button></div>
        <p class="account-profile-form__status" data-list-form-status role="status" aria-live="polite"></p>
      </form>
    </section>`;
  const body = accountPageShell('Your lists', inner, 'Sign in to create and manage your lists.');
  return c.html(renderLayout(c, 'Your lists', body));
});

pages.get('/account/feed', (c) => {
  const inner = `
    ${accountSubNav}
    <section class="account-card account-page__viewed" aria-labelledby="account-feed-title">
      <div class="account-card__header"><h2 id="account-feed-title">Your feed</h2></div>
      <p class="account-page__viewed-status">Your personal feed is coming soon.</p>
    </section>`;
  const body = accountPageShell('Your feed', inner, 'Sign in to see your feed.');
  return c.html(renderLayout(c, 'Your feed', body));
});

pages.get('/account/author', (c) => {
  const inner = `
    ${accountSubNav}
    <section class="account-card account-author-settings account-page__wide" data-author-settings hidden aria-labelledby="author-settings-title">
      <h2 id="author-settings-title">Author profile</h2>
      <p class="account-author-settings__intro">Manage the profile shown on your Coffee &amp; Code author page.</p>
      <button type="button" class="auth-signout" data-edit-author-profile hidden>Edit author profile</button>
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
            <fieldset class="account-author-form__pins account-author-form__wide"><legend>Pinned posts</legend><p>Choose the stories to feature on your author page.</p><input type="search" class="account-search-input" data-author-posts-search placeholder="Search your stories…" aria-label="Search your stories"><p data-author-posts-status>Stories will load when you open the editor.</p><div data-author-post-picker></div></fieldset>
            <div class="account-author-form__actions account-author-form__wide"><button class="auth-signout" type="submit">Save profile</button><button class="account-author-form__cancel" type="button" data-cancel-author-edit>Cancel</button></div>
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
      <div class="account-post-metadata" data-post-metadata>
        <h3 class="account-page__subheading" id="post-metadata-title">Post metadata</h3>
        <p class="account-post-metadata__intro">Attach sources and a backing document to stories published in your repository. Metadata appears on the story page.</p>
        <input type="search" class="account-search-input" data-post-metadata-search placeholder="Search your stories to edit metadata…" aria-label="Search your stories to edit metadata">
        <p class="account-post-metadata__status" data-post-metadata-status role="status" aria-live="polite"></p>
        <ul class="account-post-metadata__list" data-post-metadata-list></ul>
      </div>
    </section>
    <section class="account-card account-page__viewed" data-author-gate hidden aria-labelledby="author-gate-title">
      <h2 id="author-gate-title">Author profile</h2>
      <p class="account-page__viewed-status">Author tools appear here once you have published a story on Coffee &amp; Code. <a href="/become-an-author">Learn how to become an author</a>.</p>
    </section>`;
  const body = accountPageShell('Author profile', inner, 'Sign in to manage your author profile.');
  return c.html(renderLayout(c, 'Author profile', body));
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
  const text = (typeof post.description === 'string' ? post.description.trim() : '')
    || toPlainText(typeof post.content === 'string' ? post.content : '');
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

export default pages;
