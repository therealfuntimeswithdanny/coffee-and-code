import { Context } from 'hono';
import { Env } from '../types';


export function browserRenderOgImage(c: Context<{ Bindings: Env }>) {
  return new URL('/og.png', c.req.url).toString();
}

export function renderLayout(c: Context<{ Bindings: Env }>, title: string, content: string, metaTags = '', documentTitle?: string) {
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  ${descriptionTag}
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="apple-touch-icon" href="/favicon.png">
  ${metaTags}
  <link rel="alternate" type="application/rss+xml" title="${pubName} RSS Feed" href="/rss.xml">
  <script type="module" src="/components/sequoia-comments.js"></script>
  <script type="module" src="/components/atproto-auth.js"></script>
  <script type="module" src="https://4f82ebeb-ab5a-498a-a186-aad0c0dd760a.search.ai.cloudflare.com/assets/v0.0.40/search-snippet.es.js"></script>
  <script defer src="https://cloud.umami.is/script.js" data-website-id="ce9dca73-97c8-4831-8951-90b7fe8525b6"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Source+Sans+3:wght@400;500;600;700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet"></noscript>
  <script defer src="https://kit.fontawesome.com/0ca27f8db1.js" crossorigin="anonymous"></script>
  <style>
    .prose .prose-image-gallery { display: flex; gap: 12px; overflow-x: auto; overscroll-behavior-inline: contain; scroll-snap-type: x mandatory; }
    .prose .prose-image-gallery figure { flex: 0 0 min(100%, 360px); margin: 0; scroll-snap-align: start; }
    :root { --ink: #ffffff; --paper: #281914; --paper-deep: #3b2a1d; --accent: #b2ac88; --muted: #b2ac88; --line: rgba(178, 172, 136, .42); --line-strong: #b2ac88; --page-width: 1100px; }
    * { box-sizing: border-box; } html, body { min-height: 100%; } body { display: flex; flex-direction: column; margin: 0; min-width: 320px; background: var(--paper); color: var(--ink); font-family: 'Source Sans 3', sans-serif; font-size: 18px; line-height: 1.45; }
    a { color: inherit; text-decoration: none; } a:hover { color: var(--accent); } .site-header { border-bottom: 1px solid var(--line-strong); background: var(--paper); position: sticky; top: 0; z-index: 100; } .header-inner, .page-content, .footer-inner { width: min(var(--page-width), calc(100% - 48px)); margin: 0 auto; }
      .header-inner { min-height: 100px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 24px; transition: min-height 180ms ease; } .site-nav, .header-links { display: flex; align-items: center; gap: 24px; font-size: 14px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; } .header-links { justify-content: flex-end; }.site-brand { font-family: Lora, serif; font-size: clamp(1.55rem, 3vw, 2.3rem); font-weight: 700; letter-spacing: -.06em; white-space: nowrap; transition: font-size 180ms ease; }.site-header.is-compact { box-shadow: 0 3px 16px rgba(0, 0, 0, .2); }.site-header.is-compact .header-inner { min-height: 68px; }.site-header.is-compact .site-brand { font-size: clamp(1.35rem, 2.5vw, 1.9rem); }
    .subscribe-button { background: var(--accent); color: var(--paper); padding: 8px 13px; }.subscribe-button:hover { background: var(--ink); color: var(--paper); }
    .login-button { align-items: center; background: var(--accent); border: 1px solid var(--accent); color: var(--paper); display: inline-flex; font-size: 12px; font-weight: 700; justify-content: center; letter-spacing: .08em; min-height: 38px; padding: 8px 15px; text-transform: uppercase; transition: background 160ms, color 160ms; }
    .login-button:hover { background: transparent; color: var(--accent); }
    .hamburger-button { display: none; background: none; border: none; cursor: pointer; color: var(--accent); font-size: 24px; padding: 8px; align-items: center; }
    .search-button-icon { background: none; border: none; cursor: pointer; color: inherit; font-family: inherit; font-size: 14px; padding: 8px 12px; text-transform: uppercase; font-weight: 700; letter-spacing: .04em; }
    .search-button-icon:hover { color: var(--accent); }
    .search-button-link { background: none; border: 0; cursor: pointer; font-family: inherit; padding: 0; text-align: left; }
    .search-modal { --search-snippet-background: var(--paper); --search-snippet-surface: var(--paper-deep); --search-snippet-border-color: var(--line-strong); --search-snippet-border-radius: 3px; --search-snippet-border-radius-sm: 3px; --search-snippet-primary-color: var(--accent); --search-snippet-primary-hover: var(--ink); --search-snippet-hover: var(--accent); --search-snippet-hover-background: rgba(178, 172, 136, .12); --search-snippet-text-color: var(--ink); --search-snippet-text-secondary: var(--muted); --search-snippet-text-description: var(--muted); --search-snippet-font-family: 'Source Sans 3', sans-serif; --search-snippet-font-family-mono: 'Source Sans 3', sans-serif; --search-snippet-font-size-base: 16px; --search-snippet-font-size-sm: 14px; --search-snippet-focus-ring: 0 0 0 2px var(--accent); --search-snippet-shadow: 0 12px 28px rgba(0, 0, 0, .24); --search-snippet-result-item-shadow: none; }
    .mobile-nav { display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--paper-deep); border-bottom: 1px solid var(--line-strong); flex-direction: column; gap: 0; padding: 12px 0; z-index: 99; }
    .mobile-nav.active { display: flex; }
    .mobile-nav a { padding: 12px 24px; border-bottom: 1px solid var(--line); }
    .mobile-nav a:last-child { border-bottom: none; }
    .mobile-nav .login-button { align-self: flex-start; margin: 12px 24px; }
    .page-content { flex: 1 0 auto; padding: 40px 0 60px; }.eyebrow, .section-heading, .recent-stories__heading { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .1em; line-height: 1.2; text-transform: uppercase; }.publication-intro .eyebrow { margin: 0 0 10px; color: var(--accent); }.publication-intro h1 { margin: 0; font-family: Lora, serif; font-size: clamp(2.7rem, 7vw, 5rem); letter-spacing: -.065em; line-height: .98; }.publication-intro > p:last-child { max-width: 580px; margin: 16px 0 0; color: var(--muted); font-size: 21px; }
    .section-heading { display: flex; justify-content: space-between; border-top: 2px solid var(--line-strong); border-bottom: 1px solid var(--line); color: var(--ink); padding: 10px 0; }.section-heading span:last-child { color: var(--muted); }.front-page__grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(300px, .85fr); gap: 38px; padding-top: 28px; }.lead-story { border-bottom: 1px solid var(--line); padding-bottom: 25px; }.lead-image { display: block; aspect-ratio: 1.75 / 1; background: var(--paper-deep); overflow: hidden; }.lead-image--placeholder, .story-image--placeholder { align-items: end; background: linear-gradient(130deg, var(--paper), var(--accent)); color: var(--ink); display: flex; font-family: Lora, serif; font-size: 30px; justify-content: center; padding: 30px; }.story-image { display: block; height: 100%; object-fit: cover; width: 100%; }.lead-story__content { max-width: 850px; padding-top: 20px; }.lead-story .eyebrow, .archive-story .eyebrow { margin: 0 0 7px; color: var(--accent); } h1, h2, h3 { font-family: Lora, serif; font-weight: 600; letter-spacing: -.045em; line-height: 1.1; }.lead-story h2 { font-size: clamp(2rem, 4.2vw, 3.45rem); margin: 0; }.lead-story__summary { color: var(--muted); font-size: 20px; line-height: 1.35; margin: 13px 0 17px; }.story-footer, .archive-story__footer { align-items: center; display: flex; gap: 18px; justify-content: space-between; }.article-meta--byline { color: var(--accent); }.article-meta--byline a { color: inherit; }.read-link { color: var(--accent); font-size: 14px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }.recent-stories { border-top: 2px solid var(--line-strong); }.recent-stories__heading { color: var(--ink); padding: 11px 0; }.side-story { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 6px; display: grid; gap: 14px; grid-template-columns: 100px minmax(0, 1fr); padding: 12px; margin-bottom: 14px; transition: all 200ms; cursor: pointer; }.side-story:last-child { border-bottom: 1px solid var(--line); margin-bottom: 0; }.side-story:hover { border-color: var(--accent); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); transform: translateY(-2px); }.side-story__image { aspect-ratio: 1 / 1; overflow: hidden; border-radius: 4px; flex-shrink: 0; }.side-story h3 { font-size: 16px; margin: 0 0 6px; line-height: 1.3; }.empty-state { color: var(--muted); }.writers-callout { align-items: center; background: var(--paper-deep); border: 1px solid var(--line); display: flex; gap: 28px; justify-content: space-between; margin-top: 56px; padding: 28px 32px; }.writers-callout .eyebrow { color: var(--accent); margin: 0 0 8px; }.writers-callout h2 { font-size: clamp(1.6rem, 3vw, 2.3rem); margin: 0; }.writers-callout p:not(.eyebrow) { color: var(--muted); margin: 10px 0 0; max-width: 650px; }.archive-section { margin-top: 64px; }.archive-section__footer { margin-top: 24px; text-align: right; }.archive-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }.archive-story { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 6px; display: flex; flex-direction: column; gap: 0; justify-content: space-between; min-height: 380px; padding: 0; overflow: hidden; transition: all 200ms; cursor: pointer; }.archive-story:hover { border-color: var(--accent); box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4); transform: translateY(-3px); }.archive-story__image { aspect-ratio: 1.55 / 1; overflow: hidden; background: var(--paper); flex-shrink: 0; }.archive-story h3 { font-size: 18px; margin: 0 0 6px; padding: 14px 14px 0 14px; line-height: 1.3; }.archive-story p:not(.eyebrow) { color: var(--muted); font-size: 14px; margin: 0; padding: 6px 14px 0 14px; line-height: 1.5; }.archive-story .eyebrow { padding: 14px 14px 6px 14px; }.archive-story__footer { margin-top: auto; padding: 12px 14px 14px; }.archive-page .archive-story { min-height: 0; } .archive-search { margin-bottom: 42px; } .archive-page .archive-grid { margin-top: 28px; }
    .article { margin: 0 auto; max-width: 820px; }.article__back { color: var(--accent); display: inline-block; font-size: 14px; font-weight: 700; letter-spacing: .04em; margin-bottom: 40px; text-transform: uppercase; }.article__header { border-bottom: 1px solid var(--line); margin-bottom: 28px; padding-bottom: 28px; }.article__header .eyebrow { color: var(--accent); margin: 0 0 12px; }.article__header h1 { font-size: clamp(2.5rem, 6vw, 4.6rem); margin: 0; }.article__dek { color: var(--muted); font-family: Lora, serif; font-size: 22px; line-height: 1.4; margin: 18px 0 0; }.article__cover { aspect-ratio: 1.8 / 1; margin: 28px 0; overflow: hidden; width: 100%; max-width: 820px; }.article__cover img, .article__cover .story-image { width: 100% !important; height: 100% !important; max-width: 820px !important; object-fit: cover; display: block; }.prose { max-width: 820px; }.prose figure, .prose-image-figure { max-width: 820px; margin: 1.8rem 0; }.prose figure img, .prose img, .prose-image, .prose-image-figure img { display: block; width: 100% !important; max-width: 820px !important; height: auto !important; margin: 0; border-radius: 4px; }.prose p, .prose li, .prose-paragraph { color: var(--muted); line-height: 1.75; margin: 1.2em 0; }.prose h2, .prose-heading--2 { font-size: 2rem; margin: 2.2em 0 .6em; }.prose h3, .prose-heading--3 { font-size: 1.5rem; margin: 1.8em 0 .5em; }.prose h4, .prose-heading--4 { font-size: 1.2rem; margin: 1.5em 0 .4em; }.prose-heading { font-family: Lora, serif; font-weight: 600; letter-spacing: -.045em; line-height: 1.1; color: var(--ink); }.prose a, .prose-link { color: var(--accent); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }.prose a:hover, .prose-link:hover { color: var(--ink); }.prose blockquote, .prose-blockquote { border-left: 3px solid var(--accent); color: var(--ink); font-family: Lora, serif; font-size: 1.35rem; margin: 1.8rem 0; padding-left: 24px; font-style: italic; }.prose code, .prose-code { background: var(--paper-deep); border-radius: 3px; padding: .15rem .3rem; font-family: 'Source Sans 3', monospace; font-size: .9em; }.prose pre, .prose-pre { background: var(--paper-deep); border: 1px solid var(--line); color: var(--ink); overflow-x: auto; padding: 1rem; border-radius: 4px; margin: 1.8rem 0; }.prose pre code, .prose-pre .prose-code { background: transparent; padding: 0; }.prose ul, .prose-list--unordered { list-style-type: disc; margin-left: 1.5em; margin: 1.2em 0 1.2em 1.5em; }.prose ol, .prose-list--ordered { list-style-type: decimal; margin-left: 1.5em; margin: 1.2em 0 1.2em 1.5em; }.prose-list li { margin: 0.4em 0; }.prose table, .prose-table { width: 100%; border-collapse: collapse; margin: 1.8rem 0; }.prose table th, .prose-table th { background: var(--paper-deep); border: 1px solid var(--line); padding: 0.8rem; text-align: left; font-weight: 600; }.prose table td, .prose-table td { border: 1px solid var(--line); padding: 0.8rem; }.prose table tr:nth-child(even), .prose-table tr:nth-child(even) { background: rgba(40, 25, 20, 0.3); }.article__footer { border-top: 1px solid var(--line); display: flex; font-size: 14px; gap: 24px; justify-content: flex-end; margin-top: 56px; padding-top: 24px; }.article__footer a { color: var(--accent); }
    .not-found { margin: 60px auto; max-width: 600px; }.not-found h1 { font-size: 3rem; margin: 8px 0; }.not-found p:not(.eyebrow) { color: var(--muted); margin-bottom: 24px; }.not-found__actions { display: flex; flex-direction: column; gap: 12px; }.not-found__actions a { display: inline-block; }
    .back-to-top { position: fixed; bottom: 32px; right: 32px; width: 48px; height: 48px; background: var(--accent); color: var(--paper); border: none; border-radius: 50%; cursor: pointer; display: none; align-items: center; justify-content: center; font-size: 20px; z-index: 50; transition: opacity 200ms; }.back-to-top.show { display: flex; }.back-to-top:hover { background: var(--ink); }
    .site-footer { background: var(--paper-deep); border-top: 1px solid var(--line-strong); color: var(--ink); flex-shrink: 0; padding: 54px 0 32px; }.footer-inner { display: grid; gap: 38px; grid-template-columns: 1.5fr 1fr 1fr; }.footer-brand { font-family: Lora, serif; font-size: clamp(1.7rem, 3vw, 2.5rem); font-weight: 600; letter-spacing: -.05em; margin: 0 0 8px; }.footer-tagline { color: var(--muted); margin: 0; max-width: 420px; }.footer-heading { color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .1em; margin: 5px 0 12px; text-transform: uppercase; }.footer-links { display: grid; gap: 8px; }.footer-links a { color: var(--ink); width: fit-content; }.footer-social { display: flex; gap: 16px; margin-top: 16px; }.footer-social a { color: var(--accent); font-size: 18px; transition: color 200ms; }.footer-social a:hover { color: var(--ink); }.footer-meta { color: var(--muted); font-size: 14px; grid-column: 1 / -1; margin: 0; padding-top: 12px; border-top: 1px solid var(--line); }
    @media (max-width: 760px) { .header-inner { grid-template-columns: 1fr 1fr auto; min-height: 76px; gap: 12px; }.site-header.is-compact .header-inner { min-height: 56px; }.site-nav { display: none; }.hamburger-button { display: flex; }.header-links { gap: 8px; }.header-links .pds-link { display: none; }.page-content { padding-top: 32px; }.front-page__grid { grid-template-columns: 1fr; gap: 38px; }.archive-grid { grid-template-columns: 1fr; gap: 0; }.archive-story { min-height: 0; }.archive-story__image { aspect-ratio: 1.8 / 1; }.footer-inner { grid-template-columns: 1fr 1fr; }.footer-brand-block { grid-column: 1 / -1; }.article__footer { flex-direction: column; gap: 12px; }.search-form { grid-template-columns: 1fr; }.back-to-top { width: 44px; height: 44px; right: 16px; bottom: 16px; font-size: 18px; } } @media (max-width: 480px) { .header-inner, .page-content, .footer-inner { width: min(100% - 32px, var(--page-width)); }.site-brand { font-size: 1.35rem; }.header-links { font-size: 11px; }.side-story { grid-template-columns: 88px minmax(0, 1fr); }.footer-inner { grid-template-columns: 1fr; gap: 24px; }.footer-brand-block { grid-column: auto; } }
    .article__author { align-items: center; color: var(--accent); display: inline-flex; font-size: 16px; font-weight: 600; gap: 10px; margin-top: 20px; }.article__author:hover { color: var(--ink); }.article__author-avatar { border-radius: 50%; height: 36px; object-fit: cover; width: 36px; }.article__author-avatar--placeholder { background: var(--accent); display: block; }.view-counter { color: var(--muted); font-size: 12px; white-space: nowrap; }.article-meta { align-items: center; display: inline-flex; flex-wrap: wrap; gap: 8px; }.article-view-counter { display: block; margin-top: 18px; }
    .author-page__header { align-items: center; display: flex; gap: 20px; margin-bottom: 36px; }.author-page__header h1 { margin: 0; }.author-page__header p:last-child { color: var(--muted); margin: 6px 0 0; }.author-page__avatar { border-radius: 50%; height: 88px; object-fit: cover; width: 88px; }
    .authors-page__header { border-bottom: 1px solid var(--line); margin-bottom: 28px; padding-bottom: 20px; }.authors-page__header .eyebrow { margin: 0 0 8px; }.authors-page__header h1 { margin: 0; }.author-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }.author-card { align-items: center; background: var(--paper-deep); border: 1px solid var(--line); display: flex; gap: 14px; padding: 16px; }.author-card:hover { border-color: var(--accent); }.author-card__avatar { border-radius: 50%; flex: 0 0 64px; height: 64px; object-fit: cover; width: 64px; }.author-card__avatar--placeholder { background: var(--accent); }.author-card__details { display: grid; gap: 2px; }.author-card__details strong { color: var(--ink); font-family: Lora, serif; font-size: 20px; }.author-card__details span { color: var(--muted); font-size: 14px; }.author-card__details span:last-child { color: var(--accent); margin-top: 4px; }
    @media (max-width: 760px) { .writers-callout { align-items: flex-start; flex-direction: column; } }
    .archive-story { content-visibility: auto; contain-intrinsic-size: 0 360px; }
    /* Editorial publication system */
    :root { color-scheme: dark; --ink: #ffffff; --paper: #281914; --paper-deep: #3b2a1d; --accent: #b2ac88; --muted: #b2ac88; --line: rgba(178,172,136,.42); --line-strong: #b2ac88; --page-width: 1180px; }
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
    .writers-callout { background: var(--paper-deep); border: 0; border-left: 4px solid var(--accent); margin-top: 58px; padding: 28px 32px; }
    .archive-section { margin-top: 68px; }
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
    .prose { max-width: 740px; }
    .prose p, .prose li, .prose-paragraph { color: var(--muted); font-size: 19px; line-height: 1.82; }
    .prose h2, .prose-heading--2 { color: var(--ink); font-size: 2.1rem; }
    .prose blockquote, .prose-blockquote { border-color: var(--accent); color: var(--ink); }
    .prose code, .prose-code, .prose pre, .prose-pre { background: var(--paper-deep); color: var(--ink); }
    .prose table tr:nth-child(even), .prose-table tr:nth-child(even) { background: rgba(40,25,20,.3); }
    .article-rail { border-top: 3px solid var(--ink); padding-top: 12px; position: sticky; top: 105px; }
    .article-rail h2 { font-size: 23px; margin: 0 0 14px; }
    .article-rail ul { border-top: 1px solid var(--line); list-style: none; margin: 0 0 18px; padding: 0; }
    .article-rail li { border-bottom: 1px solid var(--line); padding: 14px 0; }
    .article-rail li a { font-family: Lora, serif; font-size: 15px; font-weight: 600; line-height: 1.4; }
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
    @media (max-width: 520px) { .recommendations__grid { grid-template-columns: 1fr; }.recommendation-card { display: grid; gap: 14px; grid-template-columns: 112px minmax(0, 1fr); padding: 14px 0; }.recommendation-card__image { aspect-ratio: 1; }.recommendation-card__body { padding: 0; }.recommendation-card h3 { font-size: 17px; }.recommendation-card__body > p:not(.eyebrow) { display: none; }.article__back { margin-bottom: 24px; }.prose p, .prose li, .prose-paragraph { font-size: 18px; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }
    /* Finishing pass: keep the coffee palette, sharpen the publication hierarchy. */
    body { background: radial-gradient(ellipse at 50% -18rem, #443126 0, var(--paper) 46rem); }
    .site-header { border-top: 3px solid var(--accent); box-shadow: 0 1px 0 rgba(255,255,255,.025); }
    .header-inner { min-height: 96px; }
    .site-brand { align-items: center; display: flex; flex-direction: column; font-size: clamp(1.8rem, 3vw, 2.45rem); line-height: 1; }
    .site-brand::after { content: none; }
    .site-nav, .header-links { font-size: 12px; letter-spacing: .12em; }
    .site-nav a, .header-links > a { opacity: .88; }
    .site-nav a:hover, .header-links > a:hover { opacity: 1; }
    .page-content { padding-top: 42px; padding-bottom: 76px; }
    .section-heading { align-items: center; border-top-width: 2px; padding: 13px 0 11px; }
    .section-heading span:first-child { color: var(--ink); }
    .front-page__grid { padding-top: 34px; }
    .lead-image { aspect-ratio: 1.82 / 1; }
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
    .archive-grid { column-gap: 28px; row-gap: 36px; }
    .archive-story { border-top: 1px solid var(--line); min-height: 0; }
    .archive-story__image { margin: 0 -1px; }
    .archive-story h3 { font-size: 20px; letter-spacing: -.025em; line-height: 1.24; padding-left: 0; padding-right: 0; }
    .archive-story .eyebrow, .archive-story p:not(.eyebrow), .archive-story__footer { padding-left: 0; padding-right: 0; }
    .archive-story p:not(.eyebrow) { color: #d2cbb9; }
    .archive-story__footer { border-top: 1px solid var(--line); margin: 14px 0 0; }
    .article-layout { gap: clamp(42px, 6vw, 84px); }
    .article__back { font-size: 12px; letter-spacing: .1em; margin-bottom: 36px; }
    .article__header { padding-bottom: 30px; }
    .article__header > .eyebrow { letter-spacing: .16em; }
    .article__header h1 { letter-spacing: -.06em; }
    .article__dek { color: #ddd5c4; }
    .article__author { color: var(--ink); }
    .prose { max-width: 720px; }
    .prose p, .prose li, .prose-paragraph { color: #eee9dc; font-size: 19px; line-height: 1.84; }
    .prose h2, .prose h3, .prose h4, .prose-heading { color: var(--ink); }
    .prose a, .prose-link { color: var(--accent); }
    .prose blockquote, .prose-blockquote { color: #eee9dc; }
    .article-rail { background: rgba(59,42,29,.42); border-top-color: var(--accent); padding: 15px 18px 18px; top: 108px; }
    .article-rail h2 { margin-bottom: 16px; }
    .article-rail li a { font-size: 14px; }
    .recommendations { margin-top: 76px; }
    .recommendations .section-heading { margin-bottom: 4px; }
    .recommendations__grid { gap: 28px; }
    .recommendation-card { border-top: 1px solid var(--line); border-bottom: 0; }
    .recommendation-card__image { margin-top: 14px; }
    .recommendation-card h3 { font-size: 20px; letter-spacing: -.025em; }
    .recommendation-card__body > p:not(.eyebrow) { color: #d2cbb9; }
    .recommendation-card__date { display: inline-block; margin-top: 5px; }
    .article-engagement { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .article-view-counter { margin-top: 0; }
    .article-reactions__buttons { display: inline-flex; flex-wrap: wrap; gap: 6px; }
    .reaction-button { align-items: center; background: var(--paper-deep); border: 1px solid var(--line); border-radius: 2px; color: var(--ink); cursor: pointer; display: inline-flex; font: 600 13px 'Source Sans 3', sans-serif; gap: 6px; min-height: 32px; padding: 4px 8px; transition: background 160ms, border-color 160ms, color 160ms; }
    .reaction-button:hover, .reaction-button[aria-pressed="true"] { background: rgba(178,172,136,.16); border-color: var(--accent); color: var(--ink); }
    .reaction-button:disabled { cursor: wait; opacity: .65; }
    .reaction-count { color: var(--accent); font-variant-numeric: tabular-nums; }
    .article-reactions__status { color: var(--muted); flex-basis: 100%; font-size: 12px; min-height: 18px; }
    .auth-page { margin: 24px auto 60px; max-width: 620px; }
    .auth-page h1 { font-size: clamp(2.4rem, 6vw, 3.7rem); margin: 0; }
    .auth-page__intro { color: #eee9dc; font-size: 18px; line-height: 1.6; margin: 16px 0 28px; }
    .auth-form { background: var(--paper-deep); border: 1px solid var(--line); display: grid; gap: 10px; padding: 22px; }
    .auth-form label { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    .auth-form input { background: var(--paper); border: 1px solid var(--line); color: var(--ink); font: 17px 'Source Sans 3', sans-serif; min-height: 48px; padding: 10px 12px; width: 100%; }
    .auth-form .login-button { cursor: pointer; font-family: inherit; justify-self: start; margin-top: 6px; }
    .auth-page__permissions { color: var(--muted); font-size: 14px; line-height: 1.6; margin-top: 20px; }
    .auth-account { background: var(--paper-deep); border: 1px solid var(--line); margin-top: 24px; padding: 20px; }
    .auth-account__status { color: var(--muted); margin: 0 0 14px; }.auth-account__status strong { color: var(--ink); }
    .auth-signout { background: transparent; border: 1px solid var(--line-strong); color: var(--ink); cursor: pointer; font: 600 13px 'Source Sans 3', sans-serif; padding: 9px 14px; }
    .auth-page__error { color: #f2a18d; margin-top: 14px; }
    .site-footer { border-top-width: 1px; padding-top: 48px; }
    .footer-tagline { color: #d2cbb9; }
    .footer-social a { background: rgba(178,172,136,.1); border: 1px solid var(--line); border-radius: 50%; display: inline-grid; height: 38px; place-items: center; width: 38px; }
    @media (max-width: 760px) { .header-inner { grid-template-columns: auto minmax(0,1fr) auto; min-height: 76px; }.hamburger-button { grid-column: 1; grid-row: 1; }.site-brand { font-size: 1.5rem; grid-column: 2; grid-row: 1; justify-self: center; }.header-links { grid-column: 3; grid-row: 1; }.header-links .rss-link, .header-links .pds-link { display: none; }.page-content { padding-top: 30px; }.writers-callout { margin-top: 46px; padding: 24px; }.archive-story h3 { padding-left: 14px; padding-right: 14px; }.archive-story .eyebrow, .archive-story p:not(.eyebrow), .archive-story__footer { padding-left: 14px; padding-right: 14px; } }
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
      .prose p, .prose li, .prose-paragraph { font-size: 18px; line-height: 1.75; }
      .prose table { display: block; max-width: 100%; overflow-x: auto; }
      .article__cover { margin: 20px 0; }
      .mobile-nav .login-button { margin-left: 16px; }
    }
  </style>
</head>
<body>
  <header class="site-header"><div class="header-inner"><nav class="site-nav" aria-label="Main navigation"><a href="/">Latest</a><a href="/archive">Archive</a><a href="/authors">Authors</a></nav><a href="/" class="site-brand">${pubName}</a><div class="header-links"><button type="button" class="search-button-icon" id="open-search" data-open-search title="Search articles">Search</button><a class="rss-link" href="/rss.xml">RSS</a><a class="pds-link" href="https://bsky.app/profile/${did}" target="_blank" rel="noopener" aria-label="Coffee and Code on Bluesky" title="Coffee and Code on Bluesky"><i class="fab fa-bluesky" aria-hidden="true"></i></a><a href="/auth" class="login-button">Log in</a></div><button class="hamburger-button" id="hamburgerBtn" aria-label="Toggle navigation" aria-expanded="false">☰</button></div><nav class="mobile-nav" id="mobileNav" aria-label="Mobile navigation"><a href="/">Latest</a><a href="/archive">Archive</a><a href="/authors">Authors</a><button type="button" class="search-button-icon" id="open-search-mobile" data-open-search>Search</button><a href="/auth" class="login-button">Log in</a></nav></header>
  <main class="page-content">${content}</main>
  <search-modal-snippet class="search-modal" api-url="https://search.coffeencode.cc" placeholder="Search Coffee &amp; Code" max-results="25" max-render-results="7" show-url="true" show-date="true"></search-modal-snippet>
  <button class="back-to-top" id="backToTop" aria-label="Back to top" title="Back to top"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
  <footer class="site-footer"><div class="footer-inner"><div class="footer-brand-block"><p class="footer-brand">${pubName}</p><p class="footer-tagline">${pubDescription}</p><div class="footer-social"><a href="https://bsky.app/profile/${did}" target="_blank" rel="noopener" aria-label="Coffee and Code on Bluesky" title="Coffee and Code on Bluesky"><i class="fab fa-bluesky" aria-hidden="true"></i></a><a href="/rss.xml" aria-label="RSS feed" title="RSS feed"><i class="fas fa-rss" aria-hidden="true"></i></a><a href="/sitemap.xml" aria-label="Sitemap" title="Sitemap"><i class="fas fa-sitemap" aria-hidden="true"></i></a><a href="/privacy" aria-label="Privacy policy" title="Privacy policy"><i class="fas fa-shield-halved" aria-hidden="true"></i></a></div></div><p class="footer-meta">© ${new Date().getFullYear()} ${pubName} an MBD Company</p></div></footer>
  <script>
    // Load view counts without blocking the page.
    const viewCounterEndpoint = 'https://reads.coffeencode.cc/';
    const viewCounters = [...document.querySelectorAll('[data-view-counter][data-path]')];
    const renderViewCount = (element, views) => {
      element.textContent = Number(views).toLocaleString() + ' views';
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

    // Public reaction totals are indexed by Constellation.
    document.querySelectorAll('[data-reaction-subject]').forEach((container) => {
      const subject = container.dataset.reactionSubject;
      if (!subject) return;
      fetch('/api/reactions?subject=' + encodeURIComponent(subject))
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Reaction count request failed')))
        .then((counts) => {
          ['like', 'dislike'].forEach((kind) => {
            const count = container.querySelector('[data-reaction-count="' + kind + '"]');
            if (count) count.textContent = Number(counts[kind] || 0).toLocaleString();
          });
          const viewCount = container.querySelector('[data-at-view-count]');
          if (viewCount) viewCount.textContent = Number(counts.views || 0).toLocaleString() + ' views';
        })
        .catch(() => {
          container.querySelectorAll('[data-reaction-count]').forEach((count) => { count.textContent = '—'; });
          const viewCount = container.querySelector('[data-at-view-count]');
          if (viewCount) viewCount.textContent = 'Views unavailable';
        });
    });

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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Hamburger menu
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const mobileNav = document.getElementById('mobileNav');
    const searchModal = document.querySelector('search-modal-snippet');
    document.querySelectorAll('[data-open-search]').forEach((button) => {
      button.addEventListener('click', () => searchModal?.open());
    });
    hamburgerBtn.addEventListener('click', () => {
      const isActive = mobileNav.classList.toggle('active');
      hamburgerBtn.setAttribute('aria-expanded', isActive);
    });
    // Close menu when a link is clicked
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('active');
        hamburgerBtn.setAttribute('aria-expanded', 'false');
      });
    });
  </script>
</body>
</html>`;
}
