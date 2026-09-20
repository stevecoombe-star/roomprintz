"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

import {
  afcQaBrowserStateUrl,
  parseAfcQaBrowserState,
  type AfcQaBrowserState,
} from "./tester-report.client";

export type AfcQaStateLoad = Readonly<{
  loading: boolean;
  error: boolean;
  state: AfcQaBrowserState | null;
  reload: () => void;
}>;

const IDLE: Omit<AfcQaStateLoad, "reload"> = {
  loading: false,
  error: false,
  state: null,
};

export function useAfcQaState(
  roomId: string | null,
  options?: Readonly<{ reloadKey?: number }>,
): AfcQaStateLoad {
  const reloadKey = options?.reloadKey ?? 0;
  const [nonce, setNonce] = useState(0);
  const [load, setLoad] = useState<Omit<AfcQaStateLoad, "reload">>(IDLE);
  const roomIdRef = useRef<string | null>(null);

  const reload = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!roomId) {
      roomIdRef.current = null;
      setLoad(IDLE);
      return;
    }

    const sameRoom = roomIdRef.current === roomId;
    roomIdRef.current = roomId;
    const activeRoomId = roomId;
    let cancelled = false;
    setLoad((current) => ({
      loading: true,
      error: false,
      state: sameRoom ? current.state : null,
    }));

    async function loadState() {
      try {
        const token = await getSupabaseBrowserAccessToken();
        if (!token) {
          if (!cancelled) {
            setLoad({ loading: false, error: true, state: null });
          }
          return;
        }
        if (cancelled) return;
        const response = await fetch(afcQaBrowserStateUrl(activeRoomId), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.status === 401) {
          setLoad({ loading: false, error: true, state: null });
          return;
        }
        if (!response.ok) {
          setLoad((current) => ({
            loading: false,
            error: true,
            state: current.state,
          }));
          return;
        }
        const parsed = parseAfcQaBrowserState(payload);
        if (!parsed) {
          setLoad({ loading: false, error: true, state: null });
          return;
        }
        setLoad({ loading: false, error: false, state: parsed });
      } catch {
        if (cancelled) return;
        setLoad((current) => ({
          loading: false,
          error: true,
          state: current.state,
        }));
      }
    }

    void loadState();
    return () => {
      cancelled = true;
    };
  }, [roomId, reloadKey, nonce]);

  return {
    ...load,
    reload,
  };
}
