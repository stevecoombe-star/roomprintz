"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useStageEditor } from "@/components/stage/StageEditorContext";
import {
  ROOM_SCALE_MAX,
  ROOM_SCALE_MIN,
  ROOM_SCALE_STEP,
  formatRoomScaleMultiplier,
  roomScaleButtonLabel,
  stepRoomScaleMultiplier,
} from "@/lib/vibode-stage/room-scale";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function RoomScaleControl() {
  const stage = useStageEditor();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const labelId = useId();
  const multiplier = stage.roomScaleMultiplier;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={labelId}
        aria-label={roomScaleButtonLabel(multiplier)}
        onClick={() => setOpen((current) => !current)}
        className={`rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800 ${FOCUS}`}
      >
        {roomScaleButtonLabel(multiplier)}
      </button>
      {open ? (
        <div
          id={labelId}
          aria-label="Room scale"
          className="absolute right-0 top-full z-30 mt-1 w-[280px] rounded-md border border-neutral-700 bg-neutral-950 p-2 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease room scale"
              onClick={() => stage.setRoomScaleMultiplier(stepRoomScaleMultiplier(multiplier, -1))}
              className={`h-7 w-7 shrink-0 rounded-md border border-neutral-700 text-sm text-neutral-200 hover:bg-neutral-800 ${FOCUS}`}
            >
              −
            </button>
            <span className="w-12 shrink-0 text-center text-xs tabular-nums text-neutral-100">
              {formatRoomScaleMultiplier(multiplier)}
            </span>
            <input
              type="range"
              aria-label="Room scale"
              min={ROOM_SCALE_MIN}
              max={ROOM_SCALE_MAX}
              step={ROOM_SCALE_STEP}
              value={multiplier}
              onChange={(event) => stage.setRoomScaleMultiplier(Number(event.target.value))}
              className="h-1 min-w-0 flex-1 accent-neutral-200"
            />
            <button
              type="button"
              aria-label="Increase room scale"
              onClick={() => stage.setRoomScaleMultiplier(stepRoomScaleMultiplier(multiplier, 1))}
              className={`h-7 w-7 shrink-0 rounded-md border border-neutral-700 text-sm text-neutral-200 hover:bg-neutral-800 ${FOCUS}`}
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => stage.setRoomScaleMultiplier(1)}
            className={`mt-2 text-[11px] text-neutral-400 hover:text-neutral-200 ${FOCUS}`}
          >
            Reset
          </button>
        </div>
      ) : null}
    </div>
  );
}
