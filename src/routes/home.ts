import { Hono } from 'hono';
import { Env } from '../types';
import { getPdsEndpoint, fetchArticles } from '../lib/atproto';
import { renderLayout } from '../templates/layout';

const home = new Hono<{ Bindings: Env }>();

home.get('/', async (c) => {
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const posts = await fetchArticles(c.env.AUTHOR_DID, pds);

  const heroPost = posts[0];
  const remainingPosts = posts.slice(1);

  const heroHtml = heroPost
    ? `
    <article class="relative mb-12 p-8 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-900/40 border border-amber-500/20 hover:border-amber-500/40 transition-all shadow-xl">
      <div class="flex items-center gap-2 text-xs font-mono text-amber-500 mb-3">
        <span>LATEST POST</span>
        <span>•</span>
        <time>${heroPost.publishedAt ? new Date(heroPost.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</time>
      </div>
      <h2 class="text-3xl font-extrabold tracking-tight text-white mb-3 hover:text-amber-300 transition-colors">
        <a href="${heroPost.path}">${heroPost.title || 'Untitled'}</a>
      </h2>
      <p class="text-gray-400 line-clamp-3 mb-6 text-base leading-relaxed">
        ${heroPost.description || (heroPost.content ? heroPost.content.substring(0, 200) + '...' : '')}
      </p>
      <a href="${heroPost.path}" class="inline-flex items-center gap-2 text-sm font-semibold text-amber-400 hover:text-amber-300">
        Read Full Entry ➔
      </a>
    </article>
  `
    : '<p class="text-gray-400 py-12 text-center">No posts found on PDS yet.</p>';

  const gridHtml = remainingPosts
    .map((post) => {
      const safeTitle = post.title || 'Untitled';
      const safeDesc = post.description || (post.content ? post.content.substring(0, 120) + '...' : '');
      const safeDate = post.publishedAt
        ? new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';

      return `
    <article class="p-6 rounded-xl bg-gray-900/60 border border-gray-800 hover:border-gray-700 transition-all flex flex-col justify-between group">
      <div>
        <time class="text-xs font-mono text-gray-500 mb-2 block">${safeDate}</time>
        <h3 class="text-xl font-bold text-gray-100 group-hover:text-amber-400 transition-colors mb-2">
          <a href="${post.path}">${safeTitle}</a>
        </h3>
        <p class="text-sm text-gray-400 line-clamp-2 leading-relaxed">${safeDesc}</p>
      </div>
      <a href="${post.path}" class="mt-4 text-xs font-mono text-amber-500 hover:underline inline-block">Read Article →</a>
    </article>
  `;
    })
    .join('');

  const body = `
    <section class="mb-12 text-center md:text-left border-b border-gray-800/60 pb-8">
      <h1 class="text-4xl font-extrabold tracking-tight text-white mb-3">
        ${c.env.PUB_NAME}
      </h1>
      <p class="text-lg text-gray-400 max-w-2xl">
        ${c.env.PUB_DESCRIPTION}
      </p>
    </section>

    ${heroHtml}

    ${
      remainingPosts.length > 0
        ? `
      <h3 class="text-xs font-mono text-gray-500 uppercase tracking-wider mb-6">Archive & Recent Posts</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        ${gridHtml}
      </div>
    `
        : ''
    }
  `;

  return c.html(renderLayout(c, 'Home', body));
});

export default home;
