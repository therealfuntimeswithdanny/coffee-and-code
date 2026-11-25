import type { Env } from '../types';
import { fetchArticles, getPdsEndpoint, proxyAvatarUrl } from './atproto';
import { findFollowedPostMatches } from './followedPosts';

export type NotificationType =
  | 'comment'
  | 'comment.reply'
  | 'comment.like'
  | 'post.like'
  | 'post.view'
  | 'followed.post';

export type Notification = {
  uri: string;
  type: NotificationType;
  actorDid: string;
  subjectUri: string;
  documentUri: string;
  documentTitle: string;
  documentPath: string;
  targetUri?: string;
  matchedTags?: string[];
  createdAt?: string;
  text?: string;
  targetText?: string;
  actorName?: string;
  actorHandle?: string;
  actorAvatar?: string;
  // followed.post items carry the document body so email can include the story.
  documentContent?: string;
  documentFormat?: string;
  documentMimeType?: string;
};

type Backlink = { did: string; collection: string; rkey: string };
type Activity = Notification & { recordKey: string };

const DID_PATTERN = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;
const RKEY_PATTERN = /^[a-zA-Z0-9._~:-]+$/;

// AT Protocol records are public and immutable in normal use. Constellation
// indexes backlinks across repositories, so this produces a current activity
// feed without maintaining a separate copy of the firehose.
export async function loadNotificationsForUser(env: Env, did: string): Promise<Notification[]> {
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
      && DID_PATTERN.test(record.did)
      && RKEY_PATTERN.test(record.rkey));
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

  const pds = await getPdsEndpoint(env.OWNER_DID, env.OWNER_PDS);
  const documents = await fetchArticles(pds, env.OWNER_DID);
  const ownPds = await getPdsEndpoint(did, env.OWNER_PDS);
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
    if (typeof value.subject === 'string' && DID_PATTERN.test(value.subject)) {
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
      ...(typeof document.content === 'string' && document.content ? {
        documentContent: document.content,
        ...(document.format ? { documentFormat: document.format } : {}),
        ...(document.mimeType ? { documentMimeType: document.mimeType } : {}),
      } : {}),
      recordKey: document.rkey,
      createdAt: document.publishedAt,
    });
  }
  const activities = [...activitiesByUri.values()];

  // Fetch the small activity window's records for displayable text and time.
  // TID record keys sort by creation time, providing a useful candidate
  // window before we fetch records for their timestamps.
  activities.sort((a, b) => b.recordKey.localeCompare(a.recordKey));
  const selectedActivities = activities.slice(0, 30);
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
      const actorPds = await getPdsEndpoint(activity.actorDid, env.OWNER_PDS);
      const recordUrl = new URL(`${actorPds}/xrpc/com.atproto.repo.getRecord`);
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
  return notifications;
}
