/**
 * Server-side settings parser. Unknown fields, including credit and
 * ownership fields, are rejected.
 */

import type { FurnitureViewSlot } from "@/lib/vibode-furniture/generator/images";
import {
  MESHY_TEXTURE_PROMPT_MAX,
  type FurnitureGeneratorSettings,
  type MeshyGeometryResolution,
  type MeshyRemeshTopology,
  type MeshyTextureModelChoice,
  type MeshyTextureResolution,
} from "@/lib/vibode-furniture/generator/settings";

const KEYS = [
  "geometryResolution",
  "shouldTexture",
  "textureModel",
  "textureResolution",
  "enablePbr",
  "texturePrompt",
  "imageEnhancement",
  "shouldRemesh",
  "topology",
  "targetPolycount",
] as const;

const GEOMETRY = new Set<MeshyGeometryResolution>(["standard", "2k", "4k"]);
const TEXTURE_MODELS = new Set<MeshyTextureModelChoice>(["default", "meshy-7", "meshy-n1", "meshy-6-lite"]);
const TEXTURE_RESOLUTIONS = new Set<MeshyTextureResolution>(["2k", "4k", "8k"]);
const TOPOLOGY = new Set<MeshyRemeshTopology>(["triangle", "quad"]);
const SLOTS = new Set<FurnitureViewSlot>(["front", "left", "right", "back"]);

export function furnitureSettingsFromJson(value: unknown): FurnitureGeneratorSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !(KEYS as readonly string[]).includes(key))) return null;
  if (!GEOMETRY.has(record.geometryResolution as MeshyGeometryResolution)) return null;
  if (!TEXTURE_MODELS.has(record.textureModel as MeshyTextureModelChoice)) return null;
  if (!TEXTURE_RESOLUTIONS.has(record.textureResolution as MeshyTextureResolution)) return null;
  if (!TOPOLOGY.has(record.topology as MeshyRemeshTopology)) return null;
  if (typeof record.shouldTexture !== "boolean") return null;
  if (typeof record.enablePbr !== "boolean") return null;
  if (typeof record.imageEnhancement !== "boolean") return null;
  if (typeof record.shouldRemesh !== "boolean") return null;
  if (typeof record.texturePrompt !== "string" || record.texturePrompt.length > MESHY_TEXTURE_PROMPT_MAX) return null;
  if (typeof record.targetPolycount !== "number" || !Number.isInteger(record.targetPolycount)) return null;
  return {
    geometryResolution: record.geometryResolution as MeshyGeometryResolution,
    shouldTexture: record.shouldTexture,
    textureModel: record.textureModel as MeshyTextureModelChoice,
    textureResolution: record.textureResolution as MeshyTextureResolution,
    enablePbr: record.enablePbr,
    texturePrompt: record.texturePrompt,
    imageEnhancement: record.imageEnhancement,
    shouldRemesh: record.shouldRemesh,
    topology: record.topology as MeshyRemeshTopology,
    targetPolycount: record.targetPolycount,
  };
}

export function furnitureSlotsFromJson(value: unknown): FurnitureViewSlot[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) return null;
  const slots: FurnitureViewSlot[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !SLOTS.has(item as FurnitureViewSlot)) return null;
    slots.push(item as FurnitureViewSlot);
  }
  return slots;
}
