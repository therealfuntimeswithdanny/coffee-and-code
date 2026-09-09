import { marked } from 'marked';

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
  // Basic sanitization: remove script tags and event handlers
  const sanitized = content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/on\w+\s*=\s*[^\s>]*/gi, '')
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<object[^>]*>.*?<\/object>/gi, '');

  return sanitized;
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
    return html || `<p>${escapeHtml(content)}</p>`;
  } catch (error) {
    console.error('Markdown parsing error:', error);
    return renderPlaintext(content);
  }
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
                return `<p class="prose-paragraph">${escapeHtml(text)}</p>`;
              }

              // Handle Leaflet image blocks
              if (blockType === 'pub.leaflet.blocks.image') {
                const imageRef = block.image?.ref?.$link;
                if (!imageRef) return '';

                const aspectRatio = block.aspectRatio;
                const paddingBottom = aspectRatio
                  ? `${(aspectRatio.height / aspectRatio.width) * 100}%`
                  : '66.67%';

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
      return renderRichtext(content);

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
  return html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (_match: string, before: string, source: string, after: string) => {
    return `${before}${proxyImageUrl(source)}${after}`;
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
