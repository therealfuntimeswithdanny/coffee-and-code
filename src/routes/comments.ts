import { Hono } from 'hono';
import { Env } from '../types';
import { getPdsEndpoint } from '../lib/atproto';

const comments = new Hono<{ Bindings: Env }>();
const constellationUrl = 'https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks';

type Backlink = { did: string; collection: string; rkey: string };
type CommentRecord = {
  uri: string;
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  text: string;
  createdAt: string;
  parentUri?: string;
  likeCount?: number;
  liked?: boolean;
};

type Profile = { handle?: string; displayName?: string; avatar?: string };

async function countCommentLikes(uri: string) {
  const url = new URL('https://constellation.microcosm.blue/links/count/distinct-dids');
  url.searchParams.set('target', uri);
  url.searchParams.set('collection', 'cc.coffeencode.comment.like');
  url.searchParams.set('path', '.subject.uri');
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CoffeeAndCode (coffeencode.cc; @coffeencode.bsky.social)' },
  });
  if (!response.ok) throw new Error(`Constellation returned ${response.status}`);
  const result = await response.json() as { total?: unknown };
  const total = Number(result.total);
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

async function hasCommentLike(uri: string, did: string) {
  const url = new URL('https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks');
  url.searchParams.set('subject', uri);
  url.searchParams.set('source', 'cc.coffeencode.comment.like:subject.uri');
  url.searchParams.set('did', did);
  url.searchParams.set('limit', '1');
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CoffeeAndCode (coffeencode.cc; @coffeencode.bsky.social)' },
  });
  if (!response.ok) throw new Error(`Constellation returned ${response.status}`);
  const result = await response.json() as { records?: unknown[] };
  return Boolean(result.records?.length);
}

comments.get('/', async (c) => {
  const subject = c.req.query('subject') || '';
  const did = c.req.query('did');
  if (!subject.startsWith('at://') || !subject.includes('/site.standard.document/') || subject.length > 2048) {
    return c.json({ error: 'A site.standard.document AT URI is required.' }, 400);
  }
  if (did && !/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did)) {
    return c.json({ error: 'A valid DID is required.' }, 400);
  }

  try {
    const url = new URL(constellationUrl);
    url.searchParams.set('subject', subject);
    url.searchParams.set('source', 'cc.coffeencode.comment:subject.uri');
    url.searchParams.set('limit', '100');
    const indexResponse = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'CoffeeAndCode (coffeencode.cc; @coffeencode.bsky.social)' },
    });
    if (!indexResponse.ok) throw new Error(`Constellation returned ${indexResponse.status}`);
    const index = await indexResponse.json() as { records?: Backlink[]; total?: number };
    const backlinks = (index.records || []).filter((item) => item.collection === 'cc.coffeencode.comment'
      && /^[a-zA-Z0-9._:%-]+$/.test(item.did) && /^[a-zA-Z0-9._~:-]+$/.test(item.rkey));
    const pdsByDid = new Map<string, string>();
    await Promise.all([...new Set(backlinks.map((item) => item.did))].map(async (did) => {
      pdsByDid.set(did, await getPdsEndpoint(did, c.env.OWNER_PDS));
    }));

    const fetched = await Promise.all(backlinks.map(async (item): Promise<CommentRecord | undefined> => {
      try {
        const pds = pdsByDid.get(item.did) || c.env.OWNER_PDS;
        const recordUrl = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
        recordUrl.searchParams.set('repo', item.did);
        recordUrl.searchParams.set('collection', item.collection);
        recordUrl.searchParams.set('rkey', item.rkey);
        const response = await fetch(recordUrl, { headers: { Accept: 'application/json' } });
        if (!response.ok) return undefined;
        const data = await response.json() as { uri?: string; value?: { text?: string; createdAt?: string; reply?: { parent?: { uri?: string } } } };
        if (typeof data.value?.text !== 'string') return undefined;
        return {
          uri: data.uri || `at://${item.did}/${item.collection}/${item.rkey}`,
          did: item.did,
          handle: item.did,
          text: data.value.text,
          createdAt: data.value.createdAt || '',
          parentUri: data.value.reply?.parent?.uri,
        };
      } catch {
        return undefined;
      }
    }));
    const records = fetched.filter((item): item is CommentRecord => !!item)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const commentsWithLikes = await Promise.all(records.map(async (record) => {
      const [likeCount, ownLikes] = await Promise.all([
        countCommentLikes(record.uri),
        did ? hasCommentLike(record.uri, did).then((has) => Number(has)) : Promise.resolve(0),
      ]);
      return { ...record, likeCount, liked: ownLikes > 0 };
    }));
    const profiles = await Promise.all([...new Set(records.map((item) => item.did))].map(async (did): Promise<[string, Profile]> => {
      try {
        const profileUrl = new URL('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile');
        profileUrl.searchParams.set('actor', did);
        const response = await fetch(profileUrl);
        if (response.ok) return [did, await response.json() as Profile];
      } catch { /* Profiles are optional; comments remain available without them. */ }
      return [did, {}];
    }));
    const profileByDid = new Map(profiles);
    commentsWithLikes.forEach((record) => {
      const profile = profileByDid.get(record.did);
      record.handle = profile?.handle || record.did;
      record.displayName = profile?.displayName;
      record.avatar = profile?.avatar;
    });
    return c.json({ records: commentsWithLikes, total: Number(index.total) || commentsWithLikes.length }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Failed to load comments:', error);
    return c.json({ error: 'Comments are temporarily unavailable.' }, 502);
  }
});

export default comments;
