/**
 * One maintenance decision. Cleanup deletes temporary objects only when
 * its own flag is on. A processing pass still releases stale unsubmitted
 * reservations, and it does not delete storage while cleanup is off.
 */

import type { CleanupPassResult } from "@/lib/vibode-furniture/generation/pipeline";

export async function runFurnitureGenerationMaintenance(input: Readonly<{
  cleanupEnabled: boolean;
  processingEnabled: boolean;
  cleanup: () => Promise<CleanupPassResult>;
  sweep: () => Promise<void>;
  claim: () => Promise<{ action: string; jobId?: string | null }>;
}>): Promise<{ action: string; jobId: string | null }> {
  if (!input.cleanupEnabled && !input.processingEnabled) {
    return { action: "disabled", jobId: null };
  }
  if (input.cleanupEnabled) await input.cleanup();
  else await input.sweep();
  if (!input.processingEnabled) return { action: "cleanup", jobId: null };
  const claimed = await input.claim();
  return { action: claimed.action, jobId: claimed.jobId ?? null };
}
