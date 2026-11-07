/**
 * Worker startup. This build refuses a Meshy credential and any provider
 * other than the local fake. The process does not print secret values.
 */

export type FurnitureGenerationWorkerStartup =
  | { ok: true; processingEnabled: boolean; pollIntervalMs: number; once: boolean }
  | { ok: false; missing: string };

export function evaluateFurnitureGenerationWorkerStartup(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): FurnitureGenerationWorkerStartup {
  if (env.MESHY_API_KEY?.trim()) return { ok: false, missing: "meshy_credentials_refused" };
  if (env.VIBODE_FURNITURE_GENERATION_PROVIDER !== "fake") {
    return { ok: false, missing: "provider_must_be_fake" };
  }
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
    processingEnabled: env.VIBODE_FURNITURE_GENERATION_WORKER_ENABLED === "true",
    pollIntervalMs,
    once: argv.includes("--once"),
  };
}
