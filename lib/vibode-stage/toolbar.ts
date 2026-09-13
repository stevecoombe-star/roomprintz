import type { StageToolbarPlacement } from "./types";

export const STAGE_TOOLBAR_WIDTH_PX = 430;
export const STAGE_TOOLBAR_HEIGHT_PX = 44;
export const STAGE_SLIDER_HEIGHT_PX = 52;
export const STAGE_TOOLBAR_MARGIN_PX = 10;

export function shouldHideToolbarDuringPointer(input: Readonly<{
  pointerDownOnObject: boolean;
  dragging: boolean;
}>): boolean {
  return input.pointerDownOnObject || input.dragging;
}

export function placeStageToolbar(input: Readonly<{
  anchorX: number;
  anchorY: number;
  canvasWidth: number;
  canvasHeight: number;
  toolbarWidth?: number;
  toolbarHeight?: number;
  extraHeight?: number;
}>): StageToolbarPlacement {
  const width = input.toolbarWidth ?? STAGE_TOOLBAR_WIDTH_PX;
  const height = input.toolbarHeight ?? STAGE_TOOLBAR_HEIGHT_PX;
  const extra = input.extraHeight ?? 0;
  const margin = STAGE_TOOLBAR_MARGIN_PX;
  const totalHeight = height + extra;
  let side: StageToolbarPlacement["side"] = "above";
  let top = input.anchorY - totalHeight - 16;
  if (top < margin) {
    side = "below";
    top = input.anchorY + 16;
  }
  if (top + totalHeight > input.canvasHeight - margin) {
    side = "side";
    top = Math.max(margin, input.canvasHeight - totalHeight - margin);
  }
  let left = input.anchorX - width / 2;
  if (left < margin) left = margin;
  if (left + width > input.canvasWidth - margin) {
    left = Math.max(margin, input.canvasWidth - width - margin);
  }
  return { left, top, side };
}
