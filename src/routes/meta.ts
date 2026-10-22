import { Hono } from 'hono';
import { Env } from '../types';
import { getPdsEndpoint, fetchArticles } from '../lib/atproto';

const meta = new Hono<{ Bindings: Env }>();

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// AT Protocol domain-to-DID verification record.
meta.get('/.well-known/atproto-did', (c) => {
  return c.text('did:plc:z7hzwpuv5ytin56wecfxa4mx', 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
});

// standard.site publication record
meta.get('/.well-known/site.standard.publication', (c) => {
  return c.text('at://did:plc:l37td5yhxl2irrzrgvei4qay/site.standard.publication/3m3lav73ujc27', 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
});

// Public AT Protocol OAuth client metadata. The metadata URL is the OAuth client ID.
meta.get('/oauth-client-metadata.json', (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: c.env.PUB_NAME || 'Coffee and Code',
    client_uri: origin,
    logo_uri: `${origin}/favicon.png`,
    policy_uri: `${origin}/privacy`,
    redirect_uris: [`${origin}/auth`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'atproto repo:cc.coffeencode.interact.like?action=create&action=delete repo:cc.coffeencode.interact.dislike?action=create&action=delete repo:cc.coffeencode.interact.view?action=create',
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  }, 200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  });
});

// RSS 2.0 Feed
meta.get('/rss.xml', async (c) => {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const posts = (await fetchArticles(pds, c.env.OWNER_DID)).slice(0, 10);
  const baseUrl = new URL(c.req.url).origin;

  const rssItems = posts
    .map(
      (p) => `
    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${baseUrl}${p.path}</link>
      <guid isPermaLink="false">${p.uri}</guid>
      <pubDate>${p.publishedAt ? new Date(p.publishedAt).toUTCString() : ''}</pubDate>
      <description><![CDATA[${p.description || p.content}]]></description>
    </item>
  `
    )
    .join('');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${c.env.PUB_NAME}</title>
    <link>${baseUrl}</link>
    <description>${c.env.PUB_DESCRIPTION}</description>
    <language>en-us</language>
    ${rssItems}
  </channel>
</rss>`;

  return c.text(rssXml, 200, { 'Content-Type': 'application/xml' });
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
      (p) => `
    <url>
      <loc>${baseUrl}${p.path}</loc>
      <lastmod>${p.publishedAt ? new Date(p.publishedAt).toISOString() : new Date().toISOString()}</lastmod>
    </url>
  `
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${baseUrl}/</loc></url>
  <url><loc>${baseUrl}/authors</loc></url>
  ${urls}
</urlset>`;

  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

export default meta;
