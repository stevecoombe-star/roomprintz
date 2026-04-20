"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSupabaseUser } from "@/lib/useSupabaseUser";

type TokenSnapshotResponse = {
  balanceTokens?: unknown;
  error?: unknown;
};

export function useTokenBalance() {
  const { user, loading: authLoading } = useSupabaseUser();
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/vibode/tokens/snapshot", {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as TokenSnapshotResponse;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to load token balance (HTTP ${response.status}).`
        );
      }

      const nextBalance = typeof payload.balanceTokens === "number" ? payload.balanceTokens : 0;
      setBalance(nextBalance);
      setHasLoadedOnce(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load token balance.";
      console.warn("[tokens] failed to load token balance:", err);
      setError(message);
      setHasLoadedOnce(true);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setBalance(null);
      setError(null);
      setIsLoading(false);
      setHasLoadedOnce(false);
      return;
    }
    void refresh();
  }, [authLoading, refresh, user]);

  useEffect(() => {
    if (!user) return;
    const onTokensChanged = () => {
      void refresh();
    };
    window.addEventListener("tokens:changed", onTokensChanged);
    return () => {
      window.removeEventListener("tokens:changed", onTokensChanged);
    };
  }, [refresh, user]);

  return useMemo(
    () => ({
      visible: !authLoading && Boolean(user),
      balance,
      isLoading: isLoading || (!hasLoadedOnce && Boolean(user)),
      error,
      refresh,
    }),
    [authLoading, balance, error, hasLoadedOnce, isLoading, refresh, user]
  );
}
