import { executeHarmonizeClaim } from "@/lib/vibode-stage/harmonize-jobs/execute";
import {
  createHarmonizeFakeProvider,
  createHarmonizeNbpProvider,
} from "@/lib/vibode-stage/harmonize-jobs/provider";
import { harmonizeWorkerProcessingEnabled } from "@/lib/vibode-stage/harmonize-jobs/worker-enabled";

import { createHarmonizeWorkerHealthState, startHarmonizeWorkerHealthServer } from "./health";
import { createHttpHarmonizeWorkerApi, createHttpHarmonizeWorkerControl } from "./http-api";
import { runHarmonizeWorker } from "./run";
import { evaluateHarmonizeWorkerStartup } from "./startup";

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
  const startup = evaluateHarmonizeWorkerStartup(process.env, process.argv.slice(2));
  if (!startup.ok) {
    log("worker_config_invalid", { missing: startup.missing });
    process.exit(1);
  }
  const provider = startup.providerMode === "google"
    ? createHarmonizeNbpProvider({ apiKey: startup.apiKey ?? "" })
    : createHarmonizeFakeProvider();
  const jobId = startup.selection.mode === "once" ? startup.selection.jobId : null;
  const api = createHttpHarmonizeWorkerApi(startup.env, { jobId });
  const control = createHttpHarmonizeWorkerControl(startup.env);
  const healthState = createHarmonizeWorkerHealthState(startup.providerMode);
  let activePasses = 0;
  const beginPass = () => {
    activePasses += 1;
    healthState.idle = false;
  };
  const endPass = () => {
    activePasses = Math.max(0, activePasses - 1);
    healthState.idle = activePasses === 0;
  };
  const health = await startHarmonizeWorkerHealthServer({
    port: startup.port,
    snapshot: () => healthState.snapshot(harmonizeWorkerProcessingEnabled(process.env)),
  });
  let stop = false;
  // Signals only ask the loop to stop. They do not abort the in-flight
  // provider call, shorten its timeout, or start another claim.
  // An already contacted generation keeps its heartbeat and completion
  // route so it can settle. The enable flag blocks the next claim.
  process.on("SIGTERM", () => {
    stop = true;
  });
  process.on("SIGINT", () => {
    stop = true;
  });
  log("worker_started", startup.selection.mode === "once"
    ? {
      pollIntervalMs: String(startup.env.pollIntervalMs),
      provider: startup.providerMode,
      processingEnabled: startup.processingEnabled,
      mode: "once",
      jobId: startup.selection.jobId,
    }
    : {
      pollIntervalMs: String(startup.env.pollIntervalMs),
      provider: startup.providerMode,
      processingEnabled: startup.processingEnabled,
    });
  const code = await runHarmonizeWorker({
    selection: startup.selection,
    enabled: () => harmonizeWorkerProcessingEnabled(process.env),
    execute: async () => {
      beginPass();
      try {
        const result = await executeHarmonizeClaim({ api, provider });
        healthState.noteGeneration(result);
        return result;
      } finally {
        endPass();
      }
    },
    recover: async () => {
      beginPass();
      try {
        const result = await control.recover();
        healthState.noteRecovery(result);
        return result;
      } finally {
        endPass();
      }
    },
    refreshOperations: async () => {
      const operations = await control.operations();
      if (operations) healthState.noteOperations(operations);
    },
    pollIntervalMs: startup.env.pollIntervalMs,
    shouldStop: () => stop,
    sleep: (ms) => interruptibleSleep(ms, () => stop),
    log,
  });
  await health.close();
  if (code !== 0) process.exit(code);
}

main().catch(() => {
  process.stderr.write("harmonize worker failed\n");
  process.exit(1);
});
