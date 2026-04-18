"use client";

import { useEffect, useMemo, useState } from "react";
import type { MyFurnitureFolder } from "@/components/my-furniture/MyFurnitureFoldersBar";

type MyFurnitureMoveToFolderDialogProps = {
  isOpen: boolean;
  folders: MyFurnitureFolder[];
  itemCount: number;
  initialFolderId?: string | null;
  isSubmitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (nextFolderId: string | null) => Promise<void> | void;
  onCreateFolder?: (name: string) => Promise<MyFurnitureFolder | null>;
};

export function MyFurnitureMoveToFolderDialog({
  isOpen,
  folders,
  itemCount,
  initialFolderId = null,
  isSubmitting = false,
  error = null,
  onClose,
  onSubmit,
  onCreateFolder,
}: MyFurnitureMoveToFolderDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedFolderId(initialFolderId ?? "");
    setNewFolderName("");
    setCreateError(null);
    setIsCreatingFolder(false);
  }, [initialFolderId, isOpen]);

  const canCreateFolder = Boolean(onCreateFolder);
  const moveLabel = useMemo(
    () => (itemCount === 1 ? "Move Item" : `Move ${itemCount} Items`),
    [itemCount]
  );

  if (!isOpen) return null;

  async function handleCreateFolderInline() {
    if (!onCreateFolder) return;
    const name = newFolderName.trim();
    if (!name) {
      setCreateError("Enter a folder name.");
      return;
    }
    setIsCreatingFolder(true);
    setCreateError(null);
    try {
      const created = await onCreateFolder(name);
      if (!created) {
        throw new Error("Could not create folder.");
      }
      setSelectedFolderId(created.id);
      setNewFolderName("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not create folder.";
      setCreateError(message);
    } finally {
      setIsCreatingFolder(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting && !isCreatingFolder) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Move to Folder"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-100">Move to Folder</h2>
        <p className="mt-1 text-xs text-slate-400">{moveLabel}</p>

        <label className="mt-4 block text-xs text-slate-400" htmlFor="move-folder-select">
          Target folder
        </label>
        <select
          id="move-folder-select"
          value={selectedFolderId}
          disabled={isSubmitting || isCreatingFolder}
          onChange={(event) => setSelectedFolderId(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500 disabled:opacity-50"
        >
          <option value="">Unfiled</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>

        {canCreateFolder ? (
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <p className="text-xs text-slate-400">Create folder</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                disabled={isSubmitting || isCreatingFolder}
                placeholder="Folder name"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-slate-500 disabled:opacity-50"
              />
              <button
                type="button"
                disabled={isSubmitting || isCreatingFolder}
                onClick={() => void handleCreateFolderInline()}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
              >
                {isCreatingFolder ? "Creating..." : "Create"}
              </button>
            </div>
            {createError ? <p className="mt-2 text-xs text-rose-300">{createError}</p> : null}
          </div>
        ) : null}

        {error ? <p className="mt-3 text-xs text-rose-300">{error}</p> : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={isSubmitting || isCreatingFolder}
            onClick={() => void onSubmit(selectedFolderId || null)}
            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
          >
            {isSubmitting ? "Moving..." : "Move"}
          </button>
          <button
            type="button"
            disabled={isSubmitting || isCreatingFolder}
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
