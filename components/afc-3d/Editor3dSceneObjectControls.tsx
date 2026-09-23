"use client";

import { useAfcSceneObjectCrudSession } from "@/components/afc-3d/AfcSceneObjectCrudSession";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function Editor3dSceneObjectControls() {
  const session = useAfcSceneObjectCrudSession();
  if (!session) return null;

  const addDisabled = !session.liveReady || session.atObjectLimit;
  const selectionDisabled = !session.liveReady || !session.selectedObjectId;

  return (
    <div className="mt-3 space-y-2" data-editor-3d-scene-object-controls="true">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label="Add Furniture"
          disabled={addDisabled}
          onClick={() => session.addFurniture()}
          className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
            addDisabled
              ? "border-neutral-800 bg-neutral-950 text-neutral-500"
              : "border-neutral-700 bg-neutral-950 text-neutral-200 hover:bg-neutral-800"
          }`}
        >
          Add Furniture
        </button>
        <button
          type="button"
          aria-label="Duplicate"
          disabled={selectionDisabled || session.atObjectLimit}
          onClick={() => session.duplicateSelected()}
          className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
            selectionDisabled || session.atObjectLimit
              ? "border-neutral-800 bg-neutral-950 text-neutral-500"
              : "border-neutral-700 bg-neutral-950 text-neutral-200 hover:bg-neutral-800"
          }`}
        >
          Duplicate
        </button>
        <button
          type="button"
          aria-label="Delete"
          disabled={selectionDisabled}
          onClick={() => session.deleteSelected()}
          className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
            selectionDisabled
              ? "border-neutral-800 bg-neutral-950 text-neutral-500"
              : "border-neutral-700 bg-neutral-950 text-neutral-200 hover:bg-neutral-800"
          }`}
        >
          Delete
        </button>
      </div>
      {session.actionError ? (
        <div className="text-xs text-amber-200" role="status" aria-live="polite">
          {session.actionError}
        </div>
      ) : null}
    </div>
  );
}
