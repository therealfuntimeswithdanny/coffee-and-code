import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import { getPdsEndpoint, fetchArticles, searchArticles, proxyImageUrl, proxyAvatarUrl } from '../lib/atproto';
import { renderLayout, browserRenderOgImage } from '../templates/layout';

const pages = new Hono<{ Bindings: Env }>();

function formatDate(date?: string) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function excerpt(post: StandardDocument) {
  const text = post.description?.trim() || '';
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
        <span class="author-card__details"><strong>${escapeHtml(name)}</strong><span>@${escapeHtml(author.handle)}</span><span>${postCount} ${postCount === 1 ? 'story' : 'stories'}</span></span>
      </a>`;
    })
    .join('');

  const body = `
    <section class="authors-page" aria-labelledby="authors-title">
      <header class="authors-page__header">
        <p class="eyebrow">Contributors</p>
        <h1 id="authors-title">Authors</h1>
      </header>
      ${authorItems ? `<div class="author-grid">${authorItems}</div>` : '<p class="empty-state">No authors have published stories yet.</p>'}
    </section>
  `;

  return c.html(renderLayout(c, 'Authors', body));
});

pages.get('/author/:handle', async (c) => {
  const handle = c.req.param('handle').toLowerCase();
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const allPosts = await fetchArticles(pds, c.env.OWNER_DID);
  const authorPosts = allPosts.filter((post) => post.author?.handle.toLowerCase() === handle);
  const author = authorPosts[0]?.author;

  if (!author) {
    return c.html(renderLayout(c, 'Author Not Found', '<section class="not-found"><p class="eyebrow">404</p><h1>Author not found</h1><p>This author has not published in this publication.</p><a href="/archive" class="read-link">Browse archive <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></section>'), 404);
  }

  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const authorName = author.displayName || author.handle;
  const authorAvatar = author.avatar ? proxyAvatarUrl(author.avatar) : '';
  const archiveItems = authorPosts
    .map((post) => `
      <article class="archive-story">
        <a class="archive-story__image${post.cover ? '' : ' story-image--placeholder'}" href="${post.path}" aria-label="Read ${escapeHtml(post.title)}">
          ${post.cover ? `<img src="${proxyImageUrl(post.cover, pds)}" alt="" class="story-image" width="1200" height="686" sizes="(max-width: 760px) 100vw, 320px" loading="lazy" decoding="async">` : '<span aria-hidden="true">C&amp;C</span>'}
        </a>
        <div>
          <p class="eyebrow">${formatDate(post.publishedAt)}</p>
          <h3><a href="${post.path}">${escapeHtml(post.title || 'Untitled')}</a></h3>
          ${excerpt(post) ? `<p>${escapeHtml(excerpt(post))}</p>` : ''}
            <span class="view-counter" data-view-counter data-path="${post.path}" data-update-db="false">Loading views...</span>
        </div>
        <a href="${post.path}" class="read-link">Read story <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
      </article>`)
    .join('');

  const body = `
    <section class="author-page" aria-labelledby="author-title">
      <header class="author-page__header">
        ${authorAvatar ? `<img src="${authorAvatar}" alt="" class="author-page__avatar" width="88" height="88" decoding="async">` : ''}
        <div><p class="eyebrow">Author</p><h1 id="author-title">${escapeHtml(authorName)}</h1><p>@${escapeHtml(author.handle)}</p></div>
      </header>
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
  const allPosts = await fetchArticles(pds, c.env.OWNER_DID);
  const query = c.req.query('q') || '';

  // Filter posts based on search query
  const posts = query.trim() ? searchArticles(allPosts, query) : allPosts;
  const archiveBaseUrl = new URL(c.req.url).origin;

  const proxiedCover = (source?: string) => (source ? proxyImageUrl(source, pds || archiveBaseUrl) : source);

  const archiveItems = posts
    .map(
      (post) => `
        <article class="archive-story">
          <a class="archive-story__image${post.cover ? '' : ' story-image--placeholder'}" href="${post.path}" aria-label="Read ${post.title || 'Untitled'}">
            ${post.cover ? `<img src="${proxiedCover(post.cover)}" alt="" class="story-image" loading="lazy" decoding="async">` : '<span aria-hidden="true">C&amp;C</span>'}
          </a>
          <div>
            <p class="eyebrow">${formatDate(post.publishedAt)}</p>
            <h3><a href="${post.path}">${post.title || 'Untitled'}</a></h3>
            ${excerpt(post) ? `<p>${excerpt(post)}</p>` : ''}
            <span class="view-counter" data-view-counter data-path="${post.path}" data-update-db="false">Loading views...</span>
          </div>
          <a href="${post.path}" class="read-link">Read story <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
        </article>`
    )
    .join('');

  const searchForm = `
    <div class="archive-search">
      <form class="search-form" action="/archive" method="get">
        <input
          type="text"
          name="q"
          placeholder="Search archive..."
          value="${query.replace(/"/g, '&quot;')}"
          class="search-input"
          autocomplete="off"
        >
        <button type="submit" class="search-button">Search</button>
      </form>
    </div>
  `;

  const emptyMessage = query.trim() ? 'No stories found matching your search.' : 'No stories have been published yet.';
  const gridOrEmpty = archiveItems
    ? `<div class="archive-grid">${archiveItems}</div>`
    : `<p class="empty-state">${emptyMessage}</p>`;

  const body = `
    <section class="archive-page" aria-labelledby="archive-title">
      ${searchForm}
      <div class="section-heading"><span id="archive-title">Archive</span><span>${posts.length} ${posts.length === 1 ? 'story' : 'stories'}</span></div>
      ${gridOrEmpty}
    </section>
  `;

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

  return c.html(renderLayout(c, 'Archive', body, metaTags));
});

pages.get('/privacy', (c) => {
  const body = '<article class="max-w-2xl mx-auto py-8"><h1 class="text-3xl font-bold text-white mb-4">Privacy</h1><p class="text-gray-300 leading-relaxed mb-4">Coffee &amp; Code does not sell personal information. This site reads publicly available publication records from AT Protocol to display its stories.</p><p class="text-gray-300 leading-relaxed">We use Umami Analytics, provided by Umami Cloud, to understand how visitors use this site and improve it. Umami may process privacy-focused, aggregated usage information such as page views, referring pages, device and browser details, and approximate location. We do not use this analytics data to identify you or sell it to third parties. The Umami service is loaded when you visit pages on this site.</p></article>';

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

  return c.html(renderLayout(c, 'Privacy', body, metaTags));
});

export default pages;
