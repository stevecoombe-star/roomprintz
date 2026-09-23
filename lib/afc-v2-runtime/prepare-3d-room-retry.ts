/**
 * Conservative production retry classification.
 *
 * Maps known AFC failure reasons onto certified PI-2 intents.
 * Add new entries to PERSPECTIVE_REREAD_FAILURES only for exact,
 * known settle/perspective failures. Unclassified failures retry as
 * run_again, never as a first-ever analyze.
 */

export const NO_APPLY_SAFE_CANDIDATE_FAILURE =
  "AFC settle failed closed: no_apply_safe_candidate." as const;

export type Prepare3dRequestIntent =
  | "analyze"
  | "run_again"
  | "reread_perspective";

export type Prepare3dRetryIntent = Exclude<Prepare3dRequestIntent, "analyze">;

const PERSPECTIVE_REREAD_FAILURES: readonly string[] = Object.freeze([
  NO_APPLY_SAFE_CANDIDATE_FAILURE,
  "AFC settle failed closed: no_apply_safe_candidate",
]);

function normalizedFailureReason(
  failureReason: string | null | undefined,
): string | null {
  if (typeof failureReason !== "string") return null;
  const trimmed = failureReason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function classifyPrepare3dRetry(
  failureReason: string | null | undefined,
): Prepare3dRetryIntent {
  const reason = normalizedFailureReason(failureReason);
  if (reason && PERSPECTIVE_REREAD_FAILURES.includes(reason)) {
    return "reread_perspective";
  }
  return "run_again";
}
