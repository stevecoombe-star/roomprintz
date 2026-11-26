"use client";

import { type FormEvent, useState } from "react";
import { myRoomsDialogCardClass, myRoomsDialogScrimClass, myRoomsFieldClass } from "@/components/my-rooms/surface";
import { VibodeButton } from "@/components/ui/VibodeButton";

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
      className={myRoomsDialogScrimClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-folder-title"
    >
      <form
        onSubmit={submit}
        className={myRoomsDialogCardClass}
      >
        <h2 id="create-folder-title" className="text-sm font-semibold text-ink">
          New folder
        </h2>
        <p className="mt-1 text-xs text-ink-secondary">
          Keep folder names short and clear for faster scanning.
        </p>

        <label className="mt-4 block text-[11px] text-ink-secondary">Folder name</label>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Living Rooms"
          maxLength={120}
          className={`mt-1 text-sm ${myRoomsFieldClass}`}
        />

        {errorMessage ? <div className="mt-2 text-xs text-danger">{errorMessage}</div> : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <VibodeButton type="button" variant="outline" size="standard" onClick={onClose} disabled={isSaving}>
            Cancel
          </VibodeButton>
          <VibodeButton type="submit" variant="primary" size="standard" disabled={isSaving || name.trim().length === 0}>
            {isSaving ? "Creating..." : "Create folder"}
          </VibodeButton>
        </div>
      </form>
    </div>
  );
}
