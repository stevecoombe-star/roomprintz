import type { ClaimedJob, ThumbnailApi } from "./client.js";
import { encodeThumbnailWebp } from "./encode.js";
import type { WorkerEnv } from "./env.js";
import {
  failureFromPage,
  failureFromTimeout,
  isTimeoutError,
  workerFailure,
  type WorkerFailure,
} from "./failures.js";

export const THUMBNAIL_FRAME_SELECTOR = "[data-vibode-thumbnail-frame]";

export type RenderReady = Readonly<{
  status?: string;
  error?: { code?: string; message?: string };
  webglRenderer?: string | null;
}>;

export type ThumbnailSession = Readonly<{
  goto: (url: string) => Promise<void>;
  waitForReady: () => Promise<RenderReady>;
  captureFrame: () => Promise<Uint8Array>;
  close: () => Promise<void>;
}>;

export type OrchestratorDeps = Readonly<{
  env: WorkerEnv;
  api: ThumbnailApi;
  openSession: (job: ClaimedJob) => Promise<ThumbnailSession>;
  encode?: (png: Uint8Array) => Promise<Uint8Array>;
  now?: () => number;
}>;

export type JobRunResult = Readonly<{
  outcome: "completed" | "failed" | "idle";
  jobId?: string;
  code?: string;
  timingsMs?: Readonly<{
    ready: number;
    screenshot: number;
    encode: number;
    publish: number;
    total: number;
  }>;
  webglRenderer?: string | null;
}>;

export async function runOnePoll(deps: OrchestratorDeps): Promise<JobRunResult> {
  const claimed = await deps.api.claim();
  if (!claimed.ok) {
    return { outcome: "failed", code: claimed.code };
  }
  if (!claimed.job) return { outcome: "idle" };
  return runClaimedJob(deps, claimed.job);
}

export async function runClaimedJob(
  deps: OrchestratorDeps,
  job: ClaimedJob,
): Promise<JobRunResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const encode = deps.encode ?? encodeThumbnailWebp;
  let session: ThumbnailSession | null = null;
  try {
    session = await deps.openSession(job);
    const readyStarted = now();
    let ready: RenderReady;
    try {
      await session.goto(renderUrl(deps.env, job));
    } catch (error) {
      const failure = isTimeoutError(error)
        ? failureFromTimeout("navigation")
        : workerFailure("render_page_error", "Render page navigation failed.");
      await deps.api.fail(job, failure);
      return { outcome: "failed", jobId: job.jobId, code: failure.code };
    }
    try {
      ready = await session.waitForReady();
    } catch (error) {
      const failure = isTimeoutError(error)
        ? failureFromTimeout("ready")
        : workerFailure("render_page_error", "Render readiness failed.");
      await deps.api.fail(job, failure);
      return { outcome: "failed", jobId: job.jobId, code: failure.code };
    }
    const readyMs = now() - readyStarted;
    if (ready.status !== "ready") {
      const failure = failureFromPage(ready.error?.code, ready.error?.message);
      await deps.api.fail(job, failure);
      return { outcome: "failed", jobId: job.jobId, code: failure.code, webglRenderer: ready.webglRenderer };
    }
    const shotStarted = now();
    let png: Uint8Array;
    try {
      png = await session.captureFrame();
    } catch (error) {
      const failure = isTimeoutError(error)
        ? failureFromTimeout("screenshot")
        : workerFailure("screenshot_failed", "Thumbnail frame capture failed.");
      await deps.api.fail(job, failure);
      return { outcome: "failed", jobId: job.jobId, code: failure.code };
    }
    const screenshotMs = now() - shotStarted;
    const encodeStarted = now();
    let webp: Uint8Array;
    try {
      webp = await encode(png);
    } catch {
      const failure = workerFailure("encode_failed", "WebP encode failed.");
      await deps.api.fail(job, failure);
      return { outcome: "failed", jobId: job.jobId, code: failure.code };
    }
    const encodeMs = now() - encodeStarted;
    const publishStarted = now();
    let published: { ok: true } | { ok: false; code: string };
    try {
      published = await deps.api.publish(job, webp);
    } catch (error) {
      const failure = isTimeoutError(error)
        ? failureFromTimeout("publish")
        : workerFailure("publish_failed", "Thumbnail publish failed.");
      await deps.api.fail(job, failure);
      return { outcome: "failed", jobId: job.jobId, code: failure.code };
    }
    if (!published.ok) {
      return { outcome: "failed", jobId: job.jobId, code: published.code };
    }
    return {
      outcome: "completed",
      jobId: job.jobId,
      webglRenderer: ready.webglRenderer,
      timingsMs: {
        ready: readyMs,
        screenshot: screenshotMs,
        encode: encodeMs,
        publish: now() - publishStarted,
        total: now() - started,
      },
    };
  } finally {
    await session?.close().catch(() => undefined);
  }
}

export function renderUrl(env: WorkerEnv, job: ClaimedJob): string {
  const url = new URL("/internal/vibode-thumbnail-render", env.appBaseUrl);
  url.searchParams.set("access", job.accessToken);
  return url.toString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { WorkerFailure };
