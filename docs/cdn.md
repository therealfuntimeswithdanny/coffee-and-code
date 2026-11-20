---
title: Images (atCDN)
description: Public CDN for fetching blobs (images) on the AT Protocol.
section: Media
sectionIcon: fa-photo-film
icon: fa-images
order: 1
updated: 2026-11-19
---
atCDN is a public CDN for AT Protocol images, available at
**`https://cdn.coffeencode.cc`**. It serves blobs (avatars, banners, post
images) through Cloudflare's edge cache, resolving each author's PDS from
their DID and optionally resizing images through an
[imgproxy](https://imgproxy.net) backend.

Anyone can use it — no API key, no signup. Build a URL from a DID and a blob
CID, request it, and you get the image.

## Quick start

```html
<!-- A user's avatar, 128x128 -->
<img src="https://cdn.coffeencode.cc/img/avatar_thumb/plain/did:plc:l37td5yhxl2irrzrgvei4qay/bafkreia6woar4xdzztr7npinlwu7suybwzvq2g7zv4clmpzkqfhzewotg4@jpeg" alt="">

<!-- The same blob at a custom size -->
<img src="https://cdn.coffeencode.cc/blob/did:plc:l37td5yhxl2irrzrgvei4qay/bafkreia6woar4xdzztr7npinlwu7suybwzvq2g7zv4clmpzkqfhzewotg4?w=400&h=300&fit=crop" alt="">
```

To build URLs for a user, look up their `app.bsky.actor.profile` record on
their PDS (`com.atproto.repo.getRecord`) and read the `avatar`/`banner` blob
`ref.$link` for the CID, or use post embed images from
`app.bsky.feed.getPosts`.

Send `Accept: image/webp` and resized images come back as WebP; otherwise
JPEG. Hotlinking is fine — responses are edge-cached and permissive.

---

## Endpoints

All endpoints are relative to `https://cdn.coffeencode.cc`.

| Endpoint | Description |
|---|---|
| `GET /` | Landing page: health status, playground, examples |
| `GET /img/{type}/plain/{did}/{cid}[@ext]` | Bluesky social-app compatible image format |
| `GET /blob/{did}/{cid}[@ext][/{preset}]` | Generic AT Protocol blob, optional preset |
| `GET /blob/{did}/{cid}?w=256&h=256&fit=crop` | Resize via query params |
| `GET /imgproxy/?url=https://...&w=400&h=300&fit=crop` | Resize any public image |
| `GET /presets` | JSON list of all presets |
| `GET /xrpc/_health` | Health check JSON |
| `GET /clear` | Clear the DID cache (token-protected if `CLEAR_TOKEN` is set) |

Only `GET` and `HEAD` are allowed; everything else returns `405`.

## URL formats

### `/img/` format (social-app compatible)

```
/img/{type}/plain/{did}/{cid}[@ext]
```

Example:

```
/img/avatar_medium/plain/did:plc:l37td5yhxl2irrzrgvei4qay/bafkrei...@jpeg
```

`@ext` is optional (`@jpeg`, `@png`, `@webp`, …) and is ignored when choosing the
output — the actual format is picked from the request's `Accept` header.

When the CID in the URL has gone stale (profile picture changed), `avatar*` and
`banner*` types automatically retry with the CID from the author's current
`app.bsky.actor.profile` record.

#### `/img/` types

Avatar types (square, `cover` fit) — used for profile pictures, e.g. the
avatar beside a post or on a profile page:

- `avatar_thumbnail` — 64x64
- `avatar_thumb` — 128x128
- `avatar_small` — 240x240
- `avatar_medium` — 400x400
- `avatar_large` — 640x640
- `avatar_fullsize` — original

Banner types (`cover` fit) — used for the profile header image:

- `banner_thumb` — 600x200
- `banner_small` — 900x300
- `banner_medium` — 1200x400
- `banner_large` — 1500x500
- `banner_fullsize` — original

Feed types (`inside` fit) — used for post embed images in timelines:

- `feed_thumb` — 400x400
- `feed_small` — 600x600
- `feed_medium` — 800x800
- `feed_large` — 1200x1200
- `feed_thumbnail` / `feed_fullsize` — original

### `/blob/` format (generic AT Protocol)

```
/blob/{did}/{cid}[@ext]/{preset}
/blob/{did}/{cid}[@ext]?w=256&h=256&fit=crop
```

- With a **preset name**, the image is resized to that preset (see table below).
- With **`w`/`h` query params**, it resizes to those dimensions (capped at 4000px
  per side). `fit=crop` or `fit=cover` crops to fill; anything else (or omitted)
  fits inside the box preserving aspect ratio.
- With neither, the original blob is served. Unknown presets also serve the original.

#### Presets

| Preset | Size (WxH) | Fit |
|---|---|---|
| `avatar_thumb` | 64x64 | cover |
| `avatar_small` | 128x128 | cover |
| `avatar_medium` | 256x256 | cover |
| `avatar_large` | 512x512 | cover |
| `avatar_full` | 1000x1000 | inside |
| `banner_thumb` | 300x100 | cover |
| `banner_small` | 600x200 | cover |
| `banner_medium` | 900x300 | cover |
| `banner_large` | 1500x500 | cover |
| `banner_full` | 3000x1000 | inside |
| `thumb` | 150x150 | cover |
| `small` | 320x320 | inside |
| `medium` | 640x640 | inside |
| `large` | 1024x1024 | inside |
| `full` | 2000x2000 | inside |
| `feed_thumb` | 200x150 | cover |
| `feed_card` | 360x240 | cover |
| `feed_small` | 400x300 | cover |
| `feed_medium` | 800x600 | cover |
| `feed_large` | 1200x900 | cover |
| `feed_fullsize` | 2000x2000 | inside |
| `wide_thumb` | 320x180 | cover |
| `wide_small` | 640x360 | cover |
| `wide_card` | 800x450 | cover |
| `wide_medium` | 1280x720 | cover |
| `wide_large` | 1920x1080 | cover |

### `/imgproxy/` — generic image proxy

```
/imgproxy/?url=https://example.com/photo.jpg&w=400&h=300&fit=crop
```

Resizes any public image through imgproxy.

- `url` is required; `http:` and `https:` only, no credentials in the URL.
- `w` and/or `h` is required (this prevents use as a plain pass-through proxy).
- Private/internal hosts are blocked: `localhost`, `*.local`, `*.internal`,
  IP literals, and single-label hostnames.
- If `PROXY_ALLOWED_HOSTS` is set, only those hosts (and `*.` suffixes) are allowed.

## Output format & headers

- **WebP** is served when the client sends `Accept: image/webp`, otherwise **JPEG**
  (only when a resize applies; un-resized requests return the original bytes).
- Responses include `Content-Security-Policy: default-src 'none'; sandbox` and
  `X-Content-Type-Options: nosniff` since blobs are user-controlled content.
- `X-Format` identifies which route served the response (`img`, `blob`, `proxy`).
- `Vary: Accept` is set on resized responses.

### Cache-Control

| Route | Policy |
|---|---|
| `/img/` | `max-age=86400, s-maxage=604800, stale-while-revalidate=86400` |
| `/blob/` | `max-age=31536000, immutable` (CIDs are content-addressed) |
| `/imgproxy/` | `max-age=86400` |
| 404s | `max-age=60` (brief negative caching) |

## How it works

1. **Route parsing** — `/img/…` and `/blob/…` paths are matched against regexes;
   the DID and CID are validated (`did:plc:`/`did:web:` shapes, CID 10–128 chars).
2. **Edge cache lookup** — the Cloudflare `caches.default` store is checked first
   (cache keys are versioned by `imgproxy-v2` and output format). Cached entries
   older than 24h are served while a refresh runs in the background.
3. **DID → PDS resolution** — three tiers:
   - In-memory memo (1h TTL, max 5000 entries)
   - D1 `did_cache` table (24h TTL)
   - PLC lookup: `plc.eurosky.network` and `plc.directory` raced in parallel;
     `did:web:` DIDs resolve via their `did.json` instead.
   The `#atproto_pds` service endpoint (https only) is extracted from the DID document.
4. **Origin fetch** — `GET {pds}/xrpc/com.atproto.sync.getBlob?did=…&cid=…`
   with a 10s timeout. For stale avatar/banner CIDs, the current profile record's
   CID is retried once.
5. **Resize** — if a size applies and imgproxy is configured, the blob URL is
   fetched through a signed imgproxy URL (`rs:fill|fit:W:H`, smart gravity for
   cover crops, `sm:1` strips metadata). On imgproxy failure it falls back to the
   original and serves it honestly (no `Vary: Accept`).

### Caching layers

| Layer | What | TTL |
|---|---|---|
| `caches.default` | Final responses (incl. brief 404s) | up to 1yr / 24h refresh |
| Memory map | DID → PDS | 1h, max 5000 |
| D1 `did_cache` | DID → PDS | 24h |
| `cf` fetch cache | PLC directory responses | 1h |
| `cf` fetch cache | imgproxy responses | 7d |

A scheduled (cron) handler prunes expired `did_cache` rows and records
`last_cache_clear` in the `meta` table.

## Error responses

| Status | Meaning |
|---|---|
| 400 | Invalid DID, CID, URL, or missing required params |
| 401 | `/clear` without the right token |
| 403 | `/imgproxy/` host blocked or not in the allowlist |
| 404 | PDS not found, asset not found, or unknown route |
| 405 | Non-GET/HEAD method |
| 502 | Origin (PDS/imgproxy) returned an error or fetch failed |
| 503 | `/imgproxy/` used when imgproxy isn't configured |
| 504 | Origin fetch timed out |

## Configuration (Worker env)

| Binding/var | Purpose |
|---|---|
| `DB` (D1) | DID → PDS cache; tables `did_cache(did, pds_url, cached_at)` and `meta(key, value)` |
| `D1_CACHE_ENABLED` | Set `"false"` to disable the D1 cache |
| `IMGPROXY_URL` | imgproxy base URL; required for resizing |
| `IMGPROXY_KEY` | Hex-encoded HMAC key for URL signing |
| `IMGPROXY_SALT` | Hex-encoded HMAC salt |
| `IMGPROXY_SECRET` | Optional `Bearer` token sent to imgproxy |
| `PROXY_ALLOWED_HOSTS` | Comma-separated allowlist for `/imgproxy/` (supports `*.` wildcards); empty = any public host |
| `CLEAR_TOKEN` | If set, `/clear` requires it via `?token=` or `Authorization: Bearer` |

Resizing is enabled only when `IMGPROXY_URL`, `IMGPROXY_KEY`, **and**
`IMGPROXY_SALT` are all set — otherwise every request serves the original.

## Health check

`GET /xrpc/_health` returns:

```json
{
  "status": "ok | degraded",
  "version": "5.2.0",
  "admin_did": "did:plc:…",
  "admin_contact_email": "atcdn@danielmorrisey.com",
  "service_name": "atCDN for Bluesky & the AT Protocol by the BlueAT Network",
  "primary_plc_directory": "https://plc.eurosky.network",
  "backup_plc_directory": "https://plc.directory",
  "d1_cache_enabled": true,
  "imgproxy": { "configured": true, "ok": true, "status": 200 },
  "features": { "img_format": "…", "blob_format": "…", "generic_proxy": "…" },
  "plc_health": [{ "directory": "…", "ok": true, "status": 200 }],
  "db": { "cached_dids": 0, "stale_dids": 0, "last_cache_clear": "…" }
}
```

Status is `ok` when at least one PLC directory is reachable and the D1 cache is
healthy. When imgproxy is unconfigured or down it is reported but requests keep
working by serving originals.
