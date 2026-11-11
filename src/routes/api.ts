import { Hono, type Context } from 'hono';
import { Env, StandardDocument } from '../types';
import { fetchArticleByUri, fetchArticles, getPdsEndpoint, isPdsAvailable, proxyAvatarUrl, proxyImageUrl } from '../lib/atproto';
import { detectFormat, renderContent, renderHtmlAsMarkdown } from '../lib/contentRenderer';

const api = new Hono<{ Bindings: Env }>();

function documentSummary(post: StandardDocument, origin: string, pds: string) {
  return {
    uri: post.uri,
    title: post.title,
    description: post.description || '',
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
    markdownUrl: `${origin}/api/documents/${encodeURIComponent(post.rkey)}.md?uri=${encodeURIComponent(post.uri)}`,
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

async function markdownDocument(document: StandardDocument) {
  const content = document.content || '';
  const format = detectFormat(content, document.mimeType);
  const markdown = document.format === 'markdown' || format === 'markdown'
    ? content
    : format === 'plaintext'
      ? content
      : renderHtmlAsMarkdown(await renderContent(content, document.format, document.mimeType));

  return [
    `# ${document.title}`,
    document.description?.trim(),
    markdown.trim(),
  ].filter(Boolean).join('\n\n');
}

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
    document ? documentSummary(document, origin, pds) : null;

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
    latest: latest.map((document) => documentSummary(document, origin, pds)),
    pinned: pinnedStories.map((document) => documentSummary(document, origin, pds)),
    more: more.map((document) => documentSummary(document, origin, pds)),
    authors: [...authors.values()],
  }, 200, { 'Cache-Control': 'public, max-age=60' });
});

api.get('/documents', async (c) => {
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
  const origin = new URL(c.req.url).origin;

  return c.json({
    documents: documents.slice(0, limit).map((document) => documentSummary(document, origin, pds)),
    totalAvailable: documents.length,
    limit,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
});

api.get('/documents/:rkey.md', async (c) => {
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

  return c.body(await markdownDocument(document), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
  });
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
    ...documentSummary(document, new URL(c.req.url).origin, pds),
    content: await markdownDocument(document),
    format: 'markdown',
  }, 200, { 'Cache-Control': 'public, max-age=60' });
});

export default api;
