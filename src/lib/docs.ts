// Local developer docs. Each markdown file under docs/ is imported as text
// (see the `rules` block in wrangler.toml) and becomes a page at /docs/<slug>.
// To add a doc: drop an .md file in docs/ — scripts/build-docs.mjs regenerates
// docs.generated.ts automatically on `npm run dev` / `npm run deploy`.

import { RAW_DOCS, type RawDoc } from './docs.generated';

export interface DocEntry {
  /** URL slug, also the markdown filename without extension. */
  slug: string;
  /** Page title — frontmatter `title` or the first `#` heading. */
  title: string;
  /** Short summary for the landing page and meta tags. */
  description: string;
  /** Sidebar/landing grouping label (frontmatter `section`, else the parent folder name, else "Guides"). */
  section: string;
  /** FontAwesome class shown next to this doc in the sidebar/landing (frontmatter `icon`, e.g. `fa-server` or `fa-brands fa-github`). */
  icon: string;
  /** FontAwesome class for this doc's section heading (frontmatter `sectionIcon` on any doc in the section). */
  sectionIcon: string;
  /** Sort order within a section (frontmatter `order`, default 0). */
  order: number;
  /** ISO date shown as "Updated …" (frontmatter `updated`). */
  updated: string;
  /** Markdown body with frontmatter stripped. */
  markdown: string;
}

/** Parses a leading `---` YAML-lite frontmatter block (flat `key: value` pairs). */
function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { fields: {}, body: raw };
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fields[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fields, body: raw.slice(match[0].length) };
}

/** First `#` heading in the body, used as a fallback title. */
function headingTitle(body: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

/** First plain paragraph — fallback description when frontmatter omits one. */
function firstParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^[#>`\-|]/.test(text) || text.startsWith('```')) continue;
    return text.replace(/\s+/g, ' ').slice(0, 200);
  }
  return '';
}

/** Turns a folder name like `getting-started` into `Getting Started`. */
function humanizeFolder(folder: string): string {
  return folder
    .split('/')
    .pop()!
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Normalizes a frontmatter icon value into full FA classes (`server`/`fa-server` → `fa-solid fa-server`). */
function normalizeIcon(value: string): string {
  if (!value) return '';
  if (/^fa-(solid|regular|brands|light|thin|duotone|sharp)\s/.test(value)) return value;
  return `fa-solid ${value.startsWith('fa-') ? value : `fa-${value}`}`;
}

const DOCS: DocEntry[] = RAW_DOCS.map(({ slug, folder, markdown }) => {
  const { fields, body } = parseFrontmatter(markdown);
  return {
    slug,
    title: fields.title || headingTitle(body) || slug,
    description: fields.description || firstParagraph(body),
    section: fields.section || (folder ? humanizeFolder(folder) : 'Guides'),
    icon: normalizeIcon(fields.icon || ''),
    sectionIcon: normalizeIcon(fields.sectionicon || ''),
    order: Number.parseInt(fields.order || '0', 10) || 0,
    updated: fields.updated || '',
    markdown: body,
  };
});

/**
 * Replaces inline icon shorthand in doc markdown before rendering:
 * `:fa-server:` → solid, `:fa-brands:github:` / `:fa-regular:bell:` for other styles.
 */
export function renderDocIcons(markdown: string): string {
  return markdown
    .replace(/:fa-(solid|regular|brands):([a-z0-9-]+):/gi, '<i class="fa-$1 fa-$2" aria-hidden="true"></i>')
    .replace(/:fa-([a-z0-9-]+):/gi, '<i class="fa-solid fa-$1" aria-hidden="true"></i>');
}

/** All docs, sorted by section order then title. */
export function listDocs(): DocEntry[] {
  return [...DOCS].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function getDoc(slug: string): DocEntry | undefined {
  return DOCS.find((doc) => doc.slug === slug);
}
