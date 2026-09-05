import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  deriveAutoMetricScale,
  evaluateTrustedBackWallWidthSpan,
} from "./metric-auto-scale";
import { AUTO_METRIC_SCALE } from "./scene-metric-world-realization";
import {
  METRIC_SPAN_CANDIDATE_HELPER_COPY,
  METRIC_SPAN_CANDIDATE_LABEL,
  METRIC_SPAN_TRUSTED_HELPER_COPY,
  METRIC_SPAN_TRUSTED_LABEL,
  canonicalWorldSpanLength,
  metricCorrespondenceSpanHelperCopy,
  metricCorrespondenceSpanLabel,
} from "./metric-correspondence-span-contract";
import { selectMetricCorrespondenceSpan } from "./metric-correspondence-span";
import {
  ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
  originalSourcePoint,
} from "./original-structural-localization-authority-contract";
import type { OriginalLocalizedBoundaryCandidate } from "./original-localized-boundary-authority-contract";
import type {
  RoomBoundaryCandidate,
  RoomBoundaryWorldGeometry,
} from "./room-boundary-authority-contract";
import { acceptMetricRoomPrior } from "./metric-room-prior-acceptance";
import {
  buildMetricRoomPriorReceipt,
  parseMetricRoomPriorModelEstimate,
} from "./metric-room-prior-contract";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const V1_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab");
const ROOM4_LIVE_CANONICAL_LENGTH = 9.582188;
const ROOM4_WIDTH_M = 3.6;
const ROOM4_LIVE_AUTO = ROOM4_WIDTH_M / ROOM4_LIVE_CANONICAL_LENGTH;
const CLASS_A_AUTO_REASONS = [
  "trusted_back_floor_wall_span_experimental",
  "lab_trust_enabled",
  "uniform_physical_span_scale",
] as const;
const S4A_SAFE = Object.freeze({
  observedSpanOnly: true,
  hiddenContinuation: false,
  geometryManufactured: false,
});
const CAMERA = {
  position: { x: 0, y: 2, z: 4 },
  lookAt: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
} as const;
const ROOM2_BACK_IMAGE = {
  a: { x: 0.078, y: 0.694 },
  b: { x: 0.415, y: 0.616 },
} as const;

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
  confidence?: number;
  frameAdjacentEndpoint?: boolean;
  worldGeometry?: RoomBoundaryWorldGeometry | null;
  imageA?: { x: number; y: number };
  imageB?: { x: number; y: number };
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
      lineResidualClass: "supported",
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
    reasons: [],
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
    ? geometry(-0.4, 0.05, 0.4, 0.05)
    : overrides.worldGeometry;
  const imageA = overrides.imageA ?? { x: 0.22, y: 0.64 };
  const imageB = overrides.imageB ?? { x: 0.38, y: 0.64 };
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
      matchedFraction: overrides.matchedFraction ?? 0.95,
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

function selectUncertified(
  candidates: readonly RoomBoundaryCandidate[],
  olCandidates: readonly OriginalLocalizedBoundaryCandidate[] = [],
  registrationClass = "rejected",
  originalLocalizationClass: string | null = olCandidates.length > 0
    ? "certified_original_localized"
    : null,
) {
  return selectMetricCorrespondenceSpan({
    roomBoundary: s4aReceipt(candidates),
    registration: { registrationClass },
    originalLocalizedBoundary: olCandidates.length > 0
      ? {
        candidates: olCandidates,
        camera: { pose: CAMERA },
        lineage: { originalLocalizationClass },
      }
      : null,
    originalLocalizationClass,
  });
}

function room2Back() {
  return s4aCandidate({
    id: "rb_room2_back",
    sourceSeamId: "back_floor_wall",
    worldGeometry: geometry(-2, 0, 2, 0),
    imageA: ROOM2_BACK_IMAGE.a,
    imageB: ROOM2_BACK_IMAGE.b,
  });
}

function room2LeftTruncated() {
  return s4aCandidate({
    id: "rb_room2_left",
    sourceSeamId: "left_floor_wall",
    worldGeometry: geometry(-2, 0.2, -2, 3.2),
    imageA: { x: 0.01, y: 0.85 },
    imageB: { x: 0.078, y: 0.694 },
    frameAdjacentEndpoint: true,
    confidence: 0.7,
  });
}

function room2RightTruncated() {
  return s4aCandidate({
    id: "rb_room2_right",
    sourceSeamId: "right_floor_wall",
    worldGeometry: geometry(2, 0.2, 2, 3.2),
    imageA: { x: 0.415, y: 0.616 },
    imageB: { x: 0.99, y: 0.82 },
    frameAdjacentEndpoint: true,
    confidence: 0.7,
  });
}

function priorReceipt() {
  const parsed = parseMetricRoomPriorModelEstimate({
    observability: "recoverable",
    estimatedRoomDepthM: { low: 4.2, best: 4.5, high: 4.8 },
    estimatedRoomWidthM: { low: 3.3, best: ROOM4_WIDTH_M, high: 3.9 },
    estimatedCeilingHeightM: 2.7,
    modelConfidence: 0.8,
    limitations: [],
    notes: null,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("metric prior parse failed");
  return buildMetricRoomPriorReceipt({
    sourceImageHash: "a".repeat(64),
    originalAncestorSha256: "a".repeat(64),
    attemptId: "v2-m1",
    loadGeneration: 1,
    provider: "controlled_fixture",
    model: "fixture",
  }, parsed.estimate, acceptMetricRoomPrior(parsed.estimate), null);
}

function deriveFromSelected(
  selected: ReturnType<typeof selectIdentity>["selected"],
  trust = true,
) {
  return deriveAutoMetricScale({
    roomPrior: priorReceipt(),
    selected,
    s4aSafety: S4A_SAFE,
    trustSelectedBackSpanAsFullWidth: trust,
  });
}

test("Test A: Class A exact-grid S4A geometry, identity UV, Auto reasons unchanged", () => {
  const back = s4aCandidate();
  const result = selectIdentity([back]);
  assert.equal(result.selectionStatus, "selected");
  assert.equal(result.selected?.id, "rb_back_floor_wall");
  assert.equal(result.selected?.source, "s4a_floor_wall");
  assert.equal(result.selected?.correspondenceSource, "identity_uv");
  assert.equal(result.selected?.spanTrust, "trusted");
  assert.equal(result.selected?.role, "back_floor_wall");
  assert.equal(result.selected?.canonicalLength, 4);
  assert.equal(result.selected?.overlaySafeOnOriginal, true);
  assert.equal(result.selected?.lineage.olCandidateId, null);
  assert.deepEqual([...result.selectionReasons], [
    "accepted_s4a_floor_wall",
    "identity_certified_original_overlay",
    "role_back_floor_wall",
    "ranked_best_eligible",
  ]);
  const auto = deriveFromSelected(result.selected);
  assert.equal(auto.accepted, true);
  assert.deepEqual([...auto.reasons], [...CLASS_A_AUTO_REASONS]);
  const trust = evaluateTrustedBackWallWidthSpan(result.selected, S4A_SAFE);
  assert.equal(trust.trusted, true);
  assert.deepEqual([...trust.reasons], [
    "trusted_back_floor_wall_span_experimental",
  ]);
});

test("Test B: Room 4 formula lock is unchanged", () => {
  assert.equal(ROOM4_LIVE_AUTO, 3.6 / 9.582188);
  const auto = deriveAutoMetricScale({
    roomPrior: priorReceipt(),
    selected: selectIdentity([s4aCandidate({
      id: "rb_floor_back_wall_seam",
      sourceSeamId: "floor_back_wall_seam",
      worldGeometry: geometry(-4.791094, 0, 4.791094, 0),
    })]).selected,
    s4aSafety: S4A_SAFE,
    trustSelectedBackSpanAsFullWidth: true,
  });
  assert.equal(
    auto.canonicalSource?.gaugeLength,
    canonicalWorldSpanLength({ x: -4.791094, z: 0 }, { x: 4.791094, z: 0 }),
  );
  assert.ok(Math.abs(auto.canonicalSource!.gaugeLength - ROOM4_LIVE_CANONICAL_LENGTH) < 1e-6);
  assert.equal(auto.autoMetricScale, ROOM4_WIDTH_M / auto.canonicalSource!.gaugeLength);
  assert.ok(Math.abs(auto.autoMetricScale - 0.3757) < 0.0001);
  assert.deepEqual([...auto.reasons], [...CLASS_A_AUTO_REASONS]);
});

test("Test C: Class B OL fragment cannot replace S4A geometry or denominator", () => {
  const s4a = room2Back();
  const s4aLength = canonicalWorldSpanLength(
    { x: s4a.worldGeometry!.baseStart.x, z: s4a.worldGeometry!.baseStart.z },
    { x: s4a.worldGeometry!.baseEnd.x, z: s4a.worldGeometry!.baseEnd.z },
  );
  const ol = olCandidate({
    worldGeometry: geometry(-0.3, 0.04, 0.3, 0.04),
    imageA: { x: 0.18, y: 0.66 },
    imageB: { x: 0.31, y: 0.64 },
    matchedFraction: 0.99,
  });
  const olLength = canonicalWorldSpanLength(
    { x: ol.worldGeometry!.baseStart.x, z: ol.worldGeometry!.baseStart.z },
    { x: ol.worldGeometry!.baseEnd.x, z: ol.worldGeometry!.baseEnd.z },
  );
  assert.ok(olLength < s4aLength);
  const result = selectUncertified([s4a, room2LeftTruncated(), room2RightTruncated()], [ol]);
  assert.equal(result.selected?.source, "s4a_floor_wall");
  assert.equal(result.selected?.id, "rb_room2_back");
  assert.equal(result.selected?.canonicalLength, s4aLength);
  assert.notEqual(result.selected?.canonicalLength, olLength);
  assert.equal(result.selected?.imageA.x, ROOM2_BACK_IMAGE.a.x);
  assert.equal(result.selected?.imageB.x, ROOM2_BACK_IMAGE.b.x);
  assert.equal(result.selected?.spanTrust, "candidate");
  assert.equal(result.selected?.overlaySafeOnOriginal, false);
  const auto = deriveFromSelected(result.selected);
  assert.equal(auto.accepted, false);
  assert.equal(auto.autoMetricScale, AUTO_METRIC_SCALE);
  assert.ok(auto.reasons.includes("overlay_unsafe_on_original"));
  assert.ok(auto.reasons.includes("correspondence_not_identity_uv"));
});

test("Test D: unrelated higher-confidence OL cannot win over S4A back", () => {
  const s4a = room2Back();
  const unrelated = olCandidate({
    id: "olb_right_long",
    sourceObservationSeamId: "right_floor_wall",
    worldGeometry: geometry(2, 0.2, 2, 4.2),
    imageA: { x: 0.42, y: 0.40 },
    imageB: { x: 0.88, y: 0.82 },
    matchedFraction: 0.99,
  });
  const result = selectUncertified(
    [s4a, room2LeftTruncated(), room2RightTruncated()],
    [unrelated],
  );
  assert.equal(result.selected?.id, "rb_room2_back");
  assert.equal(result.selected?.source, "s4a_floor_wall");
  assert.equal(result.selected?.role, "back_floor_wall");
  assert.equal(result.selected?.correspondenceSource, "none");
  assert.equal(result.selected?.lineage.olCandidateId, null);
  assert.notEqual(result.selected?.id, unrelated.id);
});

test("Test E: OL interior cluster does not extrapolate endpoints or grant full-wall trust", () => {
  const s4a = room2Back();
  const interior = olCandidate({
    imageA: { x: 0.20, y: 0.66 },
    imageB: { x: 0.28, y: 0.65 },
    worldGeometry: geometry(-0.2, 0.02, 0.2, 0.02),
  });
  const result = selectUncertified([s4a], [interior]);
  assert.equal(result.selected?.canonicalWorldA.x, s4a.worldGeometry!.baseStart.x);
  assert.equal(result.selected?.canonicalWorldB.x, s4a.worldGeometry!.baseEnd.x);
  assert.equal(result.selected?.imageA.x, ROOM2_BACK_IMAGE.a.x);
  assert.equal(result.selected?.imageB.x, ROOM2_BACK_IMAGE.b.x);
  assert.notEqual(result.selected?.imageA.x, interior.originalImageEvidence.polyline[0]!.x);
  assert.equal(result.selected?.spanTrust, "candidate");
  assert.equal(result.selected?.overlaySafeOnOriginal, false);
  assert.equal(result.selected?.correspondenceSource, "original_localization");
  assert.ok(
    result.selected?.selectionReasons.includes("ol_same_seam_correspondence_incomplete"),
  );
  const auto = deriveFromSelected(result.selected);
  assert.equal(auto.autoMetricScale, 1);
  assert.equal(auto.accepted, false);
});

test("Test F: exact-grid identity UV stays trusted with the same overlay and Auto", () => {
  const result = selectIdentity([s4aCandidate()]);
  assert.equal(result.selected?.correspondenceSource, "identity_uv");
  assert.equal(result.selected?.spanTrust, "trusted");
  assert.equal(result.selected?.overlaySafeOnOriginal, true);
  assert.equal(metricCorrespondenceSpanLabel(result.selected!), METRIC_SPAN_TRUSTED_LABEL);
  assert.equal(
    metricCorrespondenceSpanHelperCopy(result.selected!),
    METRIC_SPAN_TRUSTED_HELPER_COPY,
  );
  const auto = deriveFromSelected(result.selected);
  assert.equal(auto.accepted, true);
  assert.deepEqual([...auto.reasons], [...CLASS_A_AUTO_REASONS]);
});

test("Test G: certified-rescaled registration keeps S4A gauge and Auto policy", () => {
  const s4a = s4aCandidate();
  const result = selectMetricCorrespondenceSpan({
    roomBoundary: s4aReceipt([s4a]),
    registration: { registrationClass: "certified_rescaled_registered" },
    originalLocalizedBoundary: {
      candidates: [olCandidate()],
      camera: { pose: CAMERA },
      lineage: { originalLocalizationClass: "certified_original_localized" },
    },
    originalLocalizationClass: "certified_original_localized",
  });
  assert.equal(result.selected?.source, "s4a_floor_wall");
  assert.equal(result.selected?.id, s4a.id);
  assert.equal(result.selected?.canonicalLength, 4);
  assert.equal(result.selected?.correspondenceSource, "identity_uv");
  assert.equal(result.selected?.overlaySafeOnOriginal, true);
  assert.equal(result.selected?.lineage.olCandidateId, null);
  const auto = deriveFromSelected(result.selected);
  assert.equal(auto.accepted, true);
  assert.deepEqual([...auto.reasons], [...CLASS_A_AUTO_REASONS]);
});

test("Test H: uncertified rescaled registration keeps S4A candidate and Auto = 1", () => {
  const result = selectUncertified([room2Back()], [], "insufficient", null);
  assert.equal(result.selected?.source, "s4a_floor_wall");
  assert.equal(result.selected?.spanTrust, "candidate");
  assert.equal(result.selected?.correspondenceSource, "none");
  assert.equal(result.selected?.overlaySafeOnOriginal, false);
  assert.equal(
    metricCorrespondenceSpanLabel(result.selected!),
    METRIC_SPAN_CANDIDATE_LABEL,
  );
  assert.equal(
    metricCorrespondenceSpanHelperCopy(result.selected!),
    METRIC_SPAN_CANDIDATE_HELPER_COPY,
  );
  const auto = deriveFromSelected(result.selected);
  assert.equal(auto.autoMetricScale, 1);
  assert.equal(auto.accepted, false);
});

test("Test I: frame-truncated side stays truncated; OL stub cannot erase truncation", () => {
  const left = room2LeftTruncated();
  const stub = olCandidate({
    id: "olb_left_stub",
    sourceObservationSeamId: "left_floor_wall",
    worldGeometry: geometry(-2, 1.0, -2, 1.8),
    imageA: { x: 0.06, y: 0.55 },
    imageB: { x: 0.07, y: 0.70 },
    matchedFraction: 0.98,
  });
  const result = selectUncertified([left], [stub]);
  assert.equal(result.selected, null);
  assert.equal(result.rejectedAlternatives[0]?.reason, "frame_truncated");
  assert.equal(result.rejectedAlternatives.some((item) => item.id === stub.id), false);
  const auto = deriveFromSelected(null);
  assert.equal(auto.autoMetricScale, 1);
});

test("Test J: hidden continuation and manufactured geometry stay rejected", () => {
  const hidden = selectIdentity([{
    ...s4aCandidate(),
    limitations: {
      ...s4aCandidate().limitations,
      hiddenContinuation: true,
    },
  } as unknown as RoomBoundaryCandidate]);
  assert.equal(hidden.selected, null);
  assert.equal(hidden.rejectedAlternatives[0]?.reason, "other");
  const manufactured = selectIdentity([{
    ...s4aCandidate(),
    limitations: {
      ...s4aCandidate().limitations,
      geometryManufactured: true,
    },
  } as unknown as RoomBoundaryCandidate]);
  assert.equal(manufactured.selected, null);
  assert.equal(manufactured.rejectedAlternatives[0]?.reason, "other");
});

test("Test K: lab trust off keeps trusted S4A display and Auto = 1", () => {
  const result = selectIdentity([s4aCandidate()]);
  assert.equal(result.selected?.spanTrust, "trusted");
  assert.equal(result.selected?.overlaySafeOnOriginal, true);
  const auto = deriveFromSelected(result.selected, false);
  assert.equal(auto.autoMetricScale, 1);
  assert.equal(auto.accepted, false);
  assert.ok(auto.reasons.includes("lab_trust_not_enabled"));
  assert.ok(auto.reasons.includes("completeness_not_certified"));
});

test("Test L: Reader, TILED, and providers stay out of metric consumption", () => {
  const selector = readV2("metric-correspondence-span.ts");
  const contract = readV2("metric-correspondence-span-contract.ts");
  const autoSource = readV2("metric-auto-scale.ts");
  const analysis = readV2("afc-v2-analysis.server.ts");
  for (const source of [selector, contract]) {
    assert.doesNotMatch(source, /readTiledPerspective/);
    assert.doesNotMatch(source, /afc-sr1-tiled-artifact-cache/);
    assert.doesNotMatch(source, /estimateMetricCorrespondenceSpan/);
    assert.doesNotMatch(source, /observeRoom/);
    assert.doesNotMatch(source, /gemini|Gemini/);
    assert.doesNotMatch(source, /autoMetricScale/);
  }
  assert.doesNotMatch(selector, /source: "ol_floor_wall"/);
  assert.match(selector, /ol_same_seam_correspondence_incomplete/);
  assert.doesNotMatch(autoSource, /original_localization" ===/);
  assert.match(analysis, /metricCorrespondenceEstimate: null/);
  assert.doesNotMatch(analysis, /estimateMetricCorrespondenceSpan/);
  const selectCount = analysis.split("selectMetricCorrespondenceSpan").length - 1;
  assert.ok(selectCount >= 1);
});

test("Room 2-class fixture keeps back S4A as canonical candidate", () => {
  const result = selectUncertified(
    [room2Back(), room2LeftTruncated(), room2RightTruncated()],
    [olCandidate({
      imageA: { x: 0.16, y: 0.67 },
      imageB: { x: 0.29, y: 0.64 },
    })],
  );
  assert.equal(result.selected?.role, "back_floor_wall");
  assert.equal(result.selected?.source, "s4a_floor_wall");
  assert.equal(result.selected?.canonicalLength, 4);
  assert.equal(result.rejectedAlternatives.some((item) =>
    item.id === "rb_room2_left" && item.reason === "frame_truncated"
  ), true);
  assert.equal(result.rejectedAlternatives.some((item) =>
    item.id === "rb_room2_right" && item.reason === "frame_truncated"
  ), true);
});

test("Room 3 live metric receipt is still unavailable; aspect-rescaled stays fail-closed", () => {
  const generic = selectUncertified([s4aCandidate()], [olCandidate()]);
  assert.equal(generic.selected?.spanTrust, "candidate");
  assert.equal(deriveFromSelected(generic.selected).autoMetricScale, 1);
  const combined = readdirSync(V2_DIRECTORY).join("\n");
  assert.doesNotMatch(combined, /room-3-live-metric-receipt|ROOM3_LIVE_CANONICAL/);
});

test("UI distinguishes trusted vs candidate metric span and does not imply OL geometry", () => {
  const overlay = readV2("RoomEvidenceOverlay.tsx");
  const roomLab = readV2("RoomLabV2.tsx");
  assert.match(overlay, /metricCorrespondenceSpanLabel/);
  assert.match(overlay, /data-span-trust/);
  assert.match(roomLab, /METRIC_SPAN_TRUSTED_LABEL|metricCorrespondenceSpanLabel/);
  assert.match(roomLab, /metricCorrespondenceSpanHelperCopy/);
  assert.equal(METRIC_SPAN_TRUSTED_LABEL, "Trusted Metric Span");
  assert.equal(METRIC_SPAN_CANDIDATE_LABEL, "Candidate Metric Span");
  assert.equal(
    METRIC_SPAN_TRUSTED_HELPER_COPY,
    "Trusted room span used for automatic metric scale when enabled.",
  );
  assert.equal(
    METRIC_SPAN_CANDIDATE_HELPER_COPY,
    "Detected room span available for metric correspondence, but not trusted for automatic scale.",
  );
  assert.match(roomLab, /overlaySafeOnOriginal/);
  assert.doesNotMatch(overlay, /ol_floor_wall/);
});

test("V1 is untouched by M1 metric authority split", () => {
  const v1Runtime = readdirSync(V1_DIRECTORY)
    .filter((name) => /\.(?:ts|tsx)$/.test(name))
    .map((name) => readFileSync(path.join(V1_DIRECTORY, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(v1Runtime, /spanTrust/);
  assert.doesNotMatch(v1Runtime, /correspondenceSource/);
  assert.doesNotMatch(v1Runtime, /METRIC_SPAN_TRUSTED_LABEL/);
  assert.doesNotMatch(v1Runtime, /selectMetricCorrespondenceSpan/);
});
