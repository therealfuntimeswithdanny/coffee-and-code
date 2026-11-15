import { Hono, type Context } from 'hono';
import { Env, StandardDocument } from '../types';
import { fetchArticleByUri, fetchArticles, getPdsEndpoint, isPdsAvailable, proxyAvatarUrl, proxyImageUrl } from '../lib/atproto';
import { findFollowedPostMatches } from '../lib/followedPosts';

const api = new Hono<{ Bindings: Env }>();

function documentSummary(post: StandardDocument, pds: string) {
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

  type Backlink = { did: string; collection: string; rkey: string };
  type Activity = {
    uri: string;
    type: 'comment' | 'comment.reply' | 'comment.like' | 'post.like' | 'post.view' | 'followed.post';
    actorDid: string;
    subjectUri: string;
    documentUri: string;
    documentTitle: string;
    documentPath: string;
    targetUri?: string;
    matchedTags?: string[];
    recordKey: string;
    createdAt?: string;
    text?: string;
    targetText?: string;
    actorName?: string;
    actorHandle?: string;
    actorAvatar?: string;
  };
  type Notification = Omit<Activity, 'recordKey'>;
  const respondWithNotifications = (notifications: Notification[]) => {
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
  const fetchRepoRecords = async (pds: string, collection: string) => {
    const records: Array<{ value: Record<string, unknown> }> = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
      url.searchParams.set('repo', did);
      url.searchParams.set('collection', collection);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Could not load ${collection} records (${response.status})`);
      const data = await response.json() as {
        records?: Array<{ value?: unknown }>;
        cursor?: unknown;
      };
      for (const record of data.records || []) {
        if (typeof record.value === 'object' && record.value !== null && !Array.isArray(record.value)) {
          records.push({ value: record.value as Record<string, unknown> });
        }
      }
      if (records.length > 10_000) throw new Error(`The ${collection} record list is too large to load.`);
      if (typeof data.cursor !== 'string' || !data.cursor) break;
      if (seenCursors.has(data.cursor)) throw new Error(`The account provider returned a repeated ${collection} cursor.`);
      seenCursors.add(data.cursor);
      cursor = data.cursor;
    } while (cursor);
    return records;
  };

  try {
    const { documents } = await loadDocuments(c);
    const ownPds = await getPdsEndpoint(did, c.env.OWNER_PDS);
    const [authorFollowRecords, tagFollowRecords, blueskyFollowRecords] = await Promise.all([
      fetchRepoRecords(ownPds, 'cc.coffeencode.author.follow'),
      fetchRepoRecords(ownPds, 'cc.coffeencode.tag.follow'),
      fetchRepoRecords(ownPds, 'app.bsky.graph.follow'),
    ]);
    const authorFollowedAt = new Map<string, number>();
    const tagFollowedAt = new Map<string, number>();
    const addFollow = (map: Map<string, number>, key: string, createdAt: unknown) => {
      const normalizedKey = key.toLocaleLowerCase();
      const timestamp = typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt))
        ? Date.parse(createdAt)
        : Number.NEGATIVE_INFINITY;
      map.set(normalizedKey, Math.min(map.get(normalizedKey) ?? Number.POSITIVE_INFINITY, timestamp));
    };
    for (const { value } of [...authorFollowRecords, ...blueskyFollowRecords]) {
      if (typeof value.subject === 'string' && /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(value.subject)) {
        addFollow(authorFollowedAt, value.subject, value.createdAt);
      }
    }
    for (const { value } of tagFollowRecords) {
      const tag = typeof value.tag === 'string' ? value.tag : value.subject;
      if (typeof tag === 'string' && tag.trim()) addFollow(tagFollowedAt, tag.trim(), value.createdAt);
    }
    const documentUris = [...new Set(documents.map((document) => document.uri).filter(Boolean))];
    const documentByUri = new Map(documents.map((document) => [document.uri, document]));
    const userDocuments = documents.filter((document) =>
      document.author?.did.toLowerCase() === did.toLowerCase()
      || (!document.author && document.repoDid?.toLowerCase() === did.toLowerCase()));
    const commentsByDocument = await Promise.all(documentUris.map(async (uri) => ({
      uri,
      records: await fetchBacklinks(uri, 'cc.coffeencode.comment:subject.uri', 'cc.coffeencode.comment'),
    })));
    const documentComments = commentsByDocument.flatMap(({ uri, records }) => records.map((record) => ({
      ...record,
      subjectUri: uri,
      documentTitle: documentByUri.get(uri)?.title || 'Untitled story',
      documentPath: documentByUri.get(uri)?.path || '/',
      uri: `at://${record.did}/cc.coffeencode.comment/${record.rkey}`,
    })));

    const ownComments = documentComments.filter((comment) => comment.did.toLowerCase() === did.toLowerCase());
    const [commentLikes, repliesToOwnComments, postLikes, postViews] = await Promise.all([
      Promise.all(ownComments.map(async (comment) => ({
        comment,
        records: await fetchBacklinks(comment.uri, 'cc.coffeencode.comment.like:subject.uri', 'cc.coffeencode.comment.like'),
      }))),
      Promise.all(ownComments.map(async (comment) => ({
        comment,
        records: await fetchBacklinks(comment.uri, 'cc.coffeencode.comment:reply.parent.uri', 'cc.coffeencode.comment'),
      }))),
      Promise.all(userDocuments.map(async (document) => ({
        document,
        records: await fetchBacklinks(document.uri, 'cc.coffeencode.interact.like:document', 'cc.coffeencode.interact.like'),
      }))),
      Promise.all(userDocuments.map(async (document) => ({
        document,
        records: await fetchBacklinks(document.uri, 'cc.coffeencode.interact.view:document', 'cc.coffeencode.interact.view'),
      }))),
    ]);

    const ownReplyUris = new Set(repliesToOwnComments.flatMap(({ records }) => records
      .filter((record) => record.did.toLowerCase() !== did.toLowerCase())
      .map((record) => `at://${record.did}/cc.coffeencode.comment/${record.rkey}`)));
    const activitiesByUri = new Map<string, Activity>();
    for (const comment of documentComments) {
      if (comment.did.toLowerCase() === did.toLowerCase() || ownReplyUris.has(comment.uri)) continue;
      if (!userDocuments.some((document) => document.uri === comment.subjectUri)) continue;
      activitiesByUri.set(comment.uri, {
        uri: comment.uri,
        type: 'comment',
        actorDid: comment.did,
        subjectUri: comment.subjectUri,
        documentUri: comment.subjectUri,
        documentTitle: comment.documentTitle,
        documentPath: comment.documentPath,
        recordKey: comment.rkey,
      });
    }
    for (const { comment, records } of repliesToOwnComments) {
      for (const record of records) {
        if (record.did.toLowerCase() === did.toLowerCase()) continue;
        const uri = `at://${record.did}/cc.coffeencode.comment/${record.rkey}`;
        activitiesByUri.set(uri, {
          uri,
          type: 'comment.reply',
          actorDid: record.did,
          subjectUri: comment.uri,
          documentUri: comment.subjectUri,
          documentTitle: comment.documentTitle,
          documentPath: comment.documentPath,
          targetUri: comment.uri,
          recordKey: record.rkey,
        });
      }
    }
    for (const { comment, records } of commentLikes) {
      for (const record of records) {
        if (record.did.toLowerCase() === did.toLowerCase()) continue;
        const uri = `at://${record.did}/cc.coffeencode.comment.like/${record.rkey}`;
        activitiesByUri.set(uri, {
          uri,
          type: 'comment.like',
          actorDid: record.did,
          subjectUri: comment.uri,
          documentUri: comment.subjectUri,
          documentTitle: comment.documentTitle,
          documentPath: comment.documentPath,
          targetUri: comment.uri,
          recordKey: record.rkey,
        });
      }
    }
    for (const { document, records } of postLikes) {
      for (const record of records) {
        if (record.did.toLowerCase() === did.toLowerCase()) continue;
        const uri = `at://${record.did}/cc.coffeencode.interact.like/${record.rkey}`;
        activitiesByUri.set(uri, {
          uri,
          type: 'post.like',
          actorDid: record.did,
          subjectUri: document.uri,
          documentUri: document.uri,
          documentTitle: document.title || 'Untitled story',
          documentPath: document.path,
          recordKey: record.rkey,
        });
      }
    }
    for (const { document, records } of postViews) {
      for (const record of records) {
        if (record.did.toLowerCase() === did.toLowerCase()) continue;
        const uri = `at://${record.did}/cc.coffeencode.interact.view/${record.rkey}`;
        activitiesByUri.set(uri, {
          uri,
          type: 'post.view',
          actorDid: record.did,
          subjectUri: document.uri,
          documentUri: document.uri,
          documentTitle: document.title || 'Untitled story',
          documentPath: document.path,
          recordKey: record.rkey,
        });
      }
    }
    for (const { document, actorDid, matchedTags } of findFollowedPostMatches(
      documents,
      authorFollowedAt,
      tagFollowedAt,
      did,
    )) {
      activitiesByUri.set(document.uri, {
        uri: document.uri,
        type: 'followed.post',
        actorDid,
        subjectUri: document.uri,
        documentUri: document.uri,
        documentTitle: document.title || 'Untitled story',
        documentPath: document.path,
        ...(matchedTags.length ? { matchedTags } : {}),
        recordKey: document.rkey,
        createdAt: document.publishedAt,
      });
    }
    const activities = [...activitiesByUri.values()];

    // Fetch the small activity window's records for displayable text and time.
    // TID record keys sort by creation time, providing a useful candidate
    // window before we fetch records for their timestamps.
    activities.sort((a, b) => b.recordKey.localeCompare(a.recordKey));
    const selectedActivities = activities.slice(0, 100);
    const records = await Promise.all(selectedActivities.map(async (activity) => {
      if (activity.type === 'followed.post') {
        const { recordKey: _recordKey, ...notification } = activity;
        return notification;
      }
      try {
        const collection = activity.type === 'comment.like'
          ? 'cc.coffeencode.comment.like'
          : activity.type === 'post.like'
            ? 'cc.coffeencode.interact.like'
            : activity.type === 'post.view'
              ? 'cc.coffeencode.interact.view'
            : 'cc.coffeencode.comment';
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
        const data = await response.json() as { value?: { createdAt?: string; text?: string; document?: string } };
        return {
          uri: activity.uri,
          type: activity.type,
          actorDid: activity.actorDid,
          subjectUri: activity.subjectUri,
          documentUri: activity.documentUri,
          documentTitle: activity.documentTitle,
          documentPath: activity.documentPath,
          ...(activity.targetUri ? { targetUri: activity.targetUri } : {}),
          ...(typeof data.value?.createdAt === 'string' ? { createdAt: data.value.createdAt } : {}),
          ...((activity.type === 'comment' || activity.type === 'comment.reply') && typeof data.value?.text === 'string' ? { text: data.value.text } : {}),
        };
      } catch {
        const { recordKey: _recordKey, ...notification } = activity;
        return notification;
      }
    }));

    const targetCommentUris = [...new Set(records
      .filter((activity) => activity.type === 'comment.like' && activity.targetUri)
      .map((activity) => activity.targetUri!))];
    const commentTextByUri = new Map<string, string>();
    await Promise.all(targetCommentUris.map(async (uri) => {
      const match = uri.match(/^at:\/\/(did:[^/]+)\/cc\.coffeencode\.comment\/([a-zA-Z0-9._~:-]+)$/);
      if (!match || match[1].toLowerCase() !== did.toLowerCase()) return;
      try {
        const recordUrl = new URL(`${ownPds}/xrpc/com.atproto.repo.getRecord`);
        recordUrl.searchParams.set('repo', did);
        recordUrl.searchParams.set('collection', 'cc.coffeencode.comment');
        recordUrl.searchParams.set('rkey', match[2]);
        const response = await fetch(recordUrl, { headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const data = await response.json() as { value?: { text?: unknown } };
        if (typeof data.value?.text === 'string') commentTextByUri.set(uri, data.value.text);
      } catch { /* The like notification remains useful without the quoted comment. */ }
    }));

    const actorDids = [...new Set(records.map((activity) => activity.actorDid))];
    const profiles = await Promise.all(actorDids.map(async (actorDid): Promise<[string, { handle?: string; displayName?: string; avatar?: string }]> => {
      try {
        const profileUrl = new URL('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile');
        profileUrl.searchParams.set('actor', actorDid);
        const response = await fetch(profileUrl, { headers: { Accept: 'application/json' } });
        if (response.ok) return [actorDid, await response.json() as { handle?: string; displayName?: string; avatar?: string }];
      } catch { /* Profile decoration is optional. */ }
      return [actorDid, {}];
    }));
    const profileByDid = new Map(profiles);
    const notifications = records.map((activity) => {
      const profile = profileByDid.get(activity.actorDid);
      return {
        ...activity,
        ...(activity.targetUri && commentTextByUri.has(activity.targetUri) ? { targetText: commentTextByUri.get(activity.targetUri) } : {}),
        actorName: profile?.displayName || profile?.handle || activity.actorDid,
        ...(profile?.handle ? { actorHandle: profile.handle } : {}),
        ...(profile?.avatar ? { actorAvatar: proxyAvatarUrl(profile.avatar) } : {}),
      };
    });
    notifications.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.uri.localeCompare(a.uri));
    return respondWithNotifications(notifications);
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
    record: { uri: document.uri, cid: document.cid, value: document.record },
  }, 200, { 'Cache-Control': 'no-store' });
});

export default api;
