import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { USER_PROFILE_LIMITS } from '../src/lib/userProfile.ts';

const root = new URL('../lexicons/', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.json') ? [path] : [];
  });
}

const lexicons = new Map(files(root).map((path) => [path, JSON.parse(readFileSync(path, 'utf8'))]));
const ids = new Set([...lexicons.values()].map((lexicon) => lexicon.id));

test('every lexicon file is a v1 lexicon whose id matches its path', () => {
  for (const [path, lexicon] of lexicons) {
    assert.equal(lexicon.lexicon, 1, path);
    assert.equal(lexicon.id, relative(root, path).replace(/\.json$/, '').split(sep).join('.'), path);
    assert.ok(lexicon.defs && Object.values(lexicon.defs).every((def: any) => typeof def.type === 'string'), path);
  }
});

test('local references point at lexicons in this repo', () => {
  for (const [path, lexicon] of lexicons) {
    for (const [, ref] of JSON.stringify(lexicon).matchAll(/"ref":"(cc\.coffeencode\.[^"#]+)/g)) {
      assert.ok(ids.has(ref), `${path} references missing ${ref}`);
    }
  }
});

test('the collections the website writes have lexicons', () => {
  for (const id of ['cc.coffeencode.profile', 'cc.coffeencode.save', 'cc.coffeencode.user.block', 'cc.coffeencode.tag.follow', 'cc.coffeencode.authPublic']) {
    assert.ok(ids.has(id), id);
  }
});

test('the profile editor limits match the profile lexicon', () => {
  const profile = [...lexicons.values()].find((lexicon) => lexicon.id === 'cc.coffeencode.profile');
  const properties = profile.defs.main.record.properties;
  for (const [field, limit] of Object.entries(USER_PROFILE_LIMITS)) {
    assert.equal(properties[field].maxGraphemes, limit, field);
  }
});

test('the profile collection is granted by a permission set the website requests', () => {
  const metadata = JSON.parse(readFileSync(new URL('../media/oauth-client-metadata.json', import.meta.url), 'utf8'));
  const included = new Set(metadata.scope.split(' ').filter((scope: string) => scope.startsWith('include:')).map((scope: string) => scope.slice(8)));
  const grants = [...lexicons.values()]
    .filter((lexicon) => included.has(lexicon.id) && lexicon.defs.main.type === 'permission-set')
    .flatMap((lexicon) => lexicon.defs.main.permissions)
    .filter((permission) => permission.resource === 'repo' && permission.collection.includes('cc.coffeencode.profile'));
  assert.ok(grants.some((permission) => permission.action.includes('create') && permission.action.includes('update')));
});

test('tag follows are granted by a permission set the website requests', () => {
  const metadata = JSON.parse(readFileSync(new URL('../media/oauth-client-metadata.json', import.meta.url), 'utf8'));
  const included = new Set(metadata.scope.split(' ').filter((scope: string) => scope.startsWith('include:')).map((scope: string) => scope.slice(8)));
  const grants = [...lexicons.values()]
    .filter((lexicon) => included.has(lexicon.id) && lexicon.defs.main.type === 'permission-set')
    .flatMap((lexicon) => lexicon.defs.main.permissions)
    .filter((permission) => permission.resource === 'repo' && permission.collection.includes('cc.coffeencode.tag.follow'));
  assert.ok(grants.some((permission) => permission.action.includes('create') && permission.action.includes('delete')));
});
