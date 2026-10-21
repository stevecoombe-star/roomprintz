import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  CLEANUP_HISTORY_BUCKET,
  CLEANUP_HISTORY_LABEL,
  classifyCleanupCandidateAspect,
  cleanupHistoryObjectPath,
  type CleanupHistoryAcceptResult,
  type CleanupHistoryAspectTier,
} from "@/lib/vibode-stage/remove-cleanup-history";

import { VIBODE_CLEANUP_BUCKET } from "./policy";
import type { CleanupJobRow } from "./types";

const MAX_DECODED_PIXELS = 40_000_000;
const READINESS_USER_ID = "00000000-0000-4000-8000-000000000000";
const READINESS_JOB_ID = "00000000-0000-4000-8000-000000000001";

export async function acceptSupabaseCleanupHistory(
  client: SupabaseClient,
  job: CleanupJobRow,
): Promise<CleanupHistoryAcceptResult> {
  if (!job.outputPath || !job.outputSha256) {
    return { ok: false, code: job.status === "succeeded" ? "candidate_missing" : "not_succeeded" };
  }
  if (!(await cleanupHistoryPublicationReady(client))) {
    return { ok: false, code: "unavailable" };
  }
  const downloaded = await client.storage.from(VIBODE_CLEANUP_BUCKET).download(job.outputPath);
  if (downloaded.error || !downloaded.data) return { ok: false, code: "candidate_missing" };
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (sha256Hex(bytes) !== job.outputSha256) return { ok: false, code: "candidate_mismatch" };
  const decoded = await decodeJpeg(bytes);
  if (!decoded || decoded.width !== job.outputWidth || decoded.height !== job.outputHeight) {
    return { ok: false, code: "undecodable" };
  }
  const aspect = classifyCleanupCandidateAspect({
    originalWidth: job.originalWidth,
    originalHeight: job.originalHeight,
    candidateWidth: decoded.width,
    candidateHeight: decoded.height,
    candidateOrientation: decoded.orientation,
  });
  if (!aspect.ok) return { ok: false, code: "aspect_incompatible" };
  const path = cleanupHistoryObjectPath(job.roomId, job.id);
  const stored = await placeHistoryObject(client, path, bytes);
  if (stored === "mismatch") return { ok: false, code: "candidate_mismatch" };
  if (stored !== "created" && stored !== "present") return { ok: false, code: "unavailable" };
  const sourceAssetId = await lineageSourceAssetId(client, job);
  const published = await client.rpc("accept_vibode_cleanup_history", {
    p_user_id: job.userId,
    p_job_id: job.id,
    p_output_sha256: job.outputSha256,
    p_width: decoded.width,
    p_height: decoded.height,
    p_history_bucket: CLEANUP_HISTORY_BUCKET,
    p_history_path: path,
    p_aspect_tier: aspect.tier,
    p_aspect_error: aspect.relativeAspectError,
    p_source_asset_id: sourceAssetId,
  });
  if (published.error || !published.data || typeof published.data !== "object" || Array.isArray(published.data)) {
    return { ok: false, code: "unavailable" };
  }
  const row = published.data as Record<string, unknown>;
  if (row.ok !== true || (row.code !== "accepted" && row.code !== "already_accepted") || typeof row.assetId !== "string") {
    return { ok: false, code: acceptCode(row.code) };
  }
  if (row.activated === true) return { ok: false, code: "unavailable" };
  job.historyAssetId = row.assetId;
  job.acceptedAtMs = job.acceptedAtMs ?? Date.now();
  return {
    ok: true,
    created: row.code === "accepted",
    activated: false,
    asset: {
      id: row.assetId,
      jobId: job.id,
      roomId: job.roomId,
      userId: job.userId,
      bucket: CLEANUP_HISTORY_BUCKET,
      path,
      sha256: job.outputSha256,
      width: decoded.width,
      height: decoded.height,
      bytes,
      isActive: false,
      label: CLEANUP_HISTORY_LABEL,
      sourceAssetId,
      sourceAfcGenerationId: job.afcGenerationId,
      originalSha256: job.originalSha256,
      provider: job.provider,
      model: job.returnedModelId ?? job.requestedModelId,
      aspectTier: aspect.tier,
      relativeAspectError: aspect.relativeAspectError,
      acceptedAtMs: job.acceptedAtMs,
      generationRunId: typeof row.generationRunId === "string" ? row.generationRunId : "",
    },
  };
}

async function cleanupHistoryPublicationReady(client: SupabaseClient): Promise<boolean> {
  try {
    const jobColumn = await client
      .from("vibode_cleanup_generations")
      .select("history_asset_id")
      .limit(1);
    if (jobColumn.error) return false;
    const assetColumn = await client.from("vibode_room_assets").select("cleanup_job_id").limit(1);
    if (assetColumn.error) return false;
    const runColumn = await client.from("vibode_generation_runs").select("cleanup_job_id").limit(1);
    if (runColumn.error) return false;
    const probe = await client.rpc("accept_vibode_cleanup_history", {
      p_user_id: READINESS_USER_ID,
      p_job_id: READINESS_JOB_ID,
      p_output_sha256: "0".repeat(64),
      p_width: 1,
      p_height: 1,
      p_history_bucket: CLEANUP_HISTORY_BUCKET,
      p_history_path: cleanupHistoryObjectPath(READINESS_USER_ID, READINESS_JOB_ID),
      p_aspect_tier: "exact_grid_compatible",
      p_aspect_error: 0,
      p_source_asset_id: null,
    });
    if (probe.error || !probe.data || typeof probe.data !== "object" || Array.isArray(probe.data)) return false;
    const row = probe.data as Record<string, unknown>;
    return row.ok === false && row.code === "not_found";
  } catch {
    return false;
  }
}

async function placeHistoryObject(
  client: SupabaseClient,
  path: string,
  bytes: Uint8Array,
): Promise<"created" | "present" | "mismatch" | "unavailable"> {
  const bucket = client.storage.from(CLEANUP_HISTORY_BUCKET);
  const uploaded = await bucket.upload(path, Buffer.from(bytes), { contentType: "image/jpeg", upsert: false });
  if (!uploaded.error) return "created";
  const message = uploaded.error.message.toLowerCase();
  if (!message.includes("already") && !message.includes("exists")) return "unavailable";
  const existing = await bucket.download(path);
  if (existing.error || !existing.data) return "unavailable";
  return sha256Hex(new Uint8Array(await existing.data.arrayBuffer())) === sha256Hex(bytes) ? "present" : "mismatch";
}

async function lineageSourceAssetId(client: SupabaseClient, job: CleanupJobRow): Promise<string | null> {
  const { data, error } = await client
    .from("vibode_rooms")
    .select("active_asset_id, current_afc_generation_id")
    .eq("id", job.roomId)
    .eq("user_id", job.userId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.current_afc_generation_id !== job.afcGenerationId) return null;
  return typeof data.active_asset_id === "string" ? data.active_asset_id : null;
}

async function decodeJpeg(bytes: Uint8Array): Promise<Readonly<{ width: number; height: number; orientation: number }> | null> {
  try {
    const meta = await sharp(Buffer.from(bytes), {
      failOn: "error",
      animated: false,
      limitInputPixels: MAX_DECODED_PIXELS,
    }).metadata();
    if (!meta.width || !meta.height || meta.format !== "jpeg") return null;
    return { width: meta.width, height: meta.height, orientation: meta.orientation ?? 1 };
  } catch {
    return null;
  }
}

function acceptCode(code: unknown): Extract<CleanupHistoryAcceptResult, { ok: false }>["code"] {
  if (
    code === "not_found"
    || code === "not_succeeded"
    || code === "discarded"
    || code === "candidate_missing"
    || code === "candidate_mismatch"
    || code === "undecodable"
    || code === "aspect_incompatible"
  ) return code;
  return "unavailable";
}

export type { CleanupHistoryAspectTier };
