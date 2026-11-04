/**
 * Bring Forward cutouts and session selection.
 *
 * A cutout is verified ORIGINAL pixels with mask coverage copied into alpha.
 * Selection belongs to Bring Forward. REMOVE's hidden-object set is not an input.
 * Nothing is selected until the user clicks an outline. Done keeps that set for
 * this editor session. Cancel restores the set from before the edit.
 */

import { classifyAfcR3cImagePairCompatibility } from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";
import { isCleanupHistoryAsset } from "@/lib/vibode-stage/remove-cleanup-history-ui";
import { isRemoveHistoryAsset } from "@/lib/vibode-stage/remove-edit";
import {
  readRemoveObjectUiPayload,
  requestRemoveObjects,
  type RemoveObjectUiDiagnostics,
  type RemoveObjectUiIdentity,
} from "@/lib/vibode-stage/remove-object-ui";
import {
  unpackRemoveMask,
  type RemoveObjectRecord,
} from "@/lib/vibode-stage/remove-objects";

const SHA256 = /^[0-9a-f]{64}$/;

export const BRING_FORWARD_BACKGROUND_MESSAGE =
  "Bring Forward isn't available for this room image.";
export const BRING_FORWARD_CHECKING_MESSAGE = "Checking the room photo…";
export const BRING_FORWARD_FINDING_MESSAGE = "Finding objects…";
export const BRING_FORWARD_EMPTY_MESSAGE = "No objects were found in this photo.";
export const BRING_FORWARD_READY_MESSAGE =
  "Click a yellow outline to bring it forward. Click a blue outline to put it back.";
export const BRING_FORWARD_UNUSABLE_MESSAGE = "Object detection returned an unusable result.";
export const BRING_FORWARD_NO_RESPONSE_MESSAGE = "Object detection did not respond. The room is unchanged.";

export type BringForwardImageIdentity = Readonly<{
  sha256: string;
  width: number;
  height: number;
}>;

export type BringForwardSnapshot = Readonly<{
  roomId: string;
  generationId: string;
  original: BringForwardImageIdentity;
  objects: readonly RemoveObjectRecord[];
}>;

export type BringForwardBackgroundKind = "remove" | "cleanup" | "history";

/**
 * A room History image the certified viewer is actually showing.
 * REMOVE and CLEAN UP must name this generation and ORIGINAL. Other History
 * images must belong to this room. A declared generation that differs is not a claim.
 */
export type BringForwardBackgroundClaim = Readonly<{
  imageUrl: string;
  roomId: string;
  generationId: string;
  kind: BringForwardBackgroundKind;
  originalSha256: string | null;
}>;

export type BringForwardScan = Readonly<{
  roomId: string;
  generationId: string;
  original: BringForwardImageIdentity;
  vocabularyRevision: number;
  conceptSet: string;
  objects: readonly RemoveObjectRecord[];
  diagnostics: RemoveObjectUiDiagnostics | null;
}>;

export type BringForwardEditor = Readonly<{
  editing: boolean;
  committedIds: ReadonlySet<string>;
  draftIds: ReadonlySet<string>;
  scan: BringForwardScan | null;
}>;

export type BringForwardDisplayPhase = "idle" | "checking" | "show" | "hide";

const EMPTY_IDS: ReadonlySet<string> = new Set();

const EMPTY_EDITOR: BringForwardEditor = Object.freeze({
  editing: false,
  committedIds: EMPTY_IDS,
  draftIds: EMPTY_IDS,
  scan: null,
});

export function emptyBringForwardEditor(): BringForwardEditor {
  return EMPTY_EDITOR;
}

export function bringForwardImageIdentity(
  input: Readonly<{ sha256: string; width: number; height: number }> | null,
): BringForwardImageIdentity | null {
  if (!input) return null;
  const sha256 = input.sha256.trim().toLowerCase();
  if (!SHA256.test(sha256)) return null;
  if (!positiveInteger(input.width) || !positiveInteger(input.height)) return null;
  return { sha256, width: input.width, height: input.height };
}

/**
 * The cutout always uses verified ORIGINAL pixels. The displayed photo may be
 * that ORIGINAL, or a room History image the certified frame already accepts.
 * Byte equality is required for the ORIGINAL artifact, not for the displayed
 * photo. An unknown URL is rejected even when its aspect matches.
 * REMOVE editing hides the cutout. Exact pixel registration is proven only
 * when the displayed bytes are the ORIGINAL. Other admitted photos share the
 * certified frame's existing exact-grid or aspect-compatible stretch.
 */
export function assessBringForwardDisplay(input: Readonly<{
  snapshot: BringForwardSnapshot | null;
  roomId: string;
  generationId: string;
  displayed: BringForwardImageIdentity | null;
  source: BringForwardImageIdentity | null;
  removeActive: boolean;
  background?: BringForwardBackgroundClaim | null;
}>): "show" | "hide" {
  if (input.removeActive) return "hide";
  if (!presentText(input.roomId) || !presentText(input.generationId)) return "hide";
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.roomId !== input.roomId || snapshot.generationId !== input.generationId) {
    return "hide";
  }
  const original = bringForwardImageIdentity(snapshot.original);
  const displayed = bringForwardImageIdentity(input.displayed);
  const source = bringForwardImageIdentity(input.source);
  if (!original || !displayed || !source) return "hide";
  if (!sameImage(original, source)) return "hide";
  if (sameImage(original, displayed)) return "show";
  const claim = input.background ?? null;
  if (!claim || claim.roomId !== input.roomId || claim.generationId !== input.generationId) return "hide";
  if (claim.kind !== "remove" && claim.kind !== "cleanup" && claim.kind !== "history") return "hide";
  if (claim.originalSha256) {
    const bound = claim.originalSha256.trim().toLowerCase();
    if (bound !== original.sha256) return "hide";
  } else if (claim.kind === "remove" || claim.kind === "cleanup") {
    return "hide";
  }
  return certifiedFrameAllows(original, displayed) ? "show" : "hide";
}

export function readBringForwardBackgroundClaim(input: Readonly<{
  asset: unknown;
  roomId: string;
  generationId: string;
}>): BringForwardBackgroundClaim | null {
  const row = record(input.asset);
  if (!row || !presentText(input.roomId) || !presentText(input.generationId)) return null;
  const imageUrl = typeof row.image_url === "string" ? row.image_url.trim() : "";
  if (!imageUrl) return null;
  const metadata = record(row.metadata) ?? {};
  const assetRoom = typeof row.room_id === "string" ? row.room_id : null;
  const sourceRoom = typeof metadata.sourceRoomId === "string" ? metadata.sourceRoomId : null;
  if (assetRoom && assetRoom !== input.roomId) return null;
  if (sourceRoom && sourceRoom !== input.roomId) return null;
  if (!assetRoom && !sourceRoom) return null;
  const kind: BringForwardBackgroundKind = isCleanupHistoryAsset(row)
    ? "cleanup"
    : isRemoveHistoryAsset(row)
      ? "remove"
      : "history";
  const declaredGeneration = typeof metadata.sourceAfcGenerationId === "string"
    ? metadata.sourceAfcGenerationId
    : null;
  if (declaredGeneration && declaredGeneration !== input.generationId) return null;
  if ((kind === "remove" || kind === "cleanup") && declaredGeneration !== input.generationId) return null;
  const declaredOriginal = typeof metadata.originalSha256 === "string"
    ? metadata.originalSha256.trim().toLowerCase()
    : null;
  if (declaredOriginal && !SHA256.test(declaredOriginal)) return null;
  if ((kind === "remove" || kind === "cleanup") && !declaredOriginal) return null;
  return {
    imageUrl,
    roomId: input.roomId,
    generationId: declaredGeneration ?? input.generationId,
    kind,
    originalSha256: declaredOriginal,
  };
}

export function bringForwardScanKey(input: Readonly<{
  roomId: string;
  generationId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  vocabularyRevision: number;
}>): string | null {
  const original = bringForwardImageIdentity({
    sha256: input.originalSha256,
    width: input.originalWidth,
    height: input.originalHeight,
  });
  if (!original || !presentText(input.roomId) || !presentText(input.generationId)) return null;
  if (!Number.isInteger(input.vocabularyRevision) || input.vocabularyRevision < 0) return null;
  return [
    input.roomId,
    input.generationId,
    original.sha256,
    original.width,
    original.height,
    input.vocabularyRevision,
  ].join("\0");
}

export function bringForwardDisplayKey(input: Readonly<{
  roomId: string;
  generationId: string;
  backgroundUrl: string;
  original: BringForwardImageIdentity;
  background?: BringForwardBackgroundClaim | null;
}>): string {
  const claim = input.background;
  return [
    input.roomId,
    input.generationId,
    input.backgroundUrl,
    input.original.sha256,
    input.original.width,
    input.original.height,
    claim ? [claim.kind, claim.roomId, claim.generationId, claim.originalSha256 ?? ""].join(":") : "",
  ].join("\0");
}

export function toggleBringForwardId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!presentText(id)) return ids;
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function visibleBringForwardIds(editor: BringForwardEditor): ReadonlySet<string> {
  return editor.editing ? editor.draftIds : editor.committedIds;
}

export function enterBringForward(editor: BringForwardEditor): BringForwardEditor {
  if (editor.editing) return editor;
  return {
    ...editor,
    editing: true,
    draftIds: new Set(editor.committedIds),
  };
}

export function doneBringForward(editor: BringForwardEditor): BringForwardEditor {
  if (!editor.editing) return editor;
  return {
    ...editor,
    editing: false,
    committedIds: editor.draftIds,
  };
}

export function cancelBringForward(editor: BringForwardEditor): BringForwardEditor {
  if (!editor.editing) return editor;
  return {
    ...editor,
    editing: false,
    draftIds: editor.committedIds,
  };
}

export function scopeBringForwardEditor(
  editor: BringForwardEditor,
  scope: Readonly<{ roomId: string; generationId: string; vocabularyRevision: number }>,
): BringForwardEditor {
  const scan = editor.scan;
  if (!scan) return editor;
  if (
    scan.roomId === scope.roomId
    && scan.generationId === scope.generationId
    && scan.vocabularyRevision === scope.vocabularyRevision
  ) {
    return editor;
  }
  return EMPTY_EDITOR;
}

/**
 * Keep a compatible scan without selecting anything. A new room, generation,
 * ORIGINAL, vocabulary revision, or concept set drops the previous selection.
 */
export function installBringForwardScan(
  editor: BringForwardEditor,
  scan: BringForwardScan,
): BringForwardEditor {
  const current = editor.scan;
  if (
    current
    && current.roomId === scan.roomId
    && current.generationId === scan.generationId
    && sameImage(current.original, scan.original)
    && current.vocabularyRevision === scan.vocabularyRevision
    && current.conceptSet === scan.conceptSet
    && sameObjectIds(current.objects, scan.objects)
  ) {
    return editor;
  }
  const compatible = Boolean(
    current
    && current.roomId === scan.roomId
    && current.generationId === scan.generationId
    && sameImage(current.original, scan.original)
    && current.vocabularyRevision === scan.vocabularyRevision
    && current.conceptSet === scan.conceptSet,
  );
  const committedIds = compatible ? idsOnScan(editor.committedIds, scan) : EMPTY_IDS;
  const draftIds = editor.editing
    ? (compatible ? idsOnScan(editor.draftIds, scan) : EMPTY_IDS)
    : committedIds;
  return {
    editing: editor.editing,
    committedIds,
    draftIds,
    scan: {
      ...scan,
      objects: scan.objects.slice(),
    },
  };
}

export function bringForwardStatusMessage(input: Readonly<{
  display: BringForwardDisplayPhase;
  scanReady: boolean;
  objectCount: number;
  error: string | null;
}>): string {
  if (input.error) return input.error;
  if (input.display === "hide") return BRING_FORWARD_BACKGROUND_MESSAGE;
  if (input.display === "idle" || input.display === "checking") return BRING_FORWARD_CHECKING_MESSAGE;
  if (!input.scanReady) return BRING_FORWARD_FINDING_MESSAGE;
  if (input.objectCount === 0) return BRING_FORWARD_EMPTY_MESSAGE;
  return BRING_FORWARD_READY_MESSAGE;
}

export function readBringForwardConceptSet(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as { conceptSet?: unknown }).conceptSet;
  if (typeof value !== "string") return null;
  const conceptSet = value.trim();
  if (conceptSet.length < 1 || conceptSet.length > 80) return null;
  return conceptSet;
}

const scans = new Map<string, BringForwardScan>();
const failures = new Map<string, string>();
const inflight = new Map<string, Promise<BringForwardScan | null>>();
const listeners = new Set<() => void>();
let scanVersion = 0;

export function subscribeBringForwardScans(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function bringForwardScanVersion(): number {
  return scanVersion;
}

export function readBringForwardScan(key: string): BringForwardScan | null {
  return scans.get(key) ?? null;
}

export function readBringForwardScanError(key: string): string | null {
  return failures.get(key) ?? null;
}

export function rememberBringForwardScan(scan: BringForwardScan): void {
  const key = bringForwardScanKey({
    roomId: scan.roomId,
    generationId: scan.generationId,
    originalSha256: scan.original.sha256,
    originalWidth: scan.original.width,
    originalHeight: scan.original.height,
    vocabularyRevision: scan.vocabularyRevision,
  });
  if (!key || scan.conceptSet.trim().length === 0) return;
  const existing = scans.get(key);
  if (
    existing
    && existing.conceptSet === scan.conceptSet
    && sameObjectIds(existing.objects, scan.objects)
  ) {
    return;
  }
  scans.set(key, { ...scan, objects: scan.objects.slice() });
  failures.delete(key);
  publishScans();
}

export function resetBringForwardScansForTests(): void {
  scans.clear();
  failures.clear();
  inflight.clear();
  scanVersion = 0;
}

/**
 * One authorized segmentation request per room, generation, ORIGINAL, and
 * vocabulary revision. A cached or in-flight result is reused. Failures retry
 * on the next call. This does not bypass the route's sign-in, ownership, or
 * quota checks.
 */
export function loadBringForwardScan(input: Readonly<{
  identity: RemoveObjectUiIdentity;
  fetchImpl?: typeof fetch;
}>): Promise<BringForwardScan | null> {
  const key = bringForwardScanKey(input.identity);
  if (!key) return Promise.resolve(null);
  const cached = scans.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = requestBringForwardScan(input.identity, key, input.fetchImpl).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

async function requestBringForwardScan(
  identity: RemoveObjectUiIdentity,
  key: string,
  fetchImpl: typeof fetch | undefined,
): Promise<BringForwardScan | null> {
  failures.delete(key);
  publishScans();
  try {
    const result = await requestRemoveObjects({
      identity,
      signal: new AbortController().signal,
      fetchImpl,
    });
    const read = readRemoveObjectUiPayload(result.payload, identity);
    if (!read.ok) {
      failures.set(key, read.reason);
      publishScans();
      return null;
    }
    const conceptSet = readBringForwardConceptSet(result.payload);
    if (!conceptSet) {
      failures.set(key, BRING_FORWARD_UNUSABLE_MESSAGE);
      publishScans();
      return null;
    }
    const elapsedMs = Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0
      ? Math.round(result.elapsedMs)
      : 0;
    const scan: BringForwardScan = {
      roomId: identity.roomId,
      generationId: identity.generationId,
      original: {
        sha256: identity.originalSha256,
        width: identity.originalWidth,
        height: identity.originalHeight,
      },
      vocabularyRevision: identity.vocabularyRevision,
      conceptSet,
      objects: read.objects.slice(),
      diagnostics: { ...read.diagnostics, elapsedMs },
    };
    scans.set(key, scan);
    failures.delete(key);
    publishScans();
    return scan;
  } catch {
    failures.set(key, BRING_FORWARD_NO_RESPONSE_MESSAGE);
    publishScans();
    return null;
  }
}

function publishScans(): void {
  scanVersion += 1;
  for (const listener of listeners) listener();
}

function idsOnScan(ids: ReadonlySet<string>, scan: BringForwardScan): ReadonlySet<string> {
  let changed = false;
  const next = new Set<string>();
  for (const id of ids) {
    const object = scan.objects.find((item) => item.id === id);
    if (!object || !object.eligibility.eligible || !maskFits(object.mask, scan.original.width, scan.original.height)) {
      changed = true;
      continue;
    }
    next.add(id);
  }
  if (!changed && next.size === ids.size) return ids;
  return next;
}

/**
 * Copy ORIGINAL RGBA and replace alpha with unpacked mask coverage.
 * Selected masks combine by maximum coverage. RGB is unchanged.
 * An empty selection, a size mismatch, or an ineligible id produces nothing.
 */
export function compositeBringForwardRgba(input: Readonly<{
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  objects: readonly RemoveObjectRecord[];
  selectedIds: ReadonlySet<string>;
}>): Uint8ClampedArray | null {
  if (input.selectedIds.size === 0) return null;
  if (!positiveInteger(input.width) || !positiveInteger(input.height)) return null;
  const pixels = input.width * input.height;
  if (!Number.isSafeInteger(pixels) || input.rgba.length !== pixels * 4) return null;
  const selected: RemoveObjectRecord[] = [];
  for (const id of input.selectedIds) {
    const object = input.objects.find((item) => item.id === id);
    if (!object || !object.eligibility.eligible || !maskFits(object.mask, input.width, input.height)) {
      return null;
    }
    selected.push(object);
  }
  const output = new Uint8ClampedArray(input.rgba);
  for (let index = 3; index < output.length; index += 4) output[index] = 0;
  let covered = false;
  for (const object of selected) {
    const coverage = unpackRemoveMask(object.mask);
    if (!coverage || coverage.length !== pixels) return null;
    const bounds = object.mask.bounds;
    const y1 = bounds.y + bounds.height;
    const x1 = bounds.x + bounds.width;
    for (let y = bounds.y; y < y1; y += 1) {
      for (let x = bounds.x; x < x1; x += 1) {
        const pixel = y * input.width + x;
        const alpha = coverage[pixel] ?? 0;
        if (alpha <= 0) continue;
        const offset = pixel * 4 + 3;
        if (alpha > (output[offset] ?? 0)) output[offset] = alpha;
        covered = true;
      }
    }
  }
  return covered ? output : null;
}

function certifiedFrameAllows(
  original: BringForwardImageIdentity,
  displayed: BringForwardImageIdentity,
): boolean {
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: original.sha256,
      decodedWidth: original.width,
      decodedHeight: original.height,
      orientation: 1,
    },
    {
      fingerprint: displayed.sha256,
      decodedWidth: displayed.width,
      decodedHeight: displayed.height,
      orientation: 1,
    },
  );
  return compatibility.tier === "exact_grid_compatible"
    || compatibility.tier === "aspect_compatible_rescaled";
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sameImage(left: BringForwardImageIdentity, right: BringForwardImageIdentity): boolean {
  return left.sha256 === right.sha256 && left.width === right.width && left.height === right.height;
}

function sameObjectIds(
  left: readonly RemoveObjectRecord[],
  right: readonly RemoveObjectRecord[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.id !== right[index]?.id) return false;
  }
  return true;
}

function maskFits(
  mask: RemoveObjectRecord["mask"],
  width: number,
  height: number,
): boolean {
  return mask.width === width && mask.height === height;
}

function presentText(value: string): boolean {
  return value.trim().length > 0;
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
