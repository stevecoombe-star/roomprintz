/**
 * AFD-4E admin Diagnostic Case capture — pure request parsing and
 * eligibility. No Supabase, no React, no client-supplied provenance.
 */

import { parseAfcDiagnosticAdminUuid } from "./admin-read-model";
import { AFC_DIAGNOSTIC_NOTES_MAX_CHARS } from "./contracts";
import {
  isAfcQaIssueCode,
  type AfcQaIssueCode,
} from "./taxonomy";

export const AFC_DIAGNOSTIC_ADMIN_CAPTURE_TRIGGER = "admin_capture" as const;

export const AFC_DIAGNOSTIC_ADMIN_CAPTURE_ALLOWED_KEYS = [
  "generationId",
  "issueCodes",
  "notes",
] as const;

export const AFC_DIAGNOSTIC_ADMIN_CAPTURE_FORBIDDEN_KEYS = [
  "trigger",
  "reporterUserId",
  "reporter_user_id",
  "roomId",
  "room_id",
  "sessionId",
  "session_id",
  "originalSha256",
  "original_sha256",
  "originalIdentity",
  "original_identity",
  "machineStatusSnapshot",
  "machine_status_snapshot",
  "taxonomyVersion",
  "taxonomy_version",
  "submittedAt",
  "submitted_at",
  "reviewStatus",
  "review_status",
  "reviewerUserId",
  "reviewer_user_id",
  "reviewNotes",
  "review_notes",
  "reviewedAt",
  "reviewed_at",
  "caseId",
  "case_id",
  "userId",
  "user_id",
] as const;

export const AFC_DIAGNOSTIC_ADMIN_CAPTURE_ELIGIBLE_STATUSES = [
  "ready",
  "failed",
] as const;

export type AfcDiagnosticAdminCaptureEligibleStatus =
  (typeof AFC_DIAGNOSTIC_ADMIN_CAPTURE_ELIGIBLE_STATUSES)[number];

export type AfcDiagnosticAdminCaptureRequest = Readonly<{
  generationId: string;
  issueCodes: readonly AfcQaIssueCode[];
  notes?: string | null;
}>;

const ALLOWED_KEY_SET = new Set<string>(AFC_DIAGNOSTIC_ADMIN_CAPTURE_ALLOWED_KEYS);
const FORBIDDEN_KEY_SET = new Set<string>(
  AFC_DIAGNOSTIC_ADMIN_CAPTURE_FORBIDDEN_KEYS,
);
const ELIGIBLE_STATUS_SET = new Set<string>(
  AFC_DIAGNOSTIC_ADMIN_CAPTURE_ELIGIBLE_STATUSES,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAfcDiagnosticAdminCaptureNotes(
  value: string | null,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeAfcDiagnosticAdminCaptureIssueCodes(
  value: unknown,
): readonly AfcQaIssueCode[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const codes: AfcQaIssueCode[] = [];
  const seen = new Set<AfcQaIssueCode>();
  for (const entry of value) {
    if (!isAfcQaIssueCode(entry)) return null;
    if (seen.has(entry)) continue;
    seen.add(entry);
    codes.push(entry);
  }
  return codes.length > 0 ? codes : null;
}

export function isAfcDiagnosticAdminCaptureGenerationStatusEligible(
  status: unknown,
): status is AfcDiagnosticAdminCaptureEligibleStatus {
  return typeof status === "string" && ELIGIBLE_STATUS_SET.has(status);
}

export function parseAfcDiagnosticAdminCaptureRequest(
  body: unknown,
):
  | { ok: true; value: AfcDiagnosticAdminCaptureRequest }
  | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  const keys = Object.keys(body);
  for (const key of keys) {
    if (FORBIDDEN_KEY_SET.has(key) || !ALLOWED_KEY_SET.has(key)) {
      return { ok: false };
    }
  }
  if (!("generationId" in body) || !("issueCodes" in body)) {
    return { ok: false };
  }

  const generationId = parseAfcDiagnosticAdminUuid(body.generationId);
  if (!generationId) return { ok: false };

  const issueCodes = normalizeAfcDiagnosticAdminCaptureIssueCodes(body.issueCodes);
  if (!issueCodes) return { ok: false };

  let notes: string | null = null;
  if ("notes" in body) {
    if (body.notes === null) {
      notes = null;
    } else if (typeof body.notes === "string") {
      notes = normalizeAfcDiagnosticAdminCaptureNotes(body.notes);
      if (notes != null && notes.length > AFC_DIAGNOSTIC_NOTES_MAX_CHARS) {
        return { ok: false };
      }
    } else {
      return { ok: false };
    }
  }

  return {
    ok: true,
    value: Object.freeze({
      generationId,
      issueCodes: Object.freeze([...issueCodes]),
      notes,
    }),
  };
}
