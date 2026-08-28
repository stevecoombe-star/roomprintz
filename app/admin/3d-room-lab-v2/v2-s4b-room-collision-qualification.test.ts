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
  floorWallPolylineCrossesOpeningInterior,
} from "./room-collision-qualification.server";

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
  assert.equal(boundary.limitations.twoPointObserved, true);
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
