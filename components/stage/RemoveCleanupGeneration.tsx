"use client";

import { useEffect, useRef, useState } from "react";

import { RemoveCleanupReviewViewer } from "@/components/stage/RemoveCleanupReviewViewer";
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
  REMOVE_CLEANUP_RETRY_NOTE,
  removeCleanupGenerationAvailability,
  removeCleanupRetryAvailable,
  type CleanupGenerationPhase,
  type CleanupReviewMode,
} from "@/lib/vibode-stage/remove-cleanup-generation-ui";
import {
  createCleanupObjectUrlStore,
  isAbortError,
  loadCleanupCandidateBlob,
  pollCleanupJob,
  REMOVE_CLEANUP_CANDIDATE_LOAD_ERROR,
  REMOVE_CLEANUP_STATUS_READ_ERROR,
  type CleanupCandidatePhase,
} from "@/lib/vibode-stage/remove-cleanup-review";
import type { CleanupStatusView } from "@/lib/vibode-stage/remove-cleanup-jobs/types";
import type { RemoveObjectUiState } from "@/lib/vibode-stage/remove-object-ui";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const BUTTON = `rounded-md border px-2 py-1 text-[11px] ${FOCUS}`;

const POLL_INTERVAL_MS = 2000;

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
  const [retrying, setRetrying] = useState(false);
  const retryLock = useRef(false);
  const [review, setReview] = useState<CleanupReviewMode>("compare");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [loadedCandidate, setLoadedCandidate] = useState<{ jobId: string; attempt: number; url: string } | null>(null);
  const [candidatePhase, setCandidatePhase] = useState<CleanupCandidatePhase>("idle");
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidateAttempt, setCandidateAttempt] = useState(0);
  const urlStore = useRef(createCleanupObjectUrlStore((url) => URL.revokeObjectURL(url))).current;
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
  const reviewJobId = job?.status === "succeeded" && job.candidateAvailable ? job.jobId : null;
  const visibleCandidateUrl = loadedCandidate
    && loadedCandidate.jobId === reviewJobId
    && loadedCandidate.attempt === candidateAttempt
    ? loadedCandidate.url
    : null;

  useEffect(() => {
    if (!roomId) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    void loadRoomJob(roomId, controller.signal).then((next) => {
      if (cancelled || controller.signal.aborted || !next) return;
      publishCleanupJob(next, setJob, setPhase);
    }).catch((loadError) => {
      if (cancelled || isAbortError(loadError)) return;
      setError(REMOVE_CLEANUP_STATUS_READ_ERROR);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roomId, generationId]);

  useEffect(() => {
    if (!jobId || (jobStatus !== "queued" && jobStatus !== "running")) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    void pollCleanupJob({
      jobId,
      signal: controller.signal,
      intervalMs: POLL_INTERVAL_MS,
      load: async (id, signal) => {
        try {
          return await loadJob(id, signal);
        } catch (loadError) {
          if (isAbortError(loadError) || signal.aborted) throw loadError;
          if (!cancelled) setError(REMOVE_CLEANUP_STATUS_READ_ERROR);
          return null;
        }
      },
      publish: (next) => {
        if (cancelled || controller.signal.aborted || next.jobId !== jobId) return;
        publishCleanupJob(next, setJob, setPhase);
        setError(cleanupGenerationErrorCopy(next.errorCategory));
      },
    }).catch((loadError) => {
      if (cancelled || isAbortError(loadError)) return;
      setError(REMOVE_CLEANUP_STATUS_READ_ERROR);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [jobId, jobStatus]);

  useEffect(() => {
    if (!reviewJobId) {
      urlStore.release();
      setCandidatePhase("idle");
      setCandidateError(null);
      return undefined;
    }
    const owner = reviewJobId;
    const attempt = candidateAttempt;
    const controller = new AbortController();
    let cancelled = false;
    setCandidatePhase("loading");
    setCandidateError(null);
    void loadCleanupCandidateBlob({
      jobId: owner,
      signal: controller.signal,
      fetchCandidate: fetchCandidateBlob,
      createObjectUrl: (blob) => URL.createObjectURL(blob),
      revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    }).then((result) => {
      if (cancelled || controller.signal.aborted) {
        if (result.ok) URL.revokeObjectURL(result.url);
        return;
      }
      if (!result.ok) {
        urlStore.release();
        setLoadedCandidate(null);
        setCandidatePhase("error");
        setCandidateError(REMOVE_CLEANUP_CANDIDATE_LOAD_ERROR);
        return;
      }
      urlStore.replace(result.url);
      setLoadedCandidate({ jobId: owner, attempt, url: result.url });
      setCandidatePhase("ready");
    });
    return () => {
      cancelled = true;
      controller.abort();
      urlStore.release();
    };
  }, [reviewJobId, candidateAttempt, urlStore]);

  function publishSeen(next: CleanupStatusView) {
    publishCleanupJob(next, setJob, setPhase);
  }

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
    publishSeen(payload.job);
  }

  async function retryFailed() {
    if (!job || job.status !== "failed" || retryLock.current) return;
    retryLock.current = true;
    setRetrying(true);
    setError(null);
    try {
      const response = await fetch(`/api/vibode/admin/remove-cleanup-jobs/${job.jobId}/retry`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as { job?: CleanupStatusView; error?: string } | null;
      if (!response.ok || !payload?.job) {
        setError(typeof payload?.error === "string" ? payload.error : "Clean Up could not be retried.");
        return;
      }
      setError(null);
      publishCleanupJob(payload.job, setJob, setPhase);
    } finally {
      retryLock.current = false;
      setRetrying(false);
    }
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
    setViewerOpen(false);
    setJob(payload.job);
    setPhase("discarded");
  }

  function openReview(next: CleanupReviewMode) {
    setReview(next);
    setViewerOpen(true);
  }

  const originalSrc = job
    ? removeAlignmentArtifactPath(job.roomId, "original", job.generationId)
    : "";

  return (
    <div className="mt-3" data-remove-cleanup-generation="panel">
      {phase === "failed" && job && removeCleanupRetryAvailable({ status: job.status, busy: false }) ? (
        <div className="mt-2" data-remove-cleanup-generation="retry-panel">
          <button
            type="button"
            data-remove-cleanup-generation="retry"
            disabled={retrying}
            onClick={() => void retryFailed()}
            className={`${BUTTON} ${retrying ? "border-neutral-900 bg-neutral-950 text-neutral-600" : "border-neutral-700 text-neutral-300"}`}
          >
            Retry Clean Up
          </button>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{REMOVE_CLEANUP_RETRY_NOTE}</p>
        </div>
      ) : phase === "idle" || phase === "failed" || phase === "discarded" ? (
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
      {job && phase === "completed" ? (
        <div className="mt-2" data-remove-cleanup-generation="review">
          <div className="flex flex-wrap gap-1">
            {(["original", "candidate", "compare"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-remove-cleanup-generation={`open-${mode}`}
                aria-pressed={viewerOpen && review === mode}
                onClick={() => openReview(mode)}
                className={`${BUTTON} ${viewerOpen && review === mode ? "border-neutral-500 bg-neutral-800 text-neutral-50" : "border-neutral-700 text-neutral-300"}`}
              >
                {mode === "original" ? "Original" : mode === "candidate" ? "Candidate" : "Compare"}
              </button>
            ))}
            <button type="button" data-remove-cleanup-generation="discard" onClick={() => void discard()} className={`${BUTTON} border-neutral-700 text-neutral-300`}>
              Discard
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
            Review opens in a larger viewer. The room view stays unchanged.
          </p>
        </div>
      ) : null}
      {job && phase === "completed" ? (
        <RemoveCleanupReviewViewer
          open={viewerOpen}
          mode={review}
          originalSrc={originalSrc}
          candidateUrl={visibleCandidateUrl}
          candidatePhase={candidatePhase}
          candidateError={candidateError}
          onMode={setReview}
          onReload={() => setCandidateAttempt((attempt) => attempt + 1)}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
      {job && (phase === "queued" || phase === "generating") ? (
        <button type="button" className={`${BUTTON} mt-2 border-neutral-700 text-neutral-300`} onClick={() => void discard()}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}

function publishCleanupJob(
  next: CleanupStatusView,
  setJob: (job: CleanupStatusView) => void,
  setPhase: (phase: CleanupGenerationPhase) => void,
) {
  setJob(next);
  setPhase(cleanupGenerationPhaseFromStatus(next.status));
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

async function fetchCandidateBlob(jobId: string, signal: AbortSignal): Promise<Blob | null> {
  const response = await fetch(`/api/vibode/admin/remove-cleanup-jobs/${jobId}/candidate`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return null;
  return response.blob();
}
