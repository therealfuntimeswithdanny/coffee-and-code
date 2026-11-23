const VERSION = "5.3.0";
const ADMIN_DID = "did:plc:l37td5yhxl2irrzrgvei4qay";
const CONTACT_EMAIL = "atcdn@danielmorrisey.com";
const SERVICE_NAME = "atCDN for Bluesky & the AT Protocol by Coffee & Code";
const PLC_DIRECTORIES = ["https://plc.eurosky.network", "https://plc.directory"];
const DID_TTL_MS = 86_400_000; // 24 hours
const NEGATIVE_TTL_S = 60;     // remember missing blobs briefly
const IMG_CACHE_VERSION = "imgproxy-v3";
const PDS_TIMEOUT_MS = 10_000;
const PLC_TIMEOUT_MS = 5_000;
const MAX_DIM = 4000;
const PROXY_TTL_S = 86_400;
const IMGPROXY_EDGE_TTL_S = 604_800;
const MEMO_MAX = 5000;
const MEMO_TTL_MS = 3_600_000;

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
  feed_card:      { width: 360,  height: 240,  fit: "cover" },
  feed_small:     { width: 400,  height: 300,  fit: "cover" },
  feed_medium:    { width: 800,  height: 600,  fit: "cover" },
  feed_large:     { width: 1200, height: 900,  fit: "cover" },
  feed_fullsize:  { width: 2000, height: 2000, fit: "inside" },

  // 16:9 widescreen
  wide_thumb:  { width: 320,  height: 180,  fit: "cover" },
  wide_small:  { width: 640,  height: 360,  fit: "cover" },
  wide_card:   { width: 800,  height: 450,  fit: "cover" },
  wide_medium: { width: 1280, height: 720,  fit: "cover" },
  wide_large:  { width: 1920, height: 1080, fit: "cover" },
};

// /img/{type} sizes (matches the landing page table).
// *_fullsize and feed_thumbnail are not listed, so they serve the original.
const IMG_TYPES = {
  avatar_thumbnail: { width: 64,   height: 64,   fit: "cover"  },
  avatar_thumb:     { width: 128,  height: 128,  fit: "cover"  },
  avatar_small:     { width: 240,  height: 240,  fit: "cover"  },
  avatar_medium:    { width: 400,  height: 400,  fit: "cover"  },
  avatar_large:     { width: 640,  height: 640,  fit: "cover"  },
  banner_thumb:     { width: 600,  height: 200,  fit: "cover"  },
  banner_small:     { width: 900,  height: 300,  fit: "cover"  },
  banner_medium:    { width: 1200, height: 400,  fit: "cover"  },
  banner_large:     { width: 1500, height: 500,  fit: "cover"  },
  feed_thumb:       { width: 400,  height: 400,  fit: "inside" },
  feed_small:       { width: 600,  height: 600,  fit: "inside" },
  feed_medium:      { width: 800,  height: 800,  fit: "inside" },
  feed_large:       { width: 1200, height: 1200, fit: "inside" },
};

// ── Option vocabulary (query params → imgproxy processing options) ────────────

const RESIZE_TYPES = {
  inside: "fit", fit: "fit",
  crop: "fill", cover: "fill", fill: "fill",
  "fill-down": "fill-down",
  force: "force", stretch: "force",
  auto: "auto",
};
const GRAVITIES = new Set(["no", "so", "ea", "we", "noea", "nowe", "soea", "sowe", "ce", "sm"]);
const WM_POSITIONS = new Set(["no", "so", "ea", "we", "noea", "nowe", "soea", "sowe", "ce", "re"]);
const FORMATS = { webp: "webp", jpeg: "jpeg", jpg: "jpeg", png: "png", avif: "avif", gif: "gif" };
// Any of these params makes a request "active" even without a size
const ACTIVE_PARAMS = [
  "format", "quality", "blur", "sharpen", "pixelate", "rotate", "trim", "pad", "crop",
  "bg", "wm", "lqip", "dpr", "zoom", "maxbytes", "enlarge", "extend",
];

const OPTION_DOCS = {
  size: "w, h (0-4000), preset, fit=inside|crop|cover|fill|fill-down|force|auto, enlarge=1, extend=1, dpr=1-3, zoom=0.1-4",
  crop_and_gravity: "gravity=no|so|ea|we|noea|nowe|soea|sowe|ce|sm, fp=x,y (0-1), crop=w,h, trim=0-100",
  layout: "pad=n or top,right,bottom,left (0-200), rotate=90|180|270, bg=hex (for padding / transparent areas)",
  effects: "blur=0-50, sharpen=0-10, pixelate=1-100, lqip=1 (tiny blurred placeholder)",
  output: "format=webp|jpeg|png|avif|gif, quality=1-100, maxbytes=1000-5000000",
  metadata: "keep_meta=1 (keep EXIF), copyright=1 (keep copyright tags), profile=keep (keep colour profile)",
  watermark: "wm=0-1 (opacity), wm_pos=no|so|ea|we|noea|nowe|soea|sowe|ce|re, wm_scale=0-1 (needs watermark enabled)",
  download: "download=1, filename=name",
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
        <p>Image proxy: <span id="imgproxy-status">-</span></p>
        <p>AVIF output: <span id="avif-status">-</span> | Watermark: <span id="wm-status">-</span></p>
        <p id="db-stats"></p>
    </div>
    <hr>

    <h2>Image Proxy</h2>
    <p>
        Images are resized on the fly by <a href="https://imgproxy.net" target="_blank" rel="noopener">imgproxy</a>
        and cached at the edge. Original blobs are never modified.
    </p>
    <ul>
        <li><b>Output format:</b> WebP when your browser sends <code>Accept: image/webp</code>, otherwise JPEG (override with <code>format=</code>)</li>
        <li><b>Max size:</b> 4000px on either side (including dpr and zoom)</li>
        <li><b>Privacy:</b> EXIF and other metadata are stripped unless <code>keep_meta=1</code></li>
        <li><b>Fallback:</b> if the image proxy is down, Bluesky/AT Protocol URLs serve the original blob (header <code>X-Imgproxy-Fallback</code>)</li>
        <li><b>Generic proxy:</b> <code>/imgproxy/</code> resizes any public http(s) image; a size or at least one option is required</li>
        <li><b>Debug:</b> the <code>X-Imgproxy-Opts</code> response header shows exactly what was applied</li>
    </ul>

    <h3>Options (query params on /blob/ and /imgproxy/)</h3>
    <table border="1" cellpadding="4" cellspacing="0">
        <tr><th>Group</th><th>Params</th></tr>
        <tr><td>Size</td><td><code>w</code>, <code>h</code> (0-4000), <code>preset</code>, <code>fit</code>=inside|crop|cover|fill|fill-down|force|auto, <code>enlarge</code>=1, <code>extend</code>=1, <code>dpr</code>=1-3, <code>zoom</code>=0.1-4</td></tr>
        <tr><td>Crop</td><td><code>gravity</code>=no|so|ea|we|noea|nowe|soea|sowe|ce|sm, <code>fp</code>=x,y (0-1), <code>crop</code>=w,h, <code>trim</code>=0-100</td></tr>
        <tr><td>Layout</td><td><code>pad</code>=n or t,r,b,l (0-200), <code>rotate</code>=90|180|270, <code>bg</code>=hex</td></tr>
        <tr><td>Effects</td><td><code>blur</code>=0-50, <code>sharpen</code>=0-10, <code>pixelate</code>=1-100, <code>lqip</code>=1 (tiny blurred placeholder)</td></tr>
        <tr><td>Output</td><td><code>format</code>=webp|jpeg|png|avif|gif, <code>quality</code>=1-100, <code>maxbytes</code>=1000-5000000</td></tr>
        <tr><td>Metadata</td><td><code>keep_meta</code>=1, <code>copyright</code>=1, <code>profile</code>=keep</td></tr>
        <tr><td>Watermark</td><td><code>wm</code>=0-1 (opacity), <code>wm_pos</code>, <code>wm_scale</code>=0-1</td></tr>
        <tr><td>Download</td><td><code>download</code>=1, <code>filename</code>=name</td></tr>
    </table>
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
            <option value="avatar_fullsize">avatar_fullsize (original size)</option>
            <option value="banner_thumb">banner_thumb (600x200)</option>
            <option value="banner_small">banner_small (900x300)</option>
            <option value="banner_medium">banner_medium (1200x400)</option>
            <option value="banner_large">banner_large (1500x500)</option>
            <option value="banner_fullsize">banner_fullsize (original size)</option>
            <option value="feed_thumbnail">feed_thumbnail (original size)</option>
            <option value="feed_thumb">feed_thumb (400x400)</option>
            <option value="feed_small">feed_small (600x600)</option>
            <option value="feed_medium">feed_medium (800x800)</option>
            <option value="feed_large">feed_large (1200x1200)</option>
            <option value="feed_fullsize" selected>feed_fullsize (original size)</option>
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
        Or params: <input type="text" id="blob-params" placeholder="w=256&h=256&fit=crop" size="30"><br>
        Extra options: <input type="text" id="blob-extra" placeholder="format=avif&blur=5&rotate=90" size="40">
    </p>
    <p>
        <button onclick="genBlob()">Generate URL</button>
        <button onclick="loadBlob()">Load Image</button>
        <button onclick="openBlob()">Open</button>
    </p>
    <p>URL: <code id="blob-url"></code></p>
    <p><img id="blob-preview" style="max-width:500px"></p>

    <hr>

    <h3>/imgproxy/ format (any public image)</h3>
    <p>
        Image URL: <input type="text" id="proxy-src" size="60" value="https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png"><br>
        Width: <input type="number" id="proxy-w" value="300" min="1" max="4000" style="width:80px">
        Height: <input type="number" id="proxy-h" value="" min="1" max="4000" style="width:80px" placeholder="auto">
        Fit:
        <select id="proxy-fit">
            <option value="inside" selected>inside (keep whole image)</option>
            <option value="crop">crop (fill the box)</option>
            <option value="fill-down">fill-down</option>
            <option value="force">force (stretch)</option>
            <option value="auto">auto</option>
        </select><br>
        Extra options: <input type="text" id="proxy-extra" placeholder="format=webp&quality=80&bg=ffffff&pad=10" size="40">
    </p>
    <p>
        <button onclick="genProxy()">Generate URL</button>
        <button onclick="loadProxy()">Load Image</button>
        <button onclick="openProxy()">Open</button>
    </p>
    <p>URL: <code id="proxy-url"></code></p>
    <p><img id="proxy-preview" style="max-width:500px"></p>

    <hr>

    <h2>Endpoints</h2>
    <ul>
        <li><code>GET /img/{type}/plain/{did}/{cid}[@ext]</code> - Bluesky social-app format</li>
        <li><code>GET /blob/{did}/{cid}[@ext]/{preset}</code> - Generic AT Protocol format</li>
        <li><code>GET /blob/{did}/{cid}?w=256&h=256&fit=crop&format=avif</code> - Resize and convert via query params</li>
        <li><code>GET /imgproxy/?url=https://...&w=400&h=300&fit=crop</code> - Resize any public image</li>
        <li><code>GET /presets</code> - List all presets and options</li>
        <li><code>GET /xrpc/_health</code> - Health check</li>
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

                // Image proxy status
                const ip = data.imgproxy;
                document.getElementById("imgproxy-status").textContent = !ip.configured
                    ? "Not configured (serving originals)"
                    : ip.ok ? "OK (" + ip.status + ")" : "DOWN (" + ip.status + ") - serving originals";
                document.getElementById("imgproxy-status").style.color = !ip.configured ? "" : ip.ok ? "green" : "red";
                document.getElementById("avif-status").textContent = data.features.avif_auto ? "auto (when browser accepts)" : "on request (format=avif)";
                document.getElementById("wm-status").textContent = data.features.watermark ? "Enabled" : "Disabled";

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
            const proxyExample = encodeURIComponent("https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png");
            const examples = document.getElementById("examples");
            examples.innerHTML = \`
                <li><a href="/img/avatar/plain/did:plc:l37td5yhxl2irrzrgvei4qay/bafkreibayz5nsqibyixagmx4afqd45fg2ab6ehcav5m26u4eejom2kvydq@webp" target="_blank">Avatar (cdn.bsky.app format)</a></li>
                <li><a href="/blob/\${encodedDid}/\${exampleCid}@jpeg/avatar_medium" target="_blank">Blob with preset</a></li>
                <li><a href="/blob/\${encodedDid}/\${exampleCid}?w=256&h=256&fit=crop" target="_blank">Blob with query params</a></li>
                <li><a href="/blob/\${encodedDid}/\${exampleCid}?lqip=1" target="_blank">Blob blur placeholder (lqip)</a></li>
                <li><a href="/blob/\${encodedDid}/\${exampleCid}?w=400&format=png&bg=ffffff&pad=20" target="_blank">Blob padded PNG</a></li>
                <li><a href="/imgproxy/?url=\${proxyExample}&w=300" target="_blank">Image proxy (any public image)</a></li>
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
            const extra = document.getElementById("blob-extra").value.trim().replace(/^[?&]/, "");
            let url = base + "/blob/" + did + "/" + cid;
            if (preset) url += "/" + preset;
            const query = [params, extra].filter(Boolean).join("&");
            if (query) url += "?" + query;
            document.getElementById("blob-url").textContent = url;
            return url;
        }

        function loadBlob() {
            document.getElementById("blob-preview").src = genBlob();
        }

        function openBlob() {
            window.open(genBlob(), "_blank");
        }

        function genProxy() {
            const src = document.getElementById("proxy-src").value.trim();
            const w = document.getElementById("proxy-w").value.trim();
            const h = document.getElementById("proxy-h").value.trim();
            const fit = document.getElementById("proxy-fit").value;
            const extra = document.getElementById("proxy-extra").value.trim().replace(/^[?&]/, "");
            let url = base + "/imgproxy/?url=" + encodeURIComponent(src);
            if (w) url += "&w=" + encodeURIComponent(w);
            if (h) url += "&h=" + encodeURIComponent(h);
            url += "&fit=" + fit;
            if (extra) url += "&" + extra;
            document.getElementById("proxy-url").textContent = url;
            return url;
        }

        function loadProxy() {
            document.getElementById("proxy-preview").src = genProxy();
        }

        function openProxy() {
            window.open(genProxy(), "_blank");
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
          generic_proxy: "/imgproxy/?url=https://example.com/a.jpg&w=400&h=300&fit=crop",
          note: "Resized by imgproxy. WebP when the client sends Accept: image/webp, otherwise JPEG. Unknown presets serve the original.",
          options: OPTION_DOCS,
          presets: PRESETS,
        });
      case "/clear": {
        if (env.CLEAR_TOKEN) {
          const supplied = url.searchParams.get("token") || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
          if (supplied !== env.CLEAR_TOKEN) return json({ error: "unauthorized" }, 401);
        }
        memo.clear();
        if (!d1) return json({ cleared: 0, message: "D1 cache is disabled" });
        const { meta } = await env.DB.prepare("DELETE FROM did_cache").run();
        return json({ cleared: meta.changes });
      }
      case "/imgproxy":
      case "/imgproxy/":
        return handleProxy(request, env, ctx, url);
    }

    const route = parseRoute(url);
    if (!route) return new Response("Not Found", { status: 404 });
    if (!DID_RE.test(route.did)) return new Response("Invalid DID", { status: 400 });
    if (!CID_RE.test(route.cid)) return new Response("Invalid CID", { status: 400 });

    // Work out which imgproxy options (if any) apply to this request
    route.opt = null;
    route.download = route.format === "blob" ? downloadName(url.searchParams) : null;
    if (imgproxyReady(env)) {
      const base = route.format === "img"
        ? IMG_TYPES[route.type] ?? null
        : route.preset && PRESETS[route.preset] ? PRESETS[route.preset] : null;
      const o = buildOptions(env, request, url.searchParams, base, route.format === "img");
      if (o.active) route.opt = o;
    }

    const cache = caches.default;
    const cacheKey = makeCacheKey(url, route.opt);
    const cached = await cache.match(cacheKey);
    if (cached) {
      const age = Date.now() - Date.parse(cached.headers.get("X-Cached-At") || 0);
      if (cached.status === 200 && !(age < DID_TTL_MS)) {
        ctx.waitUntil(refresh(env, ctx, route, cache, cacheKey, d1));
      }
      return cached;
    }

    try {
      const res = await fetchBlob(env, ctx, route, d1);

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
      if (!route.fellBack) ctx.waitUntil(cache.put(cacheKey, out.clone())); // never cache a degraded response
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

// ── imgproxy options ──────────────────────────────────────────────────────────

function imgproxyReady(env) {
  return !!(env.IMGPROXY_URL && env.IMGPROXY_KEY && env.IMGPROXY_SALT);
}

function num(v, min, max, int = false) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const c = Math.min(max, Math.max(min, n));
  return int ? Math.round(c) : Math.round(c * 100) / 100;
}

function downloadName(q) {
  if (q.get("download") !== "1") return null;
  const n = (q.get("filename") || "image").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  return n || "image";
}

// Builds a validated imgproxy option list.
// base = { width, height, fit } from a preset/type, or null. lock = ignore query params (the /img/ routes).
function buildOptions(env, request, q, base, lock) {
  const accept = request.headers.get("Accept") || "";
  const get = (k) => (lock ? null : q.get(k));

  // Output format: explicit, else AVIF (only if enabled), else WebP, else JPEG
  let fmt = FORMATS[(get("format") || "").toLowerCase()];
  if (!fmt) {
    fmt = env.IMGPROXY_AVIF === "true" && accept.includes("image/avif") ? "avif"
        : accept.includes("image/webp") ? "webp"
        : "jpeg";
  }

  // Tiny blurred placeholder
  if (get("lqip") === "1") {
    const opts = ["rt:fit", "s:24:0", "bl:4", "q:40", "sm:1", `f:${fmt === "avif" ? "webp" : fmt}`];
    return { opts, key: opts.join("/"), hasSize: true, active: true };
  }

  // Size
  let width = base?.width ?? 0;
  let height = base?.height ?? 0;
  let rt = base?.fit === "cover" ? "fill" : "fit";
  const w = num(get("w"), 0, MAX_DIM, true);
  const h = num(get("h"), 0, MAX_DIM, true);
  if (w !== null) width = w;
  if (h !== null) height = h;
  const fitParam = (get("fit") || "").toLowerCase();
  if (RESIZE_TYPES[fitParam]) rt = RESIZE_TYPES[fitParam];

  const dpr = num(get("dpr"), 1, 3);
  const zoom = num(get("zoom"), 0.1, 4);
  const mult = Math.max((dpr ?? 1) * (zoom ?? 1), 1);
  const maxSide = Math.max(1, Math.floor(MAX_DIM / mult));
  width = Math.min(width, maxSide);
  height = Math.min(height, maxSide);
  const hasSize = width > 0 || height > 0;

  const opts = [];
  if (hasSize) {
    opts.push(`rt:${rt}`, `s:${width}:${height}`);
    if (get("enlarge") === "1") opts.push("el:1");
    if (get("extend") === "1") opts.push("ex:1:ce");
  }
  if (dpr !== null) opts.push(`dpr:${dpr}`);
  if (zoom !== null) opts.push(`z:${zoom}`);

  // Gravity (center crop is the default for fill modes; sm/others via ?gravity=)
  const gParam = (get("gravity") || "").toLowerCase();
  const fp = (get("fp") || "").split(",").map(Number);
  let gravity = null;
  if (fp.length === 2 && fp.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) gravity = `fp:${fp[0]}:${fp[1]}`;
  else if (GRAVITIES.has(gParam)) gravity = gParam;
  else if (hasSize && (rt === "fill" || rt === "fill-down")) gravity = "ce";
  if (gravity) opts.push(`g:${gravity}`);

  // Pre-crop, trim, padding, rotation, background
  const crop = (get("crop") || "").split(",").map(Number);
  if (crop.length === 2 && crop.every((n) => Number.isFinite(n) && n >= 1 && n <= MAX_DIM)) {
    opts.push(`c:${Math.round(crop[0])}:${Math.round(crop[1])}`);
  }
  const trim = num(get("trim"), 0, 100);
  if (trim !== null) opts.push(`t:${trim}`);

  const pad = (get("pad") || "").split(",").map((v) => num(v, 0, 200, true));
  if (pad.length === 1 && pad[0] !== null) opts.push(`pd:${pad[0]}`);
  else if (pad.length === 4 && pad.every((v) => v !== null)) opts.push(`pd:${pad.join(":")}`);

  const rot = num(get("rotate"), 0, 270, true);
  if (rot === 90 || rot === 180 || rot === 270) opts.push(`rot:${rot}`);

  const bg = (get("bg") || "").replace(/^#/, "");
  if (/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(bg)) opts.push(`bg:${bg.toLowerCase()}`);

  // Effects
  const blur = num(get("blur"), 0, 50);
  if (blur) opts.push(`bl:${blur}`);
  const sharpen = num(get("sharpen"), 0, 10);
  if (sharpen) opts.push(`sh:${sharpen}`);
  const pix = num(get("pixelate"), 1, 100, true);
  if (pix !== null) opts.push(`pix:${pix}`);

  // Watermark (needs IMGPROXY_WATERMARK_PATH on imgproxy and WATERMARK_ENABLED=true here)
  if (env.WATERMARK_ENABLED === "false") {
    const opacity = num(get("wm"), 0, 1);
    if (opacity) {
      const pos = (get("wm_pos") || "soea").toLowerCase();
      const scale = num(get("wm_scale"), 0, 1);
      opts.push(`wm:${opacity}:${WM_POSITIONS.has(pos) ? pos : "soea"}:10:10${scale ? ":" + scale : ""}`);
    }
  }

  // Output + metadata
  const quality = num(get("quality"), 1, 100, true);
  if (quality !== null) opts.push(`q:${quality}`);
  const maxBytes = num(get("maxbytes"), 1000, 5_000_000, true);
  if (maxBytes !== null) opts.push(`mb:${maxBytes}`);

  opts.push(get("keep_meta") === "1" ? "sm:0" : "sm:1");
  if (get("copyright") === "1") opts.push("kcr:1");
  if (get("profile") === "keep") opts.push("scp:0");
  opts.push(`f:${fmt}`);

  const active = hasSize || (!lock && ACTIVE_PARAMS.some((k) => q.has(k)));
  return { opts, key: opts.join("/"), hasSize, active };
}

const hex = (s) => Uint8Array.from(s.match(/../g), (h) => parseInt(h, 16));
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function imgproxyUrl(env, sourceUrl, opts) {
  const path = `/${opts.join("/")}/plain/${encodeURIComponent(sourceUrl)}`;

  const key = await crypto.subtle.importKey(
    "raw", hex(env.IMGPROXY_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const salt = hex(env.IMGPROXY_SALT);
  const pathBytes = new TextEncoder().encode(path);
  const data = new Uint8Array(salt.length + pathBytes.length);
  data.set(salt);
  data.set(pathBytes, salt.length);
  const sig = b64url(await crypto.subtle.sign("HMAC", key, data));

  return `${env.IMGPROXY_URL.replace(/\/$/, "")}/${sig}${path}`;
}

async function imgproxyFetch(env, target, opts) {
  return fetch(await imgproxyUrl(env, target, opts), {
    headers: env.IMGPROXY_SECRET ? { Authorization: `Bearer ${env.IMGPROXY_SECRET}` } : {},
    cf: { cacheEverything: true, cacheTtl: IMGPROXY_EDGE_TTL_S },
    signal: AbortSignal.timeout(PDS_TIMEOUT_MS + 5_000),
  });
}

// Cache key from the final options, so extra/random query params can't fragment the cache
function makeCacheKey(url, opt, extra = {}) {
  const k = new URL(url.origin + url.pathname);
  k.searchParams.set("__cache", IMG_CACHE_VERSION);
  k.searchParams.set("__o", opt ? opt.key : "orig");
  for (const [a, b] of Object.entries(extra)) k.searchParams.set(a, b);
  return new Request(k, { method: "GET" });
}

// Fetch the blob via imgproxy when options apply; fall back to the original if imgproxy fails.
async function fetchSource(env, blobUrl, route) {
  if (route.opt) {
    try {
      const res = await imgproxyFetch(env, blobUrl, route.opt.opts);
      if (res.ok || res.status === 404) return res; // 404 keeps the stale avatar/banner retry working
      res.body?.cancel();
    } catch {}
    route.fellBack = true; // serve the original, don't cache it, and say so in a header
  }
  return pdsFetch(blobUrl);
}

// ── Generic image proxy: /imgproxy/?url=...&w=...&h=...&fit=crop ──────────────

function hostAllowed(env, hostname) {
  const list = (env.PROXY_ALLOWED_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true; // no allowlist set: any public host
  return list.some((p) => (p.startsWith("*.") ? hostname.endsWith(p.slice(1)) : hostname === p));
}

function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // IPv4 literal
  if (h.includes(":") || h.startsWith("[")) return true; // IPv6 literal
  return !h.includes("."); // single-label hostnames
}

async function handleProxy(request, env, ctx, url) {
  if (!imgproxyReady(env)) return new Response("Image proxy not configured", { status: 503 });

  const target = url.searchParams.get("url");
  if (!target) return new Response("Missing url parameter", { status: 400 });

  let src;
  try { src = new URL(target); } catch { return new Response("Invalid url", { status: 400 }); }
  if (src.protocol !== "https:" && src.protocol !== "http:") return new Response("Invalid url scheme", { status: 400 });
  if (src.username || src.password) return new Response("Invalid url", { status: 400 });
  if (isBlockedHost(src.hostname)) return new Response("Host not allowed", { status: 403 });
  if (!hostAllowed(env, src.hostname.toLowerCase())) return new Response("Host not allowed", { status: 403 });

  const presetName = url.searchParams.get("preset");
  const base = presetName && PRESETS[presetName] ? PRESETS[presetName] : null;
  const opt = buildOptions(env, request, url.searchParams, base, false);
  if (!opt.active) return new Response("Specify a size (w/h/preset) or at least one option", { status: 400 });

  const cache = caches.default;
  const cacheKey = makeCacheKey(url, opt, { url: src.toString() });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const res = await imgproxyFetch(env, src.toString(), opt.opts);

    if (!res.ok) {
      res.body?.cancel();
      const code = res.status >= 500 ? 502 : 404;
      const err = new Response(code === 404 ? "Image Not Found" : "Bad Gateway", {
        status: code,
        headers: { "Cache-Control": `public, max-age=${NEGATIVE_TTL_S}` },
      });
      if (code === 404) ctx.waitUntil(cache.put(cacheKey, err.clone()));
      return err;
    }

    const headers = new Headers({
      "Content-Type": res.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": `public, max-age=${PROXY_TTL_S}`,
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "X-Cached-At": new Date().toUTCString(),
      "X-Format": "proxy",
      "X-Imgproxy-Opts": opt.key,
      "Vary": "Accept",
    });
    const name = downloadName(url.searchParams);
    if (name) headers.set("Content-Disposition", `attachment; filename="${name}"`);

    const out = new Response(res.body, { status: 200, headers });
    ctx.waitUntil(cache.put(cacheKey, out.clone()));
    return out;
  } catch (err) {
    const timeout = err?.name === "TimeoutError";
    return new Response(timeout ? "Gateway Timeout" : "Bad Gateway", { status: timeout ? 504 : 502 });
  }
}

// ── Origin fetch ──────────────────────────────────────────────────────────────

// Returns a Response from imgproxy/the PDS, or null if the DID can't be resolved.
async function fetchBlob(env, ctx, route, d1) {
  const { did, cid, format, type } = route;
  const pds = await resolvePds(env, ctx, did, d1);
  if (!pds) return null;

  const blobUrl = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${cid}`;
  let res = await fetchSource(env, blobUrl, route);

  // Avatar/banner CIDs go stale when a profile changes: retry with the current one
  const field = type?.startsWith("avatar") ? "avatar" : type?.startsWith("banner") ? "banner" : null;
  if ((res.status === 404 || res.status === 400) && format === "img" && field) {
    res.body?.cancel();
    const current = await currentProfileCid(pds, did, field);
    if (current && current !== cid) {
      res = await fetchSource(
        env,
        `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${current}`,
        route
      );
    }
  }
  return res;
}

async function refresh(env, ctx, route, cache, cacheKey, d1) {
  try {
    route.fellBack = false;
    const res = await fetchBlob(env, ctx, route, d1);
    if (res?.ok && !route.fellBack) await cache.put(cacheKey, buildResponse(res, route));
    else res?.body?.cancel(); // keep the existing copy
  } catch {}
}

function pdsFetch(url) {
  return fetch(url, { signal: AbortSignal.timeout(PDS_TIMEOUT_MS) });
}

async function currentProfileCid(pds, did, field) {
  const res = await pdsFetch(
    `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=app.bsky.actor.profile&rkey=self`
  );
  if (!res.ok) { res.body?.cancel(); return null; }
  return (await res.json()).value?.[field]?.ref?.$link ?? null;
}

function buildResponse(source, route) {
  let cacheControl = route.format === "img"
    ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"
    : "public, max-age=31536000, immutable";
  if (route.fellBack) cacheControl = "public, max-age=60"; // degraded response, don't keep it
  const headers = new Headers({
    "Content-Type": source.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": cacheControl,
    "Content-Disposition": "inline",
    "Content-Security-Policy": "default-src 'none'; sandbox", // blobs are user-controlled
    "X-Content-Type-Options": "nosniff",
    "X-Cached-At": new Date().toUTCString(),
    "X-Format": route.format,
  });
  if (route.opt) {
    headers.set("Vary", "Accept");
    headers.set("X-Imgproxy-Opts", route.opt.key);
  }
  if (route.fellBack) headers.set("X-Imgproxy-Fallback", "1");
  if (route.download) headers.set("Content-Disposition", `attachment; filename="${route.download}"`);
  for (const h of ["etag", "last-modified"]) {
    const v = source.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(source.body, { status: 200, headers });
}

// ── DID → PDS (memory → D1 → PLC in parallel) ─────────────────────────────────

const memo = new Map();

async function fetchPdsFrom(src) {
  const res = await fetch(src, {
    cf: { cacheTtl: 3600, cacheEverything: true },
    signal: AbortSignal.timeout(PLC_TIMEOUT_MS),
  });
  if (!res.ok) { res.body?.cancel(); throw new Error("not ok"); }
  const pds = extractPds(await res.json());
  if (!pds) throw new Error("no pds");
  return pds;
}

async function resolvePds(env, ctx, did, d1) {
  const hit = memo.get(did);
  if (hit && Date.now() - hit.t < MEMO_TTL_MS) return hit.pds;

  const remember = (pds) => {
    if (memo.size >= MEMO_MAX) memo.clear();
    memo.set(did, { pds, t: Date.now() });
    return pds;
  };

  if (d1) {
    const row = await env.DB.prepare("SELECT pds_url, cached_at FROM did_cache WHERE did = ?").bind(did).first();
    if (row && Date.now() - row.cached_at < DID_TTL_MS) return remember(row.pds_url);
  }

  const sources = did.startsWith("did:web:") ? [didWebUrl(did)] : PLC_DIRECTORIES.map((dir) => `${dir}/${did}`);
  const pds = await Promise.any(sources.map(fetchPdsFrom)).catch(() => null);
  if (!pds) return null;

  if (d1) {
    ctx.waitUntil(
      env.DB.prepare(
        `INSERT INTO did_cache (did, pds_url, cached_at) VALUES (?, ?, ?)
         ON CONFLICT(did) DO UPDATE SET pds_url = excluded.pds_url, cached_at = excluded.cached_at`
      ).bind(did, pds, Date.now()).run().catch(() => {})
    );
  }
  return remember(pds);
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

// ── Routing ───────────────────────────────────────────────────────────────────

function parseRoute(url) {
  const img = url.pathname.match(IMG_PATH_RE);
  if (img) {
    return { format: "img", type: img[1], did: decodeDid(img[2]), cid: img[3] };
  }

  const blob = url.pathname.match(BLOB_PATH_RE);
  if (blob) {
    return { format: "blob", type: null, did: decodeDid(blob[1]), cid: blob[2], preset: blob[3] || null };
  }
  return null;
}

function decodeDid(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// ── Health ────────────────────────────────────────────────────────────────────

async function health(env, d1) {
  const [plc, db, imgproxy] = await Promise.all([
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
    (async () => {
      if (!imgproxyReady(env)) return { configured: false, ok: false, status: 0 };
      try {
        const res = await fetch(`${env.IMGPROXY_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(PLC_TIMEOUT_MS) });
        res.body?.cancel();
        return { configured: true, ok: res.ok, status: res.status };
      } catch {
        return { configured: true, ok: false, status: 0 };
      }
    })(),
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
    imgproxy,
    features: {
      img_format: "/img/{type}/plain/{did}/{cid}[@ext]",
      blob_format: "/blob/{did}/{cid}[@ext]/{params}",
      generic_proxy: "/imgproxy/?url=...&w=...&h=...",
      presets_endpoint: "/presets",
      clear_endpoint: "/clear",
      avif_auto: env.IMGPROXY_AVIF === "true",
      watermark: env.WATERMARK_ENABLED === "true",
      options: OPTION_DOCS,
    },
    plc_health: plc,
    db,
  });
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}