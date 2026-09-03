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
  type AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import { buildEmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import {
  AFC_V2_METRIC_CORRESPONDENCE_AUTHORITY,
  AFC_V2_METRIC_CORRESPONDENCE_SELECTION_VERSION,
  canonicalWorldSpanLength,
  formatCanonicalGaugeUnits,
  isMetricCorrespondenceSelection,
  METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED,
  metricCorrespondenceRoleCopy,
} from "./metric-correspondence-span-contract";
import {
  deriveMetricCorrespondenceSpanRole,
  selectMetricCorrespondenceSpan,
} from "./metric-correspondence-span";
import {
  ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
  originalSourcePoint,
} from "./original-structural-localization-authority-contract";
import type { OriginalLocalizedBoundaryCandidate } from "./original-localized-boundary-authority-contract";
import { constructAfcV2RoomBoundaryAuthority } from "./room-boundary-authority.server";
import {
  ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M,
  type RoomBoundaryCandidate,
  type RoomBoundaryWorldGeometry,
} from "./room-boundary-authority-contract";
import {
  AUTO_METRIC_SCALE,
  computeMetricScale,
} from "./scene-metric-world-realization";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function readV2(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const CAMERA = {
  position: { x: 0, y: 2, z: 4 },
  lookAt: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
} as const;

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
  confidence?: number;
  frameAdjacentEndpoint?: boolean;
  lineResidualClass?: RoomBoundaryCandidate["imageEvidence"]["lineResidualClass"];
  worldGeometry?: RoomBoundaryWorldGeometry | null;
  imageA?: { x: number; y: number };
  imageB?: { x: number; y: number };
  reasons?: readonly string[];
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
  return {
    id: overrides.id ?? "rb_back_floor_wall",
    sourceSeamId: overrides.sourceSeamId ?? "back_floor_wall",
    status: overrides.status ?? "accepted",
    source: {
      category: overrides.category ?? "floor_wall",
      observationSource: "general_empty_observer",
      imageBasis: "EMPTY",
      planeIds: ["visible_floor", "visible_wall"],
      floorPlaneId: "visible_floor",
      wallPlaneId: "visible_wall",
      confidence: overrides.confidence ?? 0.9,
      ambiguity: null,
    },
    imageEvidence: {
      polyline: [imageA, imageB],
      occupancy: null,
      frontier: null,
      lineResidual: null,
      lineResidualClass: overrides.lineResidualClass ?? "supported",
      nearVertical: false,
    },
    projection: {
      kernelVersion: "afc-v2-room-boundary-projection/v1",
      points: [
        okProjection(imageA, worldA),
        okProjection(imageB, worldB),
      ],
      worldSamples: [worldA, worldB],
      worldResidual: null,
    },
    worldGeometry: world,
    interior: {
      status: "accepted",
      witnessImagePoint: { x: 0.5, y: 0.7 },
      witnessWorldPoint: { x: 0, y: 0, z: 0.2 },
      sideSign: 1,
      cameraSideSign: 1,
      cameraContradictsWitness: false,
    },
    authority: {
      kind: "visible_wall_base_boundary",
      baseSegment: true,
      supportPlane: true,
      interiorHalfSpace: "accepted",
      collision: false,
    },
    limitations: {
      observedSpanOnly: true,
      verticalExtentUnknown: true,
      hiddenContinuation: false,
      completeWall: false,
      frameAdjacentEndpoint: overrides.frameAdjacentEndpoint ?? false,
      geometryManufactured: false,
    },
    reasons: overrides.reasons ?? [],
  };
}

function olCandidate(overrides: {
  id?: string;
  sourceObservationSeamId?: string;
  status?: OriginalLocalizedBoundaryCandidate["status"];
  worldGeometry?: RoomBoundaryWorldGeometry | null;
  imageA?: { x: number; y: number };
  imageB?: { x: number; y: number };
  matchedFraction?: number | null;
} = {}): OriginalLocalizedBoundaryCandidate {
  const world = overrides.worldGeometry === undefined
    ? geometry(-1.5, 0.1, 1.5, 0.1)
    : overrides.worldGeometry;
  const imageA = overrides.imageA ?? { x: 0.22, y: 0.64 };
  const imageB = overrides.imageB ?? { x: 0.78, y: 0.64 };
  return {
    id: overrides.id ?? "olb_back_floor_wall",
    sourceObservationSeamId: overrides.sourceObservationSeamId ?? "back_floor_wall",
    sourceOLStructureId: "ol_back_floor_wall",
    status: overrides.status ?? "accepted",
    source: {
      imageBasis: "ORIGINAL",
      coordinateSpace: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
      floorPlaneId: "visible_floor",
      wallPlaneId: "visible_wall",
      planeIds: ["visible_floor", "visible_wall"],
    },
    originalImageEvidence: {
      polyline: [
        originalSourcePoint(imageA.x, imageA.y),
        originalSourcePoint(imageB.x, imageB.y),
      ],
      occupancy: null,
      lineResidual: null,
      sampleCount: 2,
      matchedSampleCount: 2,
      matchedFraction: overrides.matchedFraction ?? 0.8,
      orientationResidual: null,
    },
    projection: {
      kernel: "projectOriginalSourceNormalizedToWorld",
      worldSamples: world
        ? [
          { x: world.baseStart.x, z: world.baseStart.z },
          { x: world.baseEnd.x, z: world.baseEnd.z },
        ]
        : [],
      worldResidual: null,
    },
    worldGeometry: world,
    interior: {
      status: "accepted",
      witnessImagePoint: { x: 0.5, y: 0.7 },
      witnessWorldPoint: { x: 0, y: 0, z: 0.2 },
      sideSign: 1,
      cameraSideSign: 1,
      cameraContradictsWitness: false,
    },
    authority: {
      kind: "partial_original_localized_room_boundary_authority",
      baseSegment: true,
      supportPlane: true,
      interiorHalfSpace: "accepted",
      collision: false,
    },
    limitations: {
      observedSpanOnly: true,
      hiddenContinuation: false,
      geometryManufactured: false,
      closedTopology: false,
      collisionAuthority: false,
      emptyCoordinatesAuthoritative: false,
    },
    reasons: [],
  };
}

function s4aReceipt(candidates: readonly RoomBoundaryCandidate[]) {
  return {
    candidates,
    lineage: {
      camera: { pose: CAMERA },
    },
  };
}

function selectIdentity(candidates: readonly RoomBoundaryCandidate[]) {
  return selectMetricCorrespondenceSpan({
    roomBoundary: s4aReceipt(candidates),
    registration: { registrationClass: "exact_grid_registered" },
    originalLocalizedBoundary: null,
    originalLocalizationClass: null,
  });
}

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
const analyzeInput: AfcV2AnalyzeInput = {
  attemptId: "v2-ux3b0-correspondence",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 31,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

function productDependencies(): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-ux3b0-result",
    qualifyOriginal: async () => ({
      sourceImageUrl: analyzeInput.sourceImageUrl,
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
        runId: "v2-ux3b0-generation",
        generatedAt: "2026-09-02T12:00:00.000Z",
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

function observationEvidence() {
  return buildEmptyRoomObservationEvidence({
    observedPlanes: [{
      id: "visible_floor",
      category: "floor",
      sourceNormalizedPolygon: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 0.8, y: 0.62 },
        { x: 0.2, y: 0.62 },
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
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-02T18:00:00.000Z",
  });
}

test("eligible accepted S4A back floor-wall is selected with correct canonical length", () => {
  const world = geometry(-2, 0, 2, 0);
  const candidate = s4aCandidate({ worldGeometry: world });
  const result = selectIdentity([candidate]);
  assert.equal(result.schemaVersion, AFC_V2_METRIC_CORRESPONDENCE_SELECTION_VERSION);
  assert.equal(result.authority, AFC_V2_METRIC_CORRESPONDENCE_AUTHORITY);
  assert.equal(result.selectionStatus, "selected");
  assert.ok(result.selected);
  assert.equal(result.selected?.role, "back_floor_wall");
  assert.equal(result.selected?.source, "s4a_floor_wall");
  assert.equal(result.selected?.overlaySafeOnOriginal, true);
  assert.equal(result.selected?.truncation, "none");
  assert.equal(result.selected?.endpointAClass, "observed_interior");
  assert.equal(result.selected?.endpointBClass, "observed_interior");
  const expected = canonicalWorldSpanLength(
    { x: world.baseStart.x, z: world.baseStart.z },
    { x: world.baseEnd.x, z: world.baseEnd.z },
  );
  assert.equal(result.selected?.canonicalLength, expected);
  assert.equal(expected, 4);
  assert.ok(
    (result.selected?.imageLengthNormalized ?? 0) >=
      METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED,
  );
  assert.equal(result.selected?.lineage.sourceSeamId, "back_floor_wall");
  assert.equal(result.selected?.lineage.registrationClass, "exact_grid_registered");
  assert.equal(
    deriveMetricCorrespondenceSpanRole(world, CAMERA),
    "back_floor_wall",
  );
});

test("eligible side seam is selected when no valid back seam exists", () => {
  const left = s4aCandidate({
    id: "rb_left_floor_wall",
    sourceSeamId: "left_floor_wall",
    worldGeometry: geometry(-2, 0.2, -2, 3.2),
    imageA: { x: 0.12, y: 0.35 },
    imageB: { x: 0.18, y: 0.82 },
    confidence: 0.7,
  });
  const result = selectIdentity([left]);
  assert.equal(result.selectionStatus, "selected");
  assert.equal(result.selected?.role, "left_floor_wall");
  assert.equal(
    deriveMetricCorrespondenceSpanRole(left.worldGeometry!, CAMERA),
    "left_floor_wall",
  );
  const right = s4aCandidate({
    id: "rb_right_floor_wall",
    sourceSeamId: "right_floor_wall",
    worldGeometry: geometry(2, 0.2, 2, 3.2),
    imageA: { x: 0.82, y: 0.35 },
    imageB: { x: 0.88, y: 0.82 },
  });
  assert.equal(
    deriveMetricCorrespondenceSpanRole(right.worldGeometry!, CAMERA),
    "right_floor_wall",
  );
});

test("ranking prefers back over side, then confidence, image span, and stable id", () => {
  const backLow = s4aCandidate({
    id: "rb_back_low",
    sourceSeamId: "back_floor_wall",
    worldGeometry: geometry(-2, 0, 0, 0),
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.5, y: 0.62 },
    confidence: 0.4,
  });
  const sideHigh = s4aCandidate({
    id: "rb_left_high",
    sourceSeamId: "left_floor_wall",
    worldGeometry: geometry(-2, 0.2, -2, 3.2),
    imageA: { x: 0.12, y: 0.3 },
    imageB: { x: 0.2, y: 0.85 },
    confidence: 0.99,
  });
  const rankedRole = selectIdentity([sideHigh, backLow]);
  assert.equal(rankedRole.selected?.id, "rb_back_low");

  const backHigh = s4aCandidate({
    id: "rb_back_high",
    sourceSeamId: "back_alt",
    worldGeometry: geometry(1.2, 0.05, 3.2, 0.05),
    imageA: { x: 0.55, y: 0.6 },
    imageB: { x: 0.88, y: 0.6 },
    confidence: 0.95,
  });
  const rankedConfidence = selectIdentity([backLow, backHigh]);
  assert.equal(rankedConfidence.selected?.id, "rb_back_high");

  const backLong = s4aCandidate({
    id: "rb_back_long",
    sourceSeamId: "back_long",
    worldGeometry: geometry(-3, 0.2, 1, 0.2),
    imageA: { x: 0.1, y: 0.58 },
    imageB: { x: 0.9, y: 0.58 },
    confidence: 0.95,
  });
  const rankedImage = selectIdentity([backHigh, backLong]);
  assert.equal(rankedImage.selected?.id, "rb_back_long");
  assert.ok(
    (rankedImage.selected?.imageLengthNormalized ?? 0) >
      (backHigh.imageEvidence.polyline[1]!.x - backHigh.imageEvidence.polyline[0]!.x),
  );

  const aaa = s4aCandidate({
    id: "rb_aaa",
    sourceSeamId: "seam_aaa",
    worldGeometry: geometry(-2, 0.4, 0.5, 0.4),
    imageA: { x: 0.2, y: 0.55 },
    imageB: { x: 0.7, y: 0.55 },
    confidence: 0.5,
    lineResidualClass: "underdetermined",
  });
  const zzz = s4aCandidate({
    id: "rb_zzz",
    sourceSeamId: "seam_zzz",
    worldGeometry: geometry(0.8, 0.4, 3.2, 0.4),
    imageA: { x: 0.2, y: 0.55 },
    imageB: { x: 0.7, y: 0.55 },
    confidence: 0.5,
    lineResidualClass: "underdetermined",
  });
  const rankedId = selectIdentity([zzz, aaa]);
  assert.equal(rankedId.selected?.id, "rb_aaa");
});

test("residual-supported back outranks underdetermined at equal confidence and image span", () => {
  const supported = s4aCandidate({
    id: "rb_supported",
    sourceSeamId: "back_supported",
    worldGeometry: geometry(-2, 0, 1, 0),
    imageA: { x: 0.2, y: 0.6 },
    imageB: { x: 0.7, y: 0.6 },
    confidence: 0.7,
    lineResidualClass: "supported",
  });
  const under = s4aCandidate({
    id: "rb_under",
    sourceSeamId: "back_under",
    worldGeometry: geometry(1.2, 0.05, 3.5, 0.05),
    imageA: { x: 0.2, y: 0.6 },
    imageB: { x: 0.7, y: 0.6 },
    confidence: 0.7,
    lineResidualClass: "underdetermined",
  });
  const result = selectIdentity([under, supported]);
  assert.equal(result.selected?.id, "rb_supported");
});

test("image span below the named minimum is rejected", () => {
  const tooShort = s4aCandidate({
    id: "rb_short",
    imageA: { x: 0.50, y: 0.62 },
    imageB: { x: 0.50 + METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED / 2, y: 0.62 },
  });
  const result = selectIdentity([tooShort]);
  assert.equal(result.selected, null);
  assert.equal(result.rejectedAlternatives[0]?.reason, "too_short_in_image");
});

test("frameAdjacentEndpoint is a hard rejection for correspondence", () => {
  const truncated = s4aCandidate({
    id: "rb_truncated",
    frameAdjacentEndpoint: true,
    imageA: { x: 0.01, y: 0.62 },
    imageB: { x: 0.7, y: 0.62 },
  });
  const result = selectIdentity([truncated]);
  assert.equal(result.selectionStatus, "no_eligible_finite_span");
  assert.equal(result.selected, null);
  assert.equal(result.rejectedAlternatives[0]?.reason, "frame_truncated");
});

test("zero or nearly-zero world length is rejected as degenerate", () => {
  const degenerate = s4aCandidate({
    id: "rb_degenerate",
    worldGeometry: geometry(1, 1, 1, 1 + ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M / 2),
  });
  const result = selectIdentity([degenerate]);
  assert.equal(result.selected, null);
  assert.equal(result.rejectedAlternatives[0]?.reason, "degenerate");
});

test("identity-certified ORIGINAL overlay is eligible; OL-certified is eligible; neither is rejected", () => {
  const s4a = s4aCandidate();
  const identity = selectMetricCorrespondenceSpan({
    roomBoundary: s4aReceipt([s4a]),
    registration: { registrationClass: "certified_rescaled_registered" },
    originalLocalizedBoundary: null,
    originalLocalizationClass: null,
  });
  assert.equal(identity.selected?.overlaySafeOnOriginal, true);
  assert.equal(identity.selected?.source, "s4a_floor_wall");

  const ol = olCandidate();
  const olOnly = selectMetricCorrespondenceSpan({
    roomBoundary: s4aReceipt([s4a]),
    registration: { registrationClass: "rejected" },
    originalLocalizedBoundary: {
      candidates: [ol],
      camera: { pose: CAMERA },
      lineage: { originalLocalizationClass: "certified_original_localized" },
    },
    originalLocalizationClass: "certified_original_localized",
  });
  assert.equal(olOnly.selected?.source, "ol_floor_wall");
  assert.equal(olOnly.selected?.overlaySafeOnOriginal, true);
  assert.equal(olOnly.selected?.imageSpace, "original-source-normalized-image/v1");

  const neither = selectMetricCorrespondenceSpan({
    roomBoundary: s4aReceipt([s4a]),
    registration: { registrationClass: "insufficient" },
    originalLocalizedBoundary: {
      candidates: [ol],
      lineage: { originalLocalizationClass: "original_localization_insufficient" },
    },
    originalLocalizationClass: "original_localization_insufficient",
  });
  assert.equal(neither.selected, null);
  assert.ok(
    neither.rejectedAlternatives.every((item) =>
      item.reason === "overlay_unsafe" || item.reason === "registration_unavailable"
    ),
  );
});

test("no candidate returns null / no_eligible_finite_span", () => {
  const empty = selectMetricCorrespondenceSpan({
    roomBoundary: s4aReceipt([]),
    registration: { registrationClass: "exact_grid_registered" },
    originalLocalizedBoundary: null,
    originalLocalizationClass: null,
  });
  assert.equal(empty.selected, null);
  assert.equal(empty.selectionStatus, "no_eligible_finite_span");
  assert.equal(isMetricCorrespondenceSelection(empty), true);

  const missing = selectMetricCorrespondenceSpan({
    roomBoundary: null,
    registration: null,
    originalLocalizedBoundary: null,
  });
  assert.equal(missing.selectionStatus, "no_eligible_finite_span");
});

test("extraction failure is fail-closed and never throws", () => {
  const exploding = new Proxy({}, {
    get() {
      throw new Error("correspondence boom");
    },
  });
  const result = selectMetricCorrespondenceSpan({
    roomBoundary: exploding as never,
    registration: { registrationClass: "exact_grid_registered" },
    originalLocalizedBoundary: null,
  });
  assert.equal(result.selectionStatus, "no_eligible_finite_span");
  assert.equal(result.selected, null);
  assert.ok(result.selectionReasons.includes("extraction_failed_closed"));
});

test("not-accepted and non-floor-wall S4A candidates are rejected", () => {
  const rejected = selectIdentity([
    s4aCandidate({ id: "rb_rej", status: "rejected" }),
    s4aCandidate({
      id: "rb_ceiling",
      category: "wall_ceiling",
      status: "accepted",
    }),
  ]);
  assert.equal(rejected.selected, null);
  const reasons = rejected.rejectedAlternatives.map((item) => item.reason);
  assert.ok(reasons.includes("not_accepted"));
  assert.ok(reasons.includes("not_floor_wall"));
});

test("constructed S4A back seam is eligible under identity registration", () => {
  const observation = buildEmptyRoomObservationEvidence({
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
    attemptId: "v2-ux3b0-s4a",
    loadGeneration: 3,
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 1200,
      decodedHeight: 800,
      byteCount: 3,
      mimeType: "image/png",
      orientation: 1,
    },
    originalAncestorSha256: "a".repeat(64),
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-09-02T18:00:00.000Z",
  });
  const receipt = constructAfcV2RoomBoundaryAuthority({
    attemptId: "v2-ux3b0-s4a",
    loadGeneration: 3,
    observation,
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 1200,
      decodedHeight: 800,
      orientation: 1,
    },
    originalIdentity: {
      sha256: "a".repeat(64),
      decodedWidth: 1200,
      decodedHeight: 800,
      orientation: 1,
    },
    floor: {
      authorityKey: "floor-key",
      worldWidthM: 6,
      referenceDepthM: 4,
      widthDepthRatio: 1.5,
    },
    camera: {
      verticalFovDeg: 52,
      pose: CAMERA,
      frame: { width: 900, height: 600 },
    },
    freezeReceipt: {
      receiptVersion: "afc-sr1-calibrated-camera-freeze-receipt/v1",
      integrity: { payloadSha256: "f".repeat(64) },
    },
  });
  const accepted = receipt.candidates.find((item) => item.status === "accepted");
  assert.ok(accepted?.worldGeometry);
  const result = selectMetricCorrespondenceSpan({
    roomBoundary: receipt,
    registration: { registrationClass: "exact_grid_registered" },
    originalLocalizedBoundary: null,
    originalLocalizationClass: null,
  });
  if (accepted && !accepted.limitations.frameAdjacentEndpoint) {
    assert.equal(result.selectionStatus, "selected");
    assert.ok(result.selected);
    assert.equal(result.selected?.source, "s4a_floor_wall");
    const expected = canonicalWorldSpanLength(
      result.selected!.canonicalWorldA,
      result.selected!.canonicalWorldB,
    );
    assert.equal(result.selected?.canonicalLength, expected);
    assert.ok(result.selected!.canonicalLength > ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M);
  }
});

test("correspondence files never consume TILED Floor edges or collision walls", () => {
  const selector = readV2("metric-correspondence-span.ts");
  const contract = readV2("metric-correspondence-span-contract.ts");
  for (const source of [selector, contract]) {
    assert.doesNotMatch(source, /selectActiveRuntimeCollisionWalls/);
    assert.doesNotMatch(source, /\bworldWidthM\b/);
    assert.doesNotMatch(source, /\breferenceDepthM\b/);
    assert.doesNotMatch(source, /\bNL\b|\bNR\b|\bFR\b|\bFL\b/);
    assert.doesNotMatch(source, /metric-room-prior/);
    assert.doesNotMatch(source, /estimatedRoomDepthM/);
    assert.doesNotMatch(source, /autoMetricScale/);
    assert.doesNotMatch(source, /computeMetricScale/);
    assert.doesNotMatch(source, /gemini|Gemini/);
  }
  assert.match(
    selector,
    /METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED/,
  );
  assert.equal(METRIC_CORRESPONDENCE_MIN_IMAGE_SPAN_NORMALIZED, 0.08);
});

test("generic UX-3a prior is not an input to correspondence selection", () => {
  const selector = readV2("metric-correspondence-span.ts");
  assert.doesNotMatch(selector, /metricRoomPrior/);
  assert.doesNotMatch(selector, /derivedAutoMetricScale/);
  const first = selectIdentity([s4aCandidate()]);
  const second = selectIdentity([s4aCandidate()]);
  assert.equal(first.selected?.id, second.selected?.id);
  assert.equal(first.selected?.canonicalLength, second.selected?.canonicalLength);
});

test("live Auto is not wired from correspondence length; UX-3C0 owns Auto derivation", async () => {
  const result = await executeAfcV2Analysis(analyzeInput, {
    product: productDependencies(),
    observeRoom: async () => observationEvidence(),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.metricCorrespondence?.authority, "prior_only");
  assert.equal(AUTO_METRIC_SCALE, 1);
  assert.equal(computeMetricScale(AUTO_METRIC_SCALE, 1), 1);
  assert.equal(computeMetricScale(AUTO_METRIC_SCALE, 1.25), 1.25);
  assert.equal(result.floor.referenceDepthM, 4);
  const roomLabSource = readV2("RoomLabV2.tsx");
  const realizationSource = readV2("scene-metric-world-realization.ts");
  const analysisSource = readV2("afc-v2-analysis.server.ts");
  const autoScaleSource = readV2("metric-auto-scale.ts");
  assert.match(roomLabSource, /deriveAutoMetricScale\(/);
  assert.match(
    roomLabSource,
    /computeMetricScale\(autoMetricScale, userWorldScale\)/,
  );
  assert.doesNotMatch(roomLabSource, /computeMetricScale\([^)]*metricCorrespondence/);
  assert.doesNotMatch(roomLabSource, /computeMetricScale\([^)]*canonicalLength/);
  assert.doesNotMatch(realizationSource, /metricCorrespondence|canonicalLength/);
  assert.match(autoScaleSource, /deriveUniformMetricScaleFromPhysicalSpan/);
  assert.doesNotMatch(
    analysisSource,
    /settleAfcFixedSeamCalibrationWithRatioExtension\([\s\S]{0,400}metricCorrespondence/,
  );
  assert.doesNotMatch(
    analysisSource,
    /constructAfcV2RoomBoundaryAuthority\([\s\S]{0,500}metricCorrespondence/,
  );
  assert.doesNotMatch(
    analysisSource,
    /constructAfcV2RoomCollisionAuthority\([\s\S]{0,400}metricCorrespondence/,
  );
});

test("correspondence extraction failure does not prevent Analyze Apply", async () => {
  const result = await executeAfcV2Analysis(analyzeInput, {
    product: productDependencies(),
    observeRoom: async () => observationEvidence(),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.ok(result.floor);
  assert.equal(result.camera.applied, true);
  assert.ok(result.roomBoundaries);
  assert.ok(result.roomCollision);
  assert.equal(result.metricCorrespondence?.selectionStatus, "no_eligible_finite_span");
  assert.equal(result.metricCorrespondence?.selected, null);
  const analysisSource = readV2("afc-v2-analysis.server.ts");
  const selectIndex = analysisSource.indexOf("selectMetricCorrespondenceSpan");
  const s4bIndex = analysisSource.indexOf("constructAfcV2RoomCollisionAuthority");
  assert.ok(selectIndex > 0 && s4bIndex > 0 && selectIndex > s4bIndex);
  assert.match(analysisSource, /extraction_failed_closed/);
  assert.match(
    analysisSource,
    /try \{\s*metricCorrespondence = selectMetricCorrespondenceSpan/,
  );
});

test("lab overlay and diagnostic panel stay shadow-only and do not say metres", () => {
  const roomLabSource = readV2("RoomLabV2.tsx");
  const overlaySource = readV2("RoomEvidenceOverlay.tsx");
  assert.match(roomLabSource, /Metric Correspondence/);
  assert.match(roomLabSource, /No eligible finite span/);
  assert.match(roomLabSource, /METRIC_SPAN_ESTIMATE_SHADOW_STATUS_COPY|Shadow only/);
  assert.match(roomLabSource, /No physical estimate yet/);
  assert.match(roomLabSource, /formatCanonicalGaugeUnits/);
  assert.match(roomLabSource, /Download Metric Correspondence/);
  assert.match(roomLabSource, /afc-v2-metric-correspondence-selection\.json/);
  assert.match(overlaySource, /data-evidence-role="metric-correspondence-span"/);
  assert.match(overlaySource, /Metric span/);
  assert.match(overlaySource, /metric-correspondence-endpoint-a/);
  assert.match(overlaySource, /metric-correspondence-endpoint-b/);
  assert.match(
    roomLabSource,
    /selectedRepresentation === "ORIGINAL" &&/,
  );
  assert.match(overlaySource, /overlaySpace === "original"/);
  const panel = roomLabSource.slice(
    roomLabSource.indexOf("Metric Correspondence"),
    roomLabSource.indexOf("Download Metric Correspondence"),
  );
  assert.match(panel, /formatCanonicalGaugeUnits/);
  assert.doesNotMatch(panel, /Canonical length:[\s\S]{0,80}\bm\b/);
  assert.equal(formatCanonicalGaugeUnits(3.12), "3.12 gauge units");
  assert.equal(metricCorrespondenceRoleCopy("back_floor_wall"), "Back floor-wall");
  assert.doesNotMatch(roomLabSource, /computeMetricScale\([^)]*metricCorrespondence/);
  assert.doesNotMatch(overlaySource, /gemini|Gemini/);
});

test("correspondence is not imported by Floor, FOV, S4, or collision authority", () => {
  const forbidden = [
    "fully-tiled-floor-authority.server.ts",
    "room-boundary-authority.server.ts",
    "room-collision-qualification.server.ts",
    "room-collision-geometry.ts",
    "scene-collision-resolver.ts",
    "empty-authoritative-collision-qualification.server.ts",
    "scene-metric-world-realization.ts",
    "CalibratedRoomViewer.tsx",
    "room-envelope-authority.server.ts",
    "original-localized-boundary.server.ts",
    "room-boundary-projection.server.ts",
    "metric-room-prior.server.ts",
    "metric-room-prior-acceptance.ts",
  ];
  for (const fileName of forbidden) {
    const source = readV2(fileName);
    assert.doesNotMatch(
      source,
      /metric-correspondence-span/,
      `${fileName} must not import metric correspondence`,
    );
  }
});

test("future known-span naming stays provider-agnostic", () => {
  const combined = readdirSync(V2_DIRECTORY)
    .filter((fileName) => /\.(?:ts|tsx)$/.test(fileName) && !fileName.endsWith(".test.ts"))
    .map((fileName) => readV2(fileName))
    .join("\n");
  assert.doesNotMatch(combined, /geminiMetricScale|geminiSpanLength|geminiAutoScale/);
  const contract = readV2("metric-correspondence-span-contract.ts");
  assert.match(contract, /physicalSpanLengthM \/ span\.canonicalLength/);
  assert.match(contract, /Do not pass canonicalLength to provider-facing prompts/);
});
