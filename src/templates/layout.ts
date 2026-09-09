import { Context } from 'hono';
import { Env } from '../types';

export function renderLayout(c: Context<{ Bindings: Env }>, title: string, content: string, metaTags = '') {
  const pubName = c.env.PUB_NAME || 'Coffee and Code';
  const did = c.env.AUTHOR_DID || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | ${pubName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="alternate" type="application/rss+xml" title="${pubName} RSS Feed" href="/rss.xml">
  <link rel="site.standard.publication" href="at://${did}/site.standard.publication/self">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root { --ink: #f7f0e2; --paper: #28190E; --paper-deep: #3b2a1d; --accent: #B2AC88; --muted: #c4b9a6; --line: rgba(178, 172, 136, .34); }
    * { box-sizing: border-box; }
    body { display: flex; flex-direction: column; margin: 0; min-height: 100vh; min-width: 320px; background: var(--paper); color: var(--ink); font-family: 'Source Sans 3', sans-serif; font-size: 18px; line-height: 1.45; }
    a { color: inherit; text-decoration: none; }
    a:hover { color: var(--accent); }
    .site-header { border-bottom: 1px solid var(--ink); background: var(--paper); }
    .header-inner, .page-content, .footer-inner { width: min(860px, calc(100% - 48px)); margin: 0 auto; }
    .header-inner { min-height: 100px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 24px; }
    .site-nav, .header-links { display: flex; align-items: center; gap: 24px; font-size: 14px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
    .header-links { justify-content: flex-end; }
    .site-brand { font-family: Lora, serif; font-size: clamp(1.55rem, 3vw, 2.3rem); font-weight: 700; letter-spacing: -.06em; white-space: nowrap; }
    .rss-link { border-bottom: 1px solid var(--ink); padding-bottom: 2px; }
    .page-content { flex: 1; padding: 50px 0 72px; }
    .eyebrow, .section-heading, .recent-stories__heading, .article-meta { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .1em; line-height: 1.2; text-transform: uppercase; }
    .section-heading { display: flex; justify-content: space-between; border-top: 2px solid var(--ink); border-bottom: 1px solid var(--line); color: var(--ink); padding: 10px 0; }
    .section-heading span:last-child { color: var(--muted); }
    .front-page__grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(230px, .8fr); gap: 32px; padding-top: 28px; }
    .lead-story { border-bottom: 1px solid var(--line); padding-bottom: 25px; }
    .lead-image { display: block; aspect-ratio: 1.75 / 1; background: var(--paper-deep); overflow: hidden; }
    .lead-image--placeholder { align-items: end; background: linear-gradient(130deg, #5a402c, var(--accent)); color: var(--paper); display: flex; font-family: Lora, serif; font-size: 30px; padding: 30px; }
    .story-image { display: block; height: 100%; object-fit: cover; width: 100%; }
    .lead-story__content { max-width: 850px; padding-top: 20px; }
    .lead-story .eyebrow, .side-story .eyebrow, .archive-story .eyebrow { margin: 0 0 7px; color: var(--accent); }
    h2, h3 { font-family: Lora, serif; font-weight: 600; letter-spacing: -.045em; line-height: 1.1; }
    .lead-story h2 { font-size: clamp(2rem, 4.2vw, 3.45rem); margin: 0; }
    .lead-story__summary { color: var(--muted); font-size: 20px; line-height: 1.35; margin: 13px 0 17px; }
    .story-footer, .archive-story__footer { align-items: center; display: flex; gap: 18px; justify-content: space-between; }
    .read-link { color: var(--accent); font-size: 14px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
    .recent-stories { border-top: 2px solid var(--ink); }
    .recent-stories__heading { color: var(--ink); padding: 11px 0; }
    .side-story { border-top: 1px solid var(--line); display: grid; gap: 15px; grid-template-columns: 112px minmax(0, 1fr); padding: 18px 0; }
    .side-story:last-child { border-bottom: 1px solid var(--line); }
    .side-story:not(:has(.side-story__image)) { display: block; }
    .side-story__image { aspect-ratio: 1 / 1; background: #503a29; overflow: hidden; }
    .side-story h3 { font-size: 22px; margin: 0 0 12px; }
    .side-empty, .empty-state { color: var(--muted); }
    .archive-section { margin-top: 64px; }
    .archive-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 28px; }
    .archive-story { border-bottom: 1px solid var(--line); display: flex; flex-direction: column; justify-content: space-between; min-height: 240px; padding: 22px 0; }
    .archive-story h3 { font-size: 25px; margin: 0 0 10px; }
    .archive-story p:not(.eyebrow) { color: var(--muted); font-size: 17px; margin: 0; }
    .archive-story__footer { margin-top: 22px; }
    .subscribe-link { background: var(--accent); color: var(--paper); padding: 8px 12px; transition: background-color .2s ease, color .2s ease; }
    .subscribe-link:hover { background: var(--ink); color: var(--paper); }
    .site-footer { background: #1b0f07; color: #e9e1d3; padding: 30px 0; }
    .footer-inner { align-items: center; color: #cec6b7; display: flex; font-size: 14px; justify-content: space-between; }
    .footer-brand { color: var(--ink); font-family: Lora, serif; font-size: 18px; font-weight: 600; }
    .footer-links { display: flex; gap: 18px; }
    .footer-inner a { color: var(--accent); }
    .prose { max-width: 720px; }
    .prose code { background: var(--paper-deep); border-radius: 3px; padding: .15rem .3rem; }
    .prose pre { background: var(--ink); color: var(--paper); overflow-x: auto; padding: 1rem; }
    .prose p { color: var(--muted); line-height: 1.7; }
    .prose h1, .prose h2, .prose h3 { color: var(--ink); }
    .prose a { color: var(--accent); text-decoration: underline; }
    @media (max-width: 760px) { .header-inner { grid-template-columns: 1fr auto; min-height: 76px; } .site-nav { display: none; } .header-links { gap: 15px; } .header-links .pds-link { display: none; } .page-content { padding-top: 34px; } .front-page__grid { grid-template-columns: 1fr; gap: 38px; } .archive-grid { grid-template-columns: 1fr; gap: 0; } .archive-story { min-height: 0; } }
    @media (max-width: 480px) { .header-inner, .page-content, .footer-inner { width: min(100% - 32px, 860px); } .site-brand { font-size: 1.35rem; } .header-links { font-size: 12px; } .side-story { grid-template-columns: 88px minmax(0, 1fr); } .footer-inner { align-items: flex-start; flex-direction: column; gap: 8px; } }
  </style>
  ${metaTags}
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <nav class="site-nav" aria-label="Main navigation"><a href="/">Latest</a><a href="/about">About</a></nav>
      <a href="/" class="site-brand">${pubName}</a>
      <div class="header-links"><a class="rss-link" href="/rss.xml">RSS</a><a class="subscribe-link" href="https://sequoia.pub/" target="_blank" rel="noopener">Subscribe</a><a class="pds-link" href="https://bsky.app/profile/${did}" target="_blank" rel="noopener">Bluesky ↗</a></div>
    </div>
  </header>
  <main class="page-content">${content}</main>
  <footer class="site-footer">
    <div class="footer-inner">
      <span class="footer-brand">${pubName}</span>
      <span>© ${new Date().getFullYear()} ${pubName}. All rights reserved.</span>
      <nav class="footer-links" aria-label="Footer navigation"><a href="/about">About</a><a href="/rss.xml">RSS</a><a href="/.well-known/site.standard.publication">standard.site</a></nav>
    </div>
  </footer>
</body>
</html>`;
}
