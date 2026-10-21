import { executeCleanupClaim, type CleanupGenerate } from "@/lib/vibode-stage/remove-cleanup-jobs/execute";
import {
  removeCleanupNbpOutputConfig,
  requestRemoveCleanupNbpCandidate,
} from "@/lib/vibode-stage/remove-cleanup-nbp.server";
import { createSupabaseCleanupControl } from "@/lib/vibode-stage/remove-cleanup-jobs/production.server";
import { createCleanupServiceClient } from "@/lib/vibode-stage/remove-cleanup-jobs/service-client";

import { runCleanupWorker } from "./run";

function log(event: string, fields: Record<string, string | number | null>): void {
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...fields })}\n`);
}

function providerMode(argv: readonly string[]): "google" | "fake" | null {
  const index = argv.indexOf("--provider");
  const mode = index >= 0 ? argv[index + 1] : "";
  return mode === "google" || mode === "fake" ? mode : null;
}

async function main(): Promise<void> {
  const mode = providerMode(process.argv.slice(2));
  if (!mode) {
    log("worker_config_invalid", { missing: "--provider google|fake" });
    process.exit(1);
  }
  if (mode === "fake" && process.env.NODE_ENV === "production") {
    log("worker_config_invalid", { missing: "fake provider is refused in production" });
    process.exit(1);
  }
  if (mode === "google" && !process.env.GEMINI_API_KEY?.trim() && !process.env.GOOGLE_API_KEY?.trim()) {
    log("worker_config_invalid", { missing: "GEMINI_API_KEY" });
    process.exit(1);
  }
  const client = createCleanupServiceClient();
  if (!client) {
    log("worker_config_invalid", { missing: "SUPABASE_SERVICE_ROLE_KEY" });
    process.exit(1);
  }
  const control = createSupabaseCleanupControl(client);
  const generate: CleanupGenerate = mode === "google"
    ? async ({ snapshot, signal }) => {
      const output = removeCleanupNbpOutputConfig(snapshot, "2K");
      if (!output) {
        return {
          ok: false,
          phase: "before_contact",
          code: "inadmissible_aspect",
          message: "The ORIGINAL aspect is outside the supported Nano Banana Pro families.",
          retryable: false,
          httpStatus: null,
          providerStatus: null,
          providerFields: [],
          postCount: 0,
          getCount: 0,
        };
      }
      return requestRemoveCleanupNbpCandidate({ snapshot, output, signal, env: process.env });
    }
    : await fakeGenerate();
  let stop = false;
  process.on("SIGTERM", () => {
    stop = true;
  });
  process.on("SIGINT", () => {
    stop = true;
  });
  log("worker_started", { provider: mode });
  await runCleanupWorker({
    once: () => executeCleanupClaim({ control, generate }),
    pollIntervalMs: 2000,
    shouldStop: () => stop,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log,
  });
}

async function fakeGenerate(): Promise<CleanupGenerate> {
  const sharp = (await import("sharp")).default;
  return async ({ snapshot, signal }) => {
    const output = removeCleanupNbpOutputConfig(snapshot, "2K");
    if (!output) {
      return {
        ok: false,
        phase: "before_contact",
        code: "inadmissible_aspect",
        message: "The ORIGINAL aspect is outside the supported Nano Banana Pro families.",
        retryable: false,
        httpStatus: null,
        providerStatus: null,
        providerFields: [],
        postCount: 0,
        getCount: 0,
      };
    }
    const [widthText, heightText] = output.aspectRatioFamily.split(":");
    const widthRatio = Number(widthText);
    const heightRatio = Number(heightText);
    const width = widthRatio >= heightRatio ? 1800 : Math.round(1800 * widthRatio / heightRatio);
    const height = widthRatio >= heightRatio ? Math.round(1800 * heightRatio / widthRatio) : 1800;
    const bytes = new Uint8Array(await sharp({
      create: { width, height, channels: 3, background: { r: 40, g: 40, b: 40 } },
    }).jpeg().toBuffer());
    return requestRemoveCleanupNbpCandidate({
      snapshot,
      output,
      apiKey: "cleanup-fake",
      signal,
      fetchImpl: async () => new Response(JSON.stringify({
        id: "cleanup-fake",
        status: "completed",
        steps: [{
          type: "model_output",
          content: [{ type: "image", mime_type: "image/jpeg", data: Buffer.from(bytes).toString("base64") }],
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });
  };
}

main().catch(() => {
  process.stderr.write("cleanup worker failed\n");
  process.exit(1);
});
