import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { hasSupabaseAuthEnv } from "@/lib/adminServer";
import {
  CompositorTransportError,
  type CompositorTransportErrorClass,
} from "@/lib/compositorTransportError";

import {
  dynamic,
  fetchCache,
  GET,
  revalidate,
  runCompositorConnectivityProbe,
} from "./route";

const FLAG = "VIBODE_COMPOSITOR_CONNECTIVITY_PROBE_ENABLED";
const SECRET_MARKERS = [
  "compositor.internal.example",
  "test-secret-token",
  "secret-stack-trace",
  "evil.example",
  "admin-should-not-leak",
  "Bearer",
  "ECONNREFUSED",
  "readerEnabled",
  "schemaVersion",
  "afc-sr1",
  "ROOMPRINTZ_COMPOSITOR",
  "SUPABASE",
  "Compositor returned",
  "Compositor connection",
  "malformed JSON",
];

const originalFetch = globalThis.fetch;
let networkAttempts = 0;

globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error("blocked-network");
};

test.after(() => {
  globalThis.fetch = originalFetch;
});

test.beforeEach(() => {
  networkAttempts = 0;
});

type ProbeDeps = Readonly<{
  getAuthenticatedAdminUser: () => Promise<unknown>;
  callCompositorAfcSr1Readiness: (signal?: AbortSignal) => Promise<unknown>;
}>;

type PublicGet = (
  request: Request,
  routeContext?: unknown,
) => Promise<Response>;

function probeRequest(): Request {
  return new Request(
    "http://127.0.0.1/api/admin/compositor-connectivity?url=https://evil.example&host=compositor.internal.example",
  );
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function withFlag<T>(
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  }
}

function transportError(args: {
  classification: CompositorTransportErrorClass;
  httpStatus?: number | null;
}): CompositorTransportError {
  const error = new CompositorTransportError({
    seam: "readiness",
    classification: args.classification,
    httpStatus: args.httpStatus,
    osCode: args.classification === "connection_failure" ? "ECONNREFUSED" : null,
    endpoint: {
      host: "compositor.internal.example",
      port: "443",
      path: "/api/research/afc-sr1/readiness",
    },
  });
  error.stack = "secret-stack-trace";
  return error;
}

async function assertClosed(response: Response): Promise<void> {
  const text = await response.text();
  const headers = [...response.headers.entries()]
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
  const haystack = `${text}\n${headers}`;
  for (const marker of SECRET_MARKERS) {
    assert.equal(
      haystack.toLowerCase().includes(marker.toLowerCase()),
      false,
      marker,
    );
  }
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(networkAttempts, 0);
}

async function assertProbe(
  response: Response,
  httpStatus: number,
  status: "authenticated" | "rejected" | "unavailable",
): Promise<void> {
  assert.equal(response.status, httpStatus);
  const text = await response.clone().text();
  assert.deepEqual(JSON.parse(text), { status });
  await assertClosed(response);
}

function refusingDeps(): ProbeDeps {
  return {
    getAuthenticatedAdminUser: async () => {
      throw new Error("admin lookup must not run secret-stack-trace");
    },
    callCompositorAfcSr1Readiness: async () => {
      throw new Error("compositor call must not run compositor.internal.example");
    },
  };
}

function injectedRouteContext(): ProbeDeps & { params: Promise<Record<string, string>> } {
  return {
    params: Promise.resolve({ url: "https://evil.example" }),
    getAuthenticatedAdminUser: async () => {
      throw new Error("route context admin lookup must not run");
    },
    callCompositorAfcSr1Readiness: async () => {
      throw new Error("route context compositor call must not run");
    },
  };
}

test("route config is dynamic, non-cacheable, and GET-only", () => {
  assert.equal(dynamic, "force-dynamic");
  assert.equal(revalidate, 0);
  assert.equal(fetchCache, "force-no-store");
  assert.equal(GET.length, 1);
  const source = readFileSync(
    path.join(process.cwd(), "app/api/admin/compositor-connectivity/route.ts"),
    "utf8",
  );
  assert.match(source, /export async function GET/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/);
  assert.match(source, /getAuthenticatedAdminUser/);
  assert.match(source, /callCompositorAfcSr1Readiness/);
  assert.match(source, /runCompositorConnectivityProbe\(productionDeps\)/);
  assert.doesNotMatch(source, /\bfetch\s*\(|searchParams|request\.url|ROOMPRINTZ_COMPOSITOR_URL|retry|setInterval|isProbeDeps|routeContext/);
  const body = GET.toString().slice(GET.toString().indexOf("{"));
  assert.match(body, /runCompositorConnectivityProbe\(productionDeps\)/);
  assert.equal(body.includes("arguments"), false);
  assert.equal(body.includes("isProbeDeps"), false);
  assert.equal(body.includes("routeContext"), false);
});

test("public GET cannot select injected dependencies through route context", async () => {
  let adminCalls = 0;
  let compositorCalls = 0;
  const injected = {
    params: Promise.resolve({ target: "https://evil.example" }),
    url: "https://compositor.internal.example",
    getAuthenticatedAdminUser: async () => {
      adminCalls += 1;
      return { id: "admin-should-not-leak" };
    },
    callCompositorAfcSr1Readiness: async () => {
      compositorCalls += 1;
      return {
        schemaVersion: "afc-sr1-readiness/v2",
        readerEnabled: true,
        authorization: "Bearer test-secret-token",
        endpoint: "https://compositor.internal.example",
      };
    },
  };
  const callPublicGet = GET as PublicGet;

  const disabled = await withFlag(undefined, () => callPublicGet(probeRequest(), injected));
  assert.equal(disabled.status, 404);
  assert.equal(await disabled.clone().text(), "");
  await assertClosed(disabled);
  assert.equal(adminCalls, 0);
  assert.equal(compositorCalls, 0);

  const enabled = await withFlag("1", () => callPublicGet(probeRequest(), injected));
  assert.equal(adminCalls, 0);
  assert.equal(compositorCalls, 0);
  assert.notEqual(enabled.status, 200);
  if (hasSupabaseAuthEnv()) {
    await assertProbe(enabled, 503, "unavailable");
  } else {
    assert.equal(enabled.status, 403);
    assert.equal(await enabled.clone().text(), "");
    await assertClosed(enabled);
  }

  const contextResponse = await withFlag(undefined, () =>
    callPublicGet(probeRequest(), injectedRouteContext()),
  );
  assert.equal(contextResponse.status, 404);
  assert.equal(await contextResponse.clone().text(), "");
  await assertClosed(contextResponse);
});

test("feature flag absent or disabled returns 404 without admin or compositor calls", async () => {
  const disabled: Array<string | undefined> = [undefined, "", "0", "true", "yes", "01", " 1", "1 "];
  for (const value of disabled) {
    let adminCalls = 0;
    let compositorCalls = 0;
    const deps: ProbeDeps = {
      getAuthenticatedAdminUser: async () => {
        adminCalls += 1;
        return { id: "admin-should-not-leak" };
      },
      callCompositorAfcSr1Readiness: async () => {
        compositorCalls += 1;
        return { schemaVersion: "afc-sr1-readiness/v2", readerEnabled: true };
      },
    };
    const response = await withFlag(value, () => runCompositorConnectivityProbe(deps));
    assert.equal(response.status, 404);
    assert.equal(await response.clone().text(), "");
    await assertClosed(response);
    assert.equal(adminCalls, 0);
    assert.equal(compositorCalls, 0);
  }
});

test("unauthorized administrator returns 403 and does not call the compositor", async () => {
  let compositorCalls = 0;
  const response = await withFlag("1", () =>
    runCompositorConnectivityProbe({
      getAuthenticatedAdminUser: async () => null,
      callCompositorAfcSr1Readiness: async () => {
        compositorCalls += 1;
        throw new Error("compositor must not run secret-stack-trace");
      },
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(await response.clone().text(), "");
  await assertClosed(response);
  assert.equal(compositorCalls, 0);
});

test("admin lookup failure stays unavailable and does not call the compositor", async () => {
  let compositorCalls = 0;
  const response = await withFlag("1", () =>
    runCompositorConnectivityProbe({
      getAuthenticatedAdminUser: async () => {
        throw new Error("supabase failed secret-stack-trace Bearer test-secret-token");
      },
      callCompositorAfcSr1Readiness: async () => {
        compositorCalls += 1;
        return {};
      },
    }),
  );
  await assertProbe(response, 503, "unavailable");
  assert.equal(compositorCalls, 0);
});

test("authorized admin and validated readiness return authenticated and clear the timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let adminCalls = 0;
  let compositorCalls = 0;
  let aborted = false;
  let seen: AbortSignal | undefined;
  const deps = {
    url: "https://evil.example",
    endpoint: "https://compositor.internal.example",
    getAuthenticatedAdminUser: async () => {
      adminCalls += 1;
      return { id: "admin-should-not-leak", email: "admin@example.test" };
    },
    callCompositorAfcSr1Readiness: async function readiness(signal?: AbortSignal) {
      assert.equal(arguments.length, 1);
      compositorCalls += 1;
      seen = signal;
      signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return {
        schemaVersion: "afc-sr1-readiness/v2",
        readerEnabled: true,
        placementEnabled: false,
        ts0GeneratorReady: true,
        ts0GeneratorProfile: "afc-sr1-tile-grid-scaffold/v1",
        ts0RequestedModelId: "NBP",
        authorization: "Bearer test-secret-token",
        endpoint: "https://compositor.internal.example",
      };
    },
  };
  const response = await withFlag("1", () => runCompositorConnectivityProbe(deps));
  await assertProbe(response, 200, "authenticated");
  assert.equal(adminCalls, 1);
  assert.equal(compositorCalls, 1);
  assert.ok(seen instanceof AbortSignal);
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(aborted, false);
});

test("downstream 401 and 403 return rejected without downstream details", async () => {
  for (const httpStatus of [401, 403] as const) {
    let calls = 0;
    const response = await withFlag("1", () =>
      runCompositorConnectivityProbe({
        getAuthenticatedAdminUser: async () => ({ id: "admin-should-not-leak" }),
        callCompositorAfcSr1Readiness: async () => {
          calls += 1;
          throw transportError({
            classification: httpStatus === 401 ? "http_401" : "http_403",
            httpStatus,
          });
        },
      }),
    );
    await assertProbe(response, 502, "rejected");
    assert.equal(calls, 1);
    assert.equal(response.status === 401 || response.status === 403, false);
  }
});

test("connection failure returns unavailable and clears the timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let aborted = false;
  const response = await withFlag("1", () =>
    runCompositorConnectivityProbe({
      getAuthenticatedAdminUser: async () => ({ id: "admin-should-not-leak" }),
      callCompositorAfcSr1Readiness: async (signal?: AbortSignal) => {
        calls += 1;
        signal?.addEventListener("abort", () => {
          aborted = true;
        });
        throw transportError({ classification: "connection_failure" });
      },
    }),
  );
  await assertProbe(response, 503, "unavailable");
  assert.equal(calls, 1);
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(aborted, false);
});

test("malformed readiness returns unavailable", async () => {
  const response = await withFlag("1", () =>
    runCompositorConnectivityProbe({
      getAuthenticatedAdminUser: async () => ({ id: "admin-should-not-leak" }),
      callCompositorAfcSr1Readiness: async () => {
        throw transportError({ classification: "malformed_response", httpStatus: 200 });
      },
    }),
  );
  await assertProbe(response, 503, "unavailable");
});

test("cooperative timeout returns unavailable and aborts the readiness signal at five seconds", async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let aborts = 0;
  let seen: AbortSignal | undefined;
  let rejectReadiness: ((error: Error) => void) | undefined;
  t.after(() => {
    rejectReadiness?.(new Error("unstick"));
  });

  const pending = withFlag("1", () =>
    runCompositorConnectivityProbe({
      getAuthenticatedAdminUser: async () => ({ id: "admin-should-not-leak" }),
      callCompositorAfcSr1Readiness: (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          rejectReadiness = reject;
          calls += 1;
          seen = signal;
          if (!(signal instanceof AbortSignal)) {
            reject(new Error("missing abort signal"));
            return;
          }
          signal.addEventListener("abort", () => {
            aborts += 1;
            reject(transportError({ classification: "timeout" }));
          });
        }),
    }),
  );
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<Response>((_resolve, reject) => {
    watchdog = realSetTimeout(() => reject(new Error("timeout test hung")), 1_000);
  });

  try {
    await flush();
    assert.equal(calls, 1);
    assert.equal(aborts, 0);
    assert.equal(seen?.aborted, false);
    t.mock.timers.tick(4_999);
    await flush();
    assert.equal(aborts, 0);
    assert.equal(seen?.aborted, false);
    t.mock.timers.tick(1);
    const response = await Promise.race([pending, hung]);
    assert.equal(aborts, 1);
    assert.equal(seen?.aborted, true);
    assert.equal(calls, 1);
    await assertProbe(response, 503, "unavailable");
  } finally {
    if (watchdog !== undefined) realClearTimeout(watchdog);
    rejectReadiness?.(new Error("unstick"));
  }
});

test("non-cooperative hanging readiness returns unavailable at five seconds and aborts", async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let aborts = 0;
  let seen: AbortSignal | undefined;
  let rejectReadiness: ((error: Error) => void) | undefined;
  t.after(() => {
    rejectReadiness?.(new Error("late failure secret-stack-trace"));
  });

  const pending = withFlag("1", () =>
    runCompositorConnectivityProbe({
      getAuthenticatedAdminUser: async () => ({ id: "admin-should-not-leak" }),
      callCompositorAfcSr1Readiness: (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          rejectReadiness = reject;
          calls += 1;
          seen = signal;
          signal?.addEventListener("abort", () => {
            aborts += 1;
          });
        }),
    }),
  );
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<Response>((_resolve, reject) => {
    watchdog = realSetTimeout(() => reject(new Error("timeout test hung")), 1_000);
  });

  try {
    await flush();
    assert.equal(calls, 1);
    assert.equal(aborts, 0);
    assert.equal(seen?.aborted, false);
    t.mock.timers.tick(4_999);
    await flush();
    assert.equal(aborts, 0);
    assert.equal(seen?.aborted, false);
    t.mock.timers.tick(1);
    const response = await Promise.race([pending, hung]);
    assert.equal(aborts, 1);
    assert.equal(seen?.aborted, true);
    assert.equal(calls, 1);
    await assertProbe(response, 503, "unavailable");
    rejectReadiness?.(new Error("late failure secret-stack-trace https://compositor.internal.example"));
    await flush();
  } finally {
    if (watchdog !== undefined) realClearTimeout(watchdog);
    rejectReadiness?.(new Error("late failure secret-stack-trace"));
  }
});

test("unconfirmed and non-auth transport failures return unavailable", async () => {
  const cases: Array<{
    classification: CompositorTransportErrorClass;
    httpStatus: number | null;
  }> = [
    { classification: "http_401", httpStatus: null },
    { classification: "http_403", httpStatus: 401 },
    { classification: "http_404", httpStatus: 404 },
    { classification: "http_422", httpStatus: 422 },
    { classification: "http_5xx", httpStatus: 500 },
    { classification: "http_other", httpStatus: 418 },
    { classification: "client_construction_failure", httpStatus: null },
    { classification: "missing_image_artifact", httpStatus: 200 },
  ];

  for (const item of cases) {
    let calls = 0;
    const response = await withFlag("1", () =>
      runCompositorConnectivityProbe({
        getAuthenticatedAdminUser: async () => ({ id: "admin-should-not-leak" }),
        callCompositorAfcSr1Readiness: async () => {
          calls += 1;
          throw transportError(item);
        },
      }),
    );
    await assertProbe(response, 503, "unavailable");
    assert.equal(calls, 1);
  }

  const generic = await withFlag("1", () =>
    runCompositorConnectivityProbe({
      getAuthenticatedAdminUser: async () => ({ id: "admin-should-not-leak" }),
      callCompositorAfcSr1Readiness: async () => {
        throw new Error(
          "secret-stack-trace https://compositor.internal.example Bearer test-secret-token",
        );
      },
    }),
  );
  await assertProbe(generic, 503, "unavailable");

  const disabledCalls = refusingDeps();
  const hidden = await withFlag("true", () => runCompositorConnectivityProbe(disabledCalls));
  assert.equal(hidden.status, 404);
  await assertClosed(hidden);
});
