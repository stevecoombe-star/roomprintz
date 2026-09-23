import "server-only";

import sharp from "sharp";

import type { GreyscaleRaster } from "./empty-original-ncc-localizer";

export type EmptyOriginalRasterIdentity = Readonly<{
  sha256: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: number;
}>;

export async function decodeEmptyOriginalGreyscale(
  bytes: Uint8Array,
  identity: EmptyOriginalRasterIdentity,
): Promise<GreyscaleRaster | null> {
  try {
    const decoded = await sharp(Buffer.from(bytes), { failOn: "error", animated: false })
      .rotate()
      .removeAlpha()
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== identity.decodedWidth ||
      decoded.info.height !== identity.decodedHeight
    ) {
      return null;
    }
    const pixels = new Float64Array(decoded.info.width * decoded.info.height);
    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = decoded.data[index]! / 255;
    }
    return { width: decoded.info.width, height: decoded.info.height, pixels };
  } catch {
    return null;
  }
}

export async function resizeEmptyOriginalGreyscale(
  bytes: Uint8Array,
  source: GreyscaleRaster,
  width: number,
  height: number,
): Promise<GreyscaleRaster | null> {
  if (source.width === width && source.height === height) return source;
  try {
    const resized = await sharp(Buffer.from(bytes), { failOn: "error", animated: false })
      .rotate()
      .removeAlpha()
      .greyscale()
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (resized.info.width !== width || resized.info.height !== height) return null;
    const pixels = new Float64Array(width * height);
    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = resized.data[index]! / 255;
    }
    return { width, height, pixels };
  } catch {
    return null;
  }
}
