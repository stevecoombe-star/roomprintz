import type { NanoBananaProAspectRatio } from "@/lib/afc-image-models";
import type { RemoveCleanupGenerationInputSnapshot } from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

export type CleanupJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type CleanupPublicStatus = CleanupJobStatus | "discarded";

export type CleanupSelectionItem = Readonly<{
  id: string;
  concept: string;
  maskSha256: string;
}>;

export type CleanupJobInsert = Readonly<{
  id: string;
  userId: string;
  roomUserId: string;
  roomId: string;
  afcGenerationId: string;
  currentGenerationId: string;
  paidRequestFingerprint: string;
  inputFingerprint: string;
  hiddenConcepts: readonly string[];
  selection: readonly CleanupSelectionItem[];
  originalSha256: string;
  originalMime: RemoveCleanupGenerationInputSnapshot["original"]["mimeType"];
  originalByteCount: number;
  originalWidth: number;
  originalHeight: number;
  overlaySha256: string;
  promptSha256: string;
  promptVersion: string;
  maskManifestSha256: string;
  aspectRatioFamily: NanoBananaProAspectRatio;
  documented1kGridWidth: number;
  documented1kGridHeight: number;
  originalPath: string;
  overlayPath: string;
  promptPath: string;
  masksPath: string;
}>;

export type CleanupJobRow = {
  id: string;
  userId: string;
  roomId: string;
  afcGenerationId: string;
  paidRequestFingerprint: string;
  inputFingerprint: string;
  status: CleanupJobStatus;
  hiddenObjectCount: number;
  hiddenConcepts: string[];
  selection: CleanupSelectionItem[];
  originalSha256: string;
  originalMime: CleanupJobInsert["originalMime"];
  originalByteCount: number;
  originalWidth: number;
  originalHeight: number;
  overlaySha256: string;
  promptSha256: string;
  promptVersion: string;
  maskManifestSha256: string;
  aspectRatioFamily: NanoBananaProAspectRatio;
  documented1kGridWidth: number;
  documented1kGridHeight: number;
  resolutionClass: "2K";
  outputMime: "image/jpeg";
  provider: "google-gemini-interactions";
  requestedModelId: "gemini-3-pro-image";
  artifactBucket: "vibode-cleanup";
  originalPath: string;
  overlayPath: string;
  promptPath: string;
  masksPath: string;
  outputPath: string | null;
  outputSha256: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  returnedModelId: string | null;
  interactionId: string | null;
  usage: Record<string, number> | null;
  stageRegistration: "not-assessed";
  providerStartedAtMs: number | null;
  providerAttemptId: string | null;
  claimNonce: string | null;
  claimExpiresAtMs: number | null;
  claimedAtMs: number | null;
  heartbeatAtMs: number | null;
  attemptCount: number;
  failureCode: string | null;
  failureMessage: string | null;
  providerStatus: string | null;
  providerHttpStatus: number | null;
  latencyMs: number | null;
  discardedAtMs: number | null;
  notBeforeMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs: number | null;
};

export type CleanupJobDatabase = {
  jobs: CleanupJobRow[];
};

export type CleanupEnqueueResult =
  | Readonly<{ ok: true; created: boolean; job: CleanupJobRow }>
  | Readonly<{
      ok: false;
      code: "not_found" | "stale_generation" | "active_job" | "daily_limit" | "global_daily_limit" | "idempotency_conflict" | "invalid_submission";
    }>;

export type CleanupClaim = Readonly<{
  jobId: string;
  userId: string;
  roomId: string;
  claimNonce: string;
  claimExpiresAtMs: number;
  attemptCount: number;
  afcGenerationId: string;
  inputFingerprint: string;
  paidRequestFingerprint: string;
  aspectRatioFamily: NanoBananaProAspectRatio;
  documented1kGridWidth: number;
  documented1kGridHeight: number;
  originalSha256: string;
  originalMime: CleanupJobInsert["originalMime"];
  originalWidth: number;
  originalHeight: number;
  overlaySha256: string;
  promptSha256: string;
  promptVersion: string;
  maskManifestSha256: string;
  originalPath: string;
  overlayPath: string;
  promptPath: string;
  masksPath: string;
  selection: readonly CleanupSelectionItem[];
}>;

export type CleanupContactResult =
  | Readonly<{ ok: true; attemptId: string }>
  | Readonly<{ ok: false; code: "stale_claim" | "already_contacted" | "daily_limit" | "global_daily_limit" }>;

export type CleanupCompleteInput = Readonly<{
  outputSha256: string;
  outputWidth: number;
  outputHeight: number;
  returnedModelId: string | null;
  interactionId: string | null;
  usage: Record<string, number> | null;
  providerStatus: string | null;
  providerHttpStatus: number | null;
  latencyMs: number;
}>;

export type CleanupCompleteResult =
  | Readonly<{ ok: true; code: "completed" | "already_complete" }>
  | Readonly<{ ok: false; code: "stale_claim" | "not_contacted" | "unexpected_output" | "terminal" }>;

export type CleanupFailInput = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  providerStatus?: string | null;
  providerHttpStatus?: number | null;
  latencyMs?: number | null;
}>;

export type CleanupFailResult =
  | Readonly<{ ok: true; disposition: "requeued" | "failed" }>
  | Readonly<{ ok: false; code: "stale_claim" | "terminal" }>;

export type CleanupDiscardResult =
  | Readonly<{ ok: true; job: CleanupJobRow; effect: "cancelled" | "marked" | "already" }>
  | Readonly<{ ok: false; code: "not_found" }>;

export type CleanupStatusView = Readonly<{
  jobId: string;
  status: CleanupPublicStatus;
  roomId: string;
  generationId: string;
  hiddenCount: number;
  concepts: readonly string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCategory: string | null;
  candidateAvailable: boolean;
  stale: boolean;
  outputWidth: number | null;
  outputHeight: number | null;
  stageRegistration: "not-assessed";
}>;
