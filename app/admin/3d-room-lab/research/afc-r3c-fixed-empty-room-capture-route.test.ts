/**
 * Offline route boundary checks. The injectable handler seam prevents every
 * test from reaching real admin auth, capture filesystems, or network paths.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  createFixedEmptyRoomCapturePostHandler,
  runtime,
} from "@/app/api/admin/3d-room-lab/afc-r3c/fixed-empty-room-capture/route";
import type { AfcR3cFixedEmptyRoomCaptureResult } from "./afc-r3c-fixed-empty-room-capture";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("Fixed capture route tests block network.");
};
test.after(() => {
  globalThis.fetch = originalFetch;
});

function withEnv<T>(updates: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function post(body: BodyInit | null = "{}"): Request {
  return new Request("http://localhost/api/admin/3d-room-lab/afc-r3c/fixed-empty-room-capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function handler(args: {
  admin?: boolean;
  capture?: (raw: unknown) => Promise<AfcR3cFixedEmptyRoomCaptureResult>;
}) {
  return createFixedEmptyRoomCapturePostHandler({
    getAuthenticatedAdminUser: async () => (args.admin === false ? null : ({ id: "offline-admin" } as never)),
    capture: args.capture ?? (async () => ({
      status: "cache_miss",
      captureSource: null,
      emptyRoomGenerationCall: false,
      captureWritten: false,
      safety: {
        applied: false,
        authoritative: false,
        persisted: false,
        activeCameraUnchanged: true,
        sceneStateUnchanged: true,
        databaseWrites: false,
        productionAssetWrites: false,
        productionTokenAccountingUsed: false,
        emptyRoomGenerationCall: false,
        geminiFloorProposalCall: false,
        localResearchCaptureWritten: false,
      },
    })),
  });
}

test("route enforces auth, development runtime, and exact feature flag", async () => {
  assert.equal(runtime, "nodejs");
  let delegated = 0;
  const capture = async (): Promise<AfcR3cFixedEmptyRoomCaptureResult> => {
    delegated += 1;
    throw new Error("delegation must not occur");
  };
  await withEnv({ NODE_ENV: "development", AFC_R3C_FIXED_CAPTURE_ENABLED: "true" }, async () => {
    assert.equal((await handler({ admin: false, capture })(post())).status, 403);
  });
  for (const value of [undefined, "TRUE", " true "]) {
    await withEnv({ NODE_ENV: "development", AFC_R3C_FIXED_CAPTURE_ENABLED: value }, async () => {
      assert.equal((await handler({ capture })(post())).status, 404);
    });
  }
  await withEnv({ NODE_ENV: "production", AFC_R3C_FIXED_CAPTURE_ENABLED: "true" }, async () => {
    assert.equal((await handler({ capture })(post())).status, 404);
  });
  assert.equal(delegated, 0);
});

test("route delegates raw parsed JSON only with exact true flag and sanitizes malformed input", async () => {
  let received: unknown = null;
  const capture = async (raw: unknown): Promise<AfcR3cFixedEmptyRoomCaptureResult> => {
    received = raw;
    return {
      status: "cache_miss",
      captureSource: null,
      emptyRoomGenerationCall: false,
      captureWritten: false,
      safety: {
        applied: false,
        authoritative: false,
        persisted: false,
        activeCameraUnchanged: true,
        sceneStateUnchanged: true,
        databaseWrites: false,
        productionAssetWrites: false,
        productionTokenAccountingUsed: false,
        emptyRoomGenerationCall: false,
        geminiFloorProposalCall: false,
        localResearchCaptureWritten: false,
      },
    };
  };
  await withEnv({ NODE_ENV: "development", AFC_R3C_FIXED_CAPTURE_ENABLED: "true" }, async () => {
    const malformed = await handler({ capture })(post("{"));
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { status: "failure", failureCode: "invalid_request" });

    const raw = { contractVersion: "unvalidated-by-route", extra: { retained: true } };
    const response = await handler({ capture })(post(JSON.stringify(raw)));
    assert.equal(response.status, 200);
    assert.deepEqual(received, raw);
    const body = await response.text();
    assert.equal(body.includes("base64"), false);
    assert.equal(body.includes("image bytes"), false);
  });
});

test("route serializes delegated failures without stack traces or provider data", async () => {
  const capture = async (): Promise<AfcR3cFixedEmptyRoomCaptureResult> => ({
    status: "failure",
    failureCode: "empty_generation_failed",
    emptyRoomGenerationCall: true,
    captureWritten: false,
    safety: {
      applied: false,
      authoritative: false,
      persisted: false,
      activeCameraUnchanged: true,
      sceneStateUnchanged: true,
      databaseWrites: false,
      productionAssetWrites: false,
      productionTokenAccountingUsed: false,
      emptyRoomGenerationCall: true,
      geminiFloorProposalCall: false,
      localResearchCaptureWritten: false,
    },
  });
  await withEnv({ NODE_ENV: "development", AFC_R3C_FIXED_CAPTURE_ENABLED: "true" }, async () => {
    const response = await handler({ capture })(post());
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.equal(text.includes("stack"), false);
    assert.equal(text.includes("api-key"), false);
    assert.equal(text.includes("raw provider"), false);
    assert.equal(text.includes("base64"), false);
  });
});
