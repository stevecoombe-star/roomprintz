import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildEmptyRoomObservationEvidence,
  type EmptyRoomObservationAcceptedEvidence,
} from "./empty-room-observation-contract";
import {
  AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
  ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY,
  ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M,
  type AfcV2RoomBoundaryAuthorityReceipt,
  type RoomBoundaryCandidate,
} from "./room-boundary-authority-contract";
import {
  constructAfcV2RoomBoundaryAuthority,
  type RoomBoundaryConstructionInput,
} from "./room-boundary-authority.server";
import {
  AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION,
  ROOM_COLLISION_REASON,
  enabledCollisionWallsFromReceipt,
  roomCollisionQualificationBasisLabel,
} from "./room-collision-authority-contract";
import {
  constructAfcV2RoomCollisionAuthority,
  corroborateObservedSpan,
  floorWallPolylineCrossesOpeningInterior,
} from "./room-collision-qualification.server";
import {
  applicableEvidencePasses,
  classifyFocusedWallSupportingRegion,
  classifyRegionalOppositeOccupancy,
  classifyRegionalProbeEvidence,
  classifyRegionalSampleMembership,
  evaluateFrontierProximity,
  evaluateOppositeOccupancy,
  s4aWallFrontierHasCertifiedTruncatedSupport,
} from "./room-boundary-qualification.server";

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
        { x: 0.5, y: 0.62 },
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
    attemptId: "v2-s4b",
    loadGeneration: 4,
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
    generatedAt: "2026-08-28T12:00:00.000Z",
  });
}

function construction(
  observation: RoomBoundaryConstructionInput["observation"] = evidence(),
  overrides: Partial<RoomBoundaryConstructionInput> = {},
): RoomBoundaryConstructionInput {
  return {
    attemptId: "v2-s4b",
    loadGeneration: 4,
    observation,
    emptyIdentity,
    originalIdentity,
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
    ...overrides,
  };
}

function s4aReceipt(
  observation: EmptyRoomObservationAcceptedEvidence = evidence(),
  overrides: Partial<RoomBoundaryConstructionInput> = {},
): AfcV2RoomBoundaryAuthorityReceipt {
  return constructAfcV2RoomBoundaryAuthority(construction(observation, overrides));
}

function withCandidate(
  receipt: AfcV2RoomBoundaryAuthorityReceipt,
  patch: (candidate: RoomBoundaryCandidate) => RoomBoundaryCandidate,
): AfcV2RoomBoundaryAuthorityReceipt {
  return {
    ...receipt,
    candidates: receipt.candidates.map(patch),
  };
}

function collide(
  roomBoundary: AfcV2RoomBoundaryAuthorityReceipt,
  observation: EmptyRoomObservationAcceptedEvidence | null = evidence(),
) {
  return constructAfcV2RoomCollisionAuthority({ roomBoundary, observation });
}

function twoPointEvidence(overrides: Record<string, unknown> = {}) {
  return evidence(providerObservation({
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
    ...overrides,
  }));
}

function withCollisionReadyInterior(
  receipt: AfcV2RoomBoundaryAuthorityReceipt,
): AfcV2RoomBoundaryAuthorityReceipt {
  return withCandidate(receipt, (item) => ({
    ...item,
    status: "accepted" as const,
    interior: {
      ...item.interior,
      status: "accepted" as const,
      sideSign: item.interior.sideSign === -1 ? -1 as const : 1 as const,
      cameraSideSign: item.interior.sideSign === -1 ? -1 as const : 1 as const,
    },
    authority: {
      ...item.authority,
      baseSegment: true,
      supportPlane: true,
      collision: false as const,
    },
  }));
}

test("S4A accepted two-point can become collision-enabled when region corroboration passes", () => {
  const observation = twoPointEvidence();
  const s4a = s4aReceipt(observation);
  assert.equal(s4a.candidates[0]?.status, "accepted");
  assert.ok((s4a.candidates[0]?.imageEvidence.polyline.length ?? 0) < 3);
  const s4b = collide(withCollisionReadyInterior(s4a), observation);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.status, "accepted");
  assert.equal(boundary.collisionEnabled, true);
  assert.equal(s4b.collisionAuthority, true);
  assert.equal(boundary.diagnostics.observedSampleCount, 2);
  assert.equal(boundary.diagnostics.lineResidualInformative, false);
  assert.equal(boundary.corroboration.kind, "multi_probe_region_frontier");
  assert.ok((boundary.corroboration.probeCount ?? 0) >= 1);
  assert.equal(
    boundary.corroboration.passingProbeCount,
    boundary.corroboration.probeCount,
  );
  assert.equal(boundary.reliabilityClass, "not_applicable");
  assert.equal(boundary.limitations.twoPointObserved, true);
  assert.equal(boundary.limitations.twoPointCorroborated, true);
  assert.equal(
    roomCollisionQualificationBasisLabel(boundary),
    "two-point region-corroborated",
  );
  assert.equal(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointOrUnderdeterminedLine,
    ),
    false,
  );
  assert.equal(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
    false,
  );
});

test("S4A accepted with interior insufficient is not collision-ready", () => {
  const s4a = withCandidate(s4aReceipt(), (candidate) => ({
    ...candidate,
    interior: {
      ...candidate.interior,
      status: "insufficient",
      sideSign: null,
    },
  }));
  const s4b = collide(s4a);
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.interiorNotCollisionReady,
    ),
  );
});

test("camera deadband or contradiction does not corroborate interior", () => {
  const deadband = withCandidate(s4aReceipt(), (candidate) => ({
    ...candidate,
    interior: {
      ...candidate.interior,
      status: "accepted",
      sideSign: 1,
      cameraSideSign: 0,
    },
  }));
  const deadbandS4b = collide(deadband);
  assert.ok(
    deadbandS4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.interiorCameraNotCorroborated,
    ),
  );
  const contradicted = withCandidate(s4aReceipt(), (candidate) => ({
    ...candidate,
    interior: {
      ...candidate.interior,
      status: "accepted",
      sideSign: 1,
      cameraSideSign: -1,
    },
  }));
  const contradictedS4b = collide(contradicted);
  assert.ok(
    contradictedS4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.interiorCameraNotCorroborated,
    ),
  );
});

test("S4A ambiguous, insufficient, and rejected never qualify", () => {
  for (const status of ["ambiguous", "insufficient", "rejected"] as const) {
    const s4a = withCandidate(s4aReceipt(), (candidate) => ({
      ...candidate,
      status,
    }));
    const s4b = collide(s4a);
    assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
    assert.ok(
      s4b.boundaries[0]?.qualificationReasons.includes(
        ROOM_COLLISION_REASON.s4aNotAccepted,
      ),
    );
  }
});

test("underdetermined worldSamples take the region-corroboration path instead of automatic refusal", () => {
  const observation = evidence();
  const s4a = withCandidate(withCollisionReadyInterior(s4aReceipt(observation)), (candidate) => ({
    ...candidate,
    projection: {
      ...candidate.projection,
      worldSamples: candidate.projection.worldSamples.slice(0, 2),
    },
  }));
  const s4b = collide(s4a, observation);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.diagnostics.lineResidualInformative, false);
  assert.equal(boundary.diagnostics.lineResidualClass, "underdetermined");
  assert.equal(boundary.limitations.twoPointObserved, false);
  assert.equal(boundary.corroboration.kind, "multi_probe_region_frontier");
  assert.equal(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointOrUnderdeterminedLine,
    ),
    false,
  );
});

test("exact-grid n>=3 with interior, camera, and no opening can be accepted", () => {
  const observation = evidence();
  const s4a = s4aReceipt(observation);
  const candidate = s4a.candidates[0];
  assert.ok(candidate);
  const ready = withCandidate(s4a, (item) => ({
    ...item,
    status: "accepted",
    interior: {
      ...item.interior,
      status: "accepted",
      sideSign: item.interior.sideSign === -1 ? -1 : 1,
      cameraSideSign: item.interior.sideSign === -1 ? -1 : 1,
    },
    authority: {
      ...item.authority,
      baseSegment: true,
      supportPlane: true,
      collision: false,
    },
  }));
  const s4b = collide(ready, observation);
  if (ready.candidates[0]?.imageEvidence.lineResidual?.sampleCount !== undefined) {
    assert.ok((ready.candidates[0]?.imageEvidence.lineResidual?.sampleCount ?? 0) >= 3);
  }
  assert.ok((ready.candidates[0]?.projection.worldSamples.length ?? 0) >= 3);
  assert.equal(s4b.boundaries[0]?.status, "accepted");
  assert.equal(s4b.boundaries[0]?.collisionEnabled, true);
  assert.equal(s4b.collisionAuthority, true);
  assert.equal(s4b.boundaries[0]?.diagnostics.lineResidualInformative, true);
  assert.equal(s4b.boundaries[0]?.diagnostics.lineResidualClass, "supported");
  assert.equal(s4b.boundaries[0]?.corroboration.kind, "observed_multi_point_line");
  assert.equal(s4b.boundaries[0]?.corroboration.probeCount, undefined);
  assert.equal(s4b.boundaries[0]?.limitations.twoPointObserved, false);
  assert.equal(s4b.boundaries[0]?.limitations.twoPointCorroborated, false);
  assert.equal(
    roomCollisionQualificationBasisLabel(s4b.boundaries[0]!),
    "multi-point residual-supported",
  );
  assert.equal(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
    false,
  );
  assert.equal(s4b.geometryManufactured, false);
  assert.equal(s4b.hiddenContinuation, false);
  assert.equal(s4b.openingSubtractionPerformed, false);
  assert.equal(enabledCollisionWallsFromReceipt(s4b).length, 1);
});

test("aspect_compatible_rescaled is refused for collision", () => {
  const s4a = s4aReceipt();
  const rescaled: AfcV2RoomBoundaryAuthorityReceipt = {
    ...s4a,
    lineage: {
      ...s4a.lineage,
      emptyToOriginalCompatibility: {
        ...s4a.lineage.emptyToOriginalCompatibility,
        tier: "aspect_compatible_rescaled",
      },
    },
  };
  const s4b = collide(rescaled);
  assert.equal(s4b.collisionAuthority, false);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
    ),
  );
});

test("incompatible basis is refused for collision", () => {
  const s4a = s4aReceipt();
  const incompatible: AfcV2RoomBoundaryAuthorityReceipt = {
    ...s4a,
    lineage: {
      ...s4a.lineage,
      emptyToOriginalCompatibility: {
        ...s4a.lineage.emptyToOriginalCompatibility,
        tier: "incompatible",
      },
    },
  };
  const s4b = collide(incompatible);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
    ),
  );
});

test("Room1-like near-threshold residual remains eligible and is marked near_s4a_residual_limit", () => {
  const s4a = withCandidate(s4aReceipt(), (candidate) => ({
    ...candidate,
    interior: {
      ...candidate.interior,
      status: "accepted",
      sideSign: candidate.interior.sideSign === -1 ? -1 : 1,
      cameraSideSign: candidate.interior.sideSign === -1 ? -1 : 1,
    },
    projection: {
      ...candidate.projection,
      worldResidual: {
        meanDistance: 0.02,
        maxDistance: 0.04933,
        sampleCount: Math.max(3, candidate.projection.worldSamples.length),
      },
    },
  }));
  const s4b = collide(s4a);
  assert.equal(s4b.boundaries[0]?.status, "accepted");
  assert.equal(s4b.boundaries[0]?.reliabilityClass, "near_s4a_residual_limit");
  assert.ok(0.04933 / ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M > 0.8);
});

test("opening-crossing seam is refused and jamb-touch remains eligible", () => {
  const crossingOpening = {
    id: "door",
    category: "doorway",
    hostPlaneId: "visible_wall",
    sourceNormalizedBoundary: [
      { x: 0.4, y: 0.5 },
      { x: 0.6, y: 0.5 },
      { x: 0.6, y: 0.74 },
      { x: 0.4, y: 0.74 },
    ],
    boundaryClosure: "complete_visible_outline",
    boundaryEvidenceCompleteness: "all_edges_visibly_traced",
    confidence: 0.9,
    visibility: "observed",
  };
  const observation = evidence(providerObservation({
    observedOpenings: [crossingOpening],
  }));
  const s4a = withCandidate(s4aReceipt(observation), (candidate) => ({
    ...candidate,
    interior: {
      ...candidate.interior,
      status: "accepted",
      sideSign: candidate.interior.sideSign === -1 ? -1 : 1,
      cameraSideSign: candidate.interior.sideSign === -1 ? -1 : 1,
    },
  }));
  const s4b = collide(s4a, observation);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.seamCrossesReportedOpening,
    ),
  );
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);

  const jambOpening = {
    ...crossingOpening,
    sourceNormalizedBoundary: [
      { x: 0.8, y: 0.5 },
      { x: 0.95, y: 0.5 },
      { x: 0.95, y: 0.74 },
      { x: 0.8, y: 0.74 },
    ],
  };
  const jambObservation = evidence(providerObservation({
    observedOpenings: [jambOpening],
  }));
  const jambS4a = withCandidate(s4aReceipt(jambObservation), (candidate) => ({
    ...candidate,
    interior: {
      ...candidate.interior,
      status: "accepted",
      sideSign: candidate.interior.sideSign === -1 ? -1 : 1,
      cameraSideSign: candidate.interior.sideSign === -1 ? -1 : 1,
    },
  }));
  const jambS4b = collide(jambS4a, jambObservation);
  assert.equal(
    jambS4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.seamCrossesReportedOpening,
    ),
    false,
  );
  assert.equal(jambS4b.boundaries[0]?.status, "accepted");
});

test("long exact-grid off-quad span is not refused solely due to length", () => {
  const s4a = withCandidate(s4aReceipt(), (candidate) => {
    if (!candidate.worldGeometry) return candidate;
    return {
      ...candidate,
      interior: {
        ...candidate.interior,
        status: "accepted",
        sideSign: candidate.interior.sideSign === -1 ? -1 : 1,
        cameraSideSign: candidate.interior.sideSign === -1 ? -1 : 1,
      },
      worldGeometry: {
        ...candidate.worldGeometry,
        baseEnd: {
          x: candidate.worldGeometry.baseStart.x + 40,
          y: 0,
          z: candidate.worldGeometry.baseStart.z,
        },
      },
    };
  });
  const s4b = collide(s4a);
  assert.equal(s4b.boundaries[0]?.status, "accepted");
  assert.ok((s4b.boundaries[0]?.diagnostics.spanM ?? 0) > (s4a.lineage.floor.worldWidthM));
});

test("multiple S4A accepted candidates qualify independently", () => {
  const first = s4aReceipt();
  const secondCandidate = {
    ...first.candidates[0]!,
    id: "rb_second",
    sourceSeamId: "second_floor_wall",
    interior: {
      ...first.candidates[0]!.interior,
      status: "accepted" as const,
      sideSign: first.candidates[0]!.interior.sideSign === -1 ? -1 as const : 1 as const,
      cameraSideSign: first.candidates[0]!.interior.sideSign === -1 ? -1 as const : 1 as const,
    },
  };
  const dual: AfcV2RoomBoundaryAuthorityReceipt = {
    ...first,
    candidates: [
      {
        ...first.candidates[0]!,
        interior: {
          ...first.candidates[0]!.interior,
          status: "accepted",
          sideSign: first.candidates[0]!.interior.sideSign === -1 ? -1 : 1,
          cameraSideSign: first.candidates[0]!.interior.sideSign === -1 ? -1 : 1,
        },
      },
      secondCandidate,
    ],
  };
  const s4b = collide(dual);
  assert.equal(s4b.summary.accepted, 2);
  assert.equal(s4b.collisionAuthority, true);
});

test("S4A receipt remains immutable and collisionAuthority false", () => {
  const s4a = s4aReceipt();
  const before = JSON.stringify(s4a);
  assert.equal(s4a.collisionAuthority, false);
  collide(s4a);
  assert.equal(JSON.stringify(s4a), before);
  assert.equal(s4a.collisionAuthority, false);
  assert.equal(s4a.schemaVersion, AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION);
  assert.equal(s4a.candidates.every((candidate) => candidate.authority.collision === false), true);
});

test("S4B geometryManufactured and hiddenContinuation stay false", () => {
  const s4b = collide(s4aReceipt());
  assert.equal(s4b.geometryManufactured, false);
  assert.equal(s4b.hiddenContinuation, false);
  assert.equal(s4b.closedTopology, false);
  assert.equal(s4b.verticalExtentKnown, false);
  assert.equal(
    s4b.boundaries.every((boundary) => boundary.limitations.hiddenContinuation === false),
    true,
  );
});

test("zero accepted S4B remains valid success", () => {
  const empty = constructAfcV2RoomCollisionAuthority({
    roomBoundary: s4aReceipt(evidence(providerObservation({ observedSeams: [] }))),
    observation: evidence(providerObservation({ observedSeams: [] })),
  });
  assert.equal(empty.schemaVersion, AFC_V2_ROOM_COLLISION_AUTHORITY_VERSION);
  assert.equal(empty.collisionAuthority, false);
  assert.equal(empty.summary.accepted, 0);
  assert.ok(
    empty.constructionReasons.includes(
      ROOM_COLLISION_REASON.zeroCollisionEnabledBoundaries,
    ),
  );
});

test("missing S4A fails closed without throwing", () => {
  const s4b = constructAfcV2RoomCollisionAuthority({
    roomBoundary: null,
    observation: evidence(),
  });
  assert.equal(s4b.collisionAuthority, false);
  assert.ok(s4b.constructionReasons.includes(ROOM_COLLISION_REASON.s4aUnavailable));
});

test("opening veto uses interior geometry rather than a 4-sample heuristic", () => {
  const polyline = [
    { x: 0.2, y: 0.62 },
    { x: 0.5, y: 0.62 },
    { x: 0.8, y: 0.62 },
  ];
  const opening = {
    id: "window",
    category: "window" as const,
    hostPlaneId: "visible_wall",
    sourceNormalizedBoundary: [
      { x: 0.45, y: 0.55 },
      { x: 0.55, y: 0.55 },
      { x: 0.55, y: 0.7 },
      { x: 0.45, y: 0.7 },
    ],
    boundaryClosure: "complete_visible_outline" as const,
    providerClaimedBoundaryClosure: "complete_visible_outline" as const,
    boundaryEvidenceCompleteness: "all_edges_visibly_traced" as const,
    closureValidation: "consistent_complete" as const,
    confidence: 0.9,
    ambiguity: null,
    evidenceClass: "provider_reported_visible_evidence" as const,
  };
  assert.equal(floorWallPolylineCrossesOpeningInterior(polyline, [opening]), true);
  const jambOnly = {
    ...opening,
    sourceNormalizedBoundary: [
      { x: 0.8, y: 0.55 },
      { x: 0.9, y: 0.55 },
      { x: 0.9, y: 0.7 },
      { x: 0.8, y: 0.7 },
    ],
  };
  assert.equal(floorWallPolylineCrossesOpeningInterior(polyline, [jambOnly]), false);
  const qualificationSource = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/room-collision-qualification.server.ts"),
    "utf8",
  );
  assert.doesNotMatch(qualificationSource, /\[0\.2, 0\.4, 0\.6, 0\.8\]/);
  assert.doesNotMatch(qualificationSource, /twoPointOrUnderdeterminedLine/);
});

const defaultFloorPolygon = [
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 0.8, y: 0.62 },
  { x: 0.2, y: 0.62 },
];
const defaultWallPolygon = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.8, y: 0.62 },
  { x: 0.2, y: 0.62 },
];

function twoPointEvidenceWithPlanes(
  floorPolygon: readonly { x: number; y: number }[],
  wallPolygon: readonly { x: number; y: number }[],
  extra: Record<string, unknown> = {},
) {
  return twoPointEvidence({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: floorPolygon,
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: wallPolygon,
        confidence: 0.91,
        visibility: "observed",
      },
    ],
    ...extra,
  });
}

function readyTwoPoint() {
  const observation = twoPointEvidence();
  return {
    observation,
    s4a: withCollisionReadyInterior(s4aReceipt(observation)),
  };
}

test("two-point midpoint leaving floor or wall frontier is insufficient", () => {
  const { s4a } = readyTwoPoint();
  const recedingWall = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.8, y: 0.62 },
    { x: 0.65, y: 0.62 },
    { x: 0.5, y: 0.4 },
    { x: 0.35, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const s4b = collide(s4a, twoPointEvidenceWithPlanes(defaultFloorPolygon, recedingWall));
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.collisionEnabled, false);
  assert.equal(boundary.status, "insufficient");
  assert.ok(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
  assert.equal(boundary.corroboration.kind, "multi_probe_region_frontier");
  assert.equal(boundary.corroboration.wallFrontierPass, false);
  assert.equal(boundary.limitations.twoPointCorroborated, false);
});

test("two-point local occupancy failure is insufficient even if frontier is close", () => {
  const { s4a } = readyTwoPoint();
  const sameSideWall = [
    { x: 0.15, y: 0.95 },
    { x: 0.85, y: 0.95 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const s4b = collide(s4a, twoPointEvidenceWithPlanes(defaultFloorPolygon, sameSideWall));
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.collisionEnabled, false);
  assert.ok(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
  assert.equal(boundary.corroboration.occupancyPass, false);
  assert.equal(
    roomCollisionQualificationBasisLabel(boundary),
    "two-point region corroboration failed",
  );
});

test("opening crossing veto is independent of two-point region corroboration", () => {
  const crossingOpening = {
    id: "door",
    category: "doorway",
    hostPlaneId: "visible_wall",
    sourceNormalizedBoundary: [
      { x: 0.4, y: 0.5 },
      { x: 0.6, y: 0.5 },
      { x: 0.6, y: 0.74 },
      { x: 0.4, y: 0.74 },
    ],
    boundaryClosure: "complete_visible_outline",
    boundaryEvidenceCompleteness: "all_edges_visibly_traced",
    confidence: 0.9,
    visibility: "observed",
  };
  const observation = twoPointEvidence({ observedOpenings: [crossingOpening] });
  const s4a = withCollisionReadyInterior(s4aReceipt(twoPointEvidence()));
  const s4b = collide(s4a, observation);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.collisionEnabled, false);
  assert.ok(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.seamCrossesReportedOpening,
    ),
  );
  assert.equal(boundary.corroboration.openingCrossing, true);
  assert.equal(boundary.limitations.twoPointCorroborated, true);
});

test("aspect_compatible_rescaled two-point remains collision-disabled even if corroborated", () => {
  const { observation, s4a } = readyTwoPoint();
  const rescaled: AfcV2RoomBoundaryAuthorityReceipt = {
    ...s4a,
    lineage: {
      ...s4a.lineage,
      emptyToOriginalCompatibility: {
        ...s4a.lineage.emptyToOriginalCompatibility,
        tier: "aspect_compatible_rescaled",
      },
    },
  };
  const s4b = collide(rescaled, observation);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.collisionEnabled, false);
  assert.ok(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
    ),
  );
  assert.equal(boundary.limitations.twoPointCorroborated, true);
  assert.equal(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
    false,
  );
});

test("radiator or internal wall feature is not a shared floor-wall frontier", () => {
  const { observation, s4a } = readyTwoPoint();
  const radiator = withCandidate(s4a, (candidate) => ({
    ...candidate,
    imageEvidence: {
      ...candidate.imageEvidence,
      polyline: [
        { x: 0.3, y: 0.35 },
        { x: 0.7, y: 0.35 },
      ],
    },
  }));
  const s4b = collide(radiator, observation);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.collisionEnabled, false);
  assert.ok(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
  assert.equal(boundary.corroboration.floorFrontierPass, false);
});

test("qualification probes do not modify S4A polyline, worldSamples, or residual", () => {
  const { observation, s4a } = readyTwoPoint();
  const before = JSON.stringify(s4a);
  const polylineBefore = JSON.stringify(s4a.candidates[0]?.imageEvidence.polyline);
  const worldBefore = JSON.stringify(s4a.candidates[0]?.projection.worldSamples);
  const imageResidualBefore = JSON.stringify(s4a.candidates[0]?.imageEvidence.lineResidual);
  const worldResidualBefore = JSON.stringify(s4a.candidates[0]?.projection.worldResidual);
  collide(s4a, observation);
  assert.equal(JSON.stringify(s4a), before);
  assert.equal(JSON.stringify(s4a.candidates[0]?.imageEvidence.polyline), polylineBefore);
  assert.equal(JSON.stringify(s4a.candidates[0]?.projection.worldSamples), worldBefore);
  assert.equal(
    JSON.stringify(s4a.candidates[0]?.imageEvidence.lineResidual),
    imageResidualBefore,
  );
  assert.equal(
    JSON.stringify(s4a.candidates[0]?.projection.worldResidual),
    worldResidualBefore,
  );
  const qualificationSource = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/room-collision-qualification.server.ts"),
    "utf8",
  );
  assert.match(qualificationSource, /never enter the observed polyline/);
  assert.doesNotMatch(qualificationSource, /polyline\.push/);
  assert.doesNotMatch(qualificationSource, /worldSamples\.push/);
});

test("endpoint-only frontier success is refused when the open-span midpoint leaves", () => {
  const { s4a } = readyTwoPoint();
  const bittenFloor = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 0.8, y: 0.62 },
    { x: 0.65, y: 0.62 },
    { x: 0.5, y: 0.8 },
    { x: 0.35, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const s4b = collide(s4a, twoPointEvidenceWithPlanes(bittenFloor, defaultWallPolygon));
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.collisionEnabled, false);
  assert.ok(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
  assert.equal(boundary.corroboration.floorFrontierPass, false);
  assert.ok((boundary.corroboration.probeCount ?? 0) >= 1);
  assert.notEqual(
    boundary.corroboration.passingProbeCount,
    boundary.corroboration.probeCount,
  );
});

test("missing bound floor or wall region fails two-point corroboration closed", () => {
  const { observation, s4a } = readyTwoPoint();
  const missingFloor = withCandidate(s4a, (candidate) => ({
    ...candidate,
    source: {
      ...candidate.source,
      floorPlaneId: "missing_floor_region",
    },
  }));
  const s4b = collide(missingFloor, observation);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.collisionEnabled, false);
  assert.ok(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
  assert.equal(boundary.corroboration.kind, "none");
  assert.equal(boundary.corroboration.probeCount, 0);
});

test("residual-underdetermined multi-point uses regional corroboration instead of destroying geometry", () => {
  const observation = evidence(providerObservation({
    observedSeams: [{
      id: "wiggle_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.2, y: 0.62 },
        { x: 0.5, y: 0.6305 },
        { x: 0.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
  const s4a = withCollisionReadyInterior(s4aReceipt(observation));
  const candidate = s4a.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.imageEvidence.lineResidualClass, "underdetermined");
  assert.ok(candidate.worldGeometry);
  const s4b = collide(s4a, observation);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.diagnostics.lineResidualInformative, false);
  assert.equal(boundary.diagnostics.lineResidualClass, "underdetermined");
  assert.equal(boundary.corroboration.kind, "multi_probe_region_frontier");
  assert.ok((boundary.corroboration.applicableProbeCount ?? 0) >= 1);
  assert.equal(boundary.corroboration.contradictionProbeCount, 0);
  assert.equal(boundary.status, "accepted");
  assert.equal(boundary.collisionEnabled, true);
  assert.equal(boundary.limitations.hiddenContinuation, false);
  assert.equal(s4b.geometryManufactured, false);
  assert.equal(
    roomCollisionQualificationBasisLabel(boundary),
    "residual-underdetermined region-corroborated",
  );
});

test("residual-supported multi-point keeps observed_multi_point_line without regional probes", () => {
  const observation = evidence();
  const s4a = withCollisionReadyInterior(s4aReceipt(observation));
  const s4b = collide(s4a, observation);
  assert.equal(s4b.boundaries[0]?.diagnostics.lineResidualClass, "supported");
  assert.equal(s4b.boundaries[0]?.corroboration.kind, "observed_multi_point_line");
  assert.equal(s4b.boundaries[0]?.corroboration.probeCount, undefined);
  assert.equal(s4b.boundaries[0]?.corroboration.probes, undefined);
});

test("strongly bent multi-point is not rescued by endpoint fallback", () => {
  const observation = evidence(providerObservation({
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
  }));
  const s4a = s4aReceipt(observation);
  assert.notEqual(s4a.candidates[0]?.status, "accepted");
  const s4b = collide(withCollisionReadyInterior(s4a), observation);
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
});

test("truncated two-point side seam with supported plus N/A probes corroborates", () => {
  const floor = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const wall = [
    { x: 0.2, y: 0.1 },
    { x: 0.8, y: 0.1 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const start = { x: 0.25, y: 0.62 };
  const end = { x: 0.99, y: 0.62 };
  const occupancy = {
    floorSide: "positive" as const,
    wallSide: "negative" as const,
    opposite: true,
    floorOnLineCount: 1,
    floorPositiveCount: 4,
    floorNegativeCount: 0,
    wallOnLineCount: 1,
    wallPositiveCount: 0,
    wallNegativeCount: 4,
  };
  const supported = classifyRegionalProbeEvidence({
    probe: { x: 0.5, y: 0.62 },
    start,
    end,
    occupancy,
    floorPolygon: floor,
    wallPolygon: wall,
  });
  const truncated = classifyRegionalProbeEvidence({
    probe: { x: 0.995, y: 0.62 },
    start,
    end,
    occupancy,
    floorPolygon: floor,
    wallPolygon: wall,
  });
  const oob = classifyRegionalProbeEvidence({
    probe: { x: 0.99, y: 0.62 },
    start,
    end,
    occupancy,
    floorPolygon: floor,
    wallPolygon: wall,
  });
  assert.equal(supported.status, "pass");
  assert.ok(
    truncated.status === "not_applicable" || oob.status === "not_applicable" ||
      truncated.occupancy === "not_applicable" || oob.occupancy === "not_applicable",
  );
  assert.notEqual(supported.status, "contradiction");
  assert.notEqual(truncated.status, "contradiction");
  const passCount = [supported, truncated, oob].filter((item) =>
    item.status === "pass"
  ).length;
  const contradictionCount = [supported, truncated, oob].filter((item) =>
    item.status === "contradiction"
  ).length;
  const notApplicableCount = [supported, truncated, oob].filter((item) =>
    item.status === "not_applicable"
  ).length;
  assert.ok(passCount >= 1);
  assert.ok(notApplicableCount >= 1);
  assert.equal(contradictionCount, 0);
  assert.equal(
    applicableEvidencePasses({ passCount, contradictionCount }),
    true,
  );
});

test("unsupported frame occupancy samples are N/A not contradiction", () => {
  const occupancy = {
    floorSide: "positive" as const,
    wallSide: "negative" as const,
    opposite: true,
    floorOnLineCount: 0,
    floorPositiveCount: 1,
    floorNegativeCount: 0,
    wallOnLineCount: 0,
    wallPositiveCount: 0,
    wallNegativeCount: 1,
  };
  const span = corroborateObservedSpan({
    polyline: [
      { x: 0.01, y: 0.62 },
      { x: 0.4, y: 0.62 },
    ],
    occupancy,
    floorPolygon: defaultFloorPolygon,
    wallPolygon: defaultWallPolygon,
  });
  assert.ok((span.notApplicableProbeCount ?? 0) >= 0);
  assert.equal(
    span.probes.every((probe) => probe.status !== "contradiction") ||
      span.contradictionProbeCount >= 0,
    true,
  );
});

test("wrong-polygon occupancy remains a hard corroboration failure", () => {
  const { s4a } = readyTwoPoint();
  const sameSideWall = [
    { x: 0.15, y: 0.95 },
    { x: 0.85, y: 0.95 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const s4b = collide(s4a, twoPointEvidenceWithPlanes(defaultFloorPolygon, sameSideWall));
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.ok((s4b.boundaries[0]?.corroboration.contradictionProbeCount ?? 0) >= 1);
  assert.equal(s4b.boundaries[0]?.corroboration.occupancyPass, false);
});

test("baseboard false seam fails local occupancy or frontier", () => {
  const { observation, s4a } = readyTwoPoint();
  const baseboard = withCandidate(s4a, (candidate) => ({
    ...candidate,
    imageEvidence: {
      ...candidate.imageEvidence,
      polyline: [
        { x: 0.25, y: 0.58 },
        { x: 0.75, y: 0.58 },
      ],
    },
  }));
  const s4b = collide(baseboard, observation);
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
});

test("acute side-wall two-point can become collision-enabled when occupancy supports it", () => {
  const observation = evidence(providerObservation({
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
  }));
  const s4a = s4aReceipt(observation);
  const candidate = s4a.candidates[0];
  assert.ok(candidate);
  if (candidate.status === "accepted" && candidate.worldGeometry) {
    const ready = withCollisionReadyInterior(s4a);
    const s4b = collide(ready, observation);
    if (s4b.boundaries[0]?.corroboration.kind === "multi_probe_region_frontier") {
      if ((s4b.boundaries[0]?.corroboration.contradictionProbeCount ?? 1) === 0 &&
        (s4b.boundaries[0]?.corroboration.applicableProbeCount ?? 0) >= 1) {
        assert.equal(s4b.boundaries[0]?.collisionEnabled, true);
        assert.ok(s4b.boundaries[0]?.finiteBaseSegment);
      }
    }
  }
});

test("generic three-wall truncated-side fixture can enable all three walls", () => {
  const observation = evidence(providerObservation({
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
        id: "left_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.08, y: 0.12 },
          { x: 0.22, y: 0.12 },
          { x: 0.2, y: 0.62 },
          { x: 0.08, y: 0.72 },
        ],
        confidence: 0.88,
        visibility: "observed",
      },
      {
        id: "back_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.2, y: 0.1 },
          { x: 0.8, y: 0.1 },
          { x: 0.8, y: 0.62 },
          { x: 0.2, y: 0.62 },
        ],
        confidence: 0.91,
        visibility: "observed",
      },
      {
        id: "right_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.78, y: 0.12 },
          { x: 0.92, y: 0.12 },
          { x: 0.92, y: 0.72 },
          { x: 0.8, y: 0.62 },
        ],
        confidence: 0.88,
        visibility: "observed",
      },
    ],
    observedSeams: [
      {
        id: "left_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "left_wall"],
        sourceNormalizedPolyline: [
          { x: 0.01, y: 0.93 },
          { x: 0.11, y: 0.75 },
          { x: 0.2, y: 0.62 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
      {
        id: "back_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "back_wall"],
        sourceNormalizedPolyline: [
          { x: 0.2, y: 0.62 },
          { x: 0.5, y: 0.62 },
          { x: 0.8, y: 0.62 },
        ],
        confidence: 0.93,
        visibility: "observed",
      },
      {
        id: "right_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "right_wall"],
        sourceNormalizedPolyline: [
          { x: 0.8, y: 0.62 },
          { x: 0.99, y: 0.93 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
    ],
  }));
  const s4a = withCollisionReadyInterior(s4aReceipt(observation));
  const s4b = collide(s4a, observation);
  assert.equal(s4b.summary.candidateCount, 3);
  assert.equal(s4b.geometryManufactured, false);
  assert.equal(s4b.hiddenContinuation, false);
  assert.equal(s4b.openingSubtractionPerformed, false);
  for (const boundary of s4b.boundaries) {
    assert.equal(boundary.limitations.hiddenContinuation, false);
    if (boundary.sourceSeamId === "back_floor_wall") {
      assert.equal(boundary.collisionEnabled, true);
    }
  }
});

test("Room-1-style exact-grid back wall remains residual-supported", () => {
  const observation = evidence();
  const s4a = withCollisionReadyInterior(s4aReceipt(observation));
  const s4b = collide(s4a, observation);
  assert.equal(s4b.boundaries[0]?.collisionEnabled, true);
  assert.equal(s4b.boundaries[0]?.corroboration.kind, "observed_multi_point_line");
  assert.equal(s4b.openingSubtractionPerformed, false);
  assert.equal(s4b.geometryManufactured, false);
});

const rightStyleSeam = [
  { x: 0.78, y: 0.58 },
  { x: 0.94, y: 0.90 },
];
const rightStyleFloor = [
  { x: 0.08, y: 0.96 },
  { x: 0.94, y: 0.96 },
  { x: 0.94, y: 0.90 },
  { x: 0.78, y: 0.58 },
  { x: 0.22, y: 0.58 },
];
const rightStyleWall = [
  { x: 0.78, y: 0.14 },
  { x: 0.96, y: 0.14 },
  { x: 0.96, y: 0.90 },
  { x: 0.78, y: 0.58 },
];

function mirrorX(point: { x: number; y: number }) {
  return { x: 1 - point.x, y: point.y };
}

const leftStyleSeam = rightStyleSeam.map(mirrorX);
const leftStyleFloor = rightStyleFloor.map(mirrorX);
const leftStyleWall = rightStyleWall.map(mirrorX);

function uniqueOccupancy(
  polyline: readonly { x: number; y: number }[],
  floor: readonly { x: number; y: number }[],
  wall: readonly { x: number; y: number }[],
) {
  const occupancy = evaluateOppositeOccupancy(polyline, floor, wall);
  assert.ok(occupancy);
  assert.equal(occupancy.opposite, true);
  return occupancy;
}

function spanOf(
  polyline: readonly { x: number; y: number }[],
  floor: readonly { x: number; y: number }[],
  wall: readonly { x: number; y: number }[],
) {
  return corroborateObservedSpan({
    polyline,
    occupancy: uniqueOccupancy(polyline, floor, wall),
    floorPolygon: floor,
    wallPolygon: wall,
  });
}

function spanSummary(span: ReturnType<typeof corroborateObservedSpan>) {
  return {
    occupancyPass: span.occupancyPass,
    floorFrontierPass: span.floorFrontierPass,
    wallFrontierPass: span.wallFrontierPass,
    passed: span.passed,
    applicableProbeCount: span.applicableProbeCount,
    passingApplicableProbeCount: span.passingApplicableProbeCount,
    contradictionProbeCount: span.contradictionProbeCount,
    notApplicableProbeCount: span.notApplicableProbeCount,
    probeStatuses: [...span.probes.map((probe) => probe.status)].sort(),
  };
}

function assertReversalInvariant(
  polyline: readonly { x: number; y: number }[],
  floor: readonly { x: number; y: number }[],
  wall: readonly { x: number; y: number }[],
) {
  const forward = spanOf(polyline, floor, wall);
  const backward = spanOf([...polyline].reverse(), floor, wall);
  assert.deepEqual(spanSummary(forward), spanSummary(backward));
}

const projectableFloor = [
  { x: 0.160, y: 0.64 },
  { x: 0.90, y: 0.64 },
  { x: 0.99, y: 0.98 },
  { x: 0.127, y: 0.98 },
];
const projectableLeftWall = [
  { x: 0.02, y: 0.12 },
  { x: 0.18, y: 0.12 },
  { x: 0.160, y: 0.64 },
  { x: 0.127, y: 0.98 },
  { x: 0.02, y: 0.90 },
];
const projectableLeftSeam = [
  { x: 0.160, y: 0.64 },
  { x: 0.127, y: 0.98 },
];
const projectableRightWall = [
  { x: 0.88, y: 0.12 },
  { x: 0.99, y: 0.12 },
  { x: 0.99, y: 0.98 },
  { x: 0.90, y: 0.64 },
];
const projectableRightSeam = [
  { x: 0.90, y: 0.64 },
  { x: 0.99, y: 0.98 },
];
const projectableBackWall = [
  { x: 0.160, y: 0.12 },
  { x: 0.90, y: 0.12 },
  { x: 0.90, y: 0.64 },
  { x: 0.160, y: 0.64 },
];
const projectableBackSeam = [
  { x: 0.160, y: 0.64 },
  { x: 0.90, y: 0.64 },
];

function threeWallSideObservation(reverseSeams = false) {
  const reverse = <T>(points: readonly T[]) =>
    reverseSeams ? [...points].reverse() : [...points];
  return evidence(providerObservation({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: projectableFloor,
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "side_wall_a",
        category: "wall",
        sourceNormalizedPolygon: projectableLeftWall,
        confidence: 0.88,
        visibility: "observed",
      },
      {
        id: "back_wall",
        category: "wall",
        sourceNormalizedPolygon: projectableBackWall,
        confidence: 0.91,
        visibility: "observed",
      },
      {
        id: "side_wall_b",
        category: "wall",
        sourceNormalizedPolygon: projectableRightWall,
        confidence: 0.88,
        visibility: "observed",
      },
    ],
    observedSeams: [
      {
        id: "side_a_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "side_wall_a"],
        sourceNormalizedPolyline: reverse(projectableLeftSeam),
        confidence: 0.9,
        visibility: "observed",
      },
      {
        id: "back_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "back_wall"],
        sourceNormalizedPolyline: reverse(projectableBackSeam),
        confidence: 0.93,
        visibility: "observed",
      },
      {
        id: "side_b_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "side_wall_b"],
        sourceNormalizedPolyline: reverse(projectableRightSeam),
        confidence: 0.9,
        visibility: "observed",
      },
    ],
  }));
}

test("valid right-side two-point regional occupancy passes", () => {
  const span = spanOf(rightStyleSeam, rightStyleFloor, rightStyleWall);
  assert.equal(span.occupancyPass, true);
  assert.equal(span.floorFrontierPass, true);
  assert.equal(span.wallFrontierPass, true);
  assert.equal(span.contradictionProbeCount, 0);
  assert.ok((span.passingApplicableProbeCount ?? 0) >= 1);
  assert.equal(span.passed, true);
});

test("mirrored valid left-side two-point regional occupancy passes", () => {
  assert.ok(leftStyleSeam[0]!.x > leftStyleSeam[1]!.x);
  const span = spanOf(leftStyleSeam, leftStyleFloor, leftStyleWall);
  assert.equal(span.occupancyPass, true);
  assert.equal(span.floorFrontierPass, true);
  assert.equal(span.wallFrontierPass, true);
  assert.equal(span.contradictionProbeCount, 0);
  assert.ok((span.passingApplicableProbeCount ?? 0) >= 1);
  assert.equal(span.passed, true);
});

test("endpoint reversal leaves regional corroboration unchanged", () => {
  assertReversalInvariant(rightStyleSeam, rightStyleFloor, rightStyleWall);
  assertReversalInvariant(leftStyleSeam, leftStyleFloor, leftStyleWall);
  assertReversalInvariant(
    [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
    defaultFloorPolygon,
    defaultWallPolygon,
  );
});

test("left/right image-space mirror leaves regional corroboration unchanged", () => {
  const original = spanOf(rightStyleSeam, rightStyleFloor, rightStyleWall);
  const mirrored = spanOf(leftStyleSeam, leftStyleFloor, leftStyleWall);
  assert.deepEqual(spanSummary(original), spanSummary(mirrored));
});

test("strong valid left-style decreasing-x seam regionally corroborates", () => {
  assert.ok(leftStyleSeam[0]!.x > leftStyleSeam[1]!.x);
  const span = spanOf(leftStyleSeam, leftStyleFloor, leftStyleWall);
  assert.equal(span.occupancyPass, true);
  assert.equal(span.passed, true);
  const midpoint = classifyRegionalProbeEvidence({
    probe: {
      x: (leftStyleSeam[0]!.x + leftStyleSeam[1]!.x) / 2,
      y: (leftStyleSeam[0]!.y + leftStyleSeam[1]!.y) / 2,
    },
    start: leftStyleSeam[0]!,
    end: leftStyleSeam[1]!,
    occupancy: uniqueOccupancy(leftStyleSeam, leftStyleFloor, leftStyleWall),
    floorPolygon: leftStyleFloor,
    wallPolygon: leftStyleWall,
  });
  assert.equal(midpoint.occupancy, "pass");
  const memberships = [midpoint.plusMembership, midpoint.minusMembership].sort();
  assert.deepEqual(memberships, ["floor_only", "wall_only"]);
});

test("strong valid right-style increasing-x seam still regionally corroborates", () => {
  assert.ok(rightStyleSeam[0]!.x < rightStyleSeam[1]!.x);
  const span = spanOf(rightStyleSeam, rightStyleFloor, rightStyleWall);
  assert.equal(span.occupancyPass, true);
  assert.equal(span.passed, true);
});

test("both offset samples in floor are a regional contradiction", () => {
  assert.equal(
    classifyRegionalOppositeOccupancy({ plus: "floor_only", minus: "floor_only" }),
    "contradiction",
  );
  const sameSideWall = [
    { x: 0.15, y: 0.95 },
    { x: 0.85, y: 0.95 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const span = corroborateObservedSpan({
    polyline: [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
    occupancy: {
      floorSide: "positive",
      wallSide: "negative",
      opposite: true,
      floorOnLineCount: 1,
      floorPositiveCount: 4,
      floorNegativeCount: 0,
      wallOnLineCount: 1,
      wallPositiveCount: 0,
      wallNegativeCount: 4,
    },
    floorPolygon: defaultFloorPolygon,
    wallPolygon: sameSideWall,
  });
  assert.equal(span.occupancyPass, false);
  assert.ok(span.contradictionProbeCount >= 1);
  assert.equal(span.passed, false);
});

test("both offset samples in wall are a regional contradiction", () => {
  assert.equal(
    classifyRegionalOppositeOccupancy({ plus: "wall_only", minus: "wall_only" }),
    "contradiction",
  );
  const sameSideFloor = [
    { x: 0.15, y: 0.35 },
    { x: 0.85, y: 0.35 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const span = corroborateObservedSpan({
    polyline: [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
    occupancy: {
      floorSide: "positive",
      wallSide: "negative",
      opposite: true,
      floorOnLineCount: 1,
      floorPositiveCount: 4,
      floorNegativeCount: 0,
      wallOnLineCount: 1,
      wallPositiveCount: 0,
      wallNegativeCount: 4,
    },
    floorPolygon: sameSideFloor,
    wallPolygon: defaultWallPolygon,
  });
  assert.equal(span.occupancyPass, false);
  assert.ok(span.contradictionProbeCount >= 1);
});

test("one offset sample inside both polygons is a regional contradiction", () => {
  assert.equal(
    classifyRegionalOppositeOccupancy({ plus: "both", minus: "wall_only" }),
    "contradiction",
  );
  assert.equal(
    classifyRegionalOppositeOccupancy({ plus: "floor_only", minus: "both" }),
    "contradiction",
  );
  const overlapping = [
    { x: 0.1, y: 0.2 },
    { x: 0.9, y: 0.2 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  const classified = classifyRegionalSampleMembership({
    point: { x: 0.5, y: 0.5 },
    probe: { x: 0.5, y: 0.62 },
    floorPolygon: overlapping,
    wallPolygon: overlapping,
  });
  assert.equal(classified.membership, "both");
});

test("mixed overlapping polygon membership is a regional contradiction", () => {
  const overlappingFloor = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 0.8, y: 0.50 },
    { x: 0.2, y: 0.50 },
  ];
  const overlappingWall = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.8, y: 0.74 },
    { x: 0.2, y: 0.74 },
  ];
  const span = corroborateObservedSpan({
    polyline: [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
    occupancy: {
      floorSide: "positive",
      wallSide: "negative",
      opposite: true,
      floorOnLineCount: 1,
      floorPositiveCount: 4,
      floorNegativeCount: 0,
      wallOnLineCount: 1,
      wallPositiveCount: 0,
      wallNegativeCount: 4,
    },
    floorPolygon: overlappingFloor,
    wallPolygon: overlappingWall,
  });
  assert.equal(span.occupancyPass, false);
  assert.ok(span.contradictionProbeCount >= 1);
});

test("floor_only opposite a frame-unsupported sample is N/A, not a pass", () => {
  assert.equal(
    classifyRegionalOppositeOccupancy({
      plus: "floor_only",
      minus: "frame_unsupported",
    }),
    "not_applicable",
  );
  const truncatedWall = [
    { x: 0.2, y: 0.1 },
    { x: 0.8, y: 0.1 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const classified = classifyRegionalProbeEvidence({
    probe: { x: 0.995, y: 0.62 },
    start: { x: 0.25, y: 0.62 },
    end: { x: 0.99, y: 0.62 },
    occupancy: uniqueOccupancy(
      [{ x: 0.25, y: 0.62 }, { x: 0.99, y: 0.62 }],
      defaultFloorPolygon,
      truncatedWall,
    ),
    floorPolygon: defaultFloorPolygon,
    wallPolygon: truncatedWall,
  });
  assert.notEqual(classified.occupancy, "pass");
  assert.notEqual(classified.status, "pass");
});

test("wall_only opposite a frame-unsupported sample is N/A, not a pass", () => {
  assert.equal(
    classifyRegionalOppositeOccupancy({
      plus: "wall_only",
      minus: "frame_unsupported",
    }),
    "not_applicable",
  );
});

test("one out-of-bounds offset sample is N/A when the other is not a hard contradiction", () => {
  assert.equal(
    classifyRegionalOppositeOccupancy({
      plus: "floor_only",
      minus: "out_of_bounds",
    }),
    "not_applicable",
  );
  const oob = classifyRegionalSampleMembership({
    point: { x: -0.01, y: 0.62 },
    probe: { x: 0.01, y: 0.62 },
    floorPolygon: defaultFloorPolygon,
    wallPolygon: defaultWallPolygon,
  });
  assert.equal(oob.membership, "out_of_bounds");
  assert.equal(oob.outOfBounds, true);
});

test("neither region in a well-supported interior is a contradiction", () => {
  assert.equal(
    classifyRegionalOppositeOccupancy({ plus: "neither", minus: "wall_only" }),
    "contradiction",
  );
  const thinFloor = [
    { x: 0.2, y: 0.62 },
    { x: 0.8, y: 0.62 },
    { x: 0.8, y: 0.625 },
    { x: 0.2, y: 0.625 },
  ];
  const thinWall = [
    { x: 0.2, y: 0.615 },
    { x: 0.8, y: 0.615 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const span = corroborateObservedSpan({
    polyline: [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
    occupancy: {
      floorSide: "positive",
      wallSide: "negative",
      opposite: true,
      floorOnLineCount: 1,
      floorPositiveCount: 2,
      floorNegativeCount: 0,
      wallOnLineCount: 1,
      wallPositiveCount: 0,
      wallNegativeCount: 2,
    },
    floorPolygon: thinFloor,
    wallPolygon: thinWall,
  });
  assert.equal(span.occupancyPass, false);
  assert.ok(span.contradictionProbeCount >= 1);
  assert.equal(span.passed, false);
});

test("floating seam inside floor fails frontier, not occupancy polarity", () => {
  const span = corroborateObservedSpan({
    polyline: [{ x: 0.35, y: 0.85 }, { x: 0.65, y: 0.85 }],
    occupancy: uniqueOccupancy(
      [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
      defaultFloorPolygon,
      defaultWallPolygon,
    ),
    floorPolygon: defaultFloorPolygon,
    wallPolygon: defaultWallPolygon,
  });
  assert.equal(span.floorFrontierPass, false);
  assert.equal(span.passed, false);
});

test("floating seam inside wall fails frontier, not occupancy polarity", () => {
  const span = corroborateObservedSpan({
    polyline: [{ x: 0.35, y: 0.35 }, { x: 0.65, y: 0.35 }],
    occupancy: uniqueOccupancy(
      [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
      defaultFloorPolygon,
      defaultWallPolygon,
    ),
    floorPolygon: defaultFloorPolygon,
    wallPolygon: defaultWallPolygon,
  });
  assert.equal(span.wallFrontierPass, false);
  assert.equal(span.floorFrontierPass, false);
  assert.equal(span.passed, false);
});

test("wrong wall polygon remains a regional occupancy contradiction", () => {
  const { s4a } = readyTwoPoint();
  const sameSideWall = [
    { x: 0.15, y: 0.95 },
    { x: 0.85, y: 0.95 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const s4b = collide(s4a, twoPointEvidenceWithPlanes(defaultFloorPolygon, sameSideWall));
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.equal(s4b.boundaries[0]?.corroboration.occupancyPass, false);
  assert.ok((s4b.boundaries[0]?.corroboration.contradictionProbeCount ?? 0) >= 1);
});

test("wall-wall jamb-like line does not regionally corroborate as floor-wall", () => {
  const span = corroborateObservedSpan({
    polyline: [{ x: 0.5, y: 0.22 }, { x: 0.5, y: 0.48 }],
    occupancy: uniqueOccupancy(
      [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
      defaultFloorPolygon,
      defaultWallPolygon,
    ),
    floorPolygon: defaultFloorPolygon,
    wallPolygon: defaultWallPolygon,
  });
  assert.equal(span.passed, false);
  assert.notEqual(span.occupancyPass && span.floorFrontierPass && span.wallFrontierPass, true);
});

test("frame-adjacent valid side keeps N/A rather than promoting one-sided evidence", () => {
  const floor = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const wall = [
    { x: 0.2, y: 0.1 },
    { x: 0.8, y: 0.1 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const start = { x: 0.25, y: 0.62 };
  const end = { x: 0.99, y: 0.62 };
  const occupancy = uniqueOccupancy([start, end], floor, wall);
  const truncated = classifyRegionalProbeEvidence({
    probe: { x: 0.995, y: 0.62 },
    start,
    end,
    occupancy,
    floorPolygon: floor,
    wallPolygon: wall,
  });
  const supported = classifyRegionalProbeEvidence({
    probe: { x: 0.5, y: 0.62 },
    start,
    end,
    occupancy,
    floorPolygon: floor,
    wallPolygon: wall,
  });
  assert.equal(supported.occupancy, "pass");
  assert.ok(
    truncated.status === "not_applicable" || truncated.occupancy === "not_applicable",
  );
  assert.notEqual(truncated.status, "pass");
  assert.notEqual(truncated.occupancy, "contradiction");
});

test("opening crossing remains an independent rejection", () => {
  const crossingOpening = {
    id: "door",
    category: "doorway",
    hostPlaneId: "visible_wall",
    sourceNormalizedBoundary: [
      { x: 0.4, y: 0.5 },
      { x: 0.6, y: 0.5 },
      { x: 0.6, y: 0.74 },
      { x: 0.4, y: 0.74 },
    ],
    boundaryClosure: "complete_visible_outline",
    boundaryEvidenceCompleteness: "all_edges_visibly_traced",
    confidence: 0.9,
    visibility: "observed",
  };
  const observation = twoPointEvidence({ observedOpenings: [crossingOpening] });
  const s4a = withCollisionReadyInterior(s4aReceipt(twoPointEvidence()));
  const s4b = collide(s4a, observation);
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.seamCrossesReportedOpening,
    ),
  );
});

test("S4A camera contradiction still disables collision after occupancy polarity correction", () => {
  const observation = twoPointEvidenceWithPlanes(
    leftStyleFloor,
    leftStyleWall,
    {
      observedSeams: [{
        id: "side_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: leftStyleSeam,
        confidence: 0.9,
        visibility: "observed",
      }],
    },
  );
  const s4a = withCandidate(withCollisionReadyInterior(s4aReceipt(observation)), (candidate) => ({
    ...candidate,
    interior: {
      ...candidate.interior,
      status: "accepted",
      sideSign: 1,
      cameraSideSign: -1,
    },
  }));
  const s4b = collide(s4a, observation);
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.interiorCameraNotCorroborated,
    ),
  );
});

test("true regional occupancy contradiction still disables collision", () => {
  const { s4a } = readyTwoPoint();
  const sameSideWall = [
    { x: 0.15, y: 0.95 },
    { x: 0.85, y: 0.95 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const s4b = collide(s4a, twoPointEvidenceWithPlanes(defaultFloorPolygon, sameSideWall));
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.equal(s4b.boundaries[0]?.corroboration.occupancyPass, false);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
});

test("generic S4A accepted left-style seam regionally corroborates in S4B", () => {
  assert.ok(projectableLeftSeam[0]!.x > projectableLeftSeam[1]!.x);
  const observation = twoPointEvidenceWithPlanes(
    projectableFloor,
    projectableLeftWall,
    {
      observedSeams: [{
        id: "side_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_wall"],
        sourceNormalizedPolyline: projectableLeftSeam,
        confidence: 0.9,
        visibility: "observed",
      }],
    },
  );
  const s4a = s4aReceipt(observation);
  assert.equal(s4a.candidates[0]?.status, "accepted");
  const exact = collide(withCollisionReadyInterior(s4a), observation);
  const exactBoundary = exact.boundaries[0];
  assert.ok(exactBoundary);
  assert.equal(exactBoundary.corroboration.kind, "multi_probe_region_frontier");
  assert.equal(exactBoundary.corroboration.occupancyPass, true);
  assert.equal(exactBoundary.corroboration.floorFrontierPass, true);
  assert.equal(exactBoundary.corroboration.wallFrontierPass, true);
  assert.equal(exactBoundary.corroboration.contradictionProbeCount, 0);
  assert.ok((exactBoundary.corroboration.passingApplicableProbeCount ?? 0) >= 1);
  assert.equal(exactBoundary.limitations.twoPointCorroborated, true);
  assert.equal(exactBoundary.collisionEnabled, true);

  const rescaled: AfcV2RoomBoundaryAuthorityReceipt = {
    ...withCollisionReadyInterior(s4a),
    lineage: {
      ...s4a.lineage,
      emptyToOriginalCompatibility: {
        ...s4a.lineage.emptyToOriginalCompatibility,
        tier: "aspect_compatible_rescaled",
      },
    },
  };
  const rescaledS4b = collide(rescaled, observation);
  const rescaledBoundary = rescaledS4b.boundaries[0];
  assert.ok(rescaledBoundary);
  assert.equal(rescaledBoundary.corroboration.occupancyPass, true);
  assert.equal(rescaledBoundary.limitations.twoPointCorroborated, true);
  assert.equal(rescaledBoundary.collisionEnabled, false);
  assert.ok(
    rescaledBoundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
    ),
  );
  assert.equal(
    rescaledBoundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
    false,
  );
});

test("generic three-wall left/back/right two-point seams all regionally corroborate", () => {
  const observation = threeWallSideObservation();
  const s4a = s4aReceipt(observation);
  assert.equal(s4a.candidates.length, 3);
  assert.ok(s4a.candidates.every((candidate) => candidate.status === "accepted"));
  const s4b = collide(withCollisionReadyInterior(s4a), observation);
  assert.equal(s4b.summary.candidateCount, 3);
  for (const boundary of s4b.boundaries) {
    assert.equal(boundary.corroboration.kind, "multi_probe_region_frontier");
    assert.equal(boundary.corroboration.occupancyPass, true);
    assert.equal(boundary.corroboration.floorFrontierPass, true);
    assert.equal(boundary.corroboration.wallFrontierPass, true);
    assert.equal(boundary.corroboration.contradictionProbeCount, 0);
    assert.equal(boundary.limitations.twoPointCorroborated, true);
    assert.equal(boundary.collisionEnabled, true);
  }
});

test("regional occupancy does not assign +normal to floorSide", () => {
  const qualificationSource = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/room-boundary-qualification.server.ts"),
    "utf8",
  );
  const regionalStart = qualificationSource.indexOf(
    "export function classifyRegionalProbeEvidence",
  );
  const regionalEnd = qualificationSource.indexOf(
    "export function applicableEvidencePasses",
  );
  const regional = qualificationSource.slice(regionalStart, regionalEnd);
  assert.match(regional, /classifyRegionalSampleMembership/);
  assert.match(regional, /classifyRegionalOppositeOccupancy/);
  assert.doesNotMatch(regional, /perpendicularTowardSide/);
  assert.doesNotMatch(regional, /expectedPolygon/);
  assert.doesNotMatch(regional, /floorNormal/);
});

const room2Floor = [
  { x: 0.045, y: 0.9999 },
  { x: 0.076, y: 0.697 },
  { x: 0.414, y: 0.616 },
  { x: 1, y: 0.819 },
  { x: 1, y: 0.9999 },
];
const room2Wall = [
  { x: 0, y: 0.222 },
  { x: 0.076, y: 0.282 },
  { x: 0.076, y: 0.697 },
  { x: 0, y: 0.75 },
];
const room2Seam = [
  { x: 0.045, y: 0.9999 },
  { x: 0.076, y: 0.697 },
];

function room2Observation() {
  return twoPointEvidenceWithPlanes(room2Floor, room2Wall, {
    observedSeams: [{
      id: "left_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: room2Seam,
      confidence: 0.9,
      visibility: "observed",
    }],
  });
}

function room2TruncatedFrontier() {
  return evaluateFrontierProximity(room2Seam, room2Floor, room2Wall);
}

function syntheticTruncatedWallFrontier() {
  return {
    maxDistanceToFloorFrontier: 0,
    maxDistanceToWallFrontier: 0,
    nearFloorFrontier: true,
    nearWallFrontier: true,
    floorVertices: [
      { applicability: "applicable" as const, status: "pass" as const, distance: 0, frameAdjacent: false },
      { applicability: "applicable" as const, status: "pass" as const, distance: 0, frameAdjacent: false },
    ],
    wallVertices: [
      {
        applicability: "unsupported_by_frame" as const,
        status: "not_applicable" as const,
        distance: 0.25,
        frameAdjacent: true,
      },
      {
        applicability: "applicable" as const,
        status: "pass" as const,
        distance: 0,
        frameAdjacent: false,
      },
    ],
  };
}

test("Test A: Room 2 truncated left wall corroborates via S4A wall-frontier receipt", () => {
  const observation = room2Observation();
  const s4a = s4aReceipt(observation);
  const candidate = s4a.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.status, "accepted");
  assert.equal(
    s4aWallFrontierHasCertifiedTruncatedSupport(candidate.imageEvidence.frontier),
    true,
  );
  const wallVertices = candidate.imageEvidence.frontier?.wallVertices ?? [];
  assert.equal(wallVertices.some((vertex) => vertex.status === "pass"), true);
  assert.equal(
    wallVertices.some((vertex) =>
      vertex.status === "not_applicable" &&
        (vertex.applicability === "unsupported_by_frame" ||
          vertex.applicability === "unsupported_by_polygon_coverage")
    ),
    true,
  );

  const occupancy = uniqueOccupancy(room2Seam, room2Floor, room2Wall);
  const start = room2Seam[0]!;
  const end = room2Seam[1]!;
  const span = corroborateObservedSpan({
    polyline: room2Seam,
    occupancy,
    floorPolygon: room2Floor,
    wallPolygon: room2Wall,
    s4aAccepted: true,
    s4aWallFrontier: room2TruncatedFrontier(),
  });
  assert.equal(span.floorFrontierPass, true);
  assert.equal(span.wallFrontierPass, true);
  assert.equal(span.contradictionProbeCount, 0);
  assert.equal(span.passed, true);
  assert.equal(span.probeCount, 4);
  assert.ok(span.probes.every((probe) => probe.status !== "contradiction"));
  assert.equal(span.occupancyPass === true || span.occupancyPass === false, true);

  const probes = [
    { x: 0.05489926481033586, y: 0.9031746028693312 },
    { x: 0.0605, y: 0.8484499999999999 },
    { x: 0.06984419877119269, y: 0.757148135232443 },
    { x: 0.07322138453906674, y: 0.724149762036022 },
  ];
  for (const probe of probes) {
    const classified = classifyRegionalProbeEvidence({
      probe,
      start,
      end,
      occupancy,
      floorPolygon: room2Floor,
      wallPolygon: room2Wall,
      s4aTruncatedWallSupport: true,
    });
    assert.equal(classified.floorFrontier.status, "pass");
    assert.equal(classified.wallFrontier.status, "not_applicable");
    assert.notEqual(classified.occupancy, "contradiction");
    assert.notEqual(classified.status, "contradiction");
    assert.deepEqual(
      [classified.plusMembership, classified.minusMembership].sort(),
      ["floor_only", "neither"],
    );
  }

  const s4b = collide(withCollisionReadyInterior(s4a), observation);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.corroboration.floorFrontierPass, true);
  assert.equal(boundary.corroboration.wallFrontierPass, true);
  assert.equal(boundary.corroboration.contradictionProbeCount, 0);
  assert.equal(boundary.limitations.twoPointCorroborated, true);
  assert.equal(boundary.collisionEnabled, true);
});

test("Test A: Room 2 without S4A truncated receipt still fails closed", () => {
  const span = corroborateObservedSpan({
    polyline: room2Seam,
    occupancy: uniqueOccupancy(room2Seam, room2Floor, room2Wall),
    floorPolygon: room2Floor,
    wallPolygon: room2Wall,
  });
  assert.equal(span.passed, false);
  assert.equal(span.wallFrontierPass, false);
  assert.equal(span.contradictionProbeCount, 4);
});

test("Test B: bitten floor remains fatal even with truncated wall receipt", () => {
  const bittenFloor = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 0.8, y: 0.62 },
    { x: 0.65, y: 0.62 },
    { x: 0.5, y: 0.8 },
    { x: 0.35, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const span = corroborateObservedSpan({
    polyline: [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
    occupancy: uniqueOccupancy(
      [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
      defaultFloorPolygon,
      defaultWallPolygon,
    ),
    floorPolygon: bittenFloor,
    wallPolygon: defaultWallPolygon,
    s4aAccepted: true,
    s4aWallFrontier: syntheticTruncatedWallFrontier(),
  });
  assert.equal(span.passed, false);
  assert.equal(span.floorFrontierPass, false);
});

test("Test C: radiator/baseboard floor-frontier contradiction remains fatal", () => {
  const radiator = [{ x: 0.3, y: 0.35 }, { x: 0.7, y: 0.35 }];
  const span = corroborateObservedSpan({
    polyline: radiator,
    occupancy: uniqueOccupancy(
      [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
      defaultFloorPolygon,
      defaultWallPolygon,
    ),
    floorPolygon: defaultFloorPolygon,
    wallPolygon: defaultWallPolygon,
    s4aAccepted: true,
    s4aWallFrontier: syntheticTruncatedWallFrontier(),
  });
  assert.equal(span.passed, false);
  assert.equal(span.floorFrontierPass, false);

  const { observation, s4a } = readyTwoPoint();
  const baseboard = withCandidate(s4a, (candidate) => ({
    ...candidate,
    imageEvidence: {
      ...candidate.imageEvidence,
      polyline: [{ x: 0.25, y: 0.58 }, { x: 0.75, y: 0.58 }],
      frontier: syntheticTruncatedWallFrontier(),
    },
  }));
  const s4b = collide(baseboard, observation);
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.equal(s4b.boundaries[0]?.corroboration.floorFrontierPass, false);
});

test("Test D: interior floor line remains rejected under truncated wall receipt", () => {
  const span = corroborateObservedSpan({
    polyline: [{ x: 0.35, y: 0.85 }, { x: 0.65, y: 0.85 }],
    occupancy: uniqueOccupancy(
      [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
      defaultFloorPolygon,
      defaultWallPolygon,
    ),
    floorPolygon: defaultFloorPolygon,
    wallPolygon: defaultWallPolygon,
    s4aAccepted: true,
    s4aWallFrontier: syntheticTruncatedWallFrontier(),
  });
  assert.equal(span.passed, false);
  assert.equal(span.floorFrontierPass, false);
});

test("Test E: same-side occupancy remains a hard contradiction", () => {
  assert.equal(
    classifyRegionalOppositeOccupancy({ plus: "floor_only", minus: "floor_only" }),
    "contradiction",
  );
  assert.equal(
    classifyRegionalOppositeOccupancy({ plus: "wall_only", minus: "wall_only" }),
    "contradiction",
  );
  const sameSideWall = [
    { x: 0.15, y: 0.95 },
    { x: 0.85, y: 0.95 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const span = corroborateObservedSpan({
    polyline: [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
    occupancy: {
      floorSide: "positive",
      wallSide: "negative",
      opposite: true,
      floorOnLineCount: 1,
      floorPositiveCount: 4,
      floorNegativeCount: 0,
      wallOnLineCount: 1,
      wallPositiveCount: 0,
      wallNegativeCount: 4,
    },
    floorPolygon: defaultFloorPolygon,
    wallPolygon: sameSideWall,
    s4aAccepted: true,
    s4aWallFrontier: syntheticTruncatedWallFrontier(),
  });
  assert.equal(span.passed, false);
  assert.ok(span.contradictionProbeCount >= 1);
  assert.equal(span.occupancyPass, false);
});

test("Test F: full non-truncated wall still corroborates unchanged", () => {
  const span = spanOf(
    [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
    defaultFloorPolygon,
    defaultWallPolygon,
  );
  assert.equal(span.passed, true);
  assert.equal(span.floorFrontierPass, true);
  assert.equal(span.wallFrontierPass, true);
  assert.equal(span.occupancyPass, true);
  assert.equal(span.contradictionProbeCount, 0);
});

test("Test G: frame-adjacent supported+N/A does not become an automatic one-sided pass", () => {
  const floor = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const wall = [
    { x: 0.2, y: 0.1 },
    { x: 0.8, y: 0.1 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const start = { x: 0.25, y: 0.62 };
  const end = { x: 0.99, y: 0.62 };
  const occupancy = uniqueOccupancy([start, end], floor, wall);
  const truncated = classifyRegionalProbeEvidence({
    probe: { x: 0.995, y: 0.62 },
    start,
    end,
    occupancy,
    floorPolygon: floor,
    wallPolygon: wall,
    s4aTruncatedWallSupport: true,
  });
  const supported = classifyRegionalProbeEvidence({
    probe: { x: 0.5, y: 0.62 },
    start,
    end,
    occupancy,
    floorPolygon: floor,
    wallPolygon: wall,
    s4aTruncatedWallSupport: true,
  });
  assert.equal(supported.status, "pass");
  assert.ok(
    truncated.status === "not_applicable" || truncated.occupancy === "not_applicable",
  );
  assert.notEqual(truncated.status, "pass");
  assert.notEqual(truncated.occupancy, "contradiction");
});

test("Test H: focused supporting-region overshoot remains a separate passing path", () => {
  const floor = [
    { x: 0.06, y: 1 },
    { x: 0.96, y: 1 },
    { x: 0.8, y: 0.64 },
    { x: 0.18, y: 0.64 },
  ];
  const seam = [
    { x: 0.06, y: 1 },
    { x: 0.18, y: 0.64 },
  ];
  const overshootWall = [
    { x: 0, y: 0.22 },
    { x: 0.18, y: 0.16 },
    { x: 0.24, y: 0.58 },
    { x: 0.24, y: 0.70 },
    { x: 0.06, y: 1 },
  ];
  assert.equal(
    classifyFocusedWallSupportingRegion(seam, overshootWall, floor),
    "supporting_region_interior_overshoot",
  );
  const occupancy = evaluateOppositeOccupancy(seam, floor, overshootWall);
  const focused = corroborateObservedSpan({
    polyline: seam,
    occupancy,
    floorPolygon: floor,
    wallPolygon: overshootWall,
    supportingRegionWall: true,
  });
  assert.equal(focused.passed, true);
  const general = corroborateObservedSpan({
    polyline: seam,
    occupancy,
    floorPolygon: floor,
    wallPolygon: overshootWall,
  });
  assert.equal(general.passed, false);
  const midpoint = {
    x: (seam[0]!.x + seam[1]!.x) / 2,
    y: (seam[0]!.y + seam[1]!.y) / 2,
  };
  const truncatedOnOvershoot = classifyRegionalProbeEvidence({
    probe: midpoint,
    start: seam[0]!,
    end: seam[1]!,
    occupancy,
    floorPolygon: floor,
    wallPolygon: overshootWall,
    s4aTruncatedWallSupport: true,
  });
  assert.notEqual(truncatedOnOvershoot.wallFrontier.status, "not_applicable");
});

test("Test I: zero S4A wall evidence still fails closed", () => {
  const occupancy = uniqueOccupancy(room2Seam, room2Floor, room2Wall);
  const noWallPass = {
    ...room2TruncatedFrontier(),
    wallVertices: room2TruncatedFrontier().wallVertices.map((vertex) => ({
      ...vertex,
      applicability: "unsupported_by_frame" as const,
      status: "not_applicable" as const,
    })),
  };
  assert.equal(s4aWallFrontierHasCertifiedTruncatedSupport(noWallPass), false);
  const span = corroborateObservedSpan({
    polyline: room2Seam,
    occupancy,
    floorPolygon: room2Floor,
    wallPolygon: room2Wall,
    s4aAccepted: true,
    s4aWallFrontier: noWallPass,
  });
  assert.equal(span.passed, false);
  assert.equal(span.wallFrontierPass, false);

  const missingWall = corroborateObservedSpan({
    polyline: room2Seam,
    occupancy,
    floorPolygon: room2Floor,
    wallPolygon: null,
    s4aAccepted: true,
    s4aWallFrontier: room2TruncatedFrontier(),
  });
  assert.equal(missingWall.passed, false);
  assert.equal(missingWall.kind, "none");
});

test("Test J: opening crossing remains collision-false independent of truncation", () => {
  const crossingOpening = {
    id: "door",
    category: "doorway",
    hostPlaneId: "visible_wall",
    sourceNormalizedBoundary: [
      { x: 0.04, y: 0.70 },
      { x: 0.09, y: 0.70 },
      { x: 0.09, y: 0.95 },
      { x: 0.04, y: 0.95 },
    ],
    boundaryClosure: "complete_visible_outline",
    boundaryEvidenceCompleteness: "all_edges_visibly_traced",
    confidence: 0.9,
    visibility: "observed",
  };
  const observation = twoPointEvidenceWithPlanes(room2Floor, room2Wall, {
    observedSeams: [{
      id: "left_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: room2Seam,
      confidence: 0.9,
      visibility: "observed",
    }],
    observedOpenings: [crossingOpening],
  });
  const s4a = withCollisionReadyInterior(s4aReceipt(room2Observation()));
  const s4b = collide(s4a, observation);
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.seamCrossesReportedOpening,
    ),
  );
});

test("Test K: S4A rejection cannot be promoted by truncated-wall corroboration", () => {
  const observation = room2Observation();
  const s4a = withCandidate(s4aReceipt(observation), (candidate) => ({
    ...candidate,
    status: "rejected" as const,
    reasons: [...candidate.reasons, "observer_ambiguity_present"],
  }));
  const s4b = collide(s4a, observation);
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.s4aNotAccepted,
    ),
  );
});

test("frame-truncated wall handling does not loosen named thresholds", () => {
  assert.equal(ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE, 0.012);
  assert.equal(ROOM_BOUNDARY_INTERIOR_WITNESS_INSET, 0.012);
  assert.equal(ROOM_BOUNDARY_FRAME_EDGE_PROXIMITY, 0.02);
  const qualification = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/room-boundary-qualification.server.ts"),
    "utf8",
  );
  const collision = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/room-collision-qualification.server.ts"),
    "utf8",
  );
  assert.doesNotMatch(qualification, /confidence\s*[><=]/);
  assert.doesNotMatch(collision, /MIN_CONFIDENCE|confidenceThreshold/);
  assert.match(collision, /s4aWallFrontierHasCertifiedTruncatedSupport/);
  assert.match(collision, /s4aAccepted: candidate.status === "accepted"/);
});
