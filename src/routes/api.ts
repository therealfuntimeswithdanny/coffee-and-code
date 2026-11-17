import { Hono, type Context } from 'hono';
import { Env, StandardDocument } from '../types';
import { fetchArticleByUri, fetchArticles, fetchPostMetadata, getPdsEndpoint, isPdsAvailable, proxyAvatarUrl, proxyImageUrl } from '../lib/atproto';
import { toPlainText } from '../lib/contentRenderer';
import { loadNotificationsForUser, loadNotificationsFromAppview, validateServiceAuthToken } from '../lib/notifications';
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
    // Signed-in clients send a service-auth JWT minted by their PDS for the
    // HappyView appview (did:web:api.coffeencode.cc); the worker proxies the
    // request since the appview only accepts authenticated calls. Without a
    // token the endpoint falls back to the public-record activity index.
    const authHeader = c.req.header('Authorization') || '';
    const serviceAuthToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    let notifications;
    if (serviceAuthToken) {
      if (!validateServiceAuthToken(serviceAuthToken, did)) {
        return c.json({ error: 'The notification session token is invalid for this account.' }, 401, { 'Cache-Control': 'no-store' });
      }
      notifications = await loadNotificationsFromAppview(serviceAuthToken);
    } else {
      notifications = await loadNotificationsForUser(c.env, did);
    }
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
