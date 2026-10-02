import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { encodeModelThumbnailWebp } from "./encode";
import { VIBODE_MODEL_THUMBNAIL_EDGE_PX } from "./frame";

test("a still is encoded to a square webp on a neutral background", async () => {
  const source = await sharp({
    create: { width: 40, height: 200, channels: 3, background: { r: 20, g: 40, b: 60 } },
  }).png().toBuffer();
  const webp = await encodeModelThumbnailWebp(source);
  assert.ok(webp);
  if (!webp) return;
  const meta = await sharp(webp).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, VIBODE_MODEL_THUMBNAIL_EDGE_PX);
  assert.equal(meta.height, VIBODE_MODEL_THUMBNAIL_EDGE_PX);
  assert.equal(await encodeModelThumbnailWebp(new Uint8Array([1, 2, 3])), null);
});
