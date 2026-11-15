// Shared search bar used by the Archive and Forum indexes: one text field with
// a submit button, followed by a compact row of drop-down filters.

export type SearchBarOption = { value: string; label: string };

export type SearchBarSelect = {
  name: string;
  label: string;
  value: string;
  options: SearchBarOption[];
  /** The value that means "no filter"; a select is active when its value differs. */
  defaultValue?: string;
};

export type SearchBarToggle = {
  name: string;
  label: string;
  value: string;
  checked: boolean;
};

export type SearchBarConfig = {
  action: string;
  label: string;
  placeholder: string;
  query: string;
  selects?: SearchBarSelect[];
  toggles?: SearchBarToggle[];
  className?: string;
};

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function idFor(action: string, name: string) {
  return `search-${action.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'site'}-${name}`;
}

/** Number of filters that differ from their defaults (the query is not counted). */
export function activeFilterCount(config: SearchBarConfig) {
  const selects = (config.selects || [])
    .filter((select) => select.value !== (select.defaultValue ?? '')).length;
  const toggles = (config.toggles || []).filter((toggle) => toggle.checked).length;
  return selects + toggles;
}

export function renderSearchBar(config: SearchBarConfig) {
  const queryId = idFor(config.action, 'q');
  const selects = (config.selects || []).map((select) => {
    const id = idFor(config.action, select.name);
    const defaultValue = select.defaultValue ?? '';
    const options = [...select.options];
    // Keep an unknown current value (for example, an old topic link) selectable.
    if (select.value && !options.some((option) => option.value === select.value)) {
      options.push({ value: select.value, label: select.value });
    }
    const active = select.value !== defaultValue;
    return `<div class="search-bar__filter${active ? ' is-active' : ''}">
        <label for="${escapeHtml(id)}">${escapeHtml(select.label)}</label>
        <select id="${escapeHtml(id)}" name="${escapeHtml(select.name)}" data-search-auto-submit>${options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === select.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>
      </div>`;
  }).join('');
  const toggles = (config.toggles || []).map((toggle) => `<label class="search-bar__toggle${toggle.checked ? ' is-active' : ''}"><input type="checkbox" name="${escapeHtml(toggle.name)}" value="${escapeHtml(toggle.value)}"${toggle.checked ? ' checked' : ''} data-search-auto-submit> ${escapeHtml(toggle.label)}</label>`).join('');
  const activeCount = activeFilterCount(config);
  const hasCriteria = activeCount > 0 || config.query.length > 0;
  const clear = hasCriteria
    ? `<a class="search-bar__clear" href="${escapeHtml(config.action)}">Clear${activeCount ? ` ${activeCount} ${activeCount === 1 ? 'filter' : 'filters'}` : ' search'}</a>`
    : '';

  return `<form class="search-bar${config.className ? ` ${escapeHtml(config.className)}` : ''}" role="search" action="${escapeHtml(config.action)}" method="get">
    <div class="search-bar__field">
      <label class="visually-hidden" for="${escapeHtml(queryId)}">${escapeHtml(config.label)}</label>
      <i class="fa-solid fa-magnifying-glass search-bar__icon" aria-hidden="true"></i>
      <input id="${escapeHtml(queryId)}" type="search" name="q" value="${escapeHtml(config.query)}" placeholder="${escapeHtml(config.placeholder)}" autocomplete="off" maxlength="200">
      <button type="submit" class="search-bar__submit">Search</button>
    </div>
    ${selects || toggles ? `<div class="search-bar__filters" role="group" aria-label="Filters">${selects}${toggles}${clear}</div>` : clear}
  </form>`;
}
