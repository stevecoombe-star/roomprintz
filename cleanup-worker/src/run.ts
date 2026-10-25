export async function runCleanupWorker(input: Readonly<{
  once: () => Promise<Readonly<{ outcome: string; code: string | null; jobId: string | null }>>;
  pollIntervalMs: number;
  shouldStop: () => boolean;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, fields: Record<string, string | number | null>) => void;
}>): Promise<number> {
  while (!input.shouldStop()) {
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
