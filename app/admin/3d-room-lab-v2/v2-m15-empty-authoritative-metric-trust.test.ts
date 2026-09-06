import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  deriveAutoMetricScale,
  evaluateTrustedBackWallWidthSpan,
} from "./metric-auto-scale";
import {
  AUTO_METRIC_SCALE_SANITY_MAX,
  deriveUniformMetricScaleFromPhysicalSpan,
  type AutoMetricS4aSafetyEvidence,
} from "./metric-auto-scale-contract";
import {
  METRIC_SPAN_OVERLAY_UNVERIFIED_HELPER_COPY,
  METRIC_SPAN_OVERLAY_UNVERIFIED_LABEL,
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
import { AUTO_METRIC_SCALE } from "./scene-metric-world-realization";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const V1_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab");
const ROOM4_LIVE_CANONICAL_LENGTH = 9.582188;
const ROOM4_WIDTH_M = 3.6;
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

function priorReceipt(overrides: Record<string, unknown> = {}) {
  const parsed = parseMetricRoomPriorModelEstimate({
    observability: "recoverable",
    estimatedRoomDepthM: { low: 4.2, best: 4.5, high: 4.8 },
    estimatedRoomWidthM: { low: 3.3, best: ROOM4_WIDTH_M, high: 3.9 },
    estimatedCeilingHeightM: 2.7,
    modelConfidence: 0.8,
    limitations: [],
    notes: null,
    ...overrides,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("metric prior parse failed");
  return buildMetricRoomPriorReceipt({
    sourceImageHash: "a".repeat(64),
    originalAncestorSha256: "a".repeat(64),
    attemptId: "v2-m15",
    loadGeneration: 1,
    provider: "controlled_fixture",
    model: "fixture",
  }, parsed.estimate, acceptMetricRoomPrior(parsed.estimate), null);
}

function deriveFromSelected(
  selected: ReturnType<typeof selectIdentity>["selected"],
  trust = true,
  roomPrior: ReturnType<typeof priorReceipt> | null = priorReceipt(),
  s4aSafety: AutoMetricS4aSafetyEvidence | null = S4A_SAFE,
) {
  return deriveAutoMetricScale({
    roomPrior,
    selected,
    s4aSafety,
    trustSelectedBackSpanAsFullWidth: trust,
  });
}

test("Test A: exact-grid Class A seam, gauge, overlay, scale, and reasons are unchanged", () => {
  const back = s4aCandidate();
  const result = selectIdentity([back]);
  assert.equal(result.selected?.id, "rb_back_floor_wall");
  assert.equal(result.selected?.source, "s4a_floor_wall");
  assert.equal(result.selected?.role, "back_floor_wall");
  assert.equal(result.selected?.canonicalLength, 4);
  assert.equal(result.selected?.correspondenceSource, "identity_uv");
  assert.equal(result.selected?.overlaySafeOnOriginal, true);
  assert.equal(result.selected?.spanTrust, "trusted");
  assert.equal(result.selected?.lineage.olCandidateId, null);
  assert.deepEqual([...result.selectionReasons], [
    "accepted_s4a_floor_wall",
    "identity_certified_original_overlay",
    "role_back_floor_wall",
    "ranked_best_eligible",
  ]);
  assert.equal(metricCorrespondenceSpanLabel(result.selected!), METRIC_SPAN_TRUSTED_LABEL);
  assert.equal(
    metricCorrespondenceSpanHelperCopy(result.selected!),
    METRIC_SPAN_TRUSTED_HELPER_COPY,
  );
  const auto = deriveFromSelected(result.selected);
  assert.equal(auto.accepted, true);
  assert.equal(auto.autoMetricScale, ROOM4_WIDTH_M / 4);
  assert.deepEqual([...auto.reasons], [...CLASS_A_AUTO_REASONS]);
  const trust = evaluateTrustedBackWallWidthSpan(result.selected, S4A_SAFE);
  assert.equal(trust.trusted, true);
  assert.equal(trust.reasons.includes("correspondence_not_identity_uv"), false);
  assert.equal(trust.reasons.includes("overlay_unsafe_on_original"), false);
});

test("Test B: Room 4 formula lock remains 3.6 / 9.582188", () => {
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
  assert.ok(Math.abs(auto.canonicalSource!.gaugeLength - ROOM4_LIVE_CANONICAL_LENGTH) < 1e-6);
  assert.equal(auto.autoMetricScale, ROOM4_WIDTH_M / auto.canonicalSource!.gaugeLength);
  assert.equal(auto.autoMetricScale, 3.6 / 9.582188);
  assert.ok(Math.abs(auto.autoMetricScale - 0.3757) < 0.0001);
  assert.deepEqual([...auto.reasons], [...CLASS_A_AUTO_REASONS]);
});

test("Test C: Room 2-class qualified S4A back Autoes without identity correspondence", () => {
  const s4a = room2Back();
  const s4aLength = canonicalWorldSpanLength(
    { x: s4a.worldGeometry!.baseStart.x, z: s4a.worldGeometry!.baseStart.z },
    { x: s4a.worldGeometry!.baseEnd.x, z: s4a.worldGeometry!.baseEnd.z },
  );
  const result = selectUncertified(
    [s4a, room2LeftTruncated(), room2RightTruncated()],
    [],
    "rejected",
    null,
  );
  assert.equal(result.selected?.source, "s4a_floor_wall");
  assert.equal(result.selected?.id, "rb_room2_back");
  assert.equal(result.selected?.canonicalLength, s4aLength);
  assert.equal(result.selected?.spanTrust, "trusted");
  assert.equal(result.selected?.overlaySafeOnOriginal, false);
  assert.equal(result.selected?.correspondenceSource, "none");
  assert.equal(metricCorrespondenceSpanLabel(result.selected!), METRIC_SPAN_TRUSTED_LABEL);
  const auto = deriveFromSelected(result.selected);
  assert.equal(auto.accepted, true);
  assert.equal(auto.autoMetricScale, ROOM4_WIDTH_M / s4aLength);
  assert.equal(auto.canonicalSource?.kind, "back_floor_wall_span");
  assert.equal(auto.canonicalSource?.gaugeLength, s4aLength);
  assert.equal(auto.reasons.includes("correspondence_not_identity_uv"), false);
  assert.equal(auto.reasons.includes("overlay_unsafe_on_original"), false);
  assert.deepEqual([...auto.reasons], [...CLASS_A_AUTO_REASONS]);
});

test("Test D: certified same-seam OL cannot change S4A canonicalLength or Auto", () => {
  const s4a = room2Back();
  const withoutOl = selectUncertified(
    [s4a, room2LeftTruncated(), room2RightTruncated()],
    [],
    "rejected",
    null,
  );
  const withOl = selectUncertified(
    [s4a, room2LeftTruncated(), room2RightTruncated()],
    [olCandidate({
      worldGeometry: geometry(-0.3, 0.04, 0.3, 0.04),
      imageA: { x: 0.18, y: 0.66 },
      imageB: { x: 0.31, y: 0.64 },
      matchedFraction: 0.99,
    })],
  );
  assert.equal(withOl.selected?.canonicalLength, withoutOl.selected?.canonicalLength);
  assert.equal(withOl.selected?.source, "s4a_floor_wall");
  assert.equal(withOl.selected?.correspondenceSource, "original_localization");
  assert.equal(withOl.selected?.overlaySafeOnOriginal, false);
  assert.equal(withOl.selected?.spanTrust, "trusted");
  const autoWithout = deriveFromSelected(withoutOl.selected);
  const autoWith = deriveFromSelected(withOl.selected);
  assert.equal(autoWith.autoMetricScale, autoWithout.autoMetricScale);
  assert.equal(autoWith.canonicalSource?.gaugeLength, autoWithout.canonicalSource?.gaugeLength);
  assert.notEqual(autoWith.canonicalSource?.gaugeLength, 0.6);
});

test("Test E: Room 2-class lab trust OFF keeps Auto = 1", () => {
  const result = selectUncertified([room2Back()], [], "insufficient", null);
  assert.equal(result.selected?.spanTrust, "trusted");
  const auto = deriveFromSelected(result.selected, false);
  assert.equal(auto.accepted, false);
  assert.equal(auto.autoMetricScale, AUTO_METRIC_SCALE);
  assert.ok(auto.reasons.includes("lab_trust_not_enabled"));
  assert.ok(auto.reasons.includes("completeness_not_certified"));
});

test("Test F: truncated back stays Auto = 1", () => {
  const truncated = selectUncertified([s4aCandidate({
    frameAdjacentEndpoint: true,
    imageA: { x: 0.01, y: 0.62 },
    imageB: { x: 0.7, y: 0.62 },
  })]);
  assert.equal(truncated.selected, null);
  assert.equal(truncated.rejectedAlternatives[0]?.reason, "frame_truncated");
  const auto = deriveFromSelected(null);
  assert.equal(auto.autoMetricScale, 1);
  const selected = selectIdentity([s4aCandidate()]).selected!;
  const truncatedConstructed = deriveAutoMetricScale({
    roomPrior: priorReceipt(),
    selected: {
      ...selected,
      truncation: "one_end",
      endpointAClass: "frame_adjacent",
    },
    s4aSafety: S4A_SAFE,
    trustSelectedBackSpanAsFullWidth: true,
  });
  assert.equal(truncatedConstructed.accepted, false);
  assert.equal(truncatedConstructed.autoMetricScale, 1);
  assert.ok(truncatedConstructed.reasons.includes("span_truncated"));
});

test("Test G: hidden continuation and manufactured geometry stay Auto = 1", () => {
  const hiddenSelected = selectIdentity([{
    ...s4aCandidate(),
    limitations: {
      ...s4aCandidate().limitations,
      hiddenContinuation: true,
    },
  } as unknown as RoomBoundaryCandidate]);
  assert.equal(hiddenSelected.selected, null);
  const manufacturedSelected = selectIdentity([{
    ...s4aCandidate(),
    limitations: {
      ...s4aCandidate().limitations,
      geometryManufactured: true,
    },
  } as unknown as RoomBoundaryCandidate]);
  assert.equal(manufacturedSelected.selected, null);
  const hiddenAuto = deriveFromSelected(
    selectIdentity([s4aCandidate()]).selected,
    true,
    priorReceipt(),
    {
      observedSpanOnly: true,
      hiddenContinuation: true,
      geometryManufactured: false,
    },
  );
  assert.equal(hiddenAuto.autoMetricScale, 1);
  assert.ok(hiddenAuto.reasons.includes("s4a_hidden_continuation"));
  const manufacturedAuto = deriveFromSelected(
    selectIdentity([s4aCandidate()]).selected,
    true,
    priorReceipt(),
    {
      observedSpanOnly: true,
      hiddenContinuation: false,
      geometryManufactured: true,
    },
  );
  assert.equal(manufacturedAuto.autoMetricScale, 1);
  assert.ok(manufacturedAuto.reasons.includes("s4a_geometry_manufactured"));
});

test("Test H: invalid / rejected room prior stays Auto = 1", () => {
  const selected = selectUncertified([room2Back()]).selected;
  const missing = deriveFromSelected(selected, true, null);
  assert.equal(missing.autoMetricScale, 1);
  const weak = deriveFromSelected(
    selected,
    true,
    priorReceipt({ modelConfidence: 0.2 }),
  );
  assert.equal(weak.accepted, false);
  assert.equal(weak.autoMetricScale, 1);
  assert.ok(weak.reasons.includes("room_prior_not_accepted"));
});

test("Test I: out-of-range scale falls back to Auto = 1 and is not clamped", () => {
  const huge = deriveUniformMetricScaleFromPhysicalSpan(0.2, 30);
  assert.ok(huge !== null && huge > AUTO_METRIC_SCALE_SANITY_MAX);
  const selected = selectIdentity([s4aCandidate({
    worldGeometry: geometry(-0.1, 0, 0.1, 0),
  })]).selected;
  const receipt = deriveFromSelected(selected);
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.autoMetricScale, 1);
  assert.notEqual(receipt.autoMetricScale, AUTO_METRIC_SCALE_SANITY_MAX);
  assert.ok(receipt.reasons.includes("candidate_outside_catastrophic_sanity_bounds"));
});

test("Test J: metric-trusted Class B does not draw cyan ORIGINAL overlay", () => {
  const result = selectUncertified([room2Back()], [], "rejected", null);
  assert.equal(result.selected?.spanTrust, "trusted");
  assert.equal(result.selected?.overlaySafeOnOriginal, false);
  const overlay = readV2("RoomEvidenceOverlay.tsx");
  const roomLab = readV2("RoomLabV2.tsx");
  assert.match(
    overlay,
    /metricCorrespondenceSpan\.overlaySafeOnOriginal \? \(/,
  );
  assert.match(
    roomLab,
    /pipeline\?\.metricCorrespondence\?\.selected\s*\?\.overlaySafeOnOriginal/,
  );
  assert.match(roomLab, /METRIC_SPAN_OVERLAY_UNVERIFIED_LABEL/);
  assert.match(roomLab, /METRIC_SPAN_OVERLAY_UNVERIFIED_HELPER_COPY/);
  assert.equal(METRIC_SPAN_OVERLAY_UNVERIFIED_LABEL, "Original overlay not verified");
  assert.equal(
    METRIC_SPAN_OVERLAY_UNVERIFIED_HELPER_COPY,
    "Scale is based on the reconstructed empty room; the original photo does not have a verified matching overlay.",
  );
});

test("Test K: certified-rescaled still Autoes with overlay remaining on", () => {
  const result = selectMetricCorrespondenceSpan({
    roomBoundary: s4aReceipt([s4aCandidate()]),
    registration: { registrationClass: "certified_rescaled_registered" },
    originalLocalizedBoundary: {
      candidates: [olCandidate()],
      camera: { pose: CAMERA },
      lineage: { originalLocalizationClass: "certified_original_localized" },
    },
    originalLocalizationClass: "certified_original_localized",
  });
  assert.equal(result.selected?.correspondenceSource, "identity_uv");
  assert.equal(result.selected?.overlaySafeOnOriginal, true);
  assert.equal(result.selected?.spanTrust, "trusted");
  assert.equal(result.selected?.canonicalLength, 4);
  assert.equal(result.selected?.lineage.olCandidateId, null);
  const auto = deriveFromSelected(result.selected);
  assert.equal(auto.accepted, true);
  assert.deepEqual([...auto.reasons], [...CLASS_A_AUTO_REASONS]);
});

test("Test L: M1.5 adds no provider calls and leaves UX-3b1 null", () => {
  const selector = readV2("metric-correspondence-span.ts");
  const autoSource = readV2("metric-auto-scale.ts");
  const analysis = readV2("afc-v2-analysis.server.ts");
  const estimate = readV2("metric-correspondence-estimate.server.ts");
  for (const source of [selector, autoSource]) {
    assert.doesNotMatch(source, /readTiledPerspective/);
    assert.doesNotMatch(source, /observeRoom/);
    assert.doesNotMatch(source, /estimateMetricCorrespondenceSpan/);
  }
  assert.doesNotMatch(autoSource, /correspondenceSource !== "identity_uv"/);
  assert.doesNotMatch(autoSource, /overlaySafeOnOriginal !== true/);
  assert.doesNotMatch(autoSource, /correspondence_not_identity_uv/);
  assert.doesNotMatch(autoSource, /overlay_unsafe_on_original/);
  assert.match(analysis, /metricCorrespondenceEstimate: null/);
  assert.doesNotMatch(analysis, /estimateMetricCorrespondenceSpan/);
  assert.match(estimate, /overlaySafeOnOriginal/);
});

test("Test M: V1 is untouched by EMPTY-authoritative metric trust", () => {
  const v1Runtime = readdirSync(V1_DIRECTORY)
    .filter((name) => /\.(?:ts|tsx)$/.test(name))
    .map((name) => readFileSync(path.join(V1_DIRECTORY, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(v1Runtime, /spanTrust/);
  assert.doesNotMatch(v1Runtime, /correspondenceSource/);
  assert.doesNotMatch(v1Runtime, /METRIC_SPAN_OVERLAY_UNVERIFIED/);
  assert.doesNotMatch(v1Runtime, /selectMetricCorrespondenceSpan/);
  assert.doesNotMatch(v1Runtime, /evaluateTrustedBackWallWidthSpan/);
});

test("fail-closed: side span, other_floor_wall, rejected S4A, competing backs, missing span", () => {
  const side = selectIdentity([s4aCandidate({
    id: "rb_left_floor_wall",
    sourceSeamId: "left_floor_wall",
    worldGeometry: geometry(-2, 0.2, -2, 3.2),
    imageA: { x: 0.12, y: 0.35 },
    imageB: { x: 0.18, y: 0.82 },
  })]);
  assert.equal(side.selected?.role, "left_floor_wall");
  assert.equal(side.selected?.spanTrust, "candidate");
  const sideAuto = deriveFromSelected(side.selected);
  assert.equal(sideAuto.autoMetricScale, 1);
  assert.ok(sideAuto.reasons.includes("role_not_back_floor_wall"));

  const other = deriveFromSelected({
    ...selectIdentity([s4aCandidate()]).selected!,
    role: "other_floor_wall",
  });
  assert.equal(other.autoMetricScale, 1);
  assert.ok(other.reasons.includes("role_not_back_floor_wall"));

  const rejected = selectUncertified([s4aCandidate({ status: "rejected" })]);
  assert.equal(rejected.selected, null);
  assert.equal(deriveFromSelected(null).autoMetricScale, 1);

  const competing = selectUncertified([
    s4aCandidate({
      id: "rb_back_a",
      sourceSeamId: "back_a",
      worldGeometry: geometry(-2, 0, 2, 0),
    }),
    s4aCandidate({
      id: "rb_back_b",
      sourceSeamId: "back_b",
      worldGeometry: geometry(-1.5, 0, 1.5, 0),
    }),
  ]);
  assert.equal(competing.selected, null);
  assert.ok(competing.rejectedAlternatives.every((item) =>
    item.reason === "ambiguous_competing_trace"
  ));
  assert.equal(deriveFromSelected(null).reasons.includes("selected_span_missing"), true);
});

test("correspondence cannot rescue invalid EMPTY geometry", () => {
  const identityTruncated = selectIdentity([s4aCandidate({
    frameAdjacentEndpoint: true,
    imageA: { x: 0.01, y: 0.62 },
  })]);
  assert.equal(identityTruncated.selected, null);
  const identityHidden = selectIdentity([{
    ...s4aCandidate(),
    limitations: {
      ...s4aCandidate().limitations,
      hiddenContinuation: true,
    },
  } as unknown as RoomBoundaryCandidate]);
  assert.equal(identityHidden.selected, null);
  const olSource = deriveFromSelected({
    ...selectIdentity([s4aCandidate()]).selected!,
    source: "ol_floor_wall",
    correspondenceSource: "identity_uv",
    overlaySafeOnOriginal: true,
    spanTrust: "trusted",
  });
  assert.equal(olSource.autoMetricScale, 1);
  assert.ok(olSource.reasons.includes("source_not_s4a_floor_wall"));
});
