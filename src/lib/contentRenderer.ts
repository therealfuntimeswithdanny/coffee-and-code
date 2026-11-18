import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { proxyBlobUrl } from './atproto';

function sanitizeContentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'h1', 'h2', 'h3', 'h4', 'img', 'pre', 'code', 'hr', 'del',
      'figure', 'figcaption', 'iframe', 'table', 'thead', 'tbody', 'tfoot',
      'tr', 'th', 'td', 'sup', 'sub',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'class', 'id', 'aria-label'],
      sup: ['id', 'class'],
      li: ['id', 'class'],
      ol: ['class', 'start'],
      mark: ['class'],
      del: ['class'],
      span: ['class'],
      h2: ['class', 'id'],
      h3: ['class', 'id'],
      h4: ['class', 'id'],
      hr: ['class'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'class'],
      code: ['class'],
      pre: ['class'],
      figure: ['class'],
      figcaption: ['class'],
      iframe: ['src', 'srcdoc', 'title', 'sandbox', 'referrerpolicy', 'loading', 'allowfullscreen', 'class'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer' }),
      iframe: sanitizeHtml.simpleTransform('iframe', {
        sandbox: 'allow-scripts allow-forms allow-presentation',
        referrerpolicy: 'no-referrer',
        loading: 'lazy',
      }),
    },
  });
}

/**
 * Supported content formats in the Standard protocol
 */
export enum ContentFormat {
  MARKDOWN = 'markdown',
  HTML = 'html',
  PLAINTEXT = 'plaintext',
  RICHTEXT = 'richtext',
  UNKNOWN = 'unknown',
}

/**
 * Detects the content format based on patterns and metadata
 */
export function detectFormat(content: string, mimeType?: string): ContentFormat {
  if (!content || !content.trim()) {
    return ContentFormat.PLAINTEXT;
  }

  // Check MIME type if provided
  if (mimeType) {
    if (mimeType.includes('markdown')) return ContentFormat.MARKDOWN;
    if (mimeType.includes('html')) return ContentFormat.HTML;
    if (mimeType.includes('richtext') || mimeType.includes('json')) return ContentFormat.RICHTEXT;
    if (mimeType.includes('text/plain')) return ContentFormat.PLAINTEXT;
  }

  // Detect HTML by presence of HTML tags
  if (/<(?:p|div|span|a|img|h[1-6]|ul|ol|li|blockquote|code|pre|table|article|section)[^>]*>/i.test(content)) {
    return ContentFormat.HTML;
  }

  // Detect markdown by presence of markdown-specific patterns
  const markdownPatterns = [
    /^#{1,6}\s+/m, // Headers
    /\*\*.*?\*\*/g, // Bold
    /\*[^*]+\*/g, // Italic
    /\[.*?\]\(.*?\)/g, // Links
    /!\[.*?\]\(.*?\)/g, // Images
    /^[-*+]\s+/m, // Lists
    /^>\s+/m, // Blockquotes
    /```/g, // Code blocks
    /`[^`]+`/g, // Inline code
  ];

  const markdownMatches = markdownPatterns.filter(pattern => pattern.test(content)).length;

  // If multiple markdown patterns found, it's likely markdown
  if (markdownMatches >= 2) {
    return ContentFormat.MARKDOWN;
  }

  // Check for rich text structures (JSON with text/formatting)
  try {
    const parsed = JSON.parse(content);
    if (
      (Array.isArray(parsed) && parsed.some(item => typeof item === 'object' && 'text' in item)) ||
      (typeof parsed === 'object' && ('content' in parsed || 'blocks' in parsed))
    ) {
      return ContentFormat.RICHTEXT;
    }
  } catch {
    // Not JSON, continue
  }

  // Default to plaintext
  return ContentFormat.PLAINTEXT;
}

/**
 * Escapes HTML special characters
 */
export function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

/**
 * Converts document content to plain text for excerpts and deks.
 * Handles HTML, Markdown, and richtext/leaflet JSON payloads.
 */
export function toPlainText(content: string, mimeType?: string): string {
  const source = (content || '').trim();
  if (!source) return '';

  const format = detectFormat(source, mimeType);
  let text = source;

  if (format === ContentFormat.RICHTEXT) {
    try {
      const parsed = JSON.parse(source);
      const items = Array.isArray(parsed)
        ? parsed
        : parsed?.content?.items ?? parsed?.blocks ?? parsed?.items ?? [];
      text = (Array.isArray(items) ? items : [])
        .map((item: any) => (typeof item?.text === 'string' ? item.text
          : typeof item?.plaintext === 'string' ? item.plaintext : ''))
        .filter(Boolean)
        .join(' ');
    } catch {
      text = '';
    }
  } else if (format === ContentFormat.HTML) {
    text = sanitizeHtml(source, { allowedTags: [], allowedAttributes: {} });
  } else {
    text = source
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/`([^`]*)`/g, '$1');
  }

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Renders plaintext content with basic formatting
 */
export function renderPlaintext(content: string): string {
  const escaped = escapeHtml(content);
  const paragraphs = escaped
    .split(/\n\n+/)
    .map(para => `<p>${para.trim().replace(/\n/g, '<br>')}</p>`)
    .join('');
  return paragraphs || `<p>${escaped}</p>`;
}

/**
 * Renders HTML content with sanitization
 */
export function renderHtml(content: string): string {
  const withSafeEmbeds = content.replace(
    /<iframe\b([^>]*)>(?:[\s\S]*?<\/iframe\s*>)?|<iframe\b([^>]*)\/?>/gi,
    (_match, pairedAttributes: string | undefined, selfClosingAttributes: string | undefined) => {
      const attributes = pairedAttributes ?? selfClosingAttributes ?? '';
      const source = attributes.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2]
        ?.replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
      const srcdoc = attributes.match(/\bsrcdoc\s*=\s*(["'])(.*?)\1/i)?.[2]
        ?.replace(/&amp;/gi, '&')
        ?.replace(/&quot;/gi, '"')
        ?.replace(/&#39;|&apos;/gi, "'");
      const title = attributes.match(/\btitle\s*=\s*(["'])(.*?)\1/i)?.[2]
        ?.replace(/&quot;/gi, '"')
        ?.replace(/&amp;/gi, '&');
      return renderLeafletEmbed({ url: source, title, html: srcdoc });
    },
  );

  return sanitizeContentHtml(withSafeEmbeds);
}

function safeLinkUrl(uri: unknown): string | undefined {
  if (typeof uri !== 'string') return undefined;

  try {
    const url = new URL(uri);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return url.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export type LeafletFootnote = {
  id: string;
  number: number;
  html: string;
};

type LeafletSpanFeature =
  | { kind: 'link'; href: string }
  | { kind: 'bold' }
  | { kind: 'italic' }
  | { kind: 'code' }
  | { kind: 'strikethrough' }
  | { kind: 'underline' }
  | { kind: 'highlight' };

function leafletSpanFeature(feature: any): LeafletSpanFeature | undefined {
  const type = feature?.$type || '';
  if (type === 'pub.leaflet.richtext.facet#link') {
    const href = safeLinkUrl(feature?.uri);
    return href ? { kind: 'link', href } : undefined;
  }
  if (type === 'pub.leaflet.richtext.facet#didMention') {
    const did = typeof feature?.did === 'string' && /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(feature.did)
      ? feature.did
      : undefined;
    return did ? { kind: 'link', href: `https://bsky.app/profile/${did}` } : undefined;
  }
  if (type === 'pub.leaflet.richtext.facet#bold') return { kind: 'bold' };
  if (type === 'pub.leaflet.richtext.facet#italic') return { kind: 'italic' };
  if (type === 'pub.leaflet.richtext.facet#code') return { kind: 'code' };
  if (type === 'pub.leaflet.richtext.facet#strikethrough') return { kind: 'strikethrough' };
  if (type === 'pub.leaflet.richtext.facet#underline') return { kind: 'underline' };
  if (type === 'pub.leaflet.richtext.facet#highlight') return { kind: 'highlight' };
  return undefined;
}

/**
 * Renders Leaflet richtext plaintext with facets (links, mentions, formatting,
 * footnotes). Facet byte ranges are mapped to character offsets so overlapping
 * marks nest correctly. Footnote facets register markers in `footnotes` and
 * emit <sup> references at their anchor position.
 */
export function renderLeafletText(text: string, facets: any[] = [], footnotes?: LeafletFootnote[]): string {
  const characters = Array.from(text);
  if (!characters.length) {
    if (footnotes) collectFacetFootnotes(facets, characters, 0, footnotes);
    return '';
  }

  const byteOffsets = [0];
  for (const character of characters) {
    byteOffsets.push(byteOffsets[byteOffsets.length - 1] + new TextEncoder().encode(character).length);
  }
  const indexForByteOffset = (offset: number): number => {
    const index = byteOffsets.indexOf(offset);
    return index >= 0 ? index : characters.length;
  };

  const intervals: { start: number; end: number; feature: LeafletSpanFeature }[] = [];
  const footnoteMarks: { position: number; feature: any }[] = [];
  for (const facet of facets || []) {
    const byteStart = facet?.index?.byteStart;
    const byteEnd = facet?.index?.byteEnd;
    if (!Number.isInteger(byteStart) || !Number.isInteger(byteEnd) || byteStart < 0 || byteEnd < byteStart) continue;
    const start = Math.min(characters.length, indexForByteOffset(byteStart));
    const end = Math.min(characters.length, indexForByteOffset(byteEnd));
    for (const feature of facet?.features || []) {
      const type = feature?.$type || '';
      if (type === 'pub.leaflet.richtext.facet#footnote') {
        footnoteMarks.push({ position: end > start ? end : start, feature });
        continue;
      }
      const span = leafletSpanFeature(feature);
      if (span && end > start) intervals.push({ start, end, feature: span });
    }
  }

  if (!intervals.length && !footnoteMarks.length) return escapeHtml(text);

  const markersByPosition = new Map<number, any[]>();
  for (const mark of footnoteMarks) {
    const list = markersByPosition.get(mark.position) || [];
    list.push(mark.feature);
    markersByPosition.set(mark.position, list);
  }

  const emitMarkers = (position: number): string => {
    const features = markersByPosition.get(position);
    if (!features) return '';
    return features.map((feature) => {
      const id = typeof feature?.footnoteId === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(feature.footnoteId)
        ? feature.footnoteId
        : `n${(footnotes?.length || 0) + 1}`;
      const contentText = typeof feature?.contentPlaintext === 'string' ? feature.contentPlaintext : '';
      const contentHtml = renderLeafletText(contentText, feature?.contentFacets, footnotes);
      const number = (footnotes?.length || 0) + 1;
      footnotes?.push({ id, number, html: contentHtml });
      return `<sup class="prose-footnote-ref" id="fnref-${number}"><a href="#fn-${number}" aria-label="Footnote ${number}">${number}</a></sup>`;
    }).join('');
  };

  const boundaries = new Set<number>([0, characters.length]);
  intervals.forEach(({ start, end }) => { boundaries.add(start); boundaries.add(end); });
  markersByPosition.forEach((_value, position) => boundaries.add(position));
  const sorted = [...boundaries].sort((a, b) => a - b);

  const wrap = (html: string, feature: LeafletSpanFeature): string => {
    switch (feature.kind) {
      case 'link': return `<a href="${escapeHtml(feature.href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
      case 'bold': return `<strong>${html}</strong>`;
      case 'italic': return `<em>${html}</em>`;
      case 'code': return `<code>${html}</code>`;
      case 'strikethrough': return `<del>${html}</del>`;
      case 'underline': return `<span class="prose-underline">${html}</span>`;
      case 'highlight': return `<mark>${html}</mark>`;
    }
  };

  let rendered = '';
  for (let index = 0; index < sorted.length; index += 1) {
    const position = sorted[index];
    rendered += emitMarkers(position);
    const next = sorted[index + 1];
    if (next === undefined || next <= position) continue;
    let segment = escapeHtml(characters.slice(position, next).join(''));
    const active = intervals.filter((interval) => interval.start <= position && interval.end >= next);
    const order = { highlight: 0, code: 1, italic: 2, strikethrough: 3, underline: 4, bold: 5, link: 6 } as const;
    active.sort((a, b) => order[a.feature.kind] - order[b.feature.kind]);
    for (const { feature } of active) segment = wrap(segment, feature);
    rendered += segment;
  }
  return rendered;
}

function collectFacetFootnotes(facets: any[], characters: string[], position: number, footnotes: LeafletFootnote[]) {
  for (const facet of facets || []) {
    for (const feature of facet?.features || []) {
      if (feature?.$type !== 'pub.leaflet.richtext.facet#footnote') continue;
      const contentText = typeof feature?.contentPlaintext === 'string' ? feature.contentPlaintext : '';
      const id = typeof feature?.footnoteId === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(feature.footnoteId)
        ? feature.footnoteId
        : `n${footnotes.length + 1}`;
      footnotes.push({
        id,
        number: footnotes.length + 1,
        html: renderLeafletText(contentText, feature?.contentFacets, footnotes),
      });
    }
  }
}

/**
 * Renders markdown content to HTML
 */
export async function renderMarkdown(content: string): Promise<string> {
  marked.setOptions({
    breaks: true,
    gfm: true,
    pedantic: false,
  });

  try {
    const html = await marked.parse(content);
    return sanitizeContentHtml(html || `<p>${escapeHtml(content)}</p>`);
  } catch (error) {
    console.error('Markdown parsing error:', error);
    return renderPlaintext(content);
  }
}

function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    copy: '©',
    gt: '>',
    ldquo: '“',
    lsquo: '‘',
    lt: '<',
    mdash: '—',
    nbsp: ' ',
    ndash: '–',
    quot: '"',
    rdquo: '”',
    rsquo: '’',
  };

  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, value: string) => {
    if (value[0] === '#') {
      const codePoint = value[1].toLowerCase() === 'x'
        ? Number.parseInt(value.slice(2), 16)
        : Number.parseInt(value.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }

    return namedEntities[value.toLowerCase()] ?? entity;
  });
}

function markdownDestination(value: string): string {
  return decodeHtmlEntities(value).replace(/\s/g, '%20').replace(/[()]/g, '\\$&');
}

function htmlTextToMarkdown(html: string): string {
  let markdown = html
    .replace(/<iframe\b([^>]*)>(?:[\s\S]*?<\/iframe\s*>)?|<iframe\b([^>]*)\/?>/gi, (_match, pairedAttributes: string | undefined, selfClosingAttributes: string | undefined) => {
      const attributes = pairedAttributes ?? selfClosingAttributes ?? '';
      const getAttribute = (name: string) => attributes.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] || '';
      const src = safeEmbedUrl(decodeHtmlEntities(getAttribute('src')));
      const srcdoc = decodeHtmlEntities(getAttribute('srcdoc'));
      if (!src && !srcdoc) return '';
      const title = decodeHtmlEntities(getAttribute('title')).trim().slice(0, 200) || 'Embedded content';
      const heightValue = getAttribute('style').match(/height\s*:\s*(\d{2,4})px/i)?.[1];
      const height = heightValue ? Math.max(180, Math.min(900, Number(heightValue))) : undefined;
      const payload = encodeURIComponent(JSON.stringify({ title, src, srcdoc, height }));
      return `\n\n:::cc-embed ${payload}\n\n`;
    })
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, contents: string) => {
      const language = contents.match(/<code\b[^>]*class=["'][^"']*language-([^ "';]+)[^"']*["']/i)?.[1] || '';
      const code = decodeHtmlEntities(contents.replace(/<[^>]*>/g, '')).replace(/\n+$/, '');
      return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    })
    .replace(/<img\b([^>]*)\/?>/gi, (_match, attributes: string) => {
      const getAttribute = (name: string) => attributes.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] || '';
      const alt = decodeHtmlEntities(getAttribute('alt')).replace(/([\\[\]])/g, '\\$1');
      const src = markdownDestination(getAttribute('src'));
      const title = getAttribute('title');
      return src ? `![${alt}](${src}${title ? ` "${decodeHtmlEntities(title).replace(/"/g, '\\"')}"` : ''})` : '';
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attributes: string, contents: string) => {
      const href = attributes.match(/\bhref=["']([^"']*)["']/i)?.[1];
      const label = contents.replace(/<[^>]*>/g, '').trim();
      return href ? `[${label || markdownDestination(href)}](${markdownDestination(href)})` : label;
    })
    .replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, tag: string, contents: string) => {
      const level = Number(tag[1]);
      const heading = contents.replace(/<[^>]*>/g, '').trim();
      return `\n\n${'#'.repeat(level)} ${heading}\n\n`;
    })
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, contents: string) => (
      `\n\n${contents.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim().split('\n').map((line: string) => `> ${line.trim()}`).join('\n')}\n\n`
    ))
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '')
    .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)\s*>/gi, '**$1**')
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)\s*>/gi, '*$1*')
    .replace(/<(?:del|s|strike)\b[^>]*>([\s\S]*?)<\/(?:del|s|strike)\s*>/gi, '~~$1~~')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, contents: string) => `\`${contents.replace(/`/g, '\\`')}\``)
    .replace(/<hr\b[^>]*\/?>/gi, '\n\n---\n\n')
    .replace(/<\/?(?:p|div|section|article|figure|figcaption|header|footer|main|aside)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');

  return decodeHtmlEntities(markdown)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Converts sanitized article HTML into readable Markdown.
 */
export function renderHtmlAsMarkdown(html: string): string {
  return htmlTextToMarkdown(html);
}

/** Converts raw iframe HTML in Markdown documents into the reader's safe embed block. */
export function renderMarkdownEmbeds(markdown: string): string {
  return markdown.replace(
    /<iframe\b[^>]*>(?:[\s\S]*?<\/iframe\s*>)?|<iframe\b[^>]*\/?>/gi,
    (iframe) => htmlTextToMarkdown(renderHtml(iframe)),
  );
}

function safeEmbedUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function renderLeafletEmbed(block: any, useSrcdoc = false): string {
  const aspectWidth = Number.isInteger(block.aspectRatio?.width) && block.aspectRatio.width > 0
    ? Math.min(block.aspectRatio.width, 10000)
    : undefined;
  const aspectHeight = Number.isInteger(block.aspectRatio?.height) && block.aspectRatio.height > 0
    ? Math.min(block.aspectRatio.height, 10000)
    : undefined;
  const ratio = aspectWidth && aspectHeight ? `${aspectWidth}/${aspectHeight}` : '16/9';
  const height = Number.isInteger(block.height) && block.height >= 16 && block.height <= 1600
    ? `height:${block.height}px;`
    : `aspect-ratio:${ratio};height:auto;`;
  const title = typeof block.title === 'string' && block.title.trim()
    ? block.title.trim().slice(0, 200)
    : typeof block.alt === 'string' && block.alt.trim()
      ? block.alt.trim().slice(0, 200)
      : 'Embedded content';

  if (useSrcdoc || typeof block.html === 'string') {
    if (typeof block.html !== 'string' || !block.html.trim()) return '';
    return `<iframe class="prose-embed" title="${escapeHtml(title)}" srcdoc="${escapeHtml(block.html)}" sandbox="allow-scripts allow-forms allow-presentation" referrerpolicy="no-referrer" loading="lazy" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen style="width:100%;${height}"></iframe>`;
  }

  const src = safeEmbedUrl(block.url);
  if (!src) return '';
  return `<iframe class="prose-embed" title="${escapeHtml(title)}" src="${escapeHtml(src)}" sandbox="allow-scripts allow-forms allow-presentation" referrerpolicy="no-referrer" loading="lazy" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen style="width:100%;${height}"></iframe>`;
}

function renderLeafletImage(item: any, defaultAlt: string): string {
  const imageRef = item?.image?.ref?.$link;
  if (!imageRef) return '';

  const aspectRatio = item.aspectRatio;
  const imageDid = item.image?.ref?.did || item.image?.did;
  const safeImageUrl = imageDid
    ? proxyBlobUrl({ did: imageDid, cid: imageRef })
    : `/api/blob/${encodeURIComponent(imageRef)}`;
  return `
    <figure class="prose-image-figure" style="aspect-ratio: ${aspectRatio?.width || 16}/${aspectRatio?.height || 9}">
      <img
        src="${escapeHtml(safeImageUrl)}"
        alt="${escapeHtml(item.alt || item.title || defaultAlt)}"
        class="prose-image"
        loading="lazy"
      />
    </figure>
  `;
}

function leafletHeadingId(text: string, used: Set<string>): string | undefined {
  const base = Array.from(text.toLowerCase())
    .map((character) => (/[a-z0-9]/.test(character) ? character : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  if (!base) return undefined;
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(slug);
  return slug;
}

function renderLeafletBlock(block: any, footnotes: LeafletFootnote[], headingIds: Set<string>): string {
  const blockType = block?.$type || '';
  const text = block?.plaintext || block?.text || '';

  if (blockType === 'pub.leaflet.blocks.text') {
    const sizeClass = block.textSize === 'large' ? ' prose-paragraph--large' : block.textSize === 'small' ? ' prose-paragraph--small' : '';
    return `<p class="prose-paragraph${sizeClass}">${renderLeafletText(text, block.facets, footnotes)}</p>`;
  }

  if (blockType === 'pub.leaflet.blocks.header') {
    const level = Math.min(4, Math.max(2, Number.isInteger(block.level) ? block.level + 1 : 2));
    const id = leafletHeadingId(text, headingIds);
    return `<h${level} class="prose-heading prose-heading--${level}"${id ? ` id="${id}"` : ''}>${renderLeafletText(text, block.facets, footnotes)}</h${level}>`;
  }

  if (blockType === 'pub.leaflet.blocks.blockquote') {
    return `<blockquote class="prose-blockquote">${renderLeafletText(text, block.facets, footnotes)}</blockquote>`;
  }

  if (blockType === 'pub.leaflet.blocks.unorderedList' || blockType === 'pub.leaflet.blocks.orderedList') {
    const tag = blockType === 'pub.leaflet.blocks.orderedList' ? 'ol' : 'ul';
    const items = (block.children || [])
      .map((item: any) => {
        const content = item?.content;
        const inner = content && typeof content === 'object'
          ? content.$type === 'pub.leaflet.blocks.text'
            ? renderLeafletText(content.plaintext || content.text || '', content.facets, footnotes)
            : renderLeafletBlock(content, footnotes, headingIds)
          : '';
        const nested = Array.isArray(item?.children) && item.children.length
          ? renderLeafletBlock({ $type: tag === 'ol' ? 'pub.leaflet.blocks.orderedList' : 'pub.leaflet.blocks.unorderedList', children: item.children }, footnotes, headingIds)
          : '';
        return inner || nested ? `<li>${inner}${nested}</li>` : '';
      })
      .filter(Boolean)
      .join('');
    return items ? `<${tag} class="prose-list">${items}</${tag}>` : '';
  }

  if (blockType === 'pub.leaflet.blocks.code') {
    const language = typeof block.language === 'string' && /^[a-zA-Z0-9#+_-]{1,40}$/.test(block.language) ? block.language : '';
    return `<pre class="prose-pre"><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(text)}</code></pre>`;
  }

  if (blockType === 'pub.leaflet.blocks.image') {
    return renderLeafletImage(block, 'Article image');
  }

  if (blockType === 'pub.leaflet.blocks.imageGallery') {
    const images = (block.images || [])
      .map((item: any) => renderLeafletImage(item, 'Article image'))
      .filter(Boolean)
      .join('');
    return images
      ? `<div class="prose-image-gallery" role="group" aria-label="Image gallery" tabindex="0">${images}</div>`
      : '';
  }

  if (blockType === 'pub.leaflet.blocks.iframe') {
    return renderLeafletEmbed(block);
  }

  if (blockType === 'pub.leaflet.blocks.html') {
    return renderLeafletEmbed(block, true);
  }

  if (blockType === 'pub.leaflet.blocks.horizontalRule') {
    return '<hr class="prose-rule">';
  }

  if (blockType === 'pub.leaflet.blocks.button') {
    const href = safeLinkUrl(block.url);
    const label = text || block.text || href;
    if (!href || !label) return '';
    return `<p class="prose-button-row"><a class="prose-button" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(label))}</a></p>`;
  }

  if (blockType === 'pub.leaflet.blocks.bskyPost') {
    const uri = typeof block.postRef?.uri === 'string' ? block.postRef.uri : '';
    const match = uri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
    if (!match) return '';
    const href = `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}`;
    return `<p class="prose-paragraph"><a href="${href}" target="_blank" rel="noopener noreferrer">View post on Bluesky</a></p>`;
  }

  // Fallback for text-bearing blocks (math, captions, unknown text blocks).
  if (text) {
    return `<p class="prose-paragraph">${renderLeafletText(text, block.facets, footnotes)}</p>`;
  }

  return '';
}

/**
 * Renders Leaflet document format (pub.leaflet.content) into prose HTML and
 * collects footnotes (pub.leaflet.richtext.facet#footnote) in reading order.
 */
export function renderLeafletDocument(content: string | object): { html: string; footnotes: LeafletFootnote[] } {
  const footnotes: LeafletFootnote[] = [];
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    if (parsed.$type !== 'pub.leaflet.content' || !Array.isArray(parsed.pages)) {
      return { html: '', footnotes };
    }
    const headingIds = new Set<string>();
    const html = parsed.pages
      .map((page: any) => (Array.isArray(page?.blocks) ? page.blocks : [])
        .map((blockWrapper: any) => renderLeafletBlock(blockWrapper?.block || blockWrapper, footnotes, headingIds))
        .filter(Boolean)
        .join(''))
      .join('');
    return { html, footnotes };
  } catch (error) {
    console.error('Leaflet rendering error:', error);
    return { html: '', footnotes };
  }
}

/**
 * Renders Leaflet document format (pub.leaflet.content)
 */
export function renderLeaflet(content: string): string {
  const { html, footnotes } = renderLeafletDocument(content);
  const notes = footnotes.length
    ? `<ol class="prose-footnotes">${footnotes.map((note) => `<li id="fn-${note.number}">${note.html} <a class="prose-footnote-back" href="#fnref-${note.number}" aria-label="Back to reference ${note.number}">↩</a></li>`).join('')}</ol>`
    : '';
  return html + notes;
}

/**
 * Renders rich text content (structured blocks format)
 */
export function renderRichtext(content: string): string {
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;

    // Handle array of blocks format
    if (Array.isArray(parsed)) {
      return parsed
        .map(block => {
          if (typeof block === 'string') {
            return `<p>${escapeHtml(block)}</p>`;
          }

          if (block.type === 'paragraph' || block.type === 'text') {
            const text = block.text || block.content || '';
            return `<p>${escapeHtml(text)}</p>`;
          }

          if (block.type === 'heading') {
            const level = block.level || 2;
            const text = block.text || block.content || '';
            return `<h${level}>${escapeHtml(text)}</h${level}>`;
          }

          if (block.type === 'image') {
            const src = block.src || block.url || '';
            const alt = block.alt || block.title || '';
            return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
          }

          if (block.type === 'link') {
            const href = block.href || block.url || '#';
            const text = block.text || block.title || href;
            return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
          }

          if (block.type === 'list' || block.type === 'ul' || block.type === 'ol') {
            const tag = block.type === 'ol' ? 'ol' : 'ul';
            const items = (block.items || [])
              .map((item: any) => {
                const itemText = typeof item === 'string' ? item : item.text || item.content || '';
                return `<li>${escapeHtml(itemText)}</li>`;
              })
              .join('');
            return `<${tag}>${items}</${tag}>`;
          }

          if (block.type === 'blockquote' || block.type === 'quote') {
            const text = block.text || block.content || '';
            return `<blockquote>${escapeHtml(text)}</blockquote>`;
          }

          if (block.type === 'code') {
            const code = block.code || block.content || '';
            const lang = block.language || '';
            return `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(code)}</code></pre>`;
          }

          // Fallback for unknown block types
          return '';
        })
        .filter(Boolean)
        .join('');
    }

    // Handle Leaflet content format
    if (typeof parsed === 'object' && parsed.$type === 'pub.leaflet.content') {
      return renderLeaflet(parsed);
    }

    // Handle object format with content array
    if (typeof parsed === 'object' && parsed.content && Array.isArray(parsed.content)) {
      return renderRichtext(JSON.stringify(parsed.content));
    }

    // Handle object with blocks
    if (typeof parsed === 'object' && parsed.blocks && Array.isArray(parsed.blocks)) {
      return renderRichtext(JSON.stringify(parsed.blocks));
    }

    // Fallback: treat as plaintext
    return renderPlaintext(JSON.stringify(parsed));
  } catch (error) {
    console.error('Rich text parsing error:', error);
    return renderPlaintext(content);
  }
}

/**
 * Main content renderer that auto-detects and renders based on format
 */
export async function renderContent(
  content: string,
  format?: ContentFormat | string,
  mimeType?: string
): Promise<string> {
  if (!content || !content.trim()) {
    return '';
  }

  // Determine format
  const detectedFormat = format
    ? (Object.values(ContentFormat).includes(format as ContentFormat)
        ? (format as ContentFormat)
        : detectFormat(content, mimeType))
    : detectFormat(content, mimeType);

  // Render based on format
  switch (detectedFormat) {
    case ContentFormat.MARKDOWN:
      return await renderMarkdown(content);

    case ContentFormat.HTML:
      return renderHtml(content);

    case ContentFormat.RICHTEXT:
      return sanitizeContentHtml(renderRichtext(content));

    case ContentFormat.PLAINTEXT:
    case ContentFormat.UNKNOWN:
    default:
      return renderPlaintext(content);
  }
}

/**
 * Process images in rendered content (proxy URLs, add alt text, etc.)
 */
export function processImages(html: string, proxyImageUrl: (url: string) => string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const sourceMatch = tag.match(/\bsrc="([^"]+)"/i);
    if (!sourceMatch) return tag;

    const proxiedTag = tag.replace(sourceMatch[1], proxyImageUrl(sourceMatch[1]));
    const attributes = /\bloading=|\bdecoding=/i.test(proxiedTag)
      ? ''
      : ' loading="lazy" decoding="async"';
    return proxiedTag.replace(/\s*\/?>$/, `${attributes}>`);
  });
}

/**
 * Add classes to rendered content for better styling
 */
export function enhanceHtmlStructure(html: string): string {
  // Add prose classes to common elements for styling
  const enhancements: [RegExp, string][] = [
    [/<p>/g, '<p class="prose-paragraph">'],
    [/<h2>/g, '<h2 class="prose-heading prose-heading--2">'],
    [/<h3>/g, '<h3 class="prose-heading prose-heading--3">'],
    [/<h4>/g, '<h4 class="prose-heading prose-heading--4">'],
    [/<blockquote>/g, '<blockquote class="prose-blockquote">'],
    [/<code>/g, '<code class="prose-code">'],
    [/<pre>/g, '<pre class="prose-pre">'],
    [/<ul>/g, '<ul class="prose-list prose-list--unordered">'],
    [/<ol>/g, '<ol class="prose-list prose-list--ordered">'],
    [/<img/g, '<img class="prose-image"'],
    [/<table>/g, '<table class="prose-table">'],
    [/<a /g, '<a class="prose-link" '],
  ];

  let enhanced = html;
  for (const [pattern, replacement] of enhancements) {
    enhanced = enhanced.replace(pattern, replacement);
  }

  return enhanced;
}

/**
 * Estimated reading time in minutes at roughly 200 words per minute.
 * Returns 0 when the content has no readable text.
 */
export function readingTimeMinutes(content: string, mimeType?: string): number {
  const words = toPlainText(content, mimeType).split(/\s+/).filter(Boolean).length;
  return words ? Math.max(1, Math.ceil(words / 200)) : 0;
}
