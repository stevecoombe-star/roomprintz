import { cleanupHistoryRoomToRefresh } from "@/lib/vibode-stage/remove-cleanup-history-ui";

export const CLEANUP_HISTORY_ACTIVATION_ERROR =
  "Clean Up was saved to History, but it is not the active image yet. Show the saved image, or Cancel and choose it from Image History.";

export const CLEANUP_HISTORY_STALE_ERROR =
  "This room changed before Clean Up could become the active image.";

export type CleanupFinalizeResult = "finalized" | "failed" | "stale";

export type CleanupAcceptancePlan =
  | { type: "rejected" }
  | { type: "activated-unexpected" }
  | { type: "already-refreshed" }
  | { type: "missing-asset" }
  | { type: "accepted"; roomId: string; jobId: string; assetId: string };

type ReadinessPhase = "checking" | "idle" | "running" | "ready" | "error";

export function editorRoomPath(roomId: string): string {
  return `/editor?roomId=${encodeURIComponent(roomId)}`;
}

/** URL sync for one upload that is still the active room-open session. */
export function uploadedRoomUrlSync(input: Readonly<{
  roomId: string | null | undefined;
  uploadSerial: number;
  activeUploadSerial: number;
  openSession: number;
  activeOpenSession: number;
}>): { roomId: string; path: string } | null {
  if (input.uploadSerial !== input.activeUploadSerial) return null;
  if (input.openSession !== input.activeOpenSession) return null;
  if (typeof input.roomId !== "string") return null;
  const roomId = input.roomId.trim();
  if (!roomId) return null;
  return { roomId, path: editorRoomPath(roomId) };
}

/**
 * Generation identity that should refetch Remove eligibility.
 * A re-run keeps the previous id until the next ready generation arrives.
 * Checking, idle, and error clear it. A room change clears it immediately.
 */
export function nextRemoveReadinessGenerationId(input: Readonly<{
  phase: ReadinessPhase;
  generationId: string | null;
  previous: string | null;
  roomChanged?: boolean;
}>): string | null {
  if (input.roomChanged) return null;
  if (input.phase === "running") return input.previous;
  if (input.phase === "ready") {
    const generationId = input.generationId?.trim() ?? "";
    return generationId.length > 0 ? generationId : input.previous;
  }
  return null;
}

export function shouldApplyRemoveAlignmentLookup(input: Readonly<{
  requestRoomId: string;
  currentRoomId: string | null;
  requestSerial: number;
  currentSerial: number;
  requestedGenerationId: string | null;
  reportGenerationId: string | null;
  access: "hidden" | "disabled" | "ready";
}>): boolean {
  if (input.requestSerial !== input.currentSerial) return false;
  if (input.currentRoomId !== input.requestRoomId) return false;
  if (
    input.requestedGenerationId
    && input.access === "ready"
    && input.reportGenerationId !== input.requestedGenerationId
  ) {
    return false;
  }
  return true;
}

export function planCleanupAcceptance(input: Readonly<{
  responseOk: boolean;
  activated: boolean;
  roomId: string | null;
  jobId: string | null;
  assetId: string | null;
  refreshedJobIds: ReadonlySet<string>;
}>): CleanupAcceptancePlan {
  if (input.responseOk && input.activated) return { type: "activated-unexpected" };
  if (!input.responseOk) return { type: "rejected" };
  const roomId = cleanupHistoryRoomToRefresh({
    responseOk: true,
    activated: false,
    roomId: input.roomId,
    jobId: input.jobId,
    refreshedJobIds: input.refreshedJobIds,
  });
  if (!roomId || !input.jobId) {
    if (input.jobId && input.refreshedJobIds.has(input.jobId)) return { type: "already-refreshed" };
    return { type: "rejected" };
  }
  const assetId = input.assetId?.trim() ?? "";
  if (!assetId) return { type: "missing-asset" };
  return { type: "accepted", roomId, jobId: input.jobId, assetId };
}
