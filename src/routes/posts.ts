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
  const allPosts = await fetchArticles(c.env.AUTHOR_DID, pds);
  const post = allPosts.find((p) => p.rkey === rkey || p.path === `/post/${rkey}`);

  if (!post) {
    return c.html(renderLayout(c, 'Article Not Found', `
      <section class="not-found">
        <p class="eyebrow">404</p>
        <h1>Article not found</h1>
        <p>The requested story could not be located. It may have moved or no longer be published.</p>
        <a href="/" class="read-link">Back to publication <span aria-hidden="true">→</span></a>
      </section>
    `), 404);
  }

  const renderedContent = await marked.parse(post.content || '');
  const htmlContent = renderedContent.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)(")/gi,
    (_match: string, before: string, source: string, after: string) => `${before}${proxyImageUrl(source)}${after}`
  );
  const pageUrl = new URL(c.req.url).toString();
  const articleMetaTags = `
    <link rel="site.standard.document" href="${post.uri}">
    <meta name="atproto:uri" content="${post.uri}">
    <meta property="og:title" content="${post.title}">
    <meta property="og:description" content="${post.description || ''}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${pageUrl}">
    ${post.cover ? `<meta property="og:image" content="${post.cover}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${post.cover}">` : ''}
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
