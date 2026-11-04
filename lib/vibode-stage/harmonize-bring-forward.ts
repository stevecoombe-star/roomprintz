/**
 * Bring Forward pixels for one Harmonize capture.
 *
 * The scene image is room, then furniture, then the photographed cutout.
 * The cutout is also carried in a private PNG chunk so the worker can stamp
 * the same pixels onto the provider JPEG. Furniture RGB and the matte are
 * never given this cutout. Masks stay the SAM 3 coverage samples. A rescale
 * copies the nearest sample and does not feather it.
 */

import { classifyAfcR3cImagePairCompatibility } from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";
import {
  compositeBringForwardRgba,
  type BringForwardDisplayPhase,
  type BringForwardScan,
} from "@/lib/vibode-stage/bring-forward-cutout";
import {
  HarmonizeExportError,
  compositeFurnitureOverRoom,
  crc32,
  readPngSize,
} from "@/lib/vibode-stage/harmonize-export";

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const FOREGROUND_CHUNK = "bfFg";

export type HarmonizeForegroundFailure =
  | "editing"
  | "unverified"
  | "identity"
  | "mask"
  | "alignment"
  | "restoring"
  | "unrestored";

export type HarmonizeForegroundSnapshot = Readonly<{
  roomId: string;
  generationId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  objects: BringForwardScan["objects"];
  selectedIds: readonly string[];
}>;

export function harmonizeForegroundFailureMessage(reason: HarmonizeForegroundFailure): string {
  switch (reason) {
    case "editing":
      return "Finish Bring Forward before Harmonize.";
    case "identity":
      return "Bring Forward does not match this room.";
    case "alignment":
      return "Bring Forward isn't available for this room image.";
    case "restoring":
      return "Bring Forward is still loading. Wait before Harmonize.";
    case "unrestored":
      return "Bring Forward could not be restored. Harmonize was not started.";
    default:
      return "Bring Forward could not be captured for Harmonize.";
  }
}

export function readHarmonizeForegroundRequest(input: Readonly<{
  session: Readonly<{
    editing: boolean;
    recovery?: "loading" | "ready" | "failed";
    committedIds: ReadonlySet<string>;
    verified: Readonly<{ rgba: Uint8ClampedArray; width: number; height: number }> | null;
    scan: BringForwardScan | null;
    display: BringForwardDisplayPhase;
  }> | null;
  roomId: string;
  generationId: string;
}>): Readonly<{ ok: true; snapshot: HarmonizeForegroundSnapshot | null }> | Readonly<{
  ok: false;
  reason: HarmonizeForegroundFailure;
}> {
  const session = input.session;
  if (!session) return { ok: true, snapshot: null };
  if (session.recovery === "loading") return { ok: false, reason: "restoring" };
  if (session.recovery === "failed") return { ok: false, reason: "unrestored" };
  if (session.editing) return { ok: false, reason: "editing" };
  if (session.committedIds.size === 0) return { ok: true, snapshot: null };
  const scan = session.scan;
  const verified = session.verified;
  if (!scan || !verified || session.display !== "show") return { ok: false, reason: "unverified" };
  if (scan.roomId !== input.roomId || scan.generationId !== input.generationId) {
    return { ok: false, reason: "identity" };
  }
  if (
    verified.width !== scan.original.width
    || verified.height !== scan.original.height
    || verified.rgba.length !== scan.original.width * scan.original.height * 4
  ) {
    return { ok: false, reason: "identity" };
  }
  return {
    ok: true,
    snapshot: {
      roomId: scan.roomId,
      generationId: scan.generationId,
      originalSha256: scan.original.sha256,
      originalWidth: scan.original.width,
      originalHeight: scan.original.height,
      rgba: new Uint8ClampedArray(verified.rgba),
      width: verified.width,
      height: verified.height,
      objects: scan.objects.slice(),
      selectedIds: [...session.committedIds],
    },
  };
}

export function buildHarmonizeForeground(input: Readonly<{
  snapshot: HarmonizeForegroundSnapshot;
  roomId: string;
  generationId: string;
  originalSha256?: string | null;
  targetWidth: number;
  targetHeight: number;
}>): Readonly<{ ok: true; rgba: Uint8Array | null }> | Readonly<{
  ok: false;
  reason: HarmonizeForegroundFailure;
}> {
  if (input.snapshot.selectedIds.length === 0) return { ok: true, rgba: null };
  const expectedSha = input.originalSha256?.trim().toLowerCase() ?? "";
  if (
    input.snapshot.roomId !== input.roomId
    || input.snapshot.generationId !== input.generationId
    || (expectedSha && input.snapshot.originalSha256 !== expectedSha)
    || input.snapshot.width !== input.snapshot.originalWidth
    || input.snapshot.height !== input.snapshot.originalHeight
    || input.snapshot.rgba.length !== input.snapshot.originalWidth * input.snapshot.originalHeight * 4
  ) {
    return { ok: false, reason: "identity" };
  }
  const cutout = compositeBringForwardRgba({
    rgba: input.snapshot.rgba,
    width: input.snapshot.originalWidth,
    height: input.snapshot.originalHeight,
    objects: input.snapshot.objects,
    selectedIds: new Set(input.snapshot.selectedIds),
  });
  if (!cutout) return { ok: false, reason: "mask" };
  const placed = scaleBringForwardRgba(
    cutout,
    input.snapshot.originalWidth,
    input.snapshot.originalHeight,
    input.targetWidth,
    input.targetHeight,
  );
  if (!placed) return { ok: false, reason: "alignment" };
  return { ok: true, rgba: placed };
}

/**
 * Room, then furniture, then the photographed cutout. The furniture buffer
 * is not modified. An empty cutout leaves the legacy composite.
 */
export function composeHarmonizeScene(
  room: Uint8Array,
  furniture: Uint8Array,
  foreground: Uint8Array | null,
): Uint8Array {
  const scene = compositeFurnitureOverRoom(room, furniture);
  if (!foreground) return scene;
  if (foreground.length !== scene.length) {
    throw new HarmonizeExportError("Photographed foreground does not match the Harmonize image.");
  }
  return compositeFurnitureOverRoom(scene, foreground);
}

export function embedHarmonizeForeground(scenePng: Uint8Array, foregroundPng: Uint8Array): Uint8Array {
  const iend = findChunk(scenePng, "IEND");
  if (iend < 0) {
    throw new HarmonizeExportError("Harmonize composite could not carry the photographed foreground.");
  }
  const chunk = pngChunk(FOREGROUND_CHUNK, foregroundPng);
  const out = new Uint8Array(scenePng.length + chunk.length);
  out.set(scenePng.subarray(0, iend), 0);
  out.set(chunk, iend);
  out.set(scenePng.subarray(iend), iend + chunk.length);
  return out;
}

export function splitHarmonizeForeground(png: Uint8Array): Readonly<{
  ok: true;
  scene: Uint8Array;
  foreground: Uint8Array | null;
}> | Readonly<{ ok: false; message: string }> {
  if (!hasPngSignature(png)) return { ok: true, scene: png, foreground: null };
  const parts: Uint8Array[] = [png.subarray(0, PNG_SIGNATURE.length)];
  let foreground: Uint8Array | null = null;
  let offset = PNG_SIGNATURE.length;
  let sawIend = false;
  while (offset + 12 <= png.length) {
    const length = readUint32(png, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const end = dataStart + length;
    if (length > png.length || end + 4 > png.length) break;
    const type = ascii(png.subarray(typeStart, dataStart));
    const chunk = png.subarray(offset, end + 4);
    if (type === FOREGROUND_CHUNK) {
      if (foreground) return { ok: false, message: "Harmonize foreground capture is duplicated." };
      const expected = crc32(png.subarray(typeStart, end));
      const actual = readUint32(png, end);
      if (expected !== actual) return { ok: false, message: "Harmonize foreground capture is damaged." };
      foreground = png.slice(dataStart, end);
    } else {
      parts.push(chunk);
    }
    offset = end + 4;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!foreground) return { ok: true, scene: png, foreground: null };
  if (!sawIend) return { ok: false, message: "Harmonize foreground capture is damaged." };
  const scene = concatBytes(parts);
  return { ok: true, scene, foreground };
}

export async function prepareHarmonizeProviderPng(
  png: Uint8Array,
  expected: Readonly<{ width: number; height: number }>,
  decodeForeground: (bytes: Uint8Array) => Promise<Readonly<{ width: number; height: number }>>,
): Promise<Readonly<{ ok: true; png: Uint8Array; foreground: Uint8Array | null }> | Readonly<{
  ok: false;
  message: string;
}>> {
  const split = splitHarmonizeForeground(png);
  if (!split.ok) return split;
  if (!split.foreground) return { ok: true, png: split.scene, foreground: null };
  const sceneSize = readPngSize(split.scene);
  const storedSize = readPngSize(split.foreground);
  if (
    !sceneSize
    || !storedSize
    || sceneSize.width !== expected.width
    || sceneSize.height !== expected.height
    || storedSize.width !== expected.width
    || storedSize.height !== expected.height
  ) {
    return { ok: false, message: "Photographed foreground does not match the Harmonize image." };
  }
  try {
    const decoded = await decodeForeground(split.foreground);
    if (decoded.width !== expected.width || decoded.height !== expected.height) {
      return { ok: false, message: "Photographed foreground does not match the Harmonize image." };
    }
  } catch {
    return { ok: false, message: "Photographed foreground could not be read." };
  }
  return { ok: true, png: split.scene, foreground: split.foreground };
}

export function scaleBringForwardRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array | null {
  if (!positive(sourceWidth) || !positive(sourceHeight) || !positive(targetWidth) || !positive(targetHeight)) {
    return null;
  }
  if (rgba.length !== sourceWidth * sourceHeight * 4) return null;
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: "original",
      decodedWidth: sourceWidth,
      decodedHeight: sourceHeight,
      orientation: 1,
    },
    {
      fingerprint: "harmonize",
      decodedWidth: targetWidth,
      decodedHeight: targetHeight,
      orientation: 1,
    },
  );
  if (compatibility.tier === "incompatible") return null;
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return new Uint8Array(rgba);
  const output = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(((y + 0.5) * sourceHeight) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(((x + 0.5) * sourceWidth) / targetWidth));
      const from = (sourceY * sourceWidth + sourceX) * 4;
      const to = (y * targetWidth + x) * 4;
      output[to] = rgba[from] ?? 0;
      output[to + 1] = rgba[from + 1] ?? 0;
      output[to + 2] = rgba[from + 2] ?? 0;
      output[to + 3] = rgba[from + 3] ?? 0;
    }
  }
  return output;
}

function positive(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function findChunk(png: Uint8Array, type: string): number {
  if (!hasPngSignature(png)) return -1;
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= png.length) {
    const length = readUint32(png, offset);
    const dataStart = offset + 8;
    const end = dataStart + length;
    if (end + 4 > png.length) return -1;
    if (ascii(png.subarray(offset + 4, dataStart)) === type) return offset;
    offset = end + 4;
  }
  return -1;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = asciiBytes(type);
  const checksum = crc32(concatBytes([typeBytes, data]));
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, checksum);
  return out;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
