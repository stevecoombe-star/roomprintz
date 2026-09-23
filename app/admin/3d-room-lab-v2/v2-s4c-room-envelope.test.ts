import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmptyRoomObservationEvidence,
  type EmptyObservedOpening,
} from "./empty-room-observation-contract";
import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import {
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION,
  AFC_V2_EMPTY_ORIGINAL_REGISTRATION_IDENTITY_VERSION,
} from "./empty-original-registration-authority-contract";
import {
  constructAfcV2RoomBoundaryAuthority,
  type RoomBoundaryConstructionInput,
} from "./room-boundary-authority.server";
import type { RoomBoundaryCandidate } from "./room-boundary-authority-contract";
import { ROOM_ENVELOPE_REASON } from "./room-envelope-authority-contract";
import { constructAfcV2RoomEnvelopeAuthority } from "./room-envelope-authority.server";
import { qualifyOpeningFloorGap } from "./room-envelope-opening-qualification";
import {
  lerpWorldXzSegment,
  subtractParameterIntervals,
} from "./room-envelope-span-subtraction";

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
  registrationClass: AfcV2EmptyOriginalRegistrationAuthorityReceipt["registrationClass"] =
    "exact_grid_registered",
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
    oldCompatibilityTier: "exact_grid_compatible",
    collisionPromotionEligible: eligible,
    geometryManufactured: false,
    residuals: {
      max: null,
      rms: null,
      maxAbsU: null,
      maxAbsV: null,
      anchorMax: null,
      anchorRms: null,
      ridgeNormalMax: null,
      ridgeNormalRms: null,
      diagnosticSimilarity: null,
      diagnosticRidgeScale: null,
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
      emptyIdentity: { ...emptyIdentity, orientation: 1 },
      originalIdentity: { ...originalIdentity, orientation: 1 },
      emptySha256: emptyIdentity.sha256,
      originalSha256: originalIdentity.sha256,
      observationSchemaVersion: null,
      observationEvidenceId: "s4c1",
      rasterProofAttempted: false,
    },
    constructionReasons: [],
    receiptSha256: "r".repeat(64),
  };
}

function doorOpening(overrides: Partial<EmptyObservedOpening> = {}): Record<string, unknown> {
  return {
    id: "door",
    category: "doorway",
    hostPlaneId: "visible_wall",
    sourceNormalizedBoundary: [
      { x: 0.4, y: 0.48 },
      { x: 0.6, y: 0.48 },
      { x: 0.6, y: 0.74 },
      { x: 0.4, y: 0.74 },
    ],
    boundaryClosure: "complete_visible_outline",
    boundaryEvidenceCompleteness: "all_edges_visibly_traced",
    confidence: 0.9,
    visibility: "observed",
    ...overrides,
  };
}

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

function evidence(raw: unknown = providerObservation()) {
  return buildEmptyRoomObservationEvidence(raw, {
    attemptId: "s4c1",
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
): RoomBoundaryConstructionInput {
  return {
    attemptId: "s4c1",
    loadGeneration: 1,
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
  };
}

function readyCandidate(observation = evidence(providerObservation({
  observedOpenings: [doorOpening()],
}))) {
  const s4a = constructAfcV2RoomBoundaryAuthority(construction(observation));
  const candidate = s4a.candidates[0];
  assert.ok(candidate);
  return {
    observation,
    s4a,
    candidate: {
      ...candidate,
      status: "accepted" as const,
      interior: {
        ...candidate.interior,
        status: "accepted" as const,
        sideSign: candidate.interior.sideSign === -1 ? -1 as const : 1 as const,
        cameraSideSign: candidate.interior.sideSign === -1 ? -1 as const : 1 as const,
      },
      authority: {
        ...candidate.authority,
        baseSegment: true,
        supportPlane: true,
        collision: false as const,
      },
    } satisfies RoomBoundaryCandidate,
  };
}

test("door that reaches the floor creates an accepted gap", () => {
  const { candidate, observation } = readyCandidate();
  const opening = observation.observedOpenings[0]!;
  const result = qualifyOpeningFloorGap({
    opening,
    candidate,
    registration: registration(),
  });
  assert.equal(result.accepted, true);
  assert.ok(result.interval);
  assert.ok(result.interval.t1 > result.interval.t0);
});

test("multiple openings merge intervals before subtraction", () => {
  const { observation, s4a } = readyCandidate(evidence(providerObservation({
    observedOpenings: [
      doorOpening({
        id: "door_a",
        sourceNormalizedBoundary: [
          { x: 0.28, y: 0.48 },
          { x: 0.42, y: 0.48 },
          { x: 0.42, y: 0.74 },
          { x: 0.28, y: 0.74 },
        ],
      }),
      doorOpening({
        id: "door_b",
        sourceNormalizedBoundary: [
          { x: 0.38, y: 0.48 },
          { x: 0.52, y: 0.48 },
          { x: 0.52, y: 0.74 },
          { x: 0.38, y: 0.74 },
        ],
      }),
    ],
  })));
  const envelope = constructAfcV2RoomEnvelopeAuthority({
    registration: registration(),
    roomBoundary: {
      ...s4a,
      candidates: [readyCandidate(observation).candidate],
    },
    roomCollision: null,
    observation,
  });
  const qualified = envelope.openings.filter((opening) =>
    opening.status === "qualified_floor_gap"
  );
  assert.equal(qualified.length, 2);
  assert.ok(envelope.solidBaseSpans.length >= 1);
  assert.equal(envelope.geometryDerivation, "observed_interval_subtraction");
  const intervals = qualified
    .map((opening) => opening.floorContactInterval)
    .filter((interval): interval is NonNullable<typeof interval> => Boolean(interval));
  assert.equal(intervals.length, 2);
  const overlap = intervals[0]!.t0 < intervals[1]!.t1 && intervals[1]!.t0 < intervals[0]!.t1;
  assert.equal(overlap, true);
  const spanIntervals = envelope.solidBaseSpans.map((span) => [span.t0, span.t1]);
  for (const [t0, t1] of spanIntervals) {
    assert.ok((t0 ?? 0) <= (t1 ?? 0));
    assert.ok((t0 ?? 0) >= 0 && (t1 ?? 1) <= 1);
  }
});

test("window does not subtract base", () => {
  const { candidate, observation } = readyCandidate(evidence(providerObservation({
    observedOpenings: [doorOpening({ id: "window", category: "window" })],
  })));
  const result = qualifyOpeningFloorGap({
    opening: observation.observedOpenings[0]!,
    candidate,
    registration: registration(),
  });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes(ROOM_ENVELOPE_REASON.categoryNotFloorReaching));
});

test("unknown opening fails closed", () => {
  const { candidate, observation } = readyCandidate(evidence(providerObservation({
    observedOpenings: [doorOpening({ id: "mystery", category: "unknown" })],
  })));
  const result = qualifyOpeningFloorGap({
    opening: observation.observedOpenings[0]!,
    candidate,
    registration: registration(),
  });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes(ROOM_ENVELOPE_REASON.categoryNotFloorReaching));
});

test("null hostPlaneId fails closed", () => {
  const { candidate, observation } = readyCandidate(evidence(providerObservation({
    observedOpenings: [doorOpening({ hostPlaneId: null })],
  })));
  const result = qualifyOpeningFloorGap({
    opening: observation.observedOpenings[0]!,
    candidate,
    registration: registration(),
  });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes(ROOM_ENVELOPE_REASON.nullHostPlane));
});

test("wrong host wall fails closed", () => {
  const { candidate, observation } = readyCandidate(evidence(providerObservation({
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
      {
        id: "other_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.7, y: 0.1 }, { x: 0.95, y: 0.1 }, { x: 0.95, y: 0.9 }, { x: 0.7, y: 0.9 },
        ],
        confidence: 0.8,
        visibility: "observed",
      },
    ],
    observedOpenings: [doorOpening({ hostPlaneId: "other_wall" })],
  })));
  const result = qualifyOpeningFloorGap({
    opening: observation.observedOpenings[0]!,
    candidate,
    registration: registration(),
  });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes(ROOM_ENVELOPE_REASON.wrongHostWall));
});

test("one jamb only fails closed", () => {
  const { candidate, observation } = readyCandidate(evidence(providerObservation({
    observedOpenings: [doorOpening({
      sourceNormalizedBoundary: [
        { x: 0.5, y: 0.2 },
        { x: 0.7, y: 0.2 },
        { x: 0.7, y: 0.62 },
        { x: 0.5, y: 0.62 },
      ],
      boundaryClosure: "partial_visible_outline",
      boundaryEvidenceCompleteness: "partial_edges_only",
    })],
  })));
  const result = qualifyOpeningFloorGap({
    opening: observation.observedOpenings[0]!,
    candidate,
    registration: registration(),
  });
  assert.equal(result.accepted, false);
});

test("endpoint touch only does not subtract", () => {
  const { candidate, observation } = readyCandidate(evidence(providerObservation({
    observedOpenings: [doorOpening({
      sourceNormalizedBoundary: [
        { x: 0.8, y: 0.4 },
        { x: 0.95, y: 0.4 },
        { x: 0.95, y: 0.61 },
        { x: 0.8, y: 0.61 },
      ],
    })],
  })));
  const result = qualifyOpeningFloorGap({
    opening: observation.observedOpenings[0]!,
    candidate,
    registration: registration(),
  });
  assert.equal(result.accepted, false);
});

test("opening at wall endpoint subtracts only the interior contact interval", () => {
  const residuals = subtractParameterIntervals({ t0: 0, t1: 1 }, [{ t0: 0, t1: 0.25 }]);
  assert.equal(residuals.length, 1);
  assert.equal(residuals[0]?.t0, 0.25);
  assert.equal(residuals[0]?.t1, 1);
});

test("frame-truncated one-sided opening fails closed", () => {
  const { candidate, observation } = readyCandidate(evidence(providerObservation({
    observedOpenings: [doorOpening({
      boundaryClosure: "partial_visible_outline",
      boundaryEvidenceCompleteness: "partial_edges_only",
      sourceNormalizedBoundary: [
        { x: 0.01, y: 0.4 },
        { x: 0.2, y: 0.4 },
        { x: 0.2, y: 0.7 },
        { x: 0.01, y: 0.7 },
      ],
    })],
  })));
  const result = qualifyOpeningFloorGap({
    opening: observation.observedOpenings[0]!,
    candidate,
    registration: registration(),
  });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes(ROOM_ENVELOPE_REASON.frameTruncated));
});

test("unregistered aspect room does not create a physical gap", () => {
  const { observation, s4a } = readyCandidate();
  const envelope = constructAfcV2RoomEnvelopeAuthority({
    registration: registration("insufficient"),
    roomBoundary: s4a,
    roomCollision: null,
    observation,
  });
  assert.equal(envelope.solidBaseSpans.length, 0);
  assert.equal(envelope.geometryDerivation, "none");
  assert.ok(
    envelope.openings.every((opening) => opening.status === "refused"),
  );
});

test("span subtraction covers middle, start, end, full, zero, overlap, and clamp", () => {
  assert.deepEqual(
    subtractParameterIntervals({ t0: 0, t1: 1 }, [{ t0: 0.4, t1: 0.6 }]),
    [{ t0: 0, t1: 0.4 }, { t0: 0.6, t1: 1 }],
  );
  assert.deepEqual(
    subtractParameterIntervals({ t0: 0, t1: 1 }, [{ t0: 0, t1: 0.3 }]),
    [{ t0: 0.3, t1: 1 }],
  );
  assert.deepEqual(
    subtractParameterIntervals({ t0: 0, t1: 1 }, [{ t0: 0.7, t1: 1 }]),
    [{ t0: 0, t1: 0.7 }],
  );
  assert.deepEqual(
    subtractParameterIntervals({ t0: 0, t1: 1 }, [{ t0: 0, t1: 1 }]),
    [],
  );
  assert.deepEqual(
    subtractParameterIntervals({ t0: 0, t1: 1 }, [{ t0: 0.5, t1: 0.5 }]),
    [{ t0: 0, t1: 1 }],
  );
  assert.deepEqual(
    subtractParameterIntervals({ t0: 0, t1: 1 }, [
      { t0: 0.2, t1: 0.45 },
      { t0: 0.4, t1: 0.6 },
    ]),
    [{ t0: 0, t1: 0.2 }, { t0: 0.6, t1: 1 }],
  );
  const clamped = subtractParameterIntervals({ t0: 0, t1: 1 }, [{ t0: -0.2, t1: 0.2 }]);
  assert.equal(clamped[0]?.t0, 0.2);
  assert.ok((clamped[0]?.t1 ?? 0) <= 1);
  const sorted = subtractParameterIntervals({ t0: 0, t1: 1 }, [
    { t0: 0.7, t1: 0.8 },
    { t0: 0.1, t1: 0.2 },
  ]);
  assert.deepEqual(sorted, [
    { t0: 0, t1: 0.1 },
    { t0: 0.2, t1: 0.7 },
    { t0: 0.8, t1: 1 },
  ]);
});

test("world residual geometry is a source-segment lerp", () => {
  const segment = { a: { x: 0, z: 0 }, b: { x: 4, z: 2 } };
  assert.deepEqual(lerpWorldXzSegment(segment, 0.5), { x: 2, z: 1 });
  assert.deepEqual(lerpWorldXzSegment(segment, -1), { x: 0, z: 0 });
  assert.deepEqual(lerpWorldXzSegment(segment, 2), { x: 4, z: 2 });
});

test("envelope residual spans keep manufactured and hidden-continuation false", () => {
  const { observation, s4a } = readyCandidate();
  const envelope = constructAfcV2RoomEnvelopeAuthority({
    registration: registration(),
    roomBoundary: {
      ...s4a,
      candidates: s4a.candidates.map((candidate) => ({
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
          collision: false as const,
        },
      })),
    },
    roomCollision: null,
    observation,
  });
  assert.equal(envelope.geometryManufactured, false);
  assert.equal(envelope.hiddenContinuation, false);
  for (const span of envelope.solidBaseSpans) {
    assert.equal(span.hiddenContinuation, false);
    assert.equal(span.geometryDerivation, "observed_interval_subtraction");
  }
  assert.deepEqual(envelope.corners, []);
  assert.deepEqual(envelope.verticalExtents, []);
  assert.equal(envelope.ceiling.status, "not_evaluated");
});
