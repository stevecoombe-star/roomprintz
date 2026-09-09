import {
  AFC_V2_ORIGINAL_STORAGE_BUCKET,
  type AfcRoomPointer,
} from "./production-store";

export const AFC_V2_ORIGINAL_SIGNED_URL_EXPIRES_IN_SEC = 30 * 60;
export const AFC_V2_ORIGINAL_SOURCE_URL_MAX_LENGTH = 4096;

export type OwnedOriginalFailureCode =
  | "unowned_path"
  | "inconsistent_asset"
  | "missing_path"
  | "invalid_bucket"
  | "download_failed"
  | "sign_failed"
  | "invalid_source_url";

export type OwnedOriginalStorageRef = Readonly<{
  bucket: string;
  path: string;
}>;

export type PrepareOwnedOriginalResult =
  | Readonly<{
    ok: true;
    bytes: Uint8Array;
    sourceImageUrl: string;
  }>
  | Readonly<{
    ok: false;
    code: OwnedOriginalFailureCode;
  }>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ownedOriginalStoragePrefix(userId: string): string {
  return `users/${userId}/`;
}

function normalizeStoragePath(storagePath: string): string | null {
  if (typeof storagePath !== "string") return null;
  const trimmed = storagePath.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return null;
  if (normalized.includes("..") || normalized.includes("//")) return null;
  if (normalized.startsWith("users/") === false) return null;
  return normalized;
}

export function isOwnedOriginalStoragePath(
  userId: string,
  storagePath: string,
): boolean {
  if (!UUID.test(userId)) return false;
  const normalized = normalizeStoragePath(storagePath);
  if (!normalized) return false;
  const prefix = ownedOriginalStoragePrefix(userId);
  return normalized.startsWith(prefix) && normalized.length > prefix.length;
}

export function isProductionOriginalSourceUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (
    trimmed.length < 8 ||
    trimmed.length > AFC_V2_ORIGINAL_SOURCE_URL_MAX_LENGTH
  ) {
    return false;
  }
  if (/vibode\.invalid/i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveOwnedOriginalStorage(input: Readonly<{
  authenticatedUserId: string;
  roomId: string;
  room: Pick<
    AfcRoomPointer,
    "id" | "userId" | "baseStorageBucket" | "baseStoragePath" | "baseAsset"
  >;
}>):
  | Readonly<{ ok: true; ref: OwnedOriginalStorageRef }>
  | Readonly<{ ok: false; code: OwnedOriginalFailureCode }> {
  if (input.room.id !== input.roomId) {
    return { ok: false, code: "inconsistent_asset" };
  }
  if (input.room.userId !== input.authenticatedUserId) {
    return { ok: false, code: "unowned_path" };
  }

  const asset = input.room.baseAsset;
  if (asset) {
    if (
      asset.userId !== input.authenticatedUserId ||
      asset.roomId !== input.roomId
    ) {
      return { ok: false, code: "inconsistent_asset" };
    }
  }

  const roomPath = input.room.baseStoragePath;
  const assetPath = asset?.storagePath ?? null;
  if (
    typeof roomPath === "string" &&
    typeof assetPath === "string" &&
    normalizeStoragePath(roomPath) !== normalizeStoragePath(assetPath)
  ) {
    return { ok: false, code: "inconsistent_asset" };
  }

  const resolvedPath = roomPath ?? assetPath;
  if (typeof resolvedPath !== "string" || !resolvedPath) {
    return { ok: false, code: "missing_path" };
  }
  if (!isOwnedOriginalStoragePath(input.authenticatedUserId, resolvedPath)) {
    return { ok: false, code: "unowned_path" };
  }

  const bucket = asset?.storageBucket ??
    input.room.baseStorageBucket ??
    AFC_V2_ORIGINAL_STORAGE_BUCKET;
  if (bucket !== AFC_V2_ORIGINAL_STORAGE_BUCKET) {
    return { ok: false, code: "invalid_bucket" };
  }

  const path = normalizeStoragePath(resolvedPath);
  if (!path) return { ok: false, code: "unowned_path" };

  return Object.freeze({
    ok: true as const,
    ref: Object.freeze({ bucket, path }),
  });
}

export async function prepareOwnedOriginalForAnalysis(input: Readonly<{
  authenticatedUserId: string;
  room: AfcRoomPointer;
  download: (ref: OwnedOriginalStorageRef) => Promise<Uint8Array | null>;
  sign: (
    ref: OwnedOriginalStorageRef,
    expiresInSec: number,
  ) => Promise<string | null>;
  expiresInSec?: number;
}>): Promise<PrepareOwnedOriginalResult> {
  const resolved = resolveOwnedOriginalStorage({
    authenticatedUserId: input.authenticatedUserId,
    roomId: input.room.id,
    room: input.room,
  });
  if (!resolved.ok) return resolved;

  const bytes = await input.download(resolved.ref);
  if (!bytes || bytes.byteLength === 0) {
    return { ok: false, code: "download_failed" };
  }

  const expiresInSec = input.expiresInSec ??
    AFC_V2_ORIGINAL_SIGNED_URL_EXPIRES_IN_SEC;
  const sourceImageUrl = await input.sign(resolved.ref, expiresInSec);
  if (!sourceImageUrl || !isProductionOriginalSourceUrl(sourceImageUrl)) {
    return { ok: false, code: "sign_failed" };
  }

  return Object.freeze({
    ok: true as const,
    bytes,
    sourceImageUrl,
  });
}
