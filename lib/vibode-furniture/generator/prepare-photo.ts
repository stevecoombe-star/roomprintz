/**
 * Browser preparation for a furniture photo.
 *
 * JPEG, PNG, and WebP stay in the browser. HEIC uses the browser when it
 * can decode the file, and otherwise the signed-in HEIC route. This module
 * does not reserve an allowance or contact the generation provider.
 */

import {
  encodeLoadedBrowserImage,
  loadRoomImageElement,
  PrepareRoomImageError,
} from "@/lib/prepareRoomImageForUpload";
import { detectStillMagic, inspectJpeg } from "@/lib/stillImageKind";
import { readGenerationAccessToken } from "@/lib/vibode-furniture/generator/beta-generation-client";

import {
  FURNITURE_HEIC_SERVER_MAX_BYTES,
  FURNITURE_JPEG_MATTE_CSS,
  FURNITURE_PHOTO_MAX_DECODED_EDGE_PX,
  FURNITURE_PHOTO_MAX_DECODED_PIXELS,
  FURNITURE_PHOTO_MAX_EDGE_PX,
  FURNITURE_PHOTO_MAX_INPUT_BYTES,
  FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  FURNITURE_PHOTO_PREPARATION_PATH,
} from "./photo-limits";
import {
  createPhotoPreparationGate,
  FURNITURE_PHOTO_MESSAGES,
  planFurniturePhoto,
} from "./photo-plan";

export { createPhotoPreparationGate, FURNITURE_PHOTO_MESSAGES };

export const furnitureBrowserEncodeOptions = Object.freeze({
  outputMimeType: "image/jpeg" as const,
  maxOutputBytes: FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  maxLongestSidePx: FURNITURE_PHOTO_MAX_EDGE_PX,
  jpegBackground: FURNITURE_JPEG_MATTE_CSS,
  shrinkUntilFit: true,
  maxDecodedPixels: FURNITURE_PHOTO_MAX_DECODED_PIXELS,
  maxDecodedEdgePx: FURNITURE_PHOTO_MAX_DECODED_EDGE_PX,
  tooManyPixelsMessage: FURNITURE_PHOTO_MESSAGES.tooManyPixels,
  logLabel: "furniture-photo",
});

export class FurniturePhotoPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FurniturePhotoPreparationError";
  }
}

export type PrepareFurniturePhotoDependencies = {
  signal?: AbortSignal;
  readToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  encodeFile?: (file: File, signal?: AbortSignal) => Promise<File>;
};

export async function prepareFurniturePhoto(
  file: File,
  deps: PrepareFurniturePhotoDependencies = {},
): Promise<File> {
  throwIfAborted(deps.signal);
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.empty);
  }
  if (file.size > FURNITURE_PHOTO_MAX_INPUT_BYTES) {
    throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.tooLarge);
  }
  const header = new Uint8Array(await file.slice(0, Math.min(64, file.size)).arrayBuffer());
  throwIfAborted(deps.signal);
  const magic = detectStillMagic(header);
  let jpeg = null;
  let jpegBytes: Uint8Array | null = null;
  if (magic === "jpeg" && file.size <= FURNITURE_PHOTO_MAX_OUTPUT_BYTES) {
    jpegBytes = new Uint8Array(await file.arrayBuffer());
    jpeg = inspectJpeg(jpegBytes);
    throwIfAborted(deps.signal);
  }
  const plan = planFurniturePhoto({
    fileName: file.name,
    mimeType: file.type,
    byteLength: file.size,
    magic,
    jpeg,
  });
  if (plan.action === "reject") throw new FurniturePhotoPreparationError(plan.message);
  if (plan.action === "passthrough") return jpegFile(file, jpegBytes);
  if (plan.action === "browser") return encodeBrowser(file, deps);
  try {
    return await encodeBrowser(file, deps);
  } catch (error) {
    if (isAbortError(error) || deps.signal?.aborted) throw abortError();
    if (!plan.serverAllowed) {
      throw new FurniturePhotoPreparationError(
        file.size > FURNITURE_HEIC_SERVER_MAX_BYTES
          ? FURNITURE_PHOTO_MESSAGES.heicTooLarge
          : FURNITURE_PHOTO_MESSAGES.heicFailed,
      );
    }
    return requestServerHeicJpeg(file, deps);
  }
}

async function encodeBrowser(file: File, deps: PrepareFurniturePhotoDependencies): Promise<File> {
  try {
    const encoded = await (deps.encodeFile ?? encodeFurnitureFileInBrowser)(file, deps.signal);
    return assertSubmissionJpeg(encoded);
  } catch (error) {
    if (isAbortError(error) || deps.signal?.aborted) throw abortError();
    if (error instanceof FurniturePhotoPreparationError) throw error;
    if (error instanceof PrepareRoomImageError) throw new FurniturePhotoPreparationError(error.message);
    throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.prepareFailed);
  }
}

export async function encodeFurnitureFileInBrowser(file: File, signal?: AbortSignal): Promise<File> {
  throwIfAborted(signal);
  const image = await loadRoomImageElement(file);
  throwIfAborted(signal);
  return encodeLoadedBrowserImage(image, {
    ...furnitureBrowserEncodeOptions,
    originalName: file.name,
    originalBytes: file.size,
  });
}

async function requestServerHeicJpeg(file: File, deps: PrepareFurniturePhotoDependencies): Promise<File> {
  throwIfAborted(deps.signal);
  const readToken = deps.readToken ?? readGenerationAccessToken;
  const token = await readToken();
  throwIfAborted(deps.signal);
  if (!token) throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.signIn);
  const body = new FormData();
  body.append("file", file, file.name || "photo.heic");
  const send = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await send(FURNITURE_PHOTO_PREPARATION_PATH, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body,
      signal: deps.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (isAbortError(error) || deps.signal?.aborted) throw abortError();
    throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.heicFailed);
  }
  throwIfAborted(deps.signal);
  if (response.status === 401) throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.signIn);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
    if (response.status === 413) {
      throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.heicTooLarge);
    }
    if (typeof error === "string" && isSafeCustomerError(error)) {
      throw new FurniturePhotoPreparationError(error);
    }
    throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.heicFailed);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  throwIfAborted(deps.signal);
  if (!isSubmissionJpeg(bytes)) throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.heicFailed);
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([bytes], `${base}.jpg`, { type: "image/jpeg" });
}

function jpegFile(file: File, bytes: Uint8Array | null): File {
  if (file.type === "image/jpeg") return file;
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  if (!bytes) return new File([file], `${base}.jpg`, { type: "image/jpeg" });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], `${base}.jpg`, { type: "image/jpeg" });
}

async function assertSubmissionJpeg(file: File): Promise<File> {
  if (file.type !== "image/jpeg" || file.size <= 0 || file.size > FURNITURE_PHOTO_MAX_OUTPUT_BYTES) {
    throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.prepareFailed);
  }
  const header = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  if (detectStillMagic(header) !== "jpeg") {
    throw new FurniturePhotoPreparationError(FURNITURE_PHOTO_MESSAGES.prepareFailed);
  }
  return file;
}

function isSubmissionJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength > 0
    && bytes.byteLength <= FURNITURE_PHOTO_MAX_OUTPUT_BYTES
    && detectStillMagic(bytes) === "jpeg";
}

function isSafeCustomerError(error: string): boolean {
  return error.length > 0 && error.length <= 180 && !/https?:|meshy|credit/i.test(error);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException("The photo preparation was cancelled.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
