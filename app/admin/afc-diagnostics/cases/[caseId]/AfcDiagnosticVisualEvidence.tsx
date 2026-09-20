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

function polygonPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
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
  const overlayCoordinatorRef = useRef(
    createAfcDiagnosticVisualOverlayCoordinator(),
  );
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
  const [overlayPhase, setOverlayPhase] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<AfcAdminVisualOverlayV1 | null>(null);
  const [overlayRetryNonce, setOverlayRetryNonce] = useState(0);
  const [overlayCommittedKey, setOverlayCommittedKey] = useState<string | null>(
    null,
  );
  const [showFloor, setShowFloor] = useState(true);
  const [showCollision, setShowCollision] = useState(true);
  const identityKey = afcDiagnosticVisualEvidenceTupleKey({
    caseId,
    generationId,
    kind,
  });
  const isCommitted = committedKey === identityKey;
  const overlayIsCommitted = overlayCommittedKey === identityKey;
  const committedOverlay = overlayIsCommitted ? overlay : null;
  const floorAvailable = afcDiagnosticVisualOverlayFloorAvailable(
    committedOverlay,
  );
  const collisionAvailable = afcDiagnosticVisualOverlayCollisionAvailable(
    committedOverlay,
  );

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

  useEffect(() => {
    const started = overlayCoordinatorRef.current.begin({
      caseId,
      generationId,
      kind,
    });
    setOverlayPhase("loading");
    setOverlayError(null);
    setOverlay(null);

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
          setOverlayError(
            afcDiagnosticVisualOverlayErrorMessage(response.status),
          );
          setOverlay(null);
          setOverlayCommittedKey(
            afcDiagnosticVisualEvidenceTupleKey(started.tuple),
          );
          setOverlayPhase("error");
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
          setOverlayError(AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY.error);
          setOverlay(null);
          setOverlayCommittedKey(
            afcDiagnosticVisualEvidenceTupleKey(started.tuple),
          );
          setOverlayPhase("error");
          return;
        }
        setOverlay(parsed);
        setOverlayCommittedKey(
          afcDiagnosticVisualEvidenceTupleKey(started.tuple),
        );
        setOverlayPhase("ready");
      } catch (cause) {
        if (isAfcDiagnosticVisualOverlayAbortError(cause)) return;
        if (
          !overlayCoordinatorRef.current.isCurrent(started.seq, started.tuple)
        ) {
          return;
        }
        setOverlayError(afcDiagnosticVisualOverlayErrorMessage("network"));
        setOverlay(null);
        setOverlayCommittedKey(
          afcDiagnosticVisualEvidenceTupleKey(started.tuple),
        );
        setOverlayPhase("error");
      }
    })();

    return () => {
      overlayCoordinatorRef.current.abort();
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
  const showSvg =
    showImage &&
    overlayIsCommitted &&
    overlayPhase === "ready" &&
    committedOverlay != null &&
    (showFloorOverlay || showCollisionOverlay);

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
                setCommittedKey(null);
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
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute inset-0 h-full w-full"
                  >
                    {showFloorOverlay && committedOverlay.floorQuad ? (
                      <polygon
                        points={polygonPoints(committedOverlay.floorQuad.points)}
                        fill="rgba(125, 211, 252, 0.12)"
                        stroke="#7dd3fc"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    {showCollisionOverlay
                      ? committedOverlay.collisionEdges.map((edge) => (
                          <polyline
                            key={edge.id}
                            points={polygonPoints(edge.points)}
                            fill="none"
                            stroke="#fcd34d"
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                          />
                        ))
                      : null}
                  </svg>
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
                setOverlayCommittedKey(null);
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
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
