/**
 * Provider-free image-pair compatibility policy shared by Empty-Room Assist,
 * AFC-R3C composition, and AFC-UI2A package authority.
 *
 * Formula parity source:
 * app/api/admin/3d-room-lab/empty-room-assist/run/route.ts classifyCompatibility
 */
export const AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION = "afc-r3c-image-pair-compatibility/v1" as const;
export const AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE = 0.015;

export type AfcR3cCompatibilityTier =
  | "exact_grid_compatible"
  | "aspect_compatible_rescaled"
  | "incompatible";

export type AfcR3cDecodedImage = Readonly<{
  fingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: number;
}>;

export type AfcR3cImagePairCompatibility = Readonly<{
  version: typeof AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION;
  tier: AfcR3cCompatibilityTier;
  originalDecodedDimensions: Readonly<{ width: number; height: number }> | null;
  inputDecodedDimensions: Readonly<{ width: number; height: number }> | null;
  originalOrientation: number | null;
  inputOrientation: number | null;
  originalAspect: number | null;
  inputAspect: number | null;
  /** Exact finite JavaScript value used for the compatibility admission gate. */
  relativeAspectErrorRaw: number | null;
  /** Production-route parity report rounded to four decimals. */
  relativeAspectError: number | null;
  reason: string | null;
}>;

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (visited.has(object)) return value;
    visited.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, visited);
    if (!Object.isFrozen(object)) Object.freeze(object);
  }
  return value;
}
function finitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}
function round4(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? value : Number(value.toFixed(4));
}
function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function dimensions(image: AfcR3cDecodedImage): { width: number; height: number } {
  return { width: image.decodedWidth, height: image.decodedHeight };
}
function validImage(image: unknown): image is AfcR3cDecodedImage {
  return !!image && typeof image === "object" && validFingerprint((image as AfcR3cDecodedImage).fingerprint) &&
    finitePositiveInteger((image as AfcR3cDecodedImage).decodedWidth) &&
    finitePositiveInteger((image as AfcR3cDecodedImage).decodedHeight) &&
    Number.isFinite((image as AfcR3cDecodedImage).orientation);
}

/**
 * Exact formula/boundary parity with route-local classifyCompatibility:
 * |inputAspect - originalAspect| / originalAspect, accepted at <= 0.015.
 */
export function classifyAfcR3cImagePairCompatibility(
  original: AfcR3cDecodedImage,
  input: AfcR3cDecodedImage,
): AfcR3cImagePairCompatibility {
  if (!validImage(original) || !validImage(input)) {
    return deepFreeze({
      version: AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION, tier: "incompatible",
      originalDecodedDimensions: validImage(original) ? dimensions(original) : null,
      inputDecodedDimensions: validImage(input) ? dimensions(input) : null,
      originalOrientation: validImage(original) ? original.orientation : null,
      inputOrientation: validImage(input) ? input.orientation : null,
      originalAspect: null, inputAspect: null,
      relativeAspectErrorRaw: null, relativeAspectError: null,
      reason: "Image metadata is invalid for transfer.",
    });
  }
  const originalAspect = original.decodedWidth / original.decodedHeight;
  const inputAspect = input.decodedWidth / input.decodedHeight;
  const relativeAspectError = Math.abs(inputAspect - originalAspect) / originalAspect;
  const shared = {
    version: AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION,
    originalDecodedDimensions: dimensions(original),
    inputDecodedDimensions: dimensions(input),
    originalOrientation: original.orientation,
    inputOrientation: input.orientation,
    originalAspect: round4(originalAspect),
    inputAspect: round4(inputAspect),
    relativeAspectErrorRaw: relativeAspectError,
    relativeAspectError: round4(relativeAspectError),
  } as const;
  if (original.orientation !== 1 || input.orientation !== 1) {
    return deepFreeze({ ...shared, tier: "incompatible" as const, reason: "Image orientation is not supported for calibration transfer." });
  }
  if (original.decodedWidth === input.decodedWidth && original.decodedHeight === input.decodedHeight) {
    return deepFreeze({ ...shared, tier: "exact_grid_compatible" as const, reason: null });
  }
  if (relativeAspectError <= AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE) {
    return deepFreeze({ ...shared, tier: "aspect_compatible_rescaled" as const, reason: null });
  }
  return deepFreeze({ ...shared, tier: "incompatible" as const, reason: "Input image aspect ratio diverges too far for transfer." });
}
