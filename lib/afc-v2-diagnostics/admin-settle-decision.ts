/**
 * AFR-3A read mapping for persisted settle_decision JSON.
 *
 * Calls the production parser and emits a whitelist DTO. Does not rerun
 * settle or invent evidence for historical null rows.
 */

import {
  AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
  parseAfcV2SettleDecision,
  type AfcV2SettleDecisionRecordedV1,
} from "@/lib/afc-v2-production/settle-decision-diagnostic";

import {
  AFC_DIAGNOSTIC_ADMIN_SETTLE_DECISION_SCHEMA_VERSION,
  parseAfcDiagnosticAdminSettleDecisionDto,
  type AfcDiagnosticAdminSettleDecision,
} from "./admin-settle-decision-dto";

function unreadable(): AfcDiagnosticAdminSettleDecision {
  return Object.freeze({ kind: "unreadable" });
}

function recordedValue(decision: AfcV2SettleDecisionRecordedV1) {
  return Object.freeze({
    reached: true as const,
    result: Object.freeze({
      ok: decision.result.ok,
      reason: decision.result.reason,
    }),
    evaluatedCellCount: decision.evaluatedCellCount,
    successfulCellCount: decision.successfulCellCount,
    applySafeCellCount: decision.applySafeCellCount,
    structuralFailureCount: decision.structuralFailureCount,
    structuralFailureReasons: decision.structuralFailureReasons,
    rejectionCounts: decision.rejectionCounts,
    ratioExtensionAttempted: decision.ratioExtensionAttempted,
    bestRejectedCandidate: decision.bestRejectedCandidate,
    winningCandidate: decision.winningCandidate,
    sourceNormalizedPolygon: decision.sourceNormalizedPolygon,
  });
}

export function mapAfcDiagnosticAdminSettleDecision(
  value: unknown,
): AfcDiagnosticAdminSettleDecision {
  try {
    const parsed = parseAfcV2SettleDecision(value);
    if (!parsed.ok) return unreadable();
    if (parsed.decision === null) return null;
    if ("kind" in parsed.decision && parsed.decision.kind === "unsupported_schema") {
      return parseAfcDiagnosticAdminSettleDecisionDto({
        kind: "unsupported_schema",
        schemaVersion: parsed.decision.schemaVersion,
      });
    }
    if (!("reached" in parsed.decision)) return unreadable();
    if (parsed.decision.schemaVersion !== AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION) {
      return unreadable();
    }
    if (parsed.decision.reached === false) {
      return parseAfcDiagnosticAdminSettleDecisionDto({
        kind: "recorded",
        schemaVersion: AFC_DIAGNOSTIC_ADMIN_SETTLE_DECISION_SCHEMA_VERSION,
        value: { reached: false },
      });
    }
    return parseAfcDiagnosticAdminSettleDecisionDto({
      kind: "recorded",
      schemaVersion: AFC_DIAGNOSTIC_ADMIN_SETTLE_DECISION_SCHEMA_VERSION,
      value: recordedValue(parsed.decision),
    });
  } catch {
    return unreadable();
  }
}
