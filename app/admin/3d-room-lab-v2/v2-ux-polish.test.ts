import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  deriveAutoMetricScale,
  evaluateTrustedBackWallWidthSpan,
} from "./metric-auto-scale";
import {
  AUTO_METRIC_LAB_TRUST_LABEL,
} from "./metric-auto-scale-contract";
import { acceptMetricRoomPrior } from "./metric-room-prior-acceptance";
import {
  buildMetricRoomPriorReceipt,
  parseMetricRoomPriorModelEstimate,
} from "./metric-room-prior-contract";
import {
  METRIC_CORRESPONDENCE_EMPTY_IMAGE_SPACE,
  METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE,
  METRIC_SPAN_TRUSTED_LABEL,
  type MetricCorrespondenceSpan,
} from "./metric-correspondence-span-contract";
import {
  defaultTrustSelectedBackSpanAsFullWidth,
  emptyImageEndpointsFromS4aCandidate,
  labCompatibilityTierForTrustDefault,
  METRIC_SPAN_EMPTY_OVERLAY_IMAGE_SPACE,
} from "./metric-lab-ux";
import type { RoomBoundaryCandidate } from "./room-boundary-authority-contract";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const V1_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab");
const ROOM4_LIVE_CANONICAL_LENGTH = 9.582188;
const ROOM4_WIDTH_M = 3.6;

function readV2(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
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
    attemptId: "v2-ux-polish",
    loadGeneration: 1,
    provider: "controlled_fixture",
    model: "fixture",
  }, parsed.estimate, acceptMetricRoomPrior(parsed.estimate), null);
}

function backSpan(
  overrides: Partial<MetricCorrespondenceSpan> = {},
): MetricCorrespondenceSpan {
  return {
    id: "rb_floor_back_wall_seam",
    source: "s4a_floor_wall",
    correspondenceSource: "identity_uv",
    spanTrust: "trusted",
    role: "back_floor_wall",
    imageSpace: METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE,
    overlaySafeOnOriginal: true,
    imageA: { x: 0.2, y: 0.62 },
    imageB: { x: 0.8, y: 0.62 },
    canonicalWorldA: { x: -4.791094, z: 0 },
    canonicalWorldB: { x: 4.791094, z: 0 },
    canonicalLength: ROOM4_LIVE_CANONICAL_LENGTH,
    endpointAClass: "observed_interior",
    endpointBClass: "observed_interior",
    truncation: "none",
    imageLengthNormalized: 0.6,
    confidence: 0.9,
    selectionReasons: Object.freeze(["accepted_s4a_floor_wall"]),
    lineage: {
      s4aCandidateId: "rb_floor_back_wall_seam",
      sourceSeamId: "back_floor_wall",
      registrationClass: "exact_grid_registered",
      olCandidateId: null,
    },
    ...overrides,
  };
}

function s4aLike(overrides: {
  polyline?: readonly { x: number; y: number }[];
  emptyA?: { x: number; y: number };
  emptyB?: { x: number; y: number };
  originalA?: { x: number; y: number };
  originalB?: { x: number; y: number };
} = {}): RoomBoundaryCandidate {
  const imageA = overrides.polyline?.[0] ?? { x: 0.21, y: 0.63 };
  const imageB = overrides.polyline?.[1] ?? { x: 0.79, y: 0.63 };
  const emptyA = overrides.emptyA ?? imageA;
  const emptyB = overrides.emptyB ?? imageB;
  const originalA = overrides.originalA ?? { x: 0.2, y: 0.62 };
  const originalB = overrides.originalB ?? { x: 0.8, y: 0.62 };
  return {
    id: "rb_floor_back_wall_seam",
    sourceSeamId: "back_floor_wall",
    status: "accepted",
    source: {
      category: "floor_wall",
      observationSource: "general_empty_observer",
      imageBasis: "EMPTY",
      planeIds: ["visible_floor", "visible_wall"],
      floorPlaneId: "visible_floor",
      wallPlaneId: "visible_wall",
      confidence: 0.9,
      ambiguity: null,
    },
    imageEvidence: {
      polyline: overrides.polyline ?? [imageA, imageB],
      occupancy: null,
      frontier: null,
      lineResidual: null,
      lineResidualClass: "supported",
      nearVertical: false,
    },
    projection: {
      kernelVersion: "afc-v2-room-boundary-projection/v1",
      points: [
        {
          ok: true as const,
          emptySourceNormalized: emptyA,
          originalSourceNormalized: originalA,
          containerNormalized: originalA,
          world: { x: -2, y: 0, z: 0 },
        },
        {
          ok: true as const,
          emptySourceNormalized: emptyB,
          originalSourceNormalized: originalB,
          containerNormalized: originalB,
          world: { x: 2, y: 0, z: 0 },
        },
      ],
      worldSamples: [{ x: -2, z: 0 }, { x: 2, z: 0 }],
      worldResidual: null,
    },
    worldGeometry: null,
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
      frameAdjacentEndpoint: false,
      geometryManufactured: false,
    },
    reasons: [],
  } as RoomBoundaryCandidate;
}

test("exact_grid eligible initial trust default is checked", () => {
  assert.equal(
    defaultTrustSelectedBackSpanAsFullWidth("exact_grid_compatible"),
    true,
  );
  assert.equal(
    labCompatibilityTierForTrustDefault({
      oldCompatibilityTier: "exact_grid_compatible",
    }),
    "exact_grid_compatible",
  );
  const roomLab = readV2("RoomLabV2.tsx");
  const ux = readV2("metric-lab-ux.ts");
  assert.match(roomLab, /trustSelectedBackSpanUserOverride \?\?/);
  assert.match(roomLab, /defaultTrustSelectedBackSpanAsFullWidth/);
  assert.match(ux, /compatibilityTier === "exact_grid_compatible"/);
  assert.equal(AUTO_METRIC_LAB_TRUST_LABEL, "Trust selected back span as full width");
});

test("exact_grid user uncheck is sticky; Analyze does not re-force ON", () => {
  const roomLab = readV2("RoomLabV2.tsx");
  assert.match(
    roomLab,
    /setTrustSelectedBackSpanUserOverride\(event\.target\.checked\)/,
  );
  assert.match(roomLab, /setTrustSelectedBackSpanUserOverride\(null\)/);
  const prepareIndex = roomLab.indexOf("async function prepareOriginal");
  const analyzeIndex = roomLab.indexOf("async function analyzeAndApply");
  const afterAnalyze = roomLab.indexOf("\n  async function ", analyzeIndex + 1);
  assert.ok(prepareIndex > 0 && analyzeIndex > prepareIndex);
  assert.match(
    roomLab.slice(prepareIndex, analyzeIndex),
    /setTrustSelectedBackSpanUserOverride\(null\)/,
  );
  assert.doesNotMatch(
    roomLab.slice(analyzeIndex, afterAnalyze > 0 ? afterAnalyze : analyzeIndex + 12000),
    /setTrustSelectedBackSpanUserOverride/,
  );
  assert.equal(
    (roomLab.match(/setTrustSelectedBackSpanUserOverride\(null\)/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(roomLab, /useEffect\([\s\S]{0,400}setTrustSelectedBackSpanUserOverride\(true\)/);
});

test("aspect_compatible_rescaled initial trust default is unchecked", () => {
  assert.equal(
    defaultTrustSelectedBackSpanAsFullWidth("aspect_compatible_rescaled"),
    false,
  );
  assert.equal(defaultTrustSelectedBackSpanAsFullWidth("incompatible"), false);
  assert.equal(defaultTrustSelectedBackSpanAsFullWidth(null), false);
  assert.equal(defaultTrustSelectedBackSpanAsFullWidth(undefined), false);
});

test("exact_grid checked default does not manufacture Path A Auto", () => {
  const truncated = deriveAutoMetricScale({
    roomPrior: priorReceipt() as never,
    selected: backSpan({
      truncation: "one_end",
      endpointAClass: "frame_adjacent",
    }),
    s4aSafety: {
      observedSpanOnly: true,
      hiddenContinuation: false,
      geometryManufactured: false,
    },
    trustSelectedBackSpanAsFullWidth: true,
  });
  assert.equal(truncated.accepted, false);
  assert.equal(truncated.autoMetricScale, 1);
  assert.ok(truncated.reasons.includes("span_truncated"));
  const missing = deriveAutoMetricScale({
    roomPrior: priorReceipt() as never,
    selected: null,
    s4aSafety: null,
    trustSelectedBackSpanAsFullWidth: true,
  });
  assert.equal(missing.accepted, false);
  assert.equal(missing.autoMetricScale, 1);
  const complete = evaluateTrustedBackWallWidthSpan(backSpan(), {
    observedSpanOnly: true,
    hiddenContinuation: false,
    geometryManufactured: false,
  });
  assert.equal(complete.trusted, true);
});

test("Path A Trusted Metric Span renders on EMPTY, not ORIGINAL", () => {
  const overlay = readV2("RoomEvidenceOverlay.tsx");
  const roomLab = readV2("RoomLabV2.tsx");
  assert.match(
    overlay,
    /overlaySpace === "empty" &&[\s\S]*metricCorrespondenceSpan &&[\s\S]*metricCorrespondenceEmptyImage/,
  );
  assert.match(overlay, /data-image-space=\{METRIC_SPAN_EMPTY_OVERLAY_IMAGE_SPACE\}/);
  assert.match(overlay, /x1=\{metricCorrespondenceEmptyImage\.imageA\.x\}/);
  assert.doesNotMatch(
    overlay,
    /overlaySpace === "original" &&[\s\S]{0,80}metricCorrespondenceSpan/,
  );
  assert.match(
    roomLab,
    /selectedRepresentation === "EMPTY"[\s\S]*metricCorrespondence\?\.selected/,
  );
  assert.doesNotMatch(
    roomLab,
    /selectedRepresentation === "ORIGINAL" &&[\s\S]{0,120}metricCorrespondence/,
  );
  assert.equal(METRIC_SPAN_EMPTY_OVERLAY_IMAGE_SPACE, METRIC_CORRESPONDENCE_EMPTY_IMAGE_SPACE);
  assert.equal(METRIC_SPAN_TRUSTED_LABEL, "Trusted Metric Span");
});

test("Path A overlay A/B are EMPTY endpoints; correspondence imageA/B stay ORIGINAL", () => {
  const candidate = s4aLike({
    polyline: [{ x: 0.21, y: 0.63 }, { x: 0.79, y: 0.63 }],
    originalA: { x: 0.2, y: 0.62 },
    originalB: { x: 0.8, y: 0.62 },
  });
  const empty = emptyImageEndpointsFromS4aCandidate(candidate);
  assert.deepEqual(empty, {
    imageA: { x: 0.21, y: 0.63 },
    imageB: { x: 0.79, y: 0.63 },
  });
  assert.notDeepEqual(empty?.imageA, { x: 0.2, y: 0.62 });
  const selector = readV2("metric-correspondence-span.ts");
  assert.match(selector, /originalSourceNormalized/);
  assert.match(selector, /imageSpace: METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE/);
  const span = backSpan();
  assert.equal(span.imageSpace, METRIC_CORRESPONDENCE_ORIGINAL_IMAGE_SPACE);
  assert.deepEqual(span.imageA, { x: 0.2, y: 0.62 });
  assert.deepEqual(span.imageB, { x: 0.8, y: 0.62 });
});

test("M2 Estimated Metric Span still renders on EMPTY; ORIGINAL registration stays on EMPTY correspondences", () => {
  const overlay = readV2("RoomEvidenceOverlay.tsx");
  const roomLab = readV2("RoomLabV2.tsx");
  assert.match(overlay, /overlaySpace === "empty" && observedSpanMetricCandidate/);
  assert.match(overlay, /data-evidence-role="observed-span-metric-segment"/);
  assert.match(
    roomLab,
    /selectedRepresentation === "EMPTY"[\s\S]*observedSpanMetricSelection\?\.selected/,
  );
  assert.match(
    roomLab,
    /selectedRepresentation === "EMPTY"[\s\S]*emptyOriginalRegistration\?\.correspondences/,
  );
  assert.match(
    overlay,
    /overlaySpace === "original" && originalLocalizationStructures/,
  );
  assert.doesNotMatch(overlay, /ol_floor_wall/);
});

test("UX polish does not add providers or touch Path A / M2 selectors", () => {
  const ux = readV2("metric-lab-ux.ts");
  const roomLab = readV2("RoomLabV2.tsx");
  const overlay = readV2("RoomEvidenceOverlay.tsx");
  for (const source of [ux, roomLab, overlay]) {
    assert.doesNotMatch(source, /observeRoom\(/);
    assert.doesNotMatch(source, /estimateObservedSpanPhysical/);
    assert.doesNotMatch(source, /estimateMetricCorrespondenceSpan/);
    assert.doesNotMatch(source, /observeFocusedSideFloorWall/);
  }
  assert.doesNotMatch(ux, /selectMetricCorrespondenceSpan/);
  assert.doesNotMatch(ux, /isMetricSafeProjectedFloorWall/);
  assert.doesNotMatch(ux, /experimentalTrust/);
  const v1 = readFileSync(
    path.join(V1_DIRECTORY, "afc-sr1-tiled-live-product.ts"),
    "utf8",
  );
  assert.doesNotMatch(v1, /defaultTrustSelectedBackSpanAsFullWidth/);
  assert.doesNotMatch(v1, /emptyImageEndpointsFromS4aCandidate/);
});
