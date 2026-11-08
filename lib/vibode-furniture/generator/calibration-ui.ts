/**
 * Owner calibration for one generated candidate.
 * The typed measurement is the only scale. Nothing here assumes a chair height.
 */

import {
  calibrateUniformDimensions,
  canonicalCalibrationTargetM,
  isCalibrationAxis,
  type CalibrationAxis,
  type MeasuredMetres,
} from "@/lib/vibode-furniture/generation/calibrate";
import {
  normalizePersonalCategory,
  normalizePersonalDisplayName,
} from "@/lib/vibode-furniture/library";

const JOB_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CalibrationSavePhase = "edit" | "confirm" | "saving";

export type CalibrationPreview = Readonly<{
  axis: CalibrationAxis;
  targetM: number | null;
  targetLabel: string | null;
  result: MeasuredMetres | null;
  resultLabel: string | null;
  measurementIssue: string | null;
  displayName: string | null;
  category: string | null;
  detailIssue: string | null;
  ready: boolean;
}>;

export function candidateJobId(value: string): string | null {
  const jobId = value.trim();
  return JOB_ID.test(jobId) ? jobId : null;
}

/**
 * Metres by default. A trailing cm is explicit, so 85 and 85cm are different.
 */
export function parseCalibrationTargetMetres(value: string): number | null {
  const trimmed = value.trim().toLowerCase().replaceAll(",", "");
  if (!trimmed) return null;
  const centimetres = trimmed.endsWith("cm");
  const numeric = trimmed.replace(/(cm|m)$/, "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(numeric)) return null;
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return centimetres ? parsed / 100 : parsed;
}

export function formatMeasurement(metres: number): string {
  return `${metres.toFixed(3)} m (${(metres * 100).toFixed(1)} cm)`;
}

export function formatCalibrationSize(size: MeasuredMetres): string {
  const metres = `${size.widthM.toFixed(3)} × ${size.depthM.toFixed(3)} × ${size.heightM.toFixed(3)} m`;
  const centimetres = `${(size.widthM * 100).toFixed(1)} × ${(size.depthM * 100).toFixed(1)} × ${(size.heightM * 100).toFixed(1)} cm`;
  return `${metres} (${centimetres})`;
}

export function formatGeneratedCentimetres(size: MeasuredMetres): string {
  return `${(size.widthM * 100).toFixed(1)} × ${(size.depthM * 100).toFixed(1)} × ${(size.heightM * 100).toFixed(1)} cm`;
}

export function buildCalibrationPreview(input: Readonly<{
  measured: MeasuredMetres | null;
  axis: string;
  targetText: string;
  displayName: string;
  category: string;
}>): CalibrationPreview {
  const axis = isCalibrationAxis(input.axis) ? input.axis : "height";
  const empty: CalibrationPreview = {
    axis,
    targetM: null,
    targetLabel: null,
    result: null,
    resultLabel: null,
    measurementIssue: null,
    displayName: null,
    category: null,
    detailIssue: null,
    ready: false,
  };
  if (!input.measured) return empty;
  const parsed = parseCalibrationTargetMetres(input.targetText);
  if (parsed == null) {
    return {
      ...empty,
      measurementIssue: input.targetText.trim() ? "Enter a positive measurement in metres." : null,
    };
  }
  const targetM = canonicalCalibrationTargetM(parsed);
  if (targetM == null) {
    return { ...empty, measurementIssue: "Enter a positive measurement in metres." };
  }
  const calibrated = calibrateUniformDimensions({
    measured: input.measured,
    axis,
    targetM,
  });
  if (!calibrated.ok) {
    return {
      ...empty,
      targetM,
      targetLabel: formatMeasurement(targetM),
      measurementIssue: "That size is outside the supported range of 0.05 m to 8 m.",
    };
  }
  const result = {
    widthM: calibrated.calibration.widthM,
    heightM: calibrated.calibration.heightM,
    depthM: calibrated.calibration.depthM,
  };
  const displayName = normalizePersonalDisplayName(input.displayName);
  const category = normalizePersonalCategory(input.category);
  const detailIssue = !displayName
    ? (input.displayName.trim() ? "Enter a name up to 80 characters." : null)
    : (category === "invalid" ? "Category must be 40 characters or fewer." : null);
  return {
    axis,
    targetM,
    targetLabel: formatMeasurement(targetM),
    result,
    resultLabel: formatCalibrationSize(result),
    measurementIssue: null,
    displayName,
    category: category === "invalid" ? null : category,
    detailIssue,
    ready: displayName != null && category !== "invalid",
  };
}

export function nextCalibrationPhase(
  phase: CalibrationSavePhase,
  event: "review" | "back" | "commit" | "edit" | "settled",
  ready: boolean,
): CalibrationSavePhase {
  if (event === "edit" || event === "back") return phase === "saving" ? phase : "edit";
  if (event === "review") return ready && phase === "edit" ? "confirm" : phase;
  if (event === "commit") return ready && phase === "confirm" ? "saving" : phase;
  return phase === "saving" ? "edit" : phase;
}

export function claimCalibrationSubmit(gate: { pending: boolean }): boolean {
  if (gate.pending) return false;
  gate.pending = true;
  return true;
}

export function calibrationFailureLocks(errorCode: string): boolean {
  return errorCode === "CANDIDATE_EXPIRED"
    || errorCode === "ALREADY_SAVED"
    || errorCode === "NOT_FOUND"
    || errorCode === "CANDIDATE_MISSING"
    || errorCode === "SOURCE_MISMATCH"
    || errorCode === "ASSET_EXISTS";
}
