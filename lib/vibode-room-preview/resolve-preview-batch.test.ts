import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { VIBODE_3D_THUMBNAIL_BUCKET, vibode3dThumbnailObjectPath } from "@/lib/vibode-thumbnail-jobs/policy";
import { ROOM_PREVIEW_BATCH_MAX } from "@/lib/vibode-room-preview/batch-limit";
import { listPublishedVibode3dThumbnails } from "@/lib/vibode-room-preview/published-thumbnail.server";
import type { PublishedVibode3dThumbnailPointer } from "@/lib/vibode-room-preview/published-thumbnail";
import {
  chooseActivePreviewAsset,
  collectRoomPreviewSignTargets,
  loadRoomPreviewBatch,
  parseRoomPreviewBatchRequest,
  resolveRoomPreviewBatch,
  selectNewestActiveAssets,
  type OwnedPreviewAssetRow,
  type OwnedPreviewRoomRow,
  type PreviewQueryResult,
  type RoomPreviewBatchContext,
} from "@/lib/vibode-room-preview/resolve-preview-batch";
import {
  previewObjectSignKey,
  signPreviewTargets,
  type SignedUrlReuseCache,
} from "@/lib/vibode-room-preview/signed-url-batch";
import type { RoomPreviewSignInput } from "@/lib/vibode-room-preview/resolve-preview";

const ROOT = process.cwd();
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "22222222-2222-4222-8222-222222222222";
const ROOM_FOREIGN = "44444444-4444-4444-8444-444444444444";
const VERSION_A = "33333333-3333-4333-8333-333333333333";
const VERSION_B = "55555555-5555-4555-8555-555555555555";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function pointerFor(roomId: string, versionId: string, token: string): PublishedVibode3dThumbnailPointer {
  const storagePath = vibode3dThumbnailObjectPath(roomId, versionId, token);
  if (!storagePath) throw new Error("expected closed thumbnail path");
  return {
    roomId,
    versionId,
    contentToken: token,
    storageBucket: VIBODE_3D_THUMBNAIL_BUCKET,
    storagePath,
  };
}

function room(id: string, activeAssetId: string | null, userId = USER): OwnedPreviewRoomRow {
  return {
    id,
    user_id: userId,
    cover_image_url: `https://cdn.example/covers/${id}.jpg`,
    active_asset_id: activeAssetId,
  };
}

function asset(args: {
  id: string;
  roomId: string;
  userId?: string;
  imageUrl?: string | null;
  thumbnailPath?: string | null;
  storagePath?: string | null;
  createdAt?: string | null;
}): OwnedPreviewAssetRow {
  return {
    id: args.id,
    room_id: args.roomId,
    user_id: args.userId ?? USER,
    image_url: args.imageUrl === undefined ? `https://cdn.example/rooms/${args.id}.jpg` : args.imageUrl,
    storage_bucket: "room-images",
    storage_path: args.storagePath === undefined ? `rooms/${args.id}.png` : args.storagePath,
    thumbnail_storage_bucket: args.thumbnailPath ? "room-images" : null,
    thumbnail_storage_path: args.thumbnailPath ?? null,
    created_at: args.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function ok<T>(data: readonly T[]): PreviewQueryResult<T> {
  return { data, error: null };
}

test("batch parser caps room ids and drops values that are not room ids", () => {
  assert.equal(parseRoomPreviewBatchRequest({ roomIds: [] }).ok, true);
  const max = parseRoomPreviewBatchRequest({ roomIds: Array.from({ length: ROOM_PREVIEW_BATCH_MAX }, () => ROOM_A) });
  assert.equal(max.ok, true);
  if (max.ok) assert.deepEqual(max.roomIds, [ROOM_A]);

  const tooMany = parseRoomPreviewBatchRequest({
    roomIds: Array.from({ length: ROOM_PREVIEW_BATCH_MAX + 1 }, () => ROOM_A),
  });
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.equal(tooMany.status, 400);

  const mixed = parseRoomPreviewBatchRequest({
    roomIds: [ROOM_A, "not-a-room", ROOM_A, `  ${ROOM_B}  `, 12, ROOM_FOREIGN],
  });
  assert.equal(mixed.ok, true);
  if (mixed.ok) assert.deepEqual(mixed.roomIds, [ROOM_A, ROOM_B, ROOM_FOREIGN]);
  assert.equal(parseRoomPreviewBatchRequest({}).ok, false);
  assert.equal(parseRoomPreviewBatchRequest(["nope"]).ok, false);
});

test("newest active asset wins and a cross-room asset id is ignored", () => {
  const older = asset({ id: VERSION_A, roomId: ROOM_A, createdAt: "2026-01-01T00:00:00.000Z" });
  const newer = asset({ id: VERSION_B, roomId: ROOM_A, createdAt: "2026-02-01T00:00:00.000Z" });
  const selected = selectNewestActiveAssets([older, newer]);
  assert.equal(selected.get(ROOM_A)?.id, VERSION_B);

  const foreign = asset({ id: VERSION_A, roomId: ROOM_FOREIGN });
  assert.equal(
    chooseActivePreviewAsset({
      userId: USER,
      roomId: ROOM_A,
      activeAssetId: VERSION_A,
      assetsById: new Map([[VERSION_A, foreign]]),
      fallbackByRoomId: new Map([[ROOM_A, newer]]),
    })?.id,
    VERSION_B,
  );
});

test("owned batch prefers the active version 3D pointer, then the 2D thumbnail", async () => {
  const pointer = pointerFor(ROOM_A, VERSION_A, TOKEN_A);
  const calls = { rooms: 0, assets: 0, active: 0, pointers: 0, signs: 0 };
  const previews = await loadRoomPreviewBatch({
    userId: USER,
    roomIds: [ROOM_A, ROOM_B, ROOM_FOREIGN],
    listOwnedRooms: async (userId, roomIds) => {
      calls.rooms += 1;
      assert.equal(userId, USER);
      assert.deepEqual(roomIds, [ROOM_A, ROOM_B, ROOM_FOREIGN]);
      return ok([room(ROOM_A, VERSION_A), room(ROOM_B, VERSION_B)]);
    },
    listAssetsById: async (_userId, assetIds) => {
      calls.assets += 1;
      assert.deepEqual([...assetIds].sort(), [VERSION_A, VERSION_B].sort());
      return ok([
        asset({ id: VERSION_A, roomId: ROOM_A, thumbnailPath: "rooms/a-thumb.webp" }),
        asset({ id: VERSION_B, roomId: ROOM_B, thumbnailPath: "rooms/b-thumb.webp" }),
      ]);
    },
    listActiveAssets: async () => {
      calls.active += 1;
      return ok([]);
    },
    listPointers: async (versions) => {
      calls.pointers += 1;
      assert.deepEqual(
        versions.map((version) => version.versionId).sort(),
        [VERSION_A, VERSION_B].sort(),
      );
      return new Map([[VERSION_A, pointer]]);
    },
    signTargets: async (targets) => {
      calls.signs += 1;
      const signed = new Map<string, string>();
      for (const target of targets) {
        signed.set(previewObjectSignKey(target.bucket, target.storagePath), `signed:${target.storagePath}`);
      }
      return signed;
    },
  });

  assert.deepEqual(calls, { rooms: 1, assets: 1, active: 0, pointers: 1, signs: 1 });
  assert.equal(previews[ROOM_FOREIGN], undefined);
  assert.equal(previews[ROOM_A]?.source, "3d");
  assert.equal(previews[ROOM_A]?.previewUrl, `signed:${pointer.storagePath}`);
  assert.equal(previews[ROOM_B]?.source, "2d-thumbnail");
  assert.equal(previews[ROOM_B]?.previewUrl, "signed:rooms/b-thumb.webp");
});

test("a pointer for another version is ignored and full-size signing is skipped when a durable image exists", async () => {
  const stalePointer = pointerFor(ROOM_A, VERSION_A, TOKEN_A);
  const context: RoomPreviewBatchContext = {
    roomId: ROOM_A,
    coverImageUrl: "https://cdn.example/cover.jpg",
    activeAsset: {
      id: VERSION_B,
      imageUrl: "https://cdn.example/rooms/full.jpg",
      storageBucket: "room-images",
      storagePath: "rooms/full.png",
      thumbnailStorageBucket: "room-images",
      thumbnailStoragePath: "rooms/b-thumb.webp",
    },
    publishedPointer: stalePointer,
  };
  const targets = collectRoomPreviewSignTargets(context);
  assert.deepEqual(targets, [{ bucket: "room-images", storagePath: "rooms/b-thumb.webp" }]);

  const previews = await loadRoomPreviewBatch({
    userId: USER,
    roomIds: [ROOM_A],
    listOwnedRooms: async () => ok([room(ROOM_A, VERSION_B)]),
    listAssetsById: async () =>
      ok([asset({ id: VERSION_B, roomId: ROOM_A, thumbnailPath: "rooms/b-thumb.webp" })]),
    listActiveAssets: async () => ok([]),
    listPointers: async () => new Map([[VERSION_A, stalePointer]]),
    signTargets: async (signTargets) => {
      assert.equal(
        signTargets.some((target) => target.storagePath.endsWith(".png")),
        false,
      );
      return new Map(signTargets.map((target) => [previewObjectSignKey(target.bucket, target.storagePath), "signed:2d"]));
    },
  });
  assert.equal(previews[ROOM_A]?.previewUrl, "signed:2d");
  assert.equal(previews[ROOM_A]?.source, "2d-thumbnail");
});

test("one room can fail without dropping the rest of the batch", async () => {
  const contexts: RoomPreviewBatchContext[] = [
    {
      roomId: ROOM_A,
      coverImageUrl: null,
      activeAsset: null,
      publishedPointer: null,
    },
    {
      roomId: ROOM_B,
      coverImageUrl: "https://cdn.example/cover-b.jpg",
      activeAsset: null,
      publishedPointer: null,
    },
  ];
  const previews = await resolveRoomPreviewBatch(contexts, async () => null, async (input) => {
    if (input.roomId === ROOM_A) throw new Error("bad pointer");
    return { previewUrl: "https://cdn.example/cover-b.jpg", source: "cover" };
  });
  assert.equal(previews[ROOM_A]?.previewUrl, null);
  assert.equal(previews[ROOM_B]?.previewUrl, "https://cdn.example/cover-b.jpg");
  assert.equal(previews[ROOM_B]?.source, "cover");
});

test("asset and pointer query failures still return durable previews for the owned rooms", async () => {
  const previews = await loadRoomPreviewBatch({
    userId: USER,
    roomIds: [ROOM_A, ROOM_B],
    listOwnedRooms: async () =>
      ok([
        room(ROOM_A, VERSION_A),
        { ...room(ROOM_B, null), cover_image_url: "https://cdn.example/cover-b.jpg" },
        room(ROOM_FOREIGN, VERSION_B, OTHER_USER),
      ]),
    listAssetsById: async () => ({ data: null, error: { message: "asset read failed" } }),
    listActiveAssets: async () => {
      throw new Error("active read failed");
    },
    listPointers: async () => {
      throw new Error("pointer read failed");
    },
    signTargets: async () => {
      throw new Error("sign failed");
    },
  });
  assert.equal(previews[ROOM_A]?.source, "cover");
  assert.equal(previews[ROOM_A]?.previewUrl, `https://cdn.example/covers/${ROOM_A}.jpg`);
  assert.equal(previews[ROOM_B]?.previewUrl, "https://cdn.example/cover-b.jpg");
  assert.equal(previews[ROOM_FOREIGN], undefined);
});

test("rooms missing an active asset id share one fallback query", async () => {
  let activeCalls = 0;
  const previews = await loadRoomPreviewBatch({
    userId: USER,
    roomIds: [ROOM_A],
    listOwnedRooms: async () => ok([room(ROOM_A, null)]),
    listAssetsById: async () => {
      throw new Error("should not load assets by id when none are referenced");
    },
    listActiveAssets: async (_userId, roomIds) => {
      activeCalls += 1;
      assert.deepEqual(roomIds, [ROOM_A]);
      return ok([
        asset({
          id: VERSION_A,
          roomId: ROOM_A,
          imageUrl: null,
          thumbnailPath: null,
          storagePath: "rooms/full.png",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
        asset({
          id: VERSION_B,
          roomId: ROOM_A,
          imageUrl: null,
          thumbnailPath: "rooms/new-thumb.webp",
          storagePath: "rooms/new.png",
          createdAt: "2026-03-01T00:00:00.000Z",
        }),
      ]);
    },
    listPointers: async () => new Map(),
    signTargets: async (targets) =>
      new Map(targets.map((target) => [previewObjectSignKey(target.bucket, target.storagePath), `signed:${target.storagePath}`])),
  });
  assert.equal(activeCalls, 1);
  assert.equal(previews[ROOM_A]?.source, "2d-thumbnail");
  assert.equal(previews[ROOM_A]?.previewUrl, "signed:rooms/new-thumb.webp");
});

test("pointer batch reads version ids once and skips a bad row", async () => {
  const pointer = pointerFor(ROOM_A, VERSION_A, TOKEN_A);
  const calls: { table: string; column?: string; values?: string[] }[] = [];
  const resolved = await listPublishedVibode3dThumbnails({
    versions: [
      { roomId: ROOM_A, versionId: VERSION_A },
      { roomId: ROOM_B, versionId: VERSION_B },
    ],
    supabase: {
      from(table: string) {
        calls.push({ table });
        return {
          select() {
            return {
              async in(column: string, values: readonly string[]) {
                calls.push({ table, column, values: [...values] });
                return {
                  error: null,
                  data: [
                    {
                      room_id: pointer.roomId,
                      version_id: pointer.versionId,
                      content_token: pointer.contentToken,
                      storage_bucket: pointer.storageBucket,
                      storage_path: pointer.storagePath,
                    },
                    {
                      room_id: ROOM_FOREIGN,
                      version_id: VERSION_B,
                      content_token: TOKEN_B,
                      storage_bucket: VIBODE_3D_THUMBNAIL_BUCKET,
                      storage_path: vibode3dThumbnailObjectPath(ROOM_B, VERSION_B, TOKEN_B),
                    },
                    { room_id: "bad" },
                  ],
                };
              },
            };
          },
        };
      },
    },
  });
  assert.deepEqual(
    calls.filter((call) => call.column),
    [{ table: "vibode_3d_thumbnail_pointers", column: "version_id", values: [VERSION_A, VERSION_B] }],
  );
  assert.equal(resolved.get(VERSION_A)?.storagePath, pointer.storagePath);
  assert.equal(resolved.has(VERSION_B), false);
  assert.equal(
    (
      await listPublishedVibode3dThumbnails({
        versions: [],
        supabase: {
          from() {
            throw new Error("empty batches must not query");
          },
        },
      })
    ).size,
    0,
  );
});

test("signed urls are reused per object and signed once per bucket chunk", async () => {
  const cache: SignedUrlReuseCache = new Map();
  const calls: { bucket: string; paths: string[] }[] = [];
  const createSignedUrls = async (bucket: string, paths: string[]) => {
    calls.push({ bucket, paths: [...paths] });
    return paths.map((storagePath) => ({
      path: storagePath,
      signedUrl: `https://cdn.example/sign/${bucket}/${storagePath}?token=one`,
      error: null,
    }));
  };
  const targets: RoomPreviewSignInput[] = [
    { bucket: "vibode-thumbnails", storagePath: "rooms/a.webp" },
    { bucket: "vibode-thumbnails", storagePath: "rooms/a.webp" },
    { bucket: "room-images", storagePath: "rooms/b.webp" },
    { bucket: "vibode-thumbnails", storagePath: "rooms/missing.webp" },
  ];
  const first = await signPreviewTargets({
    targets,
    expiresInSec: 60 * 60,
    nowMs: 1_000,
    cache,
    createSignedUrls: async (bucket, paths) => {
      const rows = await createSignedUrls(bucket, paths);
      return rows.map((row) =>
        row.path === "rooms/missing.webp" ? { ...row, signedUrl: null, error: "missing" } : row,
      );
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(first.get(previewObjectSignKey("vibode-thumbnails", "rooms/a.webp")), "https://cdn.example/sign/vibode-thumbnails/rooms/a.webp?token=one");
  assert.equal(first.has(previewObjectSignKey("vibode-thumbnails", "rooms/missing.webp")), false);

  calls.length = 0;
  const second = await signPreviewTargets({
    targets: [{ bucket: "vibode-thumbnails", storagePath: "rooms/a.webp" }],
    expiresInSec: 60 * 60,
    nowMs: 2_000,
    cache,
    createSignedUrls,
  });
  assert.equal(calls.length, 0);
  assert.equal(
    second.get(previewObjectSignKey("vibode-thumbnails", "rooms/a.webp")),
    first.get(previewObjectSignKey("vibode-thumbnails", "rooms/a.webp")),
  );

  const many = Array.from({ length: 150 }, (_value, index) => ({
    bucket: "room-images",
    storagePath: `rooms/${index}.webp`,
  }));
  await signPreviewTargets({
    targets: many,
    expiresInSec: 60,
    nowMs: 5_000,
    cache: new Map(),
    createSignedUrls,
  });
  const chunkCalls = calls.filter((call) => call.bucket === "room-images" && call.paths.length > 1);
  assert.deepEqual(
    chunkCalls.map((call) => call.paths.length),
    [ROOM_PREVIEW_BATCH_MAX, 50],
  );
});

test("listing batch route stays on owned rooms, pointer rows, and batched signing", () => {
  const route = source("app/api/vibode/room-preview-urls/route.ts");
  const loader = source("lib/vibode-room-preview/resolve-preview-batch.ts");
  const pointers = source("lib/vibode-room-preview/published-thumbnail.server.ts");
  const page = source("components/my-rooms/MyRoomsPage.tsx");
  assert.match(route, /parseRoomPreviewBatchRequest/);
  assert.match(route, /\.from\("vibode_rooms"\)/);
  assert.match(route, /\.eq\("user_id", userId\)/);
  assert.match(route, /\.in\("id", \[\.\.\.roomIds\]\)/);
  assert.match(route, /\.from\("vibode_room_assets"\)/);
  assert.match(route, /createSignedUrls/);
  assert.match(route, /listPublishedVibode3dThumbnails/);
  assert.doesNotMatch(route, /vibode_3d_scenes|vibode_3d_thumbnail_jobs|\.glb|WebGL|playwright|afc_generation/);
  assert.doesNotMatch(route, /\.map\(\s*async/);
  assert.doesNotMatch(loader, /vibode_3d_scenes|vibode_3d_thumbnail_jobs|\.glb|WebGL|playwright/);
  assert.match(pointers, /\.in\("version_id"/);
  assert.doesNotMatch(pointers, /vibode_3d_scenes|vibode_3d_thumbnail_jobs|afc_generation_id/);
  assert.match(page, /loadGenerationRef/);
  assert.doesNotMatch(page, /\[authLoading, user\]/);
  assert.doesNotMatch(source("components/my-rooms/RoomCard.tsx"), /next\/image/);
  assert.match(source("components/my-rooms/RoomCard.tsx"), /<img/);
});
