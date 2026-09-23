"use client";

import type { EditorViewportMode } from "@/lib/afc-v2-runtime/editor-viewport-mode";

type Props = Readonly<{
  mode: EditorViewportMode;
  disabled?: boolean;
  busy?: boolean;
  onChange: (mode: EditorViewportMode) => void;
}>;

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function EditorViewportModeControl({
  mode,
  disabled = false,
  busy = false,
  onChange,
}: Props) {
  const threeDDisabled = disabled || busy;

  return (
    <div
      className="flex items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5"
      role="group"
      aria-label="Editor view mode"
      aria-busy={busy}
      data-editor-viewport-mode-control="true"
      data-editor-viewport-mode={mode}
      data-editor-viewport-3d-busy={busy ? "true" : "false"}
    >
      <button
        type="button"
        aria-pressed={mode === "2d"}
        aria-label="2D"
        onClick={() => {
          if (mode !== "2d") onChange("2d");
        }}
        className={`rounded px-2.5 py-1 text-xs transition ${FOCUS} ${
          mode === "2d"
            ? "bg-neutral-200 text-neutral-950"
            : "text-neutral-400 hover:text-neutral-200"
        }`}
      >
        2D
      </button>
      <button
        type="button"
        aria-pressed={mode === "3d"}
        aria-label="3D"
        aria-busy={busy}
        disabled={threeDDisabled}
        onClick={() => {
          if (threeDDisabled || mode === "3d") return;
          onChange("3d");
        }}
        className={`rounded px-2.5 py-1 text-xs transition ${FOCUS} ${
          threeDDisabled && mode !== "3d"
            ? "cursor-not-allowed text-neutral-600"
            : mode === "3d"
              ? `bg-emerald-800 text-emerald-50 ${threeDDisabled ? "cursor-wait opacity-80" : ""}`
              : "text-neutral-400 hover:text-neutral-200"
        }`}
      >
        3D
      </button>
    </div>
  );
}
