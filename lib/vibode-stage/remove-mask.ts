/**
 * REMOVE-1B in-memory mask.
 *
 * The mask is an 8-bit coverage grid at the authoritative ORIGINAL decoded
 * size. 0 shows ORIGINAL. 255 shows EMPTY. Values in between blend them.
 * Nothing here is stored, published, or sent to a generator.
 *
 * Reveal writes `mask = max(mask, coverage)`.
 * Restore writes `mask = min(mask, 255 - coverage)`.
 *
 * Repeating an identical dab does not change the mask. Overlapping dabs of
 * the same tool commute. A later dab of the opposite tool does not replace
 * a partial edge: Restore can only lower a pixel to `255 - coverage`, and a
 * later Reveal can only raise it to that dab's own coverage. The fully
 * covered core uses coverage 255, so Restore there returns the pixel to 0.
 */

export const REMOVE_BRUSH_DEFAULT_DIAMETER_PX = 64;
export const REMOVE_BRUSH_DEFAULT_FEATHER_PX = 16;
export const REMOVE_BRUSH_DIAMETER_MIN = 1;
export const REMOVE_BRUSH_DIAMETER_MAX = 512;

export type RemoveSessionMode = "objects" | "alignment" | "brush";
export type RemoveBrushTool = "reveal" | "restore";
export type RemoveGridTier =
  | "exact_grid_compatible"
  | "aspect_compatible_rescaled"
  | "incompatible";

export type RemoveBrushAdmission =
  | Readonly<{ allowed: true; aspectRescaling: boolean }>
  | Readonly<{ allowed: false; reason: string }>;

export type RemovePointerRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type RemovePointerLocation =
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "outside" }>
  | Readonly<{ status: "inside"; x: number; y: number }>;

export type RemovePoint = Readonly<{ x: number; y: number }>;

export type RemoveDirtyRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type RemoveArtifactIdentity = Readonly<{
  sessionSerial: number;
  roomId: string;
  generationId: string;
}>;

export type RemoveBitmapDecision =
  | Readonly<{ accept: true }>
  | Readonly<{ accept: false; reason: "stale" | "dimensions" }>;

export type RemoveMaskHoldIdentity = Readonly<{
  sessionSerial: number;
  roomId: string;
  generationId: string;
  width: number;
  height: number;
  epoch: number;
}>;

export type RemoveMaskHoldPlan = "ignore" | "keep" | "reset" | "allocate";

export type RemoveStrokeState = Readonly<{
  phase: "idle" | "active";
  pointerId: number | null;
  lastInside: RemovePoint | null;
}>;

export type RemoveStrokePaint = Readonly<{
  from: RemovePoint | null;
  to: RemovePoint;
}>;

export type RemoveStrokeEffect = Readonly<{
  capturePointerId: number | null;
  releasePointerId: number | null;
  paint: RemoveStrokePaint | null;
}>;

export type RemoveStrokeEvent =
  | Readonly<{
    type: "down";
    pointerId: number;
    primary: boolean;
    button: number;
    location: RemovePointerLocation;
  }>
  | Readonly<{ type: "move"; pointerId: number; location: RemovePointerLocation }>
  | Readonly<{ type: "up"; pointerId: number; location: RemovePointerLocation }>
  | Readonly<{ type: "cancel"; pointerId: number }>
  | Readonly<{ type: "lostcapture"; pointerId: number }>
  | Readonly<{ type: "unavailable"; pointerId: number }>
  | Readonly<{ type: "end" }>;

const NO_EFFECT: RemoveStrokeEffect = {
  capturePointerId: null,
  releasePointerId: null,
  paint: null,
};

export function clampRemoveBrushDiameter(value: number): number {
  if (!Number.isFinite(value)) return REMOVE_BRUSH_DEFAULT_DIAMETER_PX;
  return Math.min(
    REMOVE_BRUSH_DIAMETER_MAX,
    Math.max(REMOVE_BRUSH_DIAMETER_MIN, Math.round(value)),
  );
}

export function clampRemoveBrushFeather(value: number, diameterPx: number): number {
  const radius = Math.floor(clampRemoveBrushDiameter(diameterPx) / 2);
  if (!Number.isFinite(value)) return 0;
  return Math.min(radius, Math.max(0, Math.round(value)));
}

export function removeBrushCoverage(distance: number, radius: number, feather: number): number {
  if (!(radius > 0) || !Number.isFinite(distance) || distance < 0) return 0;
  const falloff = Math.min(Math.max(feather, 0), radius);
  if (falloff === 0) return distance <= radius ? 255 : 0;
  const core = radius - falloff;
  if (distance <= core) return 255;
  if (distance >= radius) return 0;
  const t = (distance - core) / (radius - core);
  const shaped = t * t * (3 - 2 * t);
  return Math.round(255 * (1 - shaped));
}

export function applyRemoveCoverage(
  stored: number,
  coverage: number,
  tool: RemoveBrushTool,
): number {
  const current = byte(stored);
  const value = byte(coverage);
  if (tool === "reveal") return Math.max(current, value);
  return Math.min(current, 255 - value);
}

export function removeBrushSegmentPoints(
  from: RemovePoint | null,
  to: RemovePoint,
  diameterPx: number,
): RemovePoint[] {
  const spacing = Math.max(1, clampRemoveBrushDiameter(diameterPx) / 8);
  if (!from) return [to];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (!(distance > 0)) return [to];
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const points: RemovePoint[] = [];
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    points.push({ x: from.x + dx * t, y: from.y + dy * t });
  }
  return points;
}

export function paintRemoveBrush(input: Readonly<{
  mask: Uint8Array;
  width: number;
  height: number;
  from: RemovePoint | null;
  to: RemovePoint;
  diameterPx: number;
  featherPx: number;
  tool: RemoveBrushTool;
  protection?: Uint8Array;
}>): RemoveDirtyRect | null {
  if (!grid(input.width, input.height) || input.mask.length !== input.width * input.height) {
    return null;
  }
  const diameterPx = clampRemoveBrushDiameter(input.diameterPx);
  const featherPx = clampRemoveBrushFeather(input.featherPx, diameterPx);
  const radius = diameterPx / 2;
  const points = removeBrushSegmentPoints(input.from, input.to, diameterPx);
  let minX = input.width;
  let minY = input.height;
  let maxX = 0;
  let maxY = 0;
  let touched = false;
  for (const point of points) {
    const x0 = Math.max(0, Math.floor(point.x - radius));
    const y0 = Math.max(0, Math.floor(point.y - radius));
    const x1 = Math.min(input.width, Math.ceil(point.x + radius));
    const y1 = Math.min(input.height, Math.ceil(point.y + radius));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const coverage = removeBrushCoverage(
          Math.hypot(point.x - (x + 0.5), point.y - (y + 0.5)),
          radius,
          featherPx,
        );
        if (coverage === 0) continue;
        const index = y * input.width + x;
        if (
          input.tool === "reveal"
          && input.protection
          && input.protection.length === input.mask.length
          && (input.protection[index] ?? 0) !== 0
        ) {
          continue;
        }
        input.mask[index] = applyRemoveCoverage(input.mask[index] ?? 0, coverage, input.tool);
      }
    }
    if (x1 > x0 && y1 > y0) {
      touched = true;
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    }
  }
  if (!touched) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function composeMaskCoverage(
  mask: Uint8Array,
  coverage: Uint8Array,
  tool: RemoveBrushTool,
): boolean {
  if (mask.length === 0 || mask.length !== coverage.length) return false;
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = applyRemoveCoverage(mask[index] ?? 0, coverage[index] ?? 0, tool);
  }
  return true;
}

export function resampleCoverageToOriginal(input: Readonly<{
  source: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  originalWidth: number;
  originalHeight: number;
  filter: "nearest" | "bilinear";
}>): Uint8Array | null {
  if (
    !grid(input.sourceWidth, input.sourceHeight)
    || !grid(input.originalWidth, input.originalHeight)
    || input.source.length !== input.sourceWidth * input.sourceHeight
  ) {
    return null;
  }
  const output = new Uint8Array(input.originalWidth * input.originalHeight);
  for (let y = 0; y < input.originalHeight; y += 1) {
    for (let x = 0; x < input.originalWidth; x += 1) {
      const fx = ((x + 0.5) / input.originalWidth) * input.sourceWidth - 0.5;
      const fy = ((y + 0.5) / input.originalHeight) * input.sourceHeight - 0.5;
      output[y * input.originalWidth + x] = input.filter === "nearest"
        ? sampleNearest(input.source, input.sourceWidth, input.sourceHeight, fx, fy)
        : sampleBilinear(input.source, input.sourceWidth, input.sourceHeight, fx, fy);
    }
  }
  return output;
}

/**
 * Browser pointer to ORIGINAL pixel coordinates.
 *
 * `rect` is the certified camera frame in CSS pixels. Device pixel ratio and
 * the canvas backing store are not inputs. Coordinates outside the rectangle
 * stay outside; they are not pulled onto the edge.
 */
export function mapRemovePointer(input: Readonly<{
  clientX: number;
  clientY: number;
  rect: RemovePointerRect;
  originalWidth: number;
  originalHeight: number;
}>): RemovePointerLocation {
  if (
    !grid(input.originalWidth, input.originalHeight)
    || !(input.rect.width > 0)
    || !(input.rect.height > 0)
    || !Number.isFinite(input.clientX)
    || !Number.isFinite(input.clientY)
    || !Number.isFinite(input.rect.left)
    || !Number.isFinite(input.rect.top)
  ) {
    return { status: "unavailable" };
  }
  const u = (input.clientX - input.rect.left) / input.rect.width;
  const v = (input.clientY - input.rect.top) / input.rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return { status: "outside" };
  return {
    status: "inside",
    x: u * input.originalWidth,
    y: v * input.originalHeight,
  };
}

export function removeBrushScreenDiameter(input: Readonly<{
  diameterPx: number;
  frameWidth: number;
  originalWidth: number;
}>): number {
  if (!(input.frameWidth > 0) || !(input.originalWidth > 0)) return 0;
  return clampRemoveBrushDiameter(input.diameterPx) * (input.frameWidth / input.originalWidth);
}

export function mapOriginalRectToDisplay(input: Readonly<{
  dirty: RemoveDirtyRect;
  maskWidth: number;
  maskHeight: number;
  displayWidth: number;
  displayHeight: number;
  pad: number;
}>): RemoveDirtyRect | null {
  if (
    !grid(input.maskWidth, input.maskHeight)
    || !grid(input.displayWidth, input.displayHeight)
    || !(input.dirty.width > 0)
    || !(input.dirty.height > 0)
  ) {
    return null;
  }
  const pad = Number.isFinite(input.pad) ? Math.max(0, input.pad) : 0;
  const x0 = Math.floor((input.dirty.x / input.maskWidth) * input.displayWidth) - pad;
  const y0 = Math.floor((input.dirty.y / input.maskHeight) * input.displayHeight) - pad;
  const x1 = Math.ceil(((input.dirty.x + input.dirty.width) / input.maskWidth) * input.displayWidth) + pad;
  const y1 = Math.ceil(((input.dirty.y + input.dirty.height) / input.maskHeight) * input.displayHeight) + pad;
  const x = Math.max(0, x0);
  const y = Math.max(0, y0);
  const right = Math.min(input.displayWidth, x1);
  const bottom = Math.min(input.displayHeight, y1);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export function removeBrushAdmission(input: Readonly<{
  gridCompatibility: RemoveGridTier;
  originalDisagreement: string | null;
  emptyDisagreement: string | null;
}>): RemoveBrushAdmission {
  if (input.originalDisagreement) {
    return { allowed: false, reason: input.originalDisagreement };
  }
  if (input.emptyDisagreement) {
    return { allowed: false, reason: input.emptyDisagreement };
  }
  if (input.gridCompatibility === "incompatible") {
    return {
      allowed: false,
      reason: "Brush needs an exact or aspect-compatible ORIGINAL and EMPTY pair.",
    };
  }
  return {
    allowed: true,
    aspectRescaling: input.gridCompatibility === "aspect_compatible_rescaled",
  };
}

export function acceptRemoveBrushBitmaps(input: Readonly<{
  requested: RemoveArtifactIdentity;
  current: RemoveArtifactIdentity | null;
  active: boolean;
  original: Readonly<{ width: number; height: number }>;
  empty: Readonly<{ width: number; height: number }>;
  expectedOriginal: Readonly<{ width: number; height: number }>;
  expectedEmpty: Readonly<{ width: number; height: number }>;
}>): RemoveBitmapDecision {
  if (!input.active || !sameIdentity(input.requested, input.current)) {
    return { accept: false, reason: "stale" };
  }
  if (
    input.original.width !== input.expectedOriginal.width
    || input.original.height !== input.expectedOriginal.height
    || input.empty.width !== input.expectedEmpty.width
    || input.empty.height !== input.expectedEmpty.height
  ) {
    return { accept: false, reason: "dimensions" };
  }
  return { accept: true };
}

export function planRemoveMaskHold(input: Readonly<{
  disposition: RemoveBitmapDecision;
  existing: RemoveMaskHoldIdentity | null;
  next: RemoveMaskHoldIdentity;
}>): RemoveMaskHoldPlan {
  if (!input.disposition.accept) return "ignore";
  const existing = input.existing;
  if (
    !existing
    || existing.sessionSerial !== input.next.sessionSerial
    || existing.roomId !== input.next.roomId
    || existing.generationId !== input.next.generationId
    || existing.width !== input.next.width
    || existing.height !== input.next.height
  ) {
    return "allocate";
  }
  if (existing.epoch !== input.next.epoch) return "reset";
  return "keep";
}

export function removeMaskedCoveragePercent(mask: Uint8Array): number {
  if (mask.length === 0) return 0;
  let sum = 0;
  for (const value of mask) sum += value;
  return (sum / (255 * mask.length)) * 100;
}

export function formatRemoveMaskedCoverage(percent: number): string {
  if (!Number.isFinite(percent)) return "0.00%";
  return `${percent.toFixed(2)}%`;
}

export function initialRemoveStrokeState(): RemoveStrokeState {
  return { phase: "idle", pointerId: null, lastInside: null };
}

/**
 * Pointer capture stays up for the whole stroke, including while the pointer
 * is outside the certified frame. Outside samples do not paint and do not
 * leave a point that the next inside sample can connect to.
 */
export function reduceRemoveStroke(
  state: RemoveStrokeState,
  event: RemoveStrokeEvent,
): Readonly<{ state: RemoveStrokeState; effect: RemoveStrokeEffect }> {
  if (event.type === "end") return release(state);
  if (event.type === "down") return beginStroke(state, event);
  if (state.phase !== "active" || state.pointerId !== event.pointerId) {
    return { state, effect: NO_EFFECT };
  }
  if (event.type === "cancel" || event.type === "lostcapture" || event.type === "unavailable") {
    return release(state);
  }
  if (event.type === "move") return moveStroke(state, event.location);
  return finishStroke(state, event.location);
}

function beginStroke(
  state: RemoveStrokeState,
  event: Extract<RemoveStrokeEvent, { type: "down" }>,
): Readonly<{ state: RemoveStrokeState; effect: RemoveStrokeEffect }> {
  if (state.phase === "active" || event.primary !== true || event.button !== 0) {
    return { state, effect: NO_EFFECT };
  }
  if (event.location.status === "unavailable") return { state, effect: NO_EFFECT };
  const inside = event.location.status === "inside" ? event.location : null;
  return {
    state: {
      phase: "active",
      pointerId: event.pointerId,
      lastInside: inside ? { x: inside.x, y: inside.y } : null,
    },
    effect: {
      capturePointerId: event.pointerId,
      releasePointerId: null,
      paint: inside ? { from: null, to: { x: inside.x, y: inside.y } } : null,
    },
  };
}

function moveStroke(
  state: RemoveStrokeState,
  location: RemovePointerLocation,
): Readonly<{ state: RemoveStrokeState; effect: RemoveStrokeEffect }> {
  if (location.status === "unavailable") return release(state);
  if (location.status === "outside") {
    if (state.lastInside === null) return { state, effect: NO_EFFECT };
    return {
      state: { ...state, lastInside: null },
      effect: NO_EFFECT,
    };
  }
  const to = { x: location.x, y: location.y };
  return {
    state: { ...state, lastInside: to },
    effect: {
      capturePointerId: null,
      releasePointerId: null,
      paint: { from: state.lastInside, to },
    },
  };
}

function finishStroke(
  state: RemoveStrokeState,
  location: RemovePointerLocation,
): Readonly<{ state: RemoveStrokeState; effect: RemoveStrokeEffect }> {
  if (location.status !== "inside") return release(state);
  const to = { x: location.x, y: location.y };
  return {
    state: initialRemoveStrokeState(),
    effect: {
      capturePointerId: null,
      releasePointerId: state.pointerId,
      paint: { from: state.lastInside, to },
    },
  };
}

function release(
  state: RemoveStrokeState,
): Readonly<{ state: RemoveStrokeState; effect: RemoveStrokeEffect }> {
  if (state.phase !== "active" || state.pointerId === null) {
    return { state: initialRemoveStrokeState(), effect: NO_EFFECT };
  }
  return {
    state: initialRemoveStrokeState(),
    effect: {
      capturePointerId: null,
      releasePointerId: state.pointerId,
      paint: null,
    },
  };
}

function sameIdentity(
  requested: RemoveArtifactIdentity,
  current: RemoveArtifactIdentity | null,
): current is RemoveArtifactIdentity {
  return current !== null
    && current.sessionSerial === requested.sessionSerial
    && current.roomId === requested.roomId
    && current.generationId === requested.generationId;
}

function sampleNearest(
  source: Uint8Array,
  width: number,
  height: number,
  fx: number,
  fy: number,
): number {
  const x = Math.min(width - 1, Math.max(0, Math.round(fx)));
  const y = Math.min(height - 1, Math.max(0, Math.round(fy)));
  return source[y * width + x] ?? 0;
}

function sampleBilinear(
  source: Uint8Array,
  width: number,
  height: number,
  fx: number,
  fy: number,
): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    return source[cy * width + cx] ?? 0;
  };
  const value = at(x0, y0) * (1 - tx) * (1 - ty)
    + at(x0 + 1, y0) * tx * (1 - ty)
    + at(x0, y0 + 1) * (1 - tx) * ty
    + at(x0 + 1, y0 + 1) * tx * ty;
  return byte(value);
}

function byte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function grid(width: number, height: number): boolean {
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0;
}
