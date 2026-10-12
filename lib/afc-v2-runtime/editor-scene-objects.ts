/**
 * Editor furniture coordinates shared by scene GET/PUT and Harmonize enqueue.
 *
 * Stored `objects_json` positions are automatic certified-camera floor
 * coordinates. When the generation's own manual-perspective record applies,
 * both callers convert those positions with `mapSceneObjectsBetweenCameras`.
 * The stored row is not written. A client-supplied camera is not an input.
 *
 * Harmonize's scene canonical hash uses this effective representation: the
 * positions scene GET gives the STAGE viewer and the QA capture submits.
 * The certified camera and scales are hashed with those positions. The stored
 * automatic-camera encoding is not. Rooms with no applicable manual
 * perspective keep the stored coordinates on both sides.
 *
 * The remap does not quantize x/z. Its internal epsilons only reject a point
 * that cannot be placed; they do not snap a successful result. The same
 * inputs return the same IEEE values, and JSON.stringify/parse of those
 * values round-trips. Position checks stay exact (`===`). The inverse map
 * can differ from the original stored coordinate by about 1e-6; Harmonize
 * compares the effective coordinates, not that inverse.
 */

import { mapSceneObjectsBetweenCameras } from "./effective-floor-remap";
import { resolveEffectiveProductionAuthority } from "./effective-production-authority";
import { validateProductionRuntimeAuthority } from "./runtime-authority";
import type { SceneObjectDefinition } from "./types";

export function editorSceneObjectsFromAuthority(input: Readonly<{
  objects: readonly SceneObjectDefinition[];
  productionAuthority: unknown;
  manualPerspective: unknown;
  direction: "to-effective" | "to-automatic";
}>): { ok: true; objects: readonly SceneObjectDefinition[] } | { ok: false } {
  const validated = validateProductionRuntimeAuthority(input.productionAuthority);
  if (!validated.ok) return { ok: true, objects: input.objects };
  const effective = resolveEffectiveProductionAuthority(
    validated.authority,
    input.manualPerspective,
  );
  if (effective.kind !== "manual") return { ok: true, objects: input.objects };
  const from = input.direction === "to-effective"
    ? validated.authority.frozenCamera
    : effective.authority.frozenCamera;
  const to = input.direction === "to-effective"
    ? effective.authority.frozenCamera
    : validated.authority.frozenCamera;
  const mapped = mapSceneObjectsBetweenCameras(input.objects, from, to);
  if (!mapped) return { ok: false };
  return { ok: true, objects: mapped };
}
