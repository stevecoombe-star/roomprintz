import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  canonicalWriteAllowed,
  placeIdenticalCanonicalObject,
  type CanonicalObjectStore,
} from "./canonical-thumbnail";

test("identical canonical thumbnail writes are idempotent and conflicts do not overwrite", async () => {
  const objects = new Map<string, Uint8Array>();
  let puts = 0;
  const store: CanonicalObjectStore = {
    async download(_bucket, objectPath) {
      const found = objects.get(objectPath);
      return found ? new Uint8Array(found) : null;
    },
    async putIfAbsent(_bucket, objectPath, bytes) {
      puts += 1;
      if (objects.has(objectPath)) return { ok: false, code: "exists" };
      objects.set(objectPath, new Uint8Array(bytes));
      return { ok: true };
    },
  };
  const key = "rooms/room/assets/asset.webp";
  const first = Uint8Array.from([1, 2, 3, 4]);
  const same = Uint8Array.from([1, 2, 3, 4]);
  const other = Uint8Array.from([9, 9, 9, 9]);
  assert.equal(await placeIdenticalCanonicalObject(store, "vibode-thumbnails", key, first), "created");
  assert.equal(puts, 1);
  assert.equal(await placeIdenticalCanonicalObject(store, "vibode-thumbnails", key, same), "present");
  assert.equal(puts, 1);
  assert.equal(await placeIdenticalCanonicalObject(store, "vibode-thumbnails", key, other), "conflict");
  assert.equal(puts, 1);
  assert.deepEqual(objects.get(key), first);
});

test("concurrent identical puts settle once and a conflicting loser leaves the winner", async () => {
  let stored: Uint8Array | null = null;
  const store: CanonicalObjectStore = {
    async download() {
      return stored ? new Uint8Array(stored) : null;
    },
    async putIfAbsent(_bucket, _path, bytes) {
      if (stored) return { ok: false, code: "exists" };
      stored = new Uint8Array(bytes);
      return { ok: true };
    },
  };
  const winner = Uint8Array.from([4, 5, 6]);
  const same = Uint8Array.from([4, 5, 6]);
  const loser = Uint8Array.from([7, 8, 9]);
  const [first, second] = await Promise.all([
    placeIdenticalCanonicalObject(store, "bucket", "path", winner),
    placeIdenticalCanonicalObject(store, "bucket", "path", same),
  ]);
  assert.deepEqual([first, second].sort(), ["created", "present"]);
  assert.deepEqual(stored, winner);
  assert.equal(await placeIdenticalCanonicalObject(store, "bucket", "path", loser), "conflict");
  assert.deepEqual(stored, winner);
});

test("a late canonical write is refused once the recovery margin has passed", () => {
  const nowMs = Date.parse("2026-10-15T12:00:00.000Z");
  assert.equal(canonicalWriteAllowed(nowMs + 1, nowMs), true);
  assert.equal(canonicalWriteAllowed(nowMs, nowMs), false);
  assert.equal(canonicalWriteAllowed(null, nowMs), true);
});

test("Harmonize thumbnail placement does not upsert, activate, or change the room cover", () => {
  const server = readFileSync(path.join(process.cwd(), "lib/vibode-stage/harmonize-jobs/history-publication.server.ts"), "utf8");
  const attach = server.slice(server.indexOf("async function attachHarmonizeHistoryThumbnail"));
  assert.match(attach, /placeIdenticalCanonicalObject/);
  assert.match(attach, /upsert: false/);
  assert.doesNotMatch(attach, /upsert: true/);
  assert.match(attach, /\.is\("thumbnail_storage_path", null\)/);
  assert.doesNotMatch(attach, /is_active|cover_image_url|active_asset_id/);
  assert.match(attach, /canonicalWriteAllowed/);
});
