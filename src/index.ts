import { Hono } from 'hono';
import { Env } from './types';
import homeRouter from './routes/home';
import postsRouter from './routes/posts';
import pagesRouter from './routes/pages';
import metaRouter from './routes/meta';
import searchRouter from './routes/search';
import exportRouter from './routes/export';
import reactionsRouter from './routes/reactions';
import commentsRouter from './routes/comments';
import verificationsRouter from './routes/verifications';
import usersRouter from './routes/users';
import { renderLayout } from './templates/layout';

const app = new Hono<{ Bindings: Env }>();

// Mount routes
app.route('/', homeRouter);
app.route('/', pagesRouter);
app.route('/', metaRouter);
app.route('/search', searchRouter);
app.route('/export', exportRouter);
app.route('/api/reactions', reactionsRouter);
app.route('/api/comments', commentsRouter);
app.route('/api/verifications', verificationsRouter);
app.route('/user', usersRouter);
// Keep the two-segment story route after named page and API routes.
app.route('/', postsRouter);

app.get('/:rkey', (c) => {
  const rkey = encodeURIComponent(c.req.param('rkey'));
  const search = new URL(c.req.url).search;
  return c.redirect(`/post/${rkey}${search}`, 301);
});

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
