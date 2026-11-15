const CDN_HOSTS = new Set(['cdn.coffeencode.cc', 'cdn.bsky.app']);

export function imageUrlForPreset(uri, preset) {
  if (typeof uri !== 'string' || typeof preset !== 'string') return uri;
  try {
    const url = new URL(uri);
    if (!CDN_HOSTS.has(url.hostname)) return uri;
    if (url.hostname === 'cdn.bsky.app') url.hostname = 'cdn.coffeencode.cc';

    if (/^\/blob\//.test(url.pathname)) {
      const parts = url.pathname.split('/');
      if (parts.length < 4) return uri;
      if (parts.length > 4) parts[4] = encodeURIComponent(preset);
      else parts.push(encodeURIComponent(preset));
      url.pathname = parts.join('/');
      return url.toString();
    }

    if (/^\/img\/[^/]+\/plain\//.test(url.pathname)) {
      url.pathname = url.pathname.replace(/^\/img\/[^/]+(?=\/plain\/)/, `/img/${encodeURIComponent(preset)}`);
      return url.toString();
    }
  } catch {
    return uri;
  }
  return uri;
}

export function cdnBlobImageUrl(did, cid, preset) {
  return `https://cdn.coffeencode.cc/blob/${encodeURIComponent(did)}/${encodeURIComponent(cid)}/${encodeURIComponent(preset)}`;
}
