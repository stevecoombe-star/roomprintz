"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

import {
  createIdleAfcProductionRuntimeState,
  interpretProductionRuntimeResponse,
  runtimeRestoreUrl,
  type AfcProductionRuntimeLoadState,
} from "./production-runtime-client";

export function useAfcProductionRuntime(
  roomId: string | null,
  options?: Readonly<{ enabled?: boolean; reloadKey?: number }>,
): AfcProductionRuntimeLoadState {
  const enabled = options?.enabled ?? true;
  const reloadKey = options?.reloadKey ?? 0;
  const [state, setState] = useState<AfcProductionRuntimeLoadState>(
    createIdleAfcProductionRuntimeState,
  );

  useEffect(() => {
    if (!enabled || !roomId) {
      setState(createIdleAfcProductionRuntimeState());
      return;
    }

    const activeRoomId = roomId;
    let cancelled = false;
    setState({
      loading: true,
      error: null,
      authority: null,
      originalImageUrl: null,
      generationId: null,
    });

    async function load() {
      try {
        const token = await getSupabaseBrowserAccessToken();
        if (!token) {
          throw new Error("Your session expired. Sign in again.");
        }
        if (cancelled) return;
        const response = await fetch(runtimeRestoreUrl(activeRoomId), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        const interpreted = interpretProductionRuntimeResponse({
          ok: response.ok,
          payload,
        });
        if (interpreted.status === "ready") {
          setState({
            loading: false,
            error: null,
            authority: interpreted.authority,
            originalImageUrl: interpreted.originalImageUrl,
            generationId: interpreted.generationId,
          });
          return;
        }
        setState({
          loading: false,
          error: interpreted.message,
          authority: null,
          originalImageUrl: null,
          generationId: interpreted.generationId,
        });
      } catch (loadError) {
        if (cancelled) return;
        setState({
          loading: false,
          error: loadError instanceof Error
            ? loadError.message
            : "Failed to restore AFC runtime.",
          authority: null,
          originalImageUrl: null,
          generationId: null,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, roomId, reloadKey]);

  return state;
}
