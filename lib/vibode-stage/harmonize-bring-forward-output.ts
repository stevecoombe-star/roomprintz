/**
 * Stamp a captured Bring Forward cutout onto a Harmonize JPEG.
 * The provider image stays untouched when the frame does not match.
 */

import sharp from "sharp";

import { decodePngRgba, compositeFurnitureOverRoom } from "@/lib/vibode-stage/harmonize-export";
import { scaleBringForwardRgba } from "@/lib/vibode-stage/harmonize-bring-forward";

const MAX_EDGE = 4096;

export async function compositeHarmonizeForegroundOntoJpeg(input: Readonly<{
  jpeg: Uint8Array;
  foregroundPng: Uint8Array;
  inputWidth: number;
  inputHeight: number;
}>): Promise<Readonly<{ ok: true; jpeg: Uint8Array }> | Readonly<{ ok: false; message: string }>> {
  let foreground: Awaited<ReturnType<typeof decodePngRgba>>;
  try {
    foreground = await decodePngRgba(input.foregroundPng);
  } catch {
    return { ok: false, message: "Photographed foreground could not be read." };
  }
  if (foreground.width !== input.inputWidth || foreground.height !== input.inputHeight) {
    return { ok: false, message: "Photographed foreground does not match the Harmonize image." };
  }
  let decoded: { data: Buffer; info: { width: number; height: number; channels: number } };
  try {
    decoded = await sharp(Buffer.from(input.jpeg), {
      failOn: "error",
      animated: false,
      limitInputPixels: MAX_EDGE * MAX_EDGE,
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    return { ok: false, message: "Harmonize result could not be read for foreground placement." };
  }
  if (
    decoded.info.channels !== 4
    || decoded.info.width > MAX_EDGE
    || decoded.info.height > MAX_EDGE
    || decoded.data.length !== decoded.info.width * decoded.info.height * 4
  ) {
    return { ok: false, message: "Harmonize result could not be read for foreground placement." };
  }
  const placed = scaleBringForwardRgba(
    foreground.rgba,
    foreground.width,
    foreground.height,
    decoded.info.width,
    decoded.info.height,
  );
  if (!placed) {
    return { ok: false, message: "Photographed foreground does not match the Harmonize image." };
  }
  const merged = compositeFurnitureOverRoom(new Uint8Array(decoded.data), placed);
  try {
    const encoded = await sharp(Buffer.from(merged), {
      raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 },
      limitInputPixels: MAX_EDGE * MAX_EDGE,
    }).jpeg({
      quality: 95,
      chromaSubsampling: "4:4:4",
      mozjpeg: false,
    }).toBuffer();
    return { ok: true, jpeg: new Uint8Array(encoded) };
  } catch {
    return { ok: false, message: "Harmonize result could not keep the photographed foreground." };
  }
}
