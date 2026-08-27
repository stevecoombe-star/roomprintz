import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type {
  AfcSr1TiledLiveProductDependencies,
} from "../3d-room-lab/afc-sr1-tiled-live-product";
import {
  buildEmptyRoomObservationEvidence,
  buildFailedEmptyRoomObservationEvidence,
  type EmptyRoomObservationAcceptedEvidence,
} from "./empty-room-observation-contract";
import {
  observeRetainedEmptyRoom,
} from "./empty-room-observation.server";
import {
  executeAfcV2Analysis,
  type AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";

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
  attemptId: "v2-s3d-empty-observation",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 17,
  frame: { width: 900, height: 600 },
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
    observedOpenings: [{
      id: "partial_doorway",
      category: "doorway",
      hostPlaneId: "visible_wall",
      sourceNormalizedBoundary: [
        { x: 0.5, y: 0.25 },
        { x: 0.62, y: 0.25 },
        { x: 0.62, y: 0.6 },
      ],
      boundaryClosure: "partial_visible_outline",
      boundaryEvidenceCompleteness: "partial_edges_only",
      confidence: 0.78,
      visibility: "observed",
      ambiguity: "The lower boundary meets the visible floor seam.",
    }],
    observedJunctions: [{
      id: "room_corner",
      category: "room_corner",
      sourceNormalizedPoint: { x: 0.2, y: 0.62 },
      seamIds: ["visible_floor_wall"],
      openingIds: [],
      confidence: 0.8,
      visibility: "observed",
    }],
    unresolved: [],
  };
}

function evidence(
  raw: unknown = providerObservation(),
): EmptyRoomObservationAcceptedEvidence {
  return buildEmptyRoomObservationEvidence(raw, {
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v2",
    generatedAt: "2026-08-26T12:00:00.000Z",
  });
}

function productDependencies(
  order: string[],
  options: { readerFails?: boolean } = {},
): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-s3d-result",
    qualifyOriginal: async () => {
      order.push("original");
      return { sourceImageUrl: input.sourceImageUrl, basis: originalBasis };
    },
    resolveEmpty: async () => {
      order.push("empty");
      return { basis: emptyBasis, bytes: EMPTY_BYTES, generated: true };
    },
    generateTiled: async (args) => {
      order.push("tiled");
      assert.equal(
        args.empty.base64,
        Buffer.from(EMPTY_BYTES).toString("base64"),
      );
      return {
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
          runId: "v2-s3d-generation",
          generatedAt: "2026-08-26T12:00:00.000Z",
          appliedAspectRatio: "3:2",
          imageTransport: "data_url",
          generationStatus: "generated",
        },
        compatibility: { tier: "exact_grid_compatible" },
      } as never;
    },
    validateTiledLineage: async () => ({
      tiledIdentity: tiledBasis,
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async (args) => {
      order.push("reader");
      assert.equal(args.imageBase64, Buffer.from([1, 2, 3]).toString("base64"));
      if (options.readerFails) {
        return {
          status: "failed",
          reason: "no_complete_tile",
          decodedIdentity: tiledBasis,
          readerVersion: "afc-sr1-tiled-perspective-reader/s1",
        };
      }
      return {
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
      };
    },
  };
}

test("EMPTY observer consumes exact retained bytes with no Floor or Camera input", async () => {
  let suppliedPrompt = "";
  const result = await observeRetainedEmptyRoom({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    originalAncestorIdentity: originalBasis,
    retainedEmpty: { bytes: EMPTY_BYTES, identity: emptyBasis },
  }, {
    model: "fixture",
    now: () => new Date("2026-08-26T12:00:00.000Z"),
    callProvider: async (args) => {
      suppliedPrompt = args.prompt;
      assert.equal(
        args.imageBase64,
        Buffer.from(EMPTY_BYTES).toString("base64"),
      );
      assert.equal(args.mimeType, "image/png");
      return providerObservation();
    },
  });

  assert.equal(result.observerStatus, "observed");
  assert.equal(result.basis.kind, "EMPTY");
  assert.equal(result.basis.identity.sha256, emptyBasis.sha256);
  assert.equal(result.basis.originalAncestorSha256, originalBasis.sha256);
  assert.equal(result.basis.loadGeneration, input.loadGeneration);
  assert.equal(result.basis.exactRetainedBytesConsumed, true);
  assert.equal(result.coordinateSpace, "empty-source-normalized-image/v1");
  assert.equal(result.authority, "observation_only");
  assert.deepEqual(result.authoritySeparation, {
    cameraAuthorityConsumed: false,
    floorAuthorityConsumed: false,
    worldProjectionPerformed: false,
    tiledEvidenceConsumed: false,
    fullyTiledEvidenceConsumed: false,
  });
  assert.match(suppliedPrompt, /visible architectural evidence/i);
  assert.match(suppliedPrompt, /Do not infer hidden walls/i);
  assert.match(suppliedPrompt, /Do not close visible openings/i);
  assert.match(suppliedPrompt, /Do not assume symmetry/i);
  assert.match(suppliedPrompt, /furniture.*object edges as structural seams/i);
  assert.match(suppliedPrompt, /Never return world coordinates/i);
  assert.match(suppliedPrompt, /camera estimates, or FOV estimates/i);
  assert.match(suppliedPrompt, /general quadrilateral in perspective/i);
  assert.match(suppliedPrompt, /Do not force horizontal top\/bottom edges/i);
  assert.match(suppliedPrompt, /partial_edges_only/i);
  assert.match(suppliedPrompt, /certainty in the reported coordinates/i);
  assert.match(suppliedPrompt, /Trace each wall-ceiling seam independently/i);
  assert.match(suppliedPrompt, /Do not derive a wall-ceiling seam merely/i);
});

test("quality gate keeps partial evidence and rejects malformed geometry conservatively", () => {
  const result = evidence({
    ...providerObservation(),
    observedPlanes: [
      ...providerObservation().observedPlanes,
      {
        id: "hidden_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.2 },
          { x: 0.3, y: 0.3 },
        ],
        confidence: 0.99,
        visibility: "inferred_hidden",
      },
    ],
    cameraPose: { x: 1 },
    worldGeometry: [],
    unresolved: ["Right wall continuation is occluded."],
  });

  assert.equal(result.observerStatus, "partial");
  assert.equal(result.observedPlanes.some((plane) => plane.id === "hidden_wall"), false);
  assert.deepEqual(
    result.qualityGate.rejectedForbiddenProviderFields,
    ["cameraPose", "worldGeometry"],
  );
  assert.ok(result.qualityGate.parserRejections.length > 0);
  assert.match(result.qualityGate.unresolved[0], /occluded/);
  assert.equal(result.qualityGate.normalization.geometryManufactured, false);
  assert.equal(result.qualityGate.normalization.hiddenContinuationAdded, false);
});

test("oblique opening preserves its perspective quadrilateral without axis alignment", () => {
  const perspectiveBoundary = [
    { x: 0.448, y: 0.285 },
    { x: 0.638, y: 0.265 },
    { x: 0.642, y: 0.415 },
    { x: 0.451, y: 0.44 },
  ];
  const result = evidence({
    ...providerObservation(),
    observedOpenings: [{
      id: "right_wall_window",
      category: "window",
      hostPlaneId: "visible_wall",
      sourceNormalizedBoundary: perspectiveBoundary,
      boundaryClosure: "complete_visible_outline",
      boundaryEvidenceCompleteness: "all_edges_visibly_traced",
      confidence: 0.84,
      visibility: "observed",
    }],
  });

  assert.equal(result.observerStatus, "observed");
  assert.deepEqual(
    result.observedOpenings[0]?.sourceNormalizedBoundary,
    perspectiveBoundary,
  );
  assert.notEqual(perspectiveBoundary[0].y, perspectiveBoundary[1].y);
  assert.notEqual(perspectiveBoundary[2].y, perspectiveBoundary[3].y);
  assert.equal(result.observedOpenings[0]?.boundaryClosure, "complete_visible_outline");
  assert.equal(result.qualityGate.openingClosureAdjustments.length, 0);
  assert.equal(result.qualityGate.normalization.geometryManufactured, false);
});

test("three visible opening sides remain an open partial boundary", () => {
  const threeVisibleSides = [
    { x: 0.45, y: 0.29 },
    { x: 0.63, y: 0.27 },
    { x: 0.64, y: 0.42 },
    { x: 0.46, y: 0.44 },
  ];
  const result = evidence({
    ...providerObservation(),
    observedOpenings: [{
      id: "partial_right_window",
      category: "window",
      hostPlaneId: "visible_wall",
      sourceNormalizedBoundary: threeVisibleSides,
      boundaryClosure: "partial_visible_outline",
      boundaryEvidenceCompleteness: "partial_edges_only",
      confidence: 0.68,
      visibility: "observed",
      ambiguity: "The fourth edge is obscured by trim and shadow.",
    }],
  });

  assert.deepEqual(
    result.observedOpenings[0]?.sourceNormalizedBoundary,
    threeVisibleSides,
  );
  assert.equal(result.observedOpenings[0]?.sourceNormalizedBoundary.length, 4);
  assert.equal(result.observedOpenings[0]?.boundaryClosure, "partial_visible_outline");
  assert.equal(result.observedOpenings[0]?.closureValidation, "consistent_partial");
  assert.equal(result.qualityGate.normalization.geometryManufactured, false);
});

test("false complete opening claims downgrade or reject without missing-edge synthesis", () => {
  const contradictoryBoundary = [
    { x: 0.45, y: 0.29 },
    { x: 0.63, y: 0.27 },
    { x: 0.64, y: 0.42 },
    { x: 0.46, y: 0.44 },
  ];
  const result = evidence({
    ...providerObservation(),
    observedOpenings: [
      {
        id: "contradictory_complete",
        category: "window",
        hostPlaneId: "visible_wall",
        sourceNormalizedBoundary: contradictoryBoundary,
        boundaryClosure: "complete_visible_outline",
        boundaryEvidenceCompleteness: "partial_edges_only",
        confidence: 0.72,
        visibility: "observed",
        ambiguity: "One boundary edge is not visibly supported.",
      },
      {
        id: "malformed_complete",
        category: "window",
        hostPlaneId: "visible_wall",
        sourceNormalizedBoundary: [
          { x: 0.2, y: 0.2 },
          { x: 0.3, y: 0.3 },
        ],
        boundaryClosure: "complete_visible_outline",
        boundaryEvidenceCompleteness: "all_edges_visibly_traced",
        confidence: 0.95,
        visibility: "observed",
      },
    ],
  });

  assert.equal(result.observerStatus, "partial");
  assert.equal(result.observedOpenings.length, 1);
  assert.deepEqual(
    result.observedOpenings[0]?.sourceNormalizedBoundary,
    contradictoryBoundary,
  );
  assert.equal(result.observedOpenings[0]?.boundaryClosure, "partial_visible_outline");
  assert.equal(
    result.observedOpenings[0]?.closureValidation,
    "downgraded_to_partial_due_incomplete_visible_edge_evidence",
  );
  assert.equal(result.qualityGate.openingClosureAdjustments.length, 1);
  assert.equal(
    result.qualityGate.parserRejections.some((entry) =>
      entry.rawId === "malformed_complete"
    ),
    true,
  );
  assert.equal(result.qualityGate.normalization.geometryManufactured, false);
});

test("wall-ceiling seam preserves only the explicit interior source polyline", () => {
  const visibleJunction = [
    { x: 0.22, y: 0.17 },
    { x: 0.5, y: 0.13 },
    { x: 0.78, y: 0.1 },
  ];
  const base = providerObservation();
  const result = evidence({
    ...base,
    observedPlanes: [
      ...base.observedPlanes,
      {
        id: "visible_ceiling",
        category: "ceiling",
        sourceNormalizedPolygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.9, y: 0.2 },
          { x: 0.1, y: 0.2 },
        ],
        confidence: 0.82,
        visibility: "observed",
      },
    ],
    observedSeams: [
      ...base.observedSeams,
      {
        id: "explicit_wall_ceiling",
        category: "wall_ceiling",
        planeIds: ["visible_wall", "visible_ceiling"],
        sourceNormalizedPolyline: visibleJunction,
        confidence: 0.79,
        visibility: "observed",
        ambiguity: "Only the central physical junction is confidently visible.",
      },
    ],
  });

  const seam = result.observedSeams.find((item) =>
    item.id === "explicit_wall_ceiling"
  );
  assert.deepEqual(seam?.sourceNormalizedPolyline, visibleJunction);
  assert.notEqual(seam?.sourceNormalizedPolyline[0]?.x, 0);
  assert.notEqual(seam?.sourceNormalizedPolyline.at(-1)?.x, 1);
  assert.equal(result.observedSeams.length, base.observedSeams.length + 1);
});

test("existing floor-wall, wall-wall, floor-region, and back-window evidence remains supported", () => {
  const base = providerObservation();
  const backWindow = [
    { x: 0.28, y: 0.25 },
    { x: 0.42, y: 0.25 },
    { x: 0.42, y: 0.42 },
    { x: 0.28, y: 0.42 },
  ];
  const wallWall = [
    { x: 0.2, y: 0.12 },
    { x: 0.2, y: 0.62 },
  ];
  const result = evidence({
    ...base,
    observedPlanes: [
      ...base.observedPlanes,
      {
        id: "visible_side_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0, y: 0.05 },
          { x: 0.2, y: 0.1 },
          { x: 0.2, y: 0.62 },
          { x: 0, y: 0.75 },
        ],
        confidence: 0.88,
        visibility: "observed",
      },
    ],
    observedSeams: [
      ...base.observedSeams,
      {
        id: "visible_wall_wall",
        category: "wall_wall",
        planeIds: ["visible_wall", "visible_side_wall"],
        sourceNormalizedPolyline: wallWall,
        confidence: 0.9,
        visibility: "observed",
      },
    ],
    observedOpenings: [{
      id: "back_window",
      category: "window",
      hostPlaneId: "visible_wall",
      sourceNormalizedBoundary: backWindow,
      boundaryClosure: "complete_visible_outline",
      boundaryEvidenceCompleteness: "all_edges_visibly_traced",
      confidence: 0.9,
      visibility: "observed",
    }],
  });

  assert.equal(result.observedVisibleFloorRegions.length, 1);
  assert.deepEqual(
    result.observedSeams.find((item) => item.category === "floor_wall")
      ?.sourceNormalizedPolyline,
    base.observedSeams[0].sourceNormalizedPolyline,
  );
  assert.deepEqual(
    result.observedSeams.find((item) => item.category === "wall_wall")
      ?.sourceNormalizedPolyline,
    wallWall,
  );
  assert.deepEqual(result.observedOpenings[0]?.sourceNormalizedBoundary, backWindow);
});

test("Room Observation starts from retained EMPTY before TILED and survives Floor failure", async () => {
  const order: string[] = [];
  let observedBytes: Uint8Array | null = null;
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(order, { readerFails: true }),
    observeRoom: async (observationInput) => {
      order.push("observer");
      observedBytes = Uint8Array.from(observationInput.retainedEmpty.bytes);
      assert.equal(
        observationInput.retainedEmpty.identity.sha256,
        emptyBasis.sha256,
      );
      assert.equal(observationInput.originalAncestorIdentity.sha256, originalBasis.sha256);
      assert.equal("floor" in observationInput, false);
      assert.equal("camera" in observationInput, false);
      return evidence();
    },
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(order, ["original", "empty", "observer", "tiled", "reader"]);
  assert.deepEqual(observedBytes, EMPTY_BYTES);
  assert.equal(result.roomObservationStatus, "observed");
  assert.equal(result.roomObservation?.basis.identity.sha256, emptyBasis.sha256);
  assert.equal(result.executionCounts.roomObserver, 1);
  assert.equal(result.executionCounts.tiledFloorReader, 1);
});

test("Room Observation failure does not block certified Floor, Apply, freeze, or restore", async () => {
  const order: string[] = [];
  const failedObservation = buildFailedEmptyRoomObservationEvidence({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v2",
    generatedAt: "2026-08-26T12:00:00.000Z",
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
    product: productDependencies(order),
    observeRoom: async () => {
      order.push("observer");
      return failedObservation;
    },
  });

  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.roomObservationStatus, "failed");
  assert.deepEqual(result.product.geometry.sourceNormalizedPolygon, authoritativeFloorQuad);
  assert.equal(result.product.geometry.geometryAuthority, "tiled_perspective_reader");
  assert.equal(result.camera.originalBasisRestored, true);
  assert.equal(result.executionCounts.fullyTiledGeneration, 0);
  assert.equal(result.executionCounts.fullyTiledFloorReader, 0);
});

test("unexpected observer rejection is converted to failure evidence without blocking Apply", async () => {
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies([]),
    observeRoom: async () => {
      throw new Error("controlled rejection");
    },
  });
  assert.equal(result.status, "applied");
  assert.equal(result.roomObservationStatus, "failed");
  assert.match(
    result.roomObservation?.failure?.safeDetail ?? "",
    /continued independently/,
  );
});

test("observer and Floor failures are both receipted without circular recovery", async () => {
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies([], { readerFails: true }),
    observeRoom: async () => {
      throw new Error("controlled rejection");
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.roomObservationStatus, "failed");
  assert.equal(result.roomObservation?.authoritySeparation.floorAuthorityConsumed, false);
  assert.equal(result.executionCounts.tiledFloorReader, 1);
});

test("visible floor observation is never substituted for TILED Floor authority", async () => {
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies([]),
    observeRoom: async () => evidence(),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied" || !result.roomObservation) return;
  assert.notDeepEqual(
    result.roomObservation.observedVisibleFloorRegions[0]
      ?.sourceNormalizedPolygon,
    authoritativeFloorQuad,
  );
  assert.deepEqual(result.floor.sourceNormalizedPolygon, authoritativeFloorQuad);
  assert.equal(
    result.roomObservation.observedVisibleFloorRegions[0]?.role,
    "observed_visible_floor_region_not_floor_authority",
  );
});
