import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  USER_PROFILE_COLLECTION,
  buildUserProfileRecord,
  graphemeLength,
  isMissingRecordResponse,
  readUserProfileFields,
  validateUserProfileFields,
} from '../src/lib/userProfile.ts';

const now = new Date('2026-11-14T12:00:00.000Z');

test('builds a new record with trimmed fields and createdAt', () => {
  const record = buildUserProfileRecord(undefined, { displayName: '  Ada  ', pronouns: '', description: 'Hi' }, now);
  assert.deepEqual(record, { $type: USER_PROFILE_COLLECTION, displayName: 'Ada', description: 'Hi', createdAt: now.toISOString() });
});

test('keeps createdAt and unknown fields, removes cleared fields', () => {
  const existing = { $type: USER_PROFILE_COLLECTION, displayName: 'Old', pronouns: 'they/them', createdAt: '2025-01-01T00:00:00.000Z', futureField: 1 };
  const record = buildUserProfileRecord(existing, { displayName: 'New', pronouns: ' ', description: '' }, now);
  assert.deepEqual(record, { $type: USER_PROFILE_COLLECTION, displayName: 'New', createdAt: '2025-01-01T00:00:00.000Z', futureField: 1 });
  assert.equal(existing.displayName, 'Old', 'does not mutate the existing record');
});

test('reads only string fields from a stored record', () => {
  assert.deepEqual(readUserProfileFields({ displayName: 'Ada', pronouns: 5, description: '' }), { displayName: 'Ada' });
  assert.deepEqual(readUserProfileFields(undefined), {});
  assert.deepEqual(readUserProfileFields(['x']), {});
});

test('validates grapheme limits that match the lexicon', () => {
  assert.equal(validateUserProfileFields({ displayName: 'a'.repeat(64) }), undefined);
  assert.match(validateUserProfileFields({ displayName: 'a'.repeat(65) }) || '', /Display name/);
  assert.match(validateUserProfileFields({ description: 'b'.repeat(257) }) || '', /Bio/);
  // A family emoji is one grapheme but several code points.
  assert.equal(graphemeLength('👨‍👩‍👧'), 1);
  assert.equal(validateUserProfileFields({ pronouns: '👨‍👩‍👧'.repeat(40) }), undefined);
});

test('recognises missing-record responses', () => {
  assert.equal(isMissingRecordResponse(404, null), true);
  assert.equal(isMissingRecordResponse(400, { error: 'RecordNotFound' }), true);
  assert.equal(isMissingRecordResponse(400, { error: 'InvalidRequest' }), false);
  assert.equal(isMissingRecordResponse(403, null), false);
});
