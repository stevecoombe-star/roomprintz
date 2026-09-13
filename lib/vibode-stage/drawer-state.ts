import {
  STAGE_CANVAS_HEIGHT_CLASS,
  STAGE_CANVAS_WIDTH_CLASS,
  STAGE_CATALOG_WIDTH_PX,
  STAGE_SUMMARY_WIDTH_PX,
  type StageDrawerLayout,
} from "./types";

export type StageCatalogDrawerPhase = "collapsed" | "temporary" | "pinned";

export function catalogDrawerPhase(input: Readonly<{
  open: boolean;
  pinned: boolean;
}>): StageCatalogDrawerPhase {
  if (!input.open) return "collapsed";
  return input.pinned ? "pinned" : "temporary";
}

export function stageDrawerLayout(input: Readonly<{
  catalogOpen: boolean;
  summaryOpen: boolean;
}>): StageDrawerLayout {
  return {
    catalogWidthPx: input.catalogOpen ? STAGE_CATALOG_WIDTH_PX : 0,
    summaryWidthPx: input.summaryOpen ? STAGE_SUMMARY_WIDTH_PX : 0,
    canvasWidthClass: STAGE_CANVAS_WIDTH_CLASS,
    canvasHeightClass: STAGE_CANVAS_HEIGHT_CLASS,
  };
}

export function toggleCatalogDrawer(input: Readonly<{
  open: boolean;
  pinned: boolean;
}>): { open: boolean; pinned: boolean } {
  if (!input.open) return { open: true, pinned: false };
  return { open: false, pinned: false };
}

export function pinCatalogDrawer(): { open: boolean; pinned: boolean } {
  return { open: true, pinned: true };
}

export function collapseCatalogDrawer(): { open: boolean; pinned: boolean } {
  return { open: false, pinned: false };
}
