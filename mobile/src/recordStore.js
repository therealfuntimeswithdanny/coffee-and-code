export async function listRepoRecords(agent, did, collection) {
  const records = [];
  const seenCursors = new Set();
  let cursor;
  do {
    const { data } = await agent.com.atproto.repo.listRecords({ repo: did, collection, limit: 100, ...(cursor ? { cursor } : {}) });
    records.push(...(data.records || []));
    if (!data.cursor || seenCursors.has(data.cursor)) break;
    seenCursors.add(data.cursor);
    cursor = data.cursor;
  } while (cursor);
  return records;
}

export function storyRecordKey(uri) {
  return uri?.match(/^at:\/\/[^/]+\/[^/]+\/([^/]+)$/)?.[1];
}

export async function resolvePdsEndpoint(did) {
  let documentUrl;
  if (did.startsWith('did:plc:')) {
    documentUrl = `https://plc.directory/${encodeURIComponent(did)}`;
  } else if (did.startsWith('did:web:')) {
    const [, , host, ...path] = did.split(':');
    if (!host) return '';
    const decodedPath = path.map((part) => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
    documentUrl = decodedPath.length
      ? `https://${host}/${decodedPath.map(encodeURIComponent).join('/')}/did.json`
      : `https://${host}/.well-known/did.json`;
  } else return '';
  try {
    const response = await fetch(documentUrl);
    if (!response.ok) return '';
    const document = await response.json();
    return document.service?.find((service) => service.type === 'AtprotoPersonalDataServer')?.serviceEndpoint || '';
  } catch {
    return '';
  }
}

export function storiesFromRecords(records, postByUri, cachedStories = []) {
  const cachedByUri = new Map(cachedStories.map((story) => [story.uri, story]));
  const unique = new Map();
  records
    .filter((record) => typeof record.value?.target?.document === 'string' && record.value.target.document.startsWith('at://'))
    .sort((a, b) => (Date.parse(b.value?.createdAt || '') || 0) - (Date.parse(a.value?.createdAt || '') || 0))
    .forEach((record) => {
      const uri = record.value.target.document;
      if (unique.has(uri)) return;
      const cached = cachedByUri.get(uri) || {};
      const published = postByUri.get(uri) || {};
      unique.set(uri, {
        ...published,
        ...cached,
        uri,
        title: cached.title || published.title || 'Saved story',
        publishedAt: cached.publishedAt || published.publishedAt || record.value.createdAt,
        savedAt: record.value.createdAt,
        cover: cached.cover || published.cover,
        path: cached.path || published.path,
      });
    });
  return [...unique.values()];
}

