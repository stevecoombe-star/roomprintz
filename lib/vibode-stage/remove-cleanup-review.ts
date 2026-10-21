import type { CleanupReviewMode } from "@/lib/vibode-stage/remove-cleanup-generation-ui";
import type { CleanupStatusView } from "@/lib/vibode-stage/remove-cleanup-jobs/types";

export const REMOVE_CLEANUP_CANDIDATE_LOAD_ERROR = "Clean Up candidate could not be loaded.";

export const REMOVE_CLEANUP_STATUS_READ_ERROR = "Clean Up status could not be read.";

export type CleanupCandidatePhase = "idle" | "loading" | "ready" | "error";

export type CleanupReviewPollResult = "terminal" | "cancelled";

export type CleanupCandidateLoadResult =
  | Readonly<{ ok: true; url: string }>
  | Readonly<{ ok: false; cancelled: boolean }>;

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function cleanupReviewSources(mode: CleanupReviewMode): readonly ("original" | "candidate")[] {
  if (mode === "compare") return ["original", "candidate"];
  return [mode];
}

export function createCleanupObjectUrlStore(revoke: (url: string) => void) {
  let current: string | null = null;
  return {
    current(): string | null {
      return current;
    },
    replace(next: string | null) {
      const previous = current;
      current = next;
      if (previous && previous !== next) revoke(previous);
    },
    release() {
      if (!current) return;
      const previous = current;
      current = null;
      revoke(previous);
    },
  };
}

export async function waitForCleanupPoll(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * One status request at a time. This loop never downloads the candidate.
 * Cancellation resolves as "cancelled" instead of rejecting.
 */
export async function pollCleanupJob(input: Readonly<{
  jobId: string;
  signal: AbortSignal;
  intervalMs: number;
  load: (jobId: string, signal: AbortSignal) => Promise<CleanupStatusView | null>;
  publish: (job: CleanupStatusView) => void;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}>): Promise<CleanupReviewPollResult> {
  const wait = input.wait ?? waitForCleanupPoll;
  try {
    while (!input.signal.aborted) {
      const job = await input.load(input.jobId, input.signal);
      if (input.signal.aborted) return "cancelled";
      if (job && job.jobId === input.jobId) {
        input.publish(job);
        if (job.status !== "queued" && job.status !== "running") return "terminal";
      }
      await wait(input.intervalMs, input.signal);
    }
    return "cancelled";
  } catch (error) {
    if (isAbortError(error) || input.signal.aborted) return "cancelled";
    throw error;
  }
}

/**
 * Downloads one private candidate. The caller supplies the signal, so a
 * status-poll cancellation cannot abort this request.
 */
export async function loadCleanupCandidateBlob(input: Readonly<{
  jobId: string;
  signal: AbortSignal;
  fetchCandidate: (jobId: string, signal: AbortSignal) => Promise<Blob | null>;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
}>): Promise<CleanupCandidateLoadResult> {
  try {
    if (input.signal.aborted) return { ok: false, cancelled: true };
    const blob = await input.fetchCandidate(input.jobId, input.signal);
    if (input.signal.aborted) return { ok: false, cancelled: true };
    if (!blob || blob.size < 1) return { ok: false, cancelled: false };
    const url = input.createObjectUrl(blob);
    if (input.signal.aborted) {
      input.revokeObjectUrl(url);
      return { ok: false, cancelled: true };
    }
    return { ok: true, url };
  } catch (error) {
    if (isAbortError(error) || input.signal.aborted) return { ok: false, cancelled: true };
    return { ok: false, cancelled: false };
  }
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
