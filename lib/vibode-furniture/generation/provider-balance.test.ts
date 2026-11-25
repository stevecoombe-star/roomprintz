/**
 * Meshy account-balance reads. The provider is mocked. These tests do not
 * call api.meshy.ai and do not read a hosted credential.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ADMIN_REQUIRED } from "./admin-dashboard";
import { STANDARD_GENERATION_CREDIT_ESTIMATE } from "./budget-health";
import {
  MESHY_BALANCE_URL,
  createProviderBalanceReader,
  estimatedAccountGenerations,
  formatProviderInstant,
  meshyBalanceApiKeyFromEnv,
  parseMeshyBalanceBody,
  parseProviderBalanceView,
  providerBalanceAdminResponse,
  providerCreditAvailability,
  type ProviderBalanceView,
} from "./provider-balance";

const SENTINEL = "sentinel-balance-key";
const RESET_MS = 1_793_491_200_000;

test("the balance key is separate from the generation credential", () => {
  assert.equal(meshyBalanceApiKeyFromEnv({}), null);
  assert.equal(meshyBalanceApiKeyFromEnv({ MESHY_API_KEY: SENTINEL }), null);
  assert.equal(meshyBalanceApiKeyFromEnv({ MESHY_BALANCE_API_KEY: "  " }), null);
  assert.equal(meshyBalanceApiKeyFromEnv({
    MESHY_API_KEY: "generation-key",
    MESHY_BALANCE_API_KEY: `  ${SENTINEL}  `,
  }), SENTINEL);
});

test("a valid balance keeps monthly, permanent, and nullable reset values", () => {
  const credits = parseMeshyBalanceBody({
    balance: 70,
    monthly_credits: 60,
    permanent_credits: 30,
    monthly_resets_at: RESET_MS,
    ignored: "studio",
  });
  assert.deepEqual(credits, {
    balance: 70,
    monthlyCredits: 60,
    permanentCredits: 30,
    monthlyResetsAtMs: RESET_MS,
  });
  assert.equal(formatProviderInstant(RESET_MS), "2026-11-01 00:00:00.000 UTC");
  assert.equal(parseMeshyBalanceBody({
    balance: 0,
    monthly_credits: 0,
    permanent_credits: 0,
    monthly_resets_at: null,
  })?.monthlyResetsAtMs, null);
});

test("missing, partial, and unexpected balance values are not zero", () => {
  const rejected = [
    null,
    [],
    "{",
    { balance: 0 },
    { balance: 0, monthly_credits: 0, permanent_credits: 0 },
    { balance: 1.5, monthly_credits: 1, permanent_credits: 0, monthly_resets_at: null },
    { balance: -1, monthly_credits: 0, permanent_credits: 0, monthly_resets_at: null },
    { balance: "0", monthly_credits: 0, permanent_credits: 0, monthly_resets_at: null },
    { balance: true, monthly_credits: 0, permanent_credits: 0, monthly_resets_at: null },
    { balance: Number.NaN, monthly_credits: 0, permanent_credits: 0, monthly_resets_at: null },
    { balance: 0, monthly_credits: 0, permanent_credits: 0, monthly_resets_at: "1793491200000" },
    { balance: 0, monthly_credits: 0, permanent_credits: 0, monthly_resets_at: -1 },
    { balance: 0, monthly_credits: null, permanent_credits: 0, monthly_resets_at: null },
  ];
  for (const body of rejected) assert.equal(parseMeshyBalanceBody(body), null);
  assert.equal(estimatedAccountGenerations(0, 30), 0);
  assert.equal(estimatedAccountGenerations(29, 30), 0);
  assert.equal(estimatedAccountGenerations(30, 30), 1);
  assert.equal(estimatedAccountGenerations(59, 30), 1);
  assert.equal(estimatedAccountGenerations(60, 30), 2);
  assert.equal(providerCreditAvailability(0, 30), "insufficient");
  assert.equal(providerCreditAvailability(29, 30), "insufficient");
  assert.equal(providerCreditAvailability(30, 30), "available");
  assert.equal(STANDARD_GENERATION_CREDIT_ESTIMATE, 30);
});

test("the first read is live and a later read stays cached", async () => {
  const harness = install();
  harness.respond(200, validBody());
  const live = await harness.reader.read(false);
  assert.equal(live.status, "live");
  assert.equal(live.providerRequest, "succeeded");
  assert.equal(live.credits?.balance, 70);
  assert.equal(live.credits?.monthlyResetsAtMs, RESET_MS);
  assertPublic(live);
  harness.advance(1_000);
  const cached = await harness.reader.read(false);
  assert.equal(cached.status, "cached");
  assert.equal(cached.providerRequest, "not_sent");
  assert.equal(cached.failure, null);
  assert.equal(cached.credits?.balance, 70);
  assert.equal(cached.ageMs, 1_000);
  assert.equal(harness.calls.length, 1);
  assertOnlyBalanceGets(harness.calls);
});

test("a reported zero stays zero and a partial body does not", async () => {
  const zero = install();
  zero.respond(200, {
    balance: 0,
    monthly_credits: 0,
    permanent_credits: 0,
    monthly_resets_at: null,
  });
  const reported = await zero.reader.read(true);
  assert.equal(reported.status, "live");
  assert.equal(reported.failure, null);
  assert.deepEqual(reported.credits, {
    balance: 0,
    monthlyCredits: 0,
    permanentCredits: 0,
    monthlyResetsAtMs: null,
  });

  const partial = install();
  partial.respond(200, { balance: 0 });
  const missing = await partial.reader.read(true);
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.credits, null);
  assert.equal(missing.failure, "invalid");
  assert.equal(JSON.stringify(missing).includes('"balance":0'), false);
});

test("malformed, unauthorized, rate limited, timeout, and server errors stay secret", async () => {
  const malformed = install();
  malformed.respondRaw(new Response("{", { status: 200 }));
  assert.equal((await malformed.reader.read(true)).failure, "invalid");

  const unauthorized = install();
  unauthorized.respondRaw(new Response(JSON.stringify({ error: SENTINEL }), { status: 401 }));
  const denied = await unauthorized.reader.read(true);
  assert.equal(denied.failure, "unauthorized");
  assert.equal(denied.credits, null);
  assert.equal(denied.providerRequest, "failed");
  assertPublic(denied);

  const limited = install();
  limited.respondRaw(new Response(JSON.stringify({ error: SENTINEL }), {
    status: 429,
    headers: { "retry-after": "45" },
  }));
  const rateLimited = await limited.reader.read(true);
  assert.equal(rateLimited.failure, "rate_limited");
  assert.equal(limited.calls.length, 1);
  limited.advance(1_000);
  const held = await limited.reader.read(true);
  assert.equal(held.failure, "throttled");
  assert.equal(held.providerRequest, "not_sent");
  assert.equal(limited.calls.length, 1);
  assert.equal(JSON.stringify(held).includes("45"), false);
  assertPublic(held);

  const failed = install();
  failed.respondRaw(new Response(JSON.stringify({ error: SENTINEL, url: "https://api.meshy.ai/openapi/v1/image-to-3d" }), {
    status: 503,
  }));
  const server = await failed.reader.read(true);
  assert.equal(server.failure, "unavailable");
  assertPublic(server);
  assert.equal(JSON.stringify(server).includes("image-to-3d"), false);

  const timed = install({ timeoutMs: 20 });
  timed.queue.push((init) => hangUntilAbort(init));
  const timeout = await timed.reader.read(true);
  assert.equal(timeout.failure, "timeout");
  assert.equal(timeout.credits, null);
  assert.equal(timed.calls.length, 1);

  const offline = install();
  offline.queue.push(async () => {
    throw new TypeError("network down");
  });
  assert.equal((await offline.reader.read(true)).failure, "unavailable");
  assertOnlyBalanceGets(offline.calls);
});

test("a failed refresh keeps the last balance and a later refresh can recover", async () => {
  const harness = install();
  harness.respond(200, validBody());
  const live = await harness.reader.read(true);
  assert.equal(live.credits?.balance, 70);
  harness.advance(60_001);
  const stale = await harness.reader.read(false);
  assert.equal(stale.status, "stale");
  assert.equal(stale.credits?.balance, 70);
  assert.equal(stale.ageMs, 60_001);
  assert.equal(harness.calls.length, 1);

  harness.respondRaw(new Response(JSON.stringify({ error: SENTINEL }), { status: 500 }));
  const failed = await harness.reader.read(true);
  assert.equal(failed.status, "stale");
  assert.equal(failed.failure, "unavailable");
  assert.equal(failed.providerRequest, "failed");
  assert.equal(failed.credits?.balance, 70);
  assert.notEqual(failed.credits?.balance, 0);
  assertPublic(failed);

  harness.advance(15_000);
  harness.respond(200, {
    balance: 20,
    monthly_credits: 20,
    permanent_credits: 0,
    monthly_resets_at: null,
  });
  const recovered = await harness.reader.read(true);
  assert.equal(recovered.status, "live");
  assert.equal(recovered.credits?.balance, 20);
  assert.equal(recovered.credits?.monthlyResetsAtMs, null);
  assert.equal(harness.calls.length, 3);
  assertOnlyBalanceGets(harness.calls);
});

test("overlapping refreshes share one provider call", async () => {
  const harness = install();
  let release: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  harness.queue.push(() => pending);
  const first = harness.reader.read(true);
  const second = harness.reader.read(true);
  assert.equal(harness.calls.length, 1);
  release(jsonResponse(200, validBody()));
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.status, "live");
  assert.deepEqual(left, right);
  assert.equal(harness.calls.length, 1);
  harness.advance(1_000);
  const throttled = await harness.reader.read(true);
  assert.equal(throttled.status, "cached");
  assert.equal(throttled.failure, "throttled");
  assert.equal(throttled.credits?.balance, 70);
  assert.equal(harness.calls.length, 1);
});

test("a missing balance credential does not call Meshy", async () => {
  const harness = install();
  harness.setKey(null);
  const missing = await harness.reader.read(true);
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.failure, "unconfigured");
  assert.equal(missing.providerRequest, "not_sent");
  assert.equal(missing.credits, null);
  assert.equal(harness.calls.length, 0);
  harness.setKey(SENTINEL);
  harness.respond(200, validBody());
  const recovered = await harness.reader.read(true);
  assert.equal(recovered.status, "live");
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0]?.authorization, `Bearer ${SENTINEL}`);
  assertPublic(recovered);
});

test("admin authorization is required and a forged zero is not published", async () => {
  let reads = 0;
  const denied = await providerBalanceAdminResponse({
    getAdmin: async () => null,
    refresh: true,
    read: async () => {
      reads += 1;
      throw new Error("balance read should not run");
    },
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: ADMIN_REQUIRED });
  assert.equal(reads, 0);

  const allowed = await providerBalanceAdminResponse({
    getAdmin: async () => ({ id: "admin-id" }),
    refresh: false,
    read: async (refresh) => {
      assert.equal(refresh, false);
      reads += 1;
      return {
        status: "live",
        credits: { balance: 70, monthlyCredits: 60, permanentCredits: 30, monthlyResetsAtMs: RESET_MS },
        retrievedAtMs: 1_700_000_000_000,
        ageMs: 0,
        failure: null,
        providerRequest: "succeeded",
      };
    },
  });
  assert.equal(allowed.status, 200);
  if (allowed.status !== 200) return;
  assert.equal(allowed.body.credits?.balance, 70);
  assert.equal(reads, 1);

  const forged = await providerBalanceAdminResponse({
    getAdmin: async () => ({ id: "admin-id" }),
    refresh: true,
    read: async () => ({
      status: "live",
      credits: { balance: 0, monthlyCredits: 0, permanentCredits: 0, monthlyResetsAtMs: null },
      retrievedAtMs: 1,
      ageMs: 5,
      failure: null,
      providerRequest: "succeeded",
    }),
  });
  assert.equal(forged.status, 200);
  if (forged.status !== 200) return;
  assert.equal(forged.body.status, "unavailable");
  assert.equal(forged.body.credits, null);
  assert.equal(JSON.stringify(forged.body).includes('"balance":0'), false);
});

test("balance code does not post, mutate finances, or expose the credential", () => {
  const client = source("lib/vibode-furniture/generation/provider-balance.ts");
  const route = source("app/api/admin/furniture-generation/provider-balance/route.ts");
  const dashboard = source("app/admin/furniture-generation/FurnitureGenerationDashboard.tsx");
  const view = source("app/admin/furniture-generation/FurnitureGenerationDashboardView.tsx");
  const worker = source("furniture-generation-worker/src/provider.ts");
  const workerIndex = source("furniture-generation-worker/src/index.ts");

  assert.match(client, /method: "GET"/);
  assert.match(client, /MESHY_BALANCE_URL/);
  assert.match(client, /MESHY_BALANCE_API_KEY/);
  assert.doesNotMatch(client, /method: "POST"|image-to-3d|process\.env|supabase|\.rpc\(|console\.(log|info|debug|warn|error)/);
  assert.doesNotMatch(client, /env\.MESHY_API_KEY|NEXT_PUBLIC_/);

  assert.match(route, /getAuthenticatedAdminUser/);
  assert.match(route, /meshyBalanceApiKeyFromEnv\(process\.env\)/);
  assert.match(route, /searchParams\.get\("refresh"\) === "1"/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /export async function POST|request\.json|request\.text|supabase|\.rpc\(|image-to-3d|MESHY_API_KEY|NEXT_PUBLIC_/);

  const refreshStart = dashboard.indexOf("async function refreshDashboard");
  const refreshBody = dashboard.slice(refreshStart, dashboard.indexOf("async function loadProviderBalance", refreshStart));
  assert.doesNotMatch(refreshBody, /provider-balance|loadProviderBalance/);
  assert.match(dashboard, /loadProviderBalance\(false, ticket\)/);
  assert.match(dashboard, /provider-balance\$\{refresh \? "\?refresh=1"/);
  assert.doesNotMatch(dashboard, /api\.meshy\.ai|MESHY_API_KEY|MESHY_BALANCE_API_KEY/);

  assert.match(view, /Meshy Provider Balance/);
  assert.match(view, /are not included in this balance response/);
  assert.match(view, /Estimated account-credit capacity/);
  assert.doesNotMatch(view, /api\.meshy\.ai|fetch\(|MESHY_API_KEY|generationCapacity\(provider/);

  assert.doesNotMatch(`${worker}\n${workerIndex}`, /openapi\/v1\/balance|createServer\(/);
  assert.equal(parseProviderBalanceView({
    status: "unavailable",
    credits: { balance: 0, monthlyCredits: 0, permanentCredits: 0, monthlyResetsAtMs: null },
    retrievedAtMs: null,
    ageMs: null,
    failure: null,
    providerRequest: "not_sent",
  }), null);
});

type Call = {
  url: string;
  method: string;
  body: unknown;
  redirect: RequestRedirect | undefined;
  cache: RequestCache | undefined;
  authorization: string;
};

function install(options?: { timeoutMs?: number }) {
  let now = 1_700_000_000_000;
  let key: string | null = SENTINEL;
  const queue: Array<(init?: RequestInit) => Promise<Response>> = [];
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ?? null,
      redirect: init?.redirect,
      cache: init?.cache,
      authorization: headers.get("authorization") ?? "",
    });
    const next = queue.shift();
    if (!next) throw new Error("unexpected balance request");
    return next(init);
  };
  const reader = createProviderBalanceReader({
    fetchImpl,
    apiKey: () => key,
    now: () => now,
    freshMs: 60_000,
    minIntervalMs: 15_000,
    timeoutMs: options?.timeoutMs ?? 8_000,
  });
  return {
    reader,
    calls,
    queue,
    advance(ms: number) {
      now += ms;
    },
    setKey(value: string | null) {
      key = value;
    },
    respond(status: number, body: unknown) {
      queue.push(async () => jsonResponse(status, body));
    },
    respondRaw(response: Response) {
      queue.push(async () => response);
    },
  };
}

function validBody(): Record<string, unknown> {
  return {
    balance: 70,
    monthly_credits: 60,
    permanent_credits: 30,
    monthly_resets_at: RESET_MS,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function hangUntilAbort(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      reject(new Error("missing abort signal"));
      return;
    }
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

function assertOnlyBalanceGets(calls: readonly Call[]) {
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.url, MESHY_BALANCE_URL);
    assert.equal(call.method, "GET");
    assert.equal(call.body, null);
    assert.equal(call.redirect, "manual");
    assert.equal(call.cache, "no-store");
    assert.equal(call.url.includes(SENTINEL), false);
    assert.equal(call.authorization, `Bearer ${SENTINEL}`);
  }
}

function assertPublic(view: ProviderBalanceView) {
  assert.deepEqual(parseProviderBalanceView(JSON.parse(JSON.stringify(view))), view);
  const encoded = JSON.stringify(view);
  assert.equal(encoded.includes(SENTINEL), false);
  assert.equal(encoded.includes("api.meshy"), false);
  assert.equal(encoded.includes("Bearer"), false);
}

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}
