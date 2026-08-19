import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createAfcSr1LiveAnalyzePostHandler,
  parseAfcSr1LiveAnalyzeRequest,
} from "./route";

const valid = {
  attemptId: "attempt-1",
  sourceImageUrl: "https://images.unsplash.com/room.jpg",
  sourceImageIdentity: {
    sha256: "a".repeat(64),
    decodedWidth: 1200,
    decodedHeight: 800,
    orientation: 1,
  },
  labLoadGeneration: 2,
  referenceDepthM: 4.5,
};

test("live request parser is closed and source-identity bound", () => {
  assert.deepEqual(parseAfcSr1LiveAnalyzeRequest(valid), valid);
  assert.equal(parseAfcSr1LiveAnalyzeRequest({ ...valid, extra: true }), null);
  assert.equal(parseAfcSr1LiveAnalyzeRequest({
    ...valid,
    sourceImageIdentity: { ...valid.sourceImageIdentity, sha256: "bad" },
  }), null);
});

test("route authenticates before parsing or execution", async () => {
  let attempts = 0;
  const handler = createAfcSr1LiveAnalyzePostHandler({
    authenticateAdmin: async () => null,
    executeAttempt: async () => {
      attempts++;
      throw new Error("must not execute");
    },
  });
  const response = await handler(new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify(valid),
  }));
  assert.equal(response.status, 403);
  assert.equal(attempts, 0);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("route delegates one validated product attempt", async () => {
  let attempts = 0;
  const handler = createAfcSr1LiveAnalyzePostHandler({
    authenticateAdmin: async () => ({ id: "admin" } as never),
    executeAttempt: async (request) => {
      attempts++;
      assert.deepEqual(request, valid);
      return {
        status: "failed",
        schemaVersion: "afc-sr1-complete-product-attempt/v2",
        attemptId: request.attemptId,
        resultId: "result-1",
        labLoadGeneration: request.labLoadGeneration,
        reason: "supported_room_ambiguous",
        detail: "test",
        diagnostics: {
          finalReason: "test",
          placementStatus: null,
          placementReason: null,
          validationP90Px: null,
          evidenceDigest: "b".repeat(64),
          sameAttemptTs0Retained: false,
          floorReadDiagnostic: null,
          supportedRoomClassifier: null,
          attemptCounts: {
            originalQualification: 1,
            emptyGeneration: 1,
            tiledGeneration: 0,
            tiledReader: 0,
            geminiFloorProposal: 1,
            supportedRoomClassifier: 1,
            onAxisCorrection: 0,
            pathA: 0,
            rawReader: 0,
            ts0: 0,
            placement: 0,
            childReader: 0,
          },
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
  assert.equal(attempts, 1);
  assert.equal((await response.json()).status, "failed");
});

test("live route selects the isolated TILED authority", () => {
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /executeAfcSr1TiledLiveProductAttempt/);
  assert.doesNotMatch(source, /executeAfcSr1CompleteProductAttempt/);
});
