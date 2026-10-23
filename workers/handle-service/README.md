# Coffee & Code handle service

This is a separate Cloudflare Worker for custom `*.coffeencode.cc` AT Protocol handles. The full Worker is in the single deployable file `worker.js`.

## Routes

- `GET https://{handle}.coffeencode.cc/.well-known/atproto-did` returns the verified DID as plain text.
- `POST https://handles.coffeencode.cc/claim/challenge` with `{ "did": "did:plc:…", "handle": "name" }` creates a ten-minute one-time challenge.
- The account owner writes a `cc.coffeencode.handle.claim` record to their PDS containing that handle and nonce.
- `POST https://handles.coffeencode.cc/claim` with `{ "did", "handle", "challengeId", "recordUri" }` verifies the public record on the Coffee & Code PDS and then saves the handle-to-DID mapping in KV.

The proof record means a caller cannot reserve a handle just by putting somebody else's DID in a request. Keep the proof record in the account repository; it is public and is useful as an audit trail. The app needs the `repo:cc.coffeencode.handle.claim?action=create` OAuth permission to write it.

## Setup

1. Create a KV namespace named `COFFEECODE_HANDLES` and replace the placeholder `id` in `wrangler.toml` with the returned namespace ID.
2. Deploy this Worker. The Worker routes include the wildcard DID lookup and the `handles.coffeencode.cc` claim API.
3. Ensure the `*.coffeencode.cc` DNS wildcard points at Cloudflare and that the wildcard route is available in the zone. Keep the existing PDS hostname route for `account.coffeencode.cc`.
4. The proof lexicon and OAuth scope are included in the main project. The website still needs a claim form wired to the two claim endpoints to offer self-service claims.

KV is eventually consistent and does not provide an atomic unique-key transaction. This is intended for a small, invite-based handle service; use a Durable Object or a database with unique constraints if concurrent claims become a concern.
