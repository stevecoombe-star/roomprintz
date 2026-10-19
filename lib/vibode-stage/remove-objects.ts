/**
 * REMOVE-1C object masks.
 *
 * Identity masks are packed bits at the ORIGINAL decoded size. A set bit means
 * the object covers that pixel. Those bits stay immutable: this module does
 * not feather or dilate them.
 *
 * Brush coverage stays in its own grayscale buffer. The reveal mask is derived
 * and is never painted back into either source:
 *
 *   effective = max(brushMask, selectedObjectMaskUnion)
 *
 * Selecting an object writes 255 into the union. Deselecting rebuilds the
 * union inside that object's bounds from the masks that are still selected.
 * An overlap stays revealed while any selected mask covers it. Repeating a
 * toggle does not add coverage.
 *
 * Duplicate suppression uses intersection-over-union. A nested object whose
 * smaller mask sits mostly inside a larger mask, with IoU below the duplicate
 * threshold, is kept. A child mask that is almost the same pixels as its
 * parent crosses that IoU threshold and is suppressed as a duplicate.
 * Containment alone never removes an object.
 *
 * Area, edge contact, and full-frame span are diagnostic notices. The default
 * policy records them and still leaves the object eligible, so a large sofa,
 * bed, or rug is not dropped for its area. Confidence, an empty mask, and the
 * minimum pixel count reject with an explicit reason. A notice becomes a
 * rejection only when `rejectNotices` lists it.
 */

import {
  resampleCoverageToOriginal,
  type RemoveDirtyRect,
} from "@/lib/vibode-stage/remove-mask";

export const REMOVE_OBJECT_MASK_THRESHOLD = 128;
export const REMOVE_OBJECT_DUPLICATE_IOU = 0.7;
export const REMOVE_OBJECT_NESTED_CONTAINMENT = 0.9;

export const REMOVE_OBJECT_NOTICES = Object.freeze([
  "large_area",
  "edge_touch",
  "structural_edges",
  "full_frame",
] as const);

export type RemoveObjectNotice = (typeof REMOVE_OBJECT_NOTICES)[number];

export type RemoveObjectRejectionReason =
  | "malformed"
  | "duplicate_id"
  | "dimensions"
  | "confidence"
  | "empty_mask"
  | "min_area"
  | RemoveObjectNotice;

export type RemoveObjectEligibilityThresholds = Readonly<{
  minConfidence: number;
  minAreaPx: number;
  areaNoticeFraction: number;
  structuralAreaFraction: number;
  structuralEdgeTouches: number;
  fullFrameSpanFraction: number;
  rejectNotices: readonly RemoveObjectNotice[];
}>;

export const REMOVE_OBJECT_ELIGIBILITY_DEFAULTS: RemoveObjectEligibilityThresholds = Object.freeze({
  minConfidence: 0.5,
  minAreaPx: 400,
  areaNoticeFraction: 0.45,
  structuralAreaFraction: 0.2,
  structuralEdgeTouches: 3,
  fullFrameSpanFraction: 0.85,
  rejectNotices: Object.freeze([] as readonly RemoveObjectNotice[]),
});

export type RemovePackedMask = Readonly<{
  width: number;
  height: number;
  areaPx: number;
  bounds: RemoveDirtyRect;
  bits: Uint8Array;
}>;

export type RemoveObjectEligibility = Readonly<{
  eligible: boolean;
  reasons: readonly RemoveObjectRejectionReason[];
  notices: readonly RemoveObjectNotice[];
  confidence: number;
  areaPx: number;
  areaFraction: number;
  edgeTouches: number;
  bounds: RemoveDirtyRect;
}>;

export type RemoveObjectCandidate = Readonly<{
  id: string;
  confidence: number;
  concept: string;
  mask: RemovePackedMask;
}>;

export type RemoveObjectRecord = Readonly<{
  id: string;
  confidence: number;
  concept: string;
  mask: RemovePackedMask;
  eligibility: RemoveObjectEligibility;
}>;

export const REMOVE_OBJECT_SUPPRESSION_REASONS = Object.freeze([
  "higher_confidence",
  "equal_confidence_lesser_id",
] as const);

export type RemoveObjectSuppressionReason = (typeof REMOVE_OBJECT_SUPPRESSION_REASONS)[number];

/**
 * A duplicate report names the mask that was dropped and the mask that was
 * kept. `reason` is the keep-priority rule. Concept text is recorded and is
 * not part of that rule.
 */
export type RemoveSuppressedDuplicate = Readonly<{
  object: RemoveObjectRecord;
  duplicateOf: string;
  suppressedId: string;
  suppressedConcept: string;
  suppressedConfidence: number;
  retainedId: string;
  retainedConcept: string;
  retainedConfidence: number;
  iou: number;
  containment: number;
  reason: RemoveObjectSuppressionReason;
}>;

export type RemoveNestedObjects = Readonly<{
  innerId: string;
  outerId: string;
  iou: number;
  containment: number;
}>;

export type RemoveMaskOverlap = Readonly<{
  intersection: number;
  union: number;
  iou: number;
  containment: number;
}>;

export type RemoveObjectPreparation = Readonly<{
  eligible: readonly RemoveObjectRecord[];
  rejected: readonly RemoveObjectRecord[];
  suppressed: readonly RemoveSuppressedDuplicate[];
  nested: readonly RemoveNestedObjects[];
}>;

const NOTICE_ORDER = REMOVE_OBJECT_NOTICES;
const EMPTY_BOUNDS: RemoveDirtyRect = { x: 0, y: 0, width: 0, height: 0 };

export function removePackedByteLength(width: number, height: number): number {
  if (!grid(width, height)) return 0;
  return Math.ceil((width * height) / 8);
}

export function removeObjectFrameBounds(width: number, height: number): RemoveDirtyRect {
  if (!grid(width, height)) return EMPTY_BOUNDS;
  return { x: 0, y: 0, width, height };
}

/**
 * Pack a grayscale coverage grid. Samples at or above `threshold` become set
 * bits. The result is the identity mask; later feathering must use a copy.
 */
export function packRemoveMask(
  coverage: Uint8Array,
  width: number,
  height: number,
  threshold = REMOVE_OBJECT_MASK_THRESHOLD,
): RemovePackedMask | null {
  if (!grid(width, height) || coverage.length !== width * height) return null;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 256) return null;
  const bits = new Uint8Array(removePackedByteLength(width, height));
  let areaPx = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = coverage[y * width + x] ?? 0;
      if (value < threshold) continue;
      writeBit(bits, y * width + x);
      areaPx += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + 1 > maxX) maxX = x + 1;
      if (y + 1 > maxY) maxY = y + 1;
    }
  }
  return {
    width,
    height,
    areaPx,
    bounds: areaPx === 0
      ? EMPTY_BOUNDS
      : { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    bits,
  };
}

export function unpackRemoveMask(mask: RemovePackedMask): Uint8Array | null {
  if (!validPacked(mask)) return null;
  const coverage = new Uint8Array(mask.width * mask.height);
  for (let index = 0; index < coverage.length; index += 1) {
    if (bitIsSet(mask.bits, index)) coverage[index] = 255;
  }
  return coverage;
}

export function removePackedBit(mask: RemovePackedMask, x: number, y: number): boolean {
  if (!bitsFit(mask) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return bitIsSet(mask.bits, y * mask.width + x);
}

/**
 * Nearest-neighbor resample onto ORIGINAL pixels, then a hard threshold.
 * Matching dimensions skip the resample and still threshold.
 */
export function packRemoveObjectMaskAtOriginal(input: Readonly<{
  source: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  originalWidth: number;
  originalHeight: number;
  threshold?: number;
}>): RemovePackedMask | null {
  const threshold = input.threshold ?? REMOVE_OBJECT_MASK_THRESHOLD;
  if (input.sourceWidth === input.originalWidth && input.sourceHeight === input.originalHeight) {
    return packRemoveMask(input.source, input.originalWidth, input.originalHeight, threshold);
  }
  const resampled = resampleCoverageToOriginal({
    source: input.source,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    originalWidth: input.originalWidth,
    originalHeight: input.originalHeight,
    filter: "nearest",
  });
  if (!resampled) return null;
  return packRemoveMask(resampled, input.originalWidth, input.originalHeight, threshold);
}

/**
 * Continuous ORIGINAL coordinates from `mapRemovePointer`. The exact right
 * and bottom edges belong to the last pixel. Values outside the frame do not.
 */
export function removeObjectPixel(input: Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>): Readonly<{ x: number; y: number }> | null {
  if (!grid(input.width, input.height) || !Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    return null;
  }
  if (input.x < 0 || input.y < 0 || input.x > input.width || input.y > input.height) return null;
  const x = input.x === input.width ? input.width - 1 : Math.floor(input.x);
  const y = input.y === input.height ? input.height - 1 : Math.floor(input.y);
  if (x < 0 || y < 0 || x >= input.width || y >= input.height) return null;
  return { x, y };
}

export function assessRemoveObjectEligibility(
  mask: RemovePackedMask,
  confidence: number,
  thresholds?: Partial<RemoveObjectEligibilityThresholds>,
): RemoveObjectEligibility {
  const policy = resolveThresholds(thresholds);
  if (!validPacked(mask)) {
    return decision({
      reasons: ["malformed"],
      notices: [],
      confidence,
      areaPx: 0,
      areaFraction: 0,
      edgeTouches: 0,
      bounds: EMPTY_BOUNDS,
    });
  }
  const pixels = mask.width * mask.height;
  const areaFraction = mask.areaPx / pixels;
  const edgeTouches = countEdgeTouches(mask);
  const notices: RemoveObjectNotice[] = [];
  if (meetsFraction(mask.areaPx, pixels, policy.areaNoticeFraction)) notices.push("large_area");
  if (edgeTouches >= 1) notices.push("edge_touch");
  if (
    Number.isInteger(policy.structuralEdgeTouches)
    && policy.structuralEdgeTouches >= 1
    && edgeTouches >= policy.structuralEdgeTouches
    && meetsFraction(mask.areaPx, pixels, policy.structuralAreaFraction)
  ) {
    notices.push("structural_edges");
  }
  if (
    meetsFraction(mask.bounds.width, mask.width, policy.fullFrameSpanFraction)
    && meetsFraction(mask.bounds.height, mask.height, policy.fullFrameSpanFraction)
  ) {
    notices.push("full_frame");
  }
  const reasons: RemoveObjectRejectionReason[] = [];
  if (
    !Number.isFinite(confidence)
    || !Number.isFinite(policy.minConfidence)
    || confidence < policy.minConfidence
  ) {
    reasons.push("confidence");
  }
  if (mask.areaPx === 0) reasons.push("empty_mask");
  else if (Number.isInteger(policy.minAreaPx) && policy.minAreaPx > 0 && mask.areaPx < policy.minAreaPx) {
    reasons.push("min_area");
  }
  for (const notice of NOTICE_ORDER) {
    if (notices.includes(notice) && policy.rejectNotices.includes(notice)) reasons.push(notice);
  }
  return decision({
    reasons,
    notices,
    confidence,
    areaPx: mask.areaPx,
    areaFraction,
    edgeTouches,
    bounds: mask.bounds,
  });
}

export function removeMaskOverlap(
  left: RemovePackedMask,
  right: RemovePackedMask,
): RemoveMaskOverlap | null {
  if (!bitsFit(left) || !bitsFit(right)) return null;
  if (left.width !== right.width || left.height !== right.height) return null;
  if (left.bits.length !== right.bits.length) return null;
  let intersection = 0;
  for (let index = 0; index < left.bits.length; index += 1) {
    intersection += popcount((left.bits[index] ?? 0) & (right.bits[index] ?? 0));
  }
  const union = left.areaPx + right.areaPx - intersection;
  const smaller = Math.min(left.areaPx, right.areaPx);
  return {
    intersection,
    union,
    iou: union === 0 ? 0 : intersection / union,
    containment: smaller === 0 ? 0 : intersection / smaller,
  };
}

export function prepareRemoveObjectMasks(input: Readonly<{
  candidates: readonly RemoveObjectCandidate[];
  thresholds?: Partial<RemoveObjectEligibilityThresholds>;
  duplicateIou?: number;
  nestedContainment?: number;
}>): RemoveObjectPreparation {
  const duplicateIou = resolveRatio(input.duplicateIou, REMOVE_OBJECT_DUPLICATE_IOU);
  const nestedContainment = resolveRatio(input.nestedContainment, REMOVE_OBJECT_NESTED_CONTAINMENT);
  const seen = new Set<string>();
  let reference: Readonly<{ width: number; height: number }> | null = null;
  const drafted: RemoveObjectRecord[] = [];
  for (const candidate of input.candidates) {
    const mask = candidate.mask;
    const valid = validPacked(mask);
    if (valid && reference === null) reference = { width: mask.width, height: mask.height };
    const reasons: RemoveObjectRejectionReason[] = [];
    if (!valid || typeof candidate.id !== "string" || candidate.id.trim() === "") reasons.push("malformed");
    if (typeof candidate.concept !== "string") reasons.push("malformed");
    if (typeof candidate.id === "string" && candidate.id.trim() !== "") {
      if (seen.has(candidate.id)) reasons.push("duplicate_id");
      else seen.add(candidate.id);
    }
    if (
      valid
      && reference
      && (mask.width !== reference.width || mask.height !== reference.height)
    ) {
      reasons.push("dimensions");
    }
    const assessed = assessRemoveObjectEligibility(mask, candidate.confidence, input.thresholds);
    const eligibility = mergeReasons(assessed, reasons);
    drafted.push({
      id: typeof candidate.id === "string" ? candidate.id : "",
      confidence: candidate.confidence,
      concept: typeof candidate.concept === "string" ? candidate.concept : "",
      mask,
      eligibility,
    });
  }
  const rejected: RemoveObjectRecord[] = [];
  const admissible: RemoveObjectRecord[] = [];
  for (const object of drafted) {
    if (object.eligibility.eligible) admissible.push(object);
    else rejected.push(object);
  }
  const ranked = [...admissible].sort(byKeepPriority);
  const keptIds = new Set<string>();
  const suppressed: RemoveSuppressedDuplicate[] = [];
  for (const object of ranked) {
    let duplicateOf: RemoveSuppressedDuplicate | null = null;
    for (const keptId of keptIds) {
      const keeper = admissible.find((item) => item.id === keptId);
      if (!keeper) continue;
      const overlap = removeMaskOverlap(object.mask, keeper.mask);
      if (!overlap || !ratioAtLeast(overlap.intersection, overlap.union, duplicateIou)) continue;
      duplicateOf = {
        object,
        duplicateOf: keeper.id,
        suppressedId: object.id,
        suppressedConcept: object.concept,
        suppressedConfidence: object.confidence,
        retainedId: keeper.id,
        retainedConcept: keeper.concept,
        retainedConfidence: keeper.confidence,
        iou: overlap.iou,
        containment: overlap.containment,
        reason: suppressionReason(keeper, object),
      };
      break;
    }
    if (duplicateOf) suppressed.push(duplicateOf);
    else keptIds.add(object.id);
  }
  const eligible = admissible.filter((object) => keptIds.has(object.id));
  const nested: RemoveNestedObjects[] = [];
  for (let outerIndex = 0; outerIndex < eligible.length; outerIndex += 1) {
    for (let innerIndex = outerIndex + 1; innerIndex < eligible.length; innerIndex += 1) {
      const first = eligible[outerIndex];
      const second = eligible[innerIndex];
      if (!first || !second || first.mask.areaPx === second.mask.areaPx) continue;
      const overlap = removeMaskOverlap(first.mask, second.mask);
      if (!overlap) continue;
      if (ratioAtLeast(overlap.intersection, overlap.union, duplicateIou)) continue;
      const inner = first.mask.areaPx < second.mask.areaPx ? first : second;
      const outer = inner === first ? second : first;
      if (!ratioAtLeast(overlap.intersection, inner.mask.areaPx, nestedContainment)) continue;
      nested.push({
        innerId: inner.id,
        outerId: outer.id,
        iou: overlap.iou,
        containment: overlap.containment,
      });
    }
  }
  return { eligible, rejected, suppressed, nested };
}

export function toggleRemoveObjectSelection(
  selected: ReadonlySet<string>,
  objects: readonly RemoveObjectRecord[],
  id: string,
): ReadonlySet<string> {
  const object = objects.find((item) => item.id === id && item.eligibility.eligible);
  if (!object) return selected;
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function hideAllRemoveObjects(objects: readonly RemoveObjectRecord[]): ReadonlySet<string> {
  const next = new Set<string>();
  for (const object of objects) {
    if (object.eligibility.eligible) next.add(object.id);
  }
  return next;
}

export function showAllRemoveObjects(): ReadonlySet<string> {
  return new Set();
}

export function unionRemoveObjectBounds(objects: readonly RemoveObjectRecord[]): RemoveDirtyRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  let any = false;
  for (const object of objects) {
    if (!object.eligibility.eligible) continue;
    const bounds = object.mask.bounds;
    if (bounds.width <= 0 || bounds.height <= 0) continue;
    any = true;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  if (!any) return EMPTY_BOUNDS;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Rebuild union coverage inside `bounds` from the selected eligible masks.
 * Pixels outside `bounds` stay as they are. This is a replace, not a subtract.
 */
export function paintRemoveObjectUnion(input: Readonly<{
  destination: Uint8Array;
  width: number;
  height: number;
  objects: readonly RemoveObjectRecord[];
  selectedIds: ReadonlySet<string>;
  bounds: RemoveDirtyRect;
}>): boolean {
  if (!grid(input.width, input.height) || input.destination.length !== input.width * input.height) {
    return false;
  }
  const bounds = canonicalBounds(input.bounds, input.width, input.height);
  if (!bounds) return false;
  const active: RemoveObjectRecord[] = [];
  for (const object of input.objects) {
    if (!input.selectedIds.has(object.id) || !object.eligibility.eligible) continue;
    if (object.mask.width !== input.width || object.mask.height !== input.height || !bitsFit(object.mask)) {
      return false;
    }
    active.push(object);
  }
  if (bounds.width === 0 || bounds.height === 0) return true;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      let covered = false;
      for (const object of active) {
        const objectBounds = object.mask.bounds;
        if (
          x < objectBounds.x
          || y < objectBounds.y
          || x >= objectBounds.x + objectBounds.width
          || y >= objectBounds.y + objectBounds.height
        ) {
          continue;
        }
        if (bitIsSet(object.mask.bits, y * input.width + x)) {
          covered = true;
          break;
        }
      }
      input.destination[y * input.width + x] = covered ? 255 : 0;
    }
  }
  return true;
}

/** `effective = max(brush, objectUnion)` inside `bounds`. Neither source is written. */
export function paintRemoveEffectiveCoverage(input: Readonly<{
  brush: Uint8Array;
  objectUnion: Uint8Array;
  destination: Uint8Array;
  width: number;
  height: number;
  bounds: RemoveDirtyRect;
}>): boolean {
  const pixels = input.width * input.height;
  if (
    !grid(input.width, input.height)
    || input.brush.length !== pixels
    || input.objectUnion.length !== pixels
    || input.destination.length !== pixels
  ) {
    return false;
  }
  const bounds = canonicalBounds(input.bounds, input.width, input.height);
  if (!bounds) return false;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const index = y * input.width + x;
      input.destination[index] = Math.max(input.brush[index] ?? 0, input.objectUnion[index] ?? 0);
    }
  }
  return true;
}

/**
 * Click priority: selected masks that contain the pixel win over unselected
 * ones, so a second click peels a hidden object before it selects something
 * behind it. Inside that pool the smallest area wins, then higher confidence,
 * then the lesser id.
 */
export function hitTestRemoveObjects(input: Readonly<{
  objects: readonly RemoveObjectRecord[];
  selectedIds: ReadonlySet<string>;
  x: number;
  y: number;
}>): string | null {
  const first = input.objects[0];
  if (!first) return null;
  const width = first.mask.width;
  const height = first.mask.height;
  for (const object of input.objects) {
    if (object.mask.width !== width || object.mask.height !== height) return null;
  }
  const pixel = removeObjectPixel({ x: input.x, y: input.y, width, height });
  if (!pixel) return null;
  const hits: RemoveObjectRecord[] = [];
  for (const object of input.objects) {
    if (!object.eligibility.eligible || !bitsFit(object.mask)) continue;
    if (removePackedBit(object.mask, pixel.x, pixel.y)) hits.push(object);
  }
  if (hits.length === 0) return null;
  const selectedHits = hits.filter((object) => input.selectedIds.has(object.id));
  const pool = selectedHits.length > 0 ? selectedHits : hits;
  let winner = pool[0];
  if (!winner) return null;
  for (let index = 1; index < pool.length; index += 1) {
    const candidate = pool[index];
    if (candidate && preferHit(candidate, winner)) winner = candidate;
  }
  return winner.id;
}

function preferHit(candidate: RemoveObjectRecord, winner: RemoveObjectRecord): boolean {
  if (candidate.mask.areaPx !== winner.mask.areaPx) return candidate.mask.areaPx < winner.mask.areaPx;
  if (candidate.confidence !== winner.confidence) return candidate.confidence > winner.confidence;
  return candidate.id < winner.id;
}

function suppressionReason(
  retained: RemoveObjectRecord,
  suppressed: RemoveObjectRecord,
): RemoveObjectSuppressionReason {
  if (retained.confidence > suppressed.confidence) return "higher_confidence";
  return "equal_confidence_lesser_id";
}

function byKeepPriority(left: RemoveObjectRecord, right: RemoveObjectRecord): number {
  if (left.confidence !== right.confidence) return right.confidence - left.confidence;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function mergeReasons(
  assessed: RemoveObjectEligibility,
  integrity: readonly RemoveObjectRejectionReason[],
): RemoveObjectEligibility {
  if (integrity.length === 0) return assessed;
  const reasons: RemoveObjectRejectionReason[] = [];
  for (const reason of integrity) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  for (const reason of assessed.reasons) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return { ...assessed, eligible: false, reasons };
}

function decision(input: Readonly<{
  reasons: readonly RemoveObjectRejectionReason[];
  notices: readonly RemoveObjectNotice[];
  confidence: number;
  areaPx: number;
  areaFraction: number;
  edgeTouches: number;
  bounds: RemoveDirtyRect;
}>): RemoveObjectEligibility {
  return {
    eligible: input.reasons.length === 0,
    reasons: input.reasons,
    notices: input.notices,
    confidence: input.confidence,
    areaPx: input.areaPx,
    areaFraction: input.areaFraction,
    edgeTouches: input.edgeTouches,
    bounds: input.bounds,
  };
}

function resolveThresholds(
  overrides?: Partial<RemoveObjectEligibilityThresholds>,
): RemoveObjectEligibilityThresholds {
  return {
    minConfidence: overrides?.minConfidence ?? REMOVE_OBJECT_ELIGIBILITY_DEFAULTS.minConfidence,
    minAreaPx: overrides?.minAreaPx ?? REMOVE_OBJECT_ELIGIBILITY_DEFAULTS.minAreaPx,
    areaNoticeFraction: overrides?.areaNoticeFraction ?? REMOVE_OBJECT_ELIGIBILITY_DEFAULTS.areaNoticeFraction,
    structuralAreaFraction: overrides?.structuralAreaFraction
      ?? REMOVE_OBJECT_ELIGIBILITY_DEFAULTS.structuralAreaFraction,
    structuralEdgeTouches: overrides?.structuralEdgeTouches
      ?? REMOVE_OBJECT_ELIGIBILITY_DEFAULTS.structuralEdgeTouches,
    fullFrameSpanFraction: overrides?.fullFrameSpanFraction
      ?? REMOVE_OBJECT_ELIGIBILITY_DEFAULTS.fullFrameSpanFraction,
    rejectNotices: overrides?.rejectNotices ?? REMOVE_OBJECT_ELIGIBILITY_DEFAULTS.rejectNotices,
  };
}

function countEdgeTouches(mask: RemovePackedMask): number {
  const bounds = mask.bounds;
  if (bounds.width <= 0 || bounds.height <= 0) return 0;
  let touches = 0;
  if (bounds.x === 0) touches += 1;
  if (bounds.y === 0) touches += 1;
  if (bounds.x + bounds.width === mask.width) touches += 1;
  if (bounds.y + bounds.height === mask.height) touches += 1;
  return touches;
}

function meetsFraction(part: number, whole: number, fraction: number): boolean {
  return ratioAtLeast(part, whole, fraction);
}

function ratioAtLeast(numerator: number, denominator: number, ratio: number): boolean {
  if (!(denominator > 0) || !Number.isFinite(numerator) || !Number.isFinite(ratio) || ratio <= 0) {
    return false;
  }
  return numerator * 1_000_000 >= Math.round(ratio * 1_000_000) * denominator;
}

function resolveRatio(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0 || value > 1) return fallback;
  return value;
}

function canonicalBounds(
  bounds: RemoveDirtyRect,
  width: number,
  height: number,
): RemoveDirtyRect | null {
  if (
    !Number.isInteger(bounds.x)
    || !Number.isInteger(bounds.y)
    || !Number.isInteger(bounds.width)
    || !Number.isInteger(bounds.height)
  ) {
    return null;
  }
  if (bounds.width < 0 || bounds.height < 0 || bounds.x < 0 || bounds.y < 0) return null;
  if (bounds.width === 0 || bounds.height === 0) return EMPTY_BOUNDS;
  if (bounds.x + bounds.width > width || bounds.y + bounds.height > height) return null;
  return bounds;
}

function bitsFit(mask: RemovePackedMask | null | undefined): mask is RemovePackedMask {
  if (!mask || !grid(mask.width, mask.height)) return false;
  return mask.bits instanceof Uint8Array
    && mask.bits.length === removePackedByteLength(mask.width, mask.height);
}

function validPacked(mask: RemovePackedMask | null | undefined): mask is RemovePackedMask {
  if (!bitsFit(mask)) return false;
  if (!Number.isInteger(mask.areaPx) || mask.areaPx < 0 || mask.areaPx > mask.width * mask.height) {
    return false;
  }
  let counted = 0;
  for (const bite of mask.bits) counted += popcount(bite);
  if (counted !== mask.areaPx) return false;
  const bounds = mask.bounds;
  if (
    !bounds
    || !Number.isInteger(bounds.x)
    || !Number.isInteger(bounds.y)
    || !Number.isInteger(bounds.width)
    || !Number.isInteger(bounds.height)
  ) {
    return false;
  }
  if (mask.areaPx === 0) {
    return bounds.x === 0 && bounds.y === 0 && bounds.width === 0 && bounds.height === 0;
  }
  if (bounds.width <= 0 || bounds.height <= 0 || bounds.x < 0 || bounds.y < 0) return false;
  if (bounds.x + bounds.width > mask.width || bounds.y + bounds.height > mask.height) return false;
  return true;
}

function writeBit(bits: Uint8Array, index: number): void {
  bits[index >> 3] = (bits[index >> 3] ?? 0) | (1 << (index & 7));
}

function bitIsSet(bits: Uint8Array, index: number): boolean {
  return ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
}

function popcount(value: number): number {
  let count = 0;
  let rest = value & 0xff;
  while (rest) {
    count += rest & 1;
    rest >>= 1;
  }
  return count;
}

function grid(width: number, height: number): boolean {
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0;
}
