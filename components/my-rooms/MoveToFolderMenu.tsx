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
    <div className="mt-2 space-y-1 rounded-lg border border-line bg-canvas-warm p-2">
      <button
        type="button"
        onClick={() => void onMove(null)}
        disabled={isSaving}
        className={
          "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition " +
          (currentFolderId === null
            ? "bg-tool text-tool-ink underline decoration-2 underline-offset-[3px]"
            : "text-ink-secondary hover:bg-quiet-hover")
        }
      >
        <span>No folder</span>
        {currentFolderId === null ? <span>✓</span> : null}
      </button>

      {folders.length === 0 ? (
        <div className="px-2 py-1 text-[11px] text-ink-secondary">No folders yet.</div>
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
                ? "bg-tool text-tool-ink underline decoration-2 underline-offset-[3px]"
                : "text-ink-secondary hover:bg-quiet-hover")
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
