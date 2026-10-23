import { Hono } from 'hono';
import { Env } from '../types';
import { getPdsEndpoint } from '../lib/atproto';

const comments = new Hono<{ Bindings: Env }>();
const constellationUrl = 'https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks';
const constellationCountUrl = 'https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinksCount';
const commentCollection = 'cc.coffeencode.comment';
const likeSource = 'cc.coffeencode.comment.like:subject.uri';
const pageSizeDefault = 40;
const maxPageSize = 100;
const maxTextLength = 3000;

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
  likeCount: number;
  liked: boolean;
};
type Profile = { handle?: string; displayName?: string; avatar?: string };
type IndexPage = { records?: Backlink[]; total?: number; cursor?: string };

const headers = {
  Accept: 'application/json',
  'User-Agent': 'CoffeeAndCode (coffeencode.cc; @coffeencode.bsky.social)',
};

function validAtUri(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 2048
    && /^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._~:-]+$/.test(value);
}

async function getBacklinks(url: URL) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Constellation returned ${response.status}`);
  return await response.json() as IndexPage;
}

async function countCommentLikes(uri: string): Promise<number> {
  const url = new URL(constellationCountUrl);
  url.searchParams.set('subject', uri);
  url.searchParams.set('source', likeSource);
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Constellation returned ${response.status}`);
  const result = await response.json() as IndexPage;
  const count = Number(result.total);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

async function hasCommentLike(uri: string, did: string): Promise<boolean> {
  const url = new URL(constellationUrl);
  url.searchParams.set('subject', uri);
  url.searchParams.set('source', likeSource);
  url.searchParams.set('did', did);
  url.searchParams.set('limit', '1');
  const result = await getBacklinks(url);
  return Boolean(result.records?.length);
}

comments.get('/', async (c) => {
  const subject = c.req.query('subject') || '';
  const did = c.req.query('did');
  const rawLimit = c.req.query('limit');
  const limit = rawLimit === undefined ? pageSizeDefault : Number(rawLimit);
  const cursor = c.req.query('cursor');
  if (!validAtUri(subject) || !subject.includes('/site.standard.document/')) {
    return c.json({ error: 'A site.standard.document AT URI is required.' }, 400);
  }
  if (did && !/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did)) {
    return c.json({ error: 'A valid DID is required.' }, 400);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > maxPageSize) {
    return c.json({ error: `limit must be between 1 and ${maxPageSize}.` }, 400);
  }
  if (cursor && (cursor.length > 2048 || /[\r\n]/.test(cursor))) {
    return c.json({ error: 'Invalid pagination cursor.' }, 400);
  }

  try {
    const url = new URL(constellationUrl);
    url.searchParams.set('subject', subject);
    url.searchParams.set('source', `${commentCollection}:subject.uri`);
    url.searchParams.set('limit', String(limit));
    if (cursor) url.searchParams.set('cursor', cursor);
    const index = await getBacklinks(url);
    const backlinks = (index.records || []).filter((item) => item.collection === commentCollection
      && /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(item.did)
      && /^[a-zA-Z0-9._~:-]+$/.test(item.rkey));

    // Resolve each author's PDS once. A single unavailable DID should not make
    // every other comment disappear from the page.
    const pdsEntries = await Promise.all([...new Set(backlinks.map((item) => item.did))].map(async (authorDid) => {
      try { return [authorDid, await getPdsEndpoint(authorDid, c.env.OWNER_PDS)] as const; }
      catch { return [authorDid, undefined] as const; }
    }));
    const pdsByDid = new Map(pdsEntries);

    // Bound concurrent PDS reads so a busy thread cannot fan out hundreds of
    // simultaneous requests to remote repositories.
    const fetched: Array<CommentRecord | undefined> = [];
    for (let offset = 0; offset < backlinks.length; offset += 8) {
      const batch = backlinks.slice(offset, offset + 8);
      fetched.push(...await Promise.all(batch.map(async (item): Promise<CommentRecord | undefined> => {
        try {
          const pds = pdsByDid.get(item.did);
          if (!pds) return undefined;
          const recordUrl = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
          recordUrl.searchParams.set('repo', item.did);
          recordUrl.searchParams.set('collection', item.collection);
          recordUrl.searchParams.set('rkey', item.rkey);
          const response = await fetch(recordUrl, { headers: { Accept: 'application/json' } });
          if (!response.ok) return undefined;
          const data = await response.json() as { uri?: string; value?: { subject?: { uri?: string }; text?: string; createdAt?: string; reply?: { parent?: { uri?: string } } } };
          const value = data.value;
          const text = typeof value?.text === 'string' ? value.text.trim() : '';
          const createdAt = value?.createdAt || '';
          const parentUri = value?.reply?.parent?.uri;
          if (value?.subject?.uri !== subject || !text || text.length > maxTextLength
            || !Number.isFinite(Date.parse(createdAt))
            || (parentUri !== undefined && (!validAtUri(parentUri) || parentUri === data.uri))) return undefined;
          return {
            uri: validAtUri(data.uri) ? data.uri : `at://${item.did}/${item.collection}/${item.rkey}`,
            did: item.did,
            handle: item.did,
            text,
            createdAt,
            parentUri,
            likeCount: 0,
            liked: false,
          };
        } catch { return undefined; }
      })));
    }

    const records = fetched.filter((item): item is CommentRecord => !!item)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uri.localeCompare(b.uri));

    // Counts are useful but auxiliary. If Constellation has a temporary error,
    // keep the comments readable and render a zero/unknown-safe count.
    const commentsWithLikes: CommentRecord[] = [];
    for (let offset = 0; offset < records.length; offset += 8) {
      const batch = records.slice(offset, offset + 8);
      commentsWithLikes.push(...await Promise.all(batch.map(async (record) => {
        const [likeCount, liked] = await Promise.all([
          countCommentLikes(record.uri).catch(() => 0),
          did ? hasCommentLike(record.uri, did).catch(() => false) : Promise.resolve(false),
        ]);
        return { ...record, likeCount, liked };
      })));
    }

    const profiles = await Promise.all([...new Set(records.map((item) => item.did))].map(async (authorDid): Promise<[string, Profile]> => {
      try {
        const profileUrl = new URL('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile');
        profileUrl.searchParams.set('actor', authorDid);
        const response = await fetch(profileUrl, { headers: { Accept: 'application/json' } });
        if (response.ok) return [authorDid, await response.json() as Profile];
      } catch { /* Profile enrichment is optional. */ }
      return [authorDid, {}];
    }));
    const profileByDid = new Map(profiles);
    commentsWithLikes.forEach((record) => {
      const profile = profileByDid.get(record.did);
      record.handle = profile?.handle || record.did;
      record.displayName = profile?.displayName;
      record.avatar = profile?.avatar;
    });

    return c.json({
      records: commentsWithLikes,
      total: Number.isFinite(Number(index.total)) ? Number(index.total) : commentsWithLikes.length,
      cursor: typeof index.cursor === 'string' ? index.cursor : null,
    }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Failed to load comments:', error);
    return c.json({ error: 'Comments are temporarily unavailable.' }, 502);
  }
});

export default comments;
