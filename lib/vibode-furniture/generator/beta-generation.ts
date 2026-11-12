/**
 * Customer beta generation rules. This module does not call the network
 * or decide that a reservation succeeded. SQL reserve remains the authority.
 */

import { customerGenerationErrorClass, OWNER_RECENT_GENERATION_LIMIT } from "@/lib/vibode-furniture/generation/owner-recent";
import {
  defaultFurnitureGeneratorSettings,
  type FurnitureGeneratorSettings,
} from "@/lib/vibode-furniture/generator/settings";

export type CustomerEntitlementState =
  | "ready"
  | "unapproved"
  | "disabled"
  | "exhausted"
  | "generation_off";

export type CustomerEntitlement = Readonly<{
  canGenerate: boolean;
  state: CustomerEntitlementState;
  authorized: number;
  reserved: number;
  consumed: number;
  remaining: number;
  reason: string | null;
}>;

export type CustomerJobSnapshot = Readonly<{
  jobId: string;
  status: string;
  errorClass: string | null;
  progress: number;
  outputExpiresAt?: string | null;
  previewAvailable?: boolean;
  createdAt?: string;
  updatedAt?: string;
}>;

export type RecoverableGeneration = Readonly<{
  jobId: string;
  status: string;
  errorClass: string | null;
  progress: number;
  createdAt: string;
  updatedAt: string;
  outputExpiresAt: string | null;
  previewAvailable: boolean;
}>;

export const RECENT_GENERATION_CHECK_FAILED =
  "Your generations could not be checked. Nothing new was started.";

const RECOVERABLE_STATUSES = new Set([
  "reserved",
  "submitting",
  "ambiguous",
  "running",
  "ingesting",
  "needs_review",
  "ready",
]);

const PROCESSING_STATUSES = new Set([
  "reserved",
  "submitting",
  "ambiguous",
  "running",
  "ingesting",
]);

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUBMISSION_KEY = /^[a-z0-9-]{8,80}$/;

export function isCertifiedBetaFurnitureSettings(settings: FurnitureGeneratorSettings): boolean {
  const certified = defaultFurnitureGeneratorSettings();
  return settings.geometryResolution === "standard"
    && settings.geometryResolution === certified.geometryResolution
    && settings.shouldTexture === true
    && settings.textureModel === "default"
    && settings.textureResolution === "2k"
    && settings.enablePbr === false
    && settings.texturePrompt === ""
    && settings.imageEnhancement === true
    && settings.shouldRemesh === false
    && settings.topology === "triangle"
    && settings.targetPolycount === 30000
    && settings.targetPolycount === certified.targetPolycount;
}

export function customerEntitlement(input: Readonly<{
  approved: boolean;
  enabled: boolean;
  authorized: number;
  reserved: number;
  consumed: number;
  remaining: number;
  generationEnabled: boolean;
  liveEnabled: boolean;
}>): CustomerEntitlement {
  const counts = {
    authorized: input.authorized,
    reserved: input.reserved,
    consumed: input.consumed,
    remaining: input.remaining,
  };
  if (!input.approved) {
    return {
      canGenerate: false,
      state: "unapproved",
      authorized: 0,
      reserved: 0,
      consumed: 0,
      remaining: 0,
      reason: "This account is not approved for AI furniture generation.",
    };
  }
  if (!input.enabled) {
    return {
      canGenerate: false,
      state: "disabled",
      ...counts,
      reason: "AI generation is turned off for this account.",
    };
  }
  if (input.remaining < 1) {
    return {
      canGenerate: false,
      state: "exhausted",
      ...counts,
      reason: "No AI generations remain.",
    };
  }
  if (!input.generationEnabled || !input.liveEnabled) {
    return {
      canGenerate: false,
      state: "generation_off",
      ...counts,
      reason: "AI generation is temporarily unavailable.",
    };
  }
  return { canGenerate: true, state: "ready", ...counts, reason: null };
}

export function allowanceBalanceLine(entitlement: CustomerEntitlement): string | null {
  if (entitlement.state === "unapproved") return null;
  return `AI Generations Remaining: ${entitlement.remaining}`;
}

export function customerJobCopy(job: CustomerJobSnapshot): Readonly<{
  title: string;
  detail: string;
  poll: boolean;
}> {
  if (job.status === "reserved") {
    return {
      title: "Preparing your photo",
      detail: "The photo is stored for this generation. The model has not started yet.",
      poll: true,
    };
  }
  if (job.status === "submitting" || job.status === "ambiguous") {
    return {
      title: "Submitting",
      detail: "Vibode is submitting this generation. This screen does not start another one.",
      poll: true,
    };
  }
  if (job.status === "running") {
    return { title: "Generating", detail: "The model is being generated.", poll: true };
  }
  if (job.status === "ingesting") {
    return {
      title: "Processing the model",
      detail: "The finished model is being prepared for preview.",
      poll: true,
    };
  }
  if (job.status === "ready") {
    return {
      title: "Ready to preview",
      detail: "Preview the private model, set one real measurement, and save it.",
      poll: false,
    };
  }
  if (job.status === "needs_review") {
    return {
      title: "Awaiting operator review",
      detail: "An operator needs to review this generation. It will not start again on its own.",
      poll: false,
    };
  }
  if (job.status === "failed") {
    return { title: "The generation did not finish", detail: failedDetail(job.errorClass), poll: false };
  }
  if (job.status === "expired") {
    return {
      title: "This preview expired",
      detail: "Generate again when you want a new model.",
      poll: false,
    };
  }
  if (job.status === "saved") {
    return {
      title: "Saved to My Furniture",
      detail: "The calibrated model is in your library.",
      poll: false,
    };
  }
  if (job.status === "cancelled" || job.status === "discarded") {
    return {
      title: "This generation stopped",
      detail: "It will not continue on its own.",
      poll: false,
    };
  }
  return {
    title: "Checking this generation",
    detail: "The latest status could not be shown.",
    poll: false,
  };
}

export function nextPollDelayMs(previousMs: number): number {
  if (!Number.isFinite(previousMs) || previousMs < 2_000) return 2_000;
  return Math.min(previousMs * 2, 15_000);
}

export function shouldRefreshAllowance(status: string): boolean {
  return status === "failed" || status === "cancelled" || status === "discarded" || status === "expired";
}

export function claimBetaSubmission(
  state: Readonly<{ busy: boolean; key: string | null }>,
  mint: () => string,
): Readonly<{ busy: true; key: string }> | null {
  if (state.busy) return null;
  const key = state.key ?? mint();
  if (!SUBMISSION_KEY.test(key)) return null;
  return { busy: true, key };
}

export function submissionKeyAfterOutcome(
  key: string,
  outcome: "uncertain" | "started" | "refused",
): string | null {
  if (outcome === "refused") return null;
  return key;
}

export function betaSubmissionKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `beta-${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16)}`;
}

export function submissionKeyAfterRestore(key: string | null): string | null {
  return key;
}

export function shouldApplyGenerationRead(requestId: number, currentRequestId: number): boolean {
  return requestId === currentRequestId;
}

export function recentGenerationBlocksNew(jobs: readonly { status: string }[]): boolean {
  return jobs.some((job) => PROCESSING_STATUSES.has(job.status) || job.status === "needs_review");
}

export function canOfferBetaGeneration(input: Readonly<{
  entitlement: CustomerEntitlement | null;
  recentReady: boolean;
  blocking: boolean;
  busy: boolean;
  frontReady: boolean;
}>): boolean {
  return input.entitlement?.canGenerate === true
    && input.recentReady
    && input.frontReady
    && !input.busy
    && !input.blocking;
}

export function readyCandidateExpired(
  job: Readonly<{ status: string; outputExpiresAt?: string | null }>,
  nowMs: number,
): boolean {
  if (job.status !== "ready" || !job.outputExpiresAt) return false;
  const expiresAt = Date.parse(job.outputExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}

export function selectRecoveredGeneration<T extends { status: string }>(jobs: readonly T[]): T | null {
  return jobs.find((job) => PROCESSING_STATUSES.has(job.status))
    ?? jobs.find((job) => job.status === "needs_review")
    ?? jobs.find((job) => job.status === "ready")
    ?? null;
}

export function mergeRecentGenerationResponse(input: Readonly<{
  jobs: readonly RecoverableGeneration[];
  selectedJobId: string | null;
  userSelected: boolean;
}>): Readonly<{ jobs: readonly RecoverableGeneration[]; selectedJobId: string | null }> {
  const jobs = input.jobs.slice(0, OWNER_RECENT_GENERATION_LIMIT);
  const keep = input.userSelected
    && input.selectedJobId != null
    && jobs.some((job) => job.jobId === input.selectedJobId);
  return {
    jobs,
    selectedJobId: keep ? input.selectedJobId : selectRecoveredGeneration(jobs)?.jobId ?? null,
  };
}

export function recoverableFromSnapshot(job: CustomerJobSnapshot, nowMs: number): RecoverableGeneration | null {
  if (!RECOVERABLE_STATUSES.has(job.status)) return null;
  if (job.status === "ready" && readyCandidateExpired(job, nowMs)) return null;
  const createdAt = job.createdAt && Number.isFinite(Date.parse(job.createdAt))
    ? job.createdAt
    : new Date(nowMs).toISOString();
  const updatedAt = job.updatedAt && Number.isFinite(Date.parse(job.updatedAt))
    ? job.updatedAt
    : createdAt;
  return {
    jobId: job.jobId,
    status: job.status,
    errorClass: customerGenerationErrorClass(job.errorClass),
    progress: job.progress,
    createdAt,
    updatedAt,
    outputExpiresAt: job.status === "ready" ? job.outputExpiresAt ?? null : null,
    previewAvailable: job.status === "ready" && job.previewAvailable !== false && !readyCandidateExpired(job, nowMs),
  };
}

export function snapshotFromRecent(job: RecoverableGeneration): CustomerJobSnapshot {
  return {
    jobId: job.jobId,
    status: job.status,
    errorClass: job.errorClass,
    progress: job.progress,
    outputExpiresAt: job.outputExpiresAt,
    previewAvailable: job.previewAvailable,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function rememberRecoverableJob(
  jobs: readonly RecoverableGeneration[],
  job: CustomerJobSnapshot,
  nowMs: number,
): readonly RecoverableGeneration[] {
  const item = recoverableFromSnapshot(job, nowMs);
  const rest = jobs.filter((row) => row.jobId !== job.jobId);
  return item ? [item, ...rest].slice(0, OWNER_RECENT_GENERATION_LIMIT) : rest;
}

export function recentGenerationLabel(job: Readonly<{
  status: string;
  errorClass: string | null;
  createdAt: string;
}>): string {
  const title = customerJobCopy({
    jobId: "00000000-0000-4000-8000-000000000000",
    status: job.status,
    errorClass: job.errorClass,
    progress: 0,
  }).title;
  const day = job.createdAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${title} · ${day}` : title;
}

export function initialRecoveredSelection(input?: {
  job?: CustomerJobSnapshot | null;
  recent?: readonly RecoverableGeneration[] | null;
} | null): Readonly<{ job: CustomerJobSnapshot | null; recent: readonly RecoverableGeneration[] }> {
  if (!input) return { job: null, recent: [] };
  if (input.recent) {
    const picked = selectRecoveredGeneration(input.recent);
    return {
      job: input.job ?? (picked ? snapshotFromRecent(picked) : null),
      recent: input.recent,
    };
  }
  const seeded = input.job ? recoverableFromSnapshot(input.job, 0) : null;
  return { job: input.job ?? null, recent: seeded ? [seeded] : [] };
}

export function recoverableGenerationsFromPayload(
  payload: Record<string, unknown> | null,
  nowMs: number,
): RecoverableGeneration[] | null {
  if (!payload || payload.ok !== true || !Array.isArray(payload.jobs)) return null;
  const jobs: RecoverableGeneration[] = [];
  for (const row of payload.jobs) {
    const job = recoverableFromRecord(row, nowMs);
    if (job) jobs.push(job);
    if (jobs.length === OWNER_RECENT_GENERATION_LIMIT) break;
  }
  return jobs;
}

function recoverableFromRecord(value: unknown, nowMs: number): RecoverableGeneration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.jobId !== "string" || !JOB_ID.test(record.jobId)) return null;
  if (typeof record.status !== "string" || !RECOVERABLE_STATUSES.has(record.status)) return null;
  if (typeof record.progress !== "number" || !Number.isInteger(record.progress) || record.progress < 0 || record.progress > 100) {
    return null;
  }
  if (typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) return null;
  if (typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) return null;
  const outputExpiresAt = typeof record.outputExpiresAt === "string" ? record.outputExpiresAt : null;
  if (record.status === "ready" && readyCandidateExpired({ status: "ready", outputExpiresAt }, nowMs)) return null;
  if (record.status === "ready" && outputExpiresAt == null) return null;
  const previewAvailable = typeof record.previewAvailable === "boolean"
    ? record.previewAvailable
    : record.status === "ready";
  return {
    jobId: record.jobId,
    status: record.status,
    errorClass: customerGenerationErrorClass(record.errorClass),
    progress: record.progress,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    outputExpiresAt: record.status === "ready" ? outputExpiresAt : null,
    previewAvailable: record.status === "ready" && previewAvailable,
  };
}

function failedDetail(errorClass: string | null): string {
  if (errorClass === "rate_limited") return "The generator is busy. You can try a new generation later.";
  if (errorClass === "input_storage_failed") return "The photo could not be stored.";
  if (errorClass === "credit_unreported") return "The result needs an operator to confirm it.";
  if (errorClass === "provider_failed" || errorClass === "provider_rejected") {
    return "The model could not be generated.";
  }
  return "Nothing new was started.";
}
