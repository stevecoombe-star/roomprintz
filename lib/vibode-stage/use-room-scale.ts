"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

import {
  ROOM_SCALE_DEFAULT,
  clampRoomScaleMultiplier,
  parseRoomScaleMultiplier,
} from "./room-scale";

const ROOM_SCALE_URL = "/api/vibode/stage/room-scale";

async function authorizedFetch(url: string, init: RequestInit): Promise<Response | null> {
  const token = await getSupabaseBrowserAccessToken();
  if (!token) return null;
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
}

export function useRoomScale(roomId: string | null): {
  roomScaleMultiplier: number;
  setRoomScaleMultiplier: (value: number) => void;
} {
  const [stored, setStored] = useState<{ roomId: string | null; multiplier: number }>({
    roomId,
    multiplier: ROOM_SCALE_DEFAULT,
  });
  const roomScaleMultiplier = stored.roomId === roomId
    ? stored.multiplier
    : ROOM_SCALE_DEFAULT;
  const localEditRef = useRef(0);
  const pendingRef = useRef<{ roomId: string; multiplier: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(async (targetRoomId: string, multiplier: number) => {
    const response = await authorizedFetch(
      `${ROOM_SCALE_URL}?roomId=${encodeURIComponent(targetRoomId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ roomId: targetRoomId, roomScaleMultiplier: multiplier }),
      },
    );
    return response?.ok === true;
  }, []);

  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!pending) return;
    void persist(pending.roomId, pending.multiplier);
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    const seenEdit = localEditRef.current;
    if (!roomId) return undefined;
    void (async () => {
      const response = await authorizedFetch(
        `${ROOM_SCALE_URL}?roomId=${encodeURIComponent(roomId)}`,
        { method: "GET" },
      );
      if (!response?.ok || cancelled) return;
      const payload: unknown = await response.json();
      const multiplier = payload != null
        && typeof payload === "object"
        && "roomScaleMultiplier" in payload
        ? parseRoomScaleMultiplier(payload.roomScaleMultiplier)
        : null;
      if (multiplier == null || cancelled) return;
      if (localEditRef.current !== seenEdit) return;
      setStored({ roomId, multiplier });
    })();
    return () => {
      cancelled = true;
      flushPending();
    };
  }, [flushPending, roomId]);

  const setRoomScaleMultiplier = useCallback((value: number) => {
    const next = clampRoomScaleMultiplier(value);
    localEditRef.current += 1;
    setStored({ roomId, multiplier: next });
    if (!roomId) return;
    pendingRef.current = { roomId, multiplier: next };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) return;
      void persist(pending.roomId, pending.multiplier);
    }, 200);
  }, [persist, roomId]);

  return { roomScaleMultiplier, setRoomScaleMultiplier };
}
