/**
 * Authenticated generation HTTP handlers. Ownership and credits come from
 * the signed-in user and the server ledger. A normal owner cannot authorize
 * a second paid POST.
 */

import { randomUUID } from "node:crypto";

import type { FurnitureViewSlot } from "@/lib/vibode-furniture/generator/images";

import type { BucketObjectStore, GenerationCommands } from "./contracts";
import {
  authorizeOperationalResubmit,
  createOwnedGeneration,
  discardOwnedGeneration,
  previewOwnedGeneration,
  readOwnedGeneration,
} from "./pipeline";
import { MESHY_TEST_CREDIT_CEILING } from "./policy";
import { customerEntitlement } from "@/lib/vibode-furniture/generator/beta-generation";

import { furnitureSettingsFromJson } from "./settings-json";
import {
  GENERATION_REQUEST_BODY_MAX_BYTES,
  generationRequestBodyLimit,
  imagesFitGenerationTransport,
} from "./transport";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const KEY = /^[a-z0-9-]{8,80}$/;

const SLOTS = new Set<FurnitureViewSlot>(["front", "left", "right", "back"]);

const FORBIDDEN_FIELDS = [
  "userId",
  "user_id",
  "email",
  "jobId",
  "reservedCredits",
  "consumedCredits",
  "credits",
  "status",
  "providerTaskId",
  "savedAssetId",
];

export type GenerationHttpResult = Readonly<{ status: number; body: unknown }>;

export type GenerationAuthorizer = (request: Request) => Promise<
  | { ok: true; userId: string; email: string | null }
  | { ok: false; response: GenerationHttpResult }
>;

export type GenerationHttpDeps = Readonly<{
  authorize: GenerationAuthorizer;
  commands: GenerationCommands;
  objects: BucketObjectStore;
  env: Readonly<Record<string, string | undefined>>;
  isAdmin: (email: string | null | undefined) => boolean;
  nowMs: () => number;
  newJobId?: () => string;
  enforceCertifiedProfile?: boolean;
}>;

export async function postFurnitureGeneration(
  request: Request,
  deps: GenerationHttpDeps,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  const body = await readJson(request);
  if (!body.ok) return unreadable(body.reason);
  if (FORBIDDEN_FIELDS.some((field) => field in body.value)) {
    return json(400, { ok: false, error: "The generation request could not be read." });
  }
  const idempotencyKey = typeof body.value.idempotencyKey === "string" ? body.value.idempotencyKey.trim() : "";
  if (!KEY.test(idempotencyKey)) {
    return json(400, { ok: false, error: "The generation request could not be read." });
  }
  const settings = furnitureSettingsFromJson(body.value.settings);
  if (!settings) return json(400, { ok: false, error: "Those settings are not available." });
  const images = decodeImages(body.value.images);
  if (!images.ok) {
    return images.reason === "too_large"
      ? json(413, { ok: false, error: "The photo is too large to send." })
      : json(400, { ok: false, error: "The photos could not be used." });
  }
  try {
    const created = await createOwnedGeneration({
      commands: deps.commands,
      objects: deps.objects,
      actor: { userId: caller.userId, email: caller.email },
      env: deps.env,
      isAdmin: deps.isAdmin,
      idempotencyKey,
      jobId: (deps.newJobId ?? randomUUID)(),
      settings,
      images: images.images,
      nowMs: deps.nowMs(),
      enforceCertifiedProfile: deps.enforceCertifiedProfile === true,
    });
    if (!created.ok) return json(failureStatus(created.errorClass), { ok: false, error: created.message });
    return json(200, { ok: true, created: created.created, job: created.job });
  } catch {
    return json(500, { ok: false, error: "The generation request could not be stored." });
  }
}

export async function getFurnitureGenerationAllowance(
  request: Request,
  deps: GenerationHttpDeps,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  const url = new URL(request.url);
  if (url.searchParams.has("userId") || url.searchParams.has("user_id")) {
    return json(400, { ok: false, error: "That allowance could not be read." });
  }
  try {
    const [controls, allowance] = await Promise.all([
      deps.commands.controls(),
      deps.commands.readOwnAllowance(caller.userId),
    ]);
    if (!allowance.ok) return json(500, { ok: false, error: "That allowance could not be read." });
    const entitlement = customerEntitlement({
      approved: allowance.approved,
      enabled: allowance.enabled,
      authorized: allowance.authorized,
      reserved: allowance.reserved,
      consumed: allowance.consumed,
      remaining: allowance.remaining,
      generationEnabled: deps.env.VIBODE_MESHY_GENERATION_ENABLED === "true",
      liveEnabled: controls.liveEnabled === true,
    });
    return json(200, { ok: true, entitlement });
  } catch {
    return json(500, { ok: false, error: "That allowance could not be read." });
  }
}

export async function getFurnitureGenerationRecent(
  request: Request,
  deps: GenerationHttpDeps,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  const url = new URL(request.url);
  if (url.searchParams.has("userId") || url.searchParams.has("user_id")) {
    return json(400, { ok: false, error: "Those generations could not be read." });
  }
  try {
    const listed = await deps.commands.listOwnerRecent(caller.userId);
    if (!listed.ok) return json(500, { ok: false, error: "Those generations could not be read." });
    return json(200, {
      ok: true,
      limit: listed.limit,
      jobs: listed.jobs,
    });
  } catch {
    return json(500, { ok: false, error: "Those generations could not be read." });
  }
}

export async function getFurnitureGeneration(
  request: Request,
  deps: GenerationHttpDeps,
  jobId: string,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  if (!UUID.test(jobId)) return json(404, { ok: false, error: "That generation could not be found." });
  try {
    const read = await readOwnedGeneration(deps.commands, caller.userId, jobId);
    if (!read.ok) return json(404, { ok: false, error: read.message });
    return json(200, { ok: true, job: read.job });
  } catch {
    return json(500, { ok: false, error: "That generation could not be found." });
  }
}

export async function postFurnitureGenerationPreview(
  request: Request,
  deps: GenerationHttpDeps,
  jobId: string,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  if (!UUID.test(jobId)) return json(404, { ok: false, error: "That preview is not available." });
  try {
    const preview = await previewOwnedGeneration({
      commands: deps.commands,
      objects: deps.objects,
      userId: caller.userId,
      jobId,
    });
    if (!preview.ok) return json(404, { ok: false, error: preview.message });
    return json(200, { ok: true, previewUrl: preview.previewUrl });
  } catch {
    return json(500, { ok: false, error: "That preview is not available." });
  }
}

export async function postFurnitureGenerationDiscard(
  request: Request,
  deps: GenerationHttpDeps,
  jobId: string,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  if (!UUID.test(jobId)) return json(404, { ok: false, error: "That generation could not be found." });
  try {
    const discarded = await discardOwnedGeneration({
      commands: deps.commands,
      userId: caller.userId,
      jobId,
      nowMs: deps.nowMs(),
    });
    if (!discarded.ok) return json(failureStatus(discarded.errorClass), { ok: false, error: discarded.message });
    return json(200, {
      ok: true,
      status: discarded.status,
      providerCreditsRefunded: false,
    });
  } catch {
    return json(500, { ok: false, error: "That generation cannot be discarded." });
  }
}

export async function postFurnitureGenerationRecovery(
  request: Request,
  deps: GenerationHttpDeps,
  jobId: string,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  if (!UUID.test(jobId)) return json(404, { ok: false, error: "That generation cannot be submitted again." });
  const body = await readJson(request);
  if (!body.ok) return json(400, { ok: false, error: "That generation cannot be submitted again." });
  if (FORBIDDEN_FIELDS.some((field) => field in body.value)) {
    return json(400, { ok: false, error: "That generation cannot be submitted again." });
  }
  if (body.value.duplicateChargeRiskAccepted !== true) {
    return json(409, { ok: false, error: "That generation cannot be submitted again." });
  }
  try {
    const authorized = await authorizeOperationalResubmit({
      commands: deps.commands,
      actor: { userId: caller.userId, email: caller.email },
      isAdmin: deps.isAdmin,
      jobId,
      duplicateChargeRiskAccepted: true,
    });
    if (!authorized.ok) return json(failureStatus(authorized.errorClass), { ok: false, error: authorized.message });
    return json(200, {
      ok: true,
      status: authorized.status,
      duplicateChargeRisk: true,
    });
  } catch {
    return json(500, { ok: false, error: "That generation cannot be submitted again." });
  }
}

const CREDIT_RESOLUTION_FIELDS = new Set(["providerTaskId", "consumedCredits", "reason", "evidenceRef"]);

export async function postFurnitureGenerationCreditResolution(
  request: Request,
  deps: GenerationHttpDeps,
  jobId: string,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  if (!deps.isAdmin(caller.email) || !caller.userId) {
    return json(401, { ok: false, error: "That provider credit cannot be recorded." });
  }
  if (!UUID.test(jobId)) return json(404, { ok: false, error: "That provider credit cannot be recorded." });
  const body = await readJson(request);
  if (!body.ok) return json(400, { ok: false, error: "That provider credit cannot be recorded." });
  if (Object.keys(body.value).some((field) => !CREDIT_RESOLUTION_FIELDS.has(field))) {
    return json(400, { ok: false, error: "That provider credit cannot be recorded." });
  }
  const providerTaskId = typeof body.value.providerTaskId === "string" ? body.value.providerTaskId.trim() : "";
  const reason = typeof body.value.reason === "string" ? body.value.reason : "";
  const evidenceRef = typeof body.value.evidenceRef === "string" ? body.value.evidenceRef : "";
  const consumedCredits = body.value.consumedCredits;
  if (!Number.isInteger(consumedCredits) || typeof consumedCredits !== "number") {
    return json(400, { ok: false, error: "That provider credit cannot be recorded." });
  }
  try {
    const resolved = await deps.commands.resolveProviderCredits({
      actorUserId: caller.userId,
      jobId,
      providerTaskId,
      consumedCredits,
      reason,
      evidenceRef,
      nowMs: deps.nowMs(),
    });
    if (!resolved.ok) return json(failureStatus(resolved.code), { ok: false, error: "That provider credit cannot be recorded." });
    return json(200, {
      ok: true,
      status: resolved.status,
      consumedCredits: resolved.consumedCredits,
      idempotent: resolved.idempotent,
    });
  } catch {
    return json(500, { ok: false, error: "That provider credit cannot be recorded." });
  }
}

export async function postFurnitureGenerationAllowance(
  request: Request,
  deps: GenerationHttpDeps,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  if (!deps.isAdmin(caller.email)) {
    return json(401, { ok: false, error: "A paid Meshy submission is not authorized." });
  }
  const body = await readJson(request);
  if (!body.ok) return json(400, { ok: false, error: "A paid Meshy submission is not authorized." });
  if (FORBIDDEN_FIELDS.some((field) => field in body.value) || "duplicateChargeRiskAccepted" in body.value) {
    return json(400, { ok: false, error: "A paid Meshy submission is not authorized." });
  }
  if (body.value.paidSubmissionAuthorized !== true) {
    return json(409, { ok: false, error: "A paid Meshy submission is not authorized." });
  }
  try {
    const granted = await deps.commands.grantPaidSubmission(true);
    if (!granted.ok) {
      return json(failureStatus(granted.code), { ok: false, error: "A paid Meshy submission is not authorized." });
    }
    return json(200, {
      ok: true,
      paidSubmissionsAuthorized: granted.authorized,
      paidSubmissionsUsed: granted.used,
      maxEstimatedCredits: MESHY_TEST_CREDIT_CEILING,
    });
  } catch {
    return json(500, { ok: false, error: "A paid Meshy submission is not authorized." });
  }
}

export async function getFurnitureGenerationOperator(
  request: Request,
  deps: GenerationHttpDeps,
  jobId: string,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  if (!deps.isAdmin(caller.email)) {
    return json(401, { ok: false, error: "That generation could not be found." });
  }
  if (!UUID.test(jobId)) return json(404, { ok: false, error: "That generation could not be found." });
  try {
    const read = await deps.commands.readOperator(jobId);
    if (!read.ok) return json(failureStatus(read.code), { ok: false, error: "That generation could not be found." });
    return json(200, {
      ok: true,
      job: {
        jobId: read.job.jobId,
        status: read.job.status,
        progress: read.job.progress,
        errorClass: read.job.errorClass,
        providerStatus: read.job.providerStatus,
        consumedCredits: read.job.consumedCredits,
        quotaState: read.job.quotaState,
        attemptCount: read.job.attemptCount,
      },
      allowance: {
        paidSubmissionsAuthorized: read.job.paidSubmissionsAuthorized,
        paidSubmissionsUsed: read.job.paidSubmissionsUsed,
      },
    });
  } catch {
    return json(500, { ok: false, error: "That generation could not be found." });
  }
}

async function readJson(
  request: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; reason: "unreadable" | "too_large" }> {
  const declared = generationRequestBodyLimit(request.headers.get("content-length"));
  if (declared !== "ok") return { ok: false, reason: declared === "too_large" ? "too_large" : "unreadable" };
  let text: string;
  try {
    text = await readBodyText(request, GENERATION_REQUEST_BODY_MAX_BYTES);
  } catch (error) {
    return { ok: false, reason: error instanceof BodyTooLargeError ? "too_large" : "unreadable" };
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "unreadable" };
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

function decodeImages(
  value: unknown,
): { ok: true; images: { slot: FurnitureViewSlot; bytes: Uint8Array }[] } | { ok: false; reason: "invalid" | "too_large" } {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) return { ok: false, reason: "invalid" };
  const images: { slot: FurnitureViewSlot; bytes: Uint8Array }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return { ok: false, reason: "invalid" };
    const record = item as Record<string, unknown>;
    if (typeof record.slot !== "string" || !SLOTS.has(record.slot as FurnitureViewSlot)) {
      return { ok: false, reason: "invalid" };
    }
    if (typeof record.base64 !== "string" || record.base64.includes("data:") || record.base64.includes("http")) {
      return { ok: false, reason: "invalid" };
    }
    if (record.base64.length === 0 || record.base64.length > GENERATION_REQUEST_BODY_MAX_BYTES) {
      return { ok: false, reason: record.base64.length > GENERATION_REQUEST_BODY_MAX_BYTES ? "too_large" : "invalid" };
    }
    const bytes = Buffer.from(record.base64, "base64");
    if (bytes.byteLength === 0) return { ok: false, reason: "invalid" };
    images.push({ slot: record.slot as FurnitureViewSlot, bytes: new Uint8Array(bytes) });
  }
  if (!imagesFitGenerationTransport(images.map((image) => image.bytes.byteLength))) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true, images };
}

class BodyTooLargeError extends Error {}

async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const body = request.body;
  if (!body) {
    const text = await request.text();
    if (Buffer.byteLength(text) > maxBytes) throw new BodyTooLargeError();
    return text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function unreadable(reason: "unreadable" | "too_large"): GenerationHttpResult {
  return reason === "too_large"
    ? json(413, { ok: false, error: "The photo is too large to send." })
    : json(400, { ok: false, error: "The generation request could not be read." });
}

function failureStatus(code: string): number {
  if (code === "unauthorized") return 401;
  if (code === "disabled") return 403;
  if (code === "not_found") return 404;
  if (code === "invalid_input" || code === "unsupported_settings") return 400;
  if (
    code === "quota_exhausted"
    || code === "concurrency_limited"
    || code === "idempotency_conflict"
    || code === "not_claimable"
    || code === "allowance_closed"
    || code === "allowance_required"
    || code === "allowance_disabled"
    || code === "allowance_exhausted"
    || code === "submission_not_authorized"
    || code === "account_deletion_in_progress"
    || code === "conflict"
    || code === "credit_unreported"
  ) {
    return 409;
  }
  return 500;
}

function json(status: number, body: unknown): GenerationHttpResult {
  return { status, body };
}
