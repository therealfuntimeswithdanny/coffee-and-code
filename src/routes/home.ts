import { Hono } from 'hono';
import { Env, StandardDocument } from '../types';
import { getPdsEndpoint, fetchArticles } from '../lib/atproto';
import { renderLayout } from '../templates/layout';

const home = new Hono<{ Bindings: Env }>();

function formatDate(date?: string) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function excerpt(post: StandardDocument, length = 180) {
  const text = post.description || post.content || '';
  return text.length > length ? `${text.substring(0, length).trimEnd()}…` : text;
}

function articleMeta(post: StandardDocument) {
  return `<span class="article-meta">${formatDate(post.publishedAt)}</span>`;
}

home.get('/', async (c) => {
  const pds = await getPdsEndpoint(c.env.AUTHOR_DID, c.env.DEFAULT_PDS);
  const posts = await fetchArticles(c.env.AUTHOR_DID, pds);
  const requestedPage = Number.parseInt(c.req.query('page') || '1', 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = 10;
  const startIndex = (page - 1) * pageSize;
  const pagePosts = posts.slice(startIndex, startIndex + pageSize);
  const [heroPost, ...otherPosts] = pagePosts;
  const sidePosts = otherPosts.slice(0, 3);
  const archivePosts = otherPosts.slice(3);
  const displayedStart = pagePosts.length ? startIndex + 1 : 0;
  const displayedEnd = startIndex + pagePosts.length;

  const heroHtml = heroPost
    ? `
      <article class="lead-story">
        <a class="lead-image${heroPost.cover ? '' : ' lead-image--placeholder'}" href="${heroPost.path}" aria-label="Read ${heroPost.title || 'Untitled'}">
          ${heroPost.cover ? `<img src="${heroPost.cover}" alt="" class="story-image">` : '<span>Latest dispatch</span>'}
        </a>
        <div class="lead-story__content">
          <p class="eyebrow">${page === 1 ? 'Most recent' : 'More stories'}</p>
          <h2><a href="${heroPost.path}">${heroPost.title || 'Untitled'}</a></h2>
          <p class="lead-story__summary">${excerpt(heroPost, 260)}</p>
          <div class="story-footer">${articleMeta(heroPost)} <a href="${heroPost.path}" class="read-link">Read story <span aria-hidden="true">→</span></a></div>
        </div>
      </article>`
    : '<p class="empty-state">No stories have been published yet. Please check back soon.</p>';

  const sideHtml = sidePosts.length
    ? sidePosts
        .map(
          (post) => `
            <article class="side-story">
              ${post.cover ? `<a class="side-story__image" href="${post.path}" aria-label="Read ${post.title || 'Untitled'}"><img src="${post.cover}" alt="" class="story-image"></a>` : ''}
              <div>
                <p class="eyebrow">Recent story</p>
                <h3><a href="${post.path}">${post.title || 'Untitled'}</a></h3>
                ${articleMeta(post)}
              </div>
            </article>`
        )
        .join('')
    : '<p class="side-empty">More reporting is on its way.</p>';

  const archiveHtml = archivePosts
    .map(
      (post) => `
        <article class="archive-story">
          <div>
            <p class="eyebrow">From the archive</p>
            <h3><a href="${post.path}">${post.title || 'Untitled'}</a></h3>
            <p>${excerpt(post, 130)}</p>
          </div>
          <div class="archive-story__footer">${articleMeta(post)} <a href="${post.path}" class="read-link">Read <span aria-hidden="true">→</span></a></div>
        </article>`
    )
    .join('');

  const body = `
    <section class="front-page" aria-label="${page === 1 ? 'Latest stories' : 'More stories'}">
      <div class="section-heading"><span>${page === 1 ? 'Latest stories' : 'More stories'}</span><span>${displayedStart ? `Showing ${displayedStart}–${displayedEnd} of ${posts.length}` : 'No stories'}</span></div>
      <div class="front-page__grid">
        ${heroHtml}
        <aside class="recent-stories" aria-label="More recent stories">
          <div class="recent-stories__heading">Also new</div>
          ${sideHtml}
        </aside>
      </div>
    </section>

    ${
      archivePosts.length
        ? `<section class="archive-section" aria-label="Earlier stories">
            <div class="section-heading"><span>Earlier stories</span></div>
            <div class="archive-grid">${archiveHtml}</div>
          </section>`
        : ''
    }
    ${
      displayedEnd < posts.length
        ? `<nav class="more-stories" aria-label="More stories"><a class="more-stories__button" href="/?page=${page + 1}">View more stories <span aria-hidden="true">→</span></a></nav>`
        : ''
    }
  `;

  return c.html(renderLayout(c, 'Home', body));
});

export default home;
