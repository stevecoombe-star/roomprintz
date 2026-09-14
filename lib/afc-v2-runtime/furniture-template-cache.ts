/**
 * Viewer-lifecycle furniture GLB template cache.
 *
 * Keyed by assetId. One template per Asset per viewer. Clones share
 * geometry/materials with the template; do not dispose clones.
 * This cache is not module-global and is not a Catalog preload.
 */

import type { LoadFurnitureGlbResult } from "./furniture-glb-loader";
import { loadFurnitureGlb } from "./furniture-glb-loader";
import {
  furnitureAssetDefinition,
  uniqueRegisteredFurnitureAssetIds,
} from "./furniture-assets";
import { disposeObject3D } from "./object-runtime";
import type { SceneObjectDefinition } from "./types";

export type FurnitureTemplateLoadSuccess = Readonly<{
  ok: true;
  assetId: string;
  scene: import("three").Group;
}>;

export type FurnitureTemplateLoadFailure = Readonly<{
  ok: false;
  assetId: string;
  message: string;
}>;

export type FurnitureTemplateLoadOutcome =
  | FurnitureTemplateLoadSuccess
  | FurnitureTemplateLoadFailure;

export type FurnitureTemplateCache = Readonly<{
  ensure: (
    assetIds: readonly string[],
  ) => Promise<readonly FurnitureTemplateLoadOutcome[]>;
  template: (assetId: string) => import("three").Group | null;
  loadedAssetIds: () => ReadonlySet<string>;
  dispose: () => void;
}>;

export function createFurnitureTemplateCache(input?: Readonly<{
  load?: (url: string) => Promise<LoadFurnitureGlbResult>;
}>): FurnitureTemplateCache {
  const load = input?.load ?? loadFurnitureGlb;
  const templates = new Map<string, import("three").Group>();
  const inflight = new Map<string, Promise<FurnitureTemplateLoadOutcome>>();
  let disposed = false;

  const loadAsset = (assetId: string): Promise<FurnitureTemplateLoadOutcome> => {
    const cached = templates.get(assetId);
    if (cached) {
      return Promise.resolve({ ok: true, assetId, scene: cached });
    }
    const pending = inflight.get(assetId);
    if (pending) return pending;

    const asset = furnitureAssetDefinition(assetId);
    if (!asset) {
      return Promise.resolve({
        ok: false,
        assetId,
        message: "Unknown furniture asset.",
      });
    }

    const promise = load(asset.glbUrl)
      .then((result): FurnitureTemplateLoadOutcome => {
        if (disposed) {
          if (result.ok) disposeObject3D(result.scene);
          return { ok: false, assetId, message: "Furniture cache was disposed." };
        }
        if (!result.ok) {
          return { ok: false, assetId, message: result.message };
        }
        templates.set(assetId, result.scene);
        return { ok: true, assetId, scene: result.scene };
      })
      .catch((error: unknown): FurnitureTemplateLoadOutcome => ({
        ok: false,
        assetId,
        message: error instanceof Error
          ? error.message
          : "Unable to load furniture asset.",
      }))
      .finally(() => {
        inflight.delete(assetId);
      });

    inflight.set(assetId, promise);
    return promise;
  };

  return {
    async ensure(assetIds) {
      const unique = uniqueRegisteredFurnitureAssetIds(assetIds);
      const settled = await Promise.allSettled(unique.map((id) => loadAsset(id)));
      return unique.map((assetId, index) => {
        const item = settled[index];
        if (item?.status === "fulfilled") return item.value;
        return {
          ok: false as const,
          assetId,
          message: item?.status === "rejected"
            ? String(item.reason)
            : "Unable to load furniture asset.",
        };
      });
    },
    template(assetId) {
      return templates.get(assetId) ?? null;
    },
    loadedAssetIds() {
      return new Set(templates.keys());
    },
    dispose() {
      disposed = true;
      for (const scene of templates.values()) {
        disposeObject3D(scene);
      }
      templates.clear();
      inflight.clear();
    },
  };
}

export function mergeMountedAndSkippedSceneObjects(input: Readonly<{
  order: readonly SceneObjectDefinition[];
  mounted: readonly SceneObjectDefinition[];
  skipped: ReadonlyMap<string, SceneObjectDefinition>;
}>): SceneObjectDefinition[] {
  const mountedById = new Map(
    input.mounted.map((object) => [object.objectId, object]),
  );
  const merged: SceneObjectDefinition[] = [];
  const seen = new Set<string>();
  for (const definition of input.order) {
    if (seen.has(definition.objectId)) continue;
    seen.add(definition.objectId);
    merged.push(
      mountedById.get(definition.objectId) ??
        input.skipped.get(definition.objectId) ??
        definition,
    );
  }
  for (const object of input.mounted) {
    if (seen.has(object.objectId)) continue;
    merged.push(object);
  }
  return merged;
}
