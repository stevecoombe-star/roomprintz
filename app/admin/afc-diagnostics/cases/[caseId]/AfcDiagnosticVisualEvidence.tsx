"use client";

import { useEffect, useRef, useState } from "react";

import { AdminDiagnosticsCopyButton } from "@/lib/afc-v2-diagnostics/admin-diagnostics-copy-button";
import { afcDiagnosticInspectorArtifactSourceLabel } from "@/lib/afc-v2-diagnostics/admin-case-inspector.client";
import {
  AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS,
  AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY,
  afcDiagnosticVisualArtifactLabel,
  afcDiagnosticVisualEvidenceErrorMessage,
  afcDiagnosticVisualEvidenceTupleKey,
  afcDiagnosticVisualImageAlt,
  buildAfcDiagnosticVisualArtifactUrl,
  createAfcDiagnosticVisualEvidenceCoordinator,
  defaultAfcDiagnosticVisualArtifactKind,
  isAfcDiagnosticVisualAbortError,
  revokeAfcDiagnosticVisualObjectUrl,
  type AfcDiagnosticVisualArtifactKind,
} from "@/lib/afc-v2-diagnostics/admin-visual-evidence.client";

const buttonClassName =
  "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

type ArtifactSummary = Readonly<{
  present: boolean;
  sha256: string | null;
  artifactSource: string | null;
}>;

function shortSha(value: string): string {
  return value.slice(0, 8);
}

function metadataPresent(
  kind: AfcDiagnosticVisualArtifactKind,
  empty: ArtifactSummary,
  tiled: ArtifactSummary,
  originalSha256: string | null,
): boolean {
  if (kind === "empty") return empty.present;
  if (kind === "tiled") return tiled.present;
  return originalSha256 != null && originalSha256.length > 0;
}

function currentSha(
  kind: AfcDiagnosticVisualArtifactKind,
  empty: ArtifactSummary,
  tiled: ArtifactSummary,
  originalSha256: string | null,
): string | null {
  if (kind === "empty") return empty.sha256;
  if (kind === "tiled") return tiled.sha256;
  return originalSha256;
}

function currentSource(
  kind: AfcDiagnosticVisualArtifactKind,
  empty: ArtifactSummary,
  tiled: ArtifactSummary,
): string | null {
  if (kind === "empty") return empty.artifactSource;
  if (kind === "tiled") return tiled.artifactSource;
  return null;
}

export default function AfcDiagnosticVisualEvidence({
  caseId,
  generationId,
  attemptOrdinal,
  reported,
  empty,
  tiled,
  originalSha256,
}: {
  caseId: string;
  generationId: string;
  attemptOrdinal: number | null;
  reported: boolean;
  empty: ArtifactSummary;
  tiled: ArtifactSummary;
  originalSha256: string | null;
}) {
  const coordinatorRef = useRef(createAfcDiagnosticVisualEvidenceCoordinator());
  const objectUrlRef = useRef<string | null>(null);
  const metaRef = useRef({ empty, tiled, originalSha256 });
  metaRef.current = { empty, tiled, originalSha256 };
  const [kind, setKind] = useState<AfcDiagnosticVisualArtifactKind>(() =>
    defaultAfcDiagnosticVisualArtifactKind({
      emptyPresent: empty.present,
      tiledPresent: tiled.present,
    }),
  );
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | "network" | "blob" | null>(
    null,
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [committedKey, setCommittedKey] = useState<string | null>(null);
  const identityKey = afcDiagnosticVisualEvidenceTupleKey({
    caseId,
    generationId,
    kind,
  });
  const isCommitted = committedKey === identityKey;

  useEffect(() => {
    const started = coordinatorRef.current.begin({
      caseId,
      generationId,
      kind,
    });
    setPhase("loading");
    setError(null);
    setErrorStatus(null);
    if (objectUrlRef.current) {
      revokeAfcDiagnosticVisualObjectUrl(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setImageUrl(null);

    void (async () => {
      try {
        const response = await fetch(
          buildAfcDiagnosticVisualArtifactUrl(started.tuple),
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: started.signal,
          },
        );
        if (!coordinatorRef.current.isCurrent(started.seq, started.tuple)) {
          return;
        }
        if (!response.ok) {
          const present = metadataPresent(
            started.tuple.kind,
            metaRef.current.empty,
            metaRef.current.tiled,
            metaRef.current.originalSha256,
          );
          setError(
            afcDiagnosticVisualEvidenceErrorMessage({
              status: response.status,
              kind: started.tuple.kind,
              metadataPresent: present,
            }),
          );
          setErrorStatus(response.status);
          setCommittedKey(afcDiagnosticVisualEvidenceTupleKey(started.tuple));
          setPhase("error");
          return;
        }
        const blob = await response.blob();
        if (!coordinatorRef.current.isCurrent(started.seq, started.tuple)) {
          return;
        }
        if (blob.size === 0) {
          setError(AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.generic);
          setErrorStatus("blob");
          setCommittedKey(afcDiagnosticVisualEvidenceTupleKey(started.tuple));
          setPhase("error");
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        if (!coordinatorRef.current.isCurrent(started.seq, started.tuple)) {
          revokeAfcDiagnosticVisualObjectUrl(objectUrl);
          return;
        }
        if (objectUrlRef.current) {
          revokeAfcDiagnosticVisualObjectUrl(objectUrlRef.current);
        }
        objectUrlRef.current = objectUrl;
        setImageUrl(objectUrl);
        setCommittedKey(afcDiagnosticVisualEvidenceTupleKey(started.tuple));
        setPhase("ready");
      } catch (cause) {
        if (isAfcDiagnosticVisualAbortError(cause)) return;
        if (!coordinatorRef.current.isCurrent(started.seq, started.tuple)) {
          return;
        }
        setError(AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.generic);
        setErrorStatus("network");
        setCommittedKey(afcDiagnosticVisualEvidenceTupleKey(started.tuple));
        setPhase("error");
      }
    })();

    return () => {
      coordinatorRef.current.abort();
      if (objectUrlRef.current) {
        revokeAfcDiagnosticVisualObjectUrl(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [caseId, generationId, kind, retryNonce]);

  const sha = currentSha(kind, empty, tiled, originalSha256);
  const source = currentSource(kind, empty, tiled);
  const present = metadataPresent(kind, empty, tiled, originalSha256);
  let statusLabel: string | null = null;
  if (kind === "original") {
    if (isCommitted && phase === "ready") {
      statusLabel = AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.present;
    } else if (isCommitted && phase === "error" && errorStatus === 404) {
      statusLabel = AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.unavailable;
    }
  } else if (!present) {
    statusLabel = AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.notPresent;
  } else if (isCommitted && phase === "error" && errorStatus === 404) {
    statusLabel = AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.unavailable;
  } else {
    statusLabel = AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.present;
  }
  const sourceLabel =
    kind === "original"
      ? null
      : afcDiagnosticInspectorArtifactSourceLabel(source);

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-slate-500">
        {AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.heading}
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-100">
        <span>
          {attemptOrdinal != null ? `Attempt #${attemptOrdinal}` : "Attempt"}
        </span>
        {reported ? (
          <span className="inline-flex rounded-md border border-emerald-500/70 bg-emerald-950/50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-100">
            {AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.reported}
          </span>
        ) : null}
        <span>{afcDiagnosticVisualArtifactLabel(kind)}</span>
        {statusLabel ? <span>{statusLabel}</span> : null}
        {kind !== "original" && sourceLabel && sourceLabel !== "—" ? (
          <span>{sourceLabel}</span>
        ) : null}
        {sha ? (
          <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="font-mono" title={sha}>
              {shortSha(sha)}
            </span>
            <AdminDiagnosticsCopyButton
              value={sha}
              ariaLabel="Copy SHA-256"
            />
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={kind === candidate}
            className={buttonClassName}
            onClick={() => {
              if (candidate === kind) return;
              setKind(candidate);
            }}
          >
            {afcDiagnosticVisualArtifactLabel(candidate)}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {(!isCommitted || phase === "loading") &&
        !(isCommitted && phase === "error") ? (
          <p className="text-sm text-slate-400" aria-live="polite">
            {AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.loading}
          </p>
        ) : null}
        {isCommitted && phase === "error" && error ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-700/60 bg-rose-950/20 p-3"
          >
            <p className="text-sm text-rose-200">{error}</p>
            <button
              type="button"
              className={`${buttonClassName} mt-3`}
              onClick={() => {
                setCommittedKey(null);
                setRetryNonce((value) => value + 1);
              }}
            >
              {AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.retry}
            </button>
          </div>
        ) : null}
        {isCommitted && phase === "ready" && imageUrl ? (
          <div className="flex justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={afcDiagnosticVisualImageAlt({
                kind,
                attemptOrdinal,
              })}
              className="max-h-[min(70vh,32rem)] w-auto max-w-full object-contain"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
