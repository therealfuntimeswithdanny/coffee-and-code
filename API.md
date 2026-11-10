# Coffee & Code API

The read-only API is served by the same Cloudflare Worker as the website. All endpoints are public and return JSON unless noted otherwise.

## `GET /api/home`

Returns publication metadata and the story groups shown on the homepage:

```json
{
  "publication": {
    "name": "Coffee and Code",
    "description": "..."
  },
  "totalAvailable": 42,
  "hero": {
    "uri": "at://...",
    "title": "...",
    "description": "...",
    "publishedAt": "...",
    "path": "/author/example.com/...",
    "cover": "https://...",
    "tags": [],
    "author": {
      "did": "did:...",
      "handle": "example.com",
      "displayName": "...",
      "avatar": "https://..."
    },
    "markdownUrl": "https://.../api/documents/..."
  },
  "latest": [],
  "pinned": [],
  "more": [],
  "authors": [
    {
      "did": "did:...",
      "handle": "example.com",
      "displayName": "...",
      "avatar": "https://...",
      "storyCount": 3
    }
  ]
}
```

Each story is a metadata object with a `markdownUrl` for its full content. `hero` is `null` when the publication has no stories. The story arrays use the same grouping and ordering as the homepage. `authors` lists authors of stories shown in those groups.

## `GET /api/documents`

Returns document metadata, ordered newest first:

```json
{
  "documents": [],
  "totalAvailable": 42,
  "limit": 20
}
```

Use the optional `limit` query parameter to request between 1 and 100 entries; it defaults to 20. Each document metadata object includes a `markdownUrl`.

## `GET /api/documents/:rkey`

Returns a document’s metadata and its full content in Markdown:

```json
{
  "uri": "at://...",
  "title": "...",
  "markdownUrl": "https://.../api/documents/...",
  "content": "# Document title\n\nDocument content...",
  "format": "markdown"
}
```

If multiple documents share a record key, include `?uri=<AT-URI>` to identify the document.

## `GET /api/documents/:rkey.md`

Returns the document as a `text/markdown` response. This endpoint also accepts `?uri=<AT-URI>` when a record key is ambiguous.

Markdown documents are returned as Markdown; supported non-Markdown document formats are rendered and converted to Markdown. The response starts with the document title and includes its description when present.

## Errors

Invalid `limit` values return `400`; a missing document returns `404`; an ambiguous record key returns `409`; and an unavailable publication returns `503`. Error responses have the shape `{ "error": "..." }`.
