"use client";

import type { RuntimeTransformMode } from "@/lib/afc-v2-runtime/types";

type Props = Readonly<{
  transformMode: RuntimeTransformMode;
  onTransformModeChange: (mode: RuntimeTransformMode) => void;
}>;

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
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <div className="text-sm font-medium tracking-wide">3D MODE</div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              aria-pressed={transformMode === "move"}
              onClick={() => onTransformModeChange("move")}
              className={`rounded-md border px-2.5 py-1 text-xs ${
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
              onClick={() => onTransformModeChange("rotate")}
              className={`rounded-md border px-2.5 py-1 text-xs ${
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
