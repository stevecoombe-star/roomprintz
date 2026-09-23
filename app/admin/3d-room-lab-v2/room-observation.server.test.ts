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
          planeContinuity: [],
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

test("visible floor observation stays distinct from the unchanged calibration Floor patch", async () => {
  const calibrationBefore = JSON.stringify(
    observationInput.floor.sourceNormalizedPolygon,
  );
  let suppliedPrompt = "";
  const visibleFloorPolygon = [
    { x: 0.02, y: 0.62 },
    { x: 0.98, y: 0.62 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const result = await observeFullyTiledRoomEnvelope(observationInput, {
    callProvider: async (args) => {
      suppliedPrompt = args.prompt;
      return {
        observedPlanes: [{
          id: "visible_floor",
          category: "floor",
          imagePolygon: visibleFloorPolygon,
          confidence: 0.95,
          visibility: "observed",
        }],
        observedGridFamilies: [{
          id: "visible_floor_axis_a",
          planeId: "visible_floor",
          axis: "axis_a",
          lineSegments: [{
            start: { x: 0.2, y: 0.8 },
            end: { x: 0.8, y: 0.8 },
          }],
          confidence: 0.9,
          visibility: "observed",
        }],
        observedSeams: [],
        observedOpenings: [],
        planeContinuity: [],
        adjacency: [],
        unresolved: [],
      };
    },
  });

  assert.equal(result.status, "observed");
  if (result.status !== "observed") return;
  assert.match(suppliedPrompt, /calibration patch, not the visible floor extent/i);
  assert.deepEqual(
    result.contract.observedPlanes[0].imagePolygon,
    visibleFloorPolygon,
  );
  assert.notDeepEqual(
    result.contract.observedPlanes[0].imagePolygon,
    observationInput.floor.sourceNormalizedPolygon,
  );
  assert.equal(
    JSON.stringify(observationInput.floor.sourceNormalizedPolygon),
    calibrationBefore,
  );
  assert.equal(
    result.contract.calibratedCameraReference.authorityKey,
    observationInput.floor.authorityKey,
  );
  assert.equal(result.contract.diagnostics.worldGeometryProduced, false);
});

test("missing wall and ceiling grids receive a bounded focused provider refinement", async () => {
  let calls = 0;
  let refinementPrompt = "";
  const result = await observeFullyTiledRoomEnvelope(observationInput, {
    callProvider: async (args) => {
      calls += 1;
      if (calls === 1) {
        return {
          observedPlanes: [
            {
              id: "wall_visible",
              category: "wall",
              imagePolygon: [
                { x: 0.1, y: 0.2 },
                { x: 0.8, y: 0.2 },
                { x: 0.8, y: 0.7 },
                { x: 0.1, y: 0.7 },
              ],
              confidence: 0.95,
              visibility: "observed",
            },
            {
              id: "ceiling_visible",
              category: "ceiling",
              imagePolygon: [
                { x: 0.1, y: 0.05 },
                { x: 0.9, y: 0.05 },
                { x: 0.8, y: 0.15 },
                { x: 0.1, y: 0.15 },
              ],
              confidence: 0.9,
              visibility: "observed",
            },
          ],
          observedGridFamilies: [],
          observedSeams: [],
          observedOpenings: [],
          planeContinuity: [],
          unresolved: [],
        };
      }
      refinementPrompt = args.prompt;
      return {
        observedGridFamilies: [
          {
            id: "wall_axis_a",
            planeId: "wall_visible",
            axis: "axis_a",
            lineSegments: [
              { start: { x: 0.2, y: 0.3 }, end: { x: 0.7, y: 0.3 } },
              { start: { x: 0.2, y: 0.4 }, end: { x: 0.7, y: 0.4 } },
            ],
            confidence: 0.9,
            visibility: "observed",
          },
          {
            id: "ceiling_axis_a",
            planeId: "ceiling_visible",
            axis: "axis_a",
            lineSegments: [
              { start: { x: 0.2, y: 0.1 }, end: { x: 0.8, y: 0.1 } },
              { start: { x: 0.25, y: 0.14 }, end: { x: 0.75, y: 0.14 } },
            ],
            confidence: 0.85,
            visibility: "observed",
          },
        ],
        unresolved: [],
      };
    },
  });

  assert.equal(result.status, "observed");
  if (result.status !== "observed") return;
  assert.equal(calls, 2);
  assert.match(refinementPrompt, /focused grout-line census/i);
  assert.match(refinementPrompt, /wall_visible/);
  assert.match(refinementPrompt, /ceiling_visible/);
  assert.deepEqual(
    result.contract.observedGridFamilies.map((family) => family.planeId).sort(),
    ["ceiling_visible", "wall_visible"],
  );
  assert.equal(result.contract.diagnostics.providerPasses.gridRefinement, 1);
});

test("missing floor-wall and wall-ceiling boundaries receive focused seam refinement", async () => {
  let calls = 0;
  const result = await observeFullyTiledRoomEnvelope(observationInput, {
    callProvider: async (args) => {
      calls += 1;
      if (calls === 1) {
        return {
          observedPlanes: [
            {
              id: "floor_visible",
              category: "floor",
              imagePolygon: [
                { x: 0.1, y: 0.65 },
                { x: 0.9, y: 0.65 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
              ],
              confidence: 0.95,
              visibility: "observed",
            },
            {
              id: "wall_visible",
              category: "wall",
              imagePolygon: [
                { x: 0.1, y: 0.2 },
                { x: 0.9, y: 0.2 },
                { x: 0.9, y: 0.65 },
                { x: 0.1, y: 0.65 },
              ],
              confidence: 0.95,
              visibility: "observed",
            },
            {
              id: "ceiling_visible",
              category: "ceiling",
              imagePolygon: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0.9, y: 0.2 },
                { x: 0.1, y: 0.2 },
              ],
              confidence: 0.9,
              visibility: "observed",
            },
          ],
          observedGridFamilies: [
            {
              id: "floor_grid",
              planeId: "floor_visible",
              axis: "axis_a",
              lineSegments: [{
                start: { x: 0.2, y: 0.8 },
                end: { x: 0.8, y: 0.8 },
              }],
              confidence: 0.9,
              visibility: "observed",
            },
            {
              id: "wall_grid",
              planeId: "wall_visible",
              axis: "axis_a",
              lineSegments: [{
                start: { x: 0.2, y: 0.4 },
                end: { x: 0.8, y: 0.4 },
              }],
              confidence: 0.9,
              visibility: "observed",
            },
            {
              id: "ceiling_grid",
              planeId: "ceiling_visible",
              axis: "axis_a",
              lineSegments: [{
                start: { x: 0.2, y: 0.1 },
                end: { x: 0.8, y: 0.1 },
              }],
              confidence: 0.85,
              visibility: "observed",
            },
          ],
          observedSeams: [],
          observedOpenings: [],
          planeContinuity: [],
          unresolved: [],
        };
      }
      assert.match(args.prompt, /focused visible-seam census/i);
      return {
        observedSeams: [
          {
            id: "refined_floor_wall",
            category: "floor_wall",
            planeIds: ["floor_visible", "wall_visible"],
            imagePolyline: [
              { x: 0.1, y: 0.65 },
              { x: 0.9, y: 0.65 },
            ],
            confidence: 0.9,
            visibility: "observed",
            boundaryEvidence: "architectural_break",
            gridCompatibility: "incompatible",
          },
          {
            id: "refined_wall_ceiling",
            category: "wall_ceiling",
            planeIds: ["wall_visible", "ceiling_visible"],
            imagePolyline: [
              { x: 0.1, y: 0.2 },
              { x: 0.9, y: 0.2 },
            ],
            confidence: 0.9,
            visibility: "observed",
            boundaryEvidence: "architectural_break",
            gridCompatibility: "incompatible",
          },
        ],
        unresolved: [],
      };
    },
  });

  assert.equal(result.status, "observed");
  if (result.status !== "observed") return;
  assert.equal(calls, 2);
  assert.deepEqual(
    result.contract.observedSeams.map((seam) => seam.category).sort(),
    ["floor_wall", "wall_ceiling"],
  );
  assert.equal(result.contract.adjacency.length, 2);
  assert.equal(result.contract.diagnostics.providerPasses.seamRefinement, 1);
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
      planeContinuity: [],
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
        planeContinuity: [],
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
