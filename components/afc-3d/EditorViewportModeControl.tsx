"use client";

import type { EditorViewportMode } from "@/lib/afc-v2-runtime/editor-viewport-mode";

type Props = Readonly<{
  mode: EditorViewportMode;
  disabled?: boolean;
  onChange: (mode: EditorViewportMode) => void;
}>;

export function EditorViewportModeControl({
  mode,
  disabled = false,
  onChange,
}: Props) {
  return (
    <div
      className="flex items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5"
      role="group"
      aria-label="Editor view mode"
      data-editor-viewport-mode-control="true"
      data-editor-viewport-mode={mode}
    >
      <button
        type="button"
        aria-pressed={mode === "2d"}
        onClick={() => onChange("2d")}
        className={`rounded px-2.5 py-1 text-xs transition ${
          mode === "2d"
            ? "bg-neutral-800 text-neutral-100"
            : "text-neutral-400 hover:text-neutral-200"
        }`}
      >
        2D
      </button>
      <button
        type="button"
        aria-pressed={mode === "3d"}
        disabled={disabled}
        onClick={() => onChange("3d")}
        className={`rounded px-2.5 py-1 text-xs transition ${
          disabled
            ? "cursor-not-allowed text-neutral-600"
            : mode === "3d"
              ? "bg-neutral-800 text-neutral-100"
              : "text-neutral-400 hover:text-neutral-200"
        }`}
      >
        3D
      </button>
    </div>
  );
}
