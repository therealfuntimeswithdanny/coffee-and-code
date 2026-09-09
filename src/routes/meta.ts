import { Hono } from 'hono';
import { Env } from '../types';
import { getPdsEndpoint, fetchArticles } from '../lib/atproto';

const meta = new Hono<{ Bindings: Env }>();

// AT Protocol domain-to-DID verification record.
meta.get('/.well-known/atproto-did', (c) => {
  return c.text('did:plc:ofkstpvgn3okv2mllx4ezkod', 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
});

// standard.site publication record
meta.get('/.well-known/site.standard.publication', (c) => {
  const pubRecord = {
    $type: 'site.standard.publication',
    name: c.env.PUB_NAME,
    description: c.env.PUB_DESCRIPTION,
    url: new URL(c.req.url).origin,
    did: c.env.AUTHOR_DID,
  };

  return c.json(pubRecord, 200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
});

// RSS 2.0 Feed
meta.get('/rss.xml', async (c) => {
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const posts = await fetchArticles(c.env.AUTHOR_DID, pds);
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

// Sitemap XML
meta.get('/sitemap.xml', async (c) => {
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const posts = await fetchArticles(c.env.AUTHOR_DID, pds);
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
  <url><loc>${baseUrl}/about</loc></url>
  ${urls}
</urlset>`;

  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

export default meta;
