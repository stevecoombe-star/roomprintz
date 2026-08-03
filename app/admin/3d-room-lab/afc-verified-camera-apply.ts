import type { AfcQualifiedLiveImageBasis } from "./afc-verified-floor-apply";
import type {
  CalibratedCameraApplyEvaluation,
  CalibratedCameraApplyFirstFailingGate,
} from "./calibrated-camera-apply";

/**
 * Session-ephemeral host state established by a successful verified AFC Floor
 * Apply, including a canonical no-change Apply. Its Floor key is the exact
 * durable source authority identity produced by buildDurableSourceFloorAuthorityKey.
 */
export type VerifiedAfcFloorCameraBinding = Readonly<{
  floorAuthorityKey: string;
  basisFingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
  bindingGeneration: number;
}>;

export type VerifiedAfcCameraApplyQualificationInput = Readonly<{
  binding: VerifiedAfcFloorCameraBinding | null;
  currentFloorAuthorityKey: string | null;
  currentLiveBasis: AfcQualifiedLiveImageBasis | null;
  currentCameraApplyEvaluation: CalibratedCameraApplyEvaluation;
  hasApplyCandidate: boolean;
}>;

export type VerifiedAfcCameraApplyRejectionCode =
  | "no_afc_floor_binding"
  | "current_floor_authority_unavailable"
  | "floor_authority_mismatch"
  | "live_image_basis_unavailable"
  | "support_image_basis_mismatch"
  | "camera_candidate_unavailable"
  | "camera_apply_gates_failed";

export type VerifiedAfcCameraApplyQualification =
  | Readonly<{
      ok: true;
      bindingGeneration: number;
    }>
  | Readonly<{
      ok: false;
      reason: Exclude<VerifiedAfcCameraApplyRejectionCode, "camera_apply_gates_failed">;
    }>
  | Readonly<{
      ok: false;
      reason: "camera_apply_gates_failed";
      cameraReason: string;
      firstFailingGate: CalibratedCameraApplyFirstFailingGate;
    }>;

const CALIBRATED_CAMERA_APPLY_GATES = new Set<CalibratedCameraApplyFirstFailingGate>([
  "basis",
  "no-candidate",
  "confidence",
  "cv-avg",
  "cv-max",
  "display-unavailable",
  "display-avg",
  "display-max",
  "delta-avg",
  "delta-max",
  "scale-ratio",
  "frame-size",
  "none",
]);

function hasNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasPositiveFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function hasPositiveSafeInteger(value: unknown): value is number {
  return hasPositiveFiniteInteger(value) && Number.isSafeInteger(value);
}

function isValidBinding(value: VerifiedAfcFloorCameraBinding | null): value is VerifiedAfcFloorCameraBinding {
  return !!value &&
    hasNonEmptyText(value.floorAuthorityKey) &&
    hasNonEmptyText(value.basisFingerprint) &&
    hasPositiveFiniteInteger(value.decodedWidth) &&
    hasPositiveFiniteInteger(value.decodedHeight) &&
    hasPositiveSafeInteger(value.bindingGeneration);
}

function hasValidLiveBasis(value: AfcQualifiedLiveImageBasis | null): value is AfcQualifiedLiveImageBasis {
  return !!value &&
    hasNonEmptyText(value.basisFingerprint) &&
    hasPositiveFiniteInteger(value.decodedWidth) &&
    hasPositiveFiniteInteger(value.decodedHeight);
}

function rejected(
  reason: Exclude<VerifiedAfcCameraApplyRejectionCode, "camera_apply_gates_failed">
): VerifiedAfcCameraApplyQualification {
  return Object.freeze({ ok: false as const, reason });
}

function rejectedCameraGates(
  evaluation: CalibratedCameraApplyEvaluation
): VerifiedAfcCameraApplyQualification {
  const cameraReason = typeof evaluation?.reason === "string"
    ? evaluation.reason
    : "camera apply evaluation is malformed";
  const firstFailingGate = CALIBRATED_CAMERA_APPLY_GATES.has(evaluation?.firstFailingGate)
    ? evaluation.firstFailingGate
    : "no-candidate";
  return Object.freeze({
    ok: false as const,
    reason: "camera_apply_gates_failed" as const,
    cameraReason,
    firstFailingGate,
  });
}

/**
 * Pure render-time qualification for the explicit AFC-bound camera Apply
 * command. It grants no mutation authority and does not capture a candidate.
 *
 * Solver candidates are advisory: this only confirms one currently exists and
 * its current gates pass. A future host must re-read the latest candidate and
 * rerun evaluateCalibratedCameraApply at click time; it must never apply a
 * candidate captured by a rendered button or request.
 */
export function qualifyVerifiedAfcCameraApply(
  input: VerifiedAfcCameraApplyQualificationInput
): VerifiedAfcCameraApplyQualification {
  if (!isValidBinding(input.binding)) return rejected("no_afc_floor_binding");
  if (!hasNonEmptyText(input.currentFloorAuthorityKey)) {
    return rejected("current_floor_authority_unavailable");
  }
  if (input.currentFloorAuthorityKey !== input.binding.floorAuthorityKey) {
    return rejected("floor_authority_mismatch");
  }
  if (!hasValidLiveBasis(input.currentLiveBasis)) return rejected("live_image_basis_unavailable");
  if (
    input.currentLiveBasis.basisFingerprint !== input.binding.basisFingerprint ||
    input.currentLiveBasis.decodedWidth !== input.binding.decodedWidth ||
    input.currentLiveBasis.decodedHeight !== input.binding.decodedHeight
  ) {
    return rejected("support_image_basis_mismatch");
  }
  if (input.hasApplyCandidate !== true) return rejected("camera_candidate_unavailable");
  if (input.currentCameraApplyEvaluation?.available !== true) {
    return rejectedCameraGates(input.currentCameraApplyEvaluation);
  }
  return Object.freeze({ ok: true as const, bindingGeneration: input.binding.bindingGeneration });
}
