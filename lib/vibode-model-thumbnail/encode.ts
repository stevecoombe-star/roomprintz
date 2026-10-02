import sharp from "sharp";

import { isVibodeWebp } from "@/lib/vibodeAssetThumbnails";

import { VIBODE_MODEL_THUMBNAIL_EDGE_PX } from "./frame";

const BACKGROUND = { r: 0xe7, g: 0xe5, b: 0xe4, alpha: 1 };

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
}

export async function encodeModelThumbnailWebp(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!isPng(bytes) && !isVibodeWebp(bytes)) return null;
  try {
    const webp = await sharp(bytes)
      .resize(VIBODE_MODEL_THUMBNAIL_EDGE_PX, VIBODE_MODEL_THUMBNAIL_EDGE_PX, {
        fit: "contain",
        background: BACKGROUND,
        withoutEnlargement: false,
      })
      .webp({ quality: 80 })
      .toBuffer();
    return isVibodeWebp(webp) ? new Uint8Array(webp) : null;
  } catch {
    return null;
  }
}
