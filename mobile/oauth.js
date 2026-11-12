import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Agent } from '@atproto/api';

const SESSION_KEY = 'coffee-and-code:account-did';
const AUTHOR_KEY = 'coffee-and-code:account-author';
const REDIRECT = 'cc.coffeencode:/auth/callback';
const WEB_REDIRECT = 'https://coffeencode.cc/auth';
const AUTHOR_SCOPE = 'include:cc.coffeencode.authAuthor';

const clientMetadata = {
  client_id: 'https://coffeencode.cc/oauth-client-metadata.json',
  client_name: 'Coffee & Code',
  client_uri: 'https://coffeencode.cc',
  logo_uri: 'https://coffeencode.cc/favicon.png',
  tos_uri: 'https://coffeencode.cc/terms',
  policy_uri: 'https://coffeencode.cc/privacy',
  redirect_uris: [WEB_REDIRECT, REDIRECT],
  scope: 'atproto include:cc.coffeencode.authAuthor include:cc.coffeencode.authPublic include:cc.coffeencode.authForum include:site.standard.authSocial include:app.userinput.authBasic repo:cc.coffeencode.user.block?action=create&action=delete repo:cc.coffeencode.save?action=create&action=delete repo:cc.coffeencode.notifications.read?action=create&action=update repo:app.bsky.graph.follow?action=create&action=delete repo:app.bsky.graph.block?action=create&action=delete repo:app.bsky.feed.post?action=create&action=delete repo:app.bsky.feed.threadgate?action=create&action=update&action=delete repo:app.bsky.feed.postgate?action=create&action=update&action=delete repo:at.margin.note?action=create&action=delete repo:at.margin.collectionItem?action=create&action=delete repo:at.margin.collection?action=create&action=update&action=delete repo:network.cosmik.collection?action=create&action=update&action=delete repo:network.cosmik.collectionLink?action=create&action=delete',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  application_type: 'native',
  token_endpoint_auth_method: 'none',
  dpop_bound_access_tokens: true,
};

// Expo Go does not contain the native DPoP/key module used by this client.
// Keep the native package out of module initialization so public reading can
// still run in Expo Go; load it only in a development/standalone build.
const isExpoGo = Constants.appOwnership === 'expo';
let client;

function getClient() {
  if (isExpoGo) {
    throw new Error('AT Protocol sign-in needs the Coffee & Code development app. Expo Go can still browse stories and use the public API.');
  }
  if (!client) {
    const { ExpoOAuthClient } = require('./oauth-client-entry');
    client = new ExpoOAuthClient({ clientMetadata, handleResolver: 'https://bsky.social' });
  }
  return client;
}

function scopeForAccount(author) {
  return author ? clientMetadata.scope : clientMetadata.scope.replace(`${AUTHOR_SCOPE} `, '');
}

export async function signIn(handle, author = false) {
  const session = await getClient().signIn(handle, { redirect_uri: REDIRECT, scope: scopeForAccount(author) });
  await AsyncStorage.setItem(SESSION_KEY, session.did);
  await AsyncStorage.setItem(AUTHOR_KEY, String(author));
  return { session, agent: new Agent(session), author };
}

export async function createAccount() {
  const session = await getClient().signIn('account.coffeencode.cc', {
    redirect_uri: REDIRECT,
    prompt: 'create',
    scope: scopeForAccount(false),
  });
  await AsyncStorage.setItem(SESSION_KEY, session.did);
  await AsyncStorage.setItem(AUTHOR_KEY, 'false');
  return { session, agent: new Agent(session), author: false };
}

export async function restoreSession() {
  if (isExpoGo) return null;
  const did = await AsyncStorage.getItem(SESSION_KEY);
  if (!did) return null;
  try {
    const session = await getClient().restore(did);
    const author = (await AsyncStorage.getItem(AUTHOR_KEY)) === 'true';
    return { session, agent: new Agent(session), author };
  } catch {
    await AsyncStorage.multiRemove([SESSION_KEY, AUTHOR_KEY]);
    return null;
  }
}

export async function signOut(account) {
  if (account?.session?.did) {
    if (!isExpoGo) {
      await getClient().revoke(account.session.did).catch(() => {});
    }
  }
  await AsyncStorage.multiRemove([SESSION_KEY, AUTHOR_KEY]);
}
