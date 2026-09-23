/**
 * PI-5D2A furniture Asset intake policy.
 *
 * Certified runtime rule: 1 GLB metre = 1 Vibode world metre.
 * Intake validates declared authored dimensions against measured
 * post-placement AABB. It does not rescale, auto-normalize, or
 * convert units.
 */

export const FURNITURE_ASSET_INTAKE_MAX_BYTES = 25 * 1024 * 1024;

export const FURNITURE_ASSET_DIMENSION_HARD_RELATIVE = 0.1;

export const FURNITURE_ASSET_DIMENSION_HARD_ABS_M = 0.05;

export const FURNITURE_ASSET_DIMENSION_WARN_RELATIVE = 0.02;

export const FURNITURE_ASSET_DIMENSION_WARN_ABS_M = 0.01;

export const FURNITURE_ASSET_PLAUSIBLE_MIN_M = 0.05;

export const FURNITURE_ASSET_PLAUSIBLE_MAX_M = 8;

export const FURNITURE_ASSET_FIXTURE_TOLERANCE_M = 1e-3;

export const FURNITURE_ASSET_ROOT_ROTATION_WARN_DEG = 5;

export const FURNITURE_ASSET_NON_UNIT_SCALE_WARN = 1e-3;

export const FURNITURE_ASSET_EXTREME_ORIGIN_ABS_M = 2;

export const FURNITURE_ASSET_ALLOWED_REQUIRED_EXTENSIONS = Object.freeze([
  "KHR_materials_unlit",
  "KHR_texture_transform",
  "KHR_materials_emissive_strength",
]);

export const FURNITURE_ASSET_DECODER_EXTENSIONS = Object.freeze([
  "KHR_draco_mesh_compression",
  "KHR_texture_basisu",
  "EXT_meshopt_compression",
  "KHR_mesh_quantization",
]);

export const FURNITURE_ASSET_LIFECYCLE = Object.freeze({
  publishedAssetIdsArePermanent: true,
  publishedFilesAreImmutable: true,
  supersedeRequiresNewAssetId: true,
  catalogMayMarkUnavailable: true,
  unavailableKeepsRuntimeSupport: true,
  doNotDeletePublishedFiles: true,
  doNotReuseAssetIds: true,
  noDeleteAutomation: true,
  sceneObjectsStoreAssetIdOnly: true,
  noAssetVersionOnSceneObjects: true,
  glbMetreEqualsWorldMetre: true,
  viewerCacheKeyIsAssetId: true,
});

export type AxisMismatchClass = "ok" | "warning" | "fail";

export function classifyAuthoredAxisMismatch(
  declaredM: number,
  measuredM: number,
): AxisMismatchClass {
  const abs = Math.abs(measuredM - declaredM);
  const rel = declaredM === 0 ? Number.POSITIVE_INFINITY : abs / Math.abs(declaredM);
  if (
    rel > FURNITURE_ASSET_DIMENSION_HARD_RELATIVE ||
    abs > FURNITURE_ASSET_DIMENSION_HARD_ABS_M
  ) {
    return "fail";
  }
  if (
    rel > FURNITURE_ASSET_DIMENSION_WARN_RELATIVE ||
    abs > FURNITURE_ASSET_DIMENSION_WARN_ABS_M
  ) {
    return "warning";
  }
  return "ok";
}

export function isPlausibleFurnitureAxisM(measuredM: number): boolean {
  return (
    Number.isFinite(measuredM) &&
    measuredM >= FURNITURE_ASSET_PLAUSIBLE_MIN_M &&
    measuredM <= FURNITURE_ASSET_PLAUSIBLE_MAX_M
  );
}

export function isAllowedRequiredExtension(name: string): boolean {
  return FURNITURE_ASSET_ALLOWED_REQUIRED_EXTENSIONS.includes(name);
}

export function isDecoderExtension(name: string): boolean {
  return (FURNITURE_ASSET_DECODER_EXTENSIONS as readonly string[]).includes(name);
}

export function publicUrlFromAssetId(assetId: string): string {
  return `/${assetId}.glb`;
}

export function defaultGlbUrlForAssetId(assetId: string): string {
  return publicUrlFromAssetId(assetId.trim());
}
