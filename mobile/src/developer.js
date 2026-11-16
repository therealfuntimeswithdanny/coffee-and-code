import * as Mmkv from 'react-native-mmkv';
import { getCachedUri } from './imageCache';

// Dedicated on-device store for developer tooling. Nothing here ever leaves the device.
const store = typeof Mmkv.createMMKV === 'function'
  ? Mmkv.createMMKV({ id: 'coffee-and-code-developer' })
  : new Mmkv.MMKV({ id: 'coffee-and-code-developer' });

export const LOG_MAX_BYTES = 300 * 1024 * 1024;
const LOG_TRIM_BYTES = Math.floor(LOG_MAX_BYTES * 0.9);
export const POST_CACHE_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_REGISTRY_MAX = 3000;
const IMAGE_PREFETCH_MAX = 200;

const LOG_KEY = 'app-log';
const API_BASE_KEY = 'api-base';
const POST_PREFIX = 'post:';
const POST_INDEX_KEY = 'post-index';
const IMAGE_URLS_KEY = 'image-urls';

function removeKey(key) {
  if (typeof store.remove === 'function') store.remove(key);
  else if (typeof store.delete === 'function') store.delete(key);
}

// Approximate UTF-8 byte length without requiring TextEncoder.
export function byteSize(text) {
  let bytes = 0;
  for (const character of String(text)) {
    const code = character.codePointAt(0);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readJson(key, fallback) {
  try {
    const raw = store.getString(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// App log — newline-delimited JSON entries, hard-capped at LOG_MAX_BYTES.
// ---------------------------------------------------------------------------

function appendLog(level, message, detail) {
  try {
    const entry = { ts: new Date().toISOString(), level, message: String(message) };
    if (detail !== undefined) entry.detail = typeof detail === 'string' ? detail : JSON.stringify(detail);
    const line = JSON.stringify(entry);
    let text = store.getString(LOG_KEY) || '';
    text = text ? `${text}\n${line}` : line;
    if (byteSize(text) > LOG_MAX_BYTES) {
      const lines = text.split('\n');
      let trimmed = lines.join('\n');
      let remove = 0;
      while (remove < lines.length && byteSize(trimmed) > LOG_TRIM_BYTES) {
        remove += 1;
        trimmed = lines.slice(remove).join('\n');
      }
      text = trimmed;
    }
    store.set(LOG_KEY, text);
  } catch {
    // Logging must never break the app.
  }
}

export const log = {
  info: (message, detail) => appendLog('info', message, detail),
  warn: (message, detail) => appendLog('warn', message, detail),
  error: (message, detail) => appendLog('error', message, detail),
};

export function getLogEntries(limit = 200) {
  const text = store.getString(LOG_KEY) || '';
  if (!text) return [];
  const entries = [];
  for (const line of text.split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === 'object') entries.push(entry);
    } catch { /* skip malformed lines */ }
  }
  entries.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return entries.slice(0, limit);
}

export function getLogText() {
  return store.getString(LOG_KEY) || '';
}

export function getLogStats() {
  const text = store.getString(LOG_KEY) || '';
  return { bytes: byteSize(text), count: text ? text.split('\n').length : 0, maxBytes: LOG_MAX_BYTES };
}

export function clearLogs() {
  removeKey(LOG_KEY);
}

// ---------------------------------------------------------------------------
// Post cache — full post JSON per URI, LRU-evicted at POST_CACHE_MAX_BYTES.
// ---------------------------------------------------------------------------

function readPostIndex() {
  const index = readJson(POST_INDEX_KEY, {});
  return index && typeof index === 'object' ? index : {};
}

export function cachePost(uri, post) {
  if (typeof uri !== 'string' || !uri) return;
  try {
    const serialized = JSON.stringify(post);
    const bytes = byteSize(serialized);
    store.set(`${POST_PREFIX}${uri}`, serialized);
    const index = readPostIndex();
    index[uri] = { bytes, accessed: Date.now() };
    let total = Object.values(index).reduce((sum, entry) => sum + (entry.bytes || 0), 0);
    if (total > POST_CACHE_MAX_BYTES) {
      const oldestFirst = Object.entries(index).sort((a, b) => (a[1].accessed || 0) - (b[1].accessed || 0));
      for (const [key, entry] of oldestFirst) {
        if (total <= POST_CACHE_MAX_BYTES) break;
        total -= entry.bytes || 0;
        delete index[key];
        removeKey(`${POST_PREFIX}${key}`);
      }
    }
    store.set(POST_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Caching must never break the app.
  }
}

export function getCachedPost(uri) {
  if (typeof uri !== 'string' || !uri) return null;
  try {
    const raw = store.getString(`${POST_PREFIX}${uri}`);
    if (!raw) return null;
    const index = readPostIndex();
    if (index[uri]) {
      index[uri].accessed = Date.now();
      store.set(POST_INDEX_KEY, JSON.stringify(index));
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function postCacheStats() {
  const index = readPostIndex();
  const entries = Object.values(index);
  return {
    bytes: entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
    count: entries.length,
    maxBytes: POST_CACHE_MAX_BYTES,
  };
}

export function clearPostCache() {
  const index = readPostIndex();
  for (const uri of Object.keys(index)) removeKey(`${POST_PREFIX}${uri}`);
  removeKey(POST_INDEX_KEY);
}

// ---------------------------------------------------------------------------
// Image cache registry — displayed image URLs (bytes themselves are managed
// by React Native / the OS image cache).
// ---------------------------------------------------------------------------

function readImageUrls() {
  const urls = readJson(IMAGE_URLS_KEY, []);
  return Array.isArray(urls) ? urls.filter((url) => typeof url === 'string') : [];
}

export function registerImageUrl(uri) {
  if (typeof uri !== 'string' || !/^https?:\/\//i.test(uri)) return;
  try {
    const urls = readImageUrls().filter((url) => url !== uri);
    urls.push(uri);
    if (urls.length > IMAGE_REGISTRY_MAX) urls.splice(0, urls.length - IMAGE_REGISTRY_MAX);
    store.set(IMAGE_URLS_KEY, JSON.stringify(urls));
  } catch {
    // Registration must never break rendering.
  }
}

export function imageCacheStats() {
  const urls = readImageUrls();
  return { tracked: urls.length, maxTracked: IMAGE_REGISTRY_MAX };
}

export async function refreshImageCache() {
  const urls = readImageUrls().slice(-IMAGE_PREFETCH_MAX);
  const results = await Promise.allSettled(urls.map((url) => getCachedUri(url)));
  return results.filter((result) => result.status === 'fulfilled').length;
}

export function clearImageCacheRegistry() {
  removeKey(IMAGE_URLS_KEY);
}

// ---------------------------------------------------------------------------
// API base URL — developers can point the app at a self-hosted endpoint that
// speaks the same routes and query parameters as the official API.
// ---------------------------------------------------------------------------

export const DEFAULT_API_BASE = 'https://coffeencode.cc/api';

export function getApiBase() {
  try {
    const raw = store.getString(API_BASE_KEY);
    if (raw && /^https?:\/\/\S+$/i.test(raw)) return raw.replace(/\/+$/, '');
  } catch {}
  return DEFAULT_API_BASE;
}

export function setApiBase(url) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === DEFAULT_API_BASE) { removeKey(API_BASE_KEY); return; }
  if (!/^https?:\/\/\S+$/i.test(trimmed)) throw new Error('Enter a full URL starting with http:// or https://');
  store.set(API_BASE_KEY, trimmed);
}
