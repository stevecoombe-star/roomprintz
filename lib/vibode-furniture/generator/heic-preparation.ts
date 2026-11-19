/**
 * Authenticated HEIC/HEIF preparation. The handler never reserves an
 * allowance, reads a ledger, or contacts a model provider. JPEG, PNG, and
 * WebP photos are normalized in the browser and are rejected here.
 */

import { detectStillMagic } from "@/lib/stillImageKind";
import { isLivePhotoMovCompanion } from "@/lib/uploadImageFileTypes";

import { FURNITURE_PHOTO_MESSAGES } from "./photo-plan";
import {
  FURNITURE_HEIC_REQUEST_MAX_BYTES,
  FURNITURE_HEIC_SERVER_MAX_BYTES,
  FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
} from "./photo-limits";

export type HeicPreparationResult =
  | Readonly<{ status: 200; bytes: Uint8Array; contentType: "image/jpeg" }>
  | Readonly<{ status: number; error: string }>;

export function heicPreparationBodyStatus(
  contentLength: string | null,
): "ok" | "too_large" | "unreadable" {
  if (contentLength == null || contentLength === "") return "ok";
  if (!/^\d+$/.test(contentLength)) return "unreadable";
  return Number(contentLength) > FURNITURE_HEIC_REQUEST_MAX_BYTES ? "too_large" : "ok";
}

export async function handleFurnitureHeicPreparation(
  request: Request,
  deps: Readonly<{
    authorize: (request: Request) => Promise<
      | { ok: true }
      | { ok: false; status: number; error: string }
    >;
    convert: (bytes: Uint8Array) => Promise<{ bytes: Uint8Array }>;
  }>,
): Promise<HeicPreparationResult> {
  const length = heicPreparationBodyStatus(request.headers.get("content-length"));
  if (length === "too_large") return { status: 413, error: FURNITURE_PHOTO_MESSAGES.heicTooLarge };
  if (length === "unreadable") return { status: 400, error: FURNITURE_PHOTO_MESSAGES.heicFailed };
  const caller = await deps.authorize(request);
  if (!caller.ok) return { status: caller.status, error: caller.error };

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { status: 400, error: FURNITURE_PHOTO_MESSAGES.heicFailed };
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) return { status: 400, error: FURNITURE_PHOTO_MESSAGES.heicFailed };
  const name = file instanceof File && file.name.trim() ? file.name.trim() : "upload";
  if (isLivePhotoMovCompanion({ name, type: file.type })) {
    return { status: 400, error: FURNITURE_PHOTO_MESSAGES.livePhoto };
  }
  if (file.size <= 0) return { status: 400, error: FURNITURE_PHOTO_MESSAGES.empty };
  if (file.size > FURNITURE_HEIC_SERVER_MAX_BYTES) {
    return { status: 413, error: FURNITURE_PHOTO_MESSAGES.heicTooLarge };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength <= 0 || bytes.byteLength > FURNITURE_HEIC_SERVER_MAX_BYTES) {
    return { status: 413, error: FURNITURE_PHOTO_MESSAGES.heicTooLarge };
  }
  if (detectStillMagic(bytes) !== "heic") {
    return { status: 400, error: FURNITURE_PHOTO_MESSAGES.unsupported };
  }
  try {
    const converted = await deps.convert(bytes);
    if (
      !(converted.bytes instanceof Uint8Array)
      || converted.bytes.byteLength <= 0
      || converted.bytes.byteLength > FURNITURE_PHOTO_MAX_OUTPUT_BYTES
      || detectStillMagic(converted.bytes) !== "jpeg"
    ) {
      return { status: 422, error: FURNITURE_PHOTO_MESSAGES.heicFailed };
    }
    return { status: 200, bytes: converted.bytes, contentType: "image/jpeg" };
  } catch {
    return { status: 422, error: FURNITURE_PHOTO_MESSAGES.heicFailed };
  }
}
