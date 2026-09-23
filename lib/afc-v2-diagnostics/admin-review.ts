/**
 * AFD-4D admin Diagnostic Case review workflow — pure request and
 * state-machine logic. No Supabase, no React, no timestamps from the client.
 */

import {
  AFC_DIAGNOSTIC_NOTES_MAX_CHARS,
  isAfcDiagnosticReviewStatus,
  type AfcDiagnosticReviewStatus,
} from "./contracts";

export const AFC_DIAGNOSTIC_ADMIN_REVIEW_PATCH_KEYS = [
  "reviewStatus",
  "reviewNotes",
] as const;

export type AfcDiagnosticAdminReviewPatchRequest = Readonly<{
  reviewStatus: AfcDiagnosticReviewStatus;
  reviewNotes: string | null;
}>;

export type AfcDiagnosticAdminReviewCurrentState = Readonly<{
  reviewStatus: AfcDiagnosticReviewStatus;
  reviewerUserId: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
}>;

export type AfcDiagnosticAdminReviewUpdate = Readonly<{
  review_status: AfcDiagnosticReviewStatus;
  reviewer_user_id: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
}>;

export type AfcDiagnosticAdminReviewPlan =
  | { ok: true; noOp: true }
  | { ok: true; noOp: false; update: AfcDiagnosticAdminReviewUpdate }
  | { ok: false; code: "illegal_transition" };

const ALLOWED_REVIEW_TRANSITIONS: Readonly<
  Record<AfcDiagnosticReviewStatus, readonly AfcDiagnosticReviewStatus[]>
> = {
  new: ["new", "in_review", "closed"],
  in_review: ["in_review", "closed"],
  closed: ["closed", "in_review"],
};

const PATCH_KEY_SET = new Set<string>(AFC_DIAGNOSTIC_ADMIN_REVIEW_PATCH_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAfcDiagnosticAdminReviewNotes(
  value: string | null,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isAfcDiagnosticAdminReviewTransitionAllowed(
  from: AfcDiagnosticReviewStatus,
  to: AfcDiagnosticReviewStatus,
): boolean {
  return ALLOWED_REVIEW_TRANSITIONS[from].includes(to);
}

export function parseAfcDiagnosticAdminReviewPatchRequest(
  body: unknown,
):
  | { ok: true; value: AfcDiagnosticAdminReviewPatchRequest }
  | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  const keys = Object.keys(body);
  if (keys.length !== AFC_DIAGNOSTIC_ADMIN_REVIEW_PATCH_KEYS.length) {
    return { ok: false };
  }
  for (const key of keys) {
    if (!PATCH_KEY_SET.has(key)) return { ok: false };
  }
  if (!("reviewStatus" in body) || !("reviewNotes" in body)) {
    return { ok: false };
  }
  if (!isAfcDiagnosticReviewStatus(body.reviewStatus)) return { ok: false };

  let reviewNotes: string | null;
  if (body.reviewNotes === null) {
    reviewNotes = null;
  } else if (typeof body.reviewNotes === "string") {
    reviewNotes = normalizeAfcDiagnosticAdminReviewNotes(body.reviewNotes);
    if (
      reviewNotes != null &&
      reviewNotes.length > AFC_DIAGNOSTIC_NOTES_MAX_CHARS
    ) {
      return { ok: false };
    }
  } else {
    return { ok: false };
  }

  return {
    ok: true,
    value: Object.freeze({
      reviewStatus: body.reviewStatus,
      reviewNotes,
    }),
  };
}

export function planAfcDiagnosticAdminReview(input: {
  current: AfcDiagnosticAdminReviewCurrentState;
  request: AfcDiagnosticAdminReviewPatchRequest;
  adminUserId: string;
  now: string;
}): AfcDiagnosticAdminReviewPlan {
  if (
    !isAfcDiagnosticAdminReviewTransitionAllowed(
      input.current.reviewStatus,
      input.request.reviewStatus,
    )
  ) {
    return { ok: false, code: "illegal_transition" };
  }

  const currentNotes = normalizeAfcDiagnosticAdminReviewNotes(
    input.current.reviewNotes,
  );
  if (
    input.current.reviewStatus === input.request.reviewStatus &&
    currentNotes === input.request.reviewNotes
  ) {
    return { ok: true, noOp: true };
  }

  const claimed =
    input.request.reviewStatus === "in_review" ||
    input.request.reviewStatus === "closed";

  return {
    ok: true,
    noOp: false,
    update: Object.freeze({
      review_status: input.request.reviewStatus,
      reviewer_user_id: claimed ? input.adminUserId : null,
      review_notes: input.request.reviewNotes,
      reviewed_at: claimed ? input.now : input.current.reviewedAt,
    }),
  };
}
