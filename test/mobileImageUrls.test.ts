import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cdnBlobImageUrl, imageUrlForPreset } from '../mobile/src/imageUrls.js';

test('replaces an existing CDN blob preset', () => {
  assert.equal(
    imageUrlForPreset('https://cdn.coffeencode.cc/blob/did%3Aplc%3Aexample/cid/feed_medium', 'feed_thumb'),
    'https://cdn.coffeencode.cc/blob/did%3Aplc%3Aexample/cid/feed_thumb',
  );
});

test('converts Coffee & Code CDN image types to the requested preset', () => {
  assert.equal(
    imageUrlForPreset('https://cdn.coffeencode.cc/img/feed_fullsize/plain/did:plc:example/cid@jpeg', 'wide_medium'),
    'https://cdn.coffeencode.cc/img/wide_medium/plain/did:plc:example/cid@jpeg',
  );
});

test('builds CDN blob URLs for app-owned profile images', () => {
  assert.equal(
    cdnBlobImageUrl('did:plc:example', 'blob-cid', 'avatar_small'),
    'https://cdn.coffeencode.cc/blob/did%3Aplc%3Aexample/blob-cid/avatar_small',
  );
});

test('leaves non-CDN and non-URL image sources unchanged', () => {
  const pdsUrl = 'https://pds.example/blob';
  assert.equal(imageUrlForPreset(pdsUrl, 'feed_thumb'), pdsUrl);
  assert.equal(imageUrlForPreset(undefined, 'feed_thumb'), undefined);
});
