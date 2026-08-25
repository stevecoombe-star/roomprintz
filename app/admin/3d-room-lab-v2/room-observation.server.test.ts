import assert from "node:assert/strict";
import test from "node:test";

import {
  digestFrozenCameraSnapshot,
  observeFullyTiledRoomEnvelope,
} from "./room-observation.server";

const camera = {
  verticalFovDeg: 58,
  pose: {
    position: { x: 1, y: 2, z: 3 },
    lookAt: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  },
  frame: { width: 900, height: 600 },
  originalBasisRestored: true as const,
};

const observationInput = {
  attemptId: "observer-controlled",
  floorResultId: "floor-result-controlled",
  generation: {
    bytes: Uint8Array.from([1, 2, 3]),
    originalIdentity: {
      sha256: "a".repeat(64),
      byteCount: 10,
      decodedWidth: 1200,
      decodedHeight: 800,
      mimeType: "image/jpeg" as const,
      orientation: 1 as const,
    },
    identity: {
      sha256: "b".repeat(64),
      byteCount: 20,
      decodedWidth: 1200,
      decodedHeight: 800,
      mimeType: "image/png" as const,
      orientation: 1 as const,
    },
    provenance: {
      generationId: "generation-controlled",
      generatorId: "afc-v2-fully-tiled-compositor/stage4/v1",
      promptVersion: "afc-v2-fully-tiled-generation/v1",
      promptSha256: "c".repeat(64),
      requestedModelId: "NBP",
      generatedFrom: "ORIGINAL" as const,
      parentOriginalSha256: "a".repeat(64),
      generatedAt: "2026-08-25T12:00:00.000Z",
      appliedAspectRatio: "3:2",
      imageTransport: "data_url" as const,
    },
  },
  floor: {
    authorityKey: "certified-floor",
    observationSource: "FULLY_TILED" as const,
    sourceNormalizedPolygon: [
      { x: 0.1, y: 0.9 },
      { x: 0.9, y: 0.9 },
      { x: 0.65, y: 0.55 },
      { x: 0.35, y: 0.55 },
    ],
  },
  camera,
} as const;

test("controlled FULLY_TILED evidence is observed against the frozen camera reference", async () => {
  let suppliedPrompt = "";
  const result = await observeFullyTiledRoomEnvelope(
    observationInput,
    {
      model: "fixture-model",
      now: () => new Date("2026-08-25T12:00:01.000Z"),
      callProvider: async (args) => {
        suppliedPrompt = args.prompt;
        assert.equal(args.imageBase64, "AQID");
        assert.equal(args.mimeType, "image/png");
        assert.ok(args.responseSchema);
        return {
          observedPlanes: [{
            id: "ambiguous_plane",
            category: "unknown",
            imagePolygon: [
              { x: 0.2, y: 0.2 },
              { x: 0.8, y: 0.2 },
              { x: 0.7, y: 0.5 },
            ],
            confidence: 0.45,
            visibility: "observed",
            ambiguity: "Plane role is not visually certain.",
          }],
          observedGridFamilies: [],
          observedSeams: [],
          observedOpenings: [],
          adjacency: [],
          unresolved: ["No seam-supported adjacency is visible."],
        };
      },
    },
  );

  assert.equal(result.status, "observed");
  if (result.status !== "observed") return;
  assert.match(suppliedPrompt, /certified floor\/camera pipeline is already authoritative/i);
  assert.match(suppliedPrompt, /do not estimate, modify, refine, or replace the camera/i);
  assert.match(suppliedPrompt, /Never invent hidden planes/i);
  assert.equal(result.contract.observedPlanes[0].category, "unknown");
  assert.equal(
    result.contract.calibratedCameraReference.frozenSnapshotDigest,
    digestFrozenCameraSnapshot(camera),
  );
  assert.equal(
    result.contract.calibratedCameraReference.floorResultId,
    "floor-result-controlled",
  );
  assert.equal(result.contract.diagnostics.provider, "controlled_fixture");
});

test("Gemini HTTP failure preserves bounded safe diagnostics without secrets", async () => {
  const secret = `AIza${"secret".repeat(8)}`;
  const rawImagePayload = "A".repeat(160);
  const result = await observeFullyTiledRoomEnvelope(observationInput, {
    apiKey: "controlled-api-key",
    model: "gemini-3.5-flash",
    fetch: async () =>
      new Response(JSON.stringify({
        error: {
          status: "INVALID_ARGUMENT",
          message:
            `Schema rejected key=${secret}&next=true payload=${rawImagePayload}`,
        },
      }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  });

  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.diagnostic.failureClass, "provider_http");
  assert.equal(result.diagnostic.failureStage, "provider_response");
  assert.equal(result.diagnostic.provider, "google_gemini");
  assert.equal(result.diagnostic.providerStatus, 400);
  assert.match(result.diagnostic.safeDetail, /INVALID_ARGUMENT/);
  assert.doesNotMatch(result.diagnostic.safeDetail, /AIza|secretsecret|A{96}/);
  assert.ok(result.diagnostic.safeDetail.length <= 320);
});

test("malformed provider result fails closed with a contract reason", async () => {
  const result = await observeFullyTiledRoomEnvelope(observationInput, {
    callProvider: async () => ({
      observedPlanes: "not-an-array",
      observedGridFamilies: [],
      observedSeams: [],
      observedOpenings: [],
      adjacency: [],
      unresolved: [],
    }),
  });

  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.diagnostic.failureClass, "contract_validation");
  assert.equal(result.diagnostic.failureStage, "contract_validation");
  assert.equal(
    result.diagnostic.contractValidationReason,
    "provider_result_observedPlanes_not_array",
  );
});

test("provider schema avoids rejected maxItems complexity while local contract remains strict", async () => {
  let responseSchema: unknown;
  const result = await observeFullyTiledRoomEnvelope(observationInput, {
    callProvider: async (args) => {
      responseSchema = args.responseSchema;
      return {
        observedPlanes: [],
        observedGridFamilies: [],
        observedSeams: [],
        observedOpenings: [],
        adjacency: [],
        unresolved: [],
      };
    },
  });

  assert.equal(result.status, "observed");
  assert.ok(responseSchema);
  const serializedSchema = JSON.stringify(responseSchema);
  assert.doesNotMatch(serializedSchema, /"maxItems"/);
  assert.match(
    serializedSchema,
    /"lineSegments":\{"type":"array","minItems":1/,
  );
});
