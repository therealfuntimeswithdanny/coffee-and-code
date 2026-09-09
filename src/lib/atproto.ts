import { StandardDocument } from '../types';

const imageCdnUrl = 'https://cdn.coffeencode.cc/';

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

export function proxyImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith(imageCdnUrl)) return imageUrl;
  return `${imageCdnUrl}${encodeURIComponent(imageUrl)}`;
}

function extractDocumentContent(value: any): string {
  if (typeof value.content === 'string') return value.content;
  if (typeof value.textContent === 'string') return value.textContent;
  if (typeof value.content?.textContent === 'string') return value.content.textContent;

  if (Array.isArray(value.content?.items)) {
    return value.content.items
      .map((item: any) => (typeof item?.plaintext === 'string' ? item.plaintext : ''))
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
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

export async function fetchArticles(did: string, pdsUrl: string, publicationRkey?: string): Promise<StandardDocument[]> {
  const articles: StandardDocument[] = [];
  try {
    // If a publication rkey is provided, fetch documents from that publication
    if (publicationRkey) {
      try {
        // Fetch all site.standard.document records
        const stdUrl = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=site.standard.document&limit=100`;
        const stdRes = await fetchWithRetry(stdUrl);

        if (stdRes.ok) {
          const data: any = await stdRes.json();
          for (const rec of data.records || []) {
            if (!rec?.value) continue;
            const rkey = rec.uri ? rec.uri.split('/').pop() : Math.random().toString();
            const content = extractDocumentContent(rec.value);

            articles.push({
              uri: rec.uri || '',
              cid: rec.cid || '',
              rkey: rkey || '',
              title: rec.value.title || 'Untitled Post',
              content: content,
              publishedAt: rec.value.publishedAt || rec.value.createdAt || new Date().toISOString(),
              path: `/post/${rkey}`,
              description: rec.value.description || rec.value.summary || (content ? content.substring(0, 160) + '...' : ''),
              cover: documentCoverUrl(rec.value, content, did, pdsUrl),
            });
          }
        }
      } catch (e) {
        console.error('Error fetching publication documents:', e);
      }

      return articles.sort((a, b) => {
        const timeA = new Date(a.publishedAt).getTime() || 0;
        const timeB = new Date(b.publishedAt).getTime() || 0;
        return timeB - timeA;
      });
    }

    // 1. Fetch site.standard.document records (if no publication rkey specified)
    try {
      const stdUrl = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=site.standard.document&limit=50`;
      const stdRes = await fetchWithRetry(stdUrl);

      if (stdRes.ok) {
        const data: any = await stdRes.json();
        for (const rec of data.records || []) {
          if (!rec?.value) continue;
          const rkey = rec.uri ? rec.uri.split('/').pop() : Math.random().toString();
          const content = extractDocumentContent(rec.value);

          articles.push({
            uri: rec.uri || '',
            cid: rec.cid || '',
            rkey: rkey || '',
            title: rec.value.title || 'Untitled Post',
            content: content,
            publishedAt: rec.value.publishedAt || rec.value.createdAt || new Date().toISOString(),
            path: `/post/${rkey}`,
            description: rec.value.description || rec.value.summary || (content ? content.substring(0, 160) + '...' : ''),
            cover: documentCoverUrl(rec.value, content, did, pdsUrl),
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
              path: `/post/${rkey}`,
              description: rawText ? (rawText.length > 160 ? rawText.substring(0, 160) + '...' : rawText) : '',
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

  const q = query.toLowerCase();
  return articles.filter(article =>
    article.title.toLowerCase().includes(q) ||
    article.description?.toLowerCase().includes(q) ||
    article.content.toLowerCase().includes(q)
  );
}
