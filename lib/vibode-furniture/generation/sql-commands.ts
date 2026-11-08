/**
 * SQL-backed generation commands. The caller supplies the RPC transport.
 * service_role is the only database role that can execute these functions.
 */

import { isPersonalFurnitureAssetId } from "@/lib/vibode-furniture/asset-id";
import type { FurnitureViewSlot } from "@/lib/vibode-furniture/generator/images";

import type { MeshyGenerationOperation } from "./credits";
import type {
  ClaimedGeneration,
  GenerationCommands,
  GenerationCommandResult,
  GenerationSaveSource,
  OperatorGenerationJob,
  PublicGenerationJob,
  StoredGenerationInput,
  TemporaryGenerationObject,
} from "./contracts";
import type { GenerationStatus } from "./engine";
import { generationObjectAllowed } from "./objects";
import { generationCandidateStillPreviewable } from "./preview-access";
import { furnitureSettingsFromJson, furnitureSlotsFromJson } from "./settings-json";

export const GENERATION_RPC_ARGUMENTS = {
  read_vibode_furniture_generation_controls: [],
  reserve_vibode_furniture_generation: [
    "p_user_id",
    "p_job_id",
    "p_idempotency_key",
    "p_request_sha256",
    "p_operation",
    "p_ai_model",
    "p_settings",
    "p_image_slots",
    "p_reserved_credits",
  ],
  attach_vibode_furniture_generation_input: [
    "p_user_id",
    "p_job_id",
    "p_slot",
    "p_mime_type",
    "p_byte_size",
    "p_width_px",
    "p_height_px",
    "p_sha256",
  ],
  fail_vibode_furniture_generation_before_provider: ["p_user_id", "p_job_id"],
  read_vibode_furniture_generation: ["p_user_id", "p_job_id"],
  discard_vibode_furniture_generation_candidate: ["p_user_id", "p_job_id"],
  admin_authorize_vibode_furniture_generation_resubmit: ["p_job_id", "p_duplicate_charge_risk_accepted"],
  claim_next_vibode_furniture_generation: ["p_submit_allowed"],
  read_vibode_furniture_generation_inputs: ["p_user_id", "p_job_id"],
  bind_vibode_furniture_generation_task: [
    "p_user_id",
    "p_job_id",
    "p_claim_nonce",
    "p_provider_task_id",
    "p_provider_status",
  ],
  mark_vibode_furniture_generation_ambiguous: ["p_user_id", "p_job_id", "p_claim_nonce", "p_error_code"],
  fail_vibode_furniture_generation_create: ["p_user_id", "p_job_id", "p_claim_nonce", "p_error_class", "p_error_code"],
  settle_vibode_furniture_generation_rate_limit: ["p_user_id", "p_job_id", "p_claim_nonce"],
  drop_vibode_furniture_generation_claim: ["p_user_id", "p_job_id", "p_claim_nonce"],
  mark_vibode_furniture_generation_needs_review: ["p_user_id", "p_job_id", "p_claim_nonce", "p_reason"],
  apply_vibode_furniture_generation_observation: [
    "p_user_id",
    "p_job_id",
    "p_claim_nonce",
    "p_provider_status",
    "p_progress",
    "p_consumed_credits",
    "p_error_code",
  ],
  record_vibode_furniture_generation_output: ["p_user_id", "p_job_id", "p_claim_nonce", "p_byte_size", "p_sha256"],
  fail_vibode_furniture_generation_output: ["p_user_id", "p_job_id", "p_claim_nonce", "p_error_class"],
  read_vibode_furniture_generation_save_source: ["p_user_id", "p_job_id"],
  link_vibode_furniture_generation_saved_asset: [
    "p_user_id",
    "p_job_id",
    "p_asset_id",
    "p_source_sha256",
    "p_source_byte_size",
    "p_asset_sha256",
    "p_asset_byte_size",
  ],
  grant_vibode_furniture_generation_paid_submission: ["p_acknowledge"],
  read_vibode_furniture_generation_operator: ["p_job_id"],
  sweep_vibode_furniture_generation_holds: [],
  list_vibode_furniture_generation_temporary_objects: ["p_limit"],
  mark_vibode_furniture_generation_temporary_object_purged: ["p_kind", "p_job_id", "p_slot"],
} as const;

export type GenerationRpcName = keyof typeof GENERATION_RPC_ARGUMENTS;

export type PositionalGenerationRpc = (
  fn: GenerationRpcName,
  values: readonly unknown[],
) => Promise<unknown>;

const STATUSES = new Set<GenerationStatus>([
  "reserved",
  "submitting",
  "ambiguous",
  "running",
  "ingesting",
  "ready",
  "needs_review",
  "failed",
  "saved",
  "discarded",
  "expired",
  "cancelled",
]);

export function createSqlGenerationCommands(rpc: PositionalGenerationRpc): GenerationCommands {
  return {
    async controls() {
      const row = await rpc("read_vibode_furniture_generation_controls", []);
      const data = asRecord(row);
      return { liveEnabled: data?.live_enabled === true };
    },
    async reserve(input) {
      const data = asRecord(await rpc("reserve_vibode_furniture_generation", [
        input.userId,
        input.jobId,
        input.idempotencyKey,
        input.requestSha256,
        input.operation,
        "meshy-7.1",
        input.settings,
        [...input.imageSlots],
        input.reservedCredits,
      ]));
      if (!data || data.ok !== true) return fail(data);
      const job = publicFromReserve(data);
      if (!job) return { ok: false, code: "unavailable" };
      return { ok: true, created: data.created === true, job };
    },
    async attachInput(input) {
      const data = asRecord(await rpc("attach_vibode_furniture_generation_input", [
        input.userId,
        input.jobId,
        input.slot,
        input.mimeType,
        input.byteSize,
        input.widthPx,
        input.heightPx,
        input.sha256,
      ]));
      if (!data || data.ok !== true) return fail(data);
      return { ok: true };
    },
    async failBeforeProvider(input) {
      await rpc("fail_vibode_furniture_generation_before_provider", [input.userId, input.jobId]);
    },
    async readOwner(userId, jobId) {
      const data = asRecord(await rpc("read_vibode_furniture_generation", [userId, jobId]));
      if (!data || data.ok !== true) return fail(data);
      const job = publicFromRead(data);
      if (!job) return { ok: false, code: "not_found" };
      return { ok: true, job };
    },
    async previewSource(userId, jobId) {
      const data = asRecord(await rpc("read_vibode_furniture_generation", [userId, jobId]));
      if (!data || data.ok !== true || data.status !== "ready") return { ok: false, code: "not_found" };
      const bucket = typeof data.output_bucket === "string" ? data.output_bucket : "";
      const path = typeof data.output_object_path === "string" ? data.output_object_path : "";
      if (!generationObjectAllowed(bucket, path, userId)) return { ok: false, code: "not_found" };
      const expiresAtMs = typeof data.output_expires_at === "string" ? Date.parse(data.output_expires_at) : Number.NaN;
      if (!generationCandidateStillPreviewable(Number.isFinite(expiresAtMs) ? expiresAtMs : null, Date.now())) {
        return { ok: false, code: "not_found" };
      }
      return { ok: true, bucket, path };
    },
    async readSaveSource(userId, jobId) {
      const data = asRecord(await rpc("read_vibode_furniture_generation_save_source", [userId, jobId]));
      if (!data || data.ok !== true) return fail(data);
      return saveSourceFrom(data, userId);
    },
    async linkSavedAsset(input) {
      const data = asRecord(await rpc("link_vibode_furniture_generation_saved_asset", [
        input.userId,
        input.jobId,
        input.assetId,
        input.sourceSha256,
        input.sourceByteSize,
        input.assetSha256,
        input.assetByteSize,
      ]));
      if (!data || data.ok !== true || data.status !== "saved") return fail(data);
      return { ok: true, status: "saved", idempotent: data.idempotent === true };
    },
    async discard(input) {
      const data = asRecord(await rpc("discard_vibode_furniture_generation_candidate", [input.userId, input.jobId]));
      if (!data || data.ok !== true || typeof data.status !== "string") return fail(data);
      return { ok: true, status: data.status, providerCreditsRefunded: false };
    },
    async adminAuthorize(jobId, duplicateChargeRiskAccepted) {
      const data = asRecord(await rpc("admin_authorize_vibode_furniture_generation_resubmit", [
        jobId,
        duplicateChargeRiskAccepted,
      ]));
      if (!data || data.ok !== true || data.duplicate_charge_risk !== true) return fail(data);
      return { ok: true, status: "reserved", duplicateChargeRisk: true };
    },
    async claimNext(submitAllowed) {
      const data = asRecord(await rpc("claim_next_vibode_furniture_generation", [submitAllowed]));
      if (!data || data.ok !== true) return fail(data);
      if (data.outcome === "idle" || data.outcome === "disabled") return { ok: true, outcome: data.outcome };
      if (data.outcome !== "claimed") return { ok: false, code: "unavailable" };
      const claim = claimedFrom(data);
      if (!claim) return { ok: false, code: "not_claimable" };
      return { ok: true, outcome: "claimed", claim };
    },
    async listInputs(userId, jobId) {
      const data = asRecord(await rpc("read_vibode_furniture_generation_inputs", [userId, jobId]));
      if (!data || data.ok !== true || !Array.isArray(data.inputs)) return [];
      const inputs: StoredGenerationInput[] = [];
      for (const item of data.inputs) {
        const parsed = inputFrom(item);
        if (parsed && generationObjectAllowed(parsed.bucket, parsed.path, userId)) inputs.push(parsed);
      }
      return inputs;
    },
    async bindTask(input) {
      return statusResult(await rpc("bind_vibode_furniture_generation_task", [
        input.userId,
        input.jobId,
        input.claimNonce,
        input.providerTaskId,
        input.providerStatus,
      ]));
    },
    async markAmbiguous(input) {
      return statusResult(await rpc("mark_vibode_furniture_generation_ambiguous", [
        input.userId,
        input.jobId,
        input.claimNonce,
        input.errorCode,
      ]));
    },
    async failCreate(input) {
      return statusResult(await rpc("fail_vibode_furniture_generation_create", [
        input.userId,
        input.jobId,
        input.claimNonce,
        input.errorClass,
        input.errorCode,
      ]));
    },
    async settleRateLimit(input) {
      return statusResult(await rpc("settle_vibode_furniture_generation_rate_limit", [
        input.userId,
        input.jobId,
        input.claimNonce,
      ]));
    },
    async dropClaim(input) {
      await rpc("drop_vibode_furniture_generation_claim", [input.userId, input.jobId, input.claimNonce]);
    },
    async markNeedsReview(input) {
      return statusResult(await rpc("mark_vibode_furniture_generation_needs_review", [
        input.userId,
        input.jobId,
        input.claimNonce,
        input.reason,
      ]));
    },
    async applyObservation(input) {
      const data = asRecord(await rpc("apply_vibode_furniture_generation_observation", [
        input.userId,
        input.jobId,
        input.claimNonce,
        input.providerStatus,
        input.progress,
        input.consumedCredits,
        input.errorCode,
      ]));
      if (!data || data.ok !== true || typeof data.status !== "string") return fail(data);
      return {
        ok: true,
        status: data.status,
        errorClass: typeof data.error_class === "string" ? data.error_class : null,
      };
    },
    async recordOutput(input) {
      return statusResult(await rpc("record_vibode_furniture_generation_output", [
        input.userId,
        input.jobId,
        input.claimNonce,
        input.byteSize,
        input.sha256,
      ]));
    },
    async failOutput(input) {
      return statusResult(await rpc("fail_vibode_furniture_generation_output", [
        input.userId,
        input.jobId,
        input.claimNonce,
        input.errorClass,
      ]));
    },
    async grantPaidSubmission(acknowledge) {
      const data = asRecord(await rpc("grant_vibode_furniture_generation_paid_submission", [acknowledge]));
      if (!data || data.ok !== true) return fail(data);
      if (typeof data.paid_submissions_authorized !== "number" || typeof data.paid_submissions_used !== "number") {
        return { ok: false, code: "unavailable" };
      }
      return {
        ok: true,
        authorized: data.paid_submissions_authorized,
        used: data.paid_submissions_used,
      };
    },
    async readOperator(jobId) {
      const data = asRecord(await rpc("read_vibode_furniture_generation_operator", [jobId]));
      if (!data || data.ok !== true) return fail(data);
      const job = operatorFrom(data);
      if (!job) return { ok: false, code: "unavailable" };
      return { ok: true, job };
    },
    async sweep() {
      await rpc("sweep_vibode_furniture_generation_holds", []);
    },
    async listTemporaryObjects(limit) {
      const data = asRecord(await rpc("list_vibode_furniture_generation_temporary_objects", [limit]));
      if (!data || data.ok !== true || !Array.isArray(data.objects)) return [];
      const objects: TemporaryGenerationObject[] = [];
      for (const item of data.objects) {
        const parsed = temporaryFrom(item);
        if (parsed) objects.push(parsed);
      }
      return objects;
    },
    async markTemporaryPurged(object) {
      const data = asRecord(await rpc("mark_vibode_furniture_generation_temporary_object_purged", [
        object.kind,
        object.jobId,
        object.slot,
      ]));
      return data?.ok === true;
    },
  };
}

function statusResult(value: unknown): GenerationCommandResult<{ status: string }> {
  const data = asRecord(value);
  if (!data || data.ok !== true || typeof data.status !== "string") return fail(data);
  return { ok: true, status: data.status };
}

function fail(data: Record<string, unknown> | null): { ok: false; code: string } {
  const code = data && typeof data.code === "string" ? data.code : "unavailable";
  return { ok: false, code };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function publicFromReserve(data: Record<string, unknown>): PublicGenerationJob | null {
  if (typeof data.job_id !== "string" || typeof data.status !== "string" || !STATUSES.has(data.status as GenerationStatus)) {
    return null;
  }
  return {
    jobId: data.job_id,
    status: data.status as GenerationStatus,
    progress: 0,
    errorClass: null,
    outputExpiresAt: null,
  };
}

function operatorFrom(data: Record<string, unknown>): OperatorGenerationJob | null {
  if (typeof data.job_id !== "string" || typeof data.status !== "string" || !STATUSES.has(data.status as GenerationStatus)) {
    return null;
  }
  if (typeof data.attempt_count !== "number" || typeof data.paid_submissions_authorized !== "number" || typeof data.paid_submissions_used !== "number") {
    return null;
  }
  return {
    jobId: data.job_id,
    status: data.status as GenerationStatus,
    progress: typeof data.progress === "number" ? data.progress : 0,
    errorClass: typeof data.error_class === "string" ? data.error_class : null,
    providerStatus: typeof data.provider_status === "string" ? data.provider_status : null,
    consumedCredits: typeof data.consumed_credits === "number" ? data.consumed_credits : null,
    quotaState: typeof data.quota_state === "string" ? data.quota_state : null,
    attemptCount: data.attempt_count,
    paidSubmissionsAuthorized: data.paid_submissions_authorized,
    paidSubmissionsUsed: data.paid_submissions_used,
  };
}

function saveSourceFrom(
  data: Record<string, unknown>,
  userId: string,
): GenerationCommandResult<GenerationSaveSource> {
  if (typeof data.status !== "string" || !STATUSES.has(data.status as GenerationStatus)) {
    return { ok: false, code: "unavailable" };
  }
  const savedAssetId = data.saved_asset_id == null ? null : data.saved_asset_id;
  if (savedAssetId != null && (typeof savedAssetId !== "string" || !isPersonalFurnitureAssetId(savedAssetId))) {
    return { ok: false, code: "unavailable" };
  }
  const bucket = data.output_bucket == null ? null : data.output_bucket;
  const path = data.output_object_path == null ? null : data.output_object_path;
  const sha256 = data.output_sha256 == null ? null : data.output_sha256;
  if (bucket != null && typeof bucket !== "string") return { ok: false, code: "unavailable" };
  if (path != null && typeof path !== "string") return { ok: false, code: "unavailable" };
  if (sha256 != null && (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))) {
    return { ok: false, code: "unavailable" };
  }
  const byteSize = data.output_byte_size == null ? null : integerAt(data.output_byte_size);
  if (data.output_byte_size != null && byteSize == null) return { ok: false, code: "unavailable" };
  const expiresAtMs = data.output_expires_at == null ? null : epoch(data.output_expires_at);
  if (data.output_expires_at != null && expiresAtMs == null) return { ok: false, code: "unavailable" };
  if (
    typeof bucket === "string"
    && typeof path === "string"
    && !generationObjectAllowed(bucket, path, userId)
  ) {
    return { ok: false, code: "not_found" };
  }
  return {
    ok: true,
    status: data.status as GenerationStatus,
    savedAssetId: typeof savedAssetId === "string" ? savedAssetId : null,
    bucket: typeof bucket === "string" ? bucket : null,
    path: typeof path === "string" ? path : null,
    sha256: typeof sha256 === "string" ? sha256 : null,
    byteSize,
    expiresAtMs,
  };
}

function publicFromRead(data: Record<string, unknown>): PublicGenerationJob | null {
  if (typeof data.job_id !== "string" || typeof data.status !== "string" || !STATUSES.has(data.status as GenerationStatus)) {
    return null;
  }
  return {
    jobId: data.job_id,
    status: data.status as GenerationStatus,
    progress: typeof data.progress === "number" ? data.progress : 0,
    errorClass: typeof data.error_class === "string" ? data.error_class : null,
    outputExpiresAt: typeof data.output_expires_at === "string" ? data.output_expires_at : null,
  };
}

function claimedFrom(data: Record<string, unknown>): ClaimedGeneration | null {
  const purpose = data.purpose;
  const operation = data.operation;
  const settings = furnitureSettingsFromJson(data.settings);
  const imageSlots = furnitureSlotsFromJson(data.image_slots);
  if (
    (purpose !== "submit" && purpose !== "poll" && purpose !== "reconcile")
    || (operation !== "image-to-3d" && operation !== "multi-image-to-3d")
    || typeof data.user_id !== "string"
    || typeof data.job_id !== "string"
    || typeof data.claim_nonce !== "string"
    || typeof data.provider_task_name !== "string"
    || !settings
    || !imageSlots
  ) {
    return null;
  }
  const providerTaskId = typeof data.provider_task_id === "string" ? data.provider_task_id : null;
  return {
    userId: data.user_id,
    jobId: data.job_id,
    purpose,
    claimNonce: data.claim_nonce,
    operation: operation as MeshyGenerationOperation,
    providerTaskId,
    providerTaskName: data.provider_task_name,
    providerContactedAtMs: epoch(data.provider_contacted_at),
    settings,
    imageSlots,
  };
}

function inputFrom(value: unknown): StoredGenerationInput | null {
  const data = asRecord(value);
  const slots = data ? furnitureSlotsFromJson([data.slot]) : null;
  if (!data || !slots || slots.length !== 1) return null;
  if (typeof data.storage_bucket !== "string" || typeof data.storage_object_path !== "string") return null;
  if (typeof data.sha256 !== "string" || typeof data.mime_type !== "string") return null;
  const byteSize = asNumber(data.byte_size);
  const widthPx = asNumber(data.width_px);
  const heightPx = asNumber(data.height_px);
  if (byteSize == null || widthPx == null || heightPx == null) return null;
  return {
    slot: slots[0] as FurnitureViewSlot,
    bucket: data.storage_bucket,
    path: data.storage_object_path,
    sha256: data.sha256,
    mimeType: data.mime_type,
    byteSize,
    widthPx,
    heightPx,
  };
}

function temporaryFrom(value: unknown): TemporaryGenerationObject | null {
  const data = asRecord(value);
  if (!data) return null;
  if (data.kind !== "input" && data.kind !== "candidate") return null;
  if (typeof data.bucket !== "string" || typeof data.path !== "string") return null;
  if (typeof data.job_id !== "string" || typeof data.user_id !== "string") return null;
  if (!generationObjectAllowed(data.bucket, data.path, data.user_id)) return null;
  if (data.path.includes("/assets/")) return null;
  return {
    kind: data.kind,
    bucket: data.bucket,
    path: data.path,
    jobId: data.job_id,
    userId: data.user_id,
    slot: typeof data.slot === "string" ? data.slot : null,
  };
}

function integerAt(value: unknown): number | null {
  const number = asNumber(value);
  if (number == null || !Number.isInteger(number)) return null;
  return number;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function epoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
