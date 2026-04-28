import { NextResponse } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { readGlobalBetaSettings } from "@/lib/betaSettings.server";

type AnySupabaseClient = SupabaseClient;

type BetaUserSettingsLimitRow = {
  beta_topup_limit: number | null;
};

type UserTokenWalletRow = {
  balance_tokens: number | null;
};

type RoomIdRow = {
  id: string;
};

type RoomAssetStorageRow = {
  storage_bucket: string | null;
  storage_path: string | null;
  thumbnail_storage_bucket: string | null;
  thumbnail_storage_path: string | null;
};

type LegacyRoomStorageRow = {
  original_storage_path: string | null;
  staged_storage_path: string | null;
};

type StoragePathEntry = {
  bucket: string;
  path: string;
  source: "database" | "storage_listing";
};

type EstimatedStoragePathEntry = {
  bucket: string;
  path: string;
  reason: string;
  fileCount: number | null;
};

type OptionalAuditCount = {
  label: string;
  table: string;
  count: number;
};

const VIBODE_STAGED_BUCKET = (process.env.VIBODE_STAGED_BUCKET || "vibode-generations").trim();
const VIBODE_THUMBNAILS_BUCKET = (process.env.VIBODE_THUMBNAILS_BUCKET || "vibode-thumbnails").trim();
const VIBODE_BASE_IMAGES_BUCKET = "vibode-base-images";
const ROOM_ORIGINALS_BUCKET = "room-originals";
const ROOM_STAGED_BUCKET = "room-staged";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function normalizePath(value: string): string {
  return value.replace(/^\/+/, "").trim();
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIntOrFallback(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

function parseNullableInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function isMissingRelationError(error: PostgrestError | null): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /relation .* does not exist/i.test(error.message);
}

function isMissingColumnError(error: PostgrestError | null): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /column .* does not exist/i.test(error.message);
}

async function countRowsByUserId(args: {
  supabaseAdmin: AnySupabaseClient;
  table: string;
  userId: string;
  column?: string;
}): Promise<{ count: number; available: boolean }> {
  const { data, count, error } = await args.supabaseAdmin
    .from(args.table)
    .select("*", { count: "exact", head: true })
    .eq(args.column ?? "user_id", args.userId);

  void data;
  if (error) {
    if (isMissingRelationError(error)) return { count: 0, available: false };
    throw new Error(`Failed counting rows in ${args.table}.`);
  }
  return { count: count ?? 0, available: true };
}

function addExactStoragePath(
  into: Map<string, StoragePathEntry>,
  bucket: string | null,
  path: string | null,
  source: StoragePathEntry["source"]
) {
  const parsedBucket = safeString(bucket);
  const parsedPath = safeString(path);
  if (!parsedBucket || !parsedPath) return;
  const normalizedPath = normalizePath(parsedPath);
  if (!normalizedPath) return;
  const key = `${parsedBucket}:${normalizedPath}`;
  if (into.has(key)) return;
  into.set(key, {
    bucket: parsedBucket,
    path: normalizedPath,
    source,
  });
}

function setEstimatedStoragePath(
  into: Map<string, EstimatedStoragePathEntry>,
  entry: EstimatedStoragePathEntry
) {
  const normalizedPath = normalizePath(entry.path.replace(/\/\.\.\.$/, ""));
  if (!normalizedPath) return;
  const normalizedEstimatedPath = `${normalizedPath}/...`;
  const key = `${entry.bucket}:${normalizedEstimatedPath}`;
  into.set(key, {
    ...entry,
    path: normalizedEstimatedPath,
  });
}

async function listStoragePathsByPrefix(args: {
  supabaseAdmin: AnySupabaseClient;
  bucket: string;
  prefix: string;
  maxFiles?: number;
  maxDirectories?: number;
}): Promise<{
  listed: boolean;
  paths: string[];
}> {
  const maxFiles = Math.max(1, args.maxFiles ?? 250);
  const maxDirectories = Math.max(1, args.maxDirectories ?? 200);
  const normalizedPrefix = normalizePath(args.prefix);
  const queue = [normalizedPrefix];
  const visited = new Set<string>();
  const collected: string[] = [];

  while (queue.length > 0 && visited.size < maxDirectories && collected.length < maxFiles) {
    const current = queue.shift() ?? "";
    if (visited.has(current)) continue;
    visited.add(current);

    const { data, error } = await args.supabaseAdmin.storage.from(args.bucket).list(current, {
      limit: 100,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      if (
        /bucket/i.test(error.message) ||
        /not found/i.test(error.message) ||
        /does not exist/i.test(error.message)
      ) {
        return { listed: false, paths: [] };
      }
      throw new Error(`Failed listing storage bucket ${args.bucket}.`);
    }

    for (const entry of data ?? []) {
      const entryName = safeString((entry as { name?: unknown }).name);
      if (!entryName) continue;
      const fullPath = current ? `${current}/${entryName}` : entryName;
      const normalizedFullPath = normalizePath(fullPath);
      if (!normalizedFullPath) continue;

      const maybeMetadata = (entry as { metadata?: unknown }).metadata;
      const isFile = Boolean(maybeMetadata && typeof maybeMetadata === "object");
      if (isFile) {
        collected.push(normalizedFullPath);
        if (collected.length >= maxFiles) break;
        continue;
      }

      if (visited.size + queue.length < maxDirectories) {
        queue.push(normalizedFullPath);
      }
    }
  }

  return { listed: true, paths: collected };
}

async function safeListStoragePathsByPrefix(args: {
  supabaseAdmin: AnySupabaseClient;
  bucket: string;
  prefix: string;
  maxFiles?: number;
  maxDirectories?: number;
}): Promise<{
  listed: boolean;
  paths: string[];
}> {
  try {
    return await listStoragePathsByPrefix(args);
  } catch {
    return { listed: false, paths: [] };
  }
}

export async function GET(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin controls." });
  }

  const { searchParams } = new URL(request.url);
  const userId = safeString(searchParams.get("userId"));
  if (!userId || userId.length < 10) {
    return json(400, { error: "Invalid user id." });
  }

  const settings = await readGlobalBetaSettings(supabaseAdmin, {
    allowLocalEnvFallback: true,
  }).catch(() => null);
  if (!settings) {
    return json(500, { error: "Failed to load global beta settings." });
  }

  const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authUserErr || !authUserData?.user) {
    return json(404, { error: "User not found." });
  }

  const { data: userSettingsRows, error: userSettingsErr } = await supabaseAdmin
    .from("beta_user_settings")
    .select("beta_topup_limit")
    .eq("user_id", userId);
  if (userSettingsErr) {
    return json(500, { error: "Failed to load user beta settings." });
  }

  const { count: topupsUsed, error: topupsUsedErr } = await supabaseAdmin
    .from("token_ledger")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action_type", "topup");
  if (topupsUsedErr) {
    return json(500, { error: "Failed to load top-up usage count." });
  }

  const { data: walletRows, error: walletErr } = await supabaseAdmin
    .from("user_token_wallets")
    .select("balance_tokens")
    .eq("user_id", userId)
    .limit(1);
  if (walletErr) {
    return json(500, { error: "Failed to load current token balance." });
  }

  const roomsOwned = await countRowsByUserId({
    supabaseAdmin,
    table: "vibode_rooms",
    userId,
  });
  const legacyRoomsOwned = await countRowsByUserId({
    supabaseAdmin,
    table: "rooms",
    userId,
  });
  const myFurnitureOwned = await countRowsByUserId({
    supabaseAdmin,
    table: "vibode_user_furniture",
    userId,
  });
  const tokenLedgerRows = await countRowsByUserId({
    supabaseAdmin,
    table: "token_ledger",
    userId,
  });
  const betaUserSettingsRows = await countRowsByUserId({
    supabaseAdmin,
    table: "beta_user_settings",
    userId,
  });

  const optionalCountSpecs: Array<{ label: string; table: string; column?: string }> = [
    { label: "Vibode room asset rows", table: "vibode_room_assets" },
    { label: "Vibode generation run rows", table: "vibode_generation_runs" },
    { label: "Vibode furniture event rows", table: "vibode_furniture_events" },
    { label: "User SKU rows", table: "user_skus" },
    { label: "User SKU ingest rows", table: "user_sku_ingests" },
  ];

  const optionalAuditCounts: OptionalAuditCount[] = [];
  for (const spec of optionalCountSpecs) {
    const result = await countRowsByUserId({
      supabaseAdmin,
      table: spec.table,
      userId,
      column: spec.column,
    });
    if (result.available) {
      optionalAuditCounts.push({
        label: spec.label,
        table: spec.table,
        count: result.count,
      });
    }
  }

  const { data: roomIdRows, error: roomIdErr } = await supabaseAdmin
    .from("vibode_rooms")
    .select("id")
    .eq("user_id", userId)
    .limit(300);
  if (roomIdErr && !isMissingRelationError(roomIdErr)) {
    return json(500, { error: "Failed to load room ids for storage audit." });
  }
  const roomIds = ((roomIdRows ?? []) as RoomIdRow[])
    .map((row) => safeString(row.id))
    .filter((value): value is string => Boolean(value));

  const exactStorageMap = new Map<string, StoragePathEntry>();
  const estimatedStorageMap = new Map<string, EstimatedStoragePathEntry>();

  const { data: roomAssetRows, error: roomAssetErr } = await supabaseAdmin
    .from("vibode_room_assets")
    .select("storage_bucket,storage_path,thumbnail_storage_bucket,thumbnail_storage_path")
    .eq("user_id", userId)
    .limit(1000);
  if (roomAssetErr && !isMissingRelationError(roomAssetErr)) {
    return json(500, { error: "Failed to load room asset storage references." });
  }
  for (const row of (roomAssetRows ?? []) as RoomAssetStorageRow[]) {
    addExactStoragePath(exactStorageMap, row.storage_bucket, row.storage_path, "database");
    addExactStoragePath(
      exactStorageMap,
      row.thumbnail_storage_bucket,
      row.thumbnail_storage_path,
      "database"
    );
  }

  const { data: legacyRoomRows, error: legacyRoomErr } = await supabaseAdmin
    .from("rooms")
    .select("original_storage_path,staged_storage_path")
    .eq("user_id", userId)
    .limit(1000);
  if (!legacyRoomErr) {
    for (const row of (legacyRoomRows ?? []) as LegacyRoomStorageRow[]) {
      addExactStoragePath(exactStorageMap, ROOM_ORIGINALS_BUCKET, row.original_storage_path, "database");
      addExactStoragePath(exactStorageMap, ROOM_STAGED_BUCKET, row.staged_storage_path, "database");
    }
  } else if (!isMissingRelationError(legacyRoomErr) && !isMissingColumnError(legacyRoomErr)) {
    return json(500, { error: "Failed to load legacy room storage references." });
  }

  const listingTargets = [
    { bucket: ROOM_ORIGINALS_BUCKET, prefix: userId },
    { bucket: ROOM_STAGED_BUCKET, prefix: userId },
    { bucket: VIBODE_BASE_IMAGES_BUCKET, prefix: `users/${userId}` },
  ];

  for (const target of listingTargets) {
    const listing = await listStoragePathsByPrefix({
      supabaseAdmin,
      bucket: target.bucket,
      prefix: target.prefix,
    });
    if (!listing.listed) {
      setEstimatedStoragePath(estimatedStorageMap, {
        bucket: target.bucket,
        path: target.prefix,
        reason: "Estimated from known app upload path pattern",
        fileCount: null,
      });
      continue;
    }

    if (listing.paths.length === 0) {
      continue;
    }

    for (const path of listing.paths) {
      addExactStoragePath(exactStorageMap, target.bucket, path, "storage_listing");
    }
  }

  for (const roomId of roomIds) {
    const vibodeStagedListing = await safeListStoragePathsByPrefix({
      supabaseAdmin,
      bucket: VIBODE_STAGED_BUCKET,
      prefix: roomId,
    });
    const vibodeThumbnailListing = await safeListStoragePathsByPrefix({
      supabaseAdmin,
      bucket: VIBODE_THUMBNAILS_BUCKET,
      prefix: roomId,
    });

    setEstimatedStoragePath(estimatedStorageMap, {
      bucket: VIBODE_STAGED_BUCKET,
      path: roomId,
      reason: "Estimated from room_id-based vibode generation path convention",
      fileCount: vibodeStagedListing.listed ? vibodeStagedListing.paths.length : null,
    });
    setEstimatedStoragePath(estimatedStorageMap, {
      bucket: VIBODE_THUMBNAILS_BUCKET,
      path: roomId,
      reason: "Estimated from room_id/asset_id thumbnail path convention",
      fileCount: vibodeThumbnailListing.listed ? vibodeThumbnailListing.paths.length : null,
    });
  }

  const userSettings = (userSettingsRows ?? []) as BetaUserSettingsLimitRow[];
  const betaTopupLimitOverride =
    userSettings.length > 0 ? parseNullableInt(userSettings[0].beta_topup_limit) : null;
  const effectiveTopupLimit = betaTopupLimitOverride ?? settings.defaultTopupLimit;
  const wallet = (walletRows ?? []) as UserTokenWalletRow[];
  const currentTokenBalance =
    wallet.length > 0 ? parseIntOrFallback(wallet[0].balance_tokens, 0) : 0;

  return json(200, {
    audit: {
      userId,
      email: authUserData.user.email ?? null,
      joinedAt: authUserData.user.created_at ?? null,
      lastSignInAt: authUserData.user.last_sign_in_at ?? null,
      currentTokenBalance,
      effectiveTopupLimit,
      betaTopupLimitOverride,
      topupsUsed: topupsUsed ?? 0,
      counts: {
        vibodeRoomsOwned: roomsOwned.count,
        legacyRoomsOwned: legacyRoomsOwned.count,
        myFurnitureItemsOwned: myFurnitureOwned.count,
        tokenLedgerRows: tokenLedgerRows.count,
        betaUserSettingsRows: betaUserSettingsRows.count,
      },
      optionalAuditCounts,
      storageAudit: {
        exactPaths: Array.from(exactStorageMap.values()).sort((a, b) => {
          if (a.bucket !== b.bucket) return a.bucket.localeCompare(b.bucket);
          return a.path.localeCompare(b.path);
        }),
        estimatedPaths: Array.from(estimatedStorageMap.values()).sort((a, b) => {
          if (a.bucket !== b.bucket) return a.bucket.localeCompare(b.bucket);
          return a.path.localeCompare(b.path);
        }),
      },
    },
  });
}
