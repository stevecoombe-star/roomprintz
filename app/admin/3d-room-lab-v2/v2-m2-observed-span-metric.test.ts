import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type {
  AfcSr1TiledLiveProductDependencies,
} from "../3d-room-lab/afc-sr1-tiled-live-product";
import {
  executeAfcV2Analysis,
  launchObservedSpanPhysicalEstimate,
  type AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import { buildEmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import {
  deriveAutoMetricScale,
  evaluateTrustedBackWallWidthSpan,
} from "./metric-auto-scale";
import {
  AUTO_METRIC_SCALE_SANITY_MAX,
  AUTO_METRIC_SCALE_SANITY_MIN,
  deriveUniformMetricScaleFromPhysicalSpan,
} from "./metric-auto-scale-contract";
import { METRIC_SPAN_MIN_MODEL_CONFIDENCE } from "./metric-correspondence-estimate-acceptance";
import { selectMetricCorrespondenceSpan } from "./metric-correspondence-span";
import { METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED } from "./metric-correspondence-span-contract";
import {
  OBSERVED_SPAN_AUTO_SOURCE_COPY,
  deriveObservedSpanAutoMetricScale,
  selectAppliedAutoMetricScale,
} from "./observed-span-auto-metric-scale";
import {
  classifyObservedSpanEndpoint,
  inspectCompleteBackWallMetricGeometry,
  isMetricSafeProjectedFloorWall,
  markObservedSpanEstimatorLaunched,
  selectObservedSpanMetricCandidate,
} from "./observed-span-metric-candidate";
import {
  AFC_V2_OBSERVED_SPAN_METRIC_AUTHORITY,
  OBSERVED_SPAN_COLLISION_AUTHORITY_SEPARATE_COPY,
  OBSERVED_SPAN_METRIC_GEOMETRY_CLASS,
  OBSERVED_SPAN_METRIC_GEOMETRY_COPY,
  OBSERVED_SPAN_METRIC_GEOMETRY_SOURCE,
  OBSERVED_SPAN_METRIC_HELPER_COPY,
  OBSERVED_SPAN_METRIC_LABEL,
  OBSERVED_SPAN_SEMANTIC_S4A_BYPASSED_COPY,
  observedSpanEndpointDiagnosticCopy,
  observedSpanTruncationDiagnosticCopy,
} from "./observed-span-metric-candidate-contract";
import { acceptObservedSpanPhysicalEstimate } from "./observed-span-physical-estimate-acceptance";
import {
  AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_AUTHORITY,
  OBSERVED_SPAN_OVERLAY_CAPTION,
  parseObservedSpanPhysicalEstimate,
  type ObservedSpanEstimateLineage,
  type ObservedSpanPhysicalEstimate,
} from "./observed-span-physical-estimate-contract";
import {
  estimateObservedSpanPhysicalLength,
  observedSpanPhysicalEstimatorPrompt,
  observedSpanProviderSegmentMetadata,
} from "./observed-span-physical-estimate.server";
import type {
  RoomBoundaryCandidate,
  RoomBoundaryWorldGeometry,
} from "./room-boundary-authority-contract";
import { AUTO_METRIC_SCALE, computeMetricScale } from "./scene-metric-world-realization";
import { METRIC_CORRESPONDENCE_OVERLAY_CAPTION } from "./metric-correspondence-overlay.server";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const V1_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab");
const ROOM4_LIVE_CANONICAL_LENGTH = 9.582188;
const ROOM4_WIDTH_M = 3.6;
const ROOM4_LIVE_AUTO = ROOM4_WIDTH_M / ROOM4_LIVE_CANONICAL_LENGTH;
const CAMERA = {
  position: { x: 0, y: 2, z: 4 },
  lookAt: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
} as const;
const S4A_SAFE = Object.freeze({
  observedSpanOnly: true,
  hiddenContinuation: false,
  geometryManufactured: false,
});

function readV2(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

function geometry(
  ax: number,
  az: number,
  bx: number,
  bz: number,
): RoomBoundaryWorldGeometry {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz);
  return {
    baseStart: { x: ax, y: 0, z: az },
    baseEnd: { x: bx, y: 0, z: bz },
    tangent: { x: dx / length, y: 0, z: dz / length },
    supportPlaneNormal: { x: -dz / length, y: 0, z: dx / length },
    supportPlaneConstant: 0,
  };
}

function okProjection(
  image: { x: number; y: number },
  world: { x: number; z: number },
) {
  return {
    ok: true as const,
    emptySourceNormalized: image,
    originalSourceNormalized: image,
    containerNormalized: image,
    world: { x: world.x, y: 0, z: world.z },
  };
}

function s4aCandidate(overrides: {
  id?: string;
  sourceSeamId?: string;
  status?: RoomBoundaryCandidate["status"];
  category?: RoomBoundaryCandidate["source"]["category"];
  observationSource?: RoomBoundaryCandidate["source"]["observationSource"];
  wallPlaneId?: string | null;
  confidence?: number;
  ambiguity?: string | null;
  frameAdjacentEndpoint?: boolean;
  hiddenContinuation?: boolean;
  geometryManufactured?: boolean;
  completeWall?: boolean;
  observedSpanOnly?: boolean;
  projectionOk?: boolean;
  emptyProjection?: boolean;
  nonFiniteWorld?: boolean;
  coincidentWorld?: boolean;
  lineResidualClass?: RoomBoundaryCandidate["imageEvidence"]["lineResidualClass"];
  worldGeometry?: RoomBoundaryWorldGeometry | null;
  imageA?: { x: number; y: number };
  imageB?: { x: number; y: number };
  reasons?: readonly string[];
  openingsPolyline?: readonly { x: number; y: number }[];
  interiorStatus?: "accepted" | "insufficient";
} = {}): RoomBoundaryCandidate {
  const world = overrides.worldGeometry === undefined
    ? geometry(-2, 0, 2, 0)
    : overrides.worldGeometry;
  const imageA = overrides.imageA ?? { x: 0.2, y: 0.62 };
  const imageB = overrides.imageB ?? { x: 0.8, y: 0.62 };
  const worldA = world
    ? { x: world.baseStart.x, z: world.baseStart.z }
    : { x: 0, z: 0 };
  const worldB = world
    ? { x: world.baseEnd.x, z: world.baseEnd.z }
    : { x: 0, z: 0 };
  const projectedWorldA = overrides.nonFiniteWorld
    ? { x: Number.NaN, z: worldA.z }
    : worldA;
  const projectedWorldB = overrides.nonFiniteWorld
    ? { x: Number.NaN, z: worldB.z }
    : overrides.coincidentWorld
    ? worldA
    : worldB;
  const projectionPoints = overrides.emptyProjection
    ? []
    : overrides.projectionOk === false
    ? [
      {
        ok: false as const,
        emptySourceNormalized: imageA,
        reason: "ray_projection_failed" as const,
        detail: "malformed projection",
      },
      {
        ok: false as const,
        emptySourceNormalized: imageB,
        reason: "ray_projection_failed" as const,
        detail: "malformed projection",
      },
    ]
    : [
      okProjection(imageA, projectedWorldA),
      okProjection(imageB, projectedWorldB),
    ];
  const interiorAccepted = overrides.interiorStatus !== "insufficient";
  const status = overrides.status ?? "accepted";
  return {
    id: overrides.id ?? "rb_back_floor_wall",
    sourceSeamId: overrides.sourceSeamId ?? "back_floor_wall",
    status,
    source: {
      category: overrides.category ?? "floor_wall",
      observationSource: overrides.observationSource ?? "general_empty_observer",
      imageBasis: "EMPTY",
      planeIds: [
        "visible_floor",
        overrides.wallPlaneId === undefined
          ? "visible_wall"
          : overrides.wallPlaneId ?? "visible_floor",
      ],
      floorPlaneId: "visible_floor",
      wallPlaneId: overrides.wallPlaneId === undefined
        ? "visible_wall"
        : overrides.wallPlaneId,
      confidence: overrides.confidence ?? 0.9,
      ambiguity: overrides.ambiguity ?? null,
    },
    imageEvidence: {
      polyline: overrides.openingsPolyline ?? [imageA, imageB],
      occupancy: null,
      frontier: null,
      lineResidual: null,
      lineResidualClass: overrides.lineResidualClass ?? "supported",
      nearVertical: false,
    },
    projection: {
      kernelVersion: "afc-v2-room-boundary-projection/v1",
      points: projectionPoints,
      worldSamples: [worldA, worldB],
      worldResidual: null,
    },
    worldGeometry: world,
    interior: {
      status: interiorAccepted ? "accepted" : "insufficient",
      witnessImagePoint: interiorAccepted ? { x: 0.5, y: 0.7 } : null,
      witnessWorldPoint: interiorAccepted ? { x: 0, y: 0, z: 0.2 } : null,
      sideSign: interiorAccepted ? 1 : null,
      cameraSideSign: interiorAccepted ? 1 : null,
      cameraContradictsWitness: false,
    },
    authority: {
      kind: "visible_wall_base_boundary",
      baseSegment: status === "accepted",
      supportPlane: status === "accepted",
      interiorHalfSpace: interiorAccepted ? "accepted" : "insufficient",
      collision: false,
    },
    limitations: {
      observedSpanOnly: overrides.observedSpanOnly ?? true,
      verticalExtentUnknown: true,
      hiddenContinuation: overrides.hiddenContinuation ?? false,
      completeWall: overrides.completeWall ?? false,
      frameAdjacentEndpoint: overrides.frameAdjacentEndpoint ?? false,
      geometryManufactured: overrides.geometryManufactured ?? false,
    },
    reasons: overrides.reasons ?? [],
  } as RoomBoundaryCandidate;
}

function targetRightInsufficientSeam() {
  return s4aCandidate({
    id: "rb_right_wall_floor_seam",
    sourceSeamId: "right_wall_floor_seam",
    wallPlaneId: "visible_wall_right",
    status: "insufficient",
    reasons: ["floor_occupancy_not_unique"],
    confidence: 0.95,
    ambiguity: null,
    interiorStatus: "insufficient",
    worldGeometry: geometry(2, 0, 2, 3),
    imageA: { x: 0.8, y: 0.62 },
    imageB: { x: 0.99, y: 0.85 },
    lineResidualClass: "underdetermined",
  });
}

function completeBack() {
  return s4aCandidate();
}

function metricSafeLeft(
  overrides: Parameters<typeof s4aCandidate>[0] = {},
) {
  return s4aCandidate({
    wallPlaneId: "visible_wall_left",
    worldGeometry: geometry(-2, 0, -2, 3),
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.01, y: 0.85 },
    ...overrides,
  });
}

function truncatedLeftMeetingBack() {
  return metricSafeLeft({
    id: "rb_left_floor_wall",
    sourceSeamId: "left_floor_wall",
    confidence: 0.88,
  });
}

function truncatedRight() {
  return s4aCandidate({
    id: "rb_right_floor_wall",
    sourceSeamId: "right_floor_wall",
    wallPlaneId: "visible_wall_right",
    worldGeometry: geometry(2, 0, 2, 3),
    imageA: { x: 0.8, y: 0.62 },
    imageB: { x: 0.99, y: 0.85 },
  });
}

function shortJunctionMate() {
  return s4aCandidate({
    id: "rb_short_mate",
    sourceSeamId: "short_mate",
    wallPlaneId: "visible_wall",
    worldGeometry: geometry(-2, 0, -1.9, 0),
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.205, y: 0.62 },
    confidence: 0.8,
  });
}

function bothInteriorSpan() {
  return s4aCandidate({
    id: "rb_interior",
    sourceSeamId: "interior_span",
    wallPlaneId: "visible_wall_interior",
    worldGeometry: geometry(-1, 0, 1, 0),
    imageA: { x: 0.3, y: 0.62 },
    imageB: { x: 0.7, y: 0.62 },
  });
}

function bothFrameSpan() {
  return s4aCandidate({
    id: "rb_both_frame",
    sourceSeamId: "both_frame",
    wallPlaneId: "visible_wall_frame",
    worldGeometry: geometry(-2, 0, 2, 0),
    imageA: { x: 0.01, y: 0.62 },
    imageB: { x: 0.99, y: 0.62 },
  });
}

function frameToInteriorSpan() {
  return s4aCandidate({
    id: "rb_frame_interior",
    sourceSeamId: "frame_interior",
    wallPlaneId: "visible_wall_frame_interior",
    worldGeometry: geometry(2, 0, 2, 3),
    imageA: { x: 0.99, y: 0.62 },
    imageB: { x: 0.72, y: 0.78 },
  });
}

function doorwayAdjacentSpan() {
  return s4aCandidate({
    id: "rb_right_doorway_adjacent",
    sourceSeamId: "right_floor_wall",
    wallPlaneId: "visible_wall_right",
    worldGeometry: geometry(2, 0, 2, 3),
    imageA: { x: 0.453, y: 0.621 },
    imageB: { x: 0.877, y: 0.816 },
  });
}

function junctionToInteriorSpan() {
  return s4aCandidate({
    id: "rb_junction_interior",
    sourceSeamId: "junction_interior",
    wallPlaneId: "visible_wall_left",
    worldGeometry: geometry(-2, 0, -2, 2.4),
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.28, y: 0.78 },
  });
}

const EQUAL_IMAGE_DX = 0.19;
const EQUAL_IMAGE_DY = 0.2;

function equalImageLeft(overrides: Parameters<typeof s4aCandidate>[0] = {}) {
  return s4aCandidate({
    id: "rb_aaa_left",
    sourceSeamId: "left_equal",
    wallPlaneId: "visible_wall_left",
    worldGeometry: geometry(-2, 0, -2, 3),
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.2 - EQUAL_IMAGE_DX, y: 0.62 + EQUAL_IMAGE_DY },
    confidence: 0.8,
    ...overrides,
  });
}

function equalImageRight(overrides: Parameters<typeof s4aCandidate>[0] = {}) {
  return s4aCandidate({
    id: "rb_zzz_right",
    sourceSeamId: "right_equal",
    wallPlaneId: "visible_wall_right",
    worldGeometry: geometry(2, 0, 2, 3),
    imageA: { x: 0.8, y: 0.62 },
    imageB: { x: 0.8 + EQUAL_IMAGE_DX, y: 0.62 + EQUAL_IMAGE_DY },
    confidence: 0.8,
    ...overrides,
  });
}

function doorwayOpening(
  boundary: readonly { x: number; y: number }[],
) {
  return {
    id: "door",
    category: "doorway" as const,
    hostPlaneId: "visible_wall",
    sourceNormalizedBoundary: boundary,
    boundaryClosure: "complete_visible_outline" as const,
    providerClaimedBoundaryClosure: "complete_visible_outline" as const,
    boundaryEvidenceCompleteness: "all_edges_visibly_traced" as const,
    closureValidation: "consistent_complete" as const,
    confidence: 0.9,
    ambiguity: null,
    evidenceClass: "provider_reported_visible_evidence" as const,
  };
}

function s4aReceipt(candidates: readonly RoomBoundaryCandidate[]) {
  return {
    candidates,
    lineage: { camera: { pose: CAMERA } },
  };
}

function acceptedWidthPrior() {
  return {
    schemaVersion: "afc-v2-metric-room-prior/v1",
    authority: "prior_only",
    hostAcceptance: { class: "accepted", reasons: ["host_accepted"] },
    estimate: {
      observability: "recoverable",
      estimatedRoomWidthM: { low: 3.4, best: 3.6, high: 3.8 },
      estimatedRoomDepthM: { low: 4, best: 4.2, high: 4.4 },
      estimatedCeilingHeightM: 2.6,
      modelConfidence: 0.8,
      limitations: [],
      notes: null,
    },
  } as const;
}

function selectM2(
  candidates: readonly RoomBoundaryCandidate[],
  extras: Partial<
    Omit<
      Parameters<typeof selectObservedSpanMetricCandidate>[0],
      "roomBoundary"
    >
  > = {},
) {
  return selectObservedSpanMetricCandidate({
    roomBoundary: s4aReceipt(candidates),
    suppressWhenCompleteBackGeometryExists: extras.suppressWhenCompleteBackGeometryExists,
    observation: extras.observation,
    roomCollision: extras.roomCollision,
    overlaySafeOnOriginal: extras.overlaySafeOnOriginal,
  });
}

function fakeLineage(
  candidate: NonNullable<ReturnType<typeof selectM2>["selected"]>,
  overrides: Partial<ObservedSpanEstimateLineage> = {},
): ObservedSpanEstimateLineage {
  return {
    attemptId: "m2",
    loadGeneration: 1,
    s4aCandidateId: candidate.lineage.s4aCandidateId,
    sourceSeamId: candidate.lineage.sourceSeamId,
    observationSource: candidate.lineage.observationSource,
    emptySha256: "e".repeat(64),
    emptyByteCount: 10,
    emptyDecodedWidth: 1200,
    emptyDecodedHeight: 800,
    originalSha256: "a".repeat(64),
    floorAuthorityKey: "floor-key",
    freezeReceiptVersion: "freeze-v1",
    freezePayloadSha256: "f".repeat(64),
    emptyNormalizedA: candidate.imageA,
    emptyNormalizedB: candidate.imageB,
    canonicalWorldA: candidate.canonicalWorldA,
    canonicalWorldB: candidate.canonicalWorldB,
    canonicalLength: candidate.canonicalLength,
    highlightedImageKind: "EMPTY_OVERLAY",
    overlayRasterSha256: "o".repeat(64),
    promptVersion: "afc-v2-observed-span-physical-estimator/v1",
    schemaVersion: "afc-v2-observed-span-physical-estimate/v1",
    junctionProofType: candidate.junction?.type ?? "none",
    junctionMateCandidateId: candidate.junction?.mateCandidateId ?? null,
    junctionMateSourceSeamId: candidate.junction?.mateSourceSeamId ?? null,
    ...overrides,
  };
}

function acceptedEstimate(best = 2.4): ObservedSpanPhysicalEstimate {
  return {
    status: "recoverable",
    estimatedLengthM: { low: 2.1, best, high: 2.8 },
    modelConfidence: 0.72,
    basis: "door width",
    limitations: [],
    notes: null,
    ambiguity: null,
  };
}

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64",
);

function productDependencies(): AfcSr1TiledLiveProductDependencies {
  const emptyBasis = {
    sha256: "e".repeat(64),
    byteCount: 3,
    decodedWidth: 1200,
    decodedHeight: 800,
    mimeType: "image/png" as const,
    orientation: 1 as const,
  };
  return {
    createResultId: () => "v2-m2-result",
    qualifyOriginal: async () => ({
      sourceImageUrl: "https://example.test/original.jpg",
      basis: {
        sha256: "a".repeat(64),
        byteCount: 100,
        decodedWidth: 1200,
        decodedHeight: 800,
        mimeType: "image/jpeg" as const,
        orientation: 1 as const,
      },
    }),
    resolveEmpty: async () => ({
      basis: emptyBasis,
      bytes: Uint8Array.from([4, 5, 6]),
      generated: true,
    }),
    generateTiled: async () => ({
      status: "generated",
      input: emptyBasis,
      tiled: {
        base64: Buffer.from([1, 2, 3]).toString("base64"),
        identity: {
          sha256: "c".repeat(64),
          byteCount: 3,
          decodedWidth: 1200,
          decodedHeight: 800,
          mimeType: "image/png" as const,
          orientation: 1 as const,
        },
      },
      provenance: {
        generatorId: "vibode-tile-grid-scaffold/stage2/v1",
        profileId: "afc-sr1-tile-grid-scaffold/v1",
        researchPreset: "tile_grid_scaffold",
        requestedModelId: "NBP",
        runId: "v2-m2-generation",
        generatedAt: "2026-09-07T00:00:00.000Z",
        appliedAspectRatio: "3:2",
        imageTransport: "data_url",
        generationStatus: "generated",
      },
      compatibility: { tier: "exact_grid_compatible" },
    } as never),
    validateTiledLineage: async () => ({
      tiledIdentity: {
        sha256: "c".repeat(64),
        byteCount: 3,
        decodedWidth: 1200,
        decodedHeight: 800,
        mimeType: "image/png" as const,
        orientation: 1 as const,
      },
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async () => ({
      status: "ok",
      decodedIdentity: {
        sha256: "c".repeat(64),
        byteCount: 3,
        decodedWidth: 1200,
        decodedHeight: 800,
        mimeType: "image/png" as const,
        orientation: 1 as const,
      },
      readerVersion: "afc-sr1-tiled-perspective-reader/s1",
      authoritativeQuadSourceNormalized: [
        { x: 0.1, y: 0.9 },
        { x: 0.9, y: 0.9 },
        { x: 0.65, y: 0.55 },
        { x: 0.35, y: 0.55 },
      ],
      authoritativeQuadPixel: [
        { x: 120, y: 720 },
        { x: 1080, y: 720 },
        { x: 780, y: 440 },
        { x: 420, y: 440 },
      ],
      authoritativeCore: {
        rows: 2, columns: 2, j0: 0, i0: 0, cellIds: [1, 2, 3, 4],
      },
      selectedComponentTileCount: 4,
      rawQuadrilateralCount: 4,
      deduplicatedCellCount: 4,
      reprojectionMeanPx: 0.5,
      reprojectionMaxPx: 1,
    }),
  };
}

function completeBackObservation() {
  return buildEmptyRoomObservationEvidence({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
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
        { x: 0.2, y: 0.62 }, { x: 0.5, y: 0.62 }, { x: 0.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  }, {
    attemptId: "v2-m2-analyze",
    loadGeneration: 1,
    emptyIdentity: {
      sha256: "e".repeat(64),
      byteCount: 3,
      decodedWidth: 1200,
      decodedHeight: 800,
      mimeType: "image/png",
      orientation: 1,
    },
    originalAncestorSha256: "a".repeat(64),
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-07T00:00:00.000Z",
  });
}

const analyzeInput: AfcV2AnalyzeInput = {
  attemptId: "v2-m2-analyze",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: "a".repeat(64),
    decodedWidth: 1200,
    decodedHeight: 800,
    orientation: 1,
  },
  loadGeneration: 1,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};

test("1-4 Path A complete-back Auto bit-matches M1.5 and selectors stay separate", () => {
  const selected = selectMetricCorrespondenceSpan({
    roomBoundary: s4aReceipt([completeBack()]),
    registration: { registrationClass: "exact_grid_registered" },
    originalLocalizedBoundary: null,
  });
  assert.equal(selected.selected?.role, "back_floor_wall");
  assert.equal(selected.selected?.truncation, "none");
  const trusted = evaluateTrustedBackWallWidthSpan(selected.selected, S4A_SAFE);
  assert.equal(trusted.trusted, true);
  const auto = deriveAutoMetricScale({
    roomPrior: acceptedWidthPrior() as never,
    selected: selected.selected,
    s4aSafety: S4A_SAFE,
    trustSelectedBackSpanAsFullWidth: true,
  });
  assert.equal(auto.accepted, true);
  assert.equal(auto.autoMetricScale, 3.6 / 4);
  const room4 = deriveAutoMetricScale({
    roomPrior: acceptedWidthPrior() as never,
    selected: {
      ...selected.selected!,
      canonicalLength: ROOM4_LIVE_CANONICAL_LENGTH,
    },
    s4aSafety: S4A_SAFE,
    trustSelectedBackSpanAsFullWidth: true,
  });
  assert.equal(room4.autoMetricScale, ROOM4_LIVE_AUTO);
  const selector = readV2("metric-correspondence-span.ts");
  const autoSource = readV2("metric-auto-scale.ts");
  assert.match(selector, /export function selectMetricCorrespondenceSpan/);
  assert.match(autoSource, /export function evaluateTrustedBackWallWidthSpan/);
  assert.doesNotMatch(selector, /selectObservedSpanMetricCandidate/);
  assert.doesNotMatch(autoSource, /selectObservedSpanMetricCandidate/);
});

test("5-7 complete-back geometry suppresses M2 even when Path A checkbox is off", () => {
  const pathA = inspectCompleteBackWallMetricGeometry(s4aReceipt([completeBack()]));
  assert.equal(pathA.exists, true);
  const suppressed = selectM2([completeBack(), truncatedLeftMeetingBack()]);
  assert.equal(suppressed.selectionStatus, "suppressed_by_path_a");
  assert.equal(suppressed.selected, null);
  assert.equal(suppressed.estimatorLaunched, false);
  const checkboxOff = deriveAutoMetricScale({
    roomPrior: acceptedWidthPrior() as never,
    selected: selectMetricCorrespondenceSpan({
      roomBoundary: s4aReceipt([completeBack()]),
      registration: { registrationClass: "exact_grid_registered" },
      originalLocalizedBoundary: null,
    }).selected,
    s4aSafety: S4A_SAFE,
    trustSelectedBackSpanAsFullWidth: false,
  });
  assert.equal(checkboxOff.accepted, false);
  assert.equal(checkboxOff.autoMetricScale, 1);
  assert.ok(checkboxOff.reasons.includes("lab_trust_not_enabled"));
});

test("8 accepted S4A floor-wall junction→frame still qualifies", () => {
  const result = selectM2(
    [truncatedLeftMeetingBack(), shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  );
  assert.equal(result.selected?.id, "rb_left_floor_wall");
  assert.equal(result.selected?.truncation, "one_end");
  assert.equal(result.selected?.junction?.type, "two_accepted_s4a_floor_wall");
  assert.equal(result.selected?.frameAdjacentEndpoint, "B");
  assert.equal(result.selected?.endpointAClass, "observed_junction");
  assert.equal(result.selected?.endpointBClass, "frame_adjacent");
});

test("9 both interior endpoints qualify when geometry gates pass", () => {
  const interior = selectM2([bothInteriorSpan()], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(interior.selected?.id, "rb_interior");
  assert.equal(interior.selected?.endpointAClass, "observed_interior");
  assert.equal(interior.selected?.endpointBClass, "observed_interior");
  assert.equal(interior.selected?.truncation, "none");
  assert.equal(interior.selected?.junction, null);
  assert.equal(
    deriveUniformMetricScaleFromPhysicalSpan(
      interior.selected!.canonicalLength,
      2.4,
    ),
    2.4 / interior.selected!.canonicalLength,
  );
});

test("10 both frame-adjacent endpoints qualify and exact A↔B is estimated", async () => {
  const bothFrame = selectM2([bothFrameSpan()], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(bothFrame.selected?.id, "rb_both_frame");
  assert.equal(bothFrame.selected?.endpointAClass, "frame_adjacent");
  assert.equal(bothFrame.selected?.endpointBClass, "frame_adjacent");
  assert.equal(bothFrame.selected?.truncation, "both_ends");
  assert.equal(bothFrame.selected?.junction, null);
  const candidate = bothFrame.selected!;
  const result = await estimateObservedSpanPhysicalLength({
    attemptId: "m2-both-frame",
    loadGeneration: 1,
    empty: {
      bytes: PIXEL,
      identity: {
        sha256: createHash("sha256").update(PIXEL).digest("hex"),
        byteCount: PIXEL.byteLength,
        decodedWidth: 1,
        decodedHeight: 1,
        mimeType: "image/png",
        orientation: 1,
      },
    },
    candidate,
    floorAuthorityKey: "floor-key",
    freezeReceiptVersion: "freeze-v1",
    freezePayloadSha256: "f".repeat(64),
  }, {
    composeOverlay: async (args) => {
      assert.equal(args.imageA.x, candidate.imageA.x);
      assert.equal(args.imageB.x, candidate.imageB.x);
      return {
        bytes: PIXEL,
        mimeType: "image/png",
        sha256: "o".repeat(64),
        pixelA: { x: 0, y: 0 },
        pixelB: { x: 1, y: 1 },
        svg: "<svg></svg>",
      };
    },
    callProvider: async () => ({
      status: "recoverable",
      estimatedLengthM: { low: 2.1, best: 2.4, high: 2.8 },
      modelConfidence: 0.72,
      limitations: [],
      notes: null,
    }),
  });
  assert.equal(result.hostAcceptance.class, "accepted");
  assert.equal(result.lineage.emptyNormalizedA.x, candidate.imageA.x);
  assert.equal(result.lineage.emptyNormalizedB.x, candidate.imageB.x);
  assert.equal(result.lineage.junctionProofType, "none");
});

test("11 no certified junction is diagnostic only — candidate still qualifies", () => {
  const noProof = selectM2([truncatedLeftMeetingBack()], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(noProof.selected?.id, "rb_left_floor_wall");
  assert.equal(noProof.selected?.junction, null);
  assert.equal(noProof.selected?.endpointAClass, "observed_interior");
  assert.equal(noProof.selected?.endpointBClass, "frame_adjacent");
});

test("12 two accepted different-wall S4A traces prove junction diagnostically", () => {
  const result = selectM2(
    [truncatedLeftMeetingBack(), shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  );
  assert.equal(result.selected?.junction?.mateCandidateId, "rb_short_mate");
  assert.ok(
    (result.selected?.junction?.imageDistance ?? 1) <= 0.012,
  );
  assert.ok(
    (result.selected?.junction?.worldDistance ?? 1) <= 0.05,
  );
});

test("13 wall_wall corroboration branch proves junction", () => {
  const truncated = truncatedLeftMeetingBack();
  const result = selectM2([truncated], {
    suppressWhenCompleteBackGeometryExists: false,
    observation: {
      observedSeams: [{
        id: "wall_wall_corner",
        category: "wall_wall",
        planeIds: ["visible_wall_left", "visible_wall"],
        sourceNormalizedPolyline: [
          { x: 0.2, y: 0.62 },
          { x: 0.2, y: 0.2 },
        ],
        endpointPolicy: "preserve_observed_open_endpoints",
        confidence: 0.8,
        ambiguity: null,
        evidenceClass: "provider_reported_visible_evidence",
        observationSource: "general_empty_observer",
      }],
      observedOpenings: [],
      observedJunctions: [],
    },
  });
  assert.equal(result.selected?.junction?.type, "wall_wall_corroboration");
  assert.equal(result.selected?.junction?.mateSourceSeamId, "wall_wall_corner");
});

test("14 Gemini room_corner alone does not prove junction and is not required", () => {
  const result = selectM2([truncatedLeftMeetingBack()], {
    suppressWhenCompleteBackGeometryExists: false,
    observation: {
      observedSeams: [],
      observedOpenings: [],
      observedJunctions: [{
        id: "corner",
        category: "room_corner",
        sourceNormalizedPoint: { x: 0.2, y: 0.62 },
        seamIds: ["left_floor_wall"],
        openingIds: [],
        confidence: 0.9,
        ambiguity: null,
        evidenceClass: "provider_reported_visible_evidence",
      }],
    },
  });
  assert.equal(result.selected?.id, "rb_left_floor_wall");
  assert.equal(result.selected?.junction, null);
});

test("15 opening-adjacent stop qualifies without opening certification; interior crossing rejects", () => {
  const openingAdjacent = s4aCandidate({
    id: "rb_opening_adjacent",
    sourceSeamId: "opening_adjacent",
    wallPlaneId: "visible_wall_left",
    worldGeometry: geometry(-2, 0, -2, 2),
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.5, y: 0.62 },
  });
  const jamb = selectM2(
    [openingAdjacent, shortJunctionMate()],
    {
      suppressWhenCompleteBackGeometryExists: false,
      observation: {
        observedSeams: [],
        observedOpenings: [doorwayOpening([
          { x: 0.5, y: 0.5 },
          { x: 0.7, y: 0.5 },
          { x: 0.7, y: 0.74 },
          { x: 0.5, y: 0.74 },
        ])],
        observedJunctions: [{
          id: "jamb",
          category: "opening_boundary_intersection",
          sourceNormalizedPoint: { x: 0.5, y: 0.62 },
          seamIds: ["opening_adjacent"],
          openingIds: ["door"],
          confidence: 0.9,
          ambiguity: null,
          evidenceClass: "provider_reported_visible_evidence",
        }],
      },
    },
  );
  assert.equal(jamb.selected?.id, "rb_opening_adjacent");
  assert.equal(jamb.selected?.endpointAClass, "observed_junction");
  assert.equal(jamb.selected?.endpointBClass, "observed_interior");
  assert.equal(
    jamb.rejectedAlternatives.some((item) => item.reason === "opening_crossing"),
    false,
  );
  const crossing = selectM2(
    [truncatedLeftMeetingBack()],
    {
      suppressWhenCompleteBackGeometryExists: false,
      roomCollision: {
        boundaries: [{
          sourceBoundaryId: "rb_left_floor_wall",
          corroboration: { openingCrossing: true },
        }],
      },
    },
  );
  assert.equal(crossing.selected, null);
  assert.ok(crossing.rejectedAlternatives.some((item) =>
    item.reason === "opening_crossing"
  ));
  const geometryCrossing = selectM2(
    [s4aCandidate({
      id: "rb_crosses_opening",
      imageA: { x: 0.2, y: 0.62 },
      imageB: { x: 0.8, y: 0.62 },
    })],
    {
      suppressWhenCompleteBackGeometryExists: false,
      observation: {
        observedSeams: [],
        observedOpenings: [doorwayOpening([
          { x: 0.4, y: 0.5 },
          { x: 0.6, y: 0.5 },
          { x: 0.6, y: 0.74 },
          { x: 0.4, y: 0.74 },
        ])],
        observedJunctions: [],
      },
    },
  );
  assert.equal(geometryCrossing.selected, null);
  assert.ok(geometryCrossing.rejectedAlternatives.some((item) =>
    item.reason === "opening_crossing"
  ));
});

test("17-18 competing same-wall and short image span reject", () => {
  const competingTrace = selectM2([
    truncatedLeftMeetingBack(),
    s4aCandidate({
      id: "rb_left_b",
      sourceSeamId: "left_b",
      wallPlaneId: "visible_wall_left_b",
      status: "ambiguous",
      reasons: ["competing_same_wall_trace"],
      worldGeometry: geometry(-2, 0, -2, 3),
      imageA: { x: 0.2, y: 0.62 },
      imageB: { x: 0.01, y: 0.85 },
    }),
  ], { suppressWhenCompleteBackGeometryExists: false });
  assert.ok(competingTrace.rejectedAlternatives.some((item) =>
    item.id === "rb_left_b" && item.reason === "competing_same_wall"
  ));
  const competingAccepted = selectM2([
    truncatedLeftMeetingBack(),
    s4aCandidate({
      id: "rb_left_overlap",
      sourceSeamId: "left_overlap",
      wallPlaneId: "visible_wall_left_overlap",
      worldGeometry: geometry(-2, 0.1, -2, 3.1),
      imageA: { x: 0.21, y: 0.62 },
      imageB: { x: 0.01, y: 0.84 },
    }),
  ], { suppressWhenCompleteBackGeometryExists: false });
  assert.ok(competingAccepted.rejectedAlternatives.some((item) =>
    item.reason === "competing_same_wall"
  ));
  assert.equal(competingAccepted.selected, null);
  const short = selectM2([
    s4aCandidate({
      id: "rb_short",
      wallPlaneId: "visible_wall_left",
      worldGeometry: geometry(-2, 0, -2, 0.2),
      imageA: { x: 0.06, y: 0.62 },
      imageB: { x: 0.01, y: 0.62 },
    }),
  ], { suppressWhenCompleteBackGeometryExists: false });
  assert.ok(short.rejectedAlternatives.some((item) =>
    item.reason === "too_short_in_image"
  ));
  assert.equal(METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED, 0.08);
});

test("hidden manufactured complete-wall malformed and doorway-adjacent", () => {
  const hidden = selectM2([
    s4aCandidate({
      id: "rb_hidden",
      hiddenContinuation: true,
      imageA: { x: 0.3, y: 0.62 },
      imageB: { x: 0.7, y: 0.62 },
    }),
  ], { suppressWhenCompleteBackGeometryExists: false });
  assert.ok(hidden.rejectedAlternatives.some((item) =>
    item.reason === "hidden_continuation"
  ));
  const manufactured = selectM2([
    s4aCandidate({
      id: "rb_manufactured",
      geometryManufactured: true,
      imageA: { x: 0.3, y: 0.62 },
      imageB: { x: 0.7, y: 0.62 },
    }),
  ], { suppressWhenCompleteBackGeometryExists: false });
  assert.ok(manufactured.rejectedAlternatives.some((item) =>
    item.reason === "geometry_manufactured"
  ));
  const completeWall = selectM2([
    s4aCandidate({
      id: "rb_complete_wall",
      completeWall: true,
      imageA: { x: 0.3, y: 0.62 },
      imageB: { x: 0.7, y: 0.62 },
    }),
  ], { suppressWhenCompleteBackGeometryExists: false });
  assert.ok(completeWall.rejectedAlternatives.some((item) =>
    item.reason === "complete_wall_claim"
  ));
  const malformed = selectM2([
    s4aCandidate({
      id: "rb_malformed",
      projectionOk: false,
      imageA: { x: 0.3, y: 0.62 },
      imageB: { x: 0.7, y: 0.62 },
    }),
  ], { suppressWhenCompleteBackGeometryExists: false });
  assert.ok(malformed.rejectedAlternatives.some((item) =>
    item.reason === "malformed_projection"
  ));
  const doorway = selectM2([doorwayAdjacentSpan()], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(doorway.selected?.id, "rb_right_doorway_adjacent");
  assert.equal(doorway.selected?.junction, null);
  assert.ok(
    (doorway.selected?.imageLengthNormalized ?? 0) >=
      METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED,
  );
  const junctionInterior = selectM2(
    [junctionToInteriorSpan(), shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  );
  assert.equal(junctionInterior.selected?.id, "rb_junction_interior");
  assert.equal(junctionInterior.selected?.endpointAClass, "observed_junction");
  assert.equal(junctionInterior.selected?.endpointBClass, "observed_interior");
  const frameInterior = selectM2([frameToInteriorSpan()], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(frameInterior.selected?.id, "rb_frame_interior");
  assert.equal(frameInterior.selected?.truncation, "one_end");
});

test("19 accepted diagonal / side / return wall may qualify regardless of role", () => {
  const diagonal = s4aCandidate({
    id: "rb_return",
    sourceSeamId: "return_wall",
    wallPlaneId: "visible_wall_return",
    worldGeometry: geometry(-1, 1, 1, 3),
    imageA: { x: 0.45, y: 0.55 },
    imageB: { x: 0.01, y: 0.7 },
  });
  const mate = s4aCandidate({
    id: "rb_mate",
    sourceSeamId: "mate_wall",
    wallPlaneId: "visible_wall_mate",
    worldGeometry: geometry(-1, 1, -3, 1),
    imageA: { x: 0.45, y: 0.55 },
    imageB: { x: 0.2, y: 0.4 },
  });
  const result = selectM2([diagonal, mate], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.ok(result.selected);
  assert.notEqual(result.selected?.role, undefined);
  assert.equal(result.selected?.source, "s4a_floor_wall");
});

test("20-22 one frame-adjacent end does not pollute the opposite endpoint", () => {
  const a = classifyObservedSpanEndpoint({ x: 0.2, y: 0.62 });
  const b = classifyObservedSpanEndpoint({ x: 0.01, y: 0.85 });
  assert.equal(a, "observed_interior");
  assert.equal(b, "frame_adjacent");
  const selected = selectM2(
    [truncatedLeftMeetingBack(), shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  ).selected;
  assert.equal(selected?.imageA.x, 0.2);
  assert.equal(selected?.imageA.y, 0.62);
  assert.equal(selected?.imageB.x, 0.01);
  assert.equal(selected?.imageB.y, 0.85);
  assert.equal(selected?.endpointAClass, "observed_junction");
  assert.notEqual(selected?.endpointAClass, "frame_adjacent");
});

test("23-27 ranking: image, confidence, residual, canonical, ambiguity, id; no role or junction", () => {
  const longerImage = s4aCandidate({
    id: "rb_long_image",
    sourceSeamId: "long_image",
    wallPlaneId: "wall_long_image",
    confidence: 0.7,
    worldGeometry: geometry(-2, 0, -2, 2),
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.01, y: 0.95 },
  });
  const shorterImage = s4aCandidate({
    id: "rb_short_image",
    sourceSeamId: "short_image",
    wallPlaneId: "wall_short_image",
    confidence: 0.99,
    worldGeometry: geometry(2, 0, 2, 2),
    imageA: { x: 0.8, y: 0.62 },
    imageB: { x: 0.99, y: 0.72 },
  });
  const imageRank = selectM2([longerImage, shorterImage], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(imageRank.selected?.id, "rb_long_image");

  const higherConf = equalImageLeft({
    id: "rb_high_conf",
    sourceSeamId: "high_conf",
    wallPlaneId: "wall_high",
    confidence: 0.95,
  });
  const lowerConf = equalImageRight({
    id: "rb_low_conf",
    sourceSeamId: "low_conf",
    wallPlaneId: "wall_low",
    confidence: 0.5,
  });
  const confRank = selectM2([lowerConf, higherConf], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(confRank.selected?.id, "rb_high_conf");

  const supported = equalImageLeft({
    id: "rb_supported",
    sourceSeamId: "supported",
    wallPlaneId: "wall_supported",
    lineResidualClass: "supported",
  });
  const underdetermined = equalImageRight({
    id: "rb_underdetermined",
    sourceSeamId: "underdetermined",
    wallPlaneId: "wall_underdetermined",
    lineResidualClass: "underdetermined",
  });
  const residualRanked = selectM2([underdetermined, supported], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(residualRanked.selected?.id, "rb_supported");

  const longerCanonical = equalImageLeft({
    id: "rb_long_canonical",
    sourceSeamId: "long_canonical",
    wallPlaneId: "wall_long_canonical",
    worldGeometry: geometry(-2, 0, -2, 5),
  });
  const shorterCanonical = equalImageRight({
    id: "rb_short_canonical",
    sourceSeamId: "short_canonical",
    wallPlaneId: "wall_short_canonical",
    worldGeometry: geometry(2, 0, 2, 2),
  });
  const canonicalRank = selectM2([longerCanonical, shorterCanonical], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(canonicalRank.selected?.id, "rb_long_canonical");

  const clear = equalImageLeft({
    id: "rb_clear",
    sourceSeamId: "clear",
    wallPlaneId: "wall_clear",
    ambiguity: null,
  });
  const ambiguous = equalImageRight({
    id: "rb_ambiguous",
    sourceSeamId: "ambiguous",
    wallPlaneId: "wall_ambiguous",
    ambiguity: "uncertain",
  });
  const ambiguityRank = selectM2([ambiguous, clear], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(ambiguityRank.selected?.id, "rb_clear");
  assert.ok(ambiguityRank.rejectedAlternatives.some((item) =>
    item.id === "rb_ambiguous" && item.reason === "observer_ambiguity"
  ));

  const longerInsufficient = s4aCandidate({
    id: "rb_insufficient_long",
    sourceSeamId: "insufficient_long",
    wallPlaneId: "wall_insufficient_long",
    status: "insufficient",
    reasons: ["floor_occupancy_not_unique"],
    confidence: 0.7,
    worldGeometry: geometry(-2, 0, -2, 2),
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.01, y: 0.95 },
  });
  const shorterAccepted = s4aCandidate({
    id: "rb_accepted_short",
    sourceSeamId: "accepted_short",
    wallPlaneId: "wall_accepted_short",
    status: "accepted",
    confidence: 0.99,
    worldGeometry: geometry(2, 0, 2, 2),
    imageA: { x: 0.8, y: 0.62 },
    imageB: { x: 0.99, y: 0.72 },
  });
  const statusIgnoredRank = selectM2([longerInsufficient, shorterAccepted], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(statusIgnoredRank.selected?.id, "rb_insufficient_long");
  assert.equal(
    statusIgnoredRank.selected?.metricGeometryTrust.s4aStatus,
    "insufficient",
  );

  const a = equalImageLeft({
    id: "rb_aaa",
    sourceSeamId: "aaa",
    wallPlaneId: "wall_aaa",
  });
  const z = equalImageRight({
    id: "rb_zzz",
    sourceSeamId: "zzz",
    wallPlaneId: "wall_zzz",
  });
  const idRank = selectM2([z, a], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(idRank.selected?.id, "rb_aaa");

  const room5Analogue = truncatedLeftMeetingBack();
  const shorterAlternative = s4aCandidate({
    id: "rb_shorter_alt",
    sourceSeamId: "shorter_alt",
    wallPlaneId: "wall_shorter_alt",
    worldGeometry: geometry(2, 0, 2, 1.5),
    imageA: { x: 0.8, y: 0.62 },
    imageB: { x: 0.99, y: 0.7 },
  });
  const room5Wins = selectM2([room5Analogue, shorterAlternative], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(room5Wins.selected?.id, "rb_left_floor_wall");
  const longerBetter = s4aCandidate({
    id: "rb_longer_better",
    sourceSeamId: "longer_better",
    wallPlaneId: "wall_longer_better",
    worldGeometry: geometry(2, 0, 2, 4),
    imageA: { x: 0.8, y: 0.62 },
    imageB: { x: 0.99, y: 0.99 },
  });
  const longerWins = selectM2([room5Analogue, longerBetter], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(longerWins.selected?.id, "rb_longer_better");

  const backWall = s4aCandidate({
    id: "rb_zzz_back",
    sourceSeamId: "zzz_back",
    wallPlaneId: "visible_wall",
    confidence: 0.8,
    worldGeometry: geometry(-1.5, 0, 1.5, 0),
    imageA: { x: 0.8, y: 0.62 },
    imageB: { x: 0.8 + EQUAL_IMAGE_DX, y: 0.62 + EQUAL_IMAGE_DY },
  });
  const leftWall = equalImageLeft({
    id: "rb_aaa_left",
    sourceSeamId: "aaa_left",
    wallPlaneId: "visible_wall_left",
  });
  const roleIndependent = selectM2([backWall, leftWall], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(roleIndependent.selected?.id, "rb_aaa_left");
  assert.equal(
    roleIndependent.selected?.imageLengthNormalized,
    selectM2([backWall], { suppressWhenCompleteBackGeometryExists: false })
      .selected?.imageLengthNormalized,
  );

  const withJunction = truncatedLeftMeetingBack();
  const withoutJunctionEarlierId = bothInteriorSpan();
  const junctionIndependent = selectM2(
    [withJunction, withoutJunctionEarlierId, shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  );
  assert.equal(junctionIndependent.selected?.id, "rb_interior");
  assert.equal(junctionIndependent.selected?.junction, null);

  const selector = readV2("observed-span-metric-candidate.ts");
  assert.doesNotMatch(selector, /ROLE_RANK/);
  assert.doesNotMatch(selector, /certified_architectural_junction/);
});

test("28-35 provider contract: overlay, ORIGINAL context, forbidden fields", () => {
  const candidate = selectM2(
    [truncatedLeftMeetingBack(), shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  ).selected!;
  const metadata = observedSpanProviderSegmentMetadata(candidate);
  const prompt = observedSpanPhysicalEstimatorPrompt(metadata, true);
  assert.match(prompt, /THIS highlighted observed wall segment only/);
  assert.match(prompt, /PRIMARY image: EMPTY/);
  assert.match(prompt, /CONTEXT image: ORIGINAL/);
  assert.match(prompt, /unhighlighted/);
  assert.match(prompt, /Do not complete hidden geometry or extend beyond the highlighted endpoints/);
  assert.match(
    prompt,
    /Do not infer continuation past A or B for any reason, including frame truncation, opening, occlusion, or an interior observed stop/,
  );
  assert.doesNotMatch(prompt, /beyond the frame/);
  assert.doesNotMatch(prompt, /frame-truncated end/);
  assert.doesNotMatch(prompt, /canonicalLength/);
  assert.doesNotMatch(prompt, /autoMetricScale/);
  assert.doesNotMatch(prompt, /estimatedRoomWidthM|estimatedRoomDepthM/);
  assert.doesNotMatch(prompt, /back_floor_wall|spanRole/);
  assert.equal(metadata.endpointA.x, candidate.imageA.x);
  assert.equal(metadata.endpointB.x, candidate.imageB.x);
  assert.equal(
    parseObservedSpanPhysicalEstimate({
      status: "recoverable",
      estimatedLengthM: { low: 2, best: 2.4, high: 3 },
      modelConfidence: 0.7,
      limitations: [],
      notes: null,
      endpoints: [{ x: 0.1, y: 0.2 }],
    }).ok,
    false,
  );
  assert.equal(
    parseObservedSpanPhysicalEstimate({
      status: "recoverable",
      estimatedLengthM: { low: 2, best: 2.4, high: 3 },
      modelConfidence: 0.7,
      limitations: [],
      notes: null,
      alternateSeam: "other",
    }).ok,
    false,
  );
  assert.equal(
    parseObservedSpanPhysicalEstimate({
      status: "recoverable",
      estimatedLengthM: { low: 2, best: 2.4, high: 3 },
      modelConfidence: 0.7,
      limitations: [],
      notes: null,
      estimatedRoomWidthM: { low: 3, best: 4, high: 5 },
    }).ok,
    false,
  );
  const accepted = parseObservedSpanPhysicalEstimate({
    status: "recoverable",
    estimatedLengthM: { low: 2, best: 2.4, high: 3 },
    modelConfidence: 0.7,
    limitations: [],
    notes: null,
  });
  assert.equal(accepted.ok, true);
  assert.equal(OBSERVED_SPAN_OVERLAY_CAPTION.includes("observed wall segment"), true);
  assert.notEqual(OBSERVED_SPAN_OVERLAY_CAPTION, METRIC_CORRESPONDENCE_OVERLAY_CAPTION);
});

test("36-39 weak / low confidence / huge uncertainty rejected; accepted passes", () => {
  const candidate = selectM2(
    [truncatedLeftMeetingBack(), shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  ).selected!;
  const lineage = fakeLineage(candidate);
  const current = {
    s4aCandidateId: candidate.lineage.s4aCandidateId,
    sourceSeamId: candidate.lineage.sourceSeamId,
    emptySha256: lineage.emptySha256,
    originalSha256: lineage.originalSha256,
    floorAuthorityKey: lineage.floorAuthorityKey,
    canonicalLength: candidate.canonicalLength,
    freezeReceiptVersion: lineage.freezeReceiptVersion,
    freezePayloadSha256: lineage.freezePayloadSha256,
    candidateStillEligible: true,
  };
  const weak = acceptObservedSpanPhysicalEstimate({
    ...acceptedEstimate(),
    status: "weak",
  }, { candidate, lineage, current, originalWasIncluded: true });
  assert.equal(weak.class, "weak_rejected");
  const unrecoverable = acceptObservedSpanPhysicalEstimate({
    ...acceptedEstimate(),
    status: "not_recoverable",
  }, { candidate, lineage, current, originalWasIncluded: true });
  assert.equal(unrecoverable.class, "unobservable_rejected");
  const lowConf = acceptObservedSpanPhysicalEstimate({
    ...acceptedEstimate(),
    modelConfidence: METRIC_SPAN_MIN_MODEL_CONFIDENCE - 0.2,
  }, { candidate, lineage, current, originalWasIncluded: true });
  assert.equal(lowConf.class, "weak_rejected");
  const huge = acceptObservedSpanPhysicalEstimate({
    ...acceptedEstimate(),
    estimatedLengthM: { low: 0.5, best: 2, high: 40 },
  }, { candidate, lineage, current, originalWasIncluded: true });
  assert.equal(huge.class, "weak_rejected");
  const ok = acceptObservedSpanPhysicalEstimate(acceptedEstimate(), {
    candidate, lineage, current, originalWasIncluded: true,
  });
  assert.equal(ok.class, "accepted");
  assert.equal(
    ok.autoMetricScale,
    deriveUniformMetricScaleFromPhysicalSpan(candidate.canonicalLength, 2.4),
  );
  const interiorCandidate = selectM2([bothInteriorSpan()], {
    suppressWhenCompleteBackGeometryExists: false,
  }).selected!;
  const interiorLineage = fakeLineage(interiorCandidate);
  assert.equal(interiorLineage.junctionProofType, "none");
  assert.equal(interiorLineage.junctionMateCandidateId, null);
  const interiorOk = acceptObservedSpanPhysicalEstimate(acceptedEstimate(), {
    candidate: interiorCandidate,
    lineage: interiorLineage,
    current: {
      s4aCandidateId: interiorCandidate.lineage.s4aCandidateId,
      sourceSeamId: interiorCandidate.lineage.sourceSeamId,
      emptySha256: interiorLineage.emptySha256,
      originalSha256: interiorLineage.originalSha256,
      floorAuthorityKey: interiorLineage.floorAuthorityKey,
      canonicalLength: interiorCandidate.canonicalLength,
      freezeReceiptVersion: interiorLineage.freezeReceiptVersion,
      freezePayloadSha256: interiorLineage.freezePayloadSha256,
      candidateStillEligible: true,
    },
    originalWasIncluded: true,
  });
  assert.equal(interiorOk.class, "accepted");
});

test("40-44 Auto = best / canonicalLength; bounds; no clamp; userWorldScale composes", () => {
  const candidate = selectM2(
    [truncatedLeftMeetingBack(), shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  ).selected!;
  const best = 2.4;
  const expected = best / candidate.canonicalLength;
  assert.equal(
    deriveUniformMetricScaleFromPhysicalSpan(candidate.canonicalLength, best),
    expected,
  );
  const lineage = fakeLineage(candidate);
  const current = {
    s4aCandidateId: candidate.lineage.s4aCandidateId,
    sourceSeamId: candidate.lineage.sourceSeamId,
    emptySha256: lineage.emptySha256,
    originalSha256: lineage.originalSha256,
    floorAuthorityKey: lineage.floorAuthorityKey,
    canonicalLength: candidate.canonicalLength,
    freezeReceiptVersion: lineage.freezeReceiptVersion,
    freezePayloadSha256: lineage.freezePayloadSha256,
    candidateStillEligible: true,
  };
  const inBounds = acceptObservedSpanPhysicalEstimate(acceptedEstimate(best), {
    candidate, lineage, current, originalWasIncluded: true,
  });
  assert.equal(inBounds.class, "accepted");
  assert.ok((inBounds.autoMetricScale ?? 0) >= AUTO_METRIC_SCALE_SANITY_MIN);
  assert.ok((inBounds.autoMetricScale ?? 0) <= AUTO_METRIC_SCALE_SANITY_MAX);
  const outside = acceptObservedSpanPhysicalEstimate(
    {
      ...acceptedEstimate(40),
      estimatedLengthM: { low: 35, best: 40, high: 45 },
    },
    {
      candidate,
      lineage,
      current: { ...current, canonicalLength: candidate.canonicalLength },
      originalWasIncluded: true,
    },
  );
  const scale = deriveUniformMetricScaleFromPhysicalSpan(candidate.canonicalLength, 40);
  assert.ok(scale !== null && scale > AUTO_METRIC_SCALE_SANITY_MAX);
  assert.equal(outside.class, "implausible_rejected");
  const pathB = deriveObservedSpanAutoMetricScale({
    completeBackGeometryExists: false,
    candidate,
    estimate: {
      schemaVersion: "afc-v2-observed-span-physical-estimate/v1",
      authority: AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_AUTHORITY,
      lineage,
      sourceImageKind: "EMPTY_OVERLAY",
      contextImageKind: "ORIGINAL_CONTEXT",
      overlayImageHash: "o".repeat(64),
      provider: "controlled_fixture",
      model: "fixture",
      promptVersion: "afc-v2-observed-span-physical-estimator/v1",
      estimate: acceptedEstimate(best),
      hostAcceptance: inBounds,
      failure: null,
      diagnostics: {
        estimatorLaunched: true,
        originalIncludedAsUnhighlightedContext: true,
        canonicalLengthSentToProvider: false,
        autoMetricScaleSentToProvider: false,
        widthDepthSentAsExpectedAnswer: false,
        forbiddenGeometryFieldsPresent: false,
      },
    },
  });
  assert.equal(pathB.accepted, true);
  assert.equal(pathB.autoMetricScale, expected);
  assert.equal(computeMetricScale(pathB.autoMetricScale, 1.25), expected * 1.25);
  const suppressed = deriveObservedSpanAutoMetricScale({
    completeBackGeometryExists: true,
    candidate,
    estimate: null,
  });
  assert.equal(suppressed.autoMetricScale, 1);
});

test("45-50 stale / mismatched lineage is rejected", () => {
  const candidate = selectM2(
    [truncatedLeftMeetingBack(), shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  ).selected!;
  const lineage = fakeLineage(candidate);
  const baseCurrent = {
    s4aCandidateId: candidate.lineage.s4aCandidateId,
    sourceSeamId: candidate.lineage.sourceSeamId,
    emptySha256: lineage.emptySha256,
    originalSha256: lineage.originalSha256,
    floorAuthorityKey: lineage.floorAuthorityKey,
    canonicalLength: candidate.canonicalLength,
    freezeReceiptVersion: lineage.freezeReceiptVersion,
    freezePayloadSha256: lineage.freezePayloadSha256,
    candidateStillEligible: true,
  };
  const cases = [
    { canonicalLength: candidate.canonicalLength + 0.5 },
    { s4aCandidateId: "other-id" },
    { emptySha256: "b".repeat(64) },
    { floorAuthorityKey: "other-floor" },
    { freezePayloadSha256: "c".repeat(64) },
  ] as const;
  for (const mismatch of cases) {
    const rejected = acceptObservedSpanPhysicalEstimate(acceptedEstimate(), {
      candidate,
      lineage,
      current: { ...baseCurrent, ...mismatch },
      originalWasIncluded: true,
    });
    assert.equal(rejected.class, "lineage_rejected");
  }
});

test("51-53 collision experiment ignored; rejected S4A may still be metric-safe", () => {
  const rejectedButProjected = selectM2([metricSafeLeft({
    id: "rb_collision_only",
    status: "rejected",
    reasons: ["floor_and_wall_occupancy_not_opposite"],
  })], { suppressWhenCompleteBackGeometryExists: false });
  assert.equal(rejectedButProjected.selected?.id, "rb_collision_only");
  assert.equal(
    rejectedButProjected.selected?.metricGeometryTrust.s4aStatus,
    "rejected",
  );
  assert.equal(
    rejectedButProjected.selected?.metricGeometryTrust
      .semanticQualificationBypassed,
    true,
  );
  assert.equal(rejectedButProjected.collisionExperimentIgnoredForMetric, true);
  const selector = readV2("observed-span-metric-candidate.ts");
  assert.doesNotMatch(selector, /experimentalTrust/);
  assert.doesNotMatch(selector, /experimentalAcceptance/);
  assert.doesNotMatch(selector, /collisionEnabled/);
  assert.doesNotMatch(selector, /emptyAuthoritativeCollision/);
  assert.doesNotMatch(selector, /if \(candidate.status !== "accepted"\)/);
  const none = selectM2([], { suppressWhenCompleteBackGeometryExists: false });
  assert.equal(none.selected, null);
  assert.ok(none.selectionReasons.includes("no_s4a_floor_wall_candidates"));
});

test("M2.2 metric-safe projected Gemini seam: occupancy/interior/rejected qualify; mechanical fails", () => {
  const accepted = selectM2([truncatedLeftMeetingBack()], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(accepted.selected?.id, "rb_left_floor_wall");
  assert.equal(accepted.selected?.metricGeometryTrust.s4aStatus, "accepted");
  assert.equal(
    accepted.selected?.metricGeometryTrust.semanticQualificationBypassed,
    false,
  );
  assert.ok(accepted.selectionReasons.includes("accepted_s4a_floor_wall"));
  assert.ok(accepted.selectionReasons.includes(OBSERVED_SPAN_METRIC_GEOMETRY_CLASS));
  assert.equal(accepted.authority, AFC_V2_OBSERVED_SPAN_METRIC_AUTHORITY);

  const target = selectM2([targetRightInsufficientSeam()], {
    suppressWhenCompleteBackGeometryExists: false,
  });
  assert.equal(target.selected?.id, "rb_right_wall_floor_seam");
  const trust = target.selected!.metricGeometryTrust;
  assert.equal(trust.class, OBSERVED_SPAN_METRIC_GEOMETRY_CLASS);
  assert.equal(trust.source, OBSERVED_SPAN_METRIC_GEOMETRY_SOURCE);
  assert.equal(trust.s4aStatus, "insufficient");
  assert.deepEqual([...trust.s4aReasons], ["floor_occupancy_not_unique"]);
  assert.equal(trust.projectionValid, true);
  assert.equal(trust.canonicalLengthValid, true);
  assert.equal(trust.semanticQualificationBypassed, true);
  assert.equal(trust.metricEligible, true);
  assert.ok(
    target.selectionReasons.includes("semantic_s4a_qualification_bypassed_for_metric"),
  );
  assert.equal(
    target.selected!.selectionReasons.includes("accepted_s4a_floor_wall"),
    false,
  );
  const launched = markObservedSpanEstimatorLaunched(target, true);
  assert.equal(launched.estimatorLaunched, true);
  assert.equal(
    isMetricSafeProjectedFloorWall(targetRightInsufficientSeam()).ok,
    true,
  );
  assert.equal(
    target.selected!.canonicalLength,
    Math.hypot(2 - 2, 3 - 0),
  );
});

const M2_ONLY = { suppressWhenCompleteBackGeometryExists: false } as const;

test("M2.2 wall_occupancy_not_unique qualifies when metric-safe", () => {
  const wallOccupancy = selectM2([metricSafeLeft({
    id: "rb_wall_occupancy",
    status: "insufficient",
    reasons: ["wall_occupancy_not_unique"],
  })], M2_ONLY);
  assert.equal(wallOccupancy.selected?.id, "rb_wall_occupancy");
  assert.equal(
    wallOccupancy.selected?.metricGeometryTrust.semanticQualificationBypassed,
    true,
  );
});

test("M2.2 interior_witness_unavailable qualifies when metric-safe", () => {
  const interiorWitness = selectM2([metricSafeLeft({
    id: "rb_interior_witness",
    status: "insufficient",
    reasons: ["interior_witness_unavailable"],
    interiorStatus: "insufficient",
  })], M2_ONLY);
  assert.equal(interiorWitness.selected?.id, "rb_interior_witness");
  assert.equal(
    interiorWitness.selected?.metricGeometryTrust.s4aStatus,
    "insufficient",
  );
});

test("M2.2 rejected occupancy-not-opposite may qualify when metric-safe", () => {
  const rejectedOccupancy = selectM2([metricSafeLeft({
    id: "rb_rejected_opposite",
    status: "rejected",
    reasons: ["floor_and_wall_occupancy_not_opposite"],
  })], M2_ONLY);
  assert.equal(rejectedOccupancy.selected?.id, "rb_rejected_opposite");
  assert.equal(
    rejectedOccupancy.selected?.metricGeometryTrust.s4aStatus,
    "rejected",
  );
  assert.deepEqual(
    [...rejectedOccupancy.selected!.metricGeometryTrust.s4aReasons],
    ["floor_and_wall_occupancy_not_opposite"],
  );
  assert.equal(
    rejectedOccupancy.selected?.selectionReasons.includes("accepted_s4a_floor_wall"),
    false,
  );
});

test("M2.2 rejected mechanical projection failure still rejects", () => {
  const mechanical = selectM2([metricSafeLeft({
    id: "rb_rejected_mechanical",
    status: "rejected",
    reasons: ["floor_and_wall_occupancy_not_opposite"],
    projectionOk: false,
  })], M2_ONLY);
  assert.equal(mechanical.selected, null);
  assert.ok(mechanical.rejectedAlternatives.some((item) =>
    item.reason === "malformed_projection"
  ));
});

test("M2.2 invalid binding rejects", () => {
  const missingBinding = selectM2([metricSafeLeft({
    id: "rb_no_wall",
    wallPlaneId: null,
    status: "rejected",
    reasons: ["invalid_or_missing_floor_wall_plane_binding"],
  })], M2_ONLY);
  assert.equal(missingBinding.selected, null);
  assert.ok(missingBinding.rejectedAlternatives.some((item) =>
    item.reason === "missing_wall_plane"
  ));
});

test("M2.2 projection failure rejects", () => {
  const projectionFailed = selectM2([metricSafeLeft({
    id: "rb_proj_fail",
    status: "insufficient",
    reasons: ["floor_occupancy_not_unique"],
    projectionOk: false,
  })], M2_ONLY);
  assert.ok(projectionFailed.rejectedAlternatives.some((item) =>
    item.reason === "malformed_projection"
  ));
});

test("M2.2 non-finite projected endpoint rejects", () => {
  const nonFinite = selectM2([metricSafeLeft({
    id: "rb_nan",
    status: "insufficient",
    reasons: ["floor_occupancy_not_unique"],
    nonFiniteWorld: true,
  })], M2_ONLY);
  assert.ok(nonFinite.rejectedAlternatives.some((item) =>
    item.reason === "malformed_projection"
  ));
});

test("M2.2 degenerate canonical span rejects", () => {
  const degenerate = selectM2([metricSafeLeft({
    id: "rb_degenerate",
    status: "insufficient",
    reasons: ["floor_occupancy_not_unique"],
    coincidentWorld: true,
  })], M2_ONLY);
  assert.ok(degenerate.rejectedAlternatives.some((item) =>
    item.reason === "degenerate"
  ));
});

test("M2.2 observer ambiguity rejects", () => {
  const ambiguous = selectM2([metricSafeLeft({
    id: "rb_ambiguous_obs",
    status: "insufficient",
    reasons: ["observer_ambiguity_present"],
    ambiguity: "Could be trim rather than the floor-wall junction.",
  })], M2_ONLY);
  assert.ok(ambiguous.rejectedAlternatives.some((item) =>
    item.reason === "observer_ambiguity"
  ));
  assert.equal(ambiguous.selected, null);
});

test("M2.2 competing_same_wall_trace rejects regardless of status", () => {
  const competingReason = selectM2([metricSafeLeft({
    id: "rb_competing_insufficient",
    status: "insufficient",
    reasons: ["competing_same_wall_trace", "floor_occupancy_not_unique"],
  })], M2_ONLY);
  assert.ok(competingReason.rejectedAlternatives.some((item) =>
    item.reason === "competing_same_wall"
  ));
});

test("M2.2 two insufficient metric-safe traces both fail", () => {
  const twoInsufficientCompete = selectM2([
    metricSafeLeft({
      id: "rb_left_a",
      sourceSeamId: "left_a",
      wallPlaneId: "visible_wall_left_a",
      status: "insufficient",
      reasons: ["floor_occupancy_not_unique"],
    }),
    metricSafeLeft({
      id: "rb_left_b",
      sourceSeamId: "left_b",
      wallPlaneId: "visible_wall_left_b",
      status: "insufficient",
      reasons: ["wall_occupancy_not_unique"],
      worldGeometry: geometry(-2, 0.1, -2, 3.1),
      imageA: { x: 0.21, y: 0.62 },
      imageB: { x: 0.01, y: 0.84 },
    }),
  ], M2_ONLY);
  assert.equal(twoInsufficientCompete.selected, null);
  assert.equal(
    twoInsufficientCompete.rejectedAlternatives.filter((item) =>
      item.reason === "competing_same_wall"
    ).length,
    2,
  );
});

test("M2.2 opening interior crossing rejects without S4A accepted", () => {
  const openingWithoutAccepted = selectM2([metricSafeLeft({
    id: "rb_crosses_opening_insufficient",
    status: "insufficient",
    reasons: ["floor_occupancy_not_unique"],
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.8, y: 0.62 },
    worldGeometry: geometry(-2, 0, 2, 0),
  })], {
    ...M2_ONLY,
    observation: {
      observedSeams: [],
      observedOpenings: [doorwayOpening([
        { x: 0.4, y: 0.5 },
        { x: 0.6, y: 0.5 },
        { x: 0.6, y: 0.74 },
        { x: 0.4, y: 0.74 },
      ])],
      observedJunctions: [],
    },
  });
  assert.ok(openingWithoutAccepted.rejectedAlternatives.some((item) =>
    item.reason === "opening_crossing"
  ));
});

test("M2.2 incompatible empty projection rejects", () => {
  const emptyProjection = selectM2([metricSafeLeft({
    id: "rb_incompatible",
    status: "rejected",
    reasons: ["empty_original_incompatible"],
    emptyProjection: true,
  })], M2_ONLY);
  assert.ok(emptyProjection.rejectedAlternatives.some((item) =>
    item.reason === "malformed_projection"
  ));
});

test("M2.2 non-EMPTY observer source rejects", () => {
  const wrongObserver = selectM2([metricSafeLeft({
    id: "rb_ceiling_source",
    observationSource: "focused_side_ceiling_wall",
  })], M2_ONLY);
  assert.ok(wrongObserver.rejectedAlternatives.some((item) =>
    item.reason === "observer_source_not_empty_floor_wall"
  ));
});

test("M2.2 focused_side_floor_wall_observer qualifies when insufficient", () => {
  const focused = selectM2([metricSafeLeft({
    id: "rb_focused",
    observationSource: "focused_side_floor_wall_observer",
    status: "insufficient",
    reasons: ["floor_occupancy_not_unique"],
  })], M2_ONLY);
  assert.equal(focused.selected?.id, "rb_focused");
});

test("M2.2 collision-only EA wall without S4A projected candidate does not enter", () => {
  const eaOnly = selectM2([metricSafeLeft({
    id: "rb_ea_wall_wall",
    category: "wall_wall",
    status: "accepted",
  })], {
    ...M2_ONLY,
    roomCollision: {
      boundaries: [{
        sourceBoundaryId: "ea_collision_wall",
        corroboration: { openingCrossing: false },
      }],
    },
  });
  assert.equal(eaOnly.selected, null);
  assert.ok(eaOnly.rejectedAlternatives.some((item) =>
    item.reason === "not_floor_wall"
  ));
  const selector = readV2("observed-span-metric-candidate.ts");
  assert.doesNotMatch(selector, /experimentalTrust/);
});


test("54-58 provider counts and launch gating", async () => {
  let m2Calls = 0;
  const complete = await executeAfcV2Analysis(analyzeInput, {
    product: productDependencies(),
    observeRoom: async () => completeBackObservation(),
    estimateObservedSpanPhysical: async () => {
      m2Calls += 1;
      throw new Error("path A must not call M2");
    },
  });
  assert.equal(complete.status, "applied");
  assert.equal(m2Calls, 0);
  if (complete.status === "applied") {
    assert.equal(complete.metricCorrespondenceEstimate, null);
    assert.equal(
      complete.observedSpanMetricSelection?.selectionStatus,
      "suppressed_by_path_a",
    );
    assert.equal(complete.observedSpanMetricSelection?.estimatorLaunched, false);
  }

  const emptyObservation = buildEmptyRoomObservationEvidence({
    observedPlanes: [{
      id: "visible_floor",
      category: "floor",
      sourceNormalizedPolygon: [
        { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedSeams: [],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  }, {
    attemptId: analyzeInput.attemptId,
    loadGeneration: analyzeInput.loadGeneration,
    emptyIdentity: {
      sha256: "e".repeat(64),
      byteCount: 3,
      decodedWidth: 1200,
      decodedHeight: 800,
      mimeType: "image/png",
      orientation: 1,
    },
    originalAncestorSha256: "a".repeat(64),
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-07T00:00:00.000Z",
  });
  let emptyCalls = 0;
  const none = await executeAfcV2Analysis({
    ...analyzeInput,
    attemptId: "v2-m2-none",
  }, {
    product: productDependencies(),
    observeRoom: async () => emptyObservation,
    estimateObservedSpanPhysical: async () => {
      emptyCalls += 1;
      throw new Error("no candidate must not call M2");
    },
  });
  assert.equal(none.status, "applied");
  assert.equal(emptyCalls, 0);

  let pathBCalls = 0;
  const candidate = selectM2(
    [truncatedLeftMeetingBack(), shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  ).selected!;
  const launched = launchObservedSpanPhysicalEstimate({
    input: analyzeInput,
    dependencies: {
      estimateObservedSpanPhysical: async () => {
        pathBCalls += 1;
        return {
          schemaVersion: "afc-v2-observed-span-physical-estimate/v1",
          authority: AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_AUTHORITY,
          lineage: fakeLineage(candidate),
          sourceImageKind: "EMPTY_OVERLAY",
          contextImageKind: "ORIGINAL_CONTEXT",
          overlayImageHash: "o".repeat(64),
          provider: "controlled_fixture",
          model: "fixture",
          promptVersion: "afc-v2-observed-span-physical-estimator/v1",
          estimate: acceptedEstimate(),
          hostAcceptance: {
            class: "accepted",
            reasons: ["host_accepted_observed_span_physical_estimate"],
            autoMetricScale: 2.4 / candidate.canonicalLength,
          },
          failure: null,
          diagnostics: {
            estimatorLaunched: true,
            originalIncludedAsUnhighlightedContext: true,
            canonicalLengthSentToProvider: false,
            autoMetricScaleSentToProvider: false,
            widthDepthSentAsExpectedAnswer: false,
            forbiddenGeometryFieldsPresent: false,
          },
        };
      },
    },
    product: {
      emptyBasis: {
        sha256: "e".repeat(64),
        byteCount: PIXEL.byteLength,
        decodedWidth: 1,
        decodedHeight: 1,
        mimeType: "image/png",
        orientation: 1,
      },
      originalBasis: {
        sha256: "a".repeat(64),
        byteCount: PIXEL.byteLength,
        decodedWidth: 1,
        decodedHeight: 1,
        mimeType: "image/png",
        orientation: 1,
      },
    } as never,
    floorAuthorityKey: "floor-key",
    freezeReceipt: {
      receiptVersion: "freeze-v1",
      integrity: { payloadSha256: "f".repeat(64) },
    },
    roomBoundaries: s4aReceipt([
      truncatedLeftMeetingBack(),
      truncatedRight(),
    ]) as never,
    roomCollision: null,
    roomObservation: {
      observedSeams: [{
        id: "wall_wall_corner",
        category: "wall_wall",
        planeIds: ["visible_wall_left", "visible_wall_right"],
        sourceNormalizedPolyline: [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
        endpointPolicy: "preserve_observed_open_endpoints",
        confidence: 0.8,
        ambiguity: null,
        evidenceClass: "provider_reported_visible_evidence",
        observationSource: "general_empty_observer",
      }],
      observedOpenings: [],
      observedJunctions: [],
    } as never,
    emptyBytes: PIXEL,
    originalBytes: PIXEL,
  });
  assert.equal(launched.selection.estimatorLaunched, true);
  await launched.estimatePromise;
  assert.equal(pathBCalls, 1);
  const again = launchObservedSpanPhysicalEstimate({
    input: { ...analyzeInput, loadGeneration: 2 },
    dependencies: {
      estimateObservedSpanPhysical: async () => {
        pathBCalls += 1;
        throw new Error("warm/re-read still launches");
      },
    },
    product: {
      emptyBasis: {
        sha256: "e".repeat(64),
        byteCount: PIXEL.byteLength,
        decodedWidth: 1,
        decodedHeight: 1,
        mimeType: "image/png",
        orientation: 1,
      },
      originalBasis: {
        sha256: "a".repeat(64),
        byteCount: PIXEL.byteLength,
        decodedWidth: 1,
        decodedHeight: 1,
        mimeType: "image/png",
        orientation: 1,
      },
    } as never,
    floorAuthorityKey: "floor-key-2",
    freezeReceipt: {
      receiptVersion: "freeze-v2",
      integrity: { payloadSha256: "g".repeat(64) },
    },
    roomBoundaries: s4aReceipt([
      truncatedLeftMeetingBack(),
      truncatedRight(),
    ]) as never,
    roomCollision: null,
    roomObservation: {
      observedSeams: [{
        id: "wall_wall_corner",
        category: "wall_wall",
        planeIds: ["visible_wall_left", "visible_wall_right"],
        sourceNormalizedPolyline: [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
        endpointPolicy: "preserve_observed_open_endpoints",
        confidence: 0.8,
        ambiguity: null,
        evidenceClass: "provider_reported_visible_evidence",
        observationSource: "general_empty_observer",
      }],
      observedOpenings: [],
      observedJunctions: [],
    } as never,
    emptyBytes: PIXEL,
    originalBytes: PIXEL,
  });
  await again.estimatePromise.catch(() => null);
  assert.equal(pathBCalls, 2);
  const analysis = readV2("afc-v2-analysis.server.ts");
  assert.match(analysis, /launchObservedSpanPhysicalEstimate/);
  assert.doesNotMatch(analysis, /estimateMetricCorrespondenceSpan/);
  assert.match(analysis, /metricCorrespondenceEstimate: null/);
  assert.doesNotMatch(analysis, /observedSpanCache|m2Cache/);
});

test("59-65 V1 / frozen architecture / UI / hierarchy", () => {
  const v1Runtime = readdirSync(V1_DIRECTORY)
    .filter((name) => /\.(?:ts|tsx)$/.test(name))
    .map((name) => readFileSync(path.join(V1_DIRECTORY, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(v1Runtime, /selectObservedSpanMetricCandidate/);
  assert.doesNotMatch(v1Runtime, /observed-span-physical-estimate/);
  const roomLab = readV2("RoomLabV2.tsx");
  const overlay = readV2("RoomEvidenceOverlay.tsx");
  const analysis = readV2("afc-v2-analysis.server.ts");
  const selector = readV2("observed-span-metric-candidate.ts");
  assert.match(roomLab, /OBSERVED_SPAN_METRIC_LABEL/);
  assert.match(roomLab, /OBSERVED_SPAN_METRIC_HELPER_COPY/);
  assert.match(roomLab, /selectAppliedAutoMetricScale/);
  assert.match(roomLab, /deriveAutoMetricScale\(/);
  assert.match(roomLab, /computeMetricScale\(autoMetricScale, userWorldScale\)/);
  assert.match(roomLab, /Endpoint diagnostics/);
  assert.match(roomLab, /Truncation diagnostic/);
  assert.match(roomLab, /Junction diagnostic/);
  assert.match(roomLab, /OBSERVED_SPAN_SEMANTIC_S4A_BYPASSED_COPY/);
  assert.match(roomLab, /AFC_V2_OBSERVED_SPAN_METRIC_AUTHORITY/);
  assert.match(roomLab, /Physical estimate authority: physical_estimate_only/);
  assert.doesNotMatch(roomLab, />Truncation: one end</);
  assert.doesNotMatch(roomLab, /S4A trusted/);
  assert.doesNotMatch(roomLab, /full room width|full room depth|completed wall/);
  assert.equal(OBSERVED_SPAN_METRIC_LABEL, "Estimated Metric Span");
  assert.equal(OBSERVED_SPAN_METRIC_HELPER_COPY, "Auto from highlighted observed wall segment");
  assert.equal(
    AFC_V2_OBSERVED_SPAN_METRIC_AUTHORITY,
    "metric_safe_projected_observed_floor_wall",
  );
  assert.equal(
    OBSERVED_SPAN_METRIC_GEOMETRY_COPY,
    "Metric geometry: accepted for same-segment measurement",
  );
  assert.equal(
    OBSERVED_SPAN_SEMANTIC_S4A_BYPASSED_COPY,
    "Semantic S4A qualification bypassed for metric: yes",
  );
  assert.equal(
    OBSERVED_SPAN_COLLISION_AUTHORITY_SEPARATE_COPY,
    "Collision authority: separate / not claimed",
  );
  assert.equal(
    observedSpanEndpointDiagnosticCopy("observed_interior"),
    "observed interior",
  );
  assert.equal(observedSpanTruncationDiagnosticCopy("none"), null);
  assert.equal(observedSpanTruncationDiagnosticCopy("one_end"), "one end");
  assert.equal(observedSpanTruncationDiagnosticCopy("both_ends"), "both ends");
  assert.equal(
    OBSERVED_SPAN_AUTO_SOURCE_COPY,
    "Gemini observed-span length + canonical segment",
  );
  assert.match(overlay, /observedSpanMetricCandidate/);
  assert.match(overlay, /overlaySpace === "empty"/);
  assert.doesNotMatch(selector, /overlay_unsafe/);
  assert.doesNotMatch(selector, /identity_uv/);
  assert.doesNotMatch(selector, /experimentalTrust/);
  assert.doesNotMatch(analysis, /estimateMetricCorrespondenceSpan/);
  const collisionKernel = readV2("room-collision-geometry.ts");
  assert.doesNotMatch(collisionKernel, /selectObservedSpanMetricCandidate/);
  const reader = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab/afc-sr1-tiled-live-product.ts"),
    "utf8",
  );
  const floor = readV2("fully-tiled-floor-authority.server.ts");
  const camera = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab/calibrated-camera-readonly-projection.ts"),
    "utf8",
  );
  assert.doesNotMatch(reader, /selectObservedSpanMetricCandidate/);
  assert.doesNotMatch(floor, /selectObservedSpanMetricCandidate/);
  assert.doesNotMatch(camera, /selectObservedSpanMetricCandidate/);
  const pathA = deriveAutoMetricScale({
    roomPrior: acceptedWidthPrior() as never,
    selected: selectMetricCorrespondenceSpan({
      roomBoundary: s4aReceipt([completeBack()]),
      registration: { registrationClass: "exact_grid_registered" },
      originalLocalizedBoundary: null,
    }).selected,
    s4aSafety: S4A_SAFE,
    trustSelectedBackSpanAsFullWidth: true,
  });
  const applied = selectAppliedAutoMetricScale({
    pathA,
    pathB: deriveObservedSpanAutoMetricScale({
      completeBackGeometryExists: true,
      candidate: null,
      estimate: null,
    }),
    completeBackGeometryExists: true,
  });
  assert.equal(applied.autoMetricScale, pathA.autoMetricScale);
  assert.equal(AUTO_METRIC_SCALE, 1);
});

test("estimator uses EMPTY overlay and unhighlighted ORIGINAL context", async () => {
  const candidate = selectM2(
    [truncatedLeftMeetingBack(), shortJunctionMate()],
    { suppressWhenCompleteBackGeometryExists: false },
  ).selected!;
  let sawOriginal = false;
  let prompt = "";
  const result = await estimateObservedSpanPhysicalLength({
    attemptId: "m2",
    loadGeneration: 1,
    empty: {
      bytes: PIXEL,
      identity: {
        sha256: createHash("sha256").update(PIXEL).digest("hex"),
        byteCount: PIXEL.byteLength,
        decodedWidth: 1,
        decodedHeight: 1,
        mimeType: "image/png",
        orientation: 1,
      },
    },
    original: {
      bytes: PIXEL,
      identity: {
        sha256: createHash("sha256").update(PIXEL).digest("hex"),
        byteCount: PIXEL.byteLength,
        decodedWidth: 1,
        decodedHeight: 1,
        mimeType: "image/png",
        orientation: 1,
      },
    },
    candidate,
    floorAuthorityKey: "floor-key",
    freezeReceiptVersion: "freeze-v1",
    freezePayloadSha256: "f".repeat(64),
  }, {
    composeOverlay: async (args) => {
      assert.equal(args.caption, OBSERVED_SPAN_OVERLAY_CAPTION);
      assert.equal(args.imageA.x, candidate.imageA.x);
      assert.equal(args.imageB.x, candidate.imageB.x);
      return {
        bytes: PIXEL,
        mimeType: "image/png",
        sha256: "o".repeat(64),
        pixelA: { x: 0, y: 0 },
        pixelB: { x: 1, y: 1 },
        svg: "<svg></svg>",
      };
    },
    callProvider: async (args) => {
      prompt = args.prompt;
      sawOriginal = args.originalBase64 !== null;
      assert.equal(args.emptyOverlayBase64.length > 0, true);
      return {
        status: "recoverable",
        estimatedLengthM: { low: 2.1, best: 2.4, high: 2.8 },
        modelConfidence: 0.72,
        limitations: [],
        notes: null,
      };
    },
  });
  assert.equal(sawOriginal, true);
  assert.doesNotMatch(prompt, /canonicalLength/);
  assert.doesNotMatch(prompt, /autoMetricScale/);
  assert.equal(result.diagnostics.originalIncludedAsUnhighlightedContext, true);
  assert.equal(result.authority, "physical_estimate_only");
});
