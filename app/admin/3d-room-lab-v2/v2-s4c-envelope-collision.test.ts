import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildEmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import {
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION,
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
  type AfcV2EmptyOriginalRegistrationAuthorityReceipt,
} from "./empty-original-registration-authority-contract";
import {
  constructAfcV2RoomBoundaryAuthority,
  type RoomBoundaryConstructionInput,
} from "./room-boundary-authority.server";
import type { RoomBoundaryCandidate } from "./room-boundary-authority-contract";
import {
  ROOM_COLLISION_REASON,
  enabledCollisionWallsFromReceipt,
} from "./room-collision-authority-contract";
import { constructAfcV2RoomCollisionAuthority } from "./room-collision-qualification.server";
import { constructAfcV2RoomEnvelopeAuthority } from "./room-envelope-authority.server";
import {
  selectActiveRuntimeCollisionWalls,
} from "./room-envelope-collision-authority-contract";
import { constructAfcV2RoomEnvelopeCollisionAuthority } from "./room-envelope-collision-qualification.server";
import { resolveSceneObjectCollision } from "./scene-collision-resolver";
import { TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB } from "./room-collision-footprint";
import { DEFAULT_WORLD_TRANSFORM } from "./scene-layer-state";

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

function registration(
  registrationClass: AfcV2EmptyOriginalRegistrationAuthorityReceipt["registrationClass"],
  oldCompatibilityTier: AfcV2EmptyOriginalRegistrationAuthorityReceipt["oldCompatibilityTier"] =
    "exact_grid_compatible",
): AfcV2EmptyOriginalRegistrationAuthorityReceipt {
  const eligible = registrationClass === "exact_grid_registered" ||
    registrationClass === "certified_rescaled_registered";
  return {
    schemaVersion: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION,
    sourceSpace: "empty-source-normalized-image/v1",
    targetSpace: "original-source-normalized-image/v1",
    authority: "empty_original_registration_authority",
    methodVersion: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
    registrationClass,
    transformKind: eligible ? "identity_normalized" : "none",
    transform: eligible
      ? { kind: "identity_normalized", su: 1, sv: 1, tu: 0, tv: 0 }
      : null,
    oldCompatibilityTier,
    collisionPromotionEligible: eligible,
    geometryManufactured: false,
    residuals: {
      max: null, rms: null, maxAbsU: null, maxAbsV: null,
      anchorMax: null, anchorRms: null, ridgeNormalMax: null, ridgeNormalRms: null,
      diagnosticSimilarity: null, diagnosticRidgeScale: null,
      diagnosticRidgeScaleAbsFromIdentity: null,
    },
    correspondenceCount: 0,
    attemptedCorrespondenceCount: 0,
    inlierFraction: null,
    correspondenceSpread: null,
    outlierCount: 0,
    correspondences: [],
    rawPointDiagnostics: [],
    anchorCount: 0,
    anchorInlierCount: 0,
    ridgeStructureCount: 0,
    ridgeInlierCount: 0,
    independentEvidenceUnitCount: 0,
    attemptedEvidenceUnitCount: 0,
    orientationBinCount: null,
    zoomLockSatisfied: null,
    zoomLockConfiguration: "not_applicable",
    contradictionCount: 0,
    limitations: {
      globalOnly: true,
      localAuthority: false,
      fittedTransformNotAuthoritative: true,
      rasterProofRequiredForRescaled: true,
      ridgeTangentNonAuthoritative: true,
      diagnosticSimilarityClassAOnly: true,
    },
    lineage: {
      methodVersion: AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
      emptyIdentity: { ...emptyIdentity },
      originalIdentity: { ...originalIdentity },
      emptySha256: emptyIdentity.sha256,
      originalSha256: originalIdentity.sha256,
      observationSchemaVersion: null,
      observationEvidenceId: "s4cq",
      rasterProofAttempted: false,
    },
    constructionReasons: [],
    receiptSha256: "r".repeat(64),
  };
}

function providerObservation(overrides: Record<string, unknown> = {}) {
  return {
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
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
    attemptId: "s4cq",
    loadGeneration: 1,
    emptyIdentity: { ...emptyIdentity, byteCount: 3, mimeType: "image/png" },
    originalAncestorSha256: originalIdentity.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-28T12:00:00.000Z",
  });
}

function construction(
  observation = evidence(),
  identity = originalIdentity,
): RoomBoundaryConstructionInput {
  return {
    attemptId: "s4cq",
    loadGeneration: 1,
    observation,
    emptyIdentity: {
      ...emptyIdentity,
      decodedWidth: identity === originalIdentity ? 1200 : 800,
      decodedHeight: identity === originalIdentity ? 800 : 600,
    },
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

function withReadyInterior<T extends { candidates: readonly RoomBoundaryCandidate[] }>(
  receipt: T,
): T {
  return {
    ...receipt,
    candidates: receipt.candidates.map((candidate) => ({
      ...candidate,
      status: "accepted",
      interior: {
        ...candidate.interior,
        status: "accepted",
        sideSign: candidate.interior.sideSign === -1 ? -1 : 1,
        cameraSideSign: candidate.interior.sideSign === -1 ? -1 : 1,
      },
      authority: {
        ...candidate.authority,
        baseSegment: true,
        supportPlane: true,
        collision: false,
      },
    })),
  };
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

test("baseline S4B enabled walls are copied into S4C-CQ", () => {
  const observation = evidence();
  const s4a = withReadyInterior(constructAfcV2RoomBoundaryAuthority(construction(observation)));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const s4c = constructAfcV2RoomEnvelopeCollisionAuthority({
    roomCollision: s4b,
    registration: registration("exact_grid_registered"),
    roomEnvelope: constructAfcV2RoomEnvelopeAuthority({
      registration: registration("exact_grid_registered"),
      roomBoundary: s4a,
      roomCollision: s4b,
      observation,
    }),
  });
  assert.ok(s4c);
  const s4bEnabled = enabledCollisionWallsFromReceipt(s4b);
  const s4cEnabled = s4c.walls.filter((wall) => wall.collisionEnabled);
  assert.equal(s4cEnabled.length, s4bEnabled.length);
  assert.ok(s4cEnabled.every((wall) => wall.derivation === "s4b_baseline_copy"));
});

test("opening-vetoed S4B wall is replaced by residual solids without duplicating the whole wall", () => {
  const observation = doorObservation();
  const s4a = withReadyInterior(constructAfcV2RoomBoundaryAuthority(construction(observation)));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  assert.ok(
    s4b.boundaries.some((boundary) =>
      boundary.qualificationReasons.includes(ROOM_COLLISION_REASON.seamCrossesReportedOpening)
    ),
  );
  const envelope = constructAfcV2RoomEnvelopeAuthority({
    registration: registration("exact_grid_registered"),
    roomBoundary: s4a,
    roomCollision: s4b,
    observation,
  });
  const s4c = constructAfcV2RoomEnvelopeCollisionAuthority({
    roomCollision: s4b,
    registration: registration("exact_grid_registered"),
    roomEnvelope: envelope,
  });
  assert.ok(s4c);
  if (envelope.solidBaseSpans.length > 0) {
    assert.equal(s4c.openingSubtractionPerformed, true);
    const residualIds = new Set(envelope.solidBaseSpans.map((span) => span.id));
    const enabled = s4c.walls.filter((wall) => wall.collisionEnabled);
    assert.ok(enabled.some((wall) => residualIds.has(wall.id)));
    assert.equal(
      enabled.some((wall) =>
        wall.id === s4b.boundaries[0]?.sourceBoundaryId && wall.openingSubtractionPerformed
      ),
      false,
    );
  }
});

test("runtime XOR prefers S4C-CQ when constructed and falls back to S4B otherwise", () => {
  const observation = evidence();
  const s4a = withReadyInterior(constructAfcV2RoomBoundaryAuthority(construction(observation)));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const s4c = constructAfcV2RoomEnvelopeCollisionAuthority({
    roomCollision: s4b,
    registration: registration("exact_grid_registered"),
    roomEnvelope: constructAfcV2RoomEnvelopeAuthority({
      registration: registration("exact_grid_registered"),
      roomBoundary: s4a,
      roomCollision: s4b,
      observation,
    }),
  });
  const withCq = selectActiveRuntimeCollisionWalls({
    envelopeCollision: s4c,
    roomCollision: s4b,
  });
  assert.equal(withCq.source, "s4c_cq");
  const fallback = selectActiveRuntimeCollisionWalls({
    envelopeCollision: null,
    roomCollision: s4b,
  });
  assert.equal(fallback.source, "s4b");
  assert.equal(fallback.walls.length, enabledCollisionWallsFromReceipt(s4b).length);
});

test("certified rescaled registration may promote a wall that S4B refused only for aspect", () => {
  const observation = evidence();
  const rescaledIdentity = {
    sha256: "o".repeat(64),
    decodedWidth: 1800,
    decodedHeight: 1200,
    orientation: 1 as const,
  };
  const s4a = withReadyInterior(constructAfcV2RoomBoundaryAuthority(
    construction(observation, rescaledIdentity),
  ));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
    ),
  );
  const promoted = constructAfcV2RoomEnvelopeCollisionAuthority({
    roomCollision: s4b,
    registration: registration("certified_rescaled_registered", "aspect_compatible_rescaled"),
    roomEnvelope: constructAfcV2RoomEnvelopeAuthority({
      registration: registration("certified_rescaled_registered", "aspect_compatible_rescaled"),
      roomBoundary: s4a,
      roomCollision: s4b,
      observation,
    }),
  });
  assert.ok(promoted);
  const remainingHard = s4b.boundaries[0]?.qualificationReasons.filter((reason) =>
    reason !== ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady &&
    reason !== ROOM_COLLISION_REASON.seamCrossesReportedOpening
  ) ?? [];
  if (remainingHard.length === 0) {
    assert.ok(promoted.walls.some((wall) =>
      wall.collisionEnabled && wall.derivation === "certified_rescaled_promotion"
    ));
  }
});

test("raw aspect without certified registration remains non-collision", () => {
  const observation = evidence();
  const rescaledIdentity = {
    sha256: "o".repeat(64),
    decodedWidth: 1800,
    decodedHeight: 1200,
    orientation: 1 as const,
  };
  const s4a = withReadyInterior(constructAfcV2RoomBoundaryAuthority(
    construction(observation, rescaledIdentity),
  ));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const s4c = constructAfcV2RoomEnvelopeCollisionAuthority({
    roomCollision: s4b,
    registration: registration("insufficient", "aspect_compatible_rescaled"),
    roomEnvelope: constructAfcV2RoomEnvelopeAuthority({
      registration: registration("insufficient", "aspect_compatible_rescaled"),
      roomBoundary: s4a,
      roomCollision: s4b,
      observation,
    }),
  });
  assert.ok(s4c);
  assert.equal(s4c.walls.some((wall) => wall.collisionEnabled), false);
});

test("certified registration does not override remaining hard gates", () => {
  const observation = evidence();
  const s4a = constructAfcV2RoomBoundaryAuthority(construction(observation));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const s4c = constructAfcV2RoomEnvelopeCollisionAuthority({
    roomCollision: s4b,
    registration: registration("certified_rescaled_registered", "aspect_compatible_rescaled"),
    roomEnvelope: constructAfcV2RoomEnvelopeAuthority({
      registration: registration("certified_rescaled_registered", "aspect_compatible_rescaled"),
      roomBoundary: s4a,
      roomCollision: s4b,
      observation,
    }),
  });
  assert.ok(s4c);
  if (s4b.boundaries.some((boundary) =>
    boundary.qualificationReasons.includes(ROOM_COLLISION_REASON.interiorNotCollisionReady) ||
    boundary.qualificationReasons.includes(ROOM_COLLISION_REASON.s4aNotAccepted)
  )) {
    assert.equal(
      s4c.walls.some((wall) => wall.derivation === "certified_rescaled_promotion" && wall.collisionEnabled),
      false,
    );
  }
});

test("Move/sweep/slide/rotate/scale kernel behavior is unchanged", () => {
  const wall = {
    id: "rb_right",
    sourceBoundaryId: "rb_right",
    sourceSeamId: "right_floor_wall",
    a: { x: 1, z: -2 },
    b: { x: 1, z: 2 },
    supportPlaneNormal: { x: 1, y: 0, z: 0 },
    supportPlaneConstant: -1,
    sideSign: -1 as const,
  };
  const move = resolveSceneObjectCollision({
    current: { ...DEFAULT_WORLD_TRANSFORM, position: { x: 0, y: 0, z: 0 } },
    proposed: { ...DEFAULT_WORLD_TRANSFORM, position: { x: 4, y: 0, z: 0 } },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [wall],
    mode: "move",
  });
  assert.ok(Math.abs(move.transform.position.x - 0.25) < 1e-6);
  const rotate = resolveSceneObjectCollision({
    current: { ...DEFAULT_WORLD_TRANSFORM, position: { x: 0.25, y: 0, z: 0 } },
    proposed: {
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: 0.25, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 45, z: 0 },
    },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [wall],
    mode: "pose",
  });
  assert.equal(rotate.status, "rejected_pose");
  const scale = resolveSceneObjectCollision({
    current: { ...DEFAULT_WORLD_TRANSFORM, position: { x: 0.25, y: 0, z: 0 } },
    proposed: {
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: 0.25, y: 0, z: 0 },
      uniformScale: 3,
    },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: [wall],
    mode: "pose",
  });
  assert.equal(scale.status, "rejected_pose");
  const kernel = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/room-collision-geometry.ts"),
    "utf8",
  );
  const resolver = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/scene-collision-resolver.ts"),
    "utf8",
  );
  const footprint = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/room-collision-footprint.ts"),
    "utf8",
  );
  assert.doesNotMatch(kernel, /s4c|envelopeCollision|emptyOriginalRegistration/);
  assert.doesNotMatch(resolver, /constructAfcV2RoomEnvelopeCollisionAuthority/);
  assert.doesNotMatch(footprint, /room-envelope-collision/);
});
