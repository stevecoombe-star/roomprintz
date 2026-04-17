"use client";

import { useEffect, useMemo, useState } from "react";
import type { MyFurnitureFolder } from "@/components/my-furniture/MyFurnitureFoldersBar";

type FolderCrudMode = "create" | "rename" | "delete";

type MyFurnitureFolderCrudDialogProps = {
  isOpen: boolean;
  mode: FolderCrudMode;
  folder: MyFurnitureFolder | null;
  isSubmitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (name: string | null) => Promise<void> | void;
};

export function MyFurnitureFolderCrudDialog({
  isOpen,
  mode,
  folder,
  isSubmitting = false,
  error = null,
  onClose,
  onSubmit,
}: MyFurnitureFolderCrudDialogProps) {
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(mode === "rename" ? folder?.name ?? "" : "");
    setLocalError(null);
  }, [folder?.name, isOpen, mode]);

  const title = useMemo(() => {
    if (mode === "create") return "New Folder";
    if (mode === "rename") return "Rename Folder";
    return "Delete Folder";
  }, [mode]);

  const submitLabel = useMemo(() => {
    if (isSubmitting) {
      if (mode === "create") return "Creating...";
      if (mode === "rename") return "Saving...";
      return "Deleting...";
    }
    if (mode === "create") return "Create Folder";
    if (mode === "rename") return "Save Name";
    return "Delete Folder";
  }, [isSubmitting, mode]);

  if (!isOpen) return null;

  async function handleSubmit() {
    setLocalError(null);
    if (mode === "create" || mode === "rename") {
      const nextName = name.trim();
      if (!nextName) {
        setLocalError("Enter a folder name.");
        return;
      }
      if (mode === "rename" && folder && nextName === folder.name) {
        onClose();
        return;
      }
      await onSubmit(nextName);
      return;
    }
    await onSubmit(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-100">{title}</h2>

        {mode === "delete" ? (
          <p className="mt-2 text-xs text-slate-400">
            Delete "{folder?.name ?? "this folder"}"? Any items in it will be moved to Unfiled.
          </p>
        ) : (
          <div className="mt-3">
            <label className="block text-xs text-slate-400" htmlFor="my-furniture-folder-name">
              Folder name
            </label>
            <input
              id="my-furniture-folder-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isSubmitting}
              placeholder="Folder name"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500 disabled:opacity-50"
            />
          </div>
        )}

        {localError ? <p className="mt-3 text-xs text-rose-300">{localError}</p> : null}
        {error ? <p className="mt-3 text-xs text-rose-300">{error}</p> : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
            className={
              mode === "delete"
                ? "rounded-lg border border-rose-500/40 px-3 py-2 text-xs font-medium text-rose-100 transition hover:border-rose-400/70 disabled:opacity-50"
                : "rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
            }
          >
            {submitLabel}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
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
