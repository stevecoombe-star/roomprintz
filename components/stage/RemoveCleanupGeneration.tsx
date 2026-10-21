"use client";

import { useEffect, useRef, useState } from "react";

import { removeAlignmentArtifactPath } from "@/lib/vibode-stage/remove-alignment";
import { REMOVE_CLEANUP_EXCLUSION_COPY } from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  buildRemoveCleanupExportBody,
  hiddenRemoveCleanupObjects,
  snapshotRemoveCleanupObjects,
  type RemoveCleanupSnapshotObject,
} from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  cleanupGenerationErrorCopy,
  cleanupGenerationPhaseFromStatus,
  cleanupGenerationStatusLabel,
  describeCleanupGenerationSelection,
  removeCleanupGenerationAvailability,
  type CleanupGenerationPhase,
  type CleanupReviewMode,
} from "@/lib/vibode-stage/remove-cleanup-generation-ui";
import type { CleanupStatusView } from "@/lib/vibode-stage/remove-cleanup-jobs/types";
import type { RemoveObjectUiState } from "@/lib/vibode-stage/remove-object-ui";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const BUTTON = `rounded-md border px-2 py-1 text-[11px] ${FOCUS}`;

export function RemoveCleanupGeneration({ objectUi }: { objectUi: RemoveObjectUiState }) {
  const identity = objectUi.phase === "ready" ? objectUi.identity : null;
  const hidden = objectUi.phase === "ready"
    ? hiddenRemoveCleanupObjects(objectUi.objects, objectUi.selectedIds)
    : [];
  const [confirming, setConfirming] = useState(false);
  const [snapshot, setSnapshot] = useState<RemoveCleanupSnapshotObject[]>([]);
  const [phase, setPhase] = useState<CleanupGenerationPhase>("idle");
  const [job, setJob] = useState<CleanupStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<CleanupReviewMode>("compare");
  const [candidateUrl, setCandidateUrl] = useState<string | null>(null);
  const candidateObjectUrl = useRef<string | null>(null);
  const available = removeCleanupGenerationAvailability({
    segmentationPhase: objectUi.phase,
    hiddenCount: hidden.length,
    busy: phase === "preparing" || phase === "queued" || phase === "generating",
  });
  const frozen = describeCleanupGenerationSelection(snapshot);
  const roomId = identity?.roomId ?? null;
  const generationId = identity?.generationId ?? null;
  const jobId = job?.jobId ?? null;
  const jobStatus = job?.status ?? null;

  useEffect(() => () => {
    if (candidateObjectUrl.current) URL.revokeObjectURL(candidateObjectUrl.current);
  }, []);

  useEffect(() => {
    if (!roomId) return undefined;
    const controller = new AbortController();
    void loadRoomJob(roomId, controller.signal).then((next) => {
      void publishCleanupJob(next, controller.signal, { setJob, setPhase, setCandidateUrl, candidateObjectUrl });
    });
    return () => controller.abort();
  }, [roomId, generationId, setJob, setPhase, setCandidateUrl, candidateObjectUrl]);

  useEffect(() => {
    if (!jobId || (jobStatus !== "queued" && jobStatus !== "running")) return undefined;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void loadJob(jobId, controller.signal).then((next) => {
        void publishCleanupJob(next, controller.signal, { setJob, setPhase, setCandidateUrl, candidateObjectUrl });
      });
    }, 2000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [jobId, jobStatus, setJob, setPhase, setCandidateUrl, candidateObjectUrl]);

  async function confirm() {
    if (!identity || snapshot.length === 0 || phase === "preparing") return;
    setPhase("preparing");
    setError(null);
    const body = await buildRemoveCleanupExportBody({
      roomId: identity.roomId,
      generationId: identity.generationId,
      originalSha256: identity.originalSha256,
      originalDecodedWidth: identity.originalWidth,
      originalDecodedHeight: identity.originalHeight,
      objects: snapshot,
    });
    const response = await fetch("/api/vibode/admin/remove-cleanup-jobs", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body,
    });
    const payload = await response.json().catch(() => null) as { job?: CleanupStatusView; error?: string } | null;
    if (!response.ok || !payload?.job) {
      setPhase("failed");
      setError(typeof payload?.error === "string" ? payload.error : "Clean Up could not be started.");
      return;
    }
    setConfirming(false);
    setError(cleanupGenerationErrorCopy(payload.job.errorCategory));
    await publishCleanupJob(payload.job, new AbortController().signal, {
      setJob,
      setPhase,
      setCandidateUrl,
      candidateObjectUrl,
    });
  }

  async function discard() {
    if (!job) return;
    const response = await fetch(`/api/vibode/admin/remove-cleanup-jobs/${job.jobId}/discard`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as { job?: CleanupStatusView } | null;
    if (!response.ok || !payload?.job) return;
    clearCandidateUrl(setCandidateUrl, candidateObjectUrl);
    setJob(payload.job);
    setPhase("discarded");
  }

  return (
    <div className="mt-3" data-remove-cleanup-generation="panel">
      {phase === "idle" || phase === "failed" || phase === "discarded" ? (
        confirming ? (
          <div data-remove-cleanup-generation="confirm">
            <p className="text-[11px] leading-relaxed text-neutral-300">
              {`Clean up ${frozen.count} hidden ${frozen.count === 1 ? "object" : "objects"}: ${frozen.concepts.join(", ")}.`}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{REMOVE_CLEANUP_EXCLUSION_COPY}</p>
            <div className="mt-2 flex gap-1">
              <button type="button" className={`${BUTTON} border-neutral-700 text-neutral-300`} onClick={() => void confirm()}>
                Generate
              </button>
              <button
                type="button"
                className={`${BUTTON} border-neutral-700 text-neutral-300`}
                onClick={() => {
                  setConfirming(false);
                  setSnapshot([]);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-remove-cleanup-generation="start"
            disabled={!available}
            onClick={() => {
              setSnapshot(snapshotRemoveCleanupObjects(hidden));
              setConfirming(true);
              setError(null);
            }}
            className={`${BUTTON} ${available ? "border-neutral-700 text-neutral-300" : "border-neutral-900 bg-neutral-950 text-neutral-600"}`}
          >
            Clean Up Room
          </button>
        )
      ) : null}
      {phase !== "idle" && phase !== "confirming" ? (
        <p className="mt-2 text-[11px] text-neutral-300" role="status" data-remove-cleanup-generation="status">
          {cleanupGenerationStatusLabel(phase)}
          {job?.stale ? " This result is from an earlier room photo." : ""}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[11px] leading-relaxed text-red-300" role="alert" data-remove-cleanup-generation="error">
          {error}
        </p>
      ) : null}
      {job && phase === "completed" && identity ? (
        <div className="mt-2" data-remove-cleanup-generation="review">
          <div className="flex gap-1">
            {(["original", "candidate", "compare"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={review === mode}
                onClick={() => setReview(mode)}
                className={`${BUTTON} ${review === mode ? "border-neutral-500 bg-neutral-800 text-neutral-50" : "border-neutral-700 text-neutral-300"}`}
              >
                {mode === "original" ? "Original" : mode === "candidate" ? "Candidate" : "Compare"}
              </button>
            ))}
            <button type="button" data-remove-cleanup-generation="discard" onClick={() => void discard()} className={`${BUTTON} border-neutral-700 text-neutral-300`}>
              Discard
            </button>
          </div>
          <div className={`mt-2 grid gap-2 ${review === "compare" ? "grid-cols-2" : "grid-cols-1"}`}>
            {review !== "candidate" ? (
              // eslint-disable-next-line @next/next/no-img-element -- admin original bytes are served by the remove route
              <img
                alt="Original room"
                src={removeAlignmentArtifactPath(identity.roomId, "original", identity.generationId)}
                className="max-h-40 w-full rounded-md object-contain"
              />
            ) : null}
            {review !== "original" && candidateUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- private candidate bytes are served by the job route
              <img alt="Clean Up candidate" src={candidateUrl} className="max-h-40 w-full rounded-md object-contain" />
            ) : null}
          </div>
        </div>
      ) : null}
      {job && (phase === "queued" || phase === "generating") ? (
        <button type="button" className={`${BUTTON} mt-2 border-neutral-700 text-neutral-300`} onClick={() => void discard()}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}

async function publishCleanupJob(
  next: CleanupStatusView | null,
  signal: AbortSignal,
  target: {
    setJob: (job: CleanupStatusView | null) => void;
    setPhase: (phase: CleanupGenerationPhase) => void;
    setCandidateUrl: (url: string | null) => void;
    candidateObjectUrl: { current: string | null };
  },
): Promise<void> {
  if (signal.aborted || !next) return;
  target.setJob(next);
  target.setPhase(cleanupGenerationPhaseFromStatus(next.status));
  if (!next.candidateAvailable) {
    clearCandidateUrl(target.setCandidateUrl, target.candidateObjectUrl);
    return;
  }
  const url = await loadCandidate(next.jobId, signal);
  if (signal.aborted) {
    if (url) URL.revokeObjectURL(url);
    return;
  }
  if (target.candidateObjectUrl.current && target.candidateObjectUrl.current !== url) {
    URL.revokeObjectURL(target.candidateObjectUrl.current);
  }
  target.candidateObjectUrl.current = url;
  target.setCandidateUrl(url);
}

function clearCandidateUrl(
  setCandidateUrl: (url: string | null) => void,
  candidateObjectUrl: { current: string | null },
): void {
  if (candidateObjectUrl.current) URL.revokeObjectURL(candidateObjectUrl.current);
  candidateObjectUrl.current = null;
  setCandidateUrl(null);
}

async function loadRoomJob(roomId: string, signal: AbortSignal): Promise<CleanupStatusView | null> {
  const response = await fetch(`/api/vibode/admin/remove-cleanup-jobs?roomId=${encodeURIComponent(roomId)}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as { job?: CleanupStatusView | null } | null;
  return payload?.job ?? null;
}

async function loadJob(jobId: string, signal: AbortSignal): Promise<CleanupStatusView | null> {
  const response = await fetch(`/api/vibode/admin/remove-cleanup-jobs/${jobId}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as { job?: CleanupStatusView } | null;
  return payload?.job ?? null;
}

async function loadCandidate(jobId: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(`/api/vibode/admin/remove-cleanup-jobs/${jobId}/candidate`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return null;
  return URL.createObjectURL(await response.blob());
}
