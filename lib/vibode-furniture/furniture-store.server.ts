import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { RUNTIME_ASSET_SIGNED_GET_EXPIRES_SEC } from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import { expiresAtFromNow } from "@/lib/vibode-stage/partner-runtime-assets";

import {
  isPersonalFurnitureAssetId,
  PERSONAL_FURNITURE_BUCKET,
  personalFurniturePermanentPath,
} from "./asset-id";
import type {
  PersonalFurnitureAssetRecord,
  PersonalFurnitureUploadRecord,
  PersonalFurnitureVisibility,
  PersonalUploadStatus,
} from "./library";
import type { PersonalRuntimeRow } from "./runtime-resolve";
import type { PersonalFurnitureStore, PersonalObjectStore } from "./store";

const ASSET_COLUMNS =
  "asset_id, user_id, display_name, category, origin, authored_width_m, authored_height_m, authored_depth_m, sha256, byte_size, storage_bucket, storage_object_path, library_visibility";

const UPLOAD_COLUMNS =
  "upload_id, user_id, asset_id, storage_bucket, pending_object_path, permanent_object_path, status, result_asset_id, expires_at";

const PENDING_PATH =
  /^users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/model\.glb$/;

const PERMANENT_PATH =
  /^users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/model\.glb$/;

export function createSupabasePersonalFurnitureStore(
  supabase: SupabaseClient,
): { records: PersonalFurnitureStore; objects: PersonalObjectStore } {
  return {
    records: createRecordStore(supabase),
    objects: createObjectStore(supabase),
  };
}

export function personalFurnitureServices():
  | Readonly<{ ok: true; supabase: SupabaseClient; records: PersonalFurnitureStore; objects: PersonalObjectStore }>
  | Readonly<{ ok: false; error: string }> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, error: "Server misconfigured." };
  const bound = createSupabasePersonalFurnitureStore(supabase);
  return { ok: true, supabase, records: bound.records, objects: bound.objects };
}

/**
 * Owner-scoped lookup for runtime and thumbnail resolution.
 * Archived rows stay visible to this query. Library listing is separate.
 * A row whose path does not match the owner and asset id is ignored.
 */
export async function lookupPersonalFurnitureRuntimeRows(
  supabase: SupabaseClient,
  assetIds: readonly string[],
  ownerUserId: string,
): Promise<PersonalRuntimeRow[]> {
  const userId = ownerUserId.trim().toLowerCase();
  const ids = [...new Set(assetIds.filter(isPersonalFurnitureAssetId))];
  if (!userId || ids.length === 0) return [];
  const { data, error } = await supabase
    .from("vibode_furniture_assets")
    .select("asset_id, user_id, authored_width_m, authored_height_m, authored_depth_m, storage_bucket, storage_object_path")
    .eq("user_id", userId)
    .in("asset_id", ids);
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  const rows: PersonalRuntimeRow[] = [];
  for (const raw of data) {
    const mapped = mapRuntimeRow(raw, userId);
    if (mapped) rows.push(mapped);
  }
  return rows;
}

function createRecordStore(supabase: SupabaseClient): PersonalFurnitureStore {
  return {
    async countOpenUploads(userId, nowIso) {
      const { count, error } = await supabase
        .from("vibode_furniture_asset_uploads")
        .select("upload_id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "pending")
        .gt("expires_at", nowIso);
      if (error || count == null) throw new Error("Failed to count furniture uploads.");
      return count;
    },
    async expireUploads(userId, nowIso) {
      const { data, error } = await supabase
        .from("vibode_furniture_asset_uploads")
        .update({ status: "expired" })
        .eq("user_id", userId)
        .in("status", ["pending", "finalizing"])
        .lte("expires_at", nowIso)
        .select("pending_object_path");
      if (error) throw new Error("Failed to expire furniture uploads.");
      if (!Array.isArray(data)) return [];
      return data
        .map((row) => {
          const path = row && typeof row === "object"
            ? (row as { pending_object_path?: unknown }).pending_object_path
            : null;
          return typeof path === "string" ? path : "";
        })
        .filter((path) => PENDING_PATH.test(path));
    },
    async insertUpload(upload) {
      const { error } = await supabase.from("vibode_furniture_asset_uploads").insert({
        upload_id: upload.uploadId,
        user_id: upload.userId,
        asset_id: upload.assetId,
        storage_bucket: PERSONAL_FURNITURE_BUCKET,
        pending_object_path: upload.pendingObjectPath,
        permanent_object_path: upload.permanentObjectPath,
        status: "pending",
        result_asset_id: null,
        expires_at: upload.expiresAt,
      });
      if (error) throw new Error("Failed to record furniture upload.");
    },
    async readUpload(userId, uploadId) {
      const { data, error } = await supabase
        .from("vibode_furniture_asset_uploads")
        .select(UPLOAD_COLUMNS)
        .eq("user_id", userId)
        .eq("upload_id", uploadId)
        .maybeSingle();
      if (error) throw new Error("Failed to read furniture upload.");
      return mapUpload(data);
    },
    async claimUpload(userId, uploadId, nowIso) {
      const { data, error } = await supabase
        .from("vibode_furniture_asset_uploads")
        .update({ status: "finalizing" })
        .eq("user_id", userId)
        .eq("upload_id", uploadId)
        .eq("status", "pending")
        .gt("expires_at", nowIso)
        .select(UPLOAD_COLUMNS)
        .maybeSingle();
      if (error) throw new Error("Failed to claim furniture upload.");
      const claimed = mapUpload(data);
      if (claimed) return claimed;
      const current = await this.readUpload(userId, uploadId);
      if (!current || Date.parse(current.expiresAt) <= Date.parse(nowIso)) return null;
      return "lost";
    },
    async markUploadFinalized(userId, uploadId, resultAssetId) {
      const { error } = await supabase
        .from("vibode_furniture_asset_uploads")
        .update({ status: "finalized", result_asset_id: resultAssetId })
        .eq("user_id", userId)
        .eq("upload_id", uploadId)
        .eq("status", "finalizing");
      if (error) throw new Error("Failed to finish furniture upload.");
    },
    async markUploadRejected(userId, uploadId) {
      const { error } = await supabase
        .from("vibode_furniture_asset_uploads")
        .update({ status: "rejected" })
        .eq("user_id", userId)
        .eq("upload_id", uploadId)
        .in("status", ["pending", "finalizing"]);
      if (error) throw new Error("Failed to reject furniture upload.");
    },
    async findAssetBySha(userId, sha256) {
      const { data, error } = await supabase
        .from("vibode_furniture_assets")
        .select(ASSET_COLUMNS)
        .eq("user_id", userId)
        .eq("sha256", sha256)
        .maybeSingle();
      if (error) throw new Error("Failed to read furniture asset.");
      return mapAsset(data);
    },
    async findOwnedAsset(userId, assetId) {
      if (!isPersonalFurnitureAssetId(assetId)) return null;
      const { data, error } = await supabase
        .from("vibode_furniture_assets")
        .select(ASSET_COLUMNS)
        .eq("user_id", userId)
        .eq("asset_id", assetId)
        .maybeSingle();
      if (error) throw new Error("Failed to read furniture asset.");
      return mapAsset(data);
    },
    async insertAsset(asset) {
      const { error } = await supabase.from("vibode_furniture_assets").insert({
        asset_id: asset.assetId,
        user_id: asset.userId,
        display_name: asset.displayName,
        category: asset.category,
        origin: "uploaded",
        authored_width_m: asset.authoredWidthM,
        authored_height_m: asset.authoredHeightM,
        authored_depth_m: asset.authoredDepthM,
        sha256: asset.sha256,
        byte_size: asset.byteSize,
        storage_bucket: PERSONAL_FURNITURE_BUCKET,
        storage_object_path: asset.storageObjectPath,
        library_visibility: "active",
      });
      if (!error) return "inserted";
      if (error.code === "23505") return "exists";
      throw new Error("Failed to save furniture asset.");
    },
    async listActive(userId) {
      const { data, error } = await supabase
        .from("vibode_furniture_assets")
        .select(ASSET_COLUMNS)
        .eq("user_id", userId)
        .eq("library_visibility", "active")
        .order("created_at", { ascending: false });
      if (error || !Array.isArray(data)) throw new Error("Failed to list furniture.");
      return data.map((row) => mapAsset(row)).filter((row): row is PersonalFurnitureAssetRecord => row != null);
    },
    async archiveAsset(userId, assetId) {
      if (!isPersonalFurnitureAssetId(assetId)) return "missing";
      const { data, error } = await supabase
        .from("vibode_furniture_assets")
        .update({ library_visibility: "archived" })
        .eq("user_id", userId)
        .eq("asset_id", assetId)
        .eq("library_visibility", "active")
        .select("asset_id")
        .maybeSingle();
      if (error) throw new Error("Failed to archive furniture.");
      if (data) return "archived";
      const owned = await this.findOwnedAsset(userId, assetId);
      return owned?.libraryVisibility === "archived" ? "archived" : "missing";
    },
    async ownedAssetIds(userId, assetIds) {
      const ids = assetIds.filter(isPersonalFurnitureAssetId);
      if (ids.length === 0) return new Set<string>();
      const { data, error } = await supabase
        .from("vibode_furniture_assets")
        .select("asset_id")
        .eq("user_id", userId)
        .in("asset_id", ids);
      if (error || !Array.isArray(data)) throw new Error("Failed to read furniture ownership.");
      return new Set(data
        .map((row) => (row && typeof row === "object" ? (row as { asset_id?: unknown }).asset_id : null))
        .filter((id): id is string => typeof id === "string" && isPersonalFurnitureAssetId(id)));
    },
  };
}

function createObjectStore(supabase: SupabaseClient): PersonalObjectStore {
  const bucket = () => supabase.storage.from(PERSONAL_FURNITURE_BUCKET);
  return {
    async createPendingUploadUrl(objectPath) {
      if (!PENDING_PATH.test(objectPath)) return null;
      const { data, error } = await bucket().createSignedUploadUrl(objectPath, { upsert: false });
      const signedUrl = data?.signedUrl?.trim() ?? "";
      if (error || !signedUrl) return null;
      return { signedUrl };
    },
    async read(objectPath) {
      if (!PENDING_PATH.test(objectPath) && !PERMANENT_PATH.test(objectPath)) return null;
      const { data, error } = await bucket().download(objectPath);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async writePermanent(objectPath, bytes) {
      if (!PERMANENT_PATH.test(objectPath)) return "failed";
      const { error } = await bucket().upload(objectPath, bytes, {
        contentType: "model/gltf-binary",
        upsert: false,
      });
      if (!error) return "written";
      if (storageAlreadyExists(error)) return "exists";
      return "failed";
    },
    async remove(objectPath) {
      if (!PENDING_PATH.test(objectPath) && !PERMANENT_PATH.test(objectPath)) return;
      await bucket().remove([objectPath]);
    },
    async signGet(objectPath) {
      if (!PERMANENT_PATH.test(objectPath)) return null;
      const { data, error } = await bucket().createSignedUrl(
        objectPath,
        RUNTIME_ASSET_SIGNED_GET_EXPIRES_SEC,
      );
      const signedUrl = data?.signedUrl?.trim() ?? "";
      if (error || !signedUrl) return null;
      return {
        signedUrl,
        expiresAt: expiresAtFromNow(Date.now(), RUNTIME_ASSET_SIGNED_GET_EXPIRES_SEC),
      };
    },
  };
}

function mapRuntimeRow(value: unknown, ownerUserId: string): PersonalRuntimeRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const assetId = typeof row.asset_id === "string" ? row.asset_id : "";
  const userId = typeof row.user_id === "string" ? row.user_id.toLowerCase() : "";
  const objectPath = typeof row.storage_object_path === "string" ? row.storage_object_path : "";
  const bucket = typeof row.storage_bucket === "string" ? row.storage_bucket : "";
  const expected = personalFurniturePermanentPath(userId, assetId);
  if (
    userId !== ownerUserId ||
    !expected ||
    objectPath !== expected ||
    bucket !== PERSONAL_FURNITURE_BUCKET
  ) {
    return null;
  }
  return {
    assetId,
    userId,
    authoredWidthM: Number(row.authored_width_m),
    authoredHeightM: Number(row.authored_height_m),
    authoredDepthM: Number(row.authored_depth_m),
    storageBucket: bucket,
    storageObjectPath: objectPath,
  };
}

function mapAsset(value: unknown): PersonalFurnitureAssetRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const assetId = typeof row.asset_id === "string" ? row.asset_id : "";
  const userId = typeof row.user_id === "string" ? row.user_id.toLowerCase() : "";
  const visibility = row.library_visibility === "archived" ? "archived" : row.library_visibility === "active" ? "active" : null;
  const expected = personalFurniturePermanentPath(userId, assetId);
  const objectPath = typeof row.storage_object_path === "string" ? row.storage_object_path : "";
  if (
    !visibility ||
    row.origin !== "uploaded" ||
    !expected ||
    objectPath !== expected ||
    row.storage_bucket !== PERSONAL_FURNITURE_BUCKET ||
    typeof row.display_name !== "string" ||
    typeof row.sha256 !== "string"
  ) {
    return null;
  }
  return {
    assetId,
    userId,
    displayName: row.display_name,
    category: typeof row.category === "string" ? row.category : null,
    origin: "uploaded",
    authoredWidthM: Number(row.authored_width_m),
    authoredHeightM: Number(row.authored_height_m),
    authoredDepthM: Number(row.authored_depth_m),
    sha256: row.sha256,
    byteSize: Number(row.byte_size),
    storageBucket: PERSONAL_FURNITURE_BUCKET,
    storageObjectPath: objectPath,
    libraryVisibility: visibility satisfies PersonalFurnitureVisibility,
  };
}

function mapUpload(value: unknown): PersonalFurnitureUploadRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status = uploadStatus(row.status);
  const uploadId = typeof row.upload_id === "string" ? row.upload_id : "";
  const userId = typeof row.user_id === "string" ? row.user_id.toLowerCase() : "";
  const assetId = typeof row.asset_id === "string" ? row.asset_id : "";
  const pendingObjectPath = typeof row.pending_object_path === "string" ? row.pending_object_path : "";
  const permanentObjectPath = typeof row.permanent_object_path === "string" ? row.permanent_object_path : "";
  const expiresAt = typeof row.expires_at === "string" ? row.expires_at : "";
  if (!status || !uploadId || !userId || !isPersonalFurnitureAssetId(assetId) || !expiresAt) return null;
  if (!PENDING_PATH.test(pendingObjectPath) || !PERMANENT_PATH.test(permanentObjectPath)) return null;
  return {
    uploadId,
    userId,
    assetId,
    storageBucket: PERSONAL_FURNITURE_BUCKET,
    pendingObjectPath,
    permanentObjectPath,
    status,
    resultAssetId: typeof row.result_asset_id === "string" ? row.result_asset_id : null,
    expiresAt,
  };
}

function uploadStatus(value: unknown): PersonalUploadStatus | null {
  if (
    value === "pending" ||
    value === "finalizing" ||
    value === "finalized" ||
    value === "rejected" ||
    value === "expired"
  ) {
    return value;
  }
  return null;
}

function storageAlreadyExists(error: { message?: string; statusCode?: string | number }): boolean {
  const message = (error.message ?? "").toLowerCase();
  const status = String(error.statusCode ?? "");
  return status === "409" || message.includes("already exists") || message.includes("duplicate");
}
