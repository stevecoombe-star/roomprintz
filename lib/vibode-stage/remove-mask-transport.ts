/**
 * Bounded wire format for REMOVE identity masks.
 *
 * Downstream masks stay full-frame packed bits: index `y * width + x`,
 * least-significant bit first. The scan response sends only the tight
 * bounds and the bits inside that rectangle. Decoding rebuilds the same
 * full-frame `RemovePackedMask` before outlines, hit tests, unions, or
 * Clean Up export see it.
 *
 * Byte and pixel ceilings match the segmentation safeguards. A crop is
 * never allocated from an unvalidated length.
 */

import type { RemoveDirtyRect } from "@/lib/vibode-stage/remove-mask";
import {
  packRemoveMask,
  removePackedBit,
  type RemovePackedMask,
} from "@/lib/vibode-stage/remove-objects";

export const REMOVE_MASK_TRANSPORT_ENCODING = "bounded-bits/v1" as const;
export const REMOVE_MASK_TRANSPORT_MAX_EDGE = 8192;
export const REMOVE_MASK_TRANSPORT_MAX_PIXELS = 16_000_000;
export const REMOVE_MASK_TRANSPORT_MAX_BYTES = 3_000_000;

export type RemoveMaskTransport = Readonly<{
  encoding: typeof REMOVE_MASK_TRANSPORT_ENCODING;
  width: number;
  height: number;
  areaPx: number;
  bounds: RemoveDirtyRect;
  bits: string;
}>;

const EMPTY_BOUNDS: RemoveDirtyRect = { x: 0, y: 0, width: 0, height: 0 };

export function removeMaskTransportBytes(mask: RemovePackedMask): number | null {
  const crop = cropMaskBits(mask);
  if (crop === null) return null;
  return crop.byteLength;
}

export function encodeRemoveMaskTransport(mask: RemovePackedMask): RemoveMaskTransport | null {
  const crop = cropMaskBits(mask);
  if (crop === null) return null;
  const bits = encodeBase64(crop);
  if (bits === null) return null;
  return {
    encoding: REMOVE_MASK_TRANSPORT_ENCODING,
    width: mask.width,
    height: mask.height,
    areaPx: mask.areaPx,
    bounds: mask.areaPx === 0 ? EMPTY_BOUNDS : { ...mask.bounds },
    bits,
  };
}

/**
 * Rebuild the full-frame identity mask. `frame` is the known ORIGINAL size.
 * The payload cannot choose a larger allocation.
 */
export function decodeRemoveMaskTransport(
  value: unknown,
  frame: Readonly<{ width: number; height: number }>,
): RemovePackedMask | null {
  const record = objectRecord(value);
  if (!record || record.encoding !== REMOVE_MASK_TRANSPORT_ENCODING) return null;
  if (!sameFrame(record.width, record.height, frame)) return null;
  const width = frame.width;
  const height = frame.height;
  const pixels = width * height;
  const areaPx = integerInRange(record.areaPx, 0, pixels);
  if (areaPx === null) return null;
  const bounds = readBounds(record.bounds);
  if (!bounds) return null;
  if (areaPx === 0) {
    if (!emptyBounds(bounds) || record.bits !== "") return null;
    return packRemoveMask(new Uint8Array(pixels), width, height);
  }
  if (bounds.width < 1 || bounds.height < 1) return null;
  if (bounds.x + bounds.width > width || bounds.y + bounds.height > height) return null;
  const cropPixels = bounds.width * bounds.height;
  if (!Number.isSafeInteger(cropPixels) || cropPixels > pixels) return null;
  const expectedBytes = Math.ceil(cropPixels / 8);
  if (expectedBytes < 1 || expectedBytes > REMOVE_MASK_TRANSPORT_MAX_BYTES) return null;
  if (typeof record.bits !== "string") return null;
  const crop = decodeBase64Exact(record.bits, expectedBytes);
  if (!crop || popcount(crop) !== areaPx || unusedBitsSet(crop, cropPixels)) return null;
  if (!tightCrop(crop, bounds.width, bounds.height)) return null;

  const coverage = new Uint8Array(pixels);
  for (let row = 0; row < bounds.height; row += 1) {
    for (let column = 0; column < bounds.width; column += 1) {
      const local = row * bounds.width + column;
      if (!bitIsSet(crop, local)) continue;
      coverage[(bounds.y + row) * width + bounds.x + column] = 255;
    }
  }
  const packed = packRemoveMask(coverage, width, height);
  if (!packed || packed.areaPx !== areaPx) return null;
  if (
    packed.bounds.x !== bounds.x
    || packed.bounds.y !== bounds.y
    || packed.bounds.width !== bounds.width
    || packed.bounds.height !== bounds.height
  ) {
    return null;
  }
  return packed;
}

function cropMaskBits(mask: RemovePackedMask): Uint8Array | null {
  if (!frameGrid(mask.width, mask.height)) return null;
  const pixels = mask.width * mask.height;
  if (!(mask.bits instanceof Uint8Array)) return null;
  if (mask.bits.length !== Math.ceil(pixels / 8)) return null;
  if (!Number.isInteger(mask.areaPx) || mask.areaPx < 0 || mask.areaPx > pixels) return null;
  if (popcount(mask.bits) !== mask.areaPx || unusedBitsSet(mask.bits, pixels)) return null;
  const bounds = readBounds(mask.bounds);
  if (!bounds) return null;
  if (mask.areaPx === 0) return emptyBounds(bounds) ? new Uint8Array(0) : null;
  if (bounds.width < 1 || bounds.height < 1) return null;
  if (bounds.x + bounds.width > mask.width || bounds.y + bounds.height > mask.height) return null;
  const cropPixels = bounds.width * bounds.height;
  if (!Number.isSafeInteger(cropPixels) || cropPixels > pixels) return null;
  const expectedBytes = Math.ceil(cropPixels / 8);
  if (expectedBytes > REMOVE_MASK_TRANSPORT_MAX_BYTES) return null;

  if (
    bounds.x === 0
    && bounds.y === 0
    && bounds.width === mask.width
    && bounds.height === mask.height
  ) {
    return tightCrop(mask.bits, mask.width, mask.height) ? mask.bits : null;
  }

  const crop = new Uint8Array(expectedBytes);
  let count = 0;
  let minX = bounds.width;
  let minY = bounds.height;
  let maxX = 0;
  let maxY = 0;
  for (let row = 0; row < bounds.height; row += 1) {
    for (let column = 0; column < bounds.width; column += 1) {
      if (!removePackedBit(mask, bounds.x + column, bounds.y + row)) continue;
      writeBit(crop, row * bounds.width + column);
      count += 1;
      if (column < minX) minX = column;
      if (row < minY) minY = row;
      if (column + 1 > maxX) maxX = column + 1;
      if (row + 1 > maxY) maxY = row + 1;
    }
  }
  if (count !== mask.areaPx || minX !== 0 || minY !== 0 || maxX !== bounds.width || maxY !== bounds.height) {
    return null;
  }
  return crop;
}

function frameGrid(width: number, height: number): boolean {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width >= 1
    && height >= 1
    && width <= REMOVE_MASK_TRANSPORT_MAX_EDGE
    && height <= REMOVE_MASK_TRANSPORT_MAX_EDGE
    && width * height <= REMOVE_MASK_TRANSPORT_MAX_PIXELS;
}

function sameFrame(
  width: unknown,
  height: unknown,
  frame: Readonly<{ width: number; height: number }>,
): boolean {
  return frameGrid(frame.width, frame.height) && width === frame.width && height === frame.height;
}

function readBounds(value: unknown): RemoveDirtyRect | null {
  const record = objectRecord(value);
  if (!record) return null;
  const x = integerInRange(record.x, 0, REMOVE_MASK_TRANSPORT_MAX_EDGE);
  const y = integerInRange(record.y, 0, REMOVE_MASK_TRANSPORT_MAX_EDGE);
  const width = integerInRange(record.width, 0, REMOVE_MASK_TRANSPORT_MAX_EDGE);
  const height = integerInRange(record.height, 0, REMOVE_MASK_TRANSPORT_MAX_EDGE);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

function integerInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function emptyBounds(bounds: RemoveDirtyRect): boolean {
  return bounds.x === 0 && bounds.y === 0 && bounds.width === 0 && bounds.height === 0;
}

function tightCrop(bits: Uint8Array, width: number, height: number): boolean {
  if (width < 1 || height < 1) return false;
  return edgeHasBit(bits, width, height, "top")
    && edgeHasBit(bits, width, height, "bottom")
    && edgeHasBit(bits, width, height, "left")
    && edgeHasBit(bits, width, height, "right");
}

function edgeHasBit(
  bits: Uint8Array,
  width: number,
  height: number,
  edge: "top" | "bottom" | "left" | "right",
): boolean {
  if (edge === "top" || edge === "bottom") {
    const row = edge === "top" ? 0 : height - 1;
    for (let column = 0; column < width; column += 1) {
      if (bitIsSet(bits, row * width + column)) return true;
    }
    return false;
  }
  const column = edge === "left" ? 0 : width - 1;
  for (let row = 0; row < height; row += 1) {
    if (bitIsSet(bits, row * width + column)) return true;
  }
  return false;
}

function encodeBase64(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return "";
  if (bytes.byteLength > REMOVE_MASK_TRANSPORT_MAX_BYTES) return null;
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += stride) {
    const slice = bytes.subarray(offset, Math.min(bytes.byteLength, offset + stride));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function decodeBase64Exact(value: string, expectedBytes: number): Uint8Array | null {
  if (expectedBytes === 0) return value === "" ? new Uint8Array(0) : null;
  if (value.length !== base64Length(expectedBytes)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const remainder = expectedBytes % 3;
  if (remainder === 0 && padding !== 0) return null;
  if (remainder === 1 && padding !== 2) return null;
  if (remainder === 2 && padding !== 1) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }
  if (binary.length !== expectedBytes) return null;
  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Length(byteLength: number): number {
  return byteLength === 0 ? 0 : 4 * Math.ceil(byteLength / 3);
}

function unusedBitsSet(bits: Uint8Array, validBits: number): boolean {
  const leftover = validBits % 8;
  if (leftover === 0) return false;
  const last = bits[bits.length - 1] ?? 0;
  const unused = (~((1 << leftover) - 1)) & 0xff;
  return (last & unused) !== 0;
}

function popcount(bits: Uint8Array): number {
  let count = 0;
  for (const bite of bits) {
    let rest = bite;
    while (rest) {
      count += rest & 1;
      rest >>= 1;
    }
  }
  return count;
}

function writeBit(bits: Uint8Array, index: number): void {
  bits[index >> 3] = (bits[index >> 3] ?? 0) | (1 << (index & 7));
}

function bitIsSet(bits: Uint8Array, index: number): boolean {
  return ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
