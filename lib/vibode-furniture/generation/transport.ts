/**
 * Request-body ceiling for POST /api/vibode/furniture-generations.
 *
 * Vercel refuses a function request above 4.5 MB. This module does not raise
 * that limit, does not change Meshy's 20 MB image maximum, and does not add
 * another upload path.
 *
 * The first production test sends one JPEG at or below 3 MB, with standard
 * geometry, textures enabled, and 2K textures. That reservation is 30 credits.
 */

export const GENERATION_REQUEST_BODY_MAX_BYTES = 4_500_000;

export const FIRST_GENERATION_JPEG_MAX_BYTES = 3 * 1024 * 1024;

/** Photo bytes are not an argument to the reservation RPC. */
export function betaFrontPhotoBytesAllowed(byteLength: number): boolean {
  return Number.isInteger(byteLength) && byteLength > 0 && byteLength <= FIRST_GENERATION_JPEG_MAX_BYTES;
}

const TRANSPORT_ENVELOPE_BYTES = 2_048;

export function generationRequestBodyLimit(
  contentLength: string | null,
): "ok" | "too_large" | "unreadable" {
  if (contentLength == null || contentLength === "") return "ok";
  if (!/^\d+$/.test(contentLength)) return "unreadable";
  return Number(contentLength) > GENERATION_REQUEST_BODY_MAX_BYTES ? "too_large" : "ok";
}

export function imagesFitGenerationTransport(imageByteLengths: readonly number[]): boolean {
  if (imageByteLengths.length === 0 || imageByteLengths.length > 4) return false;
  let base64Bytes = 0;
  for (const length of imageByteLengths) {
    if (!Number.isInteger(length) || length <= 0) return false;
    base64Bytes += 4 * Math.ceil(length / 3);
  }
  return base64Bytes + TRANSPORT_ENVELOPE_BYTES <= GENERATION_REQUEST_BODY_MAX_BYTES;
}
