/**
 * AFR-3B read mapping for persisted camera_realizability_decision JSON.
 *
 * Calls the production parser and emits a whitelist DTO. Does not recompute
 * the homography or invent evidence for historical null rows.
 */

import {
  AFC_V2_CAMERA_REALIZABILITY_DIAGNOSTIC_SCHEMA_VERSION,
  parseAfcV2CameraRealizability,
  type AfcV2CameraRealizabilityRecorded,
} from "@/lib/afc-v2-production/camera-realizability-diagnostic";

import {
  AFC_DIAGNOSTIC_ADMIN_CAMERA_REALIZABILITY_SCHEMA_VERSION,
  parseAfcDiagnosticAdminCameraRealizabilityDto,
  type AfcDiagnosticAdminCameraRealizability,
} from "./admin-camera-realizability-dto";

function unreadable(): AfcDiagnosticAdminCameraRealizability {
  return Object.freeze({ kind: "unreadable" });
}

function recordedValue(decision: AfcV2CameraRealizabilityRecorded) {
  return Object.freeze({
    evaluated: decision.evaluated,
    status: decision.status,
    aspectBasis: decision.aspectBasis,
    focalFromOrthogonalityPx: decision.focalFromOrthogonalityPx,
    focalFromEqualNormPx: decision.focalFromEqualNormPx,
    verticalFovFromOrthogonalityDeg: decision.verticalFovFromOrthogonalityDeg,
    verticalFovFromEqualNormDeg: decision.verticalFovFromEqualNormDeg,
    focalDisagreement: decision.focalDisagreement,
  });
}

export function mapAfcDiagnosticAdminCameraRealizability(
  value: unknown,
): AfcDiagnosticAdminCameraRealizability {
  try {
    const parsed = parseAfcV2CameraRealizability(value);
    if (!parsed.ok) return unreadable();
    if (parsed.decision === null) return null;
    if ("kind" in parsed.decision && parsed.decision.kind === "unsupported_schema") {
      return parseAfcDiagnosticAdminCameraRealizabilityDto({
        kind: "unsupported_schema",
        schemaVersion: parsed.decision.schemaVersion,
      });
    }
    if (!("evaluated" in parsed.decision)) return unreadable();
    if (parsed.decision.schemaVersion !== AFC_V2_CAMERA_REALIZABILITY_DIAGNOSTIC_SCHEMA_VERSION) {
      return unreadable();
    }
    return parseAfcDiagnosticAdminCameraRealizabilityDto({
      kind: "recorded",
      schemaVersion: AFC_DIAGNOSTIC_ADMIN_CAMERA_REALIZABILITY_SCHEMA_VERSION,
      value: recordedValue(parsed.decision),
    });
  } catch {
    return unreadable();
  }
}
