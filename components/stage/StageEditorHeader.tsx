"use client";

import { useStageEditor } from "@/components/stage/StageEditorContext";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function StageEditorHeader() {
  const stage = useStageEditor();
  return (
    <div
      className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-800/80 px-3"
      data-stage-header="true"
    >
      <button
        type="button"
        aria-pressed={stage.catalogOpen}
        aria-label="Catalog"
        onClick={stage.toggleCatalog}
        className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
          stage.catalogOpen
            ? "border-neutral-500 bg-neutral-800 text-neutral-100"
            : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
        }`}
      >
        Catalog
      </button>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Undo"
          disabled={!stage.canUndo}
          onClick={stage.undo}
          className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
            stage.canUndo
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
          className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
            stage.summaryOpen
              ? "border-neutral-500 bg-neutral-800 text-neutral-100"
              : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
          }`}
        >
          Summary →
        </button>
      </div>
    </div>
  );
}
