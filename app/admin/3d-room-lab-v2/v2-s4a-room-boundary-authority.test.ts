import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_V2_EMPTY_ROOM_OBSERVATION_AUTHORITY,
  buildEmptyRoomObservationEvidence,
  buildFailedEmptyRoomObservationEvidence,
  type EmptyObservedSeam,
  type EmptyRoomObservationAcceptedEvidence,
} from "./empty-room-observation-contract";
import {
  constructAfcV2RoomBoundaryAuthority,
  type RoomBoundaryConstructionInput,
} from "./room-boundary-authority.server";
import {
  AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
  ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M,
  ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO,
  ROOM_BOUNDARY_VERTICAL_PLANE_NORMAL_Y_MAX,
  ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M,
  wallBaseDiagnosticsFromReceipt,
} from "./room-boundary-authority-contract";
import {
  evaluateInteriorHalfSpace,
  isNearVerticalFloorWallSeam,
} from "./room-boundary-qualification.server";
import { constructAfcV2RoomCollisionAuthority } from "./room-collision-qualification.server";
import { ROOM_COLLISION_REASON } from "./room-collision-authority-contract";

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

function providerObservation(overrides: Record<string, unknown> = {}) {
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
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
    ...overrides,
  };
}

function evidence(
  raw: unknown = providerObservation(),
): EmptyRoomObservationAcceptedEvidence {
  return buildEmptyRoomObservationEvidence(raw, {
    attemptId: "v2-s4a",
    loadGeneration: 3,
    emptyIdentity: {
      ...emptyIdentity,
      byteCount: 3,
      mimeType: "image/png",
    },
    originalAncestorSha256: originalIdentity.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-27T12:00:00.000Z",
  });
}

function cameraSnapshot() {
  return {
    verticalFovDeg: 52,
    pose: {
      position: { x: 0.4, y: 1.8, z: 4.2 },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
    frame: { width: 900, height: 600 },
  };
}

function construction(
  observation: RoomBoundaryConstructionInput["observation"] = evidence(),
  overrides: Partial<RoomBoundaryConstructionInput> = {},
): RoomBoundaryConstructionInput {
  return {
    attemptId: "v2-s4a",
    loadGeneration: 3,
    observation,
    emptyIdentity,
    originalIdentity,
    floor: {
      authorityKey: "floor-key",
      worldWidthM: 6,
      referenceDepthM: 4,
      widthDepthRatio: 1.5,
    },
    camera: cameraSnapshot(),
    freezeReceipt: {
      receiptVersion: "afc-sr1-calibrated-camera-freeze-receipt/v1",
      integrity: { payloadSha256: "f".repeat(64) },
    },
    ...overrides,
  };
}

test("accepted floor_wall publishes a finite Y=0 wall-base and vertical plane", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction());
  const candidate = receipt.candidates.find((item) =>
    item.sourceSeamId === "visible_floor_wall"
  );
  assert.ok(candidate);
  assert.equal(candidate.status, "accepted");
  assert.ok(candidate.worldGeometry);
  assert.equal(candidate.worldGeometry.baseStart.y, 0);
  assert.equal(candidate.worldGeometry.baseEnd.y, 0);
  assert.ok(
    Math.abs(candidate.worldGeometry.supportPlaneNormal.y) <=
      ROOM_BOUNDARY_VERTICAL_PLANE_NORMAL_Y_MAX,
  );
  const length = Math.hypot(
    candidate.worldGeometry.baseEnd.x - candidate.worldGeometry.baseStart.x,
    candidate.worldGeometry.baseEnd.z - candidate.worldGeometry.baseStart.z,
  );
  assert.ok(length >= ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M);
  assert.equal(candidate.limitations.observedSpanOnly, true);
  assert.equal(candidate.limitations.hiddenContinuation, false);
  assert.equal(candidate.limitations.completeWall, false);
  assert.equal(candidate.authority.collision, false);
  assert.equal(receipt.collisionAuthority, false);
  assert.equal(receipt.geometryManufactured, false);
});

test("non-floor_wall seams are skipped and cannot create authority", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedPlanes: [
        ...providerObservation().observedPlanes,
        {
          id: "visible_ceiling",
          category: "ceiling",
          sourceNormalizedPolygon: [
            { x: 0.2, y: 0.05 },
            { x: 0.8, y: 0.05 },
            { x: 0.75, y: 0.18 },
            { x: 0.25, y: 0.18 },
          ],
          confidence: 0.8,
          visibility: "observed",
        },
      ],
      observedSeams: [
        ...providerObservation().observedSeams as object[],
        {
          id: "visible_wall_ceiling",
          category: "wall_ceiling",
          planeIds: ["visible_wall", "visible_ceiling"],
          sourceNormalizedPolyline: [
            { x: 0.25, y: 0.18 },
            { x: 0.75, y: 0.18 },
          ],
          confidence: 0.8,
          visibility: "observed",
        },
      ],
    }),
  )));
  assert.equal(receipt.summary.skippedNonFloorWall, 1);
  assert.equal(
    receipt.candidates.some((candidate) =>
      candidate.source.category === "wall_ceiling"
    ),
    false,
  );
});

test("focused observer provenance cannot create world-boundary authority", () => {
  const base = evidence();
  const focusedSeam: EmptyObservedSeam = {
    ...base.observedSeams[0]!,
    id: "focused_floor_wall",
    observationSource: "focused_side_ceiling_wall",
  };
  const receipt = constructAfcV2RoomBoundaryAuthority(construction({
    ...base,
    observedSeams: [focusedSeam],
  }));
  assert.equal(receipt.candidates[0]?.status, "rejected");
  assert.match(
    receipt.candidates[0]?.reasons.join(" ") ?? "",
    /focused_observer_cannot_create_world_boundary/,
  );
  assert.equal(receipt.summary.accepted, 0);
});

test("focused side floor-wall provenance may be enumerated as a world-boundary candidate", () => {
  const base = evidence();
  const focusedSeam: EmptyObservedSeam = {
    ...base.observedSeams[0]!,
    id: "focused_side_floor_wall",
    observationSource: "focused_side_floor_wall_observer",
  };
  const receipt = constructAfcV2RoomBoundaryAuthority(construction({
    ...base,
    observedSeams: [focusedSeam],
  }));
  const candidate = receipt.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.source.observationSource, "focused_side_floor_wall_observer");
  assert.equal(
    candidate.reasons.includes("focused_observer_cannot_create_world_boundary"),
    false,
  );
});

test("missing plane binding does not accept", () => {
  const base = evidence();
  const receipt = constructAfcV2RoomBoundaryAuthority(construction({
    ...base,
    observedSeams: [{
      ...base.observedSeams[0]!,
      planeIds: ["visible_floor"],
    }],
  }));
  assert.equal(receipt.candidates[0]?.status, "rejected");
  assert.match(
    receipt.candidates[0]?.reasons.join(" ") ?? "",
    /invalid_or_missing_floor_wall_plane_binding/,
  );
});

test("observer ambiguity prevents acceptance", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [{
        ...providerObservation().observedSeams[0],
        ambiguity: "Could be trim rather than the floor-wall junction.",
      }],
    }),
  )));
  assert.notEqual(receipt.candidates[0]?.status, "accepted");
  assert.match(
    receipt.candidates[0]?.reasons.join(" ") ?? "",
    /observer_ambiguity_present/,
  );
});

test("near-vertical floor_wall fails closed", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [{
        id: "verticalish",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: [
          { x: 0.49, y: 0.2 },
          { x: 0.51, y: 0.8 },
        ],
        confidence: 0.7,
        visibility: "observed",
      }],
    }),
  )));
  assert.notEqual(receipt.candidates[0]?.status, "accepted");
  assert.match(
    receipt.candidates[0]?.reasons.join(" ") ?? "",
    /near_vertical_image_seam_insufficient_as_floor_wall/,
  );
});

test("N-point inconsistent polyline is not accepted", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [{
        id: "bent_seam",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: [
          { x: 0.2, y: 0.62 },
          { x: 0.5, y: 0.48 },
          { x: 0.8, y: 0.62 },
        ],
        confidence: 0.7,
        visibility: "observed",
      }],
    }),
  )));
  assert.notEqual(receipt.candidates[0]?.status, "accepted");
  assert.equal(receipt.candidates[0]?.imageEvidence.lineResidualClass, "underdetermined");
  assert.match(
    receipt.candidates[0]?.reasons.join(" ") ?? "",
    /seam_not_near_floor_polygon_frontier|seam_not_near_wall_polygon_frontier|image_line_residual_underdetermined/,
  );
  assert.equal(
    receipt.candidates[0]?.reasons.includes("image_line_inconsistent"),
    false,
  );
});

test("frame-adjacent truncated span is not automatically rejected", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [{
        id: "edge_span",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: [
          { x: 0.01, y: 0.62 },
          { x: 0.55, y: 0.62 },
        ],
        confidence: 0.88,
        visibility: "observed",
      }],
    }),
  )));
  assert.equal(receipt.candidates[0]?.limitations.frameAdjacentEndpoint, true);
  assert.notEqual(receipt.candidates[0]?.status, "rejected");
});

test("incompatible EMPTY↔Original fails closed", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(), {
    emptyIdentity: {
      ...emptyIdentity,
      decodedWidth: 1000,
      decodedHeight: 100,
    },
  }));
  assert.equal(
    receipt.lineage.emptyToOriginalCompatibility.tier,
    "incompatible",
  );
  assert.equal(receipt.summary.accepted, 0);
  assert.match(
    receipt.candidates[0]?.reasons.join(" ") ?? "",
    /empty_original_incompatible/,
  );
});

test("duplicate same-wall traces are both ambiguous and not averaged", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [
        {
          id: "trace_a",
          category: "floor_wall",
          planeIds: ["visible_floor", "visible_wall"],
          sourceNormalizedPolyline: [
            { x: 0.2, y: 0.62 },
            { x: 0.8, y: 0.62 },
          ],
          confidence: 0.95,
          visibility: "observed",
        },
        {
          id: "trace_b",
          category: "floor_wall",
          planeIds: ["visible_floor", "visible_wall"],
          sourceNormalizedPolyline: [
            { x: 0.25, y: 0.62 },
            { x: 0.75, y: 0.62 },
          ],
          confidence: 0.4,
          visibility: "observed",
        },
      ],
    }),
  )));
  const traces = receipt.candidates.filter((candidate) =>
    candidate.sourceSeamId === "trace_a" || candidate.sourceSeamId === "trace_b"
  );
  assert.equal(traces.length, 2);
  assert.equal(traces[0]?.status, "ambiguous");
  assert.equal(traces[1]?.status, "ambiguous");
  assert.ok(
    traces.every((candidate) =>
      candidate.reasons.includes("competing_same_wall_trace")
    ),
  );
  assert.equal(receipt.summary.accepted, 0);
  assert.equal(receipt.geometryManufactured, false);
});

test("two distinct angled walls may both accept without a synthesized corner", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedPlanes: [
        {
          id: "visible_floor",
          category: "floor",
          sourceNormalizedPolygon: [
            { x: 0.05, y: 0.95 },
            { x: 0.95, y: 0.95 },
            { x: 0.7, y: 0.58 },
            { x: 0.2, y: 0.7 },
          ],
          confidence: 0.9,
          visibility: "observed",
        },
        {
          id: "back_wall",
          category: "wall",
          sourceNormalizedPolygon: [
            { x: 0.2, y: 0.15 },
            { x: 0.8, y: 0.12 },
            { x: 0.7, y: 0.58 },
            { x: 0.22, y: 0.58 },
          ],
          confidence: 0.88,
          visibility: "observed",
        },
        {
          id: "side_wall",
          category: "wall",
          sourceNormalizedPolygon: [
            { x: 0.02, y: 0.2 },
            { x: 0.22, y: 0.15 },
            { x: 0.2, y: 0.7 },
            { x: 0.04, y: 0.92 },
          ],
          confidence: 0.86,
          visibility: "observed",
        },
      ],
      observedSeams: [
        {
          id: "back_floor_wall",
          category: "floor_wall",
          planeIds: ["visible_floor", "back_wall"],
          sourceNormalizedPolyline: [
            { x: 0.22, y: 0.58 },
            { x: 0.7, y: 0.58 },
          ],
          confidence: 0.9,
          visibility: "observed",
        },
        {
          id: "side_floor_wall",
          category: "floor_wall",
          planeIds: ["visible_floor", "side_wall"],
          sourceNormalizedPolyline: [
            { x: 0.04, y: 0.92 },
            { x: 0.2, y: 0.7 },
          ],
          confidence: 0.88,
          visibility: "observed",
        },
      ],
    }),
  )));
  const accepted = receipt.candidates.filter((candidate) =>
    candidate.status === "accepted"
  );
  if (accepted.length === 2) {
    const [first, second] = accepted;
    const dx1 = first.worldGeometry!.baseEnd.x - first.worldGeometry!.baseStart.x;
    const dz1 = first.worldGeometry!.baseEnd.z - first.worldGeometry!.baseStart.z;
    const dx2 = second.worldGeometry!.baseEnd.x - second.worldGeometry!.baseStart.x;
    const dz2 = second.worldGeometry!.baseEnd.z - second.worldGeometry!.baseStart.z;
    const mag1 = Math.hypot(dx1, dz1);
    const mag2 = Math.hypot(dx2, dz2);
    const absDot = Math.abs((dx1 * dx2 + dz1 * dz2) / (mag1 * mag2));
    assert.ok(absDot < 0.85);
  }
  assert.equal(
    receipt.candidates.some((candidate) =>
      candidate.reasons.includes("synthesized_corner")
    ),
    false,
  );
});

test("interior uses the floor witness and camera cannot override it", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction());
  const candidate = receipt.candidates[0];
  assert.ok(candidate);
  if (candidate.status === "accepted") {
    assert.ok(
      candidate.interior.status === "accepted" ||
        candidate.interior.status === "insufficient",
    );
    if (candidate.interior.cameraContradictsWitness) {
      assert.equal(candidate.interior.status, "insufficient");
      assert.ok(candidate.authority.baseSegment);
    }
    if (candidate.interior.status === "accepted") {
      assert.ok(candidate.interior.witnessImagePoint);
      assert.ok(candidate.interior.witnessWorldPoint);
      assert.ok(candidate.interior.sideSign === 1 || candidate.interior.sideSign === -1);
    }
  }
  assert.equal(candidate.authority.collision, false);
});

test("failed observation still yields a fail-closed receipt and keeps observation_only", () => {
  const failed = buildFailedEmptyRoomObservationEvidence({
    attemptId: "v2-s4a",
    loadGeneration: 3,
    emptyIdentity: {
      ...emptyIdentity,
      byteCount: 3,
      mimeType: "image/png",
    },
    originalAncestorSha256: originalIdentity.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-27T12:00:00.000Z",
  }, {
    failureClass: "transport",
    failureStage: "provider_invocation",
    provider: "controlled_fixture",
    model: "fixture",
    providerStatus: null,
    safeDetail: "controlled",
    contractValidationReason: null,
  });
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(failed));
  assert.equal(receipt.summary.accepted, 0);
  assert.equal(receipt.candidates.length, 0);
  assert.equal(receipt.lineage.observation.authority, AFC_V2_EMPTY_ROOM_OBSERVATION_AUTHORITY);
  assert.equal(receipt.lineage.observation.worldProjectionPerformed, false);
  assert.equal(failed.authority, "observation_only");
  assert.equal(failed.authoritySeparation.worldProjectionPerformed, false);
});

test("receipt retains unsuccessful candidates, lineage, and diagnostic wall-base mapping", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [{
        ...providerObservation().observedSeams[0],
        ambiguity: "uncertain",
      }],
    }),
  )));
  assert.equal(receipt.schemaVersion, AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION);
  assert.equal(receipt.candidates.length, 1);
  assert.ok(receipt.candidates[0]!.reasons.length > 0);
  assert.equal(receipt.lineage.floor.authorityKey, "floor-key");
  assert.equal(receipt.lineage.camera.verticalFovDeg, 52);
  assert.ok(receipt.lineage.emptyToOriginalCompatibility.tier);
  const diagnostics = wallBaseDiagnosticsFromReceipt(receipt);
  assert.equal(diagnostics.length, receipt.summary.accepted);
});

test("world residual threshold is an explicit named constant", () => {
  assert.equal(ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M, 0.05);
});

test("residual-underdetermined multi-point preserves observed endpoint span", () => {
  const polyline = [
    { x: 0.2, y: 0.62 },
    { x: 0.5, y: 0.6305 },
    { x: 0.8, y: 0.62 },
  ];
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [{
        id: "wiggle_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: polyline,
        confidence: 0.9,
        visibility: "observed",
      }],
    }),
  )));
  const candidate = receipt.candidates[0];
  assert.ok(candidate);
  assert.ok((candidate.imageEvidence.lineResidual?.maxDistance ?? 0) >
    0.006, `residual=${candidate.imageEvidence.lineResidual?.maxDistance}`);
  assert.equal(candidate.imageEvidence.lineResidualClass, "underdetermined");
  assert.ok(
    candidate.worldGeometry,
    `status=${candidate.status} reasons=${candidate.reasons.join(",")}`,
  );
  assert.equal(candidate.limitations.hiddenContinuation, false);
  assert.equal(candidate.limitations.geometryManufactured, false);
  assert.equal(receipt.geometryManufactured, false);
  assert.match(
    candidate.reasons.join(" "),
    /image_line_residual_underdetermined/,
  );
  assert.equal(candidate.reasons.includes("image_line_inconsistent"), false);
  assert.equal(candidate.status, "accepted");
  assert.equal(candidate.authority.baseSegment, true);
  assert.equal(candidate.authority.supportPlane, true);
});

test("residual-supported multi-point remains accepted without residual-underdetermined reasons", () => {
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
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
    }),
  )));
  const candidate = receipt.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.status, "accepted");
  assert.equal(candidate.imageEvidence.lineResidualClass, "supported");
  assert.ok((candidate.imageEvidence.lineResidual?.maxDistance ?? 1) <= 0.006);
  assert.equal(
    candidate.reasons.includes("image_line_residual_underdetermined"),
    false,
  );
  assert.equal(candidate.limitations.hiddenContinuation, false);
  assert.equal(candidate.limitations.geometryManufactured, false);
  assert.ok(candidate.worldGeometry);
});

const steepFloorPolygon = [
  { x: 0.160, y: 0.64 },
  { x: 0.90, y: 0.64 },
  { x: 0.99, y: 0.98 },
  { x: 0.127, y: 0.98 },
];
const steepWallPolygon = [
  { x: 0.02, y: 0.12 },
  { x: 0.18, y: 0.12 },
  { x: 0.160, y: 0.64 },
  { x: 0.127, y: 0.98 },
  { x: 0.02, y: 0.90 },
];
const steepSeamPolyline = [
  { x: 0.127, y: 0.98 },
  { x: 0.160, y: 0.64 },
];

function steepSideObservation(overrides: Record<string, unknown> = {}) {
  return providerObservation({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: steepFloorPolygon,
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_side_wall",
        category: "wall",
        sourceNormalizedPolygon: steepWallPolygon,
        confidence: 0.91,
        visibility: "observed",
      },
    ],
    observedSeams: [{
      id: "visible_side_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_side_wall"],
      sourceNormalizedPolyline: steepSeamPolyline,
      confidence: 0.9,
      visibility: "observed",
    }],
    ...overrides,
  });
}

function steepSideReceipt(
  observationOverrides: Record<string, unknown> = {},
  constructionOverrides: Partial<RoomBoundaryConstructionInput> = {},
) {
  return constructAfcV2RoomBoundaryAuthority(construction(
    evidence(steepSideObservation(observationOverrides)),
    constructionOverrides,
  ));
}

function assertNearVerticalInsufficient(receipt: ReturnType<typeof steepSideReceipt>) {
  const candidate = receipt.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.imageEvidence.nearVertical, true);
  assert.notEqual(candidate.status, "accepted");
  assert.ok(
    candidate.reasons.includes("near_vertical_image_seam_insufficient_as_floor_wall") ||
      candidate.reasons.includes("invalid_or_missing_floor_wall_plane_binding") ||
      candidate.reasons.includes("observer_ambiguity_present") ||
      candidate.reasons.includes("floor_and_wall_occupancy_not_opposite") ||
      candidate.reasons.includes("seam_not_near_floor_polygon_frontier") ||
      candidate.reasons.includes("seam_not_near_wall_polygon_frontier"),
  );
  assert.equal(candidate.authority.collision, false);
}

test("strong near-vertical floor-wall continues without the insufficiency reason", () => {
  assert.equal(ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO, 0.1);
  assert.equal(isNearVerticalFloorWallSeam(steepSeamPolyline), true);
  const receipt = steepSideReceipt();
  const candidate = receipt.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.imageEvidence.nearVertical, true);
  assert.equal(
    candidate.reasons.includes("near_vertical_image_seam_insufficient_as_floor_wall"),
    false,
  );
  assert.equal(candidate.status, "accepted");
  assert.equal(candidate.imageEvidence.occupancy?.opposite, true);
  assert.equal(candidate.imageEvidence.frontier?.nearFloorFrontier, true);
  assert.equal(candidate.imageEvidence.frontier?.nearWallFrontier, true);
  assert.equal(candidate.interior.status, "accepted");
  assert.equal(candidate.authority.collision, false);
  assert.equal(receipt.collisionAuthority, false);
  assert.equal(candidate.limitations.geometryManufactured, false);
  assert.equal(candidate.limitations.hiddenContinuation, false);
  assert.equal(receipt.geometryManufactured, false);
});

test("near-vertical without opposite occupancy keeps the insufficiency veto", () => {
  const receipt = steepSideReceipt({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: steepFloorPolygon,
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_side_wall",
        category: "wall",
        sourceNormalizedPolygon: steepFloorPolygon,
        confidence: 0.91,
        visibility: "observed",
      },
    ],
  });
  assertNearVerticalInsufficient(receipt);
  assert.match(
    receipt.candidates[0]?.reasons.join(" ") ?? "",
    /near_vertical_image_seam_insufficient_as_floor_wall|floor_and_wall_occupancy_not_opposite/,
  );
});

test("near-vertical without floor frontier stays insufficient", () => {
  const receipt = steepSideReceipt({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0.55, y: 0.88 },
          { x: 0.98, y: 0.88 },
          { x: 0.98, y: 0.99 },
          { x: 0.55, y: 0.99 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_side_wall",
        category: "wall",
        sourceNormalizedPolygon: steepWallPolygon,
        confidence: 0.91,
        visibility: "observed",
      },
    ],
  });
  assertNearVerticalInsufficient(receipt);
  assert.equal(
    receipt.candidates[0]?.imageEvidence.frontier?.nearFloorFrontier,
    false,
  );
});

test("near-vertical without wall frontier stays insufficient", () => {
  const receipt = steepSideReceipt({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: steepFloorPolygon,
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_side_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.01, y: 0.12 },
          { x: 0.06, y: 0.12 },
          { x: 0.06, y: 0.90 },
          { x: 0.01, y: 0.90 },
        ],
        confidence: 0.91,
        visibility: "observed",
      },
    ],
  });
  assertNearVerticalInsufficient(receipt);
  assert.equal(
    receipt.candidates[0]?.imageEvidence.frontier?.nearWallFrontier,
    false,
  );
});

test("near-vertical with observer ambiguity is not overridden", () => {
  const receipt = steepSideReceipt({
    observedSeams: [{
      id: "visible_side_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_side_wall"],
      sourceNormalizedPolyline: steepSeamPolyline,
      confidence: 0.9,
      visibility: "observed",
      ambiguity: "Could be a door jamb rather than the floor-wall junction.",
    }],
  });
  assertNearVerticalInsufficient(receipt);
  assert.match(
    receipt.candidates[0]?.reasons.join(" ") ?? "",
    /observer_ambiguity_present/,
  );
});

test("near-vertical does not override wrong plane binding", () => {
  const base = evidence(steepSideObservation());
  const missingWall = constructAfcV2RoomBoundaryAuthority(construction({
    ...base,
    observedSeams: [{
      ...base.observedSeams[0]!,
      planeIds: ["visible_floor"],
    }],
  }));
  assert.equal(missingWall.candidates[0]?.status, "rejected");
  assert.equal(missingWall.candidates[0]?.imageEvidence.nearVertical, true);
  assert.match(
    missingWall.candidates[0]?.reasons.join(" ") ?? "",
    /invalid_or_missing_floor_wall_plane_binding/,
  );
  assert.notEqual(missingWall.candidates[0]?.status, "accepted");
  const twoWalls = constructAfcV2RoomBoundaryAuthority(construction({
    ...base,
    observedPlanes: [
      ...base.observedPlanes,
      {
        ...base.observedPlanes[1]!,
        id: "visible_other_wall",
      },
    ],
    observedSeams: [{
      ...base.observedSeams[0]!,
      planeIds: ["visible_side_wall", "visible_other_wall"],
    }],
  }));
  assert.equal(twoWalls.candidates[0]?.status, "rejected");
  assert.match(
    twoWalls.candidates[0]?.reasons.join(" ") ?? "",
    /invalid_or_missing_floor_wall_plane_binding/,
  );
});

test("door jamb and window jamb style vertical lines fail closed", () => {
  const jamb = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [{
        id: "door_jamb",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: [
          { x: 0.48, y: 0.22 },
          { x: 0.50, y: 0.78 },
        ],
        confidence: 0.7,
        visibility: "observed",
      }],
    }),
  )));
  assertNearVerticalInsufficient(jamb);
  const windowJamb = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [{
        id: "window_jamb",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: [
          { x: 0.62, y: 0.18 },
          { x: 0.64, y: 0.55 },
        ],
        confidence: 0.7,
        visibility: "observed",
      }],
    }),
  )));
  assertNearVerticalInsufficient(windowJamb);
});

test("radiator vertical edge and floor-interior steep line fail closed", () => {
  const radiator = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [{
        id: "radiator_edge",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: [
          { x: 0.31, y: 0.28 },
          { x: 0.33, y: 0.52 },
        ],
        confidence: 0.7,
        visibility: "observed",
      }],
    }),
  )));
  assertNearVerticalInsufficient(radiator);
  const floorInterior = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedSeams: [{
        id: "floor_interior_steep",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: [
          { x: 0.48, y: 0.72 },
          { x: 0.50, y: 0.95 },
        ],
        confidence: 0.7,
        visibility: "observed",
      }],
    }),
  )));
  assertNearVerticalInsufficient(floorInterior);
});

test("frame-truncated steep side floor-wall continues without a junction", () => {
  const truncatedSeam = [
    { x: 0.012, y: 0.995 },
    { x: 0.044, y: 0.66 },
  ];
  const receipt = steepSideReceipt({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0.044, y: 0.66 },
          { x: 0.88, y: 0.66 },
          { x: 0.99, y: 0.995 },
          { x: 0.012, y: 0.995 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_side_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.01, y: 0.12 },
          { x: 0.08, y: 0.12 },
          { x: 0.044, y: 0.66 },
          { x: 0.012, y: 0.995 },
          { x: 0.01, y: 0.90 },
        ],
        confidence: 0.91,
        visibility: "observed",
      },
    ],
    observedSeams: [{
      id: "visible_side_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_side_wall"],
      sourceNormalizedPolyline: truncatedSeam,
      confidence: 0.9,
      visibility: "observed",
    }],
  });
  const candidate = receipt.candidates[0];
  assert.ok(candidate);
  assert.equal(isNearVerticalFloorWallSeam(truncatedSeam), true);
  assert.equal(candidate.imageEvidence.nearVertical, true);
  assert.equal(candidate.limitations.frameAdjacentEndpoint, true);
  assert.equal(
    candidate.reasons.includes("near_vertical_image_seam_insufficient_as_floor_wall"),
    false,
  );
  assert.notEqual(candidate.status, "rejected");
});

test("strong steep seam continues with or without an explicit room_corner", () => {
  const withoutCorner = steepSideReceipt({ observedJunctions: [] });
  assert.equal(
    withoutCorner.candidates[0]?.reasons.includes(
      "near_vertical_image_seam_insufficient_as_floor_wall",
    ),
    false,
  );
  assert.equal(withoutCorner.candidates[0]?.status, "accepted");
  const withCorner = steepSideReceipt({
    observedJunctions: [{
      id: "visible_room_corner",
      category: "room_corner",
      sourceNormalizedPoint: { x: 0.160, y: 0.64 },
      seamIds: ["visible_side_floor_wall"],
      openingIds: [],
      confidence: 0.9,
      visibility: "observed",
    }],
  });
  assert.equal(
    withCorner.candidates[0]?.reasons.includes(
      "near_vertical_image_seam_insufficient_as_floor_wall",
    ),
    false,
  );
  assert.equal(withCorner.candidates[0]?.status, "accepted");
});

test("world projection failure after near-vertical continuation still fails", () => {
  const receipt = steepSideReceipt({}, {
    camera: {
      verticalFovDeg: 52,
      pose: {
        position: { x: 0.4, y: 1.8, z: 4.2 },
        lookAt: { x: 0.4, y: 8, z: 4.2 },
        up: { x: 0, y: 0, z: -1 },
      },
      frame: { width: 900, height: 600 },
    },
  });
  const candidate = receipt.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.imageEvidence.nearVertical, true);
  assert.equal(
    candidate.reasons.includes("near_vertical_image_seam_insufficient_as_floor_wall"),
    false,
  );
  assert.notEqual(candidate.status, "accepted");
  assert.match(candidate.reasons.join(" "), /projection_failed/);
});

test("interior witness failure after near-vertical continuation still fails", () => {
  const receipt = steepSideReceipt({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0.160, y: 0.64 },
          { x: 0.172, y: 0.64 },
          { x: 0.139, y: 0.98 },
          { x: 0.127, y: 0.98 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_side_wall",
        category: "wall",
        sourceNormalizedPolygon: steepWallPolygon,
        confidence: 0.91,
        visibility: "observed",
      },
    ],
  });
  const candidate = receipt.candidates[0];
  assert.ok(candidate);
  assert.equal(
    candidate.reasons.includes("near_vertical_image_seam_insufficient_as_floor_wall"),
    false,
  );
  assert.notEqual(candidate.interior.status, "accepted");
  assert.equal(candidate.authority.collision, false);
  assert.match(candidate.reasons.join(" "), /interior_witness/);
});

test("camera contradiction after near-vertical continuation still fails", () => {
  const receipt = steepSideReceipt();
  const candidate = receipt.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.status, "accepted");
  assert.ok(candidate.worldGeometry);
  assert.ok(candidate.interior.witnessWorldPoint);
  const normal = candidate.worldGeometry.supportPlaneNormal;
  const oppositeCamera = {
    verticalFovDeg: 52,
    pose: {
      position: {
        x: normal.x * 4,
        y: 1.8,
        z: normal.z * 4,
      },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
    frame: { width: 900, height: 600 },
  };
  const interior = evaluateInteriorHalfSpace({
    occupancy: candidate.imageEvidence.occupancy,
    polyline: candidate.imageEvidence.polyline,
    floorPolygon: steepFloorPolygon,
    wallPolygon: steepWallPolygon,
    geometry: candidate.worldGeometry,
    camera: oppositeCamera,
    projectWitness: () => candidate.interior.witnessWorldPoint,
  });
  const cameraAgrees = interior.cameraSideSign === interior.sideSign &&
    (interior.cameraSideSign === 1 || interior.cameraSideSign === -1);
  if (cameraAgrees) {
    const flipped = evaluateInteriorHalfSpace({
      occupancy: candidate.imageEvidence.occupancy,
      polyline: candidate.imageEvidence.polyline,
      floorPolygon: steepFloorPolygon,
      wallPolygon: steepWallPolygon,
      geometry: candidate.worldGeometry,
      camera: {
        ...oppositeCamera,
        pose: {
          ...oppositeCamera.pose,
          position: {
            x: -normal.x * 4,
            y: 1.8,
            z: -normal.z * 4,
          },
        },
      },
      projectWitness: () => candidate.interior.witnessWorldPoint,
    });
    assert.equal(flipped.cameraContradictsWitness, true);
    assert.equal(flipped.status, "insufficient");
  } else {
    assert.equal(interior.cameraContradictsWitness, true);
    assert.equal(interior.status, "insufficient");
  }
  const s4b = constructAfcV2RoomCollisionAuthority({
    roomBoundary: {
      ...receipt,
      candidates: receipt.candidates.map((item) => ({
        ...item,
        interior: {
          ...item.interior,
          status: "insufficient" as const,
          cameraContradictsWitness: true,
          cameraSideSign: item.interior.sideSign === -1 ? 1 as const : -1 as const,
        },
      })),
    },
    observation: evidence(steepSideObservation()),
  });
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.interiorCameraNotCorroborated,
    ) ||
      s4b.boundaries[0]?.qualificationReasons.includes(
        ROOM_COLLISION_REASON.interiorNotCollisionReady,
      ),
  );
});

test("S4B regional contradiction and opening crossing still disable collision", () => {
  const accepted = steepSideReceipt();
  assert.equal(accepted.candidates[0]?.status, "accepted");
  const sameSideWall = constructAfcV2RoomCollisionAuthority({
    roomBoundary: accepted,
    observation: evidence(steepSideObservation({
      observedPlanes: [
        {
          id: "visible_floor",
          category: "floor",
          sourceNormalizedPolygon: steepFloorPolygon,
          confidence: 0.94,
          visibility: "observed",
        },
        {
          id: "visible_side_wall",
          category: "wall",
          sourceNormalizedPolygon: steepFloorPolygon,
          confidence: 0.91,
          visibility: "observed",
        },
      ],
    })),
  });
  assert.equal(sameSideWall.boundaries[0]?.collisionEnabled, false);
  assert.ok(
    sameSideWall.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
  const openingObservation = evidence(steepSideObservation({
    observedOpenings: [{
      id: "doorway",
      category: "doorway",
      hostPlaneId: "visible_side_wall",
      sourceNormalizedBoundary: [
        { x: 0.10, y: 0.74 },
        { x: 0.22, y: 0.74 },
        { x: 0.22, y: 0.88 },
        { x: 0.10, y: 0.88 },
      ],
      boundaryClosure: "complete_visible_outline",
      boundaryEvidenceCompleteness: "all_edges_visibly_traced",
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
  const opening = constructAfcV2RoomCollisionAuthority({
    roomBoundary: accepted,
    observation: openingObservation,
  });
  assert.equal(opening.boundaries[0]?.collisionEnabled, false);
  assert.ok(
    opening.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.seamCrossesReportedOpening,
    ),
  );
});

test("non-steep back/right and side positives remain unchanged", () => {
  const back = constructAfcV2RoomBoundaryAuthority(construction());
  assert.equal(back.candidates[0]?.imageEvidence.nearVertical, false);
  assert.equal(back.candidates[0]?.status, "accepted");
  assert.equal(
    back.candidates[0]?.reasons.includes(
      "near_vertical_image_seam_insufficient_as_floor_wall",
    ),
    false,
  );
  const side = constructAfcV2RoomBoundaryAuthority(construction(evidence(
    providerObservation({
      observedPlanes: [
        {
          id: "visible_floor",
          category: "floor",
          sourceNormalizedPolygon: [
            { x: 0.05, y: 0.95 },
            { x: 0.95, y: 0.95 },
            { x: 0.7, y: 0.58 },
            { x: 0.2, y: 0.7 },
          ],
          confidence: 0.9,
          visibility: "observed",
        },
        {
          id: "side_wall",
          category: "wall",
          sourceNormalizedPolygon: [
            { x: 0.02, y: 0.2 },
            { x: 0.22, y: 0.15 },
            { x: 0.2, y: 0.7 },
            { x: 0.04, y: 0.92 },
          ],
          confidence: 0.86,
          visibility: "observed",
        },
      ],
      observedSeams: [{
        id: "side_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "side_wall"],
        sourceNormalizedPolyline: [
          { x: 0.04, y: 0.92 },
          { x: 0.2, y: 0.7 },
        ],
        confidence: 0.88,
        visibility: "observed",
      }],
    }),
  )));
  assert.equal(isNearVerticalFloorWallSeam([
    { x: 0.04, y: 0.92 },
    { x: 0.2, y: 0.7 },
  ]), false);
  assert.equal(side.candidates[0]?.imageEvidence.nearVertical, false);
  assert.equal(
    side.candidates[0]?.reasons.includes(
      "near_vertical_image_seam_insufficient_as_floor_wall",
    ),
    false,
  );
});

test("strong near-vertical S4A to S4B enables collision only with intact proof", () => {
  const observation = evidence(steepSideObservation());
  const s4a = constructAfcV2RoomBoundaryAuthority(construction(observation));
  assert.equal(s4a.candidates[0]?.status, "accepted");
  assert.equal(s4a.candidates[0]?.imageEvidence.nearVertical, true);
  assert.equal(s4a.candidates[0]?.interior.status, "accepted");
  assert.equal(s4a.collisionAuthority, false);
  const s4b = constructAfcV2RoomCollisionAuthority({
    roomBoundary: s4a,
    observation,
  });
  assert.equal(s4b.boundaries[0]?.status, "accepted");
  assert.equal(s4b.boundaries[0]?.collisionEnabled, true);
  assert.equal(s4b.boundaries[0]?.corroboration.kind, "multi_probe_region_frontier");
  assert.equal(s4b.geometryManufactured, false);
  assert.equal(s4b.hiddenContinuation, false);

  const occupancyFalse = constructAfcV2RoomCollisionAuthority({
    roomBoundary: steepSideReceipt({
      observedPlanes: [
        {
          id: "visible_floor",
          category: "floor",
          sourceNormalizedPolygon: steepFloorPolygon,
          confidence: 0.94,
          visibility: "observed",
        },
        {
          id: "visible_side_wall",
          category: "wall",
          sourceNormalizedPolygon: steepFloorPolygon,
          confidence: 0.91,
          visibility: "observed",
        },
      ],
    }),
    observation,
  });
  assert.equal(occupancyFalse.boundaries[0]?.collisionEnabled, false);

  const floorFrontierFalse = constructAfcV2RoomCollisionAuthority({
    roomBoundary: steepSideReceipt({
      observedPlanes: [
        {
          id: "visible_floor",
          category: "floor",
          sourceNormalizedPolygon: [
            { x: 0.55, y: 0.88 },
            { x: 0.98, y: 0.88 },
            { x: 0.98, y: 0.99 },
            { x: 0.55, y: 0.99 },
          ],
          confidence: 0.94,
          visibility: "observed",
        },
        {
          id: "visible_side_wall",
          category: "wall",
          sourceNormalizedPolygon: steepWallPolygon,
          confidence: 0.91,
          visibility: "observed",
        },
      ],
    }),
    observation,
  });
  assert.equal(floorFrontierFalse.boundaries[0]?.collisionEnabled, false);

  const wallFrontierFalse = constructAfcV2RoomCollisionAuthority({
    roomBoundary: steepSideReceipt({
      observedPlanes: [
        {
          id: "visible_floor",
          category: "floor",
          sourceNormalizedPolygon: steepFloorPolygon,
          confidence: 0.94,
          visibility: "observed",
        },
        {
          id: "visible_side_wall",
          category: "wall",
          sourceNormalizedPolygon: [
            { x: 0.01, y: 0.12 },
            { x: 0.06, y: 0.12 },
            { x: 0.06, y: 0.90 },
            { x: 0.01, y: 0.90 },
          ],
          confidence: 0.91,
          visibility: "observed",
        },
      ],
    }),
    observation,
  });
  assert.equal(wallFrontierFalse.boundaries[0]?.collisionEnabled, false);

  const ambiguous = constructAfcV2RoomCollisionAuthority({
    roomBoundary: steepSideReceipt({
      observedSeams: [{
        id: "visible_side_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_side_wall"],
        sourceNormalizedPolyline: steepSeamPolyline,
        confidence: 0.9,
        visibility: "observed",
        ambiguity: "Could be trim rather than the floor-wall junction.",
      }],
    }),
    observation,
  });
  assert.equal(ambiguous.boundaries[0]?.collisionEnabled, false);
});
