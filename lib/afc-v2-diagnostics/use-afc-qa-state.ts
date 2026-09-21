"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

import {
  advanceQaRequestAuthority,
  qaResponseMayCommit,
  selectQaLoadView,
  type QaCommittedLoad,
  type QaRequestAuthority,
} from "./qa-request-authority";
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

export function useAfcQaState(
  roomId: string | null,
  options?: Readonly<{ reloadKey?: number }>,
): AfcQaStateLoad {
  const reloadKey = options?.reloadKey ?? 0;
  const [nonce, setNonce] = useState(0);
  const [committed, setCommitted] = useState<QaCommittedLoad | null>(null);
  const [authority, setAuthority] = useState<QaRequestAuthority>(() => ({
    roomId,
    reloadKey,
    nonce: 0,
    generation: 1,
  }));
  const nextAuthority = advanceQaRequestAuthority(authority, {
    roomId,
    reloadKey,
    nonce,
  });
  if (nextAuthority !== authority) {
    setAuthority(nextAuthority);
    if (roomId == null) setCommitted(null);
  }
  const authorityRef = useRef(nextAuthority);
  // Layout runs before microtasks, so a response that resolves before passive
  // cleanup still sees the room identity that is authoritative now.
  useLayoutEffect(() => {
    authorityRef.current = nextAuthority;
  }, [nextAuthority]);

  const reload = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const request = {
      roomId,
      reloadKey,
      nonce,
      generation: nextAuthority.generation,
    };
    if (
      committed != null &&
      committed.roomId === request.roomId &&
      committed.reloadKey === request.reloadKey &&
      committed.nonce === request.nonce &&
      committed.generation === request.generation
    ) {
      return;
    }

    const previousState =
      committed != null && committed.roomId === request.roomId
        ? committed.state
        : null;
    let cancelled = false;

    function commit(
      next: Readonly<{ error: boolean; state: AfcQaBrowserState | null }>,
    ) {
      if (cancelled) return;
      if (!qaResponseMayCommit(authorityRef.current, request)) return;
      setCommitted({
        roomId: request.roomId,
        reloadKey: request.reloadKey,
        nonce: request.nonce,
        generation: request.generation,
        error: next.error,
        state: next.state,
      });
    }

    async function loadState() {
      try {
        const token = await getSupabaseBrowserAccessToken();
        if (!token) {
          commit({ error: true, state: null });
          return;
        }
        if (cancelled) return;
        const response = await fetch(afcQaBrowserStateUrl(request.roomId), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.status === 401) {
          commit({ error: true, state: null });
          return;
        }
        if (!response.ok) {
          commit({ error: true, state: previousState });
          return;
        }
        const parsed = parseAfcQaBrowserState(payload);
        if (!parsed) {
          commit({ error: true, state: null });
          return;
        }
        commit({ error: false, state: parsed });
      } catch {
        if (cancelled) return;
        commit({ error: true, state: previousState });
      }
    }

    void loadState();
    return () => {
      cancelled = true;
    };
  }, [roomId, reloadKey, nonce, committed, nextAuthority]);

  const view = selectQaLoadView({
    roomId,
    reloadKey,
    nonce,
    authority: nextAuthority,
    committed,
  });
  return { ...view, reload };
}
