/**
 * Meshy 7.1 Image-to-3D and Multi-Image-to-3D credit estimates.
 *
 * Pricing page checked 2026-11-06:
 * mesh only 20, 2K or 4K textures 30, 8K textures 35,
 * Ultra geometry (`2k` or `4k`) adds 5.
 * OpenAPI says a non-default texture model does not change that price.
 * `consumed_credits` on the task is the only actual charge. This estimate
 * is the reservation, not a client-declared cost.
 */

import type { FurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";
import { effectiveTextureModel } from "@/lib/vibode-furniture/generator/settings";

import { MESHY_TEST_CREDIT_CEILING } from "./policy";

export type MeshyGenerationOperation = "image-to-3d" | "multi-image-to-3d";

export function estimateMeshy71Credits(
  settings: FurnitureGeneratorSettings,
  operation: MeshyGenerationOperation,
): number | null {
  if (operation !== "image-to-3d" && operation !== "multi-image-to-3d") return null;
  if (operation === "multi-image-to-3d" && settings.geometryResolution === "4k") return null;
  const texture = effectiveTextureModel(settings.textureModel);
  if (settings.shouldTexture && texture !== "meshy-7" && settings.textureResolution !== "2k") {
    return null;
  }
  let credits = 20;
  if (settings.shouldTexture) {
    if (settings.textureResolution === "8k") credits = 35;
    else if (settings.textureResolution === "2k" || settings.textureResolution === "4k") credits = 30;
    else return null;
  }
  if (settings.geometryResolution === "2k" || settings.geometryResolution === "4k") credits += 5;
  if (credits > MESHY_TEST_CREDIT_CEILING) return null;
  return credits;
}
