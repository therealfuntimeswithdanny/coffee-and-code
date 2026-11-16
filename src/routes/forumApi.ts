import { Hono } from 'hono';
import { Env } from '../types';
import { getPdsEndpoint, proxyImageUrl, resolveAtprotoIdentifier } from '../lib/atproto';
import {
  fetchModerations,
  getForumConfig,
  getVoteScore,
  listForumPosts,
  listReplies,
  moderationStates,
  readPost,
  type ForumConfig,
  type ForumPost,
  type ForumReply,
  type ModerationState,
} from './forum';

// JSON endpoints for the mobile app. The HTML forum lives in forum.ts; these
// routes reuse the same AT Protocol reads so both clients agree on content,
// moderation, and scores.

const forumApi = new Hono<{ Bindings: Env }>();
const apiPageLimit = 50;

function imageUrls(images: Array<{ cid: string; alt: string }>, did: string, pds: string) {
  return images.map(({ cid, alt }) => ({
    alt,
    url: proxyImageUrl(
      `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`,
      pds,
      'feed_medium',
    ),
  }));
}

function postJson(post: ForumPost, state: ModerationState | undefined) {
  return {
    uri: post.uri,
    cid: post.cid,
    rkey: post.rkey,
    authorDid: post.authorDid,
    handle: post.handle,
    name: post.name,
    avatar: post.avatar,
    title: post.title,
    content: post.content,
    createdAt: post.createdAt,
    tags: post.tags,
    images: imageUrls(post.images, post.authorDid, post.pds),
    score: post.score,
    pinned: Boolean(state?.pinned),
    locked: Boolean(state?.locked),
  };
}

function replyJson(reply: ForumReply, state: ModerationState | undefined) {
  return {
    uri: reply.uri,
    cid: reply.cid,
    authorDid: reply.authorDid,
    handle: reply.handle,
    name: reply.name,
    avatar: reply.avatar,
    parentUri: reply.parentUri,
    content: reply.content,
    createdAt: reply.createdAt,
    images: imageUrls(reply.images, reply.authorDid, reply.pds),
    score: reply.score,
    hidden: Boolean(state?.hidden),
  };
}

function configJson(config: ForumConfig) {
  return {
    uri: config.uri,
    name: config.name,
    description: config.description || '',
    tags: config.tags,
    rules: config.rules,
    moderators: config.moderators,
  };
}

async function loadConfig(c: { env: Env }) {
  try {
    const config = await getForumConfig(c.env.OWNER_PDS);
    return config || null;
  } catch (error) {
    console.error('Could not load the forum configuration:', error);
    return null;
  }
}

forumApi.get('/', async (c) => {
  const config = await loadConfig(c);
  if (!config) return c.json({ error: 'The forum is temporarily unavailable.' }, 503, { 'Cache-Control': 'no-store' });

  const queryTag = (c.req.query('tag') || '').trim().slice(0, 32);
  const query = (c.req.query('q') || '').trim().slice(0, 200);
  const sort = c.req.query('sort') === 'top' ? 'top' : 'new';
  const page = Math.max(1, Number(c.req.query('page')) || 1);

  try {
    const [allPosts, moderations] = await Promise.all([
      listForumPosts(config, c.env.OWNER_PDS),
      fetchModerations(config, c.env.OWNER_PDS),
    ]);
    const states = moderationStates(moderations);
    const posts = allPosts.filter((post) => {
      const state = states.get(post.uri);
      const matchesTag = !queryTag || post.tags.some((tag) => tag.toLowerCase() === queryTag.toLowerCase());
      const searchText = `${post.title}\n${post.content}\n${post.tags.join(' ')}`.toLowerCase();
      return !state?.hidden && matchesTag && (!query || searchText.includes(query.toLowerCase()));
    });
    const toScore = sort === 'top' ? posts : posts.slice((page - 1) * apiPageLimit, page * apiPageLimit);
    for (let offset = 0; offset < toScore.length; offset += 8) {
      const batch = toScore.slice(offset, offset + 8);
      const scores = await Promise.all(batch.map((post) => getVoteScore(post.uri, c.env.OWNER_PDS)));
      batch.forEach((post, index) => { post.score = scores[index]; });
    }
    posts.sort((a, b) => Number(Boolean(states.get(b.uri)?.pinned)) - Number(Boolean(states.get(a.uri)?.pinned))
      || (sort === 'top' ? b.score - a.score : 0)
      || b.createdAt.localeCompare(a.createdAt));
    const pagePosts = posts.slice((page - 1) * apiPageLimit, page * apiPageLimit);
    return c.json({
      forum: configJson(config),
      posts: pagePosts.map((post) => postJson(post, states.get(post.uri))),
      total: posts.length,
      page,
      hasMore: posts.length > page * apiPageLimit,
    }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Could not load forum posts for the API:', error);
    return c.json({ error: 'The forum is temporarily unavailable.' }, 502, { 'Cache-Control': 'no-store' });
  }
});

forumApi.get('/thread', async (c) => {
  const uri = (c.req.query('uri') || '').trim();
  const match = uri.match(/^at:\/\/(did:[a-z0-9]+:[a-zA-Z0-9._:%-]+)\/cc\.coffeencode\.forum\.post\/([a-zA-Z0-9._~:-]+)$/);
  if (!match) return c.json({ error: 'A valid forum post AT URI is required.' }, 400, { 'Cache-Control': 'no-store' });
  const [, authorDid, rkey] = match;

  const config = await loadConfig(c);
  if (!config) return c.json({ error: 'The forum is temporarily unavailable.' }, 503, { 'Cache-Control': 'no-store' });

  try {
    const [post, moderations] = await Promise.all([
      readPost(authorDid, rkey, c.env.OWNER_PDS, config.uri, true),
      fetchModerations(config, c.env.OWNER_PDS),
    ]);
    if (!post) return c.json({ error: 'Discussion not found.' }, 404, { 'Cache-Control': 'no-store' });
    const states = moderationStates(moderations);
    const rootState = states.get(post.uri);
    if (rootState?.hidden) return c.json({ error: 'This discussion is no longer available.' }, 404, { 'Cache-Control': 'no-store' });
    const replies = await listReplies(post.uri, c.env.OWNER_PDS);
    return c.json({
      forum: configJson(config),
      post: postJson(post, rootState),
      replies: replies
        .filter((reply) => !states.get(reply.uri)?.hidden)
        .map((reply) => replyJson(reply, states.get(reply.uri))),
      locked: Boolean(rootState?.locked),
    }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error(`Could not load forum thread ${uri} for the API:`, error);
    return c.json({ error: 'This discussion could not be loaded. Please try again later.' }, 502, { 'Cache-Control': 'no-store' });
  }
});

// Convenience lookup mirroring the web URL shape /forum/:handle/:rkey so the
// app can resolve a post URI from a shared link.
forumApi.get('/resolve', async (c) => {
  const handle = (c.req.query('handle') || '').trim().slice(0, 253);
  const rkey = (c.req.query('rkey') || '').trim();
  if (!handle || !/^[a-zA-Z0-9._~:-]{1,512}$/.test(rkey)) {
    return c.json({ error: 'A handle and record key are required.' }, 400, { 'Cache-Control': 'no-store' });
  }
  try {
    const did = await resolveAtprotoIdentifier(handle);
    if (!did) return c.json({ error: 'Discussion not found.' }, 404, { 'Cache-Control': 'no-store' });
    return c.json({ uri: `at://${did}/cc.coffeencode.forum.post/${rkey}` }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Could not resolve forum post author:', error);
    return c.json({ error: 'The discussion author could not be reached.' }, 502, { 'Cache-Control': 'no-store' });
  }
});

export default forumApi;
