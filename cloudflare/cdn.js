const VERSION = "5.0.0";
const ADMIN_DID = "did:plc:l37td5yhxl2irrzrgvei4qay";
const CONTACT_EMAIL = "atcdn@danielmorrisey.com";
const SERVICE_NAME = "atCDN for Bluesky & the AT Protocol by the BlueAT Network";
const PLC_DIRECTORIES = ["https://plc.eurosky.network", "https://plc.directory"];
const DID_TTL_MS = 86_400_000; // 24 hours
const NEGATIVE_TTL_S = 60;     // remember missing blobs briefly
const PDS_TIMEOUT_MS = 10_000;
const PLC_TIMEOUT_MS = 5_000;

const DID_RE = /^did:(?:plc:[a-z2-7]{24}|web:[A-Za-z0-9._:%-]+)$/;
const CID_RE = /^[A-Za-z0-9]{10,128}$/;

// /img/{type}/plain/{did}/{cid}[@ext]
const IMG_PATH_RE = /^\/img\/([^/]+)\/plain\/((?:did:[^/]+|did%3A[^/]+))\/([^@/]+)(?:@\w+)?/;
// /blob/{did}/{cid}[@ext][/{preset or params}]
const BLOB_PATH_RE = /^\/blob\/((?:did:[^/]+|did%3A[^/]+))\/([^@/]+)(?:@\w+)?(?:\/(.*))?$/;

// Preset definitions for /blob/{did}/{cid}/{preset} format
const PRESETS = {
  // Avatar presets
  avatar_thumb:  { width: 64,   height: 64,   fit: "cover"  },
  avatar_small:  { width: 128,  height: 128,  fit: "cover"  },
  avatar_medium: { width: 256,  height: 256,  fit: "cover"  },
  avatar_large:  { width: 512,  height: 512,  fit: "cover"  },
  avatar_full:   { width: 1000, height: 1000, fit: "inside" },

  // Banner presets
  banner_thumb:  { width: 300,  height: 100,  fit: "cover"  },
  banner_small:  { width: 600,  height: 200,  fit: "cover"  },
  banner_medium: { width: 900,  height: 300,  fit: "cover"  },
  banner_large:  { width: 1500, height: 500,  fit: "cover"  },
  banner_full:   { width: 3000, height: 1000, fit: "inside" },

  // Generic image presets
  thumb:    { width: 150,  height: 150,  fit: "cover"  },
  small:    { width: 320,  height: 320,  fit: "inside" },
  medium:   { width: 640,  height: 640,  fit: "inside" },
  large:    { width: 1024, height: 1024, fit: "inside" },
  full:     { width: 2000, height: 2000, fit: "inside" },

  // Feed/post image presets (4:3, 16:9, etc.)
  feed_thumb:     { width: 200,  height: 150,  fit: "cover" },
  feed_small:     { width: 400,  height: 300,  fit: "cover" },
  feed_medium:    { width: 800,  height: 600,  fit: "cover" },
  feed_large:     { width: 1200, height: 900,  fit: "cover" },
  feed_fullsize:  { width: 2000, height: 2000, fit: "inside" },

  // 16:9 widescreen
  wide_thumb:  { width: 320,  height: 180,  fit: "cover" },
  wide_small:  { width: 640,  height: 360,  fit: "cover" },
  wide_medium: { width: 1280, height: 720,  fit: "cover" },
  wide_large:  { width: 1920, height: 1080, fit: "cover" },
};

// Default transforms for /img/{type}/ (matching cdn.bsky.app behavior)
const IMG_TYPES = {
  avatar:           { width: 1000, height: 1000, fit: "inside" },
  avatar_thumbnail: { width: 64,   height: 64,   fit: "cover"  },
  avatar_thumb:     { width: 128,  height: 128,  fit: "cover"  },
  avatar_small:     { width: 240,  height: 240,  fit: "cover"  },
  avatar_medium:    { width: 400,  height: 400,  fit: "cover"  },
  avatar_large:     { width: 640,  height: 640,  fit: "cover"  },
  avatar_fullsize:  { width: 1000, height: 1000, fit: "inside" },

  banner:           { width: 3000, height: 1000, fit: "inside" },
  banner_thumbnail: { width: 300,  height: 100,  fit: "cover"  },
  banner_thumb:     { width: 600,  height: 200,  fit: "cover"  },
  banner_small:     { width: 900,  height: 300,  fit: "cover"  },
  banner_medium:    { width: 1200, height: 400,  fit: "cover"  },
  banner_large:     { width: 1500, height: 500,  fit: "cover"  },
  banner_fullsize:  { width: 3000, height: 1000, fit: "inside" },

  feed_thumbnail:   { width: 200,  height: 200,  fit: "cover"  },
  feed_thumb:       { width: 400,  height: 400,  fit: "cover"  },
  feed_small:       { width: 600,  height: 600,  fit: "cover"  },
  feed_medium:      { width: 800,  height: 800,  fit: "cover"  },
  feed_large:       { width: 1200, height: 1200, fit: "cover"  },
  feed_fullsize:    { width: 2000, height: 2000, fit: "inside" },

  thumb:  { width: 150,  height: 150,  fit: "cover"  },
  small:  { width: 320,  height: 320,  fit: "inside" },
  medium: { width: 640,  height: 640,  fit: "inside" },
  large:  { width: 1024, height: 1024, fit: "inside" },
  full:   { width: 2000, height: 2000, fit: "inside" },

  wide_thumb:  { width: 320,  height: 180,  fit: "cover" },
  wide_small:  { width: 640,  height: 360,  fit: "cover" },
  wide_medium: { width: 1280, height: 720, fit: "cover" },
  wide_large:  { width: 1920, height: 1080, fit: "cover" },
};

const LANDING_PAGE = `<!DOCTYPE html>
<html>
<head>
    <title>atCDN</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <h1>atCDN</h1>
    <p id="service-name">Loading...</p>
    <p>
        Version: <code id="version">-</code> | 
        <a href="/xrpc/_health">Health JSON</a> | 
        <a href="/presets">Presets</a>
    </p>
    <hr>

    <h2>Health Status</h2>
    <div id="health">
        <p>Status: <b id="health-status">checking...</b></p>
        <p>PLC Directories:</p>
        <ul id="plc-health"><li>Loading...</li></ul>
        <p>D1 Cache: <span id="d1-status">-</span></p>
        <p id="db-stats"></p>
    </div>
    <hr>

    <h2>Playground</h2>

    <h3>/img/ format (social-app compatible)</h3>
    <p>
        DID: <input type="text" id="img-did" size="50"><br>
        CID: <input type="text" id="img-cid" size="50"><br>
        Type:
        <select id="img-type">
            <option value="avatar_thumbnail">avatar_thumbnail (64x64)</option>
            <option value="avatar_thumb">avatar_thumb (128x128)</option>
            <option value="avatar_small">avatar_small (240x240)</option>
            <option value="avatar_medium">avatar_medium (400x400)</option>
            <option value="avatar_large">avatar_large (640x640)</option>
            <option value="avatar_fullsize">avatar_fullsize (1000x1000)</option>
            <option value="banner_thumb">banner_thumb (600x200)</option>
            <option value="banner_small">banner_small (900x300)</option>
            <option value="banner_medium">banner_medium (1200x400)</option>
            <option value="banner_large">banner_large (1500x500)</option>
            <option value="banner_fullsize">banner_fullsize (3000x1000)</option>
            <option value="feed_thumbnail">feed_thumbnail (200x200)</option>
            <option value="feed_thumb">feed_thumb (400x400)</option>
            <option value="feed_small">feed_small (600x600)</option>
            <option value="feed_medium">feed_medium (800x800)</option>
            <option value="feed_large">feed_large (1200x1200)</option>
            <option value="feed_fullsize" selected>feed_fullsize (2000x2000)</option>
        </select>
        Ext:
        <select id="img-ext">
            <option value="">none</option>
            <option value="@jpeg" selected>@jpeg</option>
            <option value="@png">@png</option>
        </select>
    </p>
    <p>
        <button onclick="genImg()">Generate URL</button>
        <button onclick="loadImg()">Load Image</button>
        <button onclick="openImg()">Open</button>
    </p>
    <p>URL: <code id="img-url"></code></p>
    <p><img id="img-preview" style="max-width:500px"></p>

    <hr>

    <h3>/blob/ format (Generic AT Protocol)</h3>
    <p>
        DID: <input type="text" id="blob-did" size="50"><br>
        CID: <input type="text" id="blob-cid" size="50"><br>
        Preset:
        <select id="blob-preset">
            <option value="">none (original)</option>
            <option value="avatar_thumb">avatar_thumb</option>
            <option value="avatar_medium">avatar_medium</option>
            <option value="avatar_large">avatar_large</option>
            <option value="banner_medium">banner_medium</option>
            <option value="feed_medium">feed_medium</option>
            <option value="feed_fullsize">feed_fullsize</option>
            <option value="thumb">thumb</option>
            <option value="small">small</option>
            <option value="medium">medium</option>
            <option value="large">large</option>
        </select>
        Or params: <input type="text" id="blob-params" placeholder="w=256&h=256&fit=crop" size="30">
    </p>
    <p>
        <button onclick="genBlob()">Generate URL</button>
        <button onclick="loadBlob()">Load Image</button>
        <button onclick="openBlob()">Open</button>
    </p>
    <p>URL: <code id="blob-url"></code></p>
    <p><img id="blob-preview" style="max-width:500px"></p>

    <hr>

    <h2>Endpoints</h2>
    <ul>
        <li><code>GET /img/{type}/plain/{did}/{cid}[@ext]</code> - Bluesky social-app format</li>
        <li><code>GET /blob/{did}/{cid}[@ext]/{preset}</code> - Generic AT Protocol format</li>
        <li><code>GET /blob/{did}/{cid}?w=256&h=256&fit=crop</code> - Custom transforms</li>
        <li><code>GET /presets</code> - List all presets</li>
        <li><code>GET /xrpc/_health</code> - Health check</li>
        <li><code>GET /clear</code> - Clear DID cache</li>
    </ul>

    <h2>Examples</h2>
    <ul id="examples">
        <li>Loading examples...</li>
    </ul>

    <hr>
    <p>
        <span id="footer-service"></span><br>
        Contact: <a id="footer-email" href="#"></a><br>
        Admin DID: <code id="footer-did"></code>
    </p>

    <script>
        const base = window.location.origin;

        // Fetch health info on load
        async function loadHealth() {
            try {
                const res = await fetch("/xrpc/_health");
                const data = await res.json();

                // Header info
                document.getElementById("service-name").textContent = data.service_name;
                document.getElementById("version").textContent = data.version;

                // Footer info
                document.getElementById("footer-service").textContent = data.service_name;
                document.getElementById("footer-email").textContent = data.admin_contact_email;
                document.getElementById("footer-email").href = "mailto:" + data.admin_contact_email;
                document.getElementById("footer-did").textContent = data.admin_did;

                // Health status
                document.getElementById("health-status").textContent = data.status;
                document.getElementById("health-status").style.color = data.status === "ok" ? "green" : "red";

                // PLC health
                const plcList = document.getElementById("plc-health");
                plcList.innerHTML = "";
                data.plc_health.forEach(plc => {
                    const li = document.createElement("li");
                    li.textContent = plc.directory + " - " + (plc.ok ? "OK (" + plc.status + ")" : "DOWN (" + plc.status + ")");
                    li.style.color = plc.ok ? "green" : "red";
                    plcList.appendChild(li);
                });

                // D1 cache status
                document.getElementById("d1-status").textContent = data.d1_cache_enabled ? "Enabled" : "Disabled";

                // DB stats
                if (data.db && !data.db.disabled) {
                    document.getElementById("db-stats").textContent = 
                        "Cached DIDs: " + data.db.cached_dids + 
                        " | Stale: " + data.db.stale_dids +
                        " | Last clear: " + (data.db.last_cache_clear || "never");
                } else {
                    document.getElementById("db-stats").textContent = "D1 cache disabled";
                }

                // Set example DID/CID from admin
                const exampleDid = data.admin_did;
                document.getElementById("img-did").value = exampleDid;
                document.getElementById("blob-did").value = exampleDid;

                // Load examples with real DID
                loadExamples(exampleDid);

            } catch (err) {
                document.getElementById("health-status").textContent = "Error: " + err.message;
                document.getElementById("health-status").style.color = "red";
            }
        }

        function loadExamples(did) {
            const encodedDid = encodeURIComponent(did);
            const exampleCid = "bafkreia6woar4xdzztr7npinlwu7suybwzvq2g7zv4clmpzkqfhzewotg4";
            const examples = document.getElementById("examples");
            examples.innerHTML = \`
                <li><a href="/img/avatar/plain/did:plc:l37td5yhxl2irrzrgvei4qay/bafkreibayz5nsqibyixagmx4afqd45fg2ab6ehcav5m26u4eejom2kvydq@webp" target="_blank">Avatar (cdn.bsky.app format)</a></li>
                <li><a href="/blob/\${encodedDid}/\${exampleCid}@jpeg/avatar_medium" target="_blank">Blob with preset</a></li>
                <li><a href="/blob/\${encodedDid}/\${exampleCid}?w=256&h=256&fit=crop" target="_blank">Blob with query params</a></li>
            \`;
            document.getElementById("img-cid").value = exampleCid;
            document.getElementById("blob-cid").value = exampleCid;
        }

        function genImg() {
            const did = encodeURIComponent(document.getElementById("img-did").value.trim());
            const cid = document.getElementById("img-cid").value.trim();
            const type = document.getElementById("img-type").value;
            const ext = document.getElementById("img-ext").value;
            const url = base + "/img/" + type + "/plain/" + did + "/" + cid + ext;
            document.getElementById("img-url").textContent = url;
            return url;
        }

        function loadImg() {
            document.getElementById("img-preview").src = genImg();
        }

        function openImg() {
            window.open(genImg(), "_blank");
        }

        function genBlob() {
            const did = encodeURIComponent(document.getElementById("blob-did").value.trim());
            const cid = document.getElementById("blob-cid").value.trim();
            const preset = document.getElementById("blob-preset").value;
            const params = document.getElementById("blob-params").value.trim();
            let url = base + "/blob/" + did + "/" + cid;
            if (preset) url += "/" + preset;
            else if (params) url += "?" + params;
            document.getElementById("blob-url").textContent = url;
            return url;
        }

        function loadBlob() {
            document.getElementById("blob-preview").src = genBlob();
        }

        function openBlob() {
            window.open(genBlob(), "_blank");
        }

        // Init
        loadHealth();
    </script>
</body>
</html>`;


export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const url = new URL(request.url);
    const d1 = env.D1_CACHE_ENABLED !== "false" && !!env.DB;

    switch (url.pathname) {
      case "/":
      case "/index.html":
        return new Response(LANDING_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      case "/xrpc/_health":
        return health(env, d1);
      case "/presets":
        return json({
          service: SERVICE_NAME,
          usage: "/blob/{did}/{cid}/{preset}",
          query_params: "Or use /blob/{did}/{cid}?w=256&h=256&fit=crop",
          presets: PRESETS,
        });
      case "/clear": {
        if (env.CLEAR_TOKEN) {
          const supplied = url.searchParams.get("token") || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
          if (supplied !== env.CLEAR_TOKEN) return json({ error: "unauthorized" }, 401);
        }
        if (!d1) return json({ cleared: 0, message: "D1 cache is disabled" });
        const { meta } = await env.DB.prepare("DELETE FROM did_cache").run();
        return json({ cleared: meta.changes });
      }
    }

    const route = parseRoute(url);
    if (!route) return new Response("Not Found", { status: 404 });
    if (!DID_RE.test(route.did)) return new Response("Invalid DID", { status: 400 });
    if (!CID_RE.test(route.cid)) return new Response("Invalid CID", { status: 400 });

    const cache = caches.default;
    const cacheHeaders = new Headers();
    if (route.transform) cacheHeaders.set("Accept", request.headers.get("Accept") || "");
    const cacheKey = new Request(request.url, { method: "GET", headers: cacheHeaders });
    const cached = await cache.match(cacheKey);
    if (cached) {
      const age = Date.now() - Date.parse(cached.headers.get("X-Cached-At") || 0);
      if (cached.status === 200 && !(age < DID_TTL_MS)) {
        ctx.waitUntil(refresh(env, ctx, route, cache, cacheKey, d1));
      }
      return cached;
    }

    try {
      const res = await fetchBlob(env, ctx, route, d1, request.headers.get("Accept"));

      if (res === null) return new Response("PDS Not Found", { status: 404 });

      if (!res.ok) {
        res.body?.cancel();
        if (res.status >= 500) return new Response("Bad Gateway", { status: 502 });
        const notFound = new Response("Asset Not Found", {
          status: 404,
          headers: { "Cache-Control": `public, max-age=${NEGATIVE_TTL_S}` },
        });
        ctx.waitUntil(cache.put(cacheKey, notFound.clone()));
        return notFound;
      }

      const out = buildResponse(res, route);
      ctx.waitUntil(cache.put(cacheKey, out.clone()));
      return out;
    } catch (err) {
      const timeout = err?.name === "TimeoutError";
      return new Response(timeout ? "Gateway Timeout" : "Bad Gateway", { status: timeout ? 504 : 502 });
    }
  },

  // Cron: prune expired DID cache entries
  async scheduled(event, env) {
    if (env.D1_CACHE_ENABLED === "false" || !env.DB) return;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM did_cache WHERE cached_at < ?").bind(Date.now() - DID_TTL_MS),
      env.DB.prepare(
        `INSERT INTO meta (key, value) VALUES ('last_cache_clear', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).bind(new Date().toISOString()),
    ]);
  },
};

// ── Origin fetch ──────────────────────────────────────────────────────────────

// Returns a Response from the PDS, or null if the DID can't be resolved.
async function fetchBlob(env, ctx, { did, cid, format, type, transform }, d1, accept) {
  const pds = await resolvePds(env, ctx, did, d1);
  if (!pds) return null;

  const blobUrl = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${cid}`;
  let res = await fetchBlobResponse(blobUrl, transform, accept);

  // Avatar/banner CIDs go stale when a profile changes: retry with the current one
  const field = type?.startsWith("avatar") ? "avatar" : type?.startsWith("banner") ? "banner" : null;
  if ((res.status === 404 || res.status === 400) && format === "img" && field) {
    res.body?.cancel();
    const current = await currentProfileCid(pds, did, field);
    if (current && current !== cid) {
      res = await fetchBlobResponse(
        `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${current}`,
        transform,
        accept,
      );
    }
  }
  return res;
}

async function fetchBlobResponse(url, transform, accept) {
  const res = await pdsFetch(url, transform, accept);
  if (!transform || ![400, 415, 500, 502, 503].includes(res.status)) return res;
  res.body?.cancel();
  return pdsFetch(url);
}

async function refresh(env, ctx, route, cache, cacheKey, d1) {
  try {
    const res = await fetchBlob(env, ctx, route, d1, cacheKey.headers.get("Accept"));
    if (res?.ok) await cache.put(cacheKey, buildResponse(res, route));
    else res?.body?.cancel(); // keep the existing copy
  } catch {}
}

function pdsFetch(url, transform, accept) {
  const options = { signal: AbortSignal.timeout(PDS_TIMEOUT_MS) };
  if (transform) {
    const fit = transform.fit === "inside"
      ? "scale-down"
      : transform.fit === "outside"
        ? "cover"
        : transform.fit;
    options.cf = {
      image: {
        ...transform,
        fit,
        quality: transform.quality || 80,
        format: "auto",
      },
    };
    options.headers = { Accept: accept || "image/avif,image/webp,image/*,*/*" };
  }
  return fetch(url, options);
}

async function currentProfileCid(pds, did, field) {
  const res = await pdsFetch(
    `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=app.bsky.actor.profile&rkey=self`
  );
  if (!res.ok) { res.body?.cancel(); return null; }
  return (await res.json()).value?.[field]?.ref?.$link ?? null;
}

function buildResponse(source, { format, transform }) {
  const headers = new Headers({
    "Content-Type": source.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": "inline",
    "Content-Security-Policy": "default-src 'none'; sandbox", // blobs are user-controlled
    "X-Content-Type-Options": "nosniff",
    "X-Cached-At": new Date().toUTCString(),
    "X-Format": format,
  });
  if (transform) headers.set("Vary", "Accept");
  for (const h of ["etag", "last-modified"]) {
    const v = source.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (transform) headers.set("X-Transform", JSON.stringify(transform));
  return new Response(source.body, { status: 200, headers });
}

// ── DID → PDS ─────────────────────────────────────────────────────────────────

async function resolvePds(env, ctx, did, d1) {
  if (d1) {
    const row = await env.DB.prepare("SELECT pds_url, cached_at FROM did_cache WHERE did = ?").bind(did).first();
    if (row && Date.now() - row.cached_at < DID_TTL_MS) return row.pds_url;
  }

  const sources = did.startsWith("did:web:") ? [didWebUrl(did)] : PLC_DIRECTORIES.map((dir) => `${dir}/${did}`);

  for (const src of sources) {
    try {
      const res = await fetch(src, {
        cf: { cacheTtl: 3600, cacheEverything: true },
        signal: AbortSignal.timeout(PLC_TIMEOUT_MS),
      });
      if (!res.ok) { res.body?.cancel(); continue; }

      const pds = extractPds(await res.json());
      if (!pds) continue;

      if (d1) {
        ctx.waitUntil(
          env.DB.prepare(
            `INSERT INTO did_cache (did, pds_url, cached_at) VALUES (?, ?, ?)
             ON CONFLICT(did) DO UPDATE SET pds_url = excluded.pds_url, cached_at = excluded.cached_at`
          ).bind(did, pds, Date.now()).run().catch(() => {})
        );
      }
      return pds;
    } catch {}
  }
  return null;
}

function didWebUrl(did) {
  const [host, ...path] = did.slice(8).split(":").map(decodeURIComponent);
  return `https://${host}${path.length ? "/" + path.join("/") : "/.well-known"}/did.json`;
}

function extractPds(doc) {
  const s = doc?.service?.find?.((x) => x.id === "#atproto_pds" || x.type === "AtprotoPersonalDataServer");
  try {
    const u = new URL(s?.serviceEndpoint);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

// ── Routing / transforms ──────────────────────────────────────────────────────

function parseRoute(url) {
  const img = url.pathname.match(IMG_PATH_RE);
  if (img) {
    return {
      format: "img",
      type: img[1],
      did: decodeDid(img[2]),
      cid: img[3],
      transform: parseTransformParams(url.searchParams) || IMG_TYPES[img[1]] || null,
    };
  }

  const blob = url.pathname.match(BLOB_PATH_RE);
  if (blob) {
    const params = blob[3];
    const transform = !params
      ? parseTransformParams(url.searchParams)
      : Object.hasOwn(PRESETS, params)
        ? PRESETS[params]
        : parseTransformParams(new URLSearchParams(params));
    return { format: "blob", type: null, did: decodeDid(blob[1]), cid: blob[2], transform };
  }
  return null;
}

function decodeDid(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function parseTransformParams(sp) {
  if (!sp || sp.size === 0) return null;
  const width = parseInt(sp.get("w") || sp.get("width"), 10);
  const height = parseInt(sp.get("h") || sp.get("height"), 10);
  const fit = sp.get("fit") || sp.get("f");
  const quality = parseInt(sp.get("q") || sp.get("quality"), 10);

  const t = {};
  if (width) t.width = Math.min(width, 4000);
  if (height) t.height = Math.min(height, 4000);
  if (["cover", "contain", "inside", "outside"].includes(fit)) t.fit = fit;
  if (quality) t.quality = Math.min(Math.max(quality, 1), 100);
  return Object.keys(t).length ? t : null;
}

// ── Health ────────────────────────────────────────────────────────────────────

async function health(env, d1) {
  const [plc, db] = await Promise.all([
    Promise.all(PLC_DIRECTORIES.map(async (directory) => {
      try {
        const res = await fetch(`${directory}/${ADMIN_DID}`, { method: "HEAD", signal: AbortSignal.timeout(PLC_TIMEOUT_MS) });
        return { directory, ok: res.ok, status: res.status };
      } catch {
        return { directory, ok: false, status: 0 };
      }
    })),
    d1
      ? Promise.all([
          env.DB.prepare(
            "SELECT COUNT(*) AS total, SUM(cached_at < ?) AS stale, MIN(cached_at) AS oldest, MAX(cached_at) AS newest FROM did_cache"
          ).bind(Date.now() - DID_TTL_MS).first(),
          env.DB.prepare("SELECT value FROM meta WHERE key = 'last_cache_clear'").first(),
        ]).then(([s, c]) => ({
          cached_dids: s?.total ?? 0,
          stale_dids: s?.stale ?? 0,
          oldest_entry: s?.oldest ? new Date(s.oldest).toISOString() : null,
          newest_entry: s?.newest ? new Date(s.newest).toISOString() : null,
          last_cache_clear: c?.value ?? null,
        })).catch(() => ({ error: true }))
      : { disabled: true },
  ]);

  return json({
    status: plc.some((p) => p.ok) && !db.error ? "ok" : "degraded",
    version: VERSION,
    admin_did: ADMIN_DID,
    admin_contact_email: CONTACT_EMAIL,
    service_name: SERVICE_NAME,
    primary_plc_directory: PLC_DIRECTORIES[0],
    backup_plc_directory: PLC_DIRECTORIES[1],
    d1_cache_enabled: d1,
    features: {
      img_format: "/img/{type}/plain/{did}/{cid}[@ext]",
      blob_format: "/blob/{did}/{cid}[@ext]/{params}",
      presets_endpoint: "/presets",
      clear_endpoint: "/clear",
    },
    plc_health: plc,
    db,
  });
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}