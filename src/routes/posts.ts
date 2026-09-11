import { Hono } from 'hono';
import { Env } from '../types';
import { getPdsEndpoint, fetchArticles, proxyImageUrl } from '../lib/atproto';
import { renderLayout } from '../templates/layout';
import { renderContent, processImages, enhanceHtmlStructure } from '../lib/contentRenderer';

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

posts.get('/', (c) => c.redirect('/'));

posts.get('/:rkey', async (c) => {
  const rkey = c.req.param('rkey');
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const allPosts = await fetchArticles(c.env.AUTHOR_DID, pds);
  const post = allPosts.find((p) => p.rkey === rkey || p.path === `/post/${rkey}`);

  if (!post) {
    return c.html(renderLayout(c, 'Article Not Found', `
      <section class="not-found">
        <p class="eyebrow">404</p>
        <h1>Article not found</h1>
        <p>The requested story could not be located. It may have moved or no longer be published.</p>
        <div class="not-found__actions">
          <a href="/" class="read-link">Back to publication <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
          <a href="/archive" class="read-link">Browse archive <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
          <a href="/search" class="read-link">Search articles <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
        </div>
      </section>
    `), 404);
  }

  // Render content based on detected format
  const renderedContent = await renderContent(post.content || '', post.format, post.mimeType);

  // Process images to use proxy URLs
  const requestOrigin = new URL(c.req.url).origin;
  const processImageSource = (source: string) => {
    if (source.startsWith('/api/blob/')) {
      const cid = source.replace(/^\/api\/blob\//, '');
      const blobUrl = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(c.env.AUTHOR_DID)}&cid=${encodeURIComponent(cid)}`;
      return proxyImageUrl(blobUrl, requestOrigin);
    }

    return proxyImageUrl(source, requestOrigin);
  };

  const processedContent = processImages(renderedContent, processImageSource);

  // Enhance HTML structure with prose classes for better styling
  const htmlContent = enhanceHtmlStructure(processedContent);
  const pageUrl = new URL(c.req.url).toString();

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

  // Extract first image from content or use cover
  const getImage = () => {
    if (post.cover) return post.cover;
    const match = post.content.match(/!\[.*?\]\((https?:\/\/[^)\s]+)/);
    return match ? match[1] : undefined;
  };

  const articleDescription = getDescription();
  const articleSubtitle = articleDescription?.trim() || '';
  const safeTitle = escapeHtml(post.title);
  const safeDescription = escapeHtml(articleDescription);
  const previewImage = getImage();
  const pageOrigin = new URL(pageUrl).origin;
  const proxiedPreviewImage = previewImage ? proxyImageUrl(previewImage, pageOrigin) : undefined;
  const ogImage = proxiedPreviewImage || `${pageOrigin}/og.png`;
  const proxiedCoverImage = post.cover ? proxyImageUrl(post.cover, pds) : undefined;
  const articleMetaTags = `
    <link rel="site.standard.document" href="${escapeHtml(post.uri)}">
    <meta name="atproto:uri" content="${escapeHtml(post.uri)}">
    <meta name="atproto:repo" content="${c.env.AUTHOR_DID}">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <meta property="og:image" content="${escapeHtml(ogImage)}">
    <meta property="og:image:type" content="${previewImage ? 'image/jpeg' : 'image/png'}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTitle}">
    <meta name="twitter:description" content="${safeDescription}">
    <meta name="twitter:image" content="${escapeHtml(ogImage)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  const body = `
    <article class="article">
      <a href="/" class="article__back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> All stories</a>
      <header class="article__header">
        <p class="eyebrow">${formatDate(post.publishedAt)}</p>
        <h1>${post.title}</h1>
        ${articleSubtitle ? `<p class="article__dek">${escapeHtml(articleSubtitle)}</p>` : ''}
      </header>
      ${proxiedCoverImage ? `<figure class="article__cover"><img src="${proxiedCoverImage}" alt="" class="story-image"></figure>` : ''}
      <div class="prose">${htmlContent}</div>
      <section class="article__comments" aria-labelledby="comments-heading">
        <h2 id="comments-heading">Comments</h2>
        <sequoia-comments style="--sequoia-fg-color: var(--ink); --sequoia-bg-color: var(--paper-deep); --sequoia-border-color: var(--line); --sequoia-accent-color: var(--accent); --sequoia-secondary-color: var(--muted); --sequoia-border-radius: 0;"></sequoia-comments>
      </section>
      <footer class="article__footer">
        <a href="https://pdsls.dev/${escapeHtml(post.uri)}" target="_blank" rel="noopener">View on PDSls <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
      </footer>
    </article>
  `;

  return c.html(renderLayout(c, post.title, body, articleMetaTags));
});

export default posts;
