/**
 * Authoritative furniture scale shared by the STAGE viewport and thumbnails.
 *
 * modelAxisScale = variantEffectiveDimensions / assetNativeDimensions
 * importScale    = authoredImportScale × userSizeMultiplier × modelAxisScale
 * metricScale    = certifiedMetricScale × roomScaleMultiplier
 *
 * Width is X, height is Y, depth is Z. Room scale is not part of importScale.
 * It is applied once to the camera pose and object XZ positions.
 */

import {
  composeImportAxisScale,
  isIdentityModelAxisScale,
  MODEL_AXIS_SCALE_IDENTITY,
  type ModelAxisScale,
} from "@/lib/afc-v2-runtime/model-axis-scale";
import {
  AFC_V2_USER_SIZE_DEFAULT,
  clampUserSizeMultiplier,
} from "@/lib/afc-v2-runtime/types";

import {
  explicitModelDimensions,
  modelAxisScaleOrIdentity,
  nativeModelDimensions,
  resolveEffectiveModelDimensions,
  stageVariantModelFields,
  type ModelSize,
  type ModelSizingMode,
} from "./model-dimensions";
import {
  ROOM_SCALE_DEFAULT,
  effectiveMetricScale,
} from "./room-scale";

/** Same tables as the shopper catalog. Thumbnail queries read these columns only. */
export const FURNITURE_MODEL_SCALE_ASSET_TABLE = "vibode_stage_assets" as const;
export const FURNITURE_MODEL_SCALE_VARIANT_TABLE = "vibode_stage_variants" as const;

export type StageAssetModelRecord = Readonly<{
  assetId: string;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
}>;

export type StageVariantModelRecord = Readonly<{
  variantId: string;
  assetId: string | null;
  modelWidthM?: number;
  modelHeightM?: number;
  modelDepthM?: number;
  modelSizingMode?: ModelSizingMode;
}>;

export type AuthoritativeFurnitureScale = Readonly<{
  modelAxisScale: ModelAxisScale;
  importScale: ModelAxisScale;
  metricScale: number;
}>;

type VariantScaleInput = Readonly<{
  assetId?: string | null;
  modelWidthM?: number | null;
  modelHeightM?: number | null;
  modelDepthM?: number | null;
  modelSizingMode?: string | null;
}> | null;

type AssetScaleInput = Readonly<{
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
}> | null;

export function stageModelAxisScale(input: Readonly<{
  assetId: string;
  variant?: VariantScaleInput;
  asset?: AssetScaleInput;
}>): ModelAxisScale {
  const variant = input.variant ?? null;
  const asset = input.asset ?? null;
  if (variant?.assetId && variant.assetId !== input.assetId) {
    return MODEL_AXIS_SCALE_IDENTITY;
  }
  return modelAxisScaleOrIdentity({
    native: nativeModelDimensions(asset),
    effective: resolveEffectiveModelDimensions(variant, asset),
  });
}

/**
 * Persisted object + variant + asset + room scale → the scales STAGE mounts.
 * Thumbnails must consume this result. They must not scale the model by a
 * second copy of the room multiplier.
 */
export function authoritativeFurnitureScale(input: Readonly<{
  assetId: string;
  variant?: VariantScaleInput;
  asset?: AssetScaleInput;
  userSizeMultiplier?: number;
  authoredImportScale?: number;
  certifiedMetricScale: number;
  roomScaleMultiplier?: number;
}>): AuthoritativeFurnitureScale {
  const modelAxisScale = stageModelAxisScale({
    assetId: input.assetId,
    variant: input.variant,
    asset: input.asset,
  });
  return {
    modelAxisScale,
    importScale: composeImportAxisScale(
      input.authoredImportScale ?? 1,
      clampUserSizeMultiplier(input.userSizeMultiplier ?? AFC_V2_USER_SIZE_DEFAULT),
      modelAxisScale,
    ),
    metricScale: effectiveMetricScale(
      input.certifiedMetricScale,
      input.roomScaleMultiplier ?? ROOM_SCALE_DEFAULT,
    ),
  };
}

/** Local mounted metres. Room scale changes camera distance, not this size. */
export function expectedRenderedModelSize(input: Readonly<{
  intrinsic: ModelSize;
  importScale: ModelAxisScale;
}>): ModelSize {
  return {
    widthM: input.intrinsic.widthM * input.importScale.x,
    heightM: input.intrinsic.heightM * input.importScale.y,
    depthM: input.intrinsic.depthM * input.importScale.z,
  };
}

export function furnitureAxisScaleOrUndefined(
  scale: ModelAxisScale | null | undefined,
): ModelAxisScale | undefined {
  if (!scale || isIdentityModelAxisScale(scale)) return undefined;
  return { x: scale.x, y: scale.y, z: scale.z };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function stageAssetDimensionFromRow(
  row: Readonly<Record<string, unknown>>,
): StageAssetModelRecord | null {
  const assetId = asTrimmedString(row.asset_id);
  const native = nativeModelDimensions({
    authoredWidthM: asNumber(row.authored_width_m) ?? Number.NaN,
    authoredHeightM: asNumber(row.authored_height_m) ?? Number.NaN,
    authoredDepthM: asNumber(row.authored_depth_m) ?? Number.NaN,
  });
  if (!assetId || !native) return null;
  return {
    assetId,
    authoredWidthM: native.widthM,
    authoredHeightM: native.heightM,
    authoredDepthM: native.depthM,
  };
}

export function stageVariantDimensionFromRow(
  row: Readonly<Record<string, unknown>>,
): StageVariantModelRecord | null {
  const variantId = asTrimmedString(row.variant_id);
  if (!variantId) return null;
  const dimensions = explicitModelDimensions({
    modelWidthM: asNumber(row.model_width_m),
    modelHeightM: asNumber(row.model_height_m),
    modelDepthM: asNumber(row.model_depth_m),
    modelSizingMode: typeof row.model_sizing_mode === "string" ? row.model_sizing_mode : null,
  });
  return {
    variantId,
    assetId: asTrimmedString(row.current_asset_id),
    ...stageVariantModelFields(dimensions),
  };
}
