"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreateFolderDialog } from "@/components/my-rooms/CreateFolderDialog";
import { MyRoomsContextBar } from "@/components/my-rooms/MyRoomsContextBar";
import { MyRoomsGrid } from "@/components/my-rooms/MyRoomsGrid";
import { MyRoomsHeader } from "@/components/my-rooms/MyRoomsHeader";
import { MyRoomsLayout } from "@/components/my-rooms/MyRoomsLayout";
import { MyRoomsSidebar } from "@/components/my-rooms/MyRoomsSidebar";
import { TokenBalanceBadge } from "@/components/tokens/TokenBalanceBadge";
import { TokenStatusNotice } from "@/components/tokens/TokenStatusNotice";
import type {
  MyRoomsFolder,
  MyRoomsRoom,
  MyRoomsScope,
  MyRoomsSortMode,
} from "@/components/my-rooms/types";
import { scopeLabel, sortRooms } from "@/components/my-rooms/utils";
import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";
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

const ROOM_SELECT =
  "id,title,folder_id,current_stage,selected_model,cover_image_url,created_at,updated_at,last_opened_at,sort_key,status,source_type";

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

async function tryGetSupabaseAccessToken(): Promise<string | null> {
  try {
    return await getSupabaseBrowserAccessToken();
  } catch (err) {
    console.warn("[MyRooms] failed to get Supabase access token:", err);
    return null;
  }
}

async function fetchPreviewUrlForRoom(
  roomId: string,
  accessToken: string | null,
  options?: { preferThumbnail?: boolean }
): Promise<string | null> {
  if (!accessToken) return null;

  try {
    const res = await fetch("/api/vibode/room-preview-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        roomId,
        preferThumbnail: options?.preferThumbnail === true,
      }),
    });
    if (!res.ok) return null;

    const payload = (await res.json()) as { previewUrl?: unknown };
    return typeof payload.previewUrl === "string" && payload.previewUrl.trim().length > 0
      ? payload.previewUrl
      : null;
  } catch (err) {
    console.warn("[MyRooms] failed to resolve preview URL:", err);
    return null;
  }
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
  const [deleteRoom, setDeleteRoom] = useState<MyRoomsRoom | null>(null);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);

  const [renameFolder, setRenameFolder] = useState<MyRoomsFolder | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");
  const [renameFolderError, setRenameFolderError] = useState<string | null>(null);
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);

  const [deleteFolder, setDeleteFolder] = useState<MyRoomsFolder | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);

  const [mutatingRoomId, setMutatingRoomId] = useState<string | null>(null);
  const [mutatingFolderId, setMutatingFolderId] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = useCallback((message: string, type: "error" | "info" = "info") => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
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

        const previewByRoom = new Map<string, string | null>();
        if (roomRows.length > 0) {
          const accessToken = await tryGetSupabaseAccessToken();
          await Promise.all(
            roomRows.map(async (room) => {
              const previewUrl = await fetchPreviewUrlForRoom(room.id, accessToken, {
                preferThumbnail: true,
              });
              previewByRoom.set(room.id, previewUrl);
            })
          );
        }

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
          display_image_url: previewByRoom.get(room.id) ?? null,
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
          setLoadError("We couldn't load your rooms right now. Please refresh and try again.");
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

  const selectedFolder = useMemo(() => {
    if (!selectedFolderId) return null;
    return folders.find((folder) => folder.id === selectedFolderId) ?? null;
  }, [folders, selectedFolderId]);

  const contextLabel = scopeLabel({
    selectedScope,
    selectedFolderName: selectedFolder?.name ?? null,
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
        description: "Saved rooms will appear here. Open the editor to create your first room.",
        actionLabel: "Open Editor",
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
        description: "Move rooms into this folder from each room menu.",
      };
    }
    if (visibleRooms.length === 0) {
      return {
        title: "Nothing here yet",
        description: "Try another view or clear the current search.",
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
      setCreateError(null);
      showToast("Folder created.");
    } catch (err) {
      console.error("[MyRooms] create folder error:", err);
      setCreateError("Could not create folder right now.");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleOpenRoom = async (room: MyRoomsRoom) => {
    const existingPreviewFallbackUrl =
      typeof room.cover_image_url === "string" && room.cover_image_url.trim().length > 0
        ? room.cover_image_url.trim()
        : typeof room.display_image_url === "string" && room.display_image_url.trim().length > 0
          ? room.display_image_url.trim()
          : null;
    let roomOpenPreviewUrl = existingPreviewFallbackUrl;
    try {
      const accessToken = await tryGetSupabaseAccessToken();
      const activeImagePreviewUrl = await fetchPreviewUrlForRoom(room.id, accessToken, {
        preferThumbnail: false,
      });
      roomOpenPreviewUrl = activeImagePreviewUrl ?? existingPreviewFallbackUrl;
    } catch (err) {
      console.warn("[MyRooms] room-open preview fallback:", err);
      roomOpenPreviewUrl = existingPreviewFallbackUrl;
    }
    const params = new URLSearchParams({
      roomId: room.id,
    });
    if (roomOpenPreviewUrl) {
      params.set("roomPreview", roomOpenPreviewUrl);
    }
    router.push(`/editor?${params.toString()}`);
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
      showToast("Room renamed.");
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
    if (room.folder_id === folderId) return;
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
      showToast(folderName ? `Moved to "${folderName}".` : "Removed from folder.");
    } catch (err) {
      console.error("[MyRooms] move room failed:", err);
      showToast("Could not move this room right now.", "error");
    } finally {
      setMutatingRoomId(null);
    }
  };

  const handleDeleteRoomConfirm = async () => {
    if (!deleteRoom) return;
    setIsDeletingRoom(true);
    setMutatingRoomId(deleteRoom.id);
    try {
      // Deletion relies on DB-level FK cascade from room-linked Vibode tables.
      const { error } = await supabase.from("vibode_rooms").delete().eq("id", deleteRoom.id);
      if (error) throw error;
      setRooms((prev) => prev.filter((candidate) => candidate.id !== deleteRoom.id));
      setDeleteRoom(null);
      showToast("Room deleted.");
    } catch (err) {
      console.error("[MyRooms] delete failed:", err);
      showToast("Could not delete this room.", "error");
    } finally {
      setIsDeletingRoom(false);
      setMutatingRoomId(null);
    }
  };

  const handleRenameFolderStart = (folder: MyRoomsFolder) => {
    setRenameFolder(folder);
    setRenameFolderValue(folder.name);
    setRenameFolderError(null);
  };

  const handleRenameFolderSave = async () => {
    if (!renameFolder) return;
    const nextName = renameFolderValue.trim();
    if (!nextName) {
      setRenameFolderError("Folder name cannot be empty.");
      return;
    }
    if (nextName === renameFolder.name) {
      setRenameFolder(null);
      return;
    }

    setRenameFolderError(null);
    setIsRenamingFolder(true);
    setMutatingFolderId(renameFolder.id);
    try {
      const { data, error } = await supabase
        .from("vibode_room_folders")
        .update({ name: nextName })
        .eq("id", renameFolder.id)
        .select("id,name,created_at,updated_at")
        .single();

      if (error || !data) {
        if (likelyUniqueViolation(error)) {
          setRenameFolderError("A folder with that name already exists.");
          return;
        }
        throw error ?? new Error("Failed to rename folder.");
      }

      const updatedFolder = data as FolderRow;
      setFolders((prev) =>
        prev
          .map((folder) => (folder.id === updatedFolder.id ? { ...folder, name: updatedFolder.name } : folder))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setRooms((prev) =>
        prev.map((room) =>
          room.folder_id === updatedFolder.id ? { ...room, folder_name: updatedFolder.name } : room
        )
      );
      setRenameFolder(null);
      setRenameFolderValue("");
      showToast("Folder renamed.");
    } catch (err) {
      console.error("[MyRooms] rename folder failed:", err);
      setRenameFolderError("Could not rename this folder.");
    } finally {
      setIsRenamingFolder(false);
      setMutatingFolderId(null);
    }
  };

  const handleDeleteFolderConfirm = async () => {
    if (!deleteFolder) return;
    setIsDeletingFolder(true);
    setMutatingFolderId(deleteFolder.id);
    try {
      const deletingFolderId = deleteFolder.id;
      const { error } = await supabase.from("vibode_room_folders").delete().eq("id", deletingFolderId);
      if (error) throw error;

      setFolders((prev) => prev.filter((folder) => folder.id !== deletingFolderId));
      setRooms((prev) =>
        prev.map((room) =>
          room.folder_id === deletingFolderId ? { ...room, folder_id: null, folder_name: null } : room
        )
      );
      if (selectedFolderId === deletingFolderId) {
        setSelectedScope("all");
        setSelectedFolderId(null);
      }
      setDeleteFolder(null);
      showToast("Folder deleted. Rooms moved to All Rooms.");
    } catch (err) {
      console.error("[MyRooms] delete folder failed:", err);
      showToast("Could not delete this folder.", "error");
    } finally {
      setIsDeletingFolder(false);
      setMutatingFolderId(null);
    }
  };

  const mobileScopeValue =
    selectedScope === "folder" && selectedFolderId ? `folder:${selectedFolderId}` : selectedScope;
  const deleteFolderRoomCount = useMemo(() => {
    if (!deleteFolder) return 0;
    return rooms.filter((room) => room.folder_id === deleteFolder.id).length;
  }, [deleteFolder, rooms]);

  if (authLoading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <div className="text-sm text-slate-400">Checking your session...</div>
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
            Go to Sign In
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
            folderFeatureReady={folderFeatureReady}
            mutatingFolderId={mutatingFolderId}
            onSelectAllRooms={selectAllRooms}
            onSelectRecents={selectRecents}
            onSelectFolder={selectFolder}
            onCreateFolder={() => {
              if (!folderFeatureReady) return;
              setCreateDialogOpen(true);
            }}
            onRenameFolder={handleRenameFolderStart}
            onDeleteFolder={(folder) => setDeleteFolder(folder)}
          />
        }
        header={
          <MyRoomsHeader
            searchQuery={searchQuery}
            sortMode={sortMode}
            folderFeatureReady={folderFeatureReady}
            onSearchChange={setSearchQuery}
            onSortChange={setSortMode}
            onUploadNewPhoto={() => {
              router.push("/editor");
            }}
            onCreateFolder={() => {
              if (!folderFeatureReady) return;
              setCreateDialogOpen(true);
            }}
            tokenBadge={<TokenBalanceBadge />}
          />
        }
        contextBar={<MyRoomsContextBar label={contextLabel} count={visibleRooms.length} />}
        grid={
          <>
            <TokenStatusNotice className="mt-3" showGetMoreTokensCta />
            {!folderFeatureReady ? (
              <div className="mt-3 rounded-xl border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Folders are temporarily unavailable. You can still use All Rooms and Recents.
              </div>
            ) : null}

            <div className="mt-3 space-y-2 lg:hidden">
              <div>
                <label htmlFor="my-rooms-mobile-scope" className="sr-only">
                  Browse scope
                </label>
                <select
                  id="my-rooms-mobile-scope"
                  value={mobileScopeValue}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    if (nextValue === "all") {
                      selectAllRooms();
                      return;
                    }
                    if (nextValue === "recents") {
                      selectRecents();
                      return;
                    }
                    if (nextValue.startsWith("folder:")) {
                      const folderId = nextValue.slice("folder:".length);
                      if (folderId) {
                        selectFolder(folderId);
                      }
                    }
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-slate-500"
                >
                  <option value="all">All Rooms</option>
                  <option value="recents">Recents</option>
                  {folderFeatureReady && foldersWithCounts.length > 0 ? (
                    <optgroup label="Folders">
                      {foldersWithCounts.map((folder) => (
                        <option key={folder.id} value={`folder:${folder.id}`}>
                          {folder.name} ({folder.room_count ?? 0})
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>
              {selectedScope === "folder" && selectedFolder ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRenameFolderStart(selectedFolder)}
                    disabled={isRenamingFolder || isDeletingFolder}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
                  >
                    Rename Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteFolder(selectedFolder)}
                    disabled={isRenamingFolder || isDeletingFolder}
                    className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs text-rose-200 transition hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    Delete Folder
                  </button>
                </div>
              ) : null}
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
                setDeleteRoom(room);
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
                  setRenameValue("");
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

      {renameFolder ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-folder-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/80">
            <h2 id="rename-folder-title" className="text-sm font-semibold text-slate-100">
              Rename folder
            </h2>
            <label className="mt-3 block text-[11px] text-slate-400">Folder name</label>
            <input
              autoFocus
              value={renameFolderValue}
              onChange={(event) => setRenameFolderValue(event.target.value)}
              maxLength={120}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-400"
            />
            {renameFolderError ? <div className="mt-2 text-xs text-rose-300">{renameFolderError}</div> : null}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isRenamingFolder) return;
                  setRenameFolder(null);
                  setRenameFolderValue("");
                  setRenameFolderError(null);
                }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
                disabled={isRenamingFolder}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleRenameFolderSave();
                }}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
                disabled={isRenamingFolder || renameFolderValue.trim().length === 0}
              >
                {isRenamingFolder ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteRoom ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-room-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/80">
            <h2 id="delete-room-title" className="text-sm font-semibold text-slate-100">
              Delete room
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              Delete "{deleteRoom.title}"? This removes the room and its generated history.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isDeletingRoom) return;
                  setDeleteRoom(null);
                }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
                disabled={isDeletingRoom}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteRoomConfirm();
                }}
                className="rounded-lg bg-rose-500/90 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
                disabled={isDeletingRoom}
              >
                {isDeletingRoom ? "Deleting..." : "Delete room"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteFolder ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-folder-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/80">
            <h2 id="delete-folder-title" className="text-sm font-semibold text-slate-100">
              Delete folder
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              Delete "{deleteFolder.name}"? {deleteFolderRoomCount}{" "}
              {deleteFolderRoomCount === 1 ? "room will" : "rooms will"} stay in your library and be moved to
              "No folder."
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isDeletingFolder) return;
                  setDeleteFolder(null);
                }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
                disabled={isDeletingFolder}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteFolderConfirm();
                }}
                className="rounded-lg bg-rose-500/90 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
                disabled={isDeletingFolder}
              >
                {isDeletingFolder ? "Deleting..." : "Delete folder"}
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
                onClick={() => {
                  if (toastTimeoutRef.current !== null) {
                    window.clearTimeout(toastTimeoutRef.current);
                    toastTimeoutRef.current = null;
                  }
                  setToast(null);
                }}
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
