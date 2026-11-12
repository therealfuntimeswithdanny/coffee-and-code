import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const metadataPath = new URL('../media/oauth-client-metadata.json', import.meta.url);
const permissionSetPath = new URL('../lexicons/cc/coffeencode/fullPermissions.json', import.meta.url);
const forumModeratorPermissionSetPath = new URL('../lexicons/cc/coffeencode/forum/authModerator.json', import.meta.url);
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
const permissionSet = JSON.parse(await readFile(permissionSetPath, 'utf8'));
const forumModeratorPermissionSet = JSON.parse(await readFile(forumModeratorPermissionSetPath, 'utf8'));
const expectedClientId = 'https://coffeencode.cc/oauth-client-metadata.json';
const expectedRedirectUri = 'https://coffeencode.cc/auth';
const expectedNativeRedirectUri = 'cc.coffeencode:/auth/callback';

function assert(condition, message) {
  if (!condition) throw new Error(`OAuth metadata check failed: ${message}`);
}

function assertHttpsUrl(value, label) {
  assert(typeof value === 'string', `${label} must be a string URL`);
  assert(!/^\[[^\]]+\]\(https?:\/\/[^)]+\)$/.test(value), `${label} contains Markdown link syntax`);
  const parsed = new URL(value);
  assert(parsed.protocol === 'https:', `${label} must use HTTPS`);
  const canonicalRoot = parsed.pathname === '/' && !parsed.search && !parsed.hash && parsed.origin === value;
  assert(parsed.href === value || canonicalRoot, `${label} must be a plain, canonical URL`);
}

function normalizeScope(scope) {
  const [name, query] = scope.split('?', 2);
  if (!query) return scope;
  const parameters = [...new URLSearchParams(query).entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  return `${name}?${new URLSearchParams(parameters).toString()}`;
}

assert(metadata.client_id === expectedClientId, 'client_id must match the deployed metadata URL');
assert(metadata.tos_uri === 'https://coffeencode.cc/terms', 'tos_uri must match the terms page');
assertHttpsUrl(metadata.client_id, 'client_id');
assertHttpsUrl(metadata.client_uri, 'client_uri');
assert(new URL(metadata.client_uri).hostname === new URL(metadata.client_id).hostname, 'client_uri must use the client_id hostname');
assertHttpsUrl(metadata.logo_uri, 'logo_uri');
assertHttpsUrl(metadata.policy_uri, 'policy_uri');
assert(Array.isArray(metadata.redirect_uris) && metadata.redirect_uris.length === 2, 'redirect_uris must contain the website and mobile callbacks');
assert(metadata.redirect_uris.includes(expectedRedirectUri), 'redirect URIs must include the /auth callback');
assert(metadata.redirect_uris.includes(expectedNativeRedirectUri), 'redirect URIs must include the native app callback');
assertHttpsUrl(expectedRedirectUri, 'website redirect URI');
assert(metadata.grant_types?.includes('authorization_code'), 'authorization_code grant is required');
assert(metadata.grant_types?.includes('refresh_token'), 'refresh_token grant is required');
assert(metadata.response_types?.includes('code'), 'code response type is required');
const requestedScopes = new Set((metadata.scope?.split(' ') ?? []).map(normalizeScope));
const moderatorScope = 'include:cc.coffeencode.forum.authModerator';
assert(!requestedScopes.has(normalizeScope(moderatorScope)), 'member client must not request the forum moderator permission set');
for (const scope of [
  'atproto',
  'include:cc.coffeencode.authPublic',
  'include:cc.coffeencode.authAuthor',
  'include:site.standard.authSocial',
  'include:app.userinput.authBasic',
  'repo:cc.coffeencode.user.block?action=create&action=delete',
  'repo:cc.coffeencode.save?action=create&action=delete',
  'repo:cc.coffeencode.notifications.read?action=create&action=update',
  'repo:app.bsky.graph.follow?action=create&action=delete',
  'repo:app.bsky.graph.block?action=create&action=delete',
  'repo:app.bsky.feed.post?action=create&action=delete',
  'repo:app.bsky.feed.threadgate?action=create&action=delete&action=update',
  'repo:app.bsky.feed.postgate?action=create&action=delete&action=update',
  'repo:at.margin.note?action=create&action=delete',
  'repo:at.margin.collectionItem?action=create&action=delete',
  'repo:at.margin.collection?action=create&action=update&action=delete',
  'repo:network.cosmik.collection?action=create&action=update&action=delete',
  'repo:network.cosmik.collectionLink?action=create&action=delete',
]) {
  assert(requestedScopes.has(normalizeScope(scope)), `required permission scope is missing: ${scope}`);
}
assert(permissionSet.id === 'cc.coffeencode.fullPermissions', 'permission set id must match the requested include scope');
assert(permissionSet.defs?.main?.type === 'permission-set', 'permission set must use the permission-set lexicon type');
assert(permissionSet.defs.main.title && permissionSet.defs.main.detail, 'permission set must include a title and description');
assert(forumModeratorPermissionSet.id === 'cc.coffeencode.forum.authModerator', 'forum moderator permission set id must match its requested include scope');
const expectedForumModeratorRepoActions = new Map([
  ['cc.coffeencode.forum.post', ['create', 'update', 'delete']],
  ['cc.coffeencode.forum.reply', ['create', 'update', 'delete']],
  ['cc.coffeencode.forum.vote', ['create', 'delete']],
  ['cc.coffeencode.forum.moderation', ['create', 'delete']],
]);
function validateForumPermissionSet(permissionSet, id, expectedActions, label) {
  assert(permissionSet.id === id, `${label} permission set id must match its requested include scope`);
  assert(permissionSet.defs?.main?.type === 'permission-set', `${label} permission set must use the permission-set lexicon type`);
  assert(permissionSet.defs.main.title && permissionSet.defs.main.detail, `${label} permission set must include a title and description`);
  const actualActions = new Map();
  let imageBlobPermissionCount = 0;
  for (const permission of permissionSet.defs.main.permissions ?? []) {
    assert(permission.type === 'permission', `${label} permission set entries must be permissions`);
    if (permission.resource === 'blob') {
      assert(JSON.stringify(permission.accept) === JSON.stringify(['image/*']), `${label} permission set blob access must be limited to images`);
      imageBlobPermissionCount += 1;
      continue;
    }
    assert(permission.resource === 'repo', `${label} permission set may only declare repo or image blob permissions`);
    for (const collection of permission.collection ?? []) {
      assert(!actualActions.has(collection), `duplicate ${label} permission declaration: ${collection}`);
      actualActions.set(collection, [...(permission.action ?? [])].sort());
    }
  }
  assert(imageBlobPermissionCount === 1, `${label} permission set must include image upload access`);
  assert(actualActions.size === expectedActions.size, `${label} permission set collections must match required forum repo collections`);
  for (const [collection, actions] of expectedActions) {
    const grantedActions = actualActions.get(collection);
    assert(grantedActions?.join(',') === [...actions].sort().join(','), `${label} permission actions are incorrect for ${collection}`);
  }
}
validateForumPermissionSet(forumModeratorPermissionSet, 'cc.coffeencode.forum.authModerator', expectedForumModeratorRepoActions, 'forum moderator');
const expectedRepoActions = new Map([
  ['cc.coffeencode.interact.like', ['create', 'delete']],
  ['cc.coffeencode.interact.dislike', ['create', 'delete']],
  ['cc.coffeencode.comment.like', ['create', 'delete']],
  ['cc.coffeencode.save', ['create', 'delete']],
  ['cc.coffeencode.interact.view', ['create']],
  ['cc.coffeencode.notifications.read', ['create', 'update']],
  ['cc.coffeencode.handle.claim', ['create']],
  ['cc.coffeencode.comment', ['create', 'update', 'delete']],
  ['cc.coffeencode.author.profile', ['create', 'update']],
  ['cc.coffeencode.user.block', ['create', 'delete']],
  ['app.bsky.graph.follow', ['create', 'delete']],
  ['site.standard.graph.subscription', ['create', 'delete']],
]);
const actualRepoActions = new Map();
for (const permission of permissionSet.defs.main.permissions ?? []) {
  assert(permission.type === 'permission' && permission.resource === 'repo', 'permission set may only declare repo record permissions');
  for (const collection of permission.collection ?? []) {
    assert(!actualRepoActions.has(collection), `duplicate permission declaration: ${collection}`);
    actualRepoActions.set(collection, [...(permission.action ?? [])].sort());
  }
}
assert(actualRepoActions.size === expectedRepoActions.size, 'permission set collections must match the app’s required repo collections');
for (const [collection, actions] of expectedRepoActions) {
  const grantedActions = actualRepoActions.get(collection);
  assert(grantedActions?.join(',') === [...actions].sort().join(','), `permission actions are incorrect for ${collection}`);
}
assert(metadata.token_endpoint_auth_method === 'none', 'browser client must be public');
assert(metadata.application_type === 'native', 'application_type must be native for the shared app and website client');
assert(metadata.dpop_bound_access_tokens === true, 'DPoP must be enabled');

await build({
  entryPoints: [fileURLToPath(new URL('../src/client/atproto-auth.ts', import.meta.url))],
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  outfile: fileURLToPath(new URL('../media/components/atproto-auth.js', import.meta.url)),
});
