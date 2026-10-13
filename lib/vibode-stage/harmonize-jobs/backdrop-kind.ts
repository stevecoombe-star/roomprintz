/**
 * Publication backdrop identity for a Harmonize job.
 *
 * The kind is derived from the background bytes the enqueue path already
 * hashed and from the AFC generation's stored empty and original digests.
 * A client-supplied label is not an input.
 */

import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";

export const HARMONIZE_BACKDROP_KINDS = ["afc_empty", "afc_original", "room_asset"] as const;

export type HarmonizeBackdropKind = (typeof HARMONIZE_BACKDROP_KINDS)[number];

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function classifyTrustedHarmonizeBackdrop(input: Readonly<{
  backgroundSha256: string;
  emptySha256: string | null;
  originalSha256: string | null;
}>): HarmonizeBackdropKind | null {
  if (!SHA256_HEX.test(input.backgroundSha256)) return null;
  if (!input.emptySha256 || !SHA256_HEX.test(input.emptySha256)) return null;
  if (!input.originalSha256 || !SHA256_HEX.test(input.originalSha256)) return null;
  // Identical EMPTY and ORIGINAL digests are one image. Empty wins, matching
  // the capture classifier. Either label would refer to those same bytes.
  if (input.backgroundSha256 === input.emptySha256) return "afc_empty";
  if (input.backgroundSha256 === input.originalSha256) return "afc_original";
  return "room_asset";
}

export function harmonizePublicationFields(input: Readonly<{
  backgroundSha256: string;
  emptySha256: string | null;
  originalSha256: string | null;
  persistedObjects: unknown;
  effectiveObjectIds: readonly string[];
}>): Readonly<{
  ok: true;
  backdropKind: HarmonizeBackdropKind;
  sceneObjects: SceneObjectDefinition[];
}> | Readonly<{ ok: false }> {
  const backdropKind = classifyTrustedHarmonizeBackdrop(input);
  if (!backdropKind || !Array.isArray(input.persistedObjects)) return { ok: false };
  if (input.persistedObjects.length > 32) return { ok: false };
  if (input.persistedObjects.length !== input.effectiveObjectIds.length) return { ok: false };
  for (let index = 0; index < input.persistedObjects.length; index += 1) {
    const object = input.persistedObjects[index];
    if (!object || typeof object !== "object" || Array.isArray(object)) return { ok: false };
    if (object.objectId !== input.effectiveObjectIds[index]) return { ok: false };
  }
  return {
    ok: true,
    backdropKind,
    sceneObjects: structuredClone(input.persistedObjects),
  };
}
