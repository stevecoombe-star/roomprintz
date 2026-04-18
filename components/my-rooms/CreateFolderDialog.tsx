"use client";

import { type FormEvent, useState } from "react";

type CreateFolderDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  isSaving: boolean;
  errorMessage: string | null;
};

export function CreateFolderDialog({
  open,
  onClose,
  onCreate,
  isSaving,
  errorMessage,
}: CreateFolderDialogProps) {
  const [name, setName] = useState("");

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-folder-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/80"
      >
        <h2 id="create-folder-title" className="text-sm font-semibold text-slate-100">
          New folder
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Keep folder names short and clear for faster scanning.
        </p>

        <label className="mt-4 block text-[11px] text-slate-400">Folder name</label>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Living Rooms"
          maxLength={120}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-400"
        />

        {errorMessage ? <div className="mt-2 text-xs text-rose-300">{errorMessage}</div> : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || name.trim().length === 0}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
          >
            {isSaving ? "Creating..." : "Create folder"}
          </button>
        </div>
      </form>
    </div>
  );
}
