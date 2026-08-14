import { FLOOR_MAPPING_LIMITS } from "./floor-math";
import { getCoverCrop, type ImageFrameSize } from "./image-space";
import {
  evaluateRatioFovCell,
  type RatioFovApplyObservability,
  type RatioFovSuccessfulCell,
} from "./research/ratio-fov-harness";
import { validateFloorSourcePolygonExtent } from "./floor-coordinate-extent";
import { validateOrderedFloorCorners } from "./perspective-solve";

type Point = Readonly<{ x: number; y: number }>;
type Polygon = readonly [Point, Point, Point, Point];

export type AfcFixedSeamCalibrationFailure =
  | "invalid_polygon"
  | "invalid_frame"
  | "invalid_reference_depth"
  | "metric_domain_rejected"
  | "no_apply_safe_candidate";

export type AfcFixedSeamCalibrationSuccess = Readonly<{
  ok: true;
  widthDepthRatio: number;
  referenceDepthM: number;
  worldWidthM: number;
  worldDepthM: number;
  verticalFovDeg: number;
  winningCellId: string;
  applyObservability: RatioFovApplyObservability;
  evaluatedCellCount: number;
  applySafeCellCount: number;
}>;

export type AfcFixedSeamCalibrationResult =
  | AfcFixedSeamCalibrationSuccess
  | Readonly<{
      ok: false;
      reason: AfcFixedSeamCalibrationFailure;
      evaluatedCellCount: number;
      applySafeCellCount: number;
    }>;

export type AfcFixedSeamCalibrationInput = Readonly<{
  sourceNormalizedPolygon: Polygon;
  sourceImageSize: Readonly<{ width: number; height: number }>;
  frameSize: ImageFrameSize;
  referenceDepthM: number;
  ratioSearch?: Readonly<{ min: number; max: number; step: number }>;
  fovSearch?: Readonly<{ minDeg: number; maxDeg: number; stepDeg: number }>;
}>;

const DEFAULT_RATIO_SEARCH = Object.freeze({ min: 0.5, max: 2, step: 0.05 });
const DEFAULT_FOV_SEARCH = Object.freeze({ minDeg: 20, maxDeg: 90, stepDeg: 1 });
const REFINEMENT_RATIO_STEP = 0.005;
const REFINEMENT_FOV_STEP_DEG = 0.1;

function valuesInRange(minimum: number, maximum: number, step: number): readonly number[] {
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    !Number.isFinite(step) ||
    minimum > maximum ||
    step <= 0
  ) {
    return [];
  }
  const count = Math.floor((maximum - minimum) / step + 1e-9);
  return Object.freeze(
    Array.from({ length: count + 1 }, (_, index) => Number((minimum + index * step).toPrecision(14)))
  );
}

function validPolygon(value: readonly Point[]): value is Polygon {
  return (
    value.length === 4 &&
    validateFloorSourcePolygonExtent(value).ok &&
    validateOrderedFloorCorners(value.map((point) => ({ ...point }))).ok
  );
}

function metricDomainAllows(ratio: number, referenceDepthM: number): boolean {
  const width = ratio * referenceDepthM;
  return (
    Number.isFinite(width) &&
    width >= FLOOR_MAPPING_LIMITS.worldWidth.min &&
    width <= FLOOR_MAPPING_LIMITS.worldWidth.max &&
    referenceDepthM >= FLOOR_MAPPING_LIMITS.worldDepth.min &&
    referenceDepthM <= FLOOR_MAPPING_LIMITS.worldDepth.max
  );
}

export function compareAfcFixedSeamCalibrationCells(left: RatioFovSuccessfulCell, right: RatioFovSuccessfulCell): number {
  if (left.applyObservability.available !== right.applyObservability.available) {
    return left.applyObservability.available ? -1 : 1;
  }
  if (left.confidence !== right.confidence) return left.confidence === "high" ? -1 : 1;
  if (left.cvAvgPx !== right.cvAvgPx) return left.cvAvgPx - right.cvAvgPx;
  if (left.cvMaxPx !== right.cvMaxPx) return left.cvMaxPx - right.cvMaxPx;
  if (left.fovDeg !== right.fovDeg) return left.fovDeg - right.fovDeg;
  return left.ratio - right.ratio;
}

function cellId(cell: RatioFovSuccessfulCell): string {
  return `ratio=${cell.ratio.toFixed(3)};fov=${cell.fovDeg.toFixed(1)}`;
}

/**
 * Settles ratio × FOV for an already-built, fixed-seam polygon. It has no seam
 * input by design: perspective adjustment can rebuild the polygon first and
 * call this exact path again. The evaluator is reused only as a pure
 * ratio/FOV/apply-gate calculation; final camera application remains in the Lab.
 */
export function settleAfcFixedSeamCalibration(
  input: AfcFixedSeamCalibrationInput
): AfcFixedSeamCalibrationResult {
  if (!validPolygon(input.sourceNormalizedPolygon)) {
    return Object.freeze({ ok: false as const, reason: "invalid_polygon", evaluatedCellCount: 0, applySafeCellCount: 0 });
  }
  if (
    !Number.isFinite(input.frameSize.width) ||
    !Number.isFinite(input.frameSize.height) ||
    input.frameSize.width <= 0 ||
    input.frameSize.height <= 0 ||
    !Number.isFinite(input.sourceImageSize.width) ||
    !Number.isFinite(input.sourceImageSize.height) ||
    input.sourceImageSize.width <= 0 ||
    input.sourceImageSize.height <= 0
  ) {
    return Object.freeze({ ok: false as const, reason: "invalid_frame", evaluatedCellCount: 0, applySafeCellCount: 0 });
  }
  if (!Number.isFinite(input.referenceDepthM) || input.referenceDepthM <= 0) {
    return Object.freeze({ ok: false as const, reason: "invalid_reference_depth", evaluatedCellCount: 0, applySafeCellCount: 0 });
  }
  if (
    input.referenceDepthM < FLOOR_MAPPING_LIMITS.worldDepth.min ||
    input.referenceDepthM > FLOOR_MAPPING_LIMITS.worldDepth.max
  ) {
    return Object.freeze({ ok: false as const, reason: "metric_domain_rejected", evaluatedCellCount: 0, applySafeCellCount: 0 });
  }

  const crop = getCoverCrop(
    input.sourceImageSize,
    input.frameSize
  );
  if (!crop) {
    return Object.freeze({ ok: false as const, reason: "invalid_frame", evaluatedCellCount: 0, applySafeCellCount: 0 });
  }

  const framePolygon = input.sourceNormalizedPolygon.map((point) => ({
    x: point.x * input.sourceImageSize.width * crop.scale + crop.offsetX,
    y: point.y * input.sourceImageSize.height * crop.scale + crop.offsetY,
  })) as unknown as Polygon;
  const ratioSearch = input.ratioSearch ?? DEFAULT_RATIO_SEARCH;
  const fovSearch = input.fovSearch ?? DEFAULT_FOV_SEARCH;
  const coarseRatios = valuesInRange(ratioSearch.min, ratioSearch.max, ratioSearch.step);
  const coarseFovs = valuesInRange(fovSearch.minDeg, fovSearch.maxDeg, fovSearch.stepDeg);
  const coarse: RatioFovSuccessfulCell[] = [];
  let evaluatedCellCount = 0;

  const evaluate = (ratio: number, fovDeg: number) => {
    if (!metricDomainAllows(ratio, input.referenceDepthM)) return;
    evaluatedCellCount += 1;
    const cell = evaluateRatioFovCell({
      frameSize: input.frameSize,
      frameFloorPolygonPx: framePolygon,
      ratio,
      fovDeg,
      referenceDepth: input.referenceDepthM,
      // This is observability parity with the existing Apply thresholds. The
      // host independently verifies the live qualified original basis before
      // it can commit anything.
      researchBasisQualified: true,
    });
    if (cell.status === "success") coarse.push(cell);
  };

  for (const ratio of coarseRatios) {
    for (const fovDeg of coarseFovs) evaluate(ratio, fovDeg);
  }
  const coarseBest = [...coarse].sort(compareAfcFixedSeamCalibrationCells)[0];
  if (!coarseBest) {
    return Object.freeze({ ok: false as const, reason: "no_apply_safe_candidate", evaluatedCellCount, applySafeCellCount: 0 });
  }

  const refined: RatioFovSuccessfulCell[] = [];
  const refinedRatios = valuesInRange(
    Math.max(ratioSearch.min, coarseBest.ratio - ratioSearch.step),
    Math.min(ratioSearch.max, coarseBest.ratio + ratioSearch.step),
    REFINEMENT_RATIO_STEP
  );
  const refinedFovs = valuesInRange(
    Math.max(fovSearch.minDeg, coarseBest.fovDeg - fovSearch.stepDeg),
    Math.min(fovSearch.maxDeg, coarseBest.fovDeg + fovSearch.stepDeg),
    REFINEMENT_FOV_STEP_DEG
  );
  for (const ratio of refinedRatios) {
    for (const fovDeg of refinedFovs) {
      if (!metricDomainAllows(ratio, input.referenceDepthM)) continue;
      evaluatedCellCount += 1;
      const cell = evaluateRatioFovCell({
        frameSize: input.frameSize,
        frameFloorPolygonPx: framePolygon,
        ratio,
        fovDeg,
        referenceDepth: input.referenceDepthM,
        researchBasisQualified: true,
      });
      if (cell.status === "success") refined.push(cell);
    }
  }

  const ranked = [...coarse, ...refined].sort(compareAfcFixedSeamCalibrationCells);
  const winning = ranked.find((cell) => cell.applyObservability.available);
  const applySafeCellCount = ranked.filter((cell) => cell.applyObservability.available).length;
  if (!winning) {
    return Object.freeze({ ok: false as const, reason: "no_apply_safe_candidate", evaluatedCellCount, applySafeCellCount });
  }
  const worldWidthM = winning.ratio * input.referenceDepthM;
  if (!metricDomainAllows(winning.ratio, input.referenceDepthM)) {
    return Object.freeze({ ok: false as const, reason: "metric_domain_rejected", evaluatedCellCount, applySafeCellCount });
  }
  return Object.freeze({
    ok: true as const,
    widthDepthRatio: winning.ratio,
    referenceDepthM: input.referenceDepthM,
    worldWidthM,
    worldDepthM: input.referenceDepthM,
    verticalFovDeg: winning.fovDeg,
    winningCellId: cellId(winning),
    applyObservability: winning.applyObservability,
    evaluatedCellCount,
    applySafeCellCount,
  });
}
