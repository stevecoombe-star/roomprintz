/**
 * Meshy 7.1 furniture-generation settings.
 *
 * Capability rules follow the Image to 3D and Multi-Image to 3D parameter
 * lists (docs.meshy.ai, checked 2026-11-06). Pose controls are omitted:
 * they are for character models. Deprecated ultra_mode, hd_texture,
 * symmetry_mode, and remove_lighting are not settings. remove_lighting is
 * a Meshy 6 texture option and returns 400 with the Meshy 7 texture model.
 */

export const MESHY_V1_AI_MODEL = "meshy-7.1" as const;

export const MESHY_TEXTURE_PROMPT_MAX = 800;

export const MESHY_REMESH_POLYCOUNT_MIN = 100;

export const MESHY_REMESH_POLYCOUNT_MAX = 300_000;

export const MESHY_REMESH_POLYCOUNT_DEFAULT = 30_000;

export type MeshyGeometryResolution = "standard" | "2k" | "4k";

export type MeshyTextureResolution = "2k" | "4k" | "8k";

/** "default" omits texture_model so Meshy uses the Meshy 7 default. */
export type MeshyTextureModelChoice = "default" | "meshy-7" | "meshy-n1" | "meshy-6-lite";

export type MeshyRemeshTopology = "triangle" | "quad";

export type GeneratorCapabilityMode = "single" | "multi";

export type FurnitureGeneratorSettings = Readonly<{
  geometryResolution: MeshyGeometryResolution;
  shouldTexture: boolean;
  textureModel: MeshyTextureModelChoice;
  textureResolution: MeshyTextureResolution;
  enablePbr: boolean;
  texturePrompt: string;
  imageEnhancement: boolean;
  shouldRemesh: boolean;
  topology: MeshyRemeshTopology;
  targetPolycount: number;
}>;

export type ControlAvailability = Readonly<{
  enabled: boolean;
  reason: string | null;
}>;

export type GeneratorCapabilities = Readonly<{
  geometry: Readonly<Record<MeshyGeometryResolution, ControlAvailability>>;
  textureModel: Readonly<Record<MeshyTextureModelChoice, ControlAvailability>>;
  textureResolution: Readonly<Record<MeshyTextureResolution, ControlAvailability>>;
  enablePbr: ControlAvailability;
  texturePrompt: ControlAvailability;
  imageEnhancement: ControlAvailability;
  shouldRemesh: ControlAvailability;
  topologyQuad: ControlAvailability;
  targetPolycount: ControlAvailability;
}>;

export type GeneratorSettingsIssueCode =
  | "geometry-4k-multi"
  | "texture-model-multi"
  | "texture-resolution"
  | "pbr-without-textures"
  | "pbr-n1"
  | "quad-n1"
  | "polycount"
  | "texture-prompt-length";

export type GeneratorSettingsIssue = Readonly<{
  code: GeneratorSettingsIssueCode;
  message: string;
}>;

export type SettingsReconciliation = Readonly<{
  settings: FurnitureGeneratorSettings;
  notices: readonly string[];
  changed: boolean;
}>;

const GEOMETRY: readonly MeshyGeometryResolution[] = ["standard", "2k", "4k"];
const TEXTURE_MODELS: readonly MeshyTextureModelChoice[] = ["default", "meshy-7", "meshy-n1", "meshy-6-lite"];
const TEXTURE_RESOLUTIONS: readonly MeshyTextureResolution[] = ["2k", "4k", "8k"];

export function defaultFurnitureGeneratorSettings(): FurnitureGeneratorSettings {
  return {
    geometryResolution: "standard",
    shouldTexture: true,
    textureModel: "default",
    textureResolution: "2k",
    enablePbr: false,
    texturePrompt: "",
    imageEnhancement: true,
    shouldRemesh: false,
    topology: "triangle",
    targetPolycount: MESHY_REMESH_POLYCOUNT_DEFAULT,
  };
}

/**
 * Meshy 7.1's default texture model is Meshy 7: PBR and textures through 8K.
 * Explicit meshy-7 is the same capability. N1 and 6 Lite are 2K base color,
 * and N1 rejects PBR, text prompts, and quad remesh.
 */
export function effectiveTextureModel(
  choice: MeshyTextureModelChoice,
): "meshy-7" | "meshy-n1" | "meshy-6-lite" {
  if (choice === "meshy-n1" || choice === "meshy-6-lite") return choice;
  return "meshy-7";
}

export function generatorCapabilities(
  settings: FurnitureGeneratorSettings,
  mode: GeneratorCapabilityMode,
): GeneratorCapabilities {
  const texture = effectiveTextureModel(settings.textureModel);
  const textured = settings.shouldTexture;
  const highTexture = texture === "meshy-7";
  const geometry = {} as Record<MeshyGeometryResolution, ControlAvailability>;
  for (const value of GEOMETRY) {
    geometry[value] = value === "4k" && mode === "multi"
      ? blocked("4K Ultra geometry is available for one photo only.")
      : open();
  }
  const textureModel = {} as Record<MeshyTextureModelChoice, ControlAvailability>;
  for (const value of TEXTURE_MODELS) {
    if (!textured) {
      textureModel[value] = blocked("Turn textures on to choose a texture model.");
    } else if (value === "meshy-6-lite" && mode === "multi") {
      textureModel[value] = blocked("Multi-image texturing accepts Meshy 7 or Meshy N1.");
    } else {
      textureModel[value] = open();
    }
  }
  const textureResolution = {} as Record<MeshyTextureResolution, ControlAvailability>;
  for (const value of TEXTURE_RESOLUTIONS) {
    if (!textured) {
      textureResolution[value] = blocked("Turn textures on to choose a texture resolution.");
    } else if (value !== "2k" && !highTexture) {
      textureResolution[value] = blocked("This texture model only supports 2K textures.");
    } else {
      textureResolution[value] = open();
    }
  }
  return {
    geometry,
    textureModel,
    textureResolution,
    enablePbr: !textured
      ? blocked("Turn textures on to generate PBR maps.")
      : texture === "meshy-n1"
        ? blocked("Meshy N1 generates a base color only.")
        : open(),
    texturePrompt: !textured
      ? blocked("Turn textures on to add texture guidance.")
      : texture === "meshy-n1"
        ? blocked("Meshy N1 textures from the reference photos and ignores text guidance.")
        : open(),
    imageEnhancement: open(),
    shouldRemesh: open(),
    topologyQuad: !settings.shouldRemesh
      ? blocked("Turn remesh on to choose a topology.")
      : texture === "meshy-n1"
        ? blocked("Meshy N1 remesh is triangle only.")
        : open(),
    targetPolycount: settings.shouldRemesh
      ? open()
      : blocked("Turn remesh on to set a face target."),
  };
}

export function generatorSettingsIssues(
  settings: FurnitureGeneratorSettings,
  mode: GeneratorCapabilityMode,
): GeneratorSettingsIssue[] {
  const texture = effectiveTextureModel(settings.textureModel);
  const issues: GeneratorSettingsIssue[] = [];
  if (mode === "multi" && settings.geometryResolution === "4k") {
    issues.push({
      code: "geometry-4k-multi",
      message: "4K Ultra geometry is available for one photo only.",
    });
  }
  if (mode === "multi" && settings.textureModel === "meshy-6-lite" && settings.shouldTexture) {
    issues.push({
      code: "texture-model-multi",
      message: "Multi-image texturing accepts Meshy 7 or Meshy N1.",
    });
  }
  if (settings.shouldTexture && texture !== "meshy-7" && settings.textureResolution !== "2k") {
    issues.push({
      code: "texture-resolution",
      message: "This texture model only supports 2K textures.",
    });
  }
  if (settings.enablePbr && !settings.shouldTexture) {
    issues.push({
      code: "pbr-without-textures",
      message: "PBR maps need textures.",
    });
  }
  if (settings.enablePbr && settings.shouldTexture && texture === "meshy-n1") {
    issues.push({
      code: "pbr-n1",
      message: "Meshy N1 does not generate PBR maps.",
    });
  }
  if (settings.shouldRemesh && settings.topology === "quad" && texture === "meshy-n1") {
    issues.push({
      code: "quad-n1",
      message: "Meshy N1 remesh is triangle only.",
    });
  }
  if (settings.shouldRemesh && !validPolycount(settings.targetPolycount)) {
    issues.push({
      code: "polycount",
      message: "Remesh face target must be a whole number from 100 to 300,000.",
    });
  }
  if (
    settings.shouldTexture &&
    texture !== "meshy-n1" &&
    settings.texturePrompt.trim().length > MESHY_TEXTURE_PROMPT_MAX
  ) {
    issues.push({
      code: "texture-prompt-length",
      message: "Texture guidance must be 800 characters or fewer.",
    });
  }
  return issues;
}

/**
 * Unsupported combinations are rewritten and listed. Callers show the
 * notices. Values that are merely inactive (a prompt while N1 is selected)
 * stay stored so switching back does not lose them.
 */
export function reconcileGeneratorSettings(
  settings: FurnitureGeneratorSettings,
  mode: GeneratorCapabilityMode,
): SettingsReconciliation {
  const notices: string[] = [];
  let geometryResolution = settings.geometryResolution;
  let textureModel = settings.textureModel;
  let textureResolution = settings.textureResolution;
  let enablePbr = settings.enablePbr;
  let topology = settings.topology;

  if (mode === "multi" && geometryResolution === "4k") {
    geometryResolution = "2k";
    notices.push("4K Ultra geometry is available for one photo only. Geometry is now 2K Ultra.");
  }
  if (mode === "multi" && textureModel === "meshy-6-lite") {
    textureModel = "default";
    notices.push("Meshy 6 Lite cannot texture multi-image models. Texture model is now Meshy 7.");
  }
  const texture = effectiveTextureModel(textureModel);
  if (texture !== "meshy-7" && textureResolution !== "2k") {
    textureResolution = "2k";
    notices.push("This texture model only supports 2K textures. Texture resolution is now 2K.");
  }
  if (enablePbr && !settings.shouldTexture) {
    enablePbr = false;
    notices.push("PBR maps need textures. PBR is now off.");
  } else if (enablePbr && texture === "meshy-n1") {
    enablePbr = false;
    notices.push("Meshy N1 does not generate PBR maps. PBR is now off.");
  }
  if (settings.shouldRemesh && topology === "quad" && texture === "meshy-n1") {
    topology = "triangle";
    notices.push("Meshy N1 remesh is triangle only. Topology is now triangles.");
  }

  const next: FurnitureGeneratorSettings = {
    ...settings,
    geometryResolution,
    textureModel,
    textureResolution,
    enablePbr,
    topology,
  };
  return {
    settings: next,
    notices,
    changed: !sameSettings(settings, next),
  };
}

export function validPolycount(value: number): boolean {
  return Number.isInteger(value) &&
    value >= MESHY_REMESH_POLYCOUNT_MIN &&
    value <= MESHY_REMESH_POLYCOUNT_MAX;
}

function open(): ControlAvailability {
  return { enabled: true, reason: null };
}

function blocked(reason: string): ControlAvailability {
  return { enabled: false, reason };
}

function sameSettings(left: FurnitureGeneratorSettings, right: FurnitureGeneratorSettings): boolean {
  return left.geometryResolution === right.geometryResolution &&
    left.shouldTexture === right.shouldTexture &&
    left.textureModel === right.textureModel &&
    left.textureResolution === right.textureResolution &&
    left.enablePbr === right.enablePbr &&
    left.texturePrompt === right.texturePrompt &&
    left.imageEnhancement === right.imageEnhancement &&
    left.shouldRemesh === right.shouldRemesh &&
    left.topology === right.topology &&
    Object.is(left.targetPolycount, right.targetPolycount);
}
