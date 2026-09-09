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
  const [heroPost, ...otherPosts] = posts;
  const sidePosts = otherPosts.slice(0, 3);
  const archivePosts = otherPosts.slice(3);

  const heroHtml = heroPost
    ? `
      <article class="lead-story">
        <a class="lead-image${heroPost.cover ? '' : ' lead-image--placeholder'}" href="${heroPost.path}" aria-label="Read ${heroPost.title || 'Untitled'}">
          ${heroPost.cover ? `<img src="${heroPost.cover}" alt="" class="story-image">` : '<span>Latest dispatch</span>'}
        </a>
        <div class="lead-story__content">
          <p class="eyebrow">Most recent</p>
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
    <section class="publication-intro">
      <p class="eyebrow">Independent technology journal</p>
      <h1>${c.env.PUB_NAME}</h1>
      <p>${c.env.PUB_DESCRIPTION}</p>
    </section>

    <section class="front-page" aria-label="Latest stories">
      <div class="section-heading"><span>Latest</span><span>${posts.length} ${posts.length === 1 ? 'story' : 'stories'}</span></div>
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
  `;

  return c.html(renderLayout(c, 'Home', body));
});

export default home;
