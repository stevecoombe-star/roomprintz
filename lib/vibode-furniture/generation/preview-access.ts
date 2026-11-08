/**
 * A ready candidate stays previewable until the expiry already stored on the job.
 * This does not extend, clear, or rewrite that expiry.
 */
export function generationCandidateStillPreviewable(
  expiresAtMs: number | null,
  nowMs: number,
): boolean {
  return typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}
