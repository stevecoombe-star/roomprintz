/**
 * Server conversion for one scratch HEIC photograph.
 * Only the completion route imports this module, so the small JSON routes
 * do not carry the image decoder.
 */

import "server-only";

import { convertHeicBufferToBoundedJpeg } from "@/lib/heicServerConversion";
import { MAX_LONGEST_SIDE_PX, MAX_OUTPUT_BYTES } from "@/lib/prepareRoomImageForUpload";
import {
  FURNITURE_JPEG_MATTE,
  FURNITURE_PHOTO_MAX_DECODED_PIXELS,
  FURNITURE_PHOTO_MAX_EDGE_PX,
  FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  FURNITURE_PHOTO_MIN_EDGE_PX,
} from "@/lib/vibode-furniture/generator/photo-limits";

import type { PhotoPurpose } from "./handler";

const ROOM_PIXELS = 80_000_000;

export async function convertPreparedPhoto(bytes: Uint8Array, purpose: PhotoPurpose): Promise<{ bytes: Uint8Array }> {
  const bounded = await convertHeicBufferToBoundedJpeg(bytes, optionsFor(purpose));
  return { bytes: bounded.bytes };
}

function optionsFor(purpose: PhotoPurpose) {
  if (purpose === "room") {
    return {
      maxEdgePx: MAX_LONGEST_SIDE_PX,
      maxBytes: MAX_OUTPUT_BYTES,
      maxInputPixels: ROOM_PIXELS,
      minEdgePx: 1,
      background: { r: 255, g: 255, b: 255 },
    };
  }
  return {
    maxEdgePx: FURNITURE_PHOTO_MAX_EDGE_PX,
    maxBytes: FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
    maxInputPixels: FURNITURE_PHOTO_MAX_DECODED_PIXELS,
    minEdgePx: FURNITURE_PHOTO_MIN_EDGE_PX,
    background: FURNITURE_JPEG_MATTE,
  };
}
