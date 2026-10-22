import { Hono } from 'hono';
import { Env } from '../types';

const reactions = new Hono<{ Bindings: Env }>();
const constellationEndpoint = 'https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinksCount';

async function countBacklinks(subject: string, collection: 'like' | 'dislike' | 'view') {
  const url = new URL(constellationEndpoint);
  url.searchParams.set('subject', subject);
  url.searchParams.set('source', `cc.coffeencode.interact.${collection}:subject.uri`);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Constellation returned ${response.status}`);
  const result = await response.json() as { total?: unknown };
  const total = Number(result.total);
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

reactions.get('/', async (c) => {
  const subject = c.req.query('subject') || '';
  if (!subject.startsWith('at://') || !subject.includes('/site.standard.document/') || subject.length > 2048) {
    return c.json({ error: 'A site.standard.document AT URI is required.' }, 400);
  }

  try {
    const [likes, dislikes, views] = await Promise.all([
      countBacklinks(subject, 'like'),
      countBacklinks(subject, 'dislike'),
      countBacklinks(subject, 'view'),
    ]);
    return c.json({ likes, dislikes, views }, 200, { 'Cache-Control': 'public, max-age=30, s-maxage=30' });
  } catch (error) {
    console.error('Failed to load reaction counts:', error);
    return c.json({ error: 'Reaction counts are temporarily unavailable.' }, 502);
  }
});

export default reactions;
