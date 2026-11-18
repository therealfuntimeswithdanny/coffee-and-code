import { Hono, type Context } from 'hono';
import { Env } from '../types';
import { getPdsEndpoint, fetchArticles, fetchArticleByPath, fetchPostMetadata, proxyImageUrl, proxyAvatarUrl } from '../lib/atproto';
import { renderLayout, browserRunScreenshotUrl } from '../templates/layout';
import { renderContent, renderHtmlAsMarkdown, processImages, enhanceHtmlStructure, toPlainText, readingTimeMinutes } from '../lib/contentRenderer';
import { routeExternalLinks, externalLinkUrl } from '../lib/externalLinks';

const posts = new Hono<{ Bindings: Env }>();

function formatDate(date?: string) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

async function renderPost(
  c: Context<{ Bindings: Env }>,
  rkey: string,
  requestedHandle?: string,
  requestedPath?: string,
) {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const allPosts = await fetchArticles(pds, c.env.OWNER_DID);
  const candidates = allPosts.filter((p) => p.rkey === rkey);
  const post = (requestedPath
    ? candidates.find((item) => item.path === requestedPath || item.alternatePaths?.includes(requestedPath))
    : undefined)
    || (!requestedHandle
    ? candidates[0]
    : candidates.find((item) => {
        const canonicalDid = item.author?.did || item.repoDid || '';
        return canonicalDid.toLowerCase() === requestedHandle.toLowerCase()
          || item.author?.handle.toLowerCase() === requestedHandle.toLowerCase();
      }) || (candidates.length === 1 ? candidates[0] : undefined))
    || (requestedHandle
      ? await fetchArticleByPath(requestedHandle, rkey, pds, c.env.OWNER_DID)
      : undefined);

  if (!post) {
    return c.html(renderLayout(c, 'Article Not Found', `
      <section class="not-found">
        <h1>Article not found</h1>
        <p>The requested story could not be located. It may have moved or no longer be published.</p>
        <div class="not-found__actions">
          <a href="/" class="read-link">Back to publication <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
          <a href="/archive" class="read-link">Browse archive <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
          <button type="button" class="read-link search-button-link" data-open-search>Search articles <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
        </div>
      </section>
    `), 404);
  }

  const requestUrl = new URL(c.req.url);
  if (requestUrl.pathname !== post.path) {
    return c.redirect(`${post.path}${requestUrl.search}`, 301);
  }

  const postMetadata = post.metadata
    || await fetchPostMetadata(post.pdsUrl || pds, post.repoDid || c.env.OWNER_DID, post.rkey);

  const postTagKeys = new Set((post.tags || []).map((tag) => tag.toLocaleLowerCase()));
  const recommendations = allPosts
    .filter((item) => item.path !== post.path && item.tags?.some((tag) => postTagKeys.has(tag.toLocaleLowerCase())))
    .map((item) => ({
      post: item,
      sharedTagCount: item.tags?.filter((tag) => postTagKeys.has(tag.toLocaleLowerCase())).length || 0,
    }))
    .sort((a, b) => b.sharedTagCount - a.sharedTagCount
      || (Date.parse(b.post.publishedAt) || 0) - (Date.parse(a.post.publishedAt) || 0))
    .slice(0, 3)
    .map(({ post: item }) => item);

  // Render content based on detected format
  const renderedContent = await renderContent(post.content || '', post.format, post.mimeType);

  // Process images to use proxy URLs
  const requestOrigin = new URL(c.req.url).origin;
  const processImageSource = (source: string) => {
    if (source.startsWith('/api/blob/')) {
      const cid = source.replace(/^\/api\/blob\//, '');
      const sourceDid = post.repoDid || c.env.OWNER_DID;
      const sourcePds = post.pdsUrl || pds;
      const blobUrl = `${sourcePds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(sourceDid)}&cid=${encodeURIComponent(cid)}`;
      return proxyImageUrl(blobUrl, requestOrigin);
    }

    return proxyImageUrl(source, requestOrigin);
  };

  const processedContent = processImages(renderedContent, processImageSource);

  const viewMode = requestUrl.searchParams.get('viewMode');
  if (viewMode === 'markdown') {
    const markdownBody = [
      `# ${post.title}`,
      post.description?.trim(),
      renderHtmlAsMarkdown(processedContent),
    ].filter(Boolean).join('\n\n');
    return c.body(markdownBody, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  }

  // Enhance HTML structure with prose classes for better styling
  const htmlContent = routeExternalLinks(enhanceHtmlStructure(processedContent));
  const pageUrl = new URL(c.req.url).toString();
  const browserRun = viewMode === 'browseRun' || requestUrl.searchParams.get('browserRun') === 'true';

  // Escape HTML entities for safe attribute values
  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Auto-generate description from content if missing
  const getDescription = () => {
    return post.description?.trim() || '';
  };

  const articleDescription = getDescription();
  const articleSubtitle = articleDescription?.trim() || '';
  const tagLinks = (post.tags || []).map((tag) => `
    <a class="article-tag" href="/tags?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`).join('');
  const authorLink = post.author ? `/author/${encodeURIComponent(post.author.handle)}` : '';
  const authorName = post.author?.displayName || post.author?.handle || '';
  const authorAvatar = post.author?.avatar ? escapeHtml(proxyAvatarUrl(post.author.avatar)) : '';
  const readingTime = readingTimeMinutes(post.content || '', post.mimeType);
  const safeTitle = escapeHtml(post.title);
  const safeDescription = escapeHtml(articleDescription);
  const pageOrigin = new URL(pageUrl).origin;
  const ogImage = post.cover
    ? proxyImageUrl(post.cover, pageOrigin)
    : browserRunScreenshotUrl(post.path);
  const proxiedCoverImage = post.cover ? escapeHtml(proxyImageUrl(post.cover, pds, 'wide_medium')) : undefined;
  const proxiedCoverSrcSet = post.cover
    ? `${escapeHtml(proxyImageUrl(post.cover, pds, 'wide_small'))} 640w, ${escapeHtml(proxyImageUrl(post.cover, pds, 'wide_medium'))} 1280w`
    : undefined;
  const recommendationHtml = recommendations.map((item) => {
    const dek = item.description?.trim() || toPlainText(item.content || '');
    const dekExcerpt = dek.length > 125 ? `${dek.slice(0, 122).trimEnd()}…` : dek;
    return `
    <article class="recommendation-card${item.cover ? '' : ' recommendation-card--no-cover'}">
      ${item.cover ? `<a class="recommendation-card__image" href="${escapeHtml(item.path)}" aria-label="Read ${escapeHtml(item.title || 'Untitled')}">
        <img src="${escapeHtml(proxyImageUrl(item.cover, pds, 'feed_small'))}" alt="" class="story-image" width="600" height="340" loading="lazy" decoding="async">
      </a>` : ''}
      <div class="recommendation-card__body"><h3><a href="${escapeHtml(item.path)}">${escapeHtml(item.title || 'Untitled')}</a></h3>
        ${dekExcerpt ? `<p>${escapeHtml(dekExcerpt)}</p>` : ''}
        <span class="recommendation-card__date">${formatDate(item.publishedAt)}</span>
      </div>
    </article>`;
  }).join('');
  const relatedRail = recommendations.map((item) => `
    <li><a href="${escapeHtml(item.path)}">${escapeHtml(item.title || 'Untitled')}</a></li>`).join('');
  const authorsByDid = new Map<string, NonNullable<typeof allPosts[number]['author']>>();
  allPosts.forEach((item) => {
    if (item.author) authorsByDid.set(item.author.did, item.author);
  });
  const railAuthors = [...authorsByDid.values()]
    .sort((a, b) => (a.displayName || a.handle).localeCompare(b.displayName || b.handle))
    .slice(0, 6)
    .map((author) => `<li><a class="article-rail__author" href="/author/${encodeURIComponent(author.handle)}">${author.avatar ? `<img src="${escapeHtml(proxyAvatarUrl(author.avatar, 'avatar_thumb'))}" alt="" width="36" height="36" loading="lazy">` : '<span class="article-rail__author-placeholder" aria-hidden="true"></span>'}<span><strong data-author-verification-did="${escapeHtml(author.did)}">${escapeHtml(author.displayName || author.handle)}</strong><small>@${escapeHtml(author.handle)}</small></span></a></li>`)
    .join('');
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: post.title,
    description: articleDescription || undefined,
    datePublished: post.publishedAt,
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    image: [ogImage],
    author: post.author
      ? {
          '@type': 'Person',
          name: authorName,
          url: `${pageOrigin}/author/${encodeURIComponent(post.author.handle)}`,
        }
      : { '@type': 'Organization', name: c.env.PUB_NAME },
    publisher: {
      '@type': 'Organization',
      name: c.env.PUB_NAME,
      url: pageOrigin,
      logo: { '@type': 'ImageObject', url: `${pageOrigin}/favicon.png` },
    },
  };
  const structuredDataJson = JSON.stringify(structuredData).replace(/</g, '\\u003c');
  const sourceLabel = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '') + (parsed.pathname === '/' ? '' : parsed.pathname);
    } catch {
      return url;
    }
  };
  const sourcesHtml = postMetadata && (postMetadata.sources.length || postMetadata.backlink)
    ? `<section class="article-sources" aria-labelledby="article-sources-title">
        <h2 id="article-sources-title">Sources</h2>
        <ul>${postMetadata.sources.map((source) => `
          <li><a href="${escapeHtml(externalLinkUrl(source))}" target="_blank" rel="noopener">${escapeHtml(sourceLabel(source))} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a></li>`).join('')}
          ${postMetadata.backlink ? `<li><a href="${escapeHtml(externalLinkUrl(postMetadata.backlink.startsWith('at://') ? `https://pdsls.dev/${postMetadata.backlink}` : postMetadata.backlink))}" target="_blank" rel="noopener">${postMetadata.backlink.startsWith('at://') ? 'Original document' : `Source document · ${escapeHtml(sourceLabel(postMetadata.backlink))}`} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a></li>` : ''}
        </ul>
      </section>`
    : '';
  const shareUrl = encodeURIComponent(pageUrl);
  const shareText = encodeURIComponent(post.title);
  const engagementHtml = `
    <section class="article-engagement" data-reaction-subject="${escapeHtml(post.uri)}" data-view-subject="${escapeHtml(post.uri)}" aria-label="Story reactions and views">
      <div class="article-reactions__buttons" aria-label="React to this story">
        <span class="reaction-button engagement-stat"><i class="fa-solid fa-book-open" aria-hidden="true"></i> Reads <span class="reaction-count" data-at-view-count>—</span></span>
        <button type="button" class="reaction-button" data-reaction="like" aria-pressed="false"><i class="fa-regular fa-thumbs-up" aria-hidden="true"></i> Like <span class="reaction-count" data-reaction-count="like">—</span></button>
        <button type="button" class="reaction-button" data-reaction="dislike" aria-pressed="false"><i class="fa-regular fa-thumbs-down" aria-hidden="true"></i> Dislike <span class="reaction-count" data-reaction-count="dislike">—</span></button>
        <button type="button" class="reaction-button" data-save-post aria-pressed="false"><i class="fa-regular fa-bookmark" aria-hidden="true"></i> Save <span class="reaction-count" data-save-count>—</span></button>
        <button type="button" class="reaction-button" data-add-to-list><i class="fa-regular fa-rectangle-list" aria-hidden="true"></i> Add to list</button>
        <a class="reaction-button" href="#comments"><i class="fa-regular fa-comment" aria-hidden="true"></i> Comments <span class="reaction-count" data-at-comment-count>—</span></a>
      </div>
      <div class="article-share" data-share-title="${safeTitle}" data-share-url="${escapeHtml(pageUrl)}">
        <span class="article-share__label">Share this story</span>
        <div class="article-share__buttons" aria-label="Share this story">
          <a class="reaction-button" href="https://app.coffeencode.cc/intent?text=${shareText}%20${shareUrl}" target="_blank" rel="noopener" aria-label="Share on Bluesky"><i class="fa-brands fa-bluesky" aria-hidden="true"></i> Bluesky</a>
          <a class="reaction-button" href="https://www.reddit.com/submit?url=${shareUrl}&title=${shareText}" target="_blank" rel="noopener" aria-label="Share on Reddit"><i class="fa-brands fa-reddit-alien" aria-hidden="true"></i> Reddit</a>
          <a class="reaction-button" href="https://www.threads.net/intent/post?text=${shareText}%20${shareUrl}" target="_blank" rel="noopener" aria-label="Share on Threads"><i class="fa-brands fa-threads" aria-hidden="true"></i> Threads</a>
          <a class="reaction-button" href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" rel="noopener" aria-label="Share on Facebook"><i class="fa-brands fa-facebook-f" aria-hidden="true"></i> Facebook</a>
          <button type="button" class="reaction-button" data-share-native hidden><i class="fa-solid fa-share-nodes" aria-hidden="true"></i> Share</button>
          <button type="button" class="reaction-button" data-share-copy><i class="fa-solid fa-link" aria-hidden="true"></i> Copy link</button>
        </div>
      </div>
      <span class="article-reactions__status" aria-live="polite"></span>
    </section>`;
  const articleMetaTags = `
    <link rel="site.standard.document" href="${escapeHtml(post.uri)}">
    <link rel="site.standard.publication" href="at://did:plc:l37td5yhxl2irrzrgvei4qay/site.standard.publication/3myy27riph22b">
    <meta name="atproto:uri" content="${escapeHtml(post.uri)}">
    <meta name="atproto:repo" content="${escapeHtml(post.repoDid || c.env.OWNER_DID)}">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta name="description" content="${safeDescription}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <meta property="og:image" content="${escapeHtml(ogImage)}">
    <meta property="og:image:type" content="${post.cover ? 'image/jpeg' : 'image/png'}">
    <meta property="article:published_time" content="${escapeHtml(post.publishedAt)}">
    <meta property="article:author" content="${escapeHtml(authorName || c.env.PUB_NAME)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTitle}">
    <meta name="twitter:description" content="${safeDescription}">
    <meta name="twitter:image" content="${escapeHtml(ogImage)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
    <script type="application/ld+json">${structuredDataJson}</script>
  `;

  const body = `
    <div class="article-layout">
    <article class="article">
      <a href="/" class="article__back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> All stories</a>
      <header class="article__header">
        <h1>${safeTitle}</h1>
        ${articleSubtitle ? `<p class="article__dek">${escapeHtml(articleSubtitle)}</p>` : ''}
        ${post.author ? `<a class="article__author" href="${authorLink}">${authorAvatar ? `<img src="${authorAvatar}" alt="" class="article__author-avatar" width="36" height="36" loading="lazy" decoding="async">` : '<span class="article__author-avatar article__author-avatar--placeholder" aria-hidden="true"></span>'}<span>Written by <span data-author-verification-did="${escapeHtml(post.author.did)}">${escapeHtml(authorName)}</span> on ${formatDate(post.publishedAt)}</span></a>` : ''}
        ${readingTime ? `<p class="article__reading-time">${readingTime} min read</p>` : ''}
        ${tagLinks ? `<nav class="article-tags" aria-label="Article tags">${tagLinks}</nav>` : ''}
      </header>
      ${proxiedCoverImage ? `<figure class="article__cover"><img src="${proxiedCoverImage}" srcset="${proxiedCoverSrcSet}" alt="" class="story-image" width="1200" height="667" sizes="(max-width: 860px) 100vw, 820px" fetchpriority="high" decoding="async"></figure>` : ''}
      <div class="prose">${htmlContent}</div>
      ${sourcesHtml}
      <section class="article__comments" id="comments">
        <sequoia-comments document-uri="${escapeHtml(post.uri)}" style="--sequoia-fg-color: var(--ink); --sequoia-bg-color: var(--paper-deep); --sequoia-border-color: var(--line); --sequoia-accent-color: var(--accent); --sequoia-secondary-color: var(--muted); --sequoia-border-radius: 0;"></sequoia-comments>
      </section>
      <dialog class="list-dialog" data-list-dialog aria-labelledby="list-dialog-title">
        <h2 id="list-dialog-title">Add to a list</h2>
        <p class="list-dialog__status" data-list-dialog-status role="status" aria-live="polite">Loading your lists…</p>
        <ul class="list-dialog__lists" data-list-dialog-lists></ul>
        <p class="list-dialog__empty" data-list-dialog-empty hidden>You have no lists yet. <a href="/account/list">Create a list</a> first, then add this story to it.</p>
        <div class="list-dialog__actions"><button type="button" class="auth-signout" data-list-dialog-close>Done</button></div>
      </dialog>
      <footer class="article__footer">
        <a href="${escapeHtml(externalLinkUrl(`https://pdsls.dev/${post.uri}`))}" target="_blank" rel="noopener">View on PDSls <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
      </footer>
    </article>
    <aside class="article-rail" aria-label="Story details">${engagementHtml}${relatedRail ? `<section aria-labelledby="article-related-title"><h2 id="article-related-title">Related posts</h2><ul>${relatedRail}</ul><a href="/tags" class="read-link">Explore all tags <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></section>` : ''}${railAuthors ? `<section class="article-rail__authors" aria-labelledby="article-authors-title"><h2 id="article-authors-title">Authors</h2><ul>${railAuthors}</ul><a href="/authors" class="read-link">Meet all authors <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></section>` : ''}</aside>
    </div>
    ${recommendations.length ? `<section class="recommendations" aria-labelledby="recommendations-title"><div class="section-heading"><span id="recommendations-title">Continue reading</span><a href="/archive">All stories <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div><div class="recommendations__grid">${recommendationHtml}</div></section>` : ''}
  `;

  return c.html(renderLayout(c, post.title, body, articleMetaTags, undefined, browserRun, { comments: true }));
}

posts.get('/', (c) => c.redirect('/'));
posts.get('/post/:rkey', (c) => renderPost(c, c.req.param('rkey')));
// Author-scoped post URLs are canonical; legacy /post/... routes redirect here.
posts.get('/author/:handle/:rkey', (c) => renderPost(
  c,
  c.req.param('rkey'),
  c.req.param('handle'),
));
posts.get('/post/:handle/:rkey', (c) => renderPost(
  c,
  c.req.param('rkey'),
  c.req.param('handle'),
));
posts.get('/:rkey', (c) => renderPost(c, c.req.param('rkey'), undefined, new URL(c.req.url).pathname));
posts.get('/:handle/:rkey', (c) => renderPost(
  c,
  c.req.param('rkey'),
  c.req.param('handle'),
  new URL(c.req.url).pathname,
));
posts.get('/*', (c) => {
  const path = new URL(c.req.url).pathname;
  const rkey = path.split('/').filter(Boolean).at(-1);
  if (!rkey) return c.notFound();
  return renderPost(c, decodeURIComponent(rkey), undefined, path);
});

export default posts;
