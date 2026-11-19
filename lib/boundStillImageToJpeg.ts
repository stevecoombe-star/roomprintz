/**
 * Fit a decoded still image into the certified JPEG submission contract.
 * JPEG bytes that already meet the contract are returned unchanged.
 */

import "server-only";

import { inspectJpeg, jpegCanPassThrough } from "@/lib/stillImageKind";

export class BoundedJpegError extends Error {
  readonly code: "corrupt" | "too_many_pixels" | "too_small" | "too_large";

  constructor(code: BoundedJpegError["code"], message: string) {
    super(message);
    this.name = "BoundedJpegError";
    this.code = code;
  }
}

export type BoundedJpeg = Readonly<{
  bytes: Uint8Array;
  width: number;
  height: number;
  recompressed: boolean;
}>;

export type BoundJpegOptions = Readonly<{
  maxEdgePx: number;
  maxBytes: number;
  maxInputPixels: number;
  minEdgePx: number;
  background: Readonly<{ r: number; g: number; b: number }>;
}>;

type SharpFactory = typeof import("sharp").default;

export async function boundStillImageToJpeg(
  input: Uint8Array,
  options: BoundJpegOptions,
): Promise<BoundedJpeg> {
  if (!(input instanceof Uint8Array) || input.byteLength <= 0) {
    throw new BoundedJpegError("corrupt", "Choose a photo file.");
  }
  const inspected = inspectJpeg(input);
  if (inspected && jpegCanPassThrough(inspected, input.byteLength, options)) {
    return {
      bytes: input,
      width: inspected.displayedWidthPx,
      height: inspected.displayedHeightPx,
      recompressed: false,
    };
  }

  const sharpFactory = await loadSharp();
  let width = 0;
  let height = 0;
  try {
    const metadata = await sharpFactory(input, {
      failOn: "none",
      limitInputPixels: options.maxInputPixels,
      animated: false,
    }).metadata();
    width = metadata.width ?? 0;
    height = metadata.height ?? 0;
  } catch (error) {
    if (isPixelLimitError(error)) throw new BoundedJpegError("too_many_pixels", "This photo has too many pixels.");
    throw error;
  }
  if (width > 0 && height > 0 && width * height > options.maxInputPixels) {
    throw new BoundedJpegError("too_many_pixels", "This photo has too many pixels.");
  }

  let edge = options.maxEdgePx;
  let previousKey = "";
  for (let step = 0; step < 8; step += 1) {
    const key = String(edge);
    if (key === previousKey) break;
    previousKey = key;
    for (const quality of [85, 75, 60]) {
      const encoded = await encodeAttempt(sharpFactory, input, options, edge, quality);
      if (
        encoded.data.byteLength <= options.maxBytes
        && encoded.info.width >= options.minEdgePx
        && encoded.info.height >= options.minEdgePx
      ) {
        return {
          bytes: encoded.data,
          width: encoded.info.width,
          height: encoded.info.height,
          recompressed: true,
        };
      }
    }
    const next = Math.floor(edge * 0.8);
    if (next < 512) break;
    edge = next;
  }
  throw new BoundedJpegError("too_large", "This photo could not be prepared under the size limit.");
}

async function encodeAttempt(
  sharpFactory: SharpFactory,
  input: Uint8Array,
  options: BoundJpegOptions,
  edge: number,
  quality: number,
) {
  try {
    return await sharpFactory(input, {
      failOn: "error",
      limitInputPixels: options.maxInputPixels,
      animated: false,
    })
      .rotate()
      .resize({
        width: edge,
        height: edge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: options.background })
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:4:4" })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (isPixelLimitError(error)) throw new BoundedJpegError("too_many_pixels", "This photo has too many pixels.");
    throw error;
  }
}

async function loadSharp(): Promise<SharpFactory> {
  const sharpModule = await import("sharp");
  return sharpModule.default;
}

function isPixelLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /pixel limit/i.test(message);
}
