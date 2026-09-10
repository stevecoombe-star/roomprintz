/**
 * Client-only PI-3A trigger for certified PI-2 production analysis.
 *
 * This module builds authenticated HTTP requests. It does not import
 * the AFC engine, providers, or Lab analysis.
 */

import {
  classifyPrepare3dRetry,
  type Prepare3dRequestIntent,
} from "./prepare-3d-room-retry";

export type { Prepare3dRequestIntent, Prepare3dRetryIntent } from "./prepare-3d-room-retry";
export {
  classifyPrepare3dRetry,
  NO_APPLY_SAFE_CANDIDATE_FAILURE,
} from "./prepare-3d-room-retry";

export const PREPARE_3D_ROOM_ANALYZE_PATH = "/api/vibode/afc/analyze";
export const PREPARE_3D_ROOM_RESTORE_PATH = "/api/vibode/afc/restore";
export const PREPARE_3D_ROOM_FIRST_INTENT = "analyze" as const;
export const PREPARE_3D_ROOM_FAILURE_MESSAGE =
  "We couldn't prepare this room for 3D.";

export type Prepare3dRoomPhase =
  | "checking"
  | "idle"
  | "running"
  | "ready"
  | "error";

export type Prepare3dRoomState = Readonly<{
  phase: Prepare3dRoomPhase;
  inFlight: boolean;
  errorMessage: string | null;
  nextIntent: Prepare3dRequestIntent;
}>;

export type Prepare3dRoomEvent =
  | { type: "restore_ready" }
  | { type: "restore_absent" }
  | { type: "prepare_requested" }
  | { type: "prepare_succeeded" }
  | { type: "prepare_failed"; failureReason?: string | null };

export type Prepare3dAnalyzeRequest = Readonly<{
  url: string;
  method: "POST";
  body: Readonly<{
    roomId: string;
    intent: Prepare3dRequestIntent;
  }>;
}>;

export function createInitialPrepare3dRoomState(): Prepare3dRoomState {
  return {
    phase: "checking",
    inFlight: false,
    errorMessage: null,
    nextIntent: PREPARE_3D_ROOM_FIRST_INTENT,
  };
}

/** Diagnostic-only href for /editor/afc-3d. Normal Editor 3D mode does not navigate. */
export function enter3dRoomHref(roomId: string): string {
  return `/editor/afc-3d?roomId=${encodeURIComponent(roomId)}`;
}

export function restoreStatusUrl(roomId: string): string {
  return `${PREPARE_3D_ROOM_RESTORE_PATH}?roomId=${encodeURIComponent(roomId)}`;
}

export function buildAnalyzeRequest(
  roomId: string,
  intent: Prepare3dRequestIntent,
): Prepare3dAnalyzeRequest {
  return {
    url: PREPARE_3D_ROOM_ANALYZE_PATH,
    method: "POST",
    body: {
      roomId,
      intent,
    },
  };
}

export function isReadyProductionResponse(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return record.status === "ready" && record.authority != null;
}

export function productionFailureReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const reason = (payload as Record<string, unknown>).failureReason;
  return typeof reason === "string" && reason.trim().length > 0
    ? reason
    : null;
}

export function canRequestPrepare(state: Prepare3dRoomState): boolean {
  return !state.inFlight && (state.phase === "idle" || state.phase === "error");
}

export function shouldApplyPrepareRoomResponse(input: Readonly<{
  requestRoomId: string;
  currentRoomId: string | null;
}>): boolean {
  return input.currentRoomId === input.requestRoomId;
}

export function prepareButtonLabel(state: Prepare3dRoomState): string {
  if (state.phase === "running") return "Preparing your room…";
  if (state.phase === "error") return "Try Again";
  return "Prepare 3D Room";
}

export function reducePrepare3dRoom(
  state: Prepare3dRoomState,
  event: Prepare3dRoomEvent,
): Prepare3dRoomState {
  switch (event.type) {
    case "restore_ready":
      return {
        phase: "ready",
        inFlight: false,
        errorMessage: null,
        nextIntent: PREPARE_3D_ROOM_FIRST_INTENT,
      };
    case "restore_absent":
      return {
        phase: "idle",
        inFlight: false,
        errorMessage: null,
        nextIntent: PREPARE_3D_ROOM_FIRST_INTENT,
      };
    case "prepare_requested":
      if (!canRequestPrepare(state)) return state;
      return {
        ...state,
        phase: "running",
        inFlight: true,
        errorMessage: null,
      };
    case "prepare_succeeded":
      return {
        phase: "ready",
        inFlight: false,
        errorMessage: null,
        nextIntent: PREPARE_3D_ROOM_FIRST_INTENT,
      };
    case "prepare_failed":
      return {
        phase: "error",
        inFlight: false,
        errorMessage: PREPARE_3D_ROOM_FAILURE_MESSAGE,
        nextIntent: classifyPrepare3dRetry(event.failureReason),
      };
    default:
      return state;
  }
}
