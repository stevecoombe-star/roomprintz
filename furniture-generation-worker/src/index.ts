/**
 * Local worker process. Provider POSTs stay off in this build.
 * The transport never calls the network. Do not deploy this process.
 */

import { createMeshyAdapter } from "@/lib/vibode-furniture/generation/meshy-adapter";
import type { MeshyTransportResult } from "@/lib/vibode-furniture/generation/meshy-task";
import {
  cleanupTemporaryGenerationObjects,
  executeFurnitureGenerationClaim,
} from "@/lib/vibode-furniture/generation/pipeline";
import { productionFurnitureGenerationDeps } from "@/lib/vibode-furniture/generation/production.server";
import { validatePersonalFurnitureGlb } from "@/lib/vibode-furniture/validate.server";

import { runFurnitureGenerationWorker } from "./run";
import { evaluateFurnitureGenerationWorkerStartup } from "./startup";

const WORKER_POSTS_ENABLED = false;

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
  const deps = productionFurnitureGenerationDeps();
  if (!deps) {
    log("worker_config_invalid", { missing: "service_role", action: "invalid", jobId: null });
    process.exit(1);
  }
  const adapter = createMeshyAdapter({
    async request(): Promise<MeshyTransportResult> {
      return { kind: "network" };
    },
  });
  let stop = false;
  process.on("SIGTERM", () => {
    stop = true;
  });
  process.on("SIGINT", () => {
    stop = true;
  });
  log("worker_started", {
    provider: "fake",
    postsEnabled: WORKER_POSTS_ENABLED,
    processingEnabled: startup.processingEnabled,
    action: "started",
    jobId: null,
  });
  const code = await runFurnitureGenerationWorker({
    enabled: () => startup.processingEnabled,
    once: startup.once,
    execute: async () => {
      await cleanupTemporaryGenerationObjects({
        commands: deps.commands,
        objects: deps.objects,
        nowMs: Date.now(),
      });
      return executeFurnitureGenerationClaim({
        commands: deps.commands,
        objects: deps.objects,
        adapter,
        download: async () => ({ kind: "network" }),
        validate: validatePersonalFurnitureGlb,
        nowMs: Date.now(),
        submitAllowed: WORKER_POSTS_ENABLED,
      });
    },
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
