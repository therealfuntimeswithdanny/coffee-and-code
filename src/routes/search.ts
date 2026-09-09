import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import { getPdsEndpoint, fetchArticles, searchArticles } from '../lib/atproto';
import { renderLayout } from '../templates/layout';

const search = new Hono<{ Bindings: Env }>();

function formatDate(date?: string) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function excerpt(post: StandardDocument, length = 150) {
  const text = post.description || post.content || '';
  return text.length > length ? `${text.substring(0, length).trimEnd()}…` : text;
}

search.get('/', async (c) => {
  const query = c.req.query('q') || '';
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);

  let results: StandardDocument[] = [];
  let error = '';

  if (query.trim()) {
    try {
      const allPosts = await fetchArticles(c.env.AUTHOR_DID, pds, c.env.PUBLICATION_RKEY);
      results = searchArticles(allPosts, query);
    } catch (e) {
      error = 'Failed to search articles. Please try again.';
      console.error('Search error:', e);
    }
  }

  const resultsHtml = results.length
    ? results
        .map(
          (post) => `
            <article class="search-result">
              <div class="search-result__content">
                <h3><a href="${post.path}">${post.title}</a></h3>
                <p class="search-result__excerpt">${excerpt(post, 200)}</p>
                <span class="article-meta">${formatDate(post.publishedAt)}</span>
              </div>
            </article>`
        )
        .join('')
    : `<p class="empty-state">${query.trim() ? 'No articles found matching your search.' : 'Enter a search term to find articles.'}</p>`;

  const body = `
    <section class="search-page">
      <div class="search-header">
        <h1>Search articles</h1>
        <form class="search-form" action="/search" method="get">
          <input
            type="text"
            name="q"
            placeholder="Search by title or content..."
            value="${query.replace(/"/g, '&quot;')}"
            class="search-input"
            autocomplete="off"
          >
          <button type="submit" class="search-button">Search</button>
        </form>
      </div>
      ${error ? `<div class="search-error">${error}</div>` : ''}
      <div class="search-results">
        ${results.length ? `<p class="search-count">${results.length} ${results.length === 1 ? 'result' : 'results'} found</p>` : ''}
        ${resultsHtml}
      </div>
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
    <meta property="og:title" content="Search — ${escapeHtml(c.env.PUB_NAME)}">
    <meta property="og:description" content="${escapeHtml(c.env.PUB_DESCRIPTION)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  return c.html(renderLayout(c, `Search: ${query || 'Articles'}`, body, metaTags));
});

export default search;
