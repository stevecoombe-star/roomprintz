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
import { furnitureSettingsFromJson } from "./settings-json";

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
}>;

export async function postFurnitureGeneration(
  request: Request,
  deps: GenerationHttpDeps,
): Promise<GenerationHttpResult> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  const body = await readJson(request);
  if (!body.ok) return json(400, { ok: false, error: "The generation request could not be read." });
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
  if (!images) return json(400, { ok: false, error: "The photos could not be used." });
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
      images,
      nowMs: deps.nowMs(),
    });
    if (!created.ok) return json(failureStatus(created.errorClass), { ok: false, error: created.message });
    return json(200, { ok: true, created: created.created, job: created.job });
  } catch {
    return json(500, { ok: false, error: "The generation request could not be stored." });
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

async function readJson(request: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
  try {
    const value = await request.json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

function decodeImages(value: unknown): { slot: FurnitureViewSlot; bytes: Uint8Array }[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) return null;
  const images: { slot: FurnitureViewSlot; bytes: Uint8Array }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (typeof record.slot !== "string" || !SLOTS.has(record.slot as FurnitureViewSlot)) return null;
    if (typeof record.base64 !== "string" || record.base64.includes("data:") || record.base64.includes("http")) {
      return null;
    }
    if (record.base64.length === 0 || record.base64.length > 28_000_000) return null;
    const bytes = Buffer.from(record.base64, "base64");
    if (bytes.byteLength === 0) return null;
    images.push({ slot: record.slot as FurnitureViewSlot, bytes: new Uint8Array(bytes) });
  }
  return images;
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
    || code === "submission_not_authorized"
  ) {
    return 409;
  }
  return 500;
}

function json(status: number, body: unknown): GenerationHttpResult {
  return { status, body };
}
