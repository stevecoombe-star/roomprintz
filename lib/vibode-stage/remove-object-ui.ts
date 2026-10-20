/**
 * REMOVE object selection for one inspection session.
 *
 * Brush coverage and the selected-object union stay in separate buffers.
 * Display coverage is `max(brush, selected object coverage)`. Mask expansion
 * dilates that coverage into its own buffer; radius 0 uses the exact union.
 * Packed identity masks stay immutable and remain the hit-test source.
 * Protect Objects uses a separate union of every eligible identity mask.
 * That union is undilated and ignores which objects are hidden.
 * Hide All, Show All, and object clicks change the selection only. Clear Mask
 * changes the brush buffer only. A session loads segmentation once for its
 * room, generation, ORIGINAL identity, and session serial. Mode switches do
 * not load again.
 */

import {
  hideAllRemoveObjects,
  hitTestRemoveObjects,
  packRemoveMask,
  paintRemoveEffectiveCoverage,
  paintRemoveObjectUnion,
  prepareRemoveObjectMasks,
  removePackedBit,
  showAllRemoveObjects,
  toggleRemoveObjectSelection,
  type RemoveObjectRecord,
  type RemovePackedMask,
} from "@/lib/vibode-stage/remove-objects";
import type { RemoveDirtyRect } from "@/lib/vibode-stage/remove-mask";

export const REMOVE_OBJECT_UI_REQUEST_PATH = "/api/vibode/admin/remove-objects";
export const REMOVE_OBJECT_OUTLINE_VISIBLE = "#f5c518";
export const REMOVE_OBJECT_OUTLINE_HIDDEN = "#3d7eff";
export const REMOVE_OBJECT_EXPANSION_MAX_PX = 6;
export const REMOVE_OBJECT_EXPANSION_DEFAULT_PX = 2;

const MAX_MASKS = 48;
const MAX_EDGE = 8192;
const UNUSABLE = "Segmentation provider returned an unusable mask payload.";
const MISMATCH = "Segmentation result did not match this room.";
const NO_RESPONSE = "Segmentation provider did not respond.";

const SUPPRESSION_REASONS = new Set(["higher_confidence", "equal_confidence_lesser_id"]);

export type RemoveObjectOutlineTone = "yellow" | "blue";

export type RemoveObjectOutlineRender = Readonly<{
  rendered: boolean;
  tone: RemoveObjectOutlineTone | null;
  color: string | null;
  emphasized: boolean;
}>;

const EMPTY_BOUNDS: RemoveDirtyRect = { x: 0, y: 0, width: 0, height: 0 };
const DISK_OFFSETS: Array<ReadonlyArray<readonly [number, number]>> = [];

export type RemoveObjectUiIdentity = Readonly<{
  roomId: string;
  generationId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  sessionSerial: number;
}>;

export type RemoveObjectUiSuppressed = Readonly<{
  suppressedId: string;
  suppressedConcept: string;
  retainedConcept: string;
  reason: string;
  iou: number;
}>;

export type RemoveObjectUiRejected = Readonly<{
  concept: string;
  reasons: readonly string[];
}>;

export type RemoveObjectUiDiagnostics = Readonly<{
  provider: string;
  modelId: string;
  maskCount: number;
  eligibleCount: number;
  suppressed: readonly RemoveObjectUiSuppressed[];
  rejected: readonly RemoveObjectUiRejected[];
  providerTimeSec: number | null;
  elapsedMs: number;
}>;

export type RemoveObjectUiPhase = "idle" | "loading" | "ready" | "error";

export type RemoveObjectUiState = Readonly<{
  phase: RemoveObjectUiPhase;
  identity: RemoveObjectUiIdentity | null;
  requestSerial: number;
  objects: readonly RemoveObjectRecord[];
  selectedIds: ReadonlySet<string>;
  error: string | null;
  diagnostics: RemoveObjectUiDiagnostics | null;
}>;

export type RemoveObjectLoadCommand = "fetch" | "abort" | "none";

const EMPTY_OBJECTS: readonly RemoveObjectRecord[] = Object.freeze([]);
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

const INITIAL_STATE: RemoveObjectUiState = Object.freeze({
  phase: "idle",
  identity: null,
  requestSerial: 0,
  objects: EMPTY_OBJECTS,
  selectedIds: EMPTY_SELECTION,
  error: null,
  diagnostics: null,
});

export function initialRemoveObjectUiState(): RemoveObjectUiState {
  return INITIAL_STATE;
}

export function removeObjectUiIdentityKey(identity: RemoveObjectUiIdentity): string {
  return [
    identity.sessionSerial,
    identity.roomId,
    identity.generationId,
    identity.originalSha256,
    identity.originalWidth,
    identity.originalHeight,
  ].join(":");
}

export function removeObjectUiRequestBody(identity: RemoveObjectUiIdentity): string {
  return JSON.stringify({
    roomId: identity.roomId,
    generationId: identity.generationId,
  });
}

export function reduceRemoveObjectSession(input: Readonly<{
  state: RemoveObjectUiState;
  active: boolean;
  identity: RemoveObjectUiIdentity | null;
}>): Readonly<{ state: RemoveObjectUiState; command: RemoveObjectLoadCommand }> {
  if (!input.active || !input.identity || !validIdentity(input.identity)) {
    const state = dismissRemoveObjectSession(input.state);
    return { state, command: state === input.state ? "none" : "abort" };
  }
  if (
    sameIdentity(input.state.identity, input.identity)
    && (input.state.phase === "ready" || input.state.phase === "loading" || input.state.phase === "error")
  ) {
    return { state: input.state, command: "none" };
  }
  return {
    command: "fetch",
    state: {
      phase: "loading",
      identity: input.identity,
      requestSerial: input.state.requestSerial + 1,
      objects: EMPTY_OBJECTS,
      selectedIds: EMPTY_SELECTION,
      error: null,
      diagnostics: null,
    },
  };
}

export function dismissRemoveObjectSession(state: RemoveObjectUiState): RemoveObjectUiState {
  if (
    state.phase === "idle"
    && state.identity === null
    && state.objects.length === 0
    && state.selectedIds.size === 0
    && state.error === null
    && state.diagnostics === null
  ) {
    return state;
  }
  return {
    phase: "idle",
    identity: null,
    requestSerial: state.requestSerial + 1,
    objects: EMPTY_OBJECTS,
    selectedIds: EMPTY_SELECTION,
    error: null,
    diagnostics: null,
  };
}

export function settleRemoveObjectLoad(input: Readonly<{
  state: RemoveObjectUiState;
  requestSerial: number;
  identity: RemoveObjectUiIdentity;
  payload: unknown;
  elapsedMs: number;
}>): RemoveObjectUiState {
  if (!acceptingLoad(input.state, input.requestSerial, input.identity)) return input.state;
  const read = readRemoveObjectUiPayload(input.payload, input.identity);
  if (!read.ok) return errorState(input.state, read.reason);
  const elapsedMs = Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0
    ? Math.round(input.elapsedMs)
    : 0;
  return {
    phase: "ready",
    identity: input.identity,
    requestSerial: input.state.requestSerial,
    objects: read.objects,
    selectedIds: EMPTY_SELECTION,
    error: null,
    diagnostics: { ...read.diagnostics, elapsedMs },
  };
}

export function failRemoveObjectLoad(input: Readonly<{
  state: RemoveObjectUiState;
  requestSerial: number;
  identity: RemoveObjectUiIdentity;
  reason?: string;
}>): RemoveObjectUiState {
  if (!acceptingLoad(input.state, input.requestSerial, input.identity)) return input.state;
  return errorState(input.state, safeReason(input.reason, NO_RESPONSE));
}

export function applyRemoveObjectClick(
  state: RemoveObjectUiState,
  x: number,
  y: number,
): RemoveObjectUiState {
  if (state.phase !== "ready") return state;
  const id = hitTestRemoveObjects({
    objects: state.objects,
    selectedIds: state.selectedIds,
    x,
    y,
  });
  if (!id) return state;
  const selectedIds = toggleRemoveObjectSelection(state.selectedIds, state.objects, id);
  if (selectedIds === state.selectedIds) return state;
  return { ...state, selectedIds };
}

export function hideAllRemoveObjectUi(state: RemoveObjectUiState): RemoveObjectUiState {
  if (state.phase !== "ready") return state;
  return { ...state, selectedIds: hideAllRemoveObjects(state.objects) };
}

export function showAllRemoveObjectUi(state: RemoveObjectUiState): RemoveObjectUiState {
  if (state.phase !== "ready" || state.selectedIds.size === 0) return state;
  return { ...state, selectedIds: showAllRemoveObjects() };
}

export function highlightRemoveObject(
  state: RemoveObjectUiState,
  x: number,
  y: number,
): string | null {
  if (state.phase !== "ready") return null;
  return hitTestRemoveObjects({
    objects: state.objects,
    selectedIds: state.selectedIds,
    x,
    y,
  });
}

export function removeObjectOutlineTone(hidden: boolean): RemoveObjectOutlineTone {
  return hidden ? "blue" : "yellow";
}

export function removeObjectOutlineColor(tone: RemoveObjectOutlineTone): string {
  return tone === "blue" ? REMOVE_OBJECT_OUTLINE_HIDDEN : REMOVE_OBJECT_OUTLINE_VISIBLE;
}

/** Outline colour and hover emphasis. Hidden outlines do not change selection. */
export function removeObjectOutlineRender(input: Readonly<{
  outlinesVisible: boolean;
  hidden: boolean;
  hovered: boolean;
}>): RemoveObjectOutlineRender {
  if (input.outlinesVisible !== true) {
    return { rendered: false, tone: null, color: null, emphasized: false };
  }
  const tone = removeObjectOutlineTone(input.hidden === true);
  return {
    rendered: true,
    tone,
    color: removeObjectOutlineColor(tone),
    emphasized: input.hovered === true,
  };
}

export function clampRemoveObjectExpansion(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(REMOVE_OBJECT_EXPANSION_MAX_PX, Math.max(0, Math.round(value)));
}

/** Discrete Euclidean disk: an offset is included when dx² + dy² <= radius². */
export function removeObjectExpansionIncludesOffset(
  dx: number,
  dy: number,
  radiusPx: number,
): boolean {
  const radius = clampRemoveObjectExpansion(radiusPx);
  return dx * dx + dy * dy <= radius * radius;
}

export function expandRemoveDirtyRect(
  bounds: RemoveDirtyRect,
  radiusPx: number,
  width: number,
  height: number,
): RemoveDirtyRect {
  const radius = clampRemoveObjectExpansion(radiusPx);
  if (radius === 0) return bounds;
  const x0 = Math.max(0, bounds.x - radius);
  const y0 = Math.max(0, bounds.y - radius);
  const x1 = Math.min(width, bounds.x + bounds.width + radius);
  const y1 = Math.min(height, bounds.y + bounds.height + radius);
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}

function diskOffsets(radius: number): ReadonlyArray<readonly [number, number]> {
  const cached = DISK_OFFSETS[radius];
  if (cached) return cached;
  const offsets: Array<readonly [number, number]> = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (removeObjectExpansionIncludesOffset(dx, dy, radius)) offsets.push([dx, dy]);
    }
  }
  DISK_OFFSETS[radius] = offsets;
  return offsets;
}

function containedRect(bounds: RemoveDirtyRect, width: number, height: number): boolean {
  return Number.isInteger(bounds.x)
    && Number.isInteger(bounds.y)
    && Number.isInteger(bounds.width)
    && Number.isInteger(bounds.height)
    && bounds.x >= 0
    && bounds.y >= 0
    && bounds.width >= 0
    && bounds.height >= 0
    && bounds.x + bounds.width <= width
    && bounds.y + bounds.height <= height;
}

function intersectRemoveDirtyRect(left: RemoveDirtyRect, right: RemoveDirtyRect): RemoveDirtyRect {
  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(left.x + left.width, right.x + right.width);
  const y1 = Math.min(left.y + left.height, right.y + right.height);
  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}

function coverageBoundary(
  source: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    const ny = y + dy;
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || source[ny * width + nx] === 0) {
        return true;
      }
    }
  }
  return false;
}

function selectedCoverageBounds(
  objects: readonly RemoveObjectRecord[],
  selectedIds: ReadonlySet<string>,
): RemoveDirtyRect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  let any = false;
  for (const object of objects) {
    if (!selectedIds.has(object.id) || !object.eligibility.eligible) continue;
    const bounds = object.mask.bounds;
    if (bounds.width <= 0 || bounds.height <= 0) continue;
    any = true;
    if (bounds.x < minX) minX = bounds.x;
    if (bounds.y < minY) minY = bounds.y;
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  if (!any) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Eligible identity masks only. Hidden and visible objects are both included. */
export function eligibleRemoveObjectIds(
  objects: readonly RemoveObjectRecord[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const object of objects) {
    if (object.eligibility.eligible) ids.add(object.id);
  }
  return ids;
}

export function removeObjectProtectionAvailable(state: RemoveObjectUiState): boolean {
  return state.phase === "ready" && eligibleRemoveObjectIds(state.objects).size > 0;
}

export function removeObjectProtectionEngaged(input: Readonly<{
  enabled: boolean;
  state: RemoveObjectUiState;
}>): boolean {
  return input.enabled === true && removeObjectProtectionAvailable(input.state);
}

/**
 * Undilated union of every eligible identity mask. Selection and expansion
 * are not inputs. The packed bits are read and left unchanged.
 */
export function paintRemoveObjectProtection(input: Readonly<{
  destination: Uint8Array;
  width: number;
  height: number;
  objects: readonly RemoveObjectRecord[];
  bounds: RemoveDirtyRect;
}>): boolean {
  return paintRemoveObjectUnion({
    destination: input.destination,
    width: input.width,
    height: input.height,
    objects: input.objects,
    selectedIds: eligibleRemoveObjectIds(input.objects),
    bounds: input.bounds,
  });
}

/**
 * Euclidean dilation of a 0/255 coverage buffer, in ORIGINAL pixels.
 * `source` is not written. Output pixels are replaced inside `bounds`.
 * Set pixels are visited inside `sourceBounds` when it is provided; otherwise
 * the read region is the output bounds expanded by the radius. Interior pixels
 * are copied and the 8-connected boundary stamps the cached disk.
 */
export function dilateRemoveCoverage(input: Readonly<{
  source: Uint8Array;
  destination: Uint8Array;
  width: number;
  height: number;
  radiusPx: number;
  bounds: RemoveDirtyRect;
  sourceBounds?: RemoveDirtyRect;
}>): boolean {
  const { source, destination, width, height } = input;
  const pixels = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return false;
  if (source.length !== pixels || destination.length !== pixels || source === destination) return false;
  if (!containedRect(input.bounds, width, height)) return false;
  const radius = clampRemoveObjectExpansion(input.radiusPx);
  const output = input.bounds;
  for (let y = output.y; y < output.y + output.height; y += 1) {
    destination.fill(0, y * width + output.x, y * width + output.x + output.width);
  }
  if (output.width === 0 || output.height === 0) return true;
  if (radius === 0) {
    for (let y = output.y; y < output.y + output.height; y += 1) {
      let index = y * width + output.x;
      for (let x = 0; x < output.width; x += 1) {
        destination[index] = source[index] === 0 ? 0 : 255;
        index += 1;
      }
    }
    return true;
  }
  const read = expandRemoveDirtyRect(output, radius, width, height);
  const scan = input.sourceBounds ? intersectRemoveDirtyRect(input.sourceBounds, read) : read;
  if (!containedRect(scan, width, height)) return false;
  const offsets = diskOffsets(radius);
  const x1 = output.x + output.width;
  const y1 = output.y + output.height;
  for (let y = scan.y; y < scan.y + scan.height; y += 1) {
    for (let x = scan.x; x < scan.x + scan.width; x += 1) {
      const index = y * width + x;
      if (source[index] === 0) continue;
      if (!coverageBoundary(source, x, y, width, height)) {
        if (x >= output.x && y >= output.y && x < x1 && y < y1) destination[index] = 255;
        continue;
      }
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < output.x || ny < output.y || nx >= x1 || ny >= y1) continue;
        destination[ny * width + nx] = 255;
      }
    }
  }
  return true;
}

/**
 * Rebuild exact object coverage inside `bounds`, dilate it when requested,
 * then write `max(brush, coverage)`. Returns the rectangle written into
 * `destination`. Radius 0 does not read or write `dilated`.
 */
export function syncRemoveInspectionCoverage(input: Readonly<{
  brush: Uint8Array;
  objectUnion: Uint8Array;
  dilated?: Uint8Array;
  destination: Uint8Array;
  width: number;
  height: number;
  objects: readonly RemoveObjectRecord[];
  selectedIds: ReadonlySet<string>;
  bounds: RemoveDirtyRect;
  expansionPx?: number;
}>): RemoveDirtyRect | null {
  const expansion = clampRemoveObjectExpansion(input.expansionPx ?? 0);
  const union = paintRemoveObjectUnion({
    destination: input.objectUnion,
    width: input.width,
    height: input.height,
    objects: input.objects,
    selectedIds: input.selectedIds,
    bounds: input.bounds,
  });
  if (!union) return null;
  if (expansion === 0) {
    const painted = paintRemoveEffectiveCoverage({
      brush: input.brush,
      objectUnion: input.objectUnion,
      destination: input.destination,
      width: input.width,
      height: input.height,
      bounds: input.bounds,
    });
    return painted ? input.bounds : null;
  }
  const pixels = input.width * input.height;
  const dilated = input.dilated;
  if (
    !dilated
    || dilated.length !== pixels
    || dilated === input.brush
    || dilated === input.objectUnion
    || dilated === input.destination
  ) {
    return null;
  }
  const writeBounds = input.bounds.width === 0 || input.bounds.height === 0
    ? input.bounds
    : expandRemoveDirtyRect(input.bounds, expansion, input.width, input.height);
  const dilatedOk = dilateRemoveCoverage({
    source: input.objectUnion,
    destination: dilated,
    width: input.width,
    height: input.height,
    radiusPx: expansion,
    bounds: writeBounds,
    sourceBounds: selectedCoverageBounds(input.objects, input.selectedIds) ?? EMPTY_BOUNDS,
  });
  if (!dilatedOk) return null;
  const painted = paintRemoveEffectiveCoverage({
    brush: input.brush,
    objectUnion: dilated,
    destination: input.destination,
    width: input.width,
    height: input.height,
    bounds: writeBounds,
  });
  return painted ? writeBounds : null;
}

export function removeObjectBoundaryPixels(
  mask: RemovePackedMask,
): readonly Readonly<{ x: number; y: number }>[] {
  const points: Array<{ x: number; y: number }> = [];
  const { width, height } = mask;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return points;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!removePackedBit(mask, x, y)) continue;
      const interior = x > 0
        && y > 0
        && x + 1 < width
        && y + 1 < height
        && removePackedBit(mask, x - 1, y)
        && removePackedBit(mask, x + 1, y)
        && removePackedBit(mask, x, y - 1)
        && removePackedBit(mask, x, y + 1);
      if (!interior) points.push({ x, y });
    }
  }
  return points;
}

export function removeInspectionBackingSize(
  clientWidth: number,
  clientHeight: number,
  devicePixelRatio: number,
): Readonly<{ width: number; height: number }> | null {
  if (!(clientWidth > 0) || !(clientHeight > 0)) return null;
  const ratio = Math.min(
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
    2,
  );
  return {
    width: Math.max(1, Math.round(clientWidth * ratio)),
    height: Math.max(1, Math.round(clientHeight * ratio)),
  };
}

export function mapOriginalBoxToBacking(input: Readonly<{
  box: RemoveDirtyRect;
  originalWidth: number;
  originalHeight: number;
  backingWidth: number;
  backingHeight: number;
}>): Readonly<{ x: number; y: number; width: number; height: number }> | null {
  if (
    !(input.originalWidth > 0)
    || !(input.originalHeight > 0)
    || !(input.backingWidth > 0)
    || !(input.backingHeight > 0)
    || !(input.box.width > 0)
    || !(input.box.height > 0)
  ) {
    return null;
  }
  const scaleX = input.backingWidth / input.originalWidth;
  const scaleY = input.backingHeight / input.originalHeight;
  return {
    x: input.box.x * scaleX,
    y: input.box.y * scaleY,
    width: input.box.width * scaleX,
    height: input.box.height * scaleY,
  };
}

export function watchRemoveDevicePixelRatio(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  let detach = () => {};
  const bind = () => {
    detach();
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handle = () => {
      onChange();
      bind();
    };
    media.addEventListener("change", handle);
    detach = () => media.removeEventListener("change", handle);
  };
  bind();
  return () => detach();
}

export function formatRemoveObjectInferenceTime(input: Readonly<{
  elapsedMs: number;
  providerTimeSec: number | null;
}>): string {
  const client = `${(input.elapsedMs / 1000).toFixed(1)} s`;
  if (input.providerTimeSec === null || !Number.isFinite(input.providerTimeSec)) return client;
  return `${client} (provider ${input.providerTimeSec.toFixed(2)} s)`;
}

export function formatRemoveObjectSuppressed(items: readonly RemoveObjectUiSuppressed[]): string {
  if (items.length === 0) return "0";
  return items.map((item) => (
    `${item.suppressedConcept} duplicate of ${item.retainedConcept}, ${item.reason}, IoU ${item.iou.toFixed(2)}`
  )).join("; ");
}

export function formatRemoveObjectRejected(items: readonly RemoveObjectUiRejected[]): string {
  if (items.length === 0) return "0";
  return items.map((item) => `${item.concept}: ${item.reasons.join(", ") || "rejected"}`).join("; ");
}

export async function requestRemoveObjects(input: Readonly<{
  identity: RemoveObjectUiIdentity;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}>): Promise<Readonly<{ payload: unknown; elapsedMs: number }>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const started = performance.now();
  const response = await fetchImpl(REMOVE_OBJECT_UI_REQUEST_PATH, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: removeObjectUiRequestBody(input.identity),
    signal: input.signal,
  });
  const payload = await response.json().catch(() => null);
  return {
    payload,
    elapsedMs: Math.max(0, Math.round(performance.now() - started)),
  };
}

type PayloadRead =
  | Readonly<{ ok: true; objects: readonly RemoveObjectRecord[]; diagnostics: Omit<RemoveObjectUiDiagnostics, "elapsedMs"> }>
  | Readonly<{ ok: false; reason: string }>;

export function readRemoveObjectUiPayload(
  payload: unknown,
  identity: RemoveObjectUiIdentity,
): PayloadRead {
  const record = objectRecord(payload);
  if (!record) return { ok: false, reason: UNUSABLE };
  if ("image" in record || "bytes" in record || "api_key" in record || "authorization" in record) {
    return { ok: false, reason: UNUSABLE };
  }
  if (record.usable === false) return { ok: false, reason: safeReason(record.reason, UNUSABLE) };
  if (record.usable !== true) return { ok: false, reason: UNUSABLE };
  if (
    record.roomId !== identity.roomId
    || record.generationId !== identity.generationId
    || !sameSha(record.original, identity)
  ) {
    return { ok: false, reason: MISMATCH };
  }
  const provider = token(record.provider, 40);
  const modelId = token(record.modelId, 80);
  if (!provider || !modelId) return { ok: false, reason: UNUSABLE };
  const providerTimeSec = readProviderTime(record.providerTimeSec);
  if (providerTimeSec === "invalid") return { ok: false, reason: UNUSABLE };
  if (!Array.isArray(record.objects) || !Array.isArray(record.rejected) || !Array.isArray(record.suppressed)) {
    return { ok: false, reason: UNUSABLE };
  }
  if (
    record.objects.length > MAX_MASKS
    || record.rejected.length > MAX_MASKS
    || record.suppressed.length > MAX_MASKS
  ) {
    return { ok: false, reason: UNUSABLE };
  }
  const candidates: RemoveObjectRecord[] = [];
  for (const item of record.objects) {
    const decoded = decodeCandidate(item, identity);
    if (!decoded) return { ok: false, reason: UNUSABLE };
    candidates.push(decoded);
  }
  const rejected: RemoveObjectUiRejected[] = [];
  for (const item of record.rejected) {
    const decoded = decodeRejected(item, identity);
    if (!decoded) return { ok: false, reason: UNUSABLE };
    rejected.push(decoded);
  }
  const suppressed: RemoveObjectUiSuppressed[] = [];
  for (const item of record.suppressed) {
    const decoded = decodeSuppressed(item);
    if (!decoded) return { ok: false, reason: UNUSABLE };
    suppressed.push(decoded);
  }
  const prepared = prepareRemoveObjectMasks({ candidates });
  for (const extra of prepared.suppressed) {
    if (suppressed.some((item) => item.suppressedId === extra.suppressedId)) continue;
    suppressed.push({
      suppressedId: extra.suppressedId,
      suppressedConcept: extra.suppressedConcept,
      retainedConcept: extra.retainedConcept,
      reason: extra.reason,
      iou: extra.iou,
    });
  }
  return {
    ok: true,
    objects: prepared.eligible,
    diagnostics: {
      provider,
      modelId,
      maskCount: record.objects.length + record.rejected.length + record.suppressed.length,
      eligibleCount: prepared.eligible.length,
      suppressed,
      rejected,
      providerTimeSec,
    },
  };
}

function errorState(state: RemoveObjectUiState, reason: string): RemoveObjectUiState {
  return {
    phase: "error",
    identity: state.identity,
    requestSerial: state.requestSerial,
    objects: EMPTY_OBJECTS,
    selectedIds: EMPTY_SELECTION,
    error: reason,
    diagnostics: null,
  };
}

function acceptingLoad(
  state: RemoveObjectUiState,
  requestSerial: number,
  identity: RemoveObjectUiIdentity,
): boolean {
  return state.phase === "loading"
    && state.requestSerial === requestSerial
    && sameIdentity(state.identity, identity);
}

function sameIdentity(
  left: RemoveObjectUiIdentity | null,
  right: RemoveObjectUiIdentity,
): boolean {
  if (!left) return false;
  return left.roomId === right.roomId
    && left.generationId === right.generationId
    && left.originalSha256 === right.originalSha256
    && left.originalWidth === right.originalWidth
    && left.originalHeight === right.originalHeight
    && left.sessionSerial === right.sessionSerial;
}

function validIdentity(identity: RemoveObjectUiIdentity): boolean {
  return /^[0-9a-f-]{36}$/i.test(identity.roomId)
    && /^[0-9a-f-]{36}$/i.test(identity.generationId)
    && /^[a-f0-9]{64}$/.test(identity.originalSha256)
    && positiveEdge(identity.originalWidth)
    && positiveEdge(identity.originalHeight)
    && Number.isInteger(identity.sessionSerial)
    && identity.sessionSerial >= 0;
}

function positiveEdge(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_EDGE;
}

function sameSha(value: unknown, identity: RemoveObjectUiIdentity): boolean {
  const original = objectRecord(value);
  if (!original || typeof original.sha256 !== "string") return false;
  return original.sha256.toLowerCase() === identity.originalSha256
    && original.decodedWidth === identity.originalWidth
    && original.decodedHeight === identity.originalHeight;
}

function decodeCandidate(value: unknown, identity: RemoveObjectUiIdentity): RemoveObjectRecord | null {
  const record = objectRecord(value);
  if (!record) return null;
  const id = token(record.id, 80);
  const concept = label(record.concept);
  const confidence = readUnit(record.confidence);
  const mask = decodeMask(record.mask, identity);
  if (!id || !concept || confidence === null || !mask) return null;
  return {
    id,
    concept,
    confidence,
    mask,
    eligibility: {
      eligible: false,
      reasons: [],
      notices: [],
      confidence,
      areaPx: mask.areaPx,
      areaFraction: 0,
      edgeTouches: 0,
      bounds: mask.bounds,
    },
  };
}

function decodeRejected(value: unknown, identity: RemoveObjectUiIdentity): RemoveObjectUiRejected | null {
  const record = objectRecord(value);
  if (!record) return null;
  const concept = label(record.concept);
  const eligibility = objectRecord(record.eligibility);
  if (!concept || !eligibility || !Array.isArray(eligibility.reasons)) return null;
  if (!decodeMask(record.mask, identity)) return null;
  const reasons: string[] = [];
  for (const reason of eligibility.reasons) {
    const text = reasonLabel(reason);
    if (!text) return null;
    reasons.push(text);
  }
  return { concept, reasons };
}

function decodeSuppressed(value: unknown): RemoveObjectUiSuppressed | null {
  const record = objectRecord(value);
  if (!record) return null;
  const suppressedId = token(record.suppressedId, 80);
  const suppressedConcept = label(record.suppressedConcept);
  const retainedConcept = label(record.retainedConcept);
  const reason = typeof record.reason === "string" && SUPPRESSION_REASONS.has(record.reason)
    ? record.reason
    : null;
  const iou = readUnit(record.iou);
  if (!suppressedId || !suppressedConcept || !retainedConcept || !reason || iou === null) return null;
  return { suppressedId, suppressedConcept, retainedConcept, reason, iou };
}

function decodeMask(value: unknown, identity: RemoveObjectUiIdentity): RemovePackedMask | null {
  const record = objectRecord(value);
  if (!record) return null;
  if (record.width !== identity.originalWidth || record.height !== identity.originalHeight) return null;
  if (typeof record.bits !== "string") return null;
  const bits = decodeBase64(record.bits);
  if (!bits) return null;
  const expected = Math.ceil((identity.originalWidth * identity.originalHeight) / 8);
  if (bits.length !== expected) return null;
  const coverage = new Uint8Array(identity.originalWidth * identity.originalHeight);
  for (let index = 0; index < coverage.length; index += 1) {
    const byte = bits[index >> 3] ?? 0;
    if ((byte & (1 << (index & 7))) !== 0) coverage[index] = 255;
  }
  return packRemoveMask(coverage, identity.originalWidth, identity.originalHeight);
}

function decodeBase64(value: string): Uint8Array | null {
  if (value.length === 0 || value.length > 4_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function readProviderTime(value: unknown): number | null | "invalid" {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000) return "invalid";
  return value;
}

function readUnit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

function token(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !/^[a-z0-9._/-]+$/i.test(value) || value.length > max) return null;
  return value;
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0 || text.length > 40 || !/^[a-z0-9 ]+$/i.test(text)) return null;
  return text;
}

function reasonLabel(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-z_]{1,40}$/.test(value)) return null;
  return value;
}

function safeReason(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const reason = value.trim();
  if (reason.length === 0 || reason.length > 240 || /https?:\/\//i.test(reason)) return fallback;
  return reason;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
