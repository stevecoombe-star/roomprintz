"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MyFurnitureAddItemDialog } from "@/components/my-furniture/MyFurnitureAddItemDialog";
import { MyFurnitureDrawer } from "@/components/my-furniture/MyFurnitureDrawer";
import { MyFurnitureEmptyState } from "@/components/my-furniture/MyFurnitureEmptyState";
import { MyFurnitureFolderCrudDialog } from "@/components/my-furniture/MyFurnitureFolderCrudDialog";
import {
  type MyFurnitureFolder,
  MyFurnitureFoldersBar,
} from "@/components/my-furniture/MyFurnitureFoldersBar";
import { MyFurnitureGrid } from "@/components/my-furniture/MyFurnitureGrid";
import { MyFurnitureHeader } from "@/components/my-furniture/MyFurnitureHeader";
import { MyFurnitureList } from "@/components/my-furniture/MyFurnitureList";
import { MyFurnitureMoveToFolderDialog } from "@/components/my-furniture/MyFurnitureMoveToFolderDialog";
import { MyFurnitureToolbar } from "@/components/my-furniture/MyFurnitureToolbar";
import { TokenBalanceBadge } from "@/components/tokens/TokenBalanceBadge";
import { TokenStatusNotice } from "@/components/tokens/TokenStatusNotice";
import { useMyFurniture } from "@/hooks/useMyFurniture";
import { getMyFurniturePreferredImageUrl } from "@/lib/myFurniture";
import {
  clearPendingFurnitureSelection,
  clearPendingFurnitureClipboardSuppressionHash,
  getPendingFurnitureSelection,
  getPendingFurnitureClipboardSuppressionHash,
  setPendingFurnitureSelection,
} from "@/lib/pendingFurnitureAction";
import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";
import { useSupabaseUser } from "@/lib/useSupabaseUser";

function trackMyFurnitureEvent(event: string, payload?: Record<string, unknown>) {
  console.info("[my-furniture-ui]", event, payload ?? {});
}

type FolderScope = "all" | "unfiled" | `folder:${string}`;
type FolderCrudMode = "create" | "rename" | "delete";

type FolderListResponse = {
  folders?: unknown[];
  error?: string;
};

type FolderWriteResponse = {
  folder?: unknown;
  success?: boolean;
  error?: string;
};

type MoveResponse = {
  success?: boolean;
  updatedIds?: string[];
  error?: string;
};

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFolder(raw: unknown): MyFurnitureFolder | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = asOptionalString(row.id);
  const name = asOptionalString(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    createdAt: asOptionalString(row.created_at ?? row.createdAt),
    updatedAt: asOptionalString(row.updated_at ?? row.updatedAt),
  };
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
  const [folders, setFolders] = useState<MyFurnitureFolder[]>([]);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState<FolderScope>("all");
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [moveDialog, setMoveDialog] = useState<{
    open: boolean;
    itemIds: string[];
    initialFolderId: string | null;
  }>({ open: false, itemIds: [], initialFolderId: null });
  const [isMoving, setIsMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<{
    open: boolean;
    mode: FolderCrudMode;
    folder: MyFurnitureFolder | null;
  }>({ open: false, mode: "create", folder: null });
  const [isFolderDialogSubmitting, setIsFolderDialogSubmitting] = useState(false);

  useEffect(() => {
    trackMyFurnitureEvent("vibode_my_furniture_page_viewed");
  }, []);

  useEffect(() => {
    setActingItemId(null);
  }, []);

  const fetchFolders = useCallback(async () => {
    setFoldersError(null);
    try {
      const accessToken = await getSupabaseBrowserAccessToken();
      if (!accessToken) {
        throw new Error("Please sign in again to view folders.");
      }
      const response = await fetch("/api/vibode/my-furniture/folders", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as FolderListResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Couldn't load folders right now.");
      }
      const nextFolders = Array.isArray(payload.folders)
        ? payload.folders
            .map((folder) => normalizeFolder(folder))
            .filter((folder): folder is MyFurnitureFolder => Boolean(folder))
        : [];
      setFolders(nextFolders);
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "We couldn't load folders right now. Please try again.";
      setFolders([]);
      setFoldersError(message);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void fetchFolders();
  }, [fetchFolders, user]);

  useEffect(() => {
    setSelectedItemIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (items.some((item) => item.id === id)) next.add(id);
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    if (selectedScope === "all" || selectedScope === "unfiled") return;
    const folderId = selectedScope.slice("folder:".length);
    const exists = folders.some((folder) => folder.id === folderId);
    if (!exists) {
      setSelectedScope("all");
    }
  }, [folders, selectedScope]);

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
      setSelectedItemIds((prev) => {
        if (!prev.has(itemId)) return prev;
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
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

  const createFolder = useCallback(
    async (name: string): Promise<MyFurnitureFolder | null> => {
      const accessToken = await getSupabaseBrowserAccessToken();
      if (!accessToken) {
        throw new Error("Please sign in again to manage folders.");
      }
      const response = await fetch("/api/vibode/my-furniture/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          mode: "create",
          name,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as FolderWriteResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Couldn't create that folder right now.");
      }
      const folder = normalizeFolder(payload.folder ?? null);
      if (!folder) {
        throw new Error("Folder was created, but couldn't be confirmed. Please refresh.");
      }
      setFolders((prev) => [folder, ...prev]);
      return folder;
    },
    []
  );

  const renameFolder = useCallback(async (folderId: string, name: string) => {
    const accessToken = await getSupabaseBrowserAccessToken();
    if (!accessToken) {
      throw new Error("Please sign in again to rename folders.");
    }
    const response = await fetch("/api/vibode/my-furniture/folders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        mode: "rename",
        id: folderId,
        name,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as FolderWriteResponse;
    if (!response.ok) {
      throw new Error(payload.error || "Couldn't rename that folder right now.");
    }
    const updated = normalizeFolder(payload.folder ?? null);
    if (!updated) {
      throw new Error("Folder was renamed, but couldn't be confirmed. Please refresh.");
    }
    setFolders((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
  }, []);

  const deleteFolder = useCallback(
    async (folderId: string) => {
      const accessToken = await getSupabaseBrowserAccessToken();
      if (!accessToken) {
        throw new Error("Please sign in again to delete folders.");
      }
      const response = await fetch("/api/vibode/my-furniture/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          mode: "delete",
          id: folderId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as FolderWriteResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Couldn't delete that folder right now.");
      }
      setFolders((prev) => prev.filter((entry) => entry.id !== folderId));
      if (selectedScope === `folder:${folderId}`) {
        setSelectedScope("all");
      }
      await refresh();
    },
    [refresh, selectedScope]
  );

  const filteredItems = useMemo(() => {
    if (selectedScope === "all") return items;
    if (selectedScope === "unfiled") {
      return items.filter((item) => !item.folderId);
    }
    const folderId = selectedScope.slice("folder:".length);
    return items.filter((item) => item.folderId === folderId);
  }, [items, selectedScope]);

  const folderCounts = useMemo(() => {
    const byId: Record<string, number> = {};
    let unfiled = 0;
    for (const item of items) {
      if (!item.folderId) {
        unfiled += 1;
        continue;
      }
      byId[item.folderId] = (byId[item.folderId] ?? 0) + 1;
    }
    return {
      all: items.length,
      unfiled,
      byId,
    };
  }, [items]);

  const selectedCount = selectedItemIds.size;

  const openMoveDialog = useCallback(
    (itemIds: string[], initialFolderId: string | null) => {
      setMoveError(null);
      setMoveDialog({ open: true, itemIds, initialFolderId });
    },
    []
  );

  const handleMoveItems = useCallback(
    async (itemIds: string[], folderId: string | null) => {
      const accessToken = await getSupabaseBrowserAccessToken();
      if (!accessToken) {
        throw new Error("Please sign in again to move items.");
      }
      const response = await fetch("/api/vibode/my-furniture/move", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          itemIds,
          folderId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as MoveResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Couldn't move those items right now.");
      }
      await refresh();
      setSelectedItemIds(new Set());
    },
    [refresh]
  );

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
          Loading your saved furniture...
        </div>
      );
    }
    if (error) {
      return (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          We couldn't load your saved furniture right now. Please refresh and try again.
        </div>
      );
    }
    if (items.length === 0) {
      return <MyFurnitureEmptyState />;
    }
    if (filteredItems.length === 0) {
      return (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
          No items in this folder yet. Add an item or switch folders to continue.
        </div>
      );
    }

    if (viewMode === "grid") {
      return (
        <MyFurnitureGrid
          items={filteredItems}
          onOpen={(item) => {
            trackMyFurnitureEvent("vibode_my_furniture_item_opened", { itemId: item.id });
            setSelectedItem(item);
          }}
          onUseInRoom={(itemId) => handleUseInRoom(itemId, "grid")}
          onMoveToFolder={(itemId) => {
            const item = items.find((entry) => entry.id === itemId) ?? null;
            openMoveDialog([itemId], item?.folderId ?? null);
          }}
          selectionMode={selectionMode}
          selectedIds={selectedItemIds}
          onToggleSelected={(itemId) => {
            setSelectedItemIds((prev) => {
              const next = new Set(prev);
              if (next.has(itemId)) next.delete(itemId);
              else next.add(itemId);
              return next;
            });
          }}
          actingItemId={actingItemId}
        />
      );
    }

    return (
      <MyFurnitureList
        items={filteredItems}
        onOpen={(item) => {
          trackMyFurnitureEvent("vibode_my_furniture_item_opened", { itemId: item.id });
          setSelectedItem(item);
        }}
        onUseInRoom={(itemId) => handleUseInRoom(itemId, "list")}
        onMoveToFolder={(itemId) => {
          const item = items.find((entry) => entry.id === itemId) ?? null;
          openMoveDialog([itemId], item?.folderId ?? null);
        }}
        selectionMode={selectionMode}
        selectedIds={selectedItemIds}
        onToggleSelected={(itemId) => {
          setSelectedItemIds((prev) => {
            const next = new Set(prev);
            if (next.has(itemId)) next.delete(itemId);
            else next.add(itemId);
            return next;
          });
        }}
        actingItemId={actingItemId}
      />
    );
  }, [
    actingItemId,
    error,
    filteredItems,
    handleUseInRoom,
    isLoading,
    items,
    openMoveDialog,
    selectedItemIds,
    selectionMode,
    setSelectedItem,
    viewMode,
  ]);

  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-slate-400">Checking your session...</div>
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
            Go to Sign In
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

        <MyFurnitureAddItemDialog
          isOpen={isAddItemOpen}
          onClose={() => setIsAddItemOpen(false)}
          onSubmitted={async () => {
            await refresh();
            await fetchFolders();
          }}
        />
        <MyFurnitureMoveToFolderDialog
          isOpen={moveDialog.open}
          folders={folders}
          itemCount={moveDialog.itemIds.length}
          initialFolderId={moveDialog.initialFolderId}
          isSubmitting={isMoving}
          error={moveError}
          onClose={() => {
            if (isMoving) return;
            setMoveDialog({ open: false, itemIds: [], initialFolderId: null });
            setMoveError(null);
          }}
          onCreateFolder={createFolder}
          onSubmit={async (folderId) => {
            setIsMoving(true);
            setMoveError(null);
            try {
              await handleMoveItems(moveDialog.itemIds, folderId);
              setMoveDialog({ open: false, itemIds: [], initialFolderId: null });
            } catch (err: unknown) {
              const message =
                err instanceof Error && err.message
                  ? err.message
                  : "Couldn't move those items right now. Please try again.";
              setMoveError(message);
            } finally {
              setIsMoving(false);
            }
          }}
        />
        <MyFurnitureFolderCrudDialog
          isOpen={folderDialog.open}
          mode={folderDialog.mode}
          folder={folderDialog.folder}
          isSubmitting={isFolderDialogSubmitting}
          error={foldersError}
          onClose={() => {
            if (isFolderDialogSubmitting) return;
            setFolderDialog({ open: false, mode: "create", folder: null });
            setFoldersError(null);
          }}
          onSubmit={async (name) => {
            setIsFolderDialogSubmitting(true);
            setFoldersError(null);
            try {
              if (folderDialog.mode === "create") {
                await createFolder(name?.trim() ?? "");
              } else if (folderDialog.mode === "rename") {
                if (!folderDialog.folder) {
                  throw new Error("Folder not found.");
                }
                await renameFolder(folderDialog.folder.id, name?.trim() ?? "");
              } else {
                if (!folderDialog.folder) {
                  throw new Error("Folder not found.");
                }
                await deleteFolder(folderDialog.folder.id);
              }
              setFolderDialog({ open: false, mode: "create", folder: null });
            } catch (err: unknown) {
              const message =
                err instanceof Error && err.message
                  ? err.message
                  : "Couldn't update that folder right now. Please try again.";
              setFoldersError(message);
            } finally {
              setIsFolderDialogSubmitting(false);
            }
          }}
        />
        <MyFurnitureHeader
          onRefresh={() => void refresh()}
          isRefreshing={isLoading}
          onAddItem={() => setIsAddItemOpen(true)}
          tokenBadge={<TokenBalanceBadge />}
        />
        <TokenStatusNotice className="mt-3" showGetMoreTokensCta />
        <MyFurnitureFoldersBar
          folders={folders}
          selectedScope={selectedScope}
          onScopeChange={setSelectedScope}
          onCreateFolder={() => {
            setFoldersError(null);
            setFolderDialog({ open: true, mode: "create", folder: null });
          }}
          onRenameFolder={(folder) => {
            setFoldersError(null);
            setFolderDialog({ open: true, mode: "rename", folder });
          }}
          onDeleteFolder={(folder) => {
            setFoldersError(null);
            setFolderDialog({ open: true, mode: "delete", folder });
          }}
          folderCounts={folderCounts}
          disabled={isLoading}
        />
        {foldersError ? (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-100">
            {foldersError}
          </div>
        ) : null}
        <MyFurnitureToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sort={sort}
          onSortChange={setSort}
          itemCount={filteredItems.length}
          selectionMode={selectionMode}
          selectedCount={selectedCount}
          onToggleSelectionMode={() => {
            setSelectionMode((prev) => {
              const next = !prev;
              if (!next) setSelectedItemIds(new Set());
              return next;
            });
          }}
          onClearSelection={() => setSelectedItemIds(new Set())}
          onBulkMove={() => {
            if (selectedCount === 0) return;
            openMoveDialog([...selectedItemIds], null);
          }}
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
