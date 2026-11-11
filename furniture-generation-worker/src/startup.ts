/**
 * Worker startup. Fake mode is the default. A Meshy key does not select
 * real mode. Incomplete real-mode configuration refuses to boot.
 * The result never contains the credential.
 */

import { furnitureGenerationCleanupDecision } from "@/lib/vibode-furniture/generation/policy";

import { resolveFurnitureGenerationProvider } from "./provider";

export type FurnitureGenerationWorkerStartup =
  | {
    ok: true;
    mode: "fake" | "meshy";
    processingEnabled: boolean;
    cleanupEnabled: boolean;
    pollIntervalMs: number;
    once: boolean;
  }
  | { ok: false; missing: string };

export function evaluateFurnitureGenerationWorkerStartup(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): FurnitureGenerationWorkerStartup {
  const cleanup = furnitureGenerationCleanupDecision(env);
  if (!cleanup.ok) return cleanup;
  const provider = resolveFurnitureGenerationProvider(env);
  if (!provider.ok) return provider;
  const rawPoll = env.VIBODE_FURNITURE_GENERATION_WORKER_POLL_MS;
  let pollIntervalMs = 5_000;
  if (rawPoll != null && rawPoll !== "") {
    const parsed = Number(rawPoll);
    if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 60_000) {
      return { ok: false, missing: "poll_interval" };
    }
    pollIntervalMs = parsed;
  }
  return {
    ok: true,
    mode: provider.mode,
    processingEnabled: env.VIBODE_FURNITURE_GENERATION_WORKER_ENABLED === "true",
    cleanupEnabled: cleanup.enabled,
    pollIntervalMs,
    once: argv.includes("--once"),
  };
}
