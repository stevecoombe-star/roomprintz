"use client";

import type { MyRoomsFolder, MyRoomsScope } from "@/components/my-rooms/types";

type MyRoomsSidebarProps = {
  selectedScope: MyRoomsScope;
  selectedFolderId: string | null;
  folders: MyRoomsFolder[];
  totalRoomsCount: number;
  onSelectAllRooms: () => void;
  onSelectRecents: () => void;
  onSelectFolder: (folderId: string) => void;
  onCreateFolder: () => void;
};

function navClass(active: boolean) {
  return (
    "w-full rounded-lg px-3 py-2 text-left text-sm transition " +
    (active
      ? "bg-slate-800 text-slate-100"
      : "text-slate-400 hover:bg-slate-900 hover:text-slate-100")
  );
}

export function MyRoomsSidebar({
  selectedScope,
  selectedFolderId,
  folders,
  totalRoomsCount,
  onSelectAllRooms,
  onSelectRecents,
  onSelectFolder,
  onCreateFolder,
}: MyRoomsSidebarProps) {
  return (
    <div className="sticky top-4 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3">
      <div className="mb-3 px-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">Library</div>
      <nav className="space-y-1">
        <button
          type="button"
          onClick={onSelectAllRooms}
          className={navClass(selectedScope === "all")}
          aria-current={selectedScope === "all" ? "page" : undefined}
        >
          <span className="flex items-center justify-between">
            <span>All Rooms</span>
            <span className="text-[11px] text-slate-500">{totalRoomsCount}</span>
          </span>
        </button>

        <button
          type="button"
          onClick={onSelectRecents}
          className={navClass(selectedScope === "recents")}
          aria-current={selectedScope === "recents" ? "page" : undefined}
        >
          Recents
        </button>
      </nav>

      <div className="mt-5 flex items-center justify-between px-2">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Folders</div>
        <button
          type="button"
          onClick={onCreateFolder}
          className="rounded-md px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
          aria-label="Create folder"
        >
          + New
        </button>
      </div>

      <div className="mt-2 space-y-1">
        {folders.length === 0 ? (
          <div className="px-3 py-2 text-xs text-slate-500">No folders yet.</div>
        ) : (
          folders.map((folder) => {
            const active = selectedScope === "folder" && selectedFolderId === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => onSelectFolder(folder.id)}
                className={navClass(active)}
                aria-current={active ? "page" : undefined}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">{folder.name}</span>
                  {typeof folder.room_count === "number" ? (
                    <span className="text-[11px] text-slate-500">{folder.room_count}</span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
