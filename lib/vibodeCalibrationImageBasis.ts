import "server-only";

import { createHash } from "node:crypto";
import {
  CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
  buildCalibrationImageBasisId,
  evaluateCalibrationImageBasisEvidence,
  type CalibrationImageBasis,
  type CalibrationImageBasisCoordinateSpaceVersion,
  type CalibrationImageBasisKind,
  type CalibrationImageBasisRefusalReason,
} from "@/app/admin/3d-room-lab/calibration-image-basis";
import { fetchRoomImageSafely, inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";

export type QualifyCalibrationImageBasisInput = {
  imageUrl: string;
  browserDimensions: { width: number; height: number } | null;
  coordinateSpaceVersion: CalibrationImageBasisCoordinateSpaceVersion;
  basisKind: CalibrationImageBasisKind;
  fetch: {
    allowedHosts: string[];
    maxBytes: number;
    timeoutMs: number;
    allowLocalhostHttp: boolean;
  };
};

export type QualifyCalibrationImageBasisResult =
  | {
      ok: true;
      basis: CalibrationImageBasis;
    }
  | {
      ok: false;
      reason: CalibrationImageBasisRefusalReason;
      message: string;
    };

export function computeCalibrationImageFingerprint(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function qualifyCalibrationImageBasis(
  input: QualifyCalibrationImageBasisInput
): Promise<QualifyCalibrationImageBasisResult> {
  const imageUrl = input.imageUrl.trim();
  if (!imageUrl) {
    return {
      ok: false,
      reason: "basis_unavailable",
      message: "Room image URL is unavailable for basis qualification.",
    };
  }

  const fetched = await fetchRoomImageSafely(imageUrl, input.fetch);
  if (!fetched.ok) {
    return {
      ok: false,
      reason: "basis_fetch_failed",
      message: fetched.reason,
    };
  }

  const metadata = await inspectImageMetadata(fetched.buffer);
  if (!metadata.ok) {
    return {
      ok: false,
      reason: "basis_decode_failed",
      message: metadata.reason,
    };
  }

  const evidence = evaluateCalibrationImageBasisEvidence({
    metadata,
    browserDimensions: input.browserDimensions,
    coordinateSpaceVersion: input.coordinateSpaceVersion,
    basisKind: input.basisKind,
  });
  if (!evidence.ok) {
    return {
      ok: false,
      reason: evidence.reason,
      message: evidence.message,
    };
  }

  const basisFingerprint = computeCalibrationImageFingerprint(fetched.buffer);
  const basis: CalibrationImageBasis = {
    basisId: buildCalibrationImageBasisId({
      sourceImageUrl: imageUrl,
      basisFingerprint,
      decodedWidth: metadata.width,
      decodedHeight: metadata.height,
    }),
    basisFingerprint,
    sourceImageUrl: imageUrl,
    decodedWidth: metadata.width,
    decodedHeight: metadata.height,
    encodedOrientation: metadata.orientation,
    decodedOrientationNormal: true,
    orientationTransform: "identity",
    dimensionSource: "server",
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    basisKind: "original",
  };

  return { ok: true, basis };
}
