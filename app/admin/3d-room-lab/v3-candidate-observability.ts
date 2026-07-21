/**
 * Pure, read-only adapter from active calibrated-camera/v2 authority and
 * Package 1 runtime evidence into the Package 2A candidate experiment.
 */

import type { CalibrationImageBasis } from "./calibration-image-basis";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
} from "./calibrated-camera-restore-authority";
import { buildFloorPolygonAuthorityKey } from "./policy-a-containment";
import type { CameraPose } from "./perspective-solve";
import {
  solveV3Candidate,
  type V3ActiveV2Snapshot,
  type V3CandidateObservation,
  type V3Matrix3,
  type V3Result,
  type V3Vec2,
  type V3Vec3,
} from "./v3-candidate-solver";
import type { VerticalEvidenceCollectionRuntime } from "./vertical-evidence";

export type V3CandidateUnavailableReason =
  | "calibrated_camera_inactive"
  | "calibrated_camera_snapshot_unavailable"
  | "image_basis_unqualified"
  | "floor_polygon_mismatch"
  | "floor_mapping_invalid"
  | "camera_pose_invalid";

/**
 * The active v2 snapshot is deliberately structural here because the room-lab
 * keeps this ephemeral UI state local to ThreeRoomLab.
 */
export type V3CandidateCalibratedCameraSnapshot = Readonly<{
  pose: CameraPose;
  fovDeg: number;
  frameSize: Readonly<{ width: number; height: number }>;
  diagnosticsSummary: string;
  appliedAtIso: string;
  imageBasis: CalibrationImageBasis;
  sourceFloorPolygon: readonly V3Vec2[];
}>;

export type V3CandidateObservabilityInput = Readonly<{
  isCalibratedCameraActive: boolean;
  calibratedCameraSnapshot: V3CandidateCalibratedCameraSnapshot | null;
  qualifiedImageBasis: CalibrationImageBasis | null;
  sourceNormalizedFloorPolygon: readonly V3Vec2[];
  floorMapping: Readonly<{ worldWidth: number; worldDepth: number }>;
  verticalEvidenceRuntimeObservations: VerticalEvidenceCollectionRuntime;
}>;

export type V3CandidateEvaluation =
  | Readonly<{
      kind: "unavailable";
      reason: V3CandidateUnavailableReason;
      detail: string | null;
    }>
  | Readonly<{
      kind: "evaluated";
      provenance: Readonly<{
        cameraAppliedAtIso: string;
        calibrationVersion: string;
        imageBasisId: string;
        imageBasisFingerprint: string;
        floorPolygonKey: string;
        observationCounts: Readonly<{
          persisted: number;
          selected: number;
          current: number;
          eligible: number;
        }>;
      }>;
      result: V3Result;
    }>;

const POSE_EPSILON = 1e-9;

function unavailable(reason: V3CandidateUnavailableReason, detail: string | null): V3CandidateEvaluation {
  return Object.freeze({ kind: "unavailable" as const, reason, detail });
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finitePositive(value: number): boolean {
  return finite(value) && value > 0;
}

function finiteVector(value: V3Vec3): boolean {
  return finite(value.x) && finite(value.y) && finite(value.z);
}

function subtract(left: V3Vec3, right: V3Vec3): V3Vec3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function cross(left: V3Vec3, right: V3Vec3): V3Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalize(value: V3Vec3): V3Vec3 | null {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!finite(length) || length <= POSE_EPSILON) return null;
  const normalized = { x: value.x / length, y: value.y / length, z: value.z / length };
  return finiteVector(normalized) ? normalized : null;
}

/**
 * Reconstructs the v2 production CV basis from its retained pose without
 * constructing a renderer camera: CV is +X right, +Y down, +Z forward.
 */
function poseToWorldToCameraCv(pose: CameraPose): V3Matrix3 | null {
  if (!finiteVector(pose.position) || !finiteVector(pose.lookAt) || !finiteVector(pose.up)) return null;
  const zAxis = normalize(subtract(pose.position, pose.lookAt));
  if (!zAxis) return null;
  const xAxis = normalize(cross(pose.up, zAxis));
  if (!xAxis) return null;
  const yAxis = cross(zAxis, xAxis);
  if (!finiteVector(yAxis)) return null;
  const matrix: V3Matrix3 = [
    xAxis.x, xAxis.y, xAxis.z,
    -yAxis.x, -yAxis.y, -yAxis.z,
    -zAxis.x, -zAxis.y, -zAxis.z,
  ];
  return matrix.every(Number.isFinite) ? matrix : null;
}

/**
 * Mirrors the active room-lab floor-authority gate's normalized-coordinate
 * tolerance rather than introducing a stricter equality rule.
 */
function floorPolygonsEqual(left: readonly V3Vec2[], right: readonly V3Vec2[]): boolean {
  return left.length === right.length && left.every((point, index) =>
    Math.abs(point.x - right[index].x) <= 1e-6 && Math.abs(point.y - right[index].y) <= 1e-6
  );
}

function imageBasesEqual(left: CalibrationImageBasis, right: CalibrationImageBasis): boolean {
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
    left.coordinateSpaceVersion.decoderId === right.coordinateSpaceVersion.decoderId &&
    left.coordinateSpaceVersion.normalizationPolicyVersion === right.coordinateSpaceVersion.normalizationPolicyVersion &&
    left.coordinateSpaceVersion.orientationApplied === right.coordinateSpaceVersion.orientationApplied &&
    left.basisKind === right.basisKind
  );
}

function validImageBasis(basis: CalibrationImageBasis): boolean {
  return (
    basis.basisId.length > 0 &&
    basis.basisFingerprint.length > 0 &&
    finitePositive(basis.decodedWidth) &&
    finitePositive(basis.decodedHeight)
  );
}

function observationFromRuntime(
  runtime: VerticalEvidenceCollectionRuntime["observations"][number]
): V3CandidateObservation {
  const observation = runtime.observation;
  return Object.freeze({
    observationId: observation.observationId,
    physicalVerticalId: observation.physicalVerticalId,
    imageBasisId: observation.imageBasisId,
    imageBasisFingerprint: observation.imageBasisFingerprint,
    intrinsicWidth: observation.intrinsicWidth,
    intrinsicHeight: observation.intrinsicHeight,
    sourceNormalizedEndpoints: Object.freeze({
      lower: Object.freeze({ ...observation.sourceNormalizedEndpoints.lower }),
      upper: Object.freeze({ ...observation.sourceNormalizedEndpoints.upper }),
    }),
    frozenWorldAnchor: Object.freeze({ ...observation.frozenWorldAnchor }),
    wallPolygonKey: observation.wallPolygonKey,
    frozenAnchorDerivationId: observation.frozenAnchorDerivationId,
    evidenceModelVersion: observation.evidenceModelVersion,
    suggestionGeneratorVersion: observation.suggestionGeneratorVersion,
    operatorDecision: observation.operatorDecision,
    decisionAtIso: observation.decisionAtIso,
    current: runtime.usability === "current",
    eligible: runtime.eligible,
  });
}

function freezeResult(result: V3Result): V3Result {
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  };
  freeze(result);
  return result;
}

export function evaluateV3CandidateObservability(input: V3CandidateObservabilityInput): V3CandidateEvaluation {
  if (!input.isCalibratedCameraActive) {
    return unavailable("calibrated_camera_inactive", "The calibrated-camera/v2 authority is not active.");
  }
  const snapshot = input.calibratedCameraSnapshot;
  if (!snapshot) {
    return unavailable("calibrated_camera_snapshot_unavailable", "The active calibrated-camera/v2 snapshot is unavailable.");
  }
  if (
    !finitePositive(snapshot.fovDeg) ||
    !finitePositive(snapshot.frameSize.width) ||
    !finitePositive(snapshot.frameSize.height) ||
    !snapshot.appliedAtIso
  ) {
    return unavailable("calibrated_camera_snapshot_unavailable", "The active calibrated-camera/v2 snapshot has invalid solver inputs.");
  }
  if (!input.qualifiedImageBasis || !validImageBasis(input.qualifiedImageBasis)) {
    return unavailable("image_basis_unqualified", "No qualified image basis is available.");
  }
  if (!validImageBasis(snapshot.imageBasis) || !imageBasesEqual(snapshot.imageBasis, input.qualifiedImageBasis)) {
    return unavailable("image_basis_unqualified", "The qualified image basis does not match the active calibrated-camera/v2 snapshot.");
  }
  if (!floorPolygonsEqual(snapshot.sourceFloorPolygon, input.sourceNormalizedFloorPolygon)) {
    return unavailable("floor_polygon_mismatch", "The source-normalized Floor polygon does not match the active calibrated-camera/v2 snapshot.");
  }
  if (!finitePositive(input.floorMapping.worldWidth) || !finitePositive(input.floorMapping.worldDepth)) {
    return unavailable("floor_mapping_invalid", "Floor world width and depth must be finite positive values.");
  }
  const worldToCameraCv = poseToWorldToCameraCv(snapshot.pose);
  if (!worldToCameraCv) {
    return unavailable("camera_pose_invalid", "The active calibrated-camera/v2 pose cannot form a finite non-degenerate CV basis.");
  }

  const activeV2: V3ActiveV2Snapshot = Object.freeze({
    authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
    appliedAtIso: snapshot.appliedAtIso,
    calibrationVersion: CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
    solverIdentifier: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
    frameSize: Object.freeze({ ...snapshot.frameSize }),
    imageBasis: Object.freeze({
      id: snapshot.imageBasis.basisId,
      fingerprint: snapshot.imageBasis.basisFingerprint,
      intrinsicWidth: snapshot.imageBasis.decodedWidth,
      intrinsicHeight: snapshot.imageBasis.decodedHeight,
    }),
    verticalFovDeg: snapshot.fovDeg,
    worldToCameraCv: Object.freeze([...worldToCameraCv]) as V3Matrix3,
    position: Object.freeze({ ...snapshot.pose.position }),
    sourceFloorPolygon: Object.freeze(snapshot.sourceFloorPolygon.map((point) => Object.freeze({ ...point }))),
    floor: Object.freeze({
      polygonKey: buildFloorPolygonAuthorityKey(snapshot.sourceFloorPolygon.map((point) => ({ ...point }))),
      worldWidth: input.floorMapping.worldWidth,
      worldDepth: input.floorMapping.worldDepth,
    }),
  });
  const observations = Object.freeze(input.verticalEvidenceRuntimeObservations.observations.map(observationFromRuntime));
  const runtime = input.verticalEvidenceRuntimeObservations.observations;
  const result = freezeResult(solveV3Candidate({ activeV2, observations }));

  return Object.freeze({
    kind: "evaluated" as const,
    provenance: Object.freeze({
      cameraAppliedAtIso: snapshot.appliedAtIso,
      calibrationVersion: CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
      imageBasisId: snapshot.imageBasis.basisId,
      imageBasisFingerprint: snapshot.imageBasis.basisFingerprint,
      floorPolygonKey: activeV2.floor.polygonKey,
      observationCounts: Object.freeze({
        persisted: runtime.length,
        selected: runtime.filter(({ observation }) => observation.operatorDecision === "selected").length,
        current: runtime.filter(({ usability }) => usability === "current").length,
        eligible: runtime.filter(({ eligible }) => eligible).length,
      }),
    }),
    result,
  });
}
