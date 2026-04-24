const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 3.25 * 1024 * 1024;
const MAX_LONGEST_SIDE_PX = 2048;
const PRIMARY_QUALITY = 0.85;
const RETRY_QUALITY = 0.75;

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

function computeScaledDimensions(width: number, height: number) {
  const longestSide = Math.max(width, height);
  if (longestSide <= MAX_LONGEST_SIDE_PX) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }

  const scale = MAX_LONGEST_SIDE_PX / longestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
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

function logCompressionStats(originalBytes: number, compressedBytes: number) {
  const compressionRatio = originalBytes > 0 ? compressedBytes / originalBytes : 1;
  console.debug("[room-upload] image optimization stats", {
    originalSizeBytes: originalBytes,
    compressedSizeBytes: compressedBytes,
    compressionRatio,
  });
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
    const image = await loadImageFromFile(file);
    const { width, height } = computeScaledDimensions(image.width, image.height);
    const outputMimeType = pickOutputMimeType(file.type.toLowerCase());

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new PrepareRoomImageError("PROCESSING_FAILED", PROCESSING_FAILURE_MESSAGE);
    }

    ctx.drawImage(image, 0, 0, width, height);

    let compressedBlob = await canvasToBlob(canvas, outputMimeType, PRIMARY_QUALITY);
    if (compressedBlob.size > MAX_OUTPUT_BYTES) {
      compressedBlob = await canvasToBlob(canvas, outputMimeType, RETRY_QUALITY);
    }

    if (compressedBlob.size > MAX_OUTPUT_BYTES) {
      throw new PrepareRoomImageError("PROCESSING_FAILED", PROCESSING_FAILURE_MESSAGE);
    }

    logCompressionStats(file.size, compressedBlob.size);

    const outputName = buildOutputFilename(file.name, outputMimeType);
    return new File([compressedBlob], outputName, { type: outputMimeType });
  } catch (error) {
    if (error instanceof PrepareRoomImageError) {
      throw error;
    }
    throw new PrepareRoomImageError("PROCESSING_FAILED", PROCESSING_FAILURE_MESSAGE);
  }
}
