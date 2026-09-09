import { StandardDocument } from '../types';

const imageCdnUrl = 'https://cdn.coffee-and-code.com/';

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

function documentCoverUrl(value: any, did: string, pdsUrl: string): string | undefined {
  const cid = value.coverImage?.ref?.$link || value.cover?.ref?.$link;
  return cid
    ? `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`
    : undefined;
}

export async function getPdsEndpoint(did: string, fallbackPds: string): Promise<string> {
  try {
    const res = await fetch(`https://plc.directory/${did}`, {
      headers: { 'User-Agent': 'CoffeeAndCode-Worker' },
    });
    if (!res.ok) return fallbackPds;
    const data: any = await res.json();
    const pdsService = data.service?.find(
      (s: any) => s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
    );
    return pdsService?.serviceEndpoint || fallbackPds;
  } catch {
    return fallbackPds;
  }
}

export async function fetchArticles(did: string, pdsUrl: string): Promise<StandardDocument[]> {
  const articles: StandardDocument[] = [];
  try {
    // 1. Fetch site.standard.document records
    const stdUrl = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=site.standard.document&limit=50`;
    const stdRes = await fetch(stdUrl);

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
          // Always link through this worker so documents render consistently,
          // regardless of any custom source path stored on the record.
          path: `/post/${rkey}`,
          description: rec.value.description || rec.value.summary || (content ? content.substring(0, 160) + '...' : ''),
          cover: documentCoverUrl(rec.value, did, pdsUrl),
        });
      }
    }

    // 2. Fallback to app.bsky.feed.post if no standard.site documents exist
    if (articles.length === 0) {
      const bskyUrl = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.bsky.feed.post&limit=30`;
      const bskyRes = await fetch(bskyUrl);
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
