import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type { PersistedVersionScene } from "@/lib/afc-v2-runtime/persisted-scene";
import {
  mintThumbnailRenderToken,
  thumbnailRenderTokenSecret,
  type ThumbnailRenderTokenClaims,
} from "@/lib/vibode-thumbnail-render/access.server";
import {
  inspectVibodeThumbnailContent,
  type ThumbnailRenderClaimRecord,
} from "@/lib/vibode-thumbnail-render/payload.server";

import {
  thumbnailJobFailureIsRetryable,
  thumbnailQuietWindowDeadline,
} from "./policy";

/**
 * Scene persistence stays successful when thumbnail enqueue fails.
 * The 3D scene is authoritative. The thumbnail is a derivative: a failed
 * enqueue is logged and recovered by a later save, which computes the
 * same content token and coalesces a new pending job.
 */

export type ThumbnailScheduleResult =
  | Readonly<{ ok: true; scheduled: "pending" | "cleared" | "unchanged" }>
  | Readonly<{ ok: false; code: string }>;

export type ClaimedThumbnailJob = Readonly<{
  jobId: string;
  roomId: string;
  versionId: string;
  afcGenerationId: string;
  contentToken: string;
  claimNonce: string;
  claimExpiresAt: string;
  attemptCount: number;
  accessToken: string;
}>;

export async function scheduleVibodeThumbnailAfterSceneSave(
  scene: PersistedVersionScene,
): Promise<ThumbnailScheduleResult> {
  try {
    const inspected = await inspectVibodeThumbnailContent({
      roomId: scene.roomId,
      versionId: scene.versionId,
    });
    if (!inspected.ok) {
      console.error("[vibode-3d-thumbnail] enqueue skipped", {
        code: inspected.code,
        roomId: scene.roomId,
        versionId: scene.versionId,
      });
      return { ok: false, code: inspected.code };
    }
    if (!inspected.sceneUpdatedAt) {
      console.error("[vibode-3d-thumbnail] enqueue skipped", {
        code: "scene_missing",
        roomId: scene.roomId,
        versionId: scene.versionId,
      });
      return { ok: false, code: "scene_missing" };
    }
    if (inspected.empty) {
      const cleared = await callRpc("clear_vibode_3d_thumbnail_for_empty_scene", {
        p_room_id: scene.roomId,
        p_version_id: scene.versionId,
      });
      if (!cleared.ok) return { ok: false, code: cleared.code };
      return { ok: true, scheduled: "cleared" };
    }
    const enqueued = await callRpc("enqueue_vibode_3d_thumbnail_job", {
      p_room_id: inspected.roomId,
      p_version_id: inspected.versionId,
      p_afc_generation_id: inspected.afcGenerationId,
      p_content_token: inspected.contentToken,
      p_not_before: thumbnailQuietWindowDeadline(Date.now()),
      p_scene_updated_at: inspected.sceneUpdatedAt,
    });
    if (!enqueued.ok) return { ok: false, code: enqueued.code };
    const status = typeof enqueued.row.status === "string" ? enqueued.row.status : "";
    if (status === "completed") return { ok: true, scheduled: "unchanged" };
    return { ok: true, scheduled: "pending" };
  } catch (error) {
    console.error("[vibode-3d-thumbnail] enqueue failed", {
      roomId: scene.roomId,
      versionId: scene.versionId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, code: "enqueue_failed" };
  }
}

export async function claimNextVibodeThumbnailJob(
  deps?: Readonly<{
    tokenSecret?: () => string | null;
    rpc?: typeof callRpc;
  }>,
): Promise<
  | Readonly<{ ok: true; job: ClaimedThumbnailJob | null }>
  | Readonly<{ ok: false; code: string }>
> {
  const secret = (deps?.tokenSecret ?? thumbnailRenderTokenSecret)();
  if (!secret) return { ok: false, code: "render_access_denied" };
  const rpc = deps?.rpc ?? callRpc;
  const claimed = await rpc("claim_next_vibode_3d_thumbnail_job", {});
  if (!claimed.ok) return claimed;
  const job = claimed.row.job;
  if (job == null) return { ok: true, job: null };
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    return { ok: false, code: "not_claimed" };
  }
  const record = job as Record<string, unknown>;
  const jobId = text(record.id);
  const roomId = text(record.roomId);
  const versionId = text(record.versionId);
  const contentToken = text(record.contentToken);
  const claimNonce = text(record.claimNonce);
  const claimExpiresAt = text(record.claimExpiresAt);
  const afcGenerationId = text(record.afcGenerationId);
  const attemptCount = typeof record.attemptCount === "number" ? record.attemptCount : 0;
  if (!jobId || !roomId || !versionId || !contentToken || !claimNonce || !claimExpiresAt) {
    return { ok: false, code: "not_claimed" };
  }
  const minted = mintThumbnailRenderToken({
    jobId,
    roomId,
    versionId,
    contentToken,
    nonce: claimNonce,
    durable: true,
  });
  if (!minted) return { ok: false, code: "render_access_denied" };
  return {
    ok: true,
    job: {
      jobId,
      roomId,
      versionId,
      afcGenerationId,
      contentToken,
      claimNonce,
      claimExpiresAt,
      attemptCount,
      accessToken: minted.token,
    },
  };
}

export async function failVibodeThumbnailJob(input: Readonly<{
  jobId: string;
  claimNonce: string;
  code: string;
  message: string;
}>): Promise<Readonly<{ ok: true; status: string } | { ok: false; code: string }>> {
  const failed = await callRpc("fail_vibode_3d_thumbnail_job", {
    p_job_id: input.jobId,
    p_claim_nonce: input.claimNonce,
    p_code: input.code,
    p_message: input.message,
    p_retryable: thumbnailJobFailureIsRetryable(input.code),
  });
  if (!failed.ok) return failed;
  return {
    ok: true,
    status: typeof failed.row.status === "string" ? failed.row.status : "failed",
  };
}

export async function lookupDurableThumbnailRenderClaim(
  nonce: string,
): Promise<ThumbnailRenderClaimRecord | null> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase || !nonce) return null;
  const { data, error } = await supabase
    .from("vibode_3d_thumbnail_jobs")
    .select("id, room_id, version_id, claim_content_token, claim_expires_at, status, claim_nonce")
    .eq("claim_nonce", nonce)
    .eq("status", "running")
    .maybeSingle();
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const expiresAt = text(row.claim_expires_at);
  const contentToken = text(row.claim_content_token);
  const jobId = text(row.id);
  const roomId = text(row.room_id);
  const versionId = text(row.version_id);
  if (!expiresAt || !contentToken || !jobId || !roomId || !versionId) return null;
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return null;
  return { jobId, roomId, versionId, contentToken, expiresAtMs };
}

export function thumbnailRenderClaimsMatchJob(
  claims: ThumbnailRenderTokenClaims,
  job: ClaimedThumbnailJob,
): boolean {
  return claims.jobId === job.jobId &&
    claims.roomId === job.roomId &&
    claims.versionId === job.versionId &&
    claims.contentToken === job.contentToken &&
    claims.nonce === job.claimNonce;
}

async function callRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<
  | Readonly<{ ok: true; row: Record<string, unknown> }>
  | Readonly<{ ok: false; code: string }>
> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    console.error("[vibode-3d-thumbnail] service role unavailable", { fn });
    return { ok: false, code: "enqueue_failed" };
  }
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error("[vibode-3d-thumbnail] rpc failed", { fn, message: error.message });
    return { ok: false, code: "enqueue_failed" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, code: "enqueue_failed" };
  }
  const row = data as Record<string, unknown>;
  if (row.ok === false) {
    return { ok: false, code: typeof row.code === "string" ? row.code : "enqueue_failed" };
  }
  return { ok: true, row };
}

function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
