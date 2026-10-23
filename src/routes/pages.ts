import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import { getPdsEndpoint, fetchArticles, searchArticles, proxyImageUrl, proxyAvatarUrl } from '../lib/atproto';
import { renderLayout, browserRenderOgImage } from '../templates/layout';

const pages = new Hono<{ Bindings: Env }>();

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
    console.error('Could not retrieve a signup invite code:', error);
    return c.json({ error: 'A signup invite code is temporarily unavailable.' }, 502, { 'Cache-Control': 'no-store' });
  }
});

pages.get('/api/account/posts', async (c) => {
  const authorDid = c.req.query('author');
  if (authorDid && !/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(authorDid)) {
    return c.json({ error: 'A valid author DID is required.' }, 400);
  }
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const allArticles = await fetchArticles(pds, c.env.OWNER_DID);
  const articles = authorDid
    ? allArticles.filter((post) => post.author?.did.toLowerCase() === authorDid.toLowerCase())
    : allArticles;
  return c.json(articles.map(({ uri, path, title, publishedAt, cover }) => ({ uri, path, title, publishedAt, cover })), 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

pages.get('/auth', (c) => {
  const body = `
    <section class="auth-page" aria-labelledby="auth-title">
      <p class="eyebrow">Welcome back</p>
      <h1 id="auth-title">Log in to Coffee &amp; Code</h1>
      <p class="auth-page__intro">Choose your Coffee &amp; Code account or continue with an existing Bluesky account.</p>
      <div class="auth-options" data-auth-options>
        <section class="auth-option auth-option--coffee" aria-labelledby="coffee-account-title">
          <p class="auth-option__label">Hosted by Coffee &amp; Code</p>
          <h2 id="coffee-account-title">Coffee &amp; Code account</h2>
          <p>Log in to your Coffee &amp; Code account, or start creating one on our account server. Your password stays on the account server.</p>
          <button type="button" class="login-button auth-option__button" data-coffee-account>Continue with Coffee &amp; Code</button>
          <button type="button" class="auth-create-button" data-create-coffee-account>Create a Coffee &amp; Code account</button>
          <p class="auth-page__resolution" data-invite-status aria-live="polite"></p>
          <div class="auth-invite" data-invite-panel hidden><code data-invite-code></code><button type="button" class="auth-signout" data-copy-invite>Copy invite code</button></div>
        </section>
        <section class="auth-option" aria-labelledby="existing-account-title">
          <p class="auth-option__label">Already have an account?</p>
          <h2 id="existing-account-title">Existing Bluesky account</h2>
          <p>Use Bluesky or another AT Protocol account you already have.</p>
          <form class="auth-form" data-auth-form>
            <label for="auth-handle">Handle or DID</label>
            <input id="auth-handle" name="handle" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you.bsky.social" required>
            <button type="submit" class="login-button auth-option__button">Continue with existing account</button>
          </form>
          <p class="auth-page__resolution">Your handle is sent to Coffee &amp; Code's resolver to find your account provider. You’ll enter your password on that provider’s site.</p>
        </section>
      </div>
      <div class="auth-account" data-auth-account hidden>
        <p class="auth-account__status">Signed in as <strong data-auth-name></strong></p>
        <button type="button" class="auth-signout" data-auth-signout>Log out</button>
      </div>
      <p class="auth-page__permissions">Your account provider will show the permissions Coffee &amp; Code requests. Public likes, dislikes, views, comments, and replies are saved to your AT Protocol account. <a href="/privacy">Read our privacy policy</a>.</p>
      <p class="auth-page__error" data-auth-error role="alert" hidden></p>
    </section>
  `;

  return c.html(renderLayout(c, 'Log in', body));
});

pages.get('/account', (c) => {
  const body = `
    <section class="auth-page account-page" aria-labelledby="account-title" data-account-page>
      <p class="eyebrow">Your profile</p>
      <h1 id="account-title">Your account</h1>
      <div class="auth-account" data-auth-account hidden>
        <div class="account-page__profile"><img data-profile-avatar alt="" hidden><span data-profile-placeholder aria-hidden="true"><i class="fa-solid fa-user"></i></span><div><h2 data-profile-name>Loading account…</h2><p data-profile-handle></p><p data-profile-bio></p><p class="account-page__did" data-profile-did></p></div></div>
        <section class="account-page__viewed" aria-labelledby="viewed-posts-title"><h2 id="viewed-posts-title">Posts you’ve viewed</h2><p class="account-page__viewed-status" data-viewed-status>Loading your viewed posts…</p><ul data-viewed-posts></ul></section>
        <section class="account-author-settings" data-author-settings hidden aria-labelledby="author-settings-title">
          <h2 id="author-settings-title">Author profile</h2>
          <p class="account-author-settings__intro">Manage the profile shown on your Coffee &amp; Code author page.</p>
          <button type="button" class="auth-signout" data-edit-author-profile hidden>Edit author profile</button>
          <form class="account-author-form" data-author-profile-form hidden>
            <label>Display name<input name="displayName" maxlength="100"></label>
            <label>Pronouns<input name="pronouns" maxlength="50" placeholder="Optional"></label>
            <label>Bio<textarea name="description" maxlength="1000" rows="5"></textarea></label>
            <label>Profile photo<input name="avatar" type="file" accept="image/*"></label>
            <label class="account-author-form__check"><input name="removeAvatar" type="checkbox"> Remove current photo</label>
            <label>Profile banner<input name="banner" type="file" accept="image/*"></label>
            <label class="account-author-form__check"><input name="removeBanner" type="checkbox"> Remove current banner</label>
            <fieldset class="account-author-form__pins"><legend>Pinned posts</legend><p>Choose the stories to feature on your author page.</p><p data-author-posts-status>Stories will load when you open the editor.</p><div data-author-post-picker></div></fieldset>
            <div class="account-author-form__actions"><button class="auth-signout" type="submit">Save profile</button><button class="account-author-form__cancel" type="button" data-cancel-author-edit>Cancel</button></div>
            <p class="account-author-form__status" data-author-profile-status role="status" aria-live="polite"></p>
          </form>
        </section>
        <button type="button" class="auth-signout" data-auth-signout>Log out</button>
      </div>
      <div data-account-signed-out hidden><p class="auth-page__intro">Sign in to view your account and manage your interactions.</p><a class="login-button" href="/auth">Log in</a></div>
    </section>
  `;

  return c.html(renderLayout(c, 'Your account', body));
});

pages.get('/become-an-author', (c) => {
  const body = `
    <section class="author-invitation" aria-labelledby="author-invitation-title">
      <p class="eyebrow">Write for Coffee &amp; Code</p>
      <h1 id="author-invitation-title">Become an author</h1>
      <p class="author-invitation__intro">Have something you’d like to publish? DM me on <a href="https://bsky.app/profile/did:plc:l37td5yhxl2irrzrgvei4qay" target="_blank" rel="noopener noreferrer">Bluesky</a> with your document and a link to the publication. I’ll review it, and if it’s a good fit for Coffee &amp; Code, I’ll link to your publication.</p>
      <ol class="author-invitation__steps">
        <li>
          <h2>Create your publication</h2>
          <p>Sign in to <a href="https://leaflet.pub/" target="_blank" rel="noopener noreferrer">Leaflet</a> and create a publication on your account. This keeps your stories published under your account and attributed to you.</p>
        </li>
        <li>
          <h2>Send me your post</h2>
          <p>DM me on <a href="https://bsky.app/profile/did:plc:l37td5yhxl2irrzrgvei4qay" target="_blank" rel="noopener noreferrer">Bluesky</a> with a link to the post you want to publish. I’ll review it and let you know if it’s a good fit for Coffee &amp; Code.</p>
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
      return `<a class="author-card" href="/author/${encodeURIComponent(author.did)}">
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
  const identifier = c.req.param('handle');
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const allPosts = await fetchArticles(pds, c.env.OWNER_DID);
  const authorPosts = allPosts.filter((post) => post.author?.did.toLowerCase() === identifier.toLowerCase()
    || post.author?.handle.toLowerCase() === identifier.toLowerCase());
  const author = authorPosts[0]?.author;

  if (!author) {
    return c.html(renderLayout(c, 'Author Not Found', '<section class="not-found"><p class="eyebrow">404</p><h1>Author not found</h1><p>This author has not published in this publication.</p><a href="/archive" class="read-link">Browse archive <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></section>'), 404);
  }

  const authorCanonicalPath = `/author/${encodeURIComponent(author.did)}`;
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
            <span class="view-counter" data-at-uri="${escapeHtml(post.uri)}">Loading views...</span>
        </div>
        <a href="${post.path}" class="read-link">Read story <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
      </article>`)
    .join('');
  const pinnedPosts = new Set(author.pinnedPosts || []);
  const pinnedArticles = authorPosts.filter((post) => pinnedPosts.has(post.uri));
  const pinnedItems = pinnedArticles
    .map((post) => `
      <article class="author-pinned-card">
        <a class="author-pinned-card__image${post.cover ? '' : ' story-image--placeholder'}" href="${escapeHtml(post.path)}" aria-label="Read ${escapeHtml(post.title || 'Untitled')}">
          ${post.cover ? `<img src="${escapeHtml(proxyImageUrl(post.cover, pds, 'feed_medium'))}" alt="" width="800" height="450" loading="lazy" decoding="async">` : '<span aria-hidden="true">Pinned story</span>'}
        </a>
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
        <div><p class="eyebrow">Author</p><h1 id="author-title">${escapeHtml(authorName)}</h1><p>@${escapeHtml(author.handle)}${author.pronouns ? ` · ${escapeHtml(author.pronouns)}` : ''}</p></div>
      </header>
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
            <span class="view-counter" data-at-uri="${escapeHtml(post.uri)}">Loading views...</span>
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
  const body = `
    <article class="privacy-page" aria-labelledby="privacy-title">
      <p class="eyebrow">Your information</p>
      <h1 id="privacy-title">Privacy policy</h1>
      <p class="privacy-page__updated">Last updated October 23, 2026</p>
      <p>Coffee &amp; Code is a publication operated by MBD Company. This policy describes information handled when you visit <a href="https://coffeencode.cc">coffeencode.cc</a>, sign in, or interact with stories.</p>

      <h2>Information the site uses</h2>
      <ul>
        <li><strong>Public AT Protocol information.</strong> The site reads public publication, story, author, and profile records to display content. It also asks public AT Protocol services to resolve identities and retrieve profile information.</li>
        <li><strong>Account sign-in.</strong> Sign-in is handled by your chosen Personal Data Server (PDS). Coffee &amp; Code receives your account identifier (DID) and the authorization needed for features you approve. The site does not ask for or receive your PDS password. OAuth session data is kept in your browser so you can stay signed in.</li>
        <li><strong>Interactions.</strong> If you approve and use these features, the site writes likes, dislikes, views, recommendations, comments, replies, and comment likes to your AT Protocol repository. These records are public and may be copied or indexed by other network services. Removing a record from your repository may not remove copies already made elsewhere.</li>
        <li><strong>Technical and usage information.</strong> Cloudflare provides hosting and security for the site and may process request and device information, such as IP address, browser details, and requested URLs. Umami Cloud analytics is used to understand page usage, including page views, referrers, device/browser information, and approximate location. The site also loads search, font, and icon resources from third-party services, which receive the usual connection information when your browser requests them.</li>
      </ul>

      <h2>Services involved</h2>
      <p>Depending on the page or feature, requests may go to your PDS, the Coffee &amp; Code PDS resolver, the AT Protocol PLC directory, Bluesky’s public profile service, Constellation for public interaction counts, Cloudflare, Umami Cloud, Google Fonts, or Font Awesome. These services process requests under their own privacy practices.</p>

      <h2>How information is used</h2>
      <p>Information is used to display the publication, authenticate your account, save interactions you request, retrieve public counts and profiles, protect and operate the service, and understand general site usage. Coffee &amp; Code does not sell personal information.</p>

      <h2>Choices and account controls</h2>
      <p>You can use the publication without signing in. You can sign out from the account page and manage or remove records through tools supported by your PDS. Your PDS controls your credentials and repository. Because AT Protocol is a distributed network, Coffee &amp; Code cannot remove copies held by other services.</p>

      <h2>Retention</h2>
      <p>OAuth session information remains in your browser until you sign out or the session expires. Public AT Protocol records remain in your repository until you or your PDS remove them. Hosting logs and analytics are retained according to the settings and policies of the providers that operate those services.</p>

      <h2>Contact</h2>
      <p>For privacy questions, contact the Coffee &amp; Code operator through <a href="https://bsky.app/profile/did:plc:l37td5yhxl2irrzrgvei4qay" target="_blank" rel="noopener noreferrer">Coffee &amp; Code on Bluesky</a>.</p>

      <h2>Changes to this policy</h2>
      <p>This policy may be updated as the site changes. The date above shows when it was most recently revised.</p>
    </article>`;

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

export default pages;
