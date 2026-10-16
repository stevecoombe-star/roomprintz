import type { HarmonizeExecuteResult } from "@/lib/vibode-stage/harmonize-jobs/execute";
import { HARMONIZE_GLOBAL_DEFER_BACKOFF_MS } from "@/lib/vibode-stage/harmonize-jobs/policy";

import type { HarmonizeWorkerSelection } from "./args";
import type { HarmonizeWorkerRecoveryResult } from "./http-api";

/**
 * Once mode returns after a single execute. Exit 0 means the provider JPEG
 * was stored and the job reached succeeded. History publication is reported
 * separately and does not change that exit. Any other generation result is
 * nonzero and does not start another claim or provider call.
 *
 * Continuous mode runs two loops in one process. Generation claims stay
 * serial: the next claim waits until the current generation returns.
 * Recovery claims on its own cadence, including while a generation is in
 * progress, deferred, or failing. Recovery never calls the provider.
 * The process entry passes `enabled` from VIBODE_HARMONIZE_WORKER_ENABLED.
 * An omitted callback does no work, so a caller cannot fall through to a claim.
 * A stop signal does not abort the in-flight generation or recovery.
 */
export async function runHarmonizeWorker(input: Readonly<{
  selection: HarmonizeWorkerSelection;
  execute: () => Promise<HarmonizeExecuteResult>;
  recover?: () => Promise<HarmonizeWorkerRecoveryResult>;
  refreshOperations?: () => Promise<void>;
  enabled?: () => boolean;
  pollIntervalMs: number;
  deferBackoffMs?: number;
  shouldStop: () => boolean;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, fields: Record<string, string | number | boolean | null>) => void;
}>): Promise<number> {
  const processingEnabled = input.enabled ?? (() => false);
  if (input.selection.mode === "once") {
    const jobId = input.selection.jobId;
    if (!processingEnabled()) {
      input.log("job_finished", finished("cancelled", "worker_disabled", jobId));
      return 1;
    }
    if (input.shouldStop()) {
      input.log("job_finished", finished("cancelled", "cancelled", jobId));
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
        historyActivated: historyActivated(result.history),
      });
      return result.outcome === "succeeded" ? 0 : 1;
    } catch {
      input.log("job_finished", finished("failed", "poll_failed", jobId));
      return 1;
    }
  }

  let reportedDisabled = false;
  const generation = (async () => {
    while (!input.shouldStop()) {
      if (!processingEnabled()) {
        if (!reportedDisabled) {
          input.log("processing_disabled", { processingEnabled: false });
          reportedDisabled = true;
        }
        await refreshOperations(input);
        await input.sleep(input.pollIntervalMs);
        continue;
      }
      if (reportedDisabled) {
        input.log("processing_enabled", { processingEnabled: true });
        reportedDisabled = false;
      }
      let defer = false;
      try {
        const result = await input.execute();
        if (deferredGeneration(result)) {
          defer = true;
          input.log("generation_deferred", { code: result.code });
        } else if (result.outcome !== "idle") {
          input.log("job_finished", {
            outcome: result.outcome,
            code: result.code,
            jobId: result.jobId,
            historyOutcome: result.history?.outcome ?? null,
            historyCode: result.history?.code ?? null,
            historyActivated: historyActivated(result.history),
          });
        }
      } catch {
        input.log("poll_failed", { message: "poll_failed" });
        defer = true;
      }
      if (input.shouldStop() || !processingEnabled()) {
        if (!input.shouldStop()) await input.sleep(input.pollIntervalMs);
        continue;
      }
      await input.sleep(waitMs(input, defer));
    }
  })();
  const recovery = (async () => {
    if (!input.recover) return;
    while (!input.shouldStop()) {
      if (!processingEnabled()) {
        await input.sleep(input.pollIntervalMs);
        continue;
      }
      let defer = false;
      try {
        const recovered = await input.recover();
        if (recovered.outcome === "unavailable") defer = true;
        if (recovered.outcome !== "idle") {
          input.log("recovery_finished", {
            outcome: recovered.outcome,
            code: recovered.code,
            kind: recovered.kind,
            activated: recovered.activated,
            blocked: recovered.blocked,
          });
        }
      } catch {
        input.log("recovery_failed", { message: "recovery_failed" });
        defer = true;
      }
      if (input.shouldStop() || !processingEnabled()) {
        if (!input.shouldStop()) await input.sleep(input.pollIntervalMs);
        continue;
      }
      await input.sleep(waitMs(input, defer));
    }
  })();
  await Promise.all([generation, recovery]);
  return 0;
}

function waitMs(
  input: Readonly<{ pollIntervalMs: number; deferBackoffMs?: number }>,
  defer: boolean,
): number {
  const backoff = input.deferBackoffMs ?? HARMONIZE_GLOBAL_DEFER_BACKOFF_MS;
  return defer ? Math.max(input.pollIntervalMs, backoff) : input.pollIntervalMs;
}

async function refreshOperations(input: Readonly<{ refreshOperations?: () => Promise<void> }>): Promise<void> {
  if (!input.refreshOperations) return;
  try {
    await input.refreshOperations();
  } catch {
    // A status read is not a claim and must not stop the loop.
  }
}

function deferredGeneration(result: HarmonizeExecuteResult): boolean {
  return result.outcome === "idle" && (
    result.code === "global_busy"
    || result.code === "global_daily_limit"
    || result.code === "worker_disabled"
  );
}

function finished(
  outcome: string,
  code: string,
  jobId: string,
): Record<string, string | number | boolean | null> {
  return {
    outcome,
    code,
    jobId,
    historyOutcome: null,
    historyCode: null,
    historyActivated: null,
  };
}

function historyActivated(history: Readonly<{ activated?: unknown }> | null | undefined): boolean | null {
  if (!history) return null;
  if (history.activated === true) return true;
  if (history.activated === false) return false;
  return null;
}
