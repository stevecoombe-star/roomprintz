import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isVibodeWebp,
  readVibodeImageDimensions,
  renderVibode2dThumbnail,
  vibode2dThumbnailBucket,
  vibode2dThumbnailObjectPath,
} from "@/lib/vibodeAssetThumbnails";

/**
 * One-time repair for Vibode room assets whose 2D thumbnail derivative
 * was never stored. Listing reads stay read-only; this module is the
 * only writer.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SOURCE_BUCKETS = new Set(["vibode-base-images", "vibode-generations"]);

export const VIBODE_2D_THUMBNAIL_BACKFILL_CACHE_MAX_AGE_SEC = 31_536_000;

const ASSET_COLUMNS =
  "id,room_id,user_id,asset_type,is_active,storage_bucket,storage_path,thumbnail_storage_bucket,thumbnail_storage_path,width,height,created_at";

export type BackfillAsset = {
  id: string;
  roomId: string;
  userId: string;
  assetType: string;
  isActive: boolean;
  isListingAsset: boolean;
  roomExists: boolean;
  storageBucket: string | null;
  storagePath: string | null;
  thumbnailStorageBucket: string | null;
  thumbnailStoragePath: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
};

export type BackfillOutcome =
  | "skipped"
  | "repaired"
  | "reused"
  | "planned"
  | "planned-reuse"
  | "failed"
  | "source-missing";

export type BackfillByteReport = {
  sourceBytes: number | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  derivativeBytes: number | null;
  derivativeWidth: number | null;
  derivativeHeight: number | null;
};

export type ThumbnailBackfillResult = {
  assetId: string;
  roomId: string;
  outcome: BackfillOutcome;
  reason: string;
  errorClass: string | null;
  targetBucket: string | null;
  targetPath: string | null;
  sourceBucket: string | null;
  sourcePath: string | null;
  sourceAvailable: boolean | null;
  dbUpdated: boolean;
  bytes: BackfillByteReport | null;
};

export type BackfillReport = {
  dryRun: boolean;
  candidates: number;
  scanned: number;
  skipped: number;
  repaired: number;
  planned: number;
  failed: number;
  sourceMissing: number;
  objectReused: number;
  plannedReuse: number;
  dbUpdated: number;
  results: ThumbnailBackfillResult[];
};

export type BackfillStorage = {
  stat(bucket: string, objectPath: string): Promise<{ exists: boolean; bytes: number | null }>;
  download(bucket: string, objectPath: string): Promise<Buffer | null>;
  uploadDerivative(args: {
    bucket: string;
    path: string;
    bytes: Buffer;
    upsert: boolean;
  }): Promise<"uploaded" | "exists">;
};

export type BackfillThumbnailUpdate = {
  assetId: string;
  roomId: string;
  userId: string;
  previousThumbnailPath: string | null;
  thumbnailStorageBucket: string;
  thumbnailStoragePath: string;
};

type StorageListEntry = {
  name?: string;
  metadata?: { size?: number } | null;
};

type StorageFileApi = {
  list(
    folder: string,
    options: { limit: number; search?: string },
  ): Promise<{ data: StorageListEntry[] | null; error: { message: string } | null }>;
  download(
    path: string,
  ): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: { message: string } | null }>;
  upload(
    path: string,
    body: Buffer,
    options: { contentType: string; cacheControl: string; upsert: boolean },
  ): Promise<{ error: { message: string; statusCode?: number | string } | null }>;
};

type LoadQuery = {
  assetId?: string | null;
  roomId?: string | null;
  verifyExisting?: boolean;
};

export function backfillCandidateRank(asset: BackfillAsset): number {
  if (asset.isListingAsset) return 0;
  if (asset.isActive && asset.roomExists) return 1;
  if (asset.roomExists) return 2;
  return 3;
}

export function selectBackfillCandidates(
  assets: readonly BackfillAsset[],
  options: { assetId?: string | null; roomId?: string | null; limit?: number | null } = {},
): { candidates: BackfillAsset[]; selected: BackfillAsset[] } {
  const assetId = normalizeText(options.assetId);
  const roomId = normalizeText(options.roomId);
  const limit = options.limit ?? null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("Thumbnail backfill limit must be a positive integer.");
  }

  const candidates = assets.filter((asset) => {
    if (assetId && asset.id !== assetId) return false;
    if (roomId && asset.roomId !== roomId) return false;
    return true;
  });
  const sorted = [...candidates].sort(compareBackfillAssets);
  const selected = limit === null ? sorted : sorted.slice(0, limit);
  return { candidates, selected };
}

export function isAllowedVibodeRoomImageBucket(bucket: string): boolean {
  if (SOURCE_BUCKETS.has(bucket)) return true;
  const staged = (process.env.VIBODE_STAGED_BUCKET || "").trim();
  return staged.length > 0 && bucket === staged;
}

export function isSafeVibodeStoragePath(objectPath: string): boolean {
  if (!objectPath || objectPath.length > 512) return false;
  if (objectPath.startsWith("/") || objectPath.endsWith("/")) return false;
  if (objectPath.includes("\\") || objectPath.includes("..") || objectPath.includes("//")) return false;
  return /^[a-zA-Z0-9._/-]+$/.test(objectPath);
}

export function canonicalVibode2dThumbnailPath(roomId: string, assetId: string): string | null {
  if (!UUID.test(roomId) || !UUID.test(assetId)) return null;
  const objectPath = vibode2dThumbnailObjectPath(roomId, assetId);
  return objectPath === `${roomId}/${assetId}/thumb.webp` ? objectPath : null;
}

export function createVibode2dThumbnailBackfillStorage(supabase: {
  storage: { from(bucket: string): StorageFileApi };
}): BackfillStorage {
  return {
    async stat(bucket, objectPath) {
      const slash = objectPath.lastIndexOf("/");
      const folder = slash >= 0 ? objectPath.slice(0, slash) : "";
      const name = slash >= 0 ? objectPath.slice(slash + 1) : objectPath;
      const { data, error } = await supabase.storage.from(bucket).list(folder, {
        limit: 100,
        search: name,
      });
      if (error) throw new Error("storage-stat-failed");
      const match = (data ?? []).find((entry) => entry.name === name);
      if (!match) return { exists: false, bytes: null };
      const size = match.metadata && typeof match.metadata.size === "number" ? match.metadata.size : null;
      return { exists: true, bytes: size };
    },
    async download(bucket, objectPath) {
      const { data, error } = await supabase.storage.from(bucket).download(objectPath);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async uploadDerivative({ bucket, path, bytes, upsert }) {
      const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
        contentType: "image/webp",
        cacheControl: String(VIBODE_2D_THUMBNAIL_BACKFILL_CACHE_MAX_AGE_SEC),
        upsert,
      });
      if (!error) return "uploaded";
      if (!upsert && alreadyExists(error)) return "exists";
      throw new Error("upload-failed");
    },
  };
}

export async function updateVibode2dThumbnailPath(
  supabase: SupabaseClient,
  update: BackfillThumbnailUpdate,
): Promise<boolean> {
  const base = supabase
    .from("vibode_room_assets")
    .update({
      thumbnail_storage_bucket: update.thumbnailStorageBucket,
      thumbnail_storage_path: update.thumbnailStoragePath,
    })
    .eq("id", update.assetId)
    .eq("room_id", update.roomId)
    .eq("user_id", update.userId);
  const filtered =
    update.previousThumbnailPath === null
      ? base.is("thumbnail_storage_path", null)
      : base.eq("thumbnail_storage_path", update.previousThumbnailPath);
  const { data, error } = await filtered.select("id");
  if (error) throw new Error("db-update-failed");
  return Array.isArray(data) && data.length === 1;
}

export async function loadVibode2dThumbnailBackfillCandidates(
  supabase: SupabaseClient,
  query: LoadQuery = {},
): Promise<BackfillAsset[]> {
  const assetId = normalizeText(query.assetId);
  const roomId = normalizeText(query.roomId);
  const verifyExisting = query.verifyExisting === true;
  const assetRows = await fetchPages(() => {
    let builder = supabase.from("vibode_room_assets").select(ASSET_COLUMNS);
    if (assetId) builder = builder.eq("id", assetId);
    if (roomId) builder = builder.eq("room_id", roomId);
    if (!assetId && !roomId && !verifyExisting) {
      builder = builder.is("thumbnail_storage_path", null);
    }
    return builder.order("created_at", { ascending: false });
  });
  const roomRows = await fetchPages(() =>
    supabase.from("vibode_rooms").select("id,active_asset_id").order("id", { ascending: true }),
  );

  const rooms = roomRows.map((row) => ({
    id: text(row.id),
    activeAssetId: normalizeText(row.active_asset_id),
  }));
  const listingIds = new Set<string>();
  const roomIds = new Set<string>();
  const roomsWithoutPointer: string[] = [];
  for (const room of rooms) {
    if (!room.id) continue;
    roomIds.add(room.id);
    if (room.activeAssetId) listingIds.add(room.activeAssetId);
    else roomsWithoutPointer.push(room.id);
  }

  for (const chunk of chunks(roomsWithoutPointer, 100)) {
    const activeRows = await fetchPages(() =>
      supabase
        .from("vibode_room_assets")
        .select("id,room_id,created_at,is_active")
        .in("room_id", chunk)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
    );
    const newest = new Map<string, { id: string; createdAt: string }>();
    for (const row of activeRows) {
      const rowRoomId = text(row.room_id);
      const rowId = text(row.id);
      const createdAt = text(row.created_at);
      if (!rowRoomId || !rowId) continue;
      const current = newest.get(rowRoomId);
      if (!current || createdAt > current.createdAt || (createdAt === current.createdAt && rowId > current.id)) {
        newest.set(rowRoomId, { id: rowId, createdAt });
      }
    }
    for (const chosen of newest.values()) listingIds.add(chosen.id);
  }

  return assetRows.map((row) => {
    const id = text(row.id);
    const assetRoomId = text(row.room_id);
    return {
      id,
      roomId: assetRoomId,
      userId: text(row.user_id),
      assetType: text(row.asset_type),
      isActive: row.is_active === true,
      isListingAsset: listingIds.has(id),
      roomExists: roomIds.has(assetRoomId),
      storageBucket: normalizeText(row.storage_bucket),
      storagePath: normalizeText(row.storage_path),
      thumbnailStorageBucket: normalizeText(row.thumbnail_storage_bucket),
      thumbnailStoragePath: normalizeText(row.thumbnail_storage_path),
      width: numberOrNull(row.width),
      height: numberOrNull(row.height),
      createdAt: text(row.created_at),
    };
  });
}

export async function runVibode2dThumbnailBackfill(args: {
  assets: readonly BackfillAsset[];
  dryRun: boolean;
  limit?: number | null;
  assetId?: string | null;
  roomId?: string | null;
  storage: BackfillStorage;
  updateThumbnail: (update: BackfillThumbnailUpdate) => Promise<boolean>;
  renderThumbnail?: (bytes: Buffer) => Promise<Buffer>;
}): Promise<BackfillReport> {
  const { candidates, selected } = selectBackfillCandidates(args.assets, {
    assetId: args.assetId,
    roomId: args.roomId,
    limit: args.limit,
  });
  const render = args.renderThumbnail ?? renderVibode2dThumbnail;
  const results: ThumbnailBackfillResult[] = [];
  for (const asset of selected) {
    try {
      results.push(await processAsset(asset, args.dryRun, args.storage, args.updateThumbnail, render));
    } catch {
      results.push(result(asset, {
        outcome: "failed",
        reason: "failed",
        errorClass: "failed",
        sourceAvailable: null,
      }));
    }
  }
  return summarize(args.dryRun, candidates.length, results);
}

async function processAsset(
  asset: BackfillAsset,
  dryRun: boolean,
  storage: BackfillStorage,
  updateThumbnail: (update: BackfillThumbnailUpdate) => Promise<boolean>,
  render: (bytes: Buffer) => Promise<Buffer>,
): Promise<ThumbnailBackfillResult> {
  const targetBucket = vibode2dThumbnailBucket();
  const targetPath = canonicalVibode2dThumbnailPath(asset.roomId, asset.id);
  if (!targetPath || !UUID.test(asset.userId) || !targetBucket) {
    return result(asset, {
      outcome: "failed",
      reason: "malformed-asset",
      errorClass: "malformed-asset",
      targetBucket,
      targetPath,
      sourceAvailable: null,
    });
  }
  if (isAllowedVibodeRoomImageBucket(targetBucket)) {
    return result(asset, {
      outcome: "failed",
      reason: "bucket-collision",
      errorClass: "bucket-collision",
      targetBucket,
      targetPath,
      sourceAvailable: null,
    });
  }

  const dbBucket = asset.thumbnailStorageBucket;
  const dbPath = asset.thumbnailStoragePath;
  if (dbBucket && dbPath && dbBucket === targetBucket && isSafeVibodeStoragePath(dbPath)) {
    const existing = await statSafe(storage, dbBucket, dbPath);
    if (existing === "stat-failed") {
      return failedStat(asset, targetBucket, targetPath);
    }
    if (existing.exists) {
      return result(asset, {
        outcome: "skipped",
        reason: "valid-thumbnail",
        targetBucket: dbBucket,
        targetPath: dbPath,
        sourceAvailable: null,
      });
    }
    return repair(asset, {
      dryRun,
      storage,
      updateThumbnail,
      render,
      targetBucket,
      targetPath,
      reason: "missing-object",
      replaceExisting: false,
    });
  }

  const canonical = await statSafe(storage, targetBucket, targetPath);
  if (canonical === "stat-failed") return failedStat(asset, targetBucket, targetPath);
  if (canonical.exists) {
    const bytes = await storage.download(targetBucket, targetPath);
    if (!bytes) return failedStat(asset, targetBucket, targetPath);
    if (isVibodeWebp(bytes)) {
      if (dryRun) {
        return result(asset, {
          outcome: "planned-reuse",
          reason: "adopt-existing-object",
          targetBucket,
          targetPath,
          sourceAvailable: null,
        });
      }
      const written = await writeThumbnailPath(updateThumbnail, asset, targetBucket, targetPath);
      if (written !== "updated") {
        return result(asset, {
          outcome: "failed",
          reason: written === "failed" ? "db-update-failed" : "db-conflict",
          errorClass: written === "failed" ? "db-update-failed" : "db-conflict",
          targetBucket,
          targetPath,
          sourceAvailable: null,
        });
      }
      return result(asset, {
        outcome: "reused",
        reason: "adopt-existing-object",
        targetBucket,
        targetPath,
        sourceAvailable: null,
        dbUpdated: true,
      });
    }
    return repair(asset, {
      dryRun,
      storage,
      updateThumbnail,
      render,
      targetBucket,
      targetPath,
      reason: "untrustworthy-object",
      replaceExisting: true,
    });
  }

  return repair(asset, {
    dryRun,
    storage,
    updateThumbnail,
    render,
    targetBucket,
    targetPath,
    reason: dbPath || dbBucket ? "malformed-thumbnail" : "null-thumbnail",
    replaceExisting: false,
  });
}

async function repair(
  asset: BackfillAsset,
  args: {
    dryRun: boolean;
    storage: BackfillStorage;
    updateThumbnail: (update: BackfillThumbnailUpdate) => Promise<boolean>;
    render: (bytes: Buffer) => Promise<Buffer>;
    targetBucket: string;
    targetPath: string;
    reason: string;
    replaceExisting: boolean;
  },
): Promise<ThumbnailBackfillResult> {
  const sourceBucket = asset.storageBucket;
  const sourcePath = asset.storagePath;
  const shared = {
    targetBucket: args.targetBucket,
    targetPath: args.targetPath,
    sourceBucket,
    sourcePath,
    reason: args.reason,
  };
  if (!sourceBucket || !sourcePath) {
    return result(asset, { ...shared, outcome: "source-missing", errorClass: "source-missing", sourceAvailable: false });
  }
  if (!isAllowedVibodeRoomImageBucket(sourceBucket)) {
    return result(asset, { ...shared, outcome: "failed", errorClass: "untrusted-bucket", sourceAvailable: null });
  }
  if (!isSafeVibodeStoragePath(sourcePath) || (sourceBucket === args.targetBucket && sourcePath === args.targetPath)) {
    return result(asset, { ...shared, outcome: "failed", errorClass: "unsafe-path", sourceAvailable: null });
  }

  const sourceStat = await statSafe(args.storage, sourceBucket, sourcePath);
  if (sourceStat === "stat-failed") return failedStat(asset, args.targetBucket, args.targetPath, sourceBucket, sourcePath);
  if (!sourceStat.exists) {
    return result(asset, { ...shared, outcome: "source-missing", errorClass: "source-missing", sourceAvailable: false });
  }

  if (args.dryRun) {
    return result(asset, {
      ...shared,
      outcome: "planned",
      sourceAvailable: true,
      bytes: emptyBytes(sourceStat.bytes),
    });
  }

  const sourceBytes = await args.storage.download(sourceBucket, sourcePath);
  if (!sourceBytes) {
    return result(asset, { ...shared, outcome: "failed", errorClass: "source-unavailable", sourceAvailable: false });
  }

  let derivative: Buffer;
  try {
    derivative = await args.render(sourceBytes);
  } catch {
    return result(asset, {
      ...shared,
      outcome: "failed",
      errorClass: "transform-failed",
      sourceAvailable: true,
    });
  }
  if (!isVibodeWebp(derivative)) {
    return result(asset, {
      ...shared,
      outcome: "failed",
      errorClass: "transform-failed",
      sourceAvailable: true,
    });
  }

  let uploadResult: "uploaded" | "exists";
  try {
    uploadResult = await args.storage.uploadDerivative({
      bucket: args.targetBucket,
      path: args.targetPath,
      bytes: derivative,
      upsert: args.replaceExisting,
    });
  } catch {
    return result(asset, {
      ...shared,
      outcome: "failed",
      errorClass: "upload-failed",
      sourceAvailable: true,
    });
  }

  if (uploadResult === "exists") {
    const existing = await args.storage.download(args.targetBucket, args.targetPath);
    if (!existing || !isVibodeWebp(existing)) {
      return result(asset, {
        ...shared,
        outcome: "failed",
        errorClass: "upload-failed",
        sourceAvailable: true,
      });
    }
  }

  const written = await writeThumbnailPath(
    args.updateThumbnail,
    asset,
    args.targetBucket,
    args.targetPath,
  );
  if (written !== "updated") {
    return result(asset, {
      ...shared,
      outcome: "failed",
      errorClass: written === "failed" ? "db-update-failed" : "db-conflict",
      sourceAvailable: true,
    });
  }

  const sourceSize = await readSize(sourceBytes);
  const derivativeSize = await readSize(derivative);
  return result(asset, {
    ...shared,
    outcome: uploadResult === "exists" ? "reused" : "repaired",
    reason: uploadResult === "exists" ? "adopt-existing-object" : args.reason,
    sourceAvailable: true,
    dbUpdated: true,
    bytes: {
      sourceBytes: sourceBytes.byteLength,
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      derivativeBytes: derivative.byteLength,
      derivativeWidth: derivativeSize.width,
      derivativeHeight: derivativeSize.height,
    },
  });
}

async function writeThumbnailPath(
  updateThumbnail: (update: BackfillThumbnailUpdate) => Promise<boolean>,
  asset: BackfillAsset,
  bucket: string,
  objectPath: string,
): Promise<"updated" | "conflict" | "failed"> {
  try {
    const updated = await updateThumbnail({
      assetId: asset.id,
      roomId: asset.roomId,
      userId: asset.userId,
      previousThumbnailPath: asset.thumbnailStoragePath,
      thumbnailStorageBucket: bucket,
      thumbnailStoragePath: objectPath,
    });
    return updated ? "updated" : "conflict";
  } catch {
    return "failed";
  }
}

async function statSafe(
  storage: BackfillStorage,
  bucket: string,
  objectPath: string,
): Promise<{ exists: boolean; bytes: number | null } | "stat-failed"> {
  try {
    return await storage.stat(bucket, objectPath);
  } catch {
    return "stat-failed";
  }
}

async function readSize(bytes: Buffer): Promise<{ width: number | null; height: number | null }> {
  try {
    return await readVibodeImageDimensions(bytes);
  } catch {
    return { width: null, height: null };
  }
}

function failedStat(
  asset: BackfillAsset,
  targetBucket: string | null,
  targetPath: string | null,
  sourceBucket: string | null = asset.storageBucket,
  sourcePath: string | null = asset.storagePath,
): ThumbnailBackfillResult {
  return result(asset, {
    outcome: "failed",
    reason: "storage-stat-failed",
    errorClass: "storage-stat-failed",
    targetBucket,
    targetPath,
    sourceBucket,
    sourcePath,
    sourceAvailable: null,
  });
}

function emptyBytes(sourceBytes: number | null): BackfillByteReport {
  return {
    sourceBytes,
    sourceWidth: null,
    sourceHeight: null,
    derivativeBytes: null,
    derivativeWidth: null,
    derivativeHeight: null,
  };
}

function result(
  asset: BackfillAsset,
  patch: {
    outcome: BackfillOutcome;
    reason: string;
    errorClass?: string | null;
    targetBucket?: string | null;
    targetPath?: string | null;
    sourceBucket?: string | null;
    sourcePath?: string | null;
    sourceAvailable: boolean | null;
    dbUpdated?: boolean;
    bytes?: BackfillByteReport | null;
  },
): ThumbnailBackfillResult {
  return {
    assetId: asset.id,
    roomId: asset.roomId,
    outcome: patch.outcome,
    reason: patch.reason,
    errorClass: patch.errorClass ?? null,
    targetBucket: patch.targetBucket ?? null,
    targetPath: patch.targetPath ?? null,
    sourceBucket: patch.sourceBucket ?? asset.storageBucket,
    sourcePath: patch.sourcePath ?? asset.storagePath,
    sourceAvailable: patch.sourceAvailable,
    dbUpdated: patch.dbUpdated === true,
    bytes: patch.bytes ?? null,
  };
}

function summarize(dryRun: boolean, candidates: number, results: ThumbnailBackfillResult[]): BackfillReport {
  return {
    dryRun,
    candidates,
    scanned: results.length,
    skipped: count(results, "skipped"),
    repaired: count(results, "repaired"),
    planned: count(results, "planned"),
    failed: count(results, "failed"),
    sourceMissing: count(results, "source-missing"),
    objectReused: count(results, "reused"),
    plannedReuse: count(results, "planned-reuse"),
    dbUpdated: results.filter((entry) => entry.dbUpdated).length,
    results,
  };
}

function count(results: readonly ThumbnailBackfillResult[], outcome: BackfillOutcome): number {
  return results.filter((entry) => entry.outcome === outcome).length;
}

function compareBackfillAssets(left: BackfillAsset, right: BackfillAsset): number {
  const rank = backfillCandidateRank(left) - backfillCandidateRank(right);
  if (rank !== 0) return rank;
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function alreadyExists(error: { message: string; statusCode?: number | string }): boolean {
  const message = error.message.toLowerCase();
  const status = String(error.statusCode ?? "");
  return status === "409" || message.includes("already exists") || message.includes("duplicate");
}

async function fetchPages(
  start: () => {
    range(
      from: number,
      to: number,
    ): PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
  },
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await start().range(from, from + pageSize - 1);
    if (error) throw new Error(`Room thumbnail backfill query failed: ${bounded(error.message)}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

function bounded(message: string): string {
  const trimmed = message.trim();
  return trimmed.length <= 200 ? trimmed : trimmed.slice(0, 200);
}
