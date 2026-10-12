import { executeHarmonizeClaim } from "@/lib/vibode-stage/harmonize-jobs/execute";
import { createHarmonizeNbpProvider } from "@/lib/vibode-stage/harmonize-jobs/provider";
import { readHarmonizeNbpApiKey } from "@/lib/vibode-stage/harmonize-nbp-proof";

import { createHttpHarmonizeWorkerApi, readHarmonizeWorkerProcessEnv } from "./http-api";

function log(event: string, fields: Record<string, string | number | null>): void {
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...fields })}\n`);
}

async function main(): Promise<void> {
  const parsed = readHarmonizeWorkerProcessEnv();
  if (!parsed.ok) {
    log("worker_config_invalid", { missing: parsed.missing.join(",") });
    process.exit(1);
  }
  const apiKey = readHarmonizeNbpApiKey(process.env);
  if (!apiKey) {
    log("worker_config_invalid", { missing: "GEMINI_API_KEY" });
    process.exit(1);
  }
  const api = createHttpHarmonizeWorkerApi(parsed.env);
  const provider = createHarmonizeNbpProvider({ apiKey });
  let stop = false;
  process.on("SIGTERM", () => {
    stop = true;
  });
  process.on("SIGINT", () => {
    stop = true;
  });
  log("worker_started", { pollIntervalMs: String(parsed.env.pollIntervalMs) });
  while (!stop) {
    try {
      const result = await executeHarmonizeClaim({ api, provider });
      if (result.outcome !== "idle") {
        log("job_finished", {
          outcome: result.outcome,
          code: result.code,
          jobId: result.jobId,
        });
      }
    } catch {
      log("poll_failed", { message: "poll_failed" });
    }
    if (!stop) {
      await new Promise((resolve) => setTimeout(resolve, parsed.env.pollIntervalMs));
    }
  }
}

main().catch(() => {
  process.stderr.write("harmonize worker failed\n");
  process.exit(1);
});
