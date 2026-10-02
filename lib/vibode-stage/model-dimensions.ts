/**
 * Partner product dimensions and the scale derived from them.
 *
 * Asset authored width/height/depth stay the immutable GLB measurement.
 * Variant model width/height/depth are the physical size STAGE should use.
 * Scale is derived. Merchants do not store scale factors.
 *
 * Vibode axes, matching authored placement AABBs:
 * width → X, height → Y, depth → Z.
 */

import {
  FURNITURE_ASSET_PLAUSIBLE_MAX_M,
  FURNITURE_ASSET_PLAUSIBLE_MIN_M,
} from "@/lib/afc-v2-runtime/furniture-asset-policy";

export const MODEL_DIMENSION_MIN_M = FURNITURE_ASSET_PLAUSIBLE_MIN_M;
export const MODEL_DIMENSION_MAX_M = FURNITURE_ASSET_PLAUSIBLE_MAX_M;
export const MODEL_DIMENSION_STEP_M = 0.001;

export const MODEL_SIZING_MODES = Object.freeze(["uniform", "exact"] as const);
export type ModelSizingMode = (typeof MODEL_SIZING_MODES)[number];
export const DEFAULT_MODEL_SIZING_MODE: ModelSizingMode = "uniform";

export const PARTNER_MODEL_DIMENSIONS_NOTE =
  "These dimensions determine the model's physical size in Vibode.";
export const PARTNER_MODEL_DIMENSIONS_EXACT_NOTE =
  "Edit dimensions independently to match the physical product.";
export const PARTNER_MODEL_DIMENSIONS_INVALID =
  `Enter product dimensions between ${MODEL_DIMENSION_MIN_M} m and ${MODEL_DIMENSION_MAX_M} m.`;

export type ModelDimensionAxis = "width" | "depth" | "height";

export type ModelSize = Readonly<{
  widthM: number;
  heightM: number;
  depthM: number;
}>;

export type ModelDimensions = ModelSize & Readonly<{
  sizingMode: ModelSizingMode;
}>;

export type ModelAxisScale = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export const MODEL_AXIS_SCALE_IDENTITY: ModelAxisScale = Object.freeze({
  x: 1,
  y: 1,
  z: 1,
});

export type ParsedModelDimensions =
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "invalid"; message: string }>
  | Readonly<{ state: "present"; dimensions: ModelDimensions }>;

const DIMENSION_KEYS = Object.freeze([
  "modelWidthM",
  "modelHeightM",
  "modelDepthM",
  "modelSizingMode",
] as const);

export function isModelSizingMode(value: unknown): value is ModelSizingMode {
  return value === "uniform" || value === "exact";
}

export function roundModelMetres(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 1000) / 1000;
}

export function isPlausibleModelMetres(value: number): boolean {
  return Number.isFinite(value)
    && value >= MODEL_DIMENSION_MIN_M
    && value <= MODEL_DIMENSION_MAX_M;
}

export function isPlausibleModelSize(size: ModelSize | null | undefined): size is ModelSize {
  if (!size) return false;
  return isPlausibleModelMetres(size.widthM)
    && isPlausibleModelMetres(size.heightM)
    && isPlausibleModelMetres(size.depthM);
}

export function formatModelMetres(value: number): string {
  const rounded = roundModelMetres(value);
  if (!Number.isFinite(rounded)) return "";
  const [whole, fraction = "000"] = rounded.toFixed(3).split(".");
  const kept = fraction.replace(/0+$/, "");
  const digits = kept.length < 2 ? fraction.slice(0, 2) : kept;
  return `${whole}.${digits}`;
}

export function formatModelDimensionList(size: ModelSize): string {
  return `W ${formatModelMetres(size.widthM)} m × D ${formatModelMetres(size.depthM)} m × H ${formatModelMetres(size.heightM)} m`;
}

function axisValue(size: ModelSize, axis: ModelDimensionAxis): number {
  if (axis === "width") return size.widthM;
  if (axis === "depth") return size.depthM;
  return size.heightM;
}

function roundedSize(size: ModelSize): ModelSize | null {
  const next = {
    widthM: roundModelMetres(size.widthM),
    heightM: roundModelMetres(size.heightM),
    depthM: roundModelMetres(size.depthM),
  };
  return isPlausibleModelSize(next) ? next : null;
}

export function explicitModelDimensions(input: Readonly<{
  modelWidthM?: number | null;
  modelHeightM?: number | null;
  modelDepthM?: number | null;
  modelSizingMode?: string | null;
}> | null | undefined): ModelDimensions | null {
  if (!input) return null;
  const present = DIMENSION_KEYS.some((key) => input[key] != null);
  if (!present) return null;
  if (!isModelSizingMode(input.modelSizingMode)) return null;
  if (
    typeof input.modelWidthM !== "number"
    || typeof input.modelHeightM !== "number"
    || typeof input.modelDepthM !== "number"
  ) {
    return null;
  }
  const size = roundedSize({
    widthM: input.modelWidthM,
    heightM: input.modelHeightM,
    depthM: input.modelDepthM,
  });
  if (!size) return null;
  return { ...size, sizingMode: input.modelSizingMode };
}

export function nativeModelDimensions(asset: Readonly<{
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
}> | null | undefined): ModelSize | null {
  if (!asset) return null;
  if (
    typeof asset.authoredWidthM !== "number"
    || typeof asset.authoredHeightM !== "number"
    || typeof asset.authoredDepthM !== "number"
  ) {
    return null;
  }
  return roundedSize({
    widthM: asset.authoredWidthM,
    heightM: asset.authoredHeightM,
    depthM: asset.authoredDepthM,
  });
}

export function resolveEffectiveModelDimensions(
  variant: Readonly<{
    modelWidthM?: number | null;
    modelHeightM?: number | null;
    modelDepthM?: number | null;
    modelSizingMode?: string | null;
  }> | null | undefined,
  asset: Readonly<{
    authoredWidthM: number;
    authoredHeightM: number;
    authoredDepthM: number;
  }> | null | undefined,
): ModelSize | null {
  const explicit = explicitModelDimensions(variant);
  if (explicit) {
    return {
      widthM: explicit.widthM,
      heightM: explicit.heightM,
      depthM: explicit.depthM,
    };
  }
  return nativeModelDimensions(asset);
}

export function deriveModelAxisScale(input: Readonly<{
  native: ModelSize | null;
  effective: ModelSize | null;
}>): Readonly<{ ok: true; scale: ModelAxisScale } | { ok: false; reason: "invalid_native" | "invalid_effective" | "invalid_scale" }> {
  const native = input.native ? roundedSize(input.native) : null;
  if (!native) return { ok: false, reason: "invalid_native" };
  const effective = input.effective ? roundedSize(input.effective) : null;
  if (!effective) return { ok: false, reason: "invalid_effective" };
  const scale = {
    x: effective.widthM / native.widthM,
    y: effective.heightM / native.heightM,
    z: effective.depthM / native.depthM,
  };
  if (![scale.x, scale.y, scale.z].every((value) => Number.isFinite(value) && value > 0)) {
    return { ok: false, reason: "invalid_scale" };
  }
  return { ok: true, scale };
}

export function modelAxisScaleOrIdentity(input: Readonly<{
  native: ModelSize | null;
  effective: ModelSize | null;
}>): ModelAxisScale {
  const derived = deriveModelAxisScale(input);
  return derived.ok ? derived.scale : MODEL_AXIS_SCALE_IDENTITY;
}

export function canonicalModelDimensions(dimensions: ModelDimensions | null | undefined): string | null {
  if (!dimensions) return null;
  return `${dimensions.widthM}|${dimensions.heightM}|${dimensions.depthM}|${dimensions.sizingMode}`;
}

export function sameModelDimensions(
  left: ModelDimensions | null | undefined,
  right: ModelDimensions | null | undefined,
): boolean {
  return canonicalModelDimensions(left ?? null) === canonicalModelDimensions(right ?? null);
}

export function stageVariantModelFields(dimensions: ModelDimensions | null): Readonly<{
  modelWidthM?: number;
  modelHeightM?: number;
  modelDepthM?: number;
  modelSizingMode?: ModelSizingMode;
}> {
  if (!dimensions) return {};
  return {
    modelWidthM: dimensions.widthM,
    modelHeightM: dimensions.heightM,
    modelDepthM: dimensions.depthM,
    modelSizingMode: dimensions.sizingMode,
  };
}

export function editLockedModelSize(
  baseline: ModelSize,
  axis: ModelDimensionAxis,
  nextValue: number,
): ModelSize | null {
  const baseSize = roundedSize(baseline);
  if (!baseSize) return null;
  const base = axisValue(baseSize, axis);
  const edited = roundModelMetres(nextValue);
  if (!(base > 0) || !isPlausibleModelMetres(edited)) return null;
  const factor = edited / base;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const next = {
    widthM: axis === "width" ? edited : roundModelMetres(baseSize.widthM * factor),
    heightM: axis === "height" ? edited : roundModelMetres(baseSize.heightM * factor),
    depthM: axis === "depth" ? edited : roundModelMetres(baseSize.depthM * factor),
  };
  return isPlausibleModelSize(next) ? next : null;
}

export function editExactModelSize(
  current: ModelSize,
  axis: ModelDimensionAxis,
  nextValue: number,
): ModelSize | null {
  const base = roundedSize(current);
  if (!base) return null;
  const edited = roundModelMetres(nextValue);
  if (!isPlausibleModelMetres(edited)) return null;
  const next = {
    widthM: axis === "width" ? edited : base.widthM,
    heightM: axis === "height" ? edited : base.heightM,
    depthM: axis === "depth" ? edited : base.depthM,
  };
  return isPlausibleModelSize(next) ? next : null;
}

export function editModelDimension(input: Readonly<{
  mode: ModelSizingMode;
  baseline: ModelSize;
  current: ModelSize;
  axis: ModelDimensionAxis;
  nextValue: number;
}>): ModelSize | null {
  if (input.mode === "uniform") {
    return editLockedModelSize(input.baseline, input.axis, input.nextValue);
  }
  return editExactModelSize(input.current, input.axis, input.nextValue);
}

export function setModelSizingMode(
  current: ModelSize,
  sizingMode: ModelSizingMode,
): ModelDimensions | null {
  const size = roundedSize(current);
  if (!size || !isModelSizingMode(sizingMode)) return null;
  return { ...size, sizingMode };
}

export function modelDimensionsAfterAssetReplacement(input: Readonly<{
  previousExplicit: ModelDimensions | null;
  nextNative: ModelSize;
}>): Readonly<{ dimensions: ModelDimensions; seeded: boolean }> | null {
  if (input.previousExplicit && isPlausibleModelSize(input.previousExplicit) && isModelSizingMode(input.previousExplicit.sizingMode)) {
    const kept = roundedSize(input.previousExplicit);
    if (!kept) return null;
    return {
      dimensions: { ...kept, sizingMode: input.previousExplicit.sizingMode },
      seeded: false,
    };
  }
  const seeded = roundedSize(input.nextNative);
  if (!seeded) return null;
  return {
    dimensions: { ...seeded, sizingMode: DEFAULT_MODEL_SIZING_MODE },
    seeded: true,
  };
}

function finiteDimension(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export function parseModelDimensionFields(value: Readonly<Record<string, unknown>>): ParsedModelDimensions {
  const present = DIMENSION_KEYS.some((key) => key in value);
  if (!present) return { state: "absent" };
  if (!DIMENSION_KEYS.every((key) => key in value)) {
    return { state: "invalid", message: PARTNER_MODEL_DIMENSIONS_INVALID };
  }
  const widthM = finiteDimension(value.modelWidthM);
  const heightM = finiteDimension(value.modelHeightM);
  const depthM = finiteDimension(value.modelDepthM);
  if (widthM == null || heightM == null || depthM == null || !isModelSizingMode(value.modelSizingMode)) {
    return { state: "invalid", message: PARTNER_MODEL_DIMENSIONS_INVALID };
  }
  const dimensions = explicitModelDimensions({
    modelWidthM: widthM,
    modelHeightM: heightM,
    modelDepthM: depthM,
    modelSizingMode: value.modelSizingMode,
  });
  if (!dimensions) return { state: "invalid", message: PARTNER_MODEL_DIMENSIONS_INVALID };
  return { state: "present", dimensions };
}

export function modelSizeFromMeasured(input: Readonly<{
  widthM?: unknown;
  heightM?: unknown;
  depthM?: unknown;
}> | null | undefined): ModelSize | null {
  if (!input) return null;
  const widthM = finiteDimension(input.widthM);
  const heightM = finiteDimension(input.heightM);
  const depthM = finiteDimension(input.depthM);
  if (widthM == null || heightM == null || depthM == null) return null;
  return roundedSize({ widthM, heightM, depthM });
}
