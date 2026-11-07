/**
 * Future Meshy request mapping. MESHY-1C owns the server-side adapter.
 *
 * This module never calls Meshy, never reads credentials, and never embeds
 * image bytes. The server must turn `imageSlots` into `image_url` or
 * `image_urls` after it has its own copies of the photos. Front is first.
 *
 * Meshy outputs are not bounded by Vibode's current 25 MiB GLB intake.
 * MESHY-1C.1 keeps that ceiling, rejects anything larger, and does not skip
 * GLB validation. Raising the ceiling or optimizing the file is a later slice.
 * The server adapter attaches image bytes and the reconciliation task name.
 * This module still does not call Meshy.
 */

import { PERSONAL_FURNITURE_GLB_MAX_BYTES } from "@/lib/vibode-furniture/asset-id";

import {
  furnitureInputMode,
  orderedViewSlots,
  type FurniturePhotoSet,
  type FurnitureViewSlot,
} from "./images";
import {
  effectiveTextureModel,
  generatorSettingsIssues,
  MESHY_V1_AI_MODEL,
  type FurnitureGeneratorSettings,
  type MeshyGeometryResolution,
  type MeshyRemeshTopology,
  type MeshyTextureResolution,
} from "./settings";

export const MESHY_OUTPUT_INTAKE_NOTE =
  "Meshy GLB outputs may exceed 25 MiB. MESHY-1C.1 keeps the personal furniture ceiling, rejects larger files, and does not skip GLB validation.";

export type MeshyGenerationBody = Readonly<{
  model_type: "standard";
  ai_model: typeof MESHY_V1_AI_MODEL;
  geometry_resolution: MeshyGeometryResolution;
  should_texture: boolean;
  image_enhancement: boolean;
  should_remesh: boolean;
  target_formats: readonly ["glb"];
  texture_model?: "meshy-7" | "meshy-n1" | "meshy-6-lite";
  texture_resolution?: MeshyTextureResolution;
  enable_pbr?: boolean;
  texture_prompt?: string;
  topology?: MeshyRemeshTopology;
  target_polycount?: number;
}>;

export type MeshyGenerationDraft = Readonly<{
  provider: "meshy";
  aiModel: typeof MESHY_V1_AI_MODEL;
  operation: "image-to-3d" | "multi-image-to-3d";
  endpoint: "/openapi/v1/image-to-3d" | "/openapi/v1/multi-image-to-3d";
  imageSlots: readonly FurnitureViewSlot[];
  body: MeshyGenerationBody;
  intakeLimitBytes: number;
  intakeNote: string;
}>;

export function mapMeshyGenerationDraft(input: Readonly<{
  photos: FurniturePhotoSet;
  settings: FurnitureGeneratorSettings;
}>): { ok: true; draft: MeshyGenerationDraft } | { ok: false; errors: readonly string[] } {
  const mode = furnitureInputMode(input.photos);
  if (mode === "incomplete") {
    return { ok: false, errors: ["A front photo is required."] };
  }
  const issues = generatorSettingsIssues(input.settings, mode);
  if (issues.length > 0) {
    return { ok: false, errors: issues.map((issue) => issue.message) };
  }

  const texture = effectiveTextureModel(input.settings.textureModel);
  const body: {
    model_type: "standard";
    ai_model: typeof MESHY_V1_AI_MODEL;
    geometry_resolution: MeshyGeometryResolution;
    should_texture: boolean;
    image_enhancement: boolean;
    should_remesh: boolean;
    target_formats: ["glb"];
    texture_model?: "meshy-7" | "meshy-n1" | "meshy-6-lite";
    texture_resolution?: MeshyTextureResolution;
    enable_pbr?: boolean;
    texture_prompt?: string;
    topology?: MeshyRemeshTopology;
    target_polycount?: number;
  } = {
    model_type: "standard",
    ai_model: MESHY_V1_AI_MODEL,
    geometry_resolution: input.settings.geometryResolution,
    should_texture: input.settings.shouldTexture,
    image_enhancement: input.settings.imageEnhancement,
    should_remesh: input.settings.shouldRemesh,
    target_formats: ["glb"],
  };

  if (input.settings.shouldTexture) {
    if (input.settings.textureModel !== "default") {
      body.texture_model = input.settings.textureModel;
    }
    body.texture_resolution = input.settings.textureResolution;
    // N1 rejects enable_pbr: true. Omit the flag; the API default is false.
    if (texture !== "meshy-n1") body.enable_pbr = input.settings.enablePbr;
    const prompt = input.settings.texturePrompt.trim();
    if (prompt && texture !== "meshy-n1") body.texture_prompt = prompt;
  }
  if (input.settings.shouldRemesh) {
    body.topology = input.settings.topology;
    body.target_polycount = input.settings.targetPolycount;
  }

  return {
    ok: true,
    draft: {
      provider: "meshy",
      aiModel: MESHY_V1_AI_MODEL,
      operation: mode === "single" ? "image-to-3d" : "multi-image-to-3d",
      endpoint: mode === "single" ? "/openapi/v1/image-to-3d" : "/openapi/v1/multi-image-to-3d",
      imageSlots: orderedViewSlots(input.photos),
      body,
      intakeLimitBytes: PERSONAL_FURNITURE_GLB_MAX_BYTES,
      intakeNote: MESHY_OUTPUT_INTAKE_NOTE,
    },
  };
}
