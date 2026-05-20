"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";
import {
  type MyFurnitureItem,
  type MyFurnitureSortMode,
  type MyFurnitureViewMode,
  normalizeMyFurnitureItem,
  sortMyFurnitureItems,
} from "@/lib/myFurniture";

const VIBODE_MY_FURNITURE_SORT_KEY = "vibode:my-furniture-sort:v1";
const DEFAULT_MY_FURNITURE_SORT: MyFurnitureSortMode = "recent";
const MY_FURNITURE_SORT_MODES: ReadonlySet<MyFurnitureSortMode> = new Set([
  "recent",
  "used",
  "oldest",
]);

type UseMyFurnitureResult = {
  items: MyFurnitureItem[];
  isLoading: boolean;
  error: string | null;
  viewMode: MyFurnitureViewMode;
  setViewMode: (next: MyFurnitureViewMode) => void;
  sort: MyFurnitureSortMode;
  setSort: (next: MyFurnitureSortMode) => void;
  selectedItem: MyFurnitureItem | null;
  setSelectedItem: (item: MyFurnitureItem | null) => void;
  removeItemById: (id: string) => void;
  refresh: () => Promise<void>;
};

type MyFurnitureListResponse = {
  items?: unknown[];
  error?: string;
};

function loadInitialMyFurnitureSort(): MyFurnitureSortMode {
  if (typeof window === "undefined") return DEFAULT_MY_FURNITURE_SORT;

  try {
    const savedSort = window.localStorage.getItem(VIBODE_MY_FURNITURE_SORT_KEY);
    if (savedSort && MY_FURNITURE_SORT_MODES.has(savedSort as MyFurnitureSortMode)) {
      return savedSort as MyFurnitureSortMode;
    }
  } catch {
    // Ignore localStorage read failures (privacy mode, quota, etc.).
  }

  return DEFAULT_MY_FURNITURE_SORT;
}

export function useMyFurniture(): UseMyFurnitureResult {
  const [rawItems, setRawItems] = useState<MyFurnitureItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<MyFurnitureViewMode>("grid");
  const [sort, setSort] = useState<MyFurnitureSortMode>(() => loadInitialMyFurnitureSort());
  const [selectedItem, setSelectedItem] = useState<MyFurnitureItem | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const accessToken = await getSupabaseBrowserAccessToken();
      if (!accessToken) {
        throw new Error("Please sign in to view your saved furniture.");
      }

      const res = await fetch("/api/vibode/my-furniture/list", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await res.json().catch(() => ({}))) as MyFurnitureListResponse;
      if (!res.ok) {
        throw new Error(payload.error || `Failed to load My Furniture (HTTP ${res.status}).`);
      }

      const nextItems = Array.isArray(payload.items)
        ? payload.items
            .map((item) => normalizeMyFurnitureItem(item))
            .filter((item): item is MyFurnitureItem => Boolean(item))
        : [];
      setRawItems(nextItems);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Could not load saved furniture right now.";
      setRawItems([]);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(VIBODE_MY_FURNITURE_SORT_KEY, sort);
    } catch {
      // Ignore localStorage write failures (privacy mode, quota, etc.).
    }
  }, [sort]);

  const items = useMemo(() => sortMyFurnitureItems(rawItems, sort), [rawItems, sort]);

  const removeItemById = useCallback((id: string) => {
    setRawItems((prev) => prev.filter((item) => item.id !== id));
    setSelectedItem((prev) => (prev?.id === id ? null : prev));
  }, []);

  return {
    items,
    isLoading,
    error,
    viewMode,
    setViewMode,
    sort,
    setSort,
    selectedItem,
    setSelectedItem,
    removeItemById,
    refresh,
  };
}
