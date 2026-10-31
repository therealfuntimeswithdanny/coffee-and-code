const PRIVO_STOP_URL = 'https://privo.fyi/p/stop';
const SITE_NAME = 'Coffee & Code';
const SITE_URL = 'https://coffeencode.cc';

/** Route an external destination through Privo's stop page. */
export function externalLinkUrl(destination: string): string {
  let target: URL;
  try {
    target = new URL(destination);
  } catch {
    return destination;
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') return destination;
  if (target.hostname === 'privo.fyi' || target.hostname.endsWith('.privo.fyi')) return destination;
  if (target.hostname === 'coffeencode.cc' || target.hostname.endsWith('.coffeencode.cc')) return destination;

  const stopUrl = new URL(PRIVO_STOP_URL);
  stopUrl.searchParams.set('url', target.toString());
  stopUrl.searchParams.set('viaPrivo', 'false');
  stopUrl.searchParams.set('sourceSiteName', SITE_NAME);
  stopUrl.searchParams.set('sourceSiteUrl', SITE_URL);
  return stopUrl.toString();
}

/** Rewrite external href attributes while preserving the rest of rendered markup. */
export function routeExternalLinks(html: string): string {
  return html.replace(/\bhref\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi, (match, quote: string, destination: string) => {
    const routed = externalLinkUrl(destination);
    return routed === destination ? match : `href=${quote}${routed}${quote}`;
  });
}
