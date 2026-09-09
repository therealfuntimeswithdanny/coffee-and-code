import { Context } from 'hono';
import { Env } from '../types';

export function renderLayout(c: Context<{ Bindings: Env }>, title: string, content: string, metaTags = '') {
  const pubName = c.env.PUB_NAME || 'Coffee and Code';
  const did = c.env.AUTHOR_DID || '';

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | ${pubName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            coffee: {
              50: '#fdfbf7',
              100: '#f7f2e8',
              500: '#b07d4f',
              800: '#3c2415',
              900: '#23140c',
            }
          }
        }
      }
    }
  </script>
  <link rel="alternate" type="application/rss+xml" title="${pubName} RSS Feed" href="/rss.xml">
  <link rel="site.standard.publication" href="at://${did}/site.standard.publication/self">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    code, pre { font-family: 'Fira Code', monospace; }
    .prose code { background: #1f2937; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.875em; color: #f3f4f6; }
    .prose pre { background: #0d1117; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; border: 1px solid #30363d; margin: 1.5rem 0; }
    .prose pre code { background: transparent; padding: 0; color: #e6edf3; }
    .prose p { margin-bottom: 1.25rem; line-height: 1.75; color: #d1d5db; }
    .prose h1, .prose h2, .prose h3 { color: #f9fafb; font-weight: 700; margin-top: 2rem; margin-bottom: 1rem; }
    .prose h1 { font-size: 1.875rem; }
    .prose h2 { font-size: 1.5rem; }
    .prose a { color: #38bdf8; text-decoration: underline; }
  </style>
  ${metaTags}
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen flex flex-col selection:bg-amber-500/30 selection:text-amber-200">

  <!-- Header -->
  <header class="border-b border-gray-800/80 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
    <div class="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3 group">
        <div class="w-9 h-9 rounded-lg bg-amber-600/20 border border-amber-500/30 flex items-center justify-center text-amber-500 font-bold text-lg group-hover:scale-105 transition-transform">
          ☕
        </div>
        <div>
          <span class="font-bold text-lg tracking-tight text-white group-hover:text-amber-400 transition-colors">${pubName}</span>
          <span class="text-xs text-amber-500/80 block -mt-1 font-mono">standard.site pub</span>
        </div>
      </a>

      <nav class="flex items-center gap-4 text-sm font-medium">
        <a href="/about" class="text-gray-400 hover:text-amber-400 transition-colors">About</a>
        <a href="/rss.xml" class="text-gray-400 hover:text-amber-400 transition-colors flex items-center gap-1">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/></svg>
          RSS
        </a>
        <a href="https://bsky.app/profile/${did}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-mono transition-all">
          ATProto PDS ↗
        </a>
      </nav>
    </div>
  </header>

  <!-- Main Content -->
  <main class="flex-grow max-w-5xl w-full mx-auto px-6 py-10">
    ${content}
  </main>

  <!-- Footer -->
  <footer class="border-t border-gray-900 bg-gray-950 py-8 text-center text-xs text-gray-500">
    <div class="max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
      <div>
        © ${new Date().getFullYear()} <strong class="text-gray-300">${pubName}</strong>. Decentralized & Self-Hosted on Cloudflare Workers.
      </div>
      <div class="font-mono text-gray-600 flex items-center gap-2">
        <span>DID: ${did.substring(0, 18)}...</span>
        <span>•</span>
        <a href="/.well-known/site.standard.publication" class="hover:underline text-amber-500/80">standard.site spec</a>
      </div>
    </div>
  </footer>

</body>
</html>`;
}
