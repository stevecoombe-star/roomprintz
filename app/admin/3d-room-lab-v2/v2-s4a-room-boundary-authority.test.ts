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
  ROOM_BOUNDARY_VERTICAL_PLANE_NORMAL_Y_MAX,
  ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M,
  wallBaseDiagnosticsFromReceipt,
} from "./room-boundary-authority-contract";

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
  assert.match(
    receipt.candidates[0]?.reasons.join(" ") ?? "",
    /image_line_inconsistent/,
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
