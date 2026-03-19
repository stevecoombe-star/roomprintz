"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreateFolderDialog } from "@/components/my-rooms/CreateFolderDialog";
import { MyRoomsContextBar } from "@/components/my-rooms/MyRoomsContextBar";
import { MyRoomsGrid } from "@/components/my-rooms/MyRoomsGrid";
import { MyRoomsHeader } from "@/components/my-rooms/MyRoomsHeader";
import { MyRoomsLayout } from "@/components/my-rooms/MyRoomsLayout";
import { MyRoomsSidebar } from "@/components/my-rooms/MyRoomsSidebar";
import type {
  MyRoomsFolder,
  MyRoomsRoom,
  MyRoomsScope,
  MyRoomsSortMode,
} from "@/components/my-rooms/types";
import { scopeLabel, sortRooms } from "@/components/my-rooms/utils";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";

type FolderRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type RoomRow = {
  id: string;
  title: string | null;
  folder_id: string | null;
  current_stage: number | null;
  selected_model: string | null;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  sort_key: string | null;
  status: string | null;
  source_type: string | null;
};

type ActiveAssetRow = {
  room_id: string;
  image_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  created_at: string | null;
};

const ROOM_SELECT =
  "id,title,folder_id,current_stage,selected_model,cover_image_url,created_at,updated_at,last_opened_at,sort_key,status,source_type";

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function folderQueryMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybe = err as { code?: unknown; message?: unknown };
  if (maybe.code === "42P01") return true;
  if (typeof maybe.message === "string" && maybe.message.toLowerCase().includes("does not exist")) {
    return true;
  }
  return false;
}

function likelyUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybe = err as { code?: unknown; message?: unknown; details?: unknown };
  if (maybe.code === "23505") return true;
  const msg = `${typeof maybe.message === "string" ? maybe.message : ""} ${
    typeof maybe.details === "string" ? maybe.details : ""
  }`.toLowerCase();
  return msg.includes("duplicate") || msg.includes("unique");
}

export function MyRoomsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useSupabaseUser();
  const [toast, setToast] = useState<{ message: string; type: "error" | "info" } | null>(null);

  const [rooms, setRooms] = useState<MyRoomsRoom[]>([]);
  const [folders, setFolders] = useState<MyRoomsFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [folderFeatureReady, setFolderFeatureReady] = useState(true);

  const [selectedScope, setSelectedScope] = useState<MyRoomsScope>("all");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<MyRoomsSortMode>("most_recent");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const [renameRoom, setRenameRoom] = useState<MyRoomsRoom | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenamingRoom, setIsRenamingRoom] = useState(false);

  const [mutatingRoomId, setMutatingRoomId] = useState<string | null>(null);

  const showToast = useCallback((message: string, type: "error" | "info" = "info") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRooms([]);
      setFolders([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const [roomsRes, foldersRes] = await Promise.all([
          supabase.from("vibode_rooms").select(ROOM_SELECT).order("sort_key", { ascending: false }),
          supabase.from("vibode_room_folders").select("id,name,created_at,updated_at").order("name"),
        ]);

        if (roomsRes.error) {
          throw roomsRes.error;
        }

        const roomRows = (roomsRes.data ?? []) as RoomRow[];
        let folderRows: FolderRow[] = [];
        if (foldersRes.error) {
          if (folderQueryMissing(foldersRes.error)) {
            setFolderFeatureReady(false);
          } else {
            throw foldersRes.error;
          }
        } else {
          setFolderFeatureReady(true);
          folderRows = (foldersRes.data ?? []) as FolderRow[];
        }

        const roomIds = roomRows.map((room) => room.id);
        let activeAssets: ActiveAssetRow[] = [];
        if (roomIds.length > 0) {
          const assetsRes = await supabase
            .from("vibode_room_assets")
            .select("room_id,image_url,storage_bucket,storage_path,created_at")
            .in("room_id", roomIds)
            .eq("is_active", true);
          if (!assetsRes.error) {
            activeAssets = (assetsRes.data ?? []) as ActiveAssetRow[];
          }
        }

        const latestAssetByRoom = new Map<string, ActiveAssetRow>();
        for (const asset of activeAssets) {
          const existing = latestAssetByRoom.get(asset.room_id);
          const existingStamp = existing?.created_at ? new Date(existing.created_at).getTime() : 0;
          const candidateStamp = asset.created_at ? new Date(asset.created_at).getTime() : 0;
          if (!existing || candidateStamp >= existingStamp) {
            latestAssetByRoom.set(asset.room_id, asset);
          }
        }

        const signedFallbacks = new Map<string, string | null>();
        await Promise.all(
          roomRows.map(async (room) => {
            const directCover = normalizeText(room.cover_image_url);
            if (directCover) {
              signedFallbacks.set(room.id, directCover);
              return;
            }

            const asset = latestAssetByRoom.get(room.id);
            if (!asset) {
              signedFallbacks.set(room.id, null);
              return;
            }

            const directAssetUrl = normalizeText(asset.image_url);
            if (directAssetUrl) {
              signedFallbacks.set(room.id, directAssetUrl);
              return;
            }

            const bucket = normalizeText(asset.storage_bucket);
            const path = normalizeText(asset.storage_path);
            if (!bucket || !path) {
              signedFallbacks.set(room.id, null);
              return;
            }

            const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 8);
            signedFallbacks.set(room.id, data?.signedUrl ?? null);
          })
        );

        const folderMap = new Map<string, FolderRow>();
        for (const folder of folderRows) {
          folderMap.set(folder.id, folder);
        }

        const mappedRooms: MyRoomsRoom[] = roomRows.map((room) => ({
          id: room.id,
          title: normalizeText(room.title) || "Untitled Room",
          folder_id: room.folder_id,
          folder_name: room.folder_id ? folderMap.get(room.folder_id)?.name ?? null : null,
          current_stage: room.current_stage ?? 0,
          selected_model: room.selected_model,
          cover_image_url: room.cover_image_url,
          display_image_url: signedFallbacks.get(room.id) ?? null,
          created_at: room.created_at,
          updated_at: room.updated_at,
          last_opened_at: room.last_opened_at,
          sort_key: normalizeText(room.sort_key) || room.updated_at || room.created_at,
          status: room.status,
          source_type: room.source_type,
        }));

        const roomCountByFolder = new Map<string, number>();
        for (const room of mappedRooms) {
          if (!room.folder_id) continue;
          roomCountByFolder.set(room.folder_id, (roomCountByFolder.get(room.folder_id) ?? 0) + 1);
        }

        const mappedFolders: MyRoomsFolder[] = folderRows.map((folder) => ({
          id: folder.id,
          name: folder.name,
          created_at: folder.created_at,
          updated_at: folder.updated_at,
          room_count: roomCountByFolder.get(folder.id) ?? 0,
        }));

        if (cancelled) return;
        setRooms(mappedRooms);
        setFolders(mappedFolders);
      } catch (err) {
        console.error("[MyRooms] load error:", err);
        if (!cancelled) {
          setLoadError("Failed to load rooms. Please refresh and try again.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  useEffect(() => {
    if (selectedScope !== "folder") return;
    if (!selectedFolderId) return;
    const exists = folders.some((folder) => folder.id === selectedFolderId);
    if (!exists) {
      setSelectedScope("all");
      setSelectedFolderId(null);
    }
  }, [folders, selectedFolderId, selectedScope]);

  const foldersWithCounts = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const room of rooms) {
      if (!room.folder_id) continue;
      countMap.set(room.folder_id, (countMap.get(room.folder_id) ?? 0) + 1);
    }
    return folders.map((folder) => ({
      ...folder,
      room_count: countMap.get(folder.id) ?? 0,
    }));
  }, [folders, rooms]);

  const scopedRooms = useMemo(() => {
    if (selectedScope === "folder") {
      if (!selectedFolderId) return [];
      return rooms.filter((room) => room.folder_id === selectedFolderId);
    }
    return rooms;
  }, [rooms, selectedFolderId, selectedScope]);

  const visibleRooms = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const effectiveSortMode: MyRoomsSortMode =
      selectedScope === "recents" ? "most_recent" : sortMode;
    const filtered = query
      ? scopedRooms.filter((room) => {
          const roomTitle = room.title.toLowerCase();
          const folderName = (room.folder_name ?? "").toLowerCase();
          return roomTitle.includes(query) || folderName.includes(query);
        })
      : scopedRooms;
    return sortRooms(filtered, effectiveSortMode);
  }, [scopedRooms, searchQuery, selectedScope, sortMode]);

  const selectedFolderName = useMemo(() => {
    if (!selectedFolderId) return null;
    return folders.find((folder) => folder.id === selectedFolderId)?.name ?? null;
  }, [folders, selectedFolderId]);

  const contextLabel = scopeLabel({
    selectedScope,
    selectedFolderName,
    searchQuery,
  });

  const emptyState = useMemo(() => {
    if (loadError) {
      return {
        title: "Could not load rooms",
        description: loadError,
      };
    }
    if (isLoading) return null;
    if (rooms.length === 0) {
      return {
        title: "No rooms yet",
        description: "Create your first room in the editor, then come back here to browse and resume.",
        actionLabel: "Open editor",
        onAction: () => router.push("/editor"),
      };
    }
    if (searchQuery.trim().length > 0 && visibleRooms.length === 0) {
      return {
        title: "No matching rooms",
        description: "Try a different search term or clear your filters.",
      };
    }
    if (selectedScope === "folder" && scopedRooms.length === 0) {
      return {
        title: "This folder is empty",
        description: "Move rooms into this folder from each card menu.",
      };
    }
    if (visibleRooms.length === 0) {
      return {
        title: "Nothing to show",
        description: "Adjust filters and try again.",
      };
    }
    return null;
  }, [isLoading, loadError, rooms.length, router, scopedRooms.length, searchQuery, selectedScope, visibleRooms.length]);

  const selectAllRooms = () => {
    setSelectedScope("all");
    setSelectedFolderId(null);
  };

  const selectRecents = () => {
    setSelectedScope("recents");
    setSelectedFolderId(null);
    setSortMode("most_recent");
  };

  const selectFolder = (folderId: string) => {
    setSelectedScope("folder");
    setSelectedFolderId(folderId);
  };

  const handleCreateFolder = async (name: string) => {
    if (!user) return;
    setCreateError(null);
    setIsCreatingFolder(true);
    try {
      const { data, error } = await supabase
        .from("vibode_room_folders")
        .insert({ user_id: user.id, name })
        .select("id,name,created_at,updated_at")
        .single();
      if (error || !data) {
        if (likelyUniqueViolation(error)) {
          setCreateError("A folder with that name already exists.");
          return;
        }
        throw error ?? new Error("Failed to create folder.");
      }
      setFolders((prev) =>
        [...prev, data as FolderRow]
          .map((folder) => ({
            id: folder.id,
            name: folder.name,
            created_at: folder.created_at,
            updated_at: folder.updated_at,
            room_count: 0,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setCreateDialogOpen(false);
    } catch (err) {
      console.error("[MyRooms] create folder error:", err);
      setCreateError("Could not create folder right now.");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleOpenRoom = async (room: MyRoomsRoom) => {
    const nowIso = new Date().toISOString();
    setMutatingRoomId(room.id);
    setRooms((prev) =>
      prev.map((candidate) =>
        candidate.id === room.id
          ? { ...candidate, last_opened_at: nowIso, sort_key: nowIso }
          : candidate
      )
    );

    try {
      await supabase
        .from("vibode_rooms")
        .update({ last_opened_at: nowIso, sort_key: nowIso })
        .eq("id", room.id);
    } catch (err) {
      console.error("[MyRooms] open recency update failed:", err);
    } finally {
      setMutatingRoomId(null);
      router.push(`/editor?roomId=${encodeURIComponent(room.id)}`);
    }
  };

  const handleRenameStart = (room: MyRoomsRoom) => {
    setRenameRoom(room);
    setRenameValue(room.title);
    setRenameError(null);
  };

  const handleRenameSave = async () => {
    if (!renameRoom) return;
    const nextTitle = renameValue.trim();
    const nowIso = new Date().toISOString();
    if (!nextTitle) {
      setRenameError("Title cannot be empty.");
      return;
    }
    setRenameError(null);
    setIsRenamingRoom(true);
    setMutatingRoomId(renameRoom.id);
    try {
      const { error } = await supabase
        .from("vibode_rooms")
        .update({ title: nextTitle, sort_key: nowIso })
        .eq("id", renameRoom.id);
      if (error) throw error;
      setRooms((prev) =>
        prev.map((room) =>
          room.id === renameRoom.id ? { ...room, title: nextTitle, sort_key: nowIso } : room
        )
      );
      setRenameRoom(null);
      setRenameValue("");
    } catch (err) {
      console.error("[MyRooms] rename failed:", err);
      setRenameError("Could not rename this room.");
    } finally {
      setIsRenamingRoom(false);
      setMutatingRoomId(null);
    }
  };

  const handleMoveRoom = async (room: MyRoomsRoom, folderId: string | null) => {
    if (!folderFeatureReady) return;
    setMutatingRoomId(room.id);
    try {
      const { error } = await supabase
        .from("vibode_rooms")
        .update({ folder_id: folderId })
        .eq("id", room.id);
      if (error) throw error;

      const folderName = folderId ? folders.find((folder) => folder.id === folderId)?.name ?? null : null;
      setRooms((prev) =>
        prev.map((candidate) =>
          candidate.id === room.id ? { ...candidate, folder_id: folderId, folder_name: folderName } : candidate
        )
      );
    } catch (err) {
      console.error("[MyRooms] move room failed:", err);
      showToast("Could not move this room right now.", "error");
    } finally {
      setMutatingRoomId(null);
    }
  };

  const handleDeleteRoom = async (room: MyRoomsRoom) => {
    const confirmed = window.confirm(
      `Delete "${room.title}"?\n\nThis removes the room and its generated history.`
    );
    if (!confirmed) return;

    setMutatingRoomId(room.id);
    try {
      // Deletion relies on DB-level FK cascade from room-linked Vibode tables.
      const { error } = await supabase.from("vibode_rooms").delete().eq("id", room.id);
      if (error) throw error;
      setRooms((prev) => prev.filter((candidate) => candidate.id !== room.id));
    } catch (err) {
      console.error("[MyRooms] delete failed:", err);
      showToast("Could not delete this room.", "error");
    } finally {
      setMutatingRoomId(null);
    }
  };

  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <div className="text-sm text-slate-400">Checking session...</div>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="text-2xl font-semibold">My Rooms</h1>
          <p className="mt-2 text-sm text-slate-400">Please sign in to view your saved rooms.</p>
          <Link
            href="/login?next=/my-rooms"
            className="mt-6 inline-flex rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Go to Login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <MyRoomsLayout
        sidebar={
          <MyRoomsSidebar
            selectedScope={selectedScope}
            selectedFolderId={selectedFolderId}
            folders={foldersWithCounts}
            totalRoomsCount={rooms.length}
            onSelectAllRooms={selectAllRooms}
            onSelectRecents={selectRecents}
            onSelectFolder={selectFolder}
            onCreateFolder={() => {
              if (!folderFeatureReady) return;
              setCreateDialogOpen(true);
            }}
          />
        }
        header={
          <MyRoomsHeader
            searchQuery={searchQuery}
            sortMode={sortMode}
            onSearchChange={setSearchQuery}
            onSortChange={setSortMode}
            onCreateFolder={() => {
              if (!folderFeatureReady) return;
              setCreateDialogOpen(true);
            }}
          />
        }
        contextBar={<MyRoomsContextBar label={contextLabel} count={visibleRooms.length} />}
        grid={
          <>
            {!folderFeatureReady ? (
              <div className="mt-3 rounded-xl border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Folder schema is unavailable. Run the latest Supabase migration to enable folders.
              </div>
            ) : null}

            <div className="mt-3 flex gap-2 lg:hidden">
              <button
                type="button"
                onClick={selectAllRooms}
                className={
                  "rounded-lg px-3 py-1.5 text-xs transition " +
                  (selectedScope === "all" ? "bg-slate-800 text-slate-100" : "bg-slate-900 text-slate-400")
                }
              >
                All Rooms
              </button>
              <button
                type="button"
                onClick={selectRecents}
                className={
                  "rounded-lg px-3 py-1.5 text-xs transition " +
                  (selectedScope === "recents"
                    ? "bg-slate-800 text-slate-100"
                    : "bg-slate-900 text-slate-400")
                }
              >
                Recents
              </button>
            </div>

            <MyRoomsGrid
              rooms={visibleRooms}
              folders={foldersWithCounts}
              isLoading={isLoading}
              emptyState={emptyState}
              mutatingRoomId={mutatingRoomId}
              onOpenRoom={(room) => {
                void handleOpenRoom(room);
              }}
              onRenameRoom={handleRenameStart}
              onMoveRoom={handleMoveRoom}
              onDeleteRoom={(room) => {
                void handleDeleteRoom(room);
              }}
            />
          </>
        }
      />

      <CreateFolderDialog
        key={createDialogOpen ? "create-folder-open" : "create-folder-closed"}
        open={createDialogOpen}
        onClose={() => {
          if (isCreatingFolder) return;
          setCreateDialogOpen(false);
          setCreateError(null);
        }}
        onCreate={handleCreateFolder}
        isSaving={isCreatingFolder}
        errorMessage={createError}
      />

      {renameRoom ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-room-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/80">
            <h2 id="rename-room-title" className="text-sm font-semibold text-slate-100">
              Rename room
            </h2>
            <label className="mt-3 block text-[11px] text-slate-400">Room title</label>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={120}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-400"
            />
            {renameError ? <div className="mt-2 text-xs text-rose-300">{renameError}</div> : null}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isRenamingRoom) return;
                  setRenameRoom(null);
                  setRenameError(null);
                }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
                disabled={isRenamingRoom}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleRenameSave();
                }}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
                disabled={isRenamingRoom || renameValue.trim().length === 0}
              >
                {isRenamingRoom ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50">
          <div
            className={
              "max-w-sm rounded-xl border px-4 py-3 text-xs shadow-lg " +
              (toast.type === "error"
                ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                : "border-slate-700 bg-slate-900 text-slate-100")
            }
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 leading-relaxed">{toast.message}</div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-slate-300 hover:text-slate-50"
                aria-label="Dismiss"
              >
                x
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
