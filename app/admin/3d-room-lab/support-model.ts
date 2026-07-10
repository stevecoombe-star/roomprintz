import type { CalibrationImageBasis } from "./calibration-image-basis";
import type { ImageFrameSize } from "./image-space";

// Lab-local support lifecycle. Review records an operator/authority decision;
// runtime usability is evaluated separately from the live camera/basis state.
export type SupportKind = "floor" | "wall_back" | "wall_left" | "wall_right" | "ceiling";

export type SupportReviewStatus =
  | "unavailable"
  | "suggested"
  | "needs_review"
  | "manually_confirmed"
  | "locally_verified";

export type SupportSource = "manual" | "model_suggested" | "derived";

export type SupportRuntimeBlockReason =
  | "no_active_calibrated_camera"
  | "camera_snapshot_stale"
  | "image_basis_unqualified"
  | "image_basis_mismatch"
  | "frame_size_mismatch"
  | "invalid_support_geometry"
  | "support_not_confirmed";

export type SupportCameraSnapshot = {
  imageBasis: CalibrationImageBasis;
  frameSize: ImageFrameSize;
};

export type SupportUsabilityInput = {
  reviewStatus: SupportReviewStatus;
  geometryValid: boolean;
  currentImageBasis: CalibrationImageBasis | null;
  supportImageBasis: CalibrationImageBasis | null;
  activeCameraSnapshot: SupportCameraSnapshot | null;
  currentFrameSize: ImageFrameSize | null;
  cameraSnapshotStale: boolean;
};

export type SupportUsabilityEvaluation = {
  usable: boolean;
  blockingReasons: SupportRuntimeBlockReason[];
  firstBlockingReason: SupportRuntimeBlockReason | null;
};

function hasValidFrameSize(frameSize: ImageFrameSize | null): frameSize is ImageFrameSize {
  return (
    !!frameSize &&
    Number.isFinite(frameSize.width) &&
    Number.isFinite(frameSize.height) &&
    frameSize.width > 0 &&
    frameSize.height > 0
  );
}

/**
 * Existing image-basis identity is compared through its exact basis receipt
 * fields. This deliberately introduces no support-specific digest or basis id.
 */
export function calibrationImageBasesMatch(
  left: CalibrationImageBasis | null,
  right: CalibrationImageBasis | null
): boolean {
  if (!left || !right) return false;
  return (
    left.basisFingerprint === right.basisFingerprint &&
    left.decodedWidth === right.decodedWidth &&
    left.decodedHeight === right.decodedHeight &&
    left.encodedOrientation === right.encodedOrientation &&
    left.decodedOrientationNormal === right.decodedOrientationNormal &&
    left.orientationTransform === right.orientationTransform &&
    left.coordinateSpaceVersion.decoderId === right.coordinateSpaceVersion.decoderId &&
    left.coordinateSpaceVersion.normalizationPolicyVersion ===
      right.coordinateSpaceVersion.normalizationPolicyVersion &&
    left.coordinateSpaceVersion.orientationApplied === right.coordinateSpaceVersion.orientationApplied
  );
}

function frameSizesMatch(left: ImageFrameSize | null, right: ImageFrameSize | null): boolean {
  return (
    hasValidFrameSize(left) &&
    hasValidFrameSize(right) &&
    left.width === right.width &&
    left.height === right.height
  );
}

function isConfirmedReviewStatus(status: SupportReviewStatus): boolean {
  return status === "manually_confirmed" || status === "locally_verified";
}

/**
 * Stable gate order is camera presence, its known stale state, image basis,
 * frame compatibility, geometry, then review. All failures are returned so the
 * UI can explain an independently reviewed but currently unusable support.
 */
export function evaluateSupportUsability(input: SupportUsabilityInput): SupportUsabilityEvaluation {
  const blockingReasons: SupportRuntimeBlockReason[] = [];
  const snapshot = input.activeCameraSnapshot;

  if (!snapshot) {
    blockingReasons.push("no_active_calibrated_camera");
  } else if (input.cameraSnapshotStale) {
    blockingReasons.push("camera_snapshot_stale");
  }

  if (!input.currentImageBasis) {
    blockingReasons.push("image_basis_unqualified");
  }

  if (
    input.currentImageBasis &&
    (!input.supportImageBasis ||
      !calibrationImageBasesMatch(input.supportImageBasis, input.currentImageBasis) ||
      (snapshot && !calibrationImageBasesMatch(snapshot.imageBasis, input.currentImageBasis)))
  ) {
    blockingReasons.push("image_basis_mismatch");
  }

  if (snapshot && !frameSizesMatch(snapshot.frameSize, input.currentFrameSize)) {
    blockingReasons.push("frame_size_mismatch");
  }

  if (!input.geometryValid) {
    blockingReasons.push("invalid_support_geometry");
  }

  if (!isConfirmedReviewStatus(input.reviewStatus)) {
    blockingReasons.push("support_not_confirmed");
  }

  return {
    usable: blockingReasons.length === 0,
    blockingReasons,
    firstBlockingReason: blockingReasons[0] ?? null,
  };
}
