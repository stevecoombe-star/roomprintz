/**
 * Decides how a customer photo becomes the certified front JPEG.
 * Names and MIME types lose to the file header.
 */

import { isHeicLikeFile, isLivePhotoMovCompanion, isSupportedStillImageFile } from "@/lib/uploadImageFileTypes";
import { jpegCanPassThrough, type JpegInspection, type StillMagic } from "@/lib/stillImageKind";

import {
  FURNITURE_HEIC_SERVER_MAX_BYTES,
  FURNITURE_PHOTO_MAX_EDGE_PX,
  FURNITURE_PHOTO_MAX_INPUT_BYTES,
  FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  FURNITURE_PHOTO_MIN_EDGE_PX,
} from "./photo-limits";

export const FURNITURE_PHOTO_MESSAGES = Object.freeze({
  empty: "Choose a photo file.",
  tooLarge: "This photo is too large. Please choose one under 25 MB.",
  livePhoto: "Live Photo video detected. Vibode needs the still image, not the video clip.",
  unsupported: "Please choose a JPG, PNG, WebP, or HEIC/HEIF still image.",
  tooManyPixels: "This photo has too many pixels. Try a smaller photo.",
  prepareFailed: "We couldn't prepare this photo. Try a smaller or lower-resolution photo.",
  heicFailed: "This iPhone photo could not be converted. Export it as JPEG and try again.",
  heicTooLarge: "This iPhone photo is too large to convert in this browser. Export it as JPEG, or choose a smaller photo.",
  signIn: "Sign in to prepare this iPhone photo.",
  preparing: "Preparing this photo…",
});

const PASSTHROUGH_LIMITS = Object.freeze({
  maxBytes: FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  maxEdgePx: FURNITURE_PHOTO_MAX_EDGE_PX,
  minEdgePx: FURNITURE_PHOTO_MIN_EDGE_PX,
});

export type FurniturePhotoPlan =
  | Readonly<{ action: "reject"; message: string }>
  | Readonly<{ action: "passthrough" }>
  | Readonly<{ action: "browser" }>
  | Readonly<{ action: "heic"; transport: "direct" | "storage" | "none" }>;

export function planFurniturePhoto(input: Readonly<{
  fileName: string;
  mimeType: string;
  byteLength: number;
  magic: StillMagic;
  jpeg: JpegInspection | null;
}>): FurniturePhotoPlan {
  if (!Number.isFinite(input.byteLength) || input.byteLength <= 0) {
    return { action: "reject", message: FURNITURE_PHOTO_MESSAGES.empty };
  }
  if (input.byteLength > FURNITURE_PHOTO_MAX_INPUT_BYTES) {
    return { action: "reject", message: FURNITURE_PHOTO_MESSAGES.tooLarge };
  }
  const stillMagic = input.magic === "jpeg" || input.magic === "png" || input.magic === "webp" || input.magic === "heic";
  if (
    input.magic === "mov"
    || (!stillMagic && isLivePhotoMovCompanion({ name: input.fileName, type: input.mimeType }))
  ) {
    return { action: "reject", message: FURNITURE_PHOTO_MESSAGES.livePhoto };
  }
  if (input.magic === "gif" || input.magic === "avif") {
    return { action: "reject", message: FURNITURE_PHOTO_MESSAGES.unsupported };
  }
  if (input.magic === "jpeg") {
    if (input.jpeg && jpegCanPassThrough(input.jpeg, input.byteLength, PASSTHROUGH_LIMITS)) {
      return { action: "passthrough" };
    }
    return { action: "browser" };
  }
  if (input.magic === "png" || input.magic === "webp") return { action: "browser" };
  if (input.magic === "heic") {
    return {
      action: "heic",
      transport: input.byteLength <= FURNITURE_HEIC_SERVER_MAX_BYTES ? "direct" : "storage",
    };
  }
  const described = { name: input.fileName, type: input.mimeType };
  if (isHeicLikeFile(described)) {
    return { action: "heic", transport: "none" };
  }
  if (isSupportedStillImageFile(described)) return { action: "browser" };
  return { action: "reject", message: FURNITURE_PHOTO_MESSAGES.unsupported };
}

export function createPhotoPreparationGate() {
  let token = 0;
  return {
    begin(): number {
      token += 1;
      return token;
    },
    isCurrent(started: number): boolean {
      return started === token;
    },
  };
}
