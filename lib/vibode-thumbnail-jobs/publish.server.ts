import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { inspectVibodeThumbnailContent } from "@/lib/vibode-thumbnail-render/payload.server";

import { failVibodeThumbnailJob } from "./jobs.server";
import {
  VIBODE_3D_THUMBNAIL_BUCKET,
  VIBODE_3D_THUMBNAIL_CACHE_CONTROL,
  VIBODE_3D_THUMBNAIL_CACHE_MAX_AGE_SEC,
  vibode3dThumbnailObjectPath,
} from "./policy";

export type ThumbnailPublishResult =
  | Readonly<{
    ok: true;
    storageBucket: string;
    storagePath: string;
    contentToken: string;
    idempotent: boolean;
  }>
  | Readonly<{ ok: false; code: string; pointerChanged: false }>;

/**
 * Upload is content-addressed. A second upload of the same token leaves
 * the existing object in place. Pointer publication is a separate guarded
 * RPC that rechecks the live scene token and refuses stale jobs.
 */
export async function publishVibodeThumbnailBytes(input: Readonly<{
  jobId: string;
  claimNonce: string;
  roomId: string;
  versionId: string;
  claimedContentToken: string;
  bytes: Uint8Array;
}>): Promise<ThumbnailPublishResult> {
  const path = vibode3dThumbnailObjectPath(
    input.roomId,
    input.versionId,
    input.claimedContentToken,
  );
  if (!path || !isWebp(input.bytes)) {
    return { ok: false, code: "invalid_storage_path", pointerChanged: false };
  }
  const inspected = await inspectVibodeThumbnailContent({
    roomId: input.roomId,
    versionId: input.versionId,
  });
  if (!inspected.ok) {
    await failVibodeThumbnailJob({
      jobId: input.jobId,
      claimNonce: input.claimNonce,
      code: inspected.code,
      message: inspected.message,
    });
    return { ok: false, code: inspected.code, pointerChanged: false };
  }
  if (inspected.empty) {
    await clearEmpty(input.roomId, input.versionId);
    const settled = await publishRpc({
      ...input,
      contentToken: input.claimedContentToken,
      afcGenerationId: inspected.afcGenerationId,
      sceneUpdatedAt: inspected.sceneUpdatedAt,
      backgroundBucket: "",
      backgroundPath: "",
    });
    return {
      ok: false,
      code: settled.ok ? "stale_publish" : settled.code,
      pointerChanged: false,
    };
  }
  if (inspected.contentToken !== input.claimedContentToken) {
    await rememberNewerToken(inspected);
    await failVibodeThumbnailJob({
      jobId: input.jobId,
      claimNonce: input.claimNonce,
      code: "stale_publish",
      message: "Scene changed before publish.",
    });
    return { ok: false, code: "stale_publish", pointerChanged: false };
  }
  const uploaded = await uploadImmutableWebp(path, input.bytes);
  if (!uploaded.ok) {
    await failVibodeThumbnailJob({
      jobId: input.jobId,
      claimNonce: input.claimNonce,
      code: "upload_failed",
      message: "Thumbnail upload failed.",
    });
    return { ok: false, code: "upload_failed", pointerChanged: false };
  }
  const published = await publishRpc({
    ...input,
    contentToken: inspected.contentToken,
    afcGenerationId: inspected.afcGenerationId,
    sceneUpdatedAt: inspected.sceneUpdatedAt,
    backgroundBucket: inspected.backgroundBucket,
    backgroundPath: inspected.backgroundPath,
  });
  if (!published.ok) {
    return { ok: false, code: published.code, pointerChanged: false };
  }
  return {
    ok: true,
    storageBucket: VIBODE_3D_THUMBNAIL_BUCKET,
    storagePath: path,
    contentToken: inspected.contentToken,
    idempotent: published.idempotent,
  };
}

export { VIBODE_3D_THUMBNAIL_CACHE_CONTROL };

async function rememberNewerToken(inspected: Readonly<{
  roomId: string;
  versionId: string;
  afcGenerationId: string;
  contentToken: string;
  sceneUpdatedAt: string;
}>): Promise<void> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return;
  await supabase.rpc("enqueue_vibode_3d_thumbnail_job", {
    p_room_id: inspected.roomId,
    p_version_id: inspected.versionId,
    p_afc_generation_id: inspected.afcGenerationId,
    p_content_token: inspected.contentToken,
    p_not_before: new Date().toISOString(),
    p_scene_updated_at: inspected.sceneUpdatedAt,
  });
}

async function clearEmpty(roomId: string, versionId: string): Promise<void> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return;
  await supabase.rpc("clear_vibode_3d_thumbnail_for_empty_scene", {
    p_room_id: roomId,
    p_version_id: versionId,
  });
}

async function publishRpc(input: Readonly<{
  jobId: string;
  claimNonce: string;
  contentToken: string;
  afcGenerationId: string;
  sceneUpdatedAt: string;
  backgroundBucket: string;
  backgroundPath: string;
}>): Promise<
  | Readonly<{ ok: true; idempotent: boolean }>
  | Readonly<{ ok: false; code: string }>
> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, code: "enqueue_failed" };
  const { data, error } = await supabase.rpc("publish_vibode_3d_thumbnail", {
    p_job_id: input.jobId,
    p_claim_nonce: input.claimNonce,
    p_content_token: input.contentToken,
    p_afc_generation_id: input.afcGenerationId,
    p_scene_updated_at: input.sceneUpdatedAt,
    p_background_bucket: input.backgroundBucket,
    p_background_path: input.backgroundPath,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, code: "upload_failed" };
  }
  const row = data as Record<string, unknown>;
  if (row.ok === false) {
    return { ok: false, code: typeof row.code === "string" ? row.code : "stale_publish" };
  }
  return { ok: true, idempotent: row.idempotent === true };
}

async function uploadImmutableWebp(
  path: string,
  bytes: Uint8Array,
): Promise<Readonly<{ ok: true } | { ok: false }>> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false };
  const body = new Blob([Buffer.from(bytes)], { type: "image/webp" });
  const { error } = await supabase.storage
    .from(VIBODE_3D_THUMBNAIL_BUCKET)
    .upload(path, body, {
      contentType: "image/webp",
      cacheControl: String(VIBODE_3D_THUMBNAIL_CACHE_MAX_AGE_SEC),
      upsert: false,
    });
  if (!error) return { ok: true };
  const message = error.message.toLowerCase();
  const status = "statusCode" in error ? String(error.statusCode) : "";
  if (status === "409" || message.includes("already exists") || message.includes("duplicate")) {
    return { ok: true };
  }
  console.error("[vibode-3d-thumbnail] upload failed", { path, message: error.message });
  return { ok: false };
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const riff = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  const webp = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
  return riff === "RIFF" && webp === "WEBP";
}
