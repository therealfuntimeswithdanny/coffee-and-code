import { Hono } from 'hono';
import { Env } from '../types';
import { fetchArticles, getPdsEndpoint } from '../lib/atproto';
import { renderContent } from '../lib/contentRenderer';

const exportRouter = new Hono<{ Bindings: Env }>();

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

function wordpressDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '1970-01-01 00:00:00';
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function absoluteContentUrls(html: string, origin: string): string {
  return html.replace(/\b(src|href)=(['"])\/([^'"]*)\2/gi, (_match, attribute: string, quote: string, path: string) =>
    `${attribute}=${quote}${origin}/${path}${quote}`
  );
}

exportRouter.get('/wordpress.xml', async (c) => {
  const origin = new URL(c.req.url).origin;
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  const posts = await fetchArticles(pds, c.env.OWNER_DID);
  const authors = new Map<string, { id: number; login: string; name: string }>();

  for (const post of posts) {
    const login = post.author?.handle || 'site-owner';
    if (!authors.has(login)) {
      authors.set(login, {
        id: authors.size + 1,
        login,
        name: post.author?.displayName || login,
      });
    }
  }
  if (!authors.size) {
    authors.set('site-owner', { id: 1, login: 'site-owner', name: c.env.PUB_NAME });
  }

  const authorXml = [...authors.values()].map((author) => `
    <wp:author>
      <wp:author_id>${author.id}</wp:author_id>
      <wp:author_login>${cdata(author.login)}</wp:author_login>
      <wp:author_email></wp:author_email>
      <wp:author_display_name>${cdata(author.name)}</wp:author_display_name>
      <wp:author_first_name></wp:author_first_name>
      <wp:author_last_name></wp:author_last_name>
    </wp:author>`).join('');

  const itemXml = await Promise.all(posts.map(async (post, index) => {
    const login = post.author?.handle || 'site-owner';
    const date = wordpressDate(post.publishedAt);
    const html = absoluteContentUrls(await renderContent(post.content, post.format, post.mimeType), origin);
    const content = post.cover && !html.includes(post.cover)
      ? `<p><img src="${escapeXml(post.cover.startsWith('/') ? `${origin}${post.cover}` : post.cover)}" alt="" /></p>${html}`
      : html;
    const excerpt = post.description || '';

    return `
    <item>
      <title>${cdata(post.title)}</title>
      <link>${escapeXml(`${origin}${post.path}`)}</link>
      <pubDate>${escapeXml(new Date(post.publishedAt).toUTCString())}</pubDate>
      <dc:creator>${cdata(login)}</dc:creator>
      <guid isPermaLink="false">${escapeXml(post.uri || `${origin}${post.path}`)}</guid>
      <description></description>
      <content:encoded>${cdata(content)}</content:encoded>
      <excerpt:encoded>${cdata(excerpt)}</excerpt:encoded>
      <wp:post_id>${index + 1}</wp:post_id>
      <wp:post_date>${date}</wp:post_date>
      <wp:post_date_gmt>${date}</wp:post_date_gmt>
      <wp:comment_status>closed</wp:comment_status>
      <wp:ping_status>closed</wp:ping_status>
      <wp:post_name>${escapeXml(post.rkey)}</wp:post_name>
      <wp:status>publish</wp:status>
      <wp:post_parent>0</wp:post_parent>
      <wp:menu_order>0</wp:menu_order>
      <wp:post_type>post</wp:post_type>
      <wp:post_password></wp:post_password>
      <wp:is_sticky>0</wp:is_sticky>
    </item>`;
  }));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>${escapeXml(c.env.PUB_NAME)}</title>
    <link>${escapeXml(origin)}</link>
    <description>${escapeXml(c.env.PUB_DESCRIPTION)}</description>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <language>en-US</language>
    <wp:wxr_version>1.2</wp:wxr_version>
    <wp:base_site_url>${escapeXml(origin)}</wp:base_site_url>
    <wp:base_blog_url>${escapeXml(origin)}</wp:base_blog_url>${authorXml}
    ${itemXml.join('')}
  </channel>
</rss>`;

  return c.body(xml, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Content-Disposition': 'attachment; filename="coffeencode-wordpress.xml"',
  });
});

export default exportRouter;