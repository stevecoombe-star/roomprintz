"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import AfcDiagnosticAdminCapturePanel from "../../AfcDiagnosticAdminCapturePanel";
import { AdminDiagnosticsCopyButton } from "@/lib/afc-v2-diagnostics/admin-diagnostics-copy-button";
import {
  AFC_DIAGNOSTIC_INSPECTOR_COPY,
  AFC_DIAGNOSTIC_INSPECTOR_PAGE_PATH,
  afcDiagnosticInspectorAttemptCountLabel,
  afcDiagnosticInspectorIntentLabel,
  afcDiagnosticInspectorMachineLabel,
  afcDiagnosticInspectorMachineText,
  afcDiagnosticInspectorRecoveryLabel,
  afcDiagnosticInspectorSessionErrorMessage,
  afcDiagnosticInspectorSessionSentence,
  buildAfcDiagnosticInspectorSessionUrl,
  formatAfcDiagnosticInspectorBytes,
  formatAfcDiagnosticInspectorDimensions,
  formatAfcDiagnosticInspectorTimestamp,
  isAfcDiagnosticInspectorAbortError,
  orderedAfcDiagnosticInspectorAttempts,
  parseAfcDiagnosticInspectorSessionDetail,
  parseAfcDiagnosticInspectorUuid,
  shortAfcDiagnosticInspectorRunId,
  shortAfcDiagnosticInspectorSha,
  shortAfcDiagnosticInspectorUuid,
  type AfcDiagnosticInspectorGenerationEvidence,
  type AfcDiagnosticInspectorSessionAttempt,
  type AfcDiagnosticInspectorSessionDetail,
  type AfcDiagnosticInspectorSourceSummary,
} from "@/lib/afc-v2-diagnostics/admin-case-inspector.client";
import { defaultAfcDiagnosticAdminCaptureAttemptOrdinal } from "@/lib/afc-v2-diagnostics/admin-case-capture.client";

const buttonClassName =
  "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

const cardClassName = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4";

function machineBadgeClass(status: string): string {
  if (status === "running") {
    return "border-sky-500/50 bg-sky-950/40 text-sky-200";
  }
  if (status === "failed") {
    return "border-rose-500/50 bg-rose-950/40 text-rose-200";
  }
  return "border-cyan-600/40 bg-slate-900 text-cyan-200";
}

function IdValue({
  value,
  short = shortAfcDiagnosticInspectorUuid(value),
  ariaLabel,
}: {
  value: string;
  short?: string;
  ariaLabel: string;
}) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="font-mono text-sm text-slate-100" title={value}>
        {short}
      </span>
      <AdminDiagnosticsCopyButton value={value} ariaLabel={ariaLabel} />
    </span>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-100">{children}</dd>
    </>
  );
}

function TimestampValue({ value }: { value: string | null | undefined }) {
  const formatted = formatAfcDiagnosticInspectorTimestamp(value);
  return <span title={formatted.title}>{formatted.display}</span>;
}

function SourceMetadata({ source }: { source: AfcDiagnosticInspectorSourceSummary }) {
  const bytes = formatAfcDiagnosticInspectorBytes(source.byteCount);
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
      <MetaRow label="SHA-256">
        <IdValue
          value={source.originalSha256}
          short={shortAfcDiagnosticInspectorSha(source.originalSha256)}
          ariaLabel="Copy SHA-256"
        />
      </MetaRow>
      <MetaRow label="Dimensions">
        {formatAfcDiagnosticInspectorDimensions(
          source.decodedWidth,
          source.decodedHeight,
        )}
      </MetaRow>
      <MetaRow label="Format">{source.mimeType ?? "—"}</MetaRow>
      <MetaRow label="Size">
        <span title={bytes.title}>{bytes.display}</span>
      </MetaRow>
      <MetaRow label="Orientation">{source.orientation ?? "—"}</MetaRow>
    </dl>
  );
}

function SelectedAttemptText({
  attempt,
  generation,
  associatedAt,
  attemptOrdinal,
  sessionId,
}: {
  attempt: AfcDiagnosticInspectorSessionAttempt | null;
  generation: AfcDiagnosticInspectorGenerationEvidence;
  associatedAt: string | null;
  attemptOrdinal: number | null;
  sessionId: string;
}) {
  return (
    <section className={cardClassName}>
      <h2 className="text-lg font-semibold tracking-tight">Selected attempt</h2>
      <div className="mt-4 space-y-5">
        <dl className="grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
          <MetaRow label="Attempt">
            {attemptOrdinal != null ? `Attempt #${attemptOrdinal}` : "—"}
          </MetaRow>
          <MetaRow label="Intent">
            {afcDiagnosticInspectorIntentLabel(attempt?.intent ?? generation.intent)}
          </MetaRow>
          <MetaRow label="Generation status">
            {afcDiagnosticInspectorMachineLabel(generation.status)}
          </MetaRow>
          <MetaRow label="Associated">
            <TimestampValue value={associatedAt} />
          </MetaRow>
          <MetaRow label="Generation ID">
            <IdValue
              value={generation.generationId}
              ariaLabel="Copy Generation ID"
            />
          </MetaRow>
          <MetaRow label="Created">
            <TimestampValue value={generation.createdAt} />
          </MetaRow>
          <MetaRow label="Completed">
            <TimestampValue value={generation.completedAt} />
          </MetaRow>
          <MetaRow label="Run ID">
            <IdValue
              value={generation.runId}
              short={shortAfcDiagnosticInspectorRunId(generation.runId)}
              ariaLabel="Copy run ID"
            />
          </MetaRow>
          <MetaRow label="metricStatus">
            {afcDiagnosticInspectorMachineText(generation.metricStatus)}
          </MetaRow>
          <MetaRow label="collisionStatus">
            {afcDiagnosticInspectorMachineText(generation.collisionStatus)}
          </MetaRow>
          <MetaRow label="analysisStatus">
            {afcDiagnosticInspectorMachineText(generation.analysisStatus)}
          </MetaRow>
          <MetaRow label="recoverySafeFailureState">
            {afcDiagnosticInspectorRecoveryLabel(generation.recoverySafeFailureState)}
          </MetaRow>
        </dl>
        {generation.failureReason != null ? (
          <div>
            <h3 className="text-xs uppercase tracking-wide text-slate-500">Failure</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">
              {generation.failureReason}
            </p>
          </div>
        ) : null}
        {generation.original ? (
          <div>
            <h3 className="text-xs uppercase tracking-wide text-slate-500">
              Attempt original
            </h3>
            <div className="mt-2">
              <SourceMetadata source={generation.original} />
            </div>
          </div>
        ) : null}
        <AfcDiagnosticAdminCapturePanel
          sessionId={sessionId}
          generationId={generation.generationId}
          status={generation.status}
          attemptOrdinal={attemptOrdinal}
        />
      </div>
    </section>
  );
}

export default function AfcDiagnosticSessionInspector({
  sessionId: rawSessionId,
  generationId: rawGenerationId,
}: {
  sessionId: string;
  generationId?: string;
}) {
  const parsedSessionId = parseAfcDiagnosticInspectorUuid(rawSessionId);
  const preferredGenerationId = parseAfcDiagnosticInspectorUuid(
    rawGenerationId ?? "",
  );
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">(() =>
    parsedSessionId ? "loading" : "error",
  );
  const [sessionDetail, setSessionDetail] =
    useState<AfcDiagnosticInspectorSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(() =>
    parsedSessionId ? null : AFC_DIAGNOSTIC_INSPECTOR_COPY.errorSessionGeneric,
  );
  const [selectedOrdinal, setSelectedOrdinal] = useState<number | null>(null);

  const loadSession = useCallback(async (sessionId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("loading");
    setError(null);
    try {
      const response = await fetch(buildAfcDiagnosticInspectorSessionUrl(sessionId), {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        setError(afcDiagnosticInspectorSessionErrorMessage(response.status));
        setPhase("error");
        setSessionDetail(null);
        return;
      }
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const parsed = parseAfcDiagnosticInspectorSessionDetail(payload);
      if (!parsed || parsed.sessionId !== sessionId) {
        setError(afcDiagnosticInspectorSessionErrorMessage(500));
        setPhase("error");
        setSessionDetail(null);
        return;
      }
      setSessionDetail(parsed);
      setPhase("ready");
    } catch (caught) {
      if (isAfcDiagnosticInspectorAbortError(caught)) return;
      setError(afcDiagnosticInspectorSessionErrorMessage("network"));
      setPhase("error");
      setSessionDetail(null);
    }
  }, []);

  useEffect(() => {
    if (!parsedSessionId) {
      setPhase("error");
      setError(AFC_DIAGNOSTIC_INSPECTOR_COPY.errorSessionGeneric);
      return () => {
        abortRef.current?.abort();
      };
    }
    void loadSession(parsedSessionId);
    return () => {
      abortRef.current?.abort();
    };
  }, [parsedSessionId, loadSession]);

  useEffect(() => {
    if (!sessionDetail) return;
    setSelectedOrdinal((current) =>
      defaultAfcDiagnosticAdminCaptureAttemptOrdinal({
        attempts: sessionDetail.attempts,
        preferredGenerationId,
        preserveOrdinal: current,
      }),
    );
  }, [sessionDetail, preferredGenerationId]);

  const attempts = useMemo(
    () =>
      sessionDetail
        ? orderedAfcDiagnosticInspectorAttempts(sessionDetail.attempts)
        : [],
    [sessionDetail],
  );
  const selectedAttempt =
    selectedOrdinal != null
      ? (attempts.find((attempt) => attempt.attemptOrdinal === selectedOrdinal) ??
        null)
      : null;
  const selectedGeneration = selectedAttempt?.generation ?? null;
  const shortSessionId = parsedSessionId
    ? shortAfcDiagnosticInspectorUuid(parsedSessionId)
    : rawSessionId.trim().slice(0, 8) || "—";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-50">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Diagnostic session
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <span className="font-mono" title={parsedSessionId ?? rawSessionId}>
                {shortSessionId}
              </span>
              {parsedSessionId ? (
                <AdminDiagnosticsCopyButton
                  value={parsedSessionId}
                  ariaLabel="Copy Session ID"
                />
              ) : null}
            </div>
          </div>
          <Link
            href={AFC_DIAGNOSTIC_INSPECTOR_PAGE_PATH}
            prefetch={false}
            className={buttonClassName}
          >
            {AFC_DIAGNOSTIC_INSPECTOR_COPY.inboxLink}
          </Link>
        </header>

        {error && !sessionDetail ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-700/60 bg-rose-950/20 p-4"
          >
            <p className="text-sm text-rose-200">{error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={AFC_DIAGNOSTIC_INSPECTOR_PAGE_PATH}
                prefetch={false}
                className={buttonClassName}
              >
                {AFC_DIAGNOSTIC_INSPECTOR_COPY.inboxLink}
              </Link>
              {parsedSessionId ? (
                <button
                  type="button"
                  className={buttonClassName}
                  onClick={() => void loadSession(parsedSessionId)}
                >
                  {AFC_DIAGNOSTIC_INSPECTOR_COPY.retry}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {phase === "loading" && !sessionDetail ? (
          <p className="text-sm text-slate-400">
            {AFC_DIAGNOSTIC_INSPECTOR_COPY.loadingSession}
          </p>
        ) : null}

        {sessionDetail ? (
          <div className="space-y-6">
            <section className={cardClassName}>
              <h2 className="text-lg font-semibold tracking-tight">Session</h2>
              <dl className="mt-4 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
                <MetaRow label="Session ID">
                  <IdValue
                    value={sessionDetail.sessionId}
                    ariaLabel="Copy Session ID"
                  />
                </MetaRow>
                <MetaRow label="Status">
                  {afcDiagnosticInspectorSessionSentence(sessionDetail.status)}
                </MetaRow>
                <MetaRow label="Attempts">
                  {afcDiagnosticInspectorAttemptCountLabel(
                    sessionDetail.attemptCount,
                  )}
                </MetaRow>
                <MetaRow label="Room ID">
                  <IdValue value={sessionDetail.roomId} ariaLabel="Copy Room ID" />
                </MetaRow>
                <MetaRow label="Session user ID">
                  <IdValue
                    value={sessionDetail.sessionUserId}
                    ariaLabel="Copy session user ID"
                  />
                </MetaRow>
                <MetaRow label="Original SHA">
                  <IdValue
                    value={sessionDetail.originalSha256}
                    short={shortAfcDiagnosticInspectorSha(
                      sessionDetail.originalSha256,
                    )}
                    ariaLabel="Copy SHA-256"
                  />
                </MetaRow>
                <MetaRow label="Created">
                  <TimestampValue value={sessionDetail.createdAt} />
                </MetaRow>
                <MetaRow label="Updated">
                  <TimestampValue value={sessionDetail.updatedAt} />
                </MetaRow>
              </dl>
            </section>

            <section className={cardClassName} aria-busy={phase === "loading"}>
              <h2 className="text-lg font-semibold tracking-tight">Attempts</h2>
              <ul className="mt-4 space-y-2">
                {attempts.map((attempt) => {
                  const selected = attempt.attemptOrdinal === selectedOrdinal;
                  const associated = formatAfcDiagnosticInspectorTimestamp(
                    attempt.associatedAt,
                  );
                  return (
                    <li key={`${attempt.attemptOrdinal}-${attempt.generationId}`}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-current={selected ? "true" : undefined}
                        className={`w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 ${
                          selected ? "ring-2 ring-emerald-400/70" : ""
                        }`}
                        onClick={() => {
                          if (attempt.attemptOrdinal === selectedOrdinal) return;
                          setSelectedOrdinal(attempt.attemptOrdinal);
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-100">
                            Attempt #{attempt.attemptOrdinal}
                          </span>
                          <span className="text-sm text-slate-300">
                            {afcDiagnosticInspectorIntentLabel(attempt.intent)}
                          </span>
                          <span
                            className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] ${machineBadgeClass(attempt.generation.status)}`}
                          >
                            {afcDiagnosticInspectorMachineLabel(
                              attempt.generation.status,
                            )}
                          </span>
                          <span
                            className="text-xs text-slate-400"
                            title={associated.title}
                          >
                            {associated.display}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {selectedGeneration ? (
              <SelectedAttemptText
                attempt={selectedAttempt}
                generation={selectedGeneration}
                associatedAt={selectedAttempt?.associatedAt ?? null}
                attemptOrdinal={selectedAttempt?.attemptOrdinal ?? null}
                sessionId={sessionDetail.sessionId}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
