/**
 * AFD-1A diagnostic domain contracts.
 *
 * Isolated from AFC production authority. These types describe Diagnostic
 * Sessions, session-generation membership, and QA Cases. They do not
 * recreate camera, floor, collision, or metric state.
 *
 * Case/session matching (same room, reporter, ORIGINAL sha, and membership)
 * is an AFD-3 application invariant, not a cross-table SQL FK.
 */

import type { AfcQaIssueCode, AfcQaIssueTaxonomyVersion } from "./taxonomy";

export const AFC_DIAGNOSTIC_SESSION_TABLE = "vibode_afc_diagnostic_sessions";
export const AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE =
  "vibode_afc_diagnostic_session_generations";
export const AFC_DIAGNOSTIC_CASE_TABLE = "vibode_afc_diagnostic_cases";

export const AFC_DIAGNOSTIC_SESSION_STATUSES = ["open", "closed"] as const;
export type AfcDiagnosticSessionStatus =
  (typeof AFC_DIAGNOSTIC_SESSION_STATUSES)[number];

export const AFC_DIAGNOSTIC_SESSION_INTENTS = [
  "analyze",
  "run_again",
  "reread_perspective",
] as const;
export type AfcDiagnosticSessionIntent =
  (typeof AFC_DIAGNOSTIC_SESSION_INTENTS)[number];

export const AFC_DIAGNOSTIC_CASE_TRIGGERS = [
  "repeated_unsuccessful",
  "manual_report",
  "admin_capture",
] as const;
export type AfcDiagnosticCaseTrigger =
  (typeof AFC_DIAGNOSTIC_CASE_TRIGGERS)[number];

export const AFC_DIAGNOSTIC_MACHINE_STATUS_SNAPSHOTS = [
  "ready",
  "failed",
  "running",
] as const;
export type AfcDiagnosticMachineStatusSnapshot =
  (typeof AFC_DIAGNOSTIC_MACHINE_STATUS_SNAPSHOTS)[number];

export const AFC_DIAGNOSTIC_REVIEW_STATUSES = [
  "new",
  "in_review",
  "closed",
] as const;
export type AfcDiagnosticReviewStatus =
  (typeof AFC_DIAGNOSTIC_REVIEW_STATUSES)[number];

export const AFC_DIAGNOSTIC_NOTES_MAX_CHARS = 2000;

export type AfcDiagnosticOriginalIdentity = Readonly<{
  decodedWidth?: number;
  decodedHeight?: number;
  byteCount?: number;
  mimeType?: string;
  orientation?: number;
  baseAssetId?: string;
}>;

export type AfcDiagnosticSessionRecord = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  originalSha256: string;
  baseAssetId: string | null;
  status: AfcDiagnosticSessionStatus;
  createdAt: string;
  updatedAt: string;
}>;

export type AfcDiagnosticSessionGenerationRecord = Readonly<{
  sessionId: string;
  generationId: string;
  attemptOrdinal: number;
  intent: AfcDiagnosticSessionIntent;
  associatedAt: string;
}>;

export type AfcDiagnosticCaseEvidence = Readonly<{
  id: string;
  sessionId: string;
  roomId: string;
  reporterUserId: string;
  reportedGenerationId: string;
  originalSha256: string;
  originalIdentity: AfcDiagnosticOriginalIdentity | null;
  taxonomyVersion: AfcQaIssueTaxonomyVersion | string;
  issueCodes: readonly AfcQaIssueCode[] | readonly string[];
  notes: string | null;
  trigger: AfcDiagnosticCaseTrigger;
  machineStatusSnapshot: AfcDiagnosticMachineStatusSnapshot;
  submittedAt: string;
}>;

export type AfcDiagnosticCaseReview = Readonly<{
  reviewStatus: AfcDiagnosticReviewStatus;
  reviewerUserId: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
}>;

export type AfcDiagnosticCaseRecord = AfcDiagnosticCaseEvidence &
  AfcDiagnosticCaseReview;

export const AFC_DIAGNOSTIC_CASE_EVIDENCE_FIELDS = [
  "id",
  "sessionId",
  "roomId",
  "reporterUserId",
  "reportedGenerationId",
  "originalSha256",
  "originalIdentity",
  "taxonomyVersion",
  "issueCodes",
  "notes",
  "trigger",
  "machineStatusSnapshot",
  "submittedAt",
] as const;

export const AFC_DIAGNOSTIC_CASE_REVIEW_FIELDS = [
  "reviewStatus",
  "reviewerUserId",
  "reviewNotes",
  "reviewedAt",
] as const;

function closedSet<T extends string>(values: readonly T[]) {
  return new Set(values);
}

const SESSION_STATUS_SET = closedSet(AFC_DIAGNOSTIC_SESSION_STATUSES);
const SESSION_INTENT_SET = closedSet(AFC_DIAGNOSTIC_SESSION_INTENTS);
const CASE_TRIGGER_SET = closedSet(AFC_DIAGNOSTIC_CASE_TRIGGERS);
const MACHINE_STATUS_SET = closedSet(AFC_DIAGNOSTIC_MACHINE_STATUS_SNAPSHOTS);
const REVIEW_STATUS_SET = closedSet(AFC_DIAGNOSTIC_REVIEW_STATUSES);

export function isAfcDiagnosticSessionStatus(
  value: unknown,
): value is AfcDiagnosticSessionStatus {
  return typeof value === "string" && SESSION_STATUS_SET.has(value as AfcDiagnosticSessionStatus);
}

export function isAfcDiagnosticSessionIntent(
  value: unknown,
): value is AfcDiagnosticSessionIntent {
  return typeof value === "string" && SESSION_INTENT_SET.has(value as AfcDiagnosticSessionIntent);
}

export function isAfcDiagnosticCaseTrigger(
  value: unknown,
): value is AfcDiagnosticCaseTrigger {
  return typeof value === "string" && CASE_TRIGGER_SET.has(value as AfcDiagnosticCaseTrigger);
}

export function isAfcDiagnosticMachineStatusSnapshot(
  value: unknown,
): value is AfcDiagnosticMachineStatusSnapshot {
  return (
    typeof value === "string" &&
    MACHINE_STATUS_SET.has(value as AfcDiagnosticMachineStatusSnapshot)
  );
}

export function isAfcDiagnosticReviewStatus(
  value: unknown,
): value is AfcDiagnosticReviewStatus {
  return typeof value === "string" && REVIEW_STATUS_SET.has(value as AfcDiagnosticReviewStatus);
}

export function isAfcDiagnosticNotes(value: unknown): value is string | null {
  if (value == null) return true;
  return typeof value === "string" && value.length <= AFC_DIAGNOSTIC_NOTES_MAX_CHARS;
}
