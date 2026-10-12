"use client";

import { useEffect, useState } from "react";

import { useHarmonizeQaControl } from "@/components/stage/HarmonizeExportContext";
import { harmonizeExportErrorMessage } from "@/lib/vibode-stage/harmonize-export";
import {
  HARMONIZE_QA_POLL_MS,
  createHarmonizeQaAttemptGate,
  fetchHarmonizeQaOutput,
  harmonizeQaJobIsActive,
  readHarmonizeQaJob,
  readHarmonizeQaRoom,
  submitHarmonizeQaAttempt,
  type HarmonizeQaJob,
} from "@/lib/vibode-stage/harmonize-qa";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const attemptGate = createHarmonizeQaAttemptGate();

function useIsVibodeAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/admin-access", { method: "POST", cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { isAdmin?: unknown }) => {
        if (!cancelled) setIsAdmin(payload?.isAdmin === true);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return isAdmin;
}

export function HarmonizeQaButton() {
  const isAdmin = useIsVibodeAdmin();
  const control = useHarmonizeQaControl();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [job, setJob] = useState<HarmonizeQaJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomId = control?.roomId ?? null;

  useEffect(() => {
    if (!isAdmin || !roomId) return;
    let cancelled = false;
    void readHarmonizeQaRoom({ roomId }).then((found) => {
      if (cancelled) return;
      setAvailable(found.available);
      setJob(found.available ? found.job : null);
    }, () => {
      if (!cancelled) setAvailable(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, roomId]);

  useEffect(() => {
    if (!job || !harmonizeQaJobIsActive(job.status)) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void readHarmonizeQaJob({ jobId: job.id }).then((next) => {
        if (!cancelled && next) setJob(next);
      });
    }, HARMONIZE_QA_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job]);

  if (!isAdmin || !control) return null;

  const active = job != null && harmonizeQaJobIsActive(job.status);
  const unavailable = available === false;
  const disabled = unavailable || busy || active || !control.qaReady;

  const onClick = () => {
    if (disabled) return;
    const idempotencyKey = attemptGate.start();
    if (!idempotencyKey) return;
    setBusy(true);
    setError(null);
    void control.runQa(idempotencyKey).then(async (prepared) => {
      const enqueued = await submitHarmonizeQaAttempt(prepared);
      setJob({
        id: enqueued.jobId,
        status: enqueued.status,
        failureCode: null,
        failureMessage: null,
      });
    }).catch((failure: unknown) => {
      setError(harmonizeExportErrorMessage(failure));
    }).finally(() => {
      attemptGate.finish();
      setBusy(false);
    });
  };

  const onDownload = () => {
    if (!job || job.status !== "succeeded") return;
    setError(null);
    void fetchHarmonizeQaOutput({ jobId: job.id }).then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "harmonize-test.jpg";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }).catch((failure: unknown) => {
      setError(harmonizeExportErrorMessage(failure));
    });
  };

  const note = unavailable
    ? "Harmonize testing is unavailable."
    : error
      ?? job?.failureMessage
      ?? (job ? `Test ${job.status}.` : null);

  return (
    <div className="relative">
      <button
        type="button"
        data-harmonize-qa="true"
        aria-label="Test Harmonize"
        aria-busy={busy || active}
        disabled={disabled}
        title={note ?? "Submit this saved scene for a Harmonize test"}
        onClick={onClick}
        className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
          disabled
            ? "border-neutral-900 bg-neutral-950 text-neutral-600"
            : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
        }`}
      >
        {busy ? "Testing…" : "Test Harmonize"}
      </button>
      {job?.status === "succeeded" ? (
        <button
          type="button"
          aria-label="Download Harmonize JPEG"
          onClick={onDownload}
          className={`ml-2 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800 ${FOCUS}`}
        >
          Save JPEG
        </button>
      ) : null}
      {note ? (
        <p
          role="status"
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] leading-snug text-neutral-300"
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
