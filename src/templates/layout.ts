import { Context } from 'hono';
import { Env } from '../types';
import { externalLinkUrl } from '../lib/externalLinks';


export function browserRenderOgImage(c: Context<{ Bindings: Env }>) {
  return new URL('/og.png', c.req.url).toString();
}

/**
 * Screenshot of a page rendered by the browser-run service.
 * Used as the visual for posts that have no cover image.
 */
export function browserRunScreenshotUrl(path: string) {
  const target = `https://coffeencode.cc${path}${path.includes('?') ? '&' : '?'}browserRun=true`;
  return `https://browser-run.coffeencode.cc/?url=${encodeURIComponent(target)}`;
}

export function renderLayout(
  c: Context<{ Bindings: Env }>,
  title: string,
  content: string,
  metaTags = '',
  documentTitle?: string,
  browserRun = false,
  scripts: { comments?: boolean; forum?: boolean } = {},
) {
  const pubName = c.env.PUB_NAME || 'Coffee and Code';
  const pubDescription = c.env.PUB_DESCRIPTION || 'A small tech news publication built on the AT Protocol by Daniel Morrisey';
  const did = c.env.OWNER_DID || '';
  const pageTitle = documentTitle || `${title} | ${pubName}`;
  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const descriptionTag = metaTags.includes('name="description"')
    ? ''
    : `<meta name="description" content="${escapeHtml(pubDescription)}">`;

  return `<!DOCTYPE html>
<html lang="en"${browserRun ? ' class="browser-run"' : ''}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  ${descriptionTag}
  <link rel="icon" type="image/x-icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="apple-touch-icon" href="/favicon.png">
  ${metaTags}
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(pubName)} RSS Feed" href="/rss.xml">
  ${scripts.comments ? '<script type="module" src="/components/sequoia-comments.js"></script>' : ''}
  ${scripts.forum ? '<script type="module" src="/components/forum.js"></script>' : ''}
  <link rel="modulepreload" href="/components/atproto-auth.js">
  <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>
  <link rel="preload" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/webfonts/fa-solid-900.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/webfonts/fa-brands-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@400;500;600;700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
  <link rel="preload" as="style" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css"></noscript>
  <style>
    @font-face { font-family: "Font Awesome 6 Free"; font-style: normal; font-weight: 900; font-display: swap; src: url("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/webfonts/fa-solid-900.woff2") format("woff2"); }
    @font-face { font-family: "Font Awesome 6 Brands"; font-style: normal; font-weight: 400; font-display: swap; src: url("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/webfonts/fa-brands-400.woff2") format("woff2"); }
    .prose .prose-image-gallery { display: flex; gap: 12px; overflow-x: auto; overscroll-behavior-inline: contain; scroll-snap-type: x mandatory; }
    .prose .prose-image-gallery figure { flex: 0 0 min(100%, 360px); margin: 0; scroll-snap-align: start; }
    :root { --ink: #ffffff; --paper: #281914; --paper-deep: #3b2a1d; --accent: #b2ac88; --muted: #b2ac88; --line: rgba(178, 172, 136, .42); --line-strong: #b2ac88; --page-width: 1100px; }
    .browser-run .site-header [data-login-link] { display: none !important; }
    .browser-run .mobile-nav .login-button { display: none !important; }
    .browser-run .site-footer, .browser-run .back-to-top { display: none !important; }
    .browser-run .page-content { padding-top: 32px; }
    .browser-run .article-layout { display: block; max-width: 820px; }
    .browser-run .article { margin: 0 auto; max-width: 820px; }
    .browser-run .article-rail, .browser-run .recommendations { display: none !important; }
    * { box-sizing: border-box; } html, body { min-height: 100%; overflow-x: clip; } body { display: flex; flex-direction: column; margin: 0; min-width: 320px; background: var(--paper); color: var(--ink); font-family: var(--ui-font, 'Source Sans 3', sans-serif); font-size: 18px; line-height: 1.45; }
    a { color: inherit; text-decoration: none; } a:hover { color: var(--accent); } .site-header { border-bottom: 1px solid var(--line-strong); background: var(--paper); position: sticky; top: 0; z-index: 100; } .header-inner, .page-content, .footer-inner { width: min(var(--page-width), calc(100% - 48px)); margin: 0 auto; }
      .header-inner { min-height: 100px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 24px; transition: min-height 180ms ease; } .site-nav, .header-links { display: flex; align-items: center; gap: 24px; font-size: 14px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; } .header-links { justify-content: flex-end; }.site-brand { font-family: Lora, serif; font-size: clamp(1.55rem, 3vw, 2.3rem); font-weight: 700; letter-spacing: -.06em; white-space: nowrap; transition: font-size 180ms ease; }.site-header.is-compact { box-shadow: 0 3px 16px rgba(0, 0, 0, .2); }.site-header.is-compact .header-inner { min-height: 68px; }.site-header.is-compact .site-brand { font-size: clamp(1.35rem, 2.5vw, 1.9rem); }
    .subscribe-button { background: var(--accent); color: var(--paper); padding: 8px 13px; }.subscribe-button:hover { background: var(--ink); color: var(--paper); }
    .login-button { align-items: center; background: var(--accent); border: 1px solid var(--accent); color: var(--paper); display: inline-flex; font-size: 12px; font-weight: 700; justify-content: center; letter-spacing: .08em; min-height: 38px; padding: 8px 15px; text-transform: uppercase; transition: background 160ms, color 160ms; white-space: nowrap; }
    [data-login-link][hidden] { display: none !important; }
    .login-button:hover { background: transparent; color: var(--accent); }
    .hamburger-button { display: none; background: none; border: none; cursor: pointer; color: var(--accent); font-size: 24px; padding: 8px; align-items: center; }
    .header-back { align-items: center; background: none; border: 1px solid transparent; border-radius: 50%; color: var(--accent); cursor: pointer; display: none; font-size: 15px; height: 34px; justify-content: center; padding: 0; width: 34px; }
    .header-back:hover { border-color: var(--line-strong); color: var(--ink); }
    .search-button-icon { background: none; border: none; cursor: pointer; color: inherit; font-family: inherit; font-size: 14px; padding: 8px 12px; text-transform: uppercase; font-weight: 700; letter-spacing: .04em; }
    .search-button-icon:hover { color: var(--accent); }
    .header-icon-actions { align-items: center; display: inline-flex; gap: 4px; }
    .header-icon-actions .search-button-icon, .header-icon-actions .pds-link { align-items: center; display: inline-flex; flex: 0 0 36px; font-size: 16px; height: 36px; justify-content: center; line-height: 1; padding: 8px; width: 36px; }
    .header-notifications-icon { align-items: center; display: inline-flex; }
    .header-notifications-icon { position: relative; }
    .notification-badge { align-items: center; background: #ed6b79; border: 2px solid var(--paper); border-radius: 999px; color: #fff; display: inline-flex; font: 700 10px/1 'Source Sans 3', sans-serif; height: 18px; justify-content: center; min-width: 18px; padding: 0 4px; position: absolute; right: -5px; top: -4px; }
    .notification-badge[hidden] { display: none !important; }
    .mobile-nav [data-notifications-link] { position: relative; }
    .search-button-link { background: none; border: 0; cursor: pointer; font-family: inherit; padding: 0; text-align: left; }
    .search-modal { --search-snippet-background: var(--paper); --search-snippet-surface: var(--paper-deep); --search-snippet-border-color: var(--line-strong); --search-snippet-border-radius: 3px; --search-snippet-border-radius-sm: 3px; --search-snippet-primary-color: var(--accent); --search-snippet-primary-hover: var(--ink); --search-snippet-hover: var(--accent); --search-snippet-hover-background: rgba(178, 172, 136, .12); --search-snippet-text-color: var(--ink); --search-snippet-text-secondary: var(--muted); --search-snippet-text-description: var(--muted); --search-snippet-font-family: 'Source Sans 3', sans-serif; --search-snippet-font-family-mono: 'Source Sans 3', sans-serif; --search-snippet-font-size-base: 16px; --search-snippet-font-size-sm: 14px; --search-snippet-focus-ring: 0 0 0 2px var(--accent); --search-snippet-shadow: 0 12px 28px rgba(0, 0, 0, .24); --search-snippet-result-item-shadow: none; }
    .mobile-nav { display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--paper-deep); border-bottom: 1px solid var(--line-strong); flex-direction: column; gap: 0; padding: 12px 0; z-index: 99; }
    .mobile-nav.active { display: flex; }
    .mobile-nav a { padding: 12px 24px; border-bottom: 1px solid var(--line); }
    .mobile-nav a:last-child { border-bottom: none; }
    .mobile-nav .login-button { align-self: flex-start; margin: 12px 24px; }
    .page-content { flex: 1 0 auto; padding: 40px 0 60px; }.eyebrow, .section-heading, .recent-stories__heading { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .1em; line-height: 1.2; text-transform: uppercase; }.publication-intro .eyebrow { margin: 0 0 10px; color: var(--accent); }.publication-intro h1 { margin: 0; font-family: Lora, serif; font-size: clamp(2.7rem, 7vw, 5rem); letter-spacing: -.065em; line-height: .98; }.publication-intro > p:last-child { max-width: 580px; margin: 16px 0 0; color: var(--muted); font-size: 21px; }
    .section-heading { display: flex; justify-content: space-between; border-top: 2px solid var(--line-strong); border-bottom: 1px solid var(--line); color: var(--ink); padding: 10px 0; }.section-heading span:last-child { color: var(--muted); }.front-page__grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(300px, .85fr); gap: 38px; padding-top: 28px; }.lead-story { border-bottom: 1px solid var(--line); padding-bottom: 25px; }.lead-image { display: block; aspect-ratio: 1.75 / 1; background: var(--paper-deep); overflow: hidden; }.lead-image--placeholder, .story-image--placeholder { align-items: end; background: linear-gradient(130deg, var(--paper), var(--accent)); color: var(--ink); display: flex; font-family: Lora, serif; font-size: 30px; justify-content: center; padding: 30px; }.story-image { display: block; height: 100%; object-fit: cover; width: 100%; }.lead-story__content { max-width: 850px; padding-top: 20px; }.lead-story .eyebrow, .archive-story .eyebrow { margin: 0 0 7px; color: var(--accent); } h1, h2, h3 { font-family: Lora, serif; font-weight: 600; letter-spacing: -.045em; line-height: 1.1; }.lead-story h2 { font-size: clamp(2rem, 4.2vw, 3.45rem); margin: 0; }.lead-story__summary { color: var(--muted); font-size: 20px; line-height: 1.35; margin: 13px 0 17px; }.story-footer, .archive-story__footer { align-items: center; display: flex; gap: 18px; justify-content: space-between; }.article-meta--byline { color: var(--accent); }.article-meta--byline a { color: inherit; }.read-link { color: var(--accent); font-size: 14px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }.recent-stories { border-top: 2px solid var(--line-strong); }.recent-stories__heading { color: var(--ink); padding: 11px 0; }.most-read { margin-top: 56px; }.most-read__list { display: grid; grid-template-columns: 1fr 1fr; gap: 0 40px; list-style: none; margin: 0; padding: 0; }.most-read__item { border-top: 1px solid var(--line); }.most-read__item a { align-items: baseline; display: flex; gap: 18px; padding: 14px 0; }.most-read__rank { color: var(--accent); flex-shrink: 0; font-family: Lora, serif; font-size: 26px; font-weight: 600; line-height: 1; min-width: 26px; }.most-read__title { color: var(--ink); display: block; font-family: Lora, serif; font-size: 19px; line-height: 1.25; }.most-read__item a:hover .most-read__title { color: var(--accent); }.most-read__meta { color: var(--muted); display: block; font-size: 13px; margin-top: 4px; }@media (max-width: 760px) { .most-read__list { grid-template-columns: 1fr; } }.side-story { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 6px; display: grid; gap: 14px; grid-template-columns: 100px minmax(0, 1fr); padding: 12px; margin-bottom: 14px; transition: all 200ms; cursor: pointer; }.side-story:last-child { border-bottom: 1px solid var(--line); margin-bottom: 0; }.side-story:hover { border-color: var(--accent); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); transform: translateY(-2px); }.side-story__image { aspect-ratio: 1 / 1; overflow: hidden; border-radius: 4px; flex-shrink: 0; }.side-story h3 { font-size: 16px; margin: 0 0 6px; line-height: 1.3; }.empty-state { color: var(--muted); }.writers-callout { align-items: center; background: var(--paper-deep); border: 1px solid var(--line); display: flex; gap: 28px; justify-content: space-between; margin-top: 56px; padding: 28px 32px; }.writers-callout .eyebrow { color: var(--accent); margin: 0 0 8px; }.writers-callout h2 { font-size: clamp(1.6rem, 3vw, 2.3rem); margin: 0; }.writers-callout p:not(.eyebrow) { color: var(--muted); margin: 10px 0 0; max-width: 650px; }.archive-section { margin-top: 64px; }.archive-section__footer { margin-top: 24px; text-align: right; }.archive-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }.archive-story { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 6px; display: flex; flex-direction: column; gap: 0; justify-content: space-between; min-height: 380px; padding: 0; overflow: hidden; transition: all 200ms; cursor: pointer; }.archive-story:hover { border-color: var(--accent); box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4); transform: translateY(-3px); }.archive-story__image { aspect-ratio: 1.55 / 1; overflow: hidden; background: var(--paper); flex-shrink: 0; }.archive-story h3 { font-size: 18px; margin: 0 0 6px; padding: 14px 14px 0 14px; line-height: 1.3; }.archive-story p:not(.eyebrow) { color: var(--muted); font-size: 14px; margin: 0; padding: 6px 14px 0 14px; line-height: 1.5; }.archive-story .eyebrow { padding: 14px 14px 6px 14px; }.archive-story__footer { margin-top: auto; padding: 12px 14px 14px; }.archive-page .archive-story { min-height: 0; } .archive-search { margin-bottom: 42px; } .archive-page .archive-grid { margin-top: 28px; }
    .dek--clamped { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2lh; }
    .article { margin: 0 auto; max-width: 820px; }.article__back { color: var(--accent); display: inline-block; font-size: 14px; font-weight: 700; letter-spacing: .04em; margin-bottom: 40px; text-transform: uppercase; }.article__header { border-bottom: 1px solid var(--line); margin-bottom: 28px; padding-bottom: 28px; }.article__header .eyebrow { color: var(--accent); margin: 0 0 12px; }.article__header h1 { font-size: clamp(2.5rem, 6vw, 4.6rem); margin: 0; }.article__dek { color: var(--muted); font-family: Lora, serif; font-size: 22px; line-height: 1.4; margin: 18px 0 0; }.article__cover { aspect-ratio: 1.8 / 1; margin: 28px 0; overflow: hidden; width: 100%; max-width: 820px; }.article__cover img, .article__cover .story-image { width: 100% !important; height: 100% !important; max-width: 820px !important; object-fit: cover; display: block; }.prose { max-width: 820px; }.prose figure, .prose-image-figure { max-width: 820px; margin: 1.8rem 0; }.prose figure img, .prose img, .prose-image, .prose-image-figure img { display: block; width: 100% !important; max-width: 820px !important; height: auto !important; margin: 0; border-radius: 4px; }.prose p, .prose li, .prose-paragraph { color: var(--muted); line-height: 1.75; margin: 1.2em 0; }.prose h2, .prose-heading--2 { font-size: 2rem; margin: 2.2em 0 .6em; }.prose h3, .prose-heading--3 { font-size: 1.5rem; margin: 1.8em 0 .5em; }.prose h4, .prose-heading--4 { font-size: 1.2rem; margin: 1.5em 0 .4em; }.prose-heading { font-family: Lora, serif; font-weight: 600; letter-spacing: -.045em; line-height: 1.1; color: var(--ink); }.prose a, .prose-link { color: var(--accent); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }.prose a:hover, .prose-link:hover { color: var(--ink); }.prose blockquote, .prose-blockquote { border-left: 3px solid var(--accent); color: var(--ink); font-family: Lora, serif; font-size: 1.35rem; margin: 1.8rem 0; padding-left: 24px; font-style: italic; }.prose code, .prose-code { background: var(--paper-deep); border-radius: 3px; padding: .15rem .3rem; font-family: 'Source Sans 3', monospace; font-size: .9em; }.prose pre, .prose-pre { background: var(--paper-deep); border: 1px solid var(--line); color: var(--ink); overflow-x: auto; padding: 1rem; border-radius: 4px; margin: 1.8rem 0; }.prose pre code, .prose-pre .prose-code { background: transparent; padding: 0; }.prose ul, .prose-list--unordered { list-style-type: disc; margin-left: 1.5em; margin: 1.2em 0 1.2em 1.5em; }.prose ol, .prose-list--ordered { list-style-type: decimal; margin-left: 1.5em; margin: 1.2em 0 1.2em 1.5em; }.prose-list li { margin: 0.4em 0; }.prose table, .prose-table { width: 100%; border-collapse: collapse; margin: 1.8rem 0; }.prose table th, .prose-table th { background: var(--paper-deep); border: 1px solid var(--line); padding: 0.8rem; text-align: left; font-weight: 600; }.prose table td, .prose-table td { border: 1px solid var(--line); padding: 0.8rem; }.prose table tr:nth-child(even), .prose-table tr:nth-child(even) { background: rgba(40, 25, 20, 0.3); }.article__footer { border-top: 1px solid var(--line); display: flex; font-size: 14px; gap: 24px; justify-content: flex-end; margin-top: 56px; padding-top: 24px; }.article__footer a { color: var(--accent); }.article-sources { border-top: 1px solid var(--line); margin-top: 48px; padding-top: 24px; }.article-sources h2 { font-size: 14px; font-weight: 700; letter-spacing: .08em; margin: 0 0 12px; text-transform: uppercase; }.article-sources ul { list-style: none; margin: 0; padding: 0; }.article-sources li { margin: .5em 0; }.article-sources a { color: var(--accent); text-decoration: none; }.article-sources a:hover { color: var(--ink); text-decoration: underline; }
    .not-found { margin: 60px auto; max-width: 600px; }.not-found h1 { font-size: 3rem; margin: 8px 0; }.not-found p:not(.eyebrow) { color: var(--muted); margin-bottom: 24px; }.not-found__actions { display: flex; flex-direction: column; gap: 12px; }.not-found__actions a { display: inline-block; }
    .back-to-top { position: fixed; bottom: 32px; right: 32px; width: 48px; height: 48px; background: var(--accent); color: var(--paper); border: none; border-radius: 50%; cursor: pointer; display: none; align-items: center; justify-content: center; font-size: 20px; z-index: 50; transition: opacity 200ms; }.back-to-top.show { display: flex; }.back-to-top:hover { background: var(--ink); }
    .site-footer { background: var(--paper-deep); border-top: 1px solid var(--line-strong); color: var(--ink); flex-shrink: 0; padding: 54px 0 32px; }.footer-inner { display: grid; gap: 38px; grid-template-columns: 1.5fr 1fr 1fr; }.footer-brand { font-family: Lora, serif; font-size: clamp(1.7rem, 3vw, 2.5rem); font-weight: 600; letter-spacing: -.05em; margin: 0 0 8px; }.footer-tagline { color: var(--muted); margin: 0; }.footer-brand-block { grid-column: 1 / -1; }.footer-heading { color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .1em; margin: 5px 0 12px; text-transform: uppercase; }.footer-links { display: grid; gap: 8px; }.footer-links a { color: var(--ink); width: fit-content; }.footer-social { display: flex; gap: 16px; margin-top: 16px; }.footer-social a { color: var(--accent); font-size: 18px; transition: color 200ms; }.footer-social a:hover { color: var(--ink); }.footer-meta { color: var(--muted); font-size: 14px; grid-column: 1 / -1; margin: 0; padding-top: 12px; border-top: 1px solid var(--line); }
    @media (max-width: 760px) { .header-inner { grid-template-columns: 1fr 1fr auto; min-height: 76px; gap: 12px; }.site-header.is-compact .header-inner { min-height: 56px; }.site-nav { display: none; }.hamburger-button { display: flex; }.header-links { gap: 8px; }.header-links .pds-link { display: none; }.page-content { padding-top: 32px; }.front-page__grid { grid-template-columns: 1fr; gap: 38px; }.archive-grid { grid-template-columns: 1fr; gap: 0; }.archive-story { min-height: 0; }.archive-story__image { aspect-ratio: 1.8 / 1; }.footer-inner { grid-template-columns: 1fr 1fr; }.footer-brand-block { grid-column: 1 / -1; }.article__footer { flex-direction: column; gap: 12px; }.search-form { grid-template-columns: 1fr; }.back-to-top { width: 44px; height: 44px; right: 16px; bottom: 16px; font-size: 18px; } } @media (max-width: 480px) { .header-inner, .page-content, .footer-inner { width: min(100% - 32px, var(--page-width)); }.site-brand { font-size: 1.35rem; }.header-links { font-size: 11px; }.side-story { grid-template-columns: 88px minmax(0, 1fr); }.footer-inner { grid-template-columns: 1fr; gap: 24px; }.footer-brand-block { grid-column: auto; } }
    .article__reading-time { color: var(--muted); font-size: 14px; margin: 10px 0 0; }.article__author { align-items: center; color: var(--accent); display: inline-flex; font-size: 16px; font-weight: 600; gap: 10px; margin-top: 20px; }.article__author:hover { color: var(--ink); }.article__author-avatar { border-radius: 50%; height: 36px; object-fit: cover; width: 36px; }.article__author-avatar--placeholder { background: var(--accent); display: block; }.view-counter, .comment-counter { color: var(--muted); font-size: 12px; white-space: nowrap; }.article-meta { align-items: center; display: inline-flex; flex-wrap: wrap; gap: 8px; }.article-view-counter { display: block; margin-top: 18px; }
    .author-page__header { align-items: center; display: flex; gap: 20px; margin-bottom: 36px; }.author-page__header h1 { margin: 0; }.author-page__header p:last-child { color: var(--muted); margin: 6px 0 0; }.author-page__avatar { border-radius: 50%; height: 88px; object-fit: cover; width: 88px; }
    .author-follow { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; margin: -20px 0 34px; }.author-follow__button { background: var(--accent); border: 1px solid var(--accent); color: var(--paper); cursor: pointer; font: 700 13px 'Source Sans 3', sans-serif; min-height: 38px; padding: 8px 18px; }.author-follow__button[aria-pressed="true"] { background: transparent; color: var(--accent); }.author-follow__button:disabled { cursor: wait; opacity: .65; }.author-follow__count { color: var(--muted); font-size: 14px; }.author-follow__status { color: var(--muted); flex-basis: 100%; font-size: 13px; }
    .author-page__profile-link { align-items: center; border: 1px solid var(--line-strong); color: var(--accent); display: inline-flex; font-size: 13px; gap: 8px; min-height: 38px; padding: 8px 14px; text-decoration: none; }
    .author-germ { align-items: center; background: var(--accent); border: 1px solid var(--accent); color: var(--paper); display: inline-flex; font: 700 13px 'Source Sans 3', sans-serif; gap: 8px; min-height: 38px; padding: 8px 18px; text-decoration: none; }
    .author-germ:hover { color: var(--paper); opacity: .9; }
    .author-germ[hidden] { display: none !important; }
    .author-germ img { display: block; height: 18px; width: 18px; }
    .user-page__banner { aspect-ratio: 3 / 1; background: var(--paper-deep); overflow: hidden; }.user-page__banner img { display: block; height: 100%; object-fit: cover; width: 100%; }.user-page__banner--empty { border-bottom: 1px solid var(--line); }.user-page__header { align-items: center; display: flex; gap: 20px; margin: -34px 0 20px 28px; position: relative; }.user-page__avatar { background: var(--paper-deep); border: 4px solid var(--paper); border-radius: 50%; flex: 0 0 104px; height: 104px; object-fit: cover; width: 104px; }.user-page__avatar--empty { align-items: center; color: var(--accent); display: flex; font-size: 34px; justify-content: center; }.user-page__identity { min-width: 0; }.user-page__identity .eyebrow { margin: 30px 0 2px; }.user-page__identity h1 { font-family: Lora, Georgia, serif; font-size: clamp(25px, 4vw, 38px); line-height: 1.1; margin: 0; overflow-wrap: anywhere; }.user-page__identity p:last-child { color: var(--muted); margin: 3px 0 0; }.user-page__bluesky { border: 1px solid var(--line-strong); font-size: 14px; margin-left: auto; padding: 8px 12px; white-space: nowrap; }.user-page__description { color: var(--ink); line-height: 1.65; margin: 0 0 12px 28px; max-width: 760px; white-space: pre-wrap; }.user-page__details { color: var(--muted); display: flex; flex-wrap: wrap; font-size: 13px; gap: 12px; margin: 0 0 34px 28px; }.user-page__did { overflow-wrap: anywhere; }.user-page__activity { margin-top: 24px; }.user-page__comment-limit { color: var(--muted); font-size: 14px; margin: 14px 0 0; }.user-comments { margin-top: 8px; }.user-comment { border-bottom: 1px solid var(--line); display: grid; gap: 20px; grid-template-columns: 130px minmax(0, 1fr); padding: 22px 8px; }.user-comment__date { color: var(--muted); font-size: 13px; padding-top: 4px; }.user-comment__context { color: var(--muted); font-size: 14px; margin: 0 0 8px; }.user-comment__context a { color: var(--accent); font-weight: 600; }.user-comment__text { line-height: 1.6; margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }.user-comment__permalink { color: var(--muted); display: inline-block; font-size: 13px; margin-top: 12px; }.user-comment__permalink:hover { color: var(--accent); }
    .author-page__avatar--empty { align-items: center; background: var(--paper-deep); color: var(--accent); display: inline-flex; font-size: 30px; justify-content: center; }
    .user-tabs { border-bottom: 1px solid var(--line-strong); display: flex; flex-wrap: wrap; gap: 22px; margin-top: 8px; }
    .user-tabs__tab { border-bottom: 2px solid transparent; color: var(--muted); font: 700 13px 'Source Sans 3', sans-serif; letter-spacing: .05em; margin-bottom: -1px; padding: 10px 2px; text-decoration: none; text-transform: uppercase; }
    .user-tabs__tab:hover { color: var(--ink); }
    .user-tabs__tab--active, .user-tabs__tab[aria-selected="true"] { border-color: var(--accent); color: var(--accent); }
    .user-tabs__tab span { color: var(--muted); font-weight: 400; }
    .author-page__banner { aspect-ratio: 3 / 1; display: block; margin: 0 calc(50% - (100vw - 48px) / 2) 24px; max-width: calc(100vw - 48px); object-fit: cover; width: calc(100vw - 48px); }.author-page__description { color: var(--muted); margin: -16px 0 36px; max-width: 740px; }.author-page__pinned { margin-bottom: 42px; }.author-page__pinned-grid { display: grid; gap: 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 16px; }.author-pinned-card { background: var(--paper-deep); border: 1px solid var(--line); min-width: 0; }.author-pinned-card__image { align-items: center; aspect-ratio: 16 / 9; background: var(--paper); display: flex; justify-content: center; overflow: hidden; }.author-pinned-card__image img { display: block; height: 100%; object-fit: cover; width: 100%; }.author-pinned-card__content { padding: 16px 18px 18px; }.author-pinned-card__content .eyebrow { color: var(--accent); font-size: 11px; margin: 0 0 8px; }.author-pinned-card__content h3 { font-size: clamp(18px, 2.2vw, 24px); line-height: 1.2; margin: 0; }.author-pinned-card__content > p:last-child:not(.eyebrow) { color: var(--muted); font-size: 15px; line-height: 1.5; margin: 9px 0 0; }
    @media (max-width: 760px) { .author-page__pinned-grid { gap: 12px; grid-template-columns: 1fr; }.author-pinned-card { display: grid; grid-template-columns: minmax(88px, 30%) minmax(0, 1fr); }.author-pinned-card__image { align-self: stretch; aspect-ratio: auto; min-height: 112px; }.author-pinned-card__content { align-self: center; padding: 12px; }.author-pinned-card__content h3 { font-size: 17px; }.author-pinned-card__content > p:last-child:not(.eyebrow) { display: none; }.author-follow { margin: -20px 0 30px; }.user-page__header { align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-left: 12px; }.user-page__avatar { flex-basis: 76px; height: 76px; width: 76px; }.user-page__identity .eyebrow { margin-top: 24px; }.user-page__bluesky { margin: 0 0 0 88px; }.user-page__description,.user-page__details { margin-left: 12px; }.user-comment { gap: 8px; grid-template-columns: 1fr; padding: 18px 4px; }.user-comment__date { font-size: 12px; } }
    .authors-page__header { border-bottom: 1px solid var(--line); margin-bottom: 28px; padding-bottom: 20px; }.authors-page__header .eyebrow { margin: 0 0 8px; }.authors-page__header h1 { margin: 0; }.author-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }.author-card { align-items: center; background: var(--paper-deep); border: 1px solid var(--line); display: flex; gap: 14px; padding: 16px; }.author-card:hover { border-color: var(--accent); }.author-card__avatar { border-radius: 50%; flex: 0 0 64px; height: 64px; object-fit: cover; width: 64px; }.author-card__avatar--placeholder { background: var(--accent); }.author-card__details { display: grid; gap: 2px; }.author-card__details strong { color: var(--ink); font-family: Lora, serif; font-size: 20px; }.author-card__details span { color: var(--muted); font-size: 14px; }.author-card__details span:last-child { color: var(--accent); margin-top: 4px; }
    .author-invitation { margin: 24px auto 60px; max-width: 760px; }.author-invitation h1 { font-size: clamp(2.5rem, 6vw, 4rem); margin: 0; }.author-invitation__intro { color: var(--muted); font-size: 20px; line-height: 1.55; margin: 18px 0 32px; }.author-invitation__steps { counter-reset: author-step; display: grid; gap: 22px; list-style: none; margin: 0; padding: 0; }.author-invitation__steps li { border-top: 1px solid var(--line); padding-top: 20px; }.author-invitation__steps h2 { font-size: 22px; margin: 0 0 8px; }.author-invitation__steps p { color: var(--muted); line-height: 1.6; margin: 0; }.author-invitation__steps a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }.author-invitation__steps code { background: var(--paper-deep); border: 1px solid var(--line); display: inline-block; margin-top: 4px; overflow-wrap: anywhere; padding: 8px 10px; }.authors-page__invitation { margin: 28px 0 0; }
    @media (max-width: 760px) { .writers-callout { align-items: flex-start; flex-direction: column; } }
    .archive-story { content-visibility: auto; contain-intrinsic-size: 0 360px; }
    .archive-search { background: var(--paper-deep); border: 1px solid var(--line); margin-bottom: 28px; padding: 18px; }
    .archive-search .search-form { display: grid; gap: 14px; }
    .archive-search label { color: var(--muted); display: grid; font-size: 12px; font-weight: 700; gap: 6px; letter-spacing: .04em; text-transform: uppercase; }
    .archive-search__query input, .archive-search select { background: var(--paper); border: 1px solid var(--line-strong); border-radius: 3px; color: var(--ink); font: inherit; font-size: 15px; min-height: 44px; padding: 9px 12px; width: 100%; }
    .archive-search__filters { align-items: end; display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; }
    .archive-search .archive-search__image-filter { align-items: center; display: flex; flex-direction: row; gap: 8px; min-height: 44px; white-space: nowrap; }
    .archive-search__image-filter input { accent-color: var(--accent); height: 18px; width: 18px; }
    .archive-search__actions { align-items: center; display: flex; gap: 18px; }
    .archive-load-more { margin: 34px 0 0; text-align: center; }
    .archive-load-more .search-button { background: var(--accent); border: 1px solid var(--accent); color: var(--paper); cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; letter-spacing: .06em; min-height: 46px; padding: 10px 20px; text-transform: uppercase; }
    .archive-load-more .search-button:hover { background: transparent; color: var(--accent); }
    .archive-load-more .search-button:disabled { cursor: wait; opacity: .7; }
    .archive-load-more [role="status"] { color: var(--muted); font-size: 14px; margin: 10px 0 0; }
    .archive-search .search-button { background: var(--accent); border: 1px solid var(--accent); color: var(--paper); cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; letter-spacing: .06em; min-height: 42px; padding: 9px 16px; text-transform: uppercase; }
    .archive-search .search-button:hover { background: transparent; color: var(--accent); }
    @media (max-width: 760px) { .archive-search { margin-bottom: 20px; padding: 14px; }.archive-search__filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }.archive-search .archive-search__image-filter { align-self: end; } }
    /* Editorial publication system */
    :root { color-scheme: dark; --ink: #ffffff; --paper: #281914; --paper-deep: #3b2a1d; --accent: #b2ac88; --muted: #b2ac88; --line: rgba(178,172,136,.42); --line-strong: #b2ac88; --page-width: 1180px; --reader-font: 'Source Sans 3', sans-serif; --reader-size: 19px; --ui-font: 'Source Sans 3', sans-serif; }
    html[data-reader-font="serif"] { --reader-font: 'Lora', Georgia, serif; }
    html[data-reader-font="monospace"] { --reader-font: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }
    html[data-reader-font="system"] { --reader-font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    html[data-reader-font="atkinson"] { --reader-font: 'Atkinson Hyperlegible', 'Source Sans 3', sans-serif; }
    html[data-reader-font="merriweather"] { --reader-font: 'Merriweather', Georgia, serif; }
    html[data-reader-font="fraunces"] { --reader-font: 'Fraunces', Georgia, serif; }
    html[data-reader-font="inter"] { --reader-font: 'Inter', 'Source Sans 3', sans-serif; }
    html[data-ui-font="serif"] { --ui-font: 'Lora', Georgia, serif; }
    html[data-ui-font="monospace"] { --ui-font: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; }
    html[data-ui-font="system"] { --ui-font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    html[data-ui-font="atkinson"] { --ui-font: 'Atkinson Hyperlegible', 'Source Sans 3', sans-serif; }
    html[data-ui-font="merriweather"] { --ui-font: 'Merriweather', Georgia, serif; }
    html[data-ui-font="fraunces"] { --ui-font: 'Fraunces', Georgia, serif; }
    html[data-ui-font="inter"] { --ui-font: 'Inter', 'Source Sans 3', sans-serif; }
    html[data-theme="light"] { color-scheme: light; --ink: #2b1d12; --paper: #faf5ec; --paper-deep: #efe7d8; --accent: #6f6335; --muted: #6d675a; --line: rgba(111,99,53,.38); --line-strong: #6f6335; }
    html[data-theme="light"] ::selection { background: rgba(111,99,53,.3); }
    html[data-theme="light"] .site-header { background: rgba(250,245,236,.94); box-shadow: 0 1px 0 rgba(43,29,18,.06); }
    html[data-theme="light"] .lead-story__summary, html[data-theme="light"] .archive-story p:not(.eyebrow), html[data-theme="light"] .recommendation-card__body > p:not(.eyebrow), html[data-theme="light"] .auth-option > p:not(.auth-option__label), html[data-theme="light"] .block-dialog p, html[data-theme="light"] .feed-client-dialog p, html[data-theme="light"] .list-card__body p, html[data-theme="light"] .list-page__about, html[data-theme="light"] .footer-tagline { color: #5a5342; }
    html[data-theme="light"] .prose p, html[data-theme="light"] .prose li, html[data-theme="light"] .prose-paragraph, html[data-theme="light"] .prose blockquote, html[data-theme="light"] .prose-blockquote, html[data-theme="light"] .auth-page__intro, html[data-theme="light"] .privacy-page > p, html[data-theme="light"] .privacy-page li { color: #463c2b; }
    html[data-theme="light"] .article__dek { color: #57503f; }
    html[data-theme="light"] .article-rail { background: rgba(111,99,53,.1); }
    html[data-theme="light"] .prose table tr:nth-child(even), html[data-theme="light"] .prose-table tr:nth-child(even) { background: rgba(43,29,18,.05); }
    html[data-theme="light"] .archive-story:hover, html[data-theme="light"] .side-story:hover { box-shadow: 0 6px 14px rgba(43,29,18,.15); }
    html[data-theme="light"] .auth-page__error, html[data-theme="light"] .block-dialog__status, html[data-theme="light"] .forum-status[data-error="true"] { color: #a8462e; }
    html[data-theme="light"] .search-bar .search-bar__filter select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236f6335'/%3E%3C/svg%3E"); }
    html[data-theme="light"] .search-bar .search-bar__filter.is-active, html[data-theme="light"] .search-bar .search-bar__toggle.is-active { background: rgba(111,99,53,.14); }
    html[data-theme="light"] .search-modal { --search-snippet-shadow: 0 12px 28px rgba(43,29,18,.2); --search-snippet-hover-background: rgba(111,99,53,.14); }
    html[data-theme="light"] .footer-social a { background: rgba(111,99,53,.12); }
    html[data-theme="light"] .search-bar mark, html[data-theme="light"] .search-result mark { background: rgba(111,99,53,.28); }
    html[data-theme="light"] .header-account-menu__nav { box-shadow: 0 10px 24px rgba(43,29,18,.2); }
    body { background: var(--paper); color: var(--ink); font-size: 18px; }
    ::selection { background: rgba(178,172,136,.42); color: var(--ink); }
    a { transition: color 160ms ease; }
    a:hover { color: var(--accent); }
    a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    .site-header { background: rgba(40,25,20,.96); border-bottom: 1px solid var(--line); backdrop-filter: blur(14px); }
    .header-inner { min-height: 88px; }
    .site-brand { font-size: clamp(1.7rem, 3vw, 2.35rem); letter-spacing: -.07em; }
    .site-nav, .header-links { font-size: 12px; letter-spacing: .11em; }
    .site-nav a, .rss-link { position: relative; }
    .site-nav a::after { background: var(--accent); bottom: -7px; content: ''; height: 2px; left: 0; position: absolute; transform: scaleX(0); transform-origin: left; transition: transform 160ms ease; width: 100%; }
    .site-nav a:hover::after { transform: scaleX(1); }
    .page-content { padding-top: 34px; }
    .section-heading { border-top: 3px solid var(--ink); border-bottom: 1px solid var(--line); color: var(--ink); font-size: 11px; letter-spacing: .14em; }
    .section-heading span:last-child { color: var(--muted); }
    .front-page__grid { gap: 46px; grid-template-columns: minmax(0, 1.75fr) minmax(285px, .8fr); padding-top: 32px; }
    .lead-image, .archive-story__image { background: var(--paper-deep); }
    .lead-story { border-bottom: 1px solid var(--line); }
    .lead-story h2 { font-size: clamp(2.3rem, 4.5vw, 4rem); line-height: 1.02; }
    .lead-story__summary { color: var(--muted); font-size: 20px; line-height: 1.5; max-width: 720px; }
    .eyebrow, .section-heading, .recent-stories__heading { color: var(--accent); letter-spacing: .13em; }
    .article-meta--byline, .article-meta--byline a, .read-link, .article__author, .article__footer a { color: var(--accent); }
    .recent-stories { border-top-color: var(--ink); }
    .recent-stories__heading { border-bottom: 1px solid var(--line); color: var(--ink); }
    .side-story { background: transparent; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; gap: 14px; margin: 0; padding: 14px 0; }
    .side-story:last-child { border-bottom: 1px solid var(--line); }
    .side-story:hover { box-shadow: none; transform: none; }
    .side-story__image { border-radius: 0; }
    .side-story h3 { font-size: 17px; }
    .home-post-author { align-items: center; color: var(--accent); display: inline-flex; font-size: 13px; gap: 7px; margin: 7px 0; text-decoration: none; }
    .home-post-author img, .home-post-author__placeholder { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 50%; flex: 0 0 24px; height: 24px; object-fit: cover; width: 24px; }
    .home-post-author:hover { color: var(--ink); }
    .lead-column { min-width: 0; }
    .home-pinned { margin-top: 30px; }
    .home-pinned .section-heading { margin-bottom: 16px; }
    .home-pinned__grid { display: grid; gap: 18px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .home-pinned__card { border-bottom: 1px solid var(--line); min-width: 0; }
    .home-pinned__image { aspect-ratio: 1.65 / 1; background: var(--paper-deep); display: block; overflow: hidden; }
    .home-pinned__content { padding: 11px 0 14px; }
    .home-pinned__content .eyebrow { font-size: 10px; margin: 0 0 5px; }
    .home-pinned__content h3 { font-size: 18px; line-height: 1.25; margin: 0; }
    @media (min-width: 761px) and (max-width: 900px) { .home-pinned__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 900px) { .front-page__grid { grid-template-columns: 1fr; gap: 32px; } }
    @media (max-width: 520px) { .lead-story h2 { font-size: clamp(1.7rem, 8.5vw, 2.4rem); } .lead-story__summary { font-size: 17px; } }
    .writers-callout { background: var(--paper-deep); border: 0; border-left: 4px solid var(--accent); margin-top: 58px; padding: 28px 32px; }
    .home-authors { contain-intrinsic-size: auto 420px; content-visibility: auto; margin: 58px auto 0; max-width: 1180px; }
    .home-authors .section-heading a { color: var(--accent); font-size: 11px; }
    .archive-section { contain-intrinsic-size: auto 1500px; content-visibility: auto; margin-top: 68px; }
    .archive-grid { gap: 24px; }
    .archive-story { background: transparent; border: 0; border-top: 1px solid var(--line); border-radius: 0; min-height: 350px; }
    .archive-story:hover { box-shadow: none; transform: translateY(-2px); }
    .archive-story__image { margin-bottom: 4px; }
    .archive-story p:not(.eyebrow) { color: var(--muted); }
    .article-layout { align-items: start; display: grid; gap: clamp(38px, 7vw, 96px); grid-template-columns: minmax(0, 820px) minmax(210px, 270px); justify-content: center; margin: 0 auto; max-width: 1180px; }
    .article { margin: 0; max-width: 820px; min-width: 0; }
    .article__back { color: var(--accent); margin-bottom: 34px; }
    .article__header { border-bottom-color: var(--line); }
    .article__header h1 { font-size: clamp(2.7rem, 6vw, 5rem); line-height: 1.01; }
    .article__dek { color: var(--muted); font-size: clamp(1.2rem, 2vw, 1.45rem); }
    .article__author { color: var(--ink); }
    .article__author:hover { color: var(--accent); }
    .article-tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
    .article-tag { border: 1px solid var(--line); color: var(--accent); font-size: 13px; padding: 4px 10px; text-decoration: none; }
    .article-tag:hover, .tag-directory__item:hover, .tag-directory__item.is-selected { background: var(--paper-deep); border-color: var(--accent); color: var(--accent); }
    .tags-page { margin: 0 auto; max-width: 1180px; }
    .tags-page > h1 { font-family: Lora, serif; font-size: clamp(2.5rem, 6vw, 4.5rem); margin: 0; }
    .tags-page__intro { color: var(--muted); font-size: 18px; margin: 10px 0 28px; }
    .tags-search { align-items: end; display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
    .tags-search label { flex-basis: 100%; font-weight: 600; }
    .tags-search input { background: var(--paper); border: 1px solid var(--line); color: var(--ink); flex: 1 1 240px; font: inherit; min-height: 44px; padding: 8px 12px; }
    .tags-search button { min-height: 44px; }
    .tag-directory { display: flex; flex-wrap: wrap; gap: 10px; }
    .tag-directory__item { align-items: center; border: 1px solid var(--line); color: var(--ink); display: inline-flex; gap: 12px; padding: 10px 14px; text-decoration: none; }
    .tag-directory__item span + span { color: var(--muted); font-size: 12px; }
    .tag-results { margin-top: 54px; }
    .tag-follow { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
    .tag-follow .author-follow__status { flex-basis: auto; }
    .tag-results .archive-grid { margin-top: 22px; }
    .prose { max-width: 100%; }
    .prose p, .prose li, .prose-paragraph { color: var(--muted); font-family: var(--reader-font); font-size: var(--reader-size); line-height: 1.82; }
    .prose h2, .prose-heading--2 { color: var(--ink); font-size: 2.1rem; }
    .prose blockquote, .prose-blockquote { border-color: var(--accent); color: var(--ink); }
    .prose code, .prose-code, .prose pre, .prose-pre { background: var(--paper-deep); color: var(--ink); }
    .prose table tr:nth-child(even), .prose-table tr:nth-child(even) { background: rgba(40,25,20,.3); }
    .prose .prose-paragraph--large { font-size: 1.14em; }
    .prose .prose-paragraph--small { font-size: .86em; }
    .prose .prose-underline { text-decoration: underline; text-underline-offset: 3px; }
    .prose mark { background: rgba(178,172,136,.3); color: var(--ink); padding: 0 .15em; }
    .prose .prose-rule { border: 0; border-top: 1px solid var(--line); margin: 2.4rem 0; }
    .prose .prose-button-row { margin: 1.6em 0; }
    .prose .prose-button { background: var(--accent); border-radius: 4px; color: var(--paper) !important; display: inline-block; font-weight: 700; padding: 12px 22px; text-decoration: none !important; }
    .prose .prose-button:hover { filter: brightness(1.12); }
    .prose sup.prose-footnote-ref { font-size: .72em; line-height: 0; }
    .prose sup.prose-footnote-ref a { color: var(--accent); font-weight: 700; padding: 0 .1em; text-decoration: none; }
    .prose .prose-footnotes { border-top: 1px solid var(--line); color: var(--muted); font-size: .9em; margin-top: 2.6rem; padding-top: 1.2rem; }
    .prose .prose-footnotes li { margin: .5em 0; }
    .prose .prose-footnote-back { text-decoration: none; }
    .article-rail { border-top: 3px solid var(--ink); padding-top: 12px; position: sticky; top: 105px; }
    .article-rail h2 { font-size: 23px; margin: 0 0 14px; }
    .article-rail ul { border-top: 1px solid var(--line); list-style: none; margin: 0 0 18px; padding: 0; }
    .article-rail li { border-bottom: 1px solid var(--line); padding: 14px 0; }
    .article-rail li a { font-family: Lora, serif; font-size: 15px; font-weight: 600; line-height: 1.4; }
    .article-rail__authors { margin-top: 34px; }
    .article-rail__author { align-items: center; display: flex; gap: 10px; font-family: 'Source Sans 3', sans-serif !important; }
    .article-rail__author img, .article-rail__author-placeholder { background: var(--paper-deep); border-radius: 50%; flex: 0 0 36px; height: 36px; object-fit: cover; width: 36px; }
    .article-rail__author span { display: grid; gap: 0; min-width: 0; }
    .article-rail__author strong { font-size: 14px; }
    .article-rail__author small { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
    .recommendations { margin: 70px auto 0; max-width: 1180px; }
    .recommendations .section-heading a { color: var(--accent); font-size: 11px; }
    .recommendations__grid { display: grid; gap: 24px; grid-template-columns: repeat(3, minmax(0, 1fr)); padding-top: 22px; }
    .recommendation-card { border-bottom: 1px solid var(--line); min-width: 0; }
    .recommendation-card__image { aspect-ratio: 1.7 / 1; background: var(--paper-deep); display: block; overflow: hidden; }
    .recommendation-card__image .story-image { transition: transform 250ms ease; }
    .recommendation-card:hover .story-image { transform: scale(1.025); }
    .recommendation-card__body { padding: 12px 0 16px; }
    .recommendation-card__body .eyebrow { font-size: 10px; margin: 0 0 7px; }
    .recommendation-card h3 { font-size: 21px; line-height: 1.2; margin: 0; }
    .recommendation-card__body > p:not(.eyebrow) { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 9px 0; }
    .recommendation-card__date { color: var(--muted); font-size: 12px; }
    .site-footer { background: var(--paper-deep); border-top-color: var(--line); color: var(--ink); }
    .footer-social a { color: var(--accent); }
    .footer-meta { border-color: var(--line); }
    @media (max-width: 900px) { .article-layout { grid-template-columns: minmax(0, 820px); }.article-rail { display: none; } }
    @media (max-width: 760px) { .header-inner { min-height: 74px; }.front-page__grid { gap: 32px; }.recommendations__grid { grid-template-columns: 1fr 1fr; }.archive-grid { gap: 24px; }.archive-story { min-height: 0; }.archive-story__image { aspect-ratio: 1.8 / 1; }.article__header h1 { font-size: clamp(2.5rem, 11vw, 4rem); } }
    @media (max-width: 520px) { .recommendations__grid { grid-template-columns: 1fr; }.recommendation-card { display: grid; gap: 14px; grid-template-columns: 112px minmax(0, 1fr); padding: 14px 0; }.recommendation-card__image { aspect-ratio: 1; }.recommendation-card__body { padding: 0; }.recommendation-card h3 { font-size: 17px; }.recommendation-card__body > p:not(.eyebrow) { display: none; }.article__back { margin-bottom: 24px; }.prose p, .prose li, .prose-paragraph { font-size: min(var(--reader-size), 18px); } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }
    /* Finishing pass: keep the coffee palette, sharpen the publication hierarchy. */
    body { background: var(--paper); }
    .site-header { box-shadow: 0 1px 0 rgba(255,255,255,.025); }
    .header-inner { min-height: 96px; }
    .site-brand { align-items: center; display: flex; flex-direction: column; font-size: clamp(1.8rem, 3vw, 2.45rem); line-height: 1; }
    .site-brand::after { content: none; }
    .site-nav, .header-links { font-size: 12px; letter-spacing: .12em; }
    .site-nav a, .header-links > a, .header-icon-actions > a { opacity: .88; }
    .site-nav a:hover, .header-links > a:hover, .header-icon-actions > a:hover { opacity: 1; }
    .page-content { padding-top: 42px; padding-bottom: 76px; }
    .section-heading { align-items: center; border-top-width: 2px; padding: 13px 0 11px; }
    .section-heading span:first-child { color: var(--ink); }
    .front-page__grid { padding-top: 34px; }
    .lead-image { aspect-ratio: 1.82 / 1; }
    @media (max-width: 760px) {
      .page-content { padding-top: 24px; }
      .front-page__grid { gap: 26px; padding-top: 22px; }
      .lead-image { aspect-ratio: 1.28 / 1; max-height: 58vh; }
      .lead-story { min-width: 0; padding-bottom: 22px; }
      .lead-story__content { padding: 18px 2px 0; }
      .lead-story h2 { font-size: clamp(2rem, 9vw, 3rem); line-height: 1.04; overflow-wrap: anywhere; }
      .lead-story__summary { font-size: 17px; line-height: 1.48; margin: 11px 0 14px; }
      .story-footer { align-items: flex-start; flex-direction: column; gap: 12px; }
      .story-footer .article-meta { align-items: flex-start; flex-direction: column; gap: 4px; }
      .story-footer .read-link { align-self: flex-start; }
    }
    @media (max-width: 420px) {
      .lead-image { aspect-ratio: 1.08 / 1; }
      .lead-story h2 { font-size: clamp(1.9rem, 9vw, 2.5rem); }
    }
    .lead-story { padding-bottom: 30px; }
    .lead-story__content { padding-top: 24px; }
    .lead-story .eyebrow { align-items: center; display: flex; gap: 10px; }
    .lead-story .eyebrow::before { background: var(--accent); content: ''; height: 1px; width: 24px; }
    .lead-story h2 { font-size: clamp(2.35rem, 4.4vw, 3.8rem); letter-spacing: -.055em; }
    .lead-story__summary { color: #e0d9c8; font-size: 19px; max-width: 680px; }
    .story-footer { border-top: 1px solid var(--line); margin-top: 20px; padding-top: 13px; }
    .article-meta { color: var(--muted); font-size: 13px; }
    .article-meta--byline { color: var(--ink); }
    .read-link { align-items: center; display: inline-flex; gap: 8px; }
    .recent-stories__heading { padding: 13px 0; }
    .side-story { gap: 13px; padding: 15px 0; }
    .side-story__image { background: var(--paper-deep); }
    .side-story h3 { font-size: 16px; letter-spacing: -.02em; }
    .side-story .article-meta { font-size: 12px; }
    .writers-callout { border-left-width: 3px; margin-top: 64px; padding: 30px 34px; }
    .writers-callout h2 { letter-spacing: -.04em; }
    .archive-section { margin-top: 74px; }
    .archive-section > .archive-grid { margin-top: 8px; }
    .archive-grid { column-gap: 28px; row-gap: 36px; }
    .archive-story { border-top: 1px solid var(--line); min-height: 0; }
    .archive-story__image { margin: 0 -1px; }
    .archive-story h3 { font-size: 20px; letter-spacing: -.025em; line-height: 1.24; padding-left: 0; padding-right: 0; }
    .archive-story .eyebrow, .archive-story p:not(.eyebrow), .archive-story__footer { padding-left: 0; padding-right: 0; }
    .archive-story p:not(.eyebrow) { color: #d2cbb9; }
    .archive-story__footer { border-top: 1px solid var(--line); margin: 14px 0 0; }
    .archive-story.archive-story--no-cover, .home-pinned__card.home-pinned__card--no-cover, .recommendation-card.recommendation-card--no-cover, .side-story.side-story--no-cover, .author-pinned-card.author-pinned-card--no-cover { grid-template-columns: minmax(0, 1fr); }
    .archive-story.archive-story--no-cover p:not(.eyebrow), .recommendation-card.recommendation-card--no-cover .recommendation-card__body > p:not(.eyebrow), .author-pinned-card.author-pinned-card--no-cover .author-pinned-card__content > p:last-child:not(.eyebrow) { color: var(--ink); font-family: Lora, serif; font-size: 16px; line-height: 1.5; }
    .story-dek { color: var(--muted); display: -webkit-box; font-size: 13px; line-height: 1.45; margin: 6px 0 0; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .article-layout { gap: clamp(42px, 6vw, 84px); }
    .article__back { font-size: 12px; letter-spacing: .1em; margin-bottom: 36px; }
    .article__header { padding-bottom: 30px; }
    .article__header > .eyebrow { letter-spacing: .16em; }
    .article__header h1 { letter-spacing: -.06em; }
    .article__dek { color: #ddd5c4; }
    .article__author { color: var(--ink); }
    .prose { max-width: 100%; }
    .prose p, .prose li, .prose-paragraph { color: #eee9dc; font-family: var(--reader-font); font-size: var(--reader-size); line-height: 1.84; }
    .prose h2, .prose h3, .prose h4, .prose-heading { color: var(--ink); }
    .prose a, .prose-link { color: var(--accent); }
    .prose blockquote, .prose-blockquote { color: #eee9dc; }
    .article-rail { background: rgba(59,42,29,.42); border-top-color: var(--accent); padding: 15px 18px 18px; top: 108px; }
    .article-rail h2 { margin-bottom: 16px; }
    .article-engagement { border-bottom: 1px solid var(--line); display: grid; gap: 10px; margin: 0 0 28px; padding: 0 0 22px; }
    .article-engagement .engagement-stat { background: var(--paper-deep); border: 1px solid var(--line); cursor: default; }
    .article-engagement .article-reactions__buttons { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .article-engagement .reaction-button { justify-content: center; min-width: 0; }
    .article-engagement .article-reactions__status { min-height: 0; }
    .article-share { display: grid; gap: 8px; }
    .article-share__label { color: var(--muted); font: 700 11px 'Source Sans 3', sans-serif; letter-spacing: .12em; text-transform: uppercase; }
    .article-share__buttons { display: grid; gap: 6px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .article-rail .article-sources { border-top: 0; margin: 0 0 28px; padding: 0; }
    .article-rail .article-sources h2 { font-family: Lora, serif; font-size: 23px; font-weight: 600; letter-spacing: -.045em; margin: 0 0 16px; text-transform: none; }
    .article-rail .article-sources li { overflow-wrap: anywhere; }
    .article-rail .article-sources a { font-family: 'Source Sans 3', sans-serif; }
    .article-share__buttons .reaction-button { text-decoration: none; }
    .article-rail li a { font-size: 14px; }
    .recommendations { margin-top: 76px; }
    .recommendations .section-heading { margin-bottom: 4px; }
    .recommendations__grid { gap: 28px; }
    .recommendation-card { border-top: 1px solid var(--line); border-bottom: 0; }
    .recommendation-card__image { margin-top: 14px; }
    .recommendation-card h3 { font-size: 20px; letter-spacing: -.025em; }
    .recommendation-card__body > p:not(.eyebrow) { color: #d2cbb9; }
    .recommendation-card__date { display: inline-block; margin-top: 5px; }
    .article-engagement { display: grid; gap: 8px; margin-top: 18px; }
    .article-view-counter { margin-top: 0; }
    .article-reactions__buttons { display: inline-flex; flex-wrap: wrap; gap: 6px; }
    .reaction-button { align-items: center; background: var(--paper-deep); border: 1px solid var(--line); border-radius: 2px; color: var(--ink); cursor: pointer; display: inline-flex; font: 600 13px 'Source Sans 3', sans-serif; gap: 6px; min-height: 32px; padding: 4px 8px; transition: background 160ms, border-color 160ms, color 160ms; }
    .reaction-button:hover, .reaction-button[aria-pressed="true"] { background: rgba(178,172,136,.16); border-color: var(--accent); color: var(--ink); }
    .engagement-stat { cursor: default; }
    .reaction-button:disabled { cursor: wait; opacity: .65; }
    .reaction-count { color: var(--accent); font-variant-numeric: tabular-nums; }
    .author-verification-badge { color: #3897f0; display: inline-block; margin-left: .3em; }
    .author-verification-badge--author { color: var(--accent); }
    .author-verification-badge--moderator { color: #2e8b57; }
    .author-verification-badge--developer { color: var(--ink); }
    .article-reactions__status { color: var(--muted); flex-basis: 100%; font-size: 12px; min-height: 18px; }
    .auth-page { display: flex; flex-direction: column; margin: 24px auto 60px; max-width: 1020px; min-height: calc(100vh - 120px); }
    .auth-hero { align-items: stretch; display: grid; flex: 1; gap: 48px; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
    .auth-page h1 { font-size: clamp(1.9rem, 4.6vw, 2.9rem); margin: 0; }
    .privacy-page h1 { font-size: clamp(2.2rem, 6vw, 3.5rem); margin: 0; }
    .auth-page__intro { color: #eee9dc; font-size: 18px; line-height: 1.6; margin: 16px 0 28px; }
    .auth-hero__intro { display: flex; flex-direction: column; justify-content: center; }
    .auth-benefits { display: grid; gap: 18px; list-style: none; margin: 0; padding: 0; }
    .auth-benefits li { align-items: flex-start; display: flex; gap: 14px; }
    .auth-benefits i { color: var(--accent); font-size: 17px; margin-top: 3px; width: 22px; }
    .auth-benefits strong { color: var(--ink); display: block; font-size: 16px; }
    .auth-benefits span { color: var(--muted); display: block; font-size: 14px; line-height: 1.45; margin-top: 2px; }
    .auth-card { background: var(--paper-deep); border: 1px solid var(--accent); display: flex; flex-direction: column; justify-content: center; padding: 24px; }
    .auth-card[hidden] { display: none; }
    .auth-card [hidden] { display: none !important; }
    .auth-card__heading { color: var(--ink); font-family: 'Lora', Georgia, serif; font-size: 20px; margin: 0 0 14px; }
    .auth-welcome { align-items: center; display: flex; flex-direction: column; padding: 12px 0; text-align: center; }
    .auth-welcome[hidden] { display: none; }
    .auth-welcome__avatar { border: 2px solid var(--accent); border-radius: 50%; height: 96px; object-fit: cover; width: 96px; }
    .auth-welcome__avatar--placeholder { align-items: center; background: var(--paper); color: var(--accent); display: inline-flex; font-size: 38px; justify-content: center; }
    .auth-welcome__title { font-family: 'Lora', Georgia, serif; font-size: 26px; margin: 18px 0 6px; }
    .auth-welcome__handle { color: var(--muted); font-size: 15px; margin: 0 0 20px; }
    .auth-card--waiting > :not([data-auth-waiting]) { display: none !important; }
    .auth-waiting { align-items: center; display: flex; flex-direction: column; padding: 18px 6px; text-align: center; }
    .auth-waiting__spinner { color: var(--accent); font-size: 30px; margin-bottom: 14px; }
    .auth-waiting__title { font-family: 'Lora', Georgia, serif; font-size: 24px; margin: 0 0 8px; }
    .auth-waiting__detail { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 0 0 18px; }
    .auth-providers { display: grid; gap: 8px; }
    .auth-provider { align-items: center; background: var(--paper); border: 1px solid var(--line); color: var(--ink); cursor: pointer; display: flex; font: 15px 'Source Sans 3', sans-serif; gap: 12px; min-height: 52px; padding: 10px 14px; text-align: left; transition: border-color 160ms; width: 100%; }
    .auth-provider:hover, .auth-provider:focus-visible, .auth-provider[aria-expanded="true"] { border-color: var(--accent); }
    .auth-provider > i:first-child { color: var(--accent); font-size: 17px; width: 22px; }
    .auth-provider__logo { align-self: stretch; border-right: 1px solid var(--line); display: block; flex: 0 0 56px; margin: -10px 2px -10px -14px; object-fit: cover; width: 56px; }
    .auth-provider__copy { display: grid; flex: 1; min-width: 0; }
    .auth-provider__copy strong { font-size: 15px; font-weight: 600; }
    .auth-provider__copy small { color: var(--muted); font-size: 12px; }
    .auth-provider__chevron { color: var(--muted); font-size: 12px; transition: transform 160ms; }
    .auth-provider[aria-expanded="true"] .auth-provider__chevron { transform: rotate(90deg); }
    .auth-provider:disabled { cursor: not-allowed; opacity: .5; }
    .auth-provider:disabled:hover { border-color: var(--line); }
    .auth-provider--down .auth-provider__copy small { color: #d96a4f; }
    .auth-handle-form { border: 1px solid var(--line); margin-top: 12px; padding: 14px; }
    .auth-handle-form[hidden] { display: none; }
    .auth-handle-form__hint { color: var(--muted); font-size: 12px; margin: 0; }
    .auth-card__divider { align-items: center; display: flex; gap: 12px; margin: 18px 0 12px; }
    .auth-card__divider::before, .auth-card__divider::after { background: var(--line); content: ""; flex: 1; height: 1px; }
    .auth-card__divider span { color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    .auth-row { border: 1px solid var(--line); margin-bottom: 8px; }
    .auth-row summary { align-items: center; color: var(--ink); cursor: pointer; display: flex; font-size: 15px; font-weight: 600; gap: 10px; list-style: none; min-height: 48px; padding: 10px 14px; }
    .auth-row summary::-webkit-details-marker { display: none; }
    .auth-row summary i { color: var(--accent); width: 20px; }
    .auth-row summary::after { color: var(--muted); content: "\\f078"; font-family: "Font Awesome 6 Free"; font-size: 11px; font-weight: 900; margin-left: auto; transition: transform 160ms; }
    .auth-row[open] summary::after { transform: rotate(180deg); }
    .auth-row .auth-form { margin-top: 0; padding: 0 14px 14px; }
    .auth-row .auth-page__resolution { margin: 0 !important; padding: 0 14px 14px; }
    .auth-provider--create { margin-top: 8px; }
    .auth-options { display: grid; gap: 16px; grid-template-columns: minmax(0,1fr); }
    .auth-option { background: var(--paper-deep); border: 1px solid var(--line); display: flex; flex-direction: column; padding: 24px; }
    .auth-option--coffee { border-color: var(--accent); }
    .auth-option__label { color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .12em; margin: 0 0 10px; text-transform: uppercase; }
    .auth-option h2 { font-family: 'Lora', Georgia, serif; font-size: 23px; margin: 0 0 8px; }
    .auth-option > p:not(.auth-option__label) { color: #d2cbb9; font-size: 15px; line-height: 1.55; margin: 0 0 16px; }
    .auth-option__button { cursor: pointer; font-family: inherit; justify-self: start; margin-top: auto; width: 100%; }
    .auth-create-button { background: transparent; border: 1px solid var(--line-strong); color: var(--ink); cursor: pointer; font: 600 14px 'Source Sans 3', sans-serif; margin-top: 10px; min-height: 44px; padding: 9px 14px; width: 100%; }
    .auth-create-button:hover, .auth-create-button:focus-visible { border-color: var(--accent); }
    .auth-invite { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    .auth-invite[hidden] { display: none; }
    .auth-invite code { background: var(--paper-deep); border: 1px solid var(--line); font-size: 14px; overflow-wrap: anywhere; padding: 8px 10px; user-select: all; }
    .auth-form { display: grid; gap: 10px; margin-top: auto; }
    .auth-form label { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    .auth-form input { background: var(--paper); border: 1px solid var(--line); color: var(--ink); font: 17px 'Source Sans 3', sans-serif; min-height: 48px; padding: 10px 12px; width: 100%; }
    .auth-page__resolution { color: var(--muted); font-size: 12px !important; margin: 12px 0 0 !important; }
    .auth-account { background: var(--paper-deep); border: 1px solid var(--line); margin-top: 24px; padding: 20px; }
    .auth-account__status { color: var(--muted); margin: 0 0 14px; }.auth-account__status strong { color: var(--ink); }
    .auth-signout { background: transparent; border: 1px solid var(--line-strong); color: var(--ink); cursor: pointer; font: 600 13px 'Source Sans 3', sans-serif; padding: 9px 14px; }
    .auth-page__error { color: #f2a18d; margin-top: 14px; }
    @media (max-width: 1020px) {
      .auth-page { min-height: 0; }
      .auth-hero { gap: 32px; grid-template-columns: 1fr; }
    }
    @media (max-height: 700px) and (min-width: 1021px) {
      .auth-page { min-height: 0; }
    }
    @media (max-width: 520px) {
      .auth-card { padding: 14px; }
      .auth-benefits { gap: 14px; }
      .auth-page__intro { font-size: 16px; }
      .auth-provider { gap: 10px; padding: 10px 12px; }
      .auth-provider__logo { flex-basis: 44px; margin: -10px 0 -10px -12px; width: 44px; }
      .auth-provider__copy strong { font-size: 14px; }
      .auth-provider__copy small { font-size: 11px; }
      .auth-row summary { padding: 10px 12px; }
      .auth-handle-form { padding: 12px; }
    }
    .header-account { align-items: center; border-radius: 50%; display: none; height: 40px; justify-content: center; overflow: hidden; width: 40px; }
    .header-account-menu { position: relative; }
    .header-account-menu[hidden] { display: none; }
    .header-account-menu .header-account { background: none; border: 0; cursor: pointer; display: inline-flex; padding: 0; }
    .header-account-menu__nav { background: var(--paper-deep); border: 1px solid var(--line-strong); box-shadow: 0 10px 24px rgba(0, 0, 0, .38); display: grid; min-width: 190px; padding: 6px 0; position: absolute; right: 0; top: calc(100% + 10px); z-index: 130; }
    .header-account-menu__nav[hidden] { display: none; }
    .header-account-menu__nav a { color: var(--ink); font-size: 13px; font-weight: 700; letter-spacing: .06em; padding: 11px 16px; text-transform: uppercase; }
    .header-account-menu__nav a:hover, .header-account-menu__nav a:focus-visible { background: var(--paper); color: var(--accent); }
    .header-account-menu__nav a[aria-current="page"] { color: var(--accent); }
    .header-account-menu__switcher { border-top: 1px solid var(--line); margin-top: 4px; padding: 6px 0; }
    .account-switcher__title { color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; margin: 4px 16px 6px; text-transform: uppercase; }
    .account-switcher__title i { margin-right: 6px; }
    .account-switcher__list { display: grid; gap: 2px; list-style: none; margin: 0; padding: 0; }
    .account-switcher__row { align-items: center; background: none; border: 0; color: var(--ink); cursor: pointer; display: flex; font: inherit; gap: 10px; padding: 8px 16px; text-align: left; width: 100%; }
    .account-switcher__row:hover, .account-switcher__row:focus-visible { background: var(--paper); color: var(--accent); }
    .account-switcher__row:disabled { cursor: wait; opacity: .6; }
    .account-switcher__avatar { align-items: center; background: var(--paper); border: 1px solid var(--line-strong); border-radius: 50%; color: var(--accent); display: inline-flex; flex: 0 0 28px; font-size: 12px; height: 28px; justify-content: center; object-fit: cover; width: 28px; }
    .account-switcher__copy { display: grid; min-width: 0; }
    .account-switcher__copy strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .account-switcher__copy small { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .account-switcher__add { color: var(--accent); display: block; font-size: 13px; font-weight: 700; letter-spacing: .06em; padding: 10px 16px 6px; text-transform: uppercase; }
    .account-switcher__add i { margin-right: 6px; }
    .account-switcher__add:hover, .account-switcher__add:focus-visible { color: var(--ink); }
    .account-card .account-switcher__title, .auth-card .account-switcher__title { margin: 0 0 10px; }
    .account-card .account-switcher__row, .auth-card .account-switcher__row { align-items: center; border: 1px solid var(--line); border-radius: 3px; display: flex; gap: 10px; padding: 8px 10px; text-align: left; width: 100%; }
    .account-card .account-switcher__row:hover, .account-card .account-switcher__row:focus-visible, .auth-card .account-switcher__row:hover, .auth-card .account-switcher__row:focus-visible { border-color: var(--accent); }
    .account-card .account-switcher__add, .auth-card .account-switcher__add { padding: 12px 0 0; }
    .auth-card .account-switcher { margin-bottom: 14px; }
    .auth-card .account-switcher__list { display: grid; gap: 6px; }
    .auth-card .account-switcher__avatar { flex: 0 0 34px; height: 34px; width: 34px; }
    .header-account[hidden] { display: none; }
    .header-account:not([hidden]) { display: inline-flex; }
    .header-account img { border: 1px solid var(--line-strong); border-radius: 50%; display: block; flex: 0 0 40px; height: 40px; object-fit: cover; width: 40px; }
    .header-account img[hidden] { display: none; }
    .header-account__placeholder { align-items: center; background: var(--paper-deep); border: 1px solid var(--line-strong); border-radius: 50%; color: var(--accent); display: inline-flex; font-size: 17px; height: 40px; justify-content: center; width: 40px; }
    .header-account__placeholder[hidden], .account-page__profile img[hidden], .account-page__profile > span[hidden] { display: none; }
    .account-page__profile { align-items: center; display: flex; gap: 18px; margin-bottom: 24px; min-width: 0; }
    .account-page__profile img, .account-page__profile > span { background: var(--paper); border-radius: 50%; flex: 0 0 80px; height: 80px; object-fit: cover; width: 80px; }
    .account-page__profile > span { align-items: center; color: var(--accent); display: inline-flex; font-size: 28px; justify-content: center; }
    .account-page__profile h2 { font-size: 25px; margin: 0; overflow-wrap: anywhere; }
    .account-page__profile p { color: var(--muted); margin: 3px 0 0; overflow-wrap: anywhere; }
    .account-page__did { font-size: 12px; }
    .account-page__viewed { border-top: 1px solid var(--line); margin: 26px 0; padding-top: 22px; }
    .account-page__viewed h2 { font-size: 24px; margin: 0 0 14px; }
    .account-page__viewed ul { display: grid; gap: 12px; list-style: none; margin: 0; padding: 0; }
    .account-page__viewed li { border-bottom: 1px solid var(--line); padding-bottom: 12px; }
    .account-page__viewed a { color: var(--ink); font-family: 'Lora', Georgia, serif; font-size: 18px; }
    .account-page__viewed a:hover { color: var(--accent); }
    .account-page__viewed small { color: var(--muted); display: block; font: 13px 'Source Sans 3', sans-serif; margin-top: 4px; }
    .account-page__viewed-status { color: var(--muted); }
    .account-page__subheading { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .06em; margin: 18px 0 10px; text-transform: uppercase; }
    .account-page__blocks ul { display: grid; gap: 12px; }
    .account-page__blocks li { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; }
    .account-page__blocks li a { font: 14px 'Source Sans 3', sans-serif; overflow-wrap: anywhere; }
    .account-page__blocks-note { color: var(--muted); font-size: 14px; }
    .account-email__toggle { align-items: start; display: flex; gap: 10px; margin: 0 0 16px; }
    .account-email__toggle input { accent-color: var(--accent); margin-top: 4px; }
    .account-email__list li { align-items: center; display: flex; flex-wrap: wrap; gap: 8px 12px; justify-content: space-between; }
    .account-email__list li span { font: 14px 'Source Sans 3', sans-serif; overflow-wrap: anywhere; }
    .account-email__list li small { display: inline; margin: 0; }
    .account-email__frequency { border: 0; display: grid; gap: 8px; margin: 0 0 14px; padding: 0; }
    .account-email__frequency legend { color: var(--muted); font-size: 13px; font-weight: 600; padding: 0; }
    .account-email__filters { border: 1px solid var(--line); border-radius: 4px; flex-basis: 100%; padding: 8px 12px; }
    .account-email__filters summary { color: var(--muted); cursor: pointer; font: 600 13px 'Source Sans 3', sans-serif; }
    .account-email__filters[open] summary { margin-bottom: 10px; }
    .account-email__filters label { display: grid; font-size: 13px; gap: 5px; margin-bottom: 10px; }
    .account-email__filters input[type="text"] { background: var(--paper); border: 1px solid var(--line); border-radius: 4px; color: var(--ink); font: 14px 'Source Sans 3', sans-serif; padding: 7px 9px; }
    .account-email__filters .auth-signout { font-size: 12px; padding: 5px 10px; }
    .account-email__filters > small { color: var(--muted); display: block; margin-top: 6px; }
    .account-email__filter-group { margin-bottom: 14px; }
    .account-email__filter-heading { color: var(--muted); font: 600 13px 'Source Sans 3', sans-serif; margin: 0 0 8px; }
    .account-email__options { display: flex; flex-wrap: wrap; gap: 8px; }
    .account-email__option { align-items: center; background: var(--paper); border: 1px solid var(--line); border-radius: 999px; color: var(--ink); cursor: pointer; display: inline-flex; font: 600 13px 'Source Sans 3', sans-serif; gap: 6px; min-height: 32px; padding: 3px 12px; }
    .account-email__option:has(input:checked) { background: rgba(178,172,136,.14); border-color: var(--accent); }
    html[data-theme="light"] .account-email__option:has(input:checked) { background: rgba(111,99,53,.16); }
    .account-email__option input { accent-color: var(--accent); margin: 0; }
    .account-email__filters-status { color: var(--muted); font-size: 13px; margin: 6px 0; }
    .account-email__filters > .auth-signout { margin-top: 4px; }
    .account-email__form { display: grid; gap: 12px; margin-top: 18px; }
    .account-email__form label { display: grid; font-size: 14px; gap: 6px; }
    .account-email__form input[type="email"] { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; color: var(--ink); font: 15px 'Source Sans 3', sans-serif; padding: 10px 12px; }
    .account-email__form .account-profile-form__actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .forum-post-card[data-block-author-did][hidden], .forum-thread[data-block-author-did][hidden], .user-forum-post[data-block-author-did][hidden] { display: none !important; }
    .forum-reply.is-blocked > :not(.forum-replies) { display: none !important; }
    .block-dialog { background: var(--paper-deep); border: 1px solid var(--line-strong); color: var(--ink); margin: auto; max-width: min(460px, calc(100% - 32px)); padding: 24px; width: 100%; }
    .block-dialog::backdrop { background: rgba(0, 0, 0, .72); }
    .block-dialog h2 { font-family: Lora, Georgia, serif; margin: 0 0 10px; }
    .block-dialog p { color: #d2cbb9; }
    .block-dialog__option { align-items: start; display: flex; gap: 10px; margin: 18px 0; }
    .block-dialog__option input { accent-color: var(--accent); margin-top: 5px; }
    .block-dialog__actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .block-dialog__status { color: #f2a18d !important; min-height: 1.5em; }
    .feed-client-dialog { background: var(--paper-deep); border: 1px solid var(--line-strong); color: var(--ink); margin: auto; max-width: min(440px, calc(100% - 32px)); padding: 24px; width: 100%; }
    .feed-client-dialog::backdrop { background: rgba(0, 0, 0, .72); }
    .feed-client-dialog h2 { font-family: Lora, Georgia, serif; margin: 0 0 8px; }
    .feed-client-dialog p { color: #d2cbb9; margin: 0 0 18px; }
    .feed-client-dialog__options { display: grid; gap: 8px; }
    .feed-client-dialog__options a { border: 1px solid var(--line-strong); color: var(--ink); display: block; font-weight: 700; padding: 12px 14px; text-decoration: none; }
    .feed-client-dialog__options a:hover, .feed-client-dialog__options a:focus-visible { background: var(--paper); border-color: var(--accent); }
    .account-page__saved-item { align-items: center; display: flex; gap: 12px; justify-content: space-between; }
    .account-page__saved-item a { min-width: 0; }
    .story-card { align-items: flex-start; display: flex; gap: 12px; padding: 14px 0 !important; position: relative; }
    .story-card__avatar { align-items: center; align-self: flex-start; background: var(--accent); border-radius: 50%; color: var(--paper); display: flex; flex: 0 0 42px; height: 42px; justify-content: center; overflow: hidden; width: 42px; }
    .story-card__avatar img { height: 100%; object-fit: cover; width: 100%; }
    .story-card__main { display: grid; flex: 1 1 auto; gap: 5px; min-width: 0; }
    .story-card__byline { align-items: baseline; color: var(--muted); display: flex; flex-wrap: wrap; font: 14px 'Source Sans 3', sans-serif; gap: 6px; }
    .story-card__author { color: var(--ink); font-weight: 700; }
    .story-card__author:hover { color: var(--accent); }
    .story-card__handle { color: var(--muted); }
    .story-card__byline .account-page__remove-save { margin-left: auto; }
    .story-card__story { color: var(--ink); display: grid; gap: 4px; }
    .story-card__story h3 { font-family: 'Lora', Georgia, serif; font-size: 19px; line-height: 1.3; margin: 0; }
    .story-card__story:hover h3 { color: var(--accent); }
    .story-card__story p { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 0; }
    .story-card__meta { color: var(--muted); font-size: 12px; }
    .story-card__cover { align-self: flex-start; border-radius: 8px; flex: 0 0 92px; height: 92px; object-fit: cover; width: 92px; }
    @media (max-width: 560px) { .story-card__cover { flex-basis: 72px; height: 72px; width: 72px; } }
    .account-page__remove-save { background: transparent; border: 1px solid var(--line); color: var(--muted); cursor: pointer; flex: 0 0 auto; font: 600 12px 'Source Sans 3', sans-serif; padding: 6px 10px; }
    .account-page__remove-save:hover { border-color: var(--accent); color: var(--accent); }
    .account-page__remove-save:disabled { cursor: wait; opacity: .6; }
    .list-icon { align-items: center; border: 1px solid var(--line); border-radius: 6px; color: var(--accent); display: inline-flex; flex: 0 0 auto; font-size: 20px; height: 40px; justify-content: center; overflow: hidden; width: 40px; }
    .list-icon img { display: block; height: 100%; object-fit: cover; width: 100%; }
    .list-icon--emoji { font-size: 22px; }
    .account-list-item { align-items: flex-start; }
    .account-list-item__body { display: grid; flex: 1 1 auto; gap: 2px; min-width: 0; }
    .account-list-item__body small { color: var(--muted); }
    .account-list-item__actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .account-list-form { margin-top: 12px; }
    .list-page__header { align-items: center; display: flex; gap: 16px; margin: 18px 0 8px; }
    .list-page__icon { align-items: center; border: 1px solid var(--line); border-radius: 8px; color: var(--accent); display: inline-flex; flex: 0 0 auto; font-size: 30px; height: 64px; justify-content: center; object-fit: cover; overflow: hidden; width: 64px; }
    .list-page__icon--empty { background: var(--paper); }
    .list-page__icon--emoji { font-size: 34px; }
    .list-page__heading h1 { font-family: Lora, Georgia, serif; margin: 0; }
    .list-page__owner { color: var(--muted); margin: 4px 0 0; }
    .list-page__about { color: #d2cbb9; max-width: 720px; }
    .list-page__status { color: var(--muted); margin: 12px 0 0; min-height: 1.2em; }
    .list-page__items { display: grid; gap: 10px; list-style: none; margin: 18px 0; max-width: 760px; padding: 0; }
    .list-page__item a { display: grid; gap: 2px; }
    .list-page__item a small { color: var(--muted); }
    .list-page__share { background: transparent; border: 0; cursor: pointer; }
    .list-page__manage { margin-top: 18px; }
    .list-index { display: grid; gap: 14px; list-style: none; margin: 20px 0; padding: 0; }
    .list-card { align-items: flex-start; border: 1px solid var(--line); display: flex; gap: 14px; padding: 14px 16px; }
    .list-card__icon { border: 0; height: 48px; width: 48px; }
    .list-card__body { display: grid; gap: 4px; min-width: 0; }
    .list-card__body h2 { font-family: Lora, Georgia, serif; font-size: 20px; margin: 0; }
    .list-card__body p { color: #d2cbb9; margin: 0; }
    .list-card__body small { color: var(--muted); }
    .list-dialog { background: var(--paper-deep); border: 1px solid var(--line-strong); color: var(--ink); max-width: 440px; padding: 22px; width: min(440px, calc(100vw - 32px)); }
    .list-dialog::backdrop { background: rgba(0, 0, 0, .72); }
    .list-dialog h2 { font-family: Lora, Georgia, serif; margin: 0 0 8px; }
    .list-dialog__status { color: var(--muted); margin: 0 0 10px; min-height: 1.2em; }
    .list-dialog__lists { display: grid; gap: 6px; list-style: none; margin: 0 0 14px; max-height: 50vh; overflow-y: auto; padding: 0; }
    .list-dialog__list { align-items: center; border: 1px solid var(--line); cursor: pointer; display: flex; gap: 10px; padding: 10px 12px; }
    .list-dialog__list:hover { border-color: var(--accent); }
    .list-dialog__list input { flex: 0 0 auto; }
    .list-dialog__list > span { align-items: center; display: inline-flex; gap: 10px; min-width: 0; }
    .list-dialog__empty { color: var(--muted); margin: 0 0 14px; }
    .list-dialog__actions { display: flex; justify-content: flex-end; }
    .account-page { max-width: none; width: 100%; }
    .page-content:has(.account-page) { width: min(1440px, calc(100% - 48px)); }
    .account-page > [data-auth-account] { background: transparent; border: 0; margin-top: 24px; padding: 0; }
    .account-author-settings { border-top: 1px solid var(--line); margin: 26px 0; padding-top: 22px; }
    .account-author-settings[hidden], .account-author-form[hidden] { display: none; }
    .account-author-settings h2 { font-size: 24px; margin: 0 0 8px; }
    .account-author-settings__intro { color: var(--muted); margin: 0 0 16px; }
    .account-author-form { margin-top: 18px; }
    .account-author-form__workspace { align-items: start; display: grid; gap: clamp(24px, 4vw, 48px); grid-template-columns: minmax(0, 1.35fr) minmax(280px, .75fr); }
    .account-author-form__fields { align-items: start; display: grid; gap: 14px 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .account-author-form__wide { grid-column: 1 / -1; }
    .account-author-form__sync { background: var(--accent); border: 1px solid var(--accent); color: var(--paper); cursor: pointer; font: 700 13px 'Source Sans 3', sans-serif; justify-self: start; padding: 10px 14px; }
    .account-author-form__sync:hover { background: transparent; color: var(--accent); }
    .account-author-form__sync:disabled { cursor: wait; opacity: .65; }
    .account-author-form__sync-note { color: var(--muted); font-size: 13px; grid-column: 1 / -1; margin: -8px 0 0; }
    .account-author-form label { color: var(--muted); display: grid; font-size: 13px; font-weight: 600; gap: 6px; }
    .account-author-form input, .account-author-form textarea { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 2px; color: var(--ink); font: 16px 'Source Sans 3', sans-serif; padding: 10px 12px; width: 100%; }
    .account-author-form label.account-author-form__check { align-items: center; display: flex; flex-direction: row; font-weight: 400; }
    .account-author-form__check input { height: 18px; padding: 0; width: 18px; }
    .account-author-form__pins { border: 1px solid var(--line); display: grid; gap: 10px; margin: 0; min-width: 0; padding: 14px; }
    .account-author-form__pins legend { color: var(--ink); font: 600 16px 'Lora', Georgia, serif; padding: 0 6px; }
    .account-author-form__pins > p { color: var(--muted); font-size: 13px; margin: 0; }
    .account-author-post-picker { display: grid; gap: 8px; max-height: 360px; overflow-y: auto; }
    .account-author-post-option { align-items: center; border-bottom: 1px solid var(--line); color: var(--ink) !important; display: grid !important; font-weight: 400 !important; gap: 10px !important; grid-template-columns: 20px minmax(0, 1fr); padding: 9px 0; }
    .account-author-post-option input { height: 18px; padding: 0; width: 18px; }
    .account-author-post-option__title { font-size: 15px; line-height: 1.35; }
    .account-author-post-option__meta { color: var(--muted); display: block; font-size: 12px; font-weight: 400; }
    .account-author-form textarea { resize: vertical; }
    .account-author-form small, .account-author-form__status { color: var(--muted); font-size: 13px; font-weight: 400; }
    .account-author-form__actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .account-author-form__cancel { background: transparent; border: 1px solid var(--line); color: var(--ink); cursor: pointer; font: 600 13px 'Source Sans 3', sans-serif; padding: 9px 14px; }
    .account-author-preview { background: var(--paper-deep); border: 1px solid var(--line); min-width: 0; padding: 16px; position: sticky; top: 92px; }
    .account-post-metadata { margin-top: 28px; }
    .account-post-metadata__intro, .account-post-metadata__status { color: var(--muted); font-size: 13px; margin: 0 0 10px; }
    .account-post-metadata__list { list-style: none; margin: 0; padding: 0; }
    .account-post-metadata__item { border-bottom: 1px solid var(--line); padding: 10px 0; }
    .account-post-metadata__row { align-items: center; display: flex; gap: 12px; justify-content: space-between; }
    .account-post-metadata__title { color: var(--ink); font-size: 15px; line-height: 1.35; min-width: 0; }
    .account-post-metadata__title a { color: inherit; }
    .account-post-metadata__badges { display: flex; flex-shrink: 0; gap: 8px; }
    .account-post-metadata__badge { color: var(--muted); font-size: 12px; }
    .account-post-metadata__edit { background: transparent; border: 1px solid var(--line); color: var(--accent); cursor: pointer; flex-shrink: 0; font: 600 12px 'Source Sans 3', sans-serif; padding: 6px 10px; }
    .account-post-metadata__form { display: grid; gap: 12px; margin-top: 12px; }
    .account-post-metadata__form label { color: var(--muted); display: grid; font-size: 13px; font-weight: 600; gap: 6px; }
    .account-post-metadata__form input, .account-post-metadata__form textarea { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 2px; color: var(--ink); font: 15px 'Source Sans 3', sans-serif; padding: 10px 12px; resize: vertical; width: 100%; }
    .account-post-metadata__form-actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .account-post-metadata__save { background: var(--accent); border: 1px solid var(--accent); color: var(--paper); cursor: pointer; font: 700 13px 'Source Sans 3', sans-serif; padding: 9px 14px; }
    .account-post-metadata__save:disabled { cursor: wait; opacity: .65; }
    .account-post-metadata__cancel { background: transparent; border: 1px solid var(--line); color: var(--ink); cursor: pointer; font: 600 13px 'Source Sans 3', sans-serif; padding: 8px 12px; }
    .account-post-metadata__form-status { color: var(--muted); font-size: 13px; margin: 0; }
    .account-search-input { background: var(--paper); border: 1px solid var(--line); border-radius: 2px; color: var(--ink); font: 15px 'Source Sans 3', sans-serif; margin-bottom: 10px; min-height: 44px; padding: 9px 12px; width: 100%; }
    .account-search-input::placeholder { color: var(--muted); opacity: .8; }
    .account-author-preview__banner { align-items: center; aspect-ratio: 3 / 1; background: linear-gradient(130deg, var(--paper), var(--accent)); color: var(--paper); display: flex; justify-content: center; overflow: hidden; position: relative; }
    .account-author-preview__banner img { height: 100%; object-fit: cover; position: absolute; width: 100%; }
    .account-author-preview__banner span { font: 600 15px 'Lora', Georgia, serif; }
    .account-author-preview__identity { align-items: end; display: flex; gap: 14px; margin-top: -26px; padding: 0 12px; position: relative; }
    .account-author-preview__avatar { background: var(--paper-deep); border: 4px solid var(--paper-deep); border-radius: 50%; flex: 0 0 76px; height: 76px; object-fit: cover; width: 76px; }
    .account-author-preview__avatar[hidden] { display: none; }
    .account-author-preview__avatar--placeholder { align-items: center; color: var(--accent); display: inline-flex; font-size: 25px; justify-content: center; }
    .account-author-preview__avatar--placeholder[hidden], .account-author-preview__banner span[hidden] { display: none; }
    .account-author-preview__identity h3 { font-size: 20px; margin: 0; overflow-wrap: anywhere; }
    .account-author-preview__identity p, .account-author-preview__pronouns, .account-author-preview__bio { color: var(--muted); margin: 3px 0 0; overflow-wrap: anywhere; }
    .account-author-preview__pronouns, .account-author-preview__bio, .account-author-preview__footnote { margin-left: 12px; margin-right: 12px; }
    .account-author-preview__bio { color: var(--ink); margin-top: 12px; white-space: pre-wrap; }
    .account-author-preview__footnote { border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; margin-bottom: 0; margin-top: 18px; padding-top: 10px; }
    .privacy-page { line-height: 1.7; margin: 18px auto 64px; max-width: 760px; }
    .privacy-page > p, .privacy-page li { color: #e0d8c7; }
    .privacy-page h2 { font-family: 'Lora', Georgia, serif; font-size: 24px; margin: 34px 0 8px; }
    .privacy-page ul { padding-left: 22px; }
    .privacy-page li { margin: 10px 0; }
    .privacy-page__updated { color: var(--muted) !important; font-size: 14px; margin: 6px 0 24px; }
    .site-footer { border-top-width: 1px; padding-top: 48px; }
    .footer-tagline { color: #d2cbb9; }
    .footer-legal { display: flex; font-size: 13px; gap: 14px; margin-top: 14px; }
    .footer-legal a { color: var(--muted); text-decoration: underline; text-underline-offset: 3px; }
    .footer-social a { background: rgba(178,172,136,.1); border: 1px solid var(--line); border-radius: 50%; display: inline-grid; height: 38px; place-items: center; width: 38px; }
    .site-footer .footer-social { align-items: center; display: flex; gap: 12px; margin-top: 16px; }
    .site-footer .footer-social a { align-items: center; background: rgba(178,172,136,.1); border: 1px solid var(--line); border-radius: 50%; color: var(--accent); display: inline-flex; font-size: 16px; height: 38px; justify-content: center; width: 38px; }
    .site-footer .footer-social a:hover, .site-footer .footer-social a:focus-visible { border-color: var(--accent); color: var(--ink); }
    .site-footer .footer-legal { align-items: center; display: flex; flex-wrap: wrap; font-size: 13px; gap: 8px 16px; margin-top: 14px; }
    .site-footer .footer-legal a { color: var(--muted); text-decoration: underline; text-underline-offset: 3px; }
    .site-footer .footer-legal a:hover, .site-footer .footer-legal a:focus-visible { color: var(--accent); }
    @media (max-width: 760px) { .header-inner { grid-template-columns: auto auto minmax(0,1fr) auto; min-height: 76px; }.header-back { display: inline-flex; grid-column: 1; grid-row: 1; }.hamburger-button { grid-column: 2; grid-row: 1; }.site-brand { font-size: 1.5rem; grid-column: 3; grid-row: 1; justify-self: center; }.header-links { grid-column: 4; grid-row: 1; }.header-links .rss-link, .header-links .pds-link { display: none; }.page-content { padding-top: 30px; }.writers-callout { margin-top: 46px; padding: 24px; }.archive-story h3 { padding-left: 14px; padding-right: 14px; }.archive-story .eyebrow, .archive-story p:not(.eyebrow), .archive-story__footer { padding-left: 14px; padding-right: 14px; }.auth-options { grid-template-columns: 1fr; }.auth-option { padding: 20px; }.auth-card { padding: 18px; }.privacy-page h2 { font-size: 21px; }.account-author-form__workspace { grid-template-columns: 1fr; }.account-author-preview { position: static; }.account-author-form__fields { grid-template-columns: 1fr; }.account-author-form__wide, .account-author-form__sync-note { grid-column: 1; } }
    .section-heading { border-top-color: var(--line); }
    .recent-stories { border-top-color: var(--line); }
    @media (max-width: 760px) {
      .header-inner { gap: 8px; width: calc(100% - 32px); }
      .site-brand { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
      .header-links { gap: 6px; }
      .search-button-icon, .login-button { min-height: 44px; }
      .login-button { padding-left: 10px; padding-right: 10px; }
      .mobile-nav a { display: flex; align-items: center; min-height: 48px; }
      .mobile-nav .search-button-icon { min-height: 48px; text-align: left; }
      .page-content { padding-top: 24px; padding-bottom: 48px; }
      .front-page__grid { gap: 28px; padding-top: 24px; }
      .recent-stories__heading { padding: 10px 0; }
      .side-story { gap: 12px; grid-template-columns: 84px minmax(0, 1fr); padding: 14px 0; }
      .side-story__image { width: 84px; }
      .side-story h3 { font-size: 16px; line-height: 1.32; }
      .story-footer { align-items: flex-start; flex-direction: column; gap: 12px; }
      .article__back { align-items: center; display: inline-flex; min-height: 44px; }
      .article-engagement { gap: 8px; }
      .article-view-counter { align-items: center; display: inline-flex; min-height: 44px; }
      .reaction-button { min-height: 44px; padding: 8px 12px; }
      .writers-callout { gap: 18px; padding: 22px; }
      .writers-callout .read-link { white-space: normal; }
    }
    @media (max-width: 480px) {
      .header-inner, .page-content, .footer-inner { width: calc(100% - 32px); }
      .site-brand { font-size: 1.24rem; }
      .section-heading { letter-spacing: .1em; padding: 11px 0 9px; }
      .section-heading span:last-child { font-size: 10px; }
      .lead-story h2 { font-size: clamp(2.15rem, 10vw, 3rem); }
      .lead-story__summary { font-size: 18px; }
      .writers-callout { margin-top: 38px; padding: 20px; }
      .archive-section { margin-top: 52px; }
      .archive-story { padding-bottom: 14px; margin-bottom: 14px; }
      .archive-story h3 { font-size: 19px; }
      .archive-search { margin-bottom: 28px; }
      .recommendations { margin-top: 48px; }
      .recommendation-card { border-top: 1px solid var(--line); }
      .recommendation-card__image { margin-top: 0; }
      .article__header { padding-bottom: 22px; margin-bottom: 22px; }
      .article__header h1 { font-size: clamp(2.25rem, 10vw, 3.25rem); line-height: 1.05; }
      .article__dek { font-size: 19px; }
      .article-engagement { gap: 4px 8px; }
      .reaction-button { font-size: 12px; padding: 7px 9px; }
      .prose p, .prose li, .prose-paragraph { font-size: min(var(--reader-size), 18px); line-height: 1.75; }
      .prose table { display: block; max-width: 100%; overflow-x: auto; }
      .article__cover { margin: 20px 0; }
      .mobile-nav .login-button { margin-left: 16px; }
    }
    @media (max-width: 900px) {
      .article-layout { gap: 36px; }
      .article-rail { background: rgba(59,42,29,.32); border-top: 2px solid var(--line-strong); display: block; padding: 18px; position: static; width: 100%; }
      .article-rail ul { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); column-gap: 20px; }
      .article-rail__authors ul { grid-template-columns: repeat(2, minmax(0,1fr)); }
    }
    @media (max-width: 600px) {
      body { overflow-x: hidden; }
      .article-layout { gap: 28px; }
      .article { width: 100%; }
      .article-rail { padding: 16px 14px; }
      .article-rail ul, .article-rail__authors ul { grid-template-columns: 1fr; }
      .article-rail li { padding: 12px 0; }
      .article-rail__authors { margin-top: 28px; }
      .article__cover img, .prose img, .prose video, .prose iframe { height: auto; max-width: 100%; }
      .prose video, .prose-video-figure video { display: block; width: 100%; }
      .prose-video-figure { margin: 1.8rem 0; }
      .prose-video-figure__caption { color: var(--muted); font-size: 14px; margin-top: 8px; text-align: center; }
      .prose .prose-embed { background: var(--paper-deep); border: 1px solid var(--line); display: block; margin: 24px auto; max-width: 100%; }
      .prose pre, .prose-pre { max-width: 100%; overflow-x: auto; }
      .article-engagement { display: grid; }
      .article-engagement .article-reactions__buttons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .article-reactions__status { flex-basis: 100%; }
    }
    @media (max-width: 760px) {
      .front-page { display: grid; gap: 0; }
      .front-page__grid { display: contents; }
      .lead-column { display: contents; }
      .front-page > .section-heading { margin-bottom: 10px; }
      .lead-story { display: block; padding: 0 0 20px; }
      .lead-image { aspect-ratio: 16 / 10; max-height: 56vw; }
      .lead-story__content { display: block; padding: 16px 0 0; }
      .lead-story h2 { font-size: clamp(1.65rem, 7vw, 2.4rem); line-height: 1.08; margin: 0; overflow-wrap: anywhere; }
      .lead-story__summary { display: block; font-size: 16px; line-height: 1.5; margin: 10px 0 0; }
      .lead-story .story-footer { align-items: flex-start; border: 0; flex-direction: column; gap: 8px; margin: 12px 0 0; padding: 0; }
      .lead-story .story-footer .read-link { display: none; }
      .lead-story .article-meta { align-items: center; flex-direction: row; flex-wrap: wrap; gap: 4px 10px; }
      .recent-stories { border-top: 0; display: grid; gap: 0; }
      .recent-stories { order: 2; }
      .home-pinned { margin-top: 20px; order: 3; }
      .home-pinned__grid { grid-template-columns: 1fr; gap: 0; }
      .home-pinned__card { align-items: center; border-bottom: 1px solid var(--line); display: grid; gap: 12px; grid-template-columns: 92px minmax(0, 1fr); padding: 12px 0; }
      .home-pinned__image { aspect-ratio: 1; grid-column: 1; grid-row: 1; }
      .home-pinned__content { grid-column: 2; grid-row: 1; min-width: 0; padding: 0; }
      .home-pinned__content h3 { font-size: 16px; line-height: 1.25; }
      .home-pinned__content .home-post-author { font-size: 12px; margin: 5px 0 0; }
      .side-story { align-items: center; background: transparent; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; column-gap: 12px; grid-template-columns: 68px minmax(0, 1fr); margin: 0; padding: 12px 0; }
      .side-story__image { aspect-ratio: 1; border-radius: 2px; grid-row: 1 / span 3; min-width: 0; width: 100%; }
      .side-story > div { min-width: 0; }
      .side-story h3 { display: -webkit-box; font-size: clamp(1rem, 4.5vw, 1.25rem); line-height: 1.2; margin: 0; min-width: 0; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .side-story .home-post-author { font-size: 12px; margin: 4px 0; }
      .side-story .home-post-author img, .side-story .home-post-author__placeholder { flex-basis: 20px; height: 20px; width: 20px; }
      .side-story .article-meta { align-items: center; display: flex; flex-direction: row; flex-wrap: wrap; font-size: 11px; gap: 2px 8px; }
      .home-authors { margin-top: 36px; }
      .home-authors .author-grid { gap: 8px; grid-template-columns: 1fr; }
      .home-authors .author-card { gap: 12px; padding: 12px; }
      .home-authors .author-card__avatar { flex-basis: 48px; height: 48px; width: 48px; }
      .home-authors .author-card__details strong { font-size: 17px; }
      .home-authors .author-card__details span { font-size: 12px; }
      .archive-section { border-top: 2px solid var(--line-strong); margin-top: 24px; padding-top: 6px; }
      .archive-section > .section-heading { border: 0; margin: 0; padding: 10px 0 4px; }
      .archive-grid { display: grid; gap: 0; grid-template-columns: 1fr; }
      .archive-story { align-items: center; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; column-gap: 14px; display: grid; grid-template-columns: 76px minmax(0, 1fr); padding: 14px 0; }
      .archive-story__image { aspect-ratio: 1; grid-column: 1; grid-row: 1 / 3; margin: 0; }
      .archive-story > div:first-of-type { grid-column: 2; grid-row: 1; min-width: 0; }
      .archive-story h3 { display: -webkit-box; font-size: clamp(1.1rem, 4.8vw, 1.4rem); line-height: 1.2; margin: 0; min-width: 0; overflow: hidden; overflow-wrap: anywhere; padding: 0; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .archive-story p:not(.eyebrow), .archive-story .eyebrow { display: none; }
      .archive-story__footer { align-self: end; border: 0; grid-column: 2; grid-row: 2; margin: 5px 0 0; padding: 0; }
      .archive-story__footer .read-link { display: none; }
      .archive-story .article-meta { align-items: center; display: flex; flex-direction: row; flex-wrap: wrap; gap: 3px 9px; }
      .archive-section__footer { margin-top: 18px; }
    }
    @media (max-width: 420px) {
      .site-brand { font-size: clamp(.9rem, 4.5vw, 1.15rem); }
      .lead-image { aspect-ratio: 1.35 / 1; max-height: none; }
      .home-pinned__card { gap: 10px; grid-template-columns: 76px minmax(0, 1fr); }
      .side-story { column-gap: 10px; grid-template-columns: 60px minmax(0, 1fr); }
      .archive-story { column-gap: 10px; grid-template-columns: 60px minmax(0, 1fr); }
      .lead-story h2 { font-size: 1.7rem; }
      .side-story h3, .archive-story h3 { font-size: 1rem; }
      .article-meta { font-size: 11px; }
    }
    @media (max-width: 360px) {
      .header-inner { gap: 5px; width: calc(100% - 24px); }
      .header-links { gap: 4px; }
      .login-button { padding-left: 7px; padding-right: 7px; }
    }
    .forum-page { margin: 0 auto; max-width: 900px; }
    .forum-header { border-bottom: 1px solid var(--line); margin-bottom: 28px; padding-bottom: 22px; }
    .forum-header h1, .forum-thread h1 { font-size: clamp(2.3rem, 6vw, 4rem); margin: 0 0 16px; }
    .forum-description { color: var(--muted); }
    .forum-rules, .forum-composer { background: var(--paper-deep); border: 1px solid var(--line); margin: 24px 0; padding: 20px; }
    .forum-rules h2, .forum-composer h2 { font-size: 1.4rem; margin: 0 0 12px; }
    .forum-rules ol { margin: 0; padding-left: 22px; }
    .forum-rules li + li { margin-top: 12px; }
    .forum-rules p { color: var(--muted); margin: 4px 0 0; }
    .forum-filter { align-items: end; display: flex; flex-wrap: wrap; gap: 14px; margin: 28px 0 18px; }
    .forum-index-actions { display: flex; justify-content: flex-end; margin: 26px 0 14px; }
    .forum-page label { color: var(--muted); display: grid; font-size: 14px; gap: 5px; }
    .forum-page input, .forum-page textarea, .forum-page select { background: var(--paper); border: 1px solid var(--line-strong); border-radius: 2px; color: var(--ink); font: inherit; max-width: 100%; padding: 9px 10px; }
    .forum-page input:focus, .forum-page textarea:focus, .forum-page select:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
    .forum-composer, .forum-reply-form { display: grid; gap: 14px; }
    .forum-composer textarea, .forum-reply-form textarea { resize: vertical; width: 100%; }
    .forum-composer select[multiple] { min-height: 100px; }
    .forum-status { color: var(--accent); font-size: 14px; margin: 0; }
    .forum-status[data-error="true"] { color: #ffb4a8; }
    .forum-post-list { margin-top: 10px; }
    .forum-post-card { border-bottom: 1px solid var(--line); padding: 22px 4px; }
    .forum-post-card__byline { align-items: center; color: var(--muted); display: flex; flex-wrap: wrap; font-size: 14px; gap: 10px; }
    .forum-post-card__byline img { border-radius: 50%; height: 34px; object-fit: cover; width: 34px; }
    .forum-post-card__byline time { margin-left: auto; }
    .forum-post-card h2 { font-size: clamp(1.35rem, 3vw, 2rem); margin: 12px 0; }
    .forum-post-card__excerpt { max-height: 180px; overflow: hidden; }
    .forum-post-card__excerpt > :first-child { margin-top: 0; }
    .forum-post-card__footer { align-items: center; display: flex; flex-wrap: wrap; gap: 18px; justify-content: space-between; margin-top: 14px; }
    .forum-post-card__footer > span { display: flex; flex-wrap: wrap; gap: 10px; }
    .forum-post-card__footer > span a, .forum-badge { border: 1px solid var(--line); color: var(--accent); font-size: 12px; padding: 2px 8px; }
    .forum-votes { align-items: center; display: inline-flex; gap: 7px; }
    .forum-votes button, .forum-moderation button, .forum-reply-link { background: transparent; border: 1px solid var(--line); color: var(--muted); cursor: pointer; font: inherit; padding: 4px 9px; }
    .forum-votes button[aria-pressed="true"] { background: var(--accent); color: var(--paper); }
    .forum-moderation { display: none; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
    .forum-moderation.is-visible { display: flex; }
    .forum-thread { margin: 0 auto; max-width: 820px; }
    .forum-create-page { max-width: 820px; }
    .forum-back-link { display: inline-block; margin-bottom: 24px; }
    .forum-create-intro { color: var(--muted); font-size: 19px; margin: 0; max-width: 620px; }
    .forum-editor { display: grid; gap: 18px; margin-top: 24px; padding: 24px; }
    .forum-editor label { font-size: 13px; gap: 7px; }
    .forum-editor input, .forum-editor textarea { background: var(--paper); border: 1px solid var(--line-strong); border-radius: 3px; color: var(--ink); font: inherit; font-size: 16px; padding: 11px 13px; width: 100%; }
    .forum-editor textarea { line-height: 1.65; resize: vertical; }
    .forum-editor input:focus, .forum-editor textarea:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
    .forum-markdown-note, .forum-field-hint { color: var(--muted); font-size: 13px; margin: -10px 0 0; }
    .forum-field-hint { font-weight: 400; letter-spacing: 0; text-transform: none; }
    .forum-editor__actions { align-items: center; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 18px; padding-top: 18px; }
    .forum-composer-ui { gap: 0; padding: 0; }
    .forum-composer-ui > .forum-status { padding: 12px 20px 0; }
    .forum-composer-ui__card { display: flex; gap: 14px; padding: 20px; }
    .forum-composer-ui__avatar { align-items: center; align-self: flex-start; background: var(--accent); border-radius: 50%; color: var(--paper); display: flex; flex: 0 0 44px; height: 44px; justify-content: center; overflow: hidden; width: 44px; }
    .forum-composer-ui__avatar img { border-radius: 50%; height: 100%; object-fit: cover; width: 100%; }
    .forum-composer-ui__body { display: grid; flex: 1 1 auto; gap: 12px; min-width: 0; }
    .forum-composer-ui input[type="text"], .forum-composer-ui textarea { background: transparent; border: 0; border-radius: 0; font-size: 18px; padding: 0; }
    .forum-composer-ui input[type="text"]:focus, .forum-composer-ui textarea:focus { outline: none; }
    .forum-composer-ui input::placeholder, .forum-composer-ui textarea::placeholder { color: var(--muted); opacity: .8; }
    .forum-composer-ui__title { font-size: 20px; font-weight: 700; }
    .forum-composer-ui textarea { line-height: 1.6; max-height: 50vh; min-height: 90px; overflow-y: auto; resize: none; }
    .forum-composer-ui__attachments { display: flex; flex-wrap: wrap; gap: 8px; }
    .forum-composer-ui__attachments img { border-radius: 6px; height: 96px; object-fit: cover; width: 96px; }
    .forum-composer-ui__alts { color: var(--muted); display: grid; font-size: 13px; gap: 6px; }
    .forum-composer-ui__alts textarea { border: 1px solid var(--line) !important; border-radius: 4px !important; font-size: 14px !important; min-height: 0; padding: 8px 10px !important; }
    .forum-composer-ui__toolbar { align-items: center; border-top: 1px solid var(--line); display: flex; gap: 14px; padding: 12px 16px; }
    .forum-composer-ui__tool { align-items: center; border-radius: 50%; color: var(--accent); cursor: pointer; display: inline-flex; font-size: 18px; height: 36px; justify-content: center; position: relative; width: 36px; }
    .forum-composer-ui__tool:hover { background: rgba(178,172,136,.14); }
    .forum-composer-ui__count { background: var(--accent); border-radius: 999px; color: var(--paper); font-size: 11px; font-weight: 700; line-height: 1; padding: 3px 6px; position: absolute; right: -4px; top: -2px; }
    .forum-composer-ui__tags { align-items: center; color: var(--muted); display: flex; gap: 7px; }
    .forum-composer-ui__tags input { border-bottom: 1px solid var(--line) !important; font-size: 14px !important; padding: 3px 2px !important; width: 140px; }
    .forum-composer-ui__hint { color: var(--muted); font-size: 12px; margin-left: auto; }
    .forum-composer-ui__post { background: var(--accent); border: 0; border-radius: 999px; color: var(--paper); cursor: pointer; font: 700 15px 'Source Sans 3', sans-serif; margin-left: auto; padding: 8px 22px; }
    .forum-composer-ui__post:disabled { cursor: wait; opacity: .6; }
    .forum-composer-ui__hint + .forum-composer-ui__post { margin-left: 0; }
    .forum-reply-form.forum-composer-ui { padding: 0; }
    .forum-reply-form.forum-composer-ui .forum-composer-ui__card { padding: 14px 16px; }
    .forum-thread > .read-link { display: inline-block; margin-bottom: 30px; }
    .forum-thread > .forum-post-card__byline { margin: 18px 0 28px; }
    .forum-thread__content { margin-top: 28px; }
    .forum-thread__replies { margin-top: 48px; }
    .forum-reply-form { background: var(--paper-deep); border: 1px solid var(--line); margin: 20px 0; padding: 18px; }
    .forum-replies { margin-top: 18px; }
    .forum-reply { border-left: 1px solid var(--line-strong); margin: 18px 0 18px calc(min(var(--reply-depth), 5) * 18px); padding: 4px 0 4px 16px; }
    .forum-reply > header { color: var(--muted); display: flex; flex-wrap: wrap; font-size: 14px; gap: 12px; justify-content: space-between; margin-bottom: 10px; }
    .forum-reply .forum-moderation { margin: 8px 0; }
    .forum-reply-link { font-size: 13px; margin-top: 6px; }
    .forum-locked { color: var(--muted); }
    .forum-images { display: flex; flex-wrap: wrap; gap: 14px; margin: 16px 0; }
    .forum-images figure { margin: 0; max-width: 100%; width: min(100%, 520px); }
    .forum-images img { border-radius: 3px; display: block; height: auto; max-height: 600px; object-fit: contain; width: 100%; }
    .forum-images figcaption { color: var(--muted); font-size: 13px; margin-top: 5px; }
    .forum-next-page { display: block; margin-top: 28px; text-align: right; }
    .user-forum-post { border-bottom: 1px solid var(--line); padding: 14px 6px; }
    .user-forum-post h3 { font-size: 19px; margin: 0 0 5px; }
    .user-forum-post time { color: var(--muted); font-size: 13px; }
    @media (max-width: 760px) {
      .forum-filter { align-items: stretch; flex-direction: column; }
      .forum-filter > * { width: 100%; }
      .forum-editor { padding: 14px; }
      .forum-post-card__byline time { margin-left: 0; }
      .forum-reply { margin-left: calc(min(var(--reply-depth), 5) * 8px); padding-left: 10px; }
      .forum-composer, .forum-rules { padding: 14px; }
    }

    .visually-hidden { border: 0; clip: rect(0 0 0 0); height: 1px; margin: -1px; overflow: hidden; padding: 0; position: absolute; white-space: nowrap; width: 1px; }
    .search-bar { display: grid; gap: 12px; margin: 0 0 28px; }
    .search-bar__field { align-items: center; background: var(--paper-deep); border: 1px solid var(--line-strong); border-radius: 3px; display: flex; min-height: 50px; padding-left: 14px; }
    .search-bar__field:focus-within { box-shadow: 0 0 0 2px var(--accent); }
    .search-bar__icon { color: var(--muted); font-size: 15px; }
    .search-bar__field input { background: transparent; border: 0; color: var(--ink); flex: 1 1 auto; font: inherit; font-size: 17px; min-width: 0; padding: 12px; }
    .search-bar__field input:focus { outline: none; }
    .search-bar__field input::placeholder { color: var(--muted); opacity: .8; }
    .search-bar__submit { align-self: stretch; background: var(--accent); border: 0; color: var(--paper); cursor: pointer; font: 700 13px 'Source Sans 3', sans-serif; letter-spacing: .06em; padding: 0 20px; text-transform: uppercase; transition: background 160ms, color 160ms; }
    .search-bar__submit:hover { background: var(--ink); }
    .search-bar__filters { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
    .search-bar .search-bar__filter { align-items: center; background: transparent; border: 1px solid var(--line); border-radius: 999px; display: inline-flex; gap: 2px; padding-left: 12px; position: relative; }
    .search-bar .search-bar__filter.is-active, .search-bar .search-bar__toggle.is-active { border-color: var(--accent); background: rgba(178, 172, 136, .12); }
    .search-bar .search-bar__filter:focus-within, .search-bar .search-bar__toggle:focus-within { box-shadow: 0 0 0 2px var(--accent); }
    .search-bar .search-bar__filter label { color: var(--muted); display: inline; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .search-bar .search-bar__filter select { appearance: none; background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23b2ac88'/%3E%3C/svg%3E") no-repeat right 12px center; border: 0; color: var(--ink); cursor: pointer; font: 600 14px 'Source Sans 3', sans-serif; min-height: 36px; padding: 6px 30px 6px 6px; }
    .search-bar .search-bar__filter select:focus { outline: none; }
    .search-bar .search-bar__filter option { background: var(--paper-deep); color: var(--ink); }
    .search-bar .search-bar__toggle { align-items: center; border: 1px solid var(--line); border-radius: 999px; color: var(--ink); cursor: pointer; display: inline-flex; font-size: 14px; font-weight: 600; gap: 8px; min-height: 38px; padding: 0 14px; }
    .search-bar__toggle input { accent-color: var(--accent); height: 16px; margin: 0; width: 16px; }
    .search-bar__clear { color: var(--accent); font-size: 13px; font-weight: 700; letter-spacing: .04em; margin-left: 4px; text-transform: uppercase; }
    .search-bar__clear:hover { color: var(--ink); }
    @media (max-width: 520px) {
      .search-bar__submit { padding: 0 14px; }
      .search-bar__filters { display: grid; grid-template-columns: 1fr 1fr; }
      .search-bar .search-bar__filter { border-radius: 3px; justify-content: space-between; }
      .search-bar .search-bar__filter select { min-height: 44px; }
      .search-bar .search-bar__toggle { border-radius: 3px; min-height: 46px; }
      .search-bar__clear { grid-column: 1 / -1; margin: 4px 0 0; }
    }
    .search-page .section-heading { margin-top: 32px; }
    .search-page .search-page__bar + .section-heading { margin-top: 0; }
    .search-results { display: grid; }
    .search-result { border-top: 1px solid var(--line); padding: 18px 0; }
    .search-result h3 { font-size: 21px; letter-spacing: -.02em; line-height: 1.25; margin: 0 0 6px; }
    .search-result p:not(.eyebrow) { color: var(--muted); font-size: 15px; line-height: 1.55; margin: 0; }
    .search-result .eyebrow { margin: 0 0 6px; }
    .search-result mark { background: rgba(178, 172, 136, .32); border-radius: 2px; color: var(--ink); padding: 0 2px; }
    .account-layout { align-items: start; display: grid; gap: clamp(24px, 3vw, 40px); grid-template-columns: minmax(240px, 300px) minmax(0, 1.4fr) minmax(260px, 1fr); }
    .account-layout--solo { grid-template-columns: 1fr; }
    .account-layout.account-layout--solo .account-layout__main { grid-column: 1 / -1; }
    .account-layout__column { display: grid; gap: 24px; min-width: 0; }
    .account-layout__sidebar { position: sticky; top: 96px; }
    .account-card { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 4px; padding: 20px; }
    .account-card h2 { font-size: 22px; margin: 0 0 12px; }
    .account-card__header { align-items: baseline; display: flex; gap: 12px; justify-content: space-between; margin-bottom: 12px; }
    .account-card__header h2 { margin: 0; }
    .account-card__count { color: var(--muted); font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .account-page .account-card.account-page__viewed, .account-page .account-card.account-author-settings { margin: 0; padding: 20px; }
    .account-page .account-card .account-page__profile { align-items: flex-start; flex-direction: column; gap: 12px; margin: 0; }
    .account-page__profile-meta { color: var(--muted); font-size: 14px; margin: 6px 0 0; }
    .account-page__profile-meta[hidden] { display: none; }
    .account-page__actions { display: grid; gap: 10px; margin-top: 18px; }
    .account-page__actions .auth-signout { width: 100%; }
    .account-page__section-nav { border-top: 1px solid var(--line); display: grid; gap: 2px; margin-top: 18px; padding-top: 14px; }
    .account-page__section-nav a { color: var(--muted); font-size: 14px; font-weight: 700; letter-spacing: .04em; padding: 6px 0; text-transform: uppercase; }
    .account-page__section-nav a i { color: var(--accent); display: inline-block; font-size: 13px; margin-right: 8px; text-align: center; width: 16px; }
    .account-card h2 i, .account-page__subheading i { color: var(--accent); font-size: .85em; margin-right: 8px; }
    .account-card .auth-signout i, .account-card button i { margin-right: 7px; }
    .account-email__list { display: grid; gap: 12px; list-style: none; margin: 14px 0; padding: 0; }
    .account-email__list li { align-items: center; display: flex; flex-wrap: wrap; gap: 8px 10px; }
    .account-email__list li span { flex: 1 1 180px; }
    .email-routing { margin-top: 10px; overflow-x: auto; }
    .email-routing__table { border-collapse: collapse; font-size: 14px; min-width: 100%; }
    .email-routing__table th, .email-routing__table td { border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
    .email-routing__table thead th { color: var(--ink); font: 700 12px 'Source Sans 3', sans-serif; }
    .email-routing__table tbody th { color: var(--ink); font-weight: 600; }
    .email-routing__table td { text-align: center; }
    .email-routing__table td input { accent-color: var(--accent); cursor: pointer; }
    .email-routing__table input:disabled { cursor: default; opacity: .45; }
    .email-routing__address { display: block; font: 600 13px 'Source Sans 3', sans-serif; overflow-wrap: anywhere; }
    .email-routing__badge { color: var(--muted); display: inline-block; font-size: 11px; font-weight: 600; }
    .email-routing__mode { background: var(--paper); border: 1px solid var(--line); border-radius: 4px; color: var(--ink); font: 12px 'Source Sans 3', sans-serif; margin-top: 6px; padding: 4px 6px; }
    .email-routing__group th { color: var(--muted); font: 700 11px 'Source Sans 3', sans-serif; letter-spacing: .1em; padding-top: 18px; text-transform: uppercase; }
    .account-follows-list { display: grid; gap: 4px; list-style: none; margin: 12px 0 0; padding: 0; }
    .account-follows-list__item { align-items: center; border-bottom: 1px solid var(--line); display: flex; gap: 10px; padding: 8px 0; }
    .account-follows-list__item:last-child { border-bottom: 0; }
    .account-follows-list__item > a { align-items: center; color: var(--ink); display: inline-flex; flex: 1 1 auto; gap: 8px; min-width: 0; }
    .account-follows-list__item > a i { color: var(--accent); }
    .account-follows-list__item > a:hover { color: var(--accent); }
    .account-follows-list__author img { border-radius: 50%; flex: 0 0 28px; height: 28px; object-fit: cover; width: 28px; }
    .account-follows-list__author small { color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
    .account-follows-list__unfollow { align-items: center; background: transparent; border: 1px solid var(--line); border-radius: 50%; color: var(--muted); cursor: pointer; display: inline-flex; flex: 0 0 30px; font-size: 13px; height: 30px; justify-content: center; padding: 0; width: 30px; }
    .account-follows-list__unfollow:hover { border-color: var(--accent); color: var(--accent); }
    .account-follows-list__unfollow:disabled { cursor: wait; opacity: .6; }
    .account-page__section-nav a:hover { color: var(--accent); }
    .account-page__section-nav a[hidden] { display: none; }
    .account-profile-form { display: grid; gap: 12px; margin-top: 16px; }
    .account-profile-form[hidden] { display: none; }
    .account-profile-form label { color: var(--muted); display: grid; font-size: 13px; font-weight: 600; gap: 6px; }
    .account-profile-form input, .account-profile-form textarea { background: var(--paper); border: 1px solid var(--line); border-radius: 2px; color: var(--ink); font: 16px 'Source Sans 3', sans-serif; padding: 10px 12px; width: 100%; }
    .account-profile-form__actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .account-profile-form__status { color: var(--muted); font-size: 14px; margin: 0; min-height: 1em; }
    .account-page__remove-save { align-items: center; display: inline-flex; gap: 6px; }
    .account-page__wide { grid-column: 1 / -1; }
    .account-layout__author { grid-column: 2 / -1; }
    .account-layout__main:last-child { grid-column: 2 / -1; }
    .account-layout .account-author-preview { position: static; }
    @media (max-width: 1100px) {
      .account-layout { grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); }
      .account-layout__secondary { grid-column: 2; }
    }
    @media (max-width: 760px) {
      .account-layout { grid-template-columns: 1fr; }
      .account-layout__sidebar { position: static; }
      .account-layout__secondary, .account-layout__author, .account-layout__main:last-child { grid-column: auto; }
      .account-page .account-card .account-page__profile { align-items: center; flex-direction: row; }
    }
    .account-preferences { display: grid; gap: 14px; }
    .account-preferences fieldset { border: 0; display: grid; gap: 8px; margin: 0; padding: 0; }
    .account-preferences legend, .account-preferences > label { color: var(--muted); font-size: 13px; font-weight: 600; }
    .account-preferences__options { display: flex; flex-wrap: wrap; gap: 8px; }
    .account-preferences__options label { align-items: center; background: var(--paper); border: 1px solid var(--line); border-radius: 999px; color: var(--ink); cursor: pointer; display: inline-flex; font: 600 13px 'Source Sans 3', sans-serif; gap: 6px; min-height: 38px; padding: 4px 14px; }
    .account-preferences__options label:has(input:checked) { border-color: var(--accent); background: rgba(178,172,136,.14); }
    html[data-theme="light"] .account-preferences__options label:has(input:checked) { background: rgba(111,99,53,.16); }
    .account-preferences__options input { accent-color: var(--accent); margin: 0; }
    .account-preferences__size { align-items: center; display: flex; gap: 12px; }
    .account-preferences__size input[type="range"] { accent-color: var(--accent); flex: 1 1 auto; }
    .account-preferences__size output { color: var(--ink); font: 600 13px 'Source Sans 3', sans-serif; min-width: 42px; }
    .account-preferences__status { color: var(--muted); font-size: 13px; margin: 0; min-height: 1.2em; }
    .account-preferences__note { color: var(--muted); font-size: 12px; margin: 0; }
    @media print {
      .site-header, .mobile-nav, .site-footer, .back-to-top, .reading-progress, .reading-resume,
      .article-rail, .article__comments, .article-engagement, .article-share, .article__back,
      .article__footer, .recommendations, .list-dialog, dialog, .article-banner,
      .block-dialog, .feed-client-dialog, noscript { display: none !important; }
      html, body { background: #ffffff !important; color: #1a1a1a !important; }
      .page-content { padding: 0 !important; width: 100% !important; }
      .article-layout { display: block !important; }
      .article { border: 0 !important; max-width: 100% !important; padding: 0 !important; width: 100% !important; }
      .article::before { content: "${escapeHtml(pubName)}"; display: block; font-family: Lora, serif; font-size: 22px; font-weight: 700; margin-bottom: 18px; }
      .article__header h1, .prose h2, .prose h3 { page-break-after: avoid; }
      .article__cover img, .prose img { max-width: 100% !important; }
      figure, pre, blockquote, .prose pre, .prose blockquote { page-break-inside: avoid; }
      .article__author, .article__reading-time, .article-tags { color: #444 !important; }
      .article-tags .article-tag { border-color: #999 !important; color: #444 !important; }
      .prose a { color: #1a1a1a !important; text-decoration: underline; }
      .prose a[href^="http"]::after { content: " (" attr(href) ")"; font-size: .85em; word-break: break-all; }
    }
  </style>
  <script>
    (function () {
      var root = document.documentElement;
      var lightMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : { matches: false };
      var cached = {};
      try { cached = JSON.parse(localStorage.getItem('cc.preferences') || '{}') || {}; } catch (error) {}
      var active = {};
      window.coffeeAndCodePreferences = {
        get: function () { return active; },
        apply: function (prefs) {
          var next = prefs && typeof prefs === 'object' ? prefs : {};
          var theme = next.theme === 'light' || next.theme === 'dark' || next.theme === 'system' ? next.theme : 'system';
          var fontChoices = { serif: 1, monospace: 1, system: 1, atkinson: 1, merriweather: 1, fraunces: 1, inter: 1 };
          var postFont = fontChoices[next.postFont] ? next.postFont : 'sans';
          var uiFont = fontChoices[next.uiFont] ? next.uiFont : 'sans';
          var size = Number(next.postFontSize);
          var hasSize = Number.isFinite(size) && size >= 14 && size <= 26;
          active = { theme: theme, uiFont: uiFont, postFont: postFont, postFontSize: hasSize ? size : undefined };
          root.dataset.theme = theme === 'system' ? (lightMedia.matches ? 'light' : 'dark') : theme;
          if (uiFont === 'sans') delete root.dataset.uiFont;
          else root.dataset.uiFont = uiFont;
          if (postFont === 'sans') delete root.dataset.readerFont;
          else root.dataset.readerFont = postFont;
          if (hasSize) root.style.setProperty('--reader-size', size + 'px');
          else root.style.removeProperty('--reader-size');
          try { localStorage.setItem('cc.preferences', JSON.stringify(active)); } catch (error) {}
        }
      };
      window.coffeeAndCodePreferences.apply(cached);
      if (lightMedia.addEventListener) {
        lightMedia.addEventListener('change', function () { window.coffeeAndCodePreferences.apply(active); });
      }
    })();
  </script>
</head>
<body>
  <header class="site-header"><div class="header-inner"><button type="button" class="header-back" data-header-back aria-label="Go back" title="Go back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button><nav class="site-nav" aria-label="Main navigation"><a href="/archive">Archive</a><a href="/tags">Tags</a><a href="/forum">Forum</a><a href="/feed" data-feed-client-picker>Feed</a></nav><a href="/" class="site-brand">${escapeHtml(pubName)}</a><div class="header-links"><div class="header-icon-actions"><a href="/search" class="search-button-icon" id="open-search" data-open-search aria-label="Search articles" title="Search articles"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></a><a href="/notifications" class="search-button-icon header-notifications-icon" data-notifications-link aria-label="Notifications" title="Notifications" hidden><i class="fa-solid fa-bell" aria-hidden="true"></i><span class="notification-badge" data-notifications-badge hidden></span></a><a class="pds-link" href="${externalLinkUrl(`https://bsky.app/profile/${did}`)}" target="_blank" rel="noopener" aria-label="Coffee and Code on Bluesky" title="Coffee and Code on Bluesky"><i class="fab fa-bluesky" aria-hidden="true"></i></a></div><a href="/auth" class="login-button" data-login-link>Log in</a><div class="header-account-menu" data-account-link hidden><button type="button" class="header-account" data-account-menu-button aria-label="Your account" title="Your account" aria-haspopup="true" aria-expanded="false"><span class="header-account__placeholder" data-account-placeholder aria-hidden="true"><i class="fa-solid fa-user"></i></span><img data-account-avatar alt="" hidden></button><nav class="header-account-menu__nav" data-account-menu aria-label="Account menu" hidden><a href="/account">Account</a><a href="/account/saves">Reading list</a><a href="/account/reads">Recently viewed</a><a href="/account/feed">Your feed</a><a href="/account/author">Author profile</a><div class="header-account-menu__switcher" data-account-switcher hidden></div></nav></div></div><button type="button" class="hamburger-button" id="hamburgerBtn" aria-label="Open navigation" aria-controls="mobileNav" aria-expanded="false">☰</button></div><nav class="mobile-nav" id="mobileNav" aria-label="Mobile navigation"><a href="/archive">Archive</a><a href="/tags">Tags</a><a href="/forum">Forum</a><a href="/authors">Authors</a><a href="/feed" data-feed-client-picker>Feed</a><a href="/search" class="search-button-icon" id="open-search-mobile" data-open-search aria-label="Search articles"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Search</a><a href="/auth" class="login-button" data-login-link>Log in</a><a href="/notifications" data-notifications-link hidden>Notifications <span class="notification-badge" data-notifications-badge hidden></span></a><a href="/account" data-mobile-account-link hidden>Account</a></nav></header>
  <main class="page-content">${content}</main>
  <dialog class="block-dialog" data-block-dialog aria-labelledby="block-dialog-title" aria-describedby="block-dialog-description">
    <h2 id="block-dialog-title" data-block-dialog-title>Block this account?</h2>
    <p id="block-dialog-description">Their stories, comments, and forum posts will be hidden from you on Coffee &amp; Code.</p>
    <label class="block-dialog__option"><input type="checkbox" data-block-on-bluesky><span>Also block this account on Bluesky</span></label>
    <p class="block-dialog__status" data-block-dialog-status role="status" aria-live="polite"></p>
    <div class="block-dialog__actions"><button type="button" class="author-follow__button" data-confirm-block>Confirm block</button><button type="button" class="auth-signout" data-cancel-block>Cancel</button></div>
  </dialog>
  <dialog class="block-dialog" data-unfollow-dialog aria-labelledby="unfollow-dialog-title" aria-describedby="unfollow-dialog-description">
    <h2 id="unfollow-dialog-title" data-unfollow-dialog-title>Unfollow this author?</h2>
    <p id="unfollow-dialog-description">You will stop following their stories on Coffee &amp; Code.</p>
    <label class="block-dialog__option"><input type="checkbox" data-unfollow-on-bluesky checked><span>Also unfollow on Bluesky</span></label>
    <p class="block-dialog__status" data-unfollow-dialog-status role="status" aria-live="polite"></p>
    <div class="block-dialog__actions"><button type="button" class="author-follow__button" data-confirm-unfollow>Unfollow</button><button type="button" class="auth-signout" data-cancel-unfollow>Cancel</button></div>
  </dialog>
  <dialog class="feed-client-dialog" data-feed-client-dialog aria-labelledby="feed-client-title" aria-describedby="feed-client-description">
    <h2 id="feed-client-title">Choose your Social App</h2>
    <p id="feed-client-description">Open the Coffee &amp; Code following feed in your preferred client.</p>
    <div class="feed-client-dialog__options">
      <a href="https://bsky.app/profile/coffeencode.cc/feed/following" target="_blank" rel="noopener">Bluesky (bsky.app)</a>
      <a href="https://mu.social/profile/coffeencode.cc/feed/following" target="_blank" rel="noopener">Mu<i>.social</i></a>
      <a href="https://anisota.net/profile/coffeencode.cc/feed/following" target="_blank" rel="noopener">Anisota</a>
      <a href="/feed">Coffee &amp; Code</a>
      <a href="https://witchsky.app/profile/coffeencode.cc/feed/following" target="_blank" rel="noopener">Witchsky</a>
    </div>
  </dialog>
  <search-modal-snippet class="search-modal" api-url="https://search.coffeencode.cc" placeholder="Search Coffee &amp; Code" max-results="25" max-render-results="7" show-url="true" show-date="true"></search-modal-snippet>
  <button class="back-to-top" id="backToTop" aria-label="Back to top" title="Back to top"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
  <footer class="site-footer"><div class="footer-inner"><div class="footer-brand-block"><p class="footer-brand">${pubName}</p><p class="footer-tagline">${pubDescription}</p><div class="footer-social"><a href="${externalLinkUrl(`https://bsky.app/profile/${did}`)}" target="_blank" rel="noopener" aria-label="Coffee and Code on Bluesky" title="Coffee and Code on Bluesky"><i class="fab fa-bluesky" aria-hidden="true"></i></a><a href="/rss.xml" aria-label="RSS feed" title="RSS feed"><i class="fas fa-rss" aria-hidden="true"></i></a><a href="/sitemap.xml" aria-label="Sitemap" title="Sitemap"><i class="fas fa-sitemap" aria-hidden="true"></i></a></div><nav class="footer-legal" aria-label="Legal"><a href="/docs">Docs</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="https://userinput.app/s/did:plc:l37td5yhxl2irrzrgvei4qay/3mxrdfzksld24" target="_blank" rel="noopener">Feedback</a><a href="https://status.coffeencode.cc" target="_blank" rel="noopener">System Status</a></nav></div><p class="footer-meta">© ${new Date().getFullYear()} ${pubName} an MBD Company</p></div></footer>
  <script>
    const idle = (callback, timeout = 2000) => {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(callback, { timeout });
      } else {
        window.setTimeout(callback, timeout);
      }
    };
    const afterLoadAndIdle = (callback, timeout) => {
      const schedule = () => idle(callback, timeout);
      if (document.readyState === 'complete') schedule();
      else window.addEventListener('load', schedule, { once: true });
    };
    const loadModule = (src) => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load module: ' + src));
      document.head.append(script);
    });

    // Show the signed-in header right away when this device has seen a sign-in;
    // the auth module confirms or reverts it once the session restores.
    try {
      const knownAccounts = JSON.parse(localStorage.getItem('cc:known-accounts') || '[]');
      const hasSessionHint = (Array.isArray(knownAccounts) && knownAccounts.length > 0)
        || Boolean(localStorage.getItem('cc:pds-session'));
      if (hasSessionHint) {
        document.querySelectorAll('[data-login-link]').forEach((link) => { link.hidden = true; });
        const headerAccount = document.querySelector('[data-account-link]');
        if (headerAccount) headerAccount.hidden = false;
        const mobileAccountLink = document.querySelector('[data-mobile-account-link]');
        if (mobileAccountLink) mobileAccountLink.hidden = false;
        const cachedAvatar = Array.isArray(knownAccounts) && knownAccounts[0] && knownAccounts[0].avatar;
        const avatarImage = document.querySelector('[data-account-avatar]');
        const avatarPlaceholder = document.querySelector('[data-account-placeholder]');
        if (avatarImage && cachedAvatar) {
          avatarImage.src = cachedAvatar;
          avatarImage.hidden = false;
          if (avatarPlaceholder) avatarPlaceholder.hidden = true;
        }
      }
    } catch (error) {}

    loadModule('/components/atproto-auth.js').catch((error) => {
      console.error(error);
      window.dispatchEvent(new Event('coffee-and-code-auth-ready'));
    });

    afterLoadAndIdle(() => {
      const analytics = document.createElement('script');
      analytics.src = 'https://cloud.umami.is/script.js';
      analytics.async = true;
      analytics.dataset.websiteId = 'ce9dca73-97c8-4831-8951-90b7fe8525b6';
      document.head.append(analytics);
    }, 2500);

    // Search bar drop-downs apply as soon as they change.
    document.querySelectorAll('form.search-bar [data-search-auto-submit]').forEach((control) => {
      control.addEventListener('change', () => {
        const form = control.form;
        if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
      });
    });
  </script>
  <script>
    // Load view counts without blocking the page.
    const viewCounterEndpoint = 'https://reads.coffeencode.cc/';
    const viewCounters = [...document.querySelectorAll('[data-view-counter][data-path]')];
    const renderViewCount = (element, views) => {
      element.textContent = Number(views).toLocaleString();
    };
    const loadViewCounters = (elements) => {
      if (!elements.length) return;
      const paths = elements.map((element) => element.dataset.path);
      const query = paths.length === 1
        ? 'path=' + encodeURIComponent(paths[0])
        : 'paths=' + encodeURIComponent(JSON.stringify(paths));
      const updateDb = elements[0].dataset.updateDb === 'true';
      fetch(viewCounterEndpoint + '?' + query + '&update-db=' + updateDb)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('View counter request failed')))
        .then((result) => {
          if (!result.success) return;
          result.data.forEach((item) => {
            elements.filter((element) => element.dataset.path === item.path).forEach((element) => renderViewCount(element, item.views));
          });
        })
        .catch(() => {});
    };
    loadViewCounters(viewCounters.slice(0, 10));
    const lazyViewCounters = viewCounters.slice(10);
    if (lazyViewCounters.length && 'IntersectionObserver' in window) {
      const viewCounterObserver = new IntersectionObserver((entries) => {
        entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
          viewCounterObserver.unobserve(entry.target);
          loadViewCounters([entry.target]);
        });
      }, { threshold: 0.1 });
      lazyViewCounters.forEach((element) => viewCounterObserver.observe(element));
    } else {
    loadViewCounters(lazyViewCounters);
    }

    // In-article videos autoplay muted while they're on screen and pause when
    // scrolled away — muted playback is allowed without a user gesture.
    document.querySelectorAll('video[data-autoplay-view]').forEach((video) => {
      if (!('IntersectionObserver' in window)) {
        video.play().catch(() => {});
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) video.play().catch(() => {});
          else video.pause();
        });
      }, { threshold: 0.25 });
      observer.observe(video);
    });

    // Author and archive cards use the same AT Protocol view records as post pages.
    document.querySelectorAll('[data-at-uri]').forEach((element) => {
      const subject = element.dataset.atUri;
      if (!subject) return;
      fetch('/api/reactions?subject=' + encodeURIComponent(subject), { cache: 'no-store' })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('View count request failed')))
        .then((counts) => { element.textContent = Number(counts.views || 0).toLocaleString(); })
        .catch(() => { element.textContent = '—'; });
    });

    // Public reaction totals are indexed by Constellation.
    document.querySelectorAll('[data-reaction-subject]').forEach((container) => {
      const subject = container.dataset.reactionSubject;
      if (!subject) return;
      fetch('/api/reactions?subject=' + encodeURIComponent(subject), { cache: 'no-store' })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Reaction count request failed')))
        .then((counts) => {
          [['like', 'likes'], ['dislike', 'dislikes']].forEach(([kind, key]) => {
            const count = container.querySelector('[data-reaction-count="' + kind + '"]');
            if (count) count.textContent = Number(counts[key] || 0).toLocaleString();
          });
          const saveCount = container.querySelector('[data-save-count]');
          if (saveCount) saveCount.textContent = Number(counts.saves || 0).toLocaleString();
          const viewCount = container.querySelector('[data-at-view-count]');
          if (viewCount) viewCount.textContent = Number(counts.views || 0).toLocaleString();
          const commentCount = container.querySelector('[data-at-comment-count]');
          if (commentCount) commentCount.textContent = Number(counts.comments || 0).toLocaleString();
        })
        .catch(() => {
          container.querySelectorAll('[data-reaction-count]').forEach((count) => { count.textContent = '—'; });
          const viewCount = container.querySelector('[data-at-view-count]');
          if (viewCount) viewCount.textContent = '—';
          const commentCount = container.querySelector('[data-at-comment-count]');
          if (commentCount) commentCount.textContent = 'Comments unavailable';
        });
    });

    const authorNameElements = [...document.querySelectorAll('[data-author-verification-did]')];
    const authorDids = [...new Set(authorNameElements.map((element) => element.dataset.authorVerificationDid).filter(Boolean))];
    if (authorDids.length) {
        const query = new URLSearchParams();
        authorDids.forEach((did) => query.append('did', did));
        fetch('/api/verifications?' + query.toString(), { cache: 'force-cache' })
          .then((response) => response.ok ? response.json() : Promise.reject(new Error('Author verification request failed')))
          .then((result) => {
            const verifiedDids = new Set(result.verifiedDids || []);
            const badges = result.badges || {};
            const badgeStyles = {
              verified: { icon: 'fa-circle-check', label: 'Verified by Coffee & Code' },
              author: { icon: 'fa-feather', label: 'Coffee & Code author' },
              moderator: { icon: 'fa-shield-halved', label: 'Coffee & Code moderator' },
              developer: { icon: 'fa-code', label: 'Coffee & Code developer' },
            };
            authorNameElements.forEach((element) => {
              const did = element.dataset.authorVerificationDid;
              const type = badges[did] || (verifiedDids.has(did) ? 'verified' : undefined);
              const style = type && badgeStyles[type];
              if (!style || element.querySelector('.author-verification-badge')) return;
              const badge = document.createElement('i');
              badge.className = 'fa-solid ' + style.icon + ' author-verification-badge author-verification-badge--' + type;
              badge.setAttribute('role', 'img');
              badge.setAttribute('aria-label', style.label);
              badge.title = style.label;
              element.append(badge);
            });
          })
          .catch((error) => console.error('Could not load author verification badges:', error));
    }

    // Header back button: return to the previous page, falling back to home.
    const headerBack = document.querySelector('[data-header-back]');
    if (headerBack) {
      const cameFromSite = document.referrer && new URL(document.referrer, location.href).origin === location.origin;
      if (history.length > 1 || cameFromSite) {
        headerBack.addEventListener('click', () => { history.back(); });
      } else {
        headerBack.addEventListener('click', () => { location.assign('/'); });
      }
      // On the home page with nowhere to go back to, hide the button.
      if ((location.pathname === '/' || location.pathname === '') && !cameFromSite) {
        headerBack.style.display = 'none';
      }
    }

    // Remember scroll position per page so swiping back or pressing back
    // restores the reader's place even when the browser drops the history entry.
    try {
      if ('scrollRestoration' in history) history.scrollRestoration = 'auto';
      const scrollMemoryKey = 'cc.scrollPositions';
      const readScrollMemory = () => {
        try { return JSON.parse(sessionStorage.getItem(scrollMemoryKey) || '{}') || {}; }
        catch (error) { return {}; }
      };
      const pageKey = location.pathname + location.search;
      const savedPositions = readScrollMemory();
      const savedY = savedPositions[pageKey];
      if (typeof savedY === 'number' && savedY > 0) {
        window.addEventListener('load', () => { window.scrollTo(0, savedY); }, { once: true });
      }
      let scrollSaveTimer;
      const saveScrollPosition = () => {
        const positions = readScrollMemory();
        positions[pageKey] = Math.round(window.scrollY);
        try { sessionStorage.setItem(scrollMemoryKey, JSON.stringify(positions)); } catch (error) {}
      };
      window.addEventListener('scroll', () => {
        clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(saveScrollPosition, 120);
      }, { passive: true });
      window.addEventListener('pagehide', saveScrollPosition);
    } catch (error) {}

    // Back to top button
    const siteHeader = document.querySelector('.site-header');
    const backToTopBtn = document.getElementById('backToTop');
    window.addEventListener('scroll', () => {
      siteHeader.classList.toggle('is-compact', window.scrollY > 80);
      if (window.scrollY > 300) {
        backToTopBtn.classList.add('show');
      } else {
        backToTopBtn.classList.remove('show');
      }
    });
    backToTopBtn.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      });
    });

    // Hamburger menu
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const mobileNav = document.getElementById('mobileNav');
    const feedClientDialog = document.querySelector('[data-feed-client-dialog]');
    document.querySelectorAll('[data-feed-client-picker]').forEach((link) => {
      link.addEventListener('click', (event) => {
        if (!(feedClientDialog instanceof HTMLDialogElement) || typeof feedClientDialog.showModal !== 'function') return;
        event.preventDefault();
        feedClientDialog.showModal();
      });
    });
    feedClientDialog?.addEventListener('click', (event) => {
      if (event.target === feedClientDialog) feedClientDialog.close();
    });
    let searchModule;
    document.querySelectorAll('[data-open-search]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
          searchModule ||= loadModule('https://4f82ebeb-ab5a-498a-a186-aad0c0dd760a.search.ai.cloudflare.com/assets/v0.0.40/search-snippet.es.js')
            .catch((error) => {
              searchModule = undefined;
              throw error;
            });
          await searchModule;
          await customElements.whenDefined('search-modal-snippet');
          document.querySelector('search-modal-snippet')?.open();
        } catch (error) {
          console.error(error);
          window.location.assign('/search');
        }
      });
    });
    const closeMobileNav = (restoreFocus = false) => {
      mobileNav.classList.remove('active');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      hamburgerBtn.setAttribute('aria-label', 'Open navigation');
      hamburgerBtn.textContent = '☰';
      if (restoreFocus) hamburgerBtn.focus();
    };
    hamburgerBtn.addEventListener('click', () => {
      const isActive = !mobileNav.classList.contains('active');
      mobileNav.classList.toggle('active', isActive);
      hamburgerBtn.setAttribute('aria-expanded', isActive);
      hamburgerBtn.setAttribute('aria-label', isActive ? 'Close navigation' : 'Open navigation');
      hamburgerBtn.textContent = isActive ? '×' : '☰';
    });
    mobileNav.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a, [data-open-search]')) {
        closeMobileNav();
      }
    });
    document.addEventListener('click', (event) => {
      if (mobileNav.classList.contains('active')
        && event.target instanceof Node
        && !mobileNav.contains(event.target)
        && !hamburgerBtn.contains(event.target)) {
        closeMobileNav();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && mobileNav.classList.contains('active')) {
        closeMobileNav(true);
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 760 && mobileNav.classList.contains('active')) closeMobileNav();
    });

    const archive = document.querySelector('[data-archive-pagination]');
    const loadMoreButton = archive?.querySelector('[data-archive-load-more]');
    loadMoreButton?.addEventListener('click', async () => {
      const button = loadMoreButton;
      const status = archive.querySelector('[data-archive-load-status]');
      const cursor = archive.dataset.archiveCursor;
      if (!cursor || button.disabled) return;

      button.disabled = true;
      button.textContent = 'Loading stories…';
      if (status) status.textContent = '';
      try {
        const filters = archive.querySelector('form');
        const formData = filters ? new FormData(filters) : new FormData();
        const archiveFilters = {
          q: String(formData.get('q') || ''),
          author: String(formData.get('author') || ''),
          year: String(formData.get('year') || ''),
          sort: String(formData.get('sort') || 'newest'),
          image: formData.get('image') === '1'
        };
        const response = await fetch('/api/archive/more', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: JSON.parse(cursor), filters: archiveFilters })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load more stories.');

        const grid = archive.querySelector('[data-archive-grid]');
        const emptyState = archive.querySelector('[data-archive-empty]');
        const template = document.createElement('template');
        template.innerHTML = result.html || '';
        const existingUris = new Set(
          [...grid.querySelectorAll('[data-at-uri]')].map((element) => element.dataset.atUri)
        );
        let added = 0;
        [...template.content.children].forEach((story) => {
          const uri = story.querySelector('[data-at-uri]')?.dataset.atUri;
          if (uri && existingUris.has(uri)) return;
          if (uri) existingUris.add(uri);
          grid.append(story);
          added += 1;
        });
        if (added && emptyState) emptyState.hidden = true;

        const count = archive.querySelector('[data-archive-count]');
        if (count) {
          const total = Number(count.dataset.loadedCount || count.textContent.match(/^\d+/)?.[0] || 0) + added;
          count.dataset.loadedCount = String(total);
          count.textContent = total + ' ' + (total === 1 ? 'story' : 'stories') + ' loaded';
        }
        archive.dataset.archiveCursor = result.state ? JSON.stringify(result.state) : '';
        if (!result.hasMore || !result.state) {
          button.hidden = true;
          if (status) status.textContent = added ? 'You’ve reached the end of the archive.' : 'No more stories match these filters.';
        } else {
          button.textContent = 'Load 30 more stories';
          if (status && !added) status.textContent = 'No stories matched this page. Load more to continue searching.';
        }
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : 'Could not load more stories.';
        button.textContent = 'Try again';
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
