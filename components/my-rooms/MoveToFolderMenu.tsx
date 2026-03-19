"use client";

import type { MyRoomsFolder } from "@/components/my-rooms/types";

type MoveToFolderMenuProps = {
  folders: MyRoomsFolder[];
  currentFolderId: string | null;
  onMove: (folderId: string | null) => Promise<void>;
  isSaving: boolean;
};

export function MoveToFolderMenu({
  folders,
  currentFolderId,
  onMove,
  isSaving,
}: MoveToFolderMenuProps) {
  return (
    <div className="mt-2 space-y-1 rounded-lg border border-slate-800 bg-slate-950/70 p-2">
      <button
        type="button"
        onClick={() => void onMove(null)}
        disabled={isSaving}
        className={
          "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition " +
          (currentFolderId === null
            ? "bg-slate-800 text-slate-100"
            : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100")
        }
      >
        <span>No folder</span>
        {currentFolderId === null ? <span>✓</span> : null}
      </button>

      {folders.length === 0 ? (
        <div className="px-2 py-1 text-[11px] text-slate-500">No folders yet.</div>
      ) : (
        folders.map((folder) => (
          <button
            type="button"
            key={folder.id}
            onClick={() => void onMove(folder.id)}
            disabled={isSaving}
            className={
              "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition " +
              (currentFolderId === folder.id
                ? "bg-slate-800 text-slate-100"
                : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100")
            }
          >
            <span className="truncate">{folder.name}</span>
            {currentFolderId === folder.id ? <span>✓</span> : null}
          </button>
        ))
      )}
    </div>
  );
}
