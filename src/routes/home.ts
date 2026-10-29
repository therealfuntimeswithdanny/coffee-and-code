import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import { getPdsEndpoint, fetchArticles, isPdsAvailable, proxyImageUrl, proxyAvatarUrl } from '../lib/atproto';
import { renderLayout } from '../templates/layout';

const home = new Hono<{ Bindings: Env }>();

function formatDate(date?: string) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function excerpt(post: StandardDocument, length = 180) {
  const text = post.description?.trim() || '';
  if (!text) return '';
  return text.length > length ? `${text.substring(0, length).trimEnd()}…` : text;
}

function articleMeta(post: StandardDocument) {
  return `<span class="article-meta" data-reaction-subject="${escapeHtml(post.uri)}"><span>${formatDate(post.publishedAt)}</span><span class="view-counter">Reads <span data-at-view-count>—</span></span><span class="comment-counter">Comments <span data-at-comment-count>—</span></span></span>`;
}

function authorByline(post: StandardDocument) {
  if (!post.author) return '';
  const author = post.author;
  const name = author.displayName || author.handle;
  return `<a class="home-post-author" href="/author/${encodeURIComponent(author.handle)}">
    ${author.avatar ? `<img src="${escapeHtml(proxyAvatarUrl(author.avatar))}" alt="" width="24" height="24" loading="lazy" decoding="async">` : '<span class="home-post-author__placeholder" aria-hidden="true"></span>'}
    <span data-author-verification-did="${escapeHtml(author.did)}">${escapeHtml(name)}</span>
  </a>`;
}

function heroArticleMeta(post: StandardDocument) {
  if (!post.author) return articleMeta(post);
  const authorName = post.author.displayName || post.author.handle;
  const authorLink = `/author/${encodeURIComponent(post.author.handle)}`;
  return `<span class="article-meta article-meta--byline" data-reaction-subject="${escapeHtml(post.uri)}"><span>Written by <a href="${authorLink}" data-author-verification-did="${escapeHtml(post.author.did)}">${escapeHtml(authorName)}</a> on ${formatDate(post.publishedAt)}</span><span class="view-counter">Reads <span data-at-view-count>—</span></span><span class="comment-counter">Comments <span data-at-comment-count>—</span></span></span>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

home.get('/', async (c) => {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const posts = await fetchArticles(pds, c.env.OWNER_DID);
  const pdsAvailable = posts.length > 0 || await isPdsAvailable(pds);
  const pinnedPosts = posts
    .filter((post) => post.pinnedOrder !== undefined)
    .sort((a, b) => a.pinnedOrder! - b.pinnedOrder!);
  const heroPost = posts[0];
  const pinnedForHome = pinnedPosts.filter((post) => post.uri !== heroPost?.uri).slice(0, 3);
  const excludedUris = new Set([heroPost?.uri, ...pinnedForHome.map((post) => post.uri)]);
  const sidePosts = posts.filter((post) => !excludedUris.has(post.uri)).slice(0, 4);
  sidePosts.forEach((post) => excludedUris.add(post.uri));
  const archivePosts = posts.filter((post) => !excludedUris.has(post.uri)).slice(0, 9);
  const displayedPosts = [heroPost, ...sidePosts, ...pinnedForHome, ...archivePosts]
    .filter((post): post is StandardDocument => Boolean(post));
  const homeBaseUrl = new URL(c.req.url).origin;

  const proxiedCover = (source?: string, preset = 'feed_fullsize') => (source ? proxyImageUrl(source, pds || homeBaseUrl, preset) : source);

  const emptyMessage = pdsAvailable
    ? 'No stories have been published yet. Please check back soon.'
    : 'We can’t reach the Coffee &amp; Code PDS right now. Please try again shortly.';
  const heroHtml = heroPost
    ? `
      <div class="lead-column">
        <article class="lead-story">
          <a class="lead-image${heroPost.cover ? '' : ' lead-image--placeholder'}" href="${heroPost.path}" aria-label="Read ${heroPost.title || 'Untitled'}">
            ${heroPost.cover ? `<img src="${proxiedCover(heroPost.cover)}" alt="" class="story-image" width="1200" height="686" sizes="(max-width: 760px) 100vw, 700px" fetchpriority="high" decoding="async">` : '<span>Latest dispatch</span>'}
          </a>
          <div class="lead-story__content">
            <h2><a href="${heroPost.path}">${heroPost.title || 'Untitled'}</a></h2>
            ${excerpt(heroPost, 260) ? `<p class="lead-story__summary">${excerpt(heroPost, 260)}</p>` : ''}
            <div class="story-footer">${heroArticleMeta(heroPost)} <a href="${heroPost.path}" class="read-link">Read story <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div>
          </div>
        </article>
      </div>`
    : `<p class="empty-state">${emptyMessage}</p>`;

  const pinnedHtml = pinnedForHome.length ? `<section class="home-pinned" aria-labelledby="home-pinned-title">
    <div class="section-heading"><span id="home-pinned-title">Pinned stories</span></div>
    <div class="home-pinned__grid">${pinnedForHome.map((post) => `
      <article class="home-pinned__card">
        <a class="home-pinned__image${post.cover ? '' : ' story-image--placeholder'}" href="${escapeHtml(post.path)}" aria-label="Read ${escapeHtml(post.title || 'Untitled')}">
          ${post.cover ? `<img src="${escapeHtml(proxiedCover(post.cover, 'feed_medium') || '')}" alt="" class="story-image" width="600" height="340" loading="lazy" decoding="async">` : '<span aria-hidden="true">Pinned story</span>'}
        </a>
        <div class="home-pinned__content"><p class="eyebrow">Pinned</p><h3><a href="${escapeHtml(post.path)}">${escapeHtml(post.title || 'Untitled')}</a></h3>${authorByline(post)}</div>
      </article>`).join('')}</div>
  </section>` : '';

  const sideHtml = sidePosts.length
    ? sidePosts
        .map(
          (post) => `
            <article class="side-story">
              <a class="side-story__image${post.cover ? '' : ' story-image--placeholder'}" href="${post.path}" aria-label="Read ${post.title || 'Untitled'}">
                ${post.cover ? `<img src="${proxiedCover(post.cover, 'feed_medium')}" alt="" class="story-image" width="400" height="275" sizes="100px" loading="lazy" decoding="async">` : '<span aria-hidden="true">C&amp;C</span>'}
              </a>
              <div>
                <h3><a href="${post.path}">${post.title || 'Untitled'}</a></h3>
                ${authorByline(post)}
                ${articleMeta(post)}
              </div>
            </article>`
        )
        .join('')
    : `<p class="side-empty">${emptyMessage}</p>`;

  const archiveHtml = archivePosts
    .map(
      (post) => `
        <article class="archive-story">
          <a class="archive-story__image${post.cover ? '' : ' story-image--placeholder'}" href="${post.path}" aria-label="Read ${post.title || 'Untitled'}">
            ${post.cover ? `<img src="${proxiedCover(post.cover, 'feed_medium')}" alt="" class="story-image" width="1200" height="686" sizes="(max-width: 760px) 100vw, 320px" loading="lazy" decoding="async">` : '<span aria-hidden="true">C&amp;C</span>'}
          </a>
          <div>
            <h3><a href="${post.path}">${post.title || 'Untitled'}</a></h3>
            ${authorByline(post)}
            ${excerpt(post, 130) ? `<p>${excerpt(post, 130)}</p>` : ''}
          </div>
          <div class="archive-story__footer">${articleMeta(post)} <a href="${post.path}" class="read-link">Read <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div>
        </article>`
    )
    .join('');

  const authorsByDid = new Map<string, { author: NonNullable<StandardDocument['author']>; postCount: number }>();
  displayedPosts.forEach((post) => {
    if (!post.author) return;
    const existing = authorsByDid.get(post.author.did);
    authorsByDid.set(post.author.did, {
      author: post.author,
      postCount: (existing?.postCount || 0) + 1,
    });
  });
  const authorsHtml = [...authorsByDid.values()].map(({ author, postCount }) => {
    const name = author.displayName || author.handle;
    return `<a class="author-card" href="/author/${encodeURIComponent(author.handle)}">
      ${author.avatar ? `<img src="${escapeHtml(proxyImageUrl(author.avatar))}" alt="" class="author-card__avatar" width="64" height="64" loading="lazy" decoding="async">` : '<span class="author-card__avatar author-card__avatar--placeholder" aria-hidden="true"></span>'}
      <span class="author-card__details"><strong data-author-verification-did="${escapeHtml(author.did)}">${escapeHtml(name)}</strong><span>@${escapeHtml(author.handle)}</span><span>${postCount} ${postCount === 1 ? 'story' : 'stories'}</span></span>
    </a>`;
  }).join('');

  const body = `
    <section class="front-page" aria-label="Latest stories">
      <div class="section-heading"><span>Latest</span><span>${pdsAvailable ? `${posts.length} ${posts.length === 1 ? 'story' : 'stories'}` : 'Temporarily unavailable'}</span></div>
      <div class="front-page__grid">
        ${heroHtml}
        <aside class="recent-stories" aria-label="More recent stories">
          ${sideHtml}
        </aside>
      </div>
      ${pinnedHtml}
    </section>

    ${authorsHtml ? `<section class="home-authors" aria-labelledby="home-authors-title">
      <div class="section-heading"><span id="home-authors-title">Meet the authors</span><a href="/authors" class="read-link">All authors <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div>
      <div class="author-grid">${authorsHtml}</div>
    </section>` : ''}

    ${
      archivePosts.length
        ? `<section class="archive-section" aria-label="More stories">
            <div class="section-heading"><span>More stories</span></div>
            <div class="archive-grid">${archiveHtml}</div>
          <div class="archive-section__footer"><a href="/archive" class="read-link">View all stories <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div>
          </section>`
        : ''
    }

    <section class="writers-callout" aria-labelledby="writers-callout-title">
      <div>
        <p class="eyebrow">Contribute</p>
        <h2 id="writers-callout-title">We're looking for writers</h2>
        <p>Coffee &amp; Code is made possible thanks to you! One way you can contribute is to write for us!</p>
      </div>
      <a href="/become-an-author" class="read-link">Learn how to contribute as a writer <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
    </section>
  `;

  // Open Graph tags for the publication
  const pageUrl = new URL(c.req.url).toString();
  const metaTags = `
    <meta property="og:title" content="Coffee and Code.">
    <meta property="og:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <meta property="og:image" content="${escapeHtml(pageUrl.split('/').slice(0, 3).join('/'))}/og.png">
    <meta property="og:image:type" content="image/png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Coffee and Code.">
    <meta name="twitter:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta name="twitter:image" content="${escapeHtml(pageUrl.split('/').slice(0, 3).join('/'))}/og.png">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
    <link rel="alternate" href="at://did:plc:l37td5yhxl2irrzrgvei4qay/site.standard.publication/3m3lav73ujc27">
    <link rel="site.standard.publication" href="at://did:plc:l37td5yhxl2irrzrgvei4qay/site.standard.publication/3m3lav73ujc27">
  `;

  return c.html(renderLayout(c, 'Tech News & Analysis', body, metaTags, 'Home | Coffee & Code'));
});

export default home;
