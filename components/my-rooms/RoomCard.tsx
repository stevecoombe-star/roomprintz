"use client";

import { useEffect, useRef, useState } from "react";
import { MoveToFolderMenu } from "@/components/my-rooms/MoveToFolderMenu";
import type { MyRoomsFolder, MyRoomsRoom } from "@/components/my-rooms/types";
import { formatRoomRecencyLabel } from "@/components/my-rooms/utils";

type RoomCardProps = {
  room: MyRoomsRoom;
  folders: MyRoomsFolder[];
  onOpen: () => void;
  onRename: () => void;
  onMoveToFolder: (folderId: string | null) => Promise<void>;
  onDelete: () => void;
  isBusy: boolean;
};

export function RoomCard({
  room,
  folders,
  onOpen,
  onRename,
  onMoveToFolder,
  onDelete,
  isBusy,
}: RoomCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
      setShowMoveMenu(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const recencyLabel = formatRoomRecencyLabel(room);
  const hasImage = typeof room.display_image_url === "string" && room.display_image_url.length > 0;

  return (
    <article className="group relative overflow-visible rounded-2xl bg-slate-900/50 transition hover:bg-slate-900/65">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left focus:outline-none"
        aria-label={`Open ${room.title}`}
      >
        <div className="overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900">
          <div className="relative aspect-[4/3] w-full bg-slate-900">
            {hasImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={room.display_image_url!}
                  alt={room.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-black/10" />
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 text-xs text-slate-500">
                No preview
              </div>
            )}
          </div>
        </div>

        <div className="px-1 pb-2 pt-2">
          <h3 className="truncate text-sm font-medium text-slate-100">{room.title}</h3>
          <p className="mt-1 text-xs text-slate-400">{recencyLabel}</p>
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {room.folder_name ? `${room.folder_name}` : "No folder"}
            {room.current_stage > 0 || room.selected_model
              ? ` • Stage ${room.current_stage}${room.selected_model ? ` • ${room.selected_model}` : ""}`
              : ""}
          </p>
        </div>
      </button>

      <div ref={menuRef} className="absolute right-2 top-2">
        <button
          type="button"
          onClick={() => {
            setMenuOpen((open) => !open);
            setShowMoveMenu(false);
          }}
          className={
            "rounded-md border border-slate-700/80 bg-slate-950/85 px-2 py-1 text-xs text-slate-300 backdrop-blur transition " +
            (menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")
          }
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Actions for ${room.title}`}
        >
          •••
        </button>

        {menuOpen ? (
          <div className="absolute right-0 z-30 mt-2 w-44 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-xl shadow-slate-950/80">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setShowMoveMenu(false);
                onOpen();
              }}
              className="w-full rounded-md px-2 py-1 text-left text-xs text-slate-200 transition hover:bg-slate-800"
              role="menuitem"
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setShowMoveMenu(false);
                onRename();
              }}
              className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-slate-200 transition hover:bg-slate-800"
              role="menuitem"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => setShowMoveMenu((open) => !open)}
              className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-slate-200 transition hover:bg-slate-800"
              role="menuitem"
            >
              Move to Folder
            </button>
            {showMoveMenu ? (
              <MoveToFolderMenu
                folders={folders}
                currentFolderId={room.folder_id}
                isSaving={isBusy}
                onMove={async (folderId) => {
                  await onMoveToFolder(folderId);
                  setMenuOpen(false);
                  setShowMoveMenu(false);
                }}
              />
            ) : null}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setShowMoveMenu(false);
                onDelete();
              }}
              className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-rose-300 transition hover:bg-rose-500/20"
              role="menuitem"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
