/**
 * Owner recent-generation read rules. The list is capped at 20 and contains
 * no storage paths, provider task ids, credits, or spending controls.
 */

export const OWNER_RECENT_GENERATION_LIMIT = 20;

const CUSTOMER_ERROR_CLASSES = new Set([
  "provider_rejected",
  "provider_failed",
  "rate_limited",
  "ambiguous_timeout",
  "invalid_output",
  "oversized_output",
  "ingest_failed",
  "input_storage_failed",
  "needs_review",
]);

export function customerGenerationErrorClass(value: unknown): string | null {
  if (value === "credit_unreported") return "needs_review";
  if (value === "provider_payment" || value === "provider_auth" || value === "provider_forbidden") {
    return "provider_failed";
  }
  if (value === "submission_budget_exhausted") return null;
  if (typeof value === "string" && CUSTOMER_ERROR_CLASSES.has(value)) return value;
  return null;
}

export function ownerRecentRecoverable(input: Readonly<{
  status: string;
  saved: boolean;
  expiresAtMs: number | null;
  nowMs: number;
}>): boolean {
  if (input.status === "ready") {
    return !input.saved
      && typeof input.expiresAtMs === "number"
      && Number.isFinite(input.expiresAtMs)
      && input.expiresAtMs > input.nowMs;
  }
  return input.status === "reserved"
    || input.status === "submitting"
    || input.status === "ambiguous"
    || input.status === "running"
    || input.status === "ingesting"
    || input.status === "needs_review";
}

export function ownerRecentPreviewAvailable(input: Readonly<{
  status: string;
  saved: boolean;
  expiresAtMs: number | null;
  hasOutput: boolean;
  nowMs: number;
}>): boolean {
  return input.status === "ready"
    && !input.saved
    && input.hasOutput
    && typeof input.expiresAtMs === "number"
    && Number.isFinite(input.expiresAtMs)
    && input.expiresAtMs > input.nowMs;
}
