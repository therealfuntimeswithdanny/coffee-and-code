export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function storyAuthor(story) {
  return story.author?.displayName || story.author?.handle || 'Coffee & Code';
}

export function readingTimeMinutes(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return words ? Math.max(1, Math.ceil(words / 200)) : 0;
}

// Estimated minutes to read a story record. Handles markdown/plaintext
// strings and leaflet/richtext JSON content. Returns 0 when there is no
// readable text yet (for example, before the full record has loaded).
export function articleReadingTime(record) {
  let content = record?.content ?? record?.textContent ?? null;
  if (content && typeof content === 'object') content = content.textContent ?? content;
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        content = JSON.parse(trimmed);
      } catch {
        // Not JSON after all; count it as plain text below.
      }
    }
  }
  if (typeof content === 'string') return readingTimeMinutes(content);
  if (!content || typeof content !== 'object') return 0;
  const pages = Array.isArray(content.pages)
    ? content.pages
    : [{ blocks: content.blocks ?? content.items ?? content?.content?.items }];
  const text = pages
    .flatMap((page) => (Array.isArray(page?.blocks) ? page.blocks : []))
    .map((wrapper) => wrapper?.block || wrapper)
    .map((block) => [block?.plaintext, block?.text, block?.title].find((value) => typeof value === 'string') || '')
    .join(' ');
  return readingTimeMinutes(text);
}
