// Reader display preferences (cc.coffeencode.preferences, rkey "self").
// The same record drives the website's appearance settings, so changes made
// here show up on the web and vice versa.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const PREFERENCES_COLLECTION = 'cc.coffeencode.preferences';
export const PREFERENCES_RKEY = 'self';
const CACHE_KEY = 'coffee-and-code:preferences';

export const DEFAULT_FONT_SIZE = 19;
export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 26;

// The app ships no webfonts, so the site's named fonts resolve to the nearest
// native family. The stored value is never rewritten, so the web keeps the
// exact font the reader chose there.
const FONT_FAMILIES = {
  system: undefined,
  sans: undefined,
  inter: undefined,
  atkinson: undefined,
  serif: 'Georgia',
  merriweather: 'Georgia',
  fraunces: 'Georgia',
  monospace: Platform.select({ ios: 'Menlo', default: 'monospace' }),
};

export const STORY_FONT_CHOICES = [
  { id: 'system', label: 'System' },
  { id: 'serif', label: 'Serif' },
  { id: 'monospace', label: 'Mono' },
];

export function normalizePreferences(prefs) {
  const next = prefs && typeof prefs === 'object' ? prefs : {};
  const size = Number(next.postFontSize);
  return {
    theme: ['system', 'dark', 'light'].includes(next.theme) ? next.theme : 'system',
    uiFont: typeof next.uiFont === 'string' ? next.uiFont : 'sans',
    postFont: typeof next.postFont === 'string' && next.postFont in FONT_FAMILIES ? next.postFont : 'system',
    postFontSize: Number.isFinite(size) ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size))) : undefined,
  };
}

export function fontFamilyFor(postFont) {
  return FONT_FAMILIES[postFont] ?? undefined;
}

// Style merged over the article body paragraph/quote styles.
export function readerTextStyle(prefs) {
  const style = {};
  const family = fontFamilyFor(prefs?.postFont);
  if (family) style.fontFamily = family;
  if (prefs?.postFontSize) {
    style.fontSize = prefs.postFontSize;
    style.lineHeight = Math.round(prefs.postFontSize * 1.63);
  }
  return style;
}

export async function loadCachedPreferences() {
  try {
    return normalizePreferences(JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) || '{}'));
  } catch {
    return normalizePreferences({});
  }
}

export async function cachePreferences(prefs) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch { /* Preferences fall back to defaults next launch. */ }
}

export async function loadPreferencesRecord(account) {
  if (!account?.agent) return null;
  try {
    const { data } = await account.agent.com.atproto.repo.getRecord({
      repo: account.session.did,
      collection: PREFERENCES_COLLECTION,
      rkey: PREFERENCES_RKEY,
    });
    if (data.value?.$type && data.value.$type !== PREFERENCES_COLLECTION) {
      throw new Error('Your preferences record has an unexpected record type.');
    }
    return normalizePreferences(data.value || {});
  } catch (error) {
    const status = error.status || error.statusCode;
    if (status === 404 || error.error === 'RecordNotFound') return normalizePreferences({});
    throw error;
  }
}

export async function savePreferencesRecord(account, prefs) {
  const record = {
    $type: PREFERENCES_COLLECTION,
    theme: prefs.theme,
    uiFont: prefs.uiFont,
    postFont: prefs.postFont,
    ...(prefs.postFontSize !== undefined ? { postFontSize: prefs.postFontSize } : {}),
    updatedAt: new Date().toISOString(),
  };
  await account.agent.com.atproto.repo.putRecord({
    repo: account.session.did,
    collection: PREFERENCES_COLLECTION,
    rkey: PREFERENCES_RKEY,
    record,
  });
}
