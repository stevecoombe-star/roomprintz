/**
 * Runtime lookup for Variant physical scale.
 *
 * scene-runtime applies this once on the import wrapper, together with the
 * authored import scale and the shopper size multiplier. It does not import
 * the Partner catalog. The STAGE viewport registers the lookup.
 */

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

export type ModelAxisScaleLookup = (input: Readonly<{
  assetId: string;
  variantId?: string;
}>) => ModelAxisScale | null;

let modelAxisScaleLookup: ModelAxisScaleLookup | null = null;

export function isIdentityModelAxisScale(scale: ModelAxisScale): boolean {
  return scale.x === 1 && scale.y === 1 && scale.z === 1;
}

export function isModelAxisScale(value: unknown): value is ModelAxisScale {
  if (!value || typeof value !== "object") return false;
  const scale = value as ModelAxisScale;
  return [scale.x, scale.y, scale.z].every((axis) => Number.isFinite(axis) && axis > 0);
}

export function composeImportAxisScale(
  authoredImportScale: number,
  userSizeMultiplier: number,
  modelAxisScale: ModelAxisScale,
): ModelAxisScale {
  const authored = Number.isFinite(authoredImportScale) && authoredImportScale > 0
    ? authoredImportScale
    : 1;
  const user = Number.isFinite(userSizeMultiplier) && userSizeMultiplier > 0
    ? userSizeMultiplier
    : 1;
  return {
    x: authored * user * modelAxisScale.x,
    y: authored * user * modelAxisScale.y,
    z: authored * user * modelAxisScale.z,
  };
}

export function registerModelAxisScaleLookup(next: ModelAxisScaleLookup | null): () => void {
  const previous = modelAxisScaleLookup;
  modelAxisScaleLookup = next;
  return () => {
    if (modelAxisScaleLookup === next) modelAxisScaleLookup = previous;
  };
}

export function resolveMountedModelAxisScale(input: Readonly<{
  assetId: string;
  variantId?: string;
  explicit?: ModelAxisScale | null;
}>): ModelAxisScale {
  if (input.explicit && isModelAxisScale(input.explicit)) return input.explicit;
  const found = modelAxisScaleLookup?.({
    assetId: input.assetId,
    variantId: input.variantId,
  }) ?? null;
  if (found && isModelAxisScale(found)) return found;
  return MODEL_AXIS_SCALE_IDENTITY;
}

type PlacementFootprintIntent = Readonly<{
  token: number;
  assetId: string;
  scale: ModelAxisScale;
}>;

type ScenePlacementFootprint = Readonly<{
  assetId: string;
  scale: ModelAxisScale;
}>;

let placementIntentToken = 0;
const placementIntents: PlacementFootprintIntent[] = [];
let scenePlacementFootprints = new Map<string, ScenePlacementFootprint>();
let scenePlacementEpoch = 0;

/**
 * The placement search runs inside the frozen scene host, which only knows
 * the Asset id. The caller records the Variant's derived scale first.
 * The search consumes the oldest matching intent. Cancelling removes an
 * intent the search never reached.
 */
export function beginPlacementFootprint(input: Readonly<{
  assetId: string;
  scale: ModelAxisScale;
}>): () => void {
  if (!input.assetId || !isModelAxisScale(input.scale)) return () => undefined;
  const token = ++placementIntentToken;
  placementIntents.push({ token, assetId: input.assetId, scale: input.scale });
  return () => {
    const index = placementIntents.findIndex((item) => item.token === token);
    if (index >= 0) placementIntents.splice(index, 1);
  };
}

export function takePlacementFootprintScale(assetId: string): ModelAxisScale | null {
  const index = placementIntents.findIndex((item) => item.assetId === assetId);
  if (index < 0) return null;
  const [intent] = placementIntents.splice(index, 1);
  return intent?.scale ?? null;
}

export function scenePlacementFootprint(objectId: string): ScenePlacementFootprint | null {
  return scenePlacementFootprints.get(objectId) ?? null;
}

export function replaceScenePlacementFootprints(
  entries: readonly (ScenePlacementFootprint & Readonly<{ objectId: string }>)[],
): () => void {
  const epoch = ++scenePlacementEpoch;
  scenePlacementFootprints = new Map(entries.map((entry) => [
    entry.objectId,
    { assetId: entry.assetId, scale: entry.scale },
  ]));
  return () => {
    if (scenePlacementEpoch === epoch) scenePlacementFootprints = new Map();
  };
}
