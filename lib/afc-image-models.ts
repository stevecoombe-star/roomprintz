/**
 * Canonical AFC EMPTY / TILED image-model choices.
 *
 * Browser-safe. No credentials, no network, no Node APIs.
 * Display strings and provider model IDs resolve here only.
 */

export const AFC_IMAGE_MODEL_CHOICES = [
  "nano-banana-pro",
  "gpt-image-2.5-sunburst-high",
] as const;

export type AfcImageModelChoice = (typeof AFC_IMAGE_MODEL_CHOICES)[number];

export const AFC_IMAGE_MODEL_DEFAULT: AfcImageModelChoice = "nano-banana-pro";

export const AFC_IMAGE_GENERATION_PROVENANCE_SCHEMA_VERSION =
  "afc-image-generation-provenance/v1" as const;

/** Compositor request alias. The compositor does not report a resolved model id. */
export const AFC_NANO_BANANA_PRO_REQUESTED_MODEL_ID = "NBP" as const;

export const AFC_SUNBURST_PROVIDER_MODEL_ID =
  "gpt-image-2.5-sunburst-2026-09-08" as const;

export const AFC_SUNBURST_QUALITY = "high" as const;

export const AFC_SUNBURST_MIN_PIXELS = 655_360;
export const AFC_SUNBURST_MAX_PIXELS = 8_294_400;
export const AFC_SUNBURST_MAX_EDGE = 3840;
export const AFC_SUNBURST_MAX_ASPECT = 3;
/** AFC image-pair admission tolerance. Normalization must stay inside it. */
export const AFC_SUNBURST_ASPECT_RELATIVE_TOLERANCE = 0.015;

export type AfcImageModelProvider = "nanobanana-pro" | "openai";

export type AfcImageModelResolution = Readonly<{
  choice: AfcImageModelChoice;
  displayName: string;
  provider: AfcImageModelProvider;
  /**
   * Identity recorded on generations.
   * Nano Banana Pro stays the compositor request alias "NBP".
   * Sunburst is the pinned OpenAI snapshot.
   */
  modelId: string;
  quality: typeof AFC_SUNBURST_QUALITY | null;
}>;

export type AfcImageStageProvenance = Readonly<{
  stage: "empty" | "tiled";
  choice: AfcImageModelChoice;
  displayName: string;
  provider: AfcImageModelProvider;
  modelId: string;
  quality: typeof AFC_SUNBURST_QUALITY | null;
}>;

export type AfcImageGenerationProvenance = Readonly<{
  schemaVersion: typeof AFC_IMAGE_GENERATION_PROVENANCE_SCHEMA_VERSION;
  empty: AfcImageStageProvenance;
  tiled: AfcImageStageProvenance;
}>;

export type AfcImageModelSettings = Readonly<{
  empty: AfcImageModelChoice;
  tiled: AfcImageModelChoice;
  updatedAt: string | null;
}>;

export const AFC_IMAGE_MODEL_OPTION_LIST: readonly Readonly<{
  choice: AfcImageModelChoice;
  displayName: string;
}>[] = Object.freeze([
  Object.freeze({ choice: "nano-banana-pro" as const, displayName: "Nano Banana Pro" }),
  Object.freeze({
    choice: "gpt-image-2.5-sunburst-high" as const,
    displayName: "GPT Image 2.5 Sunburst High",
  }),
]);

const RESOLUTION: Record<AfcImageModelChoice, AfcImageModelResolution> = {
  "nano-banana-pro": Object.freeze({
    choice: "nano-banana-pro",
    displayName: "Nano Banana Pro",
    provider: "nanobanana-pro",
    modelId: AFC_NANO_BANANA_PRO_REQUESTED_MODEL_ID,
    quality: null,
  }),
  "gpt-image-2.5-sunburst-high": Object.freeze({
    choice: "gpt-image-2.5-sunburst-high",
    displayName: "GPT Image 2.5 Sunburst High",
    provider: "openai",
    modelId: AFC_SUNBURST_PROVIDER_MODEL_ID,
    quality: AFC_SUNBURST_QUALITY,
  }),
};

export function isAfcImageModelChoice(value: unknown): value is AfcImageModelChoice {
  return value === "nano-banana-pro" || value === "gpt-image-2.5-sunburst-high";
}

export function resolveAfcImageModel(choice: AfcImageModelChoice): AfcImageModelResolution {
  return RESOLUTION[choice];
}

export function defaultAfcImageModelSettings(): AfcImageModelSettings {
  return Object.freeze({
    empty: AFC_IMAGE_MODEL_DEFAULT,
    tiled: AFC_IMAGE_MODEL_DEFAULT,
    updatedAt: null,
  });
}

export function afcImageStageProvenance(
  stage: "empty" | "tiled",
  choice: AfcImageModelChoice,
): AfcImageStageProvenance {
  const resolved = resolveAfcImageModel(choice);
  return Object.freeze({
    stage,
    choice: resolved.choice,
    displayName: resolved.displayName,
    provider: resolved.provider,
    modelId: resolved.modelId,
    quality: resolved.quality,
  });
}

export function afcImageGenerationProvenance(
  settings: Readonly<{ empty: AfcImageModelChoice; tiled: AfcImageModelChoice }>,
): AfcImageGenerationProvenance {
  return Object.freeze({
    schemaVersion: AFC_IMAGE_GENERATION_PROVENANCE_SCHEMA_VERSION,
    empty: afcImageStageProvenance("empty", settings.empty),
    tiled: afcImageStageProvenance("tiled", settings.tiled),
  });
}

export type AfcSunburstOutputSize =
  | Readonly<{
      ok: true;
      width: number;
      height: number;
      size: string;
      strategy: "source-dimensions" | "nano-banana-pro-1k-grid";
    }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * Nano Banana Pro default 1K output grids.
 *
 * The compositor selects the closest of these ratios and Gemini returns the
 * matching 1K pixel size. Certified TILED lineage requires that exact grid.
 * Order matches the compositor so equal distances keep the same winner.
 * 4:3 → 1200×896 and 3:4 → 896×1200 are the sizes stored for live NBP runs.
 */
const NANO_BANANA_PRO_1K_GRIDS = [
  { ratio: "1:1", aspect: 1, width: 1024, height: 1024 },
  { ratio: "3:2", aspect: 3 / 2, width: 1264, height: 848 },
  { ratio: "2:3", aspect: 2 / 3, width: 848, height: 1264 },
  { ratio: "3:4", aspect: 3 / 4, width: 896, height: 1200 },
  { ratio: "4:3", aspect: 4 / 3, width: 1200, height: 896 },
  { ratio: "4:5", aspect: 4 / 5, width: 928, height: 1152 },
  { ratio: "5:4", aspect: 5 / 4, width: 1152, height: 928 },
  { ratio: "9:16", aspect: 9 / 16, width: 768, height: 1376 },
  { ratio: "16:9", aspect: 16 / 9, width: 1376, height: 768 },
  { ratio: "21:9", aspect: 21 / 9, width: 1584, height: 672 },
] as const;

function closestNanoBananaPro1kGrid(width: number, height: number) {
  const native = width / height;
  let best: (typeof NANO_BANANA_PRO_1K_GRIDS)[number] = NANO_BANANA_PRO_1K_GRIDS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const grid of NANO_BANANA_PRO_1K_GRIDS) {
    const distance = Math.abs(native - grid.aspect);
    if (distance < bestDistance) {
      best = grid;
      bestDistance = distance;
    }
  }
  return best;
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function sunburstConstraintsMet(width: number, height: number, sourceAspect: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width < 16 || height < 16) return false;
  if (width > AFC_SUNBURST_MAX_EDGE || height > AFC_SUNBURST_MAX_EDGE) return false;
  if (width % 16 !== 0 || height % 16 !== 0) return false;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge / shortEdge > AFC_SUNBURST_MAX_ASPECT) return false;
  const pixels = width * height;
  if (pixels < AFC_SUNBURST_MIN_PIXELS || pixels > AFC_SUNBURST_MAX_PIXELS) return false;
  const relative = Math.abs(width / height - sourceAspect) / sourceAspect;
  return relative <= AFC_SUNBURST_ASPECT_RELATIVE_TOLERANCE;
}

/**
 * Output size for a Sunburst edit.
 *
 * Certified exact-grid lineage compares EMPTY and TILED pixel dimensions.
 * Nano Banana Pro TILED emits the Gemini 1K grid for the closest preset ratio,
 * not the source pixel size. Request that same grid so a Sunburst EMPTY and a
 * Nano Banana Pro TILED can share it. Keep the source size only when it is
 * already that grid. Refuse aspects outside 1:3–3:1, and refuse a preset whose
 * aspect leaves the existing 1.5% admission tolerance. Never crop.
 */
export function normalizeAfcSunburstOutputSize(
  width: number,
  height: number,
): AfcSunburstOutputSize {
  if (!positiveInteger(width) || !positiveInteger(height)) {
    return Object.freeze({
      ok: false,
      reason: "Source image dimensions are not positive integers.",
    });
  }
  const sourceAspect = width / height;
  const longOverShort = Math.max(width, height) / Math.min(width, height);
  if (longOverShort > AFC_SUNBURST_MAX_ASPECT) {
    return Object.freeze({
      ok: false,
      reason: "Source aspect ratio is outside 1:3 to 3:1. Refusing to crop.",
    });
  }
  const grid = closestNanoBananaPro1kGrid(width, height);
  if (!sunburstConstraintsMet(grid.width, grid.height, sourceAspect)) {
    return Object.freeze({
      ok: false,
      reason: "Closest Nano Banana Pro grid leaves the source aspect. Refusing to crop.",
    });
  }
  const alreadyOnGrid = width === grid.width && height === grid.height;
  return Object.freeze({
    ok: true,
    width: grid.width,
    height: grid.height,
    size: `${grid.width}x${grid.height}`,
    strategy: alreadyOnGrid ? "source-dimensions" : "nano-banana-pro-1k-grid",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const STAGE_KEYS = [
  "stage",
  "choice",
  "displayName",
  "provider",
  "modelId",
  "quality",
] as const;

const PAIR_KEYS = ["schemaVersion", "empty", "tiled"] as const;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function parseStage(
  value: unknown,
  stage: "empty" | "tiled",
): AfcImageStageProvenance | null {
  if (!isRecord(value) || !exactKeys(value, STAGE_KEYS)) return null;
  if (value.stage !== stage || !isAfcImageModelChoice(value.choice)) return null;
  const resolved = resolveAfcImageModel(value.choice);
  if (value.displayName !== resolved.displayName) return null;
  if (value.provider !== resolved.provider) return null;
  if (value.modelId !== resolved.modelId) return null;
  if (value.quality !== resolved.quality) return null;
  return afcImageStageProvenance(stage, value.choice);
}

/**
 * Reads new provenance. Missing or invalid provenance returns null so historical
 * fingerprints stay valid.
 */
/**
 * Resolves a stored TILED model id to one catalog entry.
 * Unknown ids, aliases, and future models return null.
 */
export function resolveApprovedAfcImageModelById(
  modelId: unknown,
): AfcImageModelResolution | null {
  if (typeof modelId !== "string" || modelId.length === 0) return null;
  for (const choice of AFC_IMAGE_MODEL_CHOICES) {
    const resolved = RESOLUTION[choice];
    if (resolved.modelId === modelId) return resolved;
  }
  return null;
}

/**
 * Identity fields stored beside requestedModelId.
 * Nano Banana Pro keeps the historical record: model id only.
 * Sunburst must also carry its catalog choice, provider, and quality.
 */
export function afcApprovedTiledProvenanceFields(
  choice: AfcImageModelChoice,
): Readonly<{
  imageChoice?: AfcImageModelChoice;
  imageProvider?: AfcImageModelProvider;
  imageQuality?: typeof AFC_SUNBURST_QUALITY | null;
}> {
  const resolved = resolveAfcImageModel(choice);
  if (resolved.modelId === AFC_NANO_BANANA_PRO_REQUESTED_MODEL_ID) {
    return Object.freeze({});
  }
  return Object.freeze({
    imageChoice: resolved.choice,
    imageProvider: resolved.provider,
    imageQuality: resolved.quality,
  });
}

const TILED_IDENTITY_FIELD_KEYS = ["imageChoice", "imageProvider", "imageQuality"] as const;

/**
 * Accepts only an approved catalog configuration.
 * NBP certification is the historical shape with no extra identity fields.
 * Any other approved model must match provider, choice, and quality exactly.
 */
export function certifyAfcTiledModelIdentity(
  value: Readonly<Record<string, unknown>>,
): AfcImageModelResolution | null {
  const resolved = resolveApprovedAfcImageModelById(value.requestedModelId);
  if (!resolved) return null;
  const present = TILED_IDENTITY_FIELD_KEYS.filter((key) => key in value);
  if (resolved.modelId === AFC_NANO_BANANA_PRO_REQUESTED_MODEL_ID) {
    return present.length === 0 ? resolved : null;
  }
  if (present.length !== TILED_IDENTITY_FIELD_KEYS.length) return null;
  if (value.imageChoice !== resolved.choice) return null;
  if (value.imageProvider !== resolved.provider) return null;
  if (value.imageQuality !== resolved.quality) return null;
  return resolved;
}

export type AfcStoredTiledCertification = Readonly<{
  requestedModelId: string;
  imageChoice?: AfcImageModelChoice;
  imageProvider?: AfcImageModelProvider;
  imageQuality?: typeof AFC_SUNBURST_QUALITY | null;
}>;

/**
 * Rebuilds TILED certification from the evidence that created the bytes.
 * Current admin settings are not an input.
 * Historical NBP rows may omit image-generation provenance.
 * A non-NBP model id without a matching recorded stage fails closed.
 */
export function afcTiledCertificationFromStoredEvidence(input: Readonly<{
  imageGeneration: unknown;
  lineageRequestedModelId: string | null;
  fingerprintRequestedModelId: string | null;
}>): AfcStoredTiledCertification | null {
  const recorded = parseAfcImageGenerationProvenance(input.imageGeneration);
  const lineage = input.lineageRequestedModelId;
  const fingerprintModel = input.fingerprintRequestedModelId;
  if (recorded) {
    const tiled = recorded.tiled;
    if (lineage != null && lineage !== tiled.modelId) return null;
    if (fingerprintModel != null && fingerprintModel !== tiled.modelId) return null;
    if (tiled.modelId === AFC_NANO_BANANA_PRO_REQUESTED_MODEL_ID) {
      return Object.freeze({ requestedModelId: tiled.modelId });
    }
    return Object.freeze({
      requestedModelId: tiled.modelId,
      imageChoice: tiled.choice,
      imageProvider: tiled.provider,
      imageQuality: tiled.quality,
    });
  }
  if (lineage != null && fingerprintModel != null && lineage !== fingerprintModel) {
    return null;
  }
  const modelId = lineage ?? fingerprintModel ?? AFC_NANO_BANANA_PRO_REQUESTED_MODEL_ID;
  if (modelId !== AFC_NANO_BANANA_PRO_REQUESTED_MODEL_ID) return null;
  return Object.freeze({ requestedModelId: modelId });
}

export function parseAfcImageGenerationProvenance(
  value: unknown,
): AfcImageGenerationProvenance | null {
  if (!isRecord(value) || !exactKeys(value, PAIR_KEYS)) return null;
  if (value.schemaVersion !== AFC_IMAGE_GENERATION_PROVENANCE_SCHEMA_VERSION) return null;
  const empty = parseStage(value.empty, "empty");
  const tiled = parseStage(value.tiled, "tiled");
  if (!empty || !tiled) return null;
  return Object.freeze({
    schemaVersion: AFC_IMAGE_GENERATION_PROVENANCE_SCHEMA_VERSION,
    empty,
    tiled,
  });
}
