import { Hono } from 'hono';
import { Env } from './types';
import homeRouter from './routes/home';
import postsRouter from './routes/posts';
import pagesRouter from './routes/pages';
import metaRouter from './routes/meta';

const app = new Hono<{ Bindings: Env }>();

// Mount routes
app.route('/', homeRouter);
app.route('/', pagesRouter);
app.route('/post', postsRouter);
app.route('/', metaRouter);

export default app;
