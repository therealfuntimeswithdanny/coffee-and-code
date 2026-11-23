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

// Attach mode — wire the same suggestions onto an existing <input>:
//   <input data-handle-typeahead data-typeahead-limit="6" data-typeahead-api="/api/typeahead/searchActorsTypeahead">
// Selecting a suggestion fills the input with the bare handle and dispatches a
// `handle-selected` CustomEvent from the input.
let attachStylesInjected = false;
function injectAttachStyles() {
  if (attachStylesInjected) return;
  attachStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .handle-typeahead-popover {
      background: var(--paper, #fff);
      border: 1px solid var(--line, #d8d2c4);
      border-radius: 4px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, .14);
      box-sizing: border-box;
      list-style: none;
      margin: 0;
      max-height: 320px;
      overflow-y: auto;
      padding: 0;
      position: fixed;
      z-index: 999;
    }
    .handle-typeahead-popover li { align-items: center; display: flex; gap: 11px; padding: 9px 13px; }
    .handle-typeahead-popover li[role="option"] { cursor: pointer; }
    .handle-typeahead-popover li[role="option"][aria-selected="true"],
    .handle-typeahead-popover li[role="option"]:hover { background: var(--paper-deep, #f2eee4); }
    .handle-typeahead-popover img, .handle-typeahead-popover .ht-ph { border-radius: 50%; flex: none; height: 34px; width: 34px; }
    .handle-typeahead-popover img { object-fit: cover; }
    .handle-typeahead-popover .ht-ph { align-items: center; background: var(--paper-deep, #f2eee4); color: var(--muted, #777); display: inline-flex; font-size: 15px; justify-content: center; }
    .handle-typeahead-popover .ht-meta { display: grid; min-width: 0; }
    .handle-typeahead-popover .ht-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .handle-typeahead-popover .ht-handle { color: var(--muted, #777); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .handle-typeahead-popover .ht-status { color: var(--muted, #777); cursor: default; font-size: 14px; }
  `;
  document.head.append(style);
}

function attachHandleTypeahead(input) {
  if (input.dataset.typeaheadAttached) return;
  input.dataset.typeaheadAttached = 'true';
  injectAttachStyles();

  const api = input.getAttribute('data-typeahead-api') || '/api/typeahead/searchActorsTypeahead';
  const limit = Math.min(Math.max(parseInt(input.getAttribute('data-typeahead-limit') || '8', 10) || 8, 1), 100);
  const popover = document.createElement('ul');
  popover.className = 'handle-typeahead-popover';
  popover.setAttribute('role', 'listbox');
  popover.hidden = true;
  document.body.append(popover);

  let actors = [];
  let active = -1;
  let seq = 0;
  let timer = 0;
  let abort = null;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  const position = () => {
    const rect = input.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = `${rect.left}px`;
    popover.style.width = `${rect.width}px`;
  };
  const show = () => {
    position();
    popover.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const hide = () => {
    popover.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const renderStatus = (message) => {
    popover.innerHTML = '<li class="ht-status" role="status"></li>';
    popover.firstChild.textContent = message;
    show();
  };
  const setActive = (index) => {
    active = index;
    popover.querySelectorAll('li[role="option"]').forEach((item, i) => {
      item.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    const option = popover.querySelector(`#hta-option-${index}`);
    if (option) {
      input.setAttribute('aria-activedescendant', `hta-option-${index}`);
      option.scrollIntoView({ block: 'nearest' });
    }
  };
  const select = (index) => {
    const actor = actors[index];
    if (!actor) return;
    input.value = actor.handle;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    hide();
    input.dispatchEvent(new CustomEvent('handle-selected', { detail: actor, bubbles: true }));
  };
  const render = () => {
    if (!actors.length) {
      renderStatus('No accounts found.');
      return;
    }
    popover.innerHTML = actors.map((actor, index) => {
      const name = actor.displayName || actor.handle;
      const avatar = typeof actor.avatar === 'string' && actor.avatar.startsWith('https://')
        ? `<img src="${actor.avatar}" alt="" loading="lazy" decoding="async">`
        : '<span class="ht-ph" aria-hidden="true">@</span>';
      return `<li role="option" id="hta-option-${index}" aria-selected="false" data-index="${index}">
        ${avatar}
        <span class="ht-meta"><span class="ht-name">${escape(name)}</span><span class="ht-handle">@${escape(actor.handle)}</span></span>
      </li>`;
    }).join('');
    popover.querySelectorAll('li[role="option"]').forEach((item) => {
      item.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        select(Number(item.dataset.index));
      });
      item.addEventListener('pointermove', () => setActive(Number(item.dataset.index)));
    });
    show();
  };
  const search = async (q) => {
    const requestSeq = ++seq;
    if (q.length < 2) {
      actors = [];
      hide();
      return;
    }
    renderStatus('Searching…');
    abort?.abort();
    abort = new AbortController();
    try {
      const url = new URL(api, location.href);
      url.searchParams.set('q', q.replace(/^@/, ''));
      url.searchParams.set('limit', String(limit));
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: abort.signal });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      actors = Array.isArray(payload.actors) ? payload.actors : [];
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (requestSeq !== seq) return;
      actors = [];
      renderStatus('Search is unavailable right now.');
      return;
    }
    if (requestSeq !== seq) return;
    active = -1;
    render();
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => search(input.value.trim()), 160);
  });
  input.addEventListener('keydown', (event) => {
    if (popover.hidden) {
      if (event.key === 'ArrowDown' && actors.length) show();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(active + 1, actors.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      select(active);
    } else if (event.key === 'Escape') {
      hide();
    }
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));
  input.addEventListener('focus', () => {
    if (actors.length) show();
  });
  window.addEventListener('scroll', () => {
    if (!popover.hidden) position();
  }, true);
  window.addEventListener('resize', () => {
    if (!popover.hidden) position();
  });
}

function scanTypeaheadInputs(root) {
  (root || document).querySelectorAll('input[data-handle-typeahead]').forEach(attachHandleTypeahead);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => scanTypeaheadInputs());
} else {
  scanTypeaheadInputs();
}
