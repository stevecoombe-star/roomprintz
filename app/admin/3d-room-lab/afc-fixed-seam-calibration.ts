import { FLOOR_MAPPING_LIMITS } from "./floor-math";
import { getCoverCrop, type ImageFrameSize } from "./image-space";
import {
  evaluateRatioFovCell,
  type RatioFovApplyObservability,
  type RatioFovCell,
  type RatioFovSuccessfulCell,
} from "./research/ratio-fov-harness";
import type {
  CalibratedCameraApplyFirstFailingGate,
} from "./calibrated-camera-apply";
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
  ratioExtensionDiagnostics?: AfcFixedSeamRatioExtensionDiagnostics;
}>;

export type AfcFixedSeamCalibrationBestRejectedCandidate = Readonly<{
  ratio: number;
  worldWidthM: number;
  verticalFovDeg: number;
  confidence: RatioFovSuccessfulCell["confidence"];
  cvAvgPx: number;
  cvMaxPx: number;
  displayAvgPx: number;
  displayMaxPx: number;
  avgDeltaPx: number;
  maxDeltaPx: number;
  scaleRatio: number;
  firstFailingGate: CalibratedCameraApplyFirstFailingGate;
  atRatioMin: boolean;
  atRatioMax: boolean;
  atFovMin: boolean;
  atFovMax: boolean;
}>;

export type AfcFixedSeamStructuralFailureCategory =
  | "floor_rect_failed"
  | "homography_solve_failed"
  | "homography_decomposition_failed"
  | "cv_reprojection_unavailable"
  | "display_reprojection_unavailable"
  | "other";

export type AfcFixedSeamCalibrationNoApplySafeDiagnostics = Readonly<{
  evaluatedCellCount: number;
  successfulCellCount: number;
  applySafeCellCount: number;
  structuralFailureCount: number;
  structuralFailureReasons: Readonly<
    Partial<Record<AfcFixedSeamStructuralFailureCategory, number>>
  >;
  rejectionCounts: Readonly<
    Partial<Record<CalibratedCameraApplyFirstFailingGate, number>>
  >;
  bestRejectedCandidate: AfcFixedSeamCalibrationBestRejectedCandidate | null;
}>;

export type AfcFixedSeamCalibrationResult =
  | AfcFixedSeamCalibrationSuccess
  | Readonly<{
      ok: false;
      reason: "no_apply_safe_candidate";
      evaluatedCellCount: number;
      applySafeCellCount: number;
      diagnostics: AfcFixedSeamCalibrationNoApplySafeDiagnostics;
    }>
  | Readonly<{
      ok: false;
      reason: Exclude<AfcFixedSeamCalibrationFailure, "no_apply_safe_candidate">;
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

export type AfcMetricAllowedRatioBounds = Readonly<{
  min: number;
  max: number;
}>;

export type AfcFixedSeamRatioExtensionDiagnostics = Readonly<{
  defaultRatioSearchMin: number;
  defaultRatioSearchMax: number;
  extendedRatioSearchMin: number;
  extendedRatioSearchMax: number;
  ratioExtensionApplied: true;
  extensionSide: "lower" | "upper";
  selectedRatio: number;
  referenceDepthM: number;
  worldWidthM: number;
  worldDepthM: number;
  baselineCvAvgPx: number;
  baselineCvMaxPx: number;
  firstFailingGate: CalibratedCameraApplyFirstFailingGate;
  atRatioMin: boolean;
  atRatioMax: boolean;
}>;

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

/**
 * Converts the existing metric Width limits into the canonical
 * width/depth-ratio domain for one fixed provisional reference depth.
 */
export function metricAllowedRatioBounds(
  referenceDepthM: number
): AfcMetricAllowedRatioBounds | null {
  if (!Number.isFinite(referenceDepthM) || referenceDepthM <= 0) return null;
  const min = FLOOR_MAPPING_LIMITS.worldWidth.min / referenceDepthM;
  const max = FLOOR_MAPPING_LIMITS.worldWidth.max / referenceDepthM;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  return Object.freeze({ min, max });
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
 * Diagnostic-only aggregation. Ratio/FOV evaluator failure strings remain
 * untouched because they are forensic detail, not a settle decision input.
 */
export function categorizeRatioFovStructuralFailure(
  reason: string
): AfcFixedSeamStructuralFailureCategory {
  if (reason.startsWith("widthMeters and depthMeters")) {
    return "floor_rect_failed";
  }
  if (reason.startsWith("Homography decomposition failed:")) {
    return "homography_decomposition_failed";
  }
  if (
    reason === "CV per-corner diagnostics unavailable." ||
    reason.startsWith("CV reprojection failed:")
  ) {
    return "cv_reprojection_unavailable";
  }
  if (
    reason === "Display reprojection diagnostics unavailable." ||
    reason.startsWith("Pose projection failed:")
  ) {
    return "display_reprojection_unavailable";
  }
  if (
    reason.startsWith("Homography solve failed") ||
    reason.startsWith("Solved homography") ||
    reason.startsWith("Point correspondences") ||
    reason.startsWith("Point sets") ||
    reason.includes("homography") ||
    reason.startsWith("Input points") ||
    reason.startsWith("Expected exactly 4 source")
  ) {
    return "homography_solve_failed";
  }
  return "other";
}

function bestRejectedCandidate(
  cell: RatioFovSuccessfulCell,
  input: AfcFixedSeamCalibrationInput,
  ratioSearch: Readonly<{ min: number; max: number; step: number }>,
  fovSearch: Readonly<{ minDeg: number; maxDeg: number; stepDeg: number }>
): AfcFixedSeamCalibrationBestRejectedCandidate {
  return Object.freeze({
    ratio: cell.ratio,
    worldWidthM: cell.ratio * input.referenceDepthM,
    verticalFovDeg: cell.fovDeg,
    confidence: cell.confidence,
    cvAvgPx: cell.cvAvgPx,
    cvMaxPx: cell.cvMaxPx,
    displayAvgPx: cell.applyObservability.displayAvgPx,
    displayMaxPx: cell.applyObservability.displayMaxPx,
    avgDeltaPx: cell.applyObservability.averageDeltaPx,
    maxDeltaPx: cell.applyObservability.maximumDeltaPx,
    scaleRatio: cell.columnScaleRatio,
    firstFailingGate: cell.applyObservability.firstFailingGate,
    atRatioMin: cell.ratio === ratioSearch.min,
    atRatioMax: cell.ratio === ratioSearch.max,
    atFovMin: cell.fovDeg === fovSearch.minDeg,
    atFovMax: cell.fovDeg === fovSearch.maxDeg,
  });
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
  let structuralFailureCount = 0;
  const structuralFailureReasons: Partial<
    Record<AfcFixedSeamStructuralFailureCategory, number>
  > = {};

  const evaluate = (
    ratio: number,
    fovDeg: number,
    successfulCells: RatioFovSuccessfulCell[]
  ) => {
    if (!metricDomainAllows(ratio, input.referenceDepthM)) return;
    evaluatedCellCount += 1;
    const cell: RatioFovCell = evaluateRatioFovCell({
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
    if (cell.status === "success") {
      successfulCells.push(cell);
      return;
    }
    structuralFailureCount += 1;
    const category = categorizeRatioFovStructuralFailure(cell.failureReason);
    structuralFailureReasons[category] =
      (structuralFailureReasons[category] ?? 0) + 1;
  };

  for (const ratio of coarseRatios) {
    for (const fovDeg of coarseFovs) evaluate(ratio, fovDeg, coarse);
  }
  const noApplySafeFailure = (
    successfulCells: readonly RatioFovSuccessfulCell[]
  ): AfcFixedSeamCalibrationResult => {
    const ranked = [...successfulCells].sort(
      compareAfcFixedSeamCalibrationCells
    );
    const rejectionCounts: Partial<
      Record<CalibratedCameraApplyFirstFailingGate, number>
    > = {};
    for (const cell of ranked) {
      if (cell.applyObservability.available) continue;
      const gate = cell.applyObservability.firstFailingGate;
      rejectionCounts[gate] = (rejectionCounts[gate] ?? 0) + 1;
    }
    const applySafeCellCount = ranked.filter(
      (cell) => cell.applyObservability.available
    ).length;
    return Object.freeze({
      ok: false as const,
      reason: "no_apply_safe_candidate" as const,
      evaluatedCellCount,
      applySafeCellCount,
      diagnostics: Object.freeze({
        evaluatedCellCount,
        successfulCellCount: ranked.length,
        applySafeCellCount,
        structuralFailureCount,
        structuralFailureReasons: Object.freeze({ ...structuralFailureReasons }),
        rejectionCounts: Object.freeze({ ...rejectionCounts }),
        bestRejectedCandidate: ranked[0]
          ? bestRejectedCandidate(ranked[0], input, ratioSearch, fovSearch)
          : null,
      }),
    });
  };
  const coarseBest = [...coarse].sort(compareAfcFixedSeamCalibrationCells)[0];
  if (!coarseBest) {
    return noApplySafeFailure([]);
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
      evaluate(ratio, fovDeg, refined);
    }
  }

  const ranked = [...coarse, ...refined].sort(compareAfcFixedSeamCalibrationCells);
  const winning = ranked.find((cell) => cell.applyObservability.available);
  const applySafeCellCount = ranked.filter((cell) => cell.applyObservability.available).length;
  if (!winning) {
    return noApplySafeFailure(ranked);
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

/**
 * Preserves the certified default settle as the first and normally only pass.
 * A second pass is available exclusively when its best rejected default cell
 * indicates that the viable realization is beyond a default ratio boundary.
 */
export function settleAfcFixedSeamCalibrationWithRatioExtension(
  input: AfcFixedSeamCalibrationInput
): AfcFixedSeamCalibrationResult {
  const baseline = settleAfcFixedSeamCalibration(input);
  if (
    baseline.ok ||
    input.ratioSearch !== undefined ||
    baseline.reason !== "no_apply_safe_candidate"
  ) {
    return baseline;
  }

  const bestRejected = baseline.diagnostics.bestRejectedCandidate;
  const metricBounds = metricAllowedRatioBounds(input.referenceDepthM);
  if (!bestRejected || !metricBounds) return baseline;

  const extension = bestRejected.atRatioMin && metricBounds.min < DEFAULT_RATIO_SEARCH.min
    ? {
        side: "lower" as const,
        ratioSearch: {
          min: metricBounds.min,
          // The refinement grid is 0.005 wide. Keep the extension disjoint
          // from the default domain while allowing its final basin to approach
          // the default boundary.
          max: DEFAULT_RATIO_SEARCH.min - REFINEMENT_RATIO_STEP,
          step: DEFAULT_RATIO_SEARCH.step,
        },
      }
    : bestRejected.atRatioMax && metricBounds.max > DEFAULT_RATIO_SEARCH.max
      ? {
          side: "upper" as const,
          ratioSearch: {
            min: DEFAULT_RATIO_SEARCH.max + REFINEMENT_RATIO_STEP,
            max: metricBounds.max,
            step: DEFAULT_RATIO_SEARCH.step,
          },
        }
      : null;
  if (!extension || extension.ratioSearch.min > extension.ratioSearch.max) return baseline;

  const extended = settleAfcFixedSeamCalibration({
    ...input,
    ratioSearch: extension.ratioSearch,
  });
  if (!extended.ok) return extended;

  return Object.freeze({
    ...extended,
    ratioExtensionDiagnostics: Object.freeze({
      defaultRatioSearchMin: DEFAULT_RATIO_SEARCH.min,
      defaultRatioSearchMax: DEFAULT_RATIO_SEARCH.max,
      extendedRatioSearchMin: extension.ratioSearch.min,
      extendedRatioSearchMax: extension.ratioSearch.max,
      ratioExtensionApplied: true,
      extensionSide: extension.side,
      selectedRatio: extended.widthDepthRatio,
      referenceDepthM: extended.referenceDepthM,
      worldWidthM: extended.worldWidthM,
      worldDepthM: extended.worldDepthM,
      baselineCvAvgPx: bestRejected.cvAvgPx,
      baselineCvMaxPx: bestRejected.cvMaxPx,
      firstFailingGate: bestRejected.firstFailingGate,
      atRatioMin: bestRejected.atRatioMin,
      atRatioMax: bestRejected.atRatioMax,
    }),
  });
}
