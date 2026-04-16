"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MyFurnitureDrawer } from "@/components/my-furniture/MyFurnitureDrawer";
import { MyFurnitureEmptyState } from "@/components/my-furniture/MyFurnitureEmptyState";
import { MyFurnitureGrid } from "@/components/my-furniture/MyFurnitureGrid";
import { MyFurnitureHeader } from "@/components/my-furniture/MyFurnitureHeader";
import { MyFurnitureList } from "@/components/my-furniture/MyFurnitureList";
import { MyFurnitureToolbar } from "@/components/my-furniture/MyFurnitureToolbar";
import { useMyFurniture } from "@/hooks/useMyFurniture";
import { getMyFurniturePreferredImageUrl } from "@/lib/myFurniture";
import {
  clearPendingFurnitureSelection,
  clearPendingFurnitureClipboardSuppressionHash,
  getPendingFurnitureSelection,
  getPendingFurnitureClipboardSuppressionHash,
  setPendingFurnitureSelection,
} from "@/lib/pendingFurnitureAction";
import { useSupabaseUser } from "@/lib/useSupabaseUser";

function trackMyFurnitureEvent(event: string, payload?: Record<string, unknown>) {
  console.info("[my-furniture-ui]", event, payload ?? {});
}

export function MyFurniturePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const nextEditorTarget =
    typeof returnTo === "string" && returnTo.startsWith("/editor") ? returnTo : "/editor";
  const { user, loading: authLoading } = useSupabaseUser();
  const {
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
  } = useMyFurniture();
  const [actingItemId, setActingItemId] = useState<string | null>(null);

  useEffect(() => {
    trackMyFurnitureEvent("vibode_my_furniture_page_viewed");
  }, []);

  useEffect(() => {
    setActingItemId(null);
  }, []);

  const handleUseInRoom = useCallback(
    (itemId: string, source?: string) => {
      setActingItemId(itemId);
      const item = items.find((entry) => entry.id === itemId) ?? null;
      const previewImageUrl = item ? getMyFurniturePreferredImageUrl(item) : null;
      const suppressedClipboardPreviewHash = getPendingFurnitureClipboardSuppressionHash();

      trackMyFurnitureEvent("vibode_my_furniture_use_in_room_clicked", {
        itemId,
        source: source || "unknown",
      });

      setPendingFurnitureSelection({
        furnitureId: itemId,
        previewImageUrl,
        suppressedClipboardPreviewHash,
        createdAt: Date.now(),
      });
      clearPendingFurnitureClipboardSuppressionHash();

      trackMyFurnitureEvent("vibode_my_furniture_pending_selection_created", {
        itemId,
        source: source || "unknown",
      });

      router.push(nextEditorTarget);
    },
    [items, nextEditorTarget, router]
  );

  const handleDeleteItem = useCallback(
    (itemId: string) => {
      removeItemById(itemId);
      if (selectedItem?.id === itemId) {
        setSelectedItem(null);
      }
      setActingItemId((prev) => (prev === itemId ? null : prev));

      const pendingSelection = getPendingFurnitureSelection();
      if (pendingSelection?.furnitureId === itemId) {
        clearPendingFurnitureSelection();
        clearPendingFurnitureClipboardSuppressionHash();
      }

      trackMyFurnitureEvent("vibode_my_furniture_item_deleted", { itemId });
    },
    [removeItemById, selectedItem?.id, setSelectedItem]
  );

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
          Loading saved furniture...
        </div>
      );
    }
    if (error) {
      return (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      );
    }
    if (items.length === 0) {
      return <MyFurnitureEmptyState />;
    }

    if (viewMode === "grid") {
      return (
        <MyFurnitureGrid
          items={items}
          onOpen={(item) => {
            trackMyFurnitureEvent("vibode_my_furniture_item_opened", { itemId: item.id });
            setSelectedItem(item);
          }}
          onUseInRoom={(itemId) => handleUseInRoom(itemId, "grid")}
          actingItemId={actingItemId}
        />
      );
    }

    return (
      <MyFurnitureList
        items={items}
        onOpen={(item) => {
          trackMyFurnitureEvent("vibode_my_furniture_item_opened", { itemId: item.id });
          setSelectedItem(item);
        }}
        onUseInRoom={(itemId) => handleUseInRoom(itemId, "list")}
        actingItemId={actingItemId}
      />
    );
  }, [actingItemId, error, handleUseInRoom, isLoading, items, setSelectedItem, viewMode]);

  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-slate-400">Checking session...</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="text-2xl font-semibold">My Furniture</h1>
          <p className="mt-2 text-sm text-slate-400">Please sign in to view your saved furniture.</p>
          <Link
            href="/login?next=/my-furniture"
            className="mt-6 inline-flex rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Go to Login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 lg:px-6">
        <div className="mb-3 flex items-center gap-2 text-xs">
          <Link
            href="/my-rooms"
            className="rounded-md border border-transparent px-2 py-1 text-slate-400 transition hover:border-slate-800 hover:bg-slate-900 hover:text-slate-200"
          >
            My Rooms
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-slate-300">My Furniture</span>
        </div>

        <MyFurnitureHeader onRefresh={() => void refresh()} isRefreshing={isLoading} />
        <MyFurnitureToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sort={sort}
          onSortChange={setSort}
          itemCount={items.length}
        />
        {content}

        <MyFurnitureDrawer
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUseInRoom={(itemId) => handleUseInRoom(itemId, "drawer")}
          onDelete={handleDeleteItem}
          isActing={actingItemId === selectedItem?.id}
        />
      </div>
    </main>
  );
}
