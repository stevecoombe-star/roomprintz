"use client";

import { useAfcSceneObjectCrudSession } from "@/components/afc-3d/AfcSceneObjectCrudSession";
import { useOptionalStageEditor } from "@/components/stage/StageEditorContext";
import { formatRotationDeg, snapRotationDegIfNear } from "@/lib/vibode-stage/rotate";
import {
  formatSizePercent,
  isAuthoredSize,
  STAGE_SIZE_DEFAULT,
  STAGE_SIZE_MAX,
  STAGE_SIZE_MIN,
} from "@/lib/vibode-stage/size";
import { placeStageToolbar, shouldHideToolbarDuringPointer } from "@/lib/vibode-stage/toolbar";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function StageFurnitureToolbar() {
  const stage = useOptionalStageEditor();
  const session = useAfcSceneObjectCrudSession();
  const selection = stage?.selection ?? null;
  if (!stage || !stage.active || !selection || !session?.selectedObjectId) return null;
  if (
    shouldHideToolbarDuringPointer({
      pointerDownOnObject: selection.dragging,
      dragging: selection.dragging,
    })
  ) {
    return null;
  }

  const extraHeight = stage.toolbarSlider ? 52 : 0;
  const placement = placeStageToolbar({
    anchorX: selection.x,
    anchorY: selection.y,
    canvasWidth: selection.canvasWidth,
    canvasHeight: selection.canvasHeight,
    extraHeight,
  });

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      data-stage-toolbar="true"
    >
      <div
        className="pointer-events-auto absolute"
        style={{ left: placement.left, top: placement.top }}
      >
        {stage.toolbarSlider === "rotate" ? (
          <div className="mb-1.5 rounded-md border border-neutral-700 bg-neutral-950/90 px-3 py-2 shadow-lg">
            <div className="mb-1 text-center text-[11px] text-neutral-200">
              {formatRotationDeg(selection.rotationYDeg)}
            </div>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={Math.round(selection.rotationYDeg)}
              aria-label="Rotate"
              onChange={(event) => {
                session.commitRotationYDeg(Number(event.target.value));
              }}
              onPointerUp={(event) => {
                session.commitRotationYDeg(
                  snapRotationDegIfNear(Number(event.currentTarget.value)),
                );
              }}
              className="h-1 w-44 accent-neutral-200"
            />
          </div>
        ) : null}
        {stage.toolbarSlider === "size" ? (
          <div className="mb-1.5 rounded-md border border-neutral-700 bg-neutral-950/90 px-3 py-2 shadow-lg">
            <div className="mb-1 flex items-center justify-center gap-2 text-[11px] text-neutral-200">
              <span>{formatSizePercent(selection.userSizeMultiplier)}</span>
              {!isAuthoredSize(selection.userSizeMultiplier) ? (
                <button
                  type="button"
                  className={`rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 ${FOCUS}`}
                  onClick={() => session.commitUserSizeMultiplier(STAGE_SIZE_DEFAULT)}
                >
                  100%
                </button>
              ) : null}
            </div>
            <input
              type="range"
              min={STAGE_SIZE_MIN}
              max={STAGE_SIZE_MAX}
              step={0.01}
              value={selection.userSizeMultiplier}
              aria-label="Size"
              onChange={(event) => {
                session.commitUserSizeMultiplier(Number(event.target.value));
              }}
              className="h-1 w-44 accent-neutral-200"
            />
          </div>
        ) : null}
        <div className="flex items-center gap-0.5 rounded-md border border-neutral-700 bg-neutral-950/90 p-1 shadow-lg">
          <ToolbarButton
            label="Move"
            pressed={stage.transformMode === "move" && stage.toolbarSlider !== "size"}
            onClick={() => stage.setTransformMode("move")}
          />
          <ToolbarButton
            label="Rotate"
            pressed={stage.toolbarSlider === "rotate"}
            onClick={() => stage.setTransformMode("rotate")}
          />
          <ToolbarButton
            label="Size"
            pressed={stage.toolbarSlider === "size"}
            onClick={() => {
              stage.setToolbarSlider(stage.toolbarSlider === "size" ? null : "size");
            }}
          />
          <ToolbarButton
            label="Duplicate"
            disabled={session.atObjectLimit}
            onClick={() => session.duplicateSelected()}
          />
          <ToolbarButton
            label="Delete"
            onClick={() => session.deleteSelected()}
          />
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-2 py-1 text-[10px] ${FOCUS} ${
        disabled
          ? "text-neutral-600"
          : pressed
            ? "bg-neutral-800 text-neutral-50"
            : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50"
      }`}
    >
      {label}
    </button>
  );
}
