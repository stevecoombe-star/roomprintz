/**
 * One generation claim at a time. A stop request waits for the current
 * pass. The next pass does not start while the current one is running.
 */

export async function runFurnitureGenerationWorker(input: Readonly<{
  enabled: () => boolean;
  once: boolean;
  execute: () => Promise<{ action: string; jobId?: string | null }>;
  pollIntervalMs: number;
  shouldStop: () => boolean;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, fields: Record<string, string | number | boolean | null>) => void;
}>): Promise<number> {
  const pass = async () => {
    const result = await input.execute();
    input.log("generation_pass", { action: result.action, jobId: result.jobId ?? null });
  };
  if (input.once) {
    if (!input.enabled()) {
      input.log("worker_disabled", { action: "disabled", jobId: null });
      return 1;
    }
    await pass();
    return 0;
  }
  while (!input.shouldStop()) {
    if (input.enabled()) await pass();
    else input.log("worker_disabled", { action: "disabled", jobId: null });
    if (input.shouldStop()) break;
    await input.sleep(input.pollIntervalMs);
  }
  return 0;
}
