import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import { getPdsEndpoint, fetchArticles } from '../lib/atproto';
import { renderLayout } from '../templates/layout';

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
  const text = post.description || post.content || '';
  return text.length > 150 ? `${text.substring(0, 150).trimEnd()}…` : text;
}

pages.get('/about', (c) => {
  const body = `
    <article class="max-w-2xl mx-auto py-8" id="how-this-site-works">
      <h1 class="text-3xl font-bold text-white mb-4">About ${c.env.PUB_NAME}</h1>
      <p class="text-gray-300 leading-relaxed mb-4">
        ${c.env.PUB_NAME} is an independent, decentralized technology publication built on top of Cloudflare Workers and the standard.site protocol.
      </p>
      <p class="text-gray-400 leading-relaxed">
        All articles are sourced directly from an ATProtocol Personal Data Server (PDS), ensuring full data ownership and portability across the open web.
      </p>
    </article>
  `;

  const pageUrl = new URL(c.req.url).toString();
  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const metaTags = `
    <meta property="og:title" content="About ${escapeHtml(c.env.PUB_NAME)}">
    <meta property="og:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  return c.html(renderLayout(c, 'About', body, metaTags));
});

pages.get('/archive', async (c) => {
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const posts = await fetchArticles(c.env.AUTHOR_DID, pds, c.env.PUBLICATION_RKEY);
  const archiveItems = posts
    .map(
      (post) => `
        <article class="archive-story">
          <a class="archive-story__image${post.cover ? '' : ' story-image--placeholder'}" href="${post.path}" aria-label="Read ${post.title || 'Untitled'}">
            ${post.cover ? `<img src="${post.cover}" alt="" class="story-image">` : '<span aria-hidden="true">C&amp;C</span>'}
          </a>
          <div>
            <p class="eyebrow">${formatDate(post.publishedAt)}</p>
            <h3><a href="${post.path}">${post.title || 'Untitled'}</a></h3>
            <p>${excerpt(post)}</p>
          </div>
          <a href="${post.path}" class="read-link">Read story <span aria-hidden="true">→</span></a>
        </article>`
    )
    .join('');

  const body = `
    <section class="archive-page" aria-labelledby="archive-title">
      <div class="section-heading"><span id="archive-title">Archive</span><span>${posts.length} ${posts.length === 1 ? 'story' : 'stories'}</span></div>
      ${archiveItems ? `<div class="archive-grid">${archiveItems}</div>` : '<p class="empty-state">No stories have been published yet.</p>'}
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
    <meta property="og:title" content="Archive — ${escapeHtml(c.env.PUB_NAME)}">
    <meta property="og:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  return c.html(renderLayout(c, 'Archive', body, metaTags));
});

pages.get('/privacy', (c) => {
  const body = '<article class="max-w-2xl mx-auto py-8"><h1 class="text-3xl font-bold text-white mb-4">Privacy</h1><p class="text-gray-300 leading-relaxed">Coffee &amp; Code does not sell personal information. This site reads publicly available publication records from AT Protocol to display its stories.</p></article>';

  const pageUrl = new URL(c.req.url).toString();
  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const metaTags = `
    <meta property="og:title" content="Privacy — ${escapeHtml(c.env.PUB_NAME)}">
    <meta property="og:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  return c.html(renderLayout(c, 'Privacy', body, metaTags));
});

pages.get('/terms', (c) => {
  const body = '<article class="max-w-2xl mx-auto py-8"><h1 class="text-3xl font-bold text-white mb-4">Terms</h1><p class="text-gray-300 leading-relaxed">Content is provided for informational purposes. Reuse must respect the rights held by the original authors and publishers.</p></article>';

  const pageUrl = new URL(c.req.url).toString();
  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const metaTags = `
    <meta property="og:title" content="Terms — ${escapeHtml(c.env.PUB_NAME)}">
    <meta property="og:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  return c.html(renderLayout(c, 'Terms', body, metaTags));
});

export default pages;
