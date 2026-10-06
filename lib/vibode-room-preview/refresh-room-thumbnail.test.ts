import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { applyRoomPreviewBatch, overlayPreviewCache } from "@/components/my-rooms/preview-batch";
import type { MyRoomsRoom } from "@/components/my-rooms/types";
import { VIBODE_THUMBNAIL_JOB_QUIET_WINDOW_SEC, thumbnailScheduleNotBefore } from "@/lib/vibode-thumbnail-jobs/policy";
import {
  ROOM_THUMBNAIL_REFRESH_TIMEOUT_MS,
  applyThumbnailRefreshToRooms,
  beginThumbnailRefresh,
  endThumbnailRefresh,
  executeRoomThumbnailRefresh,
  manualThumbnailNotBefore,
  requestRoomThumbnailRefresh,
  roomThumbnailRefreshHttpStatus,
  thumbnailDisplayUrl,
  thumbnailRefreshInFlight,
} from "@/lib/vibode-room-preview/refresh-room-thumbnail";

const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const NOW = 1_700_000_000_000;
const SCENE_UPDATED_AT = "2026-10-05T16:00:00.000Z";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function room(id: string, displayUrl: string | null): MyRoomsRoom {
  return {
    id,
    title: id === ROOM_A ? "Living Room" : "Office",
    folder_id: null,
    folder_name: null,
    current_stage: 1,
    selected_model: null,
    cover_image_url: null,
    display_image_url: displayUrl,
    preview_status: "ready",
    created_at: SCENE_UPDATED_AT,
    updated_at: SCENE_UPDATED_AT,
    last_opened_at: null,
    sort_key: SCENE_UPDATED_AT,
  };
}

function signedSceneUrl(token: string): string {
  return `https://cdn.example/storage/v1/object/sign/vibode-thumbnails/rooms/${ROOM_A}/versions/${VERSION}/scene/${token}.webp?token=sig`;
}

test("manual refresh is claimable immediately and scene saves keep the quiet window", () => {
  assert.equal(manualThumbnailNotBefore(NOW), new Date(NOW).toISOString());
  assert.equal(
    thumbnailScheduleNotBefore(NOW, false),
    new Date(NOW + VIBODE_THUMBNAIL_JOB_QUIET_WINDOW_SEC * 1000).toISOString(),
  );
  assert.ok(ROOM_THUMBNAIL_REFRESH_TIMEOUT_MS < 60_000);
});

test("content-addressed thumbnails are not cache-busted and reused paths get a stable version", () => {
  const sceneUrl = signedSceneUrl(TOKEN_A);
  assert.equal(thumbnailDisplayUrl(sceneUrl, TOKEN_A), sceneUrl);
  assert.equal(thumbnailDisplayUrl(sceneUrl, TOKEN_A), thumbnailDisplayUrl(sceneUrl, TOKEN_A));

  const reused = "https://cdn.example/storage/v1/object/sign/vibode-thumbnails/room/asset/thumb.webp?token=abc";
  const versioned = thumbnailDisplayUrl(reused, SCENE_UPDATED_AT);
  assert.match(versioned, /[?&]v=2026-10-05T16%3A00%3A00.000Z/);
  assert.match(versioned, /token=abc/);
  assert.equal(versioned, thumbnailDisplayUrl(reused, SCENE_UPDATED_AT));
  assert.equal(thumbnailDisplayUrl(versioned, SCENE_UPDATED_AT), versioned);
});

test("refresh targets only the selected room and failure keeps the previous thumbnail", () => {
  const rooms = [room(ROOM_A, "https://cdn.example/old-a.webp"), room(ROOM_B, "https://cdn.example/old-b.webp")];
  const failed = applyThumbnailRefreshToRooms(rooms, ROOM_A, { ok: false, code: "thumbnail_not_ready" });
  assert.equal(failed, rooms);
  assert.equal(failed[0]?.display_image_url, "https://cdn.example/old-a.webp");
  assert.equal(failed[1], rooms[1]);

  const refreshed = applyThumbnailRefreshToRooms(rooms, ROOM_A, {
    ok: true,
    previewUrl: signedSceneUrl(TOKEN_B),
    cacheVersion: TOKEN_B,
  });
  assert.equal(refreshed[0]?.display_image_url, signedSceneUrl(TOKEN_B));
  assert.equal(refreshed[0]?.title, "Living Room");
  assert.equal(refreshed[1], rooms[1]);
  assert.equal(refreshed[1]?.display_image_url, "https://cdn.example/old-b.webp");
});

test("loading state disables only the room that is refreshing", () => {
  const idle = new Set<string>();
  assert.equal(thumbnailRefreshInFlight(idle, ROOM_A), false);
  const started = beginThumbnailRefresh(idle, ROOM_A);
  assert.equal(started.has(ROOM_A), true);
  assert.equal(started.has(ROOM_B), false);
  assert.equal(beginThumbnailRefresh(started, ROOM_A), started);
  const both = beginThumbnailRefresh(started, ROOM_B);
  assert.equal(thumbnailRefreshInFlight(both, ROOM_A), true);
  assert.equal(thumbnailRefreshInFlight(both, ROOM_B), true);
  const ended = endThumbnailRefresh(both, ROOM_A);
  assert.equal(ended.has(ROOM_A), false);
  assert.equal(ended.has(ROOM_B), true);
});

test("an in-flight listing batch cannot replace a refreshed room", () => {
  const current = signedSceneUrl(TOKEN_B);
  const rooms = [room(ROOM_A, current), room(ROOM_B, null)];
  const batch = {
    ok: true,
    previews: {
      [ROOM_A]: { roomId: ROOM_A, previewUrl: signedSceneUrl(TOKEN_A), source: "3d" as const },
      [ROOM_B]: { roomId: ROOM_B, previewUrl: "https://cdn.example/b.webp", source: "3d" as const },
    },
    failedRoomIds: [],
    completedRoomIds: [ROOM_A, ROOM_B],
  };
  const next = applyRoomPreviewBatch(rooms, batch, NOW, new Set([ROOM_A]));
  assert.equal(next[0], rooms[0]);
  assert.equal(next[0]?.display_image_url, current);
  assert.equal(next[1]?.display_image_url, "https://cdn.example/b.webp");

  const cache = overlayPreviewCache(
    { [ROOM_A]: signedSceneUrl(TOKEN_A), [ROOM_B]: "https://cdn.example/b.webp" },
    new Map([[ROOM_A, current]]),
  );
  assert.equal(cache[ROOM_A], current);
  assert.equal(cache[ROOM_B], "https://cdn.example/b.webp");
});

test("a current thumbnail signs once and a pending thumbnail waits for that token", async () => {
  const sleeps: number[] = [];
  let now = NOW;
  let reads = 0;
  const scheduled: string[] = [];
  const signed: string[] = [];
  const current = await executeRoomThumbnailRefresh({
    schedule: async () => {
      scheduled.push(ROOM_A);
      return { ok: true, scheduled: "unchanged", contentToken: TOKEN_A };
    },
    readPublishedToken: async () => {
      throw new Error("should not poll a current thumbnail");
    },
    signPublishedThumbnail: async (token) => {
      signed.push(token);
      return signedSceneUrl(token);
    },
    resolveClearedPreview: async () => null,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });
  assert.equal(current.ok, true);
  if (current.ok) {
    assert.equal(current.previewUrl, signedSceneUrl(TOKEN_A));
    assert.equal(current.cacheVersion, TOKEN_A);
  }
  assert.deepEqual(scheduled, [ROOM_A]);
  assert.deepEqual(signed, [TOKEN_A]);
  assert.equal(sleeps.length, 0);

  signed.length = 0;
  const pending = await executeRoomThumbnailRefresh({
    schedule: async () => {
      scheduled.push(ROOM_B);
      return { ok: true, scheduled: "pending", contentToken: TOKEN_B };
    },
    readPublishedToken: async () => {
      reads += 1;
      return reads >= 3 ? TOKEN_B : TOKEN_A;
    },
    signPublishedThumbnail: async (token) => {
      signed.push(token);
      return signedSceneUrl(token);
    },
    resolveClearedPreview: async () => null,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    timeoutMs: 10_000,
    intervalMs: 1_000,
  });
  assert.equal(pending.ok, true);
  if (pending.ok) assert.equal(pending.cacheVersion, TOKEN_B);
  assert.deepEqual(scheduled, [ROOM_A, ROOM_B]);
  assert.deepEqual(signed, [TOKEN_B]);
  assert.equal(sleeps.length, 2);
});

test("a refresh that does not publish preserves the caller thumbnail", async () => {
  const signed: string[] = [];
  let now = NOW;
  const result = await executeRoomThumbnailRefresh({
    schedule: async () => ({ ok: true, scheduled: "pending", contentToken: TOKEN_B }),
    readPublishedToken: async () => TOKEN_A,
    signPublishedThumbnail: async (token) => {
      signed.push(token);
      return signedSceneUrl(token);
    },
    resolveClearedPreview: async () => "https://cdn.example/should-not-sign",
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    timeoutMs: 2_500,
    intervalMs: 1_000,
  });
  assert.deepEqual(result, { ok: false, code: "thumbnail_not_ready" });
  assert.deepEqual(signed, []);
  assert.equal(roomThumbnailRefreshHttpStatus("thumbnail_not_ready"), 503);
});

test("the refresh request posts one room id", async () => {
  const calls: { url: string; body: string }[] = [];
  const result = await requestRoomThumbnailRefresh({
    roomId: ROOM_A,
    accessToken: "token",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          ok: true,
          previewUrl: signedSceneUrl(TOKEN_B),
          cacheVersion: TOKEN_B,
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "/api/vibode/room-thumbnail-refresh");
  assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), { roomId: ROOM_A });
  assert.equal(result.ok, true);

  const failed = await requestRoomThumbnailRefresh({
    roomId: ROOM_A,
    accessToken: "token",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ ok: false, previewUrl: "https://cdn.example/stale.webp", cacheVersion: TOKEN_A }),
        { status: 503 },
      ),
  });
  assert.deepEqual(failed, { ok: false, code: "refresh_failed" });
});

test("refresh reuses the existing thumbnail job and does not claim the queue", () => {
  const route = source("app/api/vibode/room-thumbnail-refresh/route.ts");
  const server = source("lib/vibode-room-preview/refresh-room-thumbnail.server.ts");
  const jobs = source("lib/vibode-thumbnail-jobs/jobs.server.ts");
  const card = source("components/my-rooms/RoomCard.tsx");
  const page = source("components/my-rooms/MyRoomsPage.tsx");
  const sceneRoute = source("app/api/vibode/3d-scene/route.ts");

  assert.match(server, /scheduleVibodeThumbnailAfterSceneSave\(/);
  assert.match(server, /immediate:\s*true/);
  assert.doesNotMatch(`${route}\n${server}`, /claimNextVibodeThumbnailJob|playwright|chromium/);
  assert.doesNotMatch(route, /roomIds/);
  assert.match(jobs, /thumbnailScheduleNotBefore\(Date\.now\(\), options\?\.immediate === true\)/);
  assert.match(sceneRoute, /scheduleVibodeThumbnailAfterSceneSave\(saved\.scene\)/);
  assert.doesNotMatch(sceneRoute, /immediate:\s*true/);
  assert.match(card, /aria-label="Refresh thumbnail"/);
  assert.match(card, /left-2 top-2/);
  assert.match(card, /group-hover:opacity-100/);
  assert.match(card, /focus-visible:ring-2/);
  assert.match(card, /absolute right-2 top-2/);
  assert.match(page, /roomId: room\.id/);
  assert.doesNotMatch(`${card}\n${page}\n${route}`, /Refresh All/);
});
