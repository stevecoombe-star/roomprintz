/**
 * HARMONIZE-1 export package.
 *
 * STAGE geometry stays authoritative. A is the room image currently shown
 * behind furniture. B, C, and D are drawn on that image's pixel grid. The
 * certified camera keeps its frame aspect. Normalized coordinates map onto
 * that grid. This module does not crop, letterbox, or resample A.
 */

import {
  AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE,
  classifyAfcR3cImagePairCompatibility,
} from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";

export const HARMONIZE_EXPORT_VERSION = "harmonize-export/1" as const;

/** Same admission bound as AFC image-pair compatibility. */
export const HARMONIZE_ASPECT_RELATIVE_TOLERANCE = AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE;

export const HARMONIZE_EMPTY_PATH = "/api/vibode/admin/harmonize-export/empty";

export const HARMONIZE_EXPORT_FILES = Object.freeze({
  backgroundPng: "A-viewport-background.png",
  backgroundJpeg: "A-viewport-background.jpg",
  empty: "A-original-empty.png",
  composite: "B-stage-composite.png",
  furniture: "C-furniture-only.png",
  matte: "D-furniture-matte.png",
  referenceEmpty: "E-authoritative-empty.png",
  manifest: "manifest.json",
});

export const HARMONIZE_EXPORT_LIMITATIONS = Object.freeze([
  "STAGE does not render room occluder meshes. Furniture hidden only by the photograph stays visible. Furniture-furniture depth occlusion is included.",
  "Vibode contact shadows, selection outlines, transform gizmos, and the trusted-path overlay are excluded from B, C, and D.",
  "A is the active STAGE viewport background and is not resampled. B, C, and D are new PNGs on that same pixel grid. Uncovered pixels in B match those decoded samples.",
  "The certified camera keeps its frame aspect, vertical FOV, and pose. Normalized image coordinates map onto the viewport background grid. The live viewport is unchanged.",
  "D marks a pixel white when furniture alpha is greater than zero, including antialiased edges.",
  "Certified EMPTY is included as E only when it is not already the active viewport background. E is a reference file and is not the harmonization background.",
]);

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export class HarmonizeExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarmonizeExportError";
  }
}

export type HarmonizeVec3 = Readonly<{ x: number; y: number; z: number }>;

export type HarmonizeExportCamera = Readonly<{
  projection: "frozen-production-perspective";
  verticalFovDeg: number;
  aspect: number;
  near: number;
  far: number;
  frame: Readonly<{ width: number; height: number }>;
  pose: Readonly<{
    position: HarmonizeVec3;
    lookAt: HarmonizeVec3;
    up: HarmonizeVec3;
  }>;
}>;

export type HarmonizeExportObject = Readonly<{
  objectId: string;
  assetId: string;
  productId: string | null;
  variantId: string | null;
  positionM: HarmonizeVec3;
  rotationDeg: HarmonizeVec3;
  userSizeMultiplier: number;
  effectiveDimensionsM: Readonly<{
    width: number;
    height: number;
    depth: number;
  }> | null;
}>;

export type HarmonizeFurnitureCapture = Readonly<{
  rgba: Uint8Array;
  width: number;
  height: number;
  contactShadowsHidden: number;
  objects: readonly HarmonizeExportObject[];
  unmountedObjectIds: readonly string[];
  camera: HarmonizeExportCamera;
  roomScaleMultiplier: number;
  certifiedMetricScale: number;
  effectiveMetricScale: number;
  generationId: string;
}>;

export type HarmonizeFurnitureCapturer = (
  input: Readonly<{ width: number; height: number; orientation: number }>,
) => HarmonizeFurnitureCapture;

export type HarmonizeBackgroundSource = "empty" | "original" | "room-state";

export type HarmonizeBackgroundMediaType = "image/png" | "image/jpeg";

export type HarmonizeExportAuthority = Readonly<{
  generationId: string;
  empty: Readonly<{
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation?: number;
  }>;
  original?: Readonly<{
    sha256?: string;
    orientation?: number;
  }>;
  frame: Readonly<{ width: number; height: number }>;
  frozenCamera: Readonly<{
    frame: Readonly<{ width: number; height: number }>;
  }>;
}>;

export type HarmonizeCompatibilityTier =
  | "exact_grid_compatible"
  | "aspect_compatible_rescaled";

export type HarmonizeFrameSuccess = Readonly<{
  ok: true;
  width: number;
  height: number;
  certifiedFrame: Readonly<{ width: number; height: number }>;
  compatibilityTier: HarmonizeCompatibilityTier;
  relativeAspectError: number;
  mapping: "identity-normalized";
  exportResolutionSource: "active-viewport";
  backgroundResampled: false;
  cameraProjectionModified: false;
}>;

export type HarmonizeFrameDecision =
  | HarmonizeFrameSuccess
  | Readonly<{ ok: false; reason: string }>;

export type HarmonizeImageRecord = Readonly<{
  role: "viewport-background" | "authoritative-empty" | "stage-composite" | "furniture-rgba" | "furniture-matte";
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
  reencoded: boolean;
}>;

export type HarmonizeManifest = Readonly<{
  exportVersion: typeof HARMONIZE_EXPORT_VERSION;
  roomId: string;
  generatedAt: string;
  generationId: string;
  roomScaleMultiplier: number;
  certifiedMetricScale: number;
  effectiveMetricScale: number;
  alignment: Readonly<{
    background: Readonly<{
      source: HarmonizeBackgroundSource;
      width: number;
      height: number;
      matchesEmpty: boolean;
      matchesOriginal: boolean;
    }>;
    certifiedFrame: Readonly<{ width: number; height: number }>;
    compatibilityTier: HarmonizeCompatibilityTier;
    relativeAspectError: number;
    mapping: "identity-normalized";
    exportResolutionSource: "active-viewport";
    backgroundResampled: false;
    cameraProjectionModified: false;
    backgroundMatchesCertifiedFrame: boolean;
  }>;
  emptyReference: "same-as-background" | "included" | "unavailable";
  camera: HarmonizeExportCamera;
  images: Readonly<Record<string, HarmonizeImageRecord>>;
  contactShadows: "excluded";
  contactShadowsHidden: number;
  selectionDecorations: "excluded";
  roomOccluders: "none-in-stage-renderer";
  objects: readonly HarmonizeExportObject[];
  unmountedObjectIds: readonly string[];
  sceneSnapshotSha256: string;
  limitations: readonly string[];
}>;

type PngSize = Readonly<{ width: number; height: number }>;

export function harmonizeExportErrorMessage(error: unknown): string {
  if (error instanceof HarmonizeExportError && error.message.trim()) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Harmonize export failed.";
}

export function harmonizeExportFileName(roomId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomId)) {
    throw new HarmonizeExportError("Room id is not a valid identifier.");
  }
  return `vibode-harmonize-${roomId}.zip`;
}

function positivePixelSize(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function requireHarmonizePixelFrame(
  frame: Readonly<{ width: number; height: number }> | null | undefined,
  message: string,
): Readonly<{ width: number; height: number }> {
  if (frame == null || !positivePixelSize(frame.width) || !positivePixelSize(frame.height)) {
    throw new HarmonizeExportError(message);
  }
  return frame;
}

export function harmonizeAlignmentRecord(
  decision: HarmonizeFrameSuccess,
  identity: Readonly<{
    source: HarmonizeBackgroundSource;
    matchesEmpty: boolean;
    matchesOriginal: boolean;
  }>,
): HarmonizeManifest["alignment"] {
  const certifiedFrame = requireHarmonizePixelFrame(
    decision == null ? undefined : decision.certifiedFrame,
    "Export decision has no certified camera frame. Export stopped instead of scaling.",
  );
  if (
    identity == null
    || (identity.source !== "empty" && identity.source !== "original" && identity.source !== "room-state")
  ) {
    throw new HarmonizeExportError(
      "Export decision is missing. Export stopped instead of scaling.",
    );
  }
  return {
    background: {
      source: identity.source,
      width: decision.width,
      height: decision.height,
      matchesEmpty: identity.matchesEmpty,
      matchesOriginal: identity.matchesOriginal,
    },
    certifiedFrame: { width: certifiedFrame.width, height: certifiedFrame.height },
    compatibilityTier: decision.compatibilityTier,
    relativeAspectError: decision.relativeAspectError,
    mapping: "identity-normalized",
    exportResolutionSource: "active-viewport",
    backgroundResampled: false,
    cameraProjectionModified: false,
    backgroundMatchesCertifiedFrame: decision.compatibilityTier === "exact_grid_compatible",
  };
}

export function certifiedCameraAspectMatches(
  camera: HarmonizeExportCamera,
  certifiedFrame: Readonly<{ width: number; height: number }> | null | undefined,
): boolean {
  const certified = requireHarmonizePixelFrame(
    certifiedFrame,
    "Export decision has no certified camera frame. Export stopped instead of scaling.",
  );
  const cameraFrame = requireHarmonizePixelFrame(
    camera == null ? undefined : camera.frame,
    "Export camera has no certified frame. Export stopped instead of scaling.",
  );
  const aspect = certified.width / certified.height;
  return cameraFrame.width === certified.width
    && cameraFrame.height === certified.height
    && Number.isFinite(camera.aspect)
    && Math.abs(camera.aspect - aspect) <= 1e-9
    && Number.isFinite(camera.verticalFovDeg);
}

export function decideHarmonizeExportFrame(input: Readonly<{
  imageWidth: number;
  imageHeight: number;
  frameWidth: number;
  frameHeight: number;
  authorityFrameWidth: number;
  authorityFrameHeight: number;
  imageOrientation?: number;
  originalOrientation?: number;
  subject?: "viewport-background" | "empty";
}>): HarmonizeFrameDecision {
  const subject = input.subject ?? "viewport-background";
  const label = subject === "empty" ? "EMPTY" : "Viewport background";
  const sizes = [
    input.imageWidth,
    input.imageHeight,
    input.frameWidth,
    input.frameHeight,
    input.authorityFrameWidth,
    input.authorityFrameHeight,
  ];
  if (!sizes.every(positivePixelSize)) {
    return {
      ok: false,
      reason: `${label} and camera frame dimensions must be positive integers. Export stopped instead of scaling.`,
    };
  }
  const imageOrientation = input.imageOrientation ?? 1;
  const originalOrientation = input.originalOrientation ?? 1;
  if (imageOrientation !== 1 || (subject === "empty" && originalOrientation !== 1)) {
    return {
      ok: false,
      reason: "Image orientation is not supported. Export stopped instead of scaling.",
    };
  }
  const byteLength = input.imageWidth * input.imageHeight * 4;
  if (!Number.isSafeInteger(byteLength)) {
    return {
      ok: false,
      reason: `${label} is ${input.imageWidth}×${input.imageHeight}. Export stopped instead of scaling.`,
    };
  }
  if (
    input.frameWidth !== input.authorityFrameWidth
    || input.frameHeight !== input.authorityFrameHeight
  ) {
    return {
      ok: false,
      reason: "Certified camera frame does not match the room authority. Export stopped instead of scaling.",
    };
  }
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: "certified-frame",
      decodedWidth: input.frameWidth,
      decodedHeight: input.frameHeight,
      orientation: 1,
    },
    {
      fingerprint: subject === "empty" ? "empty" : "viewport-background",
      decodedWidth: input.imageWidth,
      decodedHeight: input.imageHeight,
      orientation: 1,
    },
  );
  if (
    compatibility.tier === "incompatible"
    || compatibility.relativeAspectErrorRaw === null
    || compatibility.relativeAspectErrorRaw > HARMONIZE_ASPECT_RELATIVE_TOLERANCE
  ) {
    return {
      ok: false,
      reason: `${label} is ${input.imageWidth}×${input.imageHeight}, certified camera frame is ${input.frameWidth}×${input.frameHeight}. Export stopped instead of scaling.`,
    };
  }
  return {
    ok: true,
    width: input.imageWidth,
    height: input.imageHeight,
    certifiedFrame: { width: input.frameWidth, height: input.frameHeight },
    compatibilityTier: compatibility.tier,
    relativeAspectError: compatibility.relativeAspectErrorRaw,
    mapping: "identity-normalized",
    exportResolutionSource: "active-viewport",
    backgroundResampled: false,
    cameraProjectionModified: false,
  };
}

export function classifyHarmonizeBackground(input: Readonly<{
  sha256: string;
  emptySha256: string;
  originalSha256?: string | null;
  backgroundUrl: string;
  originalImageUrl?: string | null;
}>): Readonly<{
  source: HarmonizeBackgroundSource;
  matchesEmpty: boolean;
  matchesOriginal: boolean;
}> {
  const matchesEmpty = shaMatches(input.sha256, input.emptySha256);
  const matchesOriginal = shaMatches(input.sha256, input.originalSha256)
    || samePresentationUrl(input.backgroundUrl, input.originalImageUrl);
  const source: HarmonizeBackgroundSource = matchesEmpty
    ? "empty"
    : matchesOriginal
      ? "original"
      : "room-state";
  return { source, matchesEmpty, matchesOriginal };
}

export function harmonizeBackgroundFileName(input: Readonly<{
  source: HarmonizeBackgroundSource;
  mediaType: HarmonizeBackgroundMediaType;
}>): string {
  if (input.source === "empty") {
    if (input.mediaType !== "image/png") {
      throw new HarmonizeExportError("Authoritative EMPTY image failed integrity checks.");
    }
    return HARMONIZE_EXPORT_FILES.empty;
  }
  return input.mediaType === "image/jpeg"
    ? HARMONIZE_EXPORT_FILES.backgroundJpeg
    : HARMONIZE_EXPORT_FILES.backgroundPng;
}

export function harmonizeBackgroundMediaType(
  bytes: Uint8Array,
): HarmonizeBackgroundMediaType | null {
  if (hasPngSignature(bytes)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

function shaMatches(actual: string, expected: string | null | undefined): boolean {
  if (!expected || !/^[0-9a-f]{64}$/i.test(expected)) return false;
  return actual.toLowerCase() === expected.toLowerCase();
}

function samePresentationUrl(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = typeof left === "string" ? left.trim() : "";
  const b = typeof right === "string" ? right.trim() : "";
  return a.length > 0 && a === b;
}

export function harmonizeScaleRefusal(input: Readonly<{
  actualWidth: number;
  actualHeight: number;
  expectedWidth: number;
  expectedHeight: number;
}>): string | null {
  if (
    input.actualWidth === input.expectedWidth
    && input.actualHeight === input.expectedHeight
  ) {
    return null;
  }
  return `Export buffer is ${input.actualWidth}×${input.actualHeight}, expected ${input.expectedWidth}×${input.expectedHeight}. Export stopped instead of scaling.`;
}

function finiteVec(value: HarmonizeVec3): boolean {
  return [value.x, value.y, value.z].every(Number.isFinite);
}

function copyVec(value: HarmonizeVec3): HarmonizeVec3 {
  return { x: value.x, y: value.y, z: value.z };
}

export function harmonizeExportObject(input: Readonly<{
  objectId: string;
  assetId: string;
  productId?: string | null;
  variantId?: string | null;
  positionM: HarmonizeVec3;
  rotationDeg: HarmonizeVec3;
  userSizeMultiplier: number;
  localAabb: Readonly<{
    min: HarmonizeVec3;
    max: HarmonizeVec3;
  }> | null;
}>): HarmonizeExportObject {
  if (!input.objectId || !input.assetId) {
    throw new HarmonizeExportError("STAGE object identity is incomplete.");
  }
  if (!finiteVec(input.positionM) || !finiteVec(input.rotationDeg)) {
    throw new HarmonizeExportError("STAGE object transform is not finite.");
  }
  if (!Number.isFinite(input.userSizeMultiplier)) {
    throw new HarmonizeExportError("STAGE object size is not finite.");
  }
  let effectiveDimensionsM: HarmonizeExportObject["effectiveDimensionsM"] = null;
  if (input.localAabb) {
    const width = input.localAabb.max.x - input.localAabb.min.x;
    const height = input.localAabb.max.y - input.localAabb.min.y;
    const depth = input.localAabb.max.z - input.localAabb.min.z;
    if ([width, height, depth].every((axis) => Number.isFinite(axis) && axis > 0)) {
      effectiveDimensionsM = { width, height, depth };
    }
  }
  return {
    objectId: input.objectId,
    assetId: input.assetId,
    productId: input.productId ?? null,
    variantId: input.variantId ?? null,
    positionM: copyVec(input.positionM),
    rotationDeg: copyVec(input.rotationDeg),
    userSizeMultiplier: input.userSizeMultiplier,
    effectiveDimensionsM,
  };
}

export function sortHarmonizeObjects(
  objects: readonly HarmonizeExportObject[],
): HarmonizeExportObject[] {
  return [...objects].sort((left, right) => (
    left.objectId < right.objectId ? -1 : left.objectId > right.objectId ? 1 : 0
  ));
}

export function harmonizeCameraRecord(input: Readonly<{
  verticalFovDeg: number;
  aspect: number;
  near: number;
  far: number;
  frame: Readonly<{ width: number; height: number }>;
  pose: HarmonizeExportCamera["pose"];
}>): HarmonizeExportCamera {
  const frame = requireHarmonizePixelFrame(
    input == null ? undefined : input.frame,
    "Certified camera frame is missing from the STAGE scene. Export stopped instead of scaling.",
  );
  return {
    projection: "frozen-production-perspective",
    verticalFovDeg: input.verticalFovDeg,
    aspect: input.aspect,
    near: input.near,
    far: input.far,
    frame: { width: frame.width, height: frame.height },
    pose: {
      position: copyVec(input.pose.position),
      lookAt: copyVec(input.pose.lookAt),
      up: copyVec(input.pose.up),
    },
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function harmonizeSceneCanonical(input: Readonly<{
  generationId: string;
  roomScaleMultiplier: number;
  certifiedMetricScale: number;
  effectiveMetricScale: number;
  camera: HarmonizeExportCamera;
  objects: readonly HarmonizeExportObject[];
  unmountedObjectIds: readonly string[];
}>): string {
  return canonicalJson({
    generationId: input.generationId,
    roomScaleMultiplier: input.roomScaleMultiplier,
    certifiedMetricScale: input.certifiedMetricScale,
    effectiveMetricScale: input.effectiveMetricScale,
    camera: input.camera,
    objects: input.objects,
    unmountedObjectIds: input.unmountedObjectIds,
  });
}

export function compositeFurnitureOverRoom(
  room: Uint8Array,
  furniture: Uint8Array,
): Uint8Array {
  if (room.length !== furniture.length || room.length % 4 !== 0) {
    throw new HarmonizeExportError("Composite images do not match.");
  }
  const out = new Uint8Array(room.length);
  for (let index = 0; index < room.length; index += 4) {
    const sourceAlpha = furniture[index + 3] / 255;
    const destinationAlpha = room[index + 3] / 255;
    const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    const channel = (source: number, destination: number) => {
      if (outAlpha === 0) return 0;
      return Math.round(
        (source * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha)) / outAlpha,
      );
    };
    out[index] = channel(furniture[index], room[index]);
    out[index + 1] = channel(furniture[index + 1], room[index + 1]);
    out[index + 2] = channel(furniture[index + 2], room[index + 2]);
    out[index + 3] = Math.round(outAlpha * 255);
  }
  return out;
}

export function furnitureMatteRgba(furniture: Uint8Array): Uint8Array {
  if (furniture.length % 4 !== 0) {
    throw new HarmonizeExportError("Furniture image is not RGBA.");
  }
  const out = new Uint8Array(furniture.length);
  for (let index = 0; index < furniture.length; index += 4) {
    const visible = furniture[index + 3] > 0 ? 255 : 0;
    out[index] = visible;
    out[index + 1] = visible;
    out[index + 2] = visible;
    out[index + 3] = 255;
  }
  return out;
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", arrayBufferOf(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function readPngSize(bytes: Uint8Array): PngSize | null {
  if (!hasPngSignature(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(8);
  const type = asciiFrom(bytes.subarray(12, 16));
  if (length !== 13 || type !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

export function unfilterPngImage(
  filtered: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array {
  const stride = width * bytesPerPixel;
  const expected = height * (stride + 1);
  if (filtered.length !== expected) {
    throw new HarmonizeExportError("Viewport background PNG scanlines are truncated.");
  }
  const raw = new Uint8Array(height * stride);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[offset];
    offset += 1;
    if (filter > 4) throw new HarmonizeExportError("Viewport background PNG uses an unsupported filter.");
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = filtered[offset];
      offset += 1;
      const left = x >= bytesPerPixel ? raw[row + x - bytesPerPixel] : 0;
      const up = y > 0 ? raw[row - stride + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? raw[row - stride + x - bytesPerPixel] : 0;
      let decoded = value;
      if (filter === 1) decoded = (value + left) & 255;
      else if (filter === 2) decoded = (value + up) & 255;
      else if (filter === 3) decoded = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) decoded = (value + paeth(left, up, upLeft)) & 255;
      raw[row + x] = decoded;
    }
  }
  return raw;
}

export function pngSamplesToRgba(input: Readonly<{
  colorType: number;
  raw: Uint8Array;
  width: number;
  height: number;
  transparency: Uint8Array | null;
}>): Uint8Array {
  const count = input.width * input.height;
  if (input.colorType === 6) {
    if (input.raw.length !== count * 4) {
      throw new HarmonizeExportError("Viewport background PNG samples do not match its dimensions.");
    }
    if (input.transparency) {
      throw new HarmonizeExportError("Viewport background PNG transparency cannot be composited without conversion.");
    }
    return Uint8Array.from(input.raw);
  }
  if (input.colorType !== 2) {
    throw new HarmonizeExportError("Viewport background PNG cannot be composited without conversion.");
  }
  if (input.raw.length !== count * 3) {
    throw new HarmonizeExportError("Viewport background PNG samples do not match its dimensions.");
  }
  const key = rgbTransparencyKey(input.transparency);
  const out = new Uint8Array(count * 4);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const source = pixel * 3;
    const target = pixel * 4;
    const red = input.raw[source];
    const green = input.raw[source + 1];
    const blue = input.raw[source + 2];
    out[target] = red;
    out[target + 1] = green;
    out[target + 2] = blue;
    out[target + 3] = key && red === key.red && green === key.green && blue === key.blue
      ? 0
      : 255;
  }
  return out;
}

export async function decodePngRgba(
  bytes: Uint8Array,
): Promise<Readonly<{ rgba: Uint8Array; width: number; height: number }>> {
  if (!hasPngSignature(bytes)) {
    throw new HarmonizeExportError("Viewport background image cannot be read. Export stopped instead of scaling.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let seenHeader = false;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.byteLength) {
      throw new HarmonizeExportError("Viewport background image cannot be read. Export stopped instead of scaling.");
    }
    const type = asciiFrom(bytes.subarray(typeStart, dataStart));
    const actual = crc32(bytes.subarray(typeStart, dataEnd));
    const expected = view.getUint32(dataEnd);
    if (actual !== expected) {
      throw new HarmonizeExportError("Viewport background image cannot be read. Export stopped instead of scaling.");
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (seenHeader || length !== 13) {
        throw new HarmonizeExportError("Viewport background image cannot be read. Export stopped instead of scaling.");
      }
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = data[8];
      colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (
        width < 1
        || height < 1
        || bitDepth !== 8
        || (colorType !== 2 && colorType !== 6)
        || compression !== 0
        || filter !== 0
        || interlace !== 0
      ) {
        throw new HarmonizeExportError("Viewport background PNG cannot be composited without conversion.");
      }
      seenHeader = true;
    } else if (type === "IDAT") {
      idat.push(Uint8Array.from(data));
    } else if (type === "tRNS") {
      transparency = Uint8Array.from(data);
    } else if (type === "IEND") {
      break;
    } else if (type === "PLTE" || type[0] === type[0].toLowerCase()) {
      // Ancillary metadata stays in A and is not needed for raw samples.
    } else {
      throw new HarmonizeExportError("Viewport background PNG cannot be composited without conversion.");
    }
    offset = dataEnd + 4;
  }
  if (!seenHeader || idat.length === 0) {
    throw new HarmonizeExportError("Viewport background image cannot be read. Export stopped instead of scaling.");
  }
  const inflated = await inflateZlib(concatBytes(idat));
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const raw = unfilterPngImage(inflated, width, height, bytesPerPixel);
  return {
    rgba: pngSamplesToRgba({ colorType, raw, width, height, transparency }),
    width,
    height,
  };
}

export async function encodeRgbaPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new HarmonizeExportError("Export image dimensions are invalid.");
  }
  if (rgba.length !== width * height * 4) {
    throw new HarmonizeExportError("Export image is not RGBA.");
  }
  const stride = width * 4;
  const scanlines = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const destination = y * (stride + 1);
    scanlines[destination] = 0;
    scanlines.set(rgba.subarray(y * stride, (y + 1) * stride), destination + 1);
  }
  const compressed = await deflateZlib(scanlines);
  if (compressed[0] !== 0x78) {
    throw new HarmonizeExportError("PNG compression did not produce a zlib stream.");
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  return concatBytes([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

export async function buildHarmonizeZip(input: Readonly<{
  roomId: string;
  generatedAt: string;
  generationId: string;
  background: Readonly<{
    bytes: Uint8Array;
    fileName: string;
    role: "viewport-background" | "authoritative-empty";
    source: HarmonizeBackgroundSource;
    matchesEmpty: boolean;
    matchesOriginal: boolean;
  }>;
  roomRgba: Uint8Array;
  capture: HarmonizeFurnitureCapture;
  alignment: HarmonizeFrameSuccess;
  referenceEmptyBytes?: Uint8Array | null;
}>): Promise<Readonly<{ fileName: string; bytes: Uint8Array; manifest: HarmonizeManifest }>> {
  if (input.alignment == null || input.background == null) {
    throw new HarmonizeExportError(
      "Export decision is missing. Export stopped instead of scaling.",
    );
  }
  if (input.capture == null) {
    throw new HarmonizeExportError("Harmonize export did not produce an image.");
  }
  const { width, height } = input.capture;
  const pixelBytes = width * height * 4;
  if (
    input.alignment.width !== width
    || input.alignment.height !== height
    || input.capture.rgba.length !== pixelBytes
    || input.roomRgba.length !== pixelBytes
    || !certifiedCameraAspectMatches(input.capture.camera, input.alignment.certifiedFrame)
    || input.capture.generationId !== input.generationId
  ) {
    throw new HarmonizeExportError(
      "Furniture render size does not match the viewport background. Export stopped instead of scaling.",
    );
  }
  const allowedBackgroundNames = new Set<string>([
    HARMONIZE_EXPORT_FILES.backgroundPng,
    HARMONIZE_EXPORT_FILES.backgroundJpeg,
    HARMONIZE_EXPORT_FILES.empty,
  ]);
  if (!allowedBackgroundNames.has(input.background.fileName)) {
    throw new HarmonizeExportError(
      "Viewport background image cannot be read. Export stopped instead of scaling.",
    );
  }
  const composite = compositeFurnitureOverRoom(input.roomRgba, input.capture.rgba);
  const matte = furnitureMatteRgba(input.capture.rgba);
  const [compositePng, furniturePng, mattePng] = await Promise.all([
    encodeRgbaPng(composite, width, height),
    encodeRgbaPng(input.capture.rgba, width, height),
    encodeRgbaPng(matte, width, height),
  ]);
  const packageFiles: { name: string; data: Uint8Array }[] = [
    { name: input.background.fileName, data: input.background.bytes },
    { name: HARMONIZE_EXPORT_FILES.composite, data: compositePng },
    { name: HARMONIZE_EXPORT_FILES.furniture, data: furniturePng },
    { name: HARMONIZE_EXPORT_FILES.matte, data: mattePng },
  ];
  const imageEntries: [string, HarmonizeImageRecord][] = [
    [
      input.background.fileName,
      await harmonizeImageRecord({
        role: input.background.role,
        bytes: input.background.bytes,
        width,
        height,
        reencoded: false,
      }),
    ],
    [
      HARMONIZE_EXPORT_FILES.composite,
      await harmonizeImageRecord({
        role: "stage-composite",
        bytes: compositePng,
        width,
        height,
        reencoded: true,
      }),
    ],
    [
      HARMONIZE_EXPORT_FILES.furniture,
      await harmonizeImageRecord({
        role: "furniture-rgba",
        bytes: furniturePng,
        width,
        height,
        reencoded: true,
      }),
    ],
    [
      HARMONIZE_EXPORT_FILES.matte,
      await harmonizeImageRecord({
        role: "furniture-matte",
        bytes: mattePng,
        width,
        height,
        reencoded: true,
      }),
    ],
  ];
  let emptyReference: HarmonizeManifest["emptyReference"] = input.background.source === "empty"
    ? "same-as-background"
    : "unavailable";
  const referenceBytes = input.background.source === "empty" ? null : input.referenceEmptyBytes ?? null;
  if (referenceBytes) {
    const referenceSize = readPngSize(referenceBytes);
    if (referenceSize && harmonizeBackgroundMediaType(referenceBytes) === "image/png") {
      packageFiles.push({
        name: HARMONIZE_EXPORT_FILES.referenceEmpty,
        data: referenceBytes,
      });
      imageEntries.push([
        HARMONIZE_EXPORT_FILES.referenceEmpty,
        await harmonizeImageRecord({
          role: "authoritative-empty",
          bytes: referenceBytes,
          width: referenceSize.width,
          height: referenceSize.height,
          reencoded: false,
        }),
      ]);
      emptyReference = "included";
    }
  }
  const objects = sortHarmonizeObjects(input.capture.objects);
  const unmountedObjectIds = [...input.capture.unmountedObjectIds].sort((left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  const sceneSnapshotSha256 = await sha256HexBytes(utf8(
    harmonizeSceneCanonical({
      generationId: input.generationId,
      roomScaleMultiplier: input.capture.roomScaleMultiplier,
      certifiedMetricScale: input.capture.certifiedMetricScale,
      effectiveMetricScale: input.capture.effectiveMetricScale,
      camera: input.capture.camera,
      objects,
      unmountedObjectIds,
    }),
  ));
  const manifest: HarmonizeManifest = {
    exportVersion: HARMONIZE_EXPORT_VERSION,
    roomId: input.roomId,
    generatedAt: input.generatedAt,
    generationId: input.generationId,
    roomScaleMultiplier: input.capture.roomScaleMultiplier,
    certifiedMetricScale: input.capture.certifiedMetricScale,
    effectiveMetricScale: input.capture.effectiveMetricScale,
    alignment: harmonizeAlignmentRecord(input.alignment, input.background),
    camera: input.capture.camera,
    images: Object.fromEntries(imageEntries),
    contactShadows: "excluded",
    contactShadowsHidden: input.capture.contactShadowsHidden,
    selectionDecorations: "excluded",
    roomOccluders: "none-in-stage-renderer",
    objects,
    unmountedObjectIds,
    sceneSnapshotSha256,
    emptyReference,
    limitations: HARMONIZE_EXPORT_LIMITATIONS,
  };
  const manifestBytes = utf8(`${JSON.stringify(manifest, null, 2)}\n`);
  packageFiles.push({ name: HARMONIZE_EXPORT_FILES.manifest, data: manifestBytes });
  const fileName = harmonizeExportFileName(input.roomId);
  return {
    fileName,
    bytes: zipStore(packageFiles),
    manifest,
  };
}

async function harmonizeImageRecord(input: Readonly<{
  role: HarmonizeImageRecord["role"];
  bytes: Uint8Array;
  width: number;
  height: number;
  reencoded: boolean;
}>): Promise<HarmonizeImageRecord> {
  return {
    role: input.role,
    width: input.width,
    height: input.height,
    sha256: await sha256HexBytes(input.bytes),
    byteLength: input.bytes.byteLength,
    reencoded: input.reencoded,
  };
}

export function zipStore(
  files: readonly Readonly<{ name: string; data: Uint8Array }>[],
): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = ascii(file.name);
    if (file.data.byteLength > 0xffffffff || name.byteLength > 0xffff) {
      throw new HarmonizeExportError("Export package is too large.");
    }
    const crc = crc32(file.data);
    const local = localFileHeader(name, file.data, crc);
    locals.push(local);
    centrals.push(centralFileHeader(name, file.data, crc, offset));
    offset += local.byteLength;
  }
  const central = concatBytes(centrals);
  return concatBytes([
    ...locals,
    central,
    endOfCentralDirectory(files.length, central.byteLength, offset),
  ]);
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function rgbTransparencyKey(
  transparency: Uint8Array | null,
): Readonly<{ red: number; green: number; blue: number }> | null {
  if (!transparency) return null;
  if (transparency.length < 6) {
    throw new HarmonizeExportError("Viewport background PNG cannot be composited without conversion.");
  }
  const channels = [0, 2, 4].map((offset) => {
    if (transparency[offset] !== 0) {
      throw new HarmonizeExportError("Viewport background PNG cannot be composited without conversion.");
    }
    return transparency[offset + 1];
  });
  return { red: channels[0], green: channels[1], blue: channels[2] };
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  const checksum = crc32(concatBytes([typeBytes, data]));
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.byteLength, checksum);
  return out;
}

function localFileHeader(name: Uint8Array, data: Uint8Array, crc: number): Uint8Array {
  return concatBytes([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(crc),
    u32(data.byteLength),
    u32(data.byteLength),
    u16(name.byteLength),
    u16(0),
    name,
    data,
  ]);
}

function centralFileHeader(
  name: Uint8Array,
  data: Uint8Array,
  crc: number,
  offset: number,
): Uint8Array {
  return concatBytes([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(crc),
    u32(data.byteLength),
    u32(data.byteLength),
    u16(name.byteLength),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(offset),
    name,
  ]);
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  return concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(count),
    u16(count),
    u32(size),
    u32(offset),
    u16(0),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function ascii(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 127) throw new HarmonizeExportError("Export text is not ASCII.");
    out[index] = code;
  }
  return out;
}

function asciiFrom(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  return transformZlib(data, "deflate");
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  return transformZlib(data, "inflate");
}

async function transformZlib(
  data: Uint8Array,
  direction: "deflate" | "inflate",
): Promise<Uint8Array> {
  const Stream = direction === "deflate" ? CompressionStream : DecompressionStream;
  if (typeof Stream !== "function") {
    throw new HarmonizeExportError("PNG compression is unavailable in this browser.");
  }
  const stream = new Blob([arrayBufferOf(data)]).stream().pipeThrough(new Stream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
