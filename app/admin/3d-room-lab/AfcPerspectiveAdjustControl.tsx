"use client";

import type {
  ChangeEventHandler,
  KeyboardEventHandler,
  PointerEventHandler,
} from "react";

type AfcPerspectiveAdjustControlProps = Readonly<{
  ariaLabel: string;
  previewDelta: number;
  committedDelta: number;
  minDelta: number;
  maxDelta: number;
  enabled: boolean;
  pending: boolean;
  compact?: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onPointerDown: PointerEventHandler<HTMLInputElement>;
  onPointerUp: PointerEventHandler<HTMLInputElement>;
  onPointerCancel: PointerEventHandler<HTMLInputElement>;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onReset: () => void;
}>;

/**
 * Presentation only. The Lab host owns the sole Perspective session, timer,
 * and realization handlers shared by each rendered surface.
 */
export default function AfcPerspectiveAdjustControl({
  ariaLabel,
  previewDelta,
  committedDelta,
  minDelta,
  maxDelta,
  enabled,
  pending,
  compact = false,
  onChange,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  onReset,
}: AfcPerspectiveAdjustControlProps) {
  const stateLabel = pending
    ? "Applying…"
    : !enabled
      ? "Unavailable"
      : previewDelta === 0 && committedDelta === 0
        ? "Automatic"
        : previewDelta !== committedDelta
          ? "Preview"
          : "Adjusted";

  return (
    <div className={compact ? "rounded-lg border border-cyan-900/70 bg-cyan-950/15 p-3 text-xs" : "text-xs"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-slate-200">Perspective Adjust</p>
          {!compact ? (
            <p className="mt-1 text-slate-500">
              Start from Automatic, then make a small deliberate perspective change.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className={pending ? "text-cyan-200" : enabled ? "text-slate-400" : "text-slate-500"}>
            {stateLabel}
          </span>
          <button
            type="button"
            onClick={onReset}
            disabled={!enabled}
            className="rounded border border-cyan-500/70 px-2 py-1 font-medium text-cyan-100 transition hover:border-cyan-300 hover:text-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500 disabled:opacity-60"
          >
            Reset perspective
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-slate-400">
        <span>Flatter</span>
        <input
          aria-label={ariaLabel}
          type="range"
          min={minDelta}
          max={maxDelta}
          step={0.001}
          value={previewDelta}
          disabled={!enabled}
          onChange={onChange}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onKeyDown}
          className="min-w-0 accent-cyan-400 disabled:cursor-not-allowed"
        />
        <span>More perspective</span>
      </div>
    </div>
  );
}
