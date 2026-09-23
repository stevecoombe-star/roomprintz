/**
 * AFD-4E browser-safe admin Diagnostic Case capture helpers.
 *
 * Route builder, POST helper, eligibility, and error copy.
 * No service role. No direct Supabase.
 */

import {
  parseAfcDiagnosticInspectorCaseDetail,
  type AfcDiagnosticInspectorCaseDetail,
} from "./admin-case-inspector.client";
import {
  isAfcDiagnosticAdminCaptureGenerationStatusEligible,
  normalizeAfcDiagnosticAdminCaptureIssueCodes,
  normalizeAfcDiagnosticAdminCaptureNotes,
  type AfcDiagnosticAdminCaptureRequest,
} from "./admin-capture";
import { AFC_DIAGNOSTIC_NOTES_MAX_CHARS } from "./contracts";
import {
  AFC_QA_ISSUE_CODES,
  AFC_QA_ISSUE_CODE_LABELS,
  type AfcQaIssueCode,
} from "./taxonomy";

export const AFC_DIAGNOSTIC_ADMIN_CAPTURE_API_PATH =
  "/api/admin/afc-diagnostics/sessions" as const;

export const AFC_DIAGNOSTIC_ADMIN_CAPTURE_CASE_PAGE_PATH =
  "/admin/afc-diagnostics/cases" as const;

export const AFC_DIAGNOSTIC_ADMIN_CAPTURE_SESSION_PAGE_PATH =
  "/admin/afc-diagnostics/sessions" as const;

export const AFC_DIAGNOSTIC_ADMIN_CAPTURE_ISSUE_OPTIONS = AFC_QA_ISSUE_CODES.map(
  (code) =>
    Object.freeze({
      code,
      label: AFC_QA_ISSUE_CODE_LABELS[code],
    }),
);

export const AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY = {
  title: "Create Case from this attempt",
  notesLabel: "Notes",
  notesOptional: "optional",
  create: "Create Case",
  cancel: "Cancel",
  running:
    "Create is available only for a terminal READY or FAILED attempt.",
  creating: "Creating Case...",
  error400: "Invalid Case capture request.",
  error401: "You need to sign in to access AFC Diagnostics.",
  error403: "You don't have admin access to AFC Diagnostics.",
  error404: "That Session attempt isn't available for capture.",
  errorGeneric: "Couldn't create Case. Try again.",
  openSession: "Open Session",
} as const;

export type AfcDiagnosticAdminCaptureResult =
  | { ok: true; detail: AfcDiagnosticInspectorCaseDetail }
  | { ok: false; status: number | "network"; message: string };

export function buildAfcDiagnosticAdminCaptureUrl(sessionId: string): string {
  return `${AFC_DIAGNOSTIC_ADMIN_CAPTURE_API_PATH}/${encodeURIComponent(sessionId)}/cases`;
}

export function buildAfcDiagnosticAdminCaptureCasePageUrl(caseId: string): string {
  return `${AFC_DIAGNOSTIC_ADMIN_CAPTURE_CASE_PAGE_PATH}/${encodeURIComponent(caseId)}`;
}

export function buildAfcDiagnosticAdminCaptureSessionPageUrl(
  sessionId: string,
  generationId?: string | null,
): string {
  const path = `${AFC_DIAGNOSTIC_ADMIN_CAPTURE_SESSION_PAGE_PATH}/${encodeURIComponent(sessionId)}`;
  if (generationId == null || generationId.length === 0) return path;
  return `${path}?generationId=${encodeURIComponent(generationId)}`;
}

export function buildAfcDiagnosticAdminCaptureBody(input: {
  generationId: string;
  issueCodes: readonly AfcQaIssueCode[];
  notes: string;
}): AfcDiagnosticAdminCaptureRequest {
  return Object.freeze({
    generationId: input.generationId,
    issueCodes: Object.freeze([...input.issueCodes]),
    notes: normalizeAfcDiagnosticAdminCaptureNotes(input.notes),
  });
}

export function canSubmitAfcDiagnosticAdminCapture(input: {
  generationId: string | null | undefined;
  status: string | null | undefined;
  issueCodes: readonly string[];
  notes: string;
  submitting: boolean;
}): boolean {
  if (input.submitting) return false;
  if (input.generationId == null || input.generationId.length === 0) {
    return false;
  }
  if (!isAfcDiagnosticAdminCaptureGenerationStatusEligible(input.status)) {
    return false;
  }
  const issueCodes = normalizeAfcDiagnosticAdminCaptureIssueCodes(input.issueCodes);
  if (!issueCodes || issueCodes.length === 0) return false;
  const notes = normalizeAfcDiagnosticAdminCaptureNotes(input.notes);
  if (notes != null && notes.length > AFC_DIAGNOSTIC_NOTES_MAX_CHARS) {
    return false;
  }
  return true;
}

export function defaultAfcDiagnosticAdminCaptureAttemptOrdinal(input: {
  attempts: readonly Readonly<{
    attemptOrdinal: number;
    generationId: string;
    generation: Readonly<{ status: string }>;
  }>[];
  preferredGenerationId?: string | null;
  preserveOrdinal?: number | null;
}): number | null {
  const ordered = [...input.attempts].sort(
    (left, right) => left.attemptOrdinal - right.attemptOrdinal,
  );
  if (ordered.length === 0) return null;
  if (
    input.preserveOrdinal != null &&
    ordered.some((attempt) => attempt.attemptOrdinal === input.preserveOrdinal)
  ) {
    return input.preserveOrdinal;
  }
  if (input.preferredGenerationId) {
    const preferred = ordered.find(
      (attempt) => attempt.generationId === input.preferredGenerationId,
    );
    if (preferred) return preferred.attemptOrdinal;
  }
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (
      isAfcDiagnosticAdminCaptureGenerationStatusEligible(
        ordered[index].generation.status,
      )
    ) {
      return ordered[index].attemptOrdinal;
    }
  }
  return ordered[ordered.length - 1]?.attemptOrdinal ?? null;
}

export function afcDiagnosticAdminCaptureErrorMessage(
  status: number | "network",
): string {
  if (status === 400) return AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.error400;
  if (status === 401) return AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.error401;
  if (status === 403) return AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.error403;
  if (status === 404) return AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.error404;
  return AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.errorGeneric;
}

export async function postAfcDiagnosticAdminCaptureCase(input: {
  sessionId: string;
  generationId: string;
  issueCodes: readonly AfcQaIssueCode[];
  notes: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<AfcDiagnosticAdminCaptureResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = buildAfcDiagnosticAdminCaptureBody({
    generationId: input.generationId,
    issueCodes: input.issueCodes,
    notes: input.notes,
  });
  try {
    const response = await fetchImpl(buildAfcDiagnosticAdminCaptureUrl(input.sessionId), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        generationId: body.generationId,
        issueCodes: body.issueCodes,
        notes: body.notes ?? null,
      }),
      signal: input.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: afcDiagnosticAdminCaptureErrorMessage(response.status),
      };
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const detail = parseAfcDiagnosticInspectorCaseDetail(payload);
    if (!detail) {
      return {
        ok: false,
        status: 500,
        message: afcDiagnosticAdminCaptureErrorMessage(500),
      };
    }
    return { ok: true, detail };
  } catch {
    return {
      ok: false,
      status: "network",
      message: afcDiagnosticAdminCaptureErrorMessage("network"),
    };
  }
}
