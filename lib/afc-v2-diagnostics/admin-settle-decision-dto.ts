/**
 * Browser-safe Admin settle-decision DTO.
 *
 * Decodes the sanitized inspector payload. Does not read database JSON and
 * does not import the runtime settle parser.
 */

import { publishAfcDiagnosticMetricToken } from "./admin-metric-decision-dto";

export const AFC_DIAGNOSTIC_ADMIN_SETTLE_DECISION_SCHEMA_VERSION =
  "afc-v2-settle-decision-diagnostic/v1" as const;

const GATES = [
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

const STRUCTURAL = [
  "floor_rect_failed",
  "homography_solve_failed",
  "homography_decomposition_failed",
  "cv_reprojection_unavailable",
  "display_reprojection_unavailable",
  "other",
] as const;

const FAILURES = [
  "invalid_polygon",
  "invalid_frame",
  "invalid_reference_depth",
  "metric_domain_rejected",
  "no_apply_safe_candidate",
] as const;

const CONFIDENCE = ["high", "low"] as const;

const WINNING_CELL_ID = /^ratio=\d+\.\d{3};fov=\d+\.\d$/;

export type AfcDiagnosticAdminSettleDecisionGate = (typeof GATES)[number];
export type AfcDiagnosticAdminSettleDecisionStructuralReason = (typeof STRUCTURAL)[number];
export type AfcDiagnosticAdminSettleDecisionFailureReason = (typeof FAILURES)[number];

export type AfcDiagnosticAdminSettleDecisionPoint = Readonly<{ x: number; y: number }>;

export type AfcDiagnosticAdminSettleDecisionBestRejected = Readonly<{
  ratio: number;
  verticalFovDeg: number;
  confidence: "high" | "low";
  cvAvgPx: number;
  cvMaxPx: number;
  scaleRatio: number;
  firstFailingGate: AfcDiagnosticAdminSettleDecisionGate;
  atFovMin: boolean;
  atFovMax: boolean;
  atRatioMin: boolean;
  atRatioMax: boolean;
}>;

export type AfcDiagnosticAdminSettleDecisionWinning = Readonly<{
  widthDepthRatio: number;
  verticalFovDeg: number;
  winningCellId: string;
  firstFailingGate: AfcDiagnosticAdminSettleDecisionGate;
  displayAvgPx: number;
  displayMaxPx: number;
}>;

export type AfcDiagnosticAdminSettleDecisionRecordedValue =
  | Readonly<{ reached: false }>
  | Readonly<{
      reached: true;
      result: Readonly<{
        ok: boolean;
        reason: AfcDiagnosticAdminSettleDecisionFailureReason | null;
      }>;
      evaluatedCellCount: number;
      successfulCellCount: number | null;
      applySafeCellCount: number;
      structuralFailureCount: number | null;
      structuralFailureReasons: Readonly<
        Partial<Record<AfcDiagnosticAdminSettleDecisionStructuralReason, number>>
      > | null;
      rejectionCounts: Readonly<
        Partial<Record<AfcDiagnosticAdminSettleDecisionGate, number>>
      > | null;
      ratioExtensionAttempted: boolean;
      bestRejectedCandidate: AfcDiagnosticAdminSettleDecisionBestRejected | null;
      winningCandidate: AfcDiagnosticAdminSettleDecisionWinning | null;
      sourceNormalizedPolygon: readonly [
        AfcDiagnosticAdminSettleDecisionPoint,
        AfcDiagnosticAdminSettleDecisionPoint,
        AfcDiagnosticAdminSettleDecisionPoint,
        AfcDiagnosticAdminSettleDecisionPoint,
      ];
    }>;

export type AfcDiagnosticAdminSettleDecision =
  | null
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "unsupported_schema"; schemaVersion: string }>
  | Readonly<{
      kind: "recorded";
      schemaVersion: typeof AFC_DIAGNOSTIC_ADMIN_SETTLE_DECISION_SCHEMA_VERSION;
      value: AfcDiagnosticAdminSettleDecisionRecordedValue;
    }>;

const RECORDED_VALUE_KEYS = [
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

function unreadable(): AfcDiagnosticAdminSettleDecision {
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

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function nullableCount(value: unknown): number | null | undefined {
  if (value === null) return null;
  return count(value) ?? undefined;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

function countMap<K extends string>(
  value: unknown,
  keys: readonly K[],
): Readonly<Partial<Record<K, number>>> | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const parsed: Partial<Record<K, number>> = {};
  for (const key of Object.keys(value)) {
    if (!keys.includes(key as K)) return undefined;
    const amount = count(value[key]);
    if (amount == null || amount === 0) return undefined;
    parsed[key as K] = amount;
  }
  const ordered: Partial<Record<K, number>> = {};
  for (const key of keys) {
    if (parsed[key] != null) ordered[key] = parsed[key];
  }
  return Object.freeze(ordered);
}

function point(value: unknown): AfcDiagnosticAdminSettleDecisionPoint | null {
  if (!isRecord(value) || !exactKeys(value, ["x", "y"])) return null;
  const x = finite(value.x);
  const y = finite(value.y);
  if (x == null || y == null) return null;
  return Object.freeze({ x, y });
}

function polygon(value: unknown): readonly [
  AfcDiagnosticAdminSettleDecisionPoint,
  AfcDiagnosticAdminSettleDecisionPoint,
  AfcDiagnosticAdminSettleDecisionPoint,
  AfcDiagnosticAdminSettleDecisionPoint,
] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points = value.map(point);
  if (points.some((entry) => entry == null)) return null;
  return Object.freeze([
    points[0] as AfcDiagnosticAdminSettleDecisionPoint,
    points[1] as AfcDiagnosticAdminSettleDecisionPoint,
    points[2] as AfcDiagnosticAdminSettleDecisionPoint,
    points[3] as AfcDiagnosticAdminSettleDecisionPoint,
  ]);
}

function bestRejected(
  value: unknown,
): AfcDiagnosticAdminSettleDecisionBestRejected | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, BEST_REJECTED_KEYS)) return undefined;
  const ratio = finite(value.ratio);
  const verticalFovDeg = finite(value.verticalFovDeg);
  const confidence = member(value.confidence, CONFIDENCE);
  const cvAvgPx = finite(value.cvAvgPx);
  const cvMaxPx = finite(value.cvMaxPx);
  const scaleRatio = finite(value.scaleRatio);
  const firstFailingGate = member(value.firstFailingGate, GATES);
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

function winning(
  value: unknown,
): AfcDiagnosticAdminSettleDecisionWinning | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, WINNING_KEYS)) return undefined;
  const widthDepthRatio = finite(value.widthDepthRatio);
  const verticalFovDeg = finite(value.verticalFovDeg);
  const firstFailingGate = member(value.firstFailingGate, GATES);
  const displayAvgPx = finite(value.displayAvgPx);
  const displayMaxPx = finite(value.displayMaxPx);
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

function recordedValue(
  value: unknown,
): AfcDiagnosticAdminSettleDecisionRecordedValue | null {
  if (!isRecord(value)) return null;
  if (value.reached === false) {
    return exactKeys(value, ["reached"]) ? Object.freeze({ reached: false }) : null;
  }
  if (value.reached !== true || !exactKeys(value, RECORDED_VALUE_KEYS)) return null;
  if (!isRecord(value.result) || !exactKeys(value.result, ["ok", "reason"])) return null;
  if (typeof value.result.ok !== "boolean") return null;
  const reason = value.result.reason === null
    ? null
    : member(value.result.reason, FAILURES);
  if (value.result.reason !== null && !reason) return null;
  if (value.result.ok !== (reason == null)) return null;
  const evaluatedCellCount = count(value.evaluatedCellCount);
  const successfulCellCount = nullableCount(value.successfulCellCount);
  const applySafeCellCount = count(value.applySafeCellCount);
  const structuralFailureCount = nullableCount(value.structuralFailureCount);
  const structuralFailureReasons = countMap(value.structuralFailureReasons, STRUCTURAL);
  const rejectionCounts = countMap(value.rejectionCounts, GATES);
  const bestRejectedCandidate = bestRejected(value.bestRejectedCandidate);
  const winningCandidate = winning(value.winningCandidate);
  const sourceNormalizedPolygon = polygon(value.sourceNormalizedPolygon);
  if (
    evaluatedCellCount == null ||
    successfulCellCount === undefined ||
    applySafeCellCount == null ||
    structuralFailureCount === undefined ||
    structuralFailureReasons === undefined ||
    rejectionCounts === undefined ||
    typeof value.ratioExtensionAttempted !== "boolean" ||
    bestRejectedCandidate === undefined ||
    winningCandidate === undefined ||
    !sourceNormalizedPolygon ||
    (value.result.ok && !winningCandidate) ||
    (!value.result.ok && winningCandidate)
  ) {
    return null;
  }
  return Object.freeze({
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
  });
}

export function parseAfcDiagnosticAdminSettleDecisionDto(
  value: unknown,
): AfcDiagnosticAdminSettleDecision {
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
  if (value.schemaVersion !== AFC_DIAGNOSTIC_ADMIN_SETTLE_DECISION_SCHEMA_VERSION) {
    return unreadable();
  }
  const parsed = recordedValue(value.value);
  if (!parsed) return unreadable();
  return Object.freeze({
    kind: "recorded",
    schemaVersion: AFC_DIAGNOSTIC_ADMIN_SETTLE_DECISION_SCHEMA_VERSION,
    value: parsed,
  });
}
