import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { beginDecision, claimDecision, markedDecision } from "@/lib/account-deletion/admission";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { deleteAfcV2UserStorage } from "@/lib/afc-v2-production/delete-user-afc-storage.server";
import { GENERATION_INPUT_BUCKET } from "@/lib/vibode-furniture/generation/policy";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;

type DeleteUserPayload = {
  userId?: unknown;
  confirmEmail?: unknown;
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
  original_storage_path?: string | null;
  staged_storage_path?: string | null;
};

type StorageDeleteCandidate = {
  bucket: string;
  path: string;
  source: "db_scoped_user" | "storage_listing";
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIBODE_STAGED_BUCKET = (process.env.VIBODE_STAGED_BUCKET || "vibode-generations").trim();
const VIBODE_THUMBNAILS_BUCKET = (process.env.VIBODE_THUMBNAILS_BUCKET || "vibode-thumbnails").trim();
const VIBODE_BASE_IMAGES_BUCKET = "vibode-base-images";
const VIBODE_FURNITURE_ASSETS_BUCKET = "vibode-furniture-assets";
const ROOM_ORIGINALS_BUCKET = "room-originals";
const ROOM_STAGED_BUCKET = "room-staged";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > 0 ? value : null;
}

function normalizePath(value: string): string {
  return value.replace(/^\/+/, "").trim();
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

function isMissingStoragePathErrorMessage(message: string): boolean {
  return /not found|does not exist|no such|404|already deleted/i.test(message);
}

function matchesOwnedPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function pathHasOwnedPrefix(args: { path: string; userId: string; roomIds: Set<string> }): boolean {
  if (matchesOwnedPrefix(args.path, args.userId)) return true;
  if (matchesOwnedPrefix(args.path, `users/${args.userId}`)) return true;
  for (const roomId of args.roomIds) {
    if (matchesOwnedPrefix(args.path, roomId)) return true;
  }
  return false;
}

function isUnsafeStorageDeletePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return true;
  if (trimmed === "." || trimmed === "/") return true;
  if (trimmed.endsWith("/")) return true;
  return false;
}

function addStorageCandidate(args: {
  into: Map<string, StorageDeleteCandidate>;
  bucket: string | null;
  path: string | null;
  source: StorageDeleteCandidate["source"];
  userId: string;
  roomIds: Set<string>;
  deletedStorageFilesRef: { skipped: number };
}) {
  const parsedBucket = safeString(args.bucket)?.trim() || null;
  const parsedPath = safeString(args.path) || null;
  if (!parsedBucket || !parsedPath) {
    args.deletedStorageFilesRef.skipped += 1;
    return;
  }

  const normalizedPath = normalizePath(parsedPath);
  if (!normalizedPath || isUnsafeStorageDeletePath(normalizedPath)) {
    args.deletedStorageFilesRef.skipped += 1;
    return;
  }

  if (
    args.source !== "db_scoped_user" &&
    !pathHasOwnedPrefix({ path: normalizedPath, userId: args.userId, roomIds: args.roomIds })
  ) {
    args.deletedStorageFilesRef.skipped += 1;
    return;
  }

  const key = `${parsedBucket}:${normalizedPath}`;
  if (args.into.has(key)) return;
  args.into.set(key, {
    bucket: parsedBucket,
    path: normalizedPath,
    source: args.source,
  });
}

async function listStoragePathsByPrefix(args: {
  supabaseAdmin: AnySupabaseClient;
  bucket: string;
  prefix: string;
  maxFiles?: number;
  maxDirectories?: number;
}): Promise<{ listed: boolean; paths: string[]; truncated: boolean }> {
  const maxFiles = Math.max(1, args.maxFiles ?? 500);
  const maxDirectories = Math.max(1, args.maxDirectories ?? 500);
  const normalizedPrefix = normalizePath(args.prefix);
  if (!normalizedPrefix) return { listed: true, paths: [], truncated: false };

  const queue = [normalizedPrefix];
  const visited = new Set<string>();
  const collected: string[] = [];
  let truncated = false;

  while (queue.length > 0 && visited.size < maxDirectories && collected.length < maxFiles) {
    const current = queue.shift() ?? "";
    if (visited.has(current)) continue;
    visited.add(current);

    const pageSize = 100;
    let offset = 0;
    for (;;) {
      const { data, error } = await args.supabaseAdmin.storage.from(args.bucket).list(current, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });

      if (error) {
        if (
          /bucket/i.test(error.message) ||
          /not found/i.test(error.message) ||
          /does not exist/i.test(error.message)
        ) {
          return { listed: false, paths: [], truncated: false };
        }
        throw new Error(`Failed listing storage bucket ${args.bucket}.`);
      }

      const entries = data ?? [];
      for (const entry of entries) {
        const entryName = safeString((entry as { name?: unknown }).name);
        if (!entryName) continue;

        const fullPath = current ? `${current}/${entryName}` : entryName;
        const normalizedFullPath = normalizePath(fullPath);
        if (!normalizedFullPath) continue;

        const maybeMetadata = (entry as { metadata?: unknown }).metadata;
        const isFile = Boolean(maybeMetadata && typeof maybeMetadata === "object");
        if (isFile) {
          collected.push(normalizedFullPath);
          if (collected.length >= maxFiles) {
            truncated = true;
            break;
          }
          continue;
        }

        if (visited.size + queue.length < maxDirectories) {
          queue.push(normalizedFullPath);
        } else {
          truncated = true;
        }
      }
      if (truncated || entries.length < pageSize) break;
      offset += entries.length;
    }
  }

  if (queue.length > 0 || collected.length >= maxFiles) truncated = true;
  return { listed: true, paths: collected, truncated };
}

async function safeListStoragePathsByPrefix(args: {
  supabaseAdmin: AnySupabaseClient;
  bucket: string;
  prefix: string;
  maxFiles?: number;
  maxDirectories?: number;
}): Promise<{ listed: boolean; paths: string[]; truncated: boolean }> {
  try {
    return await listStoragePathsByPrefix(args);
  } catch {
    return { listed: false, paths: [], truncated: false };
  }
}

async function deleteRowsByUserId(args: {
  supabaseAdmin: AnySupabaseClient;
  table: string;
  userId: string;
  column?: string;
}): Promise<{ deleted: number; skipped: boolean }> {
  const column = args.column ?? "user_id";
  const { count: preDeleteCount, error: selectErr } = await args.supabaseAdmin
    .from(args.table)
    .select(column, { head: true, count: "exact" })
    .eq(column, args.userId);

  if (selectErr) {
    if (isMissingRelationError(selectErr) || isMissingColumnError(selectErr)) {
      return { deleted: 0, skipped: true };
    }
    throw new Error(`Failed preparing delete for ${args.table}.`);
  }

  if ((preDeleteCount ?? 0) === 0) {
    return { deleted: 0, skipped: false };
  }

  const { count, error } = await args.supabaseAdmin
    .from(args.table)
    .delete({ count: "exact" })
    .eq(column, args.userId);
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) {
      return { deleted: 0, skipped: true };
    }
    throw new Error(`Failed deleting rows from ${args.table}.`);
  }

  return { deleted: count ?? 0, skipped: false };
}

const UNSETTLED_GENERATION_HOLD_MESSAGE =
  "This account has an unresolved AI furniture generation. Resolve the generation before deleting the account.";

type UnsettledHoldDecision = "clear" | "blocked" | "unknown";

function unsettledHoldDecision(data: unknown): UnsettledHoldDecision {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "unknown";
  const record = data as { ok?: unknown; blocked?: unknown };
  if (record.ok !== true || typeof record.blocked !== "boolean") return "unknown";
  return record.blocked ? "blocked" : "clear";
}

async function readUnsettledGenerationHold(
  supabaseAdmin: AnySupabaseClient,
  userId: string,
): Promise<UnsettledHoldDecision> {
  try {
    const { data, error } = await supabaseAdmin.rpc(
      "vibode_furniture_generation_account_has_unsettled_hold",
      { p_user_id: userId },
    );
    if (error) {
      console.error("[admin/delete-user] unsettled generation check failed", {
        code: typeof error.code === "string" ? error.code : null,
      });
      return "unknown";
    }
    return unsettledHoldDecision(data);
  } catch {
    console.error("[admin/delete-user] unsettled generation check failed", { code: null });
    return "unknown";
  }
}

function logAdmission(label: string, error: { code?: string } | null): void {
  console.error(`[admin/delete-user] ${label}`, {
    code: typeof error?.code === "string" ? error.code : null,
  });
}

async function beginAccountDeletion(
  supabaseAdmin: AnySupabaseClient,
  userId: string,
  adminId: string,
) {
  try {
    const { data, error } = await supabaseAdmin.rpc("begin_vibode_account_deletion", {
      p_user_id: userId,
      p_admin_id: adminId,
    });
    if (error) {
      logAdmission("deletion barrier failed", error);
      return { status: "unavailable" as const };
    }
    return beginDecision(data);
  } catch {
    logAdmission("deletion barrier failed", null);
    return { status: "unavailable" as const };
  }
}

async function claimAccountDeletion(
  supabaseAdmin: AnySupabaseClient,
  userId: string,
  attemptId: string,
  requestId: string,
) {
  try {
    const { data, error } = await supabaseAdmin.rpc("claim_vibode_account_deletion", {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_request_id: requestId,
    });
    if (error) {
      logAdmission("deletion claim failed", error);
      return "unavailable" as const;
    }
    return claimDecision(data);
  } catch {
    logAdmission("deletion claim failed", null);
    return "unavailable" as const;
  }
}

async function markAccountDeletionDestructive(
  supabaseAdmin: AnySupabaseClient,
  userId: string,
  attemptId: string,
  requestId: string,
) {
  try {
    const { data, error } = await supabaseAdmin.rpc("mark_vibode_account_deletion_destructive", {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_request_id: requestId,
    });
    if (error) {
      logAdmission("deletion phase failed", error);
      return "unavailable" as const;
    }
    return markedDecision(data);
  } catch {
    logAdmission("deletion phase failed", null);
    return "unavailable" as const;
  }
}

async function releaseAccountDeletionClaim(
  supabaseAdmin: AnySupabaseClient,
  userId: string,
  attemptId: string,
  requestId: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc("release_vibode_account_deletion_claim", {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_request_id: requestId,
    });
    if (error) logAdmission("deletion claim release failed", error);
  } catch {
    logAdmission("deletion claim release failed", null);
  }
}

async function noteAccountDeletionSucceeded(
  supabaseAdmin: AnySupabaseClient,
  userId: string,
  attemptId: string,
  adminId: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc("note_vibode_account_deletion_succeeded", {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_admin_id: adminId,
    });
    if (error) logAdmission("deletion audit note failed", error);
  } catch {
    logAdmission("deletion audit note failed", null);
  }
}

export type AdminDeleteUserHandlerDeps = {
  getAuthenticatedAdminUser?: typeof getAuthenticatedAdminUser;
  getServiceRoleSupabaseClient?: typeof getServiceRoleSupabaseClient;
  deleteAfcV2UserStorage?: typeof deleteAfcV2UserStorage;
};

export function createAdminDeleteUserPostHandler(
  deps: AdminDeleteUserHandlerDeps = {},
) {
  const resolveAdminUser = deps.getAuthenticatedAdminUser ?? getAuthenticatedAdminUser;
  const resolveServiceRoleClient =
    deps.getServiceRoleSupabaseClient ?? getServiceRoleSupabaseClient;
  const cleanupAfcV2Storage = deps.deleteAfcV2UserStorage ?? deleteAfcV2UserStorage;

  return async function POST(request: Request) {
  const adminUser = await resolveAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = resolveServiceRoleClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin controls." });
  }

  const payload = (await request.json().catch(() => ({}))) as DeleteUserPayload;
  const userId = safeString(payload.userId)?.trim() ?? "";
  const confirmEmail = safeString(payload.confirmEmail) ?? "";

  if (!UUID_RE.test(userId)) {
    return json(400, { error: "Invalid user id." });
  }
  if (!confirmEmail) {
    return json(400, { error: "Confirmation email is required." });
  }
  if (adminUser.id === userId) {
    return json(400, { error: "You cannot delete your own admin user." });
  }

  const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authUserErr || !authUserData?.user) {
    return json(404, { error: "User not found." });
  }

  const targetEmail = authUserData.user.email ?? "";
  if (!targetEmail || confirmEmail !== targetEmail) {
    return json(400, { error: "Confirmation email does not match target user email." });
  }

  const unsettledHold = await readUnsettledGenerationHold(supabaseAdmin, userId);
  if (unsettledHold === "blocked") {
    return json(409, { error: UNSETTLED_GENERATION_HOLD_MESSAGE });
  }
  if (unsettledHold !== "clear") {
    return json(500, { error: "Account deletion could not be checked." });
  }

  const admission = await beginAccountDeletion(supabaseAdmin, userId, adminUser.id);
  if (admission.status === "blocked") {
    return json(409, { error: UNSETTLED_GENERATION_HOLD_MESSAGE });
  }
  if (admission.status === "missing") {
    return json(404, { error: "User not found." });
  }
  if (admission.status !== "ready") {
    return json(500, { error: "Account deletion could not be checked." });
  }

  const admissionRequestId = randomUUID();
  const admissionClaim = await claimAccountDeletion(
    supabaseAdmin,
    userId,
    admission.attemptId,
    admissionRequestId,
  );
  if (admissionClaim === "busy") {
    return json(409, {
      error: `Account deletion is already in progress (${admission.attemptId}).`,
      attemptId: admission.attemptId,
    });
  }
  if (admissionClaim !== "claimed") {
    return json(500, { error: "Account deletion could not be checked." });
  }

  let releaseAdmission = true;
  try {
  const marked = await markAccountDeletionDestructive(
    supabaseAdmin,
    userId,
    admission.attemptId,
    admissionRequestId,
  );
  if (marked !== "marked") {
    return json(500, { error: "Account deletion could not be checked." });
  }

  const afcCleanup = await cleanupAfcV2Storage({
    supabase: supabaseAdmin,
    userId,
  });
  if (!afcCleanup.ok) {
    return json(500, {
      error: "Failed deleting AFC storage.",
      deletedStorageFiles: afcCleanup.deleted,
      skippedStorageFiles: afcCleanup.skipped,
    });
  }

  const deletedRowsByTable: Record<string, number> = {};
  const storageDeleteCandidates = new Map<string, StorageDeleteCandidate>();
  const storageSkipCounter = { skipped: 0 };

  const { data: roomIdRows, error: roomIdsErr } = await supabaseAdmin
    .from("vibode_rooms")
    .select("id")
    .eq("user_id", userId)
    .limit(3000);
  if (roomIdsErr && !isMissingRelationError(roomIdsErr) && !isMissingColumnError(roomIdsErr)) {
    return json(500, { error: "Failed loading owned room ids." });
  }

  const roomIds = new Set(
    ((roomIdRows ?? []) as RoomIdRow[])
      .map((row) => safeString(row.id)?.trim() ?? "")
      .filter((value) => value.length > 0)
  );

  const { data: roomAssetRows, error: roomAssetErr } = await supabaseAdmin
    .from("vibode_room_assets")
    .select("storage_bucket,storage_path,thumbnail_storage_bucket,thumbnail_storage_path")
    .eq("user_id", userId)
    .limit(5000);
  if (roomAssetErr && !isMissingRelationError(roomAssetErr) && !isMissingColumnError(roomAssetErr)) {
    return json(500, { error: "Failed loading room asset storage references." });
  }
  for (const row of (roomAssetRows ?? []) as RoomAssetStorageRow[]) {
    addStorageCandidate({
      into: storageDeleteCandidates,
      bucket: row.storage_bucket,
      path: row.storage_path,
      source: "db_scoped_user",
      userId,
      roomIds,
      deletedStorageFilesRef: storageSkipCounter,
    });
    addStorageCandidate({
      into: storageDeleteCandidates,
      bucket: row.thumbnail_storage_bucket,
      path: row.thumbnail_storage_path,
      source: "db_scoped_user",
      userId,
      roomIds,
      deletedStorageFilesRef: storageSkipCounter,
    });
  }

  const { data: legacyRoomRows, error: legacyRoomErr } = await supabaseAdmin
    .from("rooms")
    .select("original_storage_path,staged_storage_path")
    .eq("user_id", userId)
    .limit(5000);
  if (legacyRoomErr && !isMissingRelationError(legacyRoomErr) && !isMissingColumnError(legacyRoomErr)) {
    return json(500, { error: "Failed loading legacy room storage references." });
  }
  for (const row of (legacyRoomRows ?? []) as LegacyRoomStorageRow[]) {
    addStorageCandidate({
      into: storageDeleteCandidates,
      bucket: ROOM_ORIGINALS_BUCKET,
      path: row.original_storage_path ?? null,
      source: "db_scoped_user",
      userId,
      roomIds,
      deletedStorageFilesRef: storageSkipCounter,
    });
    addStorageCandidate({
      into: storageDeleteCandidates,
      bucket: ROOM_STAGED_BUCKET,
      path: row.staged_storage_path ?? null,
      source: "db_scoped_user",
      userId,
      roomIds,
      deletedStorageFilesRef: storageSkipCounter,
    });
  }

  const userScopedListingTargets: Array<{
    bucket: string;
    prefix: string;
    maxFiles?: number;
    maxDirectories?: number;
  }> = [
    { bucket: ROOM_ORIGINALS_BUCKET, prefix: userId },
    { bucket: ROOM_STAGED_BUCKET, prefix: userId },
    { bucket: VIBODE_BASE_IMAGES_BUCKET, prefix: `users/${userId}` },
    { bucket: VIBODE_STAGED_BUCKET, prefix: `users/${userId}` },
    { bucket: VIBODE_THUMBNAILS_BUCKET, prefix: `users/${userId}` },
    {
      bucket: VIBODE_FURNITURE_ASSETS_BUCKET,
      prefix: `users/${userId}`,
      maxFiles: 10000,
      maxDirectories: 10000,
    },
    {
      bucket: GENERATION_INPUT_BUCKET,
      prefix: `users/${userId}`,
      maxFiles: 10000,
      maxDirectories: 10000,
    },
    { bucket: VIBODE_STAGED_BUCKET, prefix: userId },
    { bucket: VIBODE_THUMBNAILS_BUCKET, prefix: userId },
  ];

  for (const target of userScopedListingTargets) {
    if (target.bucket === VIBODE_FURNITURE_ASSETS_BUCKET || target.bucket === GENERATION_INPUT_BUCKET) {
      let furnitureListing: Awaited<ReturnType<typeof listStoragePathsByPrefix>>;
      try {
        furnitureListing = await listStoragePathsByPrefix({
          supabaseAdmin,
          bucket: target.bucket,
          prefix: target.prefix,
          maxFiles: target.maxFiles,
          maxDirectories: target.maxDirectories,
        });
      } catch {
        return json(500, {
          error: target.bucket === GENERATION_INPUT_BUCKET
            ? "Generation input cleanup failed. Account deletion was not finished."
            : "Furniture storage cleanup failed. Account deletion was not finished.",
          deletedStorageFiles: afcCleanup.deleted,
          skippedStorageFiles: storageSkipCounter.skipped + afcCleanup.skipped,
          deletedRowsByTable,
          authUserDeleted: false,
        });
      }
      if (!furnitureListing.listed) continue;
      if (furnitureListing.truncated) {
        return json(500, {
          error: target.bucket === GENERATION_INPUT_BUCKET
            ? "Generation input cleanup is incomplete. Account deletion was not finished."
            : "Furniture storage cleanup is incomplete. Account deletion was not finished.",
          deletedStorageFiles: afcCleanup.deleted,
          skippedStorageFiles: storageSkipCounter.skipped + afcCleanup.skipped,
          deletedRowsByTable,
          authUserDeleted: false,
        });
      }
      for (const listedPath of furnitureListing.paths) {
        addStorageCandidate({
          into: storageDeleteCandidates,
          bucket: target.bucket,
          path: listedPath,
          source: "storage_listing",
          userId,
          roomIds,
          deletedStorageFilesRef: storageSkipCounter,
        });
      }
      continue;
    }
    const listing = await safeListStoragePathsByPrefix({
      supabaseAdmin,
      bucket: target.bucket,
      prefix: target.prefix,
      maxFiles: target.maxFiles,
      maxDirectories: target.maxDirectories,
    });
    if (!listing.listed) continue;
    for (const listedPath of listing.paths) {
      addStorageCandidate({
        into: storageDeleteCandidates,
        bucket: target.bucket,
        path: listedPath,
        source: "storage_listing",
        userId,
        roomIds,
        deletedStorageFilesRef: storageSkipCounter,
      });
    }
  }

  for (const roomId of roomIds) {
    const roomScopedTargets = [
      { bucket: VIBODE_STAGED_BUCKET, prefix: roomId },
      { bucket: VIBODE_THUMBNAILS_BUCKET, prefix: roomId },
    ];
    for (const target of roomScopedTargets) {
      const listing = await safeListStoragePathsByPrefix({
        supabaseAdmin,
        bucket: target.bucket,
        prefix: target.prefix,
      });
      if (!listing.listed) continue;
      for (const listedPath of listing.paths) {
        addStorageCandidate({
          into: storageDeleteCandidates,
          bucket: target.bucket,
          path: listedPath,
          source: "storage_listing",
          userId,
          roomIds,
          deletedStorageFilesRef: storageSkipCounter,
        });
      }
    }
  }

  let deletedStorageFiles = afcCleanup.deleted;
  let skippedStorageFiles = storageSkipCounter.skipped + afcCleanup.skipped;
  for (const candidate of storageDeleteCandidates.values()) {
    if (!candidate.bucket || !candidate.path || isUnsafeStorageDeletePath(candidate.path)) {
      skippedStorageFiles += 1;
      continue;
    }

    const { error } = await supabaseAdmin.storage.from(candidate.bucket).remove([candidate.path]);
    if (error) {
      if (isMissingStoragePathErrorMessage(error.message)) {
        skippedStorageFiles += 1;
        continue;
      }
      console.error("[admin/delete-user] storage delete failed", { bucket: candidate.bucket });
      return json(500, {
        error: "Storage deletion failed. Account deletion was not finished.",
        deletedStorageFiles,
        skippedStorageFiles,
        deletedRowsByTable,
        authUserDeleted: false,
      });
    }
    deletedStorageFiles += 1;
  }

  const deletionOrder = [
    "vibode_furniture_events",
    "vibode_user_furniture",
    "vibode_generation_runs",
    "vibode_room_assets",
    "vibode_room_folders",
    "vibode_rooms",
    "rooms",
    "beta_user_settings",
    "user_token_wallets",
    "token_ledger",
    "profiles",
    "subscriptions",
    "token_balance",
  ];

  for (const table of deletionOrder) {
    try {
      const deleteColumn = table === "profiles" ? "id" : "user_id";
      const result = await deleteRowsByUserId({
        supabaseAdmin,
        table,
        userId,
        column: deleteColumn,
      });
      deletedRowsByTable[table] = result.deleted;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed deleting rows in ${table}.`;
      return json(500, {
        error: message,
        deletedStorageFiles,
        skippedStorageFiles,
        deletedRowsByTable,
        authUserDeleted: false,
      });
    }
  }

  const { error: deleteAuthErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteAuthErr) {
    console.error("[admin/delete-user] auth delete failed", {
      message: typeof deleteAuthErr.message === "string" ? deleteAuthErr.message : null,
      status: typeof deleteAuthErr.status === "number" ? deleteAuthErr.status : null,
      code: typeof deleteAuthErr.code === "string" ? deleteAuthErr.code : null,
    });
    return json(500, {
      error: "Failed deleting auth user.",
      deletedStorageFiles,
      skippedStorageFiles,
      deletedRowsByTable,
      authUserDeleted: false,
    });
  }

  releaseAdmission = false;
  await noteAccountDeletionSucceeded(supabaseAdmin, userId, admission.attemptId, adminUser.id);
  return json(200, {
    success: true,
    deletedStorageFiles,
    skippedStorageFiles,
    deletedRowsByTable,
    authUserDeleted: true,
  });
  } finally {
    if (releaseAdmission) {
      await releaseAccountDeletionClaim(
        supabaseAdmin,
        userId,
        admission.attemptId,
        admissionRequestId,
      );
    }
  }
  };
}

export const POST = createAdminDeleteUserPostHandler();
