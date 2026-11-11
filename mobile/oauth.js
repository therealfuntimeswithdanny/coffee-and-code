import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Agent } from '@atproto/api';

const SESSION_KEY = 'coffee-and-code:account-did';
const REDIRECT = 'cc.coffeencode:/auth/callback';

const memberMetadata = {
  client_id: 'https://coffeencode.cc/oauth-client-metadata-mobile.json',
  client_name: 'Coffee & Code for iOS',
  client_uri: 'https://coffeencode.cc',
  logo_uri: 'https://coffeencode.cc/favicon.png',
  redirect_uris: [REDIRECT],
  scope: 'atproto include:cc.coffeencode.authPublic include:cc.coffeencode.authForum include:site.standard.authSocial include:app.userinput.authBasic repo:cc.coffeencode.user.block?action=create&action=delete repo:app.bsky.graph.follow?action=create&action=delete repo:app.bsky.graph.block?action=create&action=delete repo:app.bsky.feed.post?action=create&action=delete repo:app.bsky.feed.threadgate?action=create&action=update&action=delete repo:app.bsky.feed.postgate?action=create&action=update&action=delete repo:at.margin.note?action=create&action=delete repo:at.margin.collectionItem?action=create&action=delete repo:at.margin.collection?action=create&action=update&action=delete repo:network.cosmik.collection?action=create&action=update&action=delete repo:network.cosmik.collectionLink?action=create&action=delete',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  application_type: 'native',
  token_endpoint_auth_method: 'none',
  dpop_bound_access_tokens: true,
};

const authorMetadata = {
  ...memberMetadata,
  client_id: 'https://coffeencode.cc/oauth-client-metadata-author-mobile.json',
  client_name: 'Coffee & Code for iOS — Author',
  scope: memberMetadata.scope.replace('include:cc.coffeencode.authPublic', 'include:cc.coffeencode.authAuthor include:cc.coffeencode.authPublic'),
};

// Expo Go does not contain the native DPoP/key module used by this client.
// Keep the native package out of module initialization so public reading can
// still run in Expo Go; load it only in a development/standalone build.
const isExpoGo = Constants.appOwnership === 'expo';
let clients;

function getClients() {
  if (isExpoGo) {
    throw new Error('AT Protocol sign-in needs the Coffee & Code development app. Expo Go can still browse stories and use the public API.');
  }
  if (!clients) {
    const { ExpoOAuthClient } = require('./oauth-client-entry');
    clients = {
      member: new ExpoOAuthClient({ clientMetadata: memberMetadata, handleResolver: 'https://bsky.social' }),
      author: new ExpoOAuthClient({ clientMetadata: authorMetadata, handleResolver: 'https://bsky.social' }),
    };
  }
  return clients;
}

export async function signIn(handle, author = false) {
  const session = await getClients()[author ? 'author' : 'member'].signIn(handle, { redirect_uri: REDIRECT });
  await AsyncStorage.setItem(SESSION_KEY, session.did);
  return { session, agent: new Agent(session), author };
}

export async function restoreSession() {
  if (isExpoGo) return null;
  const did = await AsyncStorage.getItem(SESSION_KEY);
  if (!did) return null;
  for (const author of [false, true]) {
    try {
      const client = getClients()[author ? 'author' : 'member'];
      const session = await client.restore(did);
      return { session, agent: new Agent(session), author };
    } catch { /* Try the other permission set. */ }
  }
  await AsyncStorage.removeItem(SESSION_KEY);
  return null;
}

export async function signOut(account) {
  if (account?.session?.did) {
    if (!isExpoGo) {
      const client = getClients()[account.author ? 'author' : 'member'];
      await client.revoke(account.session.did).catch(() => {});
    }
  }
  await AsyncStorage.removeItem(SESSION_KEY);
}
