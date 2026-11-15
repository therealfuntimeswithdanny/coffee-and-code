import legal from '../legal.json';
import { externalLinkUrl } from './externalLinks';

export type LegalDocumentKey = keyof typeof legal;

export interface LegalParagraphBlock {
  type: 'p';
  text: string;
}

export interface LegalListBlock {
  type: 'list';
  items: string[];
}

export type LegalBlock = LegalParagraphBlock | LegalListBlock;

export interface LegalSection {
  heading: string | null;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  sections: LegalSection[];
}

export function getLegalDocument(key: LegalDocumentKey): LegalDocument {
  return legal[key] as LegalDocument;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape text and turn [label](url) markers into links routed through the external link stop page. */
function renderInline(text: string): string {
  return escapeHtml(text).replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, label: string, url: string) => `<a href="${externalLinkUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  );
}

function renderBlock(block: LegalBlock): string {
  if (block.type === 'list') {
    return `<ul>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`;
  }
  return `<p>${renderInline(block.text)}</p>`;
}

/** Render a legal document's body markup for the privacy/terms pages. */
export function renderLegalDocument(key: LegalDocumentKey): string {
  const doc = getLegalDocument(key);
  const sections = doc.sections
    .map((section) => `${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}${section.blocks.map(renderBlock).join('')}`)
    .join('\n      ');
  return `
    <article class="privacy-page" aria-labelledby="${key}-title">
      <h1 id="${key}-title">${escapeHtml(doc.title)}</h1>
      <p class="privacy-page__updated">Last updated ${escapeHtml(doc.updated)}</p>
      ${sections}
    </article>`;
}
