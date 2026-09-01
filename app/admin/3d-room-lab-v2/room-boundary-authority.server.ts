import { classifyAfcR3cImagePairCompatibility } from "../3d-room-lab/research/afc-r3c-image-pair-compatibility";
import type {
  EmptyObservedPlane,
  EmptyObservedSeam,
  EmptyRoomObservationEvidence,
} from "./empty-room-observation-contract";
import {
  AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
  AFC_V2_ROOM_BOUNDARY_CONSTRUCTION_VERSION,
  AFC_V2_ROOM_BOUNDARY_COORDINATE_SPACE,
  AFC_V2_ROOM_BOUNDARY_KIND,
  AFC_V2_ROOM_BOUNDARY_LINE_FIT_VERSION,
  AFC_V2_ROOM_BOUNDARY_PROJECTION_KERNEL_VERSION,
  ROOM_BOUNDARY_IMAGE_LINE_MAX_RESIDUAL,
  ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M,
  ROOM_BOUNDARY_VERTICAL_PLANE_NORMAL_Y_MAX,
  ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M,
  freezeRoomBoundaryAuthorityReceipt,
  type AfcV2RoomBoundaryAuthorityReceipt,
  type FrozenRoomBoundaryCameraSnapshot,
  type RoomBoundaryCandidate,
  type RoomBoundaryCandidateAuthority,
  type RoomBoundaryCandidateStatus,
  type RoomBoundaryInteriorEvidence,
  type RoomBoundaryLineResidualClass,
  type RoomBoundaryWorldGeometry,
  type RoomBoundaryWorldXyz,
} from "./room-boundary-authority-contract";
import {
  finiteWorldSpanAlongLine,
  imagePolylineLineFit,
  worldXzLineFit,
} from "./room-boundary-line-fit.server";
import {
  projectEmptyPolylineToWorld,
  projectEmptySourceNormalizedToWorld,
  realizeFrozenRoomBoundaryCamera,
} from "./room-boundary-projection.server";
import {
  boundPlanesForFloorWall,
  competingSameWall,
  endpointIsFrameAdjacent,
  evaluateFrontierProximity,
  evaluateInteriorHalfSpace,
  evaluateOppositeOccupancy,
  floorWallProjectionContinuation,
  isNearVerticalFloorWallSeam,
  nearVerticalFloorWallMayContinue,
} from "./room-boundary-qualification.server";

export type RoomBoundaryConstructionInput = Readonly<{
  attemptId: string;
  loadGeneration: number;
  observation: EmptyRoomObservationEvidence | null;
  emptyIdentity: Readonly<{
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
  }>;
  originalIdentity: Readonly<{
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
  }>;
  floor: Readonly<{
    authorityKey: string;
    worldWidthM: number;
    referenceDepthM: number;
    widthDepthRatio: number;
  }>;
  camera: FrozenRoomBoundaryCameraSnapshot;
  freezeReceipt: unknown;
}>;

const EMPTY_INTERIOR: RoomBoundaryInteriorEvidence = Object.freeze({
  status: "insufficient",
  witnessImagePoint: null,
  witnessWorldPoint: null,
  sideSign: null,
  cameraSideSign: null,
  cameraContradictsWitness: false,
});

const NO_AUTHORITY: RoomBoundaryCandidateAuthority = Object.freeze({
  kind: null,
  baseSegment: false,
  supportPlane: false,
  interiorHalfSpace: "insufficient",
  collision: false,
});

function freezeLineage(input: RoomBoundaryConstructionInput) {
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: input.originalIdentity.sha256,
      decodedWidth: input.originalIdentity.decodedWidth,
      decodedHeight: input.originalIdentity.decodedHeight,
      orientation: input.originalIdentity.orientation,
    },
    {
      fingerprint: input.emptyIdentity.sha256,
      decodedWidth: input.emptyIdentity.decodedWidth,
      decodedHeight: input.emptyIdentity.decodedHeight,
      orientation: input.emptyIdentity.orientation,
    },
  );
  const freeze = freezeReceiptIdentity(input.freezeReceipt);
  return Object.freeze({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: Object.freeze({ ...input.emptyIdentity }),
    originalIdentity: Object.freeze({ ...input.originalIdentity }),
    emptyToOriginalCompatibility: Object.freeze({
      version: compatibility.version,
      tier: compatibility.tier,
      reason: compatibility.reason,
    }),
    observation: Object.freeze({
      schemaVersion: input.observation?.schemaVersion ?? null,
      authority: input.observation?.authority ?? null,
      worldProjectionPerformed: false as const,
      promptVersion: input.observation?.observer.promptVersion ?? null,
      observerProfile: input.observation?.observer.profile ?? null,
      coordinateSpace: input.observation?.coordinateSpace ?? null,
    }),
    floor: Object.freeze({ ...input.floor }),
    camera: Object.freeze({
      verticalFovDeg: input.camera.verticalFovDeg,
      frame: Object.freeze({ ...input.camera.frame }),
      pose: Object.freeze({
        position: Object.freeze({ ...input.camera.pose.position }),
        lookAt: Object.freeze({ ...input.camera.pose.lookAt }),
        up: Object.freeze({ ...input.camera.pose.up }),
      }),
      freezeReceiptVersion: freeze.receiptVersion,
      freezePayloadSha256: freeze.payloadSha256,
    }),
    projectionKernelVersion: AFC_V2_ROOM_BOUNDARY_PROJECTION_KERNEL_VERSION,
    constructionVersion: AFC_V2_ROOM_BOUNDARY_CONSTRUCTION_VERSION,
    lineFitVersion: AFC_V2_ROOM_BOUNDARY_LINE_FIT_VERSION,
  });
}

function freezeReceiptIdentity(value: unknown): {
  receiptVersion: string | null;
  payloadSha256: string | null;
} {
  if (!value || typeof value !== "object") {
    return { receiptVersion: null, payloadSha256: null };
  }
  const receipt = value as {
    receiptVersion?: unknown;
    integrity?: { payloadSha256?: unknown };
  };
  return {
    receiptVersion: typeof receipt.receiptVersion === "string"
      ? receipt.receiptVersion
      : null,
    payloadSha256: typeof receipt.integrity?.payloadSha256 === "string"
      ? receipt.integrity.payloadSha256
      : null,
  };
}

function emptyReceipt(
  input: RoomBoundaryConstructionInput,
  constructionReasons: readonly string[],
): AfcV2RoomBoundaryAuthorityReceipt {
  return freezeRoomBoundaryAuthorityReceipt({
    schemaVersion: AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
    coordinateSpace: AFC_V2_ROOM_BOUNDARY_COORDINATE_SPACE,
    authority: "partial_room_boundary_authority",
    boundaryKind: AFC_V2_ROOM_BOUNDARY_KIND,
    lineage: freezeLineage(input),
    candidates: Object.freeze([]),
    summary: Object.freeze({
      accepted: 0,
      ambiguous: 0,
      insufficient: 0,
      rejected: 0,
      skippedNonFloorWall: 0,
      candidateCount: 0,
    }),
    geometryManufactured: false,
    collisionAuthority: false,
    constructionReasons: Object.freeze([...constructionReasons]),
  });
}

function limitations(frameAdjacentEndpoint: boolean) {
  return Object.freeze({
    observedSpanOnly: true as const,
    verticalExtentUnknown: true as const,
    hiddenContinuation: false as const,
    completeWall: false as const,
    frameAdjacentEndpoint,
    geometryManufactured: false as const,
  });
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

function candidateShell(input: {
  seam: EmptyObservedSeam;
  floorPlaneId: string | null;
  wallPlaneId: string | null;
  status: RoomBoundaryCandidateStatus;
  reasons: readonly string[];
  occupancy: RoomBoundaryCandidate["imageEvidence"]["occupancy"];
  frontier: RoomBoundaryCandidate["imageEvidence"]["frontier"];
  lineResidual: RoomBoundaryCandidate["imageEvidence"]["lineResidual"];
  lineResidualClass: RoomBoundaryLineResidualClass;
  nearVertical: boolean;
  projection: RoomBoundaryCandidate["projection"];
  worldGeometry: RoomBoundaryWorldGeometry | null;
  interior?: RoomBoundaryInteriorEvidence;
  authority?: RoomBoundaryCandidateAuthority;
}): RoomBoundaryCandidate {
  return Object.freeze({
    id: `rb_${input.seam.id}`,
    sourceSeamId: input.seam.id,
    status: input.status,
    source: Object.freeze({
      category: input.seam.category,
      observationSource: input.seam.observationSource,
      imageBasis: "EMPTY" as const,
      planeIds: Object.freeze([...input.seam.planeIds]),
      floorPlaneId: input.floorPlaneId,
      wallPlaneId: input.wallPlaneId,
      confidence: input.seam.confidence,
      ambiguity: input.seam.ambiguity,
    }),
    imageEvidence: Object.freeze({
      polyline: Object.freeze([...input.seam.sourceNormalizedPolyline]),
      occupancy: input.occupancy,
      frontier: input.frontier,
      lineResidual: input.lineResidual,
      lineResidualClass: input.lineResidualClass,
      nearVertical: input.nearVertical,
    }),
    projection: input.projection,
    worldGeometry: input.worldGeometry,
    interior: input.interior ?? EMPTY_INTERIOR,
    authority: input.authority ?? NO_AUTHORITY,
    limitations: limitations(
      endpointIsFrameAdjacent(input.seam.sourceNormalizedPolyline),
    ),
    reasons: Object.freeze([...input.reasons]),
  });
}

function emptyProjection(): RoomBoundaryCandidate["projection"] {
  return Object.freeze({
    kernelVersion: AFC_V2_ROOM_BOUNDARY_PROJECTION_KERNEL_VERSION,
    points: Object.freeze([]),
    worldSamples: Object.freeze([]),
    worldResidual: null,
  });
}

function qualifySeam(input: {
  seam: EmptyObservedSeam;
  planes: readonly EmptyObservedPlane[];
  identities: Parameters<typeof projectEmptyPolylineToWorld>[1];
  frame: FrozenRoomBoundaryCameraSnapshot["frame"];
  camera: ReturnType<typeof realizeFrozenRoomBoundaryCamera>;
  compatibilityOk: boolean;
}): RoomBoundaryCandidate {
  const seam = input.seam;
  const reasons: string[] = [];
  let status: RoomBoundaryCandidateStatus | null = null;
  const bound = boundPlanesForFloorWall(seam.planeIds, input.planes);
  const floorPlaneId = bound?.floor.id ?? null;
  const wallPlaneId = bound?.wall.id ?? null;
  const imageFit = imagePolylineLineFit(seam.sourceNormalizedPolyline);
  const occupancyPolyline =
    imageFit &&
      imageFit.residual.maxDistance > ROOM_BOUNDARY_IMAGE_LINE_MAX_RESIDUAL &&
      seam.sourceNormalizedPolyline.length >= 3
      ? [
        seam.sourceNormalizedPolyline[0],
        seam.sourceNormalizedPolyline[seam.sourceNormalizedPolyline.length - 1],
      ]
      : seam.sourceNormalizedPolyline;
  const nearVertical = isNearVerticalFloorWallSeam(seam.sourceNormalizedPolyline);
  const occupancy = bound
    ? evaluateOppositeOccupancy(
      occupancyPolyline,
      bound.floor.sourceNormalizedPolygon,
      bound.wall.sourceNormalizedPolygon,
    )
    : null;
  const frontier = bound
    ? evaluateFrontierProximity(
      seam.sourceNormalizedPolyline,
      bound.floor.sourceNormalizedPolygon,
      bound.wall.sourceNormalizedPolygon,
    )
    : null;

  if (seam.observationSource !== "general_empty_observer") {
    reasons.push("focused_observer_cannot_create_world_boundary");
    status = "rejected";
  }
  if (!bound) {
    reasons.push("invalid_or_missing_floor_wall_plane_binding");
    status = status ?? "rejected";
  }
  if (seam.ambiguity !== null) {
    reasons.push("observer_ambiguity_present");
    status = status ?? "insufficient";
  }
  if (
    !nearVerticalFloorWallMayContinue({
      nearVertical,
      bindingSucceeded: bound !== null,
      ambiguity: seam.ambiguity,
      occupancyOpposite: occupancy?.opposite === true,
      nearFloorFrontier: frontier?.nearFloorFrontier === true,
      nearWallFrontier: frontier?.nearWallFrontier === true,
    })
  ) {
    reasons.push("near_vertical_image_seam_insufficient_as_floor_wall");
    status = status ?? "insufficient";
  }
  if (occupancy && occupancy.floorSide === "mixed") {
    reasons.push("floor_occupancy_not_unique");
    status = status ?? "insufficient";
  } else if (occupancy && occupancy.wallSide === "mixed") {
    reasons.push("wall_occupancy_not_unique");
    status = status ?? "insufficient";
  } else if (occupancy && occupancy.floorSide === "undetermined") {
    reasons.push("floor_occupancy_undetermined");
    status = status ?? "insufficient";
  } else if (occupancy && occupancy.wallSide === "undetermined") {
    reasons.push("wall_occupancy_undetermined");
    status = status ?? "insufficient";
  } else if (occupancy && !occupancy.opposite) {
    reasons.push("floor_and_wall_occupancy_not_opposite");
    status = "rejected";
  }
  if (frontier && !frontier.nearFloorFrontier) {
    reasons.push("seam_not_near_floor_polygon_frontier");
    status = status ?? "insufficient";
  }
  if (frontier && !frontier.nearWallFrontier) {
    reasons.push("seam_not_near_wall_polygon_frontier");
    status = status ?? "insufficient";
  }
  if (!imageFit) {
    reasons.push("image_line_fit_degenerate");
    status = status ?? "insufficient";
  }
  const imageResidualSupported = Boolean(
    imageFit &&
      imageFit.residual.maxDistance <= ROOM_BOUNDARY_IMAGE_LINE_MAX_RESIDUAL,
  );
  if (imageFit && !imageResidualSupported) {
    reasons.push("image_line_residual_underdetermined");
  }
  if (!input.compatibilityOk) {
    reasons.push("empty_original_incompatible");
    status = status ?? "rejected";
  }

  let projection = emptyProjection();
  let worldGeometry: RoomBoundaryWorldGeometry | null = null;
  let lineResidualClass: RoomBoundaryLineResidualClass = "underdetermined";
  if (input.compatibilityOk && input.camera.ok) {
    const points = projectEmptyPolylineToWorld(
      seam.sourceNormalizedPolyline,
      input.identities,
      input.frame,
      input.camera.camera,
    );
    const worldSamples = points.flatMap((point) =>
      point.ok ? [{ x: point.world.x, z: point.world.z }] : []
    );
    const first = points[0];
    const last = points[points.length - 1];
    const continuation = floorWallProjectionContinuation(points);
    const endpointProjectionFailed = continuation.endpointProjectionFailed;
    const interiorProjectionFailed = continuation.interiorProjectionFailed;
    const allProjected = points.length >= 2 && points.every((point) => point.ok);
    const worldFit = worldXzLineFit(worldSamples);
    projection = Object.freeze({
      kernelVersion: AFC_V2_ROOM_BOUNDARY_PROJECTION_KERNEL_VERSION,
      points: Object.freeze(points),
      worldSamples: Object.freeze(worldSamples),
      worldResidual: worldFit?.residual ?? null,
    });
    const worldResidualSupported = Boolean(
      worldFit &&
        worldFit.residual.maxDistance <= ROOM_BOUNDARY_WORLD_LINE_MAX_RESIDUAL_M,
    );
    const residualSupported = seam.sourceNormalizedPolyline.length >= 3 &&
      imageResidualSupported &&
      allProjected &&
      worldResidualSupported;
    if (residualSupported) {
      lineResidualClass = "supported";
    }
    if (endpointProjectionFailed) {
      const failed = first && !first.ok ? first : last && !last.ok ? last : null;
      reasons.push(
        `projection_failed:${failed && !failed.ok ? failed.reason : "endpoint"}`,
      );
      status = status ?? "insufficient";
    } else if (interiorProjectionFailed) {
      reasons.push("interior_projection_unusable");
    }
    if (!worldFit) {
      reasons.push("world_line_fit_degenerate");
      status = status ?? "insufficient";
    } else if (!worldResidualSupported) {
      reasons.push("world_line_residual_underdetermined");
    }

    if (first && last && first.ok && last.ok) {
      if (residualSupported && worldFit) {
        const span = finiteWorldSpanAlongLine(
          worldSamples,
          worldFit.origin,
          worldFit.direction,
        );
        if (!span || span.length < ROOM_BOUNDARY_MIN_WORLD_SEAM_LENGTH_M) {
          reasons.push("degenerate_world_span");
          status = status ?? "rejected";
        } else {
          worldGeometry = deriveUnflippedVerticalSupportPlane(span.start, span.end);
          if (!worldGeometry) {
            reasons.push("vertical_support_plane_degenerate");
            status = status ?? "insufficient";
          }
        }
      } else {
        worldGeometry = deriveUnflippedVerticalSupportPlane(
          { x: first.world.x, y: 0, z: first.world.z },
          { x: last.world.x, y: 0, z: last.world.z },
        );
        if (!worldGeometry) {
          reasons.push("vertical_support_plane_degenerate");
          status = status ?? "insufficient";
        }
      }
    }
  } else if (!input.camera.ok) {
    reasons.push(`camera_realization_failed:${input.camera.reason}`);
    status = status ?? "insufficient";
  }

  if (status) {
    return candidateShell({
      seam,
      floorPlaneId,
      wallPlaneId,
      status,
      reasons,
      occupancy,
      frontier,
      lineResidual: imageFit?.residual ?? null,
      lineResidualClass,
      nearVertical,
      projection,
      worldGeometry,
    });
  }

  if (!worldGeometry) {
    return candidateShell({
      seam,
      floorPlaneId,
      wallPlaneId,
      status: "insufficient",
      reasons: [...reasons, "world_geometry_unavailable"],
      occupancy,
      frontier,
      lineResidual: imageFit?.residual ?? null,
      lineResidualClass,
      nearVertical,
      projection,
      worldGeometry: null,
    });
  }

  return candidateShell({
    seam,
    floorPlaneId,
    wallPlaneId,
    status: "accepted",
    reasons,
    occupancy,
    frontier,
    lineResidual: imageFit?.residual ?? null,
    lineResidualClass,
    nearVertical,
    projection,
    worldGeometry,
    authority: Object.freeze({
      kind: AFC_V2_ROOM_BOUNDARY_KIND,
      baseSegment: true,
      supportPlane: true,
      interiorHalfSpace: "insufficient",
      collision: false,
    }),
  });
}

function attachInterior(
  candidate: RoomBoundaryCandidate,
  planes: readonly EmptyObservedPlane[],
  camera: FrozenRoomBoundaryCameraSnapshot,
  projectWitness: (point: { x: number; y: number }) => ReturnType<
    typeof projectEmptySourceNormalizedToWorld
  >,
): RoomBoundaryCandidate {
  if (candidate.status !== "accepted" || !candidate.worldGeometry) {
    return candidate;
  }
  const floor = planes.find((plane) => plane.id === candidate.source.floorPlaneId);
  const wall = planes.find((plane) => plane.id === candidate.source.wallPlaneId);
  const interior = evaluateInteriorHalfSpace({
    occupancy: candidate.imageEvidence.occupancy,
    polyline: candidate.imageEvidence.polyline,
    floorPolygon: floor?.sourceNormalizedPolygon ?? null,
    wallPolygon: wall?.sourceNormalizedPolygon ?? null,
    geometry: candidate.worldGeometry,
    camera,
    projectWitness,
  });
  if (interior.status !== "accepted") {
    const reasons = [...candidate.reasons];
    if (interior.cameraContradictsWitness) {
      reasons.push("interior_camera_contradicts_floor_witness");
    } else if (!interior.witnessImagePoint) {
      reasons.push("interior_witness_unavailable");
    } else if (!interior.witnessWorldPoint) {
      reasons.push("interior_witness_projection_failed");
    } else {
      reasons.push("interior_signed_distance_degenerate");
    }
    return Object.freeze({
      ...candidate,
      interior,
      authority: Object.freeze({
        ...candidate.authority,
        interiorHalfSpace: "insufficient" as const,
        collision: false as const,
      }),
      reasons: Object.freeze(reasons),
    });
  }
  return Object.freeze({
    ...candidate,
    interior,
    authority: Object.freeze({
      ...candidate.authority,
      interiorHalfSpace: "accepted" as const,
      collision: false as const,
    }),
  });
}

/**
 * Consumes observation-only EMPTY evidence plus a frozen calibrated camera.
 * Never mutates Room Observation, Floor, FOV, or camera calibration.
 */
export function constructAfcV2RoomBoundaryAuthority(
  input: RoomBoundaryConstructionInput,
): AfcV2RoomBoundaryAuthorityReceipt {
  try {
    return constructAfcV2RoomBoundaryAuthorityUnchecked(input);
  } catch {
    return emptyReceipt(input, ["construction_failed_closed"]);
  }
}

function constructAfcV2RoomBoundaryAuthorityUnchecked(
  input: RoomBoundaryConstructionInput,
): AfcV2RoomBoundaryAuthorityReceipt {
  const lineage = freezeLineage(input);
  if (!input.observation || input.observation.observerStatus === "failed") {
    return emptyReceipt(
      input,
      input.observation
        ? ["observation_failed"]
        : ["observation_unavailable"],
    );
  }

  const compatibilityOk = lineage.emptyToOriginalCompatibility.tier ===
      "exact_grid_compatible" ||
    lineage.emptyToOriginalCompatibility.tier === "aspect_compatible_rescaled";
  const realized = realizeFrozenRoomBoundaryCamera(input.camera);
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: input.originalIdentity.sha256,
      decodedWidth: input.originalIdentity.decodedWidth,
      decodedHeight: input.originalIdentity.decodedHeight,
      orientation: input.originalIdentity.orientation,
    },
    {
      fingerprint: input.emptyIdentity.sha256,
      decodedWidth: input.emptyIdentity.decodedWidth,
      decodedHeight: input.emptyIdentity.decodedHeight,
      orientation: input.emptyIdentity.orientation,
    },
  );
  const identities = {
    emptyIntrinsicSize: {
      width: input.emptyIdentity.decodedWidth,
      height: input.emptyIdentity.decodedHeight,
    },
    originalIntrinsicSize: {
      width: input.originalIdentity.decodedWidth,
      height: input.originalIdentity.decodedHeight,
    },
    compatibility,
  };

  let skippedNonFloorWall = 0;
  const evaluated: RoomBoundaryCandidate[] = [];
  for (const seam of input.observation.observedSeams) {
    if (seam.category !== "floor_wall") {
      skippedNonFloorWall += 1;
      continue;
    }
    evaluated.push(qualifySeam({
      seam,
      planes: input.observation.observedPlanes,
      identities,
      frame: input.camera.frame,
      camera: realized,
      compatibilityOk,
    }));
  }

  const provisionallyAccepted = evaluated.filter(
    (candidate) => candidate.status === "accepted" && candidate.worldGeometry,
  );
  const demote = new Set<string>();
  for (let first = 0; first < provisionallyAccepted.length; first += 1) {
    for (let second = first + 1; second < provisionallyAccepted.length; second += 1) {
      const left = provisionallyAccepted[first];
      const right = provisionallyAccepted[second];
      if (
        left.worldGeometry &&
        right.worldGeometry &&
        competingSameWall(left.worldGeometry, right.worldGeometry)
      ) {
        demote.add(left.id);
        demote.add(right.id);
      }
    }
  }

  const afterCompetition = evaluated.map((candidate) => {
    if (!demote.has(candidate.id) || !candidate.worldGeometry) return candidate;
    return Object.freeze({
      ...candidate,
      status: "ambiguous" as const,
      authority: NO_AUTHORITY,
      interior: EMPTY_INTERIOR,
      reasons: Object.freeze([
        ...candidate.reasons,
        "competing_same_wall_trace",
      ]),
    });
  });

  const withInterior = afterCompetition.map((candidate) => {
    if (candidate.status !== "accepted" || !realized.ok) return candidate;
    return attachInterior(
      candidate,
      input.observation!.observedPlanes,
      input.camera,
      (point) =>
        projectEmptySourceNormalizedToWorld(
          point,
          identities,
          input.camera.frame,
          realized.camera,
        ),
    );
  });

  const summary = Object.freeze({
    accepted: withInterior.filter((candidate) => candidate.status === "accepted").length,
    ambiguous: withInterior.filter((candidate) => candidate.status === "ambiguous").length,
    insufficient: withInterior.filter((candidate) => candidate.status === "insufficient").length,
    rejected: withInterior.filter((candidate) => candidate.status === "rejected").length,
    skippedNonFloorWall,
    candidateCount: withInterior.length,
  });

  const constructionReasons: string[] = [];
  if (!compatibilityOk) constructionReasons.push("empty_original_incompatible");
  if (!realized.ok) {
    constructionReasons.push(`camera_realization_failed:${realized.reason}`);
  }
  if (summary.accepted === 0) {
    constructionReasons.push("zero_accepted_room_boundaries");
  }

  return freezeRoomBoundaryAuthorityReceipt({
    schemaVersion: AFC_V2_ROOM_BOUNDARY_AUTHORITY_VERSION,
    coordinateSpace: AFC_V2_ROOM_BOUNDARY_COORDINATE_SPACE,
    authority: "partial_room_boundary_authority",
    boundaryKind: AFC_V2_ROOM_BOUNDARY_KIND,
    lineage,
    candidates: Object.freeze(withInterior),
    summary,
    geometryManufactured: false,
    collisionAuthority: false,
    constructionReasons: Object.freeze(constructionReasons),
  });
}
