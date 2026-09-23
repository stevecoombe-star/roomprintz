import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRoomObservationContract,
  type RoomObservationImageIdentity,
} from "./room-observation-contract";

const originalIdentity: RoomObservationImageIdentity = {
  sha256: "a".repeat(64),
  byteCount: 100,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/jpeg",
  orientation: 1,
};
const fullyTiledIdentity: RoomObservationImageIdentity = {
  ...originalIdentity,
  sha256: "b".repeat(64),
  byteCount: 200,
  mimeType: "image/png",
};

function contract(raw: Record<string, unknown>) {
  return buildRoomObservationContract({
    observedPlanes: [],
    observedGridFamilies: [],
    observedSeams: [],
    observedOpenings: [],
    planeContinuity: [],
    adjacency: [],
    unresolved: [],
    ...raw,
  }, {
    originalIdentity,
    fullyTiledIdentity,
    generationId: "generation-quality-gate",
    attemptId: "attempt-quality-gate",
    floorResultId: "floor-result-quality-gate",
    cameraAuthorityKey: "certified-floor-authority",
    frozenSnapshotDigest: "c".repeat(64),
    provider: "controlled_fixture",
    model: "fixture",
    promptVersion: "observer/v2",
    generatedAt: "2026-08-25T12:00:00.000Z",
  });
}

function wall(id: string, left: number, right: number) {
  return {
    id,
    category: "wall",
    imagePolygon: [
      { x: left, y: 0.1 },
      { x: right, y: 0.1 },
      { x: right, y: 0.8 },
      { x: left, y: 0.8 },
    ],
    confidence: 0.95,
    visibility: "observed",
  };
}

function grid(id: string, planeId: string, x: number) {
  return {
    id,
    planeId,
    axis: "axis_a",
    lineSegments: [
      { start: { x, y: 0.2 }, end: { x, y: 0.7 } },
      {
        start: { x: x + 0.05, y: 0.2 },
        end: { x: x + 0.05, y: 0.7 },
      },
    ],
    confidence: 0.9,
    visibility: "observed",
  };
}

function continuity(assessment: "continuous" | "unresolved" = "continuous") {
  return {
    id: "continuity_wall_a_wall_b",
    planeIds: ["wall_a", "wall_b"],
    assessment,
    gridCompatibility: assessment === "continuous" ? "compatible" : "insufficient",
    boundaryEvidence: assessment === "continuous"
      ? "uninterrupted_tiled_field"
      : "unclear",
    confidence: 0.94,
    visibility: "observed",
  };
}

test("multi-signal continuity merges a false wall split and rejects its false seam", () => {
  const result = contract({
    observedPlanes: [wall("wall_a", 0.1, 0.4), wall("wall_b", 0.4, 0.8)],
    observedGridFamilies: [
      grid("grid_wall_a", "wall_a", 0.2),
      grid("grid_wall_b", "wall_b", 0.5),
    ],
    observedSeams: [{
      id: "false_split_seam",
      category: "wall_wall",
      planeIds: ["wall_a", "wall_b"],
      imagePolyline: [{ x: 0.4, y: 0.1 }, { x: 0.4, y: 0.8 }],
      confidence: 0.8,
      visibility: "observed",
      boundaryEvidence: "uninterrupted_tiled_field",
      gridCompatibility: "compatible",
    }],
    planeContinuity: [continuity()],
    adjacency: [{
      id: "provider_false_adjacency",
      planeAId: "wall_a",
      planeBId: "wall_b",
      seamId: "false_split_seam",
      confidence: 0.8,
    }],
  });

  assert.equal(result.observedPlanes.length, 1);
  assert.equal(
    result.observedPlanes[0].evidenceClass,
    "conservative_normalized_visible_evidence",
  );
  assert.deepEqual([...result.observedPlanes[0].gridFamilyIds].sort(), [
    "grid_wall_a",
  ]);
  assert.equal(result.observedGridFamilies[0].lineSegments.length, 4);
  assert.equal(result.observedSeams.length, 0);
  assert.equal(result.adjacency.length, 0);
  assert.equal(result.diagnostics.normalization.merges.length, 1);
  assert.match(
    result.diagnostics.normalization.rejectedEvidence[0]?.reason ?? "",
    /collapsed|continuous_tiled_field/,
  );
});

test("supported wall corner blocks a contradictory merge claim", () => {
  const result = contract({
    observedPlanes: [wall("wall_a", 0.1, 0.4), wall("wall_b", 0.4, 0.8)],
    observedGridFamilies: [
      grid("grid_wall_a", "wall_a", 0.2),
      grid("grid_wall_b", "wall_b", 0.5),
    ],
    observedSeams: [{
      id: "true_corner",
      category: "wall_wall",
      planeIds: ["wall_a", "wall_b"],
      imagePolyline: [{ x: 0.4, y: 0.1 }, { x: 0.4, y: 0.8 }],
      confidence: 0.93,
      visibility: "observed",
      boundaryEvidence: "projective_discontinuity",
      gridCompatibility: "incompatible",
    }],
    planeContinuity: [continuity()],
  });

  assert.equal(result.observedPlanes.length, 2);
  assert.equal(result.observedSeams.length, 1);
  assert.equal(result.adjacency.length, 1);
  assert.equal(result.diagnostics.normalization.merges.length, 0);
  assert.match(
    result.diagnostics.normalization.unresolvedTopology[0]?.reason ?? "",
    /corner_evidence_blocks_merge/,
  );
});

test("two-family grid alignment can reject a narrow provider corner strip", () => {
  const pair = (prefix: string, planeId: string, left: number, right: number) => [
    {
      id: `${prefix}_a`,
      planeId,
      axis: "axis_a",
      lineSegments: [
        {
          start: { x: (left + right) / 2, y: 0.2 },
          end: { x: (left + right) / 2, y: 0.7 },
        },
      ],
      confidence: 0.9,
      visibility: "observed",
    },
    {
      id: `${prefix}_b`,
      planeId,
      axis: "axis_b",
      lineSegments: [
        { start: { x: left, y: 0.4 }, end: { x: right, y: 0.4 } },
        { start: { x: left, y: 0.5 }, end: { x: right, y: 0.5 } },
      ],
      confidence: 0.9,
      visibility: "observed",
    },
  ];
  const result = contract({
    observedPlanes: [wall("wall_a", 0.1, 0.7), wall("wall_b", 0.7, 0.73)],
    observedGridFamilies: [
      ...pair("wall_a_grid", "wall_a", 0.1, 0.7),
      ...pair("wall_b_grid", "wall_b", 0.7, 0.73),
    ],
    observedSeams: [{
      id: "provider_strip_seam",
      category: "wall_wall",
      planeIds: ["wall_a", "wall_b"],
      imagePolyline: [{ x: 0.7, y: 0.1 }, { x: 0.7, y: 0.8 }],
      confidence: 0.9,
      visibility: "observed",
      boundaryEvidence: "architectural_break",
      gridCompatibility: "compatible",
    }],
    planeContinuity: [{
      id: "provider_strip_continuity",
      planeIds: ["wall_a", "wall_b"],
      assessment: "discontinuous",
      gridCompatibility: "compatible",
      boundaryEvidence: "architectural_break",
      confidence: 0.9,
      visibility: "observed",
    }],
  });

  assert.equal(result.observedPlanes.length, 1);
  assert.equal(result.observedSeams.length, 0);
  assert.equal(result.adjacency.length, 0);
  assert.match(
    result.diagnostics.normalization.merges[0]?.reasons.join(" ") ?? "",
    /narrow_false_split/,
  );
});

test("an opening across the shared boundary prevents an invalid merge", () => {
  const result = contract({
    observedPlanes: [wall("wall_a", 0.1, 0.4), wall("wall_b", 0.4, 0.8)],
    observedGridFamilies: [
      grid("grid_wall_a", "wall_a", 0.2),
      grid("grid_wall_b", "wall_b", 0.5),
    ],
    observedOpenings: [{
      id: "passage_at_split",
      category: "passage",
      hostPlaneId: null,
      imageBoundary: [
        { x: 0.36, y: 0.35 },
        { x: 0.44, y: 0.35 },
        { x: 0.44, y: 0.65 },
        { x: 0.36, y: 0.65 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    planeContinuity: [continuity()],
  });

  assert.equal(result.observedPlanes.length, 2);
  assert.equal(result.observedOpenings.length, 1);
  assert.match(
    result.diagnostics.normalization.unresolvedTopology[0]?.reason ?? "",
    /opening_interrupts/,
  );
});

test("ambiguous continuity remains split and explicit", () => {
  const result = contract({
    observedPlanes: [wall("wall_a", 0.1, 0.4), wall("wall_b", 0.4, 0.8)],
    observedGridFamilies: [
      grid("grid_wall_a", "wall_a", 0.2),
      grid("grid_wall_b", "wall_b", 0.5),
    ],
    planeContinuity: [continuity("unresolved")],
  });

  assert.equal(result.observedPlanes.length, 2);
  assert.equal(result.diagnostics.normalization.merges.length, 0);
  assert.match(result.diagnostics.unresolved[0] ?? "", /continuity_unresolved/);
});

test("grid validation retains wall and ceiling families while failing malformed families closed", () => {
  const result = contract({
    observedPlanes: [
      wall("wall_a", 0.1, 0.6),
      {
        id: "ceiling_a",
        category: "ceiling",
        imagePolygon: [
          { x: 0.1, y: 0.05 },
          { x: 0.8, y: 0.05 },
          { x: 0.6, y: 0.2 },
          { x: 0.2, y: 0.2 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
    ],
    observedGridFamilies: [
      grid("wall_axis_a", "wall_a", 0.2),
      {
        ...grid("ceiling_axis_a", "ceiling_a", 0.3),
        lineSegments: [
          { start: { x: 0.2, y: 0.1 }, end: { x: 0.7, y: 0.1 } },
        ],
      },
      {
        ...grid("malformed_zero_length", "wall_a", 0.3),
        axis: "axis_b",
        lineSegments: [
          { start: { x: 0.3, y: 0.3 }, end: { x: 0.3, y: 0.3 } },
        ],
      },
    ],
  });

  assert.deepEqual(
    result.observedGridFamilies.map((family) => family.planeId).sort(),
    ["ceiling_a", "wall_a"],
  );
  assert.equal(result.diagnostics.rejected.gridFamilies, 1);
});

test("accepted seams alone derive floor-wall and wall-ceiling adjacency", () => {
  const result = contract({
    observedPlanes: [
      {
        id: "floor_a",
        category: "floor",
        imagePolygon: [
          { x: 0.1, y: 0.6 },
          { x: 0.9, y: 0.6 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        confidence: 0.95,
        visibility: "observed",
      },
      wall("wall_a", 0.1, 0.7),
      wall("wall_b", 0.7, 0.9),
      {
        id: "ceiling_a",
        category: "ceiling",
        imagePolygon: [
          { x: 0.1, y: 0 },
          { x: 0.9, y: 0 },
          { x: 0.7, y: 0.1 },
          { x: 0.1, y: 0.1 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
    ],
    observedSeams: [
      {
        id: "floor_wall_visible",
        category: "floor_wall",
        planeIds: ["floor_a", "wall_a"],
        imagePolyline: [{ x: 0.1, y: 0.6 }, { x: 0.7, y: 0.6 }],
        confidence: 0.92,
        visibility: "observed",
        boundaryEvidence: "architectural_break",
        gridCompatibility: "incompatible",
      },
      {
        id: "wall_ceiling_visible",
        category: "wall_ceiling",
        planeIds: ["wall_a", "ceiling_a"],
        imagePolyline: [{ x: 0.1, y: 0.1 }, { x: 0.7, y: 0.1 }],
        confidence: 0.9,
        visibility: "observed",
        boundaryEvidence: "architectural_break",
        gridCompatibility: "incompatible",
      },
      {
        id: "unsupported_wall_split",
        category: "wall_wall",
        planeIds: ["wall_a", "wall_b"],
        imagePolyline: [{ x: 0.7, y: 0.1 }, { x: 0.7, y: 0.8 }],
        confidence: 0.7,
        visibility: "observed",
        boundaryEvidence: "unclear",
        gridCompatibility: "insufficient",
      },
    ],
    adjacency: [{
      id: "provider_unsupported_adjacency",
      planeAId: "wall_a",
      planeBId: "wall_b",
      seamId: "unsupported_wall_split",
      confidence: 0.7,
    }],
  });

  assert.deepEqual(
    result.observedSeams.map((seam) => seam.category).sort(),
    ["floor_wall", "wall_ceiling"],
  );
  assert.deepEqual(
    result.adjacency.map((item) => item.seamId).sort(),
    ["floor_wall_visible", "wall_ceiling_visible"],
  );
  assert.equal(
    result.adjacency.some((item) => item.seamId === "unsupported_wall_split"),
    false,
  );
});

test("a seam crossing an opening is rejected and cannot create adjacency", () => {
  const result = contract({
    observedPlanes: [
      {
        id: "floor_a",
        category: "floor",
        imagePolygon: [
          { x: 0.1, y: 0.6 },
          { x: 0.9, y: 0.6 },
          { x: 1, y: 1 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
      wall("wall_a", 0.1, 0.9),
    ],
    observedOpenings: [{
      id: "door_a",
      category: "door",
      hostPlaneId: "wall_a",
      imageBoundary: [
        { x: 0.45, y: 0.4 },
        { x: 0.65, y: 0.4 },
        { x: 0.65, y: 0.8 },
        { x: 0.45, y: 0.8 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedSeams: [{
      id: "seam_through_door",
      category: "floor_wall",
      planeIds: ["floor_a", "wall_a"],
      imagePolyline: [{ x: 0.1, y: 0.6 }, { x: 0.9, y: 0.6 }],
      confidence: 0.9,
      visibility: "observed",
      boundaryEvidence: "architectural_break",
      gridCompatibility: "incompatible",
    }],
  });

  assert.equal(result.observedSeams.length, 0);
  assert.equal(result.adjacency.length, 0);
  assert.match(
    result.diagnostics.normalization.rejectedEvidence[0]?.reason ?? "",
    /crosses_visible_opening/,
  );
});

test("a discontinuity claim becomes unresolved when its only corner seam is rejected", () => {
  const result = contract({
    observedPlanes: [wall("wall_a", 0.1, 0.4), wall("wall_b", 0.4, 0.8)],
    observedGridFamilies: [
      grid("grid_wall_a", "wall_a", 0.2),
      grid("grid_wall_b", "wall_b", 0.5),
    ],
    observedOpenings: [{
      id: "opening_at_corner",
      category: "passage",
      hostPlaneId: null,
      imageBoundary: [
        { x: 0.36, y: 0.35 },
        { x: 0.44, y: 0.35 },
        { x: 0.44, y: 0.65 },
        { x: 0.36, y: 0.65 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedSeams: [{
      id: "unsupported_corner",
      category: "wall_wall",
      planeIds: ["wall_a", "wall_b"],
      imagePolyline: [{ x: 0.4, y: 0.1 }, { x: 0.4, y: 0.8 }],
      confidence: 0.9,
      visibility: "observed",
      boundaryEvidence: "architectural_break",
      gridCompatibility: "compatible",
    }],
    planeContinuity: [{
      ...continuity(),
      assessment: "discontinuous",
      boundaryEvidence: "architectural_break",
    }],
  });

  assert.equal(result.observedPlanes.length, 2);
  assert.equal(result.observedSeams.length, 0);
  assert.equal(result.adjacency.length, 0);
  assert.match(
    result.diagnostics.unresolved.join(" "),
    /discontinuous_continuity_claim_has_no_accepted_wall_wall_seam/,
  );
});
