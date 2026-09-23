import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildEmptyRoomObservationEvidence,
  type EmptyObservedSeam,
  type EmptyRoomObservationAcceptedEvidence,
} from "./empty-room-observation-contract";
import { buildFocusedSideCeilingWallEvidence } from "./empty-side-ceiling-wall-observation-contract";
import {
  MERGE_REASON,
  mergeFocusedSideCeilingWallSeams,
} from "./empty-side-ceiling-wall-observation-merge.server";
import { AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION } from "./empty-side-ceiling-wall-observation.server";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const EMPTY_BYTES = Uint8Array.from([7, 8, 9]);
const emptyIdentity = {
  sha256: sha(EMPTY_BYTES),
  byteCount: EMPTY_BYTES.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};

const LEFT_ENVELOPE = [
  { x: 0, y: 0.28 },
  { x: 0.18, y: 0.12 },
] as const;
const LEFT_ENVELOPE_OFFSET = [
  { x: 0.013, y: 0.295 },
  { x: 0.193, y: 0.135 },
] as const;
const LEFT_ENVELOPE_SHORT = [
  { x: 0.04, y: 0.244 },
  { x: 0.14, y: 0.156 },
] as const;
const LEFT_PELMET_LOWER = [
  { x: 0, y: 0.4 },
  { x: 0.18, y: 0.24 },
] as const;
const RIGHT_ENVELOPE = [
  { x: 1, y: 0.27 },
  { x: 0.82, y: 0.11 },
] as const;
const LEFT_NEAR_SEGMENT = [
  { x: 0, y: 0.42 },
  { x: 0.07, y: 0.36 },
] as const;
const LEFT_FAR_SEGMENT = [
  { x: 0.12, y: 0.3 },
  { x: 0.17, y: 0.26 },
] as const;
const TRUE_SOFFIT_ENVELOPE = [
  { x: 0, y: 0.34 },
  { x: 0.2, y: 0.18 },
] as const;
const BACK_CEILING = [
  { x: 0.18, y: 0.12 },
  { x: 0.82, y: 0.11 },
] as const;

const focusedContext = {
  attemptId: "v2-s3f-duplicate-pelmet",
  loadGeneration: 31,
  emptyIdentity,
  originalAncestorSha256: "b".repeat(64),
  provider: "controlled_fixture" as const,
  model: "fixture",
  observerProfile: "empty-side-ceiling-wall-conservative/v1",
  promptVersion: AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION,
  generatedAt: "2026-08-27T20:00:00.000Z",
};

function generalObservation(options: {
  leftPolyline?: readonly { x: number; y: number }[];
  extraSeams?: readonly Record<string, unknown>[];
  junctions?: readonly Record<string, unknown>[];
} = {}) {
  return {
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 0.82, y: 0.62 },
          { x: 0.18, y: 0.62 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_back_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.18, y: 0.12 },
          { x: 0.82, y: 0.11 },
          { x: 0.82, y: 0.62 },
          { x: 0.18, y: 0.62 },
        ],
        confidence: 0.91,
        visibility: "observed",
      },
      {
        id: "visible_left_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0, y: 0.05 },
          { x: 0.18, y: 0.12 },
          { x: 0.18, y: 0.62 },
          { x: 0, y: 0.78 },
        ],
        confidence: 0.88,
        visibility: "observed",
      },
      {
        id: "visible_ceiling",
        category: "ceiling",
        sourceNormalizedPolygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.82, y: 0.11 },
          { x: 0.18, y: 0.12 },
        ],
        confidence: 0.84,
        visibility: "observed",
      },
    ],
    observedSeams: [
      {
        id: "floor_wall_back",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_back_wall"],
        sourceNormalizedPolyline: [
          { x: 0.18, y: 0.62 },
          { x: 0.82, y: 0.62 },
        ],
        confidence: 0.92,
        visibility: "observed",
      },
      {
        id: "wall_ceiling_back",
        category: "wall_ceiling",
        planeIds: ["visible_back_wall", "visible_ceiling"],
        sourceNormalizedPolyline: [...BACK_CEILING],
        confidence: 0.89,
        visibility: "observed",
      },
      ...(options.leftPolyline
        ? [{
          id: "wall_ceiling_left",
          category: "wall_ceiling",
          planeIds: ["visible_left_wall", "visible_ceiling"],
          sourceNormalizedPolyline: [...options.leftPolyline],
          confidence: 0.81,
          visibility: "observed",
        }]
        : []),
      ...(options.extraSeams ?? []),
    ],
    observedOpenings: [],
    observedJunctions: options.junctions ?? [],
    unresolved: [],
  };
}

function generalEvidence(
  raw: unknown = generalObservation(),
): EmptyRoomObservationAcceptedEvidence {
  return buildEmptyRoomObservationEvidence(raw, {
    ...focusedContext,
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
  });
}

function focusedEvidence(
  polyline: readonly { x: number; y: number }[],
  extra: Record<string, unknown> = {},
) {
  return buildFocusedSideCeilingWallEvidence({
    observedSeams: [{
      id: "left_side_ceiling",
      category: "wall_ceiling",
      sourceNormalizedPolyline: polyline,
      confidence: 0.8,
      visibility: "observed",
    }],
    unresolved: [],
    ...extra,
  }, focusedContext);
}

function emptyFocused() {
  return buildFocusedSideCeilingWallEvidence({
    observedSeams: [],
    unresolved: [],
  }, focusedContext);
}

function wallCeiling(
  evidence: EmptyRoomObservationAcceptedEvidence,
): EmptyObservedSeam[] {
  return evidence.observedSeams.filter((seam) => seam.category === "wall_ceiling");
}

function polylineJson(
  line: readonly { x: number; y: number }[],
): string {
  return JSON.stringify(line.map((point) => ({ x: point.x, y: point.y })));
}

function assertExactCandidate(
  surviving: readonly { x: number; y: number }[],
  candidates: readonly (readonly { x: number; y: number }[])[],
) {
  const actual = polylineJson(surviving);
  assert.equal(
    candidates.some((candidate) => polylineJson(candidate) === actual),
    true,
    `surviving polyline ${actual} was not an original candidate`,
  );
}

function averaged(
  first: readonly { x: number; y: number }[],
  second: readonly { x: number; y: number }[],
) {
  return first.map((point, index) => ({
    x: (point.x + second[index]!.x) / 2,
    y: (point.y + second[index]!.y) / 2,
  }));
}

test("clear same-run duplicate keeps one existing polyline", () => {
  const general = generalEvidence(generalObservation({
    leftPolyline: LEFT_ENVELOPE,
  }));
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: focusedEvidence(LEFT_ENVELOPE_OFFSET),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  const side = wallCeiling(merged).filter((seam) =>
    seam.id !== "wall_ceiling_back"
  );
  assert.equal(side.length, 1);
  assert.deepEqual(side[0]?.sourceNormalizedPolyline, [...LEFT_ENVELOPE]);
  assert.equal(side[0]?.observationSource, "general_empty_observer");
  assertExactCandidate(side[0]!.sourceNormalizedPolyline, [
    LEFT_ENVELOPE,
    LEFT_ENVELOPE_OFFSET,
  ]);
  assert.notDeepEqual(
    side[0]?.sourceNormalizedPolyline,
    averaged(LEFT_ENVELOPE, LEFT_ENVELOPE_OFFSET),
  );
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.skippedDuplicateSeamIds.length,
    1,
  );
  assert.deepEqual(
    merged.qualityGate.focusedSideCeilingWall.suppressedGeneralSeamIds,
    [],
  );
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.resolutionReasons.includes(
      MERGE_REASON.focusedDuplicateKeepGeneral,
    ),
    true,
  );
  assert.equal(merged.qualityGate.focusedSideCeilingWall.geometryManufactured, false);
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.hiddenContinuationAdded,
    false,
  );
});

test("focused clearly better same-run keeps the focused polyline exactly", () => {
  const general = generalEvidence(generalObservation({
    leftPolyline: LEFT_ENVELOPE_SHORT,
  }));
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: focusedEvidence(LEFT_ENVELOPE),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  const side = wallCeiling(merged).filter((seam) =>
    seam.id !== "wall_ceiling_back"
  );
  assert.equal(side.length, 1);
  assert.equal(side[0]?.observationSource, "focused_side_ceiling_wall");
  assert.deepEqual(side[0]?.sourceNormalizedPolyline, [...LEFT_ENVELOPE]);
  assert.notDeepEqual(side[0]?.sourceNormalizedPolyline, [...LEFT_ENVELOPE_SHORT]);
  assert.deepEqual(
    merged.qualityGate.focusedSideCeilingWall.suppressedGeneralSeamIds,
    ["wall_ceiling_left"],
  );
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.resolutionReasons.includes(
      MERGE_REASON.generalDuplicateKeepFocused,
    ),
    true,
  );
  assert.equal(merged.observedSeams.some((seam) => seam.id === "wall_ceiling_left"), false);
  assert.deepEqual(
    merged.observedSeams.find((seam) => seam.id === "wall_ceiling_back")
      ?.sourceNormalizedPolyline,
    [...BACK_CEILING],
  );
});

test("general clearly better same-run keeps the general polyline exactly", () => {
  const general = generalEvidence(generalObservation({
    leftPolyline: LEFT_ENVELOPE,
  }));
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: focusedEvidence(LEFT_ENVELOPE_SHORT),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  const side = wallCeiling(merged).filter((seam) =>
    seam.id !== "wall_ceiling_back"
  );
  assert.equal(side.length, 1);
  assert.equal(side[0]?.observationSource, "general_empty_observer");
  assert.deepEqual(side[0]?.sourceNormalizedPolyline, [...LEFT_ENVELOPE]);
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.skippedDuplicateSeamIds.length,
    1,
  );
  assert.deepEqual(
    merged.qualityGate.focusedSideCeilingWall.suppressedGeneralSeamIds,
    [],
  );
});

test("ambiguous overlap keeps both original polylines", () => {
  const general = generalEvidence(generalObservation({
    leftPolyline: LEFT_NEAR_SEGMENT,
  }));
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: focusedEvidence(LEFT_FAR_SEGMENT),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  const side = wallCeiling(merged).filter((seam) =>
    seam.id !== "wall_ceiling_back"
  );
  assert.equal(side.length, 2);
  assert.deepEqual(
    side.find((seam) => seam.observationSource === "general_empty_observer")
      ?.sourceNormalizedPolyline,
    [...LEFT_NEAR_SEGMENT],
  );
  assert.deepEqual(
    side.find((seam) => seam.observationSource === "focused_side_ceiling_wall")
      ?.sourceNormalizedPolyline,
    [...LEFT_FAR_SEGMENT],
  );
  assert.deepEqual(
    merged.qualityGate.focusedSideCeilingWall.suppressedGeneralSeamIds,
    [],
  );
});

test("distinct left and right wall-ceiling runs both survive", () => {
  const general = generalEvidence(generalObservation({
    leftPolyline: LEFT_ENVELOPE,
  }));
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: focusedEvidence(RIGHT_ENVELOPE),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  const side = wallCeiling(merged).filter((seam) =>
    seam.id !== "wall_ceiling_back"
  );
  assert.equal(side.length, 2);
  assert.deepEqual(
    side.find((seam) => seam.id === "wall_ceiling_left")
      ?.sourceNormalizedPolyline,
    [...LEFT_ENVELOPE],
  );
  assert.deepEqual(
    side.find((seam) => seam.observationSource === "focused_side_ceiling_wall")
      ?.sourceNormalizedPolyline,
    [...RIGHT_ENVELOPE],
  );
});

test("duplicate resolution never synthesizes averaged or interpolated geometry", () => {
  const generalLine = LEFT_ENVELOPE;
  const focusedLine = LEFT_ENVELOPE_OFFSET;
  const merged = mergeFocusedSideCeilingWallSeams({
    general: generalEvidence(generalObservation({ leftPolyline: generalLine })),
    focused: focusedEvidence(focusedLine),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  for (const seam of wallCeiling(merged)) {
    assertExactCandidate(seam.sourceNormalizedPolyline, [
      BACK_CEILING,
      generalLine,
      focusedLine,
    ]);
  }
  assert.equal(merged.qualityGate.normalization.geometryManufactured, false);
  assert.equal(merged.qualityGate.normalization.hiddenContinuationAdded, false);
  assert.equal(merged.qualityGate.focusedSideCeilingWall.geometryManufactured, false);
  assert.equal(merged.authority, "observation_only");
});

test("pelmet lower-edge focused candidate is rejected when an envelope exists above", () => {
  const general = generalEvidence(generalObservation({
    leftPolyline: LEFT_ENVELOPE,
  }));
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: focusedEvidence(LEFT_PELMET_LOWER),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  const side = wallCeiling(merged).filter((seam) =>
    seam.id !== "wall_ceiling_back"
  );
  assert.equal(side.length, 1);
  assert.deepEqual(side[0]?.sourceNormalizedPolyline, [...LEFT_ENVELOPE]);
  assert.equal(side[0]?.observationSource, "general_empty_observer");
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.rejectedSeamIds.length,
    1,
  );
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.resolutionReasons.includes(
      MERGE_REASON.focusedRejectedPelmet,
    ),
    true,
  );
});

test("pelmet lower-edge general candidate is suppressed when focused envelope exists above", () => {
  const general = generalEvidence(generalObservation({
    leftPolyline: LEFT_PELMET_LOWER,
  }));
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: focusedEvidence(LEFT_ENVELOPE),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  const side = wallCeiling(merged).filter((seam) =>
    seam.id !== "wall_ceiling_back"
  );
  assert.equal(side.length, 1);
  assert.deepEqual(side[0]?.sourceNormalizedPolyline, [...LEFT_ENVELOPE]);
  assert.equal(side[0]?.observationSource, "focused_side_ceiling_wall");
  assert.deepEqual(
    merged.qualityGate.focusedSideCeilingWall.suppressedGeneralSeamIds,
    ["wall_ceiling_left"],
  );
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.resolutionReasons.includes(
      MERGE_REASON.generalSuppressedPelmet,
    ),
    true,
  );
});

test("occluded pelmet case does not invent a hidden ceiling seam", () => {
  const general = generalEvidence(generalObservation());
  const before = wallCeiling(general).map((seam) =>
    polylineJson(seam.sourceNormalizedPolyline)
  );
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: emptyFocused(),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.deepEqual(
    wallCeiling(merged).map((seam) => polylineJson(seam.sourceNormalizedPolyline)),
    before,
  );
  assert.equal(
    merged.observedSeams.some((seam) =>
      seam.observationSource === "focused_side_ceiling_wall"
    ),
    false,
  );
  assert.equal(merged.qualityGate.focusedSideCeilingWall.observerStatus, "empty");
  assert.equal(merged.qualityGate.focusedSideCeilingWall.geometryManufactured, false);
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.hiddenContinuationAdded,
    false,
  );
});

test("true soffit envelope is not rejected merely for looking like a protruding structure", () => {
  const general = generalEvidence(generalObservation());
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: focusedEvidence(TRUE_SOFFIT_ENVELOPE),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  const added = merged.observedSeams.filter((seam) =>
    seam.observationSource === "focused_side_ceiling_wall"
  );
  assert.equal(added.length, 1);
  assert.deepEqual(added[0]?.sourceNormalizedPolyline, [...TRUE_SOFFIT_ENVELOPE]);
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.rejectedSeamIds.length,
    0,
  );
  assert.deepEqual(
    merged.observedSeams.find((seam) => seam.id === "wall_ceiling_back")
      ?.sourceNormalizedPolyline,
    [...BACK_CEILING],
  );
});

test("junction at pelmet lower edge is omitted when a ceiling envelope exists above", () => {
  const general = generalEvidence(generalObservation({
    leftPolyline: LEFT_ENVELOPE,
    junctions: [{
      id: "pelmet_bottom_corner",
      category: "room_corner",
      sourceNormalizedPoint: { x: 0.18, y: 0.24 },
      seamIds: ["wall_ceiling_left"],
      openingIds: [],
      confidence: 0.7,
      visibility: "observed",
    }, {
      id: "true_ceiling_corner",
      category: "room_corner",
      sourceNormalizedPoint: { x: 0.18, y: 0.12 },
      seamIds: ["wall_ceiling_back", "wall_ceiling_left"],
      openingIds: [],
      confidence: 0.84,
      visibility: "observed",
    }, {
      id: "floor_corner",
      category: "room_corner",
      sourceNormalizedPoint: { x: 0.18, y: 0.62 },
      seamIds: ["floor_wall_back"],
      openingIds: [],
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: emptyFocused(),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(
    merged.observedJunctions.some((junction) => junction.id === "pelmet_bottom_corner"),
    false,
  );
  assert.equal(
    merged.observedJunctions.some((junction) => junction.id === "true_ceiling_corner"),
    true,
  );
  assert.equal(
    merged.observedJunctions.some((junction) => junction.id === "floor_corner"),
    true,
  );
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.skippedJunctionIds.includes(
      "pelmet_bottom_corner",
    ),
    true,
  );
  assert.equal(
    merged.observedJunctions.some((junction) =>
      junction.sourceNormalizedPoint.x === 0.18 &&
      Math.abs(junction.sourceNormalizedPoint.y - 0.18) < 0.001
    ),
    false,
  );
});

test("center back wall-ceiling is never suppressed by a focused back duplicate", () => {
  const general = generalEvidence(generalObservation({
    leftPolyline: LEFT_ENVELOPE,
  }));
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: focusedEvidence([
      { x: 0.19, y: 0.125 },
      { x: 0.81, y: 0.115 },
    ]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.deepEqual(
    merged.observedSeams.find((seam) => seam.id === "wall_ceiling_back")
      ?.sourceNormalizedPolyline,
    [...BACK_CEILING],
  );
  assert.equal(
    merged.observedSeams.filter((seam) =>
      seam.observationSource === "focused_side_ceiling_wall"
    ).length,
    0,
  );
  assert.equal(merged.authority, "observation_only");
  assert.deepEqual(merged.authoritySeparation, {
    cameraAuthorityConsumed: false,
    floorAuthorityConsumed: false,
    worldProjectionPerformed: false,
    tiledEvidenceConsumed: false,
    fullyTiledEvidenceConsumed: false,
  });
});
