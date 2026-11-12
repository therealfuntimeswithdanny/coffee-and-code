# Coffee & Code notification intake

This is the Linux service for `/notfiaction-intake` (path kept as requested). It maintains a local SQLite index from Jetstream and exposes a small loopback-only JSON API for the Cloudflare Worker. It does not open a public port. Cloudflare Tunnel and an Access Service Auth policy publish/protect the API hostname.

## What it indexes

- `cc.coffeencode.author.follow`
- `cc.coffeencode.comment`
- `cc.coffeencode.comment.like`
- `cc.coffeencode.forum.vote`
- `cc.coffeencode.interact.like`
- `cc.coffeencode.interact.dislike`

Current records are upserted by their AT URI. Each source URI creates at most one notification. Deletes remove that record's notification. The service persists Jetstream's `time_us` cursor in the same SQLite database and reconnects with a five-second replay overlap, so duplicate delivery is safe. Malformed JSON is logged/skipped; a valid event with an unsupported shape still advances the cursor.

Notifications currently target the repo DID in the subject AT URI. For replies, comment notifications target the DID of the parent comment. `author.follow` expects `record.subject` to be a DID; that collection has no Lexicon in this repo, so confirm its record shape before relying on follow notifications. The API's `recipient` parameter is a trusted Worker-side identity: the Worker must authenticate the app user and pass that authenticated DID. Do not expose this service directly to clients or accept a client-selected DID through the Worker.

## Install on Linux

The service uses Python 3.10+ and `websockets` (installed into its virtual environment).

1. Copy this directory onto the Linux PC at `/notfiaction-intake`.
2. Install Python and venv support (`python3`, `python3-venv` on Debian/Ubuntu).
3. Create a dedicated account and install dependencies:

   ```sh
   sudo useradd --system --home /var/lib/notification-intake --shell /usr/sbin/nologin notification-intake
   sudo mkdir -p /notfiaction-intake /var/lib/notification-intake
   sudo chown -R notification-intake:notification-intake /notfiaction-intake /var/lib/notification-intake
   sudo -u notification-intake python3 -m venv /notfiaction-intake/.venv
   sudo -u notification-intake /notfiaction-intake/.venv/bin/pip install -r /notfiaction-intake/requirements.txt
   ```

4. Create `/etc/notification-intake.env` (mode `0600`, root-owned) with `DATABASE_PATH=/var/lib/notification-intake/notifications.sqlite3`, `HOST=127.0.0.1`, `PORT=8787`, and the Cloudflare Access service token's `ACCESS_CLIENT_ID` and `ACCESS_CLIENT_SECRET`.
5. Install the unit and start it:

   ```sh
   sudo install -m 0644 /notfiaction-intake/notification-intake.service /etc/systemd/system/notification-intake.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now notification-intake
   sudo systemctl status notification-intake
   sudo journalctl -u notification-intake -f
   ```

If copying this repository directory is inconvenient, copy the contents of `notification-intake/` into `/notfiaction-intake` and follow the same steps.

## Cloudflare Tunnel and Access

In Cloudflare Zero Trust, create a remotely managed Tunnel on the Linux PC and publish a hostname such as `notification-intake.coffeencode.cc` to `http://localhost:8787`. Add a self-hosted Access application for that hostname with a **Service Auth** policy for a Service Token. Put that token in `/etc/notification-intake.env` as above. Keep the Tunnel connector running as a systemd service using Cloudflare's supported `cloudflared service install` flow.

Configure the same Access Service Token as Worker secrets (for example, `NOTIFICATION_ACCESS_CLIENT_ID` and `NOTIFICATION_ACCESS_CLIENT_SECRET`) so the Worker can call the intake API. The Worker should proxy user reads only after it has independently established the user's identity. Access service auth authenticates the Worker-to-PC connection; it does not authenticate the end user.

## Local checks

```sh
curl http://127.0.0.1:8787/health
curl -H 'CF-Access-Client-Id: …' -H 'CF-Access-Client-Secret: …' \
  'http://127.0.0.1:8787/v1/notifications?recipient=did%3Aplc%3Aexample&limit=20'
```

Check the log for `Connected to Jetstream`, and confirm new events are stored in `/var/lib/notification-intake/notifications.sqlite3`. Back up this database regularly. This is the initial intake/index service; Worker proxy routes and the mobile notifications screen remain separate integration work.
