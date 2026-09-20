"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";

import { AdminDiagnosticsCopyButton } from "@/lib/afc-v2-diagnostics/admin-diagnostics-copy-button";
import {
  AFC_DIAGNOSTIC_INSPECTOR_COPY,
  AFC_DIAGNOSTIC_INSPECTOR_PAGE_PATH,
  afcDiagnosticInspectorAttemptCountLabel,
  afcDiagnosticInspectorAttemptOriginalDiffers,
  afcDiagnosticInspectorArtifactSourceLabel,
  afcDiagnosticInspectorCaseErrorMessage,
  afcDiagnosticInspectorIntentLabel,
  afcDiagnosticInspectorIsUnreviewedNew,
  afcDiagnosticInspectorIssueChips,
  afcDiagnosticInspectorMachineLabel,
  afcDiagnosticInspectorMachineText,
  afcDiagnosticInspectorNotesText,
  afcDiagnosticInspectorParentAttemptOrdinal,
  afcDiagnosticInspectorRecoveryLabel,
  afcDiagnosticInspectorReviewLabel,
  afcDiagnosticInspectorReviewNotesText,
  afcDiagnosticInspectorSessionErrorMessage,
  afcDiagnosticInspectorSessionSentence,
  afcDiagnosticInspectorSourceText,
  buildAfcDiagnosticInspectorCaseUrl,
  buildAfcDiagnosticInspectorSessionUrl,
  createAfcDiagnosticInspectorRequestCoordinator,
  defaultAfcDiagnosticInspectorAttemptOrdinal,
  formatAfcDiagnosticInspectorBytes,
  formatAfcDiagnosticInspectorDimensions,
  formatAfcDiagnosticInspectorTimestamp,
  isAfcDiagnosticInspectorAbortError,
  isReportedAfcDiagnosticInspectorAttempt,
  orderedAfcDiagnosticInspectorAttempts,
  parseAfcDiagnosticInspectorCaseDetail,
  parseAfcDiagnosticInspectorSessionDetail,
  parseAfcDiagnosticInspectorUuid,
  shortAfcDiagnosticInspectorRunId,
  shortAfcDiagnosticInspectorSha,
  shortAfcDiagnosticInspectorUuid,
  type AfcDiagnosticInspectorCaseDetail,
  type AfcDiagnosticInspectorEngineFingerprint,
  type AfcDiagnosticInspectorGenerationEvidence,
  type AfcDiagnosticInspectorSessionAttempt,
  type AfcDiagnosticInspectorSessionDetail,
  type AfcDiagnosticInspectorSourceSummary,
} from "@/lib/afc-v2-diagnostics/admin-case-inspector.client";

const buttonClassName =
  "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

const cardClassName = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4";

function reviewBadgeClass(status: string): string {
  if (status === "in_review") {
    return "border-amber-500/50 bg-amber-950/40 text-amber-200";
  }
  if (status === "closed") {
    return "border-slate-600 bg-slate-900 text-slate-400";
  }
  return "border-slate-500 bg-slate-800/80 text-slate-200";
}

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

function IssueChips({ codes }: { codes: readonly string[] }) {
  const chips = afcDiagnosticInspectorIssueChips(codes);
  if (chips.length === 0) {
    return <span className="text-slate-500">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((chip) => (
        <span
          key={chip.key}
          title={chip.title}
          className="inline-flex rounded-md border border-slate-600 bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-200"
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function TimestampValue({ value }: { value: string | null | undefined }) {
  const formatted = formatAfcDiagnosticInspectorTimestamp(value);
  return <span title={formatted.title}>{formatted.display}</span>;
}

function ReportedBadge() {
  return (
    <span className="inline-flex rounded-md border border-emerald-500/70 bg-emerald-950/50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-100">
      {AFC_DIAGNOSTIC_INSPECTOR_COPY.reported}
    </span>
  );
}

function SourceMetadata({
  source,
  includeBaseAsset,
}: {
  source: AfcDiagnosticInspectorSourceSummary;
  includeBaseAsset: boolean;
}) {
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
      {includeBaseAsset ? (
        <MetaRow label="Base asset">
          {source.baseAssetId ? (
            <div className="space-y-1">
              <IdValue
                value={source.baseAssetId}
                ariaLabel="Copy base asset ID"
              />
              <p className="text-xs text-slate-500">
                {AFC_DIAGNOSTIC_INSPECTOR_COPY.baseAssetCaption}
              </p>
            </div>
          ) : (
            "—"
          )}
        </MetaRow>
      ) : null}
    </dl>
  );
}

function ArtifactRow({
  label,
  artifact,
}: {
  label: string;
  artifact: AfcDiagnosticInspectorGenerationEvidence["empty"];
}) {
  if (!artifact.present || artifact.sha256 == null) {
    return (
      <MetaRow label={label}>
        {AFC_DIAGNOSTIC_INSPECTOR_COPY.artifactNotPresent}
      </MetaRow>
    );
  }
  return (
    <MetaRow label={label}>
      <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
        <span>
          Present · {afcDiagnosticInspectorArtifactSourceLabel(artifact.artifactSource)} ·{" "}
          <span className="font-mono" title={artifact.sha256}>
            {shortAfcDiagnosticInspectorSha(artifact.sha256)}
          </span>
        </span>
        <AdminDiagnosticsCopyButton
          value={artifact.sha256}
          ariaLabel="Copy SHA-256"
        />
      </span>
    </MetaRow>
  );
}

function EngineDetails({
  fingerprint,
}: {
  fingerprint: AfcDiagnosticInspectorEngineFingerprint | null;
}) {
  if (fingerprint == null) {
    return <p className="text-sm text-slate-400">{AFC_DIAGNOSTIC_INSPECTOR_COPY.engineUnavailable}</p>;
  }
  return (
    <dl className="grid grid-cols-[minmax(9rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
      <MetaRow label="Fingerprint schema">
        {fingerprint.fingerprintSchemaVersion}
      </MetaRow>
      <MetaRow label="Production schema">
        {fingerprint.productionSchemaVersion}
      </MetaRow>
      <MetaRow label="Observation model">{fingerprint.observationModelId}</MetaRow>
      <MetaRow label="Git SHA">
        {fingerprint.gitSha ? (
          <IdValue
            value={fingerprint.gitSha}
            short={shortAfcDiagnosticInspectorSha(fingerprint.gitSha)}
            ariaLabel="Copy Git SHA"
          />
        ) : (
          "Not available"
        )}
      </MetaRow>
      <MetaRow label="Live product version">
        {fingerprint.engineVersions.liveProduct}
      </MetaRow>
      <MetaRow label="Auto metric version">
        {fingerprint.engineVersions.autoMetric}
      </MetaRow>
      <MetaRow label="Camera calibration version">
        {fingerprint.engineVersions.cameraCalibration}
      </MetaRow>
      <MetaRow label="Camera authority version">
        {fingerprint.engineVersions.cameraAuthority}
      </MetaRow>
      <MetaRow label="Collision version">
        {fingerprint.engineVersions.collision}
      </MetaRow>
      <MetaRow label="Empty authoritative collision version">
        {fingerprint.engineVersions.emptyAuthoritativeCollision}
      </MetaRow>
      <MetaRow label="TILED generator version">
        {fingerprint.tiled.generatorId}
      </MetaRow>
      <MetaRow label="TILED profile version">{fingerprint.tiled.profileId}</MetaRow>
      <MetaRow label="TILED research preset">
        {fingerprint.tiled.researchPreset}
      </MetaRow>
      <MetaRow label="TILED requested model">
        {fingerprint.tiled.requestedModelId}
      </MetaRow>
      <MetaRow label="TILED reader version">
        {fingerprint.tiled.readerVersion ?? "Not available"}
      </MetaRow>
    </dl>
  );
}

function SelectedAttemptInspector({
  caseDetail,
  session,
  attempt,
  generation,
  associatedAt,
  attemptOrdinal,
}: {
  caseDetail: AfcDiagnosticInspectorCaseDetail;
  session: AfcDiagnosticInspectorSessionDetail | null;
  attempt: AfcDiagnosticInspectorSessionAttempt | null;
  generation: AfcDiagnosticInspectorGenerationEvidence;
  associatedAt: string | null;
  attemptOrdinal: number | null;
}) {
  const reported = isReportedAfcDiagnosticInspectorAttempt({
    attemptOrdinal: attemptOrdinal ?? caseDetail.reportedAttemptOrdinal ?? 0,
    generationId: generation.generationId,
    reportedAttemptOrdinal: caseDetail.reportedAttemptOrdinal,
    reportedGenerationId: caseDetail.reportedGenerationId,
  });
  const attempts = session?.attempts ?? [];
  const parentMatch = afcDiagnosticInspectorParentAttemptOrdinal(
    attempts,
    generation.parentGenerationId,
    attemptOrdinal ?? undefined,
  );
  const originalDiffers = afcDiagnosticInspectorAttemptOriginalDiffers(
    caseDetail.source.originalSha256,
    generation.original?.originalSha256,
  );

  return (
    <section className={cardClassName}>
      <h2 className="text-lg font-semibold tracking-tight">Selected attempt</h2>
      {reported ? (
        <p className="mt-1 text-sm text-slate-400">
          {AFC_DIAGNOSTIC_INSPECTOR_COPY.reportedHelper}
        </p>
      ) : null}

      <div className="mt-4 space-y-5">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500">Attempt</h3>
          <dl className="mt-2 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
            <MetaRow label="Attempt">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {attemptOrdinal != null ? `Attempt #${attemptOrdinal}` : "—"}
                {reported ? <ReportedBadge /> : null}
              </span>
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
          </dl>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500">Processing</h3>
          <dl className="mt-2 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
            <MetaRow label="Status">
              {afcDiagnosticInspectorMachineLabel(generation.status)}
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
          </dl>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500">
            Geometry / analysis
          </h3>
          <dl className="mt-2 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
            <MetaRow label="metricStatus">
              {afcDiagnosticInspectorMachineText(generation.metricStatus)}
            </MetaRow>
            <MetaRow label="collisionStatus">
              {afcDiagnosticInspectorMachineText(generation.collisionStatus)}
            </MetaRow>
            <MetaRow label="analysisStatus">
              {afcDiagnosticInspectorMachineText(generation.analysisStatus)}
            </MetaRow>
            <MetaRow label="analysisReason">
              {afcDiagnosticInspectorMachineText(generation.analysisReason)}
            </MetaRow>
            <MetaRow label="recoverySafeFailureState">
              {afcDiagnosticInspectorRecoveryLabel(
                generation.recoverySafeFailureState,
              )}
            </MetaRow>
          </dl>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500">Frame</h3>
          <p className="mt-2 text-sm text-slate-100">
            {generation.frame
              ? `${generation.frame.width} × ${generation.frame.height}`
              : AFC_DIAGNOSTIC_INSPECTOR_COPY.frameUnavailable}
          </p>
        </div>

        {generation.failureReason != null ? (
          <div>
            <h3 className="text-xs uppercase tracking-wide text-slate-500">Failure</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">
              {generation.failureReason}
            </p>
          </div>
        ) : null}

        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500">Artifacts</h3>
          <dl className="mt-2 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
            <ArtifactRow label="EMPTY" artifact={generation.empty} />
            <ArtifactRow label="TILED" artifact={generation.tiled} />
          </dl>
        </div>

        {originalDiffers && generation.original ? (
          <div>
            <h3 className="text-xs uppercase tracking-wide text-slate-500">
              {AFC_DIAGNOSTIC_INSPECTOR_COPY.attemptOriginalDiffers}
            </h3>
            <div className="mt-2">
              <SourceMetadata source={generation.original} includeBaseAsset={false} />
            </div>
          </div>
        ) : null}

        <details className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <summary className="cursor-pointer text-sm text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80">
            Technical details
          </summary>
          <div className="mt-3 space-y-4">
            <dl className="grid grid-cols-[minmax(9rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
              <MetaRow label="Generation ID">
                <IdValue
                  value={generation.generationId}
                  ariaLabel="Copy Generation ID"
                />
              </MetaRow>
              <MetaRow label="Parent generation">
                <div className="space-y-1">
                  {generation.parentGenerationId ? (
                    <IdValue
                      value={generation.parentGenerationId}
                      ariaLabel="Copy parent generation ID"
                    />
                  ) : (
                    "—"
                  )}
                  <p className="text-xs text-slate-500">
                    {AFC_DIAGNOSTIC_INSPECTOR_COPY.parentHelper}
                  </p>
                  {parentMatch != null ? (
                    <p className="text-xs text-slate-400">
                      same as Attempt #{parentMatch}
                    </p>
                  ) : null}
                </div>
              </MetaRow>
              <MetaRow label="AFC lineage">{`AFC lineage ${generation.lineageSeq}`}</MetaRow>
              <MetaRow label="Room ID">
                <IdValue value={generation.roomId} ariaLabel="Copy Room ID" />
              </MetaRow>
              <MetaRow label="Generation user ID">
                <IdValue
                  value={generation.userId}
                  ariaLabel="Copy Generation user ID"
                />
              </MetaRow>
              {generation.empty.sha256 ? (
                <MetaRow label="EMPTY SHA">
                  <IdValue
                    value={generation.empty.sha256}
                    short={shortAfcDiagnosticInspectorSha(generation.empty.sha256)}
                    ariaLabel="Copy SHA-256"
                  />
                </MetaRow>
              ) : null}
              {generation.tiled.sha256 ? (
                <MetaRow label="TILED SHA">
                  <IdValue
                    value={generation.tiled.sha256}
                    short={shortAfcDiagnosticInspectorSha(generation.tiled.sha256)}
                    ariaLabel="Copy SHA-256"
                  />
                </MetaRow>
              ) : null}
            </dl>
            <details className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <summary className="cursor-pointer text-sm text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80">
                Engine details
              </summary>
              <div className="mt-3">
                <EngineDetails fingerprint={generation.engineFingerprint} />
              </div>
            </details>
          </div>
        </details>
      </div>
    </section>
  );
}

export default function AfcDiagnosticCaseInspector({
  caseId: rawCaseId,
}: {
  caseId: string;
}) {
  const coordinatorRef = useRef(createAfcDiagnosticInspectorRequestCoordinator());
  const parsedCaseId = parseAfcDiagnosticInspectorUuid(rawCaseId);

  const [casePhase, setCasePhase] = useState<
    "loading" | "refreshing" | "ready" | "error"
  >(() => (parseAfcDiagnosticInspectorUuid(rawCaseId) ? "loading" : "error"));
  const [sessionPhase, setSessionPhase] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [caseDetail, setCaseDetail] =
    useState<AfcDiagnosticInspectorCaseDetail | null>(null);
  const [sessionDetail, setSessionDetail] =
    useState<AfcDiagnosticInspectorSessionDetail | null>(null);
  const [caseError, setCaseError] = useState<string | null>(() =>
    parseAfcDiagnosticInspectorUuid(rawCaseId)
      ? null
      : AFC_DIAGNOSTIC_INSPECTOR_COPY.errorNotFound,
  );
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [selectedOrdinal, setSelectedOrdinal] = useState<number | null>(null);

  const loadSession = useCallback(
    async (seq: number, sessionId: string, mode: "follow" | "retry") => {
      const started =
        mode === "retry"
          ? coordinatorRef.current.retrySession()
          : coordinatorRef.current.beginSession(seq, sessionId);
      if (!started.started) return;
      setSessionError(null);
      setSessionPhase("loading");
      if (mode === "retry") {
        setSessionDetail(null);
      }
      try {
        const response = await fetch(
          buildAfcDiagnosticInspectorSessionUrl(started.sessionId),
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: started.signal,
          },
        );
        if (
          !coordinatorRef.current.shouldCommitSession(
            started.seq,
            started.sessionId,
          )
        ) {
          return;
        }
        if (!response.ok) {
          setSessionError(
            afcDiagnosticInspectorSessionErrorMessage(response.status),
          );
          setSessionPhase("error");
          return;
        }
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (
          !coordinatorRef.current.shouldCommitSession(
            started.seq,
            started.sessionId,
          )
        ) {
          return;
        }
        const parsed = parseAfcDiagnosticInspectorSessionDetail(payload);
        if (!parsed || parsed.sessionId !== started.sessionId) {
          setSessionError(afcDiagnosticInspectorSessionErrorMessage(500));
          setSessionPhase("error");
          return;
        }
        setSessionDetail(parsed);
        setSessionPhase("ready");
      } catch (error) {
        if (isAfcDiagnosticInspectorAbortError(error)) return;
        if (
          !coordinatorRef.current.shouldCommitSession(
            started.seq,
            started.sessionId,
          )
        ) {
          return;
        }
        setSessionError(afcDiagnosticInspectorSessionErrorMessage("network"));
        setSessionPhase("error");
      }
    },
    [],
  );

  const loadCase = useCallback(
    async (caseId: string, mode: "page1" | "refresh") => {
      const started = coordinatorRef.current.beginCase();
      setCaseError(null);
      setSessionError(null);
      if (mode === "page1") {
        setCasePhase("loading");
        setCaseDetail(null);
        setSessionDetail(null);
        setSessionPhase("idle");
        setSelectedOrdinal(null);
      } else {
        setCasePhase("refreshing");
      }

      try {
        const response = await fetch(buildAfcDiagnosticInspectorCaseUrl(caseId), {
          credentials: "same-origin",
          cache: "no-store",
          signal: started.signal,
        });
        if (!coordinatorRef.current.isCurrentCase(started.seq)) return;
        if (!response.ok) {
          setCaseError(afcDiagnosticInspectorCaseErrorMessage(response.status));
          setCasePhase("error");
          setCaseDetail(null);
          setSessionDetail(null);
          setSessionPhase("idle");
          return;
        }
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!coordinatorRef.current.isCurrentCase(started.seq)) return;
        const parsed = parseAfcDiagnosticInspectorCaseDetail(payload);
        if (!parsed) {
          setCaseError(afcDiagnosticInspectorCaseErrorMessage(500));
          setCasePhase("error");
          setCaseDetail(null);
          setSessionDetail(null);
          setSessionPhase("idle");
          return;
        }
        setCaseDetail(parsed);
        setCasePhase("ready");
        setSessionDetail(null);
        setSessionPhase("loading");
        setSelectedOrdinal((current) =>
          mode === "refresh" ? current : parsed.reportedAttemptOrdinal,
        );
        await loadSession(started.seq, parsed.sessionId, "follow");
      } catch (error) {
        if (isAfcDiagnosticInspectorAbortError(error)) return;
        if (!coordinatorRef.current.isCurrentCase(started.seq)) return;
        setCaseError(afcDiagnosticInspectorCaseErrorMessage("network"));
        setCasePhase("error");
        setCaseDetail(null);
        setSessionDetail(null);
        setSessionPhase("idle");
      }
    },
    [loadSession],
  );

  useEffect(() => {
    if (!parsedCaseId) {
      coordinatorRef.current.abortAll();
      setCasePhase("error");
      setCaseError(AFC_DIAGNOSTIC_INSPECTOR_COPY.errorNotFound);
      setCaseDetail(null);
      setSessionDetail(null);
      setSessionPhase("idle");
      return () => {
        coordinatorRef.current.abortAll();
      };
    }
    void loadCase(parsedCaseId, "page1");
    return () => {
      coordinatorRef.current.abortAll();
    };
  }, [parsedCaseId, loadCase]);

  useEffect(() => {
    if (!caseDetail || !sessionDetail) return;
    setSelectedOrdinal((current) =>
      defaultAfcDiagnosticInspectorAttemptOrdinal({
        attempts: sessionDetail.attempts,
        reportedAttemptOrdinal: caseDetail.reportedAttemptOrdinal,
        reportedGenerationId: caseDetail.reportedGenerationId,
        preserveOrdinal: current,
      }),
    );
  }, [caseDetail, sessionDetail]);

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
  const selectedGeneration =
    selectedAttempt?.generation ?? caseDetail?.reportedGeneration ?? null;
  const sessionHeader = sessionDetail ?? caseDetail?.session ?? null;
  const invalidId = parsedCaseId == null;
  const caseBusy = casePhase === "loading" || casePhase === "refreshing";
  const sessionBusy = sessionPhase === "loading";
  const shortCaseId = parsedCaseId
    ? shortAfcDiagnosticInspectorUuid(parsedCaseId)
    : rawCaseId.trim().slice(0, 8) || "—";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-50">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {AFC_DIAGNOSTIC_INSPECTOR_COPY.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <span className="font-mono" title={parsedCaseId ?? rawCaseId}>
                {shortCaseId}
              </span>
              {parsedCaseId ? (
                <AdminDiagnosticsCopyButton
                  value={parsedCaseId}
                  ariaLabel="Copy Case ID"
                />
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={AFC_DIAGNOSTIC_INSPECTOR_PAGE_PATH}
              prefetch={false}
              className={buttonClassName}
            >
              {AFC_DIAGNOSTIC_INSPECTOR_COPY.inboxLink}
            </Link>
            {parsedCaseId ? (
              <button
                type="button"
                className={buttonClassName}
                disabled={caseBusy}
                onClick={() => void loadCase(parsedCaseId, "refresh")}
              >
                {casePhase === "refreshing"
                  ? AFC_DIAGNOSTIC_INSPECTOR_COPY.refreshing
                  : AFC_DIAGNOSTIC_INSPECTOR_COPY.refresh}
              </button>
            ) : null}
          </div>
        </header>

        {caseError && !caseDetail ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-700/60 bg-rose-950/20 p-4"
          >
            <p className="text-sm text-rose-200">{caseError}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={AFC_DIAGNOSTIC_INSPECTOR_PAGE_PATH}
                prefetch={false}
                className={buttonClassName}
              >
                {AFC_DIAGNOSTIC_INSPECTOR_COPY.inboxLink}
              </Link>
              {!invalidId ? (
                <button
                  type="button"
                  className={buttonClassName}
                  onClick={() => void loadCase(parsedCaseId, "page1")}
                >
                  {AFC_DIAGNOSTIC_INSPECTOR_COPY.retry}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {casePhase === "loading" && !caseDetail ? (
          <p className="text-sm text-slate-400">
            {AFC_DIAGNOSTIC_INSPECTOR_COPY.loadingCase}
          </p>
        ) : null}

        {caseDetail ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_auto_auto_auto]">
            <section className={`${cardClassName} order-1 lg:col-start-1 lg:row-start-1`}>
              <h2 className="text-lg font-semibold tracking-tight">Case summary</h2>
              <dl className="mt-4 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
                <MetaRow label="Case ID">
                  <IdValue value={caseDetail.caseId} ariaLabel="Copy Case ID" />
                </MetaRow>
                <MetaRow label="Submitted">
                  <TimestampValue value={caseDetail.submittedAt} />
                </MetaRow>
                <MetaRow label="Review status">
                  <span
                    className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] ${reviewBadgeClass(caseDetail.review.reviewStatus)}`}
                  >
                    {afcDiagnosticInspectorReviewLabel(
                      caseDetail.review.reviewStatus,
                    )}
                  </span>
                </MetaRow>
                <MetaRow label="Origin · trigger">
                  {afcDiagnosticInspectorSourceText(
                    caseDetail.origin,
                    caseDetail.trigger,
                  )}
                </MetaRow>
                <MetaRow label="Issues">
                  <IssueChips codes={caseDetail.issueCodes} />
                </MetaRow>
                <MetaRow label="Machine snapshot">
                  <span
                    className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] ${machineBadgeClass(caseDetail.machineStatusSnapshot)}`}
                  >
                    {afcDiagnosticInspectorMachineLabel(
                      caseDetail.machineStatusSnapshot,
                    )}
                  </span>
                </MetaRow>
                <MetaRow label="Reported attempt">
                  {caseDetail.reportedAttemptOrdinal != null
                    ? caseDetail.reportedAttemptOrdinal
                    : "—"}
                </MetaRow>
                <MetaRow label="Reported generation">
                  <IdValue
                    value={caseDetail.reportedGenerationId}
                    ariaLabel="Copy Generation ID"
                  />
                </MetaRow>
                <MetaRow label="Session status">
                  {afcDiagnosticInspectorSessionSentence(
                    sessionHeader?.status ?? caseDetail.session.status,
                  )}
                </MetaRow>
                <MetaRow label="Attempts">
                  {afcDiagnosticInspectorAttemptCountLabel(
                    sessionHeader?.attemptCount ??
                      caseDetail.session.attemptCount,
                  )}
                </MetaRow>
                <MetaRow label="Room ID">
                  <IdValue value={caseDetail.roomId} ariaLabel="Copy Room ID" />
                </MetaRow>
                <MetaRow label="Session ID">
                  <IdValue
                    value={caseDetail.sessionId}
                    ariaLabel="Copy Session ID"
                  />
                </MetaRow>
                <MetaRow label="Reporter ID">
                  <IdValue
                    value={caseDetail.reporterUserId}
                    ariaLabel="Copy Reporter ID"
                  />
                </MetaRow>
              </dl>
            </section>

            <section className={`${cardClassName} order-2 lg:col-start-1 lg:row-start-2`}>
              <h2 className="text-lg font-semibold tracking-tight">Reported issue</h2>
              <div className="mt-4 space-y-3">
                <IssueChips codes={caseDetail.issueCodes} />
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-slate-500">
                    Tester notes
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">
                    {afcDiagnosticInspectorNotesText(caseDetail.notes)}
                  </p>
                </div>
                <details className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <summary className="cursor-pointer text-sm text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80">
                    Technical details
                  </summary>
                  <dl className="mt-3 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
                    <MetaRow label="Taxonomy version">
                      {caseDetail.taxonomyVersion}
                    </MetaRow>
                  </dl>
                </details>
              </div>
            </section>

            <section className={`${cardClassName} order-3 lg:col-start-2 lg:row-start-2`}>
              <h2 className="text-lg font-semibold tracking-tight">Admin review</h2>
              <dl className="mt-4 grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
                <MetaRow label="Status">
                  <span
                    className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] ${reviewBadgeClass(caseDetail.review.reviewStatus)}`}
                  >
                    {afcDiagnosticInspectorReviewLabel(
                      caseDetail.review.reviewStatus,
                    )}
                  </span>
                </MetaRow>
                {afcDiagnosticInspectorIsUnreviewedNew(caseDetail.review) ? (
                  <MetaRow label="Review">
                    {AFC_DIAGNOSTIC_INSPECTOR_COPY.notReviewedYet}
                  </MetaRow>
                ) : (
                  <>
                    <MetaRow label="Reviewer">
                      {caseDetail.review.reviewerUserId ? (
                        <IdValue
                          value={caseDetail.review.reviewerUserId}
                          ariaLabel="Copy reviewer ID"
                        />
                      ) : (
                        "—"
                      )}
                    </MetaRow>
                    <MetaRow label="Reviewed at">
                      <TimestampValue value={caseDetail.review.reviewedAt} />
                    </MetaRow>
                    <MetaRow label="Review notes">
                      <p className="whitespace-pre-wrap">
                        {afcDiagnosticInspectorReviewNotesText(caseDetail.review)}
                      </p>
                    </MetaRow>
                  </>
                )}
              </dl>
            </section>

            <section className={`${cardClassName} order-4 lg:col-start-2 lg:row-start-1`}>
              <h2 className="text-lg font-semibold tracking-tight">
                Source photograph
              </h2>
              <div className="mt-4">
                <SourceMetadata source={caseDetail.source} includeBaseAsset />
              </div>
            </section>

            <section
              className={`${cardClassName} order-5 lg:col-start-1 lg:row-start-3`}
              aria-busy={sessionBusy}
            >
              <h2 className="text-lg font-semibold tracking-tight">
                Diagnostic session
              </h2>
              {sessionHeader ? (
                <dl className="mt-4 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
                  <MetaRow label="Session ID">
                    <IdValue
                      value={sessionHeader.sessionId}
                      ariaLabel="Copy Session ID"
                    />
                  </MetaRow>
                  <MetaRow label="Status">
                    {afcDiagnosticInspectorSessionSentence(sessionHeader.status)}
                  </MetaRow>
                  <MetaRow label="Attempts">
                    {afcDiagnosticInspectorAttemptCountLabel(
                      sessionHeader.attemptCount,
                    )}
                  </MetaRow>
                  <MetaRow label="Created">
                    <TimestampValue value={sessionHeader.createdAt} />
                  </MetaRow>
                  <MetaRow label="Updated">
                    <TimestampValue value={sessionHeader.updatedAt} />
                  </MetaRow>
                </dl>
              ) : null}

              <details className="mt-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <summary className="cursor-pointer text-sm text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80">
                  Session technical details
                </summary>
                <dl className="mt-3 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
                  <MetaRow label="Session user ID">
                    <IdValue
                      value={
                        sessionDetail?.sessionUserId ??
                        caseDetail.session.sessionUserId
                      }
                      ariaLabel="Copy session user ID"
                    />
                  </MetaRow>
                  <MetaRow label="Original SHA">
                    <IdValue
                      value={
                        sessionDetail?.originalSha256 ??
                        caseDetail.session.originalSha256
                      }
                      short={shortAfcDiagnosticInspectorSha(
                        sessionDetail?.originalSha256 ??
                          caseDetail.session.originalSha256,
                      )}
                      ariaLabel="Copy SHA-256"
                    />
                  </MetaRow>
                  <MetaRow label="Base asset">
                    {sessionDetail?.baseAssetId ? (
                      <div className="space-y-1">
                        <IdValue
                          value={sessionDetail.baseAssetId}
                          ariaLabel="Copy base asset ID"
                        />
                        <p className="text-xs text-slate-500">
                          {AFC_DIAGNOSTIC_INSPECTOR_COPY.baseAssetCaption}
                        </p>
                      </div>
                    ) : (
                      "—"
                    )}
                  </MetaRow>
                </dl>
              </details>

              <div className="mt-5" aria-busy={sessionBusy}>
                {sessionBusy ? (
                  <p className="text-sm text-slate-400">
                    {AFC_DIAGNOSTIC_INSPECTOR_COPY.loadingSession}
                  </p>
                ) : null}
                {sessionError ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-rose-700/60 bg-rose-950/20 p-3"
                  >
                    <p className="text-sm text-rose-200">{sessionError}</p>
                    <button
                      type="button"
                      className={`${buttonClassName} mt-3`}
                      onClick={() => {
                        if (!parsedCaseId || !caseDetail) return;
                        void loadSession(
                          coordinatorRef.current.currentSeq(),
                          caseDetail.sessionId,
                          "retry",
                        );
                      }}
                    >
                      {AFC_DIAGNOSTIC_INSPECTOR_COPY.retry}
                    </button>
                  </div>
                ) : null}
                {sessionPhase === "ready" ? (
                  <ul className="mt-3 space-y-2">
                    {attempts.map((attempt) => {
                      const selected = attempt.attemptOrdinal === selectedOrdinal;
                      const reported = isReportedAfcDiagnosticInspectorAttempt({
                        attemptOrdinal: attempt.attemptOrdinal,
                        generationId: attempt.generationId,
                        reportedAttemptOrdinal: caseDetail.reportedAttemptOrdinal,
                        reportedGenerationId: caseDetail.reportedGenerationId,
                      });
                      const associated = formatAfcDiagnosticInspectorTimestamp(
                        attempt.associatedAt,
                      );
                      return (
                        <li key={`${attempt.attemptOrdinal}-${attempt.generationId}`}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            aria-current={selected ? "true" : undefined}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 ${
                              reported
                                ? "border-emerald-500/70 bg-emerald-950/30"
                                : "border-slate-800 bg-slate-950/40"
                            } ${selected ? "ring-2 ring-emerald-400/70" : ""}`}
                            onClick={() => {
                              if (attempt.attemptOrdinal === selectedOrdinal) return;
                              setSelectedOrdinal(attempt.attemptOrdinal);
                            }}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-100">
                                Attempt #{attempt.attemptOrdinal}
                              </span>
                              {reported ? <ReportedBadge /> : null}
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
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                              <span>{`AFC lineage ${attempt.generation.lineageSeq}`}</span>
                              <span
                                className="font-mono"
                                title={attempt.generationId}
                              >
                                {shortAfcDiagnosticInspectorUuid(attempt.generationId)}
                              </span>
                              <span>
                                {afcDiagnosticInspectorMachineText(
                                  attempt.generation.metricStatus,
                                )}
                              </span>
                              <span>
                                {afcDiagnosticInspectorMachineText(
                                  attempt.generation.collisionStatus,
                                )}
                              </span>
                              <span>
                                {afcDiagnosticInspectorMachineText(
                                  attempt.generation.analysisStatus,
                                )}
                              </span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </section>

            <div className="order-6 lg:col-start-1 lg:row-start-4">
              {selectedGeneration ? (
                <SelectedAttemptInspector
                  caseDetail={caseDetail}
                  session={sessionDetail}
                  attempt={selectedAttempt}
                  generation={selectedGeneration}
                  associatedAt={selectedAttempt?.associatedAt ?? null}
                  attemptOrdinal={
                    selectedAttempt?.attemptOrdinal ??
                    caseDetail.reportedAttemptOrdinal
                  }
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
