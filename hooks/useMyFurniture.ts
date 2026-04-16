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

export function useMyFurniture(): UseMyFurnitureResult {
  const [rawItems, setRawItems] = useState<MyFurnitureItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<MyFurnitureViewMode>("grid");
  const [sort, setSort] = useState<MyFurnitureSortMode>("recent");
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
