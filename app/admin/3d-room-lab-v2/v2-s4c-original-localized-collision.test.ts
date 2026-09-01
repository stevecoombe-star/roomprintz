import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildEmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import { FLOOR_REACHING_OPENING_CATEGORIES } from "./room-envelope-authority-contract";
import { selectActiveRuntimeCollisionWalls } from "./room-envelope-collision-authority-contract";
import { resolveSceneObjectCollision } from "./scene-collision-resolver";
import { TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB } from "./room-collision-footprint";
import { DEFAULT_WORLD_TRANSFORM } from "./scene-layer-state";
import {
  ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
  originalSourcePoint,
  type AfcV2OriginalStructuralLocalizationAuthorityReceipt,
  type OriginalLocalizedStructure,
} from "./original-structural-localization-authority-contract";
import type { AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt } from "./original-localized-boundary-authority-contract";
import type { OriginalLocalizedBoundaryCandidate } from "./original-localized-boundary-authority-contract";
import {
  constructOriginalLocalizedCollisionAuthority,
  reconstructOriginalOpeningBoundary,
} from "./original-localized-collision-qualification.server";
import { ORIGINAL_LOCALIZED_COLLISION_REASON } from "./original-localized-collision-authority-contract";
import { evaluateOpeningFloorGapGeometry } from "./room-envelope-opening-qualification";

const V2 = path.join(process.cwd(), "app/admin/3d-room-lab-v2");

function observation(openings: unknown[] = []) {
  return buildEmptyRoomObservationEvidence({
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
    observedOpenings: openings,
    observedJunctions: [],
    unresolved: [],
  }, {
    attemptId: "ol-cq",
    loadGeneration: 1,
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 1200,
      decodedHeight: 800,
      byteCount: 3,
      mimeType: "image/png",
      orientation: 1,
    },
    originalAncestorSha256: "a".repeat(64),
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-28T12:00:00.000Z",
  });
}

function doorOpening(category = "doorway") {
  return {
    id: "door",
    category,
    hostPlaneId: "visible_wall",
    sourceNormalizedBoundary: [
      { x: 0.4, y: 0.48 }, { x: 0.6, y: 0.48 },
      { x: 0.6, y: 0.74 }, { x: 0.4, y: 0.74 },
    ],
    boundaryClosure: "complete_visible_outline",
    boundaryEvidenceCompleteness: "all_edges_visibly_traced",
    confidence: 0.9,
    visibility: "observed",
  };
}

function acceptedCandidate(
  overrides: Partial<OriginalLocalizedBoundaryCandidate> = {},
): OriginalLocalizedBoundaryCandidate {
  return {
    id: "olb_visible_floor_wall",
    sourceObservationSeamId: "visible_floor_wall",
    sourceOLStructureId: "ol_visible_floor_wall",
    status: "accepted",
    source: {
      imageBasis: "ORIGINAL",
      coordinateSpace: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
      floorPlaneId: "visible_floor",
      wallPlaneId: "visible_wall",
      planeIds: ["visible_floor", "visible_wall"],
    },
    originalImageEvidence: {
      polyline: [
        originalSourcePoint(0.2, 0.64),
        originalSourcePoint(0.5, 0.64),
        originalSourcePoint(0.8, 0.64),
      ],
      occupancy: {
        floorSide: "positive",
        wallSide: "negative",
        opposite: true,
        floorOnLineCount: 0,
        floorPositiveCount: 4,
        floorNegativeCount: 0,
        wallOnLineCount: 0,
        wallPositiveCount: 0,
        wallNegativeCount: 4,
      },
      lineResidual: { meanDistance: 0.001, maxDistance: 0.002, sampleCount: 3 },
      sampleCount: 3,
      matchedSampleCount: 3,
      matchedFraction: 1,
      orientationResidual: 0.02,
    },
    projection: {
      kernel: "projectOriginalSourceNormalizedToWorld",
      worldSamples: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }],
      worldResidual: { meanDistance: 0.001, maxDistance: 0.01, sampleCount: 3 },
    },
    worldGeometry: {
      baseStart: { x: 0, y: 0, z: 0 },
      baseEnd: { x: 4, y: 0, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
      supportPlaneNormal: { x: 0, y: 0, z: 1 },
      supportPlaneConstant: 0,
    },
    interior: {
      status: "accepted",
      witnessImagePoint: { x: 0.5, y: 0.7 },
      witnessWorldPoint: { x: 2, y: 0, z: 0.2 },
      sideSign: 1,
      cameraSideSign: 1,
      cameraContradictsWitness: false,
    },
    authority: {
      kind: "partial_original_localized_room_boundary_authority",
      baseSegment: true,
      supportPlane: true,
      interiorHalfSpace: "accepted",
      collision: false,
    },
    limitations: {
      observedSpanOnly: true,
      hiddenContinuation: false,
      geometryManufactured: false,
      closedTopology: false,
      collisionAuthority: false,
      emptyCoordinatesAuthoritative: false,
    },
    reasons: [],
    ...overrides,
  };
}

function localization(
  structures: readonly OriginalLocalizedStructure[] = [],
  registrationClass: AfcV2OriginalStructuralLocalizationAuthorityReceipt["registrationClass"] =
    "certified_original_localized",
): AfcV2OriginalStructuralLocalizationAuthorityReceipt {
  return {
    schemaVersion: "afc-v2-original-structural-localization-authority/v1",
    authority: "partial_original_structural_localization_authority",
    methodVersion: "afc-v2-original-structure-localizer/v1",
    coordinateSpace: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
    registrationClass,
    transformKind: "none",
    geometryManufactured: false,
    collisionPromotionEligible: registrationClass === "certified_original_localized",
    emptyCoordinatesAuthoritative: false,
    originalCoordinatesAuthoritative: true,
    noInterpolation: true,
    noLocalWarpField: true,
    fittedTransformAuthoritative: false,
    noGlobalTransformApplied: true,
    globalImageRegistrationProven: false,
    globalTransformApplied: false,
    partialStructureAuthority: true,
    oldCompatibilityTier: "aspect_compatible_rescaled",
    structures,
    summary: {
      attempted: structures.length,
      localized: structures.filter((item) => item.status === "localized").length,
      noMatch: 0,
      ambiguous: 0,
      rejected: 0,
      localizedFloorWalls: 1,
      localizedFloorReachingOpenings: structures.filter((item) =>
        item.collisionRelevance === "opening_floor_reaching" && item.status === "localized"
      ).length,
    },
    limitations: {
      globalImageRegistrationProven: false,
      globalTransformApplied: false,
      partialStructureAuthority: true,
      emptyCoordinatesAuthoritative: false,
      originalCoordinatesAuthoritative: true,
      noInterpolation: true,
      noLocalWarpField: true,
      fittedTransformAuthoritative: false,
      noGlobalTransformApplied: true,
      ridgeTangentNonAuthoritative: true,
      boundedSearchWindow: 0.04,
    },
    lineage: {
      attemptId: "ol-cq",
      emptyObservationSchemaVersion: null,
      emptyObservationEvidenceId: "ol-cq",
      emptySha256: "e".repeat(64),
      originalSha256: "a".repeat(64),
      originalDecodedWidth: 1600,
      originalDecodedHeight: 900,
      originalOrientation: 1,
      oldCompatibilityTier: "aspect_compatible_rescaled",
      identityRegistrationReceiptSha256: "r".repeat(64),
      identityRegistrationClass: "rejected",
      matcherMethodVersion: "afc-v2-original-structure-localizer/v1",
      frozenCameraReceiptIdentity: "frozen",
      floorAuthorityKey: "floor-key",
    },
    constructionReasons: [],
    receiptSha256: "olc".repeat(21) + "o",
  };
}

function boundary(
  candidates: readonly OriginalLocalizedBoundaryCandidate[],
): AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt {
  return {
    schemaVersion: "afc-v2-original-localized-room-boundary-authority/v1",
    authority: "partial_original_localized_room_boundary_authority",
    coordinateSpace: "calibrated-world-xz/v1",
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    collisionAuthority: false,
    camera: {
      verticalFovDeg: 52,
      pose: {
        position: { x: 0.4, y: 2.2, z: 4.8 },
        lookAt: { x: 0, y: 0, z: -0.6 },
        up: { x: 0, y: 1, z: 0 },
      },
      frame: { width: 900, height: 600 },
    },
    candidates,
    summary: {
      accepted: candidates.filter((item) => item.status === "accepted").length,
      insufficient: 0,
      rejected: 0,
      ambiguous: 0,
      candidateCount: candidates.length,
    },
    lineage: {
      originalLocalizationSchemaVersion:
        "afc-v2-original-structural-localization-authority/v1",
      originalLocalizationReceiptSha256: "ol".repeat(32),
      originalLocalizationClass: "certified_original_localized",
      identityRegistrationReceiptSha256: "r".repeat(64),
      s4aNotMutated: true,
    },
    constructionReasons: [],
  };
}

function openingCorner(
  index: number,
  point: { x: number; y: number },
): OriginalLocalizedStructure {
  return {
    id: `ol_opening:door:corner:${index}`,
    sourceObservationStructureId: `opening:door:corner:${index}`,
    structureKind: "opening_doorway",
    localizationClass: "point_anchor",
    collisionRelevance: "opening_floor_reaching",
    sourcePlaneIds: [],
    sourceWallPlaneId: "visible_wall",
    sourceFloorPlaneId: null,
    sourceOpeningId: "door",
    emptyPrior: {
      basis: "empty-source-normalized-image/v1",
      point: { basis: "empty-source-normalized-image/v1", x: point.x, y: point.y },
      polyline: null,
    },
    status: "localized",
    originalEvidence: {
      basis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
      point: originalSourcePoint(point.x, point.y),
      line: null,
      polyline: null,
    },
    matcherDiagnostics: {
      ncc: 0.9,
      sampleCount: 1,
      matchedSampleCount: 1,
      matchedFraction: 1,
      orientationResidual: null,
      strongBandDiameter: 0.004,
      bimodalOffsetDetected: false,
      localFitResidual: null,
      searchDisplacement: 0.01,
      searchBoundHit: false,
    },
    span: null,
    limitations: [],
  };
}

test("localized wall with all hard gates passes becomes collision-enabled", () => {
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate()]),
    observation: observation(),
  });
  assert.equal(receipt.collisionAuthority, true);
  assert.equal(receipt.walls[0]?.collisionEnabled, true);
  assert.equal(receipt.lineage.s4aNotMutated, true);
  assert.equal(receipt.lineage.s4bNotMutated, true);
});

test("one localized wall only is valid partial collision authority", () => {
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate()]),
    observation: observation(),
  });
  assert.equal(receipt.walls.filter((wall) => wall.collisionEnabled).length, 1);
});

test("identity disagreement is not an OL collision reason", () => {
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate()]),
    observation: observation(),
  });
  assert.equal(
    receipt.walls[0]?.qualificationReasons.some((reason) =>
      reason.includes("identity") || reason.includes("contradiction")
    ),
    false,
  );
});

test("OL no-match / insufficient wall is not collision-enabled", () => {
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate({
      status: "insufficient",
      originalImageEvidence: {
        ...acceptedCandidate().originalImageEvidence,
        matchedSampleCount: 0,
      },
    })]),
    observation: observation(),
  });
  assert.equal(receipt.walls[0]?.collisionEnabled, false);
});

test("interior fail blocks collision", () => {
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate({
      interior: {
        status: "insufficient",
        witnessImagePoint: null,
        witnessWorldPoint: null,
        sideSign: null,
        cameraSideSign: null,
        cameraContradictsWitness: false,
      },
    })]),
    observation: observation(),
  });
  assert.ok(
    receipt.walls[0]?.qualificationReasons.includes(
      ORIGINAL_LOCALIZED_COLLISION_REASON.interiorNotCollisionReady,
    ),
  );
  assert.equal(receipt.walls[0]?.collisionEnabled, false);
});

test("camera fail blocks collision", () => {
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate({
      interior: {
        status: "accepted",
        witnessImagePoint: { x: 0.5, y: 0.7 },
        witnessWorldPoint: { x: 2, y: 0, z: 0.2 },
        sideSign: 1,
        cameraSideSign: -1,
        cameraContradictsWitness: true,
      },
    })]),
    observation: observation(),
  });
  assert.ok(
    receipt.walls[0]?.qualificationReasons.includes(
      ORIGINAL_LOCALIZED_COLLISION_REASON.interiorCameraNotCorroborated,
    ),
  );
});

test("two ORIGINAL endpoints are not treated as informative residual", () => {
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate({
      originalImageEvidence: {
        ...acceptedCandidate().originalImageEvidence,
        sampleCount: 2,
        matchedSampleCount: 2,
      },
    })]),
    observation: observation(),
  });
  assert.ok(
    receipt.walls[0]?.qualificationReasons.includes(
      ORIGINAL_LOCALIZED_COLLISION_REASON.twoPointSupportInsufficient,
    ),
  );
});

test("ORIGINAL wall + EMPTY-only door geometry must not subtract", () => {
  const room = observation([doorOpening()]);
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate()]),
    observation: room,
  });
  assert.equal(receipt.openingSubtractionPerformed, false);
  assert.equal(receipt.walls[0]?.collisionEnabled, true);
  assert.equal(receipt.openings[0]?.status, "not_localized");
  assert.ok(
    receipt.openings[0]?.refusalReasons.includes(
      ORIGINAL_LOCALIZED_COLLISION_REASON.emptyOpeningGeometryForbidden,
    ),
  );
});

test("ORIGINAL wall + ORIGINAL door geometry may qualify a floor-reaching gap", () => {
  const corners = [
    openingCorner(0, { x: 0.42, y: 0.50 }),
    openingCorner(1, { x: 0.58, y: 0.50 }),
    openingCorner(2, { x: 0.58, y: 0.76 }),
    openingCorner(3, { x: 0.42, y: 0.76 }),
  ];
  const reconstructed = reconstructOriginalOpeningBoundary("door", 4, corners);
  assert.ok(reconstructed);
  const geometry = evaluateOpeningFloorGapGeometry({
    opening: {
      id: "door",
      category: "doorway",
      hostPlaneId: "visible_wall",
      sourceNormalizedBoundary: reconstructed!.map((point) => ({ x: point.x, y: point.y })),
      boundaryClosure: "complete_visible_outline",
      ambiguity: null,
    },
    polyline: [
      { x: 0.2, y: 0.64 },
      { x: 0.5, y: 0.64 },
      { x: 0.8, y: 0.64 },
    ],
    occupancy: acceptedCandidate().originalImageEvidence.occupancy,
    wallPlaneId: "visible_wall",
  });
  assert.equal(geometry.accepted, true);
});

test("ORIGINAL window does not create a base gap", () => {
  assert.equal(
    (FLOOR_REACHING_OPENING_CATEGORIES as readonly string[]).includes("window"),
    false,
  );
  const geometry = evaluateOpeningFloorGapGeometry({
    opening: {
      id: "window",
      category: "window",
      hostPlaneId: "visible_wall",
      sourceNormalizedBoundary: [
        { x: 0.4, y: 0.2 }, { x: 0.6, y: 0.2 },
        { x: 0.6, y: 0.4 }, { x: 0.4, y: 0.4 },
      ],
      boundaryClosure: "complete_visible_outline",
      ambiguity: null,
    },
    polyline: [
      { x: 0.2, y: 0.64 }, { x: 0.8, y: 0.64 },
    ],
    occupancy: acceptedCandidate().originalImageEvidence.occupancy,
    wallPlaneId: "visible_wall",
  });
  assert.equal(geometry.accepted, false);
  assert.ok(geometry.reasons.includes("opening_category_not_floor_reaching"));
});

test("one jamb only does not subtract a gap", () => {
  const geometry = evaluateOpeningFloorGapGeometry({
    opening: {
      id: "door",
      category: "doorway",
      hostPlaneId: "visible_wall",
      sourceNormalizedBoundary: [
        { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.64 },
      ],
      boundaryClosure: "partial_visible_outline",
      ambiguity: null,
    },
    polyline: [
      { x: 0.2, y: 0.64 }, { x: 0.8, y: 0.64 },
    ],
    occupancy: acceptedCandidate().originalImageEvidence.occupancy,
    wallPlaneId: "visible_wall",
  });
  assert.equal(geometry.accepted, false);
});

test("wrong host wall does not subtract", () => {
  const geometry = evaluateOpeningFloorGapGeometry({
    opening: {
      id: "door",
      category: "doorway",
      hostPlaneId: "other_wall",
      sourceNormalizedBoundary: [
        { x: 0.4, y: 0.48 }, { x: 0.6, y: 0.48 },
        { x: 0.6, y: 0.74 }, { x: 0.4, y: 0.74 },
      ],
      boundaryClosure: "complete_visible_outline",
      ambiguity: null,
    },
    polyline: [
      { x: 0.2, y: 0.64 }, { x: 0.8, y: 0.64 },
    ],
    occupancy: acceptedCandidate().originalImageEvidence.occupancy,
    wallPlaneId: "visible_wall",
  });
  assert.equal(geometry.accepted, false);
  assert.ok(geometry.reasons.includes("opening_host_wall_mismatch"));
});

test("ambiguous opening does not subtract", () => {
  const geometry = evaluateOpeningFloorGapGeometry({
    opening: {
      id: "door",
      category: "doorway",
      hostPlaneId: "visible_wall",
      sourceNormalizedBoundary: [
        { x: 0.4, y: 0.48 }, { x: 0.6, y: 0.48 },
        { x: 0.6, y: 0.74 }, { x: 0.4, y: 0.74 },
      ],
      boundaryClosure: "complete_visible_outline",
      ambiguity: "two_candidates",
    },
    polyline: [
      { x: 0.2, y: 0.64 }, { x: 0.8, y: 0.64 },
    ],
    occupancy: acceptedCandidate().originalImageEvidence.occupancy,
    wallPlaneId: "visible_wall",
  });
  assert.equal(geometry.accepted, false);
});

test("runtime XOR prefers OL collision over S4C-CQ and never concatenates", () => {
  const ol = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate()]),
    observation: observation(),
  });
  const selected = selectActiveRuntimeCollisionWalls({
    originalLocalizedCollision: ol,
    envelopeCollision: {
      schemaVersion: "afc-v2-room-envelope-collision-authority/v1",
      coordinateSpace: "calibrated-world-xz/v1",
      authority: "partial_room_envelope_collision_authority",
      qualificationVersion: "afc-v2-room-envelope-collision-qualification/v1",
      geometryKernelVersion: "afc-v2-room-collision-geometry/v1",
      objectCollisionKernelVersion: "afc-v2-room-collision-object-kernel/v1",
      collisionAuthority: true,
      geometryManufactured: false,
      hiddenContinuation: false,
      closedTopology: false,
      openingSubtractionPerformed: false,
      lineage: {
        roomCollision: { schemaVersion: null, qualificationVersion: null },
        registration: { schemaVersion: null, receiptSha256: null, registrationClass: null },
        roomEnvelope: { schemaVersion: null, geometryDerivation: null },
      },
      walls: [],
      constructionReasons: [],
    },
    roomCollision: null,
  });
  assert.equal(selected.source, "ol_cq");
  assert.equal(selected.walls.length, 1);
});

test("OL walls use the unchanged collision kernel", () => {
  const ol = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate()]),
    observation: observation(),
  });
  const selected = selectActiveRuntimeCollisionWalls({
    originalLocalizedCollision: ol,
  });
  const resolved = resolveSceneObjectCollision({
    current: DEFAULT_WORLD_TRANSFORM,
    proposed: {
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: 0, y: 0, z: -0.5 },
    },
    localAabb: TEST_CUBE_NORMALIZED_PLACEMENT_LOCAL_AABB,
    walls: selected.walls,
    mode: "move",
  });
  assert.equal(typeof resolved.transform.position.x, "number");
  const kernel = readFileSync(path.join(V2, "room-collision-geometry.ts"), "utf8");
  const resolver = readFileSync(path.join(V2, "scene-collision-resolver.ts"), "utf8");
  assert.doesNotMatch(kernel, /original-localized|s4c0-ol|emptyOriginalRegistration/);
  assert.doesNotMatch(resolver, /constructOriginalLocalizedCollisionAuthority/);
});

test("incomplete ORIGINAL opening reconstruction cannot subtract", () => {
  assert.equal(
    reconstructOriginalOpeningBoundary("door", 4, [
      openingCorner(0, { x: 0.42, y: 0.50 }),
      openingCorner(1, { x: 0.58, y: 0.50 }),
    ]),
    null,
  );
});

test("closed-door style evidence without floor contact leaves the wall solid", () => {
  const corners = [
    openingCorner(0, { x: 0.42, y: 0.20 }),
    openingCorner(1, { x: 0.58, y: 0.20 }),
    openingCorner(2, { x: 0.58, y: 0.40 }),
    openingCorner(3, { x: 0.42, y: 0.40 }),
  ];
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(corners),
    originalLocalizedBoundary: boundary([acceptedCandidate()]),
    observation: observation([doorOpening()]),
  });
  assert.equal(receipt.openingSubtractionPerformed, false);
  assert.equal(receipt.walls[0]?.collisionEnabled, true);
});

test("identity-insufficient OL receipt does not override S4C-CQ", () => {
  const insufficient = constructOriginalLocalizedCollisionAuthority({
    localization: localization([], "original_localization_insufficient"),
    originalLocalizedBoundary: boundary([acceptedCandidate()]),
    observation: observation(),
  });
  const selected = selectActiveRuntimeCollisionWalls({
    originalLocalizedCollision: insufficient,
    envelopeCollision: {
      schemaVersion: "afc-v2-room-envelope-collision-authority/v1",
      coordinateSpace: "calibrated-world-xz/v1",
      authority: "partial_room_envelope_collision_authority",
      qualificationVersion: "afc-v2-room-envelope-collision-qualification/v1",
      geometryKernelVersion: "afc-v2-room-collision-geometry/v1",
      objectCollisionKernelVersion: "afc-v2-room-collision-object-kernel/v1",
      collisionAuthority: true,
      geometryManufactured: false,
      hiddenContinuation: false,
      closedTopology: false,
      openingSubtractionPerformed: false,
      lineage: {
        roomCollision: { schemaVersion: null, qualificationVersion: null },
        registration: { schemaVersion: null, receiptSha256: null, registrationClass: null },
        roomEnvelope: { schemaVersion: null, geometryDerivation: null },
      },
      walls: [{
        id: "s4c",
        sourceEnvelopeWallId: "s4c",
        sourceS4BBoundaryId: "s4c",
        sourceS4ABoundaryId: "s4c",
        sourceSeamId: "visible_floor_wall",
        collisionEnabled: true,
        finiteBaseSegment: { a: { x: 9, z: 9 }, b: { x: 10, z: 9 } },
        supportPlane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 },
        interiorHalfSpace: { sideSign: 1, cameraSideSign: 1 },
        openingSubtractionPerformed: false,
        derivation: "s4b_baseline_copy",
        qualificationReasons: [],
        limitations: {
          observedSpanOnly: true,
          verticalExtentUnknown: true,
          hiddenContinuation: false,
        },
      }],
      constructionReasons: [],
    },
  });
  assert.equal(selected.source, "s4c_cq");
  assert.equal(selected.walls[0]?.a.x, 9);
});

test("Room-2-style local drift: identity rejection does not prevent independent OL walls", () => {
  const source = readFileSync(
    path.join(V2, "original-structural-localization-geometry.server.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /REGISTRATION_MAX_IDENTITY_RESIDUAL/);
  assert.doesNotMatch(source, /room-2|room_2|Room 2/i);
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate()]),
    observation: observation(),
  });
  assert.equal(receipt.lineage.identityRegistrationClass, "rejected");
  assert.equal(receipt.collisionAuthority, true);
});

test("Room-3-style independent multi-plane drift does not invent a global transform", () => {
  const second = acceptedCandidate({
    id: "olb_side_floor_wall",
    sourceObservationSeamId: "side_floor_wall",
    sourceOLStructureId: "ol_side_floor_wall",
    worldGeometry: {
      baseStart: { x: 0, y: 0, z: 0 },
      baseEnd: { x: 0, y: 0, z: 3 },
      tangent: { x: 0, y: 0, z: 1 },
      supportPlaneNormal: { x: 1, y: 0, z: 0 },
      supportPlaneConstant: 0,
    },
  });
  const receipt = constructOriginalLocalizedCollisionAuthority({
    localization: localization(),
    originalLocalizedBoundary: boundary([acceptedCandidate(), second]),
    observation: observation(),
  });
  assert.equal(receipt.walls.length >= 1, true);
  const olSource = readFileSync(
    path.join(V2, "original-structural-localization-authority-contract.ts"),
    "utf8",
  );
  assert.match(olSource, /transformKind: "none"/);
  assert.match(olSource, /noInterpolation: true/);
});

test("S4C1 category list is unchanged", () => {
  assert.deepEqual([...FLOOR_REACHING_OPENING_CATEGORIES], [
    "door",
    "doorway",
    "archway",
    "pass_through",
  ]);
});
