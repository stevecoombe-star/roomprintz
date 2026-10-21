/**
 * Instant REMOVE export.
 *
 * Coverage stays on the AFC ORIGINAL grid: `max(brush, dilated selected-object
 * union)`. The keep-layer is the frozen active History image. EMPTY is
 * stretched onto that image's grid, and coverage is sampled by the same
 * frame UV the preview uses. Furniture, outlines, and the brush cursor are
 * not inputs.
 */

import { classifyAfcR3cImagePairCompatibility } from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";
import { syncRemoveInspectionCoverage } from "@/lib/vibode-stage/remove-object-ui";
import {
  removeBrushAdmission,
  resampleCoverageToOriginal,
  type RemoveBrushAdmission,
} from "@/lib/vibode-stage/remove-mask";
import type { RemoveObjectRecord } from "@/lib/vibode-stage/remove-objects";
import type { RemoveAlignmentReport } from "@/lib/vibode-stage/remove-alignment";

export const REMOVE_EDIT_CONTRACT = "vibode-remove-edit/v2";
export const REMOVE_EDIT_LABEL = "Remove";
export const REMOVE_EDIT_MAX_PIXELS = 8_000_000;

export const REMOVE_EDIT_SAVE_ERROR = "Remove edits could not be saved. Your edits are still here.";
export const REMOVE_EDIT_ACTIVATE_ERROR = "The image was saved. History could not switch to it. Try Done again.";
export const REMOVE_EDIT_ALIGNMENT_ERROR = "This room image cannot be saved from Remove.";
export const REMOVE_EDIT_STALE_ERROR = "This room image changed. Your edits are still here.";

export type RemoveKeepIdentity = Readonly<{
  assetId: string;
  sha256: string;
  width: number;
  height: number;
}>;

export function buildRemoveEditCoverage(input: Readonly<{
  brush: Uint8Array;
  width: number;
  height: number;
  objects: readonly RemoveObjectRecord[];
  selectedIds: ReadonlySet<string>;
  expansionPx: number;
}>): Uint8Array | null {
  const pixels = input.width * input.height;
  if (!positiveGrid(input.width, input.height) || input.brush.length !== pixels) return null;
  if (pixels > REMOVE_EDIT_MAX_PIXELS) return null;
  const destination = new Uint8Array(pixels);
  const written = syncRemoveInspectionCoverage({
    brush: input.brush,
    objectUnion: new Uint8Array(pixels),
    dilated: new Uint8Array(pixels),
    destination,
    width: input.width,
    height: input.height,
    objects: input.objects,
    selectedIds: input.selectedIds,
    bounds: { x: 0, y: 0, width: input.width, height: input.height },
    expansionPx: input.expansionPx,
  });
  return written ? destination : null;
}

export function removeEditHasChanges(coverage: Uint8Array): boolean {
  for (let index = 0; index < coverage.length; index += 1) {
    if ((coverage[index] ?? 0) !== 0) return true;
  }
  return false;
}

/**
 * Blend EMPTY under the keep image. Coverage 0 copies the keep pixel.
 * Coverage 255 uses EMPTY. Both buffers are RGBA at the keep-image grid.
 * EMPTY must already be stretched onto that grid.
 */
export function compositeRemoveEditRgba(input: Readonly<{
  keep: Uint8Array;
  empty: Uint8Array;
  coverage: Uint8Array;
  width: number;
  height: number;
}>): Uint8Array | null {
  const pixels = input.width * input.height;
  if (!positiveGrid(input.width, input.height) || pixels > REMOVE_EDIT_MAX_PIXELS) return null;
  if (
    input.keep.length !== pixels * 4
    || input.empty.length !== pixels * 4
    || input.coverage.length !== pixels
  ) {
    return null;
  }
  const output = new Uint8Array(pixels * 4);
  for (let index = 0; index < pixels; index += 1) {
    const alpha = (input.coverage[index] ?? 0) / 255;
    const retain = 1 - alpha;
    const offset = index * 4;
    output[offset] = blendByte(input.keep[offset] ?? 0, input.empty[offset] ?? 0, retain, alpha);
    output[offset + 1] = blendByte(input.keep[offset + 1] ?? 0, input.empty[offset + 1] ?? 0, retain, alpha);
    output[offset + 2] = blendByte(input.keep[offset + 2] ?? 0, input.empty[offset + 2] ?? 0, retain, alpha);
    output[offset + 3] = 255;
  }
  return output;
}

/**
 * Sample ORIGINAL-grid coverage onto the keep-image grid.
 *
 * Pixel centers use the same UV as the preview `drawImage` of the mask:
 * `((x + 0.5) / keepWidth) * coverageWidth - 0.5`.
 */
export function mapRemoveCoverageToKeepGrid(input: Readonly<{
  coverage: Uint8Array;
  coverageWidth: number;
  coverageHeight: number;
  keepWidth: number;
  keepHeight: number;
}>): Uint8Array | null {
  const sourcePixels = input.coverageWidth * input.coverageHeight;
  const keepPixels = input.keepWidth * input.keepHeight;
  if (sourcePixels > REMOVE_EDIT_MAX_PIXELS || keepPixels > REMOVE_EDIT_MAX_PIXELS) return null;
  return resampleCoverageToOriginal({
    source: input.coverage,
    sourceWidth: input.coverageWidth,
    sourceHeight: input.coverageHeight,
    originalWidth: input.keepWidth,
    originalHeight: input.keepHeight,
    filter: "bilinear",
  });
}

export function removeEditKeepAdmission(input: Readonly<{
  keepWidth: number;
  keepHeight: number;
  emptyWidth: number;
  emptyHeight: number;
}>): RemoveBrushAdmission {
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: "keep",
      decodedWidth: input.keepWidth,
      decodedHeight: input.keepHeight,
      orientation: 1,
    },
    {
      fingerprint: "empty",
      decodedWidth: input.emptyWidth,
      decodedHeight: input.emptyHeight,
      orientation: 1,
    },
  );
  if (compatibility.tier === "incompatible") {
    return {
      allowed: false,
      reason: compatibility.reason ?? REMOVE_EDIT_ALIGNMENT_ERROR,
    };
  }
  return {
    allowed: true,
    aspectRescaling: compatibility.tier === "aspect_compatible_rescaled",
  };
}

export function removeEditExportAdmission(report: RemoveAlignmentReport): RemoveBrushAdmission {
  return removeBrushAdmission({
    gridCompatibility: report.gridCompatibility,
    originalDisagreement: null,
    emptyDisagreement: null,
  });
}

export function removeEditFingerprintMaterial(input: Readonly<{
  generationId: string;
  keepAssetId: string;
  keepSha256: string;
  originalSha256: string;
  emptySha256: string;
  keepWidth: number;
  keepHeight: number;
  coverageWidth: number;
  coverageHeight: number;
  coverageSha256: string;
}>): string {
  return [
    REMOVE_EDIT_CONTRACT,
    input.generationId,
    input.keepAssetId,
    input.keepSha256.toLowerCase(),
    input.originalSha256.toLowerCase(),
    input.emptySha256.toLowerCase(),
    String(input.keepWidth),
    String(input.keepHeight),
    String(input.coverageWidth),
    String(input.coverageHeight),
    input.coverageSha256.toLowerCase(),
  ].join("\n");
}

export function removeEditStoragePath(roomId: string, fingerprint: string): string {
  return `rooms/${roomId}/remove/${fingerprint}.png`;
}

export function isRemoveHistoryAsset(asset: unknown): boolean {
  const row = record(asset);
  if (!row) return false;
  const metadata = record(row.metadata);
  return hex64(metadata?.removeEditFingerprint);
}

export function removeHistoryFallbackVersions<T extends { id: string }>(
  versions: readonly T[],
  visibleIds: ReadonlySet<string>,
): T[] {
  const seen = new Set<string>();
  const hidden: T[] = [];
  for (const version of versions) {
    if (!version.id || seen.has(version.id) || visibleIds.has(version.id) || !isRemoveHistoryAsset(version)) continue;
    seen.add(version.id);
    hidden.push(version);
  }
  return hidden;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array | null {
  if (!value || value.length > REMOVE_EDIT_MAX_PIXELS * 2) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function blendByte(original: number, empty: number, keep: number, reveal: number): number {
  return Math.round(original * keep + empty * reveal);
}

function positiveGrid(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hex64(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}
