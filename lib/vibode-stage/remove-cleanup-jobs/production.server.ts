import type { SupabaseClient } from "@supabase/supabase-js";

import { safeCleanupObjectPath } from "./artifacts";
import type { CleanupArtifactStore } from "./artifacts";
import { VIBODE_CLEANUP_BUCKET } from "./policy";
import type { CleanupControl } from "./runtime";
import type {
  CleanupClaim,
  CleanupCompleteInput,
  CleanupCompleteResult,
  CleanupContactResult,
  CleanupDiscardResult,
  CleanupEnqueueResult,
  CleanupFailInput,
  CleanupFailResult,
  CleanupJobInsert,
  CleanupJobRow,
  CleanupRetryResult,
} from "./types";

type Row = Record<string, unknown>;

/**
 * Service-role adapter for the Clean Up RPCs and private bucket.
 * Browser roles cannot read the table or the bucket.
 */
export function createSupabaseCleanupControl(
  client: SupabaseClient,
  now: () => number = () => Date.now(),
): CleanupControl {
  const artifacts = createSupabaseCleanupArtifacts(client);
  return {
    now,
    artifacts,
    enqueue: (insert) => enqueueRpc(client, insert),
    readJob: async (userId, jobId) => readOne(client, { id: jobId, user_id: userId }),
    readRoom: async (userId, roomId) => readLatest(client, userId, roomId),
    discard: (userId, jobId) => discardRpc(client, userId, jobId),
    retry: (userId, jobId) => retryRpc(client, userId, jobId),
    claim: (jobId = null) => claimRpc(client, jobId),
    heartbeat: (jobId, claimNonce) => flagRpc(client, "heartbeat_vibode_cleanup_generation", jobId, claimNonce),
    contact: (jobId, claimNonce) => contactRpc(client, jobId, claimNonce),
    fail: (jobId, claimNonce, failure) => failRpc(client, jobId, claimNonce, failure),
    complete: (jobId, claimNonce, output) => completeRpc(client, "complete_vibode_cleanup_generation", jobId, claimNonce, output),
    settle: (jobId, output) => completeRpc(client, "settle_vibode_cleanup_candidate", jobId, null, output),
    recoverable: () => recoverableRpc(client),
  };
}

export function createSupabaseCleanupArtifacts(client: SupabaseClient): CleanupArtifactStore {
  const bucket = client.storage.from(VIBODE_CLEANUP_BUCKET);
  return {
    async put(path, bytes, contentType) {
      if (!safeCleanupObjectPath(path)) return "failed";
      const uploaded = await bucket.upload(path, Buffer.from(bytes), { contentType, upsert: false });
      return uploaded.error ? "failed" : "ok";
    },
    async get(path) {
      if (!safeCleanupObjectPath(path)) return null;
      const downloaded = await bucket.download(path);
      if (downloaded.error || !downloaded.data) return null;
      return new Uint8Array(await downloaded.data.arrayBuffer());
    },
    async remove(paths) {
      const safe = paths.filter((path) => safeCleanupObjectPath(path));
      if (safe.length === 0) return;
      await bucket.remove([...safe]);
    },
  };
}

async function enqueueRpc(client: SupabaseClient, insert: CleanupJobInsert): Promise<CleanupEnqueueResult> {
  const result = await call(client, "enqueue_vibode_cleanup_generation", {
    p_user_id: insert.userId,
    p_payload: insert,
  });
  if (!result.ok) return { ok: false, code: enqueueCode(result.code) };
  const job = jobFromRecord(record(result.row.job));
  if (!job) return { ok: false, code: "invalid_submission" };
  return { ok: true, created: result.row.created === true, job };
}

async function claimRpc(client: SupabaseClient, jobId: string | null): Promise<CleanupClaim | null> {
  const result = await call(client, "claim_next_vibode_cleanup_generation", { p_job_id: jobId });
  if (!result.ok) return null;
  return claimFromRecord(record(result.row.claim));
}

async function contactRpc(client: SupabaseClient, jobId: string, claimNonce: string): Promise<CleanupContactResult> {
  const result = await call(client, "contact_vibode_cleanup_generation", {
    p_job_id: jobId,
    p_claim_nonce: claimNonce,
  });
  if (!result.ok) return { ok: false, code: contactCode(result.code) };
  const attemptId = text(result.row.attemptId);
  return attemptId ? { ok: true, attemptId } : { ok: false, code: "stale_claim" };
}

async function completeRpc(
  client: SupabaseClient,
  fn: "complete_vibode_cleanup_generation" | "settle_vibode_cleanup_candidate",
  jobId: string,
  claimNonce: string | null,
  output: CleanupCompleteInput,
): Promise<CleanupCompleteResult> {
  const result = await call(client, fn, {
    p_job_id: jobId,
    p_claim_nonce: claimNonce,
    p_output: output,
  });
  if (!result.ok) return { ok: false, code: completeCode(result.code) };
  const code = result.row.code === "already_complete" ? "already_complete" : "completed";
  return { ok: true, code };
}

async function failRpc(
  client: SupabaseClient,
  jobId: string,
  claimNonce: string,
  failure: CleanupFailInput,
): Promise<CleanupFailResult> {
  const result = await call(client, "fail_vibode_cleanup_generation", {
    p_job_id: jobId,
    p_claim_nonce: claimNonce,
    p_code: failure.code,
    p_message: failure.message,
    p_retryable: failure.retryable,
    p_provider_status: failure.providerStatus ?? null,
    p_provider_http_status: failure.providerHttpStatus ?? null,
    p_latency_ms: failure.latencyMs ?? null,
  });
  if (!result.ok) return { ok: false, code: result.code === "terminal" ? "terminal" : "stale_claim" };
  return { ok: true, disposition: result.row.disposition === "requeued" ? "requeued" : "failed" };
}

async function discardRpc(client: SupabaseClient, userId: string, jobId: string): Promise<CleanupDiscardResult> {
  const result = await call(client, "discard_vibode_cleanup_generation", {
    p_user_id: userId,
    p_job_id: jobId,
  });
  if (!result.ok) return { ok: false, code: "not_found" };
  const job = jobFromRecord(record(result.row.job));
  if (!job) return { ok: false, code: "not_found" };
  const effect = result.row.effect === "cancelled" || result.row.effect === "already" ? result.row.effect : "marked";
  return { ok: true, job, effect };
}

async function retryRpc(client: SupabaseClient, userId: string, jobId: string): Promise<CleanupRetryResult> {
  const result = await call(client, "retry_vibode_cleanup_generation", {
    p_user_id: userId,
    p_job_id: jobId,
  });
  if (!result.ok) return { ok: false, code: retryCode(result.code) };
  const job = jobFromRecord(record(result.row.job));
  if (!job) return { ok: false, code: "not_found" };
  return { ok: true, created: result.row.created === true, job };
}

async function recoverableRpc(client: SupabaseClient): Promise<CleanupJobRow[]> {
  const result = await call(client, "list_recoverable_vibode_cleanup_generations", {});
  if (!result.ok || !Array.isArray(result.row.jobs)) return [];
  return result.row.jobs.flatMap((entry) => {
    const job = jobFromRecord(record(entry));
    return job ? [job] : [];
  });
}

async function flagRpc(client: SupabaseClient, fn: string, jobId: string, claimNonce: string): Promise<boolean> {
  const result = await call(client, fn, { p_job_id: jobId, p_claim_nonce: claimNonce });
  return result.ok;
}

async function readOne(client: SupabaseClient, filters: Record<string, string>): Promise<CleanupJobRow | null> {
  let query = client.from("vibode_cleanup_generations").select("*");
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return jobFromRecord(record(data));
}

async function readLatest(client: SupabaseClient, userId: string, roomId: string): Promise<CleanupJobRow | null> {
  const { data, error } = await client
    .from("vibode_cleanup_generations")
    .select("*")
    .eq("user_id", userId)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !Array.isArray(data)) return null;
  const jobs = data.flatMap((entry) => {
    const job = jobFromRecord(record(entry));
    return job ? [job] : [];
  });
  return jobs.find((job) => job.status === "queued" || job.status === "running") ?? jobs[0] ?? null;
}

async function call(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<Readonly<{ ok: true; row: Row }> | Readonly<{ ok: false; code: string }>> {
  const { data, error } = await client.rpc(fn, args);
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    console.error("[vibode-cleanup] rpc failed", { fn });
    return { ok: false, code: "unavailable" };
  }
  const row = data as Row;
  if (row.ok === false) return { ok: false, code: text(row.code) ?? "unavailable" };
  return { ok: true, row };
}

function jobFromRecord(row: Row | null): CleanupJobRow | null {
  if (!row) return null;
  const id = text(row.id);
  const userId = text(row.user_id);
  const roomId = text(row.room_id);
  const status = text(row.status);
  if (!id || !userId || !roomId || !status) return null;
  if (status !== "queued" && status !== "running" && status !== "succeeded" && status !== "failed" && status !== "cancelled") {
    return null;
  }
  return {
    id,
    userId,
    roomId,
    afcGenerationId: text(row.afc_generation_id) ?? "",
    paidRequestFingerprint: text(row.paid_request_fingerprint) ?? "",
    inputFingerprint: text(row.input_fingerprint) ?? "",
    status,
    hiddenObjectCount: numberValue(row.hidden_object_count) ?? 0,
    hiddenConcepts: stringList(row.hidden_concepts),
    selection: selectionList(row.selection_summary),
    originalSha256: text(row.original_sha256) ?? "",
    originalMime: mime(row.original_mime),
    originalByteCount: numberValue(row.original_byte_count) ?? 0,
    originalWidth: numberValue(row.original_width) ?? 0,
    originalHeight: numberValue(row.original_height) ?? 0,
    overlaySha256: text(row.overlay_sha256) ?? "",
    promptSha256: text(row.prompt_sha256) ?? "",
    promptVersion: text(row.prompt_version) ?? "",
    maskManifestSha256: text(row.mask_manifest_sha256) ?? "",
    aspectRatioFamily: aspect(row.aspect_ratio_family),
    documented1kGridWidth: numberValue(row.documented_1k_grid_width) ?? 0,
    documented1kGridHeight: numberValue(row.documented_1k_grid_height) ?? 0,
    resolutionClass: "2K",
    outputMime: "image/jpeg",
    provider: "google-gemini-interactions",
    requestedModelId: "gemini-3-pro-image",
    artifactBucket: "vibode-cleanup",
    originalPath: text(row.original_path) ?? "",
    overlayPath: text(row.overlay_path) ?? "",
    promptPath: text(row.prompt_path) ?? "",
    masksPath: text(row.masks_path) ?? "",
    outputPath: text(row.output_path),
    outputSha256: text(row.output_sha256),
    outputWidth: numberValue(row.output_width),
    outputHeight: numberValue(row.output_height),
    returnedModelId: text(row.returned_model_id),
    interactionId: text(row.interaction_id),
    usage: usage(row.usage),
    stageRegistration: "not-assessed",
    providerStartedAtMs: millis(row.provider_started_at),
    providerAttemptId: text(row.provider_attempt_id),
    claimNonce: text(row.claim_nonce),
    claimExpiresAtMs: millis(row.claim_expires_at),
    claimedAtMs: millis(row.claimed_at),
    heartbeatAtMs: millis(row.heartbeat_at),
    attemptCount: numberValue(row.attempt_count) ?? 0,
    failureCode: text(row.failure_code),
    failureMessage: text(row.failure_message),
    providerStatus: text(row.provider_status),
    providerHttpStatus: numberValue(row.provider_http_status),
    latencyMs: numberValue(row.latency_ms),
    discardedAtMs: millis(row.discarded_at),
    retryOfJobId: text(row.retry_of_job_id),
    retryOrdinal: numberValue(row.retry_ordinal) ?? 0,
    notBeforeMs: millis(row.not_before) ?? 0,
    createdAtMs: millis(row.created_at) ?? 0,
    updatedAtMs: millis(row.updated_at) ?? 0,
    completedAtMs: millis(row.completed_at),
  };
}

function claimFromRecord(row: Row | null): CleanupClaim | null {
  if (!row || !text(row.claimNonce) || !text(row.jobId) || !text(row.userId) || !text(row.roomId)) return null;
  const family = aspect(row.aspectRatioFamily);
  if (family !== row.aspectRatioFamily) return null;
  return {
    jobId: text(row.jobId) ?? "",
    userId: text(row.userId) ?? "",
    roomId: text(row.roomId) ?? "",
    claimNonce: text(row.claimNonce) ?? "",
    claimExpiresAtMs: numberValue(row.claimExpiresAtMs) ?? 0,
    attemptCount: numberValue(row.attemptCount) ?? 0,
    afcGenerationId: text(row.afcGenerationId) ?? "",
    inputFingerprint: text(row.inputFingerprint) ?? "",
    paidRequestFingerprint: text(row.paidRequestFingerprint) ?? "",
    aspectRatioFamily: aspect(row.aspectRatioFamily),
    documented1kGridWidth: numberValue(row.documented1kGridWidth) ?? 0,
    documented1kGridHeight: numberValue(row.documented1kGridHeight) ?? 0,
    originalSha256: text(row.originalSha256) ?? "",
    originalMime: mime(row.originalMime),
    originalWidth: numberValue(row.originalWidth) ?? 0,
    originalHeight: numberValue(row.originalHeight) ?? 0,
    overlaySha256: text(row.overlaySha256) ?? "",
    promptSha256: text(row.promptSha256) ?? "",
    promptVersion: text(row.promptVersion) ?? "",
    maskManifestSha256: text(row.maskManifestSha256) ?? "",
    originalPath: text(row.originalPath) ?? "",
    overlayPath: text(row.overlayPath) ?? "",
    promptPath: text(row.promptPath) ?? "",
    masksPath: text(row.masksPath) ?? "",
    selection: selectionList(row.selection),
  };
}

function enqueueCode(code: string): Extract<CleanupEnqueueResult, { ok: false }>["code"] {
  if (
    code === "not_found"
    || code === "stale_generation"
    || code === "active_job"
    || code === "daily_limit"
    || code === "global_daily_limit"
    || code === "idempotency_conflict"
  ) return code;
  return "invalid_submission";
}

function retryCode(code: string): Extract<CleanupRetryResult, { ok: false }>["code"] {
  if (
    code === "not_found"
    || code === "not_failed"
    || code === "active_job"
    || code === "daily_limit"
    || code === "global_daily_limit"
  ) return code;
  return "not_found";
}

function contactCode(code: string): Extract<CleanupContactResult, { ok: false }>["code"] {
  if (code === "already_contacted" || code === "daily_limit" || code === "global_daily_limit") return code;
  return "stale_claim";
}

function completeCode(code: string): Extract<CleanupCompleteResult, { ok: false }>["code"] {
  if (code === "not_contacted" || code === "unexpected_output" || code === "terminal") return code;
  return "stale_claim";
}

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function millis(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function selectionList(value: unknown): CleanupJobRow["selection"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const id = text(row?.id);
    const concept = text(row?.concept);
    const maskSha256 = text(row?.maskSha256) ?? text(row?.mask_sha256);
    return id && concept && maskSha256 ? [{ id, concept, maskSha256 }] : [];
  });
}

function usage(value: unknown): Record<string, number> | null {
  const row = record(value);
  if (!row) return null;
  const next: Record<string, number> = {};
  for (const [key, entry] of Object.entries(row)) {
    if (typeof entry === "number" && Number.isFinite(entry)) next[key] = entry;
  }
  return Object.keys(next).length > 0 ? next : null;
}

function mime(value: unknown): CleanupJobRow["originalMime"] {
  return value === "image/jpeg" || value === "image/webp" ? value : "image/png";
}

function aspect(value: unknown): CleanupJobRow["aspectRatioFamily"] {
  const allowed = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
  return allowed.find((family) => family === value) ?? "1:1";
}
