/**
 * Customer photo limits for the 3D Generator.
 *
 * The original file may be as large as a New Room upload. The bytes sent to
 * the certified generation route stay a single front JPEG at or below
 * FIRST_GENERATION_JPEG_MAX_BYTES. Preparation does not reserve anything.
 */

import { FIRST_GENERATION_JPEG_MAX_BYTES } from "@/lib/vibode-furniture/generation/transport";

export const FURNITURE_PHOTO_MAX_INPUT_BYTES = 25 * 1024 * 1024;

export const FURNITURE_PHOTO_MAX_OUTPUT_BYTES = FIRST_GENERATION_JPEG_MAX_BYTES;

/** Same longest-side cap as New Room client normalization. */
export const FURNITURE_PHOTO_MAX_EDGE_PX = 2048;

export const FURNITURE_PHOTO_MIN_EDGE_PX = 32;

/**
 * Decoder ceiling above a 48 megapixel phone photo and below a
 * decompression bomb. The normalized JPEG is still capped at 2048 px.
 */
export const FURNITURE_PHOTO_MAX_DECODED_PIXELS = 80_000_000;

export const FURNITURE_PHOTO_MAX_DECODED_EDGE_PX = 16_384;

/**
 * Vercel refuses a function body above 4.5 MB. Leave room for the
 * multipart envelope. Larger HEIC files can still be prepared when the
 * browser itself can decode them.
 */
export const FURNITURE_HEIC_SERVER_MAX_BYTES = 4_000_000;

export const FURNITURE_HEIC_REQUEST_MAX_BYTES = 4_200_000;

/** Opaque JPEG matte for pixels that were transparent. */
export const FURNITURE_JPEG_MATTE = Object.freeze({ r: 255, g: 255, b: 255 });

export const FURNITURE_JPEG_MATTE_CSS = "#ffffff";

export const FURNITURE_PHOTO_PREPARATION_PATH = "/api/vibode/furniture-photo-preparation";
