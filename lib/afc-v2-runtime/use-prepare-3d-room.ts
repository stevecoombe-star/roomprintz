"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

import {
  buildAnalyzeRequest,
  canRequestPrepare,
  canRequestRunningFromReady,
  classifyPrepare3dRetry,
  createInitialPrepare3dRoomState,
  isReadyProductionResponse,
  productionFailureReason,
  readyProductionGenerationId,
  reducePrepare3dRoom,
  restoreStatusUrl,
  shouldApplyPrepareRoomResponse,
  type Prepare3dRequestIntent,
  type Prepare3dRoomState,
} from "./prepare-3d-room-client";

export type UsePrepare3dRoomResult = Readonly<{
  state: Prepare3dRoomState;
  requestPrepare: () => void;
  requestRunningFromReady: () => boolean;
  revertRunningToReady: () => void;
  settleRunning: (input: {
    ok: boolean;
    payload?: unknown;
    failureReason?: string | null;
  }) => void;
}>;

function logPrepareFailure(detail: unknown) {
  if (typeof console === "undefined") return;
  console.warn("[prepare-3d-room] analysis did not succeed", detail);
}

export function usePrepare3dRoom(roomId: string | null): UsePrepare3dRoomResult {
  const [state, setState] = useState<Prepare3dRoomState>(
    createInitialPrepare3dRoomState,
  );
  const inFlightRef = useRef(false);
  const stateRef = useRef(state);
  const roomIdRef = useRef(roomId);
  stateRef.current = state;
  roomIdRef.current = roomId;

  useEffect(() => {
    inFlightRef.current = false;
    setState(createInitialPrepare3dRoomState());
    if (!roomId) return;
    const activeRoomId = roomId;
    let cancelled = false;
    async function probeCurrentGeneration() {
      try {
        const token = await getSupabaseBrowserAccessToken();
        if (!token || cancelled) {
          if (!cancelled) {
            setState((current) =>
              reducePrepare3dRoom(current, { type: "restore_absent" }),
            );
          }
          return;
        }
        const response = await fetch(restoreStatusUrl(activeRoomId), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok && isReadyProductionResponse(payload)) {
          setState((current) =>
            reducePrepare3dRoom(current, {
              type: "restore_ready",
              generationId: readyProductionGenerationId(payload),
            }),
          );
          return;
        }
        setState((current) =>
          reducePrepare3dRoom(current, { type: "restore_absent" }),
        );
      } catch {
        if (!cancelled) {
          setState((current) =>
            reducePrepare3dRoom(current, { type: "restore_absent" }),
          );
        }
      }
    }
    void probeCurrentGeneration();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const runAnalyze = useCallback(
    async (activeRoomId: string, intent: Prepare3dRequestIntent) => {
      const request = buildAnalyzeRequest(activeRoomId, intent);
      const token = await getSupabaseBrowserAccessToken();
      if (
        !shouldApplyPrepareRoomResponse({
          requestRoomId: activeRoomId,
          currentRoomId: roomIdRef.current,
        })
      ) {
        return;
      }
      if (!token) {
        logPrepareFailure("missing access token");
        setState((current) =>
          reducePrepare3dRoom(current, { type: "prepare_failed" }),
        );
        inFlightRef.current = false;
        return;
      }
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(request.body),
        });
        const payload = await response.json().catch(() => null);
        if (
          !shouldApplyPrepareRoomResponse({
            requestRoomId: activeRoomId,
            currentRoomId: roomIdRef.current,
          })
        ) {
          return;
        }
        if (response.ok && isReadyProductionResponse(payload)) {
          setState((current) =>
            reducePrepare3dRoom(current, {
              type: "prepare_succeeded",
              generationId: readyProductionGenerationId(payload),
            }),
          );
          return;
        }
        const failureReason = productionFailureReason(payload);
        logPrepareFailure({
          status: response.status,
          payloadStatus: payload && typeof payload === "object"
            ? (payload as { status?: unknown }).status
            : null,
          failureReason,
          retryIntent: classifyPrepare3dRetry(failureReason),
        });
        setState((current) =>
          reducePrepare3dRoom(current, {
            type: "prepare_failed",
            failureReason,
          }),
        );
      } catch (error) {
        if (
          !shouldApplyPrepareRoomResponse({
            requestRoomId: activeRoomId,
            currentRoomId: roomIdRef.current,
          })
        ) {
          return;
        }
        logPrepareFailure(error);
        setState((current) =>
          reducePrepare3dRoom(current, { type: "prepare_failed" }),
        );
      } finally {
        if (
          shouldApplyPrepareRoomResponse({
            requestRoomId: activeRoomId,
            currentRoomId: roomIdRef.current,
          })
        ) {
          inFlightRef.current = false;
        }
      }
    },
    [],
  );

  const requestPrepare = useCallback(() => {
    if (!roomId) return;
    if (inFlightRef.current) return;
    const current = stateRef.current;
    if (!canRequestPrepare(current)) return;
    const intent = current.nextIntent;
    inFlightRef.current = true;
    setState((latest) =>
      reducePrepare3dRoom(latest, { type: "prepare_requested" }),
    );
    void runAnalyze(roomId, intent);
  }, [roomId, runAnalyze]);

  const requestRunningFromReady = useCallback((): boolean => {
    if (inFlightRef.current) return false;
    const current = stateRef.current;
    if (!canRequestRunningFromReady(current)) return false;
    inFlightRef.current = true;
    setState((latest) =>
      reducePrepare3dRoom(latest, { type: "running_requested_from_ready" }),
    );
    return true;
  }, []);

  const revertRunningToReady = useCallback(() => {
    if (stateRef.current.phase !== "running") return;
    inFlightRef.current = false;
    setState((latest) =>
      reducePrepare3dRoom(latest, { type: "running_reverted_to_ready" }),
    );
  }, []);

  const settleRunning = useCallback(
    (input: {
      ok: boolean;
      payload?: unknown;
      failureReason?: string | null;
    }) => {
      if (stateRef.current.phase !== "running") return;
      inFlightRef.current = false;
      if (input.ok) {
        setState((latest) =>
          reducePrepare3dRoom(latest, {
            type: "prepare_succeeded",
            generationId: readyProductionGenerationId(input.payload),
          }),
        );
        return;
      }
      setState((latest) =>
        reducePrepare3dRoom(latest, {
          type: "prepare_failed",
          failureReason: input.failureReason,
        }),
      );
    },
    [],
  );

  return {
    state,
    requestPrepare,
    requestRunningFromReady,
    revertRunningToReady,
    settleRunning,
  };
}
