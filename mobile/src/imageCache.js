import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

export const MAX_CACHE_BYTES = 500 * 1024 * 1024;
export const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const INDEX_KEY = 'coffee-and-code:image-cache-index';
const DIR = `${FileSystem.cacheDirectory}image-cache/`;

let index = null;
let loading = null;
let saveTimer = null;
const inflight = new Map();

async function loadIndex() {
  if (index) return index;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(INDEX_KEY);
        index = raw ? JSON.parse(raw) : {};
      } catch { index = {}; }
      try { await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }); } catch {}
      return index;
    })();
  }
  return loading;
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index)).catch(() => {});
  }, 500);
}

function keyFor(uri) {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < uri.length; i += 1) {
    const c = uri.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}${uri.length.toString(36)}`;
}

async function removeEntry(key) {
  const entry = index[key];
  delete index[key];
  if (entry?.name) await FileSystem.deleteAsync(`${DIR}${entry.name}`, { idempotent: true }).catch(() => {});
}

async function evictIfNeeded() {
  let total = Object.values(index).reduce((sum, entry) => sum + (entry.size || 0), 0);
  if (total <= MAX_CACHE_BYTES) return;
  const oldestFirst = Object.entries(index).sort((a, b) => (a[1].lastUsed || 0) - (b[1].lastUsed || 0));
  for (const [key, entry] of oldestFirst) {
    if (total <= MAX_CACHE_BYTES) break;
    total -= entry.size || 0;
    await removeEntry(key);
  }
}

async function download(uri, key) {
  const name = `${key}.img`;
  const path = `${DIR}${name}`;
  const result = await FileSystem.downloadAsync(uri, path);
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    return uri;
  }
  const info = await FileSystem.getInfoAsync(path);
  const now = Date.now();
  index[key] = { name, size: info.size || 0, cachedAt: now, lastUsed: now };
  await evictIfNeeded();
  saveSoon();
  return path;
}

export async function getCachedUri(uri) {
  if (typeof uri !== 'string' || !/^https?:\/\//i.test(uri)) return uri;
  try {
    await loadIndex();
    const key = keyFor(uri);
    const entry = index[key];
    if (entry && Date.now() - entry.cachedAt < CACHE_TTL_MS) {
      const path = `${DIR}${entry.name}`;
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) {
        entry.lastUsed = Date.now();
        saveSoon();
        return path;
      }
    }
    if (entry) await removeEntry(key);
    if (!inflight.has(key)) inflight.set(key, download(uri, key).finally(() => inflight.delete(key)));
    return await inflight.get(key);
  } catch {
    return uri;
  }
}

export async function getImageCacheSize() {
  await loadIndex();
  const now = Date.now();
  for (const [key, entry] of Object.entries(index)) {
    if (now - entry.cachedAt >= CACHE_TTL_MS) await removeEntry(key);
  }
  saveSoon();
  return Object.values(index).reduce((sum, entry) => sum + (entry.size || 0), 0);
}

export async function clearImageCache() {
  await loadIndex();
  index = {};
  await FileSystem.deleteAsync(DIR, { idempotent: true }).catch(() => {});
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index)).catch(() => {});
}