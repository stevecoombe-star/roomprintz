import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ROOM_PREVIEW_BATCH_MAX } from "@/lib/vibode-room-preview/batch-limit";
import {
  applyRoomPreviewBatch,
  chooseStablePreviewUrl,
  chunkRoomIds,
  initialDisplayPreview,
  nextPreviewCache,
  parseRoomPreviewBatchResponse,
  previewUrlReusable,
  readFreshPreviewUrls,
  requestRoomPreviewBatch,
  retainPreviewCache,
  roomCardImageDelivery,
  writeFreshPreviewUrls,
  type PreviewCacheStore,
  type RoomPreviewBatchLoad,
} from "@/components/my-rooms/preview-batch";
import type { MyRoomsRoom } from "@/components/my-rooms/types";

const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-09-25T12:00:00.000Z");

function signedUrl(objectPath: string, expSec: number, tokenSuffix: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url");
  return `https://cdn.example/storage/v1/object/sign/${objectPath}?token=${header}.${payload}.${tokenSuffix}`;
}

function room(id: string, overrides: Partial<MyRoomsRoom> = {}): MyRoomsRoom {
  return {
    id,
    title: "Room",
    folder_id: null,
    folder_name: null,
    current_stage: 0,
    selected_model: null,
    cover_image_url: null,
    display_image_url: null,
    preview_status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_opened_at: null,
    sort_key: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function memoryStore(initial = ""): PreviewCacheStore & { value: string } {
  const store = {
    value: initial,
    getItem() {
      return store.value || null;
    },
    setItem(_key: string, value: string) {
      store.value = value;
    },
  };
  return store;
}

test("listing preview requests are one batch, not one post per room", async () => {
  const roomIds = Array.from({ length: 33 }, (_value, index) => {
    const hex = index.toString(16).padStart(12, "0");
    return `11111111-1111-4111-8111-${hex}`;
  });
  const bodies: unknown[] = [];
  const load = await requestRoomPreviewBatch({
    roomIds,
    accessToken: "token",
    fetchImpl: async (input, init) => {
      assert.equal(input, "/api/vibode/room-preview-urls");
      bodies.push(JSON.parse(String(init?.body)));
      const requested = (JSON.parse(String(init?.body)) as { roomIds: string[] }).roomIds;
      return new Response(
        JSON.stringify({
          previews: Object.fromEntries(
            requested.map((roomId) => [roomId, { roomId, previewUrl: `https://cdn.example/${roomId}.webp`, source: "3d" }]),
          ),
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(bodies.length, 1);
  assert.equal((bodies[0] as { roomIds: string[] }).roomIds.length, 33);
  assert.equal(load.ok, true);
  assert.equal(load.previews[roomIds[0]!]?.source, "3d");
  assert.equal(chunkRoomIds(roomIds).length, 1);
  assert.equal(chunkRoomIds([...roomIds, ...roomIds]).length, 1);
});

test("more than the batch cap is split without a per-room loop", () => {
  const roomIds = Array.from({ length: ROOM_PREVIEW_BATCH_MAX + 1 }, (_value, index) => {
    const hex = index.toString(16).padStart(12, "0");
    return `22222222-2222-4222-8222-${hex}`;
  });
  const chunks = chunkRoomIds(roomIds);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [ROOM_PREVIEW_BATCH_MAX, 1]);
});

test("cards can render before previews, and one failure does not block the others", () => {
  const shells = [room(ROOM_A), room(ROOM_B)].map((entry) => ({
    ...entry,
    ...initialDisplayPreview(entry.id, {}),
  }));
  assert.deepEqual(
    shells.map((entry) => entry.preview_status),
    ["pending", "pending"],
  );
  assert.equal(shells.every((entry) => entry.display_image_url === null), true);

  const batch: RoomPreviewBatchLoad = {
    ok: true,
    completedRoomIds: [ROOM_A, ROOM_B],
    failedRoomIds: [],
    previews: {
      [ROOM_A]: { roomId: ROOM_A, previewUrl: "https://cdn.example/a.webp", source: "3d" },
      [ROOM_B]: { roomId: ROOM_B, previewUrl: null, source: null },
    },
  };
  const painted = applyRoomPreviewBatch(shells, batch, NOW);
  assert.equal(painted[0]?.display_image_url, "https://cdn.example/a.webp");
  assert.equal(painted[0]?.preview_status, "ready");
  assert.equal(painted[1]?.display_image_url, null);
  assert.equal(painted[1]?.preview_status, "ready");
  assert.equal(painted[0]?.title, "Room");
  assert.equal(painted[0]?.folder_id, null);
});

test("a failed chunk keeps a cached image and a successful chunk fills the rest", () => {
  const cached = room(ROOM_A, {
    display_image_url: "https://cdn.example/cached.webp",
    preview_status: "ready",
  });
  const waiting = room(ROOM_B);
  const batch: RoomPreviewBatchLoad = {
    ok: true,
    completedRoomIds: [ROOM_B],
    failedRoomIds: [ROOM_A],
    previews: {
      [ROOM_B]: { roomId: ROOM_B, previewUrl: "https://cdn.example/b.webp", source: "2d-thumbnail" },
    },
  };
  const next = applyRoomPreviewBatch([cached, waiting], batch, NOW);
  assert.equal(next[0]?.display_image_url, "https://cdn.example/cached.webp");
  assert.equal(next[1]?.display_image_url, "https://cdn.example/b.webp");
  assert.equal(next[1]?.preview_status, "ready");
});

test("the same storage object keeps its signed url so reloads can reuse the browser cache", () => {
  const freshExp = Math.floor(NOW / 1000) + 60 * 60;
  const previous = signedUrl("vibode-thumbnails/rooms/a.webp", freshExp, "old");
  const next = signedUrl("vibode-thumbnails/rooms/a.webp", freshExp + 10, "new");
  assert.equal(chooseStablePreviewUrl(previous, next, NOW), previous);
  assert.equal(previewUrlReusable(previous, NOW), true);

  const expired = signedUrl("vibode-thumbnails/rooms/a.webp", Math.floor(NOW / 1000) - 10, "expired");
  assert.equal(chooseStablePreviewUrl(expired, next, NOW), next);

  const otherObject = signedUrl("vibode-thumbnails/rooms/b.webp", freshExp, "other");
  assert.equal(chooseStablePreviewUrl(previous, otherObject, NOW), otherObject);
  assert.equal(chooseStablePreviewUrl(previous, null, NOW), null);
});

test("preview url cache is per user and drops expired or deleted rooms", () => {
  const freshExp = Math.floor(NOW / 1000) + 60 * 60;
  const store = memoryStore();
  writeFreshPreviewUrls(store, "user-a", {
    [ROOM_A]: signedUrl("vibode-thumbnails/rooms/a.webp", freshExp, "a"),
    [ROOM_B]: signedUrl("vibode-thumbnails/rooms/b.webp", freshExp, "b"),
  });
  assert.equal(readFreshPreviewUrls(store, "user-b", NOW)[ROOM_A], undefined);
  const fresh = readFreshPreviewUrls(store, "user-a", NOW);
  assert.equal(typeof fresh[ROOM_A], "string");
  const retained = retainPreviewCache(fresh, [ROOM_A]);
  assert.deepEqual(Object.keys(retained), [ROOM_A]);

  const expiredStore = memoryStore();
  writeFreshPreviewUrls(expiredStore, "user-a", {
    [ROOM_A]: signedUrl("vibode-thumbnails/rooms/a.webp", Math.floor(NOW / 1000) - 5, "old"),
  });
  assert.deepEqual(readFreshPreviewUrls(expiredStore, "user-a", NOW), {});
});

test("cache updates follow the batch and keep urls from a failed chunk", () => {
  const previous = signedUrl("vibode-thumbnails/rooms/a.webp", Math.floor(NOW / 1000) + 3600, "old");
  const replacement = signedUrl("vibode-thumbnails/rooms/a.webp", Math.floor(NOW / 1000) + 7200, "new");
  const kept = nextPreviewCache(
    { [ROOM_A]: previous, [ROOM_B]: "https://cdn.example/b.webp" },
    {
      ok: true,
      completedRoomIds: [ROOM_A],
      failedRoomIds: [ROOM_B],
      previews: {
        [ROOM_A]: { roomId: ROOM_A, previewUrl: replacement, source: "3d" },
      },
    },
    NOW,
  );
  assert.equal(kept[ROOM_A], previous);
  assert.equal(kept[ROOM_B], "https://cdn.example/b.webp");
});

test("response parsing keeps a partial map and ignores unknown sources", () => {
  const parsed = parseRoomPreviewBatchResponse({
    previews: {
      [ROOM_A]: { previewUrl: "https://cdn.example/a.webp", source: "3d" },
      [ROOM_B]: { previewUrl: "", source: "scene" },
      bad: null,
    },
  });
  assert.equal(parsed?.[ROOM_A]?.source, "3d");
  assert.equal(parsed?.[ROOM_B]?.previewUrl, null);
  assert.equal(parsed?.[ROOM_B]?.source, null);
  assert.equal(parseRoomPreviewBatchResponse({ previews: [] }), null);
});

test("the first card is eager and later cards stay lazy", () => {
  assert.deepEqual(roomCardImageDelivery(0), { loading: "eager", fetchPriority: "high" });
  assert.deepEqual(roomCardImageDelivery(5), { loading: "eager", fetchPriority: "auto" });
  assert.deepEqual(roomCardImageDelivery(6), { loading: "lazy", fetchPriority: "low" });
});

test("a failed chunk does not discard rooms from a successful chunk", async () => {
  const roomIds = Array.from({ length: ROOM_PREVIEW_BATCH_MAX + 1 }, (_value, index) => {
    const hex = index.toString(16).padStart(12, "0");
    return `33333333-3333-4333-8333-${hex}`;
  });
  let calls = 0;
  const load = await requestRoomPreviewBatch({
    roomIds,
    accessToken: "token",
    fetchImpl: async (_input, init) => {
      calls += 1;
      const requested = (JSON.parse(String(init?.body)) as { roomIds: string[] }).roomIds;
      if (requested.length === 1) return new Response("nope", { status: 500 });
      return new Response(
        JSON.stringify({
          previews: Object.fromEntries(
            requested.map((roomId) => [roomId, { roomId, previewUrl: `https://cdn.example/${roomId}.webp`, source: "2d-thumbnail" }]),
          ),
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(calls, 2);
  assert.equal(load.ok, true);
  assert.equal(load.completedRoomIds.length, ROOM_PREVIEW_BATCH_MAX);
  assert.deepEqual(load.failedRoomIds, [roomIds[ROOM_PREVIEW_BATCH_MAX]]);
  assert.equal(load.previews[roomIds[0]!]?.source, "2d-thumbnail");
});

test("the listing client has one batch fetch call site", () => {
  const helper = readFileSync(path.join(process.cwd(), "components/my-rooms/preview-batch.ts"), "utf8");
  assert.equal(helper.match(/\/api\/vibode\/room-preview-urls/g)?.length, 1);
  assert.doesNotMatch(helper, /\/api\/vibode\/room-preview-url"/);
  assert.doesNotMatch(helper, /vibode_3d_scenes|vibode_3d_thumbnail_jobs|storage_path/);
});
