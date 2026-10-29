import { AuthorProfile, StandardDocument } from '../types';

const imageCdnUrl = 'https://cdn.coffeencode.cc';

function atprotoBlobParts(imageUrl: string, baseUrl?: string): { did: string; cid: string; extension?: string } | undefined {
  try {
    const url = new URL(imageUrl, baseUrl);
    const did = url.searchParams.get('did');
    const cid = url.searchParams.get('cid');
    if (did && cid && url.pathname.endsWith('/xrpc/com.atproto.sync.getBlob')) return { did, cid };

    const match = url.pathname.match(/\/img\/(?:avatar|banner)\/plain\/([^/]+)\/([^/]+)$/i);
    if (!match) return undefined;
    const [blobCid, extension] = decodeURIComponent(match[2]).split('@', 2);
    if (!blobCid) return undefined;
    return {
      did: decodeURIComponent(match[1]),
      cid: blobCid,
      extension,
    };
  } catch {
    return undefined;
  }
}

function cdnBlobUrl(parts: { did: string; cid: string; extension?: string }, preset: string): string {
  const blob = `${parts.cid}${parts.extension ? `@${parts.extension}` : ''}`;
  return `${imageCdnUrl}/blob/${encodeURIComponent(parts.did)}/${blob}/${encodeURIComponent(preset)}`;
}

function proxyBlueskyCdnUrl(imageUrl: string): string | undefined {
  try {
    const url = new URL(imageUrl);
    if (url.hostname !== 'cdn.bsky.app') return undefined;
    url.hostname = new URL(imageCdnUrl).hostname;
    return url.toString();
  } catch {
    return undefined;
  }
}

// Retry helper with exponential backoff
async function fetchWithRetry(url: string, options: any = {}, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      // Only retry on 5xx errors or timeout-like issues
      if (response.ok || response.status < 500) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    // Don't wait on the last attempt
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 100; // 100ms, 200ms, etc
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Failed after retries');
}

export function proxyImageUrl(imageUrl: string, baseUrl?: string, preset = 'feed_fullsize'): string {
  if (imageUrl.startsWith(`${imageCdnUrl}/blob/`)) return imageUrl;
  const bskyCdnUrl = proxyBlueskyCdnUrl(imageUrl);
  if (bskyCdnUrl) return bskyCdnUrl;
  const blob = atprotoBlobParts(imageUrl, baseUrl);
  if (blob) return cdnBlobUrl(blob, preset);

  if (imageUrl.startsWith('/') && baseUrl) {
    return new URL(imageUrl, baseUrl).toString();
  }
  return imageUrl;
}

export function proxyAvatarUrl(avatarUrl: string): string {
  const bskyCdnUrl = proxyBlueskyCdnUrl(avatarUrl);
  if (bskyCdnUrl) return bskyCdnUrl;
  const blob = atprotoBlobParts(avatarUrl);
  return blob ? cdnBlobUrl(blob, 'avatar_medium') : avatarUrl;
}

function extractDocumentContent(value: any): { content: string; format?: string; mimeType?: string } {
  // Try to get format metadata
  const format = value.contentFormat || value.format;
  const mimeType = value.mimeType || value.contentType;

  // Try Leaflet content format
  if (value.content?.$type === 'pub.leaflet.content') {
    return {
      content: JSON.stringify(value.content),
      format: 'leaflet',
      mimeType: mimeType || 'application/json'
    };
  }

  // Try direct string content
  if (typeof value.content === 'string') {
    return { content: value.content, format, mimeType };
  }

  // Try text content variations
  if (typeof value.textContent === 'string') {
    return { content: value.textContent, format, mimeType };
  }
  if (typeof value.content?.textContent === 'string') {
    return { content: value.content.textContent, format, mimeType };
  }

  // Try structured content with items (rich text)
  if (Array.isArray(value.content?.items)) {
    const content = value.content.items
      .map((item: any) => (typeof item?.plaintext === 'string' ? item.plaintext : ''))
      .filter(Boolean)
      .join('\n\n');
    return { content, format: format || 'richtext', mimeType };
  }

  // Try blocks format
  if (Array.isArray(value.blocks)) {
    return {
      content: JSON.stringify(value.blocks),
      format: format || 'richtext',
      mimeType: mimeType || 'application/json'
    };
  }

  return { content: '', format, mimeType };
}

function firstContentImage(content: string): string | undefined {
  const markdownImage = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)/i);
  const htmlImage = content.match(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)/i);
  return markdownImage?.[1] || htmlImage?.[1];
}

function documentCoverUrl(value: any, content: string, did: string, pdsUrl: string): string | undefined {
  const cid = value.coverImage?.ref?.$link || value.cover?.ref?.$link;
  if (cid) {
    return `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
  }

  return firstContentImage(content);
}

function validDomainHandle(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 253 || value !== value.toLowerCase()) return false;
  return value.split('.').every((label) => label.length > 0 && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

async function fetchConfiguredHandles(pdsUrl: string, ownerDid: string): Promise<Map<string, string>> {
  const record = await fetchRecord(pdsUrl, ownerDid, 'cc.coffeencode.config.handles', 'self');
  const configured = record?.value?.handles;
  const handles = new Map<string, string>();
  if (!isRecord(configured)) return handles;

  for (const [did, handle] of Object.entries(configured)) {
    if (/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did) && validDomainHandle(handle)) {
      handles.set(did.toLowerCase(), handle);
    }
  }
  return handles;
}

function canonicalDocumentPath(did: string, authorHandle: string | undefined, rkey: string, handles: Map<string, string>): string {
  const handle = handles.get(did.toLowerCase()) || authorHandle || 'unknown';
  return `/post/${encodeURIComponent(handle)}/${encodeURIComponent(rkey)}`;
}

function documentTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function getPdsEndpoint(did: string, fallbackPds: string): Promise<string> {
  try {
    const res = await fetchWithRetry(`https://plc.directory/${did}`, {
      headers: { 'User-Agent': 'CoffeeAndCode-Worker' },
    });
    if (!res.ok) return fallbackPds;
    const data: any = await res.json();
    const pdsService = data.service?.find(
      (s: any) => s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
    );
    return pdsService?.serviceEndpoint || fallbackPds;
  } catch (e) {
    console.error('Error fetching PDS endpoint:', e);
    return fallbackPds;
  }
}

export async function isPdsAvailable(pdsUrl: string): Promise<boolean> {
  try {
    const response = await fetchWithRetry(`${pdsUrl}/xrpc/com.atproto.server.describeServer`);
    return response.ok;
  } catch (error) {
    console.error('Error checking PDS availability:', error);
    return false;
  }
}

function profileBlobUrl(blob: any, did: string, pdsUrl: string): string | undefined {
  const cid = blob?.ref?.$link;
  if (typeof cid !== 'string') return undefined;

  return `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function fetchAuthorProfile(did: string, fallbackPds: string): Promise<AuthorProfile | undefined> {
  try {
    const pdsUrl = await getPdsEndpoint(did, fallbackPds);
    const [record, response] = await Promise.all([
      fetchRecord(pdsUrl, did, 'cc.coffeencode.author.profile', 'self'),
      fetchWithRetry(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
      ).catch((error) => {
        console.error('Error fetching author profile from Bluesky:', error);
        return undefined;
      }),
    ]);

    const profileData: unknown = response?.ok ? await response.json() : undefined;
    const profile = isRecord(profileData) ? profileData : {};
    let handle = typeof profile.handle === 'string' ? profile.handle : undefined;
    if (!handle) {
      try {
        const describeUrl = new URL(`${pdsUrl}/xrpc/com.atproto.repo.describeRepo`);
        describeUrl.searchParams.set('repo', did);
        const describeResponse = await fetchWithRetry(describeUrl.toString());
        if (describeResponse.ok) {
          const description: unknown = await describeResponse.json();
          if (isRecord(description) && typeof description.handle === 'string') handle = description.handle;
        }
      } catch (error) {
        console.error(`Error resolving account handle for ${did}:`, error);
      }
    }
    const custom = isRecord(record?.value) && record.value.$type === 'cc.coffeencode.author.profile'
      ? record.value
      : undefined;
    if (!handle) return undefined;

    return {
      did,
      handle,
      displayName: typeof custom?.displayName === 'string'
        ? custom.displayName
        : typeof profile.displayName === 'string'
          ? profile.displayName
          : undefined,
      avatar: profileBlobUrl(custom?.avatar, did, pdsUrl) ||
        (typeof profile.avatar === 'string' ? profile.avatar : undefined),
      banner: profileBlobUrl(custom?.banner, did, pdsUrl) ||
        (typeof profile.banner === 'string' ? profile.banner : undefined),
      description: typeof custom?.description === 'string'
        ? custom.description
        : typeof profile.description === 'string'
          ? profile.description
          : undefined,
      pronouns: typeof custom?.pronouns === 'string' ? custom.pronouns : undefined,
      pinnedPosts: Array.isArray(custom?.pinnedPosts)
        ? custom.pinnedPosts.filter((uri: unknown): uri is string => typeof uri === 'string' && uri.startsWith('at://'))
        : undefined,
    };
  } catch (error) {
    console.error('Error fetching author profile:', error);
    return undefined;
  }
}

export async function resolveAtprotoIdentifier(identifier: string): Promise<string | undefined> {
  if (/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(identifier)) return identifier;
  if (!/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(identifier)) return undefined;

  const url = new URL('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle');
  url.searchParams.set('handle', identifier);
  const response = await fetchWithRetry(url.toString());
  if (response.status === 400 || response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Handle resolution returned ${response.status}`);
  const result = await response.json() as { did?: unknown };
  return typeof result.did === 'string' && /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(result.did)
    ? result.did
    : undefined;
}

async function fetchRecord(pdsUrl: string, repo: string, collection: string, rkey: string): Promise<any | undefined> {
  try {
    const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.getRecord`);
    url.searchParams.set('repo', repo);
    url.searchParams.set('collection', collection);
    url.searchParams.set('rkey', rkey);
    const response = await fetchWithRetry(url.toString());
    if (!response.ok) return undefined;
    return await response.json();
  } catch (error) {
    console.error(`Error fetching ${collection}/${rkey}:`, error);
    return undefined;
  }
}

async function fetchConfiguredLists(pdsUrl: string, ownerDid: string): Promise<{ publicationUris: string[]; pinnedUris: string[] }> {
  const publicationsRecord = await fetchRecord(pdsUrl, ownerDid, 'cc.coffeencode.publications', 'self');

  return {
    publicationUris: Array.isArray(publicationsRecord?.value?.publications)
      ? publicationsRecord.value.publications.filter((uri: unknown): uri is string => typeof uri === 'string' && uri.startsWith('at://'))
      : [],
    pinnedUris: Array.isArray(publicationsRecord?.value?.pinned)
      ? publicationsRecord.value.pinned.filter((uri: unknown): uri is string => typeof uri === 'string' && /^at:\/\/[^/]+\/site\.standard\.document\/[^/]+$/.test(uri))
      : [],
  };
}

export async function fetchArticles(
  fallbackPds: string,
  fallbackDid: string,
): Promise<StandardDocument[]> {
  const articles: StandardDocument[] = [];
  const did = fallbackDid;
  const pdsUrl = fallbackPds;
  try {
    const [configuredLists, configuredHandles] = await Promise.all([
      fetchConfiguredLists(pdsUrl, fallbackDid),
      fetchConfiguredHandles(pdsUrl, fallbackDid),
    ]);
    const publicationUris = configuredLists.publicationUris;
    const pinnedOrderByUri = new Map(configuredLists.pinnedUris.map((uri, index) => [uri, index]));
    const articleAuthors = new Map<string, string>();

    // Fetch documents from each configured publication's repository.
    if (publicationUris.length) {
      try {
        for (const publicationUri of publicationUris) {
          const match = publicationUri.match(/^at:\/\/([^/]+)\/site\.standard\.publication\/([^/]+)$/);
          if (!match) continue;

          const [, did] = match;
          const pdsUrl = await getPdsEndpoint(did, fallbackPds);
          const stdUrl = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=site.standard.document&limit=100`;
          const stdRes = await fetchWithRetry(stdUrl);
          if (!stdRes.ok) continue;

          const data: any = await stdRes.json();
          for (const rec of data.records || []) {
            if (!rec?.value || rec.value.site !== publicationUri) continue;
            const rkey = rec.uri ? rec.uri.split('/').pop() : Math.random().toString();
            const { content, format, mimeType } = extractDocumentContent(rec.value);
            const articleAuthorDid = typeof rec.value.author === 'string'
              ? rec.value.author
              : typeof rec.value.author?.did === 'string'
                ? rec.value.author.did
                : did;
            articleAuthors.set(rec.uri || '', articleAuthorDid);
            articles.push({
              uri: rec.uri || '',
              cid: rec.cid || '',
              rkey: rkey || '',
              title: rec.value.title || 'Untitled Post',
              content: content,
              publishedAt: rec.value.publishedAt || rec.value.createdAt || new Date().toISOString(),
              tags: documentTags(rec.value.tags),
              pinnedOrder: pinnedOrderByUri.get(rec.uri || ''),
              path: canonicalDocumentPath(articleAuthorDid, undefined, rkey || '', configuredHandles),
              description: rec.value.description || rec.value.summary || '',
              cover: documentCoverUrl(rec.value, content, did, pdsUrl),
              format,
              mimeType,
              repoDid: did,
              pdsUrl,
              publicationUri,
            });
          }
        }
      } catch (e) {
        console.error('Error fetching publication documents:', e);
      }

      articles.sort((a, b) => {
        const timeA = new Date(a.publishedAt).getTime() || 0;
        const timeB = new Date(b.publishedAt).getTime() || 0;
        return timeB - timeA;
      });
      const pinnedAuthorDids = [...new Set(articles
        .filter((article) => article.pinnedOrder !== undefined)
        .sort((a, b) => a.pinnedOrder! - b.pinnedOrder!)
        .map((article) => articleAuthors.get(article.uri))
        .filter((authorDid): authorDid is string => Boolean(authorDid)))];
      const recentAuthorDids = [...new Set(articles
        .map((article) => articleAuthors.get(article.uri))
        .filter((authorDid): authorDid is string => Boolean(authorDid)))];
      const authorDids = [...new Set([...pinnedAuthorDids, ...recentAuthorDids])];
      const authorProfiles = await Promise.all(authorDids.map(async (authorDid) => [
        authorDid,
        await fetchAuthorProfile(authorDid, fallbackPds),
      ] as const));
      const authors = new Map(authorProfiles);
      articles.forEach((article) => {
        const authorDid = articleAuthors.get(article.uri);
        if (authorDid) {
          article.author = authors.get(authorDid);
          article.path = canonicalDocumentPath(authorDid, article.author?.handle, article.rkey, configuredHandles);
          const domainHandle = configuredHandles.get(authorDid.toLowerCase());
          article.alternatePaths = domainHandle && article.author?.handle && domainHandle !== article.author.handle
            ? [`/post/${encodeURIComponent(article.author.handle)}/${encodeURIComponent(article.rkey)}`]
            : undefined;
        }
      });
      return articles;
    }

    // 1. Fetch site.standard.document records (if no publications are configured)
    const ownerProfile = await fetchAuthorProfile(did, pdsUrl);
    try {
      const stdUrl = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=site.standard.document&limit=50`;
      const stdRes = await fetchWithRetry(stdUrl);

      if (stdRes.ok) {
        const data: any = await stdRes.json();
        for (const rec of data.records || []) {
          if (!rec?.value) continue;
          const rkey = rec.uri ? rec.uri.split('/').pop() : Math.random().toString();
          const { content, format, mimeType } = extractDocumentContent(rec.value);
          const authorDid = ownerProfile?.did || did;
          const domainHandle = configuredHandles.get(authorDid.toLowerCase());

          articles.push({
            uri: rec.uri || '',
            cid: rec.cid || '',
            rkey: rkey || '',
            title: rec.value.title || 'Untitled Post',
            content: content,
            publishedAt: rec.value.publishedAt || rec.value.createdAt || new Date().toISOString(),
            tags: documentTags(rec.value.tags),
            path: canonicalDocumentPath(authorDid, ownerProfile?.handle, rkey || '', configuredHandles),
            alternatePaths: domainHandle
              ? [`/post/${encodeURIComponent(domainHandle)}/${encodeURIComponent(rkey || '')}`]
              : undefined,
            description: rec.value.description || rec.value.summary || '',
            cover: documentCoverUrl(rec.value, content, did, pdsUrl),
            format,
            mimeType,
            repoDid: did,
            pdsUrl,
            publicationUri: typeof rec.value.site === 'string' ? rec.value.site : undefined,
            author: ownerProfile,
          });
        }
      }
    } catch (e) {
      console.error('Error fetching standard documents:', e);
    }

    // 2. Fallback to app.bsky.feed.post if no standard.site documents exist
    if (articles.length === 0) {
      try {
        const bskyUrl = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.bsky.feed.post&limit=30`;
        const bskyRes = await fetchWithRetry(bskyUrl);
        if (bskyRes.ok) {
          const data: any = await bskyRes.json();
          for (const rec of data.records || []) {
            if (!rec?.value || rec.value.reply) continue;

            const rkey = rec.uri ? rec.uri.split('/').pop() : Math.random().toString();
            const rawText = typeof rec.value.text === 'string' ? rec.value.text : '';
            const textLines = rawText.split('\n');
            const title = textLines[0]
              ? (textLines[0].length > 60 ? textLines[0].substring(0, 60) + '...' : textLines[0])
              : 'Tech Note';

            articles.push({
              uri: rec.uri || '',
              cid: rec.cid || '',
              rkey: rkey || '',
              title: title,
              content: rawText,
              publishedAt: rec.value.createdAt || new Date().toISOString(),
              path: `/post/${encodeURIComponent(ownerProfile?.handle || 'unknown')}/${encodeURIComponent(rkey)}`,
              description: rawText ? (rawText.length > 160 ? rawText.substring(0, 160) + '...' : rawText) : '',
              repoDid: did,
              pdsUrl,
              author: ownerProfile,
            });
          }
        }
      } catch (e) {
        console.error('Error fetching Bluesky posts:', e);
      }
    }
  } catch (e) {
    console.error('Error fetching articles from PDS:', e);
  }

  return articles.sort((a, b) => {
    const timeA = new Date(a.publishedAt).getTime() || 0;
    const timeB = new Date(b.publishedAt).getTime() || 0;
    return timeB - timeA;
  });
}

export function searchArticles(articles: StandardDocument[], query: string): StandardDocument[] {
  if (!query.trim()) return articles;

  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return articles.filter((article) => {
    const searchable = [article.title, article.description, article.content, article.author?.handle, article.author?.displayName]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
