/**
 * Bring Forward cutouts.
 *
 * A cutout is verified ORIGINAL pixels with mask coverage copied into alpha.
 * Selection belongs to Bring Forward. REMOVE's hidden-object set is not an input.
 * The first eligible object is selected when a new scan is retained. Later
 * selection can add ids without changing this composite.
 */

import {
  unpackRemoveMask,
  type RemoveObjectRecord,
} from "@/lib/vibode-stage/remove-objects";

const SHA256 = /^[0-9a-f]{64}$/;

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

export type BringForwardSession = Readonly<{
  snapshot: BringForwardSnapshot | null;
  selectedIds: ReadonlySet<string>;
}>;

export type BringForwardObservation = Readonly<{
  phase: "idle" | "loading" | "ready" | "error";
  roomId: string;
  generationId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  objects: readonly RemoveObjectRecord[];
}>;

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

const EMPTY_SESSION: BringForwardSession = Object.freeze({
  snapshot: null,
  selectedIds: EMPTY_SELECTION,
});

export function emptyBringForwardSession(): BringForwardSession {
  return EMPTY_SESSION;
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
 * Show only when the displayed background and the ORIGINAL pixel source are
 * the same verified image as the retained scan. REMOVE editing hides the cutout.
 */
export function assessBringForwardDisplay(input: Readonly<{
  snapshot: BringForwardSnapshot | null;
  roomId: string;
  generationId: string;
  displayed: BringForwardImageIdentity | null;
  source: BringForwardImageIdentity | null;
  removeActive: boolean;
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
  if (!sameImage(original, displayed) || !sameImage(original, source)) return "hide";
  return "show";
}

/**
 * Keep the last ready scan when REMOVE exits. A different room, generation,
 * ORIGINAL identity, or object list replaces it. An idle or loading observation
 * leaves the retained scan in place.
 */
export function retainBringForwardSession(
  session: BringForwardSession,
  input: Readonly<{
    roomId: string;
    generationId: string;
    observed: BringForwardObservation | null;
  }>,
): BringForwardSession {
  const scoped = session.snapshot
    && session.snapshot.roomId === input.roomId
    && session.snapshot.generationId === input.generationId
    ? session
    : blank(session);
  const observed = input.observed;
  if (
    !observed
    || observed.phase !== "ready"
    || observed.roomId !== input.roomId
    || observed.generationId !== input.generationId
  ) {
    return scoped;
  }
  const original = bringForwardImageIdentity({
    sha256: observed.originalSha256,
    width: observed.originalWidth,
    height: observed.originalHeight,
  });
  if (!original) return scoped;
  const snapshot = scoped.snapshot;
  if (
    snapshot
    && sameImage(snapshot.original, original)
    && sameObjectIds(snapshot.objects, observed.objects)
  ) {
    return scoped;
  }
  return {
    snapshot: {
      roomId: input.roomId,
      generationId: input.generationId,
      original,
      objects: observed.objects.slice(),
    },
    selectedIds: initialBringForwardSelection(observed.objects, original.width, original.height),
  };
}

export function initialBringForwardSelection(
  objects: readonly RemoveObjectRecord[],
  width: number,
  height: number,
): ReadonlySet<string> {
  for (const object of objects) {
    if (!object.eligibility.eligible || !maskFits(object.mask, width, height)) continue;
    return new Set([object.id]);
  }
  return EMPTY_SELECTION;
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

function blank(session: BringForwardSession): BringForwardSession {
  if (session.snapshot === null && session.selectedIds.size === 0) return session;
  return EMPTY_SESSION;
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
