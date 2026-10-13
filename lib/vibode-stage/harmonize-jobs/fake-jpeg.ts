/**
 * Development JPEG for the Harmonize worker.
 * Pixels are drawn here and encoded in memory. Nothing in this module is
 * written into Git or sent to a provider.
 */

import sharp from "sharp";

import {
  HARMONIZE_NBP_OUTPUT_HEIGHT,
  HARMONIZE_NBP_OUTPUT_WIDTH,
} from "@/lib/vibode-stage/harmonize-nbp-proof";

export const HARMONIZE_FAKE_JPEG_COMMENT = "FAKE HARMONIZE QA";

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  F: ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

const cached = new Map<string, Promise<Uint8Array>>();

/**
 * Deterministic JPEG for one output size.
 * The no-argument call remains the verified 4:3 frame, 2400×1792.
 */
export function createHarmonizeFakeJpeg(
  width = HARMONIZE_NBP_OUTPUT_WIDTH,
  height = HARMONIZE_NBP_OUTPUT_HEIGHT,
): Promise<Uint8Array> {
  const key = `${width}x${height}`;
  const existing = cached.get(key);
  if (existing) return existing;
  const pending = encodeHarmonizeFakeJpeg(width, height).catch((error: unknown) => {
    cached.delete(key);
    throw error;
  });
  cached.set(key, pending);
  return pending;
}

async function encodeHarmonizeFakeJpeg(width: number, height: number): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) {
    throw new Error("Fake Harmonize JPEG size is not a positive frame.");
  }
  const encoded = await sharp(renderFakeRgb(width, height), {
    raw: { width, height, channels: 3 },
  }).jpeg({
    quality: 90,
    chromaSubsampling: "4:4:4",
    mozjpeg: false,
    progressive: false,
    optimiseCoding: false,
    trellisQuantisation: false,
    overshootDeringing: false,
    optimiseScans: false,
  }).toBuffer();
  return insertJpegComment(new Uint8Array(encoded), HARMONIZE_FAKE_JPEG_COMMENT);
}

function renderFakeRgb(width: number, height: number): Buffer {
  const rgb = fillFakePattern(width, height);
  if (width === HARMONIZE_NBP_OUTPUT_WIDTH && height === HARMONIZE_NBP_OUTPUT_HEIGHT) {
    fillRect(rgb, width, 80, 520, width - 80, 1680, [12, 12, 12]);
    paintText(rgb, width, "FAKE", 620, 56);
    paintText(rgb, width, "HARMONIZE", 1040, 40);
    paintText(rgb, width, "NOT A ROOM", 1380, 32);
    return rgb;
  }
  const lines = fitFakeLines(width, [
    ["FAKE", 56],
    ["HARMONIZE", 40],
    ["NOT A ROOM", 32],
  ]);
  const gap = 16;
  const block = lines.reduce((sum, line) => sum + line.height, 0) + gap * (lines.length - 1);
  let top = Math.max(36, Math.round((height - block) / 2));
  for (const line of lines) {
    paintText(rgb, width, line.text, top, line.scale);
    top += line.height + gap;
  }
  return rgb;
}

function fillFakePattern(width: number, height: number): Buffer {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const yBand = Math.floor(y / 64) % 2;
    const row = y * width * 3;
    for (let x = 0; x < width; x += 1) {
      const border = x < 32 || y < 32 || x >= width - 32 || y >= height - 32;
      const stripe = (Math.floor(x / 64) % 2) === yBand;
      const color = border ? [0, 196, 255] : stripe ? [255, 196, 0] : [18, 18, 18];
      const offset = row + x * 3;
      rgb[offset] = color[0] ?? 0;
      rgb[offset + 1] = color[1] ?? 0;
      rgb[offset + 2] = color[2] ?? 0;
    }
  }
  fillRect(rgb, width, 80, 520, width - 80, 1680, [12, 12, 12]);
  return rgb;
}

function fitFakeLines(
  imageWidth: number,
  lines: readonly (readonly [string, number])[],
): readonly Readonly<{ text: string; scale: number; height: number }>[] {
  const limit = Math.max(8, imageWidth - 64);
  return lines.map(([text, preferred]) => {
    let scale = preferred;
    while (scale > 2 && textWidth(text, scale) > limit) scale -= 1;
    return { text, scale, height: 7 * scale };
  });
}

function fillRect(
  rgb: Buffer,
  imageWidth: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: readonly [number, number, number],
): void {
  const left = Math.max(0, x0);
  const top = Math.max(0, y0);
  const right = Math.min(imageWidth, x1);
  const bottom = Math.min(rgb.length / (imageWidth * 3), y1);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * imageWidth + x) * 3;
      rgb[offset] = color[0];
      rgb[offset + 1] = color[1];
      rgb[offset + 2] = color[2];
    }
  }
}

function paintText(rgb: Buffer, imageWidth: number, text: string, top: number, scale: number): void {
  const width = textWidth(text, scale);
  const left = Math.round((imageWidth - width) / 2);
  let cursor = left;
  for (const character of text) {
    const glyph = GLYPHS[character];
    if (!glyph) continue;
    for (let row = 0; row < glyph.length; row += 1) {
      const bits = glyph[row] ?? "";
      for (let column = 0; column < bits.length; column += 1) {
        if (bits[column] !== "1") continue;
        fillRect(
          rgb,
          imageWidth,
          cursor + column * scale,
          top + row * scale,
          cursor + (column + 1) * scale,
          top + (row + 1) * scale,
          [255, 255, 255],
        );
      }
    }
    cursor += 6 * scale;
  }
}

function textWidth(text: string, scale: number): number {
  return Math.max(0, text.length * 6 * scale - scale);
}

function insertJpegComment(jpeg: Uint8Array, comment: string): Uint8Array {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("Fake Harmonize JPEG encoder did not return a JPEG.");
  }
  const text = new TextEncoder().encode(comment);
  const segment = new Uint8Array(4 + text.length);
  segment[0] = 0xff;
  segment[1] = 0xfe;
  const length = text.length + 2;
  segment[2] = (length >> 8) & 255;
  segment[3] = length & 255;
  segment.set(text, 4);
  const out = new Uint8Array(jpeg.length + segment.length);
  out[0] = 0xff;
  out[1] = 0xd8;
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}
