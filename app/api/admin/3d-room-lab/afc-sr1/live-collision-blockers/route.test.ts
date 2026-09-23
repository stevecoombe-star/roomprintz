import assert from "node:assert/strict";
import test from "node:test";

import {
  createP2S2HLiveCollisionBlockersPostHandler,
  parseP2S2HLiveCollisionBlockersRequest,
} from "./route";

const valid = {
  attemptId: "attempt-1",
  resultId: "result-1",
  labLoadGeneration: 3,
  freezeReceipt: { receiptVersion: "test" },
};

test("live blocker request parser is closed and lifecycle-bound", () => {
  assert.deepEqual(parseP2S2HLiveCollisionBlockersRequest(valid), valid);
  for (const malformed of [
    { ...valid, extra: true },
    { ...valid, attemptId: "../stale" },
    { ...valid, resultId: "" },
    { ...valid, labLoadGeneration: -1 },
    { ...valid, freezeReceipt: null },
  ]) {
    assert.equal(parseP2S2HLiveCollisionBlockersRequest(malformed), null);
  }
});

test("live blocker route authenticates before parsing or production", async () => {
  let calls = 0;
  const handler = createP2S2HLiveCollisionBlockersPostHandler({
    authenticateAdmin: async () => null,
    produceBlockers: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  const response = await handler(new Request("http://localhost", {
    method: "POST",
    body: "{not-json",
  }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), {
    error: "Admin access required.",
  });
});

test("live blocker route rejects malformed JSON and malformed bodies deterministically", async () => {
  let calls = 0;
  const handler = createP2S2HLiveCollisionBlockersPostHandler({
    authenticateAdmin: async () => ({ id: "admin" } as never),
    produceBlockers: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  const invalidJson = await handler(new Request("http://localhost", {
    method: "POST",
    body: "{not-json",
  }));
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.headers.get("cache-control"), "no-store");
  assert.deepEqual(await invalidJson.json(), {
    error: "Request body was not valid JSON.",
  });

  const invalidBody = await handler(new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify({ ...valid, extra: true }),
  }));
  assert.equal(invalidBody.status, 400);
  assert.equal(invalidBody.headers.get("cache-control"), "no-store");
  assert.deepEqual(await invalidBody.json(), {
    error: "AFC live blocker request was invalid.",
  });
  assert.equal(calls, 0);
});

test("live blocker route delegates one validated post-freeze request", async () => {
  let calls = 0;
  const handler = createP2S2HLiveCollisionBlockersPostHandler({
    authenticateAdmin: async () => ({ id: "admin" } as never),
    produceBlockers: async (request) => {
      calls += 1;
      assert.deepEqual(request, valid);
      return {
        ok: true,
        contractVersion: "p2-s2h-live-collision-blockers/v1",
        attemptId: request.attemptId,
        resultId: request.resultId,
        labLoadGeneration: request.labLoadGeneration,
        freezeReceiptPayloadSha256: "a".repeat(64),
        blockerQualification: {
          qualificationVersion:
            "p2-s2g-collision-safe-blocker-qualification/v1",
          coordinateSpace: "calibrated-world-xz/v1",
          segments: [],
          rejections: [],
        },
      };
    },
  });
  const response = await handler(new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(valid),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), {
    ok: true,
    contractVersion: "p2-s2h-live-collision-blockers/v1",
    attemptId: valid.attemptId,
    resultId: valid.resultId,
    labLoadGeneration: valid.labLoadGeneration,
    freezeReceiptPayloadSha256: "a".repeat(64),
    blockerQualification: {
      qualificationVersion:
        "p2-s2g-collision-safe-blocker-qualification/v1",
      coordinateSpace: "calibrated-world-xz/v1",
      segments: [],
      rejections: [],
    },
  });
});
