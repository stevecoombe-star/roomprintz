import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { afterEach, beforeEach } from "node:test";

import { buildEmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import {
  constructAfcV2RoomBoundaryAuthority,
  type RoomBoundaryConstructionInput,
} from "./room-boundary-authority.server";
import type {
  AfcV2RoomBoundaryAuthorityReceipt,
  RoomBoundaryCandidate,
} from "./room-boundary-authority-contract";
import {
  ROOM_COLLISION_REASON,
  enabledCollisionWallsFromReceipt,
  type AfcV2RoomCollisionAuthorityReceipt,
  type RoomCollisionBoundary,
  type RoomCollisionBoundaryCorroboration,
} from "./room-collision-authority-contract";
import { constructAfcV2RoomCollisionAuthority } from "./room-collision-qualification.server";
import { constructAfcV2RoomEnvelopeAuthority } from "./room-envelope-authority.server";
import {
  ROOM_ENVELOPE_COLLISION_REASON,
  S4B_HARD_COLLISION_GATES,
  remainingS4bHardGates,
  selectActiveRuntimeCollisionWalls,
} from "./room-envelope-collision-authority-contract";
import { constructAfcV2RoomEnvelopeCollisionAuthority } from "./room-envelope-collision-qualification.server";
import {
  AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION,
  AFC_V2_EMPTY_AUTHORITATIVE_IMAGE_AUTHORITY_POLICY,
  EMPTY_AUTHORITATIVE_COLLISION_REASON,
  enabledEmptyAuthoritativeCollisionWalls,
} from "./empty-authoritative-collision-authority-contract";
import { constructAfcV2EmptyAuthoritativeCollisionAuthority } from "./empty-authoritative-collision-qualification.server";
import { setTrustExplicitGeminiFloorWallObservationForTests } from "./explicit-gemini-floor-wall-trust";
import { ORIGINAL_LOCALIZED_COLLISION_REASON } from "./original-localized-collision-authority-contract";
import type { AfcV2OriginalLocalizedCollisionAuthorityReceipt } from "./original-localized-collision-authority-contract";
import { resolveSceneObjectCollision } from "./scene-collision-resolver";
import { TEST_CUBE_PLACEMENT_LOCAL_AABB } from "./room-collision-footprint";
import { DEFAULT_WORLD_TRANSFORM } from "./scene-layer-state";

beforeEach(() => {
  setTrustExplicitGeminiFloorWallObservationForTests(false);
});
afterEach(() => {
  setTrustExplicitGeminiFloorWallObservationForTests(null);
});

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
    attemptId: "empty-auth",
    loadGeneration: 1,
    emptyIdentity: { ...emptyIdentity, byteCount: 3, mimeType: "image/png" },
    originalAncestorSha256: originalIdentity.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-29T12:00:00.000Z",
  });
}

function construction(
  observation = evidence(),
  identity = originalIdentity,
): RoomBoundaryConstructionInput {
  return {
    attemptId: "empty-auth",
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

function withReadyInterior(
  receipt: AfcV2RoomBoundaryAuthorityReceipt,
): AfcV2RoomBoundaryAuthorityReceipt {
  return {
    ...receipt,
    candidates: receipt.candidates.map((candidate) => ({
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
    })),
  };
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

function withCompatibility(
  receipt: AfcV2RoomBoundaryAuthorityReceipt,
  tier: "exact_grid_compatible" | "aspect_compatible_rescaled" | "incompatible",
): AfcV2RoomBoundaryAuthorityReceipt {
  return {
    ...receipt,
    lineage: {
      ...receipt.lineage,
      emptyToOriginalCompatibility: {
        ...receipt.lineage.emptyToOriginalCompatibility,
        tier,
      },
    },
  };
}

function twoPointObservation(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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

function s4bOf(
  observation = evidence(),
  identity = originalIdentity,
  patch?: (s4a: AfcV2RoomBoundaryAuthorityReceipt) => AfcV2RoomBoundaryAuthorityReceipt,
) {
  const s4a = (patch ?? withReadyInterior)(
    constructAfcV2RoomBoundaryAuthority(construction(observation, identity)),
  );
  return {
    observation,
    s4a,
    s4b: constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation }),
  };
}

function emptyAuthoritative(input: {
  s4b: ReturnType<typeof constructAfcV2RoomCollisionAuthority>;
  observation?: ReturnType<typeof evidence>;
  s4a?: AfcV2RoomBoundaryAuthorityReceipt;
  registrationClass?: AfcV2EmptyOriginalRegistrationAuthorityReceipt["registrationClass"];
  originalLocalizationClass?: string | null;
}) {
  const registration = input.registrationClass
    ? { registrationClass: input.registrationClass } as AfcV2EmptyOriginalRegistrationAuthorityReceipt
    : null;
  const envelope = input.s4a
    ? constructAfcV2RoomEnvelopeAuthority({
      registration,
      roomBoundary: input.s4a,
      roomCollision: input.s4b,
      observation: input.observation ?? null,
    })
    : null;
  return constructAfcV2EmptyAuthoritativeCollisionAuthority({
    roomCollision: input.s4b,
    roomEnvelope: envelope,
    identityRegistration: registration,
    originalLocalization: input.originalLocalizationClass
      ? { registrationClass: input.originalLocalizationClass } as never
      : null,
  });
}

function assertNoRegistrationOrOlVeto(
  receipt: ReturnType<typeof constructAfcV2EmptyAuthoritativeCollisionAuthority>,
) {
  const reasons = [
    ...receipt.constructionReasons,
    ...receipt.walls.flatMap((wall) => wall.qualificationReasons),
  ];
  for (const reason of reasons) {
    assert.equal(reason.includes("registration"), false, reason);
    assert.equal(reason.includes("ol_"), false, reason);
    assert.notEqual(
      reason,
      ROOM_ENVELOPE_COLLISION_REASON.registrationNotCertifiedForPromotion,
    );
    assert.notEqual(
      reason,
      ORIGINAL_LOCALIZED_COLLISION_REASON.localizationNotCertified,
    );
  }
}

test("exact-grid EMPTY-authoritative matches S4B enabled walls and does not rewrite S4B", () => {
  const { observation, s4a, s4b } = s4bOf();
  assert.equal(s4b.collisionAuthority, true);
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.schemaVersion, AFC_V2_EMPTY_AUTHORITATIVE_COLLISION_AUTHORITY_VERSION);
  assert.equal(ea.collisionAuthority, true);
  assert.equal(
    enabledEmptyAuthoritativeCollisionWalls(ea).length,
    enabledCollisionWallsFromReceipt(s4b).length,
  );
  assert.equal(s4b.collisionAuthority, true);
  assert.equal(
    s4b.qualificationVersion,
    "afc-v2-room-collision-qualification/v3",
  );
});

test("aspect_compatible_rescaled with rejected registration and absent OL becomes collision-enabled", () => {
  const { observation, s4a, s4b } = s4bOf(evidence(), rescaledOriginalIdentity);
  assert.equal(
    s4b.lineage.roomBoundary.compatibilityTier,
    "aspect_compatible_rescaled",
  );
  assert.equal(s4b.collisionAuthority, false);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
    ),
  );
  const ea = emptyAuthoritative({
    s4b,
    s4a,
    observation,
    registrationClass: "rejected",
    originalLocalizationClass: "original_localization_insufficient",
  });
  assert.equal(ea.experimentalPolicy, true);
  assert.equal(ea.originalCorroborationRequired, false);
  assert.equal(ea.imageAuthorityPolicy, AFC_V2_EMPTY_AUTHORITATIVE_IMAGE_AUTHORITY_POLICY);
  assert.equal(ea.collisionAuthority, true);
  assert.ok(ea.walls.some((wall) => wall.collisionEnabled));
  assert.equal(
    ea.walls[0]?.derivation,
    "empty_authoritative_promotion",
  );
  assertNoRegistrationOrOlVeto(ea);
  assert.equal(ea.lineage.identityRegistration.registrationClass, "rejected");
  assert.equal(ea.lineage.identityRegistration.diagnosticOnly, true);
  assert.equal(ea.lineage.originalLocalization.diagnosticOnly, true);
});

test("aspect-rescaled two-point region/frontier corroboration can enable collision", () => {
  const observation = twoPointObservation();
  const { s4a, s4b } = s4bOf(observation, rescaledOriginalIdentity);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.limitations.twoPointObserved, true);
  assert.equal(boundary.limitations.twoPointCorroborated, true);
  assert.equal(boundary.collisionEnabled, false);
  const ea = emptyAuthoritative({ s4b, s4a, observation, registrationClass: "rejected" });
  assert.equal(ea.collisionAuthority, true);
  assert.equal(ea.walls[0]?.twoPointObserved, true);
  assert.equal(ea.walls[0]?.twoPointCorroborated, true);
  assert.equal(ea.walls[0]?.corroboration.kind, "multi_probe_region_frontier");
  assert.equal(ea.walls[0]?.collisionEnabled, true);
  assert.equal(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointOrUnderdeterminedLine,
    ),
    false,
  );
});

test("registrationClass rejected is not an EMPTY-authoritative refusal reason", () => {
  const { observation, s4a, s4b } = s4bOf(evidence(), rescaledOriginalIdentity);
  const ea = emptyAuthoritative({
    s4b,
    s4a,
    observation,
    registrationClass: "rejected",
  });
  assert.equal(ea.collisionAuthority, true);
  assertNoRegistrationOrOlVeto(ea);
});

test("OL no_match is diagnostic only and does not veto EMPTY-authoritative collision", () => {
  const { observation, s4a, s4b } = s4bOf(evidence(), rescaledOriginalIdentity);
  const ea = emptyAuthoritative({
    s4b,
    s4a,
    observation,
    originalLocalizationClass: "original_localization_insufficient",
  });
  assert.equal(ea.collisionAuthority, true);
  assertNoRegistrationOrOlVeto(ea);
  assert.equal(
    ea.lineage.originalLocalization.registrationClass,
    "original_localization_insufficient",
  );
});

test("incompatible image tier is refused", () => {
  const observation = evidence();
  const s4a = withCompatibility(withReadyInterior(
    constructAfcV2RoomBoundaryAuthority(construction(observation)),
  ), "incompatible");
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.collisionAuthority, false);
  assert.ok(
    ea.walls.some((wall) =>
      wall.qualificationReasons.includes(
        EMPTY_AUTHORITATIVE_COLLISION_REASON.incompatibleImageTier,
      )
    ),
  );
});

test("S4A rejected remains collision-refused", () => {
  const observation = evidence();
  const s4a = withCandidate(withReadyInterior(
    constructAfcV2RoomBoundaryAuthority(construction(observation, rescaledOriginalIdentity)),
  ), (candidate) => ({ ...candidate, status: "rejected" }));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.collisionAuthority, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(ROOM_COLLISION_REASON.s4aNotAccepted),
  );
});

test("interior not collision-ready remains refused", () => {
  const observation = evidence();
  const s4a = withCandidate(withReadyInterior(
    constructAfcV2RoomBoundaryAuthority(construction(observation, rescaledOriginalIdentity)),
  ), (candidate) => ({
    ...candidate,
    interior: {
      ...candidate.interior,
      status: "insufficient",
      sideSign: null,
    },
  }));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.interiorNotCollisionReady,
    ),
  );
});

test("camera contradiction remains refused", () => {
  const observation = evidence();
  const s4a = withCandidate(withReadyInterior(
    constructAfcV2RoomBoundaryAuthority(construction(observation, rescaledOriginalIdentity)),
  ), (candidate) => ({
    ...candidate,
    interior: {
      ...candidate.interior,
      status: "accepted",
      sideSign: 1,
      cameraSideSign: -1,
    },
  }));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.interiorCameraNotCorroborated,
    ),
  );
  assert.equal(ea.walls[0]?.collisionEnabled, false);
});

test("failed two-point region corroboration remains refused", () => {
  const observation = twoPointObservation();
  const s4a = withCandidate(withReadyInterior(
    constructAfcV2RoomBoundaryAuthority(construction(observation, rescaledOriginalIdentity)),
  ), (candidate) => ({
    ...candidate,
    imageEvidence: {
      ...candidate.imageEvidence,
      polyline: [
        { x: 0.3, y: 0.35 },
        { x: 0.7, y: 0.35 },
      ],
    },
  }));
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(
    boundary.corroboration.floorFrontierPass === true &&
      boundary.corroboration.wallFrontierPass === true,
    false,
  );
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
});

test("opening crossing follows existing S4C policy without registration liberalization", () => {
  const observation = doorObservation();
  const { s4a, s4b } = s4bOf(observation, rescaledOriginalIdentity);
  assert.ok(
    s4b.boundaries[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.seamCrossesReportedOpening,
    ),
  );
  const ea = emptyAuthoritative({
    s4b,
    s4a,
    observation,
    registrationClass: "rejected",
  });
  const enabled = ea.walls.filter((wall) => wall.collisionEnabled);
  if (enabled.length > 0) {
    assert.ok(enabled.every((wall) => wall.derivation === "observed_interval_subtraction"));
  } else {
    assert.ok(
      ea.walls.some((wall) =>
        wall.qualificationReasons.includes(
          ROOM_COLLISION_REASON.seamCrossesReportedOpening,
        )
      ),
    );
  }
});

test("competing same-wall traces do not become collision walls", () => {
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
  const s4a = constructAfcV2RoomBoundaryAuthority(
    construction(observation, rescaledOriginalIdentity),
  );
  const s4b = constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation });
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.walls.some((wall) => wall.collisionEnabled), false);
  assert.ok(ea.walls.every((wall) => wall.sourceS4AStatus !== "accepted" ||
    wall.qualificationReasons.includes(ROOM_COLLISION_REASON.s4aNotAccepted)));
});

test("manufactured geometry and hidden continuation remain false", () => {
  const { observation, s4a, s4b } = s4bOf(evidence(), rescaledOriginalIdentity);
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.geometryManufactured, false);
  assert.equal(ea.hiddenContinuation, false);
  assert.equal(ea.closedTopology, false);
  assert.ok(ea.walls.every((wall) => wall.limitations.geometryManufactured === false));
  assert.ok(ea.walls.every((wall) => wall.limitations.hiddenContinuation === false));
});

test("exact-grid runtime keeps S4C/S4B and does not prefer EMPTY-authoritative", () => {
  const { observation, s4a, s4b } = s4bOf();
  const envelope = constructAfcV2RoomEnvelopeAuthority({
    registration: { registrationClass: "exact_grid_registered" } as AfcV2EmptyOriginalRegistrationAuthorityReceipt,
    roomBoundary: s4a,
    roomCollision: s4b,
    observation,
  });
  const s4c = constructAfcV2RoomEnvelopeCollisionAuthority({
    roomCollision: s4b,
    registration: { registrationClass: "exact_grid_registered" } as AfcV2EmptyOriginalRegistrationAuthorityReceipt,
    roomEnvelope: envelope,
  });
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  const selected = selectActiveRuntimeCollisionWalls({
    emptyAuthoritativeCollision: ea,
    envelopeCollision: s4c,
    roomCollision: s4b,
  });
  assert.equal(selected.source, "s4c_cq");
  assert.notEqual(selected.source, "empty_authoritative");
});

test("aspect-rescaled runtime uses EMPTY-authoritative even if certified OL exists", () => {
  const { observation, s4a, s4b } = s4bOf(evidence(), rescaledOriginalIdentity);
  const ea = emptyAuthoritative({ s4b, s4a, observation, registrationClass: "rejected" });
  const selected = selectActiveRuntimeCollisionWalls({
    emptyAuthoritativeCollision: ea,
    originalLocalizedCollision: {
      lineage: { originalLocalizationClass: "certified_original_localized" },
      walls: [{
        id: "ol-only",
        collisionEnabled: true,
        finiteBaseSegment: { a: { x: 99, z: 99 }, b: { x: 100, z: 99 } },
        supportPlane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 },
        interiorHalfSpace: { sideSign: 1, cameraSideSign: 1 },
      }],
    } as unknown as AfcV2OriginalLocalizedCollisionAuthorityReceipt,
    envelopeCollision: null,
    roomCollision: s4b,
  });
  assert.equal(selected.source, "empty_authoritative");
  assert.equal(selected.walls.some((wall) => wall.id === "ol-only"), false);
  assert.equal(selected.walls.length, enabledEmptyAuthoritativeCollisionWalls(ea).length);
});

test("runtime never concatenates EMPTY-authoritative and OL walls", () => {
  const { observation, s4a, s4b } = s4bOf(evidence(), rescaledOriginalIdentity);
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  const selected = selectActiveRuntimeCollisionWalls({
    emptyAuthoritativeCollision: ea,
    originalLocalizedCollision: {
      lineage: { originalLocalizationClass: "certified_original_localized" },
    } as unknown as AfcV2OriginalLocalizedCollisionAuthorityReceipt,
    roomCollision: s4b,
  });
  const eaIds = new Set(enabledEmptyAuthoritativeCollisionWalls(ea).map((wall) => wall.id));
  assert.ok(selected.walls.every((wall) => eaIds.has(wall.id)));
});

test("EMPTY-authoritative enabled walls use the unchanged collision kernel", () => {
  const { observation, s4a, s4b } = s4bOf(evidence(), rescaledOriginalIdentity);
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  const walls = enabledEmptyAuthoritativeCollisionWalls(ea);
  assert.ok(walls.length > 0);
  const wall = walls[0]!;
  const resolved = resolveSceneObjectCollision({
    current: DEFAULT_WORLD_TRANSFORM,
    proposed: {
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: wall.a.x + 4, y: 0, z: wall.a.z },
    },
    localAabb: TEST_CUBE_PLACEMENT_LOCAL_AABB,
    walls,
    mode: "move",
  });
  assert.equal(typeof resolved.transform.position.x, "number");
});

test("S4B/S4A/kernel sources remain independent of the experimental product", () => {
  const s4b = readFileSync(path.join(V2, "room-collision-qualification.server.ts"), "utf8");
  const s4a = readFileSync(path.join(V2, "room-boundary-authority.server.ts"), "utf8");
  const kernel = readFileSync(path.join(V2, "room-collision-geometry.ts"), "utf8");
  const resolver = readFileSync(path.join(V2, "scene-collision-resolver.ts"), "utf8");
  const footprint = readFileSync(path.join(V2, "room-collision-footprint.ts"), "utf8");
  for (const source of [s4b, s4a, kernel, resolver, footprint]) {
    assert.doesNotMatch(source, /empty-authoritative-collision|empty_authoritative_experiment/);
  }
  assert.match(s4b, /compatibilityTier !== "exact_grid_compatible"/);
});

function threeWallSideObservation(reverseSeams = false) {
  const reverse = <T>(points: readonly T[]) =>
    reverseSeams ? [...points].reverse() : [...points];
  const floor = [
    { x: 0.160, y: 0.64 },
    { x: 0.90, y: 0.64 },
    { x: 0.99, y: 0.98 },
    { x: 0.127, y: 0.98 },
  ];
  const leftWall = [
    { x: 0.02, y: 0.12 },
    { x: 0.18, y: 0.12 },
    { x: 0.160, y: 0.64 },
    { x: 0.127, y: 0.98 },
    { x: 0.02, y: 0.90 },
  ];
  const backWall = [
    { x: 0.160, y: 0.12 },
    { x: 0.90, y: 0.12 },
    { x: 0.90, y: 0.64 },
    { x: 0.160, y: 0.64 },
  ];
  const rightWall = [
    { x: 0.88, y: 0.12 },
    { x: 0.99, y: 0.12 },
    { x: 0.99, y: 0.98 },
    { x: 0.90, y: 0.64 },
  ];
  return evidence(providerObservation({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: floor,
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "side_wall_a",
        category: "wall",
        sourceNormalizedPolygon: leftWall,
        confidence: 0.88,
        visibility: "observed",
      },
      {
        id: "back_wall",
        category: "wall",
        sourceNormalizedPolygon: backWall,
        confidence: 0.91,
        visibility: "observed",
      },
      {
        id: "side_wall_b",
        category: "wall",
        sourceNormalizedPolygon: rightWall,
        confidence: 0.88,
        visibility: "observed",
      },
    ],
    observedSeams: [
      {
        id: "side_a_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "side_wall_a"],
        sourceNormalizedPolyline: reverse([
          { x: 0.160, y: 0.64 },
          { x: 0.127, y: 0.98 },
        ]),
        confidence: 0.9,
        visibility: "observed",
      },
      {
        id: "back_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "back_wall"],
        sourceNormalizedPolyline: reverse([
          { x: 0.160, y: 0.64 },
          { x: 0.90, y: 0.64 },
        ]),
        confidence: 0.93,
        visibility: "observed",
      },
      {
        id: "side_b_floor_wall",
        category: "floor_wall",
        planeIds: ["visible_floor", "side_wall_b"],
        sourceNormalizedPolyline: reverse([
          { x: 0.90, y: 0.64 },
          { x: 0.99, y: 0.98 },
        ]),
        confidence: 0.9,
        visibility: "observed",
      },
    ],
  }));
}

function emptyAuthoritativeWallAcceptance(
  receipt: ReturnType<typeof constructAfcV2EmptyAuthoritativeCollisionAuthority>,
) {
  return receipt.walls
    .map((wall) => ({
      sourceSeamId: wall.sourceSeamId,
      collisionEnabled: wall.collisionEnabled,
      status: wall.status,
    }))
    .sort((left, right) => left.sourceSeamId.localeCompare(right.sourceSeamId));
}

test("aspect-rescaled three-wall fixture promotes all semantically opposite walls", () => {
  const observation = threeWallSideObservation();
  const { s4a, s4b } = s4bOf(observation, rescaledOriginalIdentity);
  assert.equal(s4a.candidates.length, 3);
  for (const boundary of s4b.boundaries) {
    assert.equal(boundary.collisionEnabled, false);
    assert.ok(
      boundary.qualificationReasons.includes(
        ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
      ),
    );
    assert.equal(boundary.limitations.twoPointCorroborated, true);
    assert.equal(boundary.corroboration.occupancyPass, true);
    assert.equal(
      boundary.qualificationReasons.includes(
        ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
      ),
      false,
    );
  }
  const ea = emptyAuthoritative({
    s4b,
    s4a,
    observation,
    registrationClass: "rejected",
  });
  assert.equal(ea.summary.accepted, 3);
  assert.equal(ea.summary.refused, 0);
  assert.equal(ea.walls.filter((wall) => wall.collisionEnabled).length, 3);
});

test("reversing every seam endpoint leaves EMPTY-authoritative wall acceptance unchanged", () => {
  const forwardObservation = threeWallSideObservation(false);
  const reversedObservation = threeWallSideObservation(true);
  const forward = s4bOf(forwardObservation, rescaledOriginalIdentity);
  const reversed = s4bOf(reversedObservation, rescaledOriginalIdentity);
  const forwardEa = emptyAuthoritative({
    s4b: forward.s4b,
    s4a: forward.s4a,
    observation: forwardObservation,
    registrationClass: "rejected",
  });
  const reversedEa = emptyAuthoritative({
    s4b: reversed.s4b,
    s4a: reversed.s4a,
    observation: reversedObservation,
    registrationClass: "rejected",
  });
  assert.deepEqual(
    emptyAuthoritativeWallAcceptance(forwardEa),
    emptyAuthoritativeWallAcceptance(reversedEa),
  );
  assert.equal(forwardEa.summary.accepted, 3);
  assert.equal(reversedEa.summary.accepted, 3);
});

test("host UI makes the EMPTY-authoritative experiment explicit", () => {
  const roomLab = readFileSync(path.join(V2, "RoomLabV2.tsx"), "utf8");
  assert.match(roomLab, /Collision policy: EMPTY-authoritative experiment/);
  assert.match(roomLab, /Active collision source:/);
  assert.match(roomLab, /Download EMPTY-Authoritative Collision Authority/);
  assert.match(roomLab, /diagnostic only/);
  assert.match(roomLab, /emptyAuthoritativeCollision/);
  assert.match(roomLab, /afc-v2-empty-authoritative-collision-authority\.json/);
});

function withPatchedBoundaries(
  s4b: AfcV2RoomCollisionAuthorityReceipt,
  patch: (boundary: RoomCollisionBoundary) => RoomCollisionBoundary,
): AfcV2RoomCollisionAuthorityReceipt {
  return {
    ...s4b,
    collisionAuthority: false,
    boundaries: s4b.boundaries.map(patch),
  };
}

function overlayTwoPointInsufficiency(
  s4b: AfcV2RoomCollisionAuthorityReceipt,
  overlay: {
    floorFrontierPass: boolean;
    wallFrontierPass: boolean;
    kind?: RoomCollisionBoundaryCorroboration["kind"];
    passingProbeCount?: number;
    contradictionProbeCount?: number;
    omitFrontierFields?: boolean;
  },
): AfcV2RoomCollisionAuthorityReceipt {
  return withPatchedBoundaries(s4b, (boundary) => {
    const reasons = [
      ...boundary.qualificationReasons.filter(
        (reason) =>
          reason !== ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
      ),
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ];
    const probes: Array<Readonly<{ status: "pass" | "contradiction" }>> = [];
    const passingProbeCount = overlay.passingProbeCount ?? 0;
    const contradictionProbeCount = overlay.contradictionProbeCount ?? 2;
    for (let index = 0; index < passingProbeCount; index += 1) {
      probes.push(Object.freeze({ status: "pass" as const }));
    }
    for (let index = 0; index < contradictionProbeCount; index += 1) {
      probes.push(Object.freeze({ status: "contradiction" as const }));
    }
    const corroboration: RoomCollisionBoundaryCorroboration = overlay.omitFrontierFields
      ? Object.freeze({
        kind: overlay.kind ?? "none",
        occupancyPass: false,
        passingProbeCount,
        contradictionProbeCount,
        probes: Object.freeze(probes),
        openingCrossing: boundary.corroboration.openingCrossing,
      })
      : Object.freeze({
        ...boundary.corroboration,
        kind: overlay.kind ?? "multi_probe_region_frontier",
        floorFrontierPass: overlay.floorFrontierPass,
        wallFrontierPass: overlay.wallFrontierPass,
        occupancyPass: false,
        passingProbeCount,
        passingApplicableProbeCount: passingProbeCount,
        contradictionProbeCount,
        probes: Object.freeze(probes),
      });
    return {
      ...boundary,
      collisionEnabled: false,
      status: boundary.status === "accepted" ? "insufficient" : boundary.status,
      qualificationReasons: Object.freeze(reasons),
      corroboration,
      limitations: Object.freeze({
        ...boundary.limitations,
        twoPointCorroborated: false,
      }),
    };
  });
}

function aspectRescaledTwoPoint() {
  return s4bOf(twoPointObservation(), rescaledOriginalIdentity);
}

function exactGridTwoPoint() {
  return s4bOf(twoPointObservation());
}

function taperingSideWallObservation() {
  const floor = [
    { x: 0.160, y: 0.64 },
    { x: 0.90, y: 0.64 },
    { x: 0.99, y: 0.98 },
    { x: 0.127, y: 0.98 },
  ];
  const wall = [
    { x: 0.146, y: 0.64 },
    { x: 0.160, y: 0.64 },
    { x: 0.127, y: 0.98 },
    { x: 0.123, y: 0.98 },
  ];
  return evidence(providerObservation({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: floor,
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: wall,
        confidence: 0.91,
        visibility: "observed",
      },
    ],
    observedSeams: [{
      id: "tapering_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.160, y: 0.64 },
        { x: 0.127, y: 0.98 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
}

function recedingWallObservation() {
  return evidence(providerObservation({
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
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.8, y: 0.62 },
          { x: 0.65, y: 0.62 },
          { x: 0.5, y: 0.4 },
          { x: 0.35, y: 0.62 },
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
        { x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
}

test("aspect-rescaled two-point insufficiency with both in-span frontiers promotes", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  assert.equal(s4a.candidates[0]?.status, "accepted");
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: true,
    wallFrontierPass: true,
    passingProbeCount: 1,
    contradictionProbeCount: 2,
  });
  const boundary = patched.boundaries[0];
  assert.ok(boundary);
  assert.equal(boundary.collisionEnabled, false);
  assert.equal(boundary.corroboration.occupancyPass, false);
  assert.equal(boundary.limitations.twoPointCorroborated, false);
  assert.equal(boundary.corroboration.floorFrontierPass, true);
  assert.equal(boundary.corroboration.wallFrontierPass, true);
  const ea = emptyAuthoritative({
    s4b: patched,
    s4a,
    observation,
    registrationClass: "rejected",
  });
  assert.equal(ea.collisionAuthority, true);
  assert.equal(ea.walls[0]?.collisionEnabled, true);
  assert.equal(ea.walls[0]?.status, "accepted");
  assert.equal(ea.walls[0]?.derivation, "empty_authoritative_promotion");
  assert.deepEqual([...ea.walls[0]!.qualificationReasons], []);
  assert.equal(ea.walls[0]?.twoPointCorroborated, false);
  assert.equal(ea.walls[0]?.corroboration.occupancyPass, false);
});

test("zero passing probes still promote when both in-span frontiers pass", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: true,
    wallFrontierPass: true,
    passingProbeCount: 0,
    contradictionProbeCount: 0,
  });
  assert.equal(patched.boundaries[0]?.corroboration.passingProbeCount, 0);
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, true);
  assert.equal(ea.walls[0]?.twoPointCorroborated, false);
});

test("occupancy contradictions do not outvote in-span frontier promotion", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: true,
    wallFrontierPass: true,
    passingProbeCount: 0,
    contradictionProbeCount: 3,
  });
  assert.ok((patched.boundaries[0]?.corroboration.contradictionProbeCount ?? 0) > 0);
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, true);
  assert.equal(ea.walls[0]?.corroboration.occupancyPass, false);
  assert.equal(ea.walls[0]?.twoPointCorroborated, false);
});

test("floor frontier failure keeps two-point insufficiency fatal", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: false,
    wallFrontierPass: true,
  });
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
});

test("wall frontier failure keeps two-point insufficiency fatal", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: true,
    wallFrontierPass: false,
  });
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
});

test("both frontier failures keep two-point insufficiency fatal", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: false,
    wallFrontierPass: false,
  });
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
});

test("absent regional corroboration fails closed and does not infer frontiers", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: true,
    wallFrontierPass: true,
    kind: "none",
    omitFrontierFields: true,
  });
  assert.equal(patched.boundaries[0]?.corroboration.kind, "none");
  assert.equal(patched.boundaries[0]?.corroboration.floorFrontierPass, undefined);
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
});

test("kind none refuses even if frontier booleans are present", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: true,
    wallFrontierPass: true,
    kind: "none",
  });
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
});

test("receding-wall in-span frontier mismatch remains refused", () => {
  const observation = recedingWallObservation();
  const { s4a, s4b } = s4bOf(observation, rescaledOriginalIdentity);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(s4a.candidates[0]?.status, "accepted");
  assert.equal(boundary.corroboration.kind, "multi_probe_region_frontier");
  assert.equal(
    boundary.corroboration.floorFrontierPass === true &&
      boundary.corroboration.wallFrontierPass === true,
    false,
  );
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
});

test("geometry incomplete remains refused under occupancy demotion", () => {
  const observation = twoPointObservation();
  const s4a = withCandidate(withReadyInterior(
    constructAfcV2RoomBoundaryAuthority(construction(observation, rescaledOriginalIdentity)),
  ), (candidate) => ({
    ...candidate,
    worldGeometry: null,
    authority: {
      ...candidate.authority,
      baseSegment: false,
      supportPlane: false,
    },
  }));
  const s4b = overlayTwoPointInsufficiency(
    constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation }),
    { floorFrontierPass: true, wallFrontierPass: true },
  );
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.s4aGeometryIncomplete,
    ),
  );
});

test("missing finite base segment remains refused", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = withPatchedBoundaries(
    overlayTwoPointInsufficiency(s4b, {
      floorFrontierPass: true,
      wallFrontierPass: true,
    }),
    (boundary) => ({ ...boundary, finiteBaseSegment: null }),
  );
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(ea).length, 0);
});

test("missing support plane remains refused", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = withPatchedBoundaries(
    overlayTwoPointInsufficiency(s4b, {
      floorFrontierPass: true,
      wallFrontierPass: true,
    }),
    (boundary) => ({ ...boundary, supportPlane: null }),
  );
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(ea).length, 0);
});

test("invalid sideSign remains refused", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = withPatchedBoundaries(
    overlayTwoPointInsufficiency(s4b, {
      floorFrontierPass: true,
      wallFrontierPass: true,
    }),
    (boundary) => ({
      ...boundary,
      interiorHalfSpace: {
        ...boundary.interiorHalfSpace,
        sideSign: null,
      },
    }),
  );
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.equal(enabledEmptyAuthoritativeCollisionWalls(ea).length, 0);
});

test("contract integrity / manufactured geometry remains refused", () => {
  const observation = twoPointObservation();
  const s4a = withCandidate(withReadyInterior(
    constructAfcV2RoomBoundaryAuthority(construction(observation, rescaledOriginalIdentity)),
  ), (candidate) => ({
    ...candidate,
    limitations: {
      ...candidate.limitations,
      geometryManufactured: true as never,
    },
  }));
  const s4b = overlayTwoPointInsufficiency(
    constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation }),
    { floorFrontierPass: true, wallFrontierPass: true },
  );
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.s4aContractIntegrity,
    ),
  );
});

test("hidden continuation remains refused", () => {
  const observation = twoPointObservation();
  const s4a = withCandidate(withReadyInterior(
    constructAfcV2RoomBoundaryAuthority(construction(observation, rescaledOriginalIdentity)),
  ), (candidate) => ({
    ...candidate,
    limitations: {
      ...candidate.limitations,
      hiddenContinuation: true as never,
    },
  }));
  const s4b = overlayTwoPointInsufficiency(
    constructAfcV2RoomCollisionAuthority({ roomBoundary: s4a, observation }),
    { floorFrontierPass: true, wallFrontierPass: true },
  );
  const ea = emptyAuthoritative({ s4b, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.s4aContractIntegrity,
    ),
  );
});

test("exact-grid two-point insufficiency does not gain EMPTY-authoritative authority", () => {
  const { observation, s4a, s4b } = exactGridTwoPoint();
  assert.equal(s4b.lineage.roomBoundary.compatibilityTier, "exact_grid_compatible");
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: true,
    wallFrontierPass: true,
    passingProbeCount: 0,
    contradictionProbeCount: 2,
  });
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  assert.equal(ea.walls[0]?.collisionEnabled, false);
  assert.ok(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
  const selected = selectActiveRuntimeCollisionWalls({
    emptyAuthoritativeCollision: ea,
    roomCollision: patched,
  });
  assert.equal(selected.source, "s4b");
  assert.equal(
    selected.walls.length,
    enabledCollisionWallsFromReceipt(patched).length,
  );
});

test("shared S4B hard gates and S4C still treat two-point insufficiency as fatal", () => {
  assert.ok(
    S4B_HARD_COLLISION_GATES.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: true,
    wallFrontierPass: true,
  });
  assert.ok(
    remainingS4bHardGates(patched.boundaries[0]?.qualificationReasons ?? []).includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
  );
  const s4c = constructAfcV2RoomEnvelopeCollisionAuthority({
    roomCollision: patched,
    registration: {
      registrationClass: "certified_rescaled_registered",
      collisionPromotionEligible: true,
      oldCompatibilityTier: "aspect_compatible_rescaled",
    } as AfcV2EmptyOriginalRegistrationAuthorityReceipt,
    roomEnvelope: constructAfcV2RoomEnvelopeAuthority({
      registration: {
        registrationClass: "certified_rescaled_registered",
        collisionPromotionEligible: true,
        oldCompatibilityTier: "aspect_compatible_rescaled",
      } as AfcV2EmptyOriginalRegistrationAuthorityReceipt,
      roomBoundary: s4a,
      roomCollision: patched,
      observation,
    }),
  });
  assert.ok(s4c);
  assert.equal(s4c.walls.some((wall) => wall.collisionEnabled), false);
});

test("baseline S4B aspect-rescaled remains collision-disabled", () => {
  const { s4b } = aspectRescaledTwoPoint();
  assert.equal(s4b.collisionAuthority, false);
  assert.equal(s4b.boundaries[0]?.collisionEnabled, false);
  const occupancyFailed = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: true,
    wallFrontierPass: true,
  });
  assert.equal(occupancyFailed.boundaries[0]?.collisionEnabled, false);
});

test("generic tapering side-wall with inset occupancy contradictions promotes", () => {
  const observation = taperingSideWallObservation();
  const { s4a, s4b } = s4bOf(observation, rescaledOriginalIdentity);
  assert.equal(s4a.candidates[0]?.status, "accepted");
  const live = s4b.boundaries[0];
  assert.ok(live);
  const bothFrontiers =
    live.corroboration.floorFrontierPass === true &&
    live.corroboration.wallFrontierPass === true;
  const s4bForPolicy = bothFrontiers && live.corroboration.occupancyPass === false
    ? s4b
    : overlayTwoPointInsufficiency(s4b, {
      floorFrontierPass: true,
      wallFrontierPass: true,
      passingProbeCount: 0,
      contradictionProbeCount: Math.max(1, live.corroboration.contradictionProbeCount ?? 1),
    });
  assert.equal(s4bForPolicy.boundaries[0]?.collisionEnabled, false);
  assert.equal(s4bForPolicy.boundaries[0]?.corroboration.occupancyPass, false);
  assert.equal(s4bForPolicy.boundaries[0]?.corroboration.floorFrontierPass, true);
  assert.equal(s4bForPolicy.boundaries[0]?.corroboration.wallFrontierPass, true);
  const ea = emptyAuthoritative({
    s4b: s4bForPolicy,
    s4a,
    observation,
    registrationClass: "rejected",
  });
  assert.equal(ea.walls[0]?.collisionEnabled, true);
  assert.equal(ea.walls[0]?.status, "accepted");
  assert.equal(ea.walls[0]?.twoPointCorroborated, false);
  assert.equal(ea.walls[0]?.corroboration.occupancyPass, false);
  assert.ok((ea.walls[0]?.corroboration.contradictionProbeCount ?? 0) > 0);
  assert.deepEqual([...ea.walls[0]!.qualificationReasons], []);
  const selected = selectActiveRuntimeCollisionWalls({
    emptyAuthoritativeCollision: ea,
    roomCollision: s4bForPolicy,
  });
  assert.equal(selected.source, "empty_authoritative");
  assert.equal(selected.walls.length, 1);
});

test("promoted tapering wall preserves occupancy-failure diagnostics", () => {
  const { observation, s4a, s4b } = aspectRescaledTwoPoint();
  const patched = overlayTwoPointInsufficiency(s4b, {
    floorFrontierPass: true,
    wallFrontierPass: true,
    passingProbeCount: 0,
    contradictionProbeCount: 2,
  });
  const ea = emptyAuthoritative({ s4b: patched, s4a, observation });
  const wall = ea.walls[0];
  assert.ok(wall);
  assert.equal(wall.collisionEnabled, true);
  assert.equal(wall.twoPointCorroborated, false);
  assert.equal(wall.corroboration.occupancyPass, false);
  assert.equal(wall.corroboration.contradictionProbeCount, 2);
  assert.ok(wall.corroboration.probes?.some((probe) => probe.status === "contradiction"));
  assert.equal(
    wall.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
    false,
  );
});

test("EMPTY-authoritative demotion is not majority-vote logic", () => {
  const source = readFileSync(
    path.join(V2, "empty-authoritative-collision-qualification.server.ts"),
    "utf8",
  );
  assert.match(source, /isEmptyAuthoritativeTwoPointInsufficiencyDemotable/);
  assert.match(source, /filterEmptyAuthoritativeHardGates/);
  assert.match(source, /floorFrontierPass === true/);
  assert.match(source, /wallFrontierPass === true/);
  assert.match(source, /aspect_compatible_rescaled/);
  assert.doesNotMatch(source, /passingProbeCount\s*[<>=]/);
  assert.doesNotMatch(source, /contradictionProbeCount\s*[<>=]/);
  assert.doesNotMatch(source, /passCount\s*>\s*contradiction/);
  assert.doesNotMatch(source, /occupancyPass\s*===?\s*true/);
  assert.doesNotMatch(source, /S4B_HARD_COLLISION_GATES\s*=/);
});

test("EMPTY-authoritative policy has no room-specific code", () => {
  const source = readFileSync(
    path.join(V2, "empty-authoritative-collision-qualification.server.ts"),
    "utf8",
  );
  const contract = readFileSync(
    path.join(V2, "empty-authoritative-collision-authority-contract.ts"),
    "utf8",
  );
  for (const text of [source, contract]) {
    assert.doesNotMatch(text, /room\s*2/i);
    assert.doesNotMatch(text, /Room2/);
    assert.doesNotMatch(text, /ROOM_2/);
  }
});

test("Test L: aspect-rescaled Room 2-class truncated wall promotes under EMPTY-authoritative", () => {
  const observation = evidence(providerObservation({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0.045, y: 0.9999 },
          { x: 0.076, y: 0.697 },
          { x: 0.414, y: 0.616 },
          { x: 1, y: 0.819 },
          { x: 1, y: 0.9999 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0, y: 0.222 },
          { x: 0.076, y: 0.282 },
          { x: 0.076, y: 0.697 },
          { x: 0, y: 0.75 },
        ],
        confidence: 0.91,
        visibility: "observed",
      },
    ],
    observedSeams: [{
      id: "left_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.045, y: 0.9999 },
        { x: 0.076, y: 0.697 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
  }));
  const { s4a, s4b } = s4bOf(observation, rescaledOriginalIdentity);
  const boundary = s4b.boundaries[0];
  assert.ok(boundary);
  assert.equal(s4a.candidates[0]?.status, "accepted");
  assert.equal(boundary.limitations.twoPointCorroborated, true);
  assert.equal(boundary.corroboration.floorFrontierPass, true);
  assert.equal(boundary.corroboration.wallFrontierPass, true);
  assert.equal(boundary.corroboration.contradictionProbeCount, 0);
  assert.equal(boundary.collisionEnabled, false);
  assert.ok(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
    ),
  );
  assert.equal(
    boundary.qualificationReasons.includes(
      ROOM_COLLISION_REASON.twoPointRegionCorroborationInsufficient,
    ),
    false,
  );
  const ea = emptyAuthoritative({
    s4b,
    s4a,
    observation,
    registrationClass: "rejected",
  });
  assert.equal(ea.collisionAuthority, true);
  assert.equal(ea.walls[0]?.collisionEnabled, true);
  assert.equal(ea.walls[0]?.status, "accepted");
  assert.equal(ea.walls[0]?.derivation, "empty_authoritative_promotion");
  assert.equal(
    ea.walls[0]?.qualificationReasons.includes(
      ROOM_COLLISION_REASON.aspectRescaledOrIncompatibleNotCollisionReady,
    ),
    false,
  );
});
