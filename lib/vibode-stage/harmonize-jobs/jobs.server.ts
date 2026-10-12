import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { validatePersistedSceneObjects } from "@/lib/afc-v2-runtime/persisted-scene";

import { planHarmonizeEnqueue, readHarmonizeEnqueueIds } from "./plan";
import {
  HARMONIZE_COMPOSITE_MAX_BYTES,
  VIBODE_HARMONIZE_BUCKET,
  harmonizeCompositePath,
  harmonizeOutputPath,
  harmonizePromptPath,
} from "./policy";
import { assessHarmonizeJobOutput } from "./output";
import { redactHarmonizeDiagnostic } from "./redaction";
import { harmonizeStatusFromRecord } from "./status";
import type { HarmonizeJobInsert, HarmonizeJobStatusView } from "./types";
import { harmonizeSceneProductIds, harmonizeTrustedRoomFromRecords } from "./trust-records";
import type { HarmonizeWorkerClaim } from "./worker-api";

type ServiceClient = SupabaseClient;

export async function createHarmonizeCompositeUpload(input: Readonly<{
  userId: string;
  email: string | null;
  roomId: string;
  sourceVersionId: string;
  idempotencyKey: string;
  byteLength: number;
}>): Promise<
  | Readonly<{ ok: true; signedUrl: string; token: string; path: string }>
  | Readonly<{ ok: false; code: string }>
> {
  if (!Number.isInteger(input.byteLength) || input.byteLength < 1) {
    return { ok: false, code: "invalid_submission" };
  }
  if (input.byteLength > HARMONIZE_COMPOSITE_MAX_BYTES) {
    return { ok: false, code: "composite_too_large" };
  }
  const ids = readHarmonizeEnqueueIds({
    roomId: input.roomId,
    sourceVersionId: input.sourceVersionId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!ids) return { ok: false, code: "invalid_submission" };
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, code: "unavailable" };
  const owned = await assertRoomAndSource(supabase, input.userId, ids.roomId, ids.sourceVersionId);
  if (!owned.ok) return owned;
  const capacity = await assertCapacity(supabase, input.userId);
  if (!capacity.ok) return capacity;
  const path = harmonizeCompositePath(ids.roomId, input.userId, ids.idempotencyKey);
  const { data, error } = await supabase.storage.from(VIBODE_HARMONIZE_BUCKET).createSignedUploadUrl(path, {
    upsert: true,
  });
  if (error || !data?.signedUrl || !data.token) return { ok: false, code: "unavailable" };
  return { ok: true, signedUrl: data.signedUrl, token: data.token, path: data.path || path };
}

export async function enqueueHarmonizeGeneration(input: Readonly<{
  userId: string;
  email: string | null;
  submission: unknown;
}>): Promise<
  | Readonly<{ ok: true; jobId: string; status: string; created: boolean }>
  | Readonly<{ ok: false; code: string }>
> {
  const ids = readHarmonizeEnqueueIds(input.submission);
  if (!ids) return { ok: false, code: "invalid_submission" };
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, code: "unavailable" };
  const path = harmonizeCompositePath(ids.roomId, input.userId, ids.idempotencyKey);
  const downloaded = await downloadObject(supabase, VIBODE_HARMONIZE_BUCKET, path);
  if (!downloaded) return { ok: false, code: "invalid_composite" };
  const planned = await planHarmonizeEnqueue({
    actor: { userId: input.userId, email: input.email },
    submission: input.submission,
    composite: downloaded,
    loadTrusted: (roomId, sourceVersionId) => loadTrustedRoom(supabase, input.userId, roomId, sourceVersionId),
  });
  if (!planned.ok) return planned;
  const committed = await callRpc(supabase, "enqueue_vibode_harmonize_generation", {
    p_user_id: input.userId,
    p_payload: enqueuePayload(planned.insert),
  });
  if (!committed.ok) return committed;
  const jobId = text(committed.row.jobId);
  const status = text(committed.row.status);
  if (!jobId || !status) return { ok: false, code: "unavailable" };
  if (committed.row.created === true) {
    await archivePrompt(supabase, planned.insert, jobId);
  }
  return { ok: true, jobId, status, created: committed.row.created === true };
}

export async function readHarmonizeGenerationStatus(input: Readonly<{
  userId: string;
  jobId: string;
}>): Promise<HarmonizeJobStatusView | null> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase || !/^[0-9a-f-]{36}$/i.test(input.jobId)) return null;
  const { data, error } = await supabase
    .from("vibode_harmonize_generations")
    .select("id, status, failure_code, failure_message, output_width, output_height, output_mime, output_sha256, provider_started_at, created_at, completed_at, requested_model_id, returned_model_id, latency_ms, provider_http_status, provider_status, user_id")
    .eq("id", input.jobId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error || !data || typeof data !== "object") return null;
  return harmonizeStatusFromRecord(data as Record<string, unknown>);
}

export async function readHarmonizeGenerationOutput(input: Readonly<{
  userId: string;
  jobId: string;
}>): Promise<Uint8Array | null> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase || !/^[0-9a-f-]{36}$/i.test(input.jobId)) return null;
  const { data, error } = await supabase
    .from("vibode_harmonize_generations")
    .select("status, output_bucket, output_path, user_id")
    .eq("id", input.jobId)
    .eq("user_id", input.userId)
    .eq("status", "succeeded")
    .maybeSingle();
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const bucket = text(row.output_bucket);
  const path = text(row.output_path);
  if (!bucket || !path || path.includes("..")) return null;
  return downloadObject(supabase, bucket, path);
}

export async function claimHarmonizeGeneration(): Promise<
  | Readonly<{ ok: true; job: HarmonizeWorkerClaim | null }>
  | Readonly<{ ok: false; code: string }>
> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, code: "unavailable" };
  const claimed = await callRpc(supabase, "claim_next_vibode_harmonize_generation", {});
  if (!claimed.ok) return claimed;
  if (claimed.row.job == null) return { ok: true, job: null };
  const job = workerClaim(claimed.row.job);
  if (!job) return { ok: false, code: "unavailable" };
  return { ok: true, job };
}

export async function heartbeatHarmonizeGeneration(jobId: string, claimNonce: string): Promise<boolean> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return false;
  const beat = await callRpc(supabase, "heartbeat_vibode_harmonize_generation", {
    p_job_id: jobId,
    p_claim_nonce: claimNonce,
  });
  return beat.ok;
}

export async function contactHarmonizeGeneration(jobId: string, claimNonce: string): Promise<
  | Readonly<{ ok: true; attemptId: string }>
  | Readonly<{ ok: false; code: string }>
> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, code: "unavailable" };
  const contact = await callRpc(supabase, "contact_vibode_harmonize_generation", {
    p_job_id: jobId,
    p_claim_nonce: claimNonce,
  });
  if (!contact.ok) return contact;
  const attemptId = text(contact.row.attemptId);
  if (!attemptId) return { ok: false, code: "unavailable" };
  return { ok: true, attemptId };
}

export async function readHarmonizeComposite(jobId: string, claimNonce: string): Promise<Uint8Array | null> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("vibode_harmonize_generations")
    .select("composite_bucket, composite_path, status, claim_expires_at")
    .eq("id", jobId)
    .eq("claim_nonce", claimNonce)
    .eq("status", "running")
    .maybeSingle();
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const expires = typeof row.claim_expires_at === "string" ? Date.parse(row.claim_expires_at) : Number.NaN;
  if (!Number.isFinite(expires) || expires <= Date.now()) return null;
  const bucket = text(row.composite_bucket);
  const path = text(row.composite_path);
  if (!bucket || !path || path.includes("..")) return null;
  return downloadObject(supabase, bucket, path);
}

export async function completeHarmonizeGeneration(input: Readonly<{
  jobId: string;
  claimNonce: string;
  output: Uint8Array;
  returnedModelId: string | null;
  providerStatus: string | null;
  providerHttpStatus: number | null;
  latencyMs: number;
}>): Promise<Readonly<{ ok: true; code: string }> | Readonly<{ ok: false; code: string }>> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, code: "unavailable" };
  const { data, error } = await supabase
    .from("vibode_harmonize_generations")
    .select("room_id, composite_width, composite_height, status, claim_expires_at")
    .eq("id", input.jobId)
    .eq("claim_nonce", input.claimNonce)
    .eq("status", "running")
    .maybeSingle();
  if (error || !data || typeof data !== "object") return { ok: false, code: "stale_claim" };
  const row = data as Record<string, unknown>;
  const roomId = text(row.room_id);
  const width = typeof row.composite_width === "number" ? row.composite_width : 0;
  const height = typeof row.composite_height === "number" ? row.composite_height : 0;
  const assessed = await assessHarmonizeJobOutput(input.output, width, height);
  if (!assessed.ok || !roomId) return { ok: false, code: "unexpected_output" };
  const path = harmonizeOutputPath(roomId, input.jobId, input.claimNonce);
  const uploaded = await supabase.storage.from(VIBODE_HARMONIZE_BUCKET).upload(path, Buffer.from(input.output), {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (uploaded.error && !storageAlreadyExists(uploaded.error.message)) {
    return { ok: false, code: "unavailable" };
  }
  return callRpc(supabase, "complete_vibode_harmonize_generation", {
    p_job_id: input.jobId,
    p_claim_nonce: input.claimNonce,
    p_output_sha256: assessed.sha256,
    p_output_path: path,
    p_returned_model: input.returnedModelId,
    p_provider_status: input.providerStatus,
    p_provider_http_status: input.providerHttpStatus,
    p_latency_ms: input.latencyMs,
    p_output_width: assessed.width,
    p_output_height: assessed.height,
  }).then((result) => {
    if (!result.ok) return result;
    return { ok: true as const, code: text(result.row.code) || "completed" };
  });
}

export async function failHarmonizeGeneration(input: Readonly<{
  jobId: string;
  claimNonce: string;
  code: string;
  message: string;
  retryable: boolean;
  providerStatus?: string | null;
  providerHttpStatus?: number | null;
  latencyMs?: number | null;
}>): Promise<Readonly<{ ok: true; code: string }> | Readonly<{ ok: false; code: string }>> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, code: "unavailable" };
  const failed = await callRpc(supabase, "fail_vibode_harmonize_generation", {
    p_job_id: input.jobId,
    p_claim_nonce: input.claimNonce,
    p_code: input.code,
    p_message: redactHarmonizeDiagnostic(input.message),
    p_retryable: input.retryable,
    p_provider_status: input.providerStatus ?? null,
    p_provider_http_status: input.providerHttpStatus ?? null,
    p_latency_ms: input.latencyMs ?? null,
  });
  if (!failed.ok) return failed;
  return { ok: true, code: text(failed.row.code) || "failed" };
}

async function loadTrustedRoom(
  supabase: ServiceClient,
  userId: string,
  roomId: string,
  sourceVersionId: string,
) {
  const room = await maybeOne(supabase, "vibode_rooms", "id, user_id, current_afc_generation_id, room_scale_multiplier", {
    id: roomId,
  });
  if (!room) return { ok: false as const, code: "not_found" as const };
  const source = await maybeOne(supabase, "vibode_room_assets", "id, room_id, user_id, storage_bucket, storage_path", {
    id: sourceVersionId,
  });
  const background = source
    ? await downloadObject(supabase, text(source.storage_bucket), text(source.storage_path))
    : null;
  const scene = await maybeOne(supabase, "vibode_3d_scenes", "afc_generation_id, objects_json", {
    room_id: roomId,
    version_id: sourceVersionId,
  });
  const generationId = text(room.current_afc_generation_id);
  const generation = generationId
    ? await maybeOne(supabase, "vibode_afc_generations", "id, room_id, user_id, status, production_authority", {
        id: generationId,
      })
    : null;
  const parsedObjects = scene ? validatePersistedSceneObjects(scene.objects_json) : null;
  const ids = parsedObjects?.ok ? harmonizeSceneProductIds(parsedObjects.objects) : { productIds: [], variantIds: [] };
  const products = ids.productIds.length === 0
    ? []
    : await many(supabase, "vibode_stage_products", "product_id, name, primary_material, secondary_material", "product_id", ids.productIds);
  const variants = ids.variantIds.length === 0
    ? []
    : await many(supabase, "vibode_stage_variants", "variant_id, product_id, finish_label, primary_material, secondary_material", "variant_id", ids.variantIds);
  if (products == null || variants == null) return { ok: false as const, code: "catalog_unavailable" as const };
  return harmonizeTrustedRoomFromRecords({
    userId,
    roomId,
    sourceVersionId,
    room,
    source,
    background,
    scene,
    generation,
    products,
    variants,
  });
}

async function assertRoomAndSource(
  supabase: ServiceClient,
  userId: string,
  roomId: string,
  sourceVersionId: string,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: string }>> {
  const room = await maybeOne(supabase, "vibode_rooms", "id, user_id", { id: roomId });
  if (!room || text(room.user_id) !== userId) return { ok: false, code: "not_found" };
  const source = await maybeOne(supabase, "vibode_room_assets", "id, room_id, user_id", { id: sourceVersionId });
  if (!source || text(source.user_id) !== userId || text(source.room_id) !== roomId) {
    return { ok: false, code: "source_version_not_found" };
  }
  return { ok: true };
}

async function assertCapacity(
  supabase: ServiceClient,
  userId: string,
): Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; code: string }>> {
  const active = await supabase
    .from("vibode_harmonize_generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["queued", "running"]);
  if (active.error) return { ok: false, code: "unavailable" };
  if ((active.count ?? 0) > 0) return { ok: false, code: "active_job" };
  const { data, error } = await supabase.rpc("vibode_harmonize_provider_started_count", { p_user_id: userId });
  if (error || typeof data !== "number") return { ok: false, code: "unavailable" };
  if (data >= 10) return { ok: false, code: "daily_limit" };
  return { ok: true };
}

async function archivePrompt(supabase: ServiceClient, insert: HarmonizeJobInsert, jobId: string): Promise<void> {
  const path = harmonizePromptPath(insert.roomId, jobId);
  const uploaded = await supabase.storage.from(VIBODE_HARMONIZE_BUCKET).upload(
    path,
    Buffer.from(insert.snapshot.prompt),
    { contentType: "text/plain", upsert: false },
  );
  if (uploaded.error) {
    console.error("[vibode-harmonize] prompt archive failed", { jobId });
    return;
  }
  const { error } = await supabase
    .from("vibode_harmonize_generations")
    .update({ prompt_path: path })
    .eq("id", jobId)
    .eq("user_id", insert.userId)
    .is("prompt_path", null);
  if (error) console.error("[vibode-harmonize] prompt path failed", { jobId });
}

function enqueuePayload(insert: HarmonizeJobInsert): Record<string, unknown> {
  return {
    roomId: insert.roomId,
    sourceVersionId: insert.sourceVersionId,
    idempotencyKey: insert.idempotencyKey,
    requestSha256: insert.requestSha256,
    sceneSnapshotSha256: insert.sceneSnapshotSha256,
    backgroundSha256: insert.backgroundSha256,
    compositeSha256: insert.compositeSha256,
    promptSha256: insert.promptSha256,
    promptVersion: insert.promptVersion,
    assemblyVersion: insert.assemblyVersion,
    afcGenerationId: insert.afcGenerationId,
    snapshot: insert.snapshot,
    compositePath: insert.compositePath,
    compositeByteLength: insert.compositeByteLength,
    compositeWidth: insert.compositeWidth,
    compositeHeight: insert.compositeHeight,
  };
}

async function maybeOne(
  supabase: ServiceClient,
  table: string,
  columns: string,
  filters: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  let query = supabase.from(table).select(columns);
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const { data, error } = await query.maybeSingle();
  if (error || !data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

async function many(
  supabase: ServiceClient,
  table: string,
  columns: string,
  column: string,
  values: string[],
): Promise<unknown[] | null> {
  const { data, error } = await supabase.from(table).select(columns).in(column, values);
  if (error || !Array.isArray(data)) return null;
  return data;
}

async function downloadObject(
  supabase: ServiceClient,
  bucket: string,
  path: string,
): Promise<Uint8Array | null> {
  if (!bucket || !path || path.includes("..") || path.startsWith("/")) return null;
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function callRpc(
  supabase: ServiceClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<Readonly<{ ok: true; row: Record<string, unknown> }> | Readonly<{ ok: false; code: string }>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error("[vibode-harmonize] rpc failed", { fn });
    return { ok: false, code: "unavailable" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, code: "unavailable" };
  const row = data as Record<string, unknown>;
  if (row.ok === false) return { ok: false, code: typeof row.code === "string" ? row.code : "unavailable" };
  return { ok: true, row };
}

function workerClaim(value: unknown): HarmonizeWorkerClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const jobId = text(row.jobId);
  const roomId = text(row.roomId);
  const claimNonce = text(row.claimNonce);
  const prompt = typeof row.prompt === "string" ? row.prompt : "";
  const promptSha256 = text(row.promptSha256);
  const compositeSha256 = text(row.compositeSha256);
  const compositeWidth = typeof row.compositeWidth === "number" ? row.compositeWidth : 0;
  const compositeHeight = typeof row.compositeHeight === "number" ? row.compositeHeight : 0;
  const requestedModelId = text(row.requestedModelId);
  if (!jobId || !roomId || !claimNonce || !prompt || !promptSha256 || !compositeSha256 || !requestedModelId) {
    return null;
  }
  return {
    jobId,
    roomId,
    claimNonce,
    prompt,
    promptSha256,
    compositeSha256,
    compositeWidth,
    compositeHeight,
    requestedModelId,
  };
}

function storageAlreadyExists(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("already") || normalized.includes("exists");
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
