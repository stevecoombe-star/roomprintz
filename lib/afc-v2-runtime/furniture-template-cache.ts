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
  type FurnitureAssetResolver,
} from "./furniture-assets";
import { disposeObject3D } from "./object-runtime";
import type { FurnitureAssetDefinition, SceneObjectDefinition } from "./types";

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

export type FurnitureTemplateEnsureOptions = Readonly<{
  /**
   * Default true. First-add commercial bootstrap retries mint via the
   * runtime-placement endpoint instead of G5B2 scene resolve, so the
   * viewer passes false until the SceneObject exists.
   */
  allowRefresh?: boolean;
}>;

export type FurnitureTemplateCache = Readonly<{
  ensure: (
    assetIds: readonly string[],
    options?: FurnitureTemplateEnsureOptions,
  ) => Promise<readonly FurnitureTemplateLoadOutcome[]>;
  template: (assetId: string) => import("three").Group | null;
  loadedAssetIds: () => ReadonlySet<string>;
  dispose: () => void;
}>;

export function createFurnitureTemplateCache(input?: Readonly<{
  load?: (url: string) => Promise<LoadFurnitureGlbResult>;
  resolver?: FurnitureAssetResolver;
  /**
   * One refresh for dynamic overlay Assets after the first GLB load
   * failure. GLTFLoader.loadAsync does not expose HTTP status, so this
   * cannot distinguish transport/auth expiry from parse errors. Static
   * generated Assets are never refreshed. There is no second retry.
   */
  refreshDynamicAsset?: (
    assetId: string,
  ) => Promise<FurnitureAssetDefinition | null>;
}>): FurnitureTemplateCache {
  const load = input?.load ?? loadFurnitureGlb;
  const resolve = input?.resolver ?? furnitureAssetDefinition;
  const templates = new Map<string, import("three").Group>();
  const inflight = new Map<string, Promise<FurnitureTemplateLoadOutcome>>();
  let disposed = false;

  const storeTemplate = (
    assetId: string,
    result: LoadFurnitureGlbResult,
  ): FurnitureTemplateLoadOutcome => {
    if (disposed) {
      if (result.ok) disposeObject3D(result.scene);
      return { ok: false, assetId, message: "Furniture cache was disposed." };
    }
    if (!result.ok) {
      return { ok: false, assetId, message: result.message };
    }
    templates.set(assetId, result.scene);
    return { ok: true, assetId, scene: result.scene };
  };

  const loadAsset = (
    assetId: string,
    allowRefresh: boolean,
  ): Promise<FurnitureTemplateLoadOutcome> => {
    const cached = templates.get(assetId);
    if (cached) {
      return Promise.resolve({ ok: true, assetId, scene: cached });
    }
    const pending = inflight.get(assetId);
    if (pending) return pending;

    const asset = resolve(assetId);
    if (!asset) {
      return Promise.resolve({
        ok: false,
        assetId,
        message: "Unknown furniture asset.",
      });
    }
    const staticHit = furnitureAssetDefinition(assetId) != null;

    const promise = load(asset.glbUrl)
      .then(async (result): Promise<FurnitureTemplateLoadOutcome> => {
        if (
          result.ok ||
          staticHit ||
          !allowRefresh ||
          !input?.refreshDynamicAsset
        ) {
          return storeTemplate(assetId, result);
        }
        // Conservative: one refresh for any first dynamic load failure.
        const refreshed = await input.refreshDynamicAsset(assetId);
        if (!refreshed || furnitureAssetDefinition(refreshed.assetId)) {
          return storeTemplate(assetId, result);
        }
        const retry = await load(refreshed.glbUrl);
        if (!retry.ok) {
          return {
            ok: false,
            assetId,
            message: "RUNTIME_ASSET_LOAD_FAILED",
          };
        }
        return storeTemplate(assetId, retry);
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
    async ensure(assetIds, options) {
      const allowRefresh = options?.allowRefresh !== false;
      const unique = uniqueRegisteredFurnitureAssetIds(assetIds, resolve);
      const settled = await Promise.allSettled(
        unique.map((id) => loadAsset(id, allowRefresh)),
      );
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
