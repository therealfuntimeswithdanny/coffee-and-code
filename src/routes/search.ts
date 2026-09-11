import { Hono } from 'hono';
import { Env } from '../types';
import { renderLayout } from '../templates/layout';

const search = new Hono<{ Bindings: Env }>();

search.get('/', (c) => {
  const body = `
    <section class="search-page">
      <div class="search-header">
        <h1>Search articles</h1>
        <search-bar-snippet class="cloudflare-search"
          api-url="https://search.coffeencode.cc/search"
          placeholder="Search Coffee &amp; Code"
          max-results="25"
          max-render-results="7"
          show-url="true"
          show-date="true">
        </search-bar-snippet>
      </div>
    </section>
    <script type="module" src="https://4f82ebeb-ab5a-498a-a186-aad0c0dd760a.search.ai.cloudflare.com/assets/v0.0.40/search-snippet.es.js"></script>
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

  return c.html(renderLayout(c, 'Search Articles', body, metaTags));
});

export default search;
