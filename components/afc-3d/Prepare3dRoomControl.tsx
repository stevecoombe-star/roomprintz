"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  PREPARE_3D_ROOM_FAILURE_MESSAGE,
  buildAnalyzeRequest,
  canRequestPrepare,
  classifyPrepare3dRetry,
  createInitialPrepare3dRoomState,
  enter3dRoomHref,
  isReadyProductionResponse,
  prepareButtonLabel,
  productionFailureReason,
  reducePrepare3dRoom,
  restoreStatusUrl,
  type Prepare3dRequestIntent,
  type Prepare3dRoomState,
} from "@/lib/afc-v2-runtime/prepare-3d-room-client";
import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

type Props = Readonly<{
  roomId: string | null;
}>;

function logPrepareFailure(detail: unknown) {
  if (typeof console === "undefined") return;
  console.warn("[prepare-3d-room] analysis did not succeed", detail);
}

export function Prepare3dRoomControl({ roomId }: Props) {
  const [state, setState] = useState<Prepare3dRoomState>(
    createInitialPrepare3dRoomState,
  );
  const inFlightRef = useRef(false);

  useEffect(() => {
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

  async function runAnalyze(
    activeRoomId: string,
    intent: Prepare3dRequestIntent,
  ) {
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
  }

  function handlePrepareClick() {
    if (!roomId) return;
    if (inFlightRef.current) return;
    if (!canRequestPrepare(state)) return;
    const intent = state.nextIntent;
    inFlightRef.current = true;
    setState((current) =>
      reducePrepare3dRoom(current, { type: "prepare_requested" }),
    );
    void runAnalyze(roomId, intent);
  }

  if (!roomId) return null;

  const prepareDisabled = state.phase === "checking" ||
    state.phase === "running" ||
    !canRequestPrepare(state);

  return (
    <div
      className="flex items-center gap-2"
      data-prepare-3d-room="true"
      data-prepare-3d-phase={state.phase}
    >
      {state.phase === "ready" && (
        <span className="text-xs text-emerald-300">Room ready</span>
      )}
      {state.phase === "error" && (
        <span className="max-w-[16rem] text-xs text-red-300">
          {PREPARE_3D_ROOM_FAILURE_MESSAGE}
        </span>
      )}
      {state.phase === "ready" ? (
        <Link
          href={enter3dRoomHref(roomId)}
          className="rounded-md border border-emerald-500/70 bg-emerald-950/40 px-2.5 py-1 text-xs text-emerald-100 transition hover:bg-emerald-900/50"
        >
          Enter 3D Room
        </Link>
      ) : (
        <button
          type="button"
          disabled={prepareDisabled}
          onClick={handlePrepareClick}
          className={`rounded-md border px-2.5 py-1 text-xs transition ${
            prepareDisabled
              ? "border-neutral-800 bg-neutral-950 text-neutral-500"
              : "border-emerald-500/70 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-900/50"
          }`}
        >
          {prepareButtonLabel(state)}
        </button>
      )}
    </div>
  );
}
