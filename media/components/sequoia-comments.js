const styles = `
:host { display: block; color: var(--sequoia-fg-color, #1f2937); font-family: var(--sequoia-font-family, system-ui, sans-serif); line-height: 1.5; }
* { box-sizing: border-box; }
.comments-header { align-items: center; display: flex; gap: 1rem; justify-content: space-between; margin-bottom: 1rem; }
.comments-title { font-size: 1.125rem; margin: 0; }
.comments-actions { display: flex; gap: .5rem; }
.reply-button { background: var(--sequoia-accent-color, #2563eb); border-radius: var(--sequoia-border-radius, 8px); color: #fff; font-size: .875rem; padding: .5rem .75rem; text-decoration: none; }
.reply-button:hover { filter: brightness(.88); }
.status { border: 1px solid var(--sequoia-border-color, #e5e7eb); border-radius: var(--sequoia-border-radius, 8px); color: var(--sequoia-secondary-color, #6b7280); padding: 1rem; text-align: center; }
.comments-list { display: grid; gap: 1rem; }
.comment { border-top: 1px solid var(--sequoia-border-color, #e5e7eb); display: flex; gap: .75rem; padding-top: 1rem; }
.avatar, .avatar-placeholder { background: var(--sequoia-border-color, #e5e7eb); border-radius: 50%; flex: 0 0 2.5rem; height: 2.5rem; object-fit: cover; width: 2.5rem; }
.avatar-placeholder { align-items: center; color: var(--sequoia-secondary-color, #6b7280); display: flex; font-weight: 600; justify-content: center; }
.comment-content { min-width: 0; }
.comment-meta { align-items: baseline; display: flex; flex-wrap: wrap; gap: .5rem; }
.author { color: var(--sequoia-fg-color, #1f2937); font-weight: 600; text-decoration: none; }
.handle, .time { color: var(--sequoia-secondary-color, #6b7280); font-size: .875rem; }
.time { text-decoration: none; }
.comment-text { margin: .25rem 0 0; white-space: pre-wrap; word-break: break-word; }
`; 

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value ?? '';
  return element.innerHTML;
}

function parseAtUri(uri) {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(uri);
  return match ? { did: match[1], collection: match[2], rkey: match[3] } : null;
}

async function resolvePds(did) {
  const response = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
  if (!response.ok) throw new Error('Unable to resolve author');
  const data = await response.json();
  const service = data.service?.find((item) => item.id === '#atproto_pds' || item.type === 'AtprotoPersonalDataServer');
  if (!service?.serviceEndpoint) throw new Error('Author has no PDS');
  return service.serviceEndpoint;
}

async function getDocument(uri) {
  const parsed = parseAtUri(uri);
  if (!parsed) throw new Error('Invalid document URI');
  const pds = await resolvePds(parsed.did);
  const url = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
  url.searchParams.set('repo', parsed.did);
  url.searchParams.set('collection', parsed.collection);
  url.searchParams.set('rkey', parsed.rkey);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to load document');
  return response.json();
}

async function getThread(uri, depth) {
  const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread');
  url.searchParams.set('uri', uri);
  url.searchParams.set('depth', String(depth));
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to load comments');
  const data = await response.json();
  if (data.thread?.$type !== 'app.bsky.feed.defs#threadViewPost') throw new Error('Post not found');
  return data.thread;
}

function appUrl(uri) {
  const parsed = parseAtUri(uri);
  return parsed ? `https://bsky.app/profile/${parsed.did}/post/${parsed.rkey}` : '#';
}

function formatTime(value) {
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  return days < 1 ? 'today' : days < 30 ? `${days}d ago` : date.toLocaleDateString();
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

class SequoiaComments extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${styles}</style><div></div>`;
    this.container = this.shadowRoot.lastElementChild;
  }

  connectedCallback() {
    this.load();
  }

  async load() {
    this.container.innerHTML = '<div class="status">Loading comments...</div>';
    try {
      const documentUri = this.getAttribute('document-uri') || document.querySelector('link[rel="site.standard.document"]')?.getAttribute('href');
      if (!documentUri) return this.show('Comments are not available for this post.');
      const record = this.getAttribute('post-uri') ? { bskyPostRef: { uri: this.getAttribute('post-uri') } } : await getDocument(documentUri);
      const postUri = record.value?.bskyPostRef?.uri || record.bskyPostRef?.uri;
      if (!postUri) return this.show('Comments are not enabled for this post.');
      const thread = await getThread(postUri, Number(this.getAttribute('depth') || 6));
      const replies = (thread.replies || []).filter((reply) => reply?.$type === 'app.bsky.feed.defs#threadViewPost');
      this.renderComments(postUri, replies);
    } catch (error) {
      this.show(error instanceof Error ? error.message : 'Unable to load comments.');
    }
  }

  show(message) {
    this.container.innerHTML = `<div class="status">${escapeHtml(message)}</div>`;
  }

  renderComments(postUri, replies) {
    const comments = replies.map((reply) => this.renderReply(reply)).join('');
    this.container.innerHTML = `<div class="comments-header"><h2 class="comments-title">Comments${replies.length ? ` (${replies.length})` : ''}</h2><div class="comments-actions"><a class="reply-button" href="${appUrl(postUri)}" target="_blank" rel="noopener noreferrer">Reply on Bluesky</a></div></div>${comments ? `<div class="comments-list">${comments}</div>` : '<div class="status">No comments yet. Be the first to reply on Bluesky.</div>'}`;
  }

  renderReply(reply) {
    const author = reply.post.author;
    const name = author.displayName || author.handle;
    const avatar = author.avatar ? `<img class="avatar" src="${escapeHtml(author.avatar)}" alt="${escapeHtml(name)}" loading="lazy">` : `<div class="avatar-placeholder">${escapeHtml(initials(name))}</div>`;
    const text = escapeHtml(reply.post.record?.text || '');
    const nested = (reply.replies || []).filter((item) => item?.$type === 'app.bsky.feed.defs#threadViewPost').map((item) => this.renderReply(item)).join('');
    return `<article class="comment">${avatar}<div class="comment-content"><div class="comment-meta"><a class="author" href="https://bsky.app/profile/${encodeURIComponent(author.did)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a><span class="handle">@${escapeHtml(author.handle)}</span><a class="time" href="${appUrl(reply.post.uri)}" target="_blank" rel="noopener noreferrer">${formatTime(reply.post.record?.createdAt)}</a></div><p class="comment-text">${text}</p>${nested ? `<div class="comments-list">${nested}</div>` : ''}</div></article>`;
  }
}

if (!customElements.get('sequoia-comments')) customElements.define('sequoia-comments', SequoiaComments);
