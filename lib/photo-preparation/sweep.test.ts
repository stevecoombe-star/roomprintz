import assert from "node:assert/strict";
import test from "node:test";

import { storageRemovalSucceeded, sweepExpiredPhotoPreparations } from "./sweep.server";

const PATH = "users/11111111-1111-4111-8111-111111111111/preparations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source.heic";
const ORPHAN = "users/22222222-2222-4222-8222-222222222222/preparations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/source.heic";
const NOW = new Date("2026-11-19T18:00:00.000Z");

test("a failed storage delete does not retire the cleanup row", async () => {
  const confirmed: string[] = [];
  const result = await sweepExpiredPhotoPreparations(NOW, {
    sweep: async () => [PATH],
    orphans: async () => [],
    remove: async () => false,
    confirm: async (path) => {
      confirmed.push(path);
    },
  });
  assert.equal(result.deleted, 0);
  assert.deepEqual(confirmed, []);
});

test("a successful delete is confirmed and an orphan is removed without a row", async () => {
  const confirmed: string[] = [];
  const removed: string[] = [];
  const result = await sweepExpiredPhotoPreparations(NOW, {
    sweep: async () => [PATH, "not-a-preparation"],
    orphans: async () => [ORPHAN],
    remove: async (path) => {
      removed.push(path);
      return true;
    },
    confirm: async (path) => {
      confirmed.push(path);
    },
  });
  assert.deepEqual(removed, [PATH, ORPHAN]);
  assert.deepEqual(confirmed, [PATH]);
  assert.equal(result.deleted, 1);
  assert.equal(result.orphans, 1);
});

test("a missing object can be retired and a storage error cannot", () => {
  assert.equal(storageRemovalSucceeded(null), true);
  assert.equal(storageRemovalSucceeded({ message: "Object not found" }), true);
  assert.equal(storageRemovalSucceeded({ message: "database is unavailable" }), false);
});
