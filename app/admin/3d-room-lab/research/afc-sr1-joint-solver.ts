/**
 * AFC-SR1 S0 — deterministic semantic-hypothesis × seam × ratio × FOV solver.
 *
 * This is a research-only, pure geometry solver. Semantic evidence can order
 * work and add legal seam samples; it is intentionally absent from ranking.
 */
import {
  fingerprintAfcSr1SourcePolygon,
  pointOnAfcSr1NearToFarSeam,
  validateAfcSr1CanonicalNearToFarSeam,
  validateAfcSr1SourcePolygon,
  type AfcSr1Point,
  type AfcSr1SolverHandoffV1,
  type AfcSr1SourcePolygon,
  type AfcSr1ValidatedAdvisoryStatusV1,
} from "./afc-sr1-semantic-prior";
import { validateFloorSourcePolygonExtent } from "../floor-coordinate-extent";
import { getCoverCrop } from "../image-space";
import { canonicalizeRfc8785Jcs, sha256HexUtf8 } from "../gemini-evidence-contract";
import { validateOrderedFloorCorners } from "../perspective-solve";
import { evaluateRatioFovCell } from "./ratio-fov-harness";

export const AFC_SR1_JOINT_SOLVER_CONFIG_VERSION =
  "afc-sr1-joint-solver-config/v1" as const;
export const AFC_SR1_JOINT_SOLVER_ALGORITHM_VERSION =
  "afc-sr1-joint-solver-algorithm/v1" as const;
export const AFC_SR1_JOINT_SOLVER_RESULT_VERSION =
  "afc-sr1-joint-solver-result/v1" as const;
export const AFC_SR1_JOINT_SOLVER_TRACE_VERSION =
  "afc-sr1-joint-solver-trace/v1" as const;
export const AFC_SR1_JOINT_SOLVER_CONFIG_DIGEST_VERSION =
  "afc-sr1-joint-solver-config-digest/v1" as const;
export const AFC_SR1_JOINT_SOLVER_DIGEST_VERSION =
  "afc-sr1-joint-solver-digest/v1" as const;

const HYPOTHESES = ["none", "NL", "NR"] as const;
const SOURCE_EXTENT_EPSILON = 1e-12;

export type AfcSr1SolverHypothesisV1 = (typeof HYPOTHESES)[number];

export type AfcSr1JointSolverEvaluationContextV1 = Readonly<{
  schemaVersion: "afc-sr1-joint-solver-evaluation-context/v1";
  frameSize: Readonly<{ width: number; height: number }>;
  coverCropPolicy: "existing_image_space_cover_crop/v1";
  researchBasisQualified: true;
}>;

export type AfcSr1JointSolverConfigV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_JOINT_SOLVER_CONFIG_VERSION;
  algorithmVersion: typeof AFC_SR1_JOINT_SOLVER_ALGORITHM_VERSION;
  referenceDepthM: 1;
  ratioSearch: Readonly<{
    min: number;
    max: number;
    coarseStep: number;
    refineStep: number;
  }>;
  fovSearch: Readonly<{
    minDeg: number;
    maxDeg: number;
    coarseStepDeg: number;
    refineStepDeg: number;
  }>;
  seamSearch: Readonly<{
    globalMinExclusive: number;
    globalMaxExclusive: number;
    coarseStep: number;
    refineStep: number;
    advisoryDensificationStep: number;
  }>;
  semanticPriorPolicy: "search_order_and_densification_only/v1";
  candidateQualification: "existing_calibrated_camera_apply_gates/v1";
  tieBreakPolicy: "geometric_then_canonical_parameter_order/v1";
}>;

export type AfcSr1JointSearchCellV1 = Readonly<{
  hypothesis: AfcSr1SolverHypothesisV1;
  seamT: number | null;
  widthDepthRatio: number;
  verticalFovDeg: number;
}>;

export type AfcSr1JointCandidateRejectionReasonV1 =
  | "invalid_cell"
  | "invalid_seam_t"
  | "source_extent_failure"
  | "polygon_order_failure"
  | "degenerate_polygon"
  | "camera_solve_failed"
  | "ratio_fov_cell_invalid"
  | "apply_gate_unavailable";

export type AfcSr1JointSolverCandidateV1 = Readonly<{
  cell: AfcSr1JointSearchCellV1;
  sourceNormalizedPolygon: AfcSr1SourcePolygon;
  polygonFingerprint: string;
  referenceDepthM: 1;
  relativeWidthM: number;
  relativeDepthM: 1;
  metricScaleDeferred: true;
  camera: Readonly<{
    confidence: "high" | "low";
    cvAvgPx: number;
    cvMaxPx: number;
    displayAvgPx: number;
    displayMaxPx: number;
    columnScaleRatio: number;
  }>;
  applyGateObservability: Readonly<{
    available: boolean;
    firstFailingGate: string | null;
  }>;
}>;

export type AfcSr1JointSolverTraceV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_JOINT_SOLVER_TRACE_VERSION;
  evaluatedCellCount: number;
  rejectedCellCount: number;
  rejectedByReason: Readonly<Record<string, number>>;
  applySafeCellCount: number;
  hypothesisOrder: readonly AfcSr1SolverHypothesisV1[];
  advisoryStatus: AfcSr1ValidatedAdvisoryStatusV1;
  coarseBestByHypothesis: Readonly<Record<AfcSr1SolverHypothesisV1, AfcSr1JointSearchCellV1 | null>>;
  refinementSummary: Readonly<{
    seededHypotheses: readonly AfcSr1SolverHypothesisV1[];
    evaluatedCellCount: number;
  }>;
}>;

export type AfcSr1JointSolverResultV1 =
  | Readonly<{
      schemaVersion: typeof AFC_SR1_JOINT_SOLVER_RESULT_VERSION;
      status: "solved";
      candidate: AfcSr1JointSolverCandidateV1;
      diagnostics: AfcSr1JointSolverTraceV1;
      solverConfigDigest: string;
      solverDigest: string;
    }>
  | Readonly<{
      schemaVersion: typeof AFC_SR1_JOINT_SOLVER_RESULT_VERSION;
      status: "no_apply_safe_candidate" | "no_geometric_candidate";
      bestValidCandidate: AfcSr1JointSolverCandidateV1 | null;
      diagnostics: AfcSr1JointSolverTraceV1;
      solverConfigDigest: string;
      solverDigest: string;
    }>
  | Readonly<{
      schemaVersion: typeof AFC_SR1_JOINT_SOLVER_RESULT_VERSION;
      status: "invalid_input";
      reasonCode: string;
    }>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export const DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG: AfcSr1JointSolverConfigV1 = deepFreeze({
  schemaVersion: AFC_SR1_JOINT_SOLVER_CONFIG_VERSION,
  algorithmVersion: AFC_SR1_JOINT_SOLVER_ALGORITHM_VERSION,
  referenceDepthM: 1,
  ratioSearch: { min: 0.5, max: 2, coarseStep: 0.05, refineStep: 0.005 },
  fovSearch: { minDeg: 20, maxDeg: 90, coarseStepDeg: 1, refineStepDeg: 0.1 },
  seamSearch: {
    globalMinExclusive: 0,
    globalMaxExclusive: 1,
    coarseStep: 0.05,
    refineStep: 0.005,
    advisoryDensificationStep: 0.01,
  },
  semanticPriorPolicy: "search_order_and_densification_only/v1",
  candidateQualification: "existing_calibrated_camera_apply_gates/v1",
  tieBreakPolicy: "geometric_then_canonical_parameter_order/v1",
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function precision(value: number): number {
  return Number(value.toPrecision(14));
}

function freezePoint(point: AfcSr1Point): AfcSr1Point {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezePolygon(points: readonly AfcSr1Point[]): AfcSr1SourcePolygon {
  return Object.freeze(points.map(freezePoint) as unknown as AfcSr1SourcePolygon);
}

function equalPoint(left: AfcSr1Point, right: AfcSr1Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function sameHypothesis(value: unknown): value is AfcSr1SolverHypothesisV1 {
  return typeof value === "string" && (HYPOTHESES as readonly string[]).includes(value);
}

function configFailure(message: string): never {
  throw new Error(`AFC-SR1 joint solver config: ${message}`);
}

export function validateAfcSr1JointSolverConfig(
  config: AfcSr1JointSolverConfigV1
): asserts config is AfcSr1JointSolverConfigV1 {
  if (!isPlainRecord(config) || !hasExactKeys(config, [
    "schemaVersion", "algorithmVersion", "referenceDepthM", "ratioSearch", "fovSearch",
    "seamSearch", "semanticPriorPolicy", "candidateQualification", "tieBreakPolicy",
  ]) || !Object.isFrozen(config)) configFailure("shape_or_freeze_invalid");
  if (config.schemaVersion !== AFC_SR1_JOINT_SOLVER_CONFIG_VERSION ||
      config.algorithmVersion !== AFC_SR1_JOINT_SOLVER_ALGORITHM_VERSION ||
      config.referenceDepthM !== 1 ||
      config.semanticPriorPolicy !== "search_order_and_densification_only/v1" ||
      config.candidateQualification !== "existing_calibrated_camera_apply_gates/v1" ||
      config.tieBreakPolicy !== "geometric_then_canonical_parameter_order/v1") {
    configFailure("literal_values_invalid");
  }
  if (!isPlainRecord(config.ratioSearch) || !hasExactKeys(config.ratioSearch, ["min", "max", "coarseStep", "refineStep"]) ||
      !Object.isFrozen(config.ratioSearch) ||
      !finitePositive(config.ratioSearch.min) || !finitePositive(config.ratioSearch.max) ||
      !finitePositive(config.ratioSearch.coarseStep) || !finitePositive(config.ratioSearch.refineStep) ||
      config.ratioSearch.min >= config.ratioSearch.max || config.ratioSearch.min >= 1) {
    configFailure("ratio_search_invalid");
  }
  if (!isPlainRecord(config.fovSearch) || !hasExactKeys(config.fovSearch, ["minDeg", "maxDeg", "coarseStepDeg", "refineStepDeg"]) ||
      !Object.isFrozen(config.fovSearch) ||
      !finitePositive(config.fovSearch.coarseStepDeg) || !finitePositive(config.fovSearch.refineStepDeg) ||
      !Number.isFinite(config.fovSearch.minDeg) || !Number.isFinite(config.fovSearch.maxDeg) ||
      config.fovSearch.minDeg < 20 || config.fovSearch.maxDeg > 90 ||
      config.fovSearch.minDeg >= config.fovSearch.maxDeg) {
    configFailure("fov_search_invalid");
  }
  if (!isPlainRecord(config.seamSearch) || !hasExactKeys(config.seamSearch, [
    "globalMinExclusive", "globalMaxExclusive", "coarseStep", "refineStep", "advisoryDensificationStep",
  ]) || !Object.isFrozen(config.seamSearch) ||
      !finitePositive(config.seamSearch.coarseStep) || !finitePositive(config.seamSearch.refineStep) ||
      !finitePositive(config.seamSearch.advisoryDensificationStep) ||
      !Number.isFinite(config.seamSearch.globalMinExclusive) ||
      !Number.isFinite(config.seamSearch.globalMaxExclusive) ||
      config.seamSearch.globalMinExclusive < 0 || config.seamSearch.globalMaxExclusive > 1 ||
      config.seamSearch.globalMinExclusive >= config.seamSearch.globalMaxExclusive) {
    configFailure("seam_search_invalid");
  }
}

export function validateAfcSr1JointSolverEvaluationContext(
  context: AfcSr1JointSolverEvaluationContextV1
): asserts context is AfcSr1JointSolverEvaluationContextV1 {
  if (!isPlainRecord(context) || !hasExactKeys(context, [
    "schemaVersion", "frameSize", "coverCropPolicy", "researchBasisQualified",
  ]) ||
      context.schemaVersion !== "afc-sr1-joint-solver-evaluation-context/v1" ||
      context.coverCropPolicy !== "existing_image_space_cover_crop/v1" ||
      context.researchBasisQualified !== true ||
      !isPlainRecord(context.frameSize) || !hasExactKeys(context.frameSize, ["width", "height"]) ||
      !Number.isInteger(context.frameSize.width) || context.frameSize.width <= 0 ||
      !Number.isInteger(context.frameSize.height) || context.frameSize.height <= 0) {
    throw new Error("AFC-SR1 joint solver evaluation context: invalid");
  }
}

function validateHandoff(handoff: AfcSr1SolverHandoffV1): void {
  if (!isPlainRecord(handoff) || handoff.schemaVersion !== "afc-sr1-solver-handoff/v1" ||
      handoff.coordinateSpace !== "source-normalized/v1" ||
      handoff.bindingToken !== handoff.advisory?.bindingToken ||
      !/^sr1sbt1:[0-9a-f]{64}$/.test(handoff.bindingToken) ||
      !Array.isArray(handoff.semanticOrder) ||
      handoff.semanticOrder.join("|") !== "NL|NR|FR|FL" ||
      !Array.isArray(handoff.allowedHypotheses) ||
      handoff.allowedHypotheses.join("|") !== "none|NL|NR") {
    throw new Error("solver_handoff_shape_invalid");
  }
  validateAfcSr1SourcePolygon(handoff.rawSourcePolygon);
  if (handoff.rawSourcePolygonFingerprint !== fingerprintAfcSr1SourcePolygon(handoff.rawSourcePolygon)) {
    throw new Error("solver_handoff_polygon_fingerprint_invalid");
  }
  validateAfcSr1CanonicalNearToFarSeam(handoff.canonicalSeams.NL, handoff.rawSourcePolygon);
  validateAfcSr1CanonicalNearToFarSeam(handoff.canonicalSeams.NR, handoff.rawSourcePolygon);
  if (!handoff.originalTargetBasis ||
      !Number.isInteger(handoff.originalTargetBasis.decodedWidth) || handoff.originalTargetBasis.decodedWidth <= 0 ||
      !Number.isInteger(handoff.originalTargetBasis.decodedHeight) || handoff.originalTargetBasis.decodedHeight <= 0 ||
      handoff.originalTargetBasis.orientation !== 1 ||
      typeof handoff.advisory?.status !== "string" ||
      !["usable", "safe_abstention", "unsupported"].includes(handoff.advisory.status)) {
    throw new Error("solver_handoff_evidence_invalid");
  }
}

export function digestAfcSr1JointSolverConfig(config: AfcSr1JointSolverConfigV1): string {
  validateAfcSr1JointSolverConfig(config);
  return `sr1solvecfg1:${sha256HexUtf8(canonicalizeRfc8785Jcs(config))}`;
}

function valuesInRange(minimum: number, maximum: number, step: number, includeMin = true, includeMax = true): number[] {
  const last = Math.floor((maximum - minimum) / step + SOURCE_EXTENT_EPSILON);
  const values: number[] = [];
  for (let tick = 0; tick <= last; tick += 1) {
    const value = precision(minimum + tick * step);
    if ((includeMin ? value >= minimum - SOURCE_EXTENT_EPSILON : value > minimum + SOURCE_EXTENT_EPSILON) &&
        (includeMax ? value <= maximum + SOURCE_EXTENT_EPSILON : value < maximum - SOURCE_EXTENT_EPSILON)) {
      values.push(value);
    }
  }
  return values;
}

export function ratioCoarseTicks(config: AfcSr1JointSolverConfigV1): readonly number[] {
  validateAfcSr1JointSolverConfig(config);
  return Object.freeze(valuesInRange(config.ratioSearch.min, config.ratioSearch.max, config.ratioSearch.coarseStep));
}

export function ratioRefineTicks(config: AfcSr1JointSolverConfigV1, center: number): readonly number[] {
  validateAfcSr1JointSolverConfig(config);
  return Object.freeze(localValues(center, config.ratioSearch.coarseStep, config.ratioSearch.refineStep,
    config.ratioSearch.min, config.ratioSearch.max));
}

export function fovCoarseTicks(config: AfcSr1JointSolverConfigV1): readonly number[] {
  validateAfcSr1JointSolverConfig(config);
  return Object.freeze(valuesInRange(config.fovSearch.minDeg, config.fovSearch.maxDeg, config.fovSearch.coarseStepDeg));
}

export function fovRefineTicks(config: AfcSr1JointSolverConfigV1, center: number): readonly number[] {
  validateAfcSr1JointSolverConfig(config);
  return Object.freeze(localValues(center, config.fovSearch.coarseStepDeg, config.fovSearch.refineStepDeg,
    config.fovSearch.minDeg, config.fovSearch.maxDeg));
}

export function seamTGlobalTicks(config: AfcSr1JointSolverConfigV1): readonly number[] {
  validateAfcSr1JointSolverConfig(config);
  return Object.freeze(valuesInRange(
    config.seamSearch.globalMinExclusive,
    config.seamSearch.globalMaxExclusive,
    config.seamSearch.coarseStep,
    false,
    false
  ));
}

export function seamTAdvisoryDensificationTicks(
  config: AfcSr1JointSolverConfigV1,
  minSeamT: number,
  maxSeamT: number,
  preferredSeamT: number | null
): readonly number[] {
  validateAfcSr1JointSolverConfig(config);
  if (!Number.isFinite(minSeamT) || !Number.isFinite(maxSeamT) || minSeamT > maxSeamT) return Object.freeze([]);
  const min = Math.max(config.seamSearch.globalMinExclusive, minSeamT);
  const max = Math.min(config.seamSearch.globalMaxExclusive, maxSeamT);
  const values = valuesInRange(min, max, config.seamSearch.advisoryDensificationStep, true, true)
    .filter(value => isLegalSeamT(value, config));
  if (preferredSeamT !== null && isLegalSeamT(preferredSeamT, config)) values.push(precision(preferredSeamT));
  return Object.freeze(deduplicateNumbers(values));
}

function localValues(center: number, coarseStep: number, refineStep: number, minimum: number, maximum: number): number[] {
  if (!Number.isFinite(center)) return [];
  return valuesInRange(
    Math.max(minimum, center - coarseStep),
    Math.min(maximum, center + coarseStep),
    refineStep
  );
}

function deduplicateNumbers(values: readonly number[]): number[] {
  return [...new Set(values.map(precision))].sort((left, right) => left - right);
}

function isLegalSeamT(value: number, config: AfcSr1JointSolverConfigV1): boolean {
  return Number.isFinite(value) &&
    value > config.seamSearch.globalMinExclusive &&
    value < config.seamSearch.globalMaxExclusive;
}

function freezeCell(cell: AfcSr1JointSearchCellV1): AfcSr1JointSearchCellV1 {
  return Object.freeze({
    hypothesis: cell.hypothesis,
    seamT: cell.seamT === null ? null : precision(cell.seamT),
    widthDepthRatio: precision(cell.widthDepthRatio),
    verticalFovDeg: precision(cell.verticalFovDeg),
  });
}

function constructPolygon(
  handoff: AfcSr1SolverHandoffV1,
  cell: AfcSr1JointSearchCellV1
): AfcSr1SourcePolygon | AfcSr1JointCandidateRejectionReasonV1 {
  const raw = handoff.rawSourcePolygon;
  if (cell.hypothesis === "none") return freezePolygon(raw);
  if (cell.seamT === null) return "invalid_seam_t";
  const moved = pointOnAfcSr1NearToFarSeam(handoff.canonicalSeams[cell.hypothesis], cell.seamT);
  return cell.hypothesis === "NL"
    ? freezePolygon([moved, raw[1], raw[2], raw[3]])
    : freezePolygon([raw[0], moved, raw[2], raw[3]]);
}

function polygonRejection(polygon: AfcSr1SourcePolygon): AfcSr1JointCandidateRejectionReasonV1 | null {
  if (!validateFloorSourcePolygonExtent(polygon).ok) return "source_extent_failure";
  const [nl, nr, fr, fl] = polygon;
  if ((nl.y + nr.y) / 2 <= (fr.y + fl.y) / 2 || nl.x >= nr.x || fl.x >= fr.x) {
    return "polygon_order_failure";
  }
  const points = [nl, nr, fr, fl];
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      if (equalPoint(points[left]!, points[right]!)) return "degenerate_polygon";
    }
  }
  if (!validateOrderedFloorCorners(polygon.map(point => ({ ...point }))).ok) {
    return "degenerate_polygon";
  }
  return null;
}

function validCell(cell: AfcSr1JointSearchCellV1, config: AfcSr1JointSolverConfigV1): boolean {
  if (!sameHypothesis(cell.hypothesis) ||
      !finitePositive(cell.widthDepthRatio) ||
      !Number.isFinite(cell.verticalFovDeg) ||
      cell.widthDepthRatio < config.ratioSearch.min - SOURCE_EXTENT_EPSILON ||
      cell.widthDepthRatio > config.ratioSearch.max + SOURCE_EXTENT_EPSILON ||
      cell.verticalFovDeg < config.fovSearch.minDeg - SOURCE_EXTENT_EPSILON ||
      cell.verticalFovDeg > config.fovSearch.maxDeg + SOURCE_EXTENT_EPSILON) return false;
  return cell.hypothesis === "none" ? cell.seamT === null : cell.seamT !== null && isLegalSeamT(cell.seamT, config);
}

export function evaluateAfcSr1JointCandidate(input: Readonly<{
  solverHandoff: AfcSr1SolverHandoffV1;
  evaluationContext: AfcSr1JointSolverEvaluationContextV1;
  cell: AfcSr1JointSearchCellV1;
  config: AfcSr1JointSolverConfigV1;
}>):
  | Readonly<{ ok: true; candidate: AfcSr1JointSolverCandidateV1 }>
  | Readonly<{ ok: false; reasonCode: AfcSr1JointCandidateRejectionReasonV1 }> {
  if (!validCell(input.cell, input.config)) return Object.freeze({ ok: false as const, reasonCode: "invalid_cell" as const });
  const polygon = constructPolygon(input.solverHandoff, input.cell);
  if (typeof polygon === "string") return Object.freeze({ ok: false as const, reasonCode: polygon });
  const invalidPolygon = polygonRejection(polygon);
  if (invalidPolygon) return Object.freeze({ ok: false as const, reasonCode: invalidPolygon });

  const crop = getCoverCrop(
    { width: input.solverHandoff.originalTargetBasis.decodedWidth, height: input.solverHandoff.originalTargetBasis.decodedHeight },
    input.evaluationContext.frameSize
  );
  if (!crop) return Object.freeze({ ok: false as const, reasonCode: "camera_solve_failed" as const });
  const frameFloorPolygonPx = polygon.map(point => Object.freeze({
    x: point.x * input.solverHandoff.originalTargetBasis.decodedWidth * crop.scale + crop.offsetX,
    y: point.y * input.solverHandoff.originalTargetBasis.decodedHeight * crop.scale + crop.offsetY,
  })) as unknown as readonly [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const evaluated = evaluateRatioFovCell({
    frameSize: input.evaluationContext.frameSize,
    frameFloorPolygonPx,
    ratio: input.cell.widthDepthRatio,
    fovDeg: input.cell.verticalFovDeg,
    referenceDepth: input.config.referenceDepthM,
    researchBasisQualified: input.evaluationContext.researchBasisQualified,
  });
  if (evaluated.status !== "success") {
    return Object.freeze({ ok: false as const, reasonCode: "camera_solve_failed" as const });
  }
  if (!Number.isFinite(evaluated.cvAvgPx) || !Number.isFinite(evaluated.cvMaxPx) ||
      !Number.isFinite(evaluated.applyObservability.displayAvgPx) ||
      !Number.isFinite(evaluated.applyObservability.displayMaxPx) ||
      !Number.isFinite(evaluated.columnScaleRatio)) {
    return Object.freeze({ ok: false as const, reasonCode: "ratio_fov_cell_invalid" as const });
  }
  return Object.freeze({
    ok: true as const,
    candidate: Object.freeze({
      cell: freezeCell(input.cell),
      sourceNormalizedPolygon: polygon,
      polygonFingerprint: fingerprintAfcSr1SourcePolygon(polygon),
      referenceDepthM: 1 as const,
      relativeWidthM: precision(input.cell.widthDepthRatio),
      relativeDepthM: 1 as const,
      metricScaleDeferred: true as const,
      camera: Object.freeze({
        confidence: evaluated.confidence,
        cvAvgPx: evaluated.cvAvgPx,
        cvMaxPx: evaluated.cvMaxPx,
        displayAvgPx: evaluated.applyObservability.displayAvgPx,
        displayMaxPx: evaluated.applyObservability.displayMaxPx,
        columnScaleRatio: evaluated.columnScaleRatio,
      }),
      applyGateObservability: Object.freeze({
        available: evaluated.applyObservability.available,
        firstFailingGate: evaluated.applyObservability.firstFailingGate === "none"
          ? null
          : evaluated.applyObservability.firstFailingGate,
      }),
    }),
  });
}

function hypothesisOrdinal(hypothesis: AfcSr1SolverHypothesisV1): number {
  return HYPOTHESES.indexOf(hypothesis);
}

/**
 * Geometric-only final ordering. No semantic property is accepted or read.
 */
export function rankAfcSr1JointSolverCandidates(
  candidates: readonly AfcSr1JointSolverCandidateV1[]
): readonly AfcSr1JointSolverCandidateV1[] {
  return Object.freeze([...candidates].sort((left, right) => {
    if (left.applyGateObservability.available !== right.applyGateObservability.available) {
      return left.applyGateObservability.available ? -1 : 1;
    }
    if (left.camera.confidence !== right.camera.confidence) return left.camera.confidence === "high" ? -1 : 1;
    if (left.camera.cvAvgPx !== right.camera.cvAvgPx) return left.camera.cvAvgPx - right.camera.cvAvgPx;
    if (left.camera.cvMaxPx !== right.camera.cvMaxPx) return left.camera.cvMaxPx - right.camera.cvMaxPx;
    if (left.cell.hypothesis !== right.cell.hypothesis) return hypothesisOrdinal(left.cell.hypothesis) - hypothesisOrdinal(right.cell.hypothesis);
    if (left.cell.seamT !== right.cell.seamT) return (left.cell.seamT ?? -1) - (right.cell.seamT ?? -1);
    if (left.cell.widthDepthRatio !== right.cell.widthDepthRatio) return left.cell.widthDepthRatio - right.cell.widthDepthRatio;
    return left.cell.verticalFovDeg - right.cell.verticalFovDeg;
  }));
}

function hypothesisOrder(handoff: AfcSr1SolverHandoffV1): readonly AfcSr1SolverHypothesisV1[] {
  if (handoff.advisory.status !== "usable" || !handoff.advisory.rankedHypotheses) return Object.freeze([...HYPOTHESES]);
  const ranked = handoff.advisory.rankedHypotheses.map(item => item.hypothesis);
  if (ranked.length !== 3 || new Set(ranked).size !== 3 || !ranked.every(sameHypothesis)) return Object.freeze([...HYPOTHESES]);
  return Object.freeze([...ranked] as AfcSr1SolverHypothesisV1[]);
}

export function seamTSamplesForHypothesis(
  handoff: AfcSr1SolverHandoffV1,
  hypothesis: AfcSr1SolverHypothesisV1,
  config: AfcSr1JointSolverConfigV1
): readonly number[] {
  const global = seamTGlobalTicks(config);
  if (hypothesis === "none" || handoff.advisory.status !== "usable" ||
      handoff.advisory.seamTPrior?.adjustableCorner !== hypothesis) return global;
  const prior = handoff.advisory.seamTPrior;
  return Object.freeze(deduplicateNumbers([
    ...global,
    ...seamTAdvisoryDensificationTicks(config, prior.minSeamT, prior.maxSeamT, prior.preferredSeamT),
  ]));
}

function solverDigest(input: Readonly<{
  handoff: AfcSr1SolverHandoffV1;
  context: AfcSr1JointSolverEvaluationContextV1;
  configDigest: string;
  result: Exclude<AfcSr1JointSolverResultV1, Readonly<{ status: "invalid_input"; reasonCode: string }>>;
}>): string {
  const winner = input.result.status === "solved" ? input.result.candidate : input.result.bestValidCandidate;
  const preimage = {
    digestSchemaVersion: AFC_SR1_JOINT_SOLVER_DIGEST_VERSION,
    algorithmVersion: AFC_SR1_JOINT_SOLVER_ALGORITHM_VERSION,
    handoffBindingToken: input.handoff.bindingToken,
    rawPolygonFingerprint: input.handoff.rawSourcePolygonFingerprint,
    advisoryDigest: sha256HexUtf8(canonicalizeRfc8785Jcs(input.handoff.advisory)),
    evaluationContext: input.context,
    solverConfigDigest: input.configDigest,
    resultStatus: input.result.status,
    winner: winner ? {
      cell: winner.cell,
      polygonFingerprint: winner.polygonFingerprint,
      cvAvgPx: winner.camera.cvAvgPx,
      cvMaxPx: winner.camera.cvMaxPx,
      displayAvgPx: winner.camera.displayAvgPx,
      displayMaxPx: winner.camera.displayMaxPx,
      applySafe: winner.applyGateObservability.available,
    } : null,
    trace: input.result.diagnostics,
  };
  return `sr1solve1:${sha256HexUtf8(canonicalizeRfc8785Jcs(preimage))}`;
}

export function solveAfcSr1JointCalibration(input: Readonly<{
  solverHandoff: AfcSr1SolverHandoffV1;
  evaluationContext: AfcSr1JointSolverEvaluationContextV1;
  config?: AfcSr1JointSolverConfigV1;
}>): AfcSr1JointSolverResultV1 {
  const config = input.config ?? DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG;
  try {
    validateAfcSr1JointSolverConfig(config);
    validateAfcSr1JointSolverEvaluationContext(input.evaluationContext);
    validateHandoff(input.solverHandoff);
  } catch (error) {
    return Object.freeze({
      schemaVersion: AFC_SR1_JOINT_SOLVER_RESULT_VERSION,
      status: "invalid_input" as const,
      reasonCode: error instanceof Error ? error.message.replace(/^.*: /, "") : "validation_failed",
    });
  }

  const order = hypothesisOrder(input.solverHandoff);
  const configDigest = digestAfcSr1JointSolverConfig(config);
  const coarseBest = new Map<AfcSr1SolverHypothesisV1, AfcSr1JointSolverCandidateV1>();
  const seen = new Set<string>();
  const rejectedByReason: Record<string, number> = {};
  let evaluatedCellCount = 0;
  let rejectedCellCount = 0;
  let applySafeCellCount = 0;
  let refinementEvaluatedCellCount = 0;
  let bestValid: AfcSr1JointSolverCandidateV1 | null = null;
  let bestApplySafe: AfcSr1JointSolverCandidateV1 | null = null;

  const consider = (
    cell: AfcSr1JointSearchCellV1,
    phase: "coarse" | "refine"
  ): AfcSr1JointSolverCandidateV1 | null => {
    const polygon = constructPolygon(input.solverHandoff, cell);
    const fingerprint = typeof polygon === "string" ? null : fingerprintAfcSr1SourcePolygon(polygon);
    const identity = fingerprint === null ? null : `${fingerprint}|${precision(cell.widthDepthRatio)}|${precision(cell.verticalFovDeg)}`;
    if (identity && seen.has(identity)) return null;
    if (identity) seen.add(identity);
    evaluatedCellCount += 1;
    if (phase === "refine") refinementEvaluatedCellCount += 1;
    const result = evaluateAfcSr1JointCandidate({
      solverHandoff: input.solverHandoff,
      evaluationContext: input.evaluationContext,
      cell,
      config,
    });
    if (!result.ok) {
      rejectedCellCount += 1;
      rejectedByReason[result.reasonCode] = (rejectedByReason[result.reasonCode] ?? 0) + 1;
      return null;
    }
    const candidate = result.candidate;
    if (candidate.applyGateObservability.available) applySafeCellCount += 1;
    const currentCoarse = coarseBest.get(candidate.cell.hypothesis);
    if (phase === "coarse" && (!currentCoarse || rankAfcSr1JointSolverCandidates([candidate, currentCoarse])[0] === candidate)) {
      coarseBest.set(candidate.cell.hypothesis, candidate);
    }
    if (!bestValid || rankAfcSr1JointSolverCandidates([candidate, bestValid])[0] === candidate) bestValid = candidate;
    if (candidate.applyGateObservability.available &&
        (!bestApplySafe || rankAfcSr1JointSolverCandidates([candidate, bestApplySafe])[0] === candidate)) {
      bestApplySafe = candidate;
    }
    return candidate;
  };

  const coarseRatios = ratioCoarseTicks(config);
  const coarseFovs = fovCoarseTicks(config);
  const evaluateGrid = (
    hypothesis: AfcSr1SolverHypothesisV1,
    seams: readonly (number | null)[],
    ratios: readonly number[],
    fovs: readonly number[],
    phase: "coarse" | "refine"
  ) => {
    for (const seamT of seams) {
      for (const widthDepthRatio of ratios) {
        for (const verticalFovDeg of fovs) {
          consider(Object.freeze({ hypothesis, seamT, widthDepthRatio, verticalFovDeg }), phase);
        }
      }
    }
  };

  // The raw candidate is intentionally independent of the semantic ordering.
  evaluateGrid("none", [null], coarseRatios, coarseFovs, "coarse");
  for (const hypothesis of order) {
    if (hypothesis !== "none") {
      evaluateGrid(hypothesis, seamTSamplesForHypothesis(input.solverHandoff, hypothesis, config), coarseRatios, coarseFovs, "coarse");
    }
  }

  const seededHypotheses: AfcSr1SolverHypothesisV1[] = [];
  for (const hypothesis of HYPOTHESES) {
    const seed = coarseBest.get(hypothesis);
    if (!seed) continue;
    seededHypotheses.push(hypothesis);
    const seams = hypothesis === "none"
      ? [null]
      : localValues(
        seed.cell.seamT!,
        config.seamSearch.coarseStep,
        config.seamSearch.refineStep,
        config.seamSearch.globalMinExclusive,
        config.seamSearch.globalMaxExclusive
      ).filter(value => isLegalSeamT(value, config));
    evaluateGrid(
      hypothesis,
      seams,
      ratioRefineTicks(config, seed.cell.widthDepthRatio),
      fovRefineTicks(config, seed.cell.verticalFovDeg),
      "refine"
    );
  }

  const diagnostics: AfcSr1JointSolverTraceV1 = deepFreeze({
    schemaVersion: AFC_SR1_JOINT_SOLVER_TRACE_VERSION,
    evaluatedCellCount,
    rejectedCellCount,
    rejectedByReason: { ...rejectedByReason },
    applySafeCellCount,
    hypothesisOrder: [...order],
    advisoryStatus: input.solverHandoff.advisory.status,
    coarseBestByHypothesis: {
      none: coarseBest.get("none")?.cell ?? null,
      NL: coarseBest.get("NL")?.cell ?? null,
      NR: coarseBest.get("NR")?.cell ?? null,
    },
    refinementSummary: {
      seededHypotheses,
      evaluatedCellCount: refinementEvaluatedCellCount,
    },
  });
  const status = bestApplySafe ? "solved" : bestValid ? "no_apply_safe_candidate" : "no_geometric_candidate";
  const result = status === "solved"
    ? {
        schemaVersion: AFC_SR1_JOINT_SOLVER_RESULT_VERSION,
        status: "solved" as const,
        candidate: bestApplySafe!,
        diagnostics,
        solverConfigDigest: configDigest,
      }
    : {
        schemaVersion: AFC_SR1_JOINT_SOLVER_RESULT_VERSION,
        status,
        bestValidCandidate: bestValid,
        diagnostics,
        solverConfigDigest: configDigest,
      };
  return deepFreeze({
    ...result,
    solverDigest: solverDigest({
      handoff: input.solverHandoff,
      context: input.evaluationContext,
      configDigest,
      result: result as Exclude<AfcSr1JointSolverResultV1, Readonly<{ status: "invalid_input"; reasonCode: string }>>,
    }),
  }) as AfcSr1JointSolverResultV1;
}
