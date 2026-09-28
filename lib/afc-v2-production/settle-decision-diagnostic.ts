/**
 * AFR-3A settle-decision diagnostic contract.
 *
 * Whitelists facts the fixed-seam settle result already carries.
 * It does not rank cells, apply gates, or change acceptance.
 */

import type { AfcFixedSeamCalibrationResult } from "@/app/admin/3d-room-lab/afc-fixed-seam-calibration";

export const AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION =
  "afc-v2-settle-decision-diagnostic/v1" as const;

export const AFC_V2_SETTLE_DECISION_GATES = [
  "basis",
  "no-candidate",
  "confidence",
  "cv-avg",
  "cv-max",
  "display-unavailable",
  "display-avg",
  "display-max",
  "delta-avg",
  "delta-max",
  "scale-ratio",
  "frame-size",
  "none",
] as const;

export type AfcV2SettleDecisionGate = (typeof AFC_V2_SETTLE_DECISION_GATES)[number];

export const AFC_V2_SETTLE_DECISION_STRUCTURAL_REASONS = [
  "floor_rect_failed",
  "homography_solve_failed",
  "homography_decomposition_failed",
  "cv_reprojection_unavailable",
  "display_reprojection_unavailable",
  "other",
] as const;

export type AfcV2SettleDecisionStructuralReason =
  (typeof AFC_V2_SETTLE_DECISION_STRUCTURAL_REASONS)[number];

export const AFC_V2_SETTLE_DECISION_FAILURE_REASONS = [
  "invalid_polygon",
  "invalid_frame",
  "invalid_reference_depth",
  "metric_domain_rejected",
  "no_apply_safe_candidate",
] as const;

export type AfcV2SettleDecisionFailureReason =
  (typeof AFC_V2_SETTLE_DECISION_FAILURE_REASONS)[number];

export const AFC_V2_SETTLE_DECISION_CONFIDENCE = ["high", "low"] as const;

export type AfcV2SettleDecisionConfidence =
  (typeof AFC_V2_SETTLE_DECISION_CONFIDENCE)[number];

export type AfcV2SettleDecisionPoint = Readonly<{ x: number; y: number }>;

export type AfcV2SettleDecisionPolygon = readonly [
  AfcV2SettleDecisionPoint,
  AfcV2SettleDecisionPoint,
  AfcV2SettleDecisionPoint,
  AfcV2SettleDecisionPoint,
];

export type AfcV2SettleDecisionCountMap<K extends string> = Readonly<
  Partial<Record<K, number>>
>;

export type AfcV2SettleDecisionBestRejectedCandidate = Readonly<{
  ratio: number;
  verticalFovDeg: number;
  confidence: AfcV2SettleDecisionConfidence;
  cvAvgPx: number;
  cvMaxPx: number;
  scaleRatio: number;
  firstFailingGate: AfcV2SettleDecisionGate;
  atFovMin: boolean;
  atFovMax: boolean;
  atRatioMin: boolean;
  atRatioMax: boolean;
}>;

export type AfcV2SettleDecisionWinningCandidate = Readonly<{
  widthDepthRatio: number;
  verticalFovDeg: number;
  winningCellId: string;
  firstFailingGate: AfcV2SettleDecisionGate;
  displayAvgPx: number;
  displayMaxPx: number;
}>;

export type AfcV2SettleDecisionNotReachedV1 = Readonly<{
  schemaVersion: typeof AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION;
  reached: false;
}>;

export type AfcV2SettleDecisionRecordedV1 = Readonly<{
  schemaVersion: typeof AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION;
  reached: true;
  result: Readonly<{
    ok: boolean;
    reason: AfcV2SettleDecisionFailureReason | null;
  }>;
  evaluatedCellCount: number;
  successfulCellCount: number | null;
  applySafeCellCount: number;
  structuralFailureCount: number | null;
  structuralFailureReasons: AfcV2SettleDecisionCountMap<AfcV2SettleDecisionStructuralReason> | null;
  rejectionCounts: AfcV2SettleDecisionCountMap<AfcV2SettleDecisionGate> | null;
  ratioExtensionAttempted: boolean;
  bestRejectedCandidate: AfcV2SettleDecisionBestRejectedCandidate | null;
  winningCandidate: AfcV2SettleDecisionWinningCandidate | null;
  sourceNormalizedPolygon: AfcV2SettleDecisionPolygon;
}>;

export type AfcV2SettleDecisionUnsupportedSchema = Readonly<{
  kind: "unsupported_schema";
  schemaVersion: string;
}>;

export type AfcV2SettleDecisionPersistedValue =
  | null
  | AfcV2SettleDecisionNotReachedV1
  | AfcV2SettleDecisionRecordedV1
  | AfcV2SettleDecisionUnsupportedSchema;

export type AfcV2SettleDecisionParseResult =
  | Readonly<{ ok: true; decision: AfcV2SettleDecisionPersistedValue }>
  | Readonly<{ ok: false; reason: string }>;

const RECORDED_KEYS = [
  "schemaVersion",
  "reached",
  "result",
  "evaluatedCellCount",
  "successfulCellCount",
  "applySafeCellCount",
  "structuralFailureCount",
  "structuralFailureReasons",
  "rejectionCounts",
  "ratioExtensionAttempted",
  "bestRejectedCandidate",
  "winningCandidate",
  "sourceNormalizedPolygon",
] as const;

const BEST_REJECTED_KEYS = [
  "ratio",
  "verticalFovDeg",
  "confidence",
  "cvAvgPx",
  "cvMaxPx",
  "scaleRatio",
  "firstFailingGate",
  "atFovMin",
  "atFovMax",
  "atRatioMin",
  "atRatioMax",
] as const;

const WINNING_KEYS = [
  "widthDepthRatio",
  "verticalFovDeg",
  "winningCellId",
  "firstFailingGate",
  "displayAvgPx",
  "displayMaxPx",
] as const;

const WINNING_CELL_ID = /^ratio=\d+\.\d{3};fov=\d+\.\d$/;

export class AfcV2SettleDecisionCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AfcV2SettleDecisionCaptureError";
  }
}

export function afcV2SettleDecisionNotReached(): AfcV2SettleDecisionNotReachedV1 {
  return Object.freeze({
    schemaVersion: AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    reached: false as const,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => hasOwn(value, key));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function nullableInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return nonNegativeInteger(value) ?? undefined;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

function projectCountMap<K extends string>(
  value: Partial<Record<K, number>> | null,
  keys: readonly K[],
): AfcV2SettleDecisionCountMap<K> | null {
  if (value == null) return null;
  const projected: Partial<Record<K, number>> = {};
  for (const key of Object.keys(value)) {
    if (!keys.includes(key as K)) {
      throw new AfcV2SettleDecisionCaptureError("settle_count_invalid");
    }
  }
  for (const key of keys) {
    if (!hasOwn(value, key)) continue;
    const count = value[key];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new AfcV2SettleDecisionCaptureError("settle_count_invalid");
    }
    if (count > 0) projected[key] = count;
  }
  return Object.freeze(projected);
}

function parseCountMap<K extends string>(
  value: unknown,
  keys: readonly K[],
): AfcV2SettleDecisionCountMap<K> | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const parsed: Partial<Record<K, number>> = {};
  for (const key of Object.keys(value)) {
    if (!keys.includes(key as K)) return undefined;
    const count = nonNegativeInteger(value[key]);
    if (count == null || count === 0) return undefined;
    parsed[key as K] = count;
  }
  const ordered: Partial<Record<K, number>> = {};
  for (const key of keys) {
    if (parsed[key] != null) ordered[key] = parsed[key];
  }
  return Object.freeze(ordered);
}

function projectPolygon(
  points: readonly { x: number; y: number }[],
): AfcV2SettleDecisionPolygon {
  if (points.length !== 4) {
    throw new AfcV2SettleDecisionCaptureError("settle_polygon_invalid");
  }
  const projected = points.map((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new AfcV2SettleDecisionCaptureError("settle_polygon_invalid");
    }
    return Object.freeze({ x: point.x, y: point.y });
  });
  return Object.freeze([
    projected[0],
    projected[1],
    projected[2],
    projected[3],
  ]) as AfcV2SettleDecisionPolygon;
}

function parsePolygon(value: unknown): AfcV2SettleDecisionPolygon | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points = value.map((point) => {
    if (!isRecord(point) || !exactKeys(point, ["x", "y"])) return null;
    const x = finiteNumber(point.x);
    const y = finiteNumber(point.y);
    if (x == null || y == null) return null;
    return Object.freeze({ x, y });
  });
  if (points.some((point) => point == null)) return null;
  return Object.freeze(points) as AfcV2SettleDecisionPolygon;
}

function projectBestRejected(
  candidate: AfcFixedSeamCalibrationResult extends infer _ ? {
    ratio: number;
    verticalFovDeg: number;
    confidence: "high" | "low";
    cvAvgPx: number;
    cvMaxPx: number;
    scaleRatio: number;
    firstFailingGate: string;
    atFovMin: boolean;
    atFovMax: boolean;
    atRatioMin: boolean;
    atRatioMax: boolean;
  } | null : never,
): AfcV2SettleDecisionBestRejectedCandidate | null {
  if (!candidate) return null;
  const ratio = finiteNumber(candidate.ratio);
  const verticalFovDeg = finiteNumber(candidate.verticalFovDeg);
  const confidence = member(candidate.confidence, AFC_V2_SETTLE_DECISION_CONFIDENCE);
  const cvAvgPx = finiteNumber(candidate.cvAvgPx);
  const cvMaxPx = finiteNumber(candidate.cvMaxPx);
  const scaleRatio = finiteNumber(candidate.scaleRatio);
  const firstFailingGate = member(candidate.firstFailingGate, AFC_V2_SETTLE_DECISION_GATES);
  if (
    ratio == null ||
    verticalFovDeg == null ||
    !confidence ||
    cvAvgPx == null ||
    cvMaxPx == null ||
    scaleRatio == null ||
    !firstFailingGate ||
    typeof candidate.atFovMin !== "boolean" ||
    typeof candidate.atFovMax !== "boolean" ||
    typeof candidate.atRatioMin !== "boolean" ||
    typeof candidate.atRatioMax !== "boolean"
  ) {
    throw new AfcV2SettleDecisionCaptureError("settle_candidate_invalid");
  }
  return Object.freeze({
    ratio,
    verticalFovDeg,
    confidence,
    cvAvgPx,
    cvMaxPx,
    scaleRatio,
    firstFailingGate,
    atFovMin: candidate.atFovMin,
    atFovMax: candidate.atFovMax,
    atRatioMin: candidate.atRatioMin,
    atRatioMax: candidate.atRatioMax,
  });
}

function parseBestRejected(
  value: unknown,
): AfcV2SettleDecisionBestRejectedCandidate | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, BEST_REJECTED_KEYS)) return undefined;
  const ratio = finiteNumber(value.ratio);
  const verticalFovDeg = finiteNumber(value.verticalFovDeg);
  const confidence = member(value.confidence, AFC_V2_SETTLE_DECISION_CONFIDENCE);
  const cvAvgPx = finiteNumber(value.cvAvgPx);
  const cvMaxPx = finiteNumber(value.cvMaxPx);
  const scaleRatio = finiteNumber(value.scaleRatio);
  const firstFailingGate = member(value.firstFailingGate, AFC_V2_SETTLE_DECISION_GATES);
  if (
    ratio == null ||
    verticalFovDeg == null ||
    !confidence ||
    cvAvgPx == null ||
    cvMaxPx == null ||
    scaleRatio == null ||
    !firstFailingGate ||
    typeof value.atFovMin !== "boolean" ||
    typeof value.atFovMax !== "boolean" ||
    typeof value.atRatioMin !== "boolean" ||
    typeof value.atRatioMax !== "boolean"
  ) {
    return undefined;
  }
  return Object.freeze({
    ratio,
    verticalFovDeg,
    confidence,
    cvAvgPx,
    cvMaxPx,
    scaleRatio,
    firstFailingGate,
    atFovMin: value.atFovMin,
    atFovMax: value.atFovMax,
    atRatioMin: value.atRatioMin,
    atRatioMax: value.atRatioMax,
  });
}

function projectWinning(
  settle: Extract<AfcFixedSeamCalibrationResult, { ok: true }>,
): AfcV2SettleDecisionWinningCandidate {
  const widthDepthRatio = finiteNumber(settle.widthDepthRatio);
  const verticalFovDeg = finiteNumber(settle.verticalFovDeg);
  const firstFailingGate = member(
    settle.applyObservability.firstFailingGate,
    AFC_V2_SETTLE_DECISION_GATES,
  );
  const displayAvgPx = finiteNumber(settle.applyObservability.displayAvgPx);
  const displayMaxPx = finiteNumber(settle.applyObservability.displayMaxPx);
  if (
    widthDepthRatio == null ||
    verticalFovDeg == null ||
    !firstFailingGate ||
    displayAvgPx == null ||
    displayMaxPx == null ||
    !WINNING_CELL_ID.test(settle.winningCellId)
  ) {
    throw new AfcV2SettleDecisionCaptureError("settle_winner_invalid");
  }
  return Object.freeze({
    widthDepthRatio,
    verticalFovDeg,
    winningCellId: settle.winningCellId,
    firstFailingGate,
    displayAvgPx,
    displayMaxPx,
  });
}

function parseWinning(
  value: unknown,
): AfcV2SettleDecisionWinningCandidate | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, WINNING_KEYS)) return undefined;
  const widthDepthRatio = finiteNumber(value.widthDepthRatio);
  const verticalFovDeg = finiteNumber(value.verticalFovDeg);
  const firstFailingGate = member(value.firstFailingGate, AFC_V2_SETTLE_DECISION_GATES);
  const displayAvgPx = finiteNumber(value.displayAvgPx);
  const displayMaxPx = finiteNumber(value.displayMaxPx);
  if (
    widthDepthRatio == null ||
    verticalFovDeg == null ||
    typeof value.winningCellId !== "string" ||
    !WINNING_CELL_ID.test(value.winningCellId) ||
    !firstFailingGate ||
    displayAvgPx == null ||
    displayMaxPx == null
  ) {
    return undefined;
  }
  return Object.freeze({
    widthDepthRatio,
    verticalFovDeg,
    winningCellId: value.winningCellId,
    firstFailingGate,
    displayAvgPx,
    displayMaxPx,
  });
}

function retainedCounts(settle: AfcFixedSeamCalibrationResult): Readonly<{
  successfulCellCount: number | null;
  structuralFailureCount: number | null;
  structuralFailureReasons: AfcV2SettleDecisionCountMap<AfcV2SettleDecisionStructuralReason> | null;
  rejectionCounts: AfcV2SettleDecisionCountMap<AfcV2SettleDecisionGate> | null;
  bestRejectedCandidate: AfcV2SettleDecisionBestRejectedCandidate | null;
}> {
  if (settle.ok) {
    return Object.freeze({
      successfulCellCount: settle.settleObservability.successfulCellCount,
      structuralFailureCount: settle.settleObservability.structuralFailureCount,
      structuralFailureReasons: projectCountMap(
        settle.settleObservability.structuralFailureReasons,
        AFC_V2_SETTLE_DECISION_STRUCTURAL_REASONS,
      ),
      rejectionCounts: projectCountMap(
        settle.settleObservability.rejectionCounts,
        AFC_V2_SETTLE_DECISION_GATES,
      ),
      bestRejectedCandidate: null,
    });
  }
  if (settle.reason !== "no_apply_safe_candidate") {
    return Object.freeze({
      successfulCellCount: null,
      structuralFailureCount: null,
      structuralFailureReasons: null,
      rejectionCounts: null,
      bestRejectedCandidate: null,
    });
  }
  const diagnostics = settle.diagnostics;
  return Object.freeze({
    successfulCellCount: diagnostics.successfulCellCount,
    structuralFailureCount: diagnostics.structuralFailureCount,
    structuralFailureReasons: projectCountMap(
      diagnostics.structuralFailureReasons,
      AFC_V2_SETTLE_DECISION_STRUCTURAL_REASONS,
    ),
    rejectionCounts: projectCountMap(
      diagnostics.rejectionCounts,
      AFC_V2_SETTLE_DECISION_GATES,
    ),
    bestRejectedCandidate: projectBestRejected(diagnostics.bestRejectedCandidate),
  });
}

/**
 * Builds the persisted diagnostic from the settle result that analysis just
 * computed. Throws when a retained number is not JSON-safe. Does not rerun
 * settle.
 */
export function projectAfcV2SettleDecisionDiagnostic(input: Readonly<{
  settle: AfcFixedSeamCalibrationResult;
  sourceNormalizedPolygon: readonly { x: number; y: number }[];
}>): AfcV2SettleDecisionRecordedV1 {
  const settle = input.settle;
  const evaluatedCellCount = nonNegativeInteger(settle.evaluatedCellCount);
  const applySafeCellCount = nonNegativeInteger(settle.applySafeCellCount);
  if (evaluatedCellCount == null || applySafeCellCount == null) {
    throw new AfcV2SettleDecisionCaptureError("settle_count_invalid");
  }
  const counts = retainedCounts(settle);
  if (
    counts.successfulCellCount != null &&
    nonNegativeInteger(counts.successfulCellCount) == null
  ) {
    throw new AfcV2SettleDecisionCaptureError("settle_count_invalid");
  }
  if (
    counts.structuralFailureCount != null &&
    nonNegativeInteger(counts.structuralFailureCount) == null
  ) {
    throw new AfcV2SettleDecisionCaptureError("settle_count_invalid");
  }
  const reason = settle.ok
    ? null
    : member(settle.reason, AFC_V2_SETTLE_DECISION_FAILURE_REASONS);
  if (!settle.ok && !reason) {
    throw new AfcV2SettleDecisionCaptureError("settle_reason_invalid");
  }
  return Object.freeze({
    schemaVersion: AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    reached: true as const,
    result: Object.freeze({
      ok: settle.ok,
      reason,
    }),
    evaluatedCellCount,
    successfulCellCount: counts.successfulCellCount,
    applySafeCellCount,
    structuralFailureCount: counts.structuralFailureCount,
    structuralFailureReasons: counts.structuralFailureReasons,
    rejectionCounts: counts.rejectionCounts,
    ratioExtensionAttempted: settle.ok
      ? settle.ratioExtensionDiagnostics != null
      : settle.ratioExtensionAttempted === true,
    bestRejectedCandidate: counts.bestRejectedCandidate,
    winningCandidate: settle.ok ? projectWinning(settle) : null,
    sourceNormalizedPolygon: projectPolygon(input.sourceNormalizedPolygon),
  });
}

function fail(reason: string): AfcV2SettleDecisionParseResult {
  return Object.freeze({ ok: false, reason });
}

function parseNotReached(
  value: Record<string, unknown>,
): AfcV2SettleDecisionParseResult {
  if (!exactKeys(value, ["schemaVersion", "reached"])) {
    return fail("settle_decision_not_reached_invalid");
  }
  return Object.freeze({
    ok: true,
    decision: afcV2SettleDecisionNotReached(),
  });
}

function parseRecorded(
  value: Record<string, unknown>,
): AfcV2SettleDecisionParseResult {
  if (!exactKeys(value, RECORDED_KEYS)) return fail("settle_decision_keys_invalid");
  if (!isRecord(value.result) || !exactKeys(value.result, ["ok", "reason"])) {
    return fail("settle_result_invalid");
  }
  if (typeof value.result.ok !== "boolean") return fail("settle_result_invalid");
  const reason = value.result.reason === null
    ? null
    : member(value.result.reason, AFC_V2_SETTLE_DECISION_FAILURE_REASONS);
  if (value.result.reason !== null && !reason) return fail("settle_result_invalid");
  if (value.result.ok !== (reason == null)) return fail("settle_result_invalid");
  const evaluatedCellCount = nonNegativeInteger(value.evaluatedCellCount);
  const successfulCellCount = nullableInteger(value.successfulCellCount);
  const applySafeCellCount = nonNegativeInteger(value.applySafeCellCount);
  const structuralFailureCount = nullableInteger(value.structuralFailureCount);
  if (
    evaluatedCellCount == null ||
    successfulCellCount === undefined ||
    applySafeCellCount == null ||
    structuralFailureCount === undefined
  ) {
    return fail("settle_count_invalid");
  }
  const structuralFailureReasons = parseCountMap(
    value.structuralFailureReasons,
    AFC_V2_SETTLE_DECISION_STRUCTURAL_REASONS,
  );
  const rejectionCounts = parseCountMap(
    value.rejectionCounts,
    AFC_V2_SETTLE_DECISION_GATES,
  );
  if (structuralFailureReasons === undefined || rejectionCounts === undefined) {
    return fail("settle_count_invalid");
  }
  if (typeof value.ratioExtensionAttempted !== "boolean") {
    return fail("settle_ratio_extension_invalid");
  }
  const bestRejectedCandidate = parseBestRejected(value.bestRejectedCandidate);
  const winningCandidate = parseWinning(value.winningCandidate);
  if (bestRejectedCandidate === undefined || winningCandidate === undefined) {
    return fail("settle_candidate_invalid");
  }
  const sourceNormalizedPolygon = parsePolygon(value.sourceNormalizedPolygon);
  if (!sourceNormalizedPolygon) return fail("settle_polygon_invalid");
  if (value.result.ok && !winningCandidate) return fail("settle_winner_invalid");
  if (!value.result.ok && winningCandidate) return fail("settle_winner_invalid");
  return Object.freeze({
    ok: true,
    decision: Object.freeze({
      schemaVersion: AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
      reached: true as const,
      result: Object.freeze({ ok: value.result.ok, reason }),
      evaluatedCellCount,
      successfulCellCount,
      applySafeCellCount,
      structuralFailureCount,
      structuralFailureReasons,
      rejectionCounts,
      ratioExtensionAttempted: value.ratioExtensionAttempted,
      bestRejectedCandidate,
      winningCandidate,
      sourceNormalizedPolygon,
    }),
  });
}

/**
 * Decode persisted `settle_decision` JSON.
 *
 * Null is legacy or not captured. It is not settle-not-reached, settle
 * failure, or settle success. A `reached: false` object records that this
 * generation completed without calling settle.
 */
export function parseAfcV2SettleDecision(
  value: unknown,
): AfcV2SettleDecisionParseResult {
  if (value === null) return Object.freeze({ ok: true, decision: null });
  if (!isRecord(value)) return fail("settle_decision_not_object");
  if (!hasOwn(value, "schemaVersion")) return fail("schemaVersion_missing");
  if (typeof value.schemaVersion !== "string" || value.schemaVersion.trim().length === 0) {
    return fail("schemaVersion_invalid");
  }
  if (value.schemaVersion !== AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION) {
    return Object.freeze({
      ok: true,
      decision: Object.freeze({
        kind: "unsupported_schema" as const,
        schemaVersion: value.schemaVersion,
      }),
    });
  }
  if (value.reached === false) return parseNotReached(value);
  if (value.reached === true) return parseRecorded(value);
  return fail("settle_reached_invalid");
}

export function isAfcV2SettleDecisionRecordedV1(
  value: unknown,
): value is AfcV2SettleDecisionRecordedV1 {
  const parsed = parseAfcV2SettleDecision(value);
  return parsed.ok && !!parsed.decision && "reached" in parsed.decision &&
    parsed.decision.reached === true;
}

export function isAfcV2SettleDecisionNotReachedV1(
  value: unknown,
): value is AfcV2SettleDecisionNotReachedV1 {
  const parsed = parseAfcV2SettleDecision(value);
  return parsed.ok && !!parsed.decision && "reached" in parsed.decision &&
    parsed.decision.reached === false;
}
