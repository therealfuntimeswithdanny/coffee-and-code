// <handle-typeahead> — AT Protocol handle autocomplete.
// Attributes:
//   api           endpoint returning { actors: [...] } (default: /api/typeahead/searchActorsTypeahead)
//   limit         max suggestions (default: 8)
//   profile-base  optional URL prefix; each suggestion links to profile-base + handle
//   placeholder   input placeholder text
// Events:
//   handle-selected — CustomEvent with detail = { did, handle, displayName, avatar, ... }
const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: block; font: inherit; }
    .wrap { position: relative; }
    input {
      background: var(--paper, #fff);
      border: 1px solid var(--line, #d8d2c4);
      border-radius: 4px;
      box-sizing: border-box;
      color: var(--ink, #222);
      font: inherit;
      font-size: 17px;
      padding: 12px 14px;
      width: 100%;
    }
    input:focus { border-color: var(--accent, #a05838); outline: none; }
    ul {
      background: var(--paper, #fff);
      border: 1px solid var(--line, #d8d2c4);
      border-radius: 4px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, .14);
      left: 0;
      list-style: none;
      margin: 4px 0 0;
      max-height: 340px;
      overflow-y: auto;
      padding: 0;
      position: absolute;
      right: 0;
      top: 100%;
      z-index: 40;
    }
    li { align-items: center; display: flex; gap: 11px; padding: 9px 13px; }
    li[role="option"] { cursor: pointer; }
    li[role="option"][aria-selected="true"], li[role="option"]:hover { background: var(--paper-deep, #f2eee4); }
    img, .ph { border-radius: 50%; flex: none; height: 34px; width: 34px; }
    img { object-fit: cover; }
    .ph { align-items: center; background: var(--paper-deep, #f2eee4); color: var(--muted, #777); display: inline-flex; font-size: 15px; justify-content: center; }
    .meta { display: grid; min-width: 0; }
    .name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .handle { color: var(--muted, #777); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status { color: var(--muted, #777); cursor: default; font-size: 14px; }
  </style>
  <div class="wrap">
    <input type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off" autocapitalize="none" spellcheck="false">
    <ul role="listbox" hidden></ul>
  </div>`;

class HandleTypeahead extends HTMLElement {
  connectedCallback() {
    if (this._root) return;
    this._root = this.attachShadow({ mode: 'open' });
    this._root.appendChild(template.content.cloneNode(true));
    this._input = this._root.querySelector('input');
    this._list = this._root.querySelector('ul');
    this._input.placeholder = this.getAttribute('placeholder') || 'Search for a handle…';
    this._input.setAttribute('aria-label', this.getAttribute('label') || 'Search for an AT Protocol handle');
    this._api = this.getAttribute('api') || '/api/typeahead/searchActorsTypeahead';
    this._limit = Math.min(Math.max(parseInt(this.getAttribute('limit') || '8', 10) || 8, 1), 100);
    this._actors = [];
    this._active = -1;
    this._seq = 0;
    this._timer = 0;

    this._input.addEventListener('input', () => {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._search(this._input.value.trim()), 160);
    });
    this._input.addEventListener('keydown', (event) => this._onKeydown(event));
    this._input.addEventListener('blur', () => setTimeout(() => this._hide(), 150));
    this._input.addEventListener('focus', () => {
      if (this._actors.length) this._show();
    });
  }

  async _search(q) {
    const seq = ++this._seq;
    if (q.length < 2) {
      this._actors = [];
      this._hide();
      return;
    }
    this._renderStatus('Searching…');
    this._abort?.abort();
    this._abort = new AbortController();
    let actors;
    try {
      const url = new URL(this._api, location.href);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', String(this._limit));
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: this._abort.signal });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      actors = Array.isArray(payload.actors) ? payload.actors : [];
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (seq !== this._seq) return;
      this._actors = [];
      this._renderStatus('Search is unavailable right now.');
      return;
    }
    if (seq !== this._seq) return;
    this._actors = actors;
    this._active = -1;
    this._render();
  }

  _renderStatus(message) {
    this._list.innerHTML = '<li class="status" role="status">' + message + '</li>';
    this._show();
  }

  _render() {
    if (!this._actors.length) {
      this._renderStatus('No accounts found.');
      return;
    }
    this._list.innerHTML = this._actors.map((actor, index) => {
      const name = actor.displayName || actor.handle;
      const avatar = typeof actor.avatar === 'string' && actor.avatar.startsWith('https://')
        ? `<img src="${actor.avatar}" alt="" loading="lazy" decoding="async">`
        : '<span class="ph" aria-hidden="true">@</span>';
      return `<li role="option" id="ta-option-${index}" aria-selected="false" data-index="${index}">
        ${avatar}
        <span class="meta"><span class="name">${escape(name)}</span><span class="handle">@${escape(actor.handle)}</span></span>
      </li>`;
    }).join('');
    this._list.querySelectorAll('li[role="option"]').forEach((item) => {
      item.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this._select(Number(item.dataset.index));
      });
      item.addEventListener('pointermove', () => this._setActive(Number(item.dataset.index)));
    });
    this._show();
  }

  _onKeydown(event) {
    if (this._list.hidden) {
      if (event.key === 'ArrowDown' && this._actors.length) this._show();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this._setActive(Math.min(this._active + 1, this._actors.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this._setActive(Math.max(this._active - 1, 0));
    } else if (event.key === 'Enter' && this._active >= 0) {
      event.preventDefault();
      this._select(this._active);
    } else if (event.key === 'Escape') {
      this._hide();
    }
  }

  _setActive(index) {
    this._active = index;
    this._list.querySelectorAll('li[role="option"]').forEach((item, i) => {
      item.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    const option = this._list.querySelector(`#ta-option-${index}`);
    if (option) {
      this._input.setAttribute('aria-activedescendant', `ta-option-${index}`);
      option.scrollIntoView({ block: 'nearest' });
    }
  }

  _select(index) {
    const actor = this._actors[index];
    if (!actor) return;
    this._input.value = `@${actor.handle}`;
    this._hide();
    this.dispatchEvent(new CustomEvent('handle-selected', { detail: actor, bubbles: true, composed: true }));
  }

  _show() {
    this._list.hidden = false;
    this._input.setAttribute('aria-expanded', 'true');
  }

  _hide() {
    this._list.hidden = true;
    this._input.setAttribute('aria-expanded', 'false');
    this._input.removeAttribute('aria-activedescendant');
  }
}

function escape(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

customElements.define('handle-typeahead', HandleTypeahead);
