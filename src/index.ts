import { Hono } from 'hono';
import { marked } from 'marked';

type Env = {
  PUB_NAME: string;
  PUB_DESCRIPTION: string;
  AUTHOR_DID: string;
  DEFAULT_PDS: string;
};

interface StandardDocument {
  uri: string;
  cid: string;
  rkey: string;
  title: string;
  content: string;
  publishedAt: string;
  path: string;
  description?: string;
  cover?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Enable Marked line breaks and syntax wrapping
marked.setOptions({ breaks: true, gfm: true });

// Helper: Resolve PDS Endpoint from DID PLC
async function getPdsEndpoint(did: string, fallbackPds: string): Promise<string> {
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
  } catch (err) {
    return fallbackPds;
  }
}

// Helper: Fetch site.standard.document records (with bsky feed fallback)
async function fetchArticles(did: string, pdsUrl: string): Promise<StandardDocument[]> {
  const articles: StandardDocument[] = [];
  try {
    // 1. Fetch site.standard.document records
    const stdUrl = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=site.standard.document&limit=50`;
    const stdRes = await fetch(stdUrl);

    if (stdRes.ok) {
      const data: any = await stdRes.json();
      for (const rec of data.records || []) {
        const rkey = rec.uri.split('/').pop();
        articles.push({
          uri: rec.uri,
          cid: rec.cid,
          rkey: rkey,
          title: rec.value.title || 'Untitled Post',
          content: rec.value.content || '',
          publishedAt: rec.value.publishedAt || rec.value.createdAt || new Date().toISOString(),
          path: rec.value.path || `/post/${rkey}`,
          description: rec.value.description || rec.value.summary || '',
          cover: rec.value.cover?.ref?.$link ? `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${rec.value.cover.ref.$link}` : undefined
        });
      }
    }

    // 2. Fallback to app.bsky.feed.post if no standard.site documents exist yet
    if (articles.length === 0) {
      const bskyUrl = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.bsky.feed.post&limit=30`;
      const bskyRes = await fetch(bskyUrl);
      if (bskyRes.ok) {
        const data: any = await bskyRes.json();
        for (const rec of data.records || []) {
          // Filter out replies, keep standalone long/short posts
          if (!rec.value.reply) {
            const rkey = rec.uri.split('/').pop();
            const textLines = (rec.value.text || '').split('\n');
            const title = textLines[0].length > 60 ? textLines[0].substring(0, 60) + '...' : textLines[0];
            articles.push({
              uri: rec.uri,
              cid: rec.cid,
              rkey: rkey,
              title: title || 'Tech Note',
              content: rec.value.text || '',
              publishedAt: rec.value.createdAt || new Date().toISOString(),
              path: `/post/${rkey}`,
              description: rec.value.text ? rec.value.text.substring(0, 160) + '...' : ''
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('Error fetching articles:', e);
  }

  // Sort newest first
  return articles.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

// Layout wrapper HTML
function renderLayout(c: any, title: string, content: string, metaTags = '') {
  const pubName = c.env.PUB_NAME;
  const did = c.env.AUTHOR_DID;

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | ${pubName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            coffee: {
              50: '#fdfbf7',
              100: '#f7f2e8',
              500: '#b07d4f',
              800: '#3c2415',
              900: '#23140c',
            },
            codebg: '#0d1117'
          }
        }
      }
    }
  </script>
  <link rel="alternate" type="application/rss+xml" title="${pubName} RSS Feed" href="/rss.xml">
  <link rel="site.standard.publication" href="at://${did}/site.standard.publication/self">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    code, pre { font-family: 'Fira Code', monospace; }
    .prose code { background: #1f2937; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.875em; color: #f3f4f6; }
    .prose pre { background: #0d1117; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; border: 1px solid #30363d; margin: 1.5rem 0; }
    .prose pre code { background: transparent; padding: 0; color: #e6edf3; }
    .prose p { margin-bottom: 1.25rem; line-height: 1.75; color: #d1d5db; }
    .prose h1, .prose h2, .prose h3 { color: #f9fafb; font-weight: 700; margin-top: 2rem; margin-bottom: 1rem; }
    .prose h1 { font-size: 1.875rem; }
    .prose h2 { font-size: 1.5rem; }
    .prose a { color: #38bdf8; text-decoration: underline; }
  </style>
  ${metaTags}
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen flex flex-col selection:bg-amber-500/30 selection:text-amber-200">

  <!-- Header -->
  <header class="border-b border-gray-800/80 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
    <div class="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3 group">
        <div class="w-9 h-9 rounded-lg bg-amber-600/20 border border-amber-500/30 flex items-center justify-center text-amber-500 font-bold text-lg group-hover:scale-105 transition-transform">
          ☕
        </div>
        <div>
          <span class="font-bold text-lg tracking-tight text-white group-hover:text-amber-400 transition-colors">${pubName}</span>
          <span class="text-xs text-amber-500/80 block -mt-1 font-mono">standard.site pub</span>
        </div>
      </a>

      <nav class="flex items-center gap-4 text-sm font-medium">
        <a href="/rss.xml" class="text-gray-400 hover:text-amber-400 transition-colors flex items-center gap-1">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/></svg>
          RSS
        </a>
        <a href="https://bsky.app/profile/${did}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-mono transition-all">
          ATProto PDS ↗
        </a>
      </nav>
    </div>
  </header>

  <!-- Main Content -->
  <main class="flex-grow max-w-5xl w-full mx-auto px-6 py-10">
    ${content}
  </main>

  <!-- Footer -->
  <footer class="border-t border-gray-900 bg-gray-950 py-8 text-center text-xs text-gray-500">
    <div class="max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
      <div>
        © ${new Date().getFullYear()} <strong class="text-gray-300">${pubName}</strong>. Decentralized & Self-Hosted on Cloudflare Workers.
      </div>
      <div class="font-mono text-gray-600 flex items-center gap-2">
        <span>DID: ${did.substring(0, 18)}...</span>
        <span>•</span>
        <a href="/.well-known/site.standard.publication" class="hover:underline text-amber-500/80">standard.site spec</a>
      </div>
    </div>
  </footer>

</body>
</html>`;
}

// ROUTE 1: Publication Homepage
app.get('/', async (c) => {
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const posts = await fetchArticles(c.env.AUTHOR_DID, pds);

  const heroPost = posts[0];
  const remainingPosts = posts.slice(1);

  const heroHtml = heroPost ? `
    <article class="relative mb-12 p-8 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-900/40 border border-amber-500/20 hover:border-amber-500/40 transition-all shadow-xl">
      <div class="flex items-center gap-2 text-xs font-mono text-amber-500 mb-3">
        <span>LATEST POST</span>
        <span>•</span>
        <time>${new Date(heroPost.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</time>
      </div>
      <h2 class="text-3xl font-extrabold tracking-tight text-white mb-3 hover:text-amber-300 transition-colors">
        <a href="${heroPost.path}">${heroPost.title}</a>
      </h2>
      <p class="text-gray-400 line-clamp-3 mb-6 text-base leading-relaxed">
        ${heroPost.description || heroPost.content.substring(0, 200) + '...'}
      </p>
      <a href="${heroPost.path}" class="inline-flex items-center gap-2 text-sm font-semibold text-amber-400 hover:text-amber-300">
        Read Full Entry ➔
      </a>
    </article>
  ` : '<p class="text-gray-400 py-12 text-center">No posts found on PDS yet.</p>';

  const gridHtml = remainingPosts.map(post => `
    <article class="p-6 rounded-xl bg-gray-900/60 border border-gray-800 hover:border-gray-700 transition-all flex flex-col justify-between group">
      <div>
        <time class="text-xs font-mono text-gray-500 mb-2 block">
          ${new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </time>
        <h3 class="text-xl font-bold text-gray-100 group-hover:text-amber-400 transition-colors mb-2">
          <a href="${post.path}">${post.title}</a>
        </h3>
        <p class="text-sm text-gray-400 line-clamp-2 leading-relaxed">
          ${post.description || post.content.substring(0, 120) + '...'}
        </p>
      </div>
      <a href="${post.path}" class="mt-4 text-xs font-mono text-amber-500 hover:underline inline-block">
        Read Article →
      </a>
    </article>
  `).join('');

  const body = `
    <!-- Pub Banner -->
    <section class="mb-12 text-center md:text-left border-b border-gray-800/60 pb-8">
      <h1 class="text-4xl font-extrabold tracking-tight text-white mb-3">
        ${c.env.PUB_NAME}
      </h1>
      <p class="text-lg text-gray-400 max-w-2xl">
        ${c.env.PUB_DESCRIPTION}
      </p>
    </section>

    ${heroHtml}

    ${remainingPosts.length > 0 ? `
      <h3 class="text-xs font-mono text-gray-500 uppercase tracking-wider mb-6">Archive & Recent Posts</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        ${gridHtml}
      </div>
    ` : ''}
  `;

  return c.html(renderLayout(c, 'Home', body));
});

// ROUTE 2: Individual Post Page
app.get('/post/:rkey', async (c) => {
  const rkey = c.req.param('rkey');
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const posts = await fetchArticles(c.env.AUTHOR_DID, pds);

  const post = posts.find(p => p.rkey === rkey || p.path === `/post/${rkey}`);

  if (!post) {
    return c.html(renderLayout(c, '404 - Article Not Found', `
      <div class="text-center py-20">
        <h1 class="text-4xl font-bold text-amber-500 mb-4">404</h1>
        <p class="text-gray-400 mb-6">The requested article could not be located on the ATProto PDS.</p>
        <a href="/" class="text-amber-400 hover:underline font-mono">← Back to Publication</a>
      </div>
    `), 404);
  }

  const htmlContent = marked.parse(post.content);
  const articleMetaTags = `
    <link rel="site.standard.document" href="${post.uri}">
    <meta name="atproto:uri" content="${post.uri}">
    <meta property="og:title" content="${post.title}">
    <meta property="og:description" content="${post.description || ''}">
  `;

  const body = `
    <article class="max-w-3xl mx-auto">
      <a href="/" class="text-xs font-mono text-amber-500 hover:underline mb-8 inline-block">← Back to ${c.env.PUB_NAME}</a>
      
      <header class="mb-8 pb-8 border-b border-gray-800">
        <time class="text-xs font-mono text-gray-500 mb-3 block">
          Published ${new Date(post.publishedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </time>
        <h1 class="text-4xl font-extrabold text-white tracking-tight mb-4 leading-tight">
          ${post.title}
        </h1>
        <div class="flex items-center gap-3 text-xs text-gray-400 font-mono">
          <span>Author DID: ${c.env.AUTHOR_DID.substring(0, 16)}...</span>
        </div>
      </header>

      ${post.cover ? `<img src="${post.cover}" alt="Cover image" class="w-full rounded-xl mb-8 border border-gray-800 object-cover max-h-96">` : ''}

      <div class="prose">
        ${htmlContent}
      </div>

      <footer class="mt-12 pt-6 border-t border-gray-900 text-xs font-mono text-gray-500 flex justify-between items-center">
        <span>Record URI: ${post.uri}</span>
        <a href="https://bsky.app" target="_blank" class="text-amber-500 hover:underline">Verify on ATProto ↗</a>
      </footer>
    </article>
  `;

  return c.html(renderLayout(c, post.title, body, articleMetaTags));
});

// ROUTE 3: Standard.site Specification JSON Endpoint
app.get('/.well-known/site.standard.publication', (c) => {
  const pubRecord = {
    "$type": "site.standard.publication",
    "name": c.env.PUB_NAME,
    "description": c.env.PUB_DESCRIPTION,
    "url": new URL(c.req.url).origin,
    "did": c.env.AUTHOR_DID
  };

  return c.json(pubRecord, 200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
});

// ROUTE 4: RSS 2.0 Feed
app.get('/rss.xml', async (c) => {
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const posts = await fetchArticles(c.env.AUTHOR_DID, pds);
  const baseUrl = new URL(c.req.url).origin;

  const rssItems = posts.map(p => `
    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${baseUrl}${p.path}</link>
      <guid isPermaLink="false">${p.uri}</guid>
      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
      <description><![CDATA[${p.description || p.content}]]></description>
    </item>
  `).join('');

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

// ROUTE 5: Sitemap XML
app.get('/sitemap.xml', async (c) => {
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const posts = await fetchArticles(c.env.AUTHOR_DID, pds);
  const baseUrl = new URL(c.req.url).origin;

  const urls = posts.map(p => `
    <url>
      <loc>${baseUrl}${p.path}</loc>
      <lastmod>${new Date(p.publishedAt).toISOString()}</lastmod>
    </url>
  `).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${baseUrl}/</loc></url>
  ${urls}
</urlset>`;

  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

export default app;
