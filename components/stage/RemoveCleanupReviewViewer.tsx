"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { CleanupReviewMode } from "@/lib/vibode-stage/remove-cleanup-generation-ui";
import {
  cleanupReviewSources,
  type CleanupCandidatePhase,
} from "@/lib/vibode-stage/remove-cleanup-review";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const BUTTON = `rounded-md border px-2.5 py-1 text-xs ${FOCUS}`;

export function RemoveCleanupReviewViewer({
  open,
  mode,
  originalSrc,
  candidateUrl,
  candidatePhase,
  candidateError,
  onMode,
  onReload,
  onClose,
}: {
  open: boolean;
  mode: CleanupReviewMode;
  originalSrc: string;
  candidateUrl: string | null;
  candidatePhase: CleanupCandidatePhase;
  candidateError: string | null;
  onMode: (mode: CleanupReviewMode) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  const frames = cleanupReviewSources(mode);

  return createPortal(
    <div
      role="dialog"
      aria-label="Clean Up review"
      data-remove-cleanup-review="viewer"
      className="fixed left-4 top-16 z-[80] flex h-[min(760px,calc(100vh-8rem))] w-[min(980px,calc(100vw-22rem))] max-w-6xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-xl"
    >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="flex gap-1" role="group" aria-label="Clean Up review mode">
            {(["original", "candidate", "compare"] as const).map((next) => (
              <button
                key={next}
                type="button"
                aria-pressed={mode === next}
                onClick={() => onMode(next)}
                className={`${BUTTON} ${mode === next ? "border-neutral-500 bg-neutral-800 text-neutral-50" : "border-neutral-700 text-neutral-300"}`}
              >
                {next === "original" ? "Original" : next === "candidate" ? "Candidate" : "Compare"}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-remove-cleanup-review="close"
            onClick={onClose}
            className={`${BUTTON} border-neutral-700 text-neutral-300`}
          >
            Close
          </button>
        </div>
        <div className={`grid h-full min-h-0 flex-1 grid-rows-1 gap-3 overflow-auto p-4 ${frames.length > 1 ? "md:grid-cols-2" : "grid-cols-1"}`}>
          {frames.map((frame) => {
            const src = frame === "original" ? originalSrc : candidateUrl;
            return (
              <ReviewFrame
                key={`${frame}:${src ?? ""}`}
                label={frame === "original" ? "Original" : "Candidate"}
                src={src}
                phase={frame === "candidate" ? candidatePhase : "ready"}
                error={frame === "candidate" ? candidateError : null}
                onReload={onReload}
              />
            );
          })}
        </div>
        <p className="border-t border-neutral-800 px-4 py-2 text-[11px] text-neutral-400">
          This review leaves the room view unchanged.
        </p>
    </div>,
    document.body,
  );
}

function ReviewFrame({
  label,
  src,
  phase,
  error,
  onReload,
}: {
  label: string;
  src: string | null;
  phase: CleanupCandidatePhase;
  error: string | null;
  onReload: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const candidate = label !== "Original";
  const showImage = Boolean(src) && phase === "ready" && !imageFailed;
  return (
    <figure className="flex h-full min-h-0 min-w-0 flex-col" data-remove-cleanup-review={candidate ? "frame-candidate" : "frame-original"}>
      <figcaption className="mb-2 text-xs font-medium text-neutral-200">{label}</figcaption>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-neutral-900">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin review bytes stay on their existing authenticated routes
          <img
            alt={candidate ? "Clean Up candidate" : "Original room"}
            src={src ?? undefined}
            onError={() => setImageFailed(true)}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="px-4 text-center text-xs leading-relaxed text-neutral-400">
            {phase === "error" || imageFailed ? (
              <>
                <p>{error ?? (candidate ? "Clean Up candidate could not be loaded." : "Original room could not be loaded.")}</p>
                {candidate ? (
                  <button type="button" onClick={onReload} className={`${BUTTON} mt-3 border-neutral-700 text-neutral-300`}>
                    Load again
                  </button>
                ) : null}
              </>
            ) : (
              <p>{candidate ? "Loading candidate…" : "Loading original…"}</p>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}
