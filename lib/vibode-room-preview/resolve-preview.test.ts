import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { VIBODE_3D_THUMBNAIL_BUCKET, vibode3dThumbnailObjectPath } from "@/lib/vibode-thumbnail-jobs/policy";
import { resolvePublishedVibode3dThumbnail } from "@/lib/vibode-room-preview/published-thumbnail.server";
import type { PublishedVibode3dThumbnailPointer } from "@/lib/vibode-room-preview/published-thumbnail";
import { resolveRoomPreviewUrl, type RoomPreviewAsset } from "@/lib/vibode-room-preview/resolve-preview";

const ROOM = "11111111-1111-4111-8111-111111111111";
const VERSION_A = "22222222-2222-4222-8222-222222222222";
const VERSION_B = "33333333-3333-4333-8333-333333333333";
const OTHER_ROOM = "44444444-4444-4444-8444-444444444444";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

const ROOT = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function asset(overrides: Partial<RoomPreviewAsset> = {}): RoomPreviewAsset {
  return {
    id: VERSION_A,
    imageUrl: "https://cdn.example/rooms/full.jpg",
    storageBucket: "room-images",
    storagePath: "rooms/full.png",
    thumbnailStorageBucket: "room-images",
    thumbnailStoragePath: "rooms/thumb.jpg",
    ...overrides,
  };
}

function pointerFor(
  roomId: string,
  versionId: string,
  token: string,
): PublishedVibode3dThumbnailPointer {
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

function signer(urls: Record<string, string | null>) {
  const calls: string[] = [];
  return {
    calls,
    sign: async (input: { bucket: string; storagePath: string }) => {
      const key = `${input.bucket}:${input.storagePath}`;
      calls.push(key);
      return Object.prototype.hasOwnProperty.call(urls, key) ? urls[key] : `signed:${key}`;
    },
  };
}

test("published pointer for the active version wins over the 2D thumbnail", async () => {
  const pointer = pointerFor(ROOM, VERSION_A, TOKEN_A);
  const signed = signer({});
  const previewUrl = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: "https://cdn.example/cover.jpg",
    activeAsset: asset(),
    publishedPointer: pointer,
    signStorageUrl: signed.sign,
  });
  assert.equal(previewUrl, `signed:${pointer.storageBucket}:${pointer.storagePath}`);
  assert.deepEqual(signed.calls, [`${pointer.storageBucket}:${pointer.storagePath}`]);
});

test("no pointer keeps the existing 2D thumbnail", async () => {
  const signed = signer({});
  const previewUrl = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset(),
    publishedPointer: null,
    signStorageUrl: signed.sign,
  });
  assert.equal(previewUrl, "signed:room-images:rooms/thumb.jpg");
  assert.deepEqual(signed.calls, ["room-images:rooms/thumb.jpg"]);
});

test("pointer signing failure falls back to the 2D thumbnail", async () => {
  const pointer = pointerFor(ROOM, VERSION_A, TOKEN_A);
  const signed = signer({
    [`${pointer.storageBucket}:${pointer.storagePath}`]: null,
  });
  const previewUrl = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset(),
    publishedPointer: pointer,
    signStorageUrl: signed.sign,
  });
  assert.equal(previewUrl, "signed:room-images:rooms/thumb.jpg");
});

test("a pointer for a non-active version is ignored", async () => {
  const previewUrl = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset({ id: VERSION_B }),
    publishedPointer: pointerFor(ROOM, VERSION_A, TOKEN_A),
    signStorageUrl: async () => "signed:room-images:rooms/b-thumb.jpg",
  });
  assert.equal(previewUrl, "signed:room-images:rooms/b-thumb.jpg");
});

test("a pointer whose room does not match the owned room is ignored", async () => {
  const previewUrl = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset(),
    publishedPointer: pointerFor(OTHER_ROOM, VERSION_A, TOKEN_A),
    signStorageUrl: async () => "signed:room-images:rooms/thumb.jpg",
  });
  assert.equal(previewUrl, "signed:room-images:rooms/thumb.jpg");
});

test("no 3D pointer and no 2D derivative keeps durable then full-image fallback", async () => {
  const durable = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: "https://cdn.example/cover.jpg",
    activeAsset: asset({
      thumbnailStorageBucket: null,
      thumbnailStoragePath: null,
    }),
    publishedPointer: null,
    signStorageUrl: async () => "signed:room-images:rooms/full.png",
  });
  assert.equal(durable, "https://cdn.example/rooms/full.jpg");

  const signedFull = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: "https://cdn.example/cover.jpg",
    activeAsset: asset({
      imageUrl: null,
      thumbnailStorageBucket: null,
      thumbnailStoragePath: null,
    }),
    publishedPointer: null,
    signStorageUrl: async () => "signed:room-images:rooms/full.png",
  });
  assert.equal(signedFull, "signed:room-images:rooms/full.png");

  const cover = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: "https://cdn.example/cover.jpg",
    activeAsset: asset({
      imageUrl: "https://cdn.example/expired?token=abc",
      storageBucket: null,
      storagePath: null,
      thumbnailStorageBucket: null,
      thumbnailStoragePath: null,
    }),
    publishedPointer: null,
    signStorageUrl: async () => null,
  });
  assert.equal(cover, "https://cdn.example/cover.jpg");
});

test("a cleared pointer falls back to the 2D thumbnail", async () => {
  const previewUrl = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset(),
    publishedPointer: null,
    signStorageUrl: async () => "signed:room-images:rooms/thumb.jpg",
  });
  assert.equal(previewUrl, "signed:room-images:rooms/thumb.jpg");
});

test("an existing pointer stays the display authority without a job read", async () => {
  const pointer = pointerFor(ROOM, VERSION_A, TOKEN_A);
  const previewUrl = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset(),
    publishedPointer: pointer,
    signStorageUrl: async () => "signed:3d",
  });
  assert.equal(previewUrl, "signed:3d");
  const selector = source("lib/vibode-room-preview/resolve-preview.ts");
  assert.doesNotMatch(selector, /vibode_3d_thumbnail_jobs|vibode_3d_scenes/);
});

test("switching the active version uses only that version's pointer", async () => {
  const pointerA = pointerFor(ROOM, VERSION_A, TOKEN_A);
  const showA = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset({ id: VERSION_A, thumbnailStoragePath: "rooms/a-thumb.jpg" }),
    publishedPointer: pointerA,
    signStorageUrl: async (input) => `signed:${input.storagePath}`,
  });
  assert.equal(showA, `signed:${pointerA.storagePath}`);

  const showB = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset({ id: VERSION_B, thumbnailStoragePath: "rooms/b-thumb.jpg" }),
    publishedPointer: pointerA,
    signStorageUrl: async (input) => `signed:${input.storagePath}`,
  });
  assert.equal(showB, "signed:rooms/b-thumb.jpg");

  const pointerB = pointerFor(ROOM, VERSION_B, TOKEN_B);
  const showPublishedB = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset({ id: VERSION_B, thumbnailStoragePath: "rooms/b-thumb.jpg" }),
    publishedPointer: pointerB,
    signStorageUrl: async (input) => `signed:${input.storagePath}`,
  });
  assert.equal(showPublishedB, `signed:${pointerB.storagePath}`);

  const showAAgain = await resolveRoomPreviewUrl({
    preferThumbnail: true,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset({ id: VERSION_A, thumbnailStoragePath: "rooms/a-thumb.jpg" }),
    publishedPointer: pointerA,
    signStorageUrl: async (input) => `signed:${input.storagePath}`,
  });
  assert.equal(showAAgain, `signed:${pointerA.storagePath}`);
});

test("editor preview requests skip thumbnail derivatives", async () => {
  const pointer = pointerFor(ROOM, VERSION_A, TOKEN_A);
  const signed = signer({});
  const previewUrl = await resolveRoomPreviewUrl({
    preferThumbnail: false,
    roomId: ROOM,
    coverImageUrl: null,
    activeAsset: asset(),
    publishedPointer: pointer,
    signStorageUrl: signed.sign,
  });
  assert.equal(previewUrl, "https://cdn.example/rooms/full.jpg");
  assert.deepEqual(signed.calls, []);
});

test("pointer lookup matches room and version and ignores other tables", async () => {
  const tables: string[] = [];
  const filters: string[] = [];
  const pointer = pointerFor(ROOM, VERSION_A, TOKEN_A);
  const resolved = await resolvePublishedVibode3dThumbnail({
    roomId: ROOM,
    versionId: VERSION_A,
    supabase: {
      from(table: string) {
        tables.push(table);
        return {
          select() {
            return {
              eq(column: string, value: string) {
                filters.push(`${column}=${value}`);
                return this;
              },
              maybeSingle: async () => ({
                data: {
                  room_id: pointer.roomId,
                  version_id: pointer.versionId,
                  content_token: pointer.contentToken,
                  storage_bucket: pointer.storageBucket,
                  storage_path: pointer.storagePath,
                  afc_generation_id: "should-not-be-required",
                },
                error: null,
              }),
            };
          },
        };
      },
    },
  });
  assert.deepEqual(tables, ["vibode_3d_thumbnail_pointers"]);
  assert.deepEqual(filters, [`room_id=${ROOM}`, `version_id=${VERSION_A}`]);
  assert.equal(resolved?.storagePath, pointer.storagePath);
});

test("pointer lookup fails closed on a room or version mismatch and on query errors", async () => {
  const mismatch = await resolvePublishedVibode3dThumbnail({
    roomId: ROOM,
    versionId: VERSION_A,
    supabase: {
      from() {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              maybeSingle: async () => ({
                data: {
                  room_id: OTHER_ROOM,
                  version_id: VERSION_A,
                  content_token: TOKEN_A,
                  storage_bucket: VIBODE_3D_THUMBNAIL_BUCKET,
                  storage_path: vibode3dThumbnailObjectPath(ROOM, VERSION_A, TOKEN_A),
                },
                error: null,
              }),
            };
          },
        };
      },
    },
  });
  assert.equal(mismatch, null);

  const failed = await resolvePublishedVibode3dThumbnail({
    roomId: ROOM,
    versionId: VERSION_A,
    supabase: {
      from() {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              maybeSingle: async () => ({ data: null, error: { message: "permission denied" } }),
            };
          },
        };
      },
    },
  });
  assert.equal(failed, null);
  assert.equal(await resolvePublishedVibode3dThumbnail({
    roomId: ROOM,
    versionId: VERSION_A,
    supabase: null,
  }), null);
});

test("listing still uses one preview request and does not query pointer state in the browser", () => {
  const page = source("components/my-rooms/MyRoomsPage.tsx");
  const card = source("components/my-rooms/RoomCard.tsx");
  const route = source("app/api/vibode/room-preview-url/route.ts");
  const resolver = source("lib/vibode-room-preview/published-thumbnail.server.ts");
  const fetches = page.match(/fetch\(\s*"([^"]+)"/g) ?? [];
  assert.deepEqual(fetches, ['fetch("/api/vibode/room-preview-url"']);
  assert.equal(page.match(/fetchPreviewUrlForRoom\(/g)?.length, 3);
  assert.doesNotMatch(page, /vibode_3d_thumbnail_pointers|3d-thumbnail/);
  assert.doesNotMatch(card, /fetch\(|vibode_3d|thumbnail_pointer|supabase/);
  assert.match(route, /resolvePublishedVibode3dThumbnail/);
  assert.match(route, /previewUrl/);
  assert.doesNotMatch(route, /vibode_3d_scenes|vibode_3d_thumbnail_jobs|\.glb|playwright|chromium|WebGL/);
  assert.doesNotMatch(resolver, /vibode_3d_scenes|vibode_3d_thumbnail_jobs|afc_generation_id/);
  assert.match(route, /PREVIEW_SIGNED_URL_EXPIRES_IN_SEC/);
  assert.match(route, /\.eq\("id", roomId\)/);
  assert.match(route, /\.eq\("user_id", userId\)/);
});
