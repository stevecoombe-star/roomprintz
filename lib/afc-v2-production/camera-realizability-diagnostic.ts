/**
 * AFR-3B camera-realizability diagnostic.
 *
 * Observes whether the floor quad is the perspective image of the same
 * rectangle settle tested, under the calibrated camera model. It does not
 * rank cells, search aspect, change settle, or participate in acceptance.
 *
 * The rectangle is getFloorRectCorners({ widthMeters: widthDepthRatio, depthMeters: 1 }).
 * Settle uses width = ratio * referenceDepth and depth = referenceDepth.
 * A uniform meter scale cancels in both focal equations, so depth 1 keeps
 * the aspect and drops the absolute size. The equal-norm constraint is
 * ||r1|| = ||r2|| in those shared metric units. A unit square is that
 * constraint only when the aspect is 1.
 *
 * Orthogonality is unchanged by scaling one world axis. Equal-norm is not.
 * Image points are the same cover-crop into frame pixels that
 * settleAfcFixedSeamCalibration uses. The principal point is the frame
 * center. Vertical FOV uses that frame's height:
 *   2 * atan(frameHeight / (2 * focalPx)).
 *
 * Floor→image H is solvePlaneHomography(rectangle, framePixels). With
 * centered K and square pixels, the first two columns of K⁻¹H give:
 *   f²_orthogonality = -(a b + d e) / (h31 h32)
 *   f²_equal_norm    = -((a² + d²) - (b² + e²)) / (h31² - h32²)
 * Disagreement is abs(f1 - f2) / max(abs(f1), abs(f2)).
 */

import { getCoverCrop } from "@/app/admin/3d-room-lab/image-space";
import {
  floorVec3ToPlane2D,
  getFloorRectCorners,
  solvePlaneHomography,
} from "@/app/admin/3d-room-lab/perspective-solve";

export const AFC_V2_CAMERA_REALIZABILITY_DIAGNOSTIC_SCHEMA_VERSION =
  "afc-v2-camera-realizability-diagnostic/v2" as const;

export const AFC_V2_CAMERA_REALIZABILITY_ASPECT_BASIS_KINDS = [
  "winning_ratio",
  "best_rejected_ratio",
] as const;

export type AfcV2CameraRealizabilityAspectBasisKind =
  (typeof AFC_V2_CAMERA_REALIZABILITY_ASPECT_BASIS_KINDS)[number];

export type AfcV2CameraRealizabilityAspectBasis = Readonly<{
  kind: AfcV2CameraRealizabilityAspectBasisKind;
  widthDepthRatio: number;
}>;

export const AFC_V2_CAMERA_REALIZABILITY_STATUSES = [
  "not_evaluated",
  "unavailable",
  "non_finite",
  "computed",
] as const;

export type AfcV2CameraRealizabilityStatus =
  (typeof AFC_V2_CAMERA_REALIZABILITY_STATUSES)[number];

export type AfcV2CameraRealizabilityRecorded = Readonly<{
  schemaVersion: typeof AFC_V2_CAMERA_REALIZABILITY_DIAGNOSTIC_SCHEMA_VERSION;
  evaluated: boolean;
  status: AfcV2CameraRealizabilityStatus;
  aspectBasis: AfcV2CameraRealizabilityAspectBasis | null;
  focalFromOrthogonalityPx: number | null;
  focalFromEqualNormPx: number | null;
  verticalFovFromOrthogonalityDeg: number | null;
  verticalFovFromEqualNormDeg: number | null;
  focalDisagreement: number | null;
}>;

export type AfcV2CameraRealizabilityUnsupportedSchema = Readonly<{
  kind: "unsupported_schema";
  schemaVersion: string;
}>;

export type AfcV2CameraRealizabilityPersistedValue =
  | null
  | AfcV2CameraRealizabilityRecorded
  | AfcV2CameraRealizabilityUnsupportedSchema;

export type AfcV2CameraRealizabilityParseResult =
  | Readonly<{ ok: true; decision: AfcV2CameraRealizabilityPersistedValue }>
  | Readonly<{ ok: false; reason: string }>;

const RECORDED_KEYS = [
  "schemaVersion",
  "evaluated",
  "status",
  "aspectBasis",
  "focalFromOrthogonalityPx",
  "focalFromEqualNormPx",
  "verticalFovFromOrthogonalityDeg",
  "verticalFovFromEqualNormDeg",
  "focalDisagreement",
] as const;

const DENOMINATOR_EPSILON = 1e-12;

type Point = Readonly<{ x: number; y: number }>;

export function afcV2CameraRealizabilityNotEvaluated(): AfcV2CameraRealizabilityRecorded {
  return recorded({
    evaluated: false,
    status: "not_evaluated",
    aspectBasis: null,
    focalFromOrthogonalityPx: null,
    focalFromEqualNormPx: null,
    verticalFovFromOrthogonalityDeg: null,
    verticalFovFromEqualNormDeg: null,
    focalDisagreement: null,
  });
}

export function afcV2CameraRealizabilityAspectBasisFromSettle(
  settle: Readonly<{
    ok: boolean;
    widthDepthRatio?: number;
    reason?: string;
    diagnostics?: Readonly<{
      bestRejectedCandidate?: Readonly<{ ratio: number }> | null;
    }>;
  }>,
): AfcV2CameraRealizabilityAspectBasis | null {
  if (settle.ok) return aspectBasis("winning_ratio", settle.widthDepthRatio);
  if (settle.reason === "no_apply_safe_candidate") {
    return aspectBasis(
      "best_rejected_ratio",
      settle.diagnostics?.bestRejectedCandidate?.ratio,
    );
  }
  return null;
}

export function evaluateAfcV2CameraRealizability(input: Readonly<{
  sourceNormalizedPolygon: readonly Point[] | null | undefined;
  sourceImageSize: Readonly<{ width: number; height: number }> | null | undefined;
  frameSize: Readonly<{ width: number; height: number }> | null | undefined;
  aspectBasis: AfcV2CameraRealizabilityAspectBasis | null | undefined;
}>): AfcV2CameraRealizabilityRecorded {
  try {
    return evaluateWithin(input);
  } catch {
    return unavailable(null);
  }
}

function evaluateWithin(input: Readonly<{
  sourceNormalizedPolygon: readonly Point[] | null | undefined;
  sourceImageSize: Readonly<{ width: number; height: number }> | null | undefined;
  frameSize: Readonly<{ width: number; height: number }> | null | undefined;
  aspectBasis: AfcV2CameraRealizabilityAspectBasis | null | undefined;
}>): AfcV2CameraRealizabilityRecorded {
  if (input.aspectBasis == null) return afcV2CameraRealizabilityNotEvaluated();
  const basis = aspectBasis(input.aspectBasis.kind, input.aspectBasis.widthDepthRatio);
  if (!basis) return unavailable(null);
  const polygon = input.sourceNormalizedPolygon;
  const sourceImageSize = input.sourceImageSize;
  const frameSize = input.frameSize;
  if (!polygon || !sourceImageSize || !frameSize) return unavailable(basis);
  if (
    polygon.length !== 4 ||
    !polygon.every(isFinitePoint) ||
    !positiveSize(sourceImageSize) ||
    !positiveSize(frameSize)
  ) {
    return unavailable(basis);
  }

  const crop = getCoverCrop(sourceImageSize, frameSize);
  if (!crop) return unavailable(basis);
  const imagePoints = polygon.map((point) => ({
    x: point.x * sourceImageSize.width * crop.scale + crop.offsetX,
    y: point.y * sourceImageSize.height * crop.scale + crop.offsetY,
  }));
  if (!imagePoints.every(isFinitePoint)) return unavailable(basis);

  const rectangle = getFloorRectCorners({
    widthMeters: basis.widthDepthRatio,
    depthMeters: 1,
  });
  if (!rectangle.ok) return unavailable(basis);
  const floorPoints = rectangle.value.asArray.map(floorVec3ToPlane2D);
  const homography = solvePlaneHomography(floorPoints, imagePoints);
  if (!homography.ok) return unavailable(basis);

  const constraints = focalConstraints(homography.value, frameSize);
  if (
    constraints.focalFromOrthogonalityPx == null ||
    constraints.focalFromEqualNormPx == null ||
    constraints.verticalFovFromOrthogonalityDeg == null ||
    constraints.verticalFovFromEqualNormDeg == null ||
    constraints.focalDisagreement == null
  ) {
    return recorded({
      evaluated: true,
      status: "non_finite",
      aspectBasis: basis,
      ...constraints,
    });
  }
  return recorded({
    evaluated: true,
    status: "computed",
    aspectBasis: basis,
    ...constraints,
  });
}

function focalConstraints(
  homography: readonly number[],
  frameSize: Readonly<{ width: number; height: number }>,
): Pick<
  AfcV2CameraRealizabilityRecorded,
  | "focalFromOrthogonalityPx"
  | "focalFromEqualNormPx"
  | "verticalFovFromOrthogonalityDeg"
  | "verticalFovFromEqualNormDeg"
  | "focalDisagreement"
> {
  const cx = frameSize.width / 2;
  const cy = frameSize.height / 2;
  const a = homography[0] - cx * homography[6];
  const d = homography[3] - cy * homography[6];
  const b = homography[1] - cx * homography[7];
  const e = homography[4] - cy * homography[7];
  const focalFromOrthogonalityPx = positiveSqrt(
    quotient(-(a * b + d * e), homography[6] * homography[7]),
  );
  const focalFromEqualNormPx = positiveSqrt(
    quotient(
      -((a * a + d * d) - (b * b + e * e)),
      homography[6] * homography[6] - homography[7] * homography[7],
    ),
  );
  return {
    focalFromOrthogonalityPx,
    focalFromEqualNormPx,
    verticalFovFromOrthogonalityDeg: verticalFovDeg(focalFromOrthogonalityPx, frameSize.height),
    verticalFovFromEqualNormDeg: verticalFovDeg(focalFromEqualNormPx, frameSize.height),
    focalDisagreement: disagreement(focalFromOrthogonalityPx, focalFromEqualNormPx),
  };
}

function quotient(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (Math.abs(denominator) <= DENOMINATOR_EPSILON) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function positiveSqrt(squared: number | null): number | null {
  if (squared == null || !(squared > 0) || !Number.isFinite(squared)) return null;
  const value = Math.sqrt(squared);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function verticalFovDeg(focalPx: number | null, frameHeight: number): number | null {
  if (focalPx == null || !(focalPx > 0) || !(frameHeight > 0)) return null;
  const degrees = (2 * Math.atan(frameHeight / (2 * focalPx)) * 180) / Math.PI;
  return Number.isFinite(degrees) ? degrees : null;
}

function disagreement(left: number | null, right: number | null): number | null {
  if (left == null || right == null || !(left > 0) || !(right > 0)) return null;
  const value = Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right));
  return Number.isFinite(value) ? value : null;
}

function unavailable(
  basis: AfcV2CameraRealizabilityAspectBasis | null,
): AfcV2CameraRealizabilityRecorded {
  return recorded({
    evaluated: true,
    status: "unavailable",
    aspectBasis: basis,
    focalFromOrthogonalityPx: null,
    focalFromEqualNormPx: null,
    verticalFovFromOrthogonalityDeg: null,
    verticalFovFromEqualNormDeg: null,
    focalDisagreement: null,
  });
}

function aspectBasis(
  kind: unknown,
  widthDepthRatio: unknown,
): AfcV2CameraRealizabilityAspectBasis | null {
  if (
    typeof kind !== "string" ||
    !AFC_V2_CAMERA_REALIZABILITY_ASPECT_BASIS_KINDS.includes(
      kind as AfcV2CameraRealizabilityAspectBasisKind,
    ) ||
    typeof widthDepthRatio !== "number" ||
    !Number.isFinite(widthDepthRatio) ||
    !(widthDepthRatio > 0)
  ) {
    return null;
  }
  return Object.freeze({
    kind: kind as AfcV2CameraRealizabilityAspectBasisKind,
    widthDepthRatio,
  });
}

function recorded(
  value: Omit<AfcV2CameraRealizabilityRecorded, "schemaVersion">,
): AfcV2CameraRealizabilityRecorded {
  return Object.freeze({
    schemaVersion: AFC_V2_CAMERA_REALIZABILITY_DIAGNOSTIC_SCHEMA_VERSION,
    ...value,
  });
}

function positiveSize(size: Readonly<{ width: number; height: number }>): boolean {
  return Number.isFinite(size.width) && size.width > 0
    && Number.isFinite(size.height) && size.height > 0;
}

function isFinitePoint(point: Point | null | undefined): point is Point {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function parseAfcV2CameraRealizability(
  value: unknown,
): AfcV2CameraRealizabilityParseResult {
  if (value == null) return Object.freeze({ ok: true, decision: null });
  if (!isRecord(value)) return rejected("camera_realizability_not_object");
  if (value.kind === "unsupported_schema") {
    return typeof value.schemaVersion === "string" && value.schemaVersion.length > 0
      && value.schemaVersion.length <= 160
      ? Object.freeze({
          ok: true,
          decision: Object.freeze({
            kind: "unsupported_schema",
            schemaVersion: value.schemaVersion,
          }),
        })
      : rejected("camera_realizability_schema_invalid");
  }
  if (value.schemaVersion !== AFC_V2_CAMERA_REALIZABILITY_DIAGNOSTIC_SCHEMA_VERSION) {
    return typeof value.schemaVersion === "string"
      ? Object.freeze({
          ok: true,
          decision: Object.freeze({
            kind: "unsupported_schema",
            schemaVersion: value.schemaVersion,
          }),
        })
      : rejected("camera_realizability_schema_invalid");
  }
  if (!exactKeys(value, RECORDED_KEYS)) return rejected("camera_realizability_keys");
  const status = member(value.status, AFC_V2_CAMERA_REALIZABILITY_STATUSES);
  if (typeof value.evaluated !== "boolean" || !status) {
    return rejected("camera_realizability_status");
  }
  const focalFromOrthogonalityPx = nullableFinite(value.focalFromOrthogonalityPx);
  const focalFromEqualNormPx = nullableFinite(value.focalFromEqualNormPx);
  const verticalFovFromOrthogonalityDeg = nullableFinite(value.verticalFovFromOrthogonalityDeg);
  const verticalFovFromEqualNormDeg = nullableFinite(value.verticalFovFromEqualNormDeg);
  const focalDisagreement = nullableFinite(value.focalDisagreement);
  const parsedBasis = parseAspectBasis(value.aspectBasis);
  if (
    focalFromOrthogonalityPx === undefined ||
    focalFromEqualNormPx === undefined ||
    verticalFovFromOrthogonalityDeg === undefined ||
    verticalFovFromEqualNormDeg === undefined ||
    focalDisagreement === undefined ||
    parsedBasis === undefined
  ) {
    return rejected("camera_realizability_number");
  }
  if (!statusMatches(value.evaluated, status, parsedBasis, {
    focalFromOrthogonalityPx,
    focalFromEqualNormPx,
    verticalFovFromOrthogonalityDeg,
    verticalFovFromEqualNormDeg,
    focalDisagreement,
  })) {
    return rejected("camera_realizability_status_mismatch");
  }
  return Object.freeze({
    ok: true,
    decision: recorded({
      evaluated: value.evaluated,
      status,
      aspectBasis: parsedBasis,
      focalFromOrthogonalityPx,
      focalFromEqualNormPx,
      verticalFovFromOrthogonalityDeg,
      verticalFovFromEqualNormDeg,
      focalDisagreement,
    }),
  });
}

export function isAfcV2CameraRealizabilityRecorded(
  value: unknown,
): value is AfcV2CameraRealizabilityRecorded {
  const parsed = parseAfcV2CameraRealizability(value);
  return parsed.ok && parsed.decision != null && !("kind" in parsed.decision);
}

function parseAspectBasis(
  value: unknown,
): AfcV2CameraRealizabilityAspectBasis | null | undefined {
  if (value == null) return null;
  if (!isRecord(value) || !exactKeys(value, ["kind", "widthDepthRatio"])) return undefined;
  return aspectBasis(value.kind, value.widthDepthRatio) ?? undefined;
}

function statusMatches(
  evaluated: boolean,
  status: AfcV2CameraRealizabilityStatus,
  basis: AfcV2CameraRealizabilityAspectBasis | null,
  numbers: Readonly<{
    focalFromOrthogonalityPx: number | null;
    focalFromEqualNormPx: number | null;
    verticalFovFromOrthogonalityDeg: number | null;
    verticalFovFromEqualNormDeg: number | null;
    focalDisagreement: number | null;
  }>,
): boolean {
  if (status === "not_evaluated") {
    return evaluated === false && basis == null && allNull(numbers);
  }
  if (!evaluated) return false;
  if (status === "unavailable") return allNull(numbers);
  if (basis == null) return false;
  if (status === "non_finite") {
    return numbers.focalDisagreement == null
      && pairAgrees(numbers.focalFromOrthogonalityPx, numbers.verticalFovFromOrthogonalityDeg)
      && pairAgrees(numbers.focalFromEqualNormPx, numbers.verticalFovFromEqualNormDeg)
      && (
        numbers.focalFromOrthogonalityPx == null ||
        numbers.focalFromEqualNormPx == null
      );
  }
  return numbers.focalFromOrthogonalityPx != null
    && numbers.focalFromOrthogonalityPx > 0
    && numbers.focalFromEqualNormPx != null
    && numbers.focalFromEqualNormPx > 0
    && numbers.verticalFovFromOrthogonalityDeg != null
    && numbers.verticalFovFromEqualNormDeg != null
    && numbers.focalDisagreement != null
    && numbers.focalDisagreement >= 0
    && numbers.focalDisagreement <= 1;
}

function pairAgrees(focal: number | null, fov: number | null): boolean {
  if (focal == null && fov == null) return true;
  return focal != null && focal > 0 && fov != null;
}

function allNull(numbers: Readonly<Record<string, number | null>>): boolean {
  return Object.values(numbers).every((value) => value == null);
}

function nullableFinite(value: unknown): number | null | undefined {
  if (value == null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function rejected(reason: string): AfcV2CameraRealizabilityParseResult {
  return Object.freeze({ ok: false, reason });
}
