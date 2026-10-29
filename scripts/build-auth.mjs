import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const metadataPath = new URL('../media/oauth-client-metadata.json', import.meta.url);
const v8ClientMetadataPath = new URL('../media/oauth-client-metadata-v8.json', import.meta.url);
const v9ClientMetadataPath = new URL('../media/oauth-client-metadata-v9.json', import.meta.url);
const v10ClientMetadataPath = new URL('../media/oauth-client-metadata-v10.json', import.meta.url);
const permissionSetPath = new URL('../lexicons/cc/coffeencode/fullPermissions.json', import.meta.url);
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
const v8ClientMetadata = JSON.parse(await readFile(v8ClientMetadataPath, 'utf8'));
const v9ClientMetadata = JSON.parse(await readFile(v9ClientMetadataPath, 'utf8'));
const v10ClientMetadata = JSON.parse(await readFile(v10ClientMetadataPath, 'utf8'));
const permissionSet = JSON.parse(await readFile(permissionSetPath, 'utf8'));
const expectedClientId = 'https://coffeencode.cc/oauth-client-metadata.json';
const expectedV8ClientId = 'https://coffeencode.cc/oauth-client-metadata-v8.json';
const expectedV9ClientId = 'https://coffeencode.cc/oauth-client-metadata-v9.json';
const expectedV10ClientId = 'https://coffeencode.cc/oauth-client-metadata-v10.json';
const expectedRedirectUri = 'https://coffeencode.cc/auth';

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

assert(metadata.client_id === expectedClientId, 'client_id must match the deployed metadata URL');
assert(v8ClientMetadata.client_id === expectedV8ClientId, 'version 8 client_id must match its metadata URL');
assert(v9ClientMetadata.client_id === expectedV9ClientId, 'version 9 client_id must match its metadata URL');
assert(v10ClientMetadata.client_id === expectedV10ClientId, 'version 10 client_id must match its metadata URL');
assert(v10ClientMetadata.scope === metadata.scope, 'version 10 and canonical metadata must request the same scopes');
assert(v10ClientMetadata.tos_uri === metadata.tos_uri, 'version 10 and canonical metadata must use the same terms page');
assert(v9ClientMetadata.tos_uri === metadata.tos_uri, 'version 9 and canonical metadata must use the same terms page');
assert(v8ClientMetadata.tos_uri === metadata.tos_uri, 'version 8 and canonical metadata must use the same terms page');
assertHttpsUrl(v8ClientMetadata.client_id, 'version 8 client_id');
assertHttpsUrl(v9ClientMetadata.client_id, 'version 9 client_id');
assertHttpsUrl(v10ClientMetadata.client_id, 'version 10 client_id');
assert(v8ClientMetadata.redirect_uris?.[0] === expectedRedirectUri, 'version 8 redirect URI must match the /auth callback');
assert(v9ClientMetadata.redirect_uris?.[0] === expectedRedirectUri, 'version 9 redirect URI must match the /auth callback');
assert(v10ClientMetadata.redirect_uris?.[0] === expectedRedirectUri, 'version 10 redirect URI must match the /auth callback');
assert(metadata.tos_uri === 'https://coffeencode.cc/terms', 'tos_uri must match the terms page');
assertHttpsUrl(metadata.client_id, 'client_id');
assertHttpsUrl(metadata.client_uri, 'client_uri');
assert(new URL(metadata.client_uri).hostname === new URL(metadata.client_id).hostname, 'client_uri must use the client_id hostname');
assertHttpsUrl(metadata.logo_uri, 'logo_uri');
assertHttpsUrl(metadata.policy_uri, 'policy_uri');
assert(Array.isArray(metadata.redirect_uris) && metadata.redirect_uris.length === 1, 'redirect_uris must contain the canonical callback');
assert(metadata.redirect_uris[0] === expectedRedirectUri, 'redirect URI must match the /auth callback');
assertHttpsUrl(metadata.redirect_uris[0], 'redirect_uris[0]');
assert(metadata.grant_types?.includes('authorization_code'), 'authorization_code grant is required');
assert(metadata.grant_types?.includes('refresh_token'), 'refresh_token grant is required');
assert(metadata.response_types?.includes('code'), 'code response type is required');
const requestedScopes = new Set(v10ClientMetadata.scope?.split(' ') ?? []);
for (const scope of [
  'atproto',
  'include:cc.coffeencode.fullPermissions',
  'repo:cc.coffeencode.author.profile?action=create&action=update',
  'repo:app.bsky.graph.follow?action=create&action=delete',
  'repo:site.standard.graph.recommend?action=create',
  'blob:*/*',
]) {
  assert(requestedScopes.has(scope), `required permission scope is missing: ${scope}`);
}
assert(permissionSet.id === 'cc.coffeencode.fullPermissions', 'permission set id must match the requested include scope');
assert(permissionSet.defs?.main?.type === 'permission-set', 'permission set must use the permission-set lexicon type');
assert(permissionSet.defs.main.title && permissionSet.defs.main.detail, 'permission set must include a title and description');
const expectedRepoActions = new Map([
  ['cc.coffeencode.interact.like', ['create', 'delete']],
  ['cc.coffeencode.interact.dislike', ['create', 'delete']],
  ['cc.coffeencode.comment.like', ['create', 'delete']],
  ['cc.coffeencode.save', ['create', 'delete']],
  ['cc.coffeencode.interact.view', ['create']],
  ['cc.coffeencode.handle.claim', ['create']],
  ['cc.coffeencode.comment', ['create', 'update', 'delete']],
  ['cc.coffeencode.author.profile', ['create', 'update']],
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
assert(metadata.application_type === 'web', 'application_type must be web');
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
