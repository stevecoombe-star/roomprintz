import { createHash } from "node:crypto";

import { HARMONIZE_HEARTBEAT_INTERVAL_MS } from "./policy";
import { assessHarmonizeJobOutput } from "./output";
import { classifyHarmonizeProviderFailure, type HarmonizeProvider } from "./provider";
import type { HarmonizeWorkerApi, HarmonizeWorkerClaim } from "./worker-api";

export type HarmonizeExecuteResult = Readonly<{
  outcome: "idle" | "succeeded" | "failed" | "stale";
  code: string | null;
  jobId: string | null;
  history?: Readonly<{ outcome: string; code: string | null; activated?: boolean | null }> | null;
}>;

/**
 * One claimed job. Provider contact is recorded before the paid request.
 * A lost fence never finalizes the row. Post-contact failures are terminal.
 */
export async function executeHarmonizeClaim(input: Readonly<{
  api: HarmonizeWorkerApi;
  provider: HarmonizeProvider;
  heartbeatIntervalMs?: number;
}>): Promise<HarmonizeExecuteResult> {
  const claim = await input.api.claim();
  if (!claim) return { outcome: "idle", code: input.api.claimDisposition?.() ?? null, jobId: null };
  const intervalMs = input.heartbeatIntervalMs ?? HARMONIZE_HEARTBEAT_INTERVAL_MS;
  const controller = new AbortController();
  let lost = false;
  const timer = setInterval(() => {
    void input.api.heartbeat(claim).then((ok) => {
      if (!ok) {
        lost = true;
        controller.abort();
      }
    }, () => {
      // A transport failure is not a lost lease. Handle it so Node does
      // not terminate the process, and leave the provider call running.
    });
  }, intervalMs);
  try {
    if (!(await input.api.heartbeat(claim))) {
      return { outcome: "stale", code: "stale_claim", jobId: claim.jobId };
    }
    const ready = await readJobInputs(input.api, claim);
    if (!ready.ok) {
      await input.api.fail(claim, {
        code: ready.code,
        message: ready.message,
        retryable: ready.retryable,
      });
      return { outcome: "failed", code: ready.code, jobId: claim.jobId };
    }
    const contact = await input.api.contact(claim);
    if (!contact.ok) {
      if (contact.code === "already_contacted") {
        await input.api.fail(claim, {
          code: "provider_uncertain",
          message: "Provider contact was already recorded.",
          retryable: false,
        });
        return { outcome: "failed", code: "provider_uncertain", jobId: claim.jobId };
      }
      if (contact.code === "worker_disabled") {
        await input.api.fail(claim, {
          code: "worker_interrupted",
          message: "Harmonize processing stopped before provider contact.",
          retryable: true,
        });
      }
      return { outcome: "failed", code: contact.code, jobId: claim.jobId };
    }
    let generated: Awaited<ReturnType<HarmonizeProvider>>;
    try {
      generated = await input.provider({
        prompt: claim.prompt,
        png: ready.png,
        signal: controller.signal,
      });
    } catch (error) {
      const failure = classifyHarmonizeProviderFailure(error);
      await input.api.fail(claim, failure);
      return { outcome: "failed", code: failure.code, jobId: claim.jobId };
    }
    if (lost || !(await input.api.heartbeat(claim))) {
      return { outcome: "stale", code: "stale_claim", jobId: claim.jobId };
    }
    const assessed = await assessHarmonizeJobOutput(
      generated.output,
      claim.compositeWidth,
      claim.compositeHeight,
      generated.outputMime,
    );
    if (!assessed.ok) {
      await input.api.fail(claim, {
        code: "unexpected_output",
        message: "Provider output did not match the decoded JPEG.",
        retryable: false,
        providerStatus: boundedToken(generated.providerStatus),
        providerHttpStatus: generated.httpStatus,
        latencyMs: generated.latencyMs,
      });
      return { outcome: "failed", code: "unexpected_output", jobId: claim.jobId };
    }
    if (lost || !(await input.api.heartbeat(claim))) {
      return { outcome: "stale", code: "stale_claim", jobId: claim.jobId };
    }
    const completed = await input.api.complete(claim, {
      output: generated.output,
      returnedModelId: boundedToken(generated.returnedModel),
      providerStatus: boundedToken(generated.providerStatus),
      providerHttpStatus: generated.httpStatus,
      latencyMs: generated.latencyMs,
    });
    if (!completed.ok) {
      return { outcome: "stale", code: completed.code, jobId: claim.jobId };
    }
    return {
      outcome: "succeeded",
      code: completed.code,
      jobId: claim.jobId,
      history: completed.history ?? { outcome: "skipped", code: null, activated: null },
    };
  } finally {
    clearInterval(timer);
  }
}

async function readJobInputs(
  api: HarmonizeWorkerApi,
  claim: HarmonizeWorkerClaim,
): Promise<
  | Readonly<{ ok: true; png: Uint8Array }>
  | Readonly<{ ok: false; code: string; message: string; retryable: boolean }>
> {
  const promptHash = createHash("sha256").update(claim.prompt).digest("hex");
  if (promptHash !== claim.promptSha256) {
    return {
      ok: false,
      code: "invalid_prompt",
      message: "Stored Harmonize prompt did not match its hash.",
      retryable: false,
    };
  }
  let png: Uint8Array;
  try {
    png = await api.composite(claim);
  } catch {
    return {
      ok: false,
      code: "worker_interrupted",
      message: "Composite was not readable before provider contact.",
      retryable: true,
    };
  }
  const compositeHash = createHash("sha256").update(png).digest("hex");
  if (compositeHash !== claim.compositeSha256) {
    return {
      ok: false,
      code: "invalid_composite",
      message: "Stored composite did not match its hash.",
      retryable: false,
    };
  }
  return { ok: true, png };
}

function boundedToken(value: string | null): string | null {
  if (!value || !/^[A-Za-z0-9._-]{1,80}$/.test(value)) return null;
  return value;
}
