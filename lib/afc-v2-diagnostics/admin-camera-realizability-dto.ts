/**
 * Browser-safe Admin camera-realizability DTO.
 *
 * Decodes the sanitized inspector payload. Does not recompute focal
 * constraints and does not import the production evaluator.
 */

import { publishAfcDiagnosticMetricToken } from "./admin-metric-decision-dto";

export const AFC_DIAGNOSTIC_ADMIN_CAMERA_REALIZABILITY_SCHEMA_VERSION =
  "afc-v2-camera-realizability-diagnostic/v2" as const;

const ASPECT_BASIS_KINDS = ["winning_ratio", "best_rejected_ratio"] as const;

const STATUSES = ["not_evaluated", "unavailable", "non_finite", "computed"] as const;

export type AfcDiagnosticAdminCameraRealizabilityStatus = (typeof STATUSES)[number];

export type AfcDiagnosticAdminCameraRealizabilityAspectBasis = Readonly<{
  kind: (typeof ASPECT_BASIS_KINDS)[number];
  widthDepthRatio: number;
}>;

export type AfcDiagnosticAdminCameraRealizabilityValue = Readonly<{
  evaluated: boolean;
  status: AfcDiagnosticAdminCameraRealizabilityStatus;
  aspectBasis: AfcDiagnosticAdminCameraRealizabilityAspectBasis | null;
  focalFromOrthogonalityPx: number | null;
  focalFromEqualNormPx: number | null;
  verticalFovFromOrthogonalityDeg: number | null;
  verticalFovFromEqualNormDeg: number | null;
  focalDisagreement: number | null;
}>;

export type AfcDiagnosticAdminCameraRealizability =
  | null
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "unsupported_schema"; schemaVersion: string }>
  | Readonly<{
      kind: "recorded";
      schemaVersion: typeof AFC_DIAGNOSTIC_ADMIN_CAMERA_REALIZABILITY_SCHEMA_VERSION;
      value: AfcDiagnosticAdminCameraRealizabilityValue;
    }>;

const VALUE_KEYS = [
  "evaluated",
  "status",
  "aspectBasis",
  "focalFromOrthogonalityPx",
  "focalFromEqualNormPx",
  "verticalFovFromOrthogonalityDeg",
  "verticalFovFromEqualNormDeg",
  "focalDisagreement",
] as const;

function unreadable(): AfcDiagnosticAdminCameraRealizability {
  return Object.freeze({ kind: "unreadable" });
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

function finite(value: unknown): number | null | undefined {
  if (value == null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function valueOf(value: unknown): AfcDiagnosticAdminCameraRealizabilityValue | null {
  if (!isRecord(value) || !exactKeys(value, VALUE_KEYS)) return null;
  if (typeof value.evaluated !== "boolean") return null;
  if (typeof value.status !== "string" || !STATUSES.includes(value.status as AfcDiagnosticAdminCameraRealizabilityStatus)) {
    return null;
  }
  const focalFromOrthogonalityPx = finite(value.focalFromOrthogonalityPx);
  const focalFromEqualNormPx = finite(value.focalFromEqualNormPx);
  const verticalFovFromOrthogonalityDeg = finite(value.verticalFovFromOrthogonalityDeg);
  const verticalFovFromEqualNormDeg = finite(value.verticalFovFromEqualNormDeg);
  const focalDisagreement = finite(value.focalDisagreement);
  const aspectBasis = aspectBasisOf(value.aspectBasis);
  if (
    focalFromOrthogonalityPx === undefined ||
    focalFromEqualNormPx === undefined ||
    verticalFovFromOrthogonalityDeg === undefined ||
    verticalFovFromEqualNormDeg === undefined ||
    focalDisagreement === undefined ||
    aspectBasis === undefined
  ) {
    return null;
  }
  return Object.freeze({
    evaluated: value.evaluated,
    status: value.status as AfcDiagnosticAdminCameraRealizabilityStatus,
    aspectBasis,
    focalFromOrthogonalityPx,
    focalFromEqualNormPx,
    verticalFovFromOrthogonalityDeg,
    verticalFovFromEqualNormDeg,
    focalDisagreement,
  });
}

function aspectBasisOf(
  value: unknown,
): AfcDiagnosticAdminCameraRealizabilityAspectBasis | null | undefined {
  if (value == null) return null;
  if (!isRecord(value) || !exactKeys(value, ["kind", "widthDepthRatio"])) return undefined;
  if (typeof value.kind !== "string" || !ASPECT_BASIS_KINDS.includes(value.kind as (typeof ASPECT_BASIS_KINDS)[number])) {
    return undefined;
  }
  const widthDepthRatio = finite(value.widthDepthRatio);
  if (widthDepthRatio == null || !(widthDepthRatio > 0)) return undefined;
  return Object.freeze({
    kind: value.kind as (typeof ASPECT_BASIS_KINDS)[number],
    widthDepthRatio,
  });
}

export function parseAfcDiagnosticAdminCameraRealizabilityDto(
  value: unknown,
): AfcDiagnosticAdminCameraRealizability {
  if (value == null) return null;
  if (!isRecord(value) || typeof value.kind !== "string") return unreadable();
  if (value.kind === "unreadable") return unreadable();
  if (value.kind === "unsupported_schema") {
    const schemaVersion = typeof value.schemaVersion === "string"
      ? publishAfcDiagnosticMetricToken(value.schemaVersion) ?? "unavailable"
      : "unavailable";
    return Object.freeze({ kind: "unsupported_schema", schemaVersion });
  }
  if (value.kind !== "recorded") return unreadable();
  if (value.schemaVersion !== AFC_DIAGNOSTIC_ADMIN_CAMERA_REALIZABILITY_SCHEMA_VERSION) {
    return unreadable();
  }
  const parsed = valueOf(value.value);
  if (!parsed) return unreadable();
  return Object.freeze({
    kind: "recorded",
    schemaVersion: AFC_DIAGNOSTIC_ADMIN_CAMERA_REALIZABILITY_SCHEMA_VERSION,
    value: parsed,
  });
}
