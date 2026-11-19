export const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 3.25 * 1024 * 1024;
export const MAX_LONGEST_SIDE_PX = 2048;
export const PRIMARY_QUALITY = 0.85;
export const RETRY_QUALITY = 0.75;

const TOO_LARGE_INPUT_MESSAGE = "This image is too large. Please upload a photo under 25MB.";
const PROCESSING_FAILURE_MESSAGE =
  "We couldn’t process this image. Try a smaller or lower-resolution photo.";

type PrepareRoomImageErrorCode = "INVALID_TYPE" | "INPUT_TOO_LARGE" | "PROCESSING_FAILED";

export class PrepareRoomImageError extends Error {
  code: PrepareRoomImageErrorCode;

  constructor(code: PrepareRoomImageErrorCode, message: string) {
    super(message);
    this.name = "PrepareRoomImageError";
    this.code = code;
  }
}

export type BrowserImageEncodeOptions = {
  originalName: string;
  originalBytes: number;
  outputMimeType: "image/jpeg" | "image/webp";
  maxOutputBytes: number;
  maxLongestSidePx: number;
  /** Painted under a JPEG so transparent pixels become this color. Null keeps the historical room-upload path. */
  jpegBackground: string | null;
  /** When the first two qualities are still too large, reduce the long side and try again. */
  shrinkUntilFit: boolean;
  maxDecodedPixels?: number;
  maxDecodedEdgePx?: number;
  tooManyPixelsMessage?: string;
  logLabel?: string;
};

function isAllowedMimeType(mimeType: string | null | undefined): mimeType is string {
  if (typeof mimeType !== "string") return false;
  return ALLOWED_MIME_TYPES.has(mimeType.toLowerCase());
}

function buildOutputFilename(originalName: string, outputMimeType: string): string {
  const dotIndex = originalName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName;
  const extension = outputMimeType === "image/webp" ? "webp" : "jpg";
  return `${baseName || "room-photo"}.${extension}`;
}

function pickOutputMimeType(inputMimeType: string): "image/webp" | "image/jpeg" {
  return inputMimeType === "image/webp" ? "image/webp" : "image/jpeg";
}

export function scaleRoomImageToLongestSide(width: number, height: number, maxLongestSidePx: number) {
  const longestSide = Math.max(width, height);
  if (longestSide <= maxLongestSidePx) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }

  const scale = maxLongestSidePx / longestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export async function loadRoomImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = blobToObjectUrl(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new PrepareRoomImageError("PROCESSING_FAILED", PROCESSING_FAILURE_MESSAGE));
    };
    image.src = objectUrl;
  });
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: "image/webp" | "image/jpeg",
  quality: number
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new PrepareRoomImageError("PROCESSING_FAILED", PROCESSING_FAILURE_MESSAGE));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

function logCompressionStats(originalBytes: number, compressedBytes: number, label: string) {
  const compressionRatio = originalBytes > 0 ? compressedBytes / originalBytes : 1;
  console.debug(`[${label}] image optimization stats`, {
    originalSizeBytes: originalBytes,
    compressedSizeBytes: compressedBytes,
    compressionRatio,
  });
}

async function renderScaledBlob(
  image: HTMLImageElement,
  width: number,
  height: number,
  mimeType: "image/jpeg" | "image/webp",
  quality: number,
  jpegBackground: string | null,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new PrepareRoomImageError("PROCESSING_FAILED", PROCESSING_FAILURE_MESSAGE);
  }
  if (jpegBackground && mimeType === "image/jpeg") {
    ctx.fillStyle = jpegBackground;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(image, 0, 0, width, height);
  return canvasToBlob(canvas, mimeType, quality);
}

export async function encodeLoadedBrowserImage(
  image: HTMLImageElement,
  options: BrowserImageEncodeOptions,
): Promise<File> {
  if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width < 1 || image.height < 1) {
    throw new PrepareRoomImageError("PROCESSING_FAILED", PROCESSING_FAILURE_MESSAGE);
  }
  if (
    (options.maxDecodedEdgePx != null
      && (image.width > options.maxDecodedEdgePx || image.height > options.maxDecodedEdgePx))
    || (options.maxDecodedPixels != null && image.width * image.height > options.maxDecodedPixels)
  ) {
    throw new PrepareRoomImageError(
      "PROCESSING_FAILED",
      options.tooManyPixelsMessage ?? PROCESSING_FAILURE_MESSAGE,
    );
  }

  const edges = [options.maxLongestSidePx];
  if (options.shrinkUntilFit) {
    let edge = Math.floor(options.maxLongestSidePx * 0.8);
    while (edge >= 512) {
      edges.push(edge);
      edge = Math.floor(edge * 0.8);
    }
  }

  let previousSize = "";
  for (const edge of edges) {
    const scaled = scaleRoomImageToLongestSide(image.width, image.height, edge);
    const sizeKey = `${scaled.width}x${scaled.height}`;
    if (sizeKey === previousSize) continue;
    previousSize = sizeKey;
    for (const quality of [PRIMARY_QUALITY, RETRY_QUALITY]) {
      const blob = await renderScaledBlob(
        image,
        scaled.width,
        scaled.height,
        options.outputMimeType,
        quality,
        options.jpegBackground,
      );
      if (blob.size > options.maxOutputBytes) continue;
      logCompressionStats(options.originalBytes, blob.size, options.logLabel ?? "room-upload");
      return new File([blob], buildOutputFilename(options.originalName, options.outputMimeType), {
        type: options.outputMimeType,
      });
    }
    if (!options.shrinkUntilFit) break;
  }

  throw new PrepareRoomImageError("PROCESSING_FAILED", PROCESSING_FAILURE_MESSAGE);
}

export async function prepareRoomImageForUpload(file: File): Promise<File> {
  if (!isAllowedMimeType(file.type)) {
    throw new PrepareRoomImageError(
      "INVALID_TYPE",
      "Please upload a JPG, PNG, or WebP image."
    );
  }

  if (file.size > MAX_INPUT_BYTES) {
    throw new PrepareRoomImageError("INPUT_TOO_LARGE", TOO_LARGE_INPUT_MESSAGE);
  }

  if (typeof window === "undefined") {
    throw new PrepareRoomImageError("PROCESSING_FAILED", PROCESSING_FAILURE_MESSAGE);
  }

  try {
    const image = await loadRoomImageElement(file);
    return await encodeLoadedBrowserImage(image, {
      originalName: file.name,
      originalBytes: file.size,
      outputMimeType: pickOutputMimeType(file.type.toLowerCase()),
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxLongestSidePx: MAX_LONGEST_SIDE_PX,
      jpegBackground: null,
      shrinkUntilFit: false,
    });
  } catch (error) {
    if (error instanceof PrepareRoomImageError) {
      throw error;
    }
    throw new PrepareRoomImageError("PROCESSING_FAILED", PROCESSING_FAILURE_MESSAGE);
  }
}
