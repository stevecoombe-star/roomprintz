"use client";

import type { RuntimeTransformMode } from "@/lib/afc-v2-runtime/types";

type Props = Readonly<{
  transformMode: RuntimeTransformMode;
  onTransformModeChange: (mode: RuntimeTransformMode) => void;
}>;

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function Editor3dModePanel({
  transformMode,
  onTransformModeChange,
}: Props) {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      data-editor-3d-mode-panel="true"
    >
      <div className="space-y-4 p-4">
        <div
          className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"
          role="group"
          aria-label="3D"
        >
          <div className="text-sm font-medium">3D</div>
          <div
            className="mt-3 flex gap-2"
            role="group"
            aria-label="Transform mode"
          >
            <button
              type="button"
              aria-pressed={transformMode === "move"}
              aria-label="Move"
              onClick={() => onTransformModeChange("move")}
              className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
                transformMode === "move"
                  ? "border-emerald-400/70 bg-emerald-950/70 text-emerald-100"
                  : "border-neutral-700 bg-neutral-950 text-neutral-200 hover:bg-neutral-800"
              }`}
            >
              Move
            </button>
            <button
              type="button"
              aria-pressed={transformMode === "rotate"}
              aria-label="Rotate"
              onClick={() => onTransformModeChange("rotate")}
              className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
                transformMode === "rotate"
                  ? "border-emerald-400/70 bg-emerald-950/70 text-emerald-100"
                  : "border-neutral-700 bg-neutral-950 text-neutral-200 hover:bg-neutral-800"
              }`}
            >
              Rotate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
