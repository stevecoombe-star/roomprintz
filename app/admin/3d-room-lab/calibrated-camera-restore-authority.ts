import type { CalibrationImageBasis } from "./calibration-image-basis";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_POSE_COMPONENT_TOLERANCE,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
  buildExactSourceFloorPolygonKey,
  type AuthorityFloorMapping,
  type AuthorityFloorPoint,
  type AuthorityFrameSize,
  type ParsedCalibratedCameraAppliedAuthority,
} from "./calibrated-camera-applied-authority";
import {
  floorVec3ToPlane2D,
  getFloorRectCorners,
  projectFloorPointThroughPose,
  type CameraPose,
} from "./perspective-solve";

export * from "./calibrated-camera-applied-authority";

export const CALIBRATED_CAMERA_IDENTITY_EQUIVALENCE_VERSION =
  "calibrated-camera-identity-equivalence/v1" as const;
export const IDENTITY_EQUIVALENCE_MAX_CORNER_DELTA_PX = 0.01;
export const IDENTITY_EQUIVALENCE_MAX_COMPONENT_DELTA =
  CALIBRATED_CAMERA_AUTHORITY_POSE_COMPONENT_TOLERANCE;

declare const restorableIdentityBrand: unique symbol;
export type RestorableCameraIdentity = {
  readonly appliedAtIso: string;
  readonly receipt: {
    readonly authorityVersion: typeof CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION;
    readonly equivalencePolicyVersion: typeof CALIBRATED_CAMERA_IDENTITY_EQUIVALENCE_VERSION;
    readonly maxCornerDeltaPx: number;
    readonly sourceFloorPolygonKey: string;
    readonly frameSize: AuthorityFrameSize;
    readonly basisId: string;
    readonly basisFingerprint: string;
  };
  readonly [restorableIdentityBrand]: true;
};

export type CameraIdentityMode =
  | { kind: "new_apply" }
  | {
      kind: "restore_existing_identity";
      identity: RestorableCameraIdentity;
    };

export type CameraIdentityRestoreFailureReason =
  | "authority-version"
  | "calibration-version"
  | "solver-version"
  | "image-basis"
  | "frame-width"
  | "frame-height"
  | "source-floor-polygon"
  | "floor-world-width"
  | "floor-world-depth"
  | "vertical-fov"
  | "pose-component-delta"
  | "projection-invalid"
  | "projection-delta";

export type CameraIdentityRestoreEvaluation =
  | { ok: true; identity: RestorableCameraIdentity }
  | { ok: false; reason: CameraIdentityRestoreFailureReason };

function imageBasesEqual(
  left: CalibrationImageBasis,
  right: CalibrationImageBasis
): boolean {
  return (
    left.basisId === right.basisId &&
    left.basisFingerprint === right.basisFingerprint &&
    left.sourceImageUrl === right.sourceImageUrl &&
    left.decodedWidth === right.decodedWidth &&
    left.decodedHeight === right.decodedHeight &&
    left.encodedOrientation === right.encodedOrientation &&
    left.decodedOrientationNormal === right.decodedOrientationNormal &&
    left.orientationTransform === right.orientationTransform &&
    left.dimensionSource === right.dimensionSource &&
    left.coordinateSpaceVersion.decoderId ===
      right.coordinateSpaceVersion.decoderId &&
    left.coordinateSpaceVersion.normalizationPolicyVersion ===
      right.coordinateSpaceVersion.normalizationPolicyVersion &&
    left.coordinateSpaceVersion.orientationApplied ===
      right.coordinateSpaceVersion.orientationApplied &&
    left.basisKind === right.basisKind
  );
}

function floorPolygonsEqual(
  left: readonly AuthorityFloorPoint[],
  right: readonly AuthorityFloorPoint[]
): boolean {
  return (
    left.length === 4 &&
    right.length === 4 &&
    left.every(
      (point, index) =>
        point.x === right[index].x && point.y === right[index].y
    )
  );
}

function poseComponentsMatch(
  left: CameraPose,
  right: CameraPose
): boolean {
  const components = [
    left.position.x - right.position.x,
    left.position.y - right.position.y,
    left.position.z - right.position.z,
    left.lookAt.x - right.lookAt.x,
    left.lookAt.y - right.lookAt.y,
    left.lookAt.z - right.lookAt.z,
    left.up.x - right.up.x,
    left.up.y - right.up.y,
    left.up.z - right.up.z,
  ];
  return components.every(
    (delta) =>
      Number.isFinite(delta) &&
      Math.abs(delta) <= IDENTITY_EQUIVALENCE_MAX_COMPONENT_DELTA
  );
}

export function evaluateCalibratedCameraIdentityRestore(input: {
  authority: ParsedCalibratedCameraAppliedAuthority;
  currentImageBasis: CalibrationImageBasis;
  currentFrameSize: AuthorityFrameSize;
  currentSourceFloorPolygon: readonly AuthorityFloorPoint[];
  currentFloorMapping: AuthorityFloorMapping;
  currentFovDeg: number;
  freshCandidatePose: CameraPose;
  currentCalibrationVersion?: string;
  currentSolver?: string;
}): CameraIdentityRestoreEvaluation {
  const authority = input.authority;
  if (
    authority.authorityVersion !==
    CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION
  ) {
    return { ok: false, reason: "authority-version" };
  }
  if (
    (input.currentCalibrationVersion ??
      CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION) !==
    authority.calibrationVersion
  ) {
    return { ok: false, reason: "calibration-version" };
  }
  if (
    (input.currentSolver ?? CALIBRATED_CAMERA_AUTHORITY_SOLVER) !==
    authority.solver
  ) {
    return { ok: false, reason: "solver-version" };
  }
  if (!imageBasesEqual(authority.imageBasis, input.currentImageBasis)) {
    return { ok: false, reason: "image-basis" };
  }
  if (authority.frameSize.width !== input.currentFrameSize.width) {
    return { ok: false, reason: "frame-width" };
  }
  if (authority.frameSize.height !== input.currentFrameSize.height) {
    return { ok: false, reason: "frame-height" };
  }
  if (
    !floorPolygonsEqual(
      authority.sourceFloorPolygon,
      input.currentSourceFloorPolygon
    )
  ) {
    return { ok: false, reason: "source-floor-polygon" };
  }
  if (
    authority.floorMapping.worldWidth !==
    input.currentFloorMapping.worldWidth
  ) {
    return { ok: false, reason: "floor-world-width" };
  }
  if (
    authority.floorMapping.worldDepth !==
    input.currentFloorMapping.worldDepth
  ) {
    return { ok: false, reason: "floor-world-depth" };
  }
  if (authority.verticalFovDeg !== input.currentFovDeg) {
    return { ok: false, reason: "vertical-fov" };
  }
  if (!poseComponentsMatch(authority.pose, input.freshCandidatePose)) {
    return { ok: false, reason: "pose-component-delta" };
  }

  const corners = getFloorRectCorners({
    widthMeters: authority.floorMapping.worldWidth,
    depthMeters: authority.floorMapping.worldDepth,
  });
  if (!corners.ok) return { ok: false, reason: "projection-invalid" };
  let maxCornerDeltaPx = 0;
  for (const worldCorner of corners.value.asArray) {
    const floorCorner = floorVec3ToPlane2D(worldCorner);
    const persistedProjection = projectFloorPointThroughPose(
      authority.pose,
      authority.frameSize,
      { verticalFovDeg: authority.verticalFovDeg },
      floorCorner
    );
    const freshProjection = projectFloorPointThroughPose(
      input.freshCandidatePose,
      input.currentFrameSize,
      { verticalFovDeg: input.currentFovDeg },
      floorCorner
    );
    if (!persistedProjection.ok || !freshProjection.ok) {
      return { ok: false, reason: "projection-invalid" };
    }
    const delta = Math.hypot(
      persistedProjection.value.x - freshProjection.value.x,
      persistedProjection.value.y - freshProjection.value.y
    );
    if (!Number.isFinite(delta)) {
      return { ok: false, reason: "projection-invalid" };
    }
    maxCornerDeltaPx = Math.max(maxCornerDeltaPx, delta);
  }
  if (
    maxCornerDeltaPx >
    IDENTITY_EQUIVALENCE_MAX_CORNER_DELTA_PX
  ) {
    return { ok: false, reason: "projection-delta" };
  }
  return {
    ok: true,
    identity: {
      appliedAtIso: authority.appliedAtIso,
      receipt: {
        authorityVersion:
          CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
        equivalencePolicyVersion:
          CALIBRATED_CAMERA_IDENTITY_EQUIVALENCE_VERSION,
        maxCornerDeltaPx,
        sourceFloorPolygonKey: buildExactSourceFloorPolygonKey(
          authority.sourceFloorPolygon
        ),
        frameSize: { ...authority.frameSize },
        basisId: authority.imageBasis.basisId,
        basisFingerprint: authority.imageBasis.basisFingerprint,
      },
    } as RestorableCameraIdentity,
  };
}

export function selectAppliedAtIso(
  identityMode: CameraIdentityMode,
  nowIso: string
): string {
  return identityMode.kind === "restore_existing_identity"
    ? identityMode.identity.appliedAtIso
    : nowIso;
}
