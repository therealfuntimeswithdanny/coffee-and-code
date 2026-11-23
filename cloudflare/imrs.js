export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    let originalUrl = url.searchParams.get("url");

    if (!originalUrl) {
      if (url.hostname.startsWith("imrs.") || url.hostname.startsWith("cdn.")) {
        originalUrl = url.pathname.slice(1); // Remove leading /
      } else {
        originalUrl = url.pathname.replace(/^\/imrs\/?/, "");
      }

      // Decode percent-encoded target URLs (e.g. http%3A%2F%2F...)
      try {
        originalUrl = decodeURIComponent(originalUrl);
      } catch (e) {
        // leave as-is if it's not validly encoded
      }
    }

    if (!originalUrl || !originalUrl.startsWith("http")) {
      return new Response(
        JSON.stringify({ error: "Provide an image URL via ?url= or /imrs/https://..." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const typeParam = url.searchParams.get("type")?.toLowerCase();
    const format = typeParam === "webp" ? "webp" : "avif";
    const contentType = format === "webp" ? "image/webp" : "image/avif";

    try {
      const imageRequest = new Request(originalUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
        cf: {
          image: {
            format: format,
            quality: 95,
            fit: "scale-down",
          },
        },
      });

      const imageResponse = await fetch(imageRequest);

      if (!imageResponse.ok) {
        throw new Error(`Fetch failed: ${imageResponse.status}`);
      }

      const headers = new Headers(imageResponse.headers);
      headers.set("Content-Type", contentType);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Access-Control-Allow-Origin", "*");

      return new Response(imageResponse.body, {
        status: imageResponse.status,
        headers: headers,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};