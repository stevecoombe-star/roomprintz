/**
 * Authoritative reference-photo checks. Client width, height, and MIME
 * are ignored. Bytes are decoded on the server and never written to logs.
 *
 * Limits match Meshy Image to 3D and Multi-Image to 3D (docs.meshy.ai,
 * checked 2026-11-06) and the MESHY-1B browser checks.
 */

import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  MESHY_IMAGE_MAX_BYTES,
  MESHY_IMAGE_MAX_PIXELS,
  MESHY_IMAGE_MIN_EDGE_PX,
  type FurniturePhotoMime,
  type FurnitureViewSlot,
} from "@/lib/vibode-furniture/generator/images";

export type InspectedFurnitureImage = Readonly<{
  slot: FurnitureViewSlot;
  mimeType: FurniturePhotoMime;
  byteLength: number;
  widthPx: number;
  heightPx: number;
  sha256: string;
  bytes: Uint8Array;
}>;

export function furnitureImageDimensionIssue(input: Readonly<{
  widthPx: number;
  heightPx: number;
}>): string | null {
  if (
    !Number.isInteger(input.widthPx) ||
    !Number.isInteger(input.heightPx) ||
    input.widthPx < MESHY_IMAGE_MIN_EDGE_PX ||
    input.heightPx < MESHY_IMAGE_MIN_EDGE_PX
  ) {
    return "Each side of the photo must be at least 32 pixels.";
  }
  if (
    input.widthPx > MESHY_IMAGE_MAX_PIXELS ||
    input.heightPx > MESHY_IMAGE_MAX_PIXELS ||
    input.widthPx * input.heightPx > MESHY_IMAGE_MAX_PIXELS
  ) {
    return "This photo has too many pixels.";
  }
  return null;
}

export async function inspectFurnitureImage(input: Readonly<{
  slot: FurnitureViewSlot;
  bytes: Uint8Array;
}>): Promise<{ ok: true; image: InspectedFurnitureImage } | { ok: false; message: string }> {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength <= 0) {
    return { ok: false, message: "Choose a photo file." };
  }
  if (input.bytes.byteLength > MESHY_IMAGE_MAX_BYTES) {
    return { ok: false, message: "This photo is over 20 MB." };
  }
  const mimeType = magicImageMime(input.bytes);
  if (!mimeType) return { ok: false, message: "Use a JPEG, PNG, or WebP photo." };
  let widthPx: number | undefined;
  let heightPx: number | undefined;
  let format: string | undefined;
  try {
    const metadata = await sharp(input.bytes, { failOn: "error" }).rotate().metadata();
    widthPx = metadata.width;
    heightPx = metadata.height;
    format = metadata.format;
  } catch {
    return { ok: false, message: "Use a JPEG, PNG, or WebP photo." };
  }
  if (!widthPx || !heightPx || sharpFormat(mimeType) !== format) {
    return { ok: false, message: "Use a JPEG, PNG, or WebP photo." };
  }
  const dimensionIssue = furnitureImageDimensionIssue({ widthPx, heightPx });
  if (dimensionIssue) return { ok: false, message: dimensionIssue };
  return {
    ok: true,
    image: {
      slot: input.slot,
      mimeType,
      byteLength: input.bytes.byteLength,
      widthPx,
      heightPx,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      bytes: input.bytes,
    },
  };
}

export function imageDataUri(mimeType: FurniturePhotoMime, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function imageExtension(mimeType: FurniturePhotoMime): "jpg" | "png" | "webp" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function sharpFormat(mimeType: FurniturePhotoMime): "jpeg" | "png" | "webp" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpeg";
}

function magicImageMime(bytes: Uint8Array): FurniturePhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
