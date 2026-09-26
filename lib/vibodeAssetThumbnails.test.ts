import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  VIBODE_2D_THUMBNAIL_HEIGHT_PX,
  VIBODE_2D_THUMBNAIL_WEBP_QUALITY,
  VIBODE_2D_THUMBNAIL_WIDTH_PX,
  createVibodeAssetThumbnail,
  isVibodeWebp,
  renderVibode2dThumbnail,
  vibode2dThumbnailObjectPath,
} from "@/lib/vibodeAssetThumbnails";

const ROOM = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 24, g: 96, b: 180 },
    },
  }).png().toBuffer();
}

test("2D thumbnail derivative is a covered WebP at the canonical size", async () => {
  assert.equal(VIBODE_2D_THUMBNAIL_WIDTH_PX, 640);
  assert.equal(VIBODE_2D_THUMBNAIL_HEIGHT_PX, 480);
  assert.equal(VIBODE_2D_THUMBNAIL_WEBP_QUALITY, 80);

  const derivative = await renderVibode2dThumbnail(await png(1280, 960));
  const metadata = await sharp(derivative).metadata();
  assert.equal(isVibodeWebp(derivative), true);
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 480);

  const covered = await renderVibode2dThumbnail(await png(2000, 1000));
  const coveredMeta = await sharp(covered).metadata();
  assert.equal(coveredMeta.width, 640);
  assert.equal(coveredMeta.height, 480);

  const small = await renderVibode2dThumbnail(await png(100, 80));
  const smallMeta = await sharp(small).metadata();
  assert.equal(smallMeta.width, 100);
  assert.equal(smallMeta.height, 80);
});

test("2D thumbnail rendering applies EXIF orientation before resize", async () => {
  const landscape = await sharp({
    create: {
      width: 30,
      height: 10,
      channels: 3,
      background: { r: 200, g: 20, b: 20 },
    },
  }).jpeg().toBuffer();
  const oriented = await sharp(landscape).withMetadata({ orientation: 6 }).toBuffer();
  const derivative = await renderVibode2dThumbnail(oriented);
  const metadata = await sharp(derivative).metadata();
  assert.equal(metadata.width, 10);
  assert.equal(metadata.height, 30);
});

test("thumbnail object path is deterministic for a room asset", () => {
  const first = vibode2dThumbnailObjectPath(ROOM, ASSET);
  const second = vibode2dThumbnailObjectPath(ROOM, ASSET);
  assert.equal(first, second);
  assert.equal(first, `${ROOM}/${ASSET}/thumb.webp`);
});

test("live thumbnail upload reuses the shared derivative and does not set a long cache lifetime", async () => {
  const source = await png(800, 600);
  const uploads: Array<{ bucket: string; path: string; bytes: Buffer; options: { contentType?: string; upsert?: boolean; cacheControl?: string } }> = [];
  const admin = {
    storage: {
      from(bucket: string) {
        return {
          async download() {
            return { data: new Blob([new Uint8Array(source)]), error: null };
          },
          async upload(
            path: string,
            bytes: Buffer,
            options: { contentType?: string; upsert?: boolean; cacheControl?: string },
          ) {
            uploads.push({ bucket, path, bytes: Buffer.from(bytes), options });
            return { error: null };
          },
        };
      },
    },
  };

  const location = await createVibodeAssetThumbnail({
    adminSupabase: admin as never,
    roomId: ROOM,
    assetId: ASSET,
    sourceStorageBucket: "vibode-generations",
    sourceStoragePath: "rooms/source.png",
  });

  assert.equal(location?.thumbnail_storage_bucket, "vibode-thumbnails");
  assert.equal(location?.thumbnail_storage_path, `${ROOM}/${ASSET}/thumb.webp`);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0]?.bucket, "vibode-thumbnails");
  assert.equal(uploads[0]?.options.contentType, "image/webp");
  assert.equal(uploads[0]?.options.upsert, true);
  assert.equal(uploads[0]?.options.cacheControl, undefined);
  assert.equal(isVibodeWebp(uploads[0]?.bytes ?? Buffer.alloc(0)), true);
  const metadata = await sharp(uploads[0]!.bytes).metadata();
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 480);
});

test("live thumbnail creation can still read a data URL when storage bytes are absent", async () => {
  const source = await png(640, 480);
  const uploads: string[] = [];
  const admin = {
    storage: {
      from() {
        return {
          async download() {
            return { data: null, error: { message: "missing" } };
          },
          async upload(path: string) {
            uploads.push(path);
            return { error: null };
          },
        };
      },
    },
  };

  const location = await createVibodeAssetThumbnail({
    adminSupabase: admin as never,
    roomId: ROOM,
    assetId: ASSET,
    sourceImageUrl: `data:image/png;base64,${source.toString("base64")}`,
  });
  assert.equal(location?.thumbnail_storage_path, `${ROOM}/${ASSET}/thumb.webp`);
  assert.deepEqual(uploads, [`${ROOM}/${ASSET}/thumb.webp`]);
});
