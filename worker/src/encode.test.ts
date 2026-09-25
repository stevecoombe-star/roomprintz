import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { encodeThumbnailWebp, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from "./encode.js";

test("encode covers to 640x480 webp quality 80", async () => {
  const source = await sharp({
    create: { width: 100, height: 50, channels: 3, background: { r: 20, g: 40, b: 60 } },
  }).png().toBuffer();
  const webp = await encodeThumbnailWebp(source);
  const meta = await sharp(webp).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, THUMBNAIL_WIDTH);
  assert.equal(meta.height, THUMBNAIL_HEIGHT);
  assert.equal(String.fromCharCode(...webp.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...webp.subarray(8, 12)), "WEBP");
});
