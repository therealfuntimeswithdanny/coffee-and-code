import { Hono } from 'hono';
import { Env } from '../types';

const reactions = new Hono<{ Bindings: Env }>();
const constellationEndpoint = 'https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinksCount';
const constellationBacklinksEndpoint = 'https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks';

async function countBacklinks(subject: string, collection: 'like' | 'dislike' | 'view' | 'recommend') {
  const url = new URL(constellationEndpoint);
  url.searchParams.set('subject', subject);
  url.searchParams.set('source', collection === 'recommend'
    ? 'site.standard.graph.recommend:document'
    : `cc.coffeencode.interact.${collection}:document`);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'CoffeeAndCode (coffeencode.cc; @coffeencode.bsky.social)',
    },
  });
  if (!response.ok) throw new Error(`Constellation returned ${response.status}`);
  const result = await response.json() as { total?: unknown };
  const total = Number(result.total);
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

async function hasBacklink(subject: string, collection: 'like' | 'dislike' | 'recommend', did: string) {
  const url = new URL(constellationBacklinksEndpoint);
  url.searchParams.set('subject', subject);
  url.searchParams.set('source', collection === 'recommend'
    ? 'site.standard.graph.recommend:document'
    : `cc.coffeencode.interact.${collection}:document`);
  url.searchParams.set('did', did);
  url.searchParams.set('limit', '1');
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CoffeeAndCode (coffeencode.cc; @coffeencode.bsky.social)' },
  });
  if (!response.ok) throw new Error(`Constellation returned ${response.status}`);
  const result = await response.json() as { records?: unknown[] };
  return Boolean(result.records?.length);
}

reactions.get('/', async (c) => {
  const subject = c.req.query('subject') || '';
  const did = c.req.query('did');
  if (!subject.startsWith('at://') || !subject.includes('/site.standard.document/') || subject.length > 2048) {
    return c.json({ error: 'A site.standard.document AT URI is required.' }, 400);
  }
  if (did && !/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did)) {
    return c.json({ error: 'A valid DID is required.' }, 400);
  }

  try {
    const [likes, dislikes, views, liked, disliked, recommended] = await Promise.all([
      countBacklinks(subject, 'like'),
      countBacklinks(subject, 'dislike'),
      countBacklinks(subject, 'view'),
      did ? hasBacklink(subject, 'like', did).then((has) => Number(has)) : Promise.resolve(0),
      did ? hasBacklink(subject, 'dislike', did).then((has) => Number(has)) : Promise.resolve(0),
      did ? hasBacklink(subject, 'recommend', did).then((has) => Number(has)) : Promise.resolve(0),
    ]);
    return c.json({ likes, dislikes, views, liked: liked > 0, disliked: disliked > 0, recommended: recommended > 0 }, 200, { 'Cache-Control': 'public, max-age=30, s-maxage=30' });
  } catch (error) {
    console.error('Failed to load reaction counts:', error);
    return c.json({ error: 'Reaction counts are temporarily unavailable.' }, 502);
  }
});

export default reactions;
