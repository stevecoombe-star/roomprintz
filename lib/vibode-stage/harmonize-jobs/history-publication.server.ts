import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { renderVibode2dThumbnail, vibode2dThumbnailBucket, vibode2dThumbnailObjectPath } from "@/lib/vibodeAssetThumbnails";

import { canonicalWriteAllowed, placeIdenticalCanonicalObject } from "./canonical-thumbnail";
import {
  publishPreparedHarmonizeHistory,
  recoverHarmonizeHistoryPublication,
  type HarmonizeHistoryPublicationResult,
  type HarmonizeHistoryPublishResult,
  type HarmonizeHistoryStorage,
  type HarmonizePublicationJob,
} from "./history-publication";
import { VIBODE_HARMONIZE_BUCKET, VIBODE_HISTORY_BUCKET, harmonizeHistoryObjectPath } from "./policy";
import type { HarmonizeJobStatus } from "./types";

const PUBLICATION_COLUMNS = [
  "id",
  "user_id",
  "room_id",
  "status",
  "history_state",
  "output_bucket",
  "output_path",
  "output_sha256",
  "output_mime",
  "output_width",
  "output_height",
  "composite_width",
  "composite_height",
  "backdrop_kind",
  "scene_objects",
  "output_asset_id",
].join(", ");

/**
 * Publish one succeeded job. This does not claim, enqueue, or contact the provider.
 * Callers must pass a single job id. There is no table scan.
 */
export async function publishHarmonizeGenerationHistory(
  supabase: SupabaseClient,
  jobId: string,
  thumbnailDeadlineMs: number | null = null,
): Promise<HarmonizeHistoryPublicationResult> {
  const job = await loadHarmonizePublicationJob(supabase, jobId);
  if (!job) {
    return {
      outcome: "ignored",
      code: "not_found",
      assetId: null,
      generationRunId: null,
      activated: false,
      thumbnail: "skipped",
      disposition: "terminal",
    };
  }
  const published = await publishPreparedHarmonizeHistory({
    job,
    storage: supabaseHistoryStorage(supabase),
    publish: (args) => publishHistoryRpc(supabase, args),
    thumbnail: (thumb) => attachHarmonizeHistoryThumbnail(supabase, thumb, thumbnailDeadlineMs),
  });
  console.info("[vibode-harmonize] history", {
    jobId,
    outcome: published.outcome,
    code: published.code,
    activated: published.activated === true,
    thumbnail: published.thumbnail,
  });
  return published;
}

/**
 * Explicit one-job recovery with in-process retries. Not mounted on a
 * request handler or the worker poll loop. Durable scheduling is
 * runHarmonizeHistoryRecoveryOnce through the internal worker route.
 */
export async function recoverHarmonizeGenerationHistory(
  supabase: SupabaseClient,
  jobId: string,
): Promise<HarmonizeHistoryPublicationResult> {
  const job = await loadHarmonizePublicationJob(supabase, jobId);
  return recoverHarmonizeHistoryPublication({
    job,
    publish: () => publishHarmonizeGenerationHistory(supabase, jobId),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

/**
 * Thumbnail-only recovery for one already published Harmonize asset.
 * Does not call the publication RPC and does not change activation or room cover.
 */
export async function recoverPublishedHarmonizeThumbnail(
  supabase: SupabaseClient,
  jobId: string,
  thumbnailDeadlineMs: number | null = null,
): Promise<"created" | "present" | "failed" | "conflict"> {
  const job = await loadHarmonizePublicationJob(supabase, jobId);
  if (!job || job.status !== "succeeded" || job.historyState !== "published" || !job.outputAssetId) {
    return "failed";
  }
  return attachHarmonizeHistoryThumbnail(supabase, {
    jobId: job.id,
    roomId: job.roomId,
    userId: job.userId,
    assetId: job.outputAssetId,
    historyBucket: VIBODE_HISTORY_BUCKET,
    historyPath: harmonizeHistoryObjectPath(job.roomId, job.id),
  }, thumbnailDeadlineMs);
}

async function loadHarmonizePublicationJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<HarmonizePublicationJob | null> {
  const { data, error } = await supabase
    .from("vibode_harmonize_generations")
    .select(PUBLICATION_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const id = text(row.id);
  const userId = text(row.user_id);
  const roomId = text(row.room_id);
  const status = text(row.status);
  const historyState = text(row.history_state);
  if (!id || !userId || !roomId || !isStatus(status) || !isHistoryState(historyState)) return null;
  return {
    id,
    userId,
    roomId,
    status,
    historyState,
    outputBucket: text(row.output_bucket) || null,
    outputPath: text(row.output_path) || null,
    outputSha256: text(row.output_sha256) || null,
    outputMime: text(row.output_mime) || null,
    outputWidth: numberOrNull(row.output_width),
    outputHeight: numberOrNull(row.output_height),
    compositeWidth: numberOrNull(row.composite_width) ?? 0,
    compositeHeight: numberOrNull(row.composite_height) ?? 0,
    backdropKind: text(row.backdrop_kind) || null,
    sceneObjects: row.scene_objects ?? null,
    outputAssetId: text(row.output_asset_id) || null,
  };
}

function supabaseHistoryStorage(supabase: SupabaseClient): HarmonizeHistoryStorage {
  return {
    async download(bucket, path) {
      if (bucket !== VIBODE_HARMONIZE_BUCKET && bucket !== VIBODE_HISTORY_BUCKET) return null;
      const { data, error } = await supabase.storage.from(bucket).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async putIfAbsent(bucket, path, bytes) {
      if (bucket !== VIBODE_HISTORY_BUCKET) return { ok: false, code: "unavailable" };
      const uploaded = await supabase.storage.from(bucket).upload(path, Buffer.from(bytes), {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (!uploaded.error) return { ok: true, created: true };
      if (storageAlreadyExists(uploaded.error.message)) return { ok: false, code: "exists" };
      return { ok: false, code: "unavailable" };
    },
  };
}

async function publishHistoryRpc(
  supabase: SupabaseClient,
  args: Readonly<{ jobId: string; outputSha256: string; historyBucket: string; historyPath: string }>,
): Promise<HarmonizeHistoryPublishResult> {
  const { data, error } = await supabase.rpc("publish_vibode_harmonize_history", {
    p_job_id: args.jobId,
    p_output_sha256: args.outputSha256,
    p_history_bucket: args.historyBucket,
    p_history_path: args.historyPath,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, code: "unavailable" };
  }
  const row = data as Record<string, unknown>;
  const code = text(row.code) || "unavailable";
  if (row.ok === true && (code === "published" || code === "already_published")) {
    return {
      ok: true,
      code,
      assetId: text(row.assetId) || null,
      generationRunId: text(row.generationRunId) || null,
      activated: row.activated === true,
    };
  }
  return { ok: false, code };
}

async function attachHarmonizeHistoryThumbnail(
  supabase: SupabaseClient,
  thumb: Readonly<{
    jobId: string;
    roomId: string;
    userId: string;
    assetId: string;
    historyBucket: string;
    historyPath: string;
  }>,
  deadlineMs: number | null,
): Promise<"created" | "present" | "failed" | "conflict"> {
  const canonical = vibode2dThumbnailObjectPath(thumb.roomId, thumb.assetId);
  if (
    thumb.historyBucket !== VIBODE_HISTORY_BUCKET
    || thumb.historyPath !== harmonizeHistoryObjectPath(thumb.roomId, thumb.jobId)
  ) {
    return "failed";
  }
  const existing = await readThumbnailPath(supabase, thumb);
  if (existing === "present") return "present";
  if (existing !== "missing") return "failed";
  if (!canonicalWriteAllowed(deadlineMs, Date.now())) return "failed";
  const downloaded = await supabase.storage.from(thumb.historyBucket).download(thumb.historyPath);
  if (downloaded.error || !downloaded.data) return "failed";
  let rendered: Buffer;
  try {
    rendered = await renderVibode2dThumbnail(Buffer.from(await downloaded.data.arrayBuffer()));
  } catch {
    return "failed";
  }
  if (!canonicalWriteAllowed(deadlineMs, Date.now())) return "failed";
  const thumbnailBucket = vibode2dThumbnailBucket();
  const placed = await placeIdenticalCanonicalObject({
    async download(bucket, path) {
      const object = await supabase.storage.from(bucket).download(path);
      if (object.error || !object.data) return null;
      return new Uint8Array(await object.data.arrayBuffer());
    },
    async putIfAbsent(bucket, path, bytes) {
      const uploaded = await supabase.storage.from(bucket).upload(path, Buffer.from(bytes), {
        contentType: "image/webp",
        upsert: false,
      });
      if (!uploaded.error) return { ok: true };
      return { ok: false, code: "exists" };
    },
  }, thumbnailBucket, canonical, new Uint8Array(rendered));
  if (placed === "conflict") return "conflict";
  if (placed !== "created" && placed !== "present") return "failed";
  const updated = await supabase
    .from("vibode_room_assets")
    .update({
      thumbnail_storage_bucket: thumbnailBucket,
      thumbnail_storage_path: canonical,
    })
    .eq("id", thumb.assetId)
    .eq("room_id", thumb.roomId)
    .eq("user_id", thumb.userId)
    .eq("harmonize_job_id", thumb.jobId)
    .is("thumbnail_storage_path", null)
    .select("id");
  if (updated.error) return "failed";
  if (Array.isArray(updated.data) && updated.data.length === 1) {
    return placed === "present" ? "present" : "created";
  }
  const after = await readThumbnailPath(supabase, thumb);
  return after === "present" ? "present" : "failed";
}

async function readThumbnailPath(
  supabase: SupabaseClient,
  thumb: Readonly<{ jobId: string; roomId: string; userId: string; assetId: string }>,
): Promise<"missing" | "present" | "failed"> {
  const { data, error } = await supabase
    .from("vibode_room_assets")
    .select("thumbnail_storage_path")
    .eq("id", thumb.assetId)
    .eq("room_id", thumb.roomId)
    .eq("user_id", thumb.userId)
    .eq("harmonize_job_id", thumb.jobId)
    .maybeSingle();
  if (error || !data || typeof data !== "object") return "failed";
  const path = text((data as Record<string, unknown>).thumbnail_storage_path);
  if (!path) return "missing";
  return "present";
}

function storageAlreadyExists(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("already") || normalized.includes("exists");
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isStatus(value: string): value is HarmonizeJobStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled";
}

function isHistoryState(value: string): value is HarmonizePublicationJob["historyState"] {
  return value === "pending" || value === "published" || value === "unavailable";
}
