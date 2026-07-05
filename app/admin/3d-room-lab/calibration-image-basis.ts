export const CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION = {
  decoderId: "sharp-metadata/v1",
  normalizationPolicyVersion: "orientation-normal/v1",
  orientationApplied: false,
} as const;

export type CalibrationImageBasisCoordinateSpaceVersion = {
  decoderId: string;
  normalizationPolicyVersion: string;
  orientationApplied: boolean;
};

export type CalibrationImageBasisKind = "original" | "derivative";

export type CalibrationImageBasisRefusalReason =
  | "basis_unavailable"
  | "basis_fetch_failed"
  | "basis_decode_failed"
  | "basis_orientation_not_normal"
  | "basis_dimension_mismatch"
  | "basis_fingerprint_mismatch"
  | "basis_coordinate_space_mismatch"
  | "basis_derivative_not_authority_eligible"
  | "basis_legacy_receipt_missing";

export type CalibrationImageBasis = {
  basisId: string;
  basisFingerprint: string;
  sourceImageUrl: string;
  decodedWidth: number;
  decodedHeight: number;
  encodedOrientation: number;
  decodedOrientationNormal: true;
  orientationTransform: "identity";
  dimensionSource: "server";
  coordinateSpaceVersion: CalibrationImageBasisCoordinateSpaceVersion;
  basisKind: CalibrationImageBasisKind;
};

export function isCalibrationImageBasisCoordinateSpaceVersion(
  value: unknown
): value is CalibrationImageBasisCoordinateSpaceVersion {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.decoderId === CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId &&
    record.normalizationPolicyVersion ===
      CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.normalizationPolicyVersion &&
    record.orientationApplied === CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.orientationApplied
  );
}

export function buildCalibrationImageBasisId(input: {
  sourceImageUrl: string;
  basisFingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
}): string {
  return `${input.basisFingerprint}:${input.decodedWidth}x${input.decodedHeight}:${input.sourceImageUrl}`;
}

export function evaluateCalibrationImageBasisEvidence(input: {
  metadata: { width: number; height: number; orientation: number };
  browserDimensions: { width: number; height: number } | null;
  coordinateSpaceVersion: CalibrationImageBasisCoordinateSpaceVersion;
  basisKind: CalibrationImageBasisKind;
}):
  | { ok: true }
  | { ok: false; reason: CalibrationImageBasisRefusalReason; message: string } {
  if (!isCalibrationImageBasisCoordinateSpaceVersion(input.coordinateSpaceVersion)) {
    return {
      ok: false,
      reason: "basis_coordinate_space_mismatch",
      message: "Coordinate-space contract version does not match the current implementation.",
    };
  }

  if (input.basisKind !== "original") {
    return {
      ok: false,
      reason: "basis_derivative_not_authority_eligible",
      message: "Only original image bases are authority-eligible in this phase.",
    };
  }

  if (input.metadata.orientation !== 1) {
    return {
      ok: false,
      reason: "basis_orientation_not_normal",
      message: "Only EXIF orientation=1 is authority-eligible for Type A calibration.",
    };
  }

  if (
    input.browserDimensions &&
    (input.metadata.width !== input.browserDimensions.width ||
      input.metadata.height !== input.browserDimensions.height)
  ) {
    return {
      ok: false,
      reason: "basis_dimension_mismatch",
      message: "Browser/server intrinsic dimensions do not match current fetched bytes.",
    };
  }

  return { ok: true };
}
