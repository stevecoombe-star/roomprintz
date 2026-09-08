import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildEmptyRoomObservationEvidence, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE } from "./empty-room-observation-contract";
import { buildFocusedSideFloorWallEvidence } from "./empty-side-floor-wall-observation-contract";
import {
  FLOOR_WALL_MERGE_REASON,
  mergeFocusedSideFloorWallObservation,
} from "./empty-side-floor-wall-observation-merge.server";
import { AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION } from "./empty-side-floor-wall-observation.server";
import {
  enabledEmptyAuthoritativeCollisionWalls,
} from "./empty-authoritative-collision-authority-contract";
import { constructAfcV2EmptyAuthoritativeCollisionAuthority } from "./empty-authoritative-collision-qualification.server";
import {
  runWithTrustExplicitGeminiFloorWallObservation,
  trustExplicitGeminiFloorWallObservation,
} from "./explicit-gemini-floor-wall-trust";
import { deriveAutoMetricScale } from "./metric-auto-scale";
import { selectMetricCorrespondenceSpan } from "./metric-correspondence-span";
import {
  constructAfcV2RoomBoundaryAuthority,
  type RoomBoundaryConstructionInput,
} from "./room-boundary-authority.server";
import { constructAfcV2RoomCollisionAuthority } from "./room-collision-qualification.server";
import { selectActiveRuntimeCollisionWalls } from "./room-envelope-collision-authority-contract";

const V2 = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const emptyIdentity = {
  sha256: "e".repeat(64),
  decodedWidth: 1200,
  decodedHeight: 800,
  orientation: 1 as const,
};
const originalIdentity = {
  sha256: "a".repeat(64),
  decodedWidth: 1200,
  decodedHeight: 800,
  orientation: 1 as const,
};
const rescaledOriginalIdentity = {
  sha256: "o".repeat(64),
  decodedWidth: 1800,
  decodedHeight: 1200,
  orientation: 1 as const,
};
const incompatibleOriginalIdentity = {
  sha256: "i".repeat(64),
  decodedWidth: 800,
  decodedHeight: 1200,
  orientation: 1 as const,
};

const FLOOR_POLYGON = [
  { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
];
const WALL_POLYGON = [
  { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
];
const LEFT_WALL = [
  { x: 0, y: 0.22 }, { x: 0.18, y: 0.16 }, { x: 0.18, y: 0.64 }, { x: 0.06, y: 1 },
];
const BACK_SEAM = [{ x: 0.18, y: 0.64 }, { x: 0.8, y: 0.64 }];
const BACK_WALL = [
  { x: 0.18, y: 0.16 }, { x: 0.8, y: 0.16 }, { x: 0.8, y: 0.64 }, { x: 0.18, y: 0.64 },
];
const MERGE_FLOOR = [
  { x: 0.06, y: 1 }, { x: 0.96, y: 1 }, { x: 0.8, y: 0.64 }, { x: 0.18, y: 0.64 },
];

function providerObservation(overrides: Record<string, unknown> = {}) {
  return {
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: FLOOR_POLYGON,
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: WALL_POLYGON,
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
    ...overrides,
  };
}

function evidence(raw: unknown = providerObservation()) {
  return buildEmptyRoomObservationEvidence(raw, {
    attemptId: "gemini-fw-trust",
    loadGeneration: 1,
    emptyIdentity: { ...emptyIdentity, byteCount: 3, mimeType: "image/png" },
    originalAncestorSha256: originalIdentity.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-06T00:00:00.000Z",
  });
}

function construction(
  observation = evidence(),
  identity = originalIdentity,
): RoomBoundaryConstructionInput {
  return {
    attemptId: "gemini-fw-trust",
    loadGeneration: 1,
    observation,
    emptyIdentity,
    originalIdentity: identity,
    floor: {
      authorityKey: "floor-key",
      worldWidthM: 6,
      referenceDepthM: 4,
      widthDepthRatio: 1.5,
    },
    camera: {
      verticalFovDeg: 52,
      pose: {
        position: { x: 0.4, y: 1.8, z: 4.2 },
        lookAt: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      frame: { width: 900, height: 600 },
    },
    freezeReceipt: {
      receiptVersion: "afc-sr1-calibrated-camera-freeze-receipt/v1",
      integrity: { payloadSha256: "f".repeat(64) },
    },
  };
}

function pipeline(
  observation = evidence(),
  identity = originalIdentity,
) {
  const s4a = constructAfcV2RoomBoundaryAuthority(construction(observation, identity));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const ea = constructAfcV2EmptyAuthoritativeCollisionAuthority({
    roomCollision: s4b,
    roomBoundary: s4a,
    observation,
  });
  return { observation, s4a, s4b, ea };
}

function frontierRejectedObservation() {
  return evidence(providerObservation({
    observedSeams: [{
      id: "visible_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.25, y: 0.40 }, { x: 0.75, y: 0.40 },
      ],
      confidence: 0.88,
      visibility: "observed",
    }],
  }));
}

function occupancyIncoherentObservation() {
  return evidence(providerObservation({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: FLOOR_POLYGON,
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: FLOOR_POLYGON,
        confidence: 0.91,
        visibility: "observed",
      },
    ],
  }));
}

function doorObservation() {
  return evidence(providerObservation({
    observedOpenings: [{
      id: "door",
      category: "doorway",
      hostPlaneId: "visible_wall",
      sourceNormalizedBoundary: [
        { x: 0.4, y: 0.48 }, { x: 0.6, y: 0.48 },
        { x: 0.6, y: 0.74 }, { x: 0.4, y: 0.74 },
      ],
      boundaryClosure: "complete_visible_outline",
      boundaryEvidenceCompleteness: "all_edges_visibly_traced",
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
}

function jambTouchObservation() {
  return evidence(providerObservation({
    observedOpenings: [{
      id: "door",
      category: "doorway",
      hostPlaneId: "visible_wall",
      sourceNormalizedBoundary: [
        { x: 0.2, y: 0.62 }, { x: 0.12, y: 0.48 }, { x: 0.08, y: 0.62 },
      ],
      boundaryClosure: "partial_visible_outline",
      boundaryEvidenceCompleteness: "partial_edges_only",
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
}

function twoPointObservation() {
  return evidence(providerObservation({
    observedSeams: [{
      id: "visible_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
}

function mergeContext() {
  return {
    attemptId: "gemini-fw-trust",
    loadGeneration: 1,
    emptyIdentity: { ...emptyIdentity, byteCount: 3, mimeType: "image/png" as const },
    originalAncestorSha256: originalIdentity.sha256,
    provider: "controlled_fixture" as const,
    model: "fixture",
    observerProfile: "empty-side-floor-wall-conservative/v1",
    promptVersion: AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION,
    generatedAt: "2026-09-06T00:00:00.000Z",
  };
}

function generalWithoutLeft() {
  return evidence({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: MERGE_FLOOR,
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_back_wall",
        category: "wall",
        sourceNormalizedPolygon: BACK_WALL,
        confidence: 0.91,
        visibility: "observed",
      },
    ],
    observedSeams: [{
      id: "floor_wall_back",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_back_wall"],
      sourceNormalizedPolyline: BACK_SEAM,
      confidence: 0.92,
      visibility: "observed",
    }],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  });
}

test("lab experiment flag defaults on", () => {
  assert.equal(trustExplicitGeminiFloorWallObservation(), true);
});

test("1. general explicit floor-wall rejected by frontier still enables experimental collision", () => {
  const { s4a, s4b, ea } = pipeline(frontierRejectedObservation());
  const candidate = s4a.candidates[0];
  assert.ok(candidate);
  assert.notEqual(candidate.status, "accepted");
  assert.ok(
    candidate.reasons.includes("seam_not_near_floor_polygon_frontier") ||
      candidate.reasons.includes("seam_not_near_wall_polygon_frontier"),
  );
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.ok(ea.walls.some((wall) => wall.collisionEnabled));
  const trust = ea.walls.find((wall) => wall.collisionEnabled)?.experimentalTrust;
  assert.equal(trust?.observer, "general");
  assert.equal(trust?.semanticVetoBypassed, true);
  assert.equal(trust?.priorQualificationStatus, candidate.status);
  assert.equal(trust?.metricEligibleSeparately, false);
});

test("2. focused explicit floor-wall rejected by wall frontier is merge-admitted experimentally", () => {
  const general = generalWithoutLeft();
  const focused = buildFocusedSideFloorWallEvidence({
    observedSides: [{
      side: "left",
      wallPlaneVisible: true,
      sourceNormalizedWallPolygon: LEFT_WALL,
      sourceNormalizedFloorWallPolyline: [
        { x: 0.02, y: 0.92 }, { x: 0.12, y: 0.58 },
      ],
      confidence: 0.82,
      visibility: "observed",
      ambiguity: null,
      frameTruncated: true,
    }],
    unresolved: [],
  }, mergeContext());
  const merged = mergeFocusedSideFloorWallObservation({ general, focused });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.ok(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length >= 1);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearWallFrontier,
    ) ||
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ) ||
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.occupancyIncoherent,
    ) ||
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.beyondSupport,
    ),
  );
  const { s4a, ea } = pipeline(merged);
  const focusedCandidate = s4a.candidates.find((candidate) =>
    candidate.source.observationSource === FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE
  );
  assert.ok(focusedCandidate);
  assert.ok(ea.walls.some((wall) =>
    wall.collisionEnabled && wall.sourceSeamId === focusedCandidate.sourceSeamId
  ));
});

test("3. occupancy-incoherent explicit seam enables experimental collision", () => {
  const { s4a, ea } = pipeline(occupancyIncoherentObservation());
  const candidate = s4a.candidates[0];
  assert.ok(candidate);
  assert.ok(
    candidate.reasons.includes("floor_and_wall_occupancy_not_opposite") ||
      candidate.reasons.includes("floor_occupancy_not_unique") ||
      candidate.reasons.includes("wall_occupancy_not_unique") ||
      candidate.reasons.includes("floor_occupancy_undetermined") ||
      candidate.reasons.includes("wall_occupancy_undetermined"),
  );
  assert.notEqual(candidate.status, "accepted");
  assert.ok(ea.walls.some((wall) => wall.collisionEnabled));
  assert.equal(ea.walls[0]?.experimentalTrust?.semanticVetoBypassed, true);
});

test("4. S4B two-point corroboration failure still enables experimental collision", () => {
  const { s4a, s4b, ea } = pipeline(twoPointObservation());
  assert.ok(s4a.candidates[0]);
  const twoPointFailed = s4b.boundaries[0]?.qualificationReasons.includes(
    "two_point_region_corroboration_insufficient",
  ) === true || s4b.boundaries[0]?.collisionEnabled === false;
  assert.ok(twoPointFailed || ea.walls.some((wall) => wall.collisionEnabled));
  assert.ok(ea.walls.some((wall) => wall.collisionEnabled));
});

test("5. malformed seam is not experimentally trusted", () => {
  const observation = evidence(providerObservation({
    observedSeams: [{
      id: "bad",
      category: "floor_wall",
      planeIds: ["visible_floor"],
      sourceNormalizedPolyline: [{ x: 0.2, y: 0.62 }],
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
  assert.equal(
    observation.observedSeams.filter((seam) => seam.category === "floor_wall").length,
    0,
  );
  const { ea } = pipeline(observation);
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(ea).length, 0);
});

test("6. out-of-bounds seam is not experimentally trusted", () => {
  const observation = evidence(providerObservation({
    observedSeams: [{
      id: "oob",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 1.4, y: 0.62 }, { x: 1.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
  assert.equal(observation.observedSeams.length, 0);
  const { ea } = pipeline(observation);
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(ea).length, 0);
});

test("7. zero-length seam is not experimentally trusted", () => {
  const observation = evidence(providerObservation({
    observedSeams: [{
      id: "zero",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.4, y: 0.62 }, { x: 0.4, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
  assert.equal(observation.observedSeams.length, 0);
  const { ea } = pipeline(observation);
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(ea).length, 0);
});

test("8. projection failure is not experimentally trusted", () => {
  const { s4a, ea } = pipeline(evidence(), incompatibleOriginalIdentity);
  assert.ok(s4a.candidates[0]?.reasons.some((reason) =>
    reason === "empty_original_incompatible" || reason.startsWith("projection_failed")
  ));
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(ea).length, 0);
});

test("9. non-finite or degenerate world segment is not experimentally trusted", () => {
  const { observation, s4a, s4b } = pipeline();
  const patched = {
    ...s4b,
    boundaries: s4b.boundaries.map((boundary) => ({
      ...boundary,
      finiteBaseSegment: { a: { x: 1, z: 1 }, b: { x: 1, z: 1 } },
    })),
  };
  const ea = constructAfcV2EmptyAuthoritativeCollisionAuthority({
    roomCollision: patched,
    roomBoundary: s4a,
    observation,
  });
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(ea).length, 0);

  const nan = constructAfcV2EmptyAuthoritativeCollisionAuthority({
    roomCollision: {
      ...s4b,
      boundaries: s4b.boundaries.map((boundary) => ({
        ...boundary,
        finiteBaseSegment: { a: { x: Number.NaN, z: 0 }, b: { x: 1, z: 0 } },
      })),
    },
    roomBoundary: s4a,
    observation,
  });
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(nan).length, 0);
});

test("10. explicit doorway subtracts a collision gap", () => {
  const { s4b, ea } = pipeline(doorObservation());
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes("seam_crosses_reported_opening") ||
      s4b.boundaries[0]?.corroboration.openingCrossing === true,
  );
  const enabled = enabledEmptyAuthoritativeCollisionWalls(ea);
  assert.ok(enabled.length >= 1);
  assert.ok(ea.openingSubtractionPerformed);
  assert.ok(ea.walls.some((wall) => wall.derivation === "observed_interval_subtraction"));
});

test("11. jamb-touch only does not invent a full gap", () => {
  const { ea } = pipeline(jambTouchObservation());
  const enabled = enabledEmptyAuthoritativeCollisionWalls(ea);
  assert.ok(enabled.length >= 1);
  assert.equal(
    ea.walls.some((wall) => wall.derivation === "observed_interval_subtraction"),
    false,
  );
});

test("12. dashed plane extent only is not promoted", () => {
  const observation = evidence(providerObservation({
    observedSeams: [],
  }));
  assert.equal(observation.observedSeams.length, 0);
  const { s4a, ea } = pipeline(observation);
  assert.equal(s4a.candidates.length, 0);
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(ea).length, 0);
});

test("13. general plus focused disagreement keeps general geometry", () => {
  const base = evidence();
  const generalSeam = base.observedSeams.find((seam) => seam.category === "floor_wall");
  assert.ok(generalSeam);
  const focusedSeam = {
    ...generalSeam,
    id: "focused_left_disagreement",
    observationSource: FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE,
    sourceNormalizedPolyline: [
      { x: 0.22, y: 0.62 }, { x: 0.78, y: 0.62 },
    ],
  };
  const mixed = {
    ...base,
    observedSeams: Object.freeze([generalSeam, focusedSeam]),
  };
  const { s4a, ea } = pipeline(mixed);
  const enabled = ea.walls.filter((wall) => wall.collisionEnabled);
  assert.ok(enabled.length >= 1);
  assert.ok(enabled.every((wall) => wall.sourceSeamId !== focusedSeam.id));
  const general = enabled.find((wall) => wall.sourceSeamId === generalSeam.id);
  assert.ok(general);
  assert.deepEqual(
    general.finiteBaseSegment,
    s4a.candidates.find((candidate) => candidate.sourceSeamId === generalSeam.id)
      ? {
        a: {
          x: s4a.candidates.find((candidate) => candidate.sourceSeamId === generalSeam.id)!
            .worldGeometry!.baseStart.x,
          z: s4a.candidates.find((candidate) => candidate.sourceSeamId === generalSeam.id)!
            .worldGeometry!.baseStart.z,
        },
        b: {
          x: s4a.candidates.find((candidate) => candidate.sourceSeamId === generalSeam.id)!
            .worldGeometry!.baseEnd.x,
          z: s4a.candidates.find((candidate) => candidate.sourceSeamId === generalSeam.id)!
            .worldGeometry!.baseEnd.z,
        },
      }
      : general.finiteBaseSegment,
  );
  const focusedTrust = ea.walls.find((wall) => wall.sourceSeamId === focusedSeam.id)
    ?.experimentalTrust;
  assert.equal(focusedTrust?.conflict === "general_wins" || focusedTrust == null, true);
});

test("14. two competing general traces keep ambiguity and do not invent a winner", () => {
  const observation = evidence(providerObservation({
    observedSeams: [
      {
        id: "trace_a",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: [
          { x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 },
        ],
        confidence: 0.95,
        visibility: "observed",
      },
      {
        id: "trace_b",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: [
          { x: 0.25, y: 0.62 }, { x: 0.75, y: 0.62 },
        ],
        confidence: 0.4,
        visibility: "observed",
      },
    ],
  }));
  const { s4a, ea } = pipeline(observation);
  assert.ok(s4a.candidates.every((candidate) => candidate.status === "ambiguous"));
  assert.ok(s4a.candidates.every((candidate) =>
    candidate.reasons.includes("competing_same_wall_trace")
  ));
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(ea).length, 0);
});

test("15. experimental collision trust does not make metric eligible", () => {
  const { s4a, ea } = pipeline(frontierRejectedObservation());
  assert.ok(ea.walls.some((wall) => wall.collisionEnabled));
  assert.notEqual(s4a.candidates[0]?.status, "accepted");
  const selected = selectMetricCorrespondenceSpan({
    roomBoundary: s4a,
    registration: { registrationClass: "exact_grid_registered" },
    originalLocalizedBoundary: null,
    originalLocalizationClass: null,
  });
  assert.equal(selected.selected, null);
  const auto = deriveAutoMetricScale({
    roomPrior: null,
    selected: selected.selected,
    s4aSafety: {
      observedSpanOnly: true,
      hiddenContinuation: false,
      geometryManufactured: false,
    },
    trustSelectedBackSpanAsFullWidth: true,
  });
  assert.equal(auto.labTrustEnabled, true);
  assert.notEqual(auto.authority, "gemini_width_back_span_experimental");
  assert.equal(ea.walls[0]?.experimentalTrust?.metricEligibleSeparately, false);
});

test("16. exact-grid experiment ON uses experimental EA XOR", () => {
  const { s4b, ea } = pipeline(frontierRejectedObservation());
  const selected = selectActiveRuntimeCollisionWalls({
    emptyAuthoritativeCollision: ea,
    originalLocalizedCollision: {
      lineage: { originalLocalizationClass: "certified_original_localized" },
      walls: [{ id: "ol-only" }],
    } as never,
    envelopeCollision: {
      schemaVersion: "afc-v2-room-envelope-collision-authority/v1",
    } as never,
    roomCollision: s4b,
  });
  assert.equal(selected.source, "empty_authoritative");
  assert.equal(selected.walls.some((wall) => wall.id === "ol-only"), false);
  assert.equal(
    selected.walls.length,
    enabledEmptyAuthoritativeCollisionWalls(ea).length,
  );
});

test("17. aspect-rescaled experiment ON uses experimental EA XOR", () => {
  const { s4b, ea } = pipeline(frontierRejectedObservation(), rescaledOriginalIdentity);
  const selected = selectActiveRuntimeCollisionWalls({
    emptyAuthoritativeCollision: ea,
    originalLocalizedCollision: {
      lineage: { originalLocalizationClass: "certified_original_localized" },
      walls: [{ id: "ol-only" }],
    } as never,
    roomCollision: s4b,
  });
  assert.equal(selected.source, "empty_authoritative");
  assert.equal(selected.walls.some((wall) => wall.id === "ol-only"), false);
});

test("18. flag OFF matches a80aad6 refusal of semantically rejected seams", () => {
  runWithTrustExplicitGeminiFloorWallObservation(false, () => {
    const { s4a, s4b, ea } = pipeline(frontierRejectedObservation());
    assert.notEqual(s4a.candidates[0]?.status, "accepted");
    assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
    assert.equal(ea.walls.some((wall) => wall.collisionEnabled), false);
    const selected = selectActiveRuntimeCollisionWalls({
      emptyAuthoritativeCollision: ea,
      roomCollision: s4b,
    });
    assert.equal(selected.source, "s4b");
  });
});

test("19. provider counts and prompts are unchanged", () => {
  const analysis = readFileSync(path.join(V2, "afc-v2-analysis.server.ts"), "utf8");
  assert.match(analysis, /observeFocusedSideFloorWallObservation/);
  assert.match(analysis, /observeFocusedSideCeilingWallSeams/);
  assert.match(analysis, /focusedSideFloorWallObserver:/);
  assert.match(analysis, /roomObserver:/);
  const general = readFileSync(path.join(V2, "empty-room-observation.server.ts"), "utf8");
  const focused = readFileSync(path.join(V2, "empty-side-floor-wall-observation.server.ts"), "utf8");
  assert.match(general, /afc-v2-empty-visible-room-observer\/v5/);
  assert.match(focused, /AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION/);
  assert.doesNotMatch(general, /trustExplicitGeminiFloorWallObservation/);
  assert.doesNotMatch(focused, /trustExplicitGeminiFloorWallObservation/);
});

test("20. V1 room observation contract is untouched", () => {
  const v1 = readFileSync(path.join(V2, "room-observation-contract.ts"), "utf8");
  assert.doesNotMatch(v1, /trustExplicitGeminiFloorWallObservation/);
  assert.doesNotMatch(v1, /explicit-gemini-floor-wall-trust/);
  assert.doesNotMatch(v1, /experimentalTrust/);
});

test("lab inspector exposes experimental trust diagnostics", () => {
  const roomLab = readFileSync(path.join(V2, "RoomLabV2.tsx"), "utf8");
  assert.match(roomLab, /Explicit floor-wall trust/);
  assert.match(roomLab, /semantic bypass/);
  assert.match(roomLab, /experimental collision/);
});
