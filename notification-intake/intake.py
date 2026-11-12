#!/usr/bin/env python3
"""Coffee & Code Jetstream activity index and private HTTP API."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import websockets

LOG = logging.getLogger("notification-intake")
COLLECTIONS = (
    "cc.coffeencode.author.follow",
    "cc.coffeencode.comment",
    "cc.coffeencode.comment.like",
    "cc.coffeencode.forum.vote",
    "cc.coffeencode.interact.like",
    "cc.coffeencode.interact.dislike",
)
DID_RE = re.compile(r"^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$")
AT_URI_RE = re.compile(r"^at://(did:[^/]+)/([^/]+)/([^/]+)$")
DB_PATH = os.getenv("DATABASE_PATH", "./notifications.sqlite3")
JETSTREAM_URL = os.getenv("JETSTREAM_URL", "wss://jetstream2.us-east.bsky.network/subscribe")
ACCESS_CLIENT_ID = os.getenv("ACCESS_CLIENT_ID", "")
ACCESS_CLIENT_SECRET = os.getenv("ACCESS_CLIENT_SECRET", "")
DB_LOCK = threading.RLock()


def connect_db() -> sqlite3.Connection:
    path = Path(DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=30000")
    return db


def initialize_db() -> None:
    with connect_db() as db:
        db.executescript("""
          CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          INSERT OR IGNORE INTO metadata(key, value) VALUES ('cursor_time_us', '0');
          CREATE TABLE IF NOT EXISTS events (
            uri TEXT PRIMARY KEY, cid TEXT, actor_did TEXT NOT NULL,
            collection TEXT NOT NULL, operation TEXT NOT NULL,
            subject_uri TEXT, recipient_did TEXT, record_json TEXT NOT NULL,
            event_time TEXT NOT NULL, cursor_time_us INTEGER NOT NULL,
            indexed_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS events_recipient_time ON events(recipient_did, event_time DESC);
          CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT, event_uri TEXT NOT NULL UNIQUE,
            recipient_did TEXT NOT NULL, actor_did TEXT NOT NULL,
            type TEXT NOT NULL, subject_uri TEXT, source_cid TEXT,
            created_at TEXT NOT NULL, read_at TEXT
          );
          CREATE INDEX IF NOT EXISTS notifications_recipient_time ON notifications(recipient_did, created_at DESC, id DESC);
          CREATE INDEX IF NOT EXISTS notifications_unread ON notifications(recipient_did, read_at);
        """)


def cursor_time_us() -> int:
    with DB_LOCK, connect_db() as db:
        row = db.execute("SELECT value FROM metadata WHERE key='cursor_time_us'").fetchone()
        return int(row[0]) if row else 0


def advance_cursor(time_us: int) -> None:
    if time_us <= 0:
        return
    with DB_LOCK, connect_db() as db:
        db.execute("UPDATE metadata SET value=? WHERE key='cursor_time_us' AND CAST(value AS INTEGER) < ?", (str(time_us), time_us))


def event_time(event: dict) -> tuple[str, int]:
    raw_us = event.get("time_us")
    raw = event.get("time")
    if isinstance(raw_us, int) and raw_us > 0:
        stamp = datetime.fromtimestamp(raw_us / 1_000_000, timezone.utc)
        return stamp.isoformat(), raw_us
    if isinstance(raw, str):
        stamp = datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc)
        return stamp.isoformat(), int(stamp.timestamp() * 1_000_000)
    stamp = datetime.now(timezone.utc)
    return stamp.isoformat(), int(stamp.timestamp() * 1_000_000)


def subject_for(collection: str, record: dict) -> str | None:
    if collection in ("cc.coffeencode.comment", "cc.coffeencode.comment.like", "cc.coffeencode.forum.vote"):
        ref = record.get("subject")
        return ref.get("uri") if isinstance(ref, dict) else None
    if collection in ("cc.coffeencode.interact.like", "cc.coffeencode.interact.dislike"):
        return record.get("document")
    if collection == "cc.coffeencode.author.follow":
        return record.get("subject") if isinstance(record.get("subject"), str) else None
    return None


def recipient_for(collection: str, record: dict, subject_uri: str | None) -> str | None:
    if collection == "cc.coffeencode.comment":
        parent = record.get("reply", {}).get("parent", {}).get("uri") if isinstance(record.get("reply"), dict) else None
        parent_match = AT_URI_RE.fullmatch(parent) if isinstance(parent, str) else None
        if parent_match:
            return parent_match.group(1)
    match = AT_URI_RE.fullmatch(subject_uri) if isinstance(subject_uri, str) else None
    if match:
        return match.group(1)
    if collection == "cc.coffeencode.author.follow" and isinstance(subject_uri, str) and DID_RE.fullmatch(subject_uri):
        return subject_uri
    return None


def index_event(event: dict) -> None:
    if event.get("kind") != "commit":
        return
    commit = event.get("commit")
    actor = event.get("did")
    if not isinstance(commit, dict) or not isinstance(actor, str) or not DID_RE.fullmatch(actor):
        return
    collection, operation, rkey = commit.get("collection"), commit.get("operation"), commit.get("rkey")
    if collection not in COLLECTIONS or operation not in ("create", "update", "delete"):
        return
    if not isinstance(rkey, str) or not rkey or "/" in rkey:
        return
    record = commit.get("record") if isinstance(commit.get("record"), dict) else {}
    subject_uri = subject_for(collection, record)
    recipient = recipient_for(collection, record, subject_uri)
    source_uri = f"at://{actor}/{collection}/{rkey}"
    created_at, time_us = event_time(event)
    cid = commit.get("cid") if isinstance(commit.get("cid"), str) else None
    display_type = collection.removeprefix("cc.coffeencode.")
    with DB_LOCK, connect_db() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            db.execute("""INSERT INTO events
              (uri,cid,actor_did,collection,operation,subject_uri,recipient_did,record_json,event_time,cursor_time_us,indexed_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(uri) DO UPDATE SET cid=excluded.cid,actor_did=excluded.actor_did,
                collection=excluded.collection,operation=excluded.operation,subject_uri=excluded.subject_uri,
                recipient_did=excluded.recipient_did,record_json=excluded.record_json,
                event_time=excluded.event_time,cursor_time_us=excluded.cursor_time_us,indexed_at=excluded.indexed_at""",
              (source_uri,cid,actor,collection,operation,subject_uri,recipient,json.dumps(record,separators=(",",":")),created_at,time_us,datetime.now(timezone.utc).isoformat()))
            if operation == "delete":
                db.execute("DELETE FROM notifications WHERE event_uri=?", (source_uri,))
            if operation != "delete" and recipient and recipient != actor:
                db.execute("""INSERT OR IGNORE INTO notifications
                  (event_uri,recipient_did,actor_did,type,subject_uri,source_cid,created_at)
                  VALUES (?,?,?,?,?,?,?)""",
                  (source_uri,recipient,actor,display_type,subject_uri,cid,created_at))
            db.execute("UPDATE metadata SET value=? WHERE key='cursor_time_us' AND CAST(value AS INTEGER) < ?", (str(time_us),time_us))
            db.commit()
        except Exception:
            db.rollback()
            raise


async def consume() -> None:
    delay = 1
    while True:
        cursor = max(0, cursor_time_us() - 5_000_000)
        params = [("wantedCollections", item) for item in COLLECTIONS]
        if cursor:
            params.append(("cursor", str(cursor)))
        from urllib.parse import urlencode
        url = JETSTREAM_URL + ("&" if "?" in JETSTREAM_URL else "?") + urlencode(params)
        try:
            LOG.info("Connecting to Jetstream from cursor %s", cursor or "live tail")
            async with websockets.connect(url, ping_interval=20, ping_timeout=20, max_size=8 * 1024 * 1024) as socket:
                delay = 1
                async for message in socket:
                    try:
                        event = json.loads(message)
                        index_event(event)
                        try:
                            _, time_us = event_time(event)
                            advance_cursor(time_us)
                        except (ValueError, TypeError, OverflowError):
                            pass
                    except (json.JSONDecodeError, ValueError, TypeError) as exc:
                        LOG.warning("Skipped malformed event: %s", exc)
                    except Exception:
                        LOG.exception("Event indexing failed; reconnecting to replay from durable cursor")
                        raise
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            LOG.warning("Jetstream disconnected (%s); retrying in %ss", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "CoffeeCodeNotificationIntake/1.0"

    def log_message(self, fmt: str, *args) -> None:
        LOG.info("%s - %s", self.address_string(), fmt % args)

    def respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        return bool(ACCESS_CLIENT_ID and ACCESS_CLIENT_SECRET
                    and self.headers.get("CF-Access-Client-Id") == ACCESS_CLIENT_ID
                    and self.headers.get("CF-Access-Client-Secret") == ACCESS_CLIENT_SECRET)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.respond(200, {"ok": True, "cursorTimeUs": cursor_time_us()})
            return
        if not self.authorized():
            self.respond(401, {"error": "Unauthorized"})
            return
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/v1/notifications":
            did = query.get("recipient", [""])[0]
            try:
                limit = int(query.get("limit", ["30"])[0])
            except ValueError:
                limit = 0
            if not DID_RE.fullmatch(did) or not 1 <= limit <= 100:
                self.respond(400, {"error": "recipient DID and limit 1-100 are required"})
                return
            unread = query.get("unread", ["false"])[0].lower() == "true"
            clause = " AND read_at IS NULL" if unread else ""
            with DB_LOCK, connect_db() as db:
                rows = db.execute(f"""SELECT id,event_uri AS eventUri,actor_did AS actorDid,type,
                  subject_uri AS subjectUri,source_cid AS sourceCid,created_at AS createdAt,read_at AS readAt
                  FROM notifications WHERE recipient_did=?{clause} ORDER BY created_at DESC,id DESC LIMIT ?""", (did,limit)).fetchall()
                count = db.execute("SELECT COUNT(*) FROM notifications WHERE recipient_did=? AND read_at IS NULL", (did,)).fetchone()[0]
            self.respond(200, {"notifications": [dict(row) for row in rows], "unreadCount": count})
            return
        if parsed.path == "/v1/events":
            did = query.get("actor", [None])[0]
            collection = query.get("collection", [None])[0]
            clauses, values = [], []
            if did:
                if not DID_RE.fullmatch(did):
                    self.respond(400, {"error": "Invalid actor DID"}); return
                clauses.append("actor_did=?"); values.append(did)
            if collection:
                if collection not in COLLECTIONS:
                    self.respond(400, {"error": "Unsupported collection"}); return
                clauses.append("collection=?"); values.append(collection)
            where = " WHERE " + " AND ".join(clauses) if clauses else ""
            try:
                limit = min(100, max(1, int(query.get("limit", ["50"])[0])))
            except ValueError:
                limit = 50
            with DB_LOCK, connect_db() as db:
                rows = db.execute(f"SELECT uri,cid,actor_did AS actorDid,collection,operation,subject_uri AS subjectUri,recipient_did AS recipientDid,record_json AS recordJson,event_time AS eventTime FROM events{where} ORDER BY event_time DESC LIMIT ?", (*values,limit)).fetchall()
            result = [dict(row) for row in rows]
            for row in result:
                row["record"] = json.loads(row.pop("recordJson"))
            self.respond(200, {"events": result})
            return
        self.respond(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if not self.authorized():
            self.respond(401, {"error": "Unauthorized"}); return
        parsed = urlparse(self.path)
        match = re.fullmatch(r"/v1/notifications/([0-9]+)/read", parsed.path)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length > 4096:
            self.respond(413, {"error": "Request too large"}); return
        payload = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            self.respond(400, {"error": "Invalid JSON"}); return
        did = data.get("recipient") if isinstance(data, dict) else None
        if not isinstance(did, str) or not DID_RE.fullmatch(did):
            self.respond(400, {"error": "recipient DID is required"}); return
        now = datetime.now(timezone.utc).isoformat()
        with DB_LOCK, connect_db() as db:
            if parsed.path == "/v1/notifications/read-all":
                result = db.execute("UPDATE notifications SET read_at=? WHERE recipient_did=? AND read_at IS NULL", (now,did))
            elif match:
                result = db.execute("UPDATE notifications SET read_at=? WHERE id=? AND recipient_did=?", (now,int(match.group(1)),did))
            else:
                self.respond(404, {"error": "Not found"}); return
        self.respond(200, {"ok": True, "updated": result.rowcount})


def serve_api() -> None:
    host, port = os.getenv("HOST", "127.0.0.1"), int(os.getenv("PORT", "8787"))
    server = ThreadingHTTPServer((host, port), ApiHandler)
    LOG.info("API listening on http://%s:%d", host, port)
    server.serve_forever()


async def main() -> None:
    initialize_db()
    server = threading.Thread(target=serve_api, daemon=True)
    server.start()
    await consume()


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        LOG.info("Stopped")
