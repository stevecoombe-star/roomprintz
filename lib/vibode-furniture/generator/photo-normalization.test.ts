import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { boundStillImageToJpeg } from "@/lib/boundStillImageToJpeg";
import { convertHeicBufferToBoundedJpeg, convertHeicBufferToJpeg, HeicConversionError } from "@/lib/heicServerConversion";
import { detectStillMagic } from "@/lib/stillImageKind";
import {
  FURNITURE_JPEG_MATTE,
  FURNITURE_PHOTO_MAX_DECODED_PIXELS,
  FURNITURE_PHOTO_MAX_EDGE_PX,
  FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  FURNITURE_PHOTO_MIN_EDGE_PX,
} from "@/lib/vibode-furniture/generator/photo-limits";

const LIMITS = {
  maxEdgePx: FURNITURE_PHOTO_MAX_EDGE_PX,
  maxBytes: FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  maxInputPixels: FURNITURE_PHOTO_MAX_DECODED_PIXELS,
  minEdgePx: FURNITURE_PHOTO_MIN_EDGE_PX,
  background: FURNITURE_JPEG_MATTE,
};

test("an already valid JPEG is not compressed again", async () => {
  const jpeg = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "#226644" },
  }).jpeg().toBuffer();
  const bounded = await boundStillImageToJpeg(jpeg, LIMITS);
  assert.equal(bounded.recompressed, false);
  assert.equal(bounded.width, 64);
  assert.equal(bounded.height, 48);
  assert.deepEqual(Buffer.from(bounded.bytes), jpeg);
});

test("EXIF rotation is baked, large photos keep their aspect, and WebP becomes JPEG", async () => {
  const oriented = await sharp({
    create: { width: 48, height: 96, channels: 3, background: "#2244aa" },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const turned = await boundStillImageToJpeg(oriented, LIMITS);
  assert.equal(turned.recompressed, true);
  assert.equal(turned.width, 96);
  assert.equal(turned.height, 48);
  assert.ok(turned.bytes.byteLength <= FURNITURE_PHOTO_MAX_OUTPUT_BYTES);
  const meta = await sharp(turned.bytes).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok(meta.orientation == null || meta.orientation === 1);

  const wide = await sharp({
    create: { width: 3000, height: 1200, channels: 3, background: "#886644" },
  }).jpeg().toBuffer();
  const fitted = await boundStillImageToJpeg(wide, LIMITS);
  assert.equal(fitted.recompressed, true);
  assert.ok(Math.max(fitted.width, fitted.height) <= 2048);
  assert.ok(Math.abs(fitted.width / fitted.height - 2.5) < 0.02);
  assert.ok(fitted.bytes.byteLength <= FURNITURE_PHOTO_MAX_OUTPUT_BYTES);

  const webp = await sharp({
    create: { width: 40, height: 50, channels: 3, background: "#abcdef" },
  }).webp().toBuffer();
  const fromWebp = await boundStillImageToJpeg(webp, LIMITS);
  assert.equal(detectStillMagic(fromWebp.bytes), "jpeg");
  assert.equal(fromWebp.width, 40);
  assert.equal(fromWebp.height, 50);
});

test("transparent PNG pixels become opaque white and covered pixels keep their color", async () => {
  const raw = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const offset = (y * 32 + x) * 4;
      if (x < 16) {
        raw[offset + 3] = 0;
      } else {
        raw[offset] = 220;
        raw[offset + 1] = 20;
        raw[offset + 2] = 20;
        raw[offset + 3] = 255;
      }
    }
  }
  const png = await sharp(raw, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer();
  const bounded = await boundStillImageToJpeg(png, LIMITS);
  assert.equal(detectStillMagic(bounded.bytes), "jpeg");
  assert.equal(bounded.width, 32);
  assert.equal(bounded.height, 32);
  const pixels = await sharp(bounded.bytes).removeAlpha().raw().toBuffer();
  const left = [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0];
  const rightIndex = 16 * 3;
  const right = [pixels[rightIndex] ?? 0, pixels[rightIndex + 1] ?? 0, pixels[rightIndex + 2] ?? 0];
  assert.ok(left.every((channel) => channel > 240), `transparent pixel ${left.join(",")}`);
  assert.ok(right[0] > 180 && right[1] < 60 && right[2] < 60, `red pixel ${right.join(",")}`);
});

test("real Apple HEIC fixtures become upright JPEGs inside the submission contract", async () => {
  const root = process.cwd();
  const portrait = readFileSync(path.join(root, "lib/vibode-furniture/generator/fixtures/apple-sips-48x64.heic"));
  const oriented = readFileSync(path.join(root, "lib/vibode-furniture/generator/fixtures/apple-sips-oriented.heic"));
  const legacy = await convertHeicBufferToJpeg({ inputBuffer: portrait });
  assert.equal(detectStillMagic(legacy.outputBuffer), "jpeg");
  assert.ok(legacy.outputBuffer.byteLength > 100);

  const first = await convertHeicBufferToBoundedJpeg(portrait, LIMITS);
  assert.equal(first.width, 48);
  assert.equal(first.height, 64);
  assert.equal(detectStillMagic(first.bytes), "jpeg");
  assert.ok(first.bytes.byteLength <= FURNITURE_PHOTO_MAX_OUTPUT_BYTES);
  if (!first.recompressed) {
    const convert = (await import("heic-convert")).default as (args: {
      buffer: Uint8Array;
      format: "JPEG";
      quality: number;
    }) => Promise<Uint8Array | ArrayBuffer>;
    const fallback = await convert({ buffer: portrait, format: "JPEG", quality: 0.92 });
    const fallbackBytes = fallback instanceof Uint8Array ? fallback : new Uint8Array(fallback);
    assert.deepEqual(Buffer.from(first.bytes), Buffer.from(fallbackBytes));
  }

  const second = await convertHeicBufferToBoundedJpeg(oriented, LIMITS);
  assert.equal(second.width, 96);
  assert.equal(second.height, 48);
  assert.equal(detectStillMagic(second.bytes), "jpeg");

  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
  }).png().toBuffer();
  await assert.rejects(() => convertHeicBufferToBoundedJpeg(png, LIMITS), (error: unknown) => {
    assert.ok(error instanceof HeicConversionError);
    assert.equal(error.code, "INVALID_HEIC_INPUT");
    return true;
  });

  const corrupt = new Uint8Array(64);
  corrupt.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  await assert.rejects(() => convertHeicBufferToBoundedJpeg(corrupt, LIMITS), (error: unknown) => {
    assert.ok(error instanceof HeicConversionError);
    return true;
  });
});
