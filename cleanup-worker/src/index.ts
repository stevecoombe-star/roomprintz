import { executeCleanupClaim, type CleanupGenerate } from "@/lib/vibode-stage/remove-cleanup-jobs/execute";
import { authorizeCleanupWorkerClaim } from "@/lib/vibode-stage/remove-cleanup-jobs/worker-auth";
import { cleanupWorkerProcessingEnabled } from "@/lib/vibode-stage/remove-cleanup-jobs/worker-enabled";
import {
  removeCleanupNbpOutputConfig,
  requestRemoveCleanupNbpCandidate,
} from "@/lib/vibode-stage/remove-cleanup-nbp.server";
import { createSupabaseCleanupControl } from "@/lib/vibode-stage/remove-cleanup-jobs/production.server";
import { createCleanupServiceClient } from "@/lib/vibode-stage/remove-cleanup-jobs/service-client";

import { startCleanupWorkerHealthServer } from "./health";
import { runCleanupWorker } from "./run";
import { evaluateCleanupWorkerStartup } from "./startup";

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
  const startup = evaluateCleanupWorkerStartup(process.env, process.argv.slice(2));
  if (!startup.ok) {
    log("worker_config_invalid", { missing: startup.missing });
    process.exit(1);
  }
  const client = createCleanupServiceClient();
  if (!client) {
    log("worker_config_invalid", { missing: "SUPABASE_SERVICE_ROLE_KEY" });
    process.exit(1);
  }
  const control = createSupabaseCleanupControl(client);
  const generate: CleanupGenerate = startup.providerMode === "google"
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
  let idle = true;
  const health = await startCleanupWorkerHealthServer({
    port: startup.port,
    snapshot: () => ({
      status: "ok",
      live: true,
      ready: true,
      readiness: "process",
      processingEnabled: cleanupWorkerProcessingEnabled(process.env),
      idle,
      provider: startup.providerMode,
    }),
  });
  let stop = false;
  process.on("SIGTERM", () => {
    stop = true;
  });
  process.on("SIGINT", () => {
    stop = true;
  });
  log("worker_started", {
    provider: startup.providerMode,
    processingEnabled: startup.processingEnabled,
  });
  await runCleanupWorker({
    enabled: () => cleanupWorkerProcessingEnabled(process.env),
    once: async () => {
      idle = false;
      try {
        return await executeCleanupClaim({
          control,
          generate,
          authorizeClaim: (claimed) => authorizeCleanupWorkerClaim(
            async ({ roomId }) => {
              const result = await client.from("vibode_rooms").select("user_id").eq("id", roomId).maybeSingle();
              const ownerId = result.data && typeof result.data.user_id === "string" ? result.data.user_id : "";
              if (result.error || !ownerId) return { data: null, error: result.error ?? { message: "missing" } };
              return { data: { ownerId }, error: null };
            },
            { userId: claimed.userId, roomId: claimed.roomId },
          ),
        });
      } finally {
        idle = true;
      }
    },
    pollIntervalMs: 2000,
    shouldStop: () => stop,
    sleep: (ms) => interruptibleSleep(ms, () => stop),
    log,
  });
  await health.close();
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
