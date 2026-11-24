import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import { getPdsEndpoint, fetchArticles, fetchAuthorProfile, resolveAtprotoIdentifier } from '../lib/atproto';
import { fetchListItems, fetchListRecord } from './users';

const meta = new Hono<{ Bindings: Env }>();

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cdata(value: string) {
  return `<![CDATA[${value.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

// AT Protocol domain-to-DID verification record.
meta.get('/.well-known/atproto-did', (c) => {
  return c.text('did:plc:z7hzwpuv5ytin56wecfxa4mx', 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
});

// standard.site publication records
// Root publication (url: https://coffeencode.cc)
meta.get('/.well-known/site.standard.publication', (c) => {
  return c.text('at://did:plc:l37td5yhxl2irrzrgvei4qay/site.standard.publication/3myy27riph22b', 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
});

// Non-root publication (url: https://coffeencode.cc/author/danielmorrisey.com)
meta.get('/.well-known/site.standard.publication/author/danielmorrisey.com', (c) => {
  return c.text('at://did:plc:l37td5yhxl2irrzrgvei4qay/site.standard.publication/3m3lav73ujc27', 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
});

function rssResponse(
  posts: StandardDocument[],
  channel: { title: string; link: string; description: string },
  baseUrl: string,
) {
  const rssItems = posts
    .map(
      (p) => {
        const publishedDate = new Date(p.publishedAt);
        return `
    <item>
      <title>${cdata(p.title)}</title>
      <link>${escapeXml(`${baseUrl}${p.path}`)}</link>
      <guid isPermaLink="false">${escapeXml(p.uri)}</guid>
      <pubDate>${Number.isFinite(publishedDate.getTime()) ? publishedDate.toUTCString() : ''}</pubDate>
      <description>${cdata(p.description || p.content)}</description>
    </item>
  `;
      }
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.link)}</link>
    <description>${escapeXml(channel.description)}</description>
    <language>en-us</language>
    ${rssItems}
  </channel>
</rss>`;
}

const xmlHeaders = () => ({ 'Content-Type': 'application/xml' });

// RSS 2.0 Feed
meta.get('/rss.xml', async (c) => {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const posts = (await fetchArticles(pds, c.env.OWNER_DID)).slice(0, 10);
  const baseUrl = new URL(c.req.url).origin;
  return c.text(rssResponse(posts, {
    title: c.env.PUB_NAME,
    link: baseUrl,
    description: c.env.PUB_DESCRIPTION,
  }, baseUrl), 200, xmlHeaders());
});

// Per-author feed: everything they published or co-authored on the publication.
meta.get('/author/:handle/rss.xml', async (c) => {
  const identifier = c.req.param('handle');
  const did = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(identifier)
    ? identifier
    : await resolveAtprotoIdentifier(identifier).catch(() => undefined);
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const posts = (await fetchArticles(pds, c.env.OWNER_DID)).filter((post) =>
    post.author?.did.toLowerCase() === identifier.toLowerCase()
    || post.author?.handle.toLowerCase() === identifier.toLowerCase()
    || (did ? post.author?.did === did || post.coAuthorDids?.includes(did) : false));
  const author = posts.find((post) => post.author?.did === did)?.author
    || posts[0]?.author
    || (did ? await fetchAuthorProfile(did, pds) : undefined);
  if (!author) return c.text('Author not found', 404);
  const baseUrl = new URL(c.req.url).origin;
  const name = author.displayName || author.handle;
  return c.text(rssResponse(posts.slice(0, 30), {
    title: `${name} on ${c.env.PUB_NAME}`,
    link: `${baseUrl}/author/${encodeURIComponent(author.handle)}`,
    description: `Stories by ${name} on ${c.env.PUB_NAME}.`,
  }, baseUrl), 200, xmlHeaders());
});

// Per-tag feed.
meta.get('/tag/:tag/rss.xml', async (c) => {
  const tag = decodeURIComponent(c.req.param('tag')).trim();
  if (!tag || tag.length > 200) return c.text('Tag not found', 404);
  const tagKey = tag.toLocaleLowerCase();
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const posts = (await fetchArticles(pds, c.env.OWNER_DID))
    .filter((post) => post.tags?.some((postTag) => postTag.toLocaleLowerCase() === tagKey))
    .slice(0, 30);
  const baseUrl = new URL(c.req.url).origin;
  return c.text(rssResponse(posts, {
    title: `#${tag} on ${c.env.PUB_NAME}`,
    link: `${baseUrl}/tags?tag=${encodeURIComponent(tag)}`,
    description: `Stories tagged ${tag} on ${c.env.PUB_NAME}.`,
  }, baseUrl), 200, xmlHeaders());
});

// Per-list feed: a user's public list as a subscription.
meta.get('/user/:identifier/list/:rkey/rss.xml', async (c) => {
  const rkey = c.req.param('rkey');
  if (!/^[a-zA-Z0-9._~:-]+$/.test(rkey)) return c.text('List not found', 404);
  const did = await resolveAtprotoIdentifier(c.req.param('identifier')).catch(() => undefined);
  if (!did) return c.text('Profile not found', 404);
  const [profile, pds] = await Promise.all([
    fetchAuthorProfile(did, c.env.OWNER_PDS),
    getPdsEndpoint(did, c.env.OWNER_PDS),
  ]);
  const list = await fetchListRecord(pds, did, rkey).catch(() => undefined);
  if (!list) return c.text('List not found', 404);
  const items = await fetchListItems(pds, did, list.uri).catch(() => []);
  const publicationPds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const articles = await fetchArticles(publicationPds, c.env.OWNER_DID).catch(() => [] as StandardDocument[]);
  const articlesByUri = new Map(articles.map((article) => [article.uri, article]));
  // List order is "recently added first"; the feed mirrors it.
  const posts = items.map((item) => articlesByUri.get(item.document)).filter((article): article is StandardDocument => Boolean(article));
  const baseUrl = new URL(c.req.url).origin;
  const ownerName = profile?.displayName || profile?.handle || c.req.param('identifier');
  return c.text(rssResponse(posts.slice(0, 50), {
    title: `${list.title} — ${ownerName}`,
    link: `${baseUrl}/user/${encodeURIComponent(profile?.handle || c.req.param('identifier'))}/list/${encodeURIComponent(rkey)}`,
    description: list.about || `A post list curated by ${ownerName} on ${c.env.PUB_NAME}.`,
  }, baseUrl), 200, xmlHeaders());
});

// Google News sitemap. Google recommends including only articles published in
// the last two days in a News sitemap.
meta.get('/news-sitemap.xml', async (c) => {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const posts = await fetchArticles(pds, c.env.OWNER_DID);
  const baseUrl = new URL(c.req.url).origin;
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const recentPosts = posts.filter((post) => {
    const publishedAt = new Date(post.publishedAt).getTime();
    return Number.isFinite(publishedAt) && publishedAt >= cutoff;
  });

  const urls = recentPosts
    .map((post) => `
  <url>
    <loc>${escapeXml(`${baseUrl}${post.path}`)}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(c.env.PUB_NAME)}</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${escapeXml(new Date(post.publishedAt).toISOString())}</news:publication_date>
      <news:title>${escapeXml(post.title)}</news:title>
    </news:news>
  </url>`)
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${urls}
</urlset>`;

  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

meta.get('/robots.txt', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.text(`User-agent: *
Allow: /
Disallow: /search

Sitemap: ${baseUrl}/sitemap.xml
Sitemap: ${baseUrl}/news-sitemap.xml
`, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

// Sitemap XML
meta.get('/sitemap.xml', async (c) => {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const posts = await fetchArticles(pds, c.env.OWNER_DID);
  const baseUrl = new URL(c.req.url).origin;

  const urls = posts
    .map(
      (p) => {
        const publishedDate = new Date(p.publishedAt);
        return `
    <url>
      <loc>${escapeXml(`${baseUrl}${p.path}`)}</loc>
      ${Number.isFinite(publishedDate.getTime()) ? `<lastmod>${publishedDate.toISOString()}</lastmod>` : ''}
    </url>
  `;
      }
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${escapeXml(`${baseUrl}/`)}</loc></url>
  <url><loc>${escapeXml(`${baseUrl}/authors`)}</loc></url>
  ${urls}
</urlset>`;

  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

export default meta;
