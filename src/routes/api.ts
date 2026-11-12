import { Hono, type Context } from 'hono';
import { Env, StandardDocument } from '../types';
import { fetchArticleByUri, fetchArticles, getPdsEndpoint, isPdsAvailable, proxyAvatarUrl, proxyImageUrl } from '../lib/atproto';
import { detectFormat, renderContent, renderHtmlAsMarkdown, renderLeaflet, renderMarkdownEmbeds } from '../lib/contentRenderer';

const api = new Hono<{ Bindings: Env }>();

function leafletFallbackMarkdown(document: StandardDocument, content: any): string {
  const did = document.repoDid || document.uri.match(/^at:\/\/(did:[^/]+)\//)?.[1];
  const pages = Array.isArray(content?.pages) ? content.pages : [];
  return pages.flatMap((page: any) => Array.isArray(page.blocks) ? page.blocks : []).map((wrapper: any) => {
    const block = wrapper?.block || wrapper;
    if (block?.$type === 'pub.leaflet.blocks.text') return typeof block.plaintext === 'string' ? block.plaintext.trim() : '';
    if (block?.$type === 'pub.leaflet.blocks.blockquote') return `> ${(block.plaintext || block.text || '').trim()}`;
    if (block?.$type === 'pub.leaflet.blocks.horizontalRule') return '---';
    if (block?.$type === 'pub.leaflet.blocks.image' || block?.$type === 'pub.leaflet.blocks.imageGallery') {
      const images = block.$type === 'pub.leaflet.blocks.image' ? [block] : (block.images || []);
      return images.map((item: any) => {
        const cid = item.image?.ref?.$link;
        if (!cid || !did) return '';
        const imageUrl = `https://cdn.coffeencode.cc/blob/${encodeURIComponent(did)}/${encodeURIComponent(cid)}/feed_fullsize`;
        return `![${item.alt || 'Article image'}](${imageUrl})`;
      }).filter(Boolean).join('\n\n');
    }
    if (block?.$type === 'pub.leaflet.blocks.iframe' || block?.$type === 'pub.leaflet.blocks.html') {
      const html = renderLeaflet({ $type: 'pub.leaflet.content', pages: [{ blocks: [wrapper] }] });
      return renderHtmlAsMarkdown(html);
    }
    return '';
  }).filter(Boolean).join('\n\n');
}

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
    markdownUrl: `${origin}/api/documents?uri=${encodeURIComponent(post.uri)}`,
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
  let parsed: any;
  if (document.format === 'leaflet' || format === 'richtext') {
    try { parsed = JSON.parse(content); } catch { parsed = undefined; }
  }
  const isLeaflet = parsed?.$type === 'pub.leaflet.content';
  const renderedLeaflet = isLeaflet ? renderHtmlAsMarkdown(renderLeaflet(parsed)).trim() : '';
  const markdown = isLeaflet
    ? renderedLeaflet || leafletFallbackMarkdown(document, parsed)
    : document.format === 'markdown' || format === 'markdown'
      ? renderMarkdownEmbeds(content)
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
        ...documentSummary(document, new URL(c.req.url).origin, pds),
        content: await markdownDocument(document),
        format: 'markdown',
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
  const origin = new URL(c.req.url).origin;

  return c.json({
    documents: documents.slice(0, limit).map((document) => documentSummary(document, origin, pds)),
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
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return c.json({ error: 'limit must be an integer between 1 and 100.' }, 400);
  }

  type Backlink = { did: string; collection: string; rkey: string };
  type Activity = {
    uri: string;
    type: 'comment' | 'comment.like';
    actorDid: string;
    subjectUri: string;
    recordKey: string;
    createdAt?: string;
    text?: string;
  };
  const backlinkUrl = (subjectUri: string, source: string) => {
    const url = new URL('https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks');
    url.searchParams.set('subject', subjectUri);
    url.searchParams.set('source', source);
    url.searchParams.set('limit', '100');
    return url;
  };
  const fetchBacklinks = async (subjectUri: string, source: string, collection: string) => {
    const response = await fetch(backlinkUrl(subjectUri, source), {
      headers: { Accept: 'application/json', 'User-Agent': 'CoffeeAndCode (coffeencode.cc)' },
    });
    if (!response.ok) throw new Error(`Activity index returned ${response.status}`);
    const data = await response.json() as { records?: Backlink[] };
    return (data.records || []).filter((record) => record.collection === collection
      && /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(record.did)
      && /^[a-zA-Z0-9._~:-]+$/.test(record.rkey));
  };

  try {
    const { documents } = await loadDocuments(c);
    const documentUris = [...new Set(documents.map((document) => document.uri).filter(Boolean))];
    const commentsByDocument = await Promise.all(documentUris.map(async (uri) => ({
      uri,
      records: await fetchBacklinks(uri, 'cc.coffeencode.comment:subject.uri', 'cc.coffeencode.comment'),
    })));
    const commentEntries = commentsByDocument.flatMap(({ uri, records }) => records.map((record) => ({
      ...record,
      subjectUri: uri,
      uri: `at://${record.did}/cc.coffeencode.comment/${record.rkey}`,
    })));

    const likesByComment = await Promise.all(commentEntries.map(async (comment) => ({
      comment,
      records: await fetchBacklinks(comment.uri, 'cc.coffeencode.comment.like:subject.uri', 'cc.coffeencode.comment.like'),
    })));
    const activities: Activity[] = [
      ...commentEntries.map((comment) => ({
        uri: comment.uri,
        type: 'comment' as const,
        actorDid: comment.did,
        subjectUri: comment.subjectUri,
        recordKey: comment.rkey,
      })),
      ...likesByComment.flatMap(({ comment, records }) => records.map((record) => ({
        uri: `at://${record.did}/cc.coffeencode.comment.like/${record.rkey}`,
        type: 'comment.like' as const,
        actorDid: record.did,
        subjectUri: comment.uri,
        recordKey: record.rkey,
      }))),
    ];

    // Fetch the small activity window's records for displayable text and time.
    // TID record keys sort by creation time, providing a useful candidate
    // window before we fetch records for their timestamps.
    activities.sort((a, b) => b.recordKey.localeCompare(a.recordKey));
    const records = await Promise.all(activities.slice(0, limit).map(async (activity) => {
      try {
        const collection = activity.type === 'comment'
          ? 'cc.coffeencode.comment'
          : 'cc.coffeencode.comment.like';
        const rkey = activity.recordKey;
        const pds = await getPdsEndpoint(activity.actorDid, c.env.OWNER_PDS);
        const recordUrl = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
        recordUrl.searchParams.set('repo', activity.actorDid);
        recordUrl.searchParams.set('collection', collection);
        recordUrl.searchParams.set('rkey', rkey);
        const response = await fetch(recordUrl, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          const { recordKey: _recordKey, ...notification } = activity;
          return notification;
        }
        const data = await response.json() as { value?: { createdAt?: string; text?: string } };
        return {
          uri: activity.uri,
          type: activity.type,
          actorDid: activity.actorDid,
          subjectUri: activity.subjectUri,
          ...(typeof data.value?.createdAt === 'string' ? { createdAt: data.value.createdAt } : {}),
          ...(activity.type === 'comment' && typeof data.value?.text === 'string' ? { text: data.value.text } : {}),
        };
      } catch {
        const { recordKey: _recordKey, ...notification } = activity;
        return notification;
      }
    }));
    records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.uri.localeCompare(a.uri));
    return c.json({ notifications: records, limit }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Failed to load notifications:', error);
    return c.json({ error: 'Notifications are temporarily unavailable.' }, 502);
  }
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
    'Cache-Control': 'no-store',
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
  }, 200, { 'Cache-Control': 'no-store' });
});

export default api;
