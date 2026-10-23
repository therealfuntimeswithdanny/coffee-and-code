import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import { getPdsEndpoint, fetchArticles, searchArticles, proxyImageUrl, proxyAvatarUrl } from '../lib/atproto';
import { renderLayout, browserRenderOgImage } from '../templates/layout';

const pages = new Hono<{ Bindings: Env }>();

pages.get('/auth', (c) => {
  const body = `
    <section class="auth-page" aria-labelledby="auth-title">
      <p class="eyebrow">Coffee &amp; Code account</p>
      <h1 id="auth-title">Sign in with AT Protocol</h1>
      <p class="auth-page__intro">Use your Bluesky, Blacksky, Eurosky or other AT Protocol account to sign in. We will redirect you to your PDS (the server where your account is stored).</p>
      <p class="auth-page__resolution">To locate your account provider, the handle you enter is sent to Coffee &amp; Code's PDS resolver before you are redirected.</p>
      <form class="auth-form" data-auth-form>
        <label for="auth-handle">Handle or DID</label>
        <input id="auth-handle" name="handle" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you.example" required>
        <button type="submit" class="login-button">Continue with AT Protocol</button>
      </form>
      <div class="auth-account" data-auth-account hidden>
        <p class="auth-account__status">Signed in as <strong data-auth-name></strong></p>
        <button type="button" class="auth-signout" data-auth-signout>Log out</button>
      </div>
      <p class="auth-page__permissions">Coffee &amp; Code asks permission to create and remove your like and dislike records, create view records and story recommendations, and create comments and replies in your repository (account). You will be redirected to your account provider's site.</p>
      <p class="auth-page__error" data-auth-error role="alert" hidden></p>
    </section>
  `;

  return c.html(renderLayout(c, 'Log in', body));
});

pages.get('/become-an-author', (c) => {
  const body = `
    <section class="author-invitation" aria-labelledby="author-invitation-title">
      <p class="eyebrow">Write for Coffee &amp; Code</p>
      <h1 id="author-invitation-title">Become an author</h1>
      <p class="author-invitation__intro">Coffee &amp; Code is an independent publication built on the AT Protocol. To contribute, create your own publication with Leaflet and send me its publication URI.</p>
      <ol class="author-invitation__steps">
        <li>
          <h2>Create your publication</h2>
          <p>Sign in to <a href="https://leaflet.pub/" target="_blank" rel="noopener noreferrer">Leaflet</a> and create a Standard.site publication on your account. This keeps your stories published under your account and attributed to you.</p>
        </li>
        <li>
          <h2>Set the publication URL</h2>
          <p>Set the publication's URL or domain to the site you want to be its main home. If you are using this publication just for Coffee &amp; Code, set it to <code>coffeencode.cc</code> (or <code>https://coffeencode.cc</code> if a full URL is required). You can update this setting with a tool like <a href="https://pdsls.dev" target="_blank" rel="noopener noreferrer">PDSls</a>; you do not need to set up a custom domain.</p>
          <p>Coffee &amp; Code connects to your publication using its AT Protocol URI, not this website URL. So if you also want the publication to represent your own site or power another Standard.site frontend, set the URL to that site's main address instead. After you send me the publication URI and I add it, Coffee &amp; Code can still show stories published to it at <code>coffeencode.cc/\${rkey}</code>.</p>
        </li>
        <li>
          <h2>Send me the publication URI</h2>
          <p>DM me on <a href="https://bsky.app/profile/did:plc:l37td5yhxl2irrzrgvei4qay" target="_blank" rel="noopener noreferrer">Bluesky</a> with the publication's AT Protocol URI. This is not the website URL above. It starts with <code>at://</code> and looks like:</p>
          <code>at://your-did/site.standard.publication/your-record-key</code>
        </li>
        <li>
          <h2>Publish your stories</h2>
          <p>Once I have added your publication, publish stories to it through Leaflet. Stories in that publication can appear on <a href="/">coffeencode.cc</a> with your author profile.</p>
        </li>
      </ol>
    </section>
  `;

  const metaTags = `
    <meta name="description" content="How to write for Coffee &amp; Code: create a Leaflet publication and DM its AT Protocol URI.">
  `;
  return c.html(renderLayout(c, 'Become an Author', body, metaTags));
});

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
      <p class="authors-page__invitation"><a class="read-link" href="/become-an-author">Become an author <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></p>
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
  const authorBanner = author.banner ? proxyImageUrl(author.banner, pds, 'feed_fullsize') : '';
  const archiveItems = authorPosts
    .map((post) => `
      <article class="archive-story">
        <a class="archive-story__image${post.cover ? '' : ' story-image--placeholder'}" href="${post.path}" aria-label="Read ${escapeHtml(post.title)}">
          ${post.cover ? `<img src="${proxyImageUrl(post.cover, pds, 'feed_medium')}" alt="" class="story-image" width="1200" height="686" sizes="(max-width: 760px) 100vw, 320px" loading="lazy" decoding="async">` : '<span aria-hidden="true">C&amp;C</span>'}
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
  const pinnedPosts = new Set(author.pinnedPosts || []);
  const pinnedItems = authorPosts
    .filter((post) => pinnedPosts.has(post.uri))
    .map((post) => `<li><a href="${escapeHtml(post.path)}">${escapeHtml(post.title || 'Untitled')}</a></li>`)
    .join('');

  const body = `
    <section class="author-page" aria-labelledby="author-title">
      ${authorBanner ? `<img src="${escapeHtml(authorBanner)}" alt="" class="author-page__banner" width="1200" height="400" decoding="async">` : ''}
      <header class="author-page__header">
        ${authorAvatar ? `<img src="${authorAvatar}" alt="" class="author-page__avatar" width="88" height="88" decoding="async">` : ''}
        <div><p class="eyebrow">Author</p><h1 id="author-title">${escapeHtml(authorName)}</h1><p>@${escapeHtml(author.handle)}${author.pronouns ? ` · ${escapeHtml(author.pronouns)}` : ''}</p></div>
      </header>
      ${author.description ? `<p class="author-page__description">${escapeHtml(author.description)}</p>` : ''}
      ${pinnedItems ? `<section class="author-page__pinned" aria-label="Pinned stories"><div class="section-heading"><span>Pinned stories</span></div><ul>${pinnedItems}</ul></section>` : ''}
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

  const archiveItems = posts
    .map(
      (post) => `
        <article class="archive-story">
          <a class="archive-story__image${post.cover ? '' : ' story-image--placeholder'}" href="${post.path}" aria-label="Read ${post.title || 'Untitled'}">
            ${post.cover ? `<img src="${proxyImageUrl(post.cover, pds || archiveBaseUrl, 'feed_medium')}" alt="" class="story-image" loading="lazy" decoding="async">` : '<span aria-hidden="true">C&amp;C</span>'}
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
