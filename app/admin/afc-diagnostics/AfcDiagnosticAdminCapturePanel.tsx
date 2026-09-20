"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY,
  AFC_DIAGNOSTIC_ADMIN_CAPTURE_ISSUE_OPTIONS,
  buildAfcDiagnosticAdminCaptureCasePageUrl,
  canSubmitAfcDiagnosticAdminCapture,
  postAfcDiagnosticAdminCaptureCase,
} from "@/lib/afc-v2-diagnostics/admin-case-capture.client";
import { isAfcDiagnosticAdminCaptureGenerationStatusEligible } from "@/lib/afc-v2-diagnostics/admin-capture";
import { AFC_DIAGNOSTIC_NOTES_MAX_CHARS } from "@/lib/afc-v2-diagnostics/contracts";
import { afcDiagnosticInspectorMachineLabel } from "@/lib/afc-v2-diagnostics/admin-case-inspector.client";
import type { AfcQaIssueCode } from "@/lib/afc-v2-diagnostics/taxonomy";

const fieldClassName =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

const buttonClassName =
  "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

export default function AfcDiagnosticAdminCapturePanel({
  sessionId,
  generationId,
  status,
  attemptOrdinal,
}: {
  sessionId: string;
  generationId: string | null;
  status: string | null;
  attemptOrdinal?: number | null;
}) {
  const router = useRouter();
  const inFlightRef = useRef(false);
  const [selectedCodes, setSelectedCodes] = useState<AfcQaIssueCode[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terminal = isAfcDiagnosticAdminCaptureGenerationStatusEligible(status);
  const createEnabled = canSubmitAfcDiagnosticAdminCapture({
    generationId,
    status,
    issueCodes: selectedCodes,
    notes,
    submitting,
  });

  function toggleIssue(code: AfcQaIssueCode) {
    if (submitting) return;
    setSelectedCodes((current) =>
      current.includes(code)
        ? current.filter((entry) => entry !== code)
        : [...current, code],
    );
    setError(null);
  }

  function handleCancel() {
    if (submitting) return;
    setSelectedCodes([]);
    setNotes("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createEnabled || !generationId || inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    const result = await postAfcDiagnosticAdminCaptureCase({
      sessionId,
      generationId,
      issueCodes: selectedCodes,
      notes,
    });
    if (!result.ok) {
      inFlightRef.current = false;
      setSubmitting(false);
      setError(result.message);
      return;
    }
    router.push(buildAfcDiagnosticAdminCaptureCasePageUrl(result.detail.caseId));
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <h3 className="text-sm font-semibold tracking-tight text-slate-100">
        {AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.title}
      </h3>
      {attemptOrdinal != null || status != null ? (
        <p className="mt-1 text-xs text-slate-400">
          {attemptOrdinal != null ? `Attempt #${attemptOrdinal}` : "Attempt"}
          {status != null
            ? ` · ${afcDiagnosticInspectorMachineLabel(status)}`
            : ""}
        </p>
      ) : null}

      <form
        className="mt-4 space-y-4"
        onSubmit={handleSubmit}
        aria-busy={submitting}
      >
        <fieldset disabled={submitting} className="space-y-2">
          <legend className="text-xs uppercase tracking-wide text-slate-500">
            Issues
          </legend>
          {AFC_DIAGNOSTIC_ADMIN_CAPTURE_ISSUE_OPTIONS.map((option) => (
            <label
              key={option.code}
              className="flex items-center gap-2 text-sm text-slate-200"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
                checked={selectedCodes.includes(option.code)}
                onChange={() => toggleIssue(option.code)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        <div>
          <label
            htmlFor="afc-admin-capture-notes"
            className="text-xs uppercase tracking-wide text-slate-500"
          >
            {AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.notesLabel}{" "}
            <span className="normal-case tracking-normal text-slate-500">
              ({AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.notesOptional})
            </span>
          </label>
          <textarea
            id="afc-admin-capture-notes"
            className={`${fieldClassName} mt-1 min-h-24 whitespace-pre-wrap`}
            value={notes}
            disabled={submitting}
            maxLength={AFC_DIAGNOSTIC_NOTES_MAX_CHARS}
            onChange={(event) => {
              setNotes(event.target.value);
              setError(null);
            }}
          />
        </div>

        {!terminal ? (
          <p className="text-xs text-amber-200">
            {AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.running}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className={buttonClassName}
            disabled={!createEnabled}
          >
            {AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.create}
          </button>
          <button
            type="button"
            className={buttonClassName}
            disabled={submitting}
            onClick={handleCancel}
          >
            {AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.cancel}
          </button>
        </div>

        {submitting ? (
          <p role="status" className="text-xs text-slate-400">
            {AFC_DIAGNOSTIC_ADMIN_CAPTURE_COPY.creating}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-rose-200">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
