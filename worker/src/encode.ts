import sharp from "sharp";

export const THUMBNAIL_WIDTH = 640;
export const THUMBNAIL_HEIGHT = 480;
export const THUMBNAIL_WEBP_QUALITY = 80;

export async function encodeThumbnailWebp(png: Uint8Array): Promise<Uint8Array> {
  return sharp(png)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: "cover", position: "centre" })
    .webp({ quality: THUMBNAIL_WEBP_QUALITY })
    .toBuffer();
}
