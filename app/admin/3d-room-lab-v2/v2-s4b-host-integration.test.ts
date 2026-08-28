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
} from "./empty-room-observation-contract";
import { AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION } from "./room-collision-authority-contract";

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
  attemptId: "v2-s4b-host",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 22,
  frame: { width: 1118, height: 698 },
  referenceDepthM: 4,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

function observation() {
  return buildEmptyRoomObservationEvidence({
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
        { x: 0.5, y: 0.62 },
        { x: 0.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  }, {
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-28T12:00:00.000Z",
  });
}

function productDependencies(): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-s4b-result",
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
        runId: "v2-s4b-generation",
        generatedAt: "2026-08-28T12:00:00.000Z",
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

test("zero enabled S4B collision boundaries do not fail AFC apply", async () => {
  const failedObservation = buildFailedEmptyRoomObservationEvidence({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-28T12:00:00.000Z",
  }, {
    failureClass: "unknown",
    failureStage: "provider_invocation",
    provider: "controlled_fixture",
    model: "fixture",
    providerStatus: null,
    safeDetail: "controlled",
    contractValidationReason: null,
  });
  const result = await executeAfcV2Analysis(input, {
    analysisMode: "controlled_replay",
    product: productDependencies(),
    observeRoom: async () => failedObservation,
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.ok(result.roomBoundaries);
  assert.equal(result.roomBoundaries.collisionAuthority, false);
  assert.ok(result.roomCollision);
  assert.equal(result.roomCollision.schemaVersion, AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION);
  assert.equal(result.roomCollision.collisionAuthority, false);
  assert.equal(result.floor.sourceNormalizedPolygon.length, 4);
  assert.equal(result.camera.originalBasisRestored, true);
});

test("S4B is constructed after S4A and cannot roll back Floor/Camera/S4A", async () => {
  const observed = observation();
  const result = await executeAfcV2Analysis(input, {
    analysisMode: "controlled_replay",
    product: productDependencies(),
    observeRoom: async () => observed,
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.roomObservation?.authority, "observation_only");
  assert.equal(result.roomBoundaries?.collisionAuthority, false);
  assert.ok(result.roomCollision);
  assert.equal(result.roomCollision.authority, "partial_room_collision_authority");
  assert.deepEqual(result.floor.sourceNormalizedPolygon, authoritativeFloorQuad);
  const analysisSource = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/afc-v2-analysis.server.ts"),
    "utf8",
  );
  const s4aIndex = analysisSource.indexOf("constructAfcV2RoomBoundaryAuthority");
  const s4bIndex = analysisSource.indexOf("constructAfcV2RoomCollisionAuthority");
  assert.ok(s4aIndex > 0 && s4bIndex > s4aIndex);
});

test("S4B host keeps S4A and S4B as separate receipts", () => {
  const roomLabSource = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/RoomLabV2.tsx"),
    "utf8",
  );
  assert.match(roomLabSource, /roomBoundaries: asRoomBoundaryReceipt/);
  assert.match(roomLabSource, /roomCollision: asRoomCollisionReceipt/);
  assert.match(roomLabSource, /afc-v2-s4a-room-boundary-authority\.json/);
  assert.match(roomLabSource, /afc-v2-s4b-room-collision-authority\.json/);
  assert.doesNotMatch(roomLabSource, /FULLY_TILED/);
});

test("V1 runtime files are not modified by S4B", () => {
  const v1Files = [
    "app/admin/3d-room-lab/page.tsx",
    "app/admin/3d-room-lab/p2-s2h-furniture-blocker-collision.ts",
  ];
  for (const relative of v1Files) {
    const source = readFileSync(path.join(process.cwd(), relative), "utf8");
    assert.doesNotMatch(source, /constructAfcV2RoomCollisionAuthority/);
    assert.doesNotMatch(source, /afc-v2-room-collision-authority\/v1/);
  }
});
