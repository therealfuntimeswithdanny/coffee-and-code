import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeFilterCount, renderSearchBar, type SearchBarConfig } from '../src/templates/searchBar.ts';

const archive = (overrides: Partial<SearchBarConfig> = {}): SearchBarConfig => ({
  action: '/archive',
  label: 'Search stories',
  placeholder: 'Search stories',
  query: '',
  selects: [
    { name: 'author', label: 'Author', value: '', options: [{ value: '', label: 'All' }, { value: 'did:plc:abc', label: 'Ada' }] },
    { name: 'sort', label: 'Order', value: 'newest', defaultValue: 'newest', options: [{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }] },
  ],
  toggles: [{ name: 'image', label: 'With images', value: '1', checked: false }],
  ...overrides,
});

test('renders one search field and submit button with the q parameter', () => {
  const html = renderSearchBar(archive({ query: 'atproto' }));
  assert.match(html, /<form class="search-bar" role="search" action="\/archive" method="get">/);
  assert.equal(html.match(/<input [^>]*type="search"/g)?.length, 1);
  assert.match(html, /name="q" value="atproto"/);
  assert.match(html, /<button type="submit" class="search-bar__submit">Search<\/button>/);
});

test('renders filters as drop-downs that keep the existing parameter names', () => {
  const html = renderSearchBar(archive());
  assert.match(html, /<select [^>]*name="author"/);
  assert.match(html, /<select [^>]*name="sort"/);
  assert.match(html, /<input type="checkbox" name="image" value="1"/);
  assert.match(html, /<option value="newest" selected>Newest<\/option>/);
});

test('each control has a programmatic label', () => {
  const html = renderSearchBar(archive());
  for (const [, id] of html.matchAll(/<(?:input|select) id="([^"]+)"/g)) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `missing label for ${id}`);
  }
});

test('marks active filters and offers a clear link only when something is applied', () => {
  assert.doesNotMatch(renderSearchBar(archive()), /search-bar__clear/);
  const config = archive();
  config.selects![0].value = 'did:plc:abc';
  config.toggles![0].checked = true;
  assert.equal(activeFilterCount(config), 2);
  const html = renderSearchBar(config);
  assert.match(html, /search-bar__filter is-active/);
  assert.match(html, /<a class="search-bar__clear" href="\/archive">Clear 2 filters<\/a>/);
  assert.match(renderSearchBar(archive({ query: 'x' })), />Clear search</);
});

test('a non-default sort counts as a filter, the default does not', () => {
  const config = archive();
  assert.equal(activeFilterCount(config), 0);
  config.selects![1].value = 'oldest';
  assert.equal(activeFilterCount(config), 1);
});

test('keeps an unknown current value selectable (for example an old forum topic link)', () => {
  const html = renderSearchBar({
    action: '/forum', label: 'Search discussions', placeholder: '', query: '',
    selects: [{ name: 'tag', label: 'Topic', value: 'retired-topic', options: [{ value: '', label: 'All' }, { value: 'web', label: 'web' }] }],
  });
  assert.match(html, /<option value="retired-topic" selected>retired-topic<\/option>/);
});

test('escapes user-controlled values', () => {
  const html = renderSearchBar(archive({ query: '"><script>alert(1)</script>' }));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /value="&quot;&gt;&lt;script&gt;/);
  const config = archive();
  config.selects![0].options.push({ value: 'did:plc:x"y', label: '<b>Eve</b>' });
  const options = renderSearchBar(config);
  assert.match(options, /value="did:plc:x&quot;y">&lt;b&gt;Eve&lt;\/b&gt;/);
});
