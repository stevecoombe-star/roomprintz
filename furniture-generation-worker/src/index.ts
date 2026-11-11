/**
 * Generation worker process. Fake mode never posts. Real mode can post only
 * when the ledger's live switch and paid-submission allowance both allow it.
 * Do not deploy this process or configure a credential in this phase.
 */

import {
  cleanupTemporaryGenerationObjects,
  executeFurnitureGenerationClaim,
} from "@/lib/vibode-furniture/generation/pipeline";
import { productionFurnitureGenerationDeps } from "@/lib/vibode-furniture/generation/production.server";
import { validatePersonalFurnitureGlb } from "@/lib/vibode-furniture/validate.server";

import { runFurnitureGenerationMaintenance } from "./maintenance";
import { createFurnitureGenerationWorkerRuntime } from "./provider";
import { runFurnitureGenerationWorker } from "./run";
import { evaluateFurnitureGenerationWorkerStartup } from "./startup";

function log(event: string, fields: Record<string, string | number | boolean | null>): void {
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...fields })}\n`);
}

async function interruptibleSleep(ms: number, shouldStop: () => boolean): Promise<void> {
  let remaining = ms;
  while (remaining > 0 && !shouldStop()) {
    const slice = Math.min(250, remaining);
    await new Promise((resolve) => setTimeout(resolve, slice));
    remaining -= slice;
  }
}

async function main(): Promise<void> {
  const startup = evaluateFurnitureGenerationWorkerStartup(process.env, process.argv.slice(2));
  if (!startup.ok) {
    log("worker_config_invalid", { missing: startup.missing, action: "invalid", jobId: null });
    process.exit(1);
  }
  const runtime = createFurnitureGenerationWorkerRuntime({
    env: process.env,
    fetchImpl: fetch,
    log,
  });
  if (!runtime.ok) {
    log("worker_config_invalid", { missing: runtime.missing, action: "invalid", jobId: null });
    process.exit(1);
  }
  const deps = productionFurnitureGenerationDeps();
  if (!deps) {
    log("worker_config_invalid", { missing: "service_role", action: "invalid", jobId: null });
    process.exit(1);
  }
  let stop = false;
  process.on("SIGTERM", () => {
    stop = true;
  });
  process.on("SIGINT", () => {
    stop = true;
  });
  log("worker_started", {
    provider: runtime.runtime.mode,
    postsEnabled: runtime.runtime.submitAllowed,
    processingEnabled: startup.processingEnabled,
    cleanupEnabled: startup.cleanupEnabled,
    action: "started",
    jobId: null,
  });
  const code = await runFurnitureGenerationWorker({
    enabled: () => startup.processingEnabled || startup.cleanupEnabled,
    once: startup.once,
    execute: () => runFurnitureGenerationMaintenance({
      cleanupEnabled: startup.cleanupEnabled,
      processingEnabled: startup.processingEnabled,
      cleanup: async () => {
        const cleaned = await cleanupTemporaryGenerationObjects({
          commands: deps.commands,
          objects: deps.objects,
          nowMs: Date.now(),
          log,
        });
        log("cleanup_pass", {
          processed: cleaned.processed,
          deleted: cleaned.deleted,
          skipped: cleaned.skipped,
          failed: cleaned.failed,
          retainedForReview: cleaned.retainedForReview,
          action: "cleanup",
          jobId: null,
        });
        return cleaned;
      },
      sweep: () => deps.commands.sweep(Date.now()),
      claim: () => executeFurnitureGenerationClaim({
        commands: deps.commands,
        objects: deps.objects,
        adapter: runtime.runtime.adapter,
        download: runtime.runtime.download,
        validate: validatePersonalFurnitureGlb,
        nowMs: Date.now(),
        submitAllowed: runtime.runtime.submitAllowed,
      }),
    }),
    pollIntervalMs: startup.pollIntervalMs,
    shouldStop: () => stop,
    sleep: (ms) => interruptibleSleep(ms, () => stop),
    log,
  });
  if (code !== 0) process.exit(code);
}

main().catch(() => {
  process.stderr.write("furniture generation worker failed\n");
  process.exit(1);
});
