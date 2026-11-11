import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

function sanitizeContentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'h1', 'h2', 'h3', 'h4', 'img', 'pre', 'code', 'hr', 'del',
      'figure', 'figcaption', 'iframe', 'table', 'thead', 'tbody', 'tfoot',
      'tr', 'th', 'td', 'sup', 'sub',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'class'],
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

function renderLeafletText(text: string, facets: any[] = []): string {
  const linkRanges = facets
    .map(facet => {
      const feature = facet?.features?.find(
        (candidate: any) => candidate?.$type === 'pub.leaflet.richtext.facet#link'
      );
      const href = safeLinkUrl(feature?.uri);
      const byteStart = facet?.index?.byteStart;
      const byteEnd = facet?.index?.byteEnd;

      if (!href || !Number.isInteger(byteStart) || !Number.isInteger(byteEnd) || byteStart < 0 || byteEnd <= byteStart) {
        return undefined;
      }

      return { byteStart, byteEnd, href };
    })
    .filter((range): range is { byteStart: number; byteEnd: number; href: string } => Boolean(range))
    .sort((left, right) => left.byteStart - right.byteStart);

  if (!linkRanges.length) return escapeHtml(text);

  const characters = Array.from(text);
  const byteOffsets = [0];
  for (const character of characters) {
    byteOffsets.push(byteOffsets[byteOffsets.length - 1] + new TextEncoder().encode(character).length);
  }

  const indexForByteOffset = (offset: number): number => {
    const index = byteOffsets.indexOf(offset);
    return index >= 0 ? index : characters.length;
  };

  let rendered = '';
  let characterIndex = 0;
  for (const range of linkRanges) {
    const start = Math.max(characterIndex, indexForByteOffset(range.byteStart));
    const end = Math.max(start, indexForByteOffset(range.byteEnd));
    if (start > characterIndex) rendered += escapeHtml(characters.slice(characterIndex, start).join(''));
    if (end > start) {
      rendered += `<a href="${escapeHtml(range.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(characters.slice(start, end).join(''))}</a>`;
      characterIndex = end;
    }
  }

  return rendered + escapeHtml(characters.slice(characterIndex).join(''));
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

/**
 * Renders Leaflet document format (pub.leaflet.content)
 */
export function renderLeaflet(content: string): string {
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;

    // Handle Leaflet content format
    if (parsed.$type === 'pub.leaflet.content' && parsed.pages && Array.isArray(parsed.pages)) {
      return parsed.pages
        .map((page: any) => {
          if (!page.blocks || !Array.isArray(page.blocks)) return '';

          return page.blocks
            .map((blockWrapper: any) => {
              const block = blockWrapper.block || blockWrapper;
              const blockType = block.$type || '';

              // Handle Leaflet text blocks
              if (blockType === 'pub.leaflet.blocks.text') {
                const text = block.plaintext || block.text || '';
                return `<p class="prose-paragraph">${renderLeafletText(text, block.facets)}</p>`;
              }

              // Handle Leaflet blockquote blocks
              if (blockType === 'pub.leaflet.blocks.blockquote') {
                const text = block.plaintext || block.text || '';
                return `<blockquote>${escapeHtml(text).replace(/\n/g, '<br>')}</blockquote>`;
              }

              // Handle Leaflet image blocks
              if (blockType === 'pub.leaflet.blocks.image') {
                const imageRef = block.image?.ref?.$link;
                if (!imageRef) return '';

                const aspectRatio = block.aspectRatio;

                return `
                  <figure class="prose-image-figure" style="aspect-ratio: ${aspectRatio?.width || 16}/${aspectRatio?.height || 9}">
                    <img
                      src="/api/blob/${imageRef}"
                      alt="Article image"
                      class="prose-image"
                      loading="lazy"
                    />
                  </figure>
                `;
              }

              if (blockType === 'pub.leaflet.blocks.imageGallery') {
                const images = (block.images || [])
                  .map((item: any) => {
                    const imageRef = item.image?.ref?.$link;
                    if (!imageRef) return '';

                    const aspectRatio = item.aspectRatio;
                    return `
                      <figure class="prose-image-figure" style="aspect-ratio: ${aspectRatio?.width || 16}/${aspectRatio?.height || 9}">
                        <img
                          src="/api/blob/${escapeHtml(imageRef)}"
                          alt="Article image"
                          class="prose-image"
                          loading="lazy"
                        />
                      </figure>
                    `;
                  })
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

              return '';
            })
            .filter(Boolean)
            .join('');
        })
        .join('');
    }

    return '';
  } catch (error) {
    console.error('Leaflet rendering error:', error);
    return '';
  }
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
