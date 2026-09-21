/**
 * Request identity for AFD visual evidence.
 *
 * A rendered image or overlay must belong to the epoch that started the
 * current tuple request. A later visit to the same tuple gets a new epoch,
 * so a revoked blob or previous overlay cannot render as ready.
 */

export type VisualEvidenceRequest = Readonly<{
  key: string;
  epoch: number;
}>;

export function visualEvidenceRequestKey(tupleKey: string, nonce: number): string {
  return `${tupleKey}:${nonce}`;
}

export function nextVisualEvidenceRequest(
  current: VisualEvidenceRequest,
  key: string,
): VisualEvidenceRequest {
  if (current.key === key) return current;
  return { key, epoch: current.epoch + 1 };
}

export type VisualImageCommit = Readonly<{
  epoch: number;
  key: string;
  phase: "ready" | "error";
  imageUrl: string | null;
  error: string | null;
  errorStatus: number | "network" | "blob" | null;
}>;

export type VisualEvidenceImageView = Readonly<{
  isCommitted: boolean;
  phase: "loading" | "ready" | "error";
  imageUrl: string | null;
  error: string | null;
  errorStatus: number | "network" | "blob" | null;
}>;

export function selectCommittedVisualImage(input: Readonly<{
  tupleKey: string;
  request: VisualEvidenceRequest;
  commit: VisualImageCommit | null;
}>): VisualEvidenceImageView {
  const commit = input.commit;
  const current =
    commit != null &&
    commit.epoch === input.request.epoch &&
    commit.key === input.tupleKey;
  if (!current || commit == null) {
    return {
      isCommitted: false,
      phase: "loading",
      imageUrl: null,
      error: null,
      errorStatus: null,
    };
  }
  return {
    isCommitted: true,
    phase: commit.phase,
    imageUrl: commit.phase === "ready" ? commit.imageUrl : null,
    error: commit.error,
    errorStatus: commit.errorStatus,
  };
}

export type VisualOverlayCommit<T> = Readonly<{
  epoch: number;
  key: string;
  phase: "ready" | "error";
  overlay: T | null;
  error: string | null;
}>;

export function selectCommittedVisualOverlay<T>(input: Readonly<{
  tupleKey: string;
  request: VisualEvidenceRequest;
  commit: VisualOverlayCommit<T> | null;
}>): Readonly<{
  isCommitted: boolean;
  phase: "loading" | "ready" | "error";
  overlay: T | null;
  error: string | null;
}> {
  const commit = input.commit;
  const current =
    commit != null &&
    commit.epoch === input.request.epoch &&
    commit.key === input.tupleKey;
  if (!current || commit == null) {
    return {
      isCommitted: false,
      phase: "loading",
      overlay: null,
      error: null,
    };
  }
  return {
    isCommitted: true,
    phase: commit.phase,
    overlay: commit.phase === "ready" ? commit.overlay : null,
    error: commit.error,
  };
}
