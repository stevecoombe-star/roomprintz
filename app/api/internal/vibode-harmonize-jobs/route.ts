import { NextResponse } from "next/server";

import { runServiceHarmonizeHistoryRecovery } from "@/lib/vibode-stage/harmonize-jobs/history-recovery.server";
import { harmonizeJson } from "@/lib/vibode-stage/harmonize-jobs/http";
import { isHarmonizeJobId } from "@/lib/vibode-stage/harmonize-jobs/job-id";
import {
  claimHarmonizeGeneration,
  completeHarmonizeGeneration,
  contactHarmonizeGeneration,
  failHarmonizeGeneration,
  heartbeatHarmonizeGeneration,
  readHarmonizeComposite,
  readHarmonizeWorkerOperations,
} from "@/lib/vibode-stage/harmonize-jobs/jobs.server";
import { HARMONIZE_JOB_HEADER, HARMONIZE_NONCE_HEADER, HARMONIZE_OUTPUT_MAX_BYTES } from "@/lib/vibode-stage/harmonize-jobs/policy";
import { harmonizeWorkerAuthorization } from "@/lib/vibode-stage/harmonize-jobs/worker-auth.server";
import { harmonizeWorkerProcessingEnabled } from "@/lib/vibode-stage/harmonize-jobs/worker-enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = deny(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (action === "claim") {
    return claimResponse(null);
  }
  if (action === "claim-exact") {
    const requested = url.searchParams.get("jobId");
    if (!requested || !isHarmonizeJobId(requested)) {
      return harmonizeJson({ ok: false, code: "invalid_submission" }, 400);
    }
    return claimResponse(requested.toLowerCase());
  }
  if (action === "recover") {
    return recoveryResponse();
  }
  const payload = await readJson(request);
  const jobId = text(payload?.jobId);
  const claimNonce = text(payload?.claimNonce);
  if (!jobId || !claimNonce) return harmonizeJson({ ok: false, code: "invalid_submission" }, 400);
  if (action === "heartbeat") {
    const ok = await heartbeatHarmonizeGeneration(jobId, claimNonce);
    return harmonizeJson(ok ? { ok: true } : { ok: false, code: "stale_claim" }, ok ? 200 : 409);
  }
  if (action === "contact") {
    const disabled = disabledProcessing("contact");
    if (disabled) return disabled;
    const contact = await contactHarmonizeGeneration(jobId, claimNonce);
    return harmonizeJson(contact, contact.ok ? 200 : 409);
  }
  if (action === "fail") {
    const failed = await failHarmonizeGeneration({
      jobId,
      claimNonce,
      code: text(payload?.code),
      message: text(payload?.message),
      retryable: payload?.retryable === true,
      providerStatus: text(payload?.providerStatus) || null,
      providerHttpStatus: typeof payload?.providerHttpStatus === "number" ? payload.providerHttpStatus : null,
      latencyMs: typeof payload?.latencyMs === "number" ? payload.latencyMs : null,
    });
    return harmonizeJson(failed, failed.ok ? 200 : 409);
  }
  return harmonizeJson({ ok: false, code: "invalid_submission" }, 400);
}

export async function GET(request: Request) {
  const denied = deny(request);
  if (denied) return denied;
  const url = new URL(request.url);
  if (url.searchParams.get("action") === "operations") {
    const operations = await readHarmonizeWorkerOperations();
    if (!operations.ok) return harmonizeJson({ ok: false, code: operations.code }, 503);
    return harmonizeJson({
      ok: true,
      processingEnabled: harmonizeWorkerProcessingEnabled(process.env),
      globalProviderContactsToday: operations.globalProviderContactsToday,
      globalProviderContactLimit: operations.globalProviderContactLimit,
    }, 200);
  }
  if (url.searchParams.get("action") !== "composite") {
    return harmonizeJson({ ok: false, code: "invalid_submission" }, 400);
  }
  const jobId = request.headers.get(HARMONIZE_JOB_HEADER) ?? "";
  const claimNonce = request.headers.get(HARMONIZE_NONCE_HEADER) ?? "";
  const bytes = await readHarmonizeComposite(jobId, claimNonce);
  if (!bytes) return harmonizeJson({ ok: false, code: "stale_claim" }, 404);
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}

export async function PUT(request: Request) {
  const denied = deny(request);
  if (denied) return denied;
  const url = new URL(request.url);
  if (url.searchParams.get("action") !== "complete") {
    return harmonizeJson({ ok: false, code: "invalid_submission" }, 400);
  }
  const jobId = request.headers.get(HARMONIZE_JOB_HEADER) ?? "";
  const claimNonce = request.headers.get(HARMONIZE_NONCE_HEADER) ?? "";
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > HARMONIZE_OUTPUT_MAX_BYTES) {
    return harmonizeJson({ ok: false, code: "unexpected_output" }, 413);
  }
  const completed = await completeHarmonizeGeneration({
    jobId,
    claimNonce,
    output: bytes,
    declaredMime: request.headers.get("content-type") ?? "",
    returnedModelId: request.headers.get("x-vibode-harmonize-returned-model"),
    providerStatus: request.headers.get("x-vibode-harmonize-provider-status"),
    providerHttpStatus: numberHeader(request, "x-vibode-harmonize-http-status"),
    latencyMs: numberHeader(request, "x-vibode-harmonize-latency-ms") ?? -1,
  });
  return harmonizeJson(completed, completed.ok ? 200 : 409);
}

async function claimResponse(jobId: string | null): Promise<NextResponse> {
  const disabled = disabledProcessing("claim");
  if (disabled) return disabled;
  const claimed = await claimHarmonizeGeneration(jobId);
  if (!claimed.ok) {
    const status = claimed.code === "invalid_submission" ? 400 : 503;
    return harmonizeJson({ ok: false, code: claimed.code }, status);
  }
  return harmonizeJson({ ok: true, job: claimed.job, code: claimed.code }, 200);
}

async function recoveryResponse(): Promise<NextResponse> {
  const disabled = disabledProcessing("recover");
  if (disabled) return disabled;
  const recovered = await runServiceHarmonizeHistoryRecovery();
  return harmonizeJson(recovered, recovered.outcome === "unavailable" ? 503 : 200);
}

/**
 * New generation claims, provider contact, and recovery claims stop when
 * processing is off. Heartbeat, composite, complete, and fail stay available
 * so a generation that already passed contact can settle. A planned shutdown
 * does not abort that in-flight provider call.
 */
function disabledProcessing(action: "claim" | "contact" | "recover"): NextResponse | null {
  if (harmonizeWorkerProcessingEnabled(process.env)) return null;
  if (action === "claim" || action === "recover") {
    return harmonizeJson({ ok: true, outcome: "idle", job: null, code: "worker_disabled" }, 200);
  }
  return harmonizeJson({ ok: false, code: "worker_disabled" }, 409);
}

function deny(request: Request): NextResponse | null {
  const auth = harmonizeWorkerAuthorization(request);
  if (auth === "unconfigured") return harmonizeJson({ error: "Not found." }, 404);
  if (auth === "rejected") return harmonizeJson({ error: "Not found." }, 401);
  return null;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberHeader(request: Request, name: string): number | null {
  const value = Number(request.headers.get(name));
  return Number.isFinite(value) ? value : null;
}
