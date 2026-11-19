/**
 * Authenticated preparation of one oversized HEIC/HEIF photograph.
 * The handler never reserves an allowance, reads a ledger, or contacts a
 * model provider. The original is stored only long enough to convert it.
 */

import { detectStillMagic } from "@/lib/stillImageKind";

import {
  isPhotoPreparationObjectPath,
  photoPreparationJsonStatus,
  photoPreparationPathOwnedBy,
  PHOTO_PREPARATION_DIRECT_MAX_BYTES,
  PHOTO_PREPARATION_MAX_INPUT_BYTES,
} from "./limits";

export type PhotoPurpose = "room" | "furniture";

export const PHOTO_PREPARATION_MESSAGES = Object.freeze({
  signIn: "Sign in to prepare this photo.",
  tooLarge: "This photo is too large. Please choose one under 25 MB.",
  busy: "Another photo is still being prepared. Try again in a moment.",
  rate: "Too many photos were prepared just now. Try again in a little while.",
  failed: "We couldn't prepare this photo. Try another one.",
  unsupported: "Please choose a JPG, PNG, WebP, or HEIC/HEIF still image.",
});

export type PhotoPreparationFailure = Readonly<{ status: number; error: string }>;

export type PhotoPreparationDeps = Readonly<{
  now: () => Date;
  authorize: (
    request: Request,
    purpose: PhotoPurpose,
  ) => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;
  sweep: (now: Date) => Promise<readonly string[]>;
  removeObject: (objectPath: string) => Promise<void>;
  begin: (input: Readonly<{
    userId: string;
    purpose: PhotoPurpose;
    byteSize: number;
    now: Date;
  }>) => Promise<
    | { ok: true; preparationId: string; objectPath: string }
    | { ok: false; code: "invalid" | "too_large" | "capacity" | "rate" | "unavailable" }
  >;
  signUpload: (objectPath: string) => Promise<{ signedUrl: string } | null>;
  close: (input: Readonly<{ userId: string; preparationId: string; now: Date }>) => Promise<
    | { ok: true; objectPath: string | null }
    | { ok: false; code: "not_found" | "busy" | "unavailable" }
  >;
  claim: (input: Readonly<{ userId: string; preparationId: string; now: Date }>) => Promise<
    | { ok: true; objectPath: string; byteSize: number; purpose: PhotoPurpose }
    | { ok: false; code: "not_found" | "expired" | "busy" | "invalid" | "unavailable" }
  >;
  download: (objectPath: string) => Promise<Uint8Array | null>;
  convert: (bytes: Uint8Array, purpose: PhotoPurpose) => Promise<{ bytes: Uint8Array }>;
  finish: (input: Readonly<{ userId: string; preparationId: string; now: Date }>) => Promise<
    | { ok: true; objectPath: string | null }
    | { ok: false; code: "not_found" | "unavailable" }
  >;
  outputLimit: (purpose: PhotoPurpose) => number;
}>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function beginPhotoPreparation(
  request: Request,
  deps: PhotoPreparationDeps,
): Promise<
  | { status: 200; preparationId: string; signedUrl: string }
  | PhotoPreparationFailure
> {
  const length = photoPreparationJsonStatus(request.headers.get("content-length"));
  if (length !== "ok") return { status: 413, error: PHOTO_PREPARATION_MESSAGES.failed };
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { status: 400, error: PHOTO_PREPARATION_MESSAGES.failed };
  }
  const parsed = parseBeginBody(body);
  if (!parsed.ok) return { status: parsed.status, error: parsed.error };
  const caller = await deps.authorize(request, parsed.purpose);
  if (!caller.ok) return { status: caller.status, error: safeError(caller.error) };
  await deleteSweptPaths(deps);
  const begun = await deps.begin({
    userId: caller.userId,
    purpose: parsed.purpose,
    byteSize: parsed.byteSize,
    now: deps.now(),
  });
  if (!begun.ok) return beginFailure(begun.code);
  if (!photoPreparationPathOwnedBy(begun.objectPath, caller.userId) || !UUID.test(begun.preparationId)) {
    await release(deps, caller.userId, begun.preparationId, begun.objectPath);
    return { status: 500, error: PHOTO_PREPARATION_MESSAGES.failed };
  }
  const signed = await deps.signUpload(begun.objectPath);
  if (!signed?.signedUrl.startsWith("https://")) {
    await release(deps, caller.userId, begun.preparationId, begun.objectPath);
    return { status: 500, error: PHOTO_PREPARATION_MESSAGES.failed };
  }
  return { status: 200, preparationId: begun.preparationId, signedUrl: signed.signedUrl };
}

export async function completePhotoPreparation(
  request: Request,
  deps: PhotoPreparationDeps,
): Promise<{ status: 200; bytes: Uint8Array } | PhotoPreparationFailure> {
  const length = photoPreparationJsonStatus(request.headers.get("content-length"));
  if (length !== "ok") return { status: 413, error: PHOTO_PREPARATION_MESSAGES.failed };
  const requested = await readPreparationRequest(request);
  if (!requested) return { status: 400, error: PHOTO_PREPARATION_MESSAGES.failed };
  const owner = await deps.authorize(request, requested.purpose);
  if (!owner.ok) return { status: owner.status, error: safeError(owner.error) };
  const claimed = await deps.claim({ userId: owner.userId, preparationId: requested.preparationId, now: deps.now() });
  if (!claimed.ok) {
    if (claimed.code === "expired") {
      const closed = await deps.close({ userId: owner.userId, preparationId: requested.preparationId, now: deps.now() });
      if (closed.ok && closed.objectPath && photoPreparationPathOwnedBy(closed.objectPath, owner.userId)) {
        await deps.removeObject(closed.objectPath);
      }
    }
    return claimed.code === "busy"
      ? { status: 429, error: PHOTO_PREPARATION_MESSAGES.busy }
      : { status: 422, error: PHOTO_PREPARATION_MESSAGES.failed };
  }
  let result: { status: 200; bytes: Uint8Array } | PhotoPreparationFailure = {
    status: 422,
    error: PHOTO_PREPARATION_MESSAGES.failed,
  };
  try {
    if (claimed.purpose !== requested.purpose || !photoPreparationPathOwnedBy(claimed.objectPath, owner.userId)) {
      result = { status: 422, error: PHOTO_PREPARATION_MESSAGES.failed };
    } else {
      const original = await deps.download(claimed.objectPath);
      if (
        !original
        || original.byteLength !== claimed.byteSize
        || original.byteLength > PHOTO_PREPARATION_MAX_INPUT_BYTES
        || original.byteLength <= PHOTO_PREPARATION_DIRECT_MAX_BYTES
        || detectStillMagic(original) !== "heic"
      ) {
        result = { status: 422, error: PHOTO_PREPARATION_MESSAGES.unsupported };
      } else {
        const converted = await deps.convert(original, claimed.purpose);
        const limit = deps.outputLimit(claimed.purpose);
        if (
          !(converted.bytes instanceof Uint8Array)
          || converted.bytes.byteLength <= 0
          || converted.bytes.byteLength > limit
          || converted.bytes.byteLength > VERCEL_SAFE_RESPONSE_BYTES
          || detectStillMagic(converted.bytes) !== "jpeg"
        ) {
          result = { status: 422, error: PHOTO_PREPARATION_MESSAGES.failed };
        } else {
          result = { status: 200, bytes: converted.bytes };
        }
      }
    }
  } catch {
    result = { status: 422, error: PHOTO_PREPARATION_MESSAGES.failed };
  } finally {
    try {
      const finished = await deps.finish({
        userId: owner.userId,
        preparationId: requested.preparationId,
        now: deps.now(),
      });
      if (finished.ok && finished.objectPath && photoPreparationPathOwnedBy(finished.objectPath, owner.userId)) {
        await deps.removeObject(finished.objectPath);
      }
    } catch {
      // The worker sweep deletes a closed or expired object if this request is interrupted.
    }
  }
  return result;
}

export async function abandonPhotoPreparation(
  request: Request,
  deps: PhotoPreparationDeps,
): Promise<{ status: 200 } | PhotoPreparationFailure> {
  const length = photoPreparationJsonStatus(request.headers.get("content-length"));
  if (length !== "ok") return { status: 413, error: PHOTO_PREPARATION_MESSAGES.failed };
  const requested = await readPreparationRequest(request);
  if (!requested) return { status: 400, error: PHOTO_PREPARATION_MESSAGES.failed };
  const owner = await deps.authorize(request, requested.purpose);
  if (!owner.ok) return { status: owner.status, error: safeError(owner.error) };
  const closed = await deps.close({ userId: owner.userId, preparationId: requested.preparationId, now: deps.now() });
  if (!closed.ok) {
    return closed.code === "busy"
      ? { status: 409, error: PHOTO_PREPARATION_MESSAGES.busy }
      : { status: closed.code === "not_found" ? 404 : 422, error: PHOTO_PREPARATION_MESSAGES.failed };
  }
  if (closed.objectPath && photoPreparationPathOwnedBy(closed.objectPath, owner.userId)) {
    await deps.removeObject(closed.objectPath);
  }
  return { status: 200 };
}

const VERCEL_SAFE_RESPONSE_BYTES = 4_000_000;

function parseBeginBody(body: unknown):
  | { ok: true; purpose: PhotoPurpose; byteSize: number }
  | { ok: false; status: number; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: PHOTO_PREPARATION_MESSAGES.failed };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "purpose" && key !== "byteSize")) {
    return { ok: false, status: 400, error: PHOTO_PREPARATION_MESSAGES.failed };
  }
  if (record.purpose !== "room" && record.purpose !== "furniture") {
    return { ok: false, status: 400, error: PHOTO_PREPARATION_MESSAGES.failed };
  }
  if (!Number.isInteger(record.byteSize) || (record.byteSize as number) <= 0) {
    return { ok: false, status: 400, error: PHOTO_PREPARATION_MESSAGES.failed };
  }
  if ((record.byteSize as number) > PHOTO_PREPARATION_MAX_INPUT_BYTES) {
    return { ok: false, status: 413, error: PHOTO_PREPARATION_MESSAGES.tooLarge };
  }
  if ((record.byteSize as number) <= PHOTO_PREPARATION_DIRECT_MAX_BYTES) {
    return { ok: false, status: 400, error: PHOTO_PREPARATION_MESSAGES.failed };
  }
  return { ok: true, purpose: record.purpose, byteSize: record.byteSize as number };
}

async function readPreparationRequest(
  request: Request,
): Promise<{ preparationId: string; purpose: PhotoPurpose } | null> {
  try {
    const body = await request.json() as { preparationId?: unknown; purpose?: unknown };
    if (body.purpose !== "room" && body.purpose !== "furniture") return null;
    if (typeof body.preparationId !== "string" || !UUID.test(body.preparationId)) return null;
    return { preparationId: body.preparationId.toLowerCase(), purpose: body.purpose };
  } catch {
    return null;
  }
}

async function deleteSweptPaths(deps: PhotoPreparationDeps): Promise<void> {
  try {
    const paths = await deps.sweep(deps.now());
    for (const path of paths) {
      if (isPhotoPreparationObjectPath(path)) await deps.removeObject(path);
    }
  } catch {
    // A missed sweep is retried by the generation worker. Beginning still proceeds.
  }
}

async function release(
  deps: PhotoPreparationDeps,
  userId: string,
  preparationId: string,
  objectPath: string | null,
): Promise<void> {
  const closed = await deps.finish({ userId, preparationId, now: deps.now() });
  const path = closed.ok ? closed.objectPath : objectPath;
  if (path && photoPreparationPathOwnedBy(path, userId)) await deps.removeObject(path);
}

function beginFailure(code: "invalid" | "too_large" | "capacity" | "rate" | "unavailable"): PhotoPreparationFailure {
  if (code === "too_large") return { status: 413, error: PHOTO_PREPARATION_MESSAGES.tooLarge };
  if (code === "capacity") return { status: 429, error: PHOTO_PREPARATION_MESSAGES.busy };
  if (code === "rate") return { status: 429, error: PHOTO_PREPARATION_MESSAGES.rate };
  return { status: 422, error: PHOTO_PREPARATION_MESSAGES.failed };
}

function safeError(error: string): string {
  if (error.length > 0 && error.length <= 180 && !/https?:|meshy|credit|service_role/i.test(error)) return error;
  return PHOTO_PREPARATION_MESSAGES.signIn;
}
