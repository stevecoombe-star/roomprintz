/**
 * Customer dimensions for a saved My Furniture model.
 *
 * The GLB and its authored measurements stay unchanged. These metres are
 * the model's default size for a future placement. Width is X, depth is Z,
 * and height is Y, matching STAGE.
 */

import { isIdentityModelAxisScale, type ModelAxisScale } from "@/lib/afc-v2-runtime/model-axis-scale";
import {
  deriveModelAxisScale,
  editExactModelSize,
  editLockedModelSize,
  isPlausibleModelMetres,
  roundModelMetres,
  type ModelDimensionAxis,
  type ModelDimensions,
  type ModelSize,
  type ModelSizingMode,
} from "@/lib/vibode-stage/model-dimensions";

export const DIMENSION_RANGE_MESSAGE = "Enter a size between 5 cm and 8 m.";
export const DIMENSION_PROPORTION_MESSAGE =
  "That size would make another side too large or too small.";
export const DIMENSION_ENTRY_MESSAGE = "Enter a positive measurement.";
export const DIMENSION_PLACEMENT_NOTE =
  "Saved changes apply the next time this model is placed. Furniture already in a room stays as it is.";
export const DIMENSION_INDEPENDENT_NOTE =
  "Each side can be changed on its own.";

const METRES_PER_INCH = 0.0254;

export type DimensionUnit = "cm" | "in";

export type DimensionText = Readonly<{
  width: string;
  depth: string;
  height: string;
}>;

export type DimensionDraft = Readonly<{
  saved: ModelDimensions;
  current: ModelSize;
  proportion: ModelSize;
  locked: boolean;
  unit: DimensionUnit;
  texts: DimensionText;
  activeAxis: ModelDimensionAxis | null;
  issue: string | null;
}>;

type DimensionSource = Readonly<{
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  displayWidthM?: number | null;
  displayHeightM?: number | null;
  displayDepthM?: number | null;
  sizingMode?: string | null;
}>;

export function effectivePersonalDimensions(asset: DimensionSource): ModelDimensions | null {
  const native = sizeOrNull(asset.authoredWidthM, asset.authoredHeightM, asset.authoredDepthM);
  if (!native) return null;
  const display = sizeOrNull(asset.displayWidthM, asset.displayHeightM, asset.displayDepthM);
  if (!display) return { ...native, sizingMode: "uniform" };
  return {
    ...display,
    sizingMode: asset.sizingMode === "exact" ? "exact" : "uniform",
  };
}

export function personalPlacementScale(asset: DimensionSource): ModelAxisScale | null {
  const effective = effectivePersonalDimensions(asset);
  if (!effective) return null;
  const derived = deriveModelAxisScale({
    native: {
      widthM: asset.authoredWidthM,
      heightM: asset.authoredHeightM,
      depthM: asset.authoredDepthM,
    },
    effective,
  });
  if (!derived.ok || isIdentityModelAxisScale(derived.scale)) return null;
  return derived.scale;
}

export function startDimensionDraft(
  saved: ModelDimensions,
  unit: DimensionUnit = "cm",
): DimensionDraft | null {
  const size = sizeOrNull(saved.widthM, saved.heightM, saved.depthM);
  if (!size) return null;
  const sizingMode: ModelSizingMode = saved.sizingMode === "exact" ? "exact" : "uniform";
  return {
    saved: { ...size, sizingMode },
    current: size,
    proportion: size,
    locked: sizingMode !== "exact",
    unit,
    texts: textsFrom(size, unit),
    activeAxis: null,
    issue: null,
  };
}

export function editDimensionDraft(
  draft: DimensionDraft,
  axis: ModelDimensionAxis,
  text: string,
): DimensionDraft {
  const proportion = draft.locked && draft.activeAxis !== axis
    ? draft.current
    : draft.proportion;
  const texts = { ...draft.texts, [textKey(axis)]: text };
  const parsed = parseDimensionInput(text, draft.unit);
  if (parsed == null) {
    return { ...draft, proportion, texts, activeAxis: axis, issue: DIMENSION_ENTRY_MESSAGE };
  }
  const metres = roundModelMetres(parsed);
  if (!isPlausibleModelMetres(metres)) {
    return { ...draft, proportion, texts, activeAxis: axis, issue: DIMENSION_RANGE_MESSAGE };
  }
  const next = draft.locked
    ? editLockedModelSize(proportion, axis, metres)
    : editExactModelSize(draft.current, axis, metres);
  if (!next) {
    return { ...draft, proportion, texts, activeAxis: axis, issue: DIMENSION_PROPORTION_MESSAGE };
  }
  return {
    ...draft,
    current: next,
    proportion,
    texts: { ...textsFrom(next, draft.unit), [textKey(axis)]: text },
    activeAxis: axis,
    issue: null,
  };
}

export function setDimensionDraftUnit(draft: DimensionDraft, unit: DimensionUnit): DimensionDraft {
  if (draft.unit === unit) return draft;
  return {
    ...draft,
    unit,
    activeAxis: null,
    issue: null,
    texts: textsFrom(draft.current, unit),
  };
}

export function setDimensionDraftLocked(draft: DimensionDraft, locked: boolean): DimensionDraft {
  if (draft.locked === locked) return draft;
  return {
    ...draft,
    locked,
    proportion: locked ? draft.current : draft.proportion,
    activeAxis: null,
    issue: null,
    texts: textsFrom(draft.current, draft.unit),
  };
}

export function blurDimensionDraft(draft: DimensionDraft): DimensionDraft {
  if (draft.issue) return { ...draft, activeAxis: null };
  return {
    ...draft,
    activeAxis: null,
    texts: textsFrom(draft.current, draft.unit),
  };
}

export function dimensionDraftSizingMode(draft: DimensionDraft): ModelSizingMode {
  return draft.locked ? "uniform" : "exact";
}

export function dimensionDraftCanSave(draft: DimensionDraft): boolean {
  if (draft.issue) return false;
  const mode = dimensionDraftSizingMode(draft);
  return mode !== draft.saved.sizingMode
    || draft.current.widthM !== draft.saved.widthM
    || draft.current.heightM !== draft.saved.heightM
    || draft.current.depthM !== draft.saved.depthM;
}

export function dimensionPreviewScale(
  measured: ModelSize,
  target: ModelSize,
): ModelAxisScale | null {
  const derived = deriveModelAxisScale({ native: measured, effective: target });
  return derived.ok ? derived.scale : null;
}

export function parseDimensionInput(text: string, unit: DimensionUnit): number | null {
  const trimmed = text.trim();
  if (!/^\d+(?:\.\d*)?$/.test(trimmed) || trimmed === ".") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return unit === "cm" ? value / 100 : value * METRES_PER_INCH;
}

export function formatDimensionInput(metres: number, unit: DimensionUnit): string {
  const value = unit === "cm" ? metres * 100 : metres / METRES_PER_INCH;
  const digits = unit === "cm" ? 1 : 2;
  return String(Number(value.toFixed(digits)));
}

function textsFrom(size: ModelSize, unit: DimensionUnit): DimensionText {
  return {
    width: formatDimensionInput(size.widthM, unit),
    depth: formatDimensionInput(size.depthM, unit),
    height: formatDimensionInput(size.heightM, unit),
  };
}

function textKey(axis: ModelDimensionAxis): keyof DimensionText {
  if (axis === "width") return "width";
  if (axis === "depth") return "depth";
  return "height";
}

function sizeOrNull(
  width: number | null | undefined,
  height: number | null | undefined,
  depth: number | null | undefined,
): ModelSize | null {
  if (typeof width !== "number" || typeof height !== "number" || typeof depth !== "number") {
    return null;
  }
  const size = {
    widthM: roundModelMetres(width),
    heightM: roundModelMetres(height),
    depthM: roundModelMetres(depth),
  };
  if (
    !isPlausibleModelMetres(size.widthM)
    || !isPlausibleModelMetres(size.heightM)
    || !isPlausibleModelMetres(size.depthM)
  ) {
    return null;
  }
  return size;
}
