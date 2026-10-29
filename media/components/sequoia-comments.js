const styles = `
:host { display:block; color:var(--sequoia-fg-color,#1f2937); font-family:var(--sequoia-font-family,system-ui,sans-serif); line-height:1.5; }
* { box-sizing:border-box; }
.comments-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem; }
.comments-title { margin:0; font-size:1.35rem; letter-spacing:-.02em; }
.comments-intro { margin:.2rem 0 0; color:var(--sequoia-secondary-color,#6b7280); font-size:.9rem; }
.status { border:1px solid var(--sequoia-border-color,#e5e7eb); color:var(--sequoia-secondary-color,#6b7280); padding:1rem; text-align:center; }
.comment-form { display:grid; gap:.5rem; margin:.75rem 0 1rem; }
.comment-input { width:100%; min-height:5rem; padding:.75rem; resize:vertical; color:inherit; background:var(--sequoia-bg-color,#fff); border:1px solid var(--sequoia-border-color,#e5e7eb); border-radius:var(--sequoia-border-radius,8px); font:inherit; }
.comment-input:focus { border-color:var(--sequoia-accent-color,#2563eb); outline:2px solid color-mix(in srgb,var(--sequoia-accent-color,#2563eb) 20%,transparent); }
.comment-submit,.reply-button { border:0; background:var(--sequoia-accent-color,#2563eb); color:#fff; cursor:pointer; font:inherit; padding:.45rem .75rem; }
.comment-submit { justify-self:end; }
.comment-submit:disabled { opacity:.6; cursor:wait; }
.comments-list { display:grid; gap:0; }
.comments-more { justify-self:center; border:1px solid var(--sequoia-border-color,#e5e7eb); background:transparent; color:inherit; cursor:pointer; font:inherit; padding:.5rem .8rem; }
.comments-more:disabled { opacity:.6; cursor:wait; }
.comment { display:grid; grid-template-columns:2.5rem minmax(0,1fr); gap:.75rem; padding:1rem 0; border:0; border-radius:0; background:transparent; }
.comments-list > .comment + .comment { border-top:1px solid var(--sequoia-border-color,#e5e7eb); }
.comment-children { display:grid; gap:0; margin:.75rem 0 0; padding-left:clamp(.6rem,2vw,1rem); border-left:2px solid var(--sequoia-border-color,#e5e7eb); }
.comment-children > .comment { padding:.85rem 0 .25rem; }
.avatar,.avatar-placeholder { width:2.5rem; height:2.5rem; flex:0 0 2.5rem; border-radius:50%; object-fit:cover; background:var(--sequoia-border-color,#e5e7eb); }
.avatar-placeholder { display:flex; align-items:center; justify-content:center; color:var(--sequoia-secondary-color,#6b7280); }
.comment-content { min-width:0; flex:1; }
.comment-meta { display:flex; flex-wrap:wrap; align-items:baseline; gap:.5rem; }
.author { color:inherit; font-weight:600; text-decoration:none; }
.handle,.time { color:var(--sequoia-secondary-color,#6b7280); font-size:.875rem; }
.comment-text { margin:.45rem 0 0; white-space:pre-wrap; overflow-wrap:anywhere; }
.reply-button { margin-top:.4rem; font-size:.875rem; }
.comment-like { margin-top:.4rem; margin-right:.45rem; border:1px solid var(--sequoia-border-color,#e5e7eb); background:transparent; color:inherit; cursor:pointer; font:inherit; font-size:.875rem; padding:.35rem .55rem; }
.comment-like[aria-pressed="true"] { color:var(--sequoia-accent-color,#2563eb); }
.comment-actions { display:flex; flex-wrap:wrap; gap:.5rem; margin-top:.45rem; }
.comment-action { min-height:2rem; border:1px solid var(--sequoia-secondary-color,#6b7280); border-radius:var(--sequoia-border-radius,6px); background:var(--sequoia-bg-color,#fff); color:var(--sequoia-fg-color,#1f2937); cursor:pointer; font:inherit; font-size:.875rem; font-weight:600; padding:.3rem .65rem; }
.comment-action:hover { background:var(--sequoia-border-color,#e5e7eb); }
.comment-action:focus-visible { outline:2px solid var(--sequoia-accent-color,#2563eb); outline-offset:2px; }
.comment-action--danger { border-color:#b42318; color:#b42318; }
.comment-action--danger:hover { background:#fef3f2; }
.comment-action:disabled { opacity:.55; cursor:wait; }
.comment-edit-form { margin-top:.6rem; }
.comment-status { color:var(--sequoia-secondary-color,#6b7280); font-size:.875rem; }
.comment-verification { color:#3897f0; display:inline-block; height:1em; margin-left:.25em; vertical-align:-.12em; width:1em; }
@media (max-width:480px) { .comment { grid-template-columns:2rem minmax(0,1fr); gap:.55rem; padding:.8rem 0; }.avatar,.avatar-placeholder { width:2rem; height:2rem; flex-basis:2rem; }.comment-children { padding-left:.5rem; } }
`;

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value ?? '';
  return element.innerHTML;
}

function formatTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
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
    this.comments = [];
    this.cursor = null;
    this.total = 0;
    this.viewerDid = undefined;
    this.deletedUris = new Set();
    this.pendingEdits = new Map();
    this.loading = false;
    this.refreshTimer = null;
  }

  connectedCallback() { void this.load({ reset: true }); }
  disconnectedCallback() { clearTimeout(this.refreshTimer); }

  async load({ reset = false, quiet = false } = {}) {
    if (this.loading) return;
    this.loading = true;
    this.documentUri = this.getAttribute('document-uri');
    if (!this.documentUri) {
      this.loading = false;
      return this.show('Comments are not available for this post.');
    }
    if (reset) {
      this.cursor = null;
      this.total = 0;
      this.comments = [];
      if (!quiet) this.container.innerHTML = '<div class="status">Loading comments...</div>';
    }
    try {
      const did = await window.coffeeAndCodeAuth?.getDid();
      this.viewerDid = did;
      const query = new URLSearchParams({ subject: this.documentUri, limit: '40' });
      if (did) query.set('did', did);
      if (this.cursor) query.set('cursor', this.cursor);
      const response = await fetch(`/api/comments?${query}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load comments.');
      const data = await response.json();
      const incoming = Array.isArray(data.records) ? data.records : [];
      const byUri = new Map(this.comments.map((comment) => [comment.uri, comment]));
      incoming.forEach((comment) => {
        if (!comment?.uri || this.deletedUris.has(comment.uri)) return;
        if (this.pendingEdits.has(comment.uri)) comment.text = this.pendingEdits.get(comment.uri);
        byUri.set(comment.uri, comment);
      });
      this.comments = [...byUri.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uri.localeCompare(b.uri));
      this.cursor = typeof data.cursor === 'string' && data.cursor ? data.cursor : null;
      this.total = Number.isFinite(Number(data.total)) ? Number(data.total) : this.comments.length;
      this.render();
    } catch (error) {
      if (!this.comments.length) this.show(error instanceof Error ? error.message : 'Unable to load comments.');
      else {
        this.render();
        const status = this.container.querySelector('[data-list-status]');
        if (status) status.textContent = 'Could not load more comments. Try again.';
      }
    } finally {
      this.loading = false;
    }
  }

  show(message) { this.container.innerHTML = `<div class="status">${escapeHtml(message)}</div>`; }

  renderComment(comment, childrenByParent) {
    const name = comment.displayName || comment.handle || comment.did;
    const avatar = comment.avatar
      ? `<img class="avatar" src="${escapeHtml(comment.avatar)}" alt="" loading="lazy">`
      : `<div class="avatar-placeholder" aria-hidden="true">${escapeHtml(initials(name))}</div>`;
    const replies = childrenByParent.get(comment.uri) || [];
    const likeCount = Number.isFinite(Number(comment.likeCount)) && Number(comment.likeCount) >= 0 ? Number(comment.likeCount) : 0;
    const ownActions = this.viewerDid && comment.did === this.viewerDid
      ? `<div class="comment-actions" aria-label="Your comment controls"><button type="button" class="comment-action" data-edit-comment="${escapeHtml(comment.uri)}">Edit comment</button><button type="button" class="comment-action comment-action--danger" data-delete-comment="${escapeHtml(comment.uri)}">Delete comment</button></div>`
      : '';
    return `<article class="comment" data-comment-uri="${escapeHtml(comment.uri)}">${avatar}<div class="comment-content"><div class="comment-meta"><a class="author" data-author-verification-did="${escapeHtml(comment.did)}" href="/user/${encodeURIComponent(comment.did)}">${escapeHtml(name)}</a><span class="handle">@${escapeHtml(comment.handle || comment.did)}</span><time class="time" datetime="${escapeHtml(comment.createdAt)}">${escapeHtml(formatTime(comment.createdAt))}</time></div><p class="comment-text">${escapeHtml(comment.text)}</p><button type="button" class="comment-like" data-like-comment="${escapeHtml(comment.uri)}" data-like-rkey="${escapeHtml(comment.likeRkey || '')}" aria-pressed="${String(Boolean(comment.liked))}">♥ ${comment.liked ? 'Liked' : 'Like'} <span>${likeCount.toLocaleString()}</span></button><button type="button" class="reply-button" data-reply-to="${escapeHtml(comment.uri)}">Reply</button>${ownActions}<div class="comment-status" aria-live="polite"></div>${replies.length ? `<div class="comment-children">${replies.map((reply) => this.renderComment(reply, childrenByParent)).join('')}</div>` : ''}</div></article>`;
  }

  async loadVerificationBadges() {
    const authorElements = [...this.container.querySelectorAll('[data-author-verification-did]')];
    const dids = [...new Set(authorElements.map((element) => element.dataset.authorVerificationDid).filter(Boolean))];
    if (!dids.length) return;
    const query = new URLSearchParams();
    dids.forEach((did) => query.append('did', did));
    const response = await fetch(`/api/verifications?${query}`, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Could not load comment author verifications.');
    const result = await response.json();
    const verifiedDids = new Set(result.verifiedDids);
    authorElements.forEach((element) => {
      if (!verifiedDids.has(element.dataset.authorVerificationDid)) return;
      const badge = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      badge.setAttribute('class', 'comment-verification');
      badge.setAttribute('viewBox', '0 0 20 20');
      badge.setAttribute('fill', 'currentColor');
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', 'This author is a real human and has been verified by Coffee & Code');
      badge.title = 'This author is a real human and has been verified by Coffee & Code';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm4.1 6.2-4.7 5.6a1 1 0 0 1-1.5.1L5.8 11.4a1 1 0 0 1 1.4-1.4l1.3 1.3 4.1-4.9a1 1 0 0 1 1.5 1.3Z');
      badge.append(path);
      element.append(badge);
    });
  }

  render() {
    const childrenByParent = new Map();
    const knownUris = new Set(this.comments.map((comment) => comment.uri));
    const parentByChild = new Map();
    this.comments.forEach((comment) => {
      if (!comment.parentUri || !knownUris.has(comment.parentUri) || comment.parentUri === comment.uri) return;
      // Break malformed cycles from remote records so recursive rendering stays safe.
      let ancestor = comment.parentUri;
      const visited = new Set([comment.uri]);
      while (parentByChild.has(ancestor)) {
        if (visited.has(ancestor)) { ancestor = undefined; break; }
        visited.add(ancestor);
        ancestor = parentByChild.get(ancestor);
      }
      if (!ancestor || visited.has(ancestor)) return;
      const children = childrenByParent.get(comment.parentUri) || [];
      children.push(comment);
      childrenByParent.set(comment.parentUri, children);
      parentByChild.set(comment.uri, comment.parentUri);
    });
    const roots = this.comments
      .filter((comment) => !parentByChild.has(comment.uri))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.uri.localeCompare(a.uri));
    const hasMore = Boolean(this.cursor);
    this.container.innerHTML = `<div class="comments-header"><div><h2 class="comments-title">Join the conversation${this.total ? ` <span>(${this.total.toLocaleString()})</span>` : ''}</h2><p class="comments-intro">Comments are shown in threads. Reply to keep a conversation together.</p></div></div><form class="comment-form" data-comment-form><textarea class="comment-input" name="text" maxlength="3000" required placeholder="Share your thoughts..." aria-label="Write a comment"></textarea><button class="comment-submit" type="submit">Post comment</button><span class="comment-status" aria-live="polite"></span></form>${roots.length ? `<div class="comments-list">${roots.map((comment) => this.renderComment(comment, childrenByParent)).join('')}</div>` : '<div class="status">No comments yet. Start the conversation.</div>'}${hasMore ? '<button type="button" class="comments-more">Load older comments</button>' : ''}<div class="comment-status" data-list-status aria-live="polite"></div>`;
    this.container.querySelector('[data-comment-form]')?.addEventListener('submit', (event) => this.submit(event, undefined));
    this.container.querySelectorAll('[data-reply-to]').forEach((button) => button.addEventListener('click', () => this.openReply(button.dataset.replyTo)));
    this.container.querySelectorAll('[data-like-comment]').forEach((button) => button.addEventListener('click', () => this.toggleLike(button)));
    this.container.querySelectorAll('[data-edit-comment]').forEach((button) => button.addEventListener('click', () => this.openEdit(button.dataset.editComment)));
    this.container.querySelectorAll('[data-delete-comment]').forEach((button) => button.addEventListener('click', () => this.deleteComment(button.dataset.deleteComment, button)));
    this.container.querySelector('.comments-more')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Loading…';
      await this.load();
      const current = this.container.querySelector('.comments-more');
      if (current) { current.disabled = false; current.textContent = 'Load older comments'; }
    });
    void this.loadVerificationBadges().catch((error) => console.error('Could not load comment author verification badges:', error));
  }

  async toggleLike(button) {
    const commentUri = button.dataset.likeComment;
    const isLiked = button.getAttribute('aria-pressed') === 'true';
    const status = button.closest('.comment-content')?.querySelector('.comment-status');
    button.disabled = true;
    try {
      const did = await window.coffeeAndCodeAuth?.getDid();
      if (!did) {
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.assign(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }
      if (!window.coffeeAndCodeAuth?.toggleCommentLike) throw new Error('Sign-in is still initializing. Please try again.');
      const current = this.comments.find((item) => item.uri === commentUri);
      const likeRkey = await window.coffeeAndCodeAuth.toggleCommentLike(commentUri, isLiked, current?.likeRkey);
      const count = button.querySelector('span');
      if (current) {
        current.liked = !isLiked;
        current.likeCount = Math.max(0, Number(current.likeCount || 0) + (isLiked ? -1 : 1));
        current.likeRkey = likeRkey;
      }
      if (count && current) count.textContent = current.likeCount.toLocaleString();
      button.setAttribute('aria-pressed', String(!isLiked));
      button.dataset.likeRkey = likeRkey || '';
      button.firstChild.textContent = `♥ ${isLiked ? 'Like' : 'Liked'} `;
      if (status) status.textContent = isLiked ? 'Like removed.' : 'You liked this comment.';
      this.scheduleRefresh();
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Could not update this like.';
    } finally {
      button.disabled = false;
    }
  }

  async openReply(parentUri) {
    const article = [...this.container.querySelectorAll('[data-comment-uri]')].find((item) => item.dataset.commentUri === parentUri);
    if (!article) return;
    article.querySelector('.reply-form')?.remove();
    const form = document.createElement('form');
    form.className = 'comment-form reply-form';
    form.innerHTML = '<textarea class="comment-input" name="text" maxlength="3000" required placeholder="Write a reply..."></textarea><button class="comment-submit" type="submit">Post reply</button><span class="comment-status" aria-live="polite"></span>';
    article.querySelector('.comment-content')?.append(form);
    form.addEventListener('submit', (event) => this.submit(event, parentUri));
    form.querySelector('textarea')?.focus();
  }

  openEdit(uri) {
    const comment = this.comments.find((item) => item.uri === uri);
    const article = [...this.container.querySelectorAll('[data-comment-uri]')].find((item) => item.dataset.commentUri === uri);
    if (!comment || !article) return;
    article.querySelector('.reply-form, .comment-edit-form')?.remove();
    const form = document.createElement('form');
    form.className = 'comment-form comment-edit-form';
    form.innerHTML = `<textarea class="comment-input" name="text" maxlength="3000" required>${escapeHtml(comment.text)}</textarea><div><button class="comment-submit" type="submit">Save changes</button> <button class="comment-action" type="button" data-cancel-edit>Cancel</button></div><span class="comment-status" aria-live="polite"></span>`;
    article.querySelector('.comment-content')?.append(form);
    form.addEventListener('submit', (event) => this.saveEdit(event, comment));
    form.querySelector('[data-cancel-edit]')?.addEventListener('click', () => form.remove());
    form.querySelector('textarea')?.focus();
  }

  async saveEdit(event, comment) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = new FormData(form).get('text')?.toString().trim();
    if (!text) return;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.comment-status');
    try {
      button.disabled = true;
      status.textContent = 'Saving…';
      if (!window.coffeeAndCodeAuth?.editComment) throw new Error('Sign-in is still initializing. Please try again.');
      await window.coffeeAndCodeAuth.editComment(comment.uri, {
        subject: { uri: this.documentUri },
        ...(comment.parentUri ? { reply: { parent: { uri: comment.parentUri } } } : {}),
        text,
        createdAt: comment.createdAt,
      });
      comment.text = text;
      this.pendingEdits.set(comment.uri, text);
      this.render();
        void this.loadVerificationBadges().catch((error) => console.error(error));
      this.scheduleRefresh();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not save this edit.';
      button.disabled = false;
    }
  }

  async deleteComment(uri, button) {
    const comment = this.comments.find((item) => item.uri === uri);
    if (!comment || !window.confirm('Delete this comment? Replies will remain visible.')) return;
    const status = button.closest('.comment-content')?.querySelector('.comment-status');
    try {
      button.disabled = true;
      if (!window.coffeeAndCodeAuth?.deleteComment) throw new Error('Sign-in is still initializing. Please try again.');
      await window.coffeeAndCodeAuth.deleteComment(uri);
      this.deletedUris.add(uri);
      this.comments = this.comments.filter((item) => item.uri !== uri);
      this.total = Math.max(0, this.total - 1);
      this.render();
      this.scheduleRefresh();
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Could not delete this comment.';
      button.disabled = false;
    }
  }

  async submit(event, parentUri) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = new FormData(form).get('text')?.toString().trim();
    if (!text) return;
    const status = form.querySelector('.comment-status');
    const button = form.querySelector('button[type="submit"]');
    try {
      const did = await window.coffeeAndCodeAuth?.getDid();
      if (!did) {
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.assign(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }
      button.disabled = true;
      status.textContent = 'Posting…';
      const record = {
        subject: { uri: this.documentUri },
        ...(parentUri ? { reply: { parent: { uri: parentUri } } } : {}),
        text,
        createdAt: new Date().toISOString(),
      };
      if (!window.coffeeAndCodeAuth?.createComment) throw new Error('Sign-in is still initializing. Please try again.');
      await window.coffeeAndCodeAuth.createComment(record);
      form.reset();
      status.textContent = 'Comment posted. It may take a moment to appear.';
      if (button) button.disabled = false;
      this.scheduleRefresh();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not post this comment.';
      if (button) button.disabled = false;
    }
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { void this.load({ reset: true, quiet: true }); }, 1800);
  }
}

if (!customElements.get('sequoia-comments')) customElements.define('sequoia-comments', SequoiaComments);
