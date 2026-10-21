/**
 * Instant REMOVE export.
 *
 * The preview mask is `max(brush, dilated selected-object union)`. Brush
 * reveal raises coverage, restore lowers it, and Protect Objects blocks
 * reveal on identity-mask pixels. This module rebuilds that coverage for the
 * full ORIGINAL grid and blends EMPTY under ORIGINAL by that coverage.
 * Furniture, outlines, and the brush cursor are not inputs.
 */

import { syncRemoveInspectionCoverage } from "@/lib/vibode-stage/remove-object-ui";
import { removeBrushAdmission, type RemoveBrushAdmission } from "@/lib/vibode-stage/remove-mask";
import type { RemoveObjectRecord } from "@/lib/vibode-stage/remove-objects";
import type { RemoveAlignmentReport } from "@/lib/vibode-stage/remove-alignment";

export const REMOVE_EDIT_CONTRACT = "vibode-remove-edit/v1";
export const REMOVE_EDIT_LABEL = "Remove";
export const REMOVE_EDIT_MAX_PIXELS = 8_000_000;

export const REMOVE_EDIT_SAVE_ERROR = "Remove edits could not be saved. Your edits are still here.";
export const REMOVE_EDIT_ACTIVATE_ERROR = "The image was saved. History could not switch to it. Try Done again.";
export const REMOVE_EDIT_ALIGNMENT_ERROR = "This room image cannot be saved from Remove.";

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
 * Blend EMPTY under ORIGINAL. Coverage 0 keeps ORIGINAL. Coverage 255 uses
 * EMPTY. Both buffers are RGBA at the ORIGINAL grid. EMPTY must already be
 * stretched onto that grid.
 */
export function compositeRemoveEditRgba(input: Readonly<{
  original: Uint8Array;
  empty: Uint8Array;
  coverage: Uint8Array;
  width: number;
  height: number;
}>): Uint8Array | null {
  const pixels = input.width * input.height;
  if (!positiveGrid(input.width, input.height) || pixels > REMOVE_EDIT_MAX_PIXELS) return null;
  if (
    input.original.length !== pixels * 4
    || input.empty.length !== pixels * 4
    || input.coverage.length !== pixels
  ) {
    return null;
  }
  const output = new Uint8Array(pixels * 4);
  for (let index = 0; index < pixels; index += 1) {
    const alpha = (input.coverage[index] ?? 0) / 255;
    const keep = 1 - alpha;
    const offset = index * 4;
    output[offset] = blendByte(input.original[offset] ?? 0, input.empty[offset] ?? 0, keep, alpha);
    output[offset + 1] = blendByte(input.original[offset + 1] ?? 0, input.empty[offset + 1] ?? 0, keep, alpha);
    output[offset + 2] = blendByte(input.original[offset + 2] ?? 0, input.empty[offset + 2] ?? 0, keep, alpha);
    output[offset + 3] = 255;
  }
  return output;
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
  originalSha256: string;
  emptySha256: string;
  width: number;
  height: number;
  coverageSha256: string;
}>): string {
  return [
    REMOVE_EDIT_CONTRACT,
    input.generationId,
    input.originalSha256.toLowerCase(),
    input.emptySha256.toLowerCase(),
    String(input.width),
    String(input.height),
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
