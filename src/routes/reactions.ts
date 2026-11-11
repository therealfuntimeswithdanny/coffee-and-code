import { Hono } from 'hono';
import { Env } from '../types';

const reactions = new Hono<{ Bindings: Env }>();
const constellationEndpoint = 'https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinksCount';
const constellationBacklinksEndpoint = 'https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks';

async function countBacklinks(subject: string, collection: 'like' | 'dislike' | 'view' | 'recommend' | 'save') {
  const source = collection === 'recommend'
    ? 'site.standard.graph.recommend'
    : collection === 'save'
      ? 'cc.coffeencode.save'
      : `cc.coffeencode.interact.${collection}`;
  const url = new URL(constellationEndpoint);
  if (collection === 'like' || collection === 'dislike') {
    // The app permits one reaction per DID and post. Count matching records
    // using the current XRPC endpoint so counts and per-user state use the
    // same collection:path index.
  }
  url.searchParams.set('subject', subject);
  url.searchParams.set('source', `${source}:${collection === 'save' ? 'target.document' : 'document'}`);
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

async function countComments(subject: string) {
  const url = new URL(constellationEndpoint);
  url.searchParams.set('subject', subject);
  url.searchParams.set('source', 'cc.coffeencode.comment:subject.uri');
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CoffeeAndCode (coffeencode.cc; @coffeencode.bsky.social)' },
  });
  if (!response.ok) throw new Error(`Constellation returned ${response.status}`);
  const result = await response.json() as { total?: unknown };
  const total = Number(result.total);
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

async function hasBacklink(subject: string, collection: 'like' | 'dislike' | 'recommend' | 'save', did: string) {
  const url = new URL(constellationBacklinksEndpoint);
  url.searchParams.set('subject', subject);
  url.searchParams.set('source', collection === 'recommend'
    ? 'site.standard.graph.recommend:document'
    : collection === 'save'
      ? 'cc.coffeencode.save:target.document'
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

  let partial = false;
  const safe = async <T,>(label: string, request: Promise<T>, fallback: T): Promise<T> => {
    try { return await request; }
    catch (error) {
      partial = true;
      console.error(`Failed to load ${label}:`, error);
      return fallback;
    }
  };
  try {
    const [likes, dislikes, views, comments, savedCount, liked, disliked, recommended, saved] = await Promise.all([
      safe('like count', countBacklinks(subject, 'like'), 0),
      safe('dislike count', countBacklinks(subject, 'dislike'), 0),
      safe('view count', countBacklinks(subject, 'view'), 0),
      safe('comment count', countComments(subject), 0),
      safe('save count', countBacklinks(subject, 'save'), 0),
      did ? safe('your like state', hasBacklink(subject, 'like', did), false).then(Number) : Promise.resolve(0),
      did ? safe('your dislike state', hasBacklink(subject, 'dislike', did), false).then(Number) : Promise.resolve(0),
      did ? safe('your recommendation state', hasBacklink(subject, 'recommend', did), false).then(Number) : Promise.resolve(0),
      did ? safe('your saved state', hasBacklink(subject, 'save', did), false) : Promise.resolve(false),
    ]);
    // Reaction writes are immediately followed by a refresh from the client.
    // Shared caching here made those refreshes return the previous totals.
    return c.json({ likes, dislikes, views, comments, saves: savedCount, liked: liked > 0, disliked: disliked > 0, recommended: recommended > 0, saved, partial }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Failed to load reaction counts:', error);
    return c.json({ error: 'Reaction counts are temporarily unavailable.' }, 502);
  }
});

export default reactions;
