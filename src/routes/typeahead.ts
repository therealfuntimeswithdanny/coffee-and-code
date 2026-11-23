import { Hono, type Context } from 'hono';
import { Env } from '../types';
import { renderLayout } from '../templates/layout';

// typeahead.waow.tech is a community-run, network-wide actor index that keeps a
// Bluesky-compatible endpoint, so the swap is only a base-URL change.
const DEFAULT_UPSTREAM = 'https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead';
const CACHE_TTL_SECONDS = 30;
const MAX_QUERY_LENGTH = 100;

type ActorBasic = {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
  createdAt?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...extra,
    },
  });
}

function sanitizeActor(value: unknown): ActorBasic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const actor = value as Record<string, unknown>;
  const did = typeof actor.did === 'string' ? actor.did : '';
  const handle = typeof actor.handle === 'string' ? actor.handle : '';
  if (!did || did.length > 256 || !/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did)) return undefined;
  if (!handle || handle.length > 253) return undefined;
  const result: ActorBasic = { did, handle };
  if (typeof actor.displayName === 'string' && actor.displayName && actor.displayName.length <= 640) {
    result.displayName = actor.displayName;
  }
  if (typeof actor.avatar === 'string' && actor.avatar.startsWith('https://') && actor.avatar.length <= 2048) {
    result.avatar = actor.avatar;
  }
  if (typeof actor.description === 'string' && actor.description && actor.description.length <= 2560) {
    result.description = actor.description;
  }
  if (typeof actor.createdAt === 'string' && Number.isFinite(Date.parse(actor.createdAt))) {
    result.createdAt = actor.createdAt;
  }
  return result;
}

async function searchActorsTypeahead(c: Context<{ Bindings: Env }>) {
  const q = (c.req.query('q') || c.req.query('term') || '').trim();
  if (!q || q.length > MAX_QUERY_LENGTH) {
    return json({ error: `A non-empty q parameter of at most ${MAX_QUERY_LENGTH} characters is required.` }, 400);
  }
  const rawLimit = c.req.query('limit');
  const limit = rawLimit === undefined ? 10 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return json({ error: 'limit must be an integer between 1 and 100.' }, 400);
  }

  const cacheKey = new Request(
    `https://typeahead.coffeencode.cc/api/typeahead/searchActorsTypeahead?q=${encodeURIComponent(q.toLowerCase())}&limit=${limit}`,
  );
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
  } catch {
    // The Cache API is unavailable in some contexts; fall through to the network.
  }

  const upstream = new URL(c.env.TYPEAHEAD_UPSTREAM || DEFAULT_UPSTREAM);
  upstream.searchParams.set('q', q);
  upstream.searchParams.set('limit', String(limit));

  let payload: { actors?: unknown };
  try {
    const response = await fetch(upstream.toString(), {
      // X-Client attributes this app's traffic on the upstream's public stats.
      headers: { Accept: 'application/json', 'User-Agent': 'CoffeeAndCode (coffeencode.cc)', 'X-Client': 'coffeencode.cc' },
    });
    if (!response.ok) throw new Error(`Upstream typeahead returned ${response.status}`);
    payload = await response.json() as { actors?: unknown };
  } catch (error) {
    console.error('Typeahead upstream request failed:', error);
    return json({ error: 'Handle search is temporarily unavailable.' }, 502, { 'Cache-Control': 'no-store' });
  }

  const actors = (Array.isArray(payload.actors) ? payload.actors : [])
    .map(sanitizeActor)
    .filter((actor): actor is ActorBasic => Boolean(actor))
    .slice(0, limit);

  const result = json({ actors }, 200, { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` });
  try {
    c.executionCtx.waitUntil(caches.default.put(cacheKey, result.clone()));
  } catch {
    // Ignore cache write failures.
  }
  return result;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function typeaheadPage(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  const apiUrl = `${origin}/api/typeahead/searchActorsTypeahead`;
  const body = `
    <section class="typeahead-page" aria-labelledby="typeahead-title">
      <h1 id="typeahead-title">Handle typeahead</h1>
      <p class="typeahead-page__intro">Type-ahead search over AT Protocol handles and display names, powered by the network-wide index at <a href="https://typeahead.waow.tech/">typeahead.waow.tech</a>. Start typing to see matching accounts — the same unauthenticated JSON API shown below powers the suggestions.</p>
      <handle-typeahead api="${escapeHtml(apiUrl)}" profile-base="https://coffeencode.cc/user/"></handle-typeahead>
      <p class="typeahead-page__selection" data-typeahead-selection role="status" aria-live="polite"></p>
      <section class="typeahead-page__api" aria-labelledby="typeahead-api-title">
        <h2 id="typeahead-api-title">API</h2>
        <p>The endpoint is public and CORS-enabled, so you can use it from any web app:</p>
        <pre><code>GET ${escapeHtml(apiUrl)}?q=lewis&amp;limit=6</code></pre>
        <p><code>q</code> is the required search prefix and <code>limit</code> is optional (1–100, default 10). The response matches <code>app.bsky.actor.searchActorsTypeahead</code>: an <code>actors</code> array of basic profile views with <code>did</code>, <code>handle</code>, <code>displayName</code>, <code>avatar</code>, <code>description</code> and <code>createdAt</code>.</p>
        <pre><code>curl '${escapeHtml(apiUrl)}?q=daniel&amp;limit=3'</code></pre>
      </section>
    </section>
    <style>
      .typeahead-page { margin: 0 auto; max-width: 720px; }
      .typeahead-page h1 { font-family: Lora, serif; font-size: clamp(2.4rem, 6vw, 4rem); letter-spacing: -.04em; line-height: 1.05; margin: 0 0 18px; }
      .typeahead-page__intro { color: var(--muted); font-size: 18px; line-height: 1.55; margin: 0 0 26px; }
      .typeahead-page__selection { color: var(--muted); font-size: 14px; margin: 14px 0 0; min-height: 1.4em; }
      .typeahead-page__selection a { color: var(--accent); }
      .typeahead-page__api { border-top: 1px solid var(--line); margin-top: 40px; padding-top: 22px; }
      .typeahead-page__api h2 { font-size: 16px; letter-spacing: .1em; margin: 0 0 12px; text-transform: uppercase; }
      .typeahead-page__api p { color: var(--muted); font-size: 15px; line-height: 1.6; }
      .typeahead-page__api code { font-family: ui-monospace, monospace; font-size: .92em; }
      .typeahead-page__api pre { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 4px; overflow-x: auto; padding: 12px 14px; }
    </style>
    <script type="module" src="/components/typeahead.js"></script>
    <script type="module">
      const picker = document.querySelector('handle-typeahead');
      const status = document.querySelector('[data-typeahead-selection]');
      picker?.addEventListener('handle-selected', (event) => {
        const actor = event.detail || {};
        status.innerHTML = 'Selected <a href="' + picker.getAttribute('profile-base') + encodeURIComponent(actor.handle || '') + '">@' + (actor.handle || '') + '</a> (' + (actor.did || '') + ')';
      });
    </script>`;
  const metaTags = `
    <meta name="description" content="AT Protocol handle typeahead: prefix search over accounts with a free, unauthenticated JSON API.">
    <meta property="og:title" content="Handle typeahead | Coffee &amp; Code">
    <meta property="og:description" content="Prefix search over AT Protocol handles with a free, unauthenticated JSON API.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(origin)}/tools/typeahead">
    <link rel="canonical" href="${escapeHtml(origin)}/tools/typeahead">
  `;
  return c.html(renderLayout(c, 'Handle typeahead', body, metaTags));
}

// API router — mounted at /api/typeahead and /xrpc on the service host.
export const typeaheadApi = new Hono<{ Bindings: Env }>();
typeaheadApi.options('*', () => new Response(null, { status: 204, headers: corsHeaders }));
typeaheadApi.get('/searchActorsTypeahead', searchActorsTypeahead);

// Page router — mounted at /tools/typeahead on the main site.
export const typeaheadPages = new Hono<{ Bindings: Env }>();
typeaheadPages.get('/', typeaheadPage);
