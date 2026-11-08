/**
 * One known real-world measurement becomes one uniform scale.
 * Generated metres stay measurements of the model, not a verified product size.
 */

import {
  FURNITURE_ASSET_FIXTURE_TOLERANCE_M,
  FURNITURE_ASSET_PLAUSIBLE_MAX_M,
  FURNITURE_ASSET_PLAUSIBLE_MIN_M,
} from "@/lib/afc-v2-runtime/furniture-asset-policy";

export const CALIBRATION_AXES = ["height", "width", "depth"] as const;

export type CalibrationAxis = (typeof CALIBRATION_AXES)[number];

export type MeasuredMetres = Readonly<{
  widthM: number;
  heightM: number;
  depthM: number;
}>;

export type UniformCalibration = Readonly<{
  axis: CalibrationAxis;
  targetM: number;
  factor: number;
  widthM: number;
  heightM: number;
  depthM: number;
}>;

export type CalibrationFailure =
  | "invalid_axis"
  | "invalid_target"
  | "invalid_measurement"
  | "implausible_result";

export function isCalibrationAxis(value: string): value is CalibrationAxis {
  return (CALIBRATION_AXES as readonly string[]).includes(value);
}

/**
 * Micrometre precision. 0.85 and 0.850 are the same target.
 * Non-finite and non-positive values are rejected.
 */
export function canonicalCalibrationTargetM(targetM: number): number | null {
  if (typeof targetM !== "number" || !Number.isFinite(targetM) || targetM <= 0) return null;
  const canonical = Number(targetM.toFixed(6));
  if (!Number.isFinite(canonical) || canonical <= 0) return null;
  return canonical;
}

export function calibrateUniformDimensions(input: Readonly<{
  measured: MeasuredMetres;
  axis: string;
  targetM: number;
}>): { ok: true; calibration: UniformCalibration } | { ok: false; code: CalibrationFailure } {
  if (!isCalibrationAxis(input.axis)) return { ok: false, code: "invalid_axis" };
  const targetM = canonicalCalibrationTargetM(input.targetM);
  if (targetM == null) return { ok: false, code: "invalid_target" };
  const measured = input.measured;
  const axes = [measured.widthM, measured.heightM, measured.depthM];
  if (!axes.every((value) => Number.isFinite(value) && value > 0)) {
    return { ok: false, code: "invalid_measurement" };
  }
  const measuredAxis = axisMetres(measured, input.axis);
  if (targetM < FURNITURE_ASSET_PLAUSIBLE_MIN_M || targetM > FURNITURE_ASSET_PLAUSIBLE_MAX_M) {
    return { ok: false, code: "implausible_result" };
  }
  const factor = targetM / measuredAxis;
  if (!Number.isFinite(factor) || factor <= 0) return { ok: false, code: "invalid_measurement" };
  const result: MeasuredMetres = {
    widthM: measured.widthM * factor,
    heightM: measured.heightM * factor,
    depthM: measured.depthM * factor,
  };
  if (!plausible(result)) return { ok: false, code: "implausible_result" };
  return {
    ok: true,
    calibration: {
      axis: input.axis,
      targetM,
      factor,
      widthM: result.widthM,
      heightM: result.heightM,
      depthM: result.depthM,
    },
  };
}

export function measuredMetresMatch(actual: MeasuredMetres, expected: MeasuredMetres): boolean {
  return (["widthM", "heightM", "depthM"] as const).every((axis) =>
    Number.isFinite(actual[axis])
    && Math.abs(actual[axis] - expected[axis]) <= FURNITURE_ASSET_FIXTURE_TOLERANCE_M
  );
}

export function calibrationTargetMatches(actualM: number, targetM: number): boolean {
  const target = canonicalCalibrationTargetM(targetM);
  return target != null
    && Number.isFinite(actualM)
    && Math.abs(actualM - target) <= FURNITURE_ASSET_FIXTURE_TOLERANCE_M;
}

function plausible(measured: MeasuredMetres): boolean {
  return [measured.widthM, measured.heightM, measured.depthM].every((value) =>
    Number.isFinite(value)
    && value >= FURNITURE_ASSET_PLAUSIBLE_MIN_M
    && value <= FURNITURE_ASSET_PLAUSIBLE_MAX_M
  );
}

function axisMetres(measured: MeasuredMetres, axis: CalibrationAxis): number {
  if (axis === "width") return measured.widthM;
  if (axis === "height") return measured.heightM;
  return measured.depthM;
}
