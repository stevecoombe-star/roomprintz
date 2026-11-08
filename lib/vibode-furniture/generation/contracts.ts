/**
 * Shared generation pipeline types. Routes and the worker depend on this
 * seam. The memory ledger and the SQL functions are the two implementations.
 */

import type { FurnitureViewSlot } from "@/lib/vibode-furniture/generator/images";
import type { FurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";

import type { MeshyGenerationOperation } from "./credits";
import type { GenerationStatus } from "./engine";

export type PublicGenerationJob = Readonly<{
  jobId: string;
  status: GenerationStatus;
  progress: number;
  errorClass: string | null;
  outputExpiresAt: string | null;
}>;

export type GenerationSaveSource = Readonly<{
  status: GenerationStatus;
  savedAssetId: string | null;
  bucket: string | null;
  path: string | null;
  sha256: string | null;
  byteSize: number | null;
  expiresAtMs: number | null;
}>;

export type GenerationCaller = Readonly<{
  userId: string;
  email: string | null;
}>;

export type PipelineFailure = Readonly<{
  ok: false;
  errorClass: string;
  message: string;
}>;

export type BucketObjectStore = {
  put(input: Readonly<{ bucket: string; path: string; bytes: Uint8Array; contentType: string }>): Promise<void>;
  get(input: Readonly<{ bucket: string; path: string }>): Promise<Uint8Array | null>;
  remove(input: Readonly<{ bucket: string; path: string }>): Promise<void>;
  sign(input: Readonly<{ bucket: string; path: string; ownerUserId: string }>): Promise<string | null>;
};

export type StoredGenerationInput = Readonly<{
  slot: FurnitureViewSlot;
  bucket: string;
  path: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
}>;

export type ClaimedGeneration = Readonly<{
  userId: string;
  jobId: string;
  purpose: "submit" | "poll" | "reconcile";
  claimNonce: string;
  operation: MeshyGenerationOperation;
  providerTaskId: string | null;
  providerTaskName: string;
  providerContactedAtMs: number | null;
  settings: FurnitureGeneratorSettings;
  imageSlots: readonly FurnitureViewSlot[];
}>;

export type OperatorGenerationJob = Readonly<{
  jobId: string;
  status: GenerationStatus;
  progress: number;
  errorClass: string | null;
  providerStatus: string | null;
  consumedCredits: number | null;
  quotaState: string | null;
  attemptCount: number;
  paidSubmissionsAuthorized: number;
  paidSubmissionsUsed: number;
}>;

export type TemporaryGenerationObject = Readonly<{
  kind: "input" | "candidate";
  bucket: string;
  path: string;
  jobId: string;
  userId: string;
  slot: string | null;
}>;

export type GenerationCommandResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: string };

export type GenerationCommands = {
  controls(): Promise<{ liveEnabled: boolean }>;
  reserve(input: Readonly<{
    userId: string;
    jobId: string;
    idempotencyKey: string;
    requestSha256: string;
    operation: MeshyGenerationOperation;
    settings: FurnitureGeneratorSettings;
    imageSlots: readonly FurnitureViewSlot[];
    reservedCredits: number;
    nowMs: number;
  }>): Promise<GenerationCommandResult<{ created: boolean; job: PublicGenerationJob }>>;
  attachInput(input: Readonly<{
    userId: string;
    jobId: string;
    slot: FurnitureViewSlot;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    byteSize: number;
    widthPx: number;
    heightPx: number;
    sha256: string;
    nowMs: number;
  }>): Promise<GenerationCommandResult<Record<never, never>>>;
  failBeforeProvider(input: Readonly<{ userId: string; jobId: string; nowMs: number }>): Promise<void>;
  readOwner(userId: string, jobId: string): Promise<GenerationCommandResult<{ job: PublicGenerationJob }>>;
  previewSource(userId: string, jobId: string): Promise<GenerationCommandResult<{ bucket: string; path: string }>>;
  readSaveSource(userId: string, jobId: string): Promise<GenerationCommandResult<GenerationSaveSource>>;
  linkSavedAsset(input: Readonly<{
    userId: string;
    jobId: string;
    assetId: string;
    sourceSha256: string;
    sourceByteSize: number;
    assetSha256: string;
    assetByteSize: number;
    nowMs: number;
  }>): Promise<GenerationCommandResult<{ status: "saved"; idempotent: boolean }>>;
  discard(input: Readonly<{ userId: string; jobId: string; nowMs: number }>): Promise<
    GenerationCommandResult<{ status: string; providerCreditsRefunded: false }>
  >;
  adminAuthorize(jobId: string, duplicateChargeRiskAccepted: boolean): Promise<
    GenerationCommandResult<{ status: string; duplicateChargeRisk: true }>
  >;
  grantPaidSubmission(acknowledge: boolean): Promise<
    GenerationCommandResult<{ authorized: number; used: number }>
  >;
  readOperator(jobId: string): Promise<GenerationCommandResult<{ job: OperatorGenerationJob }>>;
  claimNext(submitAllowed: boolean, nowMs: number): Promise<
    | { ok: true; outcome: "idle" | "disabled" }
    | { ok: true; outcome: "claimed"; claim: ClaimedGeneration }
    | { ok: false; code: string }
  >;
  listInputs(userId: string, jobId: string): Promise<readonly StoredGenerationInput[]>;
  bindTask(input: Readonly<{
    userId: string;
    jobId: string;
    claimNonce: string;
    providerTaskId: string;
    providerStatus: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
    nowMs: number;
  }>): Promise<GenerationCommandResult<{ status: string }>>;
  markAmbiguous(input: Readonly<{
    userId: string;
    jobId: string;
    claimNonce: string;
    errorCode: string;
    nowMs: number;
  }>): Promise<GenerationCommandResult<{ status: string }>>;
  failCreate(input: Readonly<{
    userId: string;
    jobId: string;
    claimNonce: string;
    errorClass: "provider_rejected" | "provider_payment" | "provider_auth" | "provider_forbidden";
    errorCode: string;
    nowMs: number;
  }>): Promise<GenerationCommandResult<{ status: string }>>;
  settleRateLimit(input: Readonly<{
    userId: string;
    jobId: string;
    claimNonce: string;
    nowMs: number;
  }>): Promise<GenerationCommandResult<{ status: string }>>;
  dropClaim(input: Readonly<{ userId: string; jobId: string; claimNonce: string; nowMs: number }>): Promise<void>;
  markNeedsReview(input: Readonly<{
    userId: string;
    jobId: string;
    claimNonce: string;
    reason: "list_absent" | "list_incomplete";
    nowMs: number;
  }>): Promise<GenerationCommandResult<{ status: string }>>;
  applyObservation(input: Readonly<{
    userId: string;
    jobId: string;
    claimNonce: string;
    providerStatus: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
    progress: number;
    consumedCredits: number | null;
    errorCode: string | null;
    nowMs: number;
  }>): Promise<GenerationCommandResult<{ status: string; errorClass: string | null }>>;
  recordOutput(input: Readonly<{
    userId: string;
    jobId: string;
    claimNonce: string;
    byteSize: number;
    sha256: string;
    nowMs: number;
  }>): Promise<GenerationCommandResult<{ status: string }>>;
  failOutput(input: Readonly<{
    userId: string;
    jobId: string;
    claimNonce: string;
    errorClass: "invalid_output" | "oversized_output" | "ingest_failed";
    nowMs: number;
  }>): Promise<GenerationCommandResult<{ status: string }>>;
  sweep(nowMs: number): Promise<void>;
  listTemporaryObjects(limit: number): Promise<readonly TemporaryGenerationObject[]>;
  markTemporaryPurged(object: TemporaryGenerationObject): Promise<boolean>;
};
