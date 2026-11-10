// The package's current root export points to a platform-neutral filename
// that is absent from its published build. Import its native entry directly
// so Metro selects the Expo implementation and its required polyfills.
import './node_modules/@atproto/oauth-client-expo/dist/polyfill.native.js';
export { ExpoOAuthClient } from './node_modules/@atproto/oauth-client-expo/dist/expo-oauth-client.native.js';
