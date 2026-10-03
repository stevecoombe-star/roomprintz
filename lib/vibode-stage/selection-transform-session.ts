import type { RuntimeTransformMode } from "@/lib/afc-v2-runtime/types";

export type SelectionToolbarSlider = null | "rotate" | "size";

export type SelectionTransformSession = Readonly<{
  objectId: string | null;
  transformMode: RuntimeTransformMode;
  toolbarSlider: SelectionToolbarSlider;
}>;

/**
 * Transform mode belongs to one object-selection session.
 * A different object id, including clearing the selection, starts the next
 * session in Move. The same id keeps Move, Rotate, or Size.
 */
export function selectionTransformSessionAfterChange(
  current: SelectionTransformSession,
  nextObjectId: string | null,
): SelectionTransformSession {
  if (current.objectId === nextObjectId) return current;
  return {
    objectId: nextObjectId,
    transformMode: "move",
    toolbarSlider: null,
  };
}

/** Ignore sub-millimetre solver noise. A real floor move is larger. */
export const OBJECT_TRANSLATION_EPSILON_M = 0.001;

export type BodyDragMotionKind = "translate" | "shift-rotate" | "push-align";

export function objectPositionTranslated(
  before: Readonly<{ x: number; z: number }>,
  after: Readonly<{ x: number; z: number }>,
): boolean {
  return Math.hypot(after.x - before.x, after.z - before.z) > OBJECT_TRANSLATION_EPSILON_M;
}

/**
 * A body-drag sample counts as a user translation only when the move planner
 * applied a translation and the object position changed. Shift-rotate and
 * Push-to-Align are rotation samples even if the contact pivot shifts the center.
 */
export function bodyDragSampleTranslatedObject(
  kind: BodyDragMotionKind,
  before: Readonly<{ x: number; z: number }>,
  after: Readonly<{ x: number; z: number }>,
): boolean {
  if (kind !== "translate") return false;
  return objectPositionTranslated(before, after);
}

/**
 * A completed translation of the still-selected object ends Rotate or Size.
 * The object stays selected. Move with no slider is already the resting mode.
 */
export function selectionTransformSessionAfterTranslation(
  current: SelectionTransformSession,
  translatedObjectId: string,
): SelectionTransformSession {
  if (current.objectId !== translatedObjectId) return current;
  if (current.transformMode === "move" && current.toolbarSlider === null) return current;
  return {
    objectId: current.objectId,
    transformMode: "move",
    toolbarSlider: null,
  };
}

export function selectionTransformSessionAfterBodyDrag(
  current: SelectionTransformSession,
  objectId: string,
  samples: readonly Readonly<{
    kind: BodyDragMotionKind;
    before: Readonly<{ x: number; z: number }>;
    after: Readonly<{ x: number; z: number }>;
  }>[],
): SelectionTransformSession {
  const translated = samples.some((sample) => bodyDragSampleTranslatedObject(
    sample.kind,
    sample.before,
    sample.after,
  ));
  if (!translated) return current;
  return selectionTransformSessionAfterTranslation(current, objectId);
}
