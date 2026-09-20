"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { AdminDiagnosticsCopyButton } from "@/lib/afc-v2-diagnostics/admin-diagnostics-copy-button";
import {
  formatAfcDiagnosticInspectorTimestamp,
  shortAfcDiagnosticInspectorUuid,
  type AfcDiagnosticInspectorCaseDetail,
} from "@/lib/afc-v2-diagnostics/admin-case-inspector.client";
import {
  AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY,
  afcDiagnosticAdminReviewStatusLabel,
  createAfcDiagnosticAdminReviewDraft,
  isAfcDiagnosticAdminReviewDraftDirty,
  isAfcDiagnosticAdminReviewTargetDisabled,
  parseAfcDiagnosticAdminReviewSaved,
  patchAfcDiagnosticAdminCaseReview,
} from "@/lib/afc-v2-diagnostics/admin-case-review.client";
import {
  AFC_DIAGNOSTIC_REVIEW_STATUSES,
  isAfcDiagnosticReviewStatus,
} from "@/lib/afc-v2-diagnostics/contracts";

const fieldClassName =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

const buttonClassName =
  "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

export default function AfcDiagnosticAdminReviewPanel({
  caseId,
  review,
  onSaved,
}: {
  caseId: string;
  review: AfcDiagnosticInspectorCaseDetail["review"];
  onSaved: (detail: AfcDiagnosticInspectorCaseDetail) => void;
}) {
  const saved = useMemo(() => parseAfcDiagnosticAdminReviewSaved(review), [review]);
  const [draftStatus, setDraftStatus] = useState(
    saved?.reviewStatus ??
      (isAfcDiagnosticReviewStatus(review.reviewStatus)
        ? review.reviewStatus
        : "new"),
  );
  const [draftNotes, setDraftNotes] = useState(review.reviewNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = parseAfcDiagnosticAdminReviewSaved(review);
    if (!next) return;
    const nextDraft = createAfcDiagnosticAdminReviewDraft(next);
    setDraftStatus(nextDraft.reviewStatus);
    setDraftNotes(nextDraft.reviewNotes);
  }, [review]);

  const draft = useMemo(
    () =>
      Object.freeze({
        reviewStatus: draftStatus,
        reviewNotes: draftNotes,
      }),
    [draftStatus, draftNotes],
  );
  const dirty = saved
    ? isAfcDiagnosticAdminReviewDraftDirty(saved, draft)
    : false;
  const saveDisabled = !saved || !dirty || saving;
  const resetDisabled = !saved || !dirty || saving;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saved || !dirty || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    const result = await patchAfcDiagnosticAdminCaseReview({
      caseId,
      draft,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.detail);
    setSuccess(true);
  }

  function handleReset() {
    if (!saved || saving) return;
    const nextDraft = createAfcDiagnosticAdminReviewDraft(saved);
    setDraftStatus(nextDraft.reviewStatus);
    setDraftNotes(nextDraft.reviewNotes);
    setError(null);
    setSuccess(false);
  }

  const reviewedAt = formatAfcDiagnosticInspectorTimestamp(review.reviewedAt);

  return (
    <>
      <h2 className="text-lg font-semibold tracking-tight">
        {AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.title}
      </h2>
      <form
        className="mt-4 space-y-4"
        onSubmit={handleSubmit}
        aria-busy={saving}
      >
        <div>
          <label
            htmlFor="afc-admin-review-status"
            className="text-xs uppercase tracking-wide text-slate-500"
          >
            {AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.statusLabel}
          </label>
          <select
            id="afc-admin-review-status"
            className={`${fieldClassName} mt-1`}
            value={draftStatus}
            disabled={saving}
            onChange={(event) => {
              if (!isAfcDiagnosticReviewStatus(event.target.value)) return;
              setDraftStatus(event.target.value);
              setSuccess(false);
            }}
          >
            {AFC_DIAGNOSTIC_REVIEW_STATUSES.map((status) => (
              <option
                key={status}
                value={status}
                disabled={
                  saved
                    ? isAfcDiagnosticAdminReviewTargetDisabled(
                        saved.reviewStatus,
                        status,
                      )
                    : true
                }
              >
                {afcDiagnosticAdminReviewStatusLabel(status)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="afc-admin-review-notes"
            className="text-xs uppercase tracking-wide text-slate-500"
          >
            {AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.notesLabel}
          </label>
          <textarea
            id="afc-admin-review-notes"
            className={`${fieldClassName} mt-1 min-h-28 whitespace-pre-wrap`}
            value={draftNotes}
            disabled={saving}
            maxLength={2000}
            onChange={(event) => {
              setDraftNotes(event.target.value);
              setSuccess(false);
            }}
          />
        </div>

        <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            {AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.reviewerLabel}
          </dt>
          <dd className="min-w-0 text-sm text-slate-100">
            {review.reviewerUserId ? (
              <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
                <span
                  className="font-mono text-sm text-slate-100"
                  title={review.reviewerUserId}
                >
                  {shortAfcDiagnosticInspectorUuid(review.reviewerUserId)}
                </span>
                <AdminDiagnosticsCopyButton
                  value={review.reviewerUserId}
                  ariaLabel="Copy reviewer ID"
                />
              </span>
            ) : (
              "—"
            )}
          </dd>
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            {AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.reviewedAtLabel}
          </dt>
          <dd className="min-w-0 text-sm text-slate-100">
            <span title={reviewedAt.title}>{reviewedAt.display}</span>
          </dd>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className={buttonClassName}
            disabled={saveDisabled}
          >
            {AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.save}
          </button>
          <button
            type="button"
            className={buttonClassName}
            disabled={resetDisabled}
            onClick={handleReset}
          >
            {AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.reset}
          </button>
        </div>

        {dirty && !saving ? (
          <p className="text-xs text-amber-200">
            {AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.unsaved}
          </p>
        ) : null}
        {saving ? (
          <p role="status" className="text-xs text-slate-400">
            {AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.saving}
          </p>
        ) : null}
        {success && !dirty ? (
          <p role="status" aria-live="polite" className="text-xs text-emerald-200">
            {AFC_DIAGNOSTIC_ADMIN_REVIEW_COPY.saved}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-rose-200">
            {error}
          </p>
        ) : null}
      </form>
    </>
  );
}
