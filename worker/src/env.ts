export type WorkerEnv = Readonly<{
  appBaseUrl: string;
  workerSecret: string;
  pollIntervalMs: number;
  healthPort: number;
  navigationTimeoutMs: number;
  readyTimeoutMs: number;
  screenshotTimeoutMs: number;
  publishTimeoutMs: number;
  browserRecycleAfterJobs: number;
}>;

const DEFAULTS = {
  pollIntervalMs: 4_000,
  healthPort: 8080,
  navigationTimeoutMs: 30_000,
  readyTimeoutMs: 90_000,
  screenshotTimeoutMs: 15_000,
  publishTimeoutMs: 30_000,
  browserRecycleAfterJobs: 25,
} as const;

export function readWorkerEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { ok: true; env: WorkerEnv } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const appBaseUrl = trim(env.VIBODE_APP_BASE_URL);
  const workerSecret = trim(env.VIBODE_THUMBNAIL_WORKER_SECRET);
  if (!appBaseUrl) missing.push("VIBODE_APP_BASE_URL");
  if (!workerSecret) missing.push("VIBODE_THUMBNAIL_WORKER_SECRET");
  if (appBaseUrl && !isHttpBase(appBaseUrl)) missing.push("VIBODE_APP_BASE_URL");
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    env: {
      appBaseUrl: appBaseUrl.replace(/\/$/, ""),
      workerSecret,
      pollIntervalMs: positiveInt(env.VIBODE_THUMBNAIL_POLL_INTERVAL_MS, DEFAULTS.pollIntervalMs),
      healthPort: positiveInt(env.PORT, DEFAULTS.healthPort),
      navigationTimeoutMs: positiveInt(env.VIBODE_THUMBNAIL_NAVIGATION_TIMEOUT_MS, DEFAULTS.navigationTimeoutMs),
      readyTimeoutMs: positiveInt(env.VIBODE_THUMBNAIL_READY_TIMEOUT_MS, DEFAULTS.readyTimeoutMs),
      screenshotTimeoutMs: positiveInt(env.VIBODE_THUMBNAIL_SCREENSHOT_TIMEOUT_MS, DEFAULTS.screenshotTimeoutMs),
      publishTimeoutMs: positiveInt(env.VIBODE_THUMBNAIL_PUBLISH_TIMEOUT_MS, DEFAULTS.publishTimeoutMs),
      browserRecycleAfterJobs: positiveInt(
        env.VIBODE_THUMBNAIL_BROWSER_RECYCLE_AFTER,
        DEFAULTS.browserRecycleAfterJobs,
      ),
    },
  };
}

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function isHttpBase(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
