import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isVibodeWebp,
  renderVibode2dThumbnail,
  vibode2dThumbnailBucket,
} from "@/lib/vibodeAssetThumbnails";
import {
  VIBODE_2D_THUMBNAIL_BACKFILL_CACHE_MAX_AGE_SEC,
  type BackfillAsset,
  type BackfillStorage,
  type BackfillThumbnailUpdate,
  canonicalVibode2dThumbnailPath,
  createVibode2dThumbnailBackfillStorage,
  isAllowedVibodeRoomImageBucket,
  loadVibode2dThumbnailBackfillCandidates,
  runVibode2dThumbnailBackfill,
  selectBackfillCandidates,
  updateVibode2dThumbnailPath,
} from "@/lib/vibodeAssetThumbnailBackfill";

const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "44444444-4444-4444-8444-444444444444";
const ASSET_A = "22222222-2222-4222-8222-222222222222";
const ASSET_B = "33333333-3333-4333-8333-333333333333";
const ASSET_C = "66666666-6666-4666-8666-666666666666";
const USER = "55555555-5555-4555-8555-555555555555";
const SOURCE_BUCKET = "vibode-generations";
const SOURCE_PATH = "rooms/source.png";

function asset(overrides: Partial<BackfillAsset> = {}): BackfillAsset {
  return {
    id: ASSET_A,
    roomId: ROOM_A,
    userId: USER,
    assetType: "stage_output",
    isActive: true,
    isListingAsset: true,
    roomExists: true,
    storageBucket: SOURCE_BUCKET,
    storagePath: SOURCE_PATH,
    thumbnailStorageBucket: null,
    thumbnailStoragePath: null,
    width: 1264,
    height: 848,
    createdAt: "2026-03-20T00:00:00.000Z",
    ...overrides,
  };
}

async function sourcePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 1280,
      height: 960,
      channels: 3,
      background: { r: 12, g: 80, b: 40 },
    },
  }).png().toBuffer();
}

function memoryStorage(initial: Record<string, Buffer> = {}) {
  const objects = new Map<string, Buffer>(Object.entries(initial));
  const uploads: Array<{ bucket: string; path: string; upsert: boolean }> = [];
  const downloads: string[] = [];
  const updates: BackfillThumbnailUpdate[] = [];
  let thumbnailPath: string | null = null;

  const storage: BackfillStorage = {
    async stat(bucket, objectPath) {
      const bytes = objects.get(`${bucket}/${objectPath}`);
      return bytes ? { exists: true, bytes: bytes.byteLength } : { exists: false, bytes: null };
    },
    async download(bucket, objectPath) {
      downloads.push(`${bucket}/${objectPath}`);
      const bytes = objects.get(`${bucket}/${objectPath}`);
      return bytes ? Buffer.from(bytes) : null;
    },
    async uploadDerivative({ bucket, path: objectPath, bytes, upsert }) {
      uploads.push({ bucket, path: objectPath, upsert });
      objects.set(`${bucket}/${objectPath}`, Buffer.from(bytes));
      return "uploaded";
    },
  };

  return {
    objects,
    uploads,
    downloads,
    updates,
    storage,
    thumbnailPath: () => thumbnailPath,
    async updateThumbnail(update: BackfillThumbnailUpdate) {
      const key = `${update.thumbnailStorageBucket}/${update.thumbnailStoragePath}`;
      if (!objects.has(key)) throw new Error("db before upload");
      if (update.previousThumbnailPath !== thumbnailPath) return false;
      updates.push(update);
      thumbnailPath = update.thumbnailStoragePath;
      return true;
    },
    setThumbnailPath(value: string | null) {
      thumbnailPath = value;
    },
  };
}

test("candidate selection prioritizes listing assets and honors room, asset, and limit", () => {
  const listing = asset({ id: ASSET_A, isListingAsset: true, createdAt: "2026-03-01T00:00:00.000Z" });
  const active = asset({
    id: ASSET_B,
    roomId: ROOM_A,
    isListingAsset: false,
    isActive: true,
    createdAt: "2026-03-31T00:00:00.000Z",
  });
  const history = asset({
    id: ASSET_C,
    roomId: ROOM_B,
    isListingAsset: false,
    isActive: false,
    createdAt: "2026-03-30T00:00:00.000Z",
  });
  const selected = selectBackfillCandidates([history, active, listing], { limit: 2 });
  assert.equal(selected.candidates.length, 3);
  assert.deepEqual(selected.selected.map((entry) => entry.id), [ASSET_A, ASSET_B]);

  const oneRoom = selectBackfillCandidates([history, listing], { roomId: ROOM_B });
  assert.deepEqual(oneRoom.selected.map((entry) => entry.id), [ASSET_C]);

  const oneAsset = selectBackfillCandidates([history, listing], { assetId: ASSET_C });
  assert.deepEqual(oneAsset.candidates.map((entry) => entry.id), [ASSET_C]);
});

test("canonical thumbnail path is stable and source buckets stay closed", () => {
  assert.equal(canonicalVibode2dThumbnailPath(ROOM_A, ASSET_A), `${ROOM_A}/${ASSET_A}/thumb.webp`);
  assert.equal(canonicalVibode2dThumbnailPath("room", ASSET_A), null);
  assert.equal(isAllowedVibodeRoomImageBucket("vibode-generations"), true);
  assert.equal(isAllowedVibodeRoomImageBucket("vibode-base-images"), true);
  assert.equal(isAllowedVibodeRoomImageBucket("vibode-thumbnails"), false);
  assert.equal(isAllowedVibodeRoomImageBucket("public-images"), false);
});

test("dry-run reports the repair plan and performs no writes", async () => {
  const world = memoryStorage({ [`${SOURCE_BUCKET}/${SOURCE_PATH}`]: await sourcePng() });
  const report = await runVibode2dThumbnailBackfill({
    assets: [asset()],
    dryRun: true,
    storage: world.storage,
    updateThumbnail: world.updateThumbnail,
  });
  assert.equal(report.candidates, 1);
  assert.equal(report.scanned, 1);
  assert.equal(report.planned, 1);
  assert.equal(report.repaired, 0);
  assert.equal(report.dbUpdated, 0);
  assert.equal(report.results[0]?.reason, "null-thumbnail");
  assert.equal(report.results[0]?.sourceAvailable, true);
  assert.equal(report.results[0]?.targetPath, `${ROOM_A}/${ASSET_A}/thumb.webp`);
  assert.equal(world.uploads.length, 0);
  assert.equal(world.updates.length, 0);
  assert.equal(world.thumbnailPath(), null);
  assert.equal(world.downloads.length, 0);
});

test("a valid existing thumbnail is skipped", async () => {
  const thumb = `${vibode2dThumbnailBucket()}/${ROOM_A}/${ASSET_A}/thumb.webp`;
  const world = memoryStorage({
    [`${SOURCE_BUCKET}/${SOURCE_PATH}`]: await sourcePng(),
    [thumb]: Buffer.from("RIFF"),
  });
  world.setThumbnailPath(`${ROOM_A}/${ASSET_A}/thumb.webp`);
  const row = asset({
    thumbnailStorageBucket: vibode2dThumbnailBucket(),
    thumbnailStoragePath: `${ROOM_A}/${ASSET_A}/thumb.webp`,
  });
  const report = await runVibode2dThumbnailBackfill({
    assets: [row],
    dryRun: false,
    storage: world.storage,
    updateThumbnail: world.updateThumbnail,
  });
  assert.equal(report.skipped, 1);
  assert.equal(report.repaired, 0);
  assert.equal(world.uploads.length, 0);
  assert.equal(world.updates.length, 0);
  assert.equal(world.downloads.length, 0);
});

test("a null thumbnail is repaired from storage before the database update", async () => {
  const source = await sourcePng();
  const world = memoryStorage({ [`${SOURCE_BUCKET}/${SOURCE_PATH}`]: source });
  const report = await runVibode2dThumbnailBackfill({
    assets: [asset()],
    dryRun: false,
    storage: world.storage,
    updateThumbnail: world.updateThumbnail,
  });
  assert.equal(report.repaired, 1);
  assert.equal(report.dbUpdated, 1);
  assert.equal(report.results[0]?.reason, "null-thumbnail");
  assert.equal(world.uploads.length, 1);
  assert.equal(world.uploads[0]?.upsert, false);
  assert.equal(world.uploads[0]?.bucket, vibode2dThumbnailBucket());
  assert.equal(world.uploads[0]?.path, `${ROOM_A}/${ASSET_A}/thumb.webp`);
  assert.equal(world.thumbnailPath(), `${ROOM_A}/${ASSET_A}/thumb.webp`);
  assert.deepEqual(world.objects.get(`${SOURCE_BUCKET}/${SOURCE_PATH}`), source);
  const derivative = world.objects.get(`${vibode2dThumbnailBucket()}/${ROOM_A}/${ASSET_A}/thumb.webp`);
  assert.ok(derivative);
  assert.equal(isVibodeWebp(derivative), true);
  assert.equal(report.results[0]?.bytes?.derivativeWidth, 640);
  assert.equal(report.results[0]?.bytes?.derivativeHeight, 480);
  assert.equal(report.results[0]?.bytes?.sourceWidth, 1280);
  assert.equal(report.results[0]?.bytes?.sourceHeight, 960);
  assert.ok((report.results[0]?.bytes?.derivativeBytes ?? 0) < source.byteLength);
});

test("a database path with a missing object is repaired onto the deterministic path", async () => {
  const world = memoryStorage({ [`${SOURCE_BUCKET}/${SOURCE_PATH}`]: await sourcePng() });
  world.setThumbnailPath("legacy/missing.webp");
  const report = await runVibode2dThumbnailBackfill({
    assets: [asset({
      thumbnailStorageBucket: vibode2dThumbnailBucket(),
      thumbnailStoragePath: "legacy/missing.webp",
    })],
    dryRun: false,
    storage: world.storage,
    updateThumbnail: world.updateThumbnail,
  });
  assert.equal(report.repaired, 1);
  assert.equal(report.results[0]?.reason, "missing-object");
  assert.equal(world.updates[0]?.previousThumbnailPath, "legacy/missing.webp");
  assert.equal(world.updates[0]?.thumbnailStoragePath, `${ROOM_A}/${ASSET_A}/thumb.webp`);
  assert.equal(world.objects.has(`${SOURCE_BUCKET}/${SOURCE_PATH}`), true);
});

test("an existing canonical WebP is adopted without another upload", async () => {
  const derivative = await renderVibode2dThumbnail(await sourcePng());
  const key = `${vibode2dThumbnailBucket()}/${ROOM_A}/${ASSET_A}/thumb.webp`;
  const world = memoryStorage({ [key]: derivative });
  const before = Buffer.from(world.objects.get(key)!);
  const report = await runVibode2dThumbnailBackfill({
    assets: [asset()],
    dryRun: false,
    storage: world.storage,
    updateThumbnail: world.updateThumbnail,
  });
  assert.equal(report.objectReused, 1);
  assert.equal(report.dbUpdated, 1);
  assert.equal(world.uploads.length, 0);
  assert.deepEqual(world.objects.get(key), before);
  assert.equal(world.thumbnailPath(), `${ROOM_A}/${ASSET_A}/thumb.webp`);
});

test("a failed transform leaves the database and storage unchanged", async () => {
  const world = memoryStorage({
    [`${SOURCE_BUCKET}/${SOURCE_PATH}`]: Buffer.from("not-an-image"),
  });
  const report = await runVibode2dThumbnailBackfill({
    assets: [asset()],
    dryRun: false,
    storage: world.storage,
    updateThumbnail: world.updateThumbnail,
  });
  assert.equal(report.failed, 1);
  assert.equal(report.results[0]?.errorClass, "transform-failed");
  assert.equal(report.dbUpdated, 0);
  assert.equal(world.uploads.length, 0);
  assert.equal(world.thumbnailPath(), null);
  assert.equal(world.objects.has(`${vibode2dThumbnailBucket()}/${ROOM_A}/${ASSET_A}/thumb.webp`), false);
});

test("a database failure after upload does not claim the row was updated", async () => {
  const world = memoryStorage({ [`${SOURCE_BUCKET}/${SOURCE_PATH}`]: await sourcePng() });
  const report = await runVibode2dThumbnailBackfill({
    assets: [asset()],
    dryRun: false,
    storage: world.storage,
    updateThumbnail: async () => {
      throw new Error("db-update-failed");
    },
  });
  assert.equal(report.failed, 1);
  assert.equal(report.results[0]?.errorClass, "db-update-failed");
  assert.equal(report.dbUpdated, 0);
  assert.equal(world.uploads.length, 1);
  assert.equal(world.objects.has(`${vibode2dThumbnailBucket()}/${ROOM_A}/${ASSET_A}/thumb.webp`), true);
});

test("a second run skips the asset repaired by the first run", async () => {
  const world = memoryStorage({ [`${SOURCE_BUCKET}/${SOURCE_PATH}`]: await sourcePng() });
  const assets = [asset()];
  const first = await runVibode2dThumbnailBackfill({
    assets,
    dryRun: false,
    storage: world.storage,
    updateThumbnail: world.updateThumbnail,
  });
  assert.equal(first.repaired, 1);
  const repaired = asset({
    thumbnailStorageBucket: vibode2dThumbnailBucket(),
    thumbnailStoragePath: world.thumbnailPath(),
  });
  const derivative = Buffer.from(
    world.objects.get(`${vibode2dThumbnailBucket()}/${ROOM_A}/${ASSET_A}/thumb.webp`)!,
  );
  const second = await runVibode2dThumbnailBackfill({
    assets: [repaired],
    dryRun: false,
    storage: world.storage,
    updateThumbnail: world.updateThumbnail,
  });
  assert.equal(second.skipped, 1);
  assert.equal(second.repaired, 0);
  assert.equal(world.uploads.length, 1);
  assert.deepEqual(
    world.objects.get(`${vibode2dThumbnailBucket()}/${ROOM_A}/${ASSET_A}/thumb.webp`),
    derivative,
  );
});

test("single-asset targeting and the batch limit bound the scan", async () => {
  const source = await sourcePng();
  const world = memoryStorage({
    [`${SOURCE_BUCKET}/${SOURCE_PATH}`]: source,
    [`${SOURCE_BUCKET}/rooms/other.png`]: source,
  });
  const listing = asset({ id: ASSET_A, createdAt: "2026-03-01T00:00:00.000Z" });
  const history = asset({
    id: ASSET_B,
    roomId: ROOM_B,
    isListingAsset: false,
    isActive: false,
    storagePath: "rooms/other.png",
    createdAt: "2026-03-31T00:00:00.000Z",
  });
  const limited = await runVibode2dThumbnailBackfill({
    assets: [history, listing],
    dryRun: false,
    limit: 1,
    storage: world.storage,
    updateThumbnail: world.updateThumbnail,
  });
  assert.equal(limited.candidates, 2);
  assert.equal(limited.scanned, 1);
  assert.equal(limited.results[0]?.assetId, ASSET_A);
  assert.equal(world.thumbnailPath(), `${ROOM_A}/${ASSET_A}/thumb.webp`);
  assert.equal(world.objects.has(`${vibode2dThumbnailBucket()}/${ROOM_B}/${ASSET_B}/thumb.webp`), false);

  const targeted = await runVibode2dThumbnailBackfill({
    assets: [history, listing],
    dryRun: true,
    assetId: ASSET_B,
    storage: world.storage,
    updateThumbnail: world.updateThumbnail,
  });
  assert.equal(targeted.candidates, 1);
  assert.equal(targeted.results[0]?.assetId, ASSET_B);
  assert.equal(targeted.results[0]?.outcome, "planned");
  assert.equal(world.uploads.length, 1);
});

test("missing or untrusted source bytes do not change the row", async () => {
  const missing = memoryStorage();
  const missingReport = await runVibode2dThumbnailBackfill({
    assets: [asset()],
    dryRun: false,
    storage: missing.storage,
    updateThumbnail: missing.updateThumbnail,
  });
  assert.equal(missingReport.sourceMissing, 1);
  assert.equal(missingReport.dbUpdated, 0);
  assert.equal(missing.uploads.length, 0);

  const untrusted = memoryStorage({ [`public-images/${SOURCE_PATH}`]: await sourcePng() });
  const untrustedReport = await runVibode2dThumbnailBackfill({
    assets: [asset({ storageBucket: "public-images" })],
    dryRun: false,
    storage: untrusted.storage,
    updateThumbnail: untrusted.updateThumbnail,
  });
  assert.equal(untrustedReport.results[0]?.errorClass, "untrusted-bucket");
  assert.equal(untrusted.uploads.length, 0);
  assert.equal(untrusted.thumbnailPath(), null);
});

test("derivative upload uses a one-year cache lifetime and a guarded path update", async () => {
  const uploads: Array<{ options: { contentType: string; cacheControl: string; upsert: boolean } }> = [];
  const storage = createVibode2dThumbnailBackfillStorage({
    storage: {
      from() {
        return {
          async list() {
            return { data: [], error: null };
          },
          async download() {
            return { data: null, error: { message: "missing" } };
          },
          async upload(_path: string, _body: Buffer, options: { contentType: string; cacheControl: string; upsert: boolean }) {
            uploads.push({ options });
            return { error: null };
          },
        };
      },
    },
  });
  await storage.uploadDerivative({
    bucket: "vibode-thumbnails",
    path: `${ROOM_A}/${ASSET_A}/thumb.webp`,
    bytes: Buffer.from("RIFF....WEBP"),
    upsert: false,
  });
  assert.equal(uploads[0]?.options.contentType, "image/webp");
  assert.equal(uploads[0]?.options.cacheControl, String(VIBODE_2D_THUMBNAIL_BACKFILL_CACHE_MAX_AGE_SEC));
  assert.equal(uploads[0]?.options.upsert, false);
  assert.equal(VIBODE_2D_THUMBNAIL_BACKFILL_CACHE_MAX_AGE_SEC, 31536000);

  const calls: string[] = [];
  const writer = {
    from() {
      const api = {
        update() {
          calls.push("update");
          return api;
        },
        eq(column: string, value: string) {
          calls.push(`eq:${column}:${value}`);
          return api;
        },
        is(column: string, value: null) {
          calls.push(`is:${column}:${String(value)}`);
          return api;
        },
        select() {
          return Promise.resolve({ data: [{ id: ASSET_A }], error: null });
        },
      };
      return api;
    },
  };
  const updated = await updateVibode2dThumbnailPath(writer as unknown as SupabaseClient, {
    assetId: ASSET_A,
    roomId: ROOM_A,
    userId: USER,
    previousThumbnailPath: null,
    thumbnailStorageBucket: "vibode-thumbnails",
    thumbnailStoragePath: `${ROOM_A}/${ASSET_A}/thumb.webp`,
  });
  assert.equal(updated, true);
  assert.ok(calls.includes("is:thumbnail_storage_path:null"));
  assert.ok(calls.includes(`eq:id:${ASSET_A}`));
  assert.ok(calls.includes(`eq:room_id:${ROOM_A}`));
  assert.ok(calls.includes(`eq:user_id:${USER}`));
});

test("candidate loading marks the current room asset and defaults to null thumbnails", async () => {
  const calls: string[] = [];
  const tables: Record<string, Record<string, unknown>[]> = {
    vibode_room_assets: [
      {
        id: ASSET_A,
        room_id: ROOM_A,
        user_id: USER,
        asset_type: "base",
        is_active: true,
        storage_bucket: SOURCE_BUCKET,
        storage_path: SOURCE_PATH,
        thumbnail_storage_bucket: null,
        thumbnail_storage_path: null,
        width: 100,
        height: 80,
        created_at: "2026-03-22T00:00:00.000Z",
      },
      {
        id: ASSET_B,
        room_id: ROOM_A,
        user_id: USER,
        asset_type: "stage_output",
        is_active: false,
        storage_bucket: SOURCE_BUCKET,
        storage_path: "rooms/old.png",
        thumbnail_storage_bucket: "vibode-thumbnails",
        thumbnail_storage_path: "already.webp",
        width: null,
        height: null,
        created_at: "2026-03-21T00:00:00.000Z",
      },
    ],
    vibode_rooms: [{ id: ROOM_A, active_asset_id: ASSET_A }],
  };
  const supabase = {
    from(table: string) {
      let rows = (tables[table] ?? []).slice();
      const api = {
        select() {
          calls.push(`${table}:select`);
          return api;
        },
        eq(column: string, value: unknown) {
          calls.push(`${table}:eq:${column}`);
          rows = rows.filter((row) => row[column] === value);
          return api;
        },
        is(column: string, value: null) {
          calls.push(`${table}:is:${column}`);
          rows = rows.filter((row) => row[column] === value);
          return api;
        },
        in() {
          return api;
        },
        order() {
          return api;
        },
        range(from: number, to: number) {
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return api;
    },
  };
  const loaded = await loadVibode2dThumbnailBackfillCandidates(supabase as unknown as SupabaseClient, {});
  assert.deepEqual(loaded.map((entry) => entry.id), [ASSET_A]);
  assert.equal(loaded[0]?.isListingAsset, true);
  assert.ok(calls.includes("vibode_room_assets:is:thumbnail_storage_path"));

  calls.length = 0;
  const targeted = await loadVibode2dThumbnailBackfillCandidates(supabase as unknown as SupabaseClient, {
    assetId: ASSET_B,
  });
  assert.equal(targeted[0]?.id, ASSET_B);
  assert.equal(targeted[0]?.isListingAsset, false);
  assert.equal(calls.includes("vibode_room_assets:is:thumbnail_storage_path"), false);
});

test("thumbnail backfill stays outside the listing preview path", () => {
  const root = process.cwd();
  const preview = readFileSync(path.join(root, "lib/vibode-room-preview/resolve-preview.ts"), "utf8");
  const batch = readFileSync(path.join(root, "app/api/vibode/room-preview-urls/route.ts"), "utf8");
  const card = readFileSync(path.join(root, "components/my-rooms/RoomCard.tsx"), "utf8");
  assert.doesNotMatch(preview, /vibodeAssetThumbnailBackfill|renderVibode2dThumbnail/);
  assert.doesNotMatch(batch, /vibodeAssetThumbnailBackfill|renderVibode2dThumbnail/);
  assert.doesNotMatch(card, /vibodeAssetThumbnailBackfill|thumbnail_storage_path/);
});
