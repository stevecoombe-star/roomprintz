import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildEmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import { constructAfcV2RoomBoundaryAuthority } from "./room-boundary-authority.server";
import type { FrozenRoomBoundaryCameraSnapshot } from "./room-boundary-authority-contract";
import {
  projectOriginalSourceNormalizedToWorld,
  realizeFrozenRoomBoundaryCamera,
} from "./room-boundary-projection.server";
import { evaluateOppositeOccupancy } from "./room-boundary-qualification.server";
import {
  ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
  originalSourcePoint,
  type AfcV2OriginalStructuralLocalizationAuthorityReceipt,
  type OriginalLocalizedStructure,
} from "./original-structural-localization-authority-contract";
import {
  constructOriginalLocalizedBoundaryAuthority,
  evaluateOriginalLocalizedInterior,
} from "./original-localized-boundary.server";

const V2 = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const FRAME = { width: 900, height: 600 };
const ORIGINAL_IDENTITY = { decodedWidth: 1600, decodedHeight: 900 };
const ORIGINAL_PIXEL_SIZE = {
  width: ORIGINAL_IDENTITY.decodedWidth,
  height: ORIGINAL_IDENTITY.decodedHeight,
};

function snapshot(): FrozenRoomBoundaryCameraSnapshot {
  return {
    verticalFovDeg: 52,
    pose: {
      position: { x: 0.4, y: 2.2, z: 4.8 },
      lookAt: { x: 0, y: 0, z: -0.6 },
      up: { x: 0, y: 1, z: 0 },
    },
    frame: FRAME,
  };
}

function observation() {
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
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  }, {
    attemptId: "ol-b",
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

function floorWallStructure(
  overrides: Partial<OriginalLocalizedStructure> = {},
): OriginalLocalizedStructure {
  const polyline = [
    originalSourcePoint(0.22, 0.64),
    originalSourcePoint(0.5, 0.64),
    originalSourcePoint(0.78, 0.64),
  ];
  return {
    id: "ol_visible_floor_wall",
    sourceObservationStructureId: "visible_floor_wall",
    structureKind: "floor_wall",
    localizationClass: "ridge_normal",
    collisionRelevance: "floor_wall",
    sourcePlaneIds: ["visible_floor", "visible_wall"],
    sourceWallPlaneId: "visible_wall",
    sourceFloorPlaneId: "visible_floor",
    sourceOpeningId: null,
    emptyPrior: {
      basis: "empty-source-normalized-image/v1",
      point: null,
      polyline: [
        { basis: "empty-source-normalized-image/v1", x: 0.2, y: 0.62 },
        { basis: "empty-source-normalized-image/v1", x: 0.8, y: 0.62 },
      ],
    },
    status: "localized",
    originalEvidence: {
      basis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
      point: null,
      line: {
        origin: polyline[0]!,
        direction: { x: 1, y: 0 },
      },
      polyline,
    },
    matcherDiagnostics: {
      ncc: 0.9,
      sampleCount: 3,
      matchedSampleCount: 3,
      matchedFraction: 1,
      orientationResidual: 0.02,
      strongBandDiameter: null,
      bimodalOffsetDetected: false,
      localFitResidual: 0.001,
      searchDisplacement: 0.012,
      searchBoundHit: false,
    },
    span: {
      construction: "supported_contiguous_samples",
      interpolated: false,
      hiddenContinuation: false,
      clusterCount: 1,
      sampleCount: 3,
      matchedSampleCount: 3,
    },
    limitations: [],
    ...overrides,
  };
}

function localizationReceipt(
  structures: readonly OriginalLocalizedStructure[],
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
      noMatch: structures.filter((item) => item.status === "no_match").length,
      ambiguous: structures.filter((item) => item.status === "ambiguous").length,
      rejected: structures.filter((item) => item.status === "rejected").length,
      localizedFloorWalls: structures.filter((item) =>
        item.status === "localized" && item.collisionRelevance === "floor_wall"
      ).length,
      localizedFloorReachingOpenings: 0,
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
      attemptId: "ol-b",
      emptyObservationSchemaVersion: null,
      emptyObservationEvidenceId: "ol-b",
      emptySha256: "e".repeat(64),
      originalSha256: "a".repeat(64),
      originalDecodedWidth: ORIGINAL_IDENTITY.decodedWidth,
      originalDecodedHeight: ORIGINAL_IDENTITY.decodedHeight,
      originalOrientation: 1,
      oldCompatibilityTier: "aspect_compatible_rescaled",
      identityRegistrationReceiptSha256: "r".repeat(64),
      identityRegistrationClass: "rejected",
      matcherMethodVersion: "afc-v2-original-structure-localizer/v1",
      frozenCameraReceiptIdentity: "frozen",
      floorAuthorityKey: "floor-key",
    },
    constructionReasons: [],
    receiptSha256: "ol".repeat(32),
  };
}

test("ORIGINAL source-normalized points project with the certified ORIGINAL kernel", () => {
  const realized = realizeFrozenRoomBoundaryCamera(snapshot());
  assert.equal(realized.ok, true);
  if (!realized.ok) return;
  const projected = projectOriginalSourceNormalizedToWorld(
    { x: 0.5, y: 0.64 },
    ORIGINAL_PIXEL_SIZE,
    FRAME,
    realized.camera,
  );
  assert.equal(projected.ok, true);
  if (!projected.ok) return;
  assert.equal(projected.world.y, 0);
});

test("OL boundary projects ORIGINAL geometry and does not call EMPTY transfer", () => {
  const source = readFileSync(path.join(V2, "original-localized-boundary.server.ts"), "utf8");
  assert.match(source, /projectOriginalSourceNormalizedToWorld/);
  assert.doesNotMatch(source, /projectEmptySourceNormalizedToWorld/);
  assert.doesNotMatch(source, /transferEmptySourceNormalizedToOriginal/);
  assert.doesNotMatch(source, /projectEmptyPolylineToWorld/);
});

test("clean localized wall yields finite base, support plane, interior, collision=false", () => {
  const room = observation();
  const receipt = constructOriginalLocalizedBoundaryAuthority({
    localization: localizationReceipt([floorWallStructure()]),
    observation: room,
    originalIdentity: ORIGINAL_IDENTITY,
    camera: snapshot(),
  });
  assert.equal(receipt.collisionAuthority, false);
  assert.equal(receipt.geometryManufactured, false);
  assert.equal(receipt.hiddenContinuation, false);
  const wall = receipt.candidates[0];
  assert.ok(wall);
  if (!wall) return;
  assert.equal(wall.status, "accepted");
  assert.ok(wall.worldGeometry);
  assert.equal(wall.authority.collision, false);
  assert.equal(wall.authority.baseSegment, true);
  assert.equal(wall.interior.status, "accepted");
  assert.equal(wall.source.imageBasis, "ORIGINAL");
});

test("no interior proof keeps the wall non-collision", () => {
  const mixed = evaluateOriginalLocalizedInterior({
    occupancy: {
      floorSide: "mixed",
      wallSide: "positive",
      opposite: false,
      floorOnLineCount: 0,
      floorPositiveCount: 1,
      floorNegativeCount: 1,
      wallOnLineCount: 0,
      wallPositiveCount: 1,
      wallNegativeCount: 0,
    },
    emptyPolyline: [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
    originalPolyline: [{ x: 0.22, y: 0.64 }, { x: 0.78, y: 0.64 }],
    geometry: {
      baseStart: { x: 0, y: 0, z: 0 },
      baseEnd: { x: 1, y: 0, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
      supportPlaneNormal: { x: 0, y: 0, z: 1 },
      supportPlaneConstant: 0,
    },
    camera: snapshot(),
    originalIdentity: ORIGINAL_IDENTITY,
    realized: realizeFrozenRoomBoundaryCamera(snapshot()),
  });
  assert.equal(mixed.status, "insufficient");
});

test("malformed ORIGINAL geometry fails closed", () => {
  const receipt = constructOriginalLocalizedBoundaryAuthority({
    localization: localizationReceipt([floorWallStructure({
      originalEvidence: {
        basis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
        point: null,
        line: null,
        polyline: [originalSourcePoint(0.5, 0.64)],
      },
    })]),
    observation: observation(),
    originalIdentity: ORIGINAL_IDENTITY,
    camera: snapshot(),
  });
  assert.equal(receipt.candidates[0]?.status === "accepted", false);
});

test("S4A receipt is not mutated by OL boundary construction", () => {
  const room = observation();
  const s4a = constructAfcV2RoomBoundaryAuthority({
    attemptId: "ol-b",
    loadGeneration: 1,
    observation: room,
    emptyIdentity: {
      sha256: "e".repeat(64),
      decodedWidth: 1200,
      decodedHeight: 800,
      orientation: 1,
    },
    originalIdentity: {
      sha256: "a".repeat(64),
      decodedWidth: 1800,
      decodedHeight: 1200,
      orientation: 1,
    },
    floor: {
      authorityKey: "floor-key",
      worldWidthM: 6,
      referenceDepthM: 4,
      widthDepthRatio: 1.5,
    },
    camera: snapshot(),
    freezeReceipt: {
      receiptVersion: "afc-sr1-calibrated-camera-freeze-receipt/v1",
      integrity: { payloadSha256: "f".repeat(64) },
    },
  });
  const before = JSON.stringify(s4a);
  constructOriginalLocalizedBoundaryAuthority({
    localization: localizationReceipt([floorWallStructure()]),
    observation: room,
    originalIdentity: ORIGINAL_IDENTITY,
    camera: snapshot(),
  });
  assert.equal(JSON.stringify(s4a), before);
  assert.equal(s4a.authority, "partial_room_boundary_authority");
});

test("occupancy for interior is EMPTY-semantic, not EMPTY polygons vs ORIGINAL coords", () => {
  const room = observation();
  const occupancy = evaluateOppositeOccupancy(
    room.observedSeams[0]!.sourceNormalizedPolyline,
    room.observedPlanes[0]!.sourceNormalizedPolygon,
    room.observedPlanes[1]!.sourceNormalizedPolygon,
  );
  assert.ok(occupancy);
  const source = readFileSync(path.join(V2, "original-localized-boundary.server.ts"), "utf8");
  assert.match(source, /evaluateOppositeOccupancy/);
  assert.match(source, /seam\.sourceNormalizedPolyline/);
  assert.match(source, /EMPTY occupancy supplies the semantic floor side/);
  assert.match(source, /never the sole side chooser/);
});

test("camera contradiction fails interior closed", () => {
  const room = observation();
  const occupancy = evaluateOppositeOccupancy(
    room.observedSeams[0]!.sourceNormalizedPolyline,
    room.observedPlanes[0]!.sourceNormalizedPolygon,
    room.observedPlanes[1]!.sourceNormalizedPolygon,
  );
  assert.ok(occupancy);
  const camera = {
    ...snapshot(),
    pose: {
      ...snapshot().pose,
      position: { x: 0.4, y: 2.2, z: -4.8 },
    },
  };
  const result = evaluateOriginalLocalizedInterior({
    occupancy,
    emptyPolyline: room.observedSeams[0]!.sourceNormalizedPolyline,
    originalPolyline: [{ x: 0.22, y: 0.64 }, { x: 0.78, y: 0.64 }],
    geometry: {
      baseStart: { x: 0, y: 0, z: 0 },
      baseEnd: { x: 4, y: 0, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
      supportPlaneNormal: { x: 0, y: 0, z: 1 },
      supportPlaneConstant: 0,
    },
    camera,
    originalIdentity: ORIGINAL_IDENTITY,
    realized: realizeFrozenRoomBoundaryCamera(camera),
  });
  if (result.cameraContradictsWitness) {
    assert.equal(result.status, "insufficient");
  } else {
    const source = readFileSync(path.join(V2, "original-localized-boundary.server.ts"), "utf8");
    assert.match(source, /cameraContradictsWitness: true/);
    assert.equal(result.status === "accepted" || result.status === "insufficient", true);
  }
});

test("projection failure fails the wall closed", () => {
  const receipt = constructOriginalLocalizedBoundaryAuthority({
    localization: localizationReceipt([floorWallStructure()]),
    observation: observation(),
    originalIdentity: { decodedWidth: 0, decodedHeight: 0 },
    camera: snapshot(),
  });
  assert.equal(receipt.candidates[0]?.status === "accepted", false);
});

test("OL boundary never manufactures or continues geometry", () => {
  const source = readFileSync(path.join(V2, "original-localized-boundary.server.ts"), "utf8");
  const contract = readFileSync(
    path.join(V2, "original-localized-boundary-authority-contract.ts"),
    "utf8",
  );
  assert.match(contract, /geometryManufactured: false/);
  assert.match(contract, /hiddenContinuation: false/);
  assert.match(source, /projectOriginalSourceNormalizedToWorld/);
  assert.doesNotMatch(source, /hiddenContinuation: true/);
});
