import type { EmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import { evaluateOpeningFloorGapGeometry } from "./room-envelope-opening-qualification";
import {
  residualWorldSegments,
  subtractParameterIntervals,
} from "./room-envelope-span-subtraction";
import { mergeParameterIntervals } from "./room-opening-intersection-geometry";
import {
  ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
  untagSourcePoint,
  type AfcV2OriginalStructuralLocalizationAuthorityReceipt,
  type OriginalLocalizedStructure,
  type OriginalSourceNormalizedPoint,
} from "./original-structural-localization-authority-contract";
import type { AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt } from "./original-localized-boundary-authority-contract";
import type { OriginalLocalizedBoundaryCandidate } from "./original-localized-boundary-authority-contract";
import {
  AFC_V2_ORIGINAL_LOCALIZED_COLLISION_AUTHORITY_VERSION,
  AFC_V2_ORIGINAL_LOCALIZED_COLLISION_QUALIFICATION_VERSION,
  ORIGINAL_LOCALIZED_COLLISION_REASON,
  freezeOriginalLocalizedCollisionReceipt,
  type AfcV2OriginalLocalizedCollisionAuthorityReceipt,
  type OriginalLocalizedCollisionWall,
  type OriginalLocalizedOpeningRecord,
} from "./original-localized-collision-authority-contract";

const MIN_RIDGE_SAMPLES_FOR_COLLISION = 3;

export type OriginalLocalizedCollisionConstructionInput = Readonly<{
  localization: AfcV2OriginalStructuralLocalizationAuthorityReceipt | null;
  originalLocalizedBoundary: AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt | null;
  observation: EmptyRoomObservationEvidence | null;
}>;

export function constructOriginalLocalizedCollisionAuthority(
  input: OriginalLocalizedCollisionConstructionInput,
): AfcV2OriginalLocalizedCollisionAuthorityReceipt {
  try {
    return constructUnchecked(input);
  } catch {
    return emptyReceipt(input, [
      ORIGINAL_LOCALIZED_COLLISION_REASON.constructionFailedClosed,
    ]);
  }
}

function constructUnchecked(
  input: OriginalLocalizedCollisionConstructionInput,
): AfcV2OriginalLocalizedCollisionAuthorityReceipt {
  if (
    !input.localization ||
    input.localization.registrationClass !== "certified_original_localized"
  ) {
    return emptyReceipt(input, [
      ORIGINAL_LOCALIZED_COLLISION_REASON.localizationNotCertified,
    ]);
  }
  if (!input.originalLocalizedBoundary) {
    return emptyReceipt(input, [
      ORIGINAL_LOCALIZED_COLLISION_REASON.olBoundaryNotAccepted,
    ]);
  }

  const walls: OriginalLocalizedCollisionWall[] = [];
  const openings: OriginalLocalizedOpeningRecord[] = [];
  let openingSubtractionPerformed = false;

  for (const candidate of input.originalLocalizedBoundary.candidates) {
    const qualified = qualifyOlWall({
      candidate,
      localization: input.localization,
      observation: input.observation,
    });
    walls.push(...qualified.walls);
    openings.push(...qualified.openings);
    if (qualified.openingSubtractionPerformed) openingSubtractionPerformed = true;
  }

  const enabled = walls.filter((wall) => wall.collisionEnabled);
  return freezeOriginalLocalizedCollisionReceipt({
    schemaVersion: AFC_V2_ORIGINAL_LOCALIZED_COLLISION_AUTHORITY_VERSION,
    coordinateSpace: "calibrated-world-xz/v1",
    authority: "partial_original_localized_collision_authority",
    qualificationVersion: AFC_V2_ORIGINAL_LOCALIZED_COLLISION_QUALIFICATION_VERSION,
    collisionAuthority: enabled.length > 0,
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    openingSubtractionPerformed,
    walls: Object.freeze(walls),
    openings: Object.freeze(openings),
    lineage: Object.freeze({
      originalLocalizationReceiptSha256: input.localization.receiptSha256,
      originalLocalizationClass: input.localization.registrationClass,
      originalLocalizedBoundarySchema: input.originalLocalizedBoundary.schemaVersion,
      identityRegistrationClass: input.localization.lineage.identityRegistrationClass,
      s4aNotMutated: true as const,
      s4bNotMutated: true as const,
    }),
    constructionReasons: Object.freeze([]),
  });
}

function qualifyOlWall(input: {
  candidate: OriginalLocalizedBoundaryCandidate;
  localization: AfcV2OriginalStructuralLocalizationAuthorityReceipt;
  observation: EmptyRoomObservationEvidence | null;
}): {
  walls: OriginalLocalizedCollisionWall[];
  openings: OriginalLocalizedOpeningRecord[];
  openingSubtractionPerformed: boolean;
} {
  const reasons: string[] = [];
  const candidate = input.candidate;
  if (candidate.status !== "accepted") {
    reasons.push(ORIGINAL_LOCALIZED_COLLISION_REASON.olBoundaryNotAccepted);
  }
  if (
    !candidate.worldGeometry ||
    candidate.authority.baseSegment !== true ||
    candidate.authority.supportPlane !== true
  ) {
    reasons.push(ORIGINAL_LOCALIZED_COLLISION_REASON.olGeometryIncomplete);
  }
  const sideSign = candidate.interior.sideSign;
  if (candidate.interior.status !== "accepted" || (sideSign !== 1 && sideSign !== -1)) {
    reasons.push(ORIGINAL_LOCALIZED_COLLISION_REASON.interiorNotCollisionReady);
  }
  const cameraSideSign = candidate.interior.cameraSideSign;
  if (
    !(sideSign === 1 || sideSign === -1) ||
    !(cameraSideSign === 1 || cameraSideSign === -1) ||
    cameraSideSign !== sideSign
  ) {
    reasons.push(ORIGINAL_LOCALIZED_COLLISION_REASON.interiorCameraNotCorroborated);
  }
  if (
    candidate.limitations.geometryManufactured ||
    candidate.authority.collision !== false
  ) {
    reasons.push(ORIGINAL_LOCALIZED_COLLISION_REASON.contractIntegrity);
  }
  const matched = candidate.originalImageEvidence.matchedSampleCount;
  if (matched < MIN_RIDGE_SAMPLES_FOR_COLLISION) {
    reasons.push(ORIGINAL_LOCALIZED_COLLISION_REASON.twoPointSupportInsufficient);
  }

  const originalPolyline = candidate.originalImageEvidence.polyline;
  if (
    originalPolyline.some((point) => point.basis !== ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE)
  ) {
    reasons.push(ORIGINAL_LOCALIZED_COLLISION_REASON.openingBasisMismatch);
  }

  const hostedOpenings = (input.observation?.observedOpenings ?? []).filter(
    (opening) => opening.hostPlaneId === candidate.source.wallPlaneId,
  );
  const openingRecords: OriginalLocalizedOpeningRecord[] = [];
  const acceptedGaps: Array<{ openingId: string; t0: number; t1: number }> = [];

  for (const opening of hostedOpenings) {
    const reconstructed = reconstructOriginalOpeningBoundary(
      opening.id,
      opening.sourceNormalizedBoundary.length,
      input.localization.structures,
    );
    if (!reconstructed) {
      openingRecords.push(Object.freeze({
        openingId: opening.id,
        imageBasis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
        wallSeamImageBasis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
        status: "not_localized",
        hostPlaneId: opening.hostPlaneId,
        category: opening.category,
        originalBoundary: null,
        floorContactInterval: null,
        refusalReasons: Object.freeze([
          ORIGINAL_LOCALIZED_COLLISION_REASON.emptyOpeningGeometryForbidden,
        ]),
      }));
      continue;
    }
    const geometry = evaluateOpeningFloorGapGeometry({
      opening: {
        id: opening.id,
        category: opening.category,
        hostPlaneId: opening.hostPlaneId,
        sourceNormalizedBoundary: reconstructed.map(untagSourcePoint),
        boundaryClosure: opening.boundaryClosure,
        ambiguity: opening.ambiguity,
      },
      polyline: originalPolyline.map(untagSourcePoint),
      occupancy: candidate.originalImageEvidence.occupancy,
      wallPlaneId: candidate.source.wallPlaneId,
    });
    openingRecords.push(Object.freeze({
      openingId: opening.id,
      imageBasis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
      wallSeamImageBasis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
      status: geometry.accepted ? "qualified_floor_gap" : "refused",
      hostPlaneId: opening.hostPlaneId,
      category: opening.category,
      originalBoundary: reconstructed,
      floorContactInterval: geometry.interval,
      refusalReasons: Object.freeze([...geometry.reasons]),
    }));
    if (geometry.accepted && geometry.interval) {
      acceptedGaps.push({
        openingId: opening.id,
        t0: geometry.interval.t0,
        t1: geometry.interval.t1,
      });
    }
  }

  const world = candidate.worldGeometry
    ? {
      a: { x: candidate.worldGeometry.baseStart.x, z: candidate.worldGeometry.baseStart.z },
      b: { x: candidate.worldGeometry.baseEnd.x, z: candidate.worldGeometry.baseEnd.z },
    }
    : null;
  const uniqueReasons = unique(reasons);
  const hardFailed = uniqueReasons.length > 0;
  if (hardFailed || !world || !candidate.worldGeometry) {
    return {
      walls: [copyWall(candidate, null, uniqueReasons, false, "original_localized_full_span")],
      openings: openingRecords,
      openingSubtractionPerformed: false,
    };
  }

  if (acceptedGaps.length === 0) {
    return {
      walls: [copyWall(candidate, world, [], true, "original_localized_full_span")],
      openings: openingRecords,
      openingSubtractionPerformed: false,
    };
  }

  const residuals = subtractParameterIntervals(
    { t0: 0, t1: 1 },
    mergeParameterIntervals(acceptedGaps),
  );
  const residualWorld = residualWorldSegments(world, residuals);
  return {
    walls: residualWorld.map((segment, index) => {
      return Object.freeze({
        id: `${candidate.id}__solid_${index}`,
        sourceOlBoundaryId: candidate.id,
        sourceSeamId: candidate.sourceObservationSeamId,
        collisionEnabled: true,
        finiteBaseSegment: Object.freeze({
          a: Object.freeze({ ...segment.a }),
          b: Object.freeze({ ...segment.b }),
        }),
        supportPlane: Object.freeze({
          normal: Object.freeze({ ...candidate.worldGeometry!.supportPlaneNormal }),
          constant: candidate.worldGeometry!.supportPlaneConstant,
        }),
        interiorHalfSpace: Object.freeze({
          sideSign: candidate.interior.sideSign,
          cameraSideSign: candidate.interior.cameraSideSign,
        }),
        openingSubtractionPerformed: true,
        openingImageBasis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
        wallSeamImageBasis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
        derivation: "original_localized_interval_subtraction" as const,
        qualificationReasons: Object.freeze([]),
        limitations: Object.freeze({
          observedSpanOnly: true as const,
          verticalExtentUnknown: true as const,
          hiddenContinuation: false as const,
          emptyCoordinatesAuthoritative: false as const,
        }),
      });
    }),
    openings: openingRecords,
    openingSubtractionPerformed: residualWorld.length > 0,
  };
}

export function reconstructOriginalOpeningBoundary(
  openingId: string,
  vertexCount: number,
  structures: readonly OriginalLocalizedStructure[],
): readonly OriginalSourceNormalizedPoint[] | null {
  const points: OriginalSourceNormalizedPoint[] = [];
  for (let index = 0; index < vertexCount; index += 1) {
    const structureId = `opening:${openingId}:corner:${index}`;
    const found = structures.find((item) =>
      item.sourceObservationStructureId === structureId &&
      item.localizationClass === "point_anchor"
    );
    if (!found || found.status !== "localized" || !found.originalEvidence.point) {
      return null;
    }
    if (found.originalEvidence.point.basis !== ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE) {
      return null;
    }
    points.push(found.originalEvidence.point);
  }
  return points.length >= 2 ? points : null;
}

function copyWall(
  candidate: OriginalLocalizedBoundaryCandidate,
  world: { a: { x: number; z: number }; b: { x: number; z: number } } | null,
  reasons: readonly string[],
  enable: boolean,
  derivation: OriginalLocalizedCollisionWall["derivation"],
): OriginalLocalizedCollisionWall {
  return Object.freeze({
    id: candidate.id,
    sourceOlBoundaryId: candidate.id,
    sourceSeamId: candidate.sourceObservationSeamId,
    collisionEnabled: enable,
    finiteBaseSegment: world
      ? Object.freeze({
        a: Object.freeze({ ...world.a }),
        b: Object.freeze({ ...world.b }),
      })
      : candidate.worldGeometry
      ? Object.freeze({
        a: Object.freeze({
          x: candidate.worldGeometry.baseStart.x,
          z: candidate.worldGeometry.baseStart.z,
        }),
        b: Object.freeze({
          x: candidate.worldGeometry.baseEnd.x,
          z: candidate.worldGeometry.baseEnd.z,
        }),
      })
      : null,
    supportPlane: candidate.worldGeometry
      ? Object.freeze({
        normal: Object.freeze({ ...candidate.worldGeometry.supportPlaneNormal }),
        constant: candidate.worldGeometry.supportPlaneConstant,
      })
      : null,
    interiorHalfSpace: Object.freeze({
      sideSign: candidate.interior.sideSign,
      cameraSideSign: candidate.interior.cameraSideSign,
    }),
    openingSubtractionPerformed: false,
    openingImageBasis: null,
    wallSeamImageBasis: ORIGINAL_SOURCE_NORMALIZED_IMAGE_SPACE,
    derivation,
    qualificationReasons: Object.freeze([...reasons]),
    limitations: Object.freeze({
      observedSpanOnly: true as const,
      verticalExtentUnknown: true as const,
      hiddenContinuation: false as const,
      emptyCoordinatesAuthoritative: false as const,
    }),
  });
}

function emptyReceipt(
  input: OriginalLocalizedCollisionConstructionInput,
  reasons: readonly string[],
): AfcV2OriginalLocalizedCollisionAuthorityReceipt {
  return freezeOriginalLocalizedCollisionReceipt({
    schemaVersion: AFC_V2_ORIGINAL_LOCALIZED_COLLISION_AUTHORITY_VERSION,
    coordinateSpace: "calibrated-world-xz/v1",
    authority: "partial_original_localized_collision_authority",
    qualificationVersion: AFC_V2_ORIGINAL_LOCALIZED_COLLISION_QUALIFICATION_VERSION,
    collisionAuthority: false,
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    openingSubtractionPerformed: false,
    walls: Object.freeze([]),
    openings: Object.freeze([]),
    lineage: Object.freeze({
      originalLocalizationReceiptSha256: input.localization?.receiptSha256 ?? null,
      originalLocalizationClass: input.localization?.registrationClass ?? null,
      originalLocalizedBoundarySchema: input.originalLocalizedBoundary?.schemaVersion ?? null,
      identityRegistrationClass:
        input.localization?.lineage.identityRegistrationClass ?? null,
      s4aNotMutated: true as const,
      s4bNotMutated: true as const,
    }),
    constructionReasons: Object.freeze([...reasons]),
  });
}

function unique(reasons: readonly string[]): string[] {
  const seen = new Set<string>();
  const uniqueReasons: string[] = [];
  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    uniqueReasons.push(reason);
  }
  return uniqueReasons;
}
