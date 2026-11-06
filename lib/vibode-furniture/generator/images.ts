/**
 * Local furniture-photo selection for Meshy image-to-3D.
 *
 * Constraints match the documented Image to 3D and Multi-Image to 3D
 * inputs (docs.meshy.ai, checked 2026-11-06): JPEG, PNG, or WebP, at most
 * 20 MB, at least 32 pixels on each side, and at most 178,956,970 pixels.
 * Files stay in the browser. This module does not upload them.
 */

export const MESHY_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

export const MESHY_IMAGE_MIN_EDGE_PX = 32;

export const MESHY_IMAGE_MAX_PIXELS = 178_956_970;

export const FURNITURE_VIEW_SLOT_ORDER = ["front", "left", "right", "back"] as const;

export type FurnitureViewSlot = (typeof FURNITURE_VIEW_SLOT_ORDER)[number];

export const FURNITURE_VIEW_LABELS: Readonly<Record<FurnitureViewSlot, string>> = {
  front: "Front",
  left: "Left",
  right: "Right",
  back: "Back",
};

export type FurniturePhotoMime = "image/jpeg" | "image/png" | "image/webp";

export type FurniturePhotoRecord = Readonly<{
  slot: FurnitureViewSlot;
  fileName: string;
  mimeType: FurniturePhotoMime;
  byteLength: number;
  widthPx: number;
  heightPx: number;
}>;

export type FurniturePhotoSet = Readonly<Record<FurnitureViewSlot, FurniturePhotoRecord | null>>;

export type FurnitureInputMode = "incomplete" | "single" | "multi";

const MIME_BY_EXTENSION: Readonly<Record<string, FurniturePhotoMime>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function emptyFurniturePhotoSet(): FurniturePhotoSet {
  return { front: null, left: null, right: null, back: null };
}

export function furnitureInputMode(photos: FurniturePhotoSet): FurnitureInputMode {
  if (!photos.front) return "incomplete";
  const extras = FURNITURE_VIEW_SLOT_ORDER.some((slot) => slot !== "front" && photos[slot] != null);
  return extras ? "multi" : "single";
}

/**
 * Front is first because Meshy 7.1 treats the first image as the front view.
 * Later slots keep a stable left, right, back order. Empty slots are omitted.
 */
export function orderedViewSlots(photos: FurniturePhotoSet): FurnitureViewSlot[] {
  return FURNITURE_VIEW_SLOT_ORDER.filter((slot) => photos[slot] != null);
}

export function setFurniturePhoto(
  photos: FurniturePhotoSet,
  photo: FurniturePhotoRecord,
): FurniturePhotoSet {
  return { ...photos, [photo.slot]: photo };
}

export function removeFurniturePhoto(
  photos: FurniturePhotoSet,
  slot: FurnitureViewSlot,
): FurniturePhotoSet {
  return { ...photos, [slot]: null };
}

export function validateFurniturePhotoFile(input: Readonly<{
  fileName: string;
  mimeType: string;
  byteLength: number;
}>): { ok: true; mimeType: FurniturePhotoMime } | { ok: false; message: string } {
  if (!Number.isFinite(input.byteLength) || input.byteLength <= 0) {
    return { ok: false, message: "Choose a photo file." };
  }
  if (input.byteLength > MESHY_IMAGE_MAX_BYTES) {
    return { ok: false, message: "This photo is over 20 MB." };
  }
  const resolved = resolvePhotoMime(input.fileName, input.mimeType);
  if (!resolved) return { ok: false, message: "Use a JPEG, PNG, or WebP photo." };
  return { ok: true, mimeType: resolved };
}

export function validateFurniturePhotoPixels(input: Readonly<{
  widthPx: number;
  heightPx: number;
}>): { ok: true } | { ok: false; message: string } {
  if (
    !Number.isFinite(input.widthPx) ||
    !Number.isFinite(input.heightPx) ||
    input.widthPx < MESHY_IMAGE_MIN_EDGE_PX ||
    input.heightPx < MESHY_IMAGE_MIN_EDGE_PX
  ) {
    return { ok: false, message: "Each side of the photo must be at least 32 pixels." };
  }
  if (
    input.widthPx > MESHY_IMAGE_MAX_PIXELS ||
    input.heightPx > MESHY_IMAGE_MAX_PIXELS ||
    input.widthPx * input.heightPx > MESHY_IMAGE_MAX_PIXELS
  ) {
    return { ok: false, message: "This photo has too many pixels." };
  }
  return { ok: true };
}

export function replacePreviewUrl(
  urls: Readonly<Partial<Record<FurnitureViewSlot, string>>>,
  slot: FurnitureViewSlot,
  nextUrl: string | null,
): { urls: Partial<Record<FurnitureViewSlot, string>>; revoke: string[] } {
  const previous = urls[slot] ?? null;
  const revoke = previous && previous !== nextUrl ? [previous] : [];
  const next = { ...urls };
  if (nextUrl) next[slot] = nextUrl;
  else delete next[slot];
  return { urls: next, revoke };
}

export function previewUrlsToRevoke(
  urls: Readonly<Partial<Record<FurnitureViewSlot, string>>>,
): string[] {
  return FURNITURE_VIEW_SLOT_ORDER.flatMap((slot) => {
    const url = urls[slot];
    return url ? [url] : [];
  });
}

function resolvePhotoMime(fileName: string, mimeType: string): FurniturePhotoMime | null {
  const declared = normalizeMime(mimeType);
  const fromName = MIME_BY_EXTENSION[fileExtension(fileName)] ?? null;
  if (declared && fromName && declared !== fromName) return null;
  if (declared) return declared;
  const bare = mimeType.trim().toLowerCase();
  if (bare === "" || bare === "application/octet-stream") return fromName;
  return null;
}

function normalizeMime(mimeType: string): FurniturePhotoMime | null {
  const mime = mimeType.trim().toLowerCase();
  if (mime === "image/jpg" || mime === "image/jpeg" || mime === "image/pjpeg") return "image/jpeg";
  if (mime === "image/png") return "image/png";
  if (mime === "image/webp") return "image/webp";
  return null;
}

function fileExtension(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase();
  const dot = trimmed.lastIndexOf(".");
  if (dot < 0 || dot === trimmed.length - 1) return "";
  return trimmed.slice(dot + 1);
}
