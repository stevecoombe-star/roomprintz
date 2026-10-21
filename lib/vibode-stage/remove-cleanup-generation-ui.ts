import type { CleanupPublicStatus } from "@/lib/vibode-stage/remove-cleanup-jobs/types";

export type CleanupReviewMode = "original" | "candidate" | "compare";

export type CleanupGenerationPhase =
  | "idle"
  | "confirming"
  | "preparing"
  | "queued"
  | "generating"
  | "completed"
  | "failed"
  | "discarded";

export function removeCleanupGenerationAvailability(input: Readonly<{
  segmentationPhase: "idle" | "loading" | "ready" | "error";
  hiddenCount: number;
  busy: boolean;
}>): boolean {
  return input.segmentationPhase === "ready" && input.hiddenCount > 0 && input.busy !== true;
}

export function cleanupGenerationPhaseFromStatus(status: CleanupPublicStatus): CleanupGenerationPhase {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "generating";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
    case "discarded":
      return "discarded";
    default:
      return "idle";
  }
}

export function cleanupGenerationStatusLabel(phase: CleanupGenerationPhase): string {
  switch (phase) {
    case "preparing":
      return "Preparing";
    case "queued":
      return "Queued";
    case "generating":
      return "Generating";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "discarded":
      return "Discarded";
    default:
      return "Clean Up Room";
  }
}

export function describeCleanupGenerationSelection(
  objects: readonly Readonly<{ concept: string }>[],
): Readonly<{ count: number; concepts: readonly string[] }> {
  const concepts = [...new Set(objects.map((object) => object.concept))].sort();
  return { count: objects.length, concepts };
}

export const REMOVE_CLEANUP_RETRY_NOTE =
  "Retry creates a new generation attempt from the same stored inputs.";

export function removeCleanupRetryAvailable(input: Readonly<{
  status: CleanupPublicStatus | null;
  busy: boolean;
}>): boolean {
  return input.status === "failed" && input.busy !== true;
}

export function cleanupGenerationErrorCopy(code: string | null): string | null {
  if (!code) return null;
  if (code === "daily_limit" || code === "global_daily_limit") return "Daily Clean Up limit reached.";
  if (code === "active_job") return "A Clean Up job is already active.";
  if (code === "inadmissible_aspect") return "This photo's aspect ratio is not supported.";
  if (code === "provider_rejected") return "The provider refused this Clean Up.";
  if (code === "provider_uncertain") return "Clean Up did not finish. It was not sent again.";
  return "Clean Up could not be started.";
}
