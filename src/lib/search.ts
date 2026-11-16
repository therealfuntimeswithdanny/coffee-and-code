// Shared helpers for the site-wide /search page: relevance ranking over
// weighted fields, match highlighting, and plain-text result snippets.

export type WeightedField = { text: string | undefined; weight: number };

export function queryTerms(query: string, limit = 8): string[] {
  return query.toLocaleLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean).slice(0, limit);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Ranks items by how well they match the query. An item only ranks when every
 * query term appears in at least one field (the same AND semantics as the
 * archive's searchArticles); the score weighs field importance, repeat hits,
 * and matches at the start of a field.
 */
export function rankSearch<T>(items: T[], query: string, fields: (item: T) => WeightedField[]): T[] {
  const terms = queryTerms(query);
  if (!terms.length) return items;
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const weighted = fields(item).map(({ text, weight }) => ({
      weight,
      text: (text || '').toLocaleLowerCase(),
    }));
    if (!terms.every((term) => weighted.some(({ text }) => text.includes(term)))) continue;
    let score = 0;
    for (const { text, weight } of weighted) {
      for (const term of terms) {
        score += weight * countOccurrences(text, term);
        if (text.startsWith(term)) score += weight;
      }
    }
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ item }) => item);
}

/** Escapes `text` for HTML and wraps every query-term match in <mark>. */
export function highlightTerms(text: string, query: string): string {
  const terms = queryTerms(query).map(escapeRegExp);
  if (!terms.length) return escapeHtml(text);
  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
  let output = '';
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    output += escapeHtml(text.slice(last, match.index));
    output += `<mark>${escapeHtml(match[0])}</mark>`;
    last = match.index + match[0].length;
  }
  return output + escapeHtml(text.slice(last));
}

/** Plain-text excerpt centered on the first matching term, for result previews. */
export function searchSnippet(text: string, query: string, maxLength = 180): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  if (plain.length <= maxLength) return plain;
  const lower = plain.toLocaleLowerCase();
  const firstMatch = queryTerms(query)
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (firstMatch === undefined) return `${plain.slice(0, maxLength).trimEnd()}…`;
  const start = Math.max(0, firstMatch - Math.floor(maxLength / 3));
  const end = Math.min(plain.length, start + maxLength);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trimEnd()}${end < plain.length ? '…' : ''}`;
}
