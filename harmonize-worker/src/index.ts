import { executeHarmonizeClaim } from "@/lib/vibode-stage/harmonize-jobs/execute";
import {
  createHarmonizeFakeProvider,
  createHarmonizeNbpProvider,
  readHarmonizeWorkerProviderMode,
} from "@/lib/vibode-stage/harmonize-jobs/provider";
import { readHarmonizeNbpApiKey } from "@/lib/vibode-stage/harmonize-nbp-proof";

import { parseHarmonizeWorkerArgs } from "./args";
import { createHttpHarmonizeWorkerApi, readHarmonizeWorkerProcessEnv } from "./http-api";
import { runHarmonizeWorker } from "./run";

function log(event: string, fields: Record<string, string | number | null>): void {
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...fields })}\n`);
}

async function main(): Promise<void> {
  const args = parseHarmonizeWorkerArgs(process.argv.slice(2));
  if (!args.ok) {
    log("worker_config_invalid", { missing: args.code });
    process.exit(1);
  }
  const providerMode = readHarmonizeWorkerProviderMode(process.env);
  if (!providerMode.ok) {
    log("worker_config_invalid", { missing: providerMode.code });
    process.exit(1);
  }
  const parsed = readHarmonizeWorkerProcessEnv(process.env, {
    requireProviderCredentials: providerMode.mode === "google",
  });
  if (!parsed.ok) {
    log("worker_config_invalid", { missing: parsed.missing.join(",") });
    process.exit(1);
  }
  const apiKey = providerMode.mode === "google" ? readHarmonizeNbpApiKey(process.env) : null;
  if (providerMode.mode === "google" && !apiKey) {
    log("worker_config_invalid", { missing: "GEMINI_API_KEY" });
    process.exit(1);
  }
  const jobId = args.selection.mode === "once" ? args.selection.jobId : null;
  const api = createHttpHarmonizeWorkerApi(parsed.env, {
    jobId,
  });
  const provider = apiKey
    ? createHarmonizeNbpProvider({ apiKey })
    : createHarmonizeFakeProvider();
  let stop = false;
  // Signals only ask the loop to stop. They do not abort the in-flight
  // provider call, shorten its timeout, or start another claim.
  process.on("SIGTERM", () => {
    stop = true;
  });
  process.on("SIGINT", () => {
    stop = true;
  });
  log("worker_started", args.selection.mode === "once"
    ? {
      pollIntervalMs: String(parsed.env.pollIntervalMs),
      provider: providerMode.mode,
      mode: "once",
      jobId: args.selection.jobId,
    }
    : {
      pollIntervalMs: String(parsed.env.pollIntervalMs),
      provider: providerMode.mode,
    });
  const code = await runHarmonizeWorker({
    selection: args.selection,
    execute: () => executeHarmonizeClaim({ api, provider }),
    pollIntervalMs: parsed.env.pollIntervalMs,
    shouldStop: () => stop,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log,
  });
  if (code !== 0) process.exit(code);
}

main().catch(() => {
  process.stderr.write("harmonize worker failed\n");
  process.exit(1);
});
