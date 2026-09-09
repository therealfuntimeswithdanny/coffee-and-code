import { Hono } from 'hono';
import { marked } from 'marked';
import { Env } from '../types';
import { getPdsEndpoint, fetchArticles, proxyImageUrl } from '../lib/atproto';
import { renderLayout } from '../templates/layout';

const posts = new Hono<{ Bindings: Env }>();

marked.setOptions({ breaks: true, gfm: true });

function formatDate(date?: string) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

posts.get('/:rkey', async (c) => {
  const rkey = c.req.param('rkey');
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const allPosts = await fetchArticles(c.env.AUTHOR_DID, pds, c.env.PUBLICATION_RKEY);
  const post = allPosts.find((p) => p.rkey === rkey || p.path === `/post/${rkey}`);

  if (!post) {
    return c.html(renderLayout(c, 'Article Not Found', `
      <section class="not-found">
        <p class="eyebrow">404</p>
        <h1>Article not found</h1>
        <p>The requested story could not be located. It may have moved or no longer be published.</p>
        <div class="not-found__actions">
          <a href="/" class="read-link">Back to publication <span aria-hidden="true">→</span></a>
          <a href="/archive" class="read-link">Browse archive <span aria-hidden="true">→</span></a>
          <a href="/search" class="read-link">Search articles <span aria-hidden="true">→</span></a>
        </div>
      </section>
    `), 404);
  }

  const renderedContent = await marked.parse(post.content || '');
  const htmlContent = renderedContent.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)(")/gi,
    (_match: string, before: string, source: string, after: string) => `${before}${proxyImageUrl(source)}${after}`
  );
  const pageUrl = new URL(c.req.url).toString();

  // Escape HTML entities for safe attribute values
  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const safeTitle = escapeHtml(post.title);
  const safeDescription = escapeHtml(post.description || '');
  const articleMetaTags = `
    <link rel="site.standard.document" href="${escapeHtml(post.uri)}">
    <link rel="site.standard.publication" href="at://${c.env.AUTHOR_DID}/site.standard.publication/${c.env.PUBLICATION_RKEY}">
    <meta name="atproto:uri" content="${escapeHtml(post.uri)}">
    <meta name="atproto:repo" content="${c.env.AUTHOR_DID}">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    ${post.cover ? `<meta property="og:image" content="${escapeHtml(post.cover)}"><meta property="og:image:type" content="image/jpeg"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${safeTitle}"><meta name="twitter:description" content="${safeDescription}"><meta name="twitter:image" content="${escapeHtml(post.cover)}">` : `<meta name="twitter:card" content="summary">`}
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  const body = `
    <article class="article">
      <a href="/" class="article__back">← All stories</a>
      <header class="article__header">
        <p class="eyebrow">${formatDate(post.publishedAt)}</p>
        <h1>${post.title}</h1>
        ${post.description ? `<p class="article__dek">${post.description}</p>` : ''}
      </header>
      ${post.cover ? `<figure class="article__cover"><img src="${post.cover}" alt="" class="story-image"></figure>` : ''}
      <div class="prose">${htmlContent}</div>
      <footer class="article__footer">
        <span>Published on the open web.</span>
        <a href="https://bsky.app/profile/${c.env.AUTHOR_DID}" target="_blank" rel="noopener">View author on Bluesky ↗</a>
      </footer>
    </article>
  `;

  return c.html(renderLayout(c, post.title, body, articleMetaTags));
});

export default posts;
