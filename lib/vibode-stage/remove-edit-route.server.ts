import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { isAfcV2ArtifactLineageRecorded } from "@/lib/afc-v2-production/artifact-lineage-diagnostic";
import {
  durableArtifactBytesMatch,
  sha256Hex,
} from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";
import {
  AFC_V2_ORIGINAL_STORAGE_BUCKET,
  type AfcGenerationRecord,
} from "@/lib/afc-v2-production/production-store";
import { selectHarmonizeEmptyBytes } from "@/lib/vibode-stage/harmonize-empty";
import type { HarmonizeExportAuthority } from "@/lib/vibode-stage/harmonize-export";
import { VIBODE_HISTORY_BUCKET } from "@/lib/vibode-stage/harmonize-jobs/policy";
import {
  assessRemoveAlignment,
  type RemoveAlignmentFacts,
  type RemoveImageDescriptor,
} from "@/lib/vibode-stage/remove-alignment";
import { REMOVE_EDIT_ALIGNMENT_ERROR, REMOVE_EDIT_STALE_ERROR } from "@/lib/vibode-stage/remove-edit";
import type { RemoveEditHttpDeps } from "@/lib/vibode-stage/remove-edit-http";
import type { RemoveEditStorage } from "@/lib/vibode-stage/remove-edit-publish.server";
import { createCleanupServiceClient } from "@/lib/vibode-stage/remove-cleanup-jobs/service-client";

export function createRemoveEditRouteDeps(): RemoveEditHttpDeps | null {
  const client = createCleanupServiceClient();
  const store = createProductionAfcStoreFromEnv();
  const service = getServiceRoleSupabaseClient();
  if (!client || !store || !service) return null;
  const storage: RemoveEditStorage = {
    async putPng(path, bytes) {
      const bucket = client.storage.from("vibode-generations");
      const uploaded = await bucket.upload(path, Buffer.from(bytes), {
        contentType: "image/png",
        upsert: false,
      });
      if (!uploaded.error) return "stored";
      const existing = await bucket.download(path);
      if (!existing.data) return "failed";
      const current = new Uint8Array(await existing.data.arrayBuffer());
      return sha256Hex(current) === sha256Hex(bytes) ? "exists-same" : "exists-different";
    },
    async publish(input) {
      const { data, error } = await client.rpc("publish_vibode_remove_edit", {
        p_user_id: input.userId,
        p_room_id: input.roomId,
        p_fingerprint: input.fingerprint,
        p_afc_generation_id: input.afcGenerationId,
        p_parent_asset_id: input.parentAssetId,
        p_selected_asset_id: input.selectedAssetId,
        p_width: input.width,
        p_height: input.height,
        p_output_sha256: input.outputSha256,
        p_storage_path: input.storagePath,
        p_original_sha256: input.originalSha256,
        p_empty_sha256: input.emptySha256,
        p_keep_sha256: input.keepSha256,
        p_coverage_width: input.coverageWidth,
        p_coverage_height: input.coverageHeight,
      });
      if (error || !data || typeof data !== "object") return { ok: false, code: "unavailable" };
      const body = data as { ok?: unknown; code?: unknown; assetId?: unknown };
      if (body.ok !== true || typeof body.assetId !== "string") {
        const code = body.code === "not_found" || body.code === "invalid" ? body.code : "unavailable";
        return { ok: false, code };
      }
      return { ok: true, created: body.code === "saved", assetId: body.assetId };
    },
  };
  return {
    getAdmin: async () => {
      const user = await getAuthenticatedAdminUser();
      return user ? { id: user.id } : null;
    },
    storage,
    loadSubmission: async (adminId, body) => {
      const room = await store.getRoom(body.roomId);
      if (!room || room.userId !== adminId) return { ok: false, status: 404, error: "Not found." };
      if (!room.currentAfcGenerationId || room.currentAfcGenerationId !== body.generationId) {
        return { ok: false, status: 409, error: "This Remove session is out of date. Close it and open Remove again." };
      }
      if (!body.parentAssetId) return { ok: false, status: 404, error: "Not found." };
      const { data: parent, error } = await client
        .from("vibode_room_assets")
        .select("id,room_id,user_id,storage_bucket,storage_path")
        .eq("id", body.parentAssetId)
        .maybeSingle();
      if (error || !parent || parent.room_id !== body.roomId || parent.user_id !== adminId) {
        return { ok: false, status: 404, error: "Not found." };
      }
      const bucket = typeof parent.storage_bucket === "string" ? parent.storage_bucket : "";
      const storagePath = typeof parent.storage_path === "string" ? parent.storage_path : "";
      if (
        (bucket !== VIBODE_HISTORY_BUCKET && bucket !== AFC_V2_ORIGINAL_STORAGE_BUCKET)
        || storagePath.length === 0
        || storagePath.includes("..")
        || storagePath.startsWith("/")
      ) {
        return { ok: false, status: 404, error: "Not found." };
      }
      const downloaded = await client.storage.from(bucket).download(storagePath);
      if (downloaded.error || !downloaded.data) {
        return { ok: false, status: 409, error: REMOVE_EDIT_ALIGNMENT_ERROR };
      }
      const keepBytes = new Uint8Array(await downloaded.data.arrayBuffer());
      if (sha256Hex(keepBytes) !== body.keepSha256) {
        return { ok: false, status: 409, error: REMOVE_EDIT_STALE_ERROR };
      }
      const generation = await store.getGeneration(body.generationId);
      if (!generation || generation.userId !== adminId || generation.roomId !== body.roomId) {
        return { ok: false, status: 404, error: "Not found." };
      }
      const originalLoaded = generation.original
        ? await loadOwnedOriginalForProductionAnalysis(service, { userId: adminId, room })
        : { ok: false as const };
      const original = imageIdentity(generation.original);
      const originalBytes = originalLoaded.ok ? originalLoaded.bytes : null;
      const originalBytesMatch = Boolean(
        original
        && originalBytes
        && durableArtifactBytesMatch({
          bytes: originalBytes,
          sha256: original.sha256,
          byteCount: original.byteCount,
        }),
      );
      const emptyBytes = generation.emptyStoragePath
        ? await store.getArtifact(generation.emptyStoragePath)
        : null;
      const selected = selectHarmonizeEmptyBytes({
        callerIsAdmin: true,
        callerUserId: adminId,
        roomId: body.roomId,
        room,
        generation: {
          id: generation.id,
          roomId: generation.roomId,
          userId: generation.userId,
          status: generation.status,
          empty: generation.empty,
          emptyStoragePath: generation.emptyStoragePath,
        },
        authority: harmonizeAuthority(generation),
        bytes: emptyBytes,
      });
      const lineage = isAfcV2ArtifactLineageRecorded(generation.artifactLineage)
        ? generation.artifactLineage.empty
        : null;
      const facts: RemoveAlignmentFacts = {
        generationId: generation.id,
        status: generation.status,
        original,
        originalBytesMatch,
        empty: imageIdentity(generation.empty),
        emptyBytesMatch: selected.ok,
        emptyFailure: selected.ok ? null : selected.error,
        emptyArtifactSource: generation.emptyArtifactSource,
        lineageSource: lineage?.source ?? null,
        reusedFromGenerationId: lineage?.reusedFromGenerationId ?? null,
        lineageSha256: lineage?.sha256 ?? null,
        frame: generation.productionAuthority?.frame ?? generation.frame,
        frozenCameraFrame: generation.productionAuthority?.frozenCamera.frame ?? null,
      };
      const assessment = assessRemoveAlignment(facts);
      if (!assessment.usable || !originalBytes || !selected.ok || !original) {
        return { ok: false, status: 409, error: REMOVE_EDIT_ALIGNMENT_ERROR };
      }
      return {
        userId: adminId,
        roomId: body.roomId,
        generationId: body.generationId,
        parentAssetId: body.parentAssetId,
        coverageWidth: body.width,
        coverageHeight: body.height,
        coverageBase64: body.coverageBase64,
        report: assessment.report,
        keepBytes,
        emptyBytes: selected.bytes,
        keepSha256: body.keepSha256,
        keepWidth: body.keepWidth,
        keepHeight: body.keepHeight,
        originalSha256: original.sha256,
        emptySha256: assessment.report.empty.sha256,
      };
    },
  };
}

function imageIdentity(value: AfcGenerationRecord["original"]): RemoveImageDescriptor | null {
  if (!value || value.orientation !== 1) return null;
  if (value.mimeType !== "image/jpeg" && value.mimeType !== "image/png" && value.mimeType !== "image/webp") {
    return null;
  }
  return {
    sha256: value.sha256.toLowerCase(),
    decodedWidth: value.decodedWidth,
    decodedHeight: value.decodedHeight,
    byteCount: value.byteCount,
    mimeType: value.mimeType,
    orientation: 1,
  };
}

function harmonizeAuthority(generation: AfcGenerationRecord): HarmonizeExportAuthority | null {
  const authority = generation.productionAuthority;
  const empty = generation.empty;
  if (!authority || !empty || authority.status !== "ready" || authority.generationId !== generation.id) {
    return null;
  }
  return {
    generationId: generation.id,
    empty: {
      sha256: empty.sha256,
      decodedWidth: empty.decodedWidth,
      decodedHeight: empty.decodedHeight,
      orientation: empty.orientation,
    },
    original: generation.original
      ? { sha256: generation.original.sha256, orientation: generation.original.orientation }
      : undefined,
    frame: authority.frame,
    frozenCamera: { frame: authority.frozenCamera.frame },
  };
}
