import { launchBrowserPool } from "./browser.js";
import { createThumbnailApi } from "./client.js";
import { readWorkerEnv } from "./env.js";
import { workerFailure } from "./failures.js";
import { createHealthState, startHealthServer } from "./health.js";
import { runOnePoll, sleep } from "./orchestrate.js";

async function main() {
  const parsed = readWorkerEnv();
  if (!parsed.ok) {
    log("worker_config_invalid", { missing: parsed.missing });
    process.exit(1);
  }
  const env = parsed.env;
  const health = createHealthState();
  await startHealthServer(env.healthPort, health);
  log("worker_started", { pollIntervalMs: env.pollIntervalMs, healthPort: env.healthPort });
  let pool: Awaited<ReturnType<typeof launchBrowserPool>>;
  try {
    pool = await launchBrowserPool(env);
    health.browserLaunchedAt = new Date().toISOString();
    log("browser_launched", {});
  } catch (error) {
    log("browser_launch_failed", { message: error instanceof Error ? error.message : "launch failed" });
    process.exit(1);
  }
  const api = createThumbnailApi(env);
  let stop = false;
  const shutdown = () => {
    stop = true;
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  while (!stop) {
    try {
      const result = await runOnePoll({
        env,
        api,
        openSession: (job) => pool.openSession(job),
      });
      if (result.outcome === "idle" || !result.jobId) {
        if (result.outcome === "failed") {
          health.lastFailureAt = new Date().toISOString();
          health.lastFailureCode = result.code ?? "render_page_error";
          log("claim_failed", { code: result.code ?? "render_page_error" });
        } else if (!health.idle) {
          log("queue_idle", {});
        }
        health.idle = true;
        await sleep(env.pollIntervalMs);
        continue;
      }
      health.idle = false;
      if (result.jobId) health.lastClaimAt = new Date().toISOString();
      if (result.webglRenderer) health.webglRenderer = result.webglRenderer;
      if (result.outcome === "completed" && result.jobId) {
        health.jobsCompleted += 1;
        health.lastCompletedAt = new Date().toISOString();
        health.lastCompletedJobId = result.jobId;
        log("job_completed", { jobId: result.jobId, timingsMs: result.timingsMs, webglRenderer: result.webglRenderer });
      } else {
        health.lastFailureAt = new Date().toISOString();
        health.lastFailureCode = result.code ?? "render_page_error";
        health.lastFailureJobId = result.jobId ?? null;
        log("job_failed", { jobId: result.jobId ?? null, code: result.code ?? "render_page_error" });
        if (result.code === "browser_launch_failed" || !pool.launched()) {
          try {
            await pool.close();
            pool = await launchBrowserPool(env);
            health.browserLaunchedAt = new Date().toISOString();
            log("browser_relaunched", {});
          } catch {
            log("browser_launch_failed", { code: workerFailure("browser_launch_failed", "relaunch failed").code });
          }
        }
      }
    } catch (error) {
      health.lastFailureAt = new Date().toISOString();
      health.lastFailureCode = "render_page_error";
      log("poll_failed", { message: error instanceof Error ? error.message : "poll failed" });
      await sleep(env.pollIntervalMs);
    }
  }
  await pool.close();
}

function log(event: string, fields: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...fields })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "worker failed"}\n`);
  process.exit(1);
});
