import type { CalibrationImageBasis } from "./calibration-image-basis";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
  type CalibratedCameraAppliedAuthority,
} from "./calibrated-camera-restore-authority";
import type { CeilingSupportDraft } from "./ceiling-support-geometry";
import type { ObjectSupportAttachment } from "./support-attachment";
import type { SupportReviewStatus, SupportSource } from "./support-model";
import type { VerticalEvidenceSection } from "./vertical-evidence";
import type { WallSupportDraft, WallSupportKind } from "./wall-support-geometry";
import {
  CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2,
  CALIBRATED_SCENE_STATE_MAX_VERTICAL_FOV_DEG,
  CALIBRATED_SCENE_STATE_MIN_VERTICAL_FOV_DEG,
  CALIBRATED_SCENE_STATE_SOLVER_V1,
  SCENE_IMAGE_COORDINATE_SPACE_V0,
  buildSceneStatePayload,
  type CalibratedSceneStateCalibrationV2,
  type FloorMappingState,
  type FloorPoint,
  type ModelNormalizationState,
  type PerspectiveDepthScalingState,
  type SceneStatePayloadBuildResult,
  type TransformState,
} from "./scene-state";

export type CurrentSceneCalibrationSnapshot = {
  pose: {
    position: { x: number; y: number; z: number };
    lookAt: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  };
  fovDeg: number;
  frameSize: { width: number; height: number };
  diagnosticsSummary: string;
  appliedAtIso: string;
  imageBasis: CalibrationImageBasis;
  sourceFloorPolygon: FloorPoint[];
};

/**
 * Explicit live-lab inputs for one scene-state document.
 * The assembler closes over none of these; callers pass the current values.
 */
export type CurrentSceneStateAssemblyInput = {
  exportedAtIso: string;
  roomImageUrl: string;
  imageIntrinsicSize: { width: number; height: number } | null;
  rendererSize: { width: number; height: number };
  calibratedCameraSnapshot: CurrentSceneCalibrationSnapshot | null;
  isCalibratedCameraActive: boolean;
  qualifiedImageBasis: CalibrationImageBasis | null;
  sourceNormalizedFloorPolygon: FloorPoint[];
  floorMapping: FloorMappingState;
  modelPath: string;
  activeObjectType: "glb" | "fallbackCube" | "none";
  modelLoadState: "idle" | "loading" | "loaded" | "fallback" | "error";
  modelLoadError: string | null;
  modelNormalization: ModelNormalizationState;
  transform: TransformState;
  autoRotateEnabled: boolean;
  floorPolygon: FloorPoint[];
  showFloorOverlay: boolean;
  isFloorClickPlacementEnabled: boolean;
  lastAcceptedFloorClick: FloorPoint | null;
  lastRejectedFloorClick: FloorPoint | null;
  perspectiveDepthScaling: PerspectiveDepthScalingState;
  floorSupportReviewStatus: SupportReviewStatus;
  floorSupportSource: SupportSource;
  floorSupportImageBasis: CalibrationImageBasis | null;
  floorPolygonAuthorityEligible: boolean;
  wallSupportDrafts: Record<WallSupportKind, WallSupportDraft>;
  wallSupportImageBases: Record<WallSupportKind, CalibrationImageBasis | null>;
  ceilingSupportDraft: CeilingSupportDraft;
  ceilingSupportImageBasis: CalibrationImageBasis | null;
  objectSupportAttachment: ObjectSupportAttachment | null;
  verticalEvidence: VerticalEvidenceSection | null;
  imageLoadState: "idle" | "loading" | "loaded" | "error";
};

export function formatSceneModelStatus(
  state: CurrentSceneStateAssemblyInput["modelLoadState"],
  errorMessage: string | null
): string {
  if (state === "fallback") return `fallback cube (${errorMessage ?? "GLB load failed"})`;
  if (state === "error") return `error (${errorMessage ?? "unknown"})`;
  return state;
}

function floorPolygonsNearlyEqual(left: readonly FloorPoint[], right: readonly FloorPoint[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs(left[index].x - right[index].x) > 1e-6 || Math.abs(left[index].y - right[index].y) > 1e-6) {
      return false;
    }
  }
  return true;
}

function calibrationImageBasesMatch(left: CalibrationImageBasis, right: CalibrationImageBasis): boolean {
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
    left.coordinateSpaceVersion.normalizationPolicyVersion ===
      right.coordinateSpaceVersion.normalizationPolicyVersion &&
    left.coordinateSpaceVersion.orientationApplied === right.coordinateSpaceVersion.orientationApplied &&
    left.basisKind === right.basisKind
  );
}

function copyFloorQuad(
  points: readonly FloorPoint[]
): [FloorPoint, FloorPoint, FloorPoint, FloorPoint] | null {
  if (points.length !== 4) return null;
  return [
    { x: points[0].x, y: points[0].y },
    { x: points[1].x, y: points[1].y },
    { x: points[2].x, y: points[2].y },
    { x: points[3].x, y: points[3].y },
  ];
}

export function assembleCurrentSceneStatePayload(
  input: CurrentSceneStateAssemblyInput
): SceneStatePayloadBuildResult {
  const roomImageUrlTrimmed = input.roomImageUrl.trim();
  const hasValidIntrinsicImageSize =
    !!input.imageIntrinsicSize &&
    Number.isFinite(input.imageIntrinsicSize.width) &&
    Number.isFinite(input.imageIntrinsicSize.height) &&
    input.imageIntrinsicSize.width > 0 &&
    input.imageIntrinsicSize.height > 0;
  const hasValidRendererSize =
    Number.isFinite(input.rendererSize.width) &&
    Number.isFinite(input.rendererSize.height) &&
    input.rendererSize.width > 0 &&
    input.rendererSize.height > 0;
  const snapshot = input.calibratedCameraSnapshot;
  const qualifiedImageBasis = input.qualifiedImageBasis;
  const authoritativeCalibrationFovDeg = snapshot?.fovDeg ?? null;
  const hasValidAuthoritativeFov =
    authoritativeCalibrationFovDeg !== null &&
    Number.isFinite(authoritativeCalibrationFovDeg) &&
    authoritativeCalibrationFovDeg >= CALIBRATED_SCENE_STATE_MIN_VERTICAL_FOV_DEG &&
    authoritativeCalibrationFovDeg <= CALIBRATED_SCENE_STATE_MAX_VERTICAL_FOV_DEG;
  const calibrationForExport: CalibratedSceneStateCalibrationV2 | undefined =
    input.isCalibratedCameraActive &&
    snapshot &&
    qualifiedImageBasis &&
    roomImageUrlTrimmed.length > 0 &&
    hasValidIntrinsicImageSize &&
    hasValidRendererSize &&
    hasValidAuthoritativeFov &&
    authoritativeCalibrationFovDeg !== null &&
    input.sourceNormalizedFloorPolygon.length === 4
      ? {
          calibrationVersion: CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2,
          solver: CALIBRATED_SCENE_STATE_SOLVER_V1,
          intrinsics: {
            verticalFovDeg: authoritativeCalibrationFovDeg,
          },
          source: {
            imageBasis: qualifiedImageBasis,
            sourceFloorPolygon: input.sourceNormalizedFloorPolygon.map((point) => ({
              x: point.x,
              y: point.y,
            })),
          },
        }
      : undefined;
  const authoritySourceFloorPolygon = snapshot ? copyFloorQuad(snapshot.sourceFloorPolygon) : null;
  const calibrationAppliedAuthorityForExport: CalibratedCameraAppliedAuthority | undefined =
    calibrationForExport &&
    snapshot &&
    qualifiedImageBasis &&
    authoritySourceFloorPolygon &&
    calibrationImageBasesMatch(snapshot.imageBasis, qualifiedImageBasis) &&
    floorPolygonsNearlyEqual(snapshot.sourceFloorPolygon, input.sourceNormalizedFloorPolygon) &&
    snapshot.frameSize.width > 0 &&
    snapshot.frameSize.height > 0 &&
    snapshot.frameSize.width === input.rendererSize.width &&
    snapshot.frameSize.height === input.rendererSize.height &&
    Number.isFinite(input.floorMapping.worldWidth) &&
    Number.isFinite(input.floorMapping.worldDepth) &&
    input.floorMapping.worldWidth > 0 &&
    input.floorMapping.worldDepth > 0
      ? {
          authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
          appliedAtIso: snapshot.appliedAtIso,
          verticalFovDeg: snapshot.fovDeg,
          frameSize: { ...snapshot.frameSize },
          pose: {
            position: { ...snapshot.pose.position },
            lookAt: { ...snapshot.pose.lookAt },
            up: { ...snapshot.pose.up },
          },
          imageBasis: snapshot.imageBasis,
          sourceFloorPolygon: authoritySourceFloorPolygon,
          floorMapping: {
            worldWidth: input.floorMapping.worldWidth,
            worldDepth: input.floorMapping.worldDepth,
          },
          calibrationVersion: CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
          solver: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
          diagnosticsSummary: snapshot.diagnosticsSummary,
        }
      : undefined;

  return buildSceneStatePayload({
    exportedAtIso: input.exportedAtIso,
    roomImageUrl: input.roomImageUrl,
    modelPath: input.modelPath,
    activeObjectType: input.activeObjectType,
    glbLoadStatus: input.modelLoadState,
    modelNormalization: input.modelNormalization,
    transform: {
      positionX: input.transform.positionX,
      positionY: input.transform.positionY,
      positionZ: input.transform.positionZ,
      rotationYDeg: input.transform.rotationYDeg,
      uniformScale: input.transform.uniformScale,
      autoRotate: input.autoRotateEnabled,
    },
    floor: {
      polygon: input.floorPolygon,
      overlayVisible: input.showFloorOverlay,
      placementModeEnabled: input.isFloorClickPlacementEnabled,
      lastAcceptedClick: input.lastAcceptedFloorClick,
      lastRejectedClick: input.lastRejectedFloorClick,
      mapping: input.floorMapping,
      perspectiveDepthScaling: input.perspectiveDepthScaling,
    },
    image: input.imageIntrinsicSize
      ? {
          intrinsicWidth: input.imageIntrinsicSize.width,
          intrinsicHeight: input.imageIntrinsicSize.height,
          coordinateSpace: SCENE_IMAGE_COORDINATE_SPACE_V0,
        }
      : null,
    calibration: calibrationForExport,
    calibrationAppliedAuthority: calibrationAppliedAuthorityForExport,
    supports: {
      floor: {
        sourceNormalizedPolygon: input.sourceNormalizedFloorPolygon,
        reviewStatus: input.floorSupportReviewStatus,
        source: input.floorSupportSource,
        supportImageBasis: input.floorSupportImageBasis,
        authorityEligible: input.floorPolygonAuthorityEligible,
      },
      walls: {
        wall_back: {
          draft: input.wallSupportDrafts.wall_back,
          supportImageBasis: input.wallSupportImageBases.wall_back,
        },
        wall_left: {
          draft: input.wallSupportDrafts.wall_left,
          supportImageBasis: input.wallSupportImageBases.wall_left,
        },
        wall_right: {
          draft: input.wallSupportDrafts.wall_right,
          supportImageBasis: input.wallSupportImageBases.wall_right,
        },
      },
      ceiling: {
        draft: input.ceilingSupportDraft,
        supportImageBasis: input.ceilingSupportImageBasis,
      },
    },
    attachment: input.objectSupportAttachment,
    verticalEvidence: input.verticalEvidence,
    debug: {
      rendererSize: input.rendererSize,
      imageStatus: input.imageLoadState,
      modelStatus: formatSceneModelStatus(input.modelLoadState, input.modelLoadError),
    },
  });
}
