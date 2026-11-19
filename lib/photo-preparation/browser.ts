/**
 * Browser half of oversized HEIC preparation. The original file is uploaded
 * to a signed private URL. This module does not reserve credits or contact Meshy.
 */

import {
  encodeLoadedBrowserImage,
  loadRoomImageElement,
  MAX_LONGEST_SIDE_PX,
  MAX_OUTPUT_BYTES,
  PrepareRoomImageError,
} from "@/lib/prepareRoomImageForUpload";
import { detectStillMagic } from "@/lib/stillImageKind";
import { FURNITURE_PHOTO_MAX_OUTPUT_BYTES } from "@/lib/vibode-furniture/generator/photo-limits";

import { PHOTO_PREPARATION_MESSAGES, type PhotoPurpose } from "./handler";

import {
  PHOTO_PREPARATION_ABANDON_PATH,
  PHOTO_PREPARATION_BEGIN_PATH,
  PHOTO_PREPARATION_COMPLETE_PATH,
  PHOTO_PREPARATION_DIRECT_MAX_BYTES,
  PHOTO_PREPARATION_MAX_INPUT_BYTES,
} from "./limits";

export class PhotoPreparationError extends Error {
  readonly code: "sign_in" | "too_large" | "busy" | "rate" | "failed" | "aborted";

  constructor(code: PhotoPreparationError["code"], message: string) {
    super(message);
    this.name = "PhotoPreparationError";
    this.code = code;
  }
}

export type StoredPhotoDependencies = Readonly<{
  signal?: AbortSignal;
  readToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  uploadImpl?: (signedUrl: string, file: File, signal?: AbortSignal) => Promise<void>;
}>;

export async function prepareLargeRoomPhoto(file: File, deps: StoredPhotoDependencies): Promise<File> {
  throwIfAborted(deps.signal);
  if (file.size > PHOTO_PREPARATION_MAX_INPUT_BYTES) {
    throw new PhotoPreparationError("too_large", "This image is too large. Please upload a photo under 25MB.");
  }
  try {
    const image = await loadRoomImageElement(file);
    throwIfAborted(deps.signal);
    return await encodeLoadedBrowserImage(image, {
      originalName: file.name,
      originalBytes: file.size,
      outputMimeType: "image/jpeg",
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxLongestSidePx: MAX_LONGEST_SIDE_PX,
      jpegBackground: null,
      shrinkUntilFit: true,
      logLabel: "room-heic",
    });
  } catch (error) {
    if (isAbort(error) || deps.signal?.aborted) throw abortError();
    if (error instanceof PhotoPreparationError) throw error;
    if (!(error instanceof PrepareRoomImageError) && !(error instanceof Error)) {
      throw new PhotoPreparationError("failed", PHOTO_PREPARATION_MESSAGES.failed);
    }
  }
  return preparePhotoThroughStorage(file, "room", deps);
}

export async function preparePhotoThroughStorage(
  file: File,
  purpose: PhotoPurpose,
  deps: StoredPhotoDependencies,
): Promise<File> {
  throwIfAborted(deps.signal);
  if (file.size <= PHOTO_PREPARATION_DIRECT_MAX_BYTES || file.size > PHOTO_PREPARATION_MAX_INPUT_BYTES) {
    throw new PhotoPreparationError(
      file.size > PHOTO_PREPARATION_MAX_INPUT_BYTES ? "too_large" : "failed",
      file.size > PHOTO_PREPARATION_MAX_INPUT_BYTES
        ? PHOTO_PREPARATION_MESSAGES.tooLarge
        : PHOTO_PREPARATION_MESSAGES.failed,
    );
  }
  const token = await deps.readToken();
  throwIfAborted(deps.signal);
  if (!token) throw new PhotoPreparationError("sign_in", PHOTO_PREPARATION_MESSAGES.signIn);
  const send = deps.fetchImpl ?? fetch;
  const begun = await sendJson(send, PHOTO_PREPARATION_BEGIN_PATH, token, {
    purpose,
    byteSize: file.size,
  }, deps.signal);
  const preparationId = typeof begun.preparationId === "string" ? begun.preparationId : "";
  const signedUrl = typeof begun.signedUrl === "string" ? begun.signedUrl : "";
  if (!preparationId || !signedUrl.startsWith("https://")) {
    throw new PhotoPreparationError("failed", PHOTO_PREPARATION_MESSAGES.failed);
  }
  try {
    throwIfAborted(deps.signal);
    await (deps.uploadImpl ?? putSignedPhoto)(signedUrl, file, deps.signal);
    throwIfAborted(deps.signal);
    const completed = await send(PHOTO_PREPARATION_COMPLETE_PATH, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ preparationId, purpose }),
      signal: deps.signal,
      cache: "no-store",
    });
    if (!completed.ok) throw await errorFromResponse(completed);
    const bytes = new Uint8Array(await completed.arrayBuffer());
    throwIfAborted(deps.signal);
    if (detectStillMagic(bytes) !== "jpeg" || bytes.byteLength <= 0 || bytes.byteLength > outputCeiling(purpose)) {
      throw new PhotoPreparationError("failed", PHOTO_PREPARATION_MESSAGES.failed);
    }
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new File([copy], `${base}.jpg`, { type: "image/jpeg" });
  } catch (error) {
    await abandon(send, token, preparationId, purpose);
    if (isAbort(error) || deps.signal?.aborted) throw abortError();
    if (error instanceof PhotoPreparationError) throw error;
    throw new PhotoPreparationError("failed", PHOTO_PREPARATION_MESSAGES.failed);
  }
}

function outputCeiling(purpose: PhotoPurpose): number {
  return purpose === "room" ? MAX_OUTPUT_BYTES : FURNITURE_PHOTO_MAX_OUTPUT_BYTES;
}

async function putSignedPhoto(signedUrl: string, file: File, signal?: AbortSignal): Promise<void> {
  const response = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "content-type": "image/heic",
      "x-upsert": "false",
    },
    body: file,
    signal,
  });
  if (!response.ok) throw new PhotoPreparationError("failed", PHOTO_PREPARATION_MESSAGES.failed);
}

async function sendJson(
  send: typeof fetch,
  path: string,
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await send(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (isAbort(error) || signal?.aborted) throw abortError();
    throw new PhotoPreparationError("failed", PHOTO_PREPARATION_MESSAGES.failed);
  }
  if (!response.ok) throw await errorFromResponse(response);
  const payload = await response.json() as unknown;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

async function abandon(
  send: typeof fetch,
  token: string,
  preparationId: string,
  purpose: PhotoPurpose,
): Promise<void> {
  try {
    await send(PHOTO_PREPARATION_ABANDON_PATH, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ preparationId, purpose }),
      cache: "no-store",
    });
  } catch {
    // The signed upload expires and the worker deletes the scratch object.
  }
}

async function errorFromResponse(response: Response): Promise<PhotoPreparationError> {
  if (response.status === 401) return new PhotoPreparationError("sign_in", PHOTO_PREPARATION_MESSAGES.signIn);
  const payload = await response.json().catch(() => null);
  const error = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
  if (response.status === 413) return new PhotoPreparationError("too_large", PHOTO_PREPARATION_MESSAGES.tooLarge);
  if (response.status === 429 && error === PHOTO_PREPARATION_MESSAGES.rate) {
    return new PhotoPreparationError("rate", PHOTO_PREPARATION_MESSAGES.rate);
  }
  if (response.status === 429) return new PhotoPreparationError("busy", PHOTO_PREPARATION_MESSAGES.busy);
  return new PhotoPreparationError("failed", PHOTO_PREPARATION_MESSAGES.failed);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException("The photo preparation was cancelled.", "AbortError");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
