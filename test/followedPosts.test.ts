import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFollowedPostMatches } from '../src/lib/followedPosts.ts';
import type { StandardDocument } from '../src/types.ts';

function document(overrides: Partial<StandardDocument> = {}): StandardDocument {
  return {
    uri: 'at://did:plc:author/site.standard.document/post',
    cid: 'bafy',
    rkey: 'post',
    title: 'A new post',
    content: '',
    publishedAt: '2026-11-14T12:00:00.000Z',
    path: '/post',
    repoDid: 'did:plc:author',
    author: { did: 'did:plc:author', handle: 'author.test' },
    ...overrides,
  };
}

test('matches recent posts by followed authors and followed tags case-insensitively', () => {
  const post = document({ tags: ['TypeScript', 'typescript'] });
  const matches = findFollowedPostMatches(
    [post],
    new Map([['did:plc:author', Date.parse('2026-11-14T11:00:00.000Z')]]),
    new Map([['typescript', Date.parse('2026-11-14T11:30:00.000Z')]]),
    'did:plc:reader',
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].document, post);
  assert.deepEqual(matches[0].matchedTags, ['TypeScript']);
});

test('does not notify for posts published before the follow, but includes the reader\'s own posts', () => {
  const olderPost = document({ publishedAt: '2026-11-14T10:00:00.000Z', tags: ['TypeScript'] });
  const ownPost = document({
    author: { did: 'did:plc:reader', handle: 'reader.test' },
    tags: ['TypeScript'],
  });

  const matches = findFollowedPostMatches(
    [olderPost, ownPost],
    new Map([['did:plc:author', Date.parse('2026-11-14T11:00:00.000Z')]]),
    new Map([['typescript', Date.parse('2026-11-14T11:00:00.000Z')]]),
    'did:plc:reader',
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].document, ownPost);
});
