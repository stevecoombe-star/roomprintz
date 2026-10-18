"use client";

import { HarmonizeButton } from "@/components/stage/HarmonizeExperience";
import { RemoveAlignmentControl, useRemoveAlignment } from "@/components/stage/RemoveAlignmentSession";
import { RoomScaleControl } from "@/components/stage/RoomScaleControl";
import { useStageEditor } from "@/components/stage/StageEditorContext";
import { removeInspectionInteraction } from "@/lib/vibode-stage/remove-alignment";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function StageEditorHeader() {
  const stage = useStageEditor();
  const inspection = removeInspectionInteraction(useRemoveAlignment()?.active === true);
  const undoEnabled = stage.canUndo && inspection.undo;
  return (
    <div
      className="relative z-40 flex h-10 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-neutral-800/80 px-3"
      data-stage-header="true"
    >
      <button
        type="button"
        aria-pressed={stage.catalogOpen}
        aria-label="Catalog"
        onClick={stage.toggleCatalog}
        className={`shrink-0 rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
          stage.catalogOpen
            ? "border-neutral-500 bg-neutral-800 text-neutral-100"
            : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
        }`}
      >
        Catalog
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <RoomScaleControl />
        <div className="flex min-w-0 items-center justify-end gap-2 overflow-x-auto">
          <button
            type="button"
            aria-label="Undo"
            disabled={!undoEnabled}
            title={inspection.undo ? undefined : "Undo is paused during Remove inspection"}
            onClick={() => {
              if (!undoEnabled) return;
              stage.undo();
            }}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
              undoEnabled
                ? "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                : "border-neutral-900 bg-neutral-950 text-neutral-600"
            }`}
          >
            Undo
          </button>
          <button
            type="button"
            aria-pressed={stage.summaryOpen}
            aria-label="Summary"
            onClick={stage.toggleSummary}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
              stage.summaryOpen
                ? "border-neutral-500 bg-neutral-800 text-neutral-100"
                : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            Summary →
          </button>
        </div>
        <RemoveAlignmentControl />
        <HarmonizeButton />
      </div>
    </div>
  );
}
