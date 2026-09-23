/**
 * AFD-4D browser-safe admin Case review helpers.
 *
 * PATCH URL, draft/dirty model, status labels, and fetch helper.
 * No service role. No direct Supabase.
 */

import {
  parseAfcDiagnosticInspectorCaseDetail,
  type AfcDiagnosticInspectorCaseDetail,
} from "./admin-case-inspector.client";
import {
  isAfcDiagnosticAdminReviewTransitionAllowed,
  normalizeAfcDiagnosticAdminReviewNotes,
  type AfcDiagnosticAdminReviewPatchRequest,
} from "./admin-review";
import {
  AFC_DIAGNOSTIC_REVIEW_STATUSES,
  isAfcDiagnosticReviewStatus,
  type AfcDiagnosticReviewStatus,
} from "./contracts";

export const AFC_DIAGNOSTIC_ADMIN_REVIEW_API_PATH =
  "/api/admin/afc-diagnostics/cases" as const;

export const AFC_DIAGNOSTIC_ADMIN_REVIEW_STATUS_LABELS = {
  new: "New",
  in_review: "In review",
  closed: "Closed",
} as const;

export const AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY = {
  title: "Admin review",
  statusLabel: "Review status",
  notesLabel: "Review notes",
  reviewerLabel: "Reviewer",
  reviewedAtLabel: "Reviewed at",
  save: "Save review",
  reset: "Reset",
  unsaved: "Unsaved changes",
  saving: "Saving review...",
  saved: "Review saved.",
  error400: "Invalid review request.",
  error401: "You need to sign in to access AFC Diagnostics.",
  error403: "You don't have admin access to AFC Diagnostics.",
  error404: "Case not found.",
  error409: "That review change isn't allowed.",
  errorGeneric: "Couldn't save review. Try again.",
} as const;

export type AfcDiagnosticAdminReviewSaved = Readonly<{
  reviewStatus: AfcDiagnosticReviewStatus;
  reviewerUserId: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
}>;

export type AfcDiagnosticAdminReviewDraft = Readonly<{
  reviewStatus: AfcDiagnosticReviewStatus;
  reviewNotes: string;
}>;

export type AfcDiagnosticAdminReviewPatchResult =
  | { ok: true; detail: AfcDiagnosticInspectorCaseDetail }
  | { ok: false; status: number | "network"; message: string };

export function afcDiagnosticAdminReviewStatusLabel(
  status: AfcDiagnosticReviewStatus | string,
): string {
  if (status === "new") return AFC_DIAGNOSTIC_ADMIN_REVIEW_STATUS_LABELS.new;
  if (status === "in_review") {
    return AFC_DIAGNOSTIC_ADMIN_REVIEW_STATUS_LABELS.in_review;
  }
  if (status === "closed") return AFC_DIAGNOSTIC_ADMIN_REVIEW_STATUS_LABELS.closed;
  return status;
}

export function parseAfcDiagnosticAdminReviewSaved(
  review: Readonly<{
    reviewStatus: string;
    reviewerUserId: string | null;
    reviewNotes: string | null;
    reviewedAt: string | null;
  }>,
): AfcDiagnosticAdminReviewSaved | null {
  if (!isAfcDiagnosticReviewStatus(review.reviewStatus)) return null;
  return Object.freeze({
    reviewStatus: review.reviewStatus,
    reviewerUserId: review.reviewerUserId,
    reviewNotes: review.reviewNotes,
    reviewedAt: review.reviewedAt,
  });
}

export function createAfcDiagnosticAdminReviewDraft(
  saved: AfcDiagnosticAdminReviewSaved,
): AfcDiagnosticAdminReviewDraft {
  return Object.freeze({
    reviewStatus: saved.reviewStatus,
    reviewNotes: saved.reviewNotes ?? "",
  });
}

export function isAfcDiagnosticAdminReviewDraftDirty(
  saved: AfcDiagnosticAdminReviewSaved,
  draft: AfcDiagnosticAdminReviewDraft,
): boolean {
  return (
    draft.reviewStatus !== saved.reviewStatus ||
    normalizeAfcDiagnosticAdminReviewNotes(draft.reviewNotes) !==
      normalizeAfcDiagnosticAdminReviewNotes(saved.reviewNotes)
  );
}

export function allowedAfcDiagnosticAdminReviewTargets(
  saved: AfcDiagnosticReviewStatus,
): readonly AfcDiagnosticReviewStatus[] {
  return Object.freeze(
    AFC_DIAGNOSTIC_REVIEW_STATUSES.filter((status) =>
      isAfcDiagnosticAdminReviewTransitionAllowed(saved, status),
    ),
  );
}

export function isAfcDiagnosticAdminReviewTargetDisabled(
  saved: AfcDiagnosticReviewStatus,
  candidate: AfcDiagnosticReviewStatus,
): boolean {
  return !isAfcDiagnosticAdminReviewTransitionAllowed(saved, candidate);
}

export function buildAfcDiagnosticAdminReviewPatchBody(
  draft: AfcDiagnosticAdminReviewDraft,
): AfcDiagnosticAdminReviewPatchRequest {
  return Object.freeze({
    reviewStatus: draft.reviewStatus,
    reviewNotes: normalizeAfcDiagnosticAdminReviewNotes(draft.reviewNotes),
  });
}

export function buildAfcDiagnosticAdminReviewUrl(caseId: string): string {
  return `${AFC_DIAGNOSTIC_ADMIN_REVIEW_API_PATH}/${caseId}/review`;
}

export function afcDiagnosticAdminReviewErrorMessage(
  status: number | "network",
): string {
  if (status === 400) return AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.error400;
  if (status === 401) return AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.error401;
  if (status === 403) return AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.error403;
  if (status === 404) return AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.error404;
  if (status === 409) return AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.error409;
  return AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.errorGeneric;
}

export async function patchAfcDiagnosticAdminCaseReview(input: {
  caseId: string;
  draft: AfcDiagnosticAdminReviewDraft;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<AfcDiagnosticAdminReviewPatchResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = buildAfcDiagnosticAdminReviewPatchBody(input.draft);
  try {
    const response = await fetchImpl(buildAfcDiagnosticAdminReviewUrl(input.caseId), {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reviewStatus: body.reviewStatus,
        reviewNotes: body.reviewNotes,
      }),
      signal: input.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: afcDiagnosticAdminReviewErrorMessage(response.status),
      };
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const detail = parseAfcDiagnosticInspectorCaseDetail(payload);
    if (!detail || detail.caseId !== input.caseId) {
      return {
        ok: false,
        status: 500,
        message: afcDiagnosticAdminReviewErrorMessage(500),
      };
    }
    return { ok: true, detail };
  } catch {
    return {
      ok: false,
      status: "network",
      message: afcDiagnosticAdminReviewErrorMessage("network"),
    };
  }
}
