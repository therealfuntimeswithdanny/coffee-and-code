import { Hono } from 'hono';
import { Env } from './types';
import homeRouter from './routes/home';
import postsRouter from './routes/posts';
import pagesRouter from './routes/pages';
import metaRouter from './routes/meta';
import searchRouter from './routes/search';
import { renderLayout } from './templates/layout';

const app = new Hono<{ Bindings: Env }>();

// Mount routes
app.route('/', homeRouter);
app.route('/', pagesRouter);
app.route('/post', postsRouter);
app.route('/', metaRouter);
app.route('/search', searchRouter);

// Catch-all 404 handler
app.all('*', (c) => {
  const pageUrl = new URL(c.req.url).toString();
  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const body = `
    <section class="not-found">
      <p class="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>The page you're looking for doesn't exist. It may have moved or been removed.</p>
      <div class="not-found__actions">
        <a href="/" class="read-link">Back to publication <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
        <a href="/archive" class="read-link">Browse archive <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
        <button type="button" class="read-link search-button-link" data-open-search>Search articles <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
      </div>
    </section>
  `;

  const metaTags = `
    <meta property="og:title" content="Page not found — ${escapeHtml(c.env.PUB_NAME)}">
    <meta property="og:description" content="The requested page could not be found.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
  `;

  return c.html(renderLayout(c, 'Page Not Found', body, metaTags), 404);
});

export default app;
