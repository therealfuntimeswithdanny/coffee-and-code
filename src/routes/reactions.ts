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

  try {
    const [likes, dislikes, views, comments, savedCount, liked, disliked, recommended, saved] = await Promise.all([
      countBacklinks(subject, 'like'),
      countBacklinks(subject, 'dislike'),
      countBacklinks(subject, 'view'),
      countComments(subject).catch((error) => {
        console.error('Failed to load comment count:', error);
        return 0;
      }),
      countBacklinks(subject, 'save'),
      did ? hasBacklink(subject, 'like', did).then((has) => Number(has)) : Promise.resolve(0),
      did ? hasBacklink(subject, 'dislike', did).then((has) => Number(has)) : Promise.resolve(0),
      did ? hasBacklink(subject, 'recommend', did).then((has) => Number(has)) : Promise.resolve(0),
      did ? hasBacklink(subject, 'save', did) : Promise.resolve(false),
    ]);
    // Reaction writes are immediately followed by a refresh from the client.
    // Shared caching here made those refreshes return the previous totals.
    return c.json({ likes, dislikes, views, comments, saves: savedCount, liked: liked > 0, disliked: disliked > 0, recommended: recommended > 0, saved }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Failed to load reaction counts:', error);
    return c.json({ error: 'Reaction counts are temporarily unavailable.' }, 502);
  }
});

export default reactions;
