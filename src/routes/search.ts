import { Hono } from 'hono';
import { Env } from '../types';

const search = new Hono<{ Bindings: Env }>();

search.get('/', (c) => {
  return c.redirect('/');
});

export default search;
