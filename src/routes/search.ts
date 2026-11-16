import { Hono } from 'hono';
import { Env } from '../types';
import { StandardDocument } from '../types';
import { fetchArticles, getPdsEndpoint } from '../lib/atproto';
import { toPlainText } from '../lib/contentRenderer';
import { highlightTerms, rankSearch, searchSnippet } from '../lib/search';
import { fetchModerations, getForumConfig, listForumPosts, moderationStates, type ForumPost } from './forum';
import { renderLayout } from '../templates/layout';
import { escapeHtml, renderSearchBar } from '../templates/searchBar';

const search = new Hono<{ Bindings: Env }>();

const resultLimit = 50;

function formatDate(value?: string) {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function storyFields(article: StandardDocument) {
  return [
    { text: article.title, weight: 6 },
    { text: article.description, weight: 4 },
    { text: (article.tags || []).join(' '), weight: 4 },
    { text: `${article.author?.displayName || ''} ${article.author?.handle || ''}`, weight: 3 },
    { text: article.content, weight: 1 },
  ];
}

function forumFields(post: ForumPost) {
  return [
    { text: post.title, weight: 6 },
    { text: post.tags.join(' '), weight: 4 },
    { text: `${post.name} ${post.handle}`, weight: 3 },
    { text: post.content, weight: 1 },
  ];
}

function storyResult(article: StandardDocument, query: string) {
  const author = article.author?.displayName || article.author?.handle || '';
  const byline = [author, formatDate(article.publishedAt)].filter(Boolean).join(' · ');
  const snippet = article.description?.trim() || searchSnippet(toPlainText(article.content || ''), query);
  return `<article class="search-result">
      <p class="eyebrow">${escapeHtml(byline)}</p>
      <h3><a href="${escapeHtml(article.path)}">${highlightTerms(article.title || 'Untitled', query)}</a></h3>
      ${snippet ? `<p>${highlightTerms(snippet, query)}</p>` : ''}
    </article>`;
}

function forumResult(post: ForumPost, query: string) {
  const byline = [post.name || post.handle, formatDate(post.createdAt)].filter(Boolean).join(' · ');
  const snippet = searchSnippet(post.content, query);
  return `<article class="search-result">
      <p class="eyebrow">${escapeHtml(byline)}${post.tags.length ? ` · ${escapeHtml(post.tags.join(', '))}` : ''}</p>
      <h3><a href="/forum/${encodeURIComponent(post.handle)}/${encodeURIComponent(post.rkey)}">${highlightTerms(post.title, query)}</a></h3>
      ${snippet ? `<p>${highlightTerms(snippet, query)}</p>` : ''}
    </article>`;
}

search.get('/', async (c) => {
  const query = (c.req.query('q') || '').trim().slice(0, 200);
  const scopeParam = c.req.query('scope');
  const scope = scopeParam === 'stories' || scopeParam === 'forum' ? scopeParam : 'all';
  const pds = await getPdsEndpoint(c.env.OWNER_DID, c.env.OWNER_PDS);

  let stories: StandardDocument[] = [];
  let forumPosts: ForumPost[] = [];
  let storiesFailed = false;
  let forumFailed = false;

  if (query) {
    const jobs: Promise<void>[] = [];
    if (scope !== 'forum') {
      jobs.push(fetchArticles(pds, c.env.OWNER_DID)
        .then((articles) => { stories = rankSearch(articles, query, storyFields); })
        .catch((error) => {
          storiesFailed = true;
          console.error('Story search failed:', error);
        }));
    }
    if (scope !== 'stories') {
      jobs.push((async () => {
        const config = await getForumConfig(pds);
        if (!config) return;
        const [posts, moderations] = await Promise.all([
          listForumPosts(config, pds),
          fetchModerations(config, pds),
        ]);
        const states = moderationStates(moderations);
        forumPosts = rankSearch(posts.filter((post) => !states.get(post.uri)?.hidden), query, forumFields);
      })().catch((error) => {
        forumFailed = true;
        console.error('Forum search failed:', error);
      }));
    }
    await Promise.all(jobs);
  }

  const storyRows = stories.slice(0, resultLimit).map((article) => storyResult(article, query)).join('');
  const forumRows = forumPosts.slice(0, resultLimit).map((post) => forumResult(post, query)).join('');
  const totalResults = stories.length + forumPosts.length;

  const storySection = scope !== 'forum' ? `
      <div class="section-heading"><span>Stories</span><span>${storiesFailed ? 'unavailable' : stories.length}</span></div>
      ${storiesFailed ? '<p class="empty-state">Stories could not be searched right now. Please try again later.</p>'
        : storyRows ? `<div class="search-results">${storyRows}</div>` : '<p class="empty-state">No stories match this search.</p>'}` : '';
  const forumSection = scope !== 'stories' ? `
      <div class="section-heading"><span>Discussions</span><span>${forumFailed ? 'unavailable' : forumPosts.length}</span></div>
      ${forumFailed ? '<p class="empty-state">Forum discussions could not be searched right now. Please try again later.</p>'
        : forumRows ? `<div class="search-results">${forumRows}</div>` : '<p class="empty-state">No discussions match this search.</p>'}` : '';

  const body = `
    <section class="search-page" aria-labelledby="search-title">
      <h1 id="search-title" class="visually-hidden">Search</h1>
      ${renderSearchBar({
        action: '/search',
        label: 'Search the publication',
        placeholder: 'Search stories and discussions',
        query,
        className: 'search-page__bar',
        selects: [{
          name: 'scope',
          label: 'In',
          value: scope,
          defaultValue: 'all',
          options: [
            { value: 'all', label: 'Everything' },
            { value: 'stories', label: 'Stories' },
            { value: 'forum', label: 'Forum' },
          ],
        }],
      })}
      ${!query ? '<p class="empty-state">Search across every story and forum discussion on the publication.</p>'
        : totalResults === 0 && !storiesFailed && !forumFailed
          ? `<p class="empty-state">Nothing matched <strong>${escapeHtml(query)}</strong>. Try different or fewer words.</p>${storySection}${forumSection}`
          : `${storySection}${forumSection}`}
    </section>`;

  const metaTags = `
    <meta name="description" content="Search stories and forum discussions on ${escapeHtml(c.env.PUB_NAME || 'Coffee and Code')}.">
    <meta name="robots" content="noindex">
  `;
  return c.html(renderLayout(c, query ? `Search: ${query}` : 'Search', body, metaTags));
});

export default search;
