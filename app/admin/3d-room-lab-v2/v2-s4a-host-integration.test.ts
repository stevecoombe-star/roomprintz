import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type {
  AfcSr1TiledLiveProductDependencies,
} from "../3d-room-lab/afc-sr1-tiled-live-product";
import {
  executeAfcV2Analysis,
  type AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import {
  buildEmptyRoomObservationEvidence,
  buildFailedEmptyRoomObservationEvidence,
  type EmptyRoomObservationAcceptedEvidence,
} from "./empty-room-observation-contract";
import {
  ROOM_BOUNDARY_GOLDEN_FLOOR_CENTER_MAX_ERROR_M,
  ROOM_BOUNDARY_GOLDEN_FLOOR_CORNER_MAX_ERROR_M,
} from "./room-boundary-authority-contract";
import {
  projectFloorAuthorityPolygonToWorld,
  realizeFrozenRoomBoundaryCamera,
} from "./room-boundary-projection.server";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const EMPTY_BYTES = Uint8Array.from([4, 5, 6]);
const originalBasis = {
  sha256: "a".repeat(64),
  byteCount: 100,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/jpeg" as const,
  orientation: 1 as const,
};
const emptyBasis = {
  sha256: sha(EMPTY_BYTES),
  byteCount: EMPTY_BYTES.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const tiledBasis = {
  sha256: "c".repeat(64),
  byteCount: 3,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const input: AfcV2AnalyzeInput = {
  attemptId: "v2-s4a-host",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 21,
  frame: { width: 1118, height: 698 },
  referenceDepthM: 4,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

function providerObservation() {
  return {
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 0.8, y: 0.62 },
          { x: 0.2, y: 0.62 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.8, y: 0.62 },
          { x: 0.2, y: 0.62 },
        ],
        confidence: 0.91,
        visibility: "observed",
      },
    ],
    observedSeams: [{
      id: "visible_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.2, y: 0.62 },
        { x: 0.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  };
}

function observation(): EmptyRoomObservationAcceptedEvidence {
  return buildEmptyRoomObservationEvidence(providerObservation(), {
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-27T12:00:00.000Z",
  });
}

function productDependencies(): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-s4a-result",
    qualifyOriginal: async () => ({
      sourceImageUrl: input.sourceImageUrl,
      basis: originalBasis,
    }),
    resolveEmpty: async () => ({
      basis: emptyBasis,
      bytes: EMPTY_BYTES,
      generated: true,
    }),
    generateTiled: async () => ({
      status: "generated",
      input: emptyBasis,
      tiled: {
        base64: Buffer.from([1, 2, 3]).toString("base64"),
        identity: tiledBasis,
      },
      provenance: {
        generatorId: "vibode-tile-grid-scaffold/stage2/v1",
        profileId: "afc-sr1-tile-grid-scaffold/v1",
        researchPreset: "tile_grid_scaffold",
        requestedModelId: "NBP",
        runId: "v2-s4a-generation",
        generatedAt: "2026-08-27T12:00:00.000Z",
        appliedAspectRatio: "3:2",
        imageTransport: "data_url",
        generationStatus: "generated",
      },
      compatibility: { tier: "exact_grid_compatible" },
    } as never),
    validateTiledLineage: async () => ({
      tiledIdentity: tiledBasis,
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async () => ({
      status: "ok",
      decodedIdentity: tiledBasis,
      readerVersion: "afc-sr1-tiled-perspective-reader/s1",
      authoritativeQuadSourceNormalized: authoritativeFloorQuad,
      authoritativeQuadPixel: [
        { x: 120, y: 720 },
        { x: 1080, y: 720 },
        { x: 780, y: 440 },
        { x: 420, y: 440 },
      ],
      authoritativeCore: {
        rows: 2,
        columns: 2,
        j0: 0,
        i0: 0,
        cellIds: [1, 2, 3, 4],
      },
      selectedComponentTileCount: 4,
      rawQuadrilateralCount: 4,
      deduplicatedCellCount: 4,
      reprojectionMeanPx: 0.5,
      reprojectionMaxPx: 1,
    }),
  };
}

test("zero accepted Room Boundaries does not fail AFC apply", async () => {
  const failedObservation = buildFailedEmptyRoomObservationEvidence({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-27T12:00:00.000Z",
  }, {
    failureClass: "transport",
    failureStage: "provider_invocation",
    provider: "controlled_fixture",
    model: "fixture",
    providerStatus: null,
    safeDetail: "Controlled observer failure.",
    contractValidationReason: null,
  });
  const result = await executeAfcV2Analysis(input, {
    analysisMode: "controlled_replay",
    product: productDependencies(),
    observeRoom: async () => failedObservation,
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.roomObservationStatus, "failed");
  assert.equal(result.roomObservation?.authority, "observation_only");
  assert.equal(
    result.roomObservation?.authoritySeparation.worldProjectionPerformed,
    false,
  );
  assert.ok(result.roomBoundaries);
  assert.equal(result.roomBoundaries.summary.accepted, 0);
  assert.equal(result.roomBoundaries.collisionAuthority, false);
  assert.equal(result.floor.sourceNormalizedPolygon.length, 4);
  assert.equal(result.camera.originalBasisRestored, true);
});

test("S4A construction does not mutate Floor, FOV, camera, or observation authority", async () => {
  const observed = observation();
  const result = await executeAfcV2Analysis(input, {
    analysisMode: "controlled_replay",
    product: productDependencies(),
    observeRoom: async () => observed,
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied" || !result.roomObservation) return;
  assert.deepEqual(result.floor.sourceNormalizedPolygon, authoritativeFloorQuad);
  assert.equal(result.roomObservation.authority, "observation_only");
  assert.equal(
    result.roomObservation.authoritySeparation.worldProjectionPerformed,
    false,
  );
  assert.equal(result.roomObservation.authoritySeparation.floorAuthorityConsumed, false);
  assert.equal(result.roomObservation.authoritySeparation.cameraAuthorityConsumed, false);
  assert.equal(result.roomBoundaries?.collisionAuthority, false);
  assert.equal(
    result.roomBoundaries?.lineage.floor.authorityKey,
    result.floor.authorityKey,
  );
  assert.equal(
    result.roomBoundaries?.lineage.camera.verticalFovDeg,
    result.camera.verticalFovDeg,
  );
  assert.deepEqual(
    result.roomBoundaries?.lineage.camera.pose,
    result.camera.pose,
  );
});

test("Floor Authority golden round-trip through the S4A frozen camera", async () => {
  const result = await executeAfcV2Analysis(input, {
    analysisMode: "controlled_replay",
    product: productDependencies(),
    observeRoom: async () => observation(),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  const realized = realizeFrozenRoomBoundaryCamera({
    verticalFovDeg: result.camera.verticalFovDeg,
    pose: result.camera.pose,
    frame: result.camera.frame,
  });
  assert.equal(realized.ok, true);
  if (!realized.ok) return;
  const projected = projectFloorAuthorityPolygonToWorld(
    result.floor.sourceNormalizedPolygon,
    {
      width: originalBasis.decodedWidth,
      height: originalBasis.decodedHeight,
    },
    result.camera.frame,
    realized.camera,
  );
  assert.equal(projected.every((point) => point.ok), true);
  const worlds = projected.flatMap((point) => point.ok ? [point.world] : []);
  assert.equal(worlds.length, 4);
  for (const world of worlds) {
    assert.ok(Math.abs(world.y) <= 1e-6);
  }
  const xs = worlds.map((world) => world.x);
  const zs = worlds.map((world) => world.z);
  const recoveredWidth = Math.max(...xs) - Math.min(...xs);
  const recoveredDepth = Math.max(...zs) - Math.min(...zs);
  assert.ok(
    Math.abs(recoveredWidth - result.floor.worldWidthM) <=
      ROOM_BOUNDARY_GOLDEN_FLOOR_CORNER_MAX_ERROR_M,
    `width recovered ${recoveredWidth}, expected ${result.floor.worldWidthM}`,
  );
  assert.ok(
    Math.abs(recoveredDepth - result.floor.referenceDepthM) <=
      ROOM_BOUNDARY_GOLDEN_FLOOR_CORNER_MAX_ERROR_M,
    `depth recovered ${recoveredDepth}, expected ${result.floor.referenceDepthM}`,
  );
  const first = projected[0];
  assert.equal(first?.ok, true);
  if (first && first.ok) {
    assert.ok(
      Math.abs(first.containerNormalized.y - first.originalSourceNormalized.y) >
        1e-4,
      "cover-crop container mapping must not be skipped for this off-aspect frame",
    );
  }
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  assert.ok(Math.abs(centerX) <= ROOM_BOUNDARY_GOLDEN_FLOOR_CENTER_MAX_ERROR_M);
  assert.ok(Math.abs(centerZ) <= ROOM_BOUNDARY_GOLDEN_FLOOR_CENTER_MAX_ERROR_M);
});

test("object-layer modules still do not consume Room Observation or Room-Boundary physics", () => {
  const directory = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
  const sceneLayer = readFileSync(path.join(directory, "scene-layer-state.ts"), "utf8");
  const sceneRuntime = readFileSync(path.join(directory, "scene-object-runtime.ts"), "utf8");
  const interaction = readFileSync(
    path.join(directory, "scene-viewport-interaction.ts"),
    "utf8",
  );
  for (const source of [sceneLayer, sceneRuntime, interaction]) {
    assert.doesNotMatch(source, /constructAfcV2RoomBoundaryAuthority|roomBoundaries/);
    assert.doesNotMatch(
      source,
      /wall collision|object clamping|sliding|live-collision/i,
    );
  }
});
