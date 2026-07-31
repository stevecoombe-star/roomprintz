/**
 * AFC-R3C-B2 — fixed local-image manifest intake.
 *
 * This is deliberately a closed, server-only contract. It describes verified
 * local inputs only; it neither reads the images nor invokes a provider.
 */
import "server-only";

import path from "node:path";
import type { SharedCandidateComparisonContext } from "./candidate-discrimination-harness";
import { classifyAfcR3cImagePairCompatibility } from "./afc-r3c-image-pair-compatibility";

export const AFC_R3C_IMAGE_MANIFEST_VERSION = "afc-r3c-image-manifest/v1" as const;

export type AfcR3cManifestImage = Readonly<{
  filePath: string;
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  orientation: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}>;

export type AfcR3cImageManifestV1 = Readonly<{
  contractVersion: typeof AFC_R3C_IMAGE_MANIFEST_VERSION;
  roomId: string;
  original: AfcR3cManifestImage;
  emptyRoomAssist: AfcR3cManifestImage & Readonly<{
    generatedFromOriginalSha256: string;
    generatorId: string;
    /**
     * Requested generator model label (for example, "NBP"), not a
     * provider-resolved model identity.
     */
    generatorModelId: string;
  }>;
  sharedComparisonContext: ValidSharedCandidateComparisonContext;
}>;

export type AfcR3cManifestParseResult =
  | Readonly<{ ok: true; manifest: AfcR3cImageManifestV1 }>
  | Readonly<{ ok: false; reason: string; path: string }>;
type ImageParseResult =
  | Readonly<{ ok: true; image: AfcR3cManifestImage }>
  | Readonly<{ ok: false; reason: string; path: string }>;
type ContextParseResult =
  | Readonly<{ ok: true; context: ValidSharedCandidateComparisonContext }>
  | Readonly<{ ok: false; reason: string; path: string }>;

declare const validatedSharedComparisonContext: unique symbol;
export type ValidSharedCandidateComparisonContext = SharedCandidateComparisonContext & Readonly<{
  [validatedSharedComparisonContext]: true;
}>;
export type SharedComparisonContextValidationResult =
  | Readonly<{ ok: true; value: ValidSharedCandidateComparisonContext }>
  | Readonly<{ ok: false; failureCode: "comparison_context_invalid"; reason: string }>;

const SHA256 = /^[a-f0-9]{64}$/;
const ROOM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
    Object.freeze(object);
  }
  return value;
}

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of Object.keys(value)) if (!keys.includes(key)) return key;
  for (const key of keys) if (!Object.hasOwn(value, key)) return key;
  return null;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function validLocalPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0")) return false;
  if (path.isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return value.split(/[\\/]/).every((part) => part !== "..");
}

function extensionMatchesMime(filePath: string, mimeType: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return (mimeType === "image/jpeg" && (extension === ".jpg" || extension === ".jpeg")) ||
    (mimeType === "image/png" && extension === ".png") ||
    (mimeType === "image/webp" && extension === ".webp");
}

function parseImage(value: unknown, path: string): ImageParseResult {
  if (!plain(value)) return { ok: false, reason: "image_not_object", path };
  const unknown = exactKeys(value, ["filePath", "sha256", "byteCount", "decodedWidth", "decodedHeight", "orientation", "mimeType"]);
  if (unknown) return { ok: false, reason: "image_field_invalid", path: `${path}.${unknown}` };
  if (!validLocalPath(value.filePath)) return { ok: false, reason: "image_path_invalid", path: `${path}.filePath` };
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) return { ok: false, reason: "image_sha256_invalid", path: `${path}.sha256` };
  if (!positiveInteger(value.byteCount)) return { ok: false, reason: "image_byte_count_invalid", path: `${path}.byteCount` };
  if (!positiveInteger(value.decodedWidth)) return { ok: false, reason: "image_width_invalid", path: `${path}.decodedWidth` };
  if (!positiveInteger(value.decodedHeight)) return { ok: false, reason: "image_height_invalid", path: `${path}.decodedHeight` };
  if (value.orientation !== 1) return { ok: false, reason: "image_orientation_invalid", path: `${path}.orientation` };
  if (typeof value.mimeType !== "string" || !IMAGE_MIMES.has(value.mimeType)) return { ok: false, reason: "image_mime_invalid", path: `${path}.mimeType` };
  if (!extensionMatchesMime(value.filePath, value.mimeType)) return { ok: false, reason: "image_extension_mime_mismatch", path: `${path}.filePath` };
  return {
    ok: true,
    image: {
      filePath: value.filePath,
      sha256: value.sha256,
      byteCount: value.byteCount,
      decodedWidth: value.decodedWidth,
      decodedHeight: value.decodedHeight,
      orientation: value.orientation,
      mimeType: value.mimeType as AfcR3cManifestImage["mimeType"],
    },
  };
}

export function validateSharedCandidateComparisonContext(value: unknown): SharedComparisonContextValidationResult {
  const invalid = (): SharedComparisonContextValidationResult => ({
    ok: false,
    failureCode: "comparison_context_invalid",
    reason: "Shared comparison context is invalid.",
  });
  if (!plain(value)) return invalid();
  const keys = [
    "ratioFovContractVersion", "basisId", "basisFingerprint", "decoderId",
    "normalizationPolicyVersion", "decodedWidth", "decodedHeight", "frameSize",
    "orientationApplied", "basisKind", "ratioDomain", "fovDomain", "refinement", "referenceDepth",
  ] as const;
  const unknown = exactKeys(value, keys);
  if (unknown) return invalid();
  if (value.ratioFovContractVersion !== "ratio-fov-harness/v1") return invalid();
  if (!nonEmpty(value.basisId) || !nonEmpty(value.basisFingerprint) || !nonEmpty(value.decoderId)) return invalid();
  if (value.normalizationPolicyVersion !== "source-normalized/v1" || value.orientationApplied !== false || value.basisKind !== "original" || value.referenceDepth !== 1) {
    return invalid();
  }
  if (!positiveInteger(value.decodedWidth) || !positiveInteger(value.decodedHeight)) return invalid();
  if (!plain(value.frameSize) || exactKeys(value.frameSize, ["width", "height"]) ||
    !positiveInteger(value.frameSize.width) || !positiveInteger(value.frameSize.height)) {
    return invalid();
  }
  if (!plain(value.ratioDomain) || exactKeys(value.ratioDomain, ["min", "max", "step"]) ||
    !finite(value.ratioDomain.min) || value.ratioDomain.min <= 0 || !finite(value.ratioDomain.max) ||
    value.ratioDomain.max < value.ratioDomain.min || !finite(value.ratioDomain.step) || value.ratioDomain.step <= 0) {
    return invalid();
  }
  if (!plain(value.fovDomain) || exactKeys(value.fovDomain, ["minDeg", "maxDeg", "stepDeg"]) ||
    !finite(value.fovDomain.minDeg) || value.fovDomain.minDeg < 20 || !finite(value.fovDomain.maxDeg) ||
    value.fovDomain.maxDeg > 90 || value.fovDomain.maxDeg < value.fovDomain.minDeg ||
    !finite(value.fovDomain.stepDeg) || value.fovDomain.stepDeg <= 0) {
    return invalid();
  }
  if (!plain(value.refinement) || exactKeys(value.refinement, ["enabled", "ratioStep", "fovStepDeg", "basinFactor", "additivePxAllowance"]) ||
    typeof value.refinement.enabled !== "boolean" ||
    !finite(value.refinement.ratioStep) || value.refinement.ratioStep <= 0 ||
    !finite(value.refinement.fovStepDeg) || value.refinement.fovStepDeg <= 0 ||
    !finite(value.refinement.basinFactor) || value.refinement.basinFactor <= 0 ||
    !finite(value.refinement.additivePxAllowance) || value.refinement.additivePxAllowance < 0) {
    return invalid();
  }
  return { ok: true, value: deepFreeze({
    ratioFovContractVersion: value.ratioFovContractVersion,
    basisId: value.basisId,
    basisFingerprint: value.basisFingerprint,
    decoderId: value.decoderId,
    normalizationPolicyVersion: value.normalizationPolicyVersion,
    decodedWidth: value.decodedWidth,
    decodedHeight: value.decodedHeight,
    frameSize: { width: value.frameSize.width, height: value.frameSize.height },
    orientationApplied: value.orientationApplied,
    basisKind: value.basisKind,
    ratioDomain: { min: value.ratioDomain.min, max: value.ratioDomain.max, step: value.ratioDomain.step },
    fovDomain: { minDeg: value.fovDomain.minDeg, maxDeg: value.fovDomain.maxDeg, stepDeg: value.fovDomain.stepDeg },
    refinement: {
      enabled: value.refinement.enabled,
      ratioStep: value.refinement.ratioStep,
      fovStepDeg: value.refinement.fovStepDeg,
      basinFactor: value.refinement.basinFactor,
      additivePxAllowance: value.refinement.additivePxAllowance,
    },
    referenceDepth: value.referenceDepth,
  }) as ValidSharedCandidateComparisonContext };
}

function parseContext(value: unknown, original: AfcR3cManifestImage): ContextParseResult {
  const validated = validateSharedCandidateComparisonContext(value);
  if (!validated.ok) return { ok: false, reason: "shared_context_invalid", path: "$.sharedComparisonContext" };
  const context = validated.value;
  if (context.basisFingerprint !== original.sha256) {
    return { ok: false, reason: "shared_context_basis_invalid", path: "$.sharedComparisonContext.basisFingerprint" };
  }
  if (context.decodedWidth !== original.decodedWidth || context.decodedHeight !== original.decodedHeight) {
    return { ok: false, reason: "shared_context_dimensions_mismatch", path: "$.sharedComparisonContext" };
  }
  if (context.frameSize.width !== original.decodedWidth || context.frameSize.height !== original.decodedHeight) {
    return { ok: false, reason: "shared_context_frame_invalid", path: "$.sharedComparisonContext.frameSize" };
  }
  return { ok: true, context };
}

/** Parse an untrusted JSON manifest, rejecting every unknown field. */
export function parseAfcR3cImageManifest(value: unknown): AfcR3cManifestParseResult {
  if (!plain(value)) return { ok: false, reason: "manifest_not_object", path: "$" };
  const unknown = exactKeys(value, ["contractVersion", "roomId", "original", "emptyRoomAssist", "sharedComparisonContext"]);
  if (unknown) return { ok: false, reason: "manifest_field_invalid", path: `$.${unknown}` };
  if (value.contractVersion !== AFC_R3C_IMAGE_MANIFEST_VERSION) return { ok: false, reason: "manifest_version_invalid", path: "$.contractVersion" };
  if (typeof value.roomId !== "string" || !ROOM_ID.test(value.roomId)) return { ok: false, reason: "room_id_invalid", path: "$.roomId" };
  const original = parseImage(value.original, "$.original");
  if (!original.ok) return original;
  if (!plain(value.emptyRoomAssist)) return { ok: false, reason: "empty_image_not_object", path: "$.emptyRoomAssist" };
  const emptyUnknown = exactKeys(value.emptyRoomAssist, [
    "filePath", "sha256", "byteCount", "decodedWidth", "decodedHeight", "orientation", "mimeType",
    "generatedFromOriginalSha256", "generatorId", "generatorModelId",
  ]);
  if (emptyUnknown) return { ok: false, reason: "empty_image_field_invalid", path: `$.emptyRoomAssist.${emptyUnknown}` };
  const empty = parseImage({
    filePath: value.emptyRoomAssist.filePath,
    sha256: value.emptyRoomAssist.sha256,
    byteCount: value.emptyRoomAssist.byteCount,
    decodedWidth: value.emptyRoomAssist.decodedWidth,
    decodedHeight: value.emptyRoomAssist.decodedHeight,
    orientation: value.emptyRoomAssist.orientation,
    mimeType: value.emptyRoomAssist.mimeType,
  }, "$.emptyRoomAssist");
  if (!empty.ok) return empty;
  if (empty.image.filePath === original.image.filePath) return { ok: false, reason: "image_paths_not_distinct", path: "$.emptyRoomAssist.filePath" };
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: original.image.sha256,
      decodedWidth: original.image.decodedWidth,
      decodedHeight: original.image.decodedHeight,
      orientation: original.image.orientation,
    },
    {
      fingerprint: empty.image.sha256,
      decodedWidth: empty.image.decodedWidth,
      decodedHeight: empty.image.decodedHeight,
      orientation: empty.image.orientation,
    },
  );
  if (compatibility.tier === "incompatible") {
    return { ok: false, reason: "image_pair_incompatible", path: "$.emptyRoomAssist" };
  }
  if (value.emptyRoomAssist.generatedFromOriginalSha256 !== original.image.sha256) return { ok: false, reason: "empty_parent_fingerprint_mismatch", path: "$.emptyRoomAssist.generatedFromOriginalSha256" };
  if (!nonEmpty(value.emptyRoomAssist.generatorId)) return { ok: false, reason: "empty_generator_invalid", path: "$.emptyRoomAssist.generatorId" };
  // This v1 field is the requested generator label; it is not a claim about
  // any provider-resolved model identity.
  if (!nonEmpty(value.emptyRoomAssist.generatorModelId)) return { ok: false, reason: "empty_generator_model_invalid", path: "$.emptyRoomAssist.generatorModelId" };
  const context = parseContext(value.sharedComparisonContext, original.image);
  if (!context.ok) return context;
  return {
    ok: true,
    manifest: deepFreeze({
      contractVersion: AFC_R3C_IMAGE_MANIFEST_VERSION,
      roomId: value.roomId,
      original: original.image,
      emptyRoomAssist: {
        ...empty.image,
        generatedFromOriginalSha256: original.image.sha256,
        generatorId: value.emptyRoomAssist.generatorId,
        generatorModelId: value.emptyRoomAssist.generatorModelId,
      },
      sharedComparisonContext: context.context,
    }),
  };
}
