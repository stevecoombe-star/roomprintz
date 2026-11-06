export type StageDrawerPanel = "catalog" | "furniture";

export type StageFurnitureSubmode = "library" | "generator";

/**
 * Shared 340px drawer. Switching panels does not invent a camera, selection,
 * room-scale, or undo change. Those stay with the caller, which must not
 * apply any when it uses this result.
 */
export function nextStageDrawer(input: Readonly<{
  open: boolean;
  pinned: boolean;
  panel: StageDrawerPanel;
  target: StageDrawerPanel;
}>): { open: boolean; pinned: boolean; panel: StageDrawerPanel } {
  if (input.open && input.panel === input.target) {
    return { open: false, pinned: false, panel: input.target };
  }
  return {
    open: true,
    panel: input.target,
    pinned: input.open ? input.pinned : false,
  };
}
