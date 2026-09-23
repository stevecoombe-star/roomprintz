import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";

export type BoundScene = Readonly<{
  objects: readonly SceneObjectDefinition[];
  canUndo: boolean;
  undo: () => void;
}>;

export const EMPTY_BOUND_SCENE_OBJECTS: readonly SceneObjectDefinition[] =
  Object.freeze([]);

function objectsUnchanged(
  current: readonly SceneObjectDefinition[],
  next: readonly SceneObjectDefinition[],
): boolean {
  if (current === next) return true;
  return current.length === 0 && next.length === 0;
}

/**
 * Idempotent BoundScene replace. Empty arrays are logically equivalent even
 * when they are distinct references. Non-empty arrays stay referential so a
 * real persist/commit still updates.
 */
export function nextBoundScene(current: BoundScene, next: BoundScene): BoundScene {
  if (
    objectsUnchanged(current.objects, next.objects) &&
    current.canUndo === next.canUndo &&
    current.undo === next.undo
  ) {
    return current;
  }
  return next;
}
