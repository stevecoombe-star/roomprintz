import assert from "node:assert/strict";
import test from "node:test";

import {
  callCompositorJson,
  CompositorTransportError,
  resolveCompositorEndpoint,
  toCompositorTransportDiagnostic,
  type CompositorTransportErrorClass,
} from "./compositorTransportError";

const TEST_PATH = "/api/research/afc-sr1/tile-floor-vanishing-line";

function withEnvironment(callback: () => Promise<void>): Promise<void> {
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const originalKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ROOMPRINTZ_COMPOSITOR_URL =
    "http://127.0.0.1:8123/vibode/compose";
  process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = "super-secret-token";
  return callback().finally(() => {
    if (originalUrl === undefined) {
      delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    } else {
      process.env.ROOMPRINTZ_COMPOSITOR_URL = originalUrl;
    }
    if (originalKey === undefined) {
      delete process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
    } else {
      process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = originalKey;
    }
    globalThis.fetch = originalFetch;
  });
}

async function expectClass(
  operation: Promise<unknown>,
  classification: CompositorTransportErrorClass,
  httpStatus: number | null = null
): Promise<CompositorTransportError> {
  let observed: unknown;
  try {
    await operation;
  } catch (error) {
    observed = error;
  }
  assert.ok(observed instanceof CompositorTransportError);
  assert.equal(observed.classification, classification);
  assert.equal(observed.httpStatus, httpStatus);
  return observed;
}

test("HTTP statuses map to closed transport classes without response leakage", async () => {
  await withEnvironment(async () => {
    const cases = [
      [404, "http_404"],
      [401, "http_401"],
      [403, "http_403"],
      [422, "http_422"],
      [500, "http_5xx"],
      [503, "http_5xx"],
      [418, "http_other"],
    ] as const;
    for (const [status, classification] of cases) {
      globalThis.fetch = async () =>
        new Response(
          "Bearer super-secret-token imageBase64=forbidden-provider-payload",
          { status }
        );
      const error = await expectClass(
        callCompositorJson({
          seam: "tile-floor-reader",
          path: TEST_PATH,
          method: "POST",
          payload: { imageBase64: "also-forbidden" },
        }),
        classification,
        status
      );
      const serialized = JSON.stringify(toCompositorTransportDiagnostic(error));
      assert.doesNotMatch(serialized, /super-secret-token|imageBase64|provider-payload/);
      assert.deepEqual(error.endpoint, {
        host: "127.0.0.1",
        port: "8123",
        path: TEST_PATH,
      });
    }
  });
});

test("timeout and connection failures are distinct and preserve safe OS code", async () => {
  await withEnvironment(async () => {
    globalThis.fetch = async () => {
      throw new DOMException("request body leaked", "AbortError");
    };
    const timeout = await expectClass(
      callCompositorJson({
        seam: "tile-floor-reader",
        path: TEST_PATH,
        signal: new AbortController().signal,
      }),
      "timeout"
    );
    assert.equal(timeout.message, "Compositor request timed out.");

    globalThis.fetch = async () => {
      const cause = Object.assign(new Error("secret upstream message"), {
        code: "ECONNREFUSED",
      });
      throw Object.assign(new TypeError("fetch failed"), { cause });
    };
    const connection = await expectClass(
      callCompositorJson({
        seam: "tile-floor-reader",
        path: TEST_PATH,
      }),
      "connection_failure"
    );
    assert.equal(connection.osCode, "ECONNREFUSED");
    assert.doesNotMatch(connection.message, /secret|fetch failed/);
  });
});

test("malformed JSON and client construction failures are typed", async () => {
  await withEnvironment(async () => {
    globalThis.fetch = async () => new Response("{", { status: 200 });
    const malformed = await expectClass(
      callCompositorJson({
        seam: "ts0-child-placement",
        path: TEST_PATH,
      }),
      "malformed_response",
      200
    );
    assert.equal(malformed.seam, "ts0-child-placement");

    delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    const missing = await expectClass(
      callCompositorJson({
        seam: "readiness",
        path: TEST_PATH,
      }),
      "client_construction_failure"
    );
    assert.equal(missing.endpoint, null);

    process.env.ROOMPRINTZ_COMPOSITOR_URL =
      "https://user:password@compositor.example";
    await expectClass(
      callCompositorJson({
        seam: "readiness",
        path: TEST_PATH,
      }),
      "client_construction_failure"
    );
  });
});

test("endpoint resolution strips product suffix and exposes only safe shape", async () => {
  await withEnvironment(async () => {
    const resolved = resolveCompositorEndpoint(TEST_PATH);
    assert.equal(
      resolved.url,
      `http://127.0.0.1:8123${TEST_PATH}`
    );
    assert.deepEqual(resolved.endpoint, {
      host: "127.0.0.1",
      port: "8123",
      path: TEST_PATH,
    });
    assert.doesNotMatch(JSON.stringify(resolved.endpoint), /secret|Bearer/);
  });
});
