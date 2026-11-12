/**
 * Browser calls for the signed-in tester. The bearer token identifies the
 * owner. This module never calls a model provider.
 */

import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";

import type { CustomerEntitlement, CustomerJobSnapshot } from "./beta-generation";

export type BetaSubmitResult =
  | Readonly<{ ok: true; created: boolean; job: CustomerJobSnapshot }>
  | Readonly<{ ok: false; uncertain: boolean; message: string }>;

export async function readGenerationAccessToken(): Promise<string | null> {
  const browser = await import("@/lib/supabaseBrowser");
  return browser.getSupabaseBrowserAccessToken();
}

export async function readBetaEntitlement(input: Readonly<{
  token: string;
  fetchImpl?: typeof fetch;
}>): Promise<{ ok: true; entitlement: CustomerEntitlement } | { ok: false; message: string }> {
  if (!input.token) return { ok: false, message: "Sign in to see AI generations." };
  const response = await requestJson(input.fetchImpl, "/api/vibode/furniture-generations/allowance", {
    method: "GET",
    headers: { authorization: `Bearer ${input.token}` },
  });
  if (response.uncertain) return { ok: false, message: "AI generation could not be checked." };
  const entitlement = entitlementFromPayload(response.payload);
  if (!response.ok || !entitlement) return { ok: false, message: "AI generation could not be checked." };
  return { ok: true, entitlement };
}

export async function submitBetaGeneration(input: Readonly<{
  token: string;
  idempotencyKey: string;
  jpegBytes: Uint8Array;
  fetchImpl?: typeof fetch;
}>): Promise<BetaSubmitResult> {
  if (!input.token) return { ok: false, uncertain: false, message: "Sign in to generate furniture." };
  const response = await requestJson(input.fetchImpl, "/api/vibode/furniture-generations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      idempotencyKey: input.idempotencyKey,
      settings: defaultFurnitureGeneratorSettings(),
      images: [{ slot: "front", base64: bytesToBase64(input.jpegBytes) }],
    }),
  });
  if (response.uncertain) {
    return {
      ok: false,
      uncertain: true,
      message: "The request did not finish. Try again. It will not start a second generation.",
    };
  }
  const job = jobFromPayload(response.payload);
  if (response.ok && job) {
    const created = response.payload?.created === true;
    return { ok: true, created, job };
  }
  return { ok: false, uncertain: false, message: safeCustomerMessage(response.payload) };
}

export async function readBetaGeneration(input: Readonly<{
  token: string;
  jobId: string;
  fetchImpl?: typeof fetch;
}>): Promise<{ ok: true; job: CustomerJobSnapshot } | { ok: false; uncertain: boolean }> {
  if (!input.token) return { ok: false, uncertain: false };
  const response = await requestJson(
    input.fetchImpl,
    `/api/vibode/furniture-generations/${input.jobId}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${input.token}` },
    },
  );
  if (response.uncertain) return { ok: false, uncertain: true };
  const job = jobFromPayload(response.payload);
  if (!response.ok || !job) return { ok: false, uncertain: false };
  return { ok: true, job };
}

async function requestJson(
  fetchImpl: typeof fetch | undefined,
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; uncertain: boolean; payload: Record<string, unknown> | null }> {
  const send = fetchImpl ?? fetch;
  try {
    const response = await send(url, init);
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      return { ok: false, uncertain: true, payload: null };
    }
    const payload = await response.json().catch(() => null);
    const record = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    return { ok: response.ok, uncertain: false, payload: record };
  } catch {
    return { ok: false, uncertain: true, payload: null };
  }
}

function entitlementFromPayload(payload: Record<string, unknown> | null): CustomerEntitlement | null {
  if (!payload || payload.ok !== true) return null;
  const entitlement = payload.entitlement;
  if (!entitlement || typeof entitlement !== "object" || Array.isArray(entitlement)) return null;
  const record = entitlement as Record<string, unknown>;
  const state = record.state;
  if (
    state !== "ready"
    && state !== "unapproved"
    && state !== "disabled"
    && state !== "exhausted"
    && state !== "generation_off"
  ) return null;
  const authorized = count(record.authorized);
  const reserved = count(record.reserved);
  const consumed = count(record.consumed);
  const remaining = count(record.remaining);
  if (authorized == null || reserved == null || consumed == null || remaining == null) return null;
  if (remaining !== Math.max(0, authorized - reserved - consumed)) return null;
  const reason = typeof record.reason === "string" ? record.reason : null;
  return {
    canGenerate: record.canGenerate === true && state === "ready",
    state,
    authorized,
    reserved,
    consumed,
    remaining,
    reason,
  };
}

function jobFromPayload(payload: Record<string, unknown> | null): CustomerJobSnapshot | null {
  const job = payload?.job;
  if (!payload || payload.ok !== true || !job || typeof job !== "object" || Array.isArray(job)) return null;
  const record = job as Record<string, unknown>;
  if (typeof record.jobId !== "string" || typeof record.status !== "string") return null;
  if (typeof record.progress !== "number" || !Number.isFinite(record.progress)) return null;
  return {
    jobId: record.jobId,
    status: record.status,
    errorClass: typeof record.errorClass === "string" ? record.errorClass : null,
    progress: record.progress,
  };
}

function safeCustomerMessage(payload: Record<string, unknown> | null): string {
  const error = payload && typeof payload.error === "string" ? payload.error : "";
  if (
    error.length > 0
    && error.length <= 160
    && !/https?:|\/|meshy|api[_-]?key|credit/i.test(error)
  ) {
    return error;
  }
  return "The generation could not be started.";
}

function count(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
