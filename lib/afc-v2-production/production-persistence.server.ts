import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AfcSr1LiveBasis } from "@/app/admin/3d-room-lab/afc-sr1-live-product-contract";
import type { AfcSr1GeneratedTiledArtifact } from "@/app/admin/3d-room-lab/afc-sr1-tiled-artifact-cache";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import type { AfcV2ProductionRoomAuthority } from "./production-authority-contract";
import { durableArtifactBytesMatch } from "./production-artifact-integrity";
import {
  AFC_V2_ORIGINAL_SIGNED_URL_EXPIRES_IN_SEC,
  prepareOwnedOriginalForAnalysis,
} from "./production-original";
import {
  AFC_V2_ORIGINAL_STORAGE_BUCKET,
  AFC_V2_PRODUCTION_STORAGE_BUCKET,
  AfcGenerationImmutabilityError,
  type AfcArtifactSource,
  type AfcGenerationRecord,
  type AfcProductionStore,
  type AfcRoomBaseAsset,
  type AfcRoomPointer,
  type AfcStoredImageIdentity,
  type CreateAfcGenerationInput,
  type DurableEmptyArtifact,
  type DurableTiledArtifact,
  type UpdateAfcGenerationInput,
} from "./production-store";

type AnySupabase = SupabaseClient;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asIdentity(row: Record<string, unknown>, prefix: string): AfcStoredImageIdentity | null {
  const sha = row[`${prefix}_sha256`];
  const width = row[`${prefix}_decoded_width`];
  const height = row[`${prefix}_decoded_height`];
  const byteCount = row[`${prefix}_byte_count`];
  const mime = row[`${prefix}_mime_type`];
  const orientation = row[`${prefix}_orientation`];
  if (
    typeof sha !== "string" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof byteCount !== "number" ||
    (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") ||
    orientation !== 1
  ) {
    return null;
  }
  return Object.freeze({
    sha256: sha,
    decodedWidth: width,
    decodedHeight: height,
    byteCount,
    mimeType: mime,
    orientation: 1 as const,
  });
}

function identityColumns(prefix: string, identity: AfcStoredImageIdentity | null | undefined) {
  if (identity === undefined) return {};
  if (!identity) {
    return {
      [`${prefix}_sha256`]: null,
      [`${prefix}_decoded_width`]: null,
      [`${prefix}_decoded_height`]: null,
      [`${prefix}_byte_count`]: null,
      [`${prefix}_mime_type`]: null,
      [`${prefix}_orientation`]: null,
    };
  }
  return {
    [`${prefix}_sha256`]: identity.sha256,
    [`${prefix}_decoded_width`]: identity.decodedWidth,
    [`${prefix}_decoded_height`]: identity.decodedHeight,
    [`${prefix}_byte_count`]: identity.byteCount,
    [`${prefix}_mime_type`]: identity.mimeType,
    [`${prefix}_orientation`]: identity.orientation,
  };
}

function rowToGeneration(row: Record<string, unknown>): AfcGenerationRecord {
  const frameWidth = row.frame_width;
  const frameHeight = row.frame_height;
  return Object.freeze({
    id: String(row.id),
    roomId: String(row.room_id),
    userId: String(row.user_id),
    parentGenerationId: typeof row.parent_generation_id === "string"
      ? row.parent_generation_id
      : null,
    lineageSeq: typeof row.lineage_seq === "number"
      ? row.lineage_seq
      : Number(row.lineage_seq),
    runId: String(row.run_id),
    intent: row.intent as AfcGenerationRecord["intent"],
    status: row.status as AfcGenerationRecord["status"],
    createdAt: String(row.created_at),
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    original: asIdentity(row, "original"),
    empty: asIdentity(row, "empty"),
    tiled: asIdentity(row, "tiled"),
    emptyArtifactSource: (row.empty_artifact_source as AfcArtifactSource | null) ??
      null,
    tiledArtifactSource: (row.tiled_artifact_source as AfcArtifactSource | null) ??
      null,
    emptyStoragePath: typeof row.empty_storage_path === "string"
      ? row.empty_storage_path
      : null,
    tiledStoragePath: typeof row.tiled_storage_path === "string"
      ? row.tiled_storage_path
      : null,
    tiledCacheKey: typeof row.tiled_cache_key === "string" ? row.tiled_cache_key : null,
    tiledForceRegeneration: row.tiled_force_regeneration === true,
    frame: typeof frameWidth === "number" && typeof frameHeight === "number"
      ? Object.freeze({ width: frameWidth, height: frameHeight })
      : null,
    productionAuthority: (row.production_authority ??
      null) as AfcV2ProductionRoomAuthority | null,
    diagnosticPayload: row.diagnostic_payload ?? null,
    failureReason: typeof row.failure_reason === "string" ? row.failure_reason : null,
    metricStatus: typeof row.metric_status === "string" ? row.metric_status : null,
    collisionStatus: typeof row.collision_status === "string"
      ? row.collision_status
      : null,
    providerProvenance: isRecord(row.provider_provenance)
      ? Object.freeze({ ...row.provider_provenance })
      : Object.freeze({}),
  });
}

async function downloadArtifact(
  supabase: AnySupabase,
  bucket: string,
  path: string,
): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function loadOwnedOriginalForProductionAnalysis(
  supabase: AnySupabase,
  input: Readonly<{ userId: string; room: AfcRoomPointer }>,
): Promise<
  | { ok: true; bytes: Uint8Array; sourceImageUrl: string }
  | { ok: false }
> {
  const prepared = await prepareOwnedOriginalForAnalysis({
    authenticatedUserId: input.userId,
    room: input.room,
    download: async (ref) => downloadArtifact(supabase, ref.bucket, ref.path),
    sign: async (ref, expiresInSec) => {
      const { data, error } = await supabase.storage
        .from(ref.bucket)
        .createSignedUrl(ref.path, expiresInSec);
      if (error || typeof data?.signedUrl !== "string") return null;
      return data.signedUrl;
    },
    expiresInSec: AFC_V2_ORIGINAL_SIGNED_URL_EXPIRES_IN_SEC,
  });
  if (!prepared.ok) return { ok: false };
  return {
    ok: true,
    bytes: prepared.bytes,
    sourceImageUrl: prepared.sourceImageUrl,
  };
}

export function createSupabaseAfcProductionStore(
  supabase: AnySupabase,
): AfcProductionStore {
  return {
    async getRoom(roomId) {
      const { data, error } = await supabase
        .from("vibode_rooms")
        .select("id, user_id, current_afc_generation_id, base_storage_path, base_asset_id")
        .eq("id", roomId)
        .maybeSingle();
      if (error || !data) return null;
      let bucket: string | null = AFC_V2_ORIGINAL_STORAGE_BUCKET;
      let baseAsset: AfcRoomBaseAsset | null = null;
      if (typeof data.base_asset_id === "string") {
        const { data: asset } = await supabase
          .from("vibode_room_assets")
          .select("id, room_id, user_id, storage_bucket, storage_path")
          .eq("id", data.base_asset_id)
          .maybeSingle();
        if (asset) {
          baseAsset = Object.freeze({
            id: String(asset.id),
            roomId: String(asset.room_id),
            userId: String(asset.user_id),
            storageBucket: typeof asset.storage_bucket === "string"
              ? asset.storage_bucket
              : null,
            storagePath: typeof asset.storage_path === "string"
              ? asset.storage_path
              : null,
          });
          if (baseAsset.storageBucket) bucket = baseAsset.storageBucket;
          if (!data.base_storage_path && baseAsset.storagePath) {
            data.base_storage_path = baseAsset.storagePath;
          }
        }
      }
      return Object.freeze({
        id: data.id,
        userId: data.user_id,
        currentAfcGenerationId: data.current_afc_generation_id ?? null,
        baseStorageBucket: bucket,
        baseStoragePath: data.base_storage_path ?? null,
        baseAsset,
      });
    },
    async createGeneration(input: CreateAfcGenerationInput) {
      const { data, error } = await supabase
        .from("vibode_afc_generations")
        .insert({
          room_id: input.roomId,
          user_id: input.userId,
          parent_generation_id: input.parentGenerationId,
          run_id: input.runId,
          intent: input.intent,
          status: "running",
          tiled_force_regeneration: input.tiledForceRegeneration,
          ...(input.id ? { id: input.id } : {}),
        })
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "Failed to create AFC generation");
      }
      return rowToGeneration(data);
    },
    async updateGeneration(generationId, patch: UpdateAfcGenerationInput) {
      const update: Record<string, unknown> = {
        ...identityColumns("original", patch.original),
        ...identityColumns("empty", patch.empty),
        ...identityColumns("tiled", patch.tiled),
      };
      if (patch.status !== undefined) update.status = patch.status;
      if (patch.completedAt !== undefined) update.completed_at = patch.completedAt;
      if (patch.emptyArtifactSource !== undefined) {
        update.empty_artifact_source = patch.emptyArtifactSource;
      }
      if (patch.tiledArtifactSource !== undefined) {
        update.tiled_artifact_source = patch.tiledArtifactSource;
      }
      if (patch.emptyStoragePath !== undefined) {
        update.empty_storage_path = patch.emptyStoragePath;
        update.empty_storage_bucket = patch.emptyStoragePath
          ? AFC_V2_PRODUCTION_STORAGE_BUCKET
          : null;
      }
      if (patch.tiledStoragePath !== undefined) {
        update.tiled_storage_path = patch.tiledStoragePath;
        update.tiled_storage_bucket = patch.tiledStoragePath
          ? AFC_V2_PRODUCTION_STORAGE_BUCKET
          : null;
      }
      if (patch.tiledCacheKey !== undefined) {
        update.tiled_cache_key = patch.tiledCacheKey;
      }
      if (patch.frame !== undefined) {
        update.frame_width = patch.frame?.width ?? null;
        update.frame_height = patch.frame?.height ?? null;
      }
      if (patch.productionAuthority !== undefined) {
        update.production_authority = patch.productionAuthority;
      }
      if (patch.diagnosticPayload !== undefined) {
        update.diagnostic_payload = patch.diagnosticPayload;
      }
      if (patch.failureReason !== undefined) {
        update.failure_reason = patch.failureReason;
      }
      if (patch.metricStatus !== undefined) update.metric_status = patch.metricStatus;
      if (patch.collisionStatus !== undefined) {
        update.collision_status = patch.collisionStatus;
      }
      if (patch.providerProvenance !== undefined) {
        update.provider_provenance = patch.providerProvenance;
      }
      const { data, error } = await supabase
        .from("vibode_afc_generations")
        .update(update)
        .eq("id", generationId)
        .select("*")
        .single();
      if (error || !data) {
        if (error?.message?.includes("immutable")) {
          throw new AfcGenerationImmutabilityError(error.message);
        }
        throw new Error(error?.message ?? "Failed to update AFC generation");
      }
      return rowToGeneration(data);
    },
    async getGeneration(generationId) {
      const { data, error } = await supabase
        .from("vibode_afc_generations")
        .select("*")
        .eq("id", generationId)
        .maybeSingle();
      if (error || !data) return null;
      return rowToGeneration(data);
    },
    async activateGeneration(input) {
      const { data, error } = await supabase.rpc("activate_vibode_afc_generation", {
        p_room_id: input.roomId,
        p_user_id: input.userId,
        p_generation_id: input.generationId,
      });
      if (error) {
        throw new Error(error.message);
      }
      if (typeof data !== "string" || data.length === 0) {
        throw new Error("AFC generation activation did not return a current pointer");
      }
      return data;
    },
    async lookupDurableEmpty(userId, originalSha256) {
      const { data, error } = await supabase
        .from("vibode_afc_durable_empty_artifacts")
        .select("*")
        .eq("user_id", userId)
        .eq("original_sha256", originalSha256)
        .maybeSingle();
      if (error || !data) return null;
      const bytes = await downloadArtifact(
        supabase,
        data.storage_bucket,
        data.storage_path,
      );
      if (!bytes) return null;
      if (
        !durableArtifactBytesMatch({
          bytes,
          sha256: data.empty_sha256,
          byteCount: data.byte_count,
        })
      ) {
        return null;
      }
      const basis: AfcSr1LiveBasis = Object.freeze({
        sha256: data.empty_sha256,
        decodedWidth: data.decoded_width,
        decodedHeight: data.decoded_height,
        byteCount: data.byte_count,
        mimeType: data.mime_type,
        orientation: 1,
      });
      return Object.freeze({
        userId,
        originalSha256,
        basis,
        bytes,
        storageBucket: data.storage_bucket,
        storagePath: data.storage_path,
        sourceGenerationId: data.source_generation_id,
      }) satisfies DurableEmptyArtifact;
    },
    async publishDurableEmpty(artifact) {
      const { error } = await supabase.from("vibode_afc_durable_empty_artifacts").upsert({
        user_id: artifact.userId,
        original_sha256: artifact.originalSha256,
        empty_sha256: artifact.basis.sha256,
        decoded_width: artifact.basis.decodedWidth,
        decoded_height: artifact.basis.decodedHeight,
        byte_count: artifact.basis.byteCount,
        mime_type: artifact.basis.mimeType,
        orientation: artifact.basis.orientation,
        storage_bucket: artifact.storageBucket,
        storage_path: artifact.storagePath,
        source_generation_id: artifact.sourceGenerationId,
      });
      if (error) throw new Error(error.message);
    },
    async lookupDurableTiled(userId, cacheKey) {
      const { data, error } = await supabase
        .from("vibode_afc_durable_tiled_artifacts")
        .select("*")
        .eq("user_id", userId)
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (error || !data) return null;
      const bytes = await downloadArtifact(
        supabase,
        data.storage_bucket,
        data.storage_path,
      );
      if (!bytes) return null;
      const tiledIdentity = data.tiled_identity;
      const tiledSha = isRecord(tiledIdentity) && typeof tiledIdentity.sha256 === "string"
        ? tiledIdentity.sha256
        : data.tiled_sha256;
      if (
        typeof tiledSha !== "string" ||
        tiledSha !== data.tiled_sha256 ||
        !durableArtifactBytesMatch({
          bytes,
          sha256: data.tiled_sha256,
          byteCount: data.byte_count,
        })
      ) {
        return null;
      }
      const result: AfcSr1GeneratedTiledArtifact = Object.freeze({
        status: "generated",
        input: data.empty_identity,
        tiled: Object.freeze({
          base64: Buffer.from(bytes).toString("base64"),
          identity: data.tiled_identity,
        }),
        provenance: data.provenance,
        compatibility: data.compatibility,
      }) as AfcSr1GeneratedTiledArtifact;
      return Object.freeze({
        userId,
        cacheKey,
        emptySha256: data.empty_sha256,
        result,
        bytes,
        storageBucket: data.storage_bucket,
        storagePath: data.storage_path,
        sourceGenerationId: data.source_generation_id,
      }) satisfies DurableTiledArtifact;
    },
    async publishDurableTiled(artifact) {
      const { error } = await supabase.from("vibode_afc_durable_tiled_artifacts").upsert({
        user_id: artifact.userId,
        cache_key: artifact.cacheKey,
        empty_sha256: artifact.emptySha256,
        tiled_sha256: artifact.result.tiled.identity.sha256,
        decoded_width: artifact.result.tiled.identity.decodedWidth,
        decoded_height: artifact.result.tiled.identity.decodedHeight,
        byte_count: artifact.result.tiled.identity.byteCount,
        mime_type: artifact.result.tiled.identity.mimeType,
        orientation: artifact.result.tiled.identity.orientation,
        storage_bucket: artifact.storageBucket,
        storage_path: artifact.storagePath,
        generator_id: artifact.result.provenance.generatorId,
        profile_id: artifact.result.provenance.profileId,
        research_preset: artifact.result.provenance.researchPreset,
        requested_model_id: artifact.result.provenance.requestedModelId,
        empty_identity: artifact.result.input,
        tiled_identity: artifact.result.tiled.identity,
        provenance: artifact.result.provenance,
        compatibility: artifact.result.compatibility,
        source_generation_id: artifact.sourceGenerationId,
      });
      if (error) throw new Error(error.message);
    },
    async putArtifact(input) {
      const { error } = await supabase.storage
        .from(AFC_V2_PRODUCTION_STORAGE_BUCKET)
        .upload(input.path, Buffer.from(input.bytes), {
          contentType: input.contentType,
          upsert: true,
        });
      if (error) throw new Error(error.message);
      return Object.freeze({
        bucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
        path: input.path,
      });
    },
    async getArtifact(path) {
      return downloadArtifact(supabase, AFC_V2_PRODUCTION_STORAGE_BUCKET, path);
    },
  };
}

export function createProductionAfcStoreFromEnv(): AfcProductionStore | null {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return null;
  return createSupabaseAfcProductionStore(supabase);
}
