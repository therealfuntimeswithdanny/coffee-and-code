import { Hono, type Context } from 'hono';
import { Env } from '../types';
import { getPdsEndpoint, fetchArticles, fetchArticleByPath, fetchPostMetadata, fetchRecord, fetchAuthorProfile, proxyImageUrl, proxyAvatarUrl } from '../lib/atproto';
import { renderLayout, browserRunScreenshotUrl } from '../templates/layout';
import { renderContent, renderHtmlAsMarkdown, processImages, enhanceHtmlStructure, readingTimeMinutes } from '../lib/contentRenderer';
import { routeExternalLinks, externalLinkUrl } from '../lib/externalLinks';

const posts = new Hono<{ Bindings: Env }>();

function formatDate(date?: string) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(date?: string) {
  if (!date) return '';
  return new Date(date).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Fixed top progress bar plus a "pick up where you left off" toast. Position is
// remembered per post URI in localStorage so a returning reader resumes their
// spot on any article — signed in or not.
function readingProgressHtml(subjectUri: string) {
  return `
    <style>
      .reading-progress { height: 3px; left: 0; position: fixed; right: 0; top: 0; z-index: 320; }
      .reading-progress__bar { background: var(--accent); display: block; height: 100%; transform: scaleX(0); transform-origin: 0 50%; transition: transform .12s linear; }
      .reading-resume { align-items: center; background: var(--paper-deep); border: 1px solid var(--line-strong); bottom: 20px; box-shadow: 0 10px 30px rgba(0, 0, 0, .45); color: var(--ink); display: flex; font: 14px 'Source Sans 3', sans-serif; gap: 14px; left: 50%; max-width: min(92vw, 480px); padding: 10px 12px 10px 16px; position: fixed; transform: translateX(-50%); z-index: 320; }
      .reading-resume__actions { display: flex; gap: 6px; margin-left: auto; }
      .reading-resume button { background: transparent; border: 1px solid var(--line-strong); color: var(--ink); cursor: pointer; font: 600 13px 'Source Sans 3', sans-serif; padding: 6px 12px; white-space: nowrap; }
      .reading-resume button:hover { border-color: var(--accent); color: var(--accent); }
      .reading-resume [data-resume-go] { background: var(--accent); border-color: var(--accent); color: var(--paper); }
      .reading-resume [data-resume-go]:hover { color: var(--paper); }
    </style>
    <div class="reading-progress" aria-hidden="true"><span class="reading-progress__bar" data-reading-progress-bar></span></div>
    <script>
    (() => {
      const bar = document.querySelector('[data-reading-progress-bar]');
      if (!bar) return;
      const key = 'cc:readpos:' + ${JSON.stringify(subjectUri)};
      const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const fraction = () => Math.min(1, Math.max(0, window.scrollY / maxScroll()));
      let saved;
      try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { saved = null; }
      if (saved && typeof saved.y === 'number' && typeof saved.f === 'number'
        && saved.f > 0.03 && saved.f < 0.95 && Number.isFinite(saved.t) && Date.now() - saved.t < 30 * 864e5) {
        const toast = document.createElement('div');
        toast.className = 'reading-resume';
        toast.setAttribute('role', 'status');
        toast.innerHTML = '<span>You\\u2019re ' + Math.round(saved.f * 100) + '% through this story.</span>'
          + '<span class="reading-resume__actions"><button type="button" data-resume-go>Resume</button>'
          + '<button type="button" data-resume-dismiss aria-label="Dismiss">\\u00d7</button></span>';
        document.body.append(toast);
        const done = () => toast.remove();
        toast.querySelector('[data-resume-go]').addEventListener('click', () => {
          window.scrollTo({ top: saved.y, behavior: 'auto' });
          done();
        });
        toast.querySelector('[data-resume-dismiss]').addEventListener('click', done);
        window.setTimeout(done, 20000);
      }
      let ticking = false;
      let saveTimer;
      const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          const f = fraction();
          bar.style.transform = 'scaleX(' + f + ')';
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            try { localStorage.setItem(key, JSON.stringify({ y: window.scrollY, f, t: Date.now() })); } catch {}
          }, 400);
        });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      bar.style.transform = 'scaleX(' + fraction() + ')';
    })();
    </script>`;
}

async function renderPost(
  c: Context<{ Bindings: Env }>,
  rkey: string,
  requestedHandle?: string,
  requestedPath?: string,
) {
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);
  // Scheduled stories render at their own URL — it doubles as a preview link —
  // but stay out of listings until publishedAt passes.
  const allPosts = await fetchArticles(pds, c.env.OWNER_DID, undefined, { includeScheduled: true });
  const candidates = allPosts.filter((p) => p.rkey === rkey);
  const post = (requestedPath
    ? candidates.find((item) => item.path === requestedPath || item.alternatePaths?.includes(requestedPath))
    : undefined)
    || (!requestedHandle
    ? candidates[0]
    : candidates.find((item) => {
        const canonicalDid = item.author?.did || item.repoDid || '';
        return canonicalDid.toLowerCase() === requestedHandle.toLowerCase()
          || item.author?.handle.toLowerCase() === requestedHandle.toLowerCase();
      }) || (candidates.length === 1 ? candidates[0] : undefined))
    || (requestedHandle
      ? await fetchArticleByPath(requestedHandle, rkey, pds, c.env.OWNER_DID)
      : undefined);

  if (!post) {
    return c.html(renderLayout(c, 'Article Not Found', `
      <section class="not-found">
        <h1>Article not found</h1>
        <p>The requested story could not be located. It may have moved or no longer be published.</p>
        <div class="not-found__actions">
          <a href="/" class="read-link">Back to publication <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
          <a href="/archive" class="read-link">Browse archive <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
          <button type="button" class="read-link search-button-link" data-open-search>Search articles <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
        </div>
      </section>
    `), 404);
  }

  const requestUrl = new URL(c.req.url);
  if (requestUrl.pathname !== post.path) {
    return c.redirect(`${post.path}${requestUrl.search}`, 301);
  }

  const postMetadata = post.metadata
    || await fetchPostMetadata(post.pdsUrl || pds, post.repoDid || c.env.OWNER_DID, post.rkey);

  const postTagKeys = new Set((post.tags || []).map((tag) => tag.toLocaleLowerCase()));
  // Scheduled stories stay out of rails and recommendations — their own URL is
  // the only place they render.
  const listedPosts = allPosts.filter((item) => !item.scheduled);
  const tagMatches = listedPosts
    .filter((item) => item.path !== post.path && item.tags?.some((tag) => postTagKeys.has(tag.toLocaleLowerCase())))
    .map((item) => ({
      post: item,
      sharedTagCount: item.tags?.filter((tag) => postTagKeys.has(tag.toLocaleLowerCase())).length || 0,
    }))
    .sort((a, b) => b.sharedTagCount - a.sharedTagCount
      || (Date.parse(b.post.publishedAt) || 0) - (Date.parse(a.post.publishedAt) || 0));
  const recommendations = tagMatches.slice(0, 3).map(({ post: item }) => item);
  // Keep the rail populated when tags don't overlap: more from this author
  // first, then the latest stories overall.
  if (recommendations.length < 3) {
    const seen = new Set([post.path, ...recommendations.map((item) => item.path)]);
    const authorDid = post.author?.did || post.repoDid;
    const fill = listedPosts
      .filter((item) => !seen.has(item.path))
      .map((item) => ({
        post: item,
        sameAuthor: Boolean(authorDid) && (item.author?.did || item.repoDid) === authorDid,
      }))
      .sort((a, b) => Number(b.sameAuthor) - Number(a.sameAuthor)
        || (Date.parse(b.post.publishedAt) || 0) - (Date.parse(a.post.publishedAt) || 0));
    for (const { post: item } of fill) {
      if (recommendations.length >= 3) break;
      recommendations.push(item);
    }
  }

  // Render content based on detected format
  const renderedContent = await renderContent(post.content || '', post.format, post.mimeType);

  // Process images to use proxy URLs
  const requestOrigin = new URL(c.req.url).origin;
  const processImageSource = (source: string) => {
    if (source.startsWith('/api/blob/')) {
      const cid = source.replace(/^\/api\/blob\//, '');
      const sourceDid = post.repoDid || c.env.OWNER_DID;
      const sourcePds = post.pdsUrl || pds;
      const blobUrl = `${sourcePds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(sourceDid)}&cid=${encodeURIComponent(cid)}`;
      return proxyImageUrl(blobUrl, requestOrigin);
    }

    return proxyImageUrl(source, requestOrigin);
  };

  const processedContent = processImages(renderedContent, processImageSource);

  const viewMode = requestUrl.searchParams.get('viewMode');
  if (viewMode === 'markdown') {
    const markdownBody = [
      `# ${post.title}`,
      post.description?.trim(),
      renderHtmlAsMarkdown(processedContent),
    ].filter(Boolean).join('\n\n');
    return c.body(markdownBody, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  }

  // Enhance HTML structure with prose classes for better styling
  const htmlContent = routeExternalLinks(enhanceHtmlStructure(processedContent));
  const pageUrl = new URL(c.req.url).toString();
  const browserRun = viewMode === 'browseRun' || requestUrl.searchParams.get('browserRun') === 'true';

  // Escape HTML entities for safe attribute values
  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const articleSubtitle = typeof post.description === 'string' ? post.description.trim() : '';
  const tagLinks = (post.tags || []).map((tag) => `
    <a class="article-tag" href="/tags?tag=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`).join('');
  const authorLink = post.author ? `/author/${encodeURIComponent(post.author.handle)}` : '';
  const authorName = post.author?.displayName || post.author?.handle || '';
  const authorAvatar = post.author?.avatar ? escapeHtml(proxyAvatarUrl(post.author.avatar)) : '';
  // Co-authors come from the document's `authors` array; profiles resolve
  // lazily here so listing pages never pay for the extra lookups.
  const coAuthors = (await Promise.all(
    (post.coAuthorDids || []).map((did) => fetchAuthorProfile(did, post.pdsUrl || pds)),
  )).filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));
  const bylineLinks = [
    post.author ? `<a class="article__author" href="${authorLink}">${authorAvatar ? `<img src="${authorAvatar}" alt="" class="article__author-avatar" width="36" height="36" loading="lazy" decoding="async">` : '<span class="article__author-avatar article__author-avatar--placeholder" aria-hidden="true"></span>'}<span data-author-verification-did="${escapeHtml(post.author.did)}">${escapeHtml(authorName)}</span></a>` : '',
    ...coAuthors.map((coAuthor) => {
      const name = coAuthor.displayName || coAuthor.handle;
      const avatar = coAuthor.avatar ? escapeHtml(proxyAvatarUrl(coAuthor.avatar)) : '';
      return `<a class="article__author" href="/author/${encodeURIComponent(coAuthor.handle)}">${avatar ? `<img src="${avatar}" alt="" class="article__author-avatar" width="36" height="36" loading="lazy" decoding="async">` : '<span class="article__author-avatar article__author-avatar--placeholder" aria-hidden="true"></span>'}<span data-author-verification-did="${escapeHtml(coAuthor.did)}">${escapeHtml(name)}</span></a>`;
    }),
  ].filter(Boolean);
  // Update history: republishes stamp `updatedAt` (and optionally append
  // {at, note} entries to `updates`) on the document record.
  const updateEntries = (Array.isArray(post.record?.updates) ? post.record.updates : [])
    .filter((entry): entry is { at: string; note?: string } =>
      Boolean(entry) && typeof entry === 'object' && typeof (entry as { at?: unknown }).at === 'string'
        && Number.isFinite(Date.parse((entry as { at: string }).at)))
    .filter((entry) => Date.parse(entry.at) > Date.parse(post.publishedAt) + 60000)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 20);
  const recordUpdatedAt = typeof post.record?.updatedAt === 'string' && Number.isFinite(Date.parse(post.record.updatedAt))
    && Date.parse(post.record.updatedAt) > Date.parse(post.publishedAt) + 60000
    ? post.record.updatedAt as string
    : '';
  const latestUpdateAt = updateEntries[0]?.at || recordUpdatedAt;
  const updateNote = updateEntries[0]?.note
    || (typeof post.record?.updateNote === 'string' ? post.record.updateNote : '');
  // Byline + latest-update stamp share one muted line; multi-update
  // history stays in a collapsible <details> underneath.
  const bylineParts = [
    bylineLinks.length
      ? `Written by ${bylineLinks.join(' and ')} on ${formatDate(post.publishedAt)}`
      : '',
    latestUpdateAt
      ? `<i class="fa-solid fa-rotate" aria-hidden="true"></i> Updated ${escapeHtml(formatDateTime(latestUpdateAt))}${updateNote ? ` — ${escapeHtml(updateNote)}` : ''}`
      : '',
  ].filter(Boolean);
  const bylineHtml = bylineParts.length
    ? `<p class="article__byline">${bylineParts.join('<span class="article__byline-sep"> · </span>')}</p>`
    : '';
  const updatesHtml = updateEntries.length > 1
    ? `<details class="article__history"><summary>Update history (${updateEntries.length})</summary><ul>${updateEntries.map((entry) => `<li><time datetime="${escapeHtml(entry.at)}">${escapeHtml(formatDateTime(entry.at))}</time>${entry.note ? ` — ${escapeHtml(entry.note)}` : ''}</li>`).join('')}</ul></details>`
    : '';
  const readingTime = readingTimeMinutes(post.content || '', post.mimeType);
  const safeTitle = escapeHtml(post.title);
  const safeDescription = escapeHtml(articleSubtitle);
  const pageOrigin = new URL(pageUrl).origin;
  const ogImage = post.cover
    ? proxyImageUrl(post.cover, pageOrigin)
    : browserRunScreenshotUrl(post.path);
  const proxiedCoverImage = post.cover ? escapeHtml(proxyImageUrl(post.cover, pds, 'wide_medium')) : undefined;
  const proxiedCoverSrcSet = post.cover
    ? `${escapeHtml(proxyImageUrl(post.cover, pds, 'wide_small'))} 640w, ${escapeHtml(proxyImageUrl(post.cover, pds, 'wide_medium'))} 1280w`
    : undefined;
  const recommendationHtml = recommendations.map((item) => {
    const dek = typeof item.description === 'string' ? item.description.trim() : '';
    const dekExcerpt = dek.length > 125 ? `${dek.slice(0, 122).trimEnd()}…` : dek;
    return `
    <article class="recommendation-card${item.cover ? '' : ' recommendation-card--no-cover'}">
      ${item.cover ? `<a class="recommendation-card__image" href="${escapeHtml(item.path)}" aria-label="Read ${escapeHtml(item.title || 'Untitled')}">
        <img src="${escapeHtml(proxyImageUrl(item.cover, pds, 'feed_small'))}" alt="" class="story-image" width="600" height="340" loading="lazy" decoding="async">
      </a>` : ''}
      <div class="recommendation-card__body"><h3><a href="${escapeHtml(item.path)}">${escapeHtml(item.title || 'Untitled')}</a></h3>
        ${dekExcerpt ? `<p>${escapeHtml(dekExcerpt)}</p>` : ''}
        <span class="recommendation-card__date">${formatDate(item.publishedAt)}</span>
      </div>
    </article>`;
  }).join('');
  const relatedRail = recommendations.map((item) => `
    <li><a href="${escapeHtml(item.path)}">${escapeHtml(item.title || 'Untitled')}</a></li>`).join('');
  const authorsByDid = new Map<string, NonNullable<typeof allPosts[number]['author']>>();
  listedPosts.forEach((item) => {
    if (item.author) authorsByDid.set(item.author.did, item.author);
  });
  const railAuthors = [...authorsByDid.values()]
    .sort((a, b) => (a.displayName || a.handle).localeCompare(b.displayName || b.handle))
    .slice(0, 6)
    .map((author) => `<li><a class="article-rail__author" href="/author/${encodeURIComponent(author.handle)}">${author.avatar ? `<img src="${escapeHtml(proxyAvatarUrl(author.avatar, 'avatar_thumb'))}" alt="" width="36" height="36" loading="lazy">` : '<span class="article-rail__author-placeholder" aria-hidden="true"></span>'}<span><strong data-author-verification-did="${escapeHtml(author.did)}">${escapeHtml(author.displayName || author.handle)}</strong><small>@${escapeHtml(author.handle)}</small></span></a></li>`)
    .join('');
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: post.title,
    description: articleSubtitle || undefined,
    datePublished: post.publishedAt,
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    image: [ogImage],
    author: [
      ...(post.author
        ? [{
            '@type': 'Person',
            name: authorName,
            url: `${pageOrigin}/author/${encodeURIComponent(post.author.handle)}`,
          }]
        : []),
      ...coAuthors.map((coAuthor) => ({
        '@type': 'Person',
        name: coAuthor.displayName || coAuthor.handle,
        url: `${pageOrigin}/author/${encodeURIComponent(coAuthor.handle)}`,
      })),
      ...(post.author ? [] : [{ '@type': 'Organization', name: c.env.PUB_NAME }]),
    ],
    publisher: {
      '@type': 'Organization',
      name: c.env.PUB_NAME,
      url: pageOrigin,
      logo: { '@type': 'ImageObject', url: `${pageOrigin}/favicon.png` },
    },
  };
  const structuredDataJson = JSON.stringify(structuredData).replace(/</g, '\\u003c');
  const sourceLabel = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };
  const sourcesHtml = postMetadata && (postMetadata.sources.length || postMetadata.backlink)
    ? `<section class="article-sources" aria-labelledby="article-sources-title">
        <h2 id="article-sources-title">Sources</h2>
        <ul>${postMetadata.sources.map((source) => `
          <li><a href="${escapeHtml(externalLinkUrl(source))}" target="_blank" rel="noopener">${escapeHtml(sourceLabel(source))} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a></li>`).join('')}
          ${postMetadata.backlink ? `<li><a href="${escapeHtml(externalLinkUrl(postMetadata.backlink.startsWith('at://') ? `https://pdsls.dev/${postMetadata.backlink}` : postMetadata.backlink))}" target="_blank" rel="noopener">${postMetadata.backlink.startsWith('at://') ? 'Original document' : `Source document · ${escapeHtml(sourceLabel(postMetadata.backlink))}`} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a></li>` : ''}
        </ul>
      </section>`
    : '';
  const shareUrl = encodeURIComponent(pageUrl);
  const shareText = encodeURIComponent(post.title);
  const engagementHtml = `
    <section class="article-engagement" data-reaction-subject="${escapeHtml(post.uri)}" data-view-subject="${escapeHtml(post.uri)}" aria-label="Story reactions and views">
      <div class="article-reactions__buttons" aria-label="React to this story">
        <span class="reaction-button engagement-stat"><i class="fa-solid fa-book-open" aria-hidden="true"></i> Reads <span class="reaction-count" data-at-view-count>—</span></span>
        <button type="button" class="reaction-button" data-reaction="like" aria-pressed="false"><i class="fa-regular fa-thumbs-up" aria-hidden="true"></i> Like <span class="reaction-count" data-reaction-count="like">—</span></button>
        <button type="button" class="reaction-button" data-reaction="dislike" aria-pressed="false"><i class="fa-regular fa-thumbs-down" aria-hidden="true"></i> Dislike <span class="reaction-count" data-reaction-count="dislike">—</span></button>
        <button type="button" class="reaction-button" data-save-post aria-pressed="false"><i class="fa-regular fa-bookmark" aria-hidden="true"></i> Save <span class="reaction-count" data-save-count>—</span></button>
        <button type="button" class="reaction-button" data-add-to-list><i class="fa-regular fa-rectangle-list" aria-hidden="true"></i> Add to list</button>
        <a class="reaction-button" href="#comments"><i class="fa-regular fa-comment" aria-hidden="true"></i> Comments <span class="reaction-count" data-at-comment-count>—</span></a>
      </div>
      <div class="article-share" data-share-title="${safeTitle}" data-share-url="${escapeHtml(pageUrl)}">
        <span class="article-share__label">Share this story</span>
        <div class="article-share__buttons" aria-label="Share this story">
          <a class="reaction-button" href="https://app.coffeencode.cc/intent?text=${shareText}%20${shareUrl}" target="_blank" rel="noopener" aria-label="Share on Bluesky"><i class="fa-brands fa-bluesky" aria-hidden="true"></i> Bluesky</a>
          <a class="reaction-button" href="https://www.reddit.com/submit?url=${shareUrl}&title=${shareText}" target="_blank" rel="noopener" aria-label="Share on Reddit"><i class="fa-brands fa-reddit-alien" aria-hidden="true"></i> Reddit</a>
          <a class="reaction-button" href="https://www.threads.net/intent/post?text=${shareText}%20${shareUrl}" target="_blank" rel="noopener" aria-label="Share on Threads"><i class="fa-brands fa-threads" aria-hidden="true"></i> Threads</a>
          <a class="reaction-button" href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" rel="noopener" aria-label="Share on Facebook"><i class="fa-brands fa-facebook-f" aria-hidden="true"></i> Facebook</a>
          <button type="button" class="reaction-button" data-share-native hidden><i class="fa-solid fa-share-nodes" aria-hidden="true"></i> Share</button>
          <button type="button" class="reaction-button" data-share-copy><i class="fa-solid fa-link" aria-hidden="true"></i> Copy link</button>
        </div>
      </div>
      <span class="article-reactions__status" aria-live="polite"></span>
    </section>`;
  const articleMetaTags = `
    ${post.scheduled ? '<meta name="robots" content="noindex">' : ''}
    <link rel="site.standard.document" href="${escapeHtml(post.uri)}">
    <link rel="site.standard.publication" href="at://did:plc:l37td5yhxl2irrzrgvei4qay/site.standard.publication/3m3lav73ujc27">
    <meta name="atproto:uri" content="${escapeHtml(post.uri)}">
    <meta name="atproto:repo" content="${escapeHtml(post.repoDid || c.env.OWNER_DID)}">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta name="description" content="${safeDescription}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${escapeHtml(pageUrl)}">
    <meta property="og:image" content="${escapeHtml(ogImage)}">
    <meta property="og:image:type" content="${post.cover ? 'image/jpeg' : 'image/png'}">
    <meta property="article:published_time" content="${escapeHtml(post.publishedAt)}">
    ${latestUpdateAt ? `<meta property="article:modified_time" content="${escapeHtml(latestUpdateAt)}">` : ''}
    <meta property="article:author" content="${escapeHtml(authorName || c.env.PUB_NAME)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTitle}">
    <meta name="twitter:description" content="${safeDescription}">
    <meta name="twitter:image" content="${escapeHtml(ogImage)}">
    <link rel="canonical" href="${escapeHtml(pageUrl)}">
    <script type="application/ld+json">${structuredDataJson}</script>
  `;

  const scheduledBanner = post.scheduled
    ? `<p class="article-banner"><i class="fa-regular fa-clock" aria-hidden="true"></i> Scheduled — this story goes live ${formatDateTime(post.publishedAt)}. It isn't publicly listed yet; anyone with this link can preview it.</p>`
    : '';

  const body = `
    <style>
      .article-banner { background: var(--paper-deep); border: 1px solid var(--line-strong); color: var(--muted); font-size: 14px; margin: 0 0 22px; padding: 12px 16px; }
      .article-banner i { color: var(--accent); margin-right: 8px; }
      .article__byline { color: var(--muted); font-size: 14px; margin: 14px 0 0; }
      .article__byline .article__author { display: inline; font-size: inherit; font-weight: 600; gap: 0; margin-top: 0; }
      .article__byline .article__author-avatar { display: inline-block; height: 20px; margin: 0 5px 0 1px; vertical-align: -4px; width: 20px; }
      .article__byline .fa-rotate { margin-right: 4px; }
      .article__byline-sep { color: var(--muted); }
      .article__history { color: var(--muted); font-size: 14px; margin-top: 8px; }
      .article__history summary { color: var(--accent); cursor: pointer; }
      .article__history ul { margin: 8px 0 0; padding-left: 20px; }
      .article__history li { margin-bottom: 4px; }
    </style>
    ${readingProgressHtml(post.uri)}
    <div class="article-layout">
    <article class="article">
      <a href="/" class="article__back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> All stories</a>
      ${scheduledBanner}
      <header class="article__header">
        <h1>${safeTitle}</h1>
        ${articleSubtitle ? `<p class="article__dek">${escapeHtml(articleSubtitle)}</p>` : ''}
        ${bylineHtml}
        ${updatesHtml}
        ${readingTime ? `<p class="article__reading-time">${readingTime} min read</p>` : ''}
        ${tagLinks ? `<nav class="article-tags" aria-label="Article tags">${tagLinks}</nav>` : ''}
      </header>
      ${proxiedCoverImage ? `<figure class="article__cover"><img src="${proxiedCoverImage}" srcset="${proxiedCoverSrcSet}" alt="" class="story-image" width="1200" height="667" sizes="(max-width: 860px) 100vw, 820px" fetchpriority="high" decoding="async"></figure>` : ''}
      <div class="prose">${htmlContent}</div>
      <section class="article__comments" id="comments">
        <sequoia-comments document-uri="${escapeHtml(post.uri)}" style="--sequoia-fg-color: var(--ink); --sequoia-bg-color: var(--paper-deep); --sequoia-border-color: var(--line); --sequoia-accent-color: var(--accent); --sequoia-secondary-color: var(--muted); --sequoia-border-radius: 0;"></sequoia-comments>
      </section>
      <dialog class="list-dialog" data-list-dialog aria-labelledby="list-dialog-title">
        <h2 id="list-dialog-title">Add to a list</h2>
        <p class="list-dialog__status" data-list-dialog-status role="status" aria-live="polite">Loading your lists…</p>
        <ul class="list-dialog__lists" data-list-dialog-lists></ul>
        <p class="list-dialog__empty" data-list-dialog-empty hidden>You have no lists yet. <a href="/account/list">Create a list</a> first, then add this story to it.</p>
        <div class="list-dialog__actions"><button type="button" class="auth-signout" data-list-dialog-close>Done</button></div>
      </dialog>
      <footer class="article__footer">
        <a href="${escapeHtml(externalLinkUrl(`https://pdsls.dev/${post.uri}`))}" target="_blank" rel="noopener">View on PDSls <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
      </footer>
    </article>
    <aside class="article-rail" aria-label="Story details">${engagementHtml}${sourcesHtml}${relatedRail ? `<section aria-labelledby="article-related-title"><h2 id="article-related-title">Related posts</h2><ul>${relatedRail}</ul><a href="/tags" class="read-link">Explore all tags <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></section>` : ''}${railAuthors ? `<section class="article-rail__authors" aria-labelledby="article-authors-title"><h2 id="article-authors-title">Authors</h2><ul>${railAuthors}</ul><a href="/authors" class="read-link">Meet all authors <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></section>` : ''}</aside>
    </div>
    ${recommendations.length ? `<section class="recommendations" aria-labelledby="recommendations-title"><div class="section-heading"><span id="recommendations-title">Continue reading</span><a href="/archive">All stories <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div><div class="recommendations__grid">${recommendationHtml}</div></section>` : ''}
  `;

  return c.html(renderLayout(c, post.title, body, articleMetaTags, undefined, browserRun, { comments: true }));
}

// Unpublished-draft preview: renders a cc.coffeencode.author.draft record from
// the author's repository. Draft records are public on the PDS, so the link —
// an unguessable TID — is what you share for review. The page is noindexed.
async function renderDraftPreview(c: Context<{ Bindings: Env }>, did: string, rkey: string) {
  const notFound = () => c.html(renderLayout(c, 'Draft not found', `
    <section class="not-found">
      <h1>Draft not found</h1>
      <p>This draft preview link is invalid, or the draft has been deleted.</p>
      <div class="not-found__actions">
        <a href="/" class="read-link">Back to publication <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
      </div>
    </section>
  `), 404);

  if (!/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did) || !/^[a-zA-Z0-9._~:-]{1,512}$/.test(rkey)) {
    return notFound();
  }
  const pds = await getPdsEndpoint(did, c.env.OWNER_PDS);
  const record = await fetchRecord(pds, did, 'cc.coffeencode.author.draft', rkey);
  const value = record?.value;
  if (!value || typeof value !== 'object') return notFound();

  const document = (value.document || {}) as Record<string, unknown>;
  const title = (typeof value.title === 'string' && value.title.trim() ? value.title : '')
    || (typeof document.title === 'string' && document.title.trim() ? document.title : '')
    || 'Untitled draft';
  const description = typeof value.description === 'string' && value.description.trim()
    ? value.description.trim()
    : typeof document.description === 'string' ? document.description.trim() : '';
  const pages = Array.isArray(document.pages) ? document.pages : [];
  const content = JSON.stringify({ $type: 'pub.leaflet.content', pages });
  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const requestOrigin = new URL(c.req.url).origin;
  const processImageSource = (source: string) => {
    if (source.startsWith('/api/blob/')) {
      const cid = source.replace(/^\/api\/blob\//, '');
      const blobUrl = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
      return proxyImageUrl(blobUrl, requestOrigin);
    }
    return proxyImageUrl(source, requestOrigin);
  };
  const renderedContent = await renderContent(content, undefined, 'application/json');
  const htmlContent = routeExternalLinks(enhanceHtmlStructure(processImages(renderedContent, processImageSource)));
  const readingTime = readingTimeMinutes(content, 'application/json');
  const author = await fetchAuthorProfile(did, pds).catch(() => undefined);
  const coverCid = (document.coverImage as { ref?: { $link?: string } } | undefined)?.ref?.$link;
  const coverUrl = coverCid
    ? proxyImageUrl(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(coverCid)}`, pds, 'wide_medium')
    : undefined;
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt
    : typeof value.createdAt === 'string' ? value.createdAt : '';
  const scheduledAt = typeof value.publishedAt === 'string' && Date.parse(value.publishedAt) > Date.now()
    ? value.publishedAt
    : undefined;

  const body = `
    <style>
      .article-banner { background: var(--paper-deep); border: 1px solid var(--line-strong); color: var(--muted); font-size: 14px; margin: 0 0 22px; padding: 12px 16px; }
      .article-banner i { color: var(--accent); margin-right: 8px; }
    </style>
    ${readingProgressHtml(`draft:${did}/${rkey}`)}
    <article class="article">
      <a href="/" class="article__back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(c.env.PUB_NAME)}</a>
      <p class="article-banner"><i class="fa-regular fa-eye" aria-hidden="true"></i> Draft preview — this story isn't published yet. Anyone with this link can view it.${scheduledAt ? ` It is scheduled to publish ${escapeHtml(formatDateTime(scheduledAt))}.` : ''}</p>
      <header class="article__header">
        <h1>${escapeHtml(title)}</h1>
        ${description ? `<p class="article__dek">${escapeHtml(description)}</p>` : ''}
        ${author ? `<span class="article__author"><span>Drafted by <span data-author-verification-did="${escapeHtml(author.did)}">${escapeHtml(author.displayName || author.handle)}</span>${updatedAt ? ` · updated ${escapeHtml(formatDateTime(updatedAt))}` : ''}</span></span>` : ''}
        ${readingTime ? `<p class="article__reading-time">${readingTime} min read</p>` : ''}
      </header>
      ${coverUrl ? `<figure class="article__cover"><img src="${escapeHtml(coverUrl)}" alt="" class="story-image" width="1200" height="667" fetchpriority="high" decoding="async"></figure>` : ''}
      <div class="prose">${htmlContent}</div>
    </article>
  `;
  const metaTags = `
    <meta name="robots" content="noindex">
    <meta name="description" content="${escapeHtml(description || `Draft preview of ${title}`)}">
  `;
  return c.html(renderLayout(c, `${title} — draft preview`, body, metaTags));
}

posts.get('/', (c) => c.redirect('/'));
posts.get('/preview/draft/:did/:rkey', (c) => renderDraftPreview(c, c.req.param('did'), c.req.param('rkey')));
posts.get('/post/:rkey', (c) => renderPost(c, c.req.param('rkey')));
// Author-scoped post URLs are canonical; legacy /post/... routes redirect here.
posts.get('/author/:handle/:rkey', (c) => renderPost(
  c,
  c.req.param('rkey'),
  c.req.param('handle'),
));
posts.get('/post/:handle/:rkey', (c) => renderPost(
  c,
  c.req.param('rkey'),
  c.req.param('handle'),
));
posts.get('/:rkey', (c) => renderPost(c, c.req.param('rkey'), undefined, new URL(c.req.url).pathname));
posts.get('/:handle/:rkey', (c) => renderPost(
  c,
  c.req.param('rkey'),
  c.req.param('handle'),
  new URL(c.req.url).pathname,
));
posts.get('/*', (c) => {
  const path = new URL(c.req.url).pathname;
  const rkey = path.split('/').filter(Boolean).at(-1);
  if (!rkey) return c.notFound();
  return renderPost(c, decodeURIComponent(rkey), undefined, path);
});

export default posts;
