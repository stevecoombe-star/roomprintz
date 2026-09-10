"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

import {
  buildAnalyzeRequest,
  canRequestPrepare,
  classifyPrepare3dRetry,
  createInitialPrepare3dRoomState,
  isReadyProductionResponse,
  productionFailureReason,
  reducePrepare3dRoom,
  restoreStatusUrl,
  type Prepare3dRequestIntent,
  type Prepare3dRoomState,
} from "./prepare-3d-room-client";

export type UsePrepare3dRoomResult = Readonly<{
  state: Prepare3dRoomState;
  requestPrepare: () => void;
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
  stateRef.current = state;

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
            reducePrepare3dRoom(current, { type: "restore_ready" }),
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
        if (response.ok && isReadyProductionResponse(payload)) {
          setState((current) =>
            reducePrepare3dRoom(current, { type: "prepare_succeeded" }),
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
        logPrepareFailure(error);
        setState((current) =>
          reducePrepare3dRoom(current, { type: "prepare_failed" }),
        );
      } finally {
        inFlightRef.current = false;
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

  return { state, requestPrepare };
}
