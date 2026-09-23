import * as THREE from "three";
import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "./calibrated-camera-readonly-projection";
import { WALL_GEOMETRY_POLICY_VERSION, WALL_SUPPORT_LIMITS, type WallSupportKind } from "./wall-support-geometry";

export const PROJECTION_COHERENCE_DIAGNOSTICS_VERSION = "projection-coherence-diagnostics/v1";
const RAD_TO_DEG = 180 / Math.PI;
const FRAME_TOLERANCE_PX = 1e-3;

export type ProjectionCoherencePoint2 = Readonly<{ x: number; y: number }>;
export type ProjectionCoherencePoint3 = Readonly<{ x: number; y: number; z: number }>;
export type ProjectionCoherencePose = Readonly<{
  position: ProjectionCoherencePoint3;
  lookAt: ProjectionCoherencePoint3;
  up: ProjectionCoherencePoint3;
}>;
export type ProjectionCoherenceWallPolygon = readonly [
  ProjectionCoherencePoint2,
  ProjectionCoherencePoint2,
  ProjectionCoherencePoint2,
  ProjectionCoherencePoint2,
];

export type ProjectionCoherenceWallInput = Readonly<{
  kind: WallSupportKind;
  enabled: boolean;
  reviewState: string;
  confirmationCurrent: boolean;
  runtimeUsable: boolean;
  sourcePolygon: ProjectionCoherenceWallPolygon | null;
  derivation:
    | Readonly<{
        ok: true;
        boundaryUV: readonly ProjectionCoherencePoint2[];
        boundaryWorld: readonly ProjectionCoherencePoint3[];
        diagnostics: Readonly<{
          upperRayPlaneDenominatorStart: number;
          upperRayPlaneDenominatorEnd: number;
          minUpperRayPlaneDenominator: number;
          minUpperRayPlaneDenominatorThreshold: number;
          maxRoundTripReprojectionErrorPx: number;
          lowerSeamDisagreementStartWorld: number;
          lowerSeamDisagreementEndWorld: number;
        }>;
      }>
    | Readonly<{
        ok: false;
        reasons: readonly string[];
        diagnostics?: Readonly<Partial<{
          upperRayPlaneDenominatorStart: number;
          upperRayPlaneDenominatorEnd: number;
          minUpperRayPlaneDenominator: number;
          minUpperRayPlaneDenominatorThreshold: number;
          maxRoundTripReprojectionErrorPx: number;
          lowerSeamDisagreementStartWorld: number;
          lowerSeamDisagreementEndWorld: number;
        }>>;
      }>;
}>;

export type ProjectionCoherenceInput = Readonly<{
  camera: Readonly<{
    calibratedCameraVersion: string;
    appliedAtIso: string | null;
    fovDeg: number;
    pose: ProjectionCoherencePose;
  }> | null;
  frame: Readonly<{
    width: number;
    height: number;
    intrinsicWidth: number;
    intrinsicHeight: number;
    imageBasisId: string | null;
    imageBasisFingerprint: string | null;
  }> | null;
  floor: Readonly<{
    polygonKey: string | null;
    worldWidth: number;
    worldDepth: number;
  }>;
  walls: readonly ProjectionCoherenceWallInput[];
  attachment: Readonly<{
    current: boolean;
    supportKind: string;
    contactPointWorld: ProjectionCoherencePoint3 | null;
  }> | null;
  floorReprojection: Readonly<{
    cvAveragePx: number | null;
    cvMaximumPx: number | null;
    cvPerCornerPx: readonly (number | null)[] | null;
    rendererAveragePx: number | null;
    rendererMaximumPx: number | null;
    scaleRatio: number | null;
  }> | null;
}>;

export type DiagnosticAvailability<T> =
  | Readonly<{ state: "available"; value: T }>
  | Readonly<{ state: "unavailable"; reason: string }>
  | Readonly<{ state: "insufficient_evidence"; reason: string }>;

export type StructuralVerticalObservation = Readonly<{
  wallKind: WallSupportKind;
  sideIndex: 0 | 1;
  physicalVerticalId: "back_left" | "back_right" | "front_left" | "front_right";
  sourceNormalizedEndpoints: Readonly<{ lower: ProjectionCoherencePoint2; upper: ProjectionCoherencePoint2 }>;
  sourcePixelEndpoints: Readonly<{ lower: ProjectionCoherencePoint2; upper: ProjectionCoherencePoint2 }>;
  sourcePixelLength: number;
  observedTiltDeg: number | null;
  lowerWorldPoint: ProjectionCoherencePoint3;
  predictedWorldUpTiltDeg: number | null;
  locationMatchedResidualDeg: number | null;
  reviewState: string;
  runtimeUsable: boolean;
  confirmationCurrent: boolean;
  wallGeometryPolicyVersion: string;
  inclusion: "included" | "excluded";
  exclusionReason: string | null;
  frameTouching: boolean;
  frameCoincident: boolean;
}>;

export type RobustStructuralSummary = Readonly<{
  valueDeg: number;
  eligibleObservationCount: number;
  distinctPhysicalVerticalCount: number;
  totalWeight: number;
  minimumDeg: number;
  maximumDeg: number;
  rangeDeg: number;
  weightedMadDeg: number;
  leaveOneOutMinimumDeg: number | null;
  leaveOneOutMaximumDeg: number | null;
  leaveOneOutRangeDeg: number | null;
  tiePolicy: string;
}>;

export type ProjectionCoherenceResult = Readonly<{
  provenance: {
    diagnosticVersion: typeof PROJECTION_COHERENCE_DIAGNOSTICS_VERSION;
    calibratedCameraVersion: string | null;
    cameraAppliedAtIso: string | null;
    fovDeg: number | null;
    frameWidth: number | null;
    frameHeight: number | null;
    imageBasisId: string | null;
    imageBasisFingerprint: string | null;
    floorPolygonKey: string | null;
    floorWorldWidth: number | null;
    floorWorldDepth: number | null;
    wallGeometryPolicyVersion: string;
  };
  camera: {
    roll: DiagnosticAvailability<number>;
    yaw: DiagnosticAvailability<number>;
    normalizedLateralOffset: DiagnosticAvailability<number>;
  };
  anchorProjection: DiagnosticAvailability<{
    lowerPx: ProjectionCoherencePoint2;
    upperPx: ProjectionCoherencePoint2;
    tiltDeg: number;
    horizontalPixelsPerVerticalMetre: number;
    projectedPixelsPerVerticalMetre: number;
    bothInFront: boolean;
  }>;
  structural: {
    observations: readonly StructuralVerticalObservation[];
    rawObservedTilt: DiagnosticAvailability<RobustStructuralSummary>;
    locationMatchedResidual: DiagnosticAvailability<RobustStructuralSummary>;
    distinctPhysicalVerticalCount: number;
  };
  comparison: {
    signedCameraRollDeg: number | null;
    rawStructuralTiltDeg: number | null;
    signedRawDisagreementDeg: number | null;
    absoluteRawDisagreementDeg: number | null;
    locationMatchedResidualDeg: number | null;
    structuralDispersionDeg: number | null;
    leaveOneOutSensitivityDeg: number | null;
    unavailableReason: string | null;
  };
  walls: readonly (Readonly<{
    kind: WallSupportKind;
    reviewState: string;
    confirmationCurrent: boolean;
    runtimeUsable: boolean;
    derivation: "accepted" | "refused";
    refusalReasons: readonly string[];
    endpoint1LateralDriftM: number | null;
    endpoint2LateralDriftM: number | null;
    endpoint1HeightM: number | null;
    endpoint2HeightM: number | null;
    endpoint1LeanDeg: number | null;
    endpoint2LeanDeg: number | null;
    endpoint1UpperRayPlaneDenominator: number | null;
    endpoint2UpperRayPlaneDenominator: number | null;
    minimumUpperRayPlaneDenominator: number | null;
    refusalFloor: number;
    conditioningMargin: number | null;
    conditioningMultiple: number | null;
    maximumReprojectionResidualPx: number | null;
    lowerSeamDisagreementEndpoint1M: number | null;
    lowerSeamDisagreementEndpoint2M: number | null;
  }>)[];
  floorReprojection: DiagnosticAvailability<{
    cvAveragePx: number | null;
    cvMaximumPx: number | null;
    cvPerCornerPx: readonly (number | null)[];
    rendererAveragePx: number | null;
    rendererMaximumPx: number | null;
    cvVsRendererAverageDifferencePx: number | null;
    cvVsRendererMaximumDifferencePx: number | null;
    scaleRatio: number | null;
  }>;
}>;

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePoint3(value: ProjectionCoherencePoint3 | null | undefined): value is ProjectionCoherencePoint3 {
  return !!value && finite(value.x) && finite(value.y) && finite(value.z);
}

function unavailable<T>(reason: string): DiagnosticAvailability<T> {
  return { state: "unavailable", reason };
}

function insufficient<T>(reason: string): DiagnosticAvailability<T> {
  return { state: "insufficient_evidence", reason };
}

function projectedPoint(
  camera: THREE.PerspectiveCamera,
  frame: NonNullable<ProjectionCoherenceInput["frame"]>,
  point: ProjectionCoherencePoint3
): { px: ProjectionCoherencePoint2; inFront: boolean } | null {
  if (!finitePoint3(point)) return null;
  camera.updateMatrixWorld(true);
  const world = new THREE.Vector3(point.x, point.y, point.z);
  const cameraPoint = world.clone().applyMatrix4(camera.matrixWorldInverse);
  const ndc = world.project(camera);
  if (!finite(ndc.x) || !finite(ndc.y) || !finite(ndc.z)) return null;
  return {
    px: { x: (ndc.x + 1) * frame.width / 2, y: (1 - ndc.y) * frame.height / 2 },
    inFront: cameraPoint.z < 0,
  };
}

/** Positive means the upper endpoint lies to image-right of the lower endpoint. */
export function signedTiltFromImageVerticalDeg(lower: ProjectionCoherencePoint2, upper: ProjectionCoherencePoint2): number | null {
  if (![lower.x, lower.y, upper.x, upper.y].every(finite)) return null;
  const result = Math.atan2(upper.x - lower.x, lower.y - upper.y) * RAD_TO_DEG;
  return finite(result) ? result : null;
}

export function weightedMedian(values: readonly Readonly<{ value: number; weight: number }>[]): number | null {
  const valid = values.filter((entry) => finite(entry.value) && finite(entry.weight) && entry.weight > 0)
    .sort((left, right) => left.value - right.value || left.weight - right.weight);
  const total = valid.reduce((sum, entry) => sum + entry.weight, 0);
  if (!valid.length || !finite(total) || total <= 0) return null;
  // Deterministic lower-bound policy: return the first ordered value where cumulative weight reaches half.
  let cumulative = 0;
  for (const entry of valid) {
    cumulative += entry.weight;
    if (cumulative >= total / 2) return entry.value;
  }
  return valid[valid.length - 1].value;
}

export function weightedMedianAbsoluteDeviation(
  values: readonly (Readonly<{ value: number; weight: number }>)[],
  centre: number
): number | null {
  if (!finite(centre)) return null;
  return weightedMedian(values.map((entry) => ({ value: Math.abs(entry.value - centre), weight: entry.weight })));
}

function summary(
  values: readonly (Readonly<{ value: number; weight: number; physicalVerticalId: string }>)[]
): DiagnosticAvailability<RobustStructuralSummary> {
  const valid = values.filter((entry) => finite(entry.value) && finite(entry.weight) && entry.weight > 0);
  if (!valid.length) return insufficient("no eligible structural observations");
  const median = weightedMedian(valid);
  if (median === null) return insufficient("eligible structural observations have no positive finite weight");
  const loo = valid.length > 1
    ? valid.map((_, index) => weightedMedian(valid.filter((__, other) => other !== index))).filter((value): value is number => value !== null)
    : [];
  const minimum = Math.min(...valid.map((entry) => entry.value));
  const maximum = Math.max(...valid.map((entry) => entry.value));
  const totalWeight = valid.reduce((sum, entry) => sum + entry.weight, 0);
  return {
    state: "available",
    value: {
      valueDeg: median,
      eligibleObservationCount: valid.length,
      distinctPhysicalVerticalCount: new Set(valid.map((entry) => entry.physicalVerticalId)).size,
      totalWeight,
      minimumDeg: minimum,
      maximumDeg: maximum,
      rangeDeg: maximum - minimum,
      weightedMadDeg: weightedMedianAbsoluteDeviation(valid, median) ?? 0,
      leaveOneOutMinimumDeg: loo.length ? Math.min(...loo) : null,
      leaveOneOutMaximumDeg: loo.length ? Math.max(...loo) : null,
      leaveOneOutRangeDeg: loo.length ? Math.max(...loo) - Math.min(...loo) : null,
      tiePolicy: "first ordered value whose cumulative positive weight reaches 50%",
    },
  };
}

function physicalVerticalId(kind: WallSupportKind, side: 0 | 1): StructuralVerticalObservation["physicalVerticalId"] {
  const ids: Record<WallSupportKind, readonly StructuralVerticalObservation["physicalVerticalId"][]> = {
    wall_back: ["back_left", "back_right"],
    wall_left: ["front_left", "back_left"],
    wall_right: ["back_right", "front_right"],
  };
  return ids[kind][side];
}

function sourcePixels(point: ProjectionCoherencePoint2, frame: NonNullable<ProjectionCoherenceInput["frame"]>): ProjectionCoherencePoint2 {
  return { x: point.x * frame.intrinsicWidth, y: point.y * frame.intrinsicHeight };
}

function touchesFrame(point: ProjectionCoherencePoint2, frame: NonNullable<ProjectionCoherenceInput["frame"]>): boolean {
  return Math.abs(point.x) <= FRAME_TOLERANCE_PX ||
    Math.abs(point.y) <= FRAME_TOLERANCE_PX ||
    Math.abs(point.x - frame.intrinsicWidth) <= FRAME_TOLERANCE_PX ||
    Math.abs(point.y - frame.intrinsicHeight) <= FRAME_TOLERANCE_PX;
}

function boundaryOf(point: ProjectionCoherencePoint2, frame: NonNullable<ProjectionCoherenceInput["frame"]>): "left" | "right" | "top" | "bottom" | null {
  if (Math.abs(point.x) <= FRAME_TOLERANCE_PX) return "left";
  if (Math.abs(point.x - frame.intrinsicWidth) <= FRAME_TOLERANCE_PX) return "right";
  if (Math.abs(point.y) <= FRAME_TOLERANCE_PX) return "top";
  if (Math.abs(point.y - frame.intrinsicHeight) <= FRAME_TOLERANCE_PX) return "bottom";
  return null;
}

/** Uses the existing structural-observation frame exclusion semantics. */
export function isFrameCoincidentStructuralEdge(
  lower: ProjectionCoherencePoint2,
  upper: ProjectionCoherencePoint2,
  frame: Pick<NonNullable<ProjectionCoherenceInput["frame"]>, "intrinsicWidth" | "intrinsicHeight">
): boolean {
  if (
    !finite(lower.x) ||
    !finite(lower.y) ||
    !finite(upper.x) ||
    !finite(upper.y) ||
    !finite(frame.intrinsicWidth) ||
    !finite(frame.intrinsicHeight) ||
    frame.intrinsicWidth <= 0 ||
    frame.intrinsicHeight <= 0
  ) return false;
  const lowerPx = { x: lower.x * frame.intrinsicWidth, y: lower.y * frame.intrinsicHeight };
  const upperPx = { x: upper.x * frame.intrinsicWidth, y: upper.y * frame.intrinsicHeight };
  const lowerBoundary = boundaryOf(lowerPx, frame as NonNullable<ProjectionCoherenceInput["frame"]>);
  return !!lowerBoundary && lowerBoundary === boundaryOf(upperPx, frame as NonNullable<ProjectionCoherenceInput["frame"]>);
}

function buildCamera(input: ProjectionCoherenceInput): THREE.PerspectiveCamera | null {
  if (!input.camera || !input.frame) return null;
  const result = buildCalibratedReadOnlyProjectionCamera({
    fovDeg: input.camera.fovDeg,
    pose: input.camera.pose,
    frameSize: { width: input.frame.width, height: input.frame.height },
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  });
  return result.ok ? result.camera : null;
}

function cameraRoll(camera: THREE.PerspectiveCamera, frame: NonNullable<ProjectionCoherenceInput["frame"]>): number | null {
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const lower = camera.position.clone().addScaledVector(forward, 5);
  const upper = lower.clone().add(new THREE.Vector3(0, 1, 0));
  const projectedLower = projectedPoint(camera, frame, lower);
  const projectedUpper = projectedPoint(camera, frame, upper);
  return projectedLower && projectedUpper ? signedTiltFromImageVerticalDeg(projectedLower.px, projectedUpper.px) : null;
}

function cameraYaw(pose: ProjectionCoherencePose): number | null {
  const forward = new THREE.Vector3(
    pose.lookAt.x - pose.position.x,
    pose.lookAt.y - pose.position.y,
    pose.lookAt.z - pose.position.z
  );
  if (!finite(forward.length()) || forward.length() <= 1e-9) return null;
  forward.normalize();
  const result = Math.atan2(forward.x, -forward.z) * RAD_TO_DEG;
  return finite(result) ? result : null;
}

export function computeProjectionCoherenceDiagnostics(input: ProjectionCoherenceInput): ProjectionCoherenceResult {
  const camera = buildCamera(input);
  const frame = input.frame;
  const roll = camera && frame ? cameraRoll(camera, frame) : null;
  const yaw = input.camera ? cameraYaw(input.camera.pose) : null;
  const observations: StructuralVerticalObservation[] = [];

  if (camera && frame && finite(frame.intrinsicWidth) && frame.intrinsicWidth > 0 && finite(frame.intrinsicHeight) && frame.intrinsicHeight > 0) {
    for (const wall of input.walls) {
      if (!wall.enabled || !wall.sourcePolygon || !wall.derivation.ok) continue;
      for (const sideIndex of [0, 1] as const) {
        const lowerIndex = sideIndex === 0 ? 0 : 1;
        const upperIndex = sideIndex === 0 ? 3 : 2;
        const lower = wall.sourcePolygon[lowerIndex];
        const upper = wall.sourcePolygon[upperIndex];
        const lowerPx = sourcePixels(lower, frame);
        const upperPx = sourcePixels(upper, frame);
        const observedTiltDeg = signedTiltFromImageVerticalDeg(lowerPx, upperPx);
        const lowerWorldPoint = wall.derivation.boundaryWorld[lowerIndex];
        const projectedLower = projectedPoint(camera, frame, lowerWorldPoint);
        const projectedUpper = finitePoint3(lowerWorldPoint)
          ? projectedPoint(camera, frame, { ...lowerWorldPoint, y: lowerWorldPoint.y + 1 })
          : null;
        const predictedWorldUpTiltDeg = projectedLower && projectedUpper
          ? signedTiltFromImageVerticalDeg(projectedLower.px, projectedUpper.px)
          : null;
        const frameTouching = touchesFrame(lowerPx, frame) || touchesFrame(upperPx, frame);
        const frameCoincident = isFrameCoincidentStructuralEdge(lower, upper, frame);
        const exclusionReason =
          wall.reviewState !== "manually_confirmed" ? "not_manually_confirmed" :
          !wall.confirmationCurrent ? "confirmation_not_current" :
          !wall.runtimeUsable ? "support_not_runtime_usable" :
          !finite(observedTiltDeg) || !finite(predictedWorldUpTiltDeg) ? "projection_unavailable" :
          frameCoincident ? "frame_coincident_edge" : null;
        observations.push({
          wallKind: wall.kind,
          sideIndex,
          physicalVerticalId: physicalVerticalId(wall.kind, sideIndex),
          sourceNormalizedEndpoints: { lower: { ...lower }, upper: { ...upper } },
          sourcePixelEndpoints: { lower: lowerPx, upper: upperPx },
          sourcePixelLength: Math.hypot(upperPx.x - lowerPx.x, upperPx.y - lowerPx.y),
          observedTiltDeg: finite(observedTiltDeg) ? observedTiltDeg : null,
          lowerWorldPoint: lowerWorldPoint ? { ...lowerWorldPoint } : { x: 0, y: 0, z: 0 },
          predictedWorldUpTiltDeg,
          locationMatchedResidualDeg: finite(observedTiltDeg) && finite(predictedWorldUpTiltDeg)
            ? observedTiltDeg - predictedWorldUpTiltDeg
            : null,
          reviewState: wall.reviewState,
          runtimeUsable: wall.runtimeUsable,
          confirmationCurrent: wall.confirmationCurrent,
          wallGeometryPolicyVersion: WALL_GEOMETRY_POLICY_VERSION,
          inclusion: exclusionReason ? "excluded" : "included",
          exclusionReason,
          frameTouching,
          frameCoincident,
        });
      }
    }
  }

  const included = observations.filter((observation) => observation.inclusion === "included");
  const raw = summary(included
    .filter((observation) => finite(observation.observedTiltDeg))
    .map((observation) => ({
      value: observation.observedTiltDeg!,
      weight: observation.sourcePixelLength,
      physicalVerticalId: observation.physicalVerticalId,
    })));
  const residual = summary(included
    .filter((observation) => finite(observation.locationMatchedResidualDeg))
    .map((observation) => ({
      value: observation.locationMatchedResidualDeg!,
      weight: observation.sourcePixelLength,
      physicalVerticalId: observation.physicalVerticalId,
    })));
  type AnchorValue = Extract<ProjectionCoherenceResult["anchorProjection"], { state: "available" }>["value"];
  const anchorProjection: DiagnosticAvailability<AnchorValue> = !input.attachment
    ? unavailable<AnchorValue>("no current attachment")
    : !input.attachment.current || input.attachment.supportKind !== "floor"
      ? unavailable<AnchorValue>("no current Floor attachment")
      : !camera || !frame || !finitePoint3(input.attachment.contactPointWorld)
        ? unavailable<AnchorValue>("camera, frame, or attachment anchor unavailable")
        : (() => {
            const lower = projectedPoint(camera, frame, input.attachment!.contactPointWorld!);
            const upper = projectedPoint(camera, frame, {
              ...input.attachment!.contactPointWorld!,
              y: input.attachment!.contactPointWorld!.y + 1,
            });
            const tiltDeg = lower && upper ? signedTiltFromImageVerticalDeg(lower.px, upper.px) : null;
            if (!lower || !upper || !finite(tiltDeg)) return unavailable("attachment anchor projection unavailable");
            return {
              state: "available" as const,
              value: {
                lowerPx: lower.px,
                upperPx: upper.px,
                tiltDeg,
                horizontalPixelsPerVerticalMetre: upper.px.x - lower.px.x,
                projectedPixelsPerVerticalMetre: Math.hypot(upper.px.x - lower.px.x, upper.px.y - lower.px.y),
                bothInFront: lower.inFront && upper.inFront,
              },
            };
          })();
  const walls = input.walls.map((wall) => {
    const diagnostics = wall.derivation.diagnostics;
    const uv = wall.derivation.ok ? wall.derivation.boundaryUV : null;
    const drift1 = uv && uv.length >= 4 ? uv[3].x - uv[0].x : null;
    const drift2 = uv && uv.length >= 4 ? uv[2].x - uv[1].x : null;
    const height1 = uv && uv.length >= 4 ? uv[3].y - uv[0].y : null;
    const height2 = uv && uv.length >= 4 ? uv[2].y - uv[1].y : null;
    const min = finite(diagnostics?.minUpperRayPlaneDenominator) ? diagnostics.minUpperRayPlaneDenominator : null;
    return {
      kind: wall.kind,
      reviewState: wall.reviewState,
      confirmationCurrent: wall.confirmationCurrent,
      runtimeUsable: wall.runtimeUsable,
      derivation: wall.derivation.ok ? "accepted" as const : "refused" as const,
      refusalReasons: wall.derivation.ok ? [] : [...wall.derivation.reasons],
      endpoint1LateralDriftM: finite(drift1) ? drift1 : null,
      endpoint2LateralDriftM: finite(drift2) ? drift2 : null,
      endpoint1HeightM: finite(height1) ? height1 : null,
      endpoint2HeightM: finite(height2) ? height2 : null,
      endpoint1LeanDeg: finite(drift1) && finite(height1) ? Math.atan2(drift1, height1) * RAD_TO_DEG : null,
      endpoint2LeanDeg: finite(drift2) && finite(height2) ? Math.atan2(drift2, height2) * RAD_TO_DEG : null,
      endpoint1UpperRayPlaneDenominator: finite(diagnostics?.upperRayPlaneDenominatorStart) ? diagnostics.upperRayPlaneDenominatorStart : null,
      endpoint2UpperRayPlaneDenominator: finite(diagnostics?.upperRayPlaneDenominatorEnd) ? diagnostics.upperRayPlaneDenominatorEnd : null,
      minimumUpperRayPlaneDenominator: min,
      refusalFloor: WALL_SUPPORT_LIMITS.minUpperRayPlaneDenominator,
      conditioningMargin: min === null ? null : min - WALL_SUPPORT_LIMITS.minUpperRayPlaneDenominator,
      conditioningMultiple: min === null ? null : min / WALL_SUPPORT_LIMITS.minUpperRayPlaneDenominator,
      maximumReprojectionResidualPx: finite(diagnostics?.maxRoundTripReprojectionErrorPx) ? diagnostics.maxRoundTripReprojectionErrorPx : null,
      lowerSeamDisagreementEndpoint1M: finite(diagnostics?.lowerSeamDisagreementStartWorld) ? diagnostics.lowerSeamDisagreementStartWorld : null,
      lowerSeamDisagreementEndpoint2M: finite(diagnostics?.lowerSeamDisagreementEndWorld) ? diagnostics.lowerSeamDisagreementEndWorld : null,
    };
  });
  const rawValue = raw.state === "available" ? raw.value : null;
  const residualValue = residual.state === "available" ? residual.value : null;
  return {
    provenance: {
      diagnosticVersion: PROJECTION_COHERENCE_DIAGNOSTICS_VERSION,
      calibratedCameraVersion: input.camera?.calibratedCameraVersion ?? null,
      cameraAppliedAtIso: input.camera?.appliedAtIso ?? null,
      fovDeg: input.camera && finite(input.camera.fovDeg) ? input.camera.fovDeg : null,
      frameWidth: frame && finite(frame.width) ? frame.width : null,
      frameHeight: frame && finite(frame.height) ? frame.height : null,
      imageBasisId: frame?.imageBasisId ?? null,
      imageBasisFingerprint: frame?.imageBasisFingerprint ?? null,
      floorPolygonKey: input.floor.polygonKey,
      floorWorldWidth: finite(input.floor.worldWidth) ? input.floor.worldWidth : null,
      floorWorldDepth: finite(input.floor.worldDepth) ? input.floor.worldDepth : null,
      wallGeometryPolicyVersion: WALL_GEOMETRY_POLICY_VERSION,
    },
    camera: {
      roll: roll === null ? unavailable("calibrated camera or frame unavailable") : { state: "available", value: roll },
      yaw: yaw === null ? unavailable("calibrated camera unavailable") : { state: "available", value: yaw },
      normalizedLateralOffset: !input.camera ? unavailable("calibrated camera unavailable") :
        !finite(input.floor.worldWidth) || input.floor.worldWidth <= 0 ? unavailable("Floor width must be positive and finite") :
        { state: "available", value: Math.abs(input.camera.pose.position.x) / (input.floor.worldWidth / 2) },
    },
    anchorProjection,
    structural: {
      observations,
      rawObservedTilt: raw,
      locationMatchedResidual: residual,
      distinctPhysicalVerticalCount: new Set(included.map((observation) => observation.physicalVerticalId)).size,
    },
    comparison: {
      signedCameraRollDeg: roll,
      rawStructuralTiltDeg: rawValue?.valueDeg ?? null,
      signedRawDisagreementDeg: roll !== null && rawValue ? roll - rawValue.valueDeg : null,
      absoluteRawDisagreementDeg: roll !== null && rawValue ? Math.abs(roll - rawValue.valueDeg) : null,
      locationMatchedResidualDeg: residualValue?.valueDeg ?? null,
      structuralDispersionDeg: residualValue?.weightedMadDeg ?? rawValue?.weightedMadDeg ?? null,
      leaveOneOutSensitivityDeg: residualValue?.leaveOneOutRangeDeg ?? rawValue?.leaveOneOutRangeDeg ?? null,
      unavailableReason: roll === null ? "camera roll unavailable" : rawValue && residualValue ? null : "structural evidence is insufficient",
    },
    walls,
    floorReprojection: input.floorReprojection
      ? {
          state: "available",
          value: {
            cvAveragePx: finite(input.floorReprojection.cvAveragePx) ? input.floorReprojection.cvAveragePx : null,
            cvMaximumPx: finite(input.floorReprojection.cvMaximumPx) ? input.floorReprojection.cvMaximumPx : null,
            cvPerCornerPx: (input.floorReprojection.cvPerCornerPx ?? []).map((value) => finite(value) ? value : null),
            rendererAveragePx: finite(input.floorReprojection.rendererAveragePx) ? input.floorReprojection.rendererAveragePx : null,
            rendererMaximumPx: finite(input.floorReprojection.rendererMaximumPx) ? input.floorReprojection.rendererMaximumPx : null,
            cvVsRendererAverageDifferencePx:
              finite(input.floorReprojection.cvAveragePx) && finite(input.floorReprojection.rendererAveragePx)
                ? input.floorReprojection.cvAveragePx - input.floorReprojection.rendererAveragePx
                : null,
            cvVsRendererMaximumDifferencePx:
              finite(input.floorReprojection.cvMaximumPx) && finite(input.floorReprojection.rendererMaximumPx)
                ? input.floorReprojection.cvMaximumPx - input.floorReprojection.rendererMaximumPx
                : null,
            scaleRatio: finite(input.floorReprojection.scaleRatio) ? input.floorReprojection.scaleRatio : null,
          },
        }
      : unavailable("Floor reprojection diagnostics unavailable"),
  };
}
