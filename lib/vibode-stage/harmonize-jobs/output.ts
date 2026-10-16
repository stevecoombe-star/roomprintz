import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  HARMONIZE_NBP_OUTPUT_MAX_EDGE,
  readHarmonizeNbpImageSize,
} from "@/lib/vibode-stage/harmonize-nbp-proof";

import { HARMONIZE_OUTPUT_MAX_BYTES } from "./policy";
import { harmonizeProviderAcceptsOutput } from "./provider-capability";

const MAX_DECODED_PIXELS = HARMONIZE_NBP_OUTPUT_MAX_EDGE * HARMONIZE_NBP_OUTPUT_MAX_EDGE;

export async function assessHarmonizeJobOutput(
  bytes: Uint8Array,
  inputWidth: number,
  inputHeight: number,
  declaredMime?: string,
): Promise<
  | Readonly<{ ok: true; width: number; height: number; sha256: string; mime: "image/jpeg" }>
  | Readonly<{ ok: false; code: "unexpected_output" }>
> {
  if (bytes.byteLength === 0 || bytes.byteLength > HARMONIZE_OUTPUT_MAX_BYTES) {
    return { ok: false, code: "unexpected_output" };
  }
  const header = readHarmonizeNbpImageSize(bytes);
  const decoded = await decodeHarmonizeJpeg(bytes);
  const declared = declaredMime == null ? null : normalizeMime(declaredMime);
  if (
    !header
    || !decoded
    || header.mime !== "image/jpeg"
    || decoded.mime !== "image/jpeg"
    || header.width !== decoded.width
    || header.height !== decoded.height
    || (declared != null && declared !== decoded.mime)
  ) {
    return { ok: false, code: "unexpected_output" };
  }
  if (!harmonizeProviderAcceptsOutput({
    width: decoded.width,
    height: decoded.height,
    inputWidth,
    inputHeight,
  })) {
    return { ok: false, code: "unexpected_output" };
  }
  return {
    ok: true,
    width: decoded.width,
    height: decoded.height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mime: "image/jpeg",
  };
}

async function decodeHarmonizeJpeg(
  bytes: Uint8Array,
): Promise<Readonly<{ width: number; height: number; mime: "image/jpeg" }> | null> {
  try {
    const input = Buffer.from(bytes);
    const meta = await sharp(input, { failOn: "error", animated: false, limitInputPixels: MAX_DECODED_PIXELS }).metadata();
    if (meta.format !== "jpeg" || !meta.width || !meta.height) return null;
    if (meta.width * meta.height > MAX_DECODED_PIXELS) return null;
    const decoded = await sharp(input, { failOn: "error", animated: false, limitInputPixels: MAX_DECODED_PIXELS })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== meta.width || decoded.info.height !== meta.height) return null;
    return { width: decoded.info.width, height: decoded.info.height, mime: "image/jpeg" };
  } catch {
    return null;
  }
}

function normalizeMime(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}
