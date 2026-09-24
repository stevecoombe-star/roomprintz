"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  nextVisualEvidenceRequest,
  selectCommittedVisualImage,
  selectCommittedVisualOverlay,
  visualEvidenceRequestKey,
  type VisualImageCommit,
  type VisualOverlayCommit,
} from "@/lib/afc-v2-diagnostics/visual-evidence-request";

import { AdminDiagnosticsCopyButton } from "@/lib/afc-v2-diagnostics/admin-diagnostics-copy-button";
import { afcDiagnosticInspectorArtifactSourceLabel } from "@/lib/afc-v2-diagnostics/admin-case-inspector.client";
import type { AfcDiagnosticAdminMetricDecision } from "@/lib/afc-v2-diagnostics/admin-metric-decision-dto";
import {
  AFC_DIAGNOSTIC_METRIC_SPAN_COPY,
  afcDiagnosticMetricSpanDefaultSource,
  afcDiagnosticMetricSpanOptions,
  selectAfcDiagnosticMetricSpanOverlay,
  type AfcDiagnosticMetricSpanSourcePath,
} from "@/lib/afc-v2-diagnostics/admin-metric-span-overlay";
import {
  AfcDiagnosticEvidenceOverlaySvg,
  AfcDiagnosticMetricSpanContext,
} from "./AfcDiagnosticMetricSpanOverlay";
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
import {
  AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY,
  afcDiagnosticVisualOverlayBasisLabel,
  afcDiagnosticVisualOverlayCollisionAvailable,
  afcDiagnosticVisualOverlayErrorMessage,
  afcDiagnosticVisualOverlayFloorAvailable,
  afcDiagnosticVisualOverlayHasGeometry,
  buildAfcDiagnosticVisualOverlayUrl,
  createAfcDiagnosticVisualOverlayCoordinator,
  isAfcDiagnosticVisualOverlayAbortError,
  parseAfcAdminVisualOverlayV1,
  type AfcAdminVisualOverlayV1,
} from "@/lib/afc-v2-diagnostics/admin-visual-overlay.client";

const buttonClassName =
  "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

const visualEvidenceSourceButtonActiveClassName =
  "rounded-lg border border-emerald-400/80 px-3 py-1.5 text-xs text-emerald-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

export function visualEvidenceSourceButtonClassName(active: boolean): string {
  return active ? visualEvidenceSourceButtonActiveClassName : buttonClassName;
}

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
  metricDecision,
}: {
  caseId: string;
  generationId: string;
  attemptOrdinal: number | null;
  reported: boolean;
  empty: ArtifactSummary;
  tiled: ArtifactSummary;
  originalSha256: string | null;
  metricDecision: AfcDiagnosticAdminMetricDecision;
}) {
  const coordinatorRef = useRef(createAfcDiagnosticVisualEvidenceCoordinator());
  const overlayCoordinatorRef = useRef(
    createAfcDiagnosticVisualOverlayCoordinator(),
  );
  const objectUrlRef = useRef<string | null>(null);
  const readArtifactMetadata = useEffectEvent(() => ({
    empty,
    tiled,
    originalSha256,
  }));
  const [kind, setKind] = useState<AfcDiagnosticVisualArtifactKind>(() =>
    defaultAfcDiagnosticVisualArtifactKind({
      emptyPresent: empty.present,
      tiledPresent: tiled.present,
    }),
  );
  const [retryNonce, setRetryNonce] = useState(0);
  const [overlayRetryNonce, setOverlayRetryNonce] = useState(0);
  const [imageCommit, setImageCommit] = useState<VisualImageCommit | null>(null);
  const [overlayCommit, setOverlayCommit] =
    useState<VisualOverlayCommit<AfcAdminVisualOverlayV1> | null>(null);
  const [showFloor, setShowFloor] = useState(true);
  const [showCollision, setShowCollision] = useState(true);
  const [showMetricSpan, setShowMetricSpan] = useState(true);
  const [metricSourcePath, setMetricSourcePath] =
    useState<AfcDiagnosticMetricSpanSourcePath | null>(null);
  const identityKey = afcDiagnosticVisualEvidenceTupleKey({
    caseId,
    generationId,
    kind,
  });
  const [imageRequest, setImageRequest] = useState(() => ({
    key: visualEvidenceRequestKey(identityKey, 0),
    epoch: 1,
  }));
  const [overlayRequest, setOverlayRequest] = useState(() => ({
    key: visualEvidenceRequestKey(identityKey, 0),
    epoch: 1,
  }));
  const nextImageRequest = nextVisualEvidenceRequest(
    imageRequest,
    visualEvidenceRequestKey(identityKey, retryNonce),
  );
  if (nextImageRequest !== imageRequest) setImageRequest(nextImageRequest);
  const nextOverlayRequest = nextVisualEvidenceRequest(
    overlayRequest,
    visualEvidenceRequestKey(identityKey, overlayRetryNonce),
  );
  if (nextOverlayRequest !== overlayRequest) setOverlayRequest(nextOverlayRequest);
  const imageView = selectCommittedVisualImage({
    tupleKey: identityKey,
    request: nextImageRequest,
    commit: imageCommit,
  });
  const isCommitted = imageView.isCommitted;
  const phase = imageView.phase;
  const imageUrl = imageView.imageUrl;
  const error = imageView.error;
  const errorStatus = imageView.errorStatus;
  const overlayView = selectCommittedVisualOverlay({
    tupleKey: identityKey,
    request: nextOverlayRequest,
    commit: overlayCommit,
  });
  const overlayCommittedKey = overlayCommit?.key ?? null;
  const overlayIsCommitted =
    overlayView.isCommitted && overlayCommittedKey === identityKey;
  const overlayPhase = overlayView.phase;
  const overlayError = overlayView.error;
  const overlay = overlayView.overlay;
  const committedOverlay = overlayIsCommitted ? overlay : null;
  const readImageRequestEpoch = useEffectEvent(() => nextImageRequest.epoch);
  const readOverlayRequestEpoch = useEffectEvent(() => nextOverlayRequest.epoch);
  const floorAvailable = afcDiagnosticVisualOverlayFloorAvailable(
    committedOverlay,
  );
  const collisionAvailable = afcDiagnosticVisualOverlayCollisionAvailable(
    committedOverlay,
  );
  const metricOptions = afcDiagnosticMetricSpanOptions(metricDecision);
  const defaultMetricSource = afcDiagnosticMetricSpanDefaultSource(metricOptions);
  const activeMetricSource = metricSourcePath &&
      metricOptions.some((span) => span.sourcePath === metricSourcePath)
    ? metricSourcePath
    : defaultMetricSource;
  const metricSpan = selectAfcDiagnosticMetricSpanOverlay({
    metricDecision,
    artifactKind: kind,
    sourcePath: activeMetricSource,
  });
  const metricAvailable = metricSpan != null;

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    const requestEpoch = readImageRequestEpoch();
    const started = coordinator.begin({
      caseId,
      generationId,
      kind,
    });
    if (objectUrlRef.current) {
      revokeAfcDiagnosticVisualObjectUrl(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    function commitImage(
      next: Omit<VisualImageCommit, "epoch" | "key">,
    ) {
      setImageCommit({
        epoch: requestEpoch,
        key: afcDiagnosticVisualEvidenceTupleKey(started.tuple),
        phase: next.phase,
        imageUrl: next.imageUrl,
        error: next.error,
        errorStatus: next.errorStatus,
      });
    }

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
          const metadata = readArtifactMetadata();
          const present = metadataPresent(
            started.tuple.kind,
            metadata.empty,
            metadata.tiled,
            metadata.originalSha256,
          );
          commitImage({
            phase: "error",
            imageUrl: null,
            error: afcDiagnosticVisualEvidenceErrorMessage({
              status: response.status,
              kind: started.tuple.kind,
              metadataPresent: present,
            }),
            errorStatus: response.status,
          });
          return;
        }
        const blob = await response.blob();
        if (!coordinatorRef.current.isCurrent(started.seq, started.tuple)) {
          return;
        }
        if (blob.size === 0) {
          commitImage({
            phase: "error",
            imageUrl: null,
            error: AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.generic,
            errorStatus: "blob",
          });
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
        commitImage({
          phase: "ready",
          imageUrl: objectUrl,
          error: null,
          errorStatus: null,
        });
      } catch (cause) {
        if (isAfcDiagnosticVisualAbortError(cause)) return;
        if (!coordinatorRef.current.isCurrent(started.seq, started.tuple)) {
          return;
        }
        commitImage({
          phase: "error",
          imageUrl: null,
          error: AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.generic,
          errorStatus: "network",
        });
      }
    })();

    return () => {
      coordinator.abort();
      if (objectUrlRef.current) {
        revokeAfcDiagnosticVisualObjectUrl(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [caseId, generationId, kind, retryNonce]);

  useEffect(() => {
    const overlayCoordinator = overlayCoordinatorRef.current;
    const requestEpoch = readOverlayRequestEpoch();
    const started = overlayCoordinator.begin({
      caseId,
      generationId,
      kind,
    });

    function commitOverlay(
      next: Omit<VisualOverlayCommit<AfcAdminVisualOverlayV1>, "epoch" | "key">,
    ) {
      setOverlayCommit({
        epoch: requestEpoch,
        key: afcDiagnosticVisualEvidenceTupleKey(started.tuple),
        phase: next.phase,
        overlay: next.overlay,
        error: next.error,
      });
    }

    void (async () => {
      try {
        const response = await fetch(
          buildAfcDiagnosticVisualOverlayUrl(started.tuple),
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: started.signal,
          },
        );
        if (
          !overlayCoordinatorRef.current.isCurrent(started.seq, started.tuple)
        ) {
          return;
        }
        if (!response.ok) {
          commitOverlay({
            phase: "error",
            overlay: null,
            error: afcDiagnosticVisualOverlayErrorMessage(response.status),
          });
          return;
        }
        const payload: unknown = await response.json();
        if (
          !overlayCoordinatorRef.current.isCurrent(started.seq, started.tuple)
        ) {
          return;
        }
        const parsed = parseAfcAdminVisualOverlayV1(payload);
        if (
          !parsed ||
          parsed.artifactBasis !== started.tuple.kind
        ) {
          commitOverlay({
            phase: "error",
            overlay: null,
            error: AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.error,
          });
          return;
        }
        commitOverlay({
          phase: "ready",
          overlay: parsed,
          error: null,
        });
      } catch (cause) {
        if (isAfcDiagnosticVisualOverlayAbortError(cause)) return;
        if (
          !overlayCoordinatorRef.current.isCurrent(started.seq, started.tuple)
        ) {
          return;
        }
        commitOverlay({
          phase: "error",
          overlay: null,
          error: afcDiagnosticVisualOverlayErrorMessage("network"),
        });
      }
    })();

    return () => {
      overlayCoordinator.abort();
    };
  }, [caseId, generationId, kind, overlayRetryNonce]);

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
  const showImage = isCommitted && phase === "ready" && imageUrl;
  const overlayFrame = committedOverlay?.frame ?? null;
  const showFloorOverlay = showFloor && floorAvailable;
  const showCollisionOverlay = showCollision && collisionAvailable;
  const showMetricOverlay = showMetricSpan && metricAvailable;
  const showSvg =
    showImage &&
    overlayIsCommitted &&
    overlayPhase === "ready" &&
    committedOverlay != null &&
    (showFloorOverlay || showCollisionOverlay || showMetricOverlay);

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
            className={visualEvidenceSourceButtonClassName(kind === candidate)}
            onClick={() => {
              if (candidate === kind) return;
              setKind(candidate);
            }}
          >
            {afcDiagnosticVisualArtifactLabel(candidate)}
          </button>
        ))}
      </div>

      <fieldset className="mt-3 min-w-0">
        <legend className="text-xs uppercase tracking-wide text-slate-500">
          Overlays
        </legend>
        <div className="mt-2 flex flex-col gap-2 text-sm text-slate-200">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
              checked={showFloor}
              disabled={!floorAvailable}
              aria-describedby="afc-overlay-floor-help"
              onChange={(event) => {
                setShowFloor(event.target.checked);
              }}
            />
            <span>
              <span>{AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.floor}</span>
              <span
                id="afc-overlay-floor-help"
                className="mt-0.5 block text-xs text-slate-400"
              >
                {AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.floorHelp}
              </span>
              {overlayIsCommitted && overlayPhase === "ready" && !floorAvailable ? (
                <span className="mt-0.5 block text-xs text-slate-500">
                  {AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.floorUnavailable}
                </span>
              ) : null}
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
              checked={showCollision}
              disabled={!collisionAvailable}
              aria-describedby="afc-overlay-collision-help"
              onChange={(event) => {
                setShowCollision(event.target.checked);
              }}
            />
            <span>
              <span>{AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.collision}</span>
              <span
                id="afc-overlay-collision-help"
                className="mt-0.5 block text-xs text-slate-400"
              >
                {AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.collisionHelp}
              </span>
              {overlayIsCommitted &&
              overlayPhase === "ready" &&
              !collisionAvailable ? (
                <span className="mt-0.5 block text-xs text-slate-500">
                  {AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.collisionUnavailable}
                </span>
              ) : null}
            </span>
          </label>
          <div>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
                checked={showMetricSpan}
                disabled={!metricAvailable}
                aria-describedby="afc-overlay-metric-span-help"
                onChange={(event) => {
                  setShowMetricSpan(event.target.checked);
                }}
              />
              <span>
                <span>{AFC_DIAGNOSTIC_METRIC_SPAN_COPY.label}</span>
                <span
                  id="afc-overlay-metric-span-help"
                  className="mt-0.5 block text-xs text-slate-400"
                >
                  {AFC_DIAGNOSTIC_METRIC_SPAN_COPY.help}
                </span>
                {!metricAvailable ? (
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {AFC_DIAGNOSTIC_METRIC_SPAN_COPY.unavailable}
                  </span>
                ) : null}
                {showMetricOverlay && metricSpan ? (
                  <AfcDiagnosticMetricSpanContext span={metricSpan} />
                ) : null}
              </span>
            </label>
            {metricOptions.length > 1 ? (
              <span className="mt-1 flex flex-wrap gap-1 pl-6">
                {metricOptions.map((option) => (
                  <button
                    key={option.sourcePath}
                    type="button"
                    aria-pressed={activeMetricSource === option.sourcePath}
                    className={buttonClassName}
                    onClick={() => {
                      setMetricSourcePath(option.sourcePath);
                    }}
                  >
                    {option.sourcePath === "path_a"
                      ? AFC_DIAGNOSTIC_METRIC_SPAN_COPY.pathA
                      : AFC_DIAGNOSTIC_METRIC_SPAN_COPY.pathB}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        </div>
      </fieldset>

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
                setRetryNonce((value) => value + 1);
              }}
            >
              {AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.retry}
            </button>
          </div>
        ) : null}
        {showImage ? (
          <div className="flex justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-2">
            {overlayFrame ? (
              <div
                className="relative w-full"
                style={{
                  aspectRatio: `${overlayFrame.width} / ${overlayFrame.height}`,
                  maxWidth: `min(100%, calc(min(70vh, 32rem) * ${overlayFrame.width} / ${overlayFrame.height}))`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt={afcDiagnosticVisualImageAlt({
                    kind,
                    attemptOrdinal,
                  })}
                  className="absolute inset-0 h-full w-full object-contain"
                />
                {showSvg && committedOverlay ? (
                  <AfcDiagnosticEvidenceOverlaySvg
                    showFloor={showFloorOverlay}
                    floorPoints={committedOverlay.floorQuad?.points ?? null}
                    showCollision={showCollisionOverlay}
                    collisionEdges={committedOverlay.collisionEdges}
                    metricSpan={showMetricOverlay ? metricSpan : null}
                  />
                ) : null}
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={afcDiagnosticVisualImageAlt({
                  kind,
                  attemptOrdinal,
                })}
                className="max-h-[min(70vh,32rem)] w-auto max-w-full object-contain"
              />
            )}
          </div>
        ) : null}
        {showImage &&
        !(overlayIsCommitted && overlayPhase === "ready") &&
        !(overlayIsCommitted && overlayPhase === "error") ? (
          <p className="mt-2 text-sm text-slate-400" aria-live="polite">
            {AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.loading}
          </p>
        ) : null}
        {showImage && overlayIsCommitted && overlayPhase === "error" && overlayError ? (
          <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3" role="status">
            <p className="text-sm text-slate-200">{overlayError}</p>
            <button
              type="button"
              className={`${buttonClassName} mt-3`}
              onClick={() => {
                setOverlayRetryNonce((value) => value + 1);
              }}
            >
              {AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.retry}
            </button>
          </div>
        ) : null}
        {showImage && overlayIsCommitted && overlayPhase === "ready" ? (
          <div className="mt-2 text-xs text-slate-400">
            <p>{afcDiagnosticVisualOverlayBasisLabel(committedOverlay)}</p>
            {afcDiagnosticVisualOverlayHasGeometry(committedOverlay) ? (
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                <li>
                  <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-300 align-middle" />
                  {AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.floor}
                </li>
                <li>
                  <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-300 align-middle" />
                  {AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.collision}
                </li>
                {metricAvailable ? (
                  <li>
                    <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-cyan-300 align-middle" />
                    {AFC_DIAGNOSTIC_METRIC_SPAN_COPY.label}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
