/**
 * Continuous Clean Up loop.
 *
 * `enabled` is read on every pass from VIBODE_CLEANUP_WORKER_ENABLED.
 * An omitted callback does no work, so a caller cannot fall through to a
 * claim, a recovery, or a provider call. While processing is off the loop
 * sleeps and logs the disabled state once.
 * A stop signal does not abort an in-flight pass.
 */
export async function runCleanupWorker(input: Readonly<{
  once: () => Promise<Readonly<{ outcome: string; code: string | null; jobId: string | null }>>;
  pollIntervalMs: number;
  shouldStop: () => boolean;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  enabled?: () => boolean;
}>): Promise<number> {
  const processingEnabled = input.enabled ?? (() => false);
  let reportedDisabled = false;
  while (!input.shouldStop()) {
    if (!processingEnabled()) {
      if (!reportedDisabled) {
        input.log("processing_disabled", { processingEnabled: false });
        reportedDisabled = true;
      }
      await input.sleep(input.pollIntervalMs);
      continue;
    }
    if (reportedDisabled) {
      input.log("processing_enabled", { processingEnabled: true });
      reportedDisabled = false;
    }
    try {
      const result = await input.once();
      input.log("cleanup_pass", {
        outcome: result.outcome,
        code: result.code,
        jobId: result.jobId,
      });
      if (result.outcome === "idle" || result.outcome === "failed") {
        await input.sleep(input.pollIntervalMs);
      }
    } catch {
      input.log("cleanup_pass_failed", { outcome: "error", code: null, jobId: null });
      await input.sleep(input.pollIntervalMs);
    }
  }
  return 0;
}
