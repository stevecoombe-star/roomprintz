import type { HarmonizeExecuteResult } from "@/lib/vibode-stage/harmonize-jobs/execute";

import type { HarmonizeWorkerSelection } from "./args";

/**
 * Once mode returns after a single execute. Exit 0 means the provider JPEG
 * was stored and the job reached succeeded. History publication is reported
 * separately and does not change that exit. Any other generation result is
 * nonzero and does not start another claim or provider call.
 */
export async function runHarmonizeWorker(input: Readonly<{
  selection: HarmonizeWorkerSelection;
  execute: () => Promise<HarmonizeExecuteResult>;
  pollIntervalMs: number;
  shouldStop: () => boolean;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, fields: Record<string, string | number | null>) => void;
}>): Promise<number> {
  if (input.selection.mode === "once") {
    const jobId = input.selection.jobId;
    if (input.shouldStop()) {
      input.log("job_finished", {
        outcome: "cancelled",
        code: "cancelled",
        jobId,
        historyOutcome: null,
        historyCode: null,
      });
      return 1;
    }
    try {
      const result = await input.execute();
      input.log("job_finished", {
        outcome: result.outcome,
        code: result.code ?? (result.outcome === "idle" ? "not_claimed" : null),
        jobId: result.jobId ?? jobId,
        historyOutcome: result.history?.outcome ?? null,
        historyCode: result.history?.code ?? null,
      });
      return result.outcome === "succeeded" ? 0 : 1;
    } catch {
      input.log("job_finished", {
        outcome: "failed",
        code: "poll_failed",
        jobId,
        historyOutcome: null,
        historyCode: null,
      });
      return 1;
    }
  }

  while (!input.shouldStop()) {
    try {
      const result = await input.execute();
      if (result.outcome !== "idle") {
        input.log("job_finished", {
          outcome: result.outcome,
          code: result.code,
          jobId: result.jobId,
          historyOutcome: result.history?.outcome ?? null,
          historyCode: result.history?.code ?? null,
        });
      }
    } catch {
      input.log("poll_failed", { message: "poll_failed" });
    }
    if (!input.shouldStop()) await input.sleep(input.pollIntervalMs);
  }
  return 0;
}
