import type { CleanupJobRow, CleanupStatusView } from "./types";

/** Owner status. Prompts, storage paths, and image bytes stay off this view. */
export function cleanupJobStatusView(
  job: CleanupJobRow,
  currentGenerationId: string | null,
): CleanupStatusView {
  const discarded = job.discardedAtMs != null || job.status === "cancelled";
  return {
    jobId: job.id,
    status: discarded ? "discarded" : job.status,
    roomId: job.roomId,
    generationId: job.afcGenerationId,
    hiddenCount: job.hiddenObjectCount,
    concepts: [...job.hiddenConcepts],
    createdAt: new Date(job.createdAtMs).toISOString(),
    startedAt: job.providerStartedAtMs == null ? null : new Date(job.providerStartedAtMs).toISOString(),
    completedAt: job.completedAtMs == null ? null : new Date(job.completedAtMs).toISOString(),
    errorCategory: job.failureCode,
    candidateAvailable: job.status === "succeeded" && job.outputSha256 != null && job.discardedAtMs == null,
    stale: currentGenerationId != null && currentGenerationId !== job.afcGenerationId,
    outputWidth: job.outputWidth,
    outputHeight: job.outputHeight,
    stageRegistration: "not-assessed",
  };
}

export function cleanupPublicStatus(code: string): number {
  switch (code) {
    case "not_found":
    case "stale_generation":
      return 404;
    case "forbidden":
      return 403;
    case "daily_limit":
    case "global_daily_limit":
      return 429;
    case "active_job":
    case "idempotency_conflict":
    case "not_failed":
      return 409;
    case "inadmissible_aspect":
      return 422;
    case "artifact_unreadable":
    case "unavailable":
      return 503;
    default:
      return 400;
  }
}

export function cleanupPublicBody(code: string): Readonly<{ error: string }> {
  if (code === "forbidden" || code === "not_found" || code === "stale_generation") return { error: "Not found." };
  if (code === "daily_limit" || code === "global_daily_limit") return { error: "Daily Clean Up limit reached." };
  if (code === "active_job") return { error: "A Clean Up job is already active." };
  if (code === "not_failed") return { error: "Only a failed Clean Up can be retried." };
  if (code === "inadmissible_aspect") return { error: "This photo's aspect ratio is not supported." };
  return { error: "Clean Up could not be started." };
}
