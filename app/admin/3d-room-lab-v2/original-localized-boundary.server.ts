import type { EmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import type { SourceNormalizedPoint } from "./empty-room-observation-contract";
import {
  ROOM_BOUNDARY_CAMERA_INTERIOR_MIN_ABS_DISTANCE_M,
  ROOM_BOUNDARY_IMAGE_LINE_MAX_RESIDUAL,
  ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M,
  ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO,
  ROOM_BOUNDARY_VERTICAL_PLANE_NORMAL_Y_MAX,
  ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M,
  type FrozenRoomBoundaryCameraSnapshot,
  type RoomBoundaryInteriorEvidence,
  type RoomBoundaryOccupancyEvidence,
  type RoomBoundaryWorldGeometry,
  type RoomBoundaryWorldXyz,
  type RoomBoundaryWorldXz,
} from "./room-boundary-authority-contract";
import {
  finiteWorldSpanAlongLine,
  horizontalRunRatio,
  imagePolylineLineFit,
  worldXzLineFit,
} from "./room-boundary-line-fit.server";
import {
  projectOriginalSourceNormalizedToWorld,
  realizeFrozenRoomBoundaryCamera,
} from "./room-boundary-projection.server";
import {
  boundPlanesForFloorWall,
  evaluateOppositeOccupancy,
} from "./room-boundary-qualification.server";
import type { AfcV2OriginalStructuralLocalizationAuthorityReceipt } from "./original-structural-localization-authority-contract";
import { untagSourcePoint } from "./original-structural-localization-authority-contract";
import {
  AFC_V2_ORIGINAL_LOCALIZED_ROOM_BOUNDARY_AUTHORITY_VERSION,
  ORIGINAL_LOCALIZED_BOUNDARY_REASON,
  freezeOriginalLocalizedBoundaryReceipt,
  type AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt,
  type OriginalLocalizedBoundaryCandidate,
  type OriginalLocalizedBoundaryCandidateStatus,
} from "./original-localized-boundary-authority-contract";

export type OriginalLocalizedBoundaryConstructionInput = Readonly<{
  localization: AfcV2OriginalStructuralLocalizationAuthorityReceipt | null;
  observation: EmptyRoomObservationEvidence | null;
  originalIdentity: Readonly<{
    decodedWidth: number;
    decodedHeight: number;
  }> | null;
  camera: FrozenRoomBoundaryCameraSnapshot | null;
}>;

const EMPTY_INTERIOR: RoomBoundaryInteriorEvidence = {
  status: "insufficient",
  witnessImagePoint: null,
  witnessWorldPoint: null,
  sideSign: null,
  cameraSideSign: null,
  cameraContradictsWitness: false,
};

export function constructOriginalLocalizedBoundaryAuthority(
  input: OriginalLocalizedBoundaryConstructionInput,
): AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt {
  try {
    return constructUnchecked(input);
  } catch {
    return emptyReceipt(input, [
      ORIGINAL_LOCALIZED_BOUNDARY_REASON.constructionFailedClosed,
    ]);
  }
}

function constructUnchecked(
  input: OriginalLocalizedBoundaryConstructionInput,
): AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt {
  const localization = input.localization;
  if (
    !localization ||
    localization.registrationClass !== "certified_original_localized"
  ) {
    return emptyReceipt(input, [ORIGINAL_LOCALIZED_BOUNDARY_REASON.olNotCertified]);
  }
  if (!input.camera || !input.originalIdentity) {
    return emptyReceipt(input, [ORIGINAL_LOCALIZED_BOUNDARY_REASON.projectionFailed]);
  }
  const realized = realizeFrozenRoomBoundaryCamera(input.camera);
  const candidates: OriginalLocalizedBoundaryCandidate[] = [];
  for (const structure of localization.structures) {
    if (structure.collisionRelevance !== "floor_wall") continue;
    candidates.push(qualifyFloorWall({
      structure,
      observation: input.observation,
      originalIdentity: input.originalIdentity,
      camera: input.camera,
      realized,
    }));
  }
  const summary = Object.freeze({
    accepted: candidates.filter((item) => item.status === "accepted").length,
    insufficient: candidates.filter((item) => item.status === "insufficient").length,
    rejected: candidates.filter((item) => item.status === "rejected").length,
    ambiguous: candidates.filter((item) => item.status === "ambiguous").length,
    candidateCount: candidates.length,
  });
  return freezeOriginalLocalizedBoundaryReceipt({
    schemaVersion: AFC_V2_ORIGINAL_LOCALIZED_ROOM_BOUNDARY_AUTHORITY_VERSION,
    authority: "partial_original_localized_room_boundary_authority",
    coordinateSpace: "calibrated-world-xz/v1",
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    collisionAuthority: false,
    camera: input.camera,
    candidates: Object.freeze(candidates),
    summary,
    lineage: Object.freeze({
      originalLocalizationSchemaVersion: localization.schemaVersion,
      originalLocalizationReceiptSha256: localization.receiptSha256,
      originalLocalizationClass: localization.registrationClass,
      identityRegistrationReceiptSha256:
        localization.lineage.identityRegistrationReceiptSha256,
      s4aNotMutated: true as const,
    }),
    constructionReasons: Object.freeze([]),
  });
}

function qualifyFloorWall(input: {
  structure: AfcV2OriginalStructuralLocalizationAuthorityReceipt["structures"][number];
  observation: EmptyRoomObservationEvidence | null;
  originalIdentity: Readonly<{ decodedWidth: number; decodedHeight: number }>;
  camera: FrozenRoomBoundaryCameraSnapshot;
  realized: ReturnType<typeof realizeFrozenRoomBoundaryCamera>;
}): OriginalLocalizedBoundaryCandidate {
  const reasons: string[] = [];
  let status: OriginalLocalizedBoundaryCandidateStatus | null = null;
  const seam = input.observation?.observedSeams.find(
    (item) => item.id === input.structure.sourceObservationStructureId,
  );
  const bound = seam && input.observation
    ? boundPlanesForFloorWall(seam.planeIds, input.observation.observedPlanes)
    : null;
  if (!bound) {
    reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.planeBindingInvalid);
    status = "rejected";
  }
  if (input.structure.status !== "localized") {
    reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.floorWallNotLocalized);
    status = status ?? "insufficient";
  }
  const originalPolyline = input.structure.originalEvidence.polyline ?? [];
  if (originalPolyline.length < 2) {
    reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.originalGeometryMissing);
    status = status ?? "insufficient";
  }
  const untagged = originalPolyline.map(untagSourcePoint);
  const nearVertical = horizontalRunRatio(untagged) !== null &&
    (horizontalRunRatio(untagged) ?? 1) < ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO;
  if (nearVertical) {
    reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.nearVertical);
    status = status ?? "insufficient";
  }
  const occupancy = bound && seam
    ? evaluateOppositeOccupancy(
      seam.sourceNormalizedPolyline,
      bound.floor.sourceNormalizedPolygon,
      bound.wall.sourceNormalizedPolygon,
    )
    : null;
  if (occupancy && !occupancy.opposite) {
    reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.occupancyNotOpposite);
    status = "rejected";
  }
  const imageFit = untagged.length >= 2 ? imagePolylineLineFit(untagged) : null;
  if (imageFit && imageFit.residual.maxDistance > ROOM_BOUNDARY_IMAGE_LINE_MAX_RESIDUAL) {
    reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.worldLineDegenerate);
    status = status ?? "insufficient";
  }

  let worldGeometry: RoomBoundaryWorldGeometry | null = null;
  let worldSamples: RoomBoundaryWorldXz[] = [];
  let worldResidual = null as OriginalLocalizedBoundaryCandidate["projection"]["worldResidual"];
  const realized = input.realized;
  if (realized.ok && originalPolyline.length >= 2) {
    const points = originalPolyline.map((point) =>
      projectOriginalSourceNormalizedToWorld(
        untagSourcePoint(point),
        {
          width: input.originalIdentity.decodedWidth,
          height: input.originalIdentity.decodedHeight,
        },
        input.camera.frame,
        realized.camera,
      )
    );
    const failed = points.find((point) => !point.ok);
    worldSamples = points.flatMap((point) =>
      point.ok ? [{ x: point.world.x, z: point.world.z }] : []
    );
    if (failed && !failed.ok) {
      reasons.push(`${ORIGINAL_LOCALIZED_BOUNDARY_REASON.projectionFailed}:${failed.reason}`);
      status = status ?? "insufficient";
    } else {
      const worldFit = worldXzLineFit(worldSamples);
      worldResidual = worldFit?.residual ?? null;
      if (!worldFit) {
        reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.worldLineDegenerate);
        status = status ?? "insufficient";
      } else if (worldFit.residual.maxDistance > ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M) {
        reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.worldLineDegenerate);
        status = status ?? "insufficient";
      } else {
        const span = finiteWorldSpanAlongLine(
          worldSamples,
          worldFit.origin,
          worldFit.direction,
        );
        if (!span || span.length < ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M) {
          reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.degenerateWorldSpan);
          status = status ?? "rejected";
        } else {
          worldGeometry = deriveUnflippedVerticalSupportPlane(span.start, span.end);
          if (!worldGeometry) {
            reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.supportPlaneDegenerate);
            status = status ?? "insufficient";
          }
        }
      }
    }
  } else if (!realized.ok) {
    reasons.push(`${ORIGINAL_LOCALIZED_BOUNDARY_REASON.projectionFailed}:${realized.reason}`);
    status = status ?? "insufficient";
  }

  let interior = EMPTY_INTERIOR;
  if (!status && worldGeometry && occupancy && seam) {
    interior = evaluateOriginalLocalizedInterior({
      occupancy,
      emptyPolyline: seam.sourceNormalizedPolyline,
      originalPolyline: untagged,
      geometry: worldGeometry,
      camera: input.camera,
      originalIdentity: input.originalIdentity,
      realized: input.realized,
    });
    if (interior.status !== "accepted") {
      reasons.push(
        interior.cameraContradictsWitness
          ? ORIGINAL_LOCALIZED_BOUNDARY_REASON.cameraContradictsWitness
          : ORIGINAL_LOCALIZED_BOUNDARY_REASON.interiorInsufficient,
      );
      status = "insufficient";
    }
  } else if (!status && !occupancy) {
    reasons.push(ORIGINAL_LOCALIZED_BOUNDARY_REASON.interiorInsufficient);
    status = "insufficient";
  }

  const accepted = status === null && worldGeometry !== null && interior.status === "accepted";
  return Object.freeze({
    id: `olb_${input.structure.sourceObservationStructureId}`,
    sourceObservationSeamId: input.structure.sourceObservationStructureId,
    sourceOLStructureId: input.structure.id,
    status: accepted ? "accepted" : status ?? "insufficient",
    source: Object.freeze({
      imageBasis: "ORIGINAL" as const,
      coordinateSpace: "original-source-normalized-image/v1" as const,
      floorPlaneId: bound?.floor.id ?? input.structure.sourceFloorPlaneId,
      wallPlaneId: bound?.wall.id ?? input.structure.sourceWallPlaneId,
      planeIds: Object.freeze([...(seam?.planeIds ?? input.structure.sourcePlaneIds)]),
    }),
    originalImageEvidence: Object.freeze({
      polyline: Object.freeze([...originalPolyline]),
      occupancy,
      lineResidual: imageFit?.residual ?? null,
      sampleCount: input.structure.matcherDiagnostics.sampleCount ?? originalPolyline.length,
      matchedSampleCount: input.structure.matcherDiagnostics.matchedSampleCount ??
        originalPolyline.length,
      matchedFraction: input.structure.matcherDiagnostics.matchedFraction,
      orientationResidual: input.structure.matcherDiagnostics.orientationResidual,
    }),
    projection: Object.freeze({
      kernel: "projectOriginalSourceNormalizedToWorld" as const,
      worldSamples: Object.freeze(worldSamples),
      worldResidual,
    }),
    worldGeometry,
    interior,
    authority: Object.freeze({
      kind: "partial_original_localized_room_boundary_authority" as const,
      baseSegment: worldGeometry !== null,
      supportPlane: worldGeometry !== null,
      interiorHalfSpace: interior.status,
      collision: false as const,
    }),
    limitations: Object.freeze({
      observedSpanOnly: true as const,
      hiddenContinuation: false as const,
      geometryManufactured: false as const,
      closedTopology: false as const,
      collisionAuthority: false as const,
      emptyCoordinatesAuthoritative: false as const,
    }),
    reasons: Object.freeze([...reasons]),
  });
}

/**
 * EMPTY occupancy supplies the semantic floor side relative to the EMPTY
 * seam orientation. ORIGINAL coordinates supply the witness location.
 * Camera corroborates and may veto; it is never the sole side chooser.
 */
export function evaluateOriginalLocalizedInterior(input: {
  occupancy: RoomBoundaryOccupancyEvidence;
  emptyPolyline: readonly SourceNormalizedPoint[];
  originalPolyline: readonly SourceNormalizedPoint[];
  geometry: RoomBoundaryWorldGeometry;
  camera: FrozenRoomBoundaryCameraSnapshot;
  originalIdentity: Readonly<{ decodedWidth: number; decodedHeight: number }>;
  realized: ReturnType<typeof realizeFrozenRoomBoundaryCamera>;
}): RoomBoundaryInteriorEvidence {
  const failed = (
    extras: Partial<RoomBoundaryInteriorEvidence> = {},
  ): RoomBoundaryInteriorEvidence => ({
    status: "insufficient",
    witnessImagePoint: extras.witnessImagePoint ?? null,
    witnessWorldPoint: extras.witnessWorldPoint ?? null,
    sideSign: extras.sideSign ?? null,
    cameraSideSign: extras.cameraSideSign ?? null,
    cameraContradictsWitness: extras.cameraContradictsWitness ?? false,
  });
  if (
    (input.occupancy.floorSide !== "positive" && input.occupancy.floorSide !== "negative") ||
    !input.occupancy.opposite
  ) {
    return failed();
  }
  const emptyFit = imagePolylineLineFit(input.emptyPolyline);
  const originalFit = imagePolylineLineFit(input.originalPolyline);
  if (!emptyFit || !originalFit) return failed();
  let originalDirection = originalFit.direction;
  const alignedDot = emptyFit.direction.x * originalDirection.x +
    emptyFit.direction.y * originalDirection.y;
  if (alignedDot < 0) {
    originalDirection = { x: -originalDirection.x, y: -originalDirection.y };
  }
  const inward = perpendicularTowardSide(originalDirection, input.occupancy.floorSide);
  const start = input.originalPolyline[0]!;
  const end = input.originalPolyline[input.originalPolyline.length - 1]!;
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  const inwardNorm = normalize2d(inward);
  if (!inwardNorm) return failed();
  const witnessImage = {
    x: midpoint.x + inwardNorm.x * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
    y: midpoint.y + inwardNorm.y * ROOM_BOUNDARY_INTERIOR_WITNESS_INSET,
  };
  if (!input.realized.ok) return failed({ witnessImagePoint: witnessImage });
  const realized = input.realized;
  const projected = projectOriginalSourceNormalizedToWorld(
    witnessImage,
    {
      width: input.originalIdentity.decodedWidth,
      height: input.originalIdentity.decodedHeight,
    },
    input.camera.frame,
    realized.camera,
  );
  if (!projected.ok) return failed({ witnessImagePoint: witnessImage });
  const witnessWorld = projected.world;
  const witnessDistance = signedPlaneDistance(witnessWorld, input.geometry);
  const sideSign = signFromDistance(witnessDistance);
  if (sideSign === null || sideSign === 0) {
    return failed({
      witnessImagePoint: witnessImage,
      witnessWorldPoint: witnessWorld,
    });
  }
  const cameraDistance = signedPlaneDistance({
    x: input.camera.pose.position.x,
    y: input.camera.pose.position.y,
    z: input.camera.pose.position.z,
  }, input.geometry);
  const cameraSideSign = signFromDistance(cameraDistance);
  if ((cameraSideSign === 1 || cameraSideSign === -1) && cameraSideSign !== sideSign) {
    return failed({
      witnessImagePoint: witnessImage,
      witnessWorldPoint: witnessWorld,
      sideSign,
      cameraSideSign,
      cameraContradictsWitness: true,
    });
  }
  return {
    status: "accepted",
    witnessImagePoint: witnessImage,
    witnessWorldPoint: witnessWorld,
    sideSign,
    cameraSideSign,
    cameraContradictsWitness: false,
  };
}

function deriveUnflippedVerticalSupportPlane(
  start: RoomBoundaryWorldXyz,
  end: RoomBoundaryWorldXyz,
): RoomBoundaryWorldGeometry | null {
  const tangent = {
    x: end.x - start.x,
    y: 0,
    z: end.z - start.z,
  };
  const tangentLength = Math.hypot(tangent.x, tangent.z);
  if (
    !Number.isFinite(tangentLength) ||
    tangentLength < ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M
  ) {
    return null;
  }
  const unitTangent = {
    x: tangent.x / tangentLength,
    y: 0,
    z: tangent.z / tangentLength,
  };
  const rawNormal = { x: -unitTangent.z, y: 0, z: unitTangent.x };
  const normalLength = Math.hypot(rawNormal.x, rawNormal.z);
  if (!Number.isFinite(normalLength) || normalLength <= 1e-12) return null;
  const supportPlaneNormal = {
    x: rawNormal.x / normalLength,
    y: 0,
    z: rawNormal.z / normalLength,
  };
  if (Math.abs(supportPlaneNormal.y) > ROOM_BOUNDARY_VERTICAL_PLANE_NORMAL_Y_MAX) {
    return null;
  }
  return {
    baseStart: { x: start.x, y: 0, z: start.z },
    baseEnd: { x: end.x, y: 0, z: end.z },
    tangent: unitTangent,
    supportPlaneNormal,
    supportPlaneConstant:
      -(supportPlaneNormal.x * start.x + supportPlaneNormal.z * start.z),
  };
}

function signedPlaneDistance(
  point: RoomBoundaryWorldXyz,
  geometry: RoomBoundaryWorldGeometry,
): number {
  return geometry.supportPlaneNormal.x * point.x +
    geometry.supportPlaneNormal.y * point.y +
    geometry.supportPlaneNormal.z * point.z +
    geometry.supportPlaneConstant;
}

function signFromDistance(distance: number): -1 | 1 | 0 | null {
  if (!Number.isFinite(distance)) return null;
  if (Math.abs(distance) <= ROOM_BOUNDARY_CAMERA_INTERIOR_MIN_ABS_DISTANCE_M) {
    return 0;
  }
  return distance > 0 ? 1 : -1;
}

function signedImageSide(
  origin: SourceNormalizedPoint,
  direction: SourceNormalizedPoint,
  point: SourceNormalizedPoint,
): number {
  return direction.x * (point.y - origin.y) - direction.y * (point.x - origin.x);
}

function perpendicularTowardSide(
  direction: SourceNormalizedPoint,
  desired: "positive" | "negative",
): SourceNormalizedPoint {
  const first = { x: -direction.y, y: direction.x };
  const origin = { x: 0, y: 0 };
  const firstSign = signedImageSide(origin, direction, first);
  const matches = desired === "positive" ? firstSign > 0 : firstSign < 0;
  return matches ? first : { x: direction.y, y: -direction.x };
}

function normalize2d(vector: SourceNormalizedPoint): SourceNormalizedPoint | null {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= 1e-12) return null;
  return { x: vector.x / length, y: vector.y / length };
}

function emptyReceipt(
  input: OriginalLocalizedBoundaryConstructionInput,
  reasons: readonly string[],
): AfcV2OriginalLocalizedRoomBoundaryAuthorityReceipt {
  return freezeOriginalLocalizedBoundaryReceipt({
    schemaVersion: AFC_V2_ORIGINAL_LOCALIZED_ROOM_BOUNDARY_AUTHORITY_VERSION,
    authority: "partial_original_localized_room_boundary_authority",
    coordinateSpace: "calibrated-world-xz/v1",
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    collisionAuthority: false,
    camera: input.camera ?? {
      verticalFovDeg: 0,
      pose: {
        position: { x: 0, y: 0, z: 0 },
        lookAt: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      frame: { width: 0, height: 0 },
    },
    candidates: Object.freeze([]),
    summary: Object.freeze({
      accepted: 0,
      insufficient: 0,
      rejected: 0,
      ambiguous: 0,
      candidateCount: 0,
    }),
    lineage: Object.freeze({
      originalLocalizationSchemaVersion: input.localization?.schemaVersion ?? null,
      originalLocalizationReceiptSha256: input.localization?.receiptSha256 ?? null,
      originalLocalizationClass: input.localization?.registrationClass ?? null,
      identityRegistrationReceiptSha256:
        input.localization?.lineage.identityRegistrationReceiptSha256 ?? null,
      s4aNotMutated: true as const,
    }),
    constructionReasons: Object.freeze([...reasons]),
  });
}
