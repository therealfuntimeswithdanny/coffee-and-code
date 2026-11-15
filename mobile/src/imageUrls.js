export function imageUrlForPreset(uri, preset) {
  if (typeof uri !== 'string' || typeof preset !== 'string') return uri;
  try {
    const url = new URL(uri);
    const isAtprotoImage = /^\/img\/[^/]+\/plain\/[^/]+\/[^/]+$/.test(url.pathname);
    if (url.hostname !== 'cdn.coffeencode.cc' && !isAtprotoImage) return uri;

    if (/^\/blob\//.test(url.pathname)) {
      const parts = url.pathname.split('/');
      if (parts.length < 4) return uri;
      if (parts.length > 4) parts[4] = encodeURIComponent(preset);
      else parts.push(encodeURIComponent(preset));
      url.pathname = parts.join('/');
      return url.toString();
    }

    if (/^\/img\/[^/]+\/plain\//.test(url.pathname)) {
      url.hostname = 'cdn.coffeencode.cc';
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
