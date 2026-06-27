import type { ImageFrameSize } from "./image-space";

export const CALIBRATED_CAMERA_APPLY_MAX_CV_AVG_PX = 4;
export const CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX = 10;
export const CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_AVG_PX = 10;
export const CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_MAX_PX = 10;
export const CALIBRATED_CAMERA_APPLY_MAX_AVG_DELTA_PX = 1;
export const CALIBRATED_CAMERA_APPLY_MAX_MAX_DELTA_PX = 1;
export const CALIBRATED_CAMERA_APPLY_MIN_SCALE_RATIO = 0.85;
export const CALIBRATED_CAMERA_APPLY_MAX_SCALE_RATIO = 1.18;

export type CalibratedCameraApplyCandidate = {
  confidence: "high" | "low";
  cvAvgPx: number;
  cvMaxPx: number;
  displayAvgPx: number | null;
  displayMaxPx: number | null;
  scaleRatio: number;
  frameSize: ImageFrameSize;
};

export type CalibratedCameraApplyFirstFailingGate =
  | "no-candidate"
  | "confidence"
  | "cv-avg"
  | "cv-max"
  | "display-unavailable"
  | "display-avg"
  | "display-max"
  | "delta-avg"
  | "delta-max"
  | "scale-ratio"
  | "frame-size"
  | "none";

export type CalibratedCameraApplyEvaluation = {
  available: boolean;
  reason: string;
  firstFailingGate: CalibratedCameraApplyFirstFailingGate;
};

export function evaluateCalibratedCameraApply(
  candidate: CalibratedCameraApplyCandidate | null,
  unavailableReason?: string | null
): CalibratedCameraApplyEvaluation {
  if (!candidate) {
    return {
      available: false,
      reason: unavailableReason ?? "camera pose diagnostics unavailable",
      firstFailingGate: "no-candidate",
    };
  }
  if (candidate.confidence !== "high") {
    return {
      available: false,
      reason: "camera pose confidence is not high",
      firstFailingGate: "confidence",
    };
  }
  if (candidate.cvAvgPx >= CALIBRATED_CAMERA_APPLY_MAX_CV_AVG_PX) {
    return {
      available: false,
      reason: "CV reprojection average is too high",
      firstFailingGate: "cv-avg",
    };
  }
  if (candidate.cvMaxPx >= CALIBRATED_CAMERA_APPLY_MAX_CV_MAX_PX) {
    return {
      available: false,
      reason: "CV reprojection max is too high",
      firstFailingGate: "cv-max",
    };
  }
  if (
    candidate.displayAvgPx === null ||
    candidate.displayMaxPx === null ||
    !Number.isFinite(candidate.displayAvgPx) ||
    !Number.isFinite(candidate.displayMaxPx)
  ) {
    return {
      available: false,
      reason: "display reprojection diagnostics are unavailable",
      firstFailingGate: "display-unavailable",
    };
  }
  if (candidate.displayAvgPx >= CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_AVG_PX) {
    return {
      available: false,
      reason: "display reprojection average is too high",
      firstFailingGate: "display-avg",
    };
  }
  if (candidate.displayMaxPx >= CALIBRATED_CAMERA_APPLY_MAX_DISPLAY_MAX_PX) {
    return {
      available: false,
      reason: "display reprojection max is too high",
      firstFailingGate: "display-max",
    };
  }
  if (Math.abs(candidate.displayAvgPx - candidate.cvAvgPx) > CALIBRATED_CAMERA_APPLY_MAX_AVG_DELTA_PX) {
    return {
      available: false,
      reason: "display/CV average reprojection mismatch is too high",
      firstFailingGate: "delta-avg",
    };
  }
  if (Math.abs(candidate.displayMaxPx - candidate.cvMaxPx) > CALIBRATED_CAMERA_APPLY_MAX_MAX_DELTA_PX) {
    return {
      available: false,
      reason: "display/CV max reprojection mismatch is too high",
      firstFailingGate: "delta-max",
    };
  }
  if (
    candidate.scaleRatio < CALIBRATED_CAMERA_APPLY_MIN_SCALE_RATIO ||
    candidate.scaleRatio > CALIBRATED_CAMERA_APPLY_MAX_SCALE_RATIO
  ) {
    return {
      available: false,
      reason: "camera pose scale ratio is outside apply bounds",
      firstFailingGate: "scale-ratio",
    };
  }
  if (candidate.frameSize.width <= 0 || candidate.frameSize.height <= 0) {
    return {
      available: false,
      reason: "frame size is invalid for apply snapshot",
      firstFailingGate: "frame-size",
    };
  }
  return {
    available: true,
    reason: "available",
    firstFailingGate: "none",
  };
}
