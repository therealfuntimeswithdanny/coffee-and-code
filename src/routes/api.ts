import { Hono, type Context } from 'hono';
import { Env, StandardDocument } from '../types';
import { fetchArticleByUri, fetchArticles, fetchPostMetadata, getPdsEndpoint, isPdsAvailable, proxyAvatarUrl, proxyImageUrl, purgePublishedPostCache } from '../lib/atproto';
import { toPlainText } from '../lib/contentRenderer';
import { loadNotificationsForUser } from '../lib/notifications';
import legal from '../legal.json';

const api = new Hono<{ Bindings: Env }>();

async function documentMetadata(document: StandardDocument, pds: string) {
  const metadata = document.metadata
    || await fetchPostMetadata(document.pdsUrl || pds, document.repoDid || '', document.rkey);
  if (!metadata) return undefined;
  return {
    uri: metadata.uri,
    cid: metadata.cid,
    sources: metadata.sources,
    backlink: metadata.backlink,
    createdAt: metadata.createdAt,
  };
}

function documentSnippet(post: StandardDocument, length = 240) {
  const text = toPlainText(post.content || '', post.mimeType);
  return text.length > length ? `${text.substring(0, length).trimEnd()}…` : text;
}

function documentSummary(post: StandardDocument, pds: string) {
  return {
    uri: post.uri,
    title: post.title,
    description: post.description || '',
    snippet: documentSnippet(post),
    publishedAt: post.publishedAt,
    path: post.path,
    cover: post.cover ? proxyImageUrl(post.cover, pds, 'feed_medium') : undefined,
    tags: post.tags || [],
    author: post.author
      ? {
          did: post.author.did,
          handle: post.author.handle,
          displayName: post.author.displayName || post.author.handle,
          avatar: post.author.avatar ? proxyAvatarUrl(post.author.avatar) : undefined,
        }
      : undefined,
  };
}

async function loadDocuments(c: Context<{ Bindings: Env }>) {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const documents = await fetchArticles(pds, c.env.OWNER_DID);
  return { pds, documents };
}

async function loadDocumentsSafely(c: Context<{ Bindings: Env }>) {
  try {
    return await loadDocuments(c);
  } catch (error) {
    console.error('Could not load Coffee & Code posts:', error);
    return null;
  }
}

function findDocument(documents: StandardDocument[], rkey: string | undefined, uri: string | undefined) {
  const recordMatches = documents.filter((document) => document.rkey === rkey);
  const matches = uri ? recordMatches.filter((document) => document.uri === uri) : recordMatches;
  return {
    document: matches.length === 1 ? matches[0] : undefined,
    ambiguous: !uri && matches.length > 1,
  };
}

async function findDocumentForRequest(documents: StandardDocument[], rkey: string | undefined, uri: string | undefined, pds: string, ownerDid: string) {
  const result = findDocument(documents, rkey, uri);
  if (result.document || result.ambiguous || !uri || !rkey) return result;
  try {
    const exact = await fetchArticleByUri(uri, pds, ownerDid);
    return exact?.rkey === rkey ? { document: exact, ambiguous: false } : result;
  } catch (error) {
    console.error('Could not load the requested Coffee & Code post directly:', error);
    return result;
  }
}

// Single source of truth for the privacy policy and terms of service,
// shared by the /privacy and /terms pages and the mobile app.
api.get('/legal', (c) => c.json(legal, 200, { 'Cache-Control': 'public, max-age=300' }));

api.get('/home', async (c) => {
  const loaded = await loadDocumentsSafely(c);
  if (!loaded) return c.json({ error: 'The publication is temporarily unavailable.' }, 503, { 'Cache-Control': 'no-store' });
  const { pds, documents } = loaded;
  if (!documents.length && !await isPdsAvailable(pds)) {
    return c.json({ error: 'The publication is temporarily unavailable.' }, 503, { 'Cache-Control': 'no-store' });
  }

  const pinned = documents
    .filter((document) => document.pinnedOrder !== undefined)
    .sort((a, b) => a.pinnedOrder! - b.pinnedOrder!);
  const hero = documents[0];
  const pinnedStories = pinned.filter((document) => document.uri !== hero?.uri).slice(0, 3);
  const excludedUris = new Set([hero?.uri, ...pinnedStories.map((document) => document.uri)]);
  const latest = documents.filter((document) => !excludedUris.has(document.uri)).slice(0, 4);
  latest.forEach((document) => excludedUris.add(document.uri));
  const more = documents.filter((document) => !excludedUris.has(document.uri)).slice(0, 9);
  const displayed = [hero, ...latest, ...pinnedStories, ...more]
    .filter((document): document is StandardDocument => Boolean(document));
  const authors = new Map<string, { did: string; handle: string; displayName: string; avatar?: string; storyCount: number }>();
  displayed.forEach((document) => {
    const author = document.author;
    if (!author) return;
    const existing = authors.get(author.did);
    authors.set(author.did, {
      did: author.did,
      handle: author.handle,
      displayName: author.displayName || author.handle,
      avatar: author.avatar ? proxyAvatarUrl(author.avatar) : undefined,
      storyCount: (existing?.storyCount || 0) + 1,
    });
  });
  const origin = new URL(c.req.url).origin;
  const summary = (document: StandardDocument | undefined) =>
    document ? documentSummary(document, pds) : null;

  return c.json({
    publication: {
      name: c.env.PUB_NAME,
      description: c.env.PUB_DESCRIPTION,
    },
    promotion: {
      title: "We're looking for writers",
      description: 'Coffee & Code is made possible thanks to you! One way you can contribute is to write for us!',
      action: 'Write for us',
      url: `${origin}/become-an-author`,
    },
    totalAvailable: documents.length,
    hero: summary(hero),
    latest: latest.map((document) => documentSummary(document, pds)),
    pinned: pinnedStories.map((document) => documentSummary(document, pds)),
    more: more.map((document) => documentSummary(document, pds)),
    authors: [...authors.values()],
  }, 200, { 'Cache-Control': 'public, max-age=60' });
});

api.get('/documents', async (c) => {
  const uri = c.req.query('uri');
  if (uri) {
    if (uri.length > 2048 || !/^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/site\.standard\.document\/[a-zA-Z0-9._~:-]+$/.test(uri)) {
      return c.json({ error: 'A valid site.standard.document AT URI is required.' }, 400, { 'Cache-Control': 'no-store' });
    }
    try {
      const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
      const document = await fetchArticleByUri(uri, pds, c.env.OWNER_DID);
      if (!document) return c.json({ error: 'Document not found.' }, 404, { 'Cache-Control': 'no-store' });
      return c.json({
        ...documentSummary(document, pds),
        metadata: await documentMetadata(document, pds),
        record: { uri: document.uri, cid: document.cid, value: document.record },
      }, 200, { 'Cache-Control': 'no-store' });
    } catch (error) {
      console.error('Could not load the requested Coffee & Code post:', error);
      return c.json({ error: 'The post is temporarily unavailable.' }, 502, { 'Cache-Control': 'no-store' });
    }
  }

  const rawLimit = c.req.query('limit');
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return c.json({ error: 'limit must be an integer between 1 and 100.' }, 400);
  }

  const loaded = await loadDocumentsSafely(c);
  if (!loaded) return c.json({ error: 'The publication is temporarily unavailable.' }, 503, { 'Cache-Control': 'no-store' });
  const { pds, documents } = loaded;
  if (!documents.length && !await isPdsAvailable(pds)) {
    return c.json({ error: 'The publication is temporarily unavailable.' }, 503, { 'Cache-Control': 'no-store' });
  }
  return c.json({
    documents: documents.slice(0, limit).map((document) => documentSummary(document, pds)),
    totalAvailable: documents.length,
    limit,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
});

// AT Protocol records are public and immutable in normal use. Constellation
// indexes backlinks across repositories, so this endpoint can produce a
// current activity feed without maintaining a separate copy of the firehose.
api.get('/notifications', async (c) => {
  const rawLimit = c.req.query('limit');
  const limit = rawLimit === undefined ? 40 : Number(rawLimit);
  const did = c.req.query('did') || '';
  const countOnly = c.req.query('count') === '1';
  const rawLastRead = c.req.query('lastRead');
  const lastRead = rawLastRead && Number.isFinite(Date.parse(rawLastRead)) ? rawLastRead : undefined;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return c.json({ error: 'limit must be an integer between 1 and 100.' }, 400);
  }
  if (!/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did)) {
    return c.json({ error: 'A valid account DID is required.' }, 400);
  }
  if (countOnly && rawLastRead && !lastRead) {
    return c.json({ error: 'lastRead must be a valid timestamp.' }, 400);
  }

  try {
    const notifications = await loadNotificationsForUser(c.env, did);
    if (countOnly) {
      const cutoff = lastRead ? Date.parse(lastRead) : Number.NEGATIVE_INFINITY;
      const unreadCount = notifications.filter((notification) => {
        const timestamp = notification.createdAt ? Date.parse(notification.createdAt) : Number.NaN;
        return !Number.isFinite(timestamp) || timestamp > cutoff;
      }).length;
      return c.json({ unreadCount }, 200, { 'Cache-Control': 'no-store' });
    }
    return c.json({ notifications: notifications.slice(0, limit), limit }, 200, {
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    console.error('Failed to load notifications:', error);
    return c.json({ error: 'Notifications are temporarily unavailable.' }, 502);
  }
});

const VIDEO_MIME_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'video/ogg': '.ogv',
  'video/mpeg': '.mpg',
  'video/3gpp': '.3gp',
  'video/3gpp2': '.3g2',
};
// 100 MB — Cloudflare's request-body proxy limit caps uploads above this.
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

// Stores author videos in the public R2 bucket served at
// storage.coffeencode.cc/video/. Two modes:
//   - JSON {did, cid}: copies a blob the author already uploaded to their PDS;
//     the blob's presence in their repository is the proof of ownership.
//   - Raw body with a video/* Content-Type and a ?did= query param: direct
//     upload, used when the PDS rejects the file (e.g. over its blob limit).
api.post('/video', async (c) => {
  if (!c.env.STORAGE) {
    return c.json({ error: 'Video storage is not configured.' }, 503, { 'Cache-Control': 'no-store' });
  }
  const storageBase = (c.env.STORAGE_PUBLIC_URL || 'https://storage.coffeencode.cc').replace(/\/+$/, '');
  const tooLarge = () => c.json({ error: 'Video exceeds the 100 MB limit.' }, 413, { 'Cache-Control': 'no-store' });
  const store = async (key: string, body: ReadableStream | null, mimeType: string, declared: number) => {
    if (Number.isFinite(declared) && declared > VIDEO_MAX_BYTES) {
      body?.cancel();
      return tooLarge();
    }
    const written = await c.env.STORAGE!.put(key, body, {
      httpMetadata: { contentType: mimeType, cacheControl: 'public, max-age=31536000, immutable' },
    });
    if (written.size > VIDEO_MAX_BYTES) {
      await c.env.STORAGE!.delete(key);
      return tooLarge();
    }
    return c.json({ url: `${storageBase}/${key}`, mimeType, size: written.size }, 200, { 'Cache-Control': 'no-store' });
  };

  const contentType = (c.req.header('content-type') || '').split(';')[0].trim().toLowerCase();

  // Raw upload: POST /api/video?did=... with the video file as the body.
  const directExt = VIDEO_MIME_EXT[contentType];
  if (directExt) {
    const did = c.req.query('did') || '';
    if (!/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did)) {
      return c.json({ error: 'A valid did query parameter is required.' }, 400, { 'Cache-Control': 'no-store' });
    }
    const key = `video/${did}/${crypto.randomUUID()}${directExt}`;
    try {
      return await store(key, c.req.raw.body, contentType, Number(c.req.header('content-length')));
    } catch (error) {
      console.error('Video storage failed:', error);
      return c.json({ error: 'The video could not be stored. Try again in a moment.' }, 502, { 'Cache-Control': 'no-store' });
    }
  }

  if (contentType !== 'application/json') {
    return c.json({ error: 'Send the video file bytes or a JSON {did, cid} blob reference.' }, 415, { 'Cache-Control': 'no-store' });
  }
  const body = await c.req.json().catch(() => null) as { did?: unknown; cid?: unknown } | null;
  const did = typeof body?.did === 'string' ? body.did : '';
  const cid = typeof body?.cid === 'string' ? body.cid : '';
  if (!/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did) || !/^[A-Za-z0-9]{10,128}$/.test(cid)) {
    return c.json({ error: 'A valid did and blob cid are required.' }, 400, { 'Cache-Control': 'no-store' });
  }
  try {
    const pds = await getPdsEndpoint(did, c.env.OWNER_PDS);
    const blobUrl = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
    const res = await fetch(blobUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      res.body?.cancel();
      return c.json({ error: `Could not fetch the video from the account provider (${res.status}).` }, 502, { 'Cache-Control': 'no-store' });
    }
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = VIDEO_MIME_EXT[type];
    if (!ext) {
      res.body?.cancel();
      return c.json({ error: `The blob is not a supported video (${type || 'unknown type'}).` }, 415, { 'Cache-Control': 'no-store' });
    }
    return await store(`video/${did}/${cid}${ext}`, res.body, type, Number(res.headers.get('content-length')));
  } catch (error) {
    console.error('Video storage failed:', error);
    return c.json({ error: 'The video could not be stored. Try again in a moment.' }, 502, { 'Cache-Control': 'no-store' });
  }
});

// Called by the draft editor after publishing or updating a post. Drops the
// Worker's edge-cached copies of the story and the post lists so the next
// request renders the updated record, and — when CF_ZONE_ID/CF_API_TOKEN are
// configured — purges the story URL from the Cloudflare zone cache.
api.post('/author/cache/purge', async (c) => {
  const body = await c.req.json().catch(() => null) as {
    did?: unknown;
    rkey?: unknown;
    site?: unknown;
    path?: unknown;
  } | null;
  const did = typeof body?.did === 'string' ? body.did : '';
  const rkey = typeof body?.rkey === 'string' ? body.rkey : '';
  const site = typeof body?.site === 'string' ? body.site : undefined;
  const path = typeof body?.path === 'string' && /^\/author\/[^/]+\/[^/]+$/.test(body.path) ? body.path : '';
  if (!/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did) || !/^[a-zA-Z0-9._~:-]+$/.test(rkey)) {
    return c.json({ error: 'A valid did and rkey are required.' }, 400, { 'Cache-Control': 'no-store' });
  }
  if (site !== undefined && !/^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/site\.standard\.publication\/[a-zA-Z0-9._~:-]+$/.test(site)) {
    return c.json({ error: 'A valid site.standard.publication AT URI is required for site.' }, 400, { 'Cache-Control': 'no-store' });
  }

  try {
    const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
    await purgePublishedPostCache(pds, c.env.OWNER_DID, did, rkey, site);
  } catch (error) {
    console.error('Could not purge the post edge cache:', error);
  }

  let zonePurged = false;
  if (c.env.CF_ZONE_ID && c.env.CF_API_TOKEN) {
    try {
      const origin = new URL(c.req.url).origin;
      const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${c.env.CF_ZONE_ID}/purge_cache`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: [`${origin}${path || `/author/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`}`] }),
        signal: AbortSignal.timeout(10_000),
      });
      zonePurged = response.ok;
      if (!response.ok) {
        response.body?.cancel();
        console.error(`Cloudflare zone purge failed (${response.status}).`);
      }
    } catch (error) {
      console.error('Could not purge the Cloudflare zone cache:', error);
    }
  }
  return c.json({ ok: true, zonePurged }, 200, { 'Cache-Control': 'no-store' });
});

api.get('/documents/:rkey', async (c) => {
  const loaded = await loadDocumentsSafely(c);
  if (!loaded) return c.json({ error: 'The publication is temporarily unavailable.' }, 503, { 'Cache-Control': 'no-store' });
  const { pds, documents } = loaded;
  if (!documents.length && !await isPdsAvailable(pds)) {
    return c.json({ error: 'The publication is temporarily unavailable.' }, 503, { 'Cache-Control': 'no-store' });
  }
  const { document, ambiguous } = await findDocumentForRequest(documents, c.req.param('rkey'), c.req.query('uri'), pds, c.env.OWNER_DID);
  if (!document) {
    return c.json({
      error: ambiguous
        ? 'Multiple documents use this record key. Specify the document uri query parameter.'
        : 'Document not found.',
    }, ambiguous ? 409 : 404, { 'Cache-Control': 'no-store' });
  }

  return c.json({
    ...documentSummary(document, pds),
    metadata: await documentMetadata(document, pds),
    record: { uri: document.uri, cid: document.cid, value: document.record },
  }, 200, { 'Cache-Control': 'no-store' });
});

export default api;
