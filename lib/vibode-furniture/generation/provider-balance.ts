/**
 * Read-only Meshy account balance.
 * The balance key is passed in by the admin route. This module does not
 * read the generation credential, does not post a generation, and does not change
 * Vibode's credit ceiling, paid attempts, or tester allowances.
 */

import { ADMIN_REQUIRED } from "./admin-dashboard";

export const MESHY_BALANCE_URL = "https://api.meshy.ai/openapi/v1/balance";

/** A dashboard load can reuse a reading for one minute, then must call it stale. */
export const PROVIDER_BALANCE_FRESH_MS = 60_000;

/** Manual refresh will not start another provider call inside this window. */
export const PROVIDER_BALANCE_MIN_INTERVAL_MS = 15_000;

export const PROVIDER_BALANCE_TIMEOUT_MS = 8_000;

/** Used when Meshy rate limits the balance call and sends no usable Retry-After. */
export const PROVIDER_BALANCE_RATE_LIMIT_WAIT_MS = 60_000;

const MAX_BALANCE_BODY_CHARS = 4_000;
const MAX_RETRY_AFTER_SECONDS = 300;

export type ProviderBalanceCredits = {
  balance: number;
  monthlyCredits: number;
  permanentCredits: number;
  monthlyResetsAtMs: number | null;
};

export type ProviderBalanceFailure =
  | "unconfigured"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid"
  | "throttled";

export type ProviderBalanceStatus = "live" | "cached" | "stale" | "unavailable";

export type ProviderBalanceRequest = "succeeded" | "failed" | "not_sent";

export type ProviderBalanceView = {
  status: ProviderBalanceStatus;
  credits: ProviderBalanceCredits | null;
  retrievedAtMs: number | null;
  ageMs: number | null;
  failure: ProviderBalanceFailure | null;
  providerRequest: ProviderBalanceRequest;
};

type Snapshot = {
  credits: ProviderBalanceCredits;
  retrievedAtMs: number;
};

type BalanceRequestResult =
  | { ok: true; credits: ProviderBalanceCredits }
  | { ok: false; failure: Exclude<ProviderBalanceFailure, "throttled">; retryAfterMs: number | null };

export function meshyBalanceApiKeyFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const key = env.MESHY_BALANCE_API_KEY?.trim() ?? "";
  return key.length > 0 ? key : null;
}

export function unavailableProviderBalance(
  failure: ProviderBalanceFailure,
  providerRequest: Exclude<ProviderBalanceRequest, "succeeded">,
): ProviderBalanceView {
  return {
    status: "unavailable",
    credits: null,
    retrievedAtMs: null,
    ageMs: null,
    failure,
    providerRequest,
  };
}

export function parseMeshyBalanceBody(body: unknown): ProviderBalanceCredits | null {
  if (!isRecord(body)) return null;
  if (!Object.prototype.hasOwnProperty.call(body, "monthly_resets_at")) return null;
  const balance = nonnegativeInteger(body.balance);
  const monthlyCredits = nonnegativeInteger(body.monthly_credits);
  const permanentCredits = nonnegativeInteger(body.permanent_credits);
  if (balance == null || monthlyCredits == null || permanentCredits == null) return null;
  const reset = body.monthly_resets_at;
  if (reset !== null && nonnegativeInteger(reset) == null) return null;
  return {
    balance,
    monthlyCredits,
    permanentCredits,
    monthlyResetsAtMs: reset === null ? null : nonnegativeInteger(reset),
  };
}

export function parseProviderBalanceView(value: unknown): ProviderBalanceView | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  const failure = value.failure;
  const providerRequest = value.providerRequest;
  if (!isStatus(status) || !isFailure(failure) || !isRequest(providerRequest)) return null;
  const retrievedAtMs = value.retrievedAtMs;
  const ageMs = value.ageMs;
  if (retrievedAtMs !== null && nonnegativeInteger(retrievedAtMs) == null) return null;
  if (ageMs !== null && nonnegativeInteger(ageMs) == null) return null;
  if (value.credits === null) {
    if (status !== "unavailable" || retrievedAtMs !== null || ageMs !== null) return null;
    return {
      status,
      credits: null,
      retrievedAtMs: null,
      ageMs: null,
      failure,
      providerRequest,
    };
  }
  if (!isRecord(value.credits) || status === "unavailable") return null;
  const balance = nonnegativeInteger(value.credits.balance);
  const monthlyCredits = nonnegativeInteger(value.credits.monthlyCredits);
  const permanentCredits = nonnegativeInteger(value.credits.permanentCredits);
  const monthlyResetsAtMs = value.credits.monthlyResetsAtMs === null
    ? null
    : nonnegativeInteger(value.credits.monthlyResetsAtMs);
  const retrieved = nonnegativeInteger(retrievedAtMs);
  const age = nonnegativeInteger(ageMs);
  if (balance == null || monthlyCredits == null || permanentCredits == null) return null;
  if (value.credits.monthlyResetsAtMs !== null && monthlyResetsAtMs == null) return null;
  if (retrieved == null || age == null) return null;
  if (status === "live" && (failure !== null || providerRequest !== "succeeded" || age !== 0)) return null;
  return {
    status,
    credits: {
      balance,
      monthlyCredits,
      permanentCredits,
      monthlyResetsAtMs,
    },
    retrievedAtMs: retrieved,
    ageMs: age,
    failure,
    providerRequest,
  };
}

export function formatProviderInstant(ms: number): string {
  if (nonnegativeInteger(ms) == null) return "—";
  return new Date(ms).toISOString().replace("T", " ").replace("Z", " UTC");
}

export function formatProviderAge(ageMs: number): string {
  if (nonnegativeInteger(ageMs) == null) return "unknown age";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s old`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m old`;
  return `${Math.floor(minutes / 60)}h old`;
}

export function providerCreditAvailability(
  balance: number,
  standardCredits: number,
): "available" | "insufficient" | "unknown" {
  if (nonnegativeInteger(balance) == null || !Number.isSafeInteger(standardCredits) || standardCredits <= 0) {
    return "unknown";
  }
  return balance >= standardCredits ? "available" : "insufficient";
}

export function estimatedAccountGenerations(balance: number, creditsPerGeneration: number): number | null {
  if (nonnegativeInteger(balance) == null) return null;
  if (!Number.isSafeInteger(creditsPerGeneration) || creditsPerGeneration <= 0) return null;
  return Math.floor(balance / creditsPerGeneration);
}

export function createProviderBalanceReader(input: {
  fetchImpl: typeof fetch;
  apiKey: () => string | null;
  now: () => number;
  freshMs?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
}): { read(refresh: boolean): Promise<ProviderBalanceView> } {
  const freshMs = input.freshMs ?? PROVIDER_BALANCE_FRESH_MS;
  const minIntervalMs = input.minIntervalMs ?? PROVIDER_BALANCE_MIN_INTERVAL_MS;
  const timeoutMs = input.timeoutMs ?? PROVIDER_BALANCE_TIMEOUT_MS;
  const state: {
    snapshot: Snapshot | null;
    inFlight: Promise<ProviderBalanceView> | null;
    nextAllowedAtMs: number;
  } = {
    snapshot: null,
    inFlight: null,
    nextAllowedAtMs: 0,
  };

  return {
    async read(refresh) {
      if (state.inFlight) return state.inFlight;
      const nowMs = input.now();
      if (state.snapshot && !refresh) return publish(snapshotView(state.snapshot, nowMs, null, "not_sent"));
      if (nowMs < state.nextAllowedAtMs && (refresh || !state.snapshot)) {
        if (state.snapshot) {
          return publish(snapshotView(state.snapshot, nowMs, refresh ? "throttled" : null, "not_sent"));
        }
        return publish(unavailableProviderBalance(refresh ? "throttled" : "unavailable", "not_sent"));
      }
      const gate: { current: Promise<ProviderBalanceView> | null } = { current: null };
      const promise = perform().finally(() => {
        if (state.inFlight === gate.current) state.inFlight = null;
      });
      gate.current = promise;
      state.inFlight = promise;
      return promise;
    },
  };

  async function perform(): Promise<ProviderBalanceView> {
    const key = input.apiKey()?.trim() ?? "";
    if (!key) return publish(unavailableProviderBalance("unconfigured", "not_sent"));
    const result = await requestMeshyBalance({
      fetchImpl: input.fetchImpl,
      apiKey: key,
      timeoutMs,
    });
    const finished = input.now();
    if (result.ok) {
      state.snapshot = { credits: result.credits, retrievedAtMs: finished };
      state.nextAllowedAtMs = finished + minIntervalMs;
      return publish({
        status: "live",
        credits: result.credits,
        retrievedAtMs: finished,
        ageMs: 0,
        failure: null,
        providerRequest: "succeeded",
      });
    }
    const wait = result.failure === "rate_limited"
      ? Math.max(minIntervalMs, Math.min(300_000, result.retryAfterMs ?? PROVIDER_BALANCE_RATE_LIMIT_WAIT_MS))
      : minIntervalMs;
    state.nextAllowedAtMs = finished + wait;
    if (!state.snapshot) {
      return publish({
        status: "unavailable",
        credits: null,
        retrievedAtMs: null,
        ageMs: null,
        failure: result.failure,
        providerRequest: "failed",
      });
    }
    return publish(snapshotView(state.snapshot, finished, result.failure, "failed"));
  }

  function snapshotView(
    snapshot: Snapshot,
    nowMs: number,
    failure: ProviderBalanceFailure | null,
    providerRequest: Exclude<ProviderBalanceRequest, "succeeded">,
  ): ProviderBalanceView {
    const ageMs = Math.max(0, nowMs - snapshot.retrievedAtMs);
    const failed = failure != null && failure !== "throttled";
    return {
      status: failed || ageMs > freshMs ? "stale" : "cached",
      credits: snapshot.credits,
      retrievedAtMs: snapshot.retrievedAtMs,
      ageMs,
      failure,
      providerRequest,
    };
  }
}

export async function requestMeshyBalance(input: {
  fetchImpl: typeof fetch;
  apiKey: string;
  timeoutMs: number;
}): Promise<BalanceRequestResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) return { ok: false, failure: "unconfigured", retryAfterMs: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(MESHY_BALANCE_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 401) {
      await discard(response);
      return { ok: false, failure: "unauthorized", retryAfterMs: null };
    }
    if (response.status === 429) {
      const retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));
      await discard(response);
      return { ok: false, failure: "rate_limited", retryAfterMs };
    }
    if (response.status !== 200) {
      await discard(response);
      return { ok: false, failure: "unavailable", retryAfterMs: null };
    }
    const text = await response.text();
    if (text.length > MAX_BALANCE_BODY_CHARS) return { ok: false, failure: "invalid", retryAfterMs: null };
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, failure: "invalid", retryAfterMs: null };
    }
    const credits = parseMeshyBalanceBody(body);
    if (!credits) return { ok: false, failure: "invalid", retryAfterMs: null };
    return { ok: true, credits };
  } catch {
    return controller.signal.aborted
      ? { ok: false, failure: "timeout", retryAfterMs: null }
      : { ok: false, failure: "unavailable", retryAfterMs: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function providerBalanceAdminResponse(input: {
  getAdmin: () => Promise<unknown>;
  refresh: boolean;
  read: (refresh: boolean) => Promise<ProviderBalanceView>;
}): Promise<{ status: 200; body: ProviderBalanceView } | { status: 403; body: { error: string } }> {
  const admin = await input.getAdmin();
  if (!admin) return { status: 403, body: { error: ADMIN_REQUIRED } };
  const body = parseProviderBalanceView(await input.read(input.refresh))
    ?? unavailableProviderBalance("invalid", "failed");
  return { status: 200, body };
}

function publish(view: ProviderBalanceView): ProviderBalanceView {
  return parseProviderBalanceView(view) ?? unavailableProviderBalance("invalid", "failed");
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_RETRY_AFTER_SECONDS) return null;
  return seconds * 1000;
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The provider body is never returned to the browser.
  }
}

function nonnegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is ProviderBalanceStatus {
  return value === "live" || value === "cached" || value === "stale" || value === "unavailable";
}

function isFailure(value: unknown): value is ProviderBalanceFailure | null {
  return value === null
    || value === "unconfigured"
    || value === "unauthorized"
    || value === "rate_limited"
    || value === "timeout"
    || value === "unavailable"
    || value === "invalid"
    || value === "throttled";
}

function isRequest(value: unknown): value is ProviderBalanceRequest {
  return value === "succeeded" || value === "failed" || value === "not_sent";
}
