import { Hono } from 'hono';
import { marked } from 'marked';
import { Env } from '../types';
import { getPdsEndpoint, fetchArticles, proxyImageUrl } from '../lib/atproto';
import { renderLayout } from '../templates/layout';

const posts = new Hono<{ Bindings: Env }>();

marked.setOptions({ breaks: true, gfm: true });

posts.get('/:rkey', async (c) => {
  const rkey = c.req.param('rkey');
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const allPosts = await fetchArticles(c.env.AUTHOR_DID, pds);

  const post = allPosts.find((p) => p.rkey === rkey || p.path === `/post/${rkey}`);

  if (!post) {
    return c.html(
      renderLayout(
        c,
        '404 - Article Not Found',
        `
      <div class="text-center py-20">
        <h1 class="text-4xl font-bold text-amber-500 mb-4">404</h1>
        <p class="text-gray-400 mb-6">The requested article could not be located on the ATProto PDS.</p>
        <a href="/" class="text-amber-400 hover:underline font-mono">← Back to Publication</a>
      </div>
    `
      ),
      404
    );
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
    <article class="max-w-3xl mx-auto">
      <a href="/" class="text-xs font-mono text-amber-500 hover:underline mb-8 inline-block">← Back to ${c.env.PUB_NAME}</a>
      
      <header class="mb-8 pb-8 border-b border-gray-800">
        <time class="text-xs font-mono text-gray-500 mb-3 block">
          Published ${post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''}
        </time>
        <h1 class="text-4xl font-extrabold text-white tracking-tight mb-4 leading-tight">
          ${post.title}
        </h1>
        <div class="flex items-center gap-3 text-xs text-gray-400 font-mono">
          <span>Author DID: ${c.env.AUTHOR_DID.substring(0, 16)}...</span>
        </div>
      </header>

      ${post.cover ? `<img src="${post.cover}" alt="Cover image" class="w-full rounded-xl mb-8 border border-gray-800 object-cover max-h-96">` : ''}

      <div class="prose">
        ${htmlContent}
      </div>

      <footer class="mt-12 pt-6 border-t border-gray-900 text-xs font-mono text-gray-500 flex justify-between items-center">
        <span>Record URI: ${post.uri}</span>
        <a href="https://bsky.app" target="_blank" class="text-amber-500 hover:underline">Verify on ATProto ↗</a>
      </footer>
    </article>
  `;

  return c.html(renderLayout(c, post.title, body, articleMetaTags));
});

export default posts;
