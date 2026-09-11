"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

import { createPi4bSceneObjectDefinitions } from "./furniture-runtime";
import {
  createLoadedSceneInstanceId,
  pendingSceneInstanceId,
  persistenceSafeSceneObjects,
  sceneIdentitiesEqual,
  shouldApplySceneRequest,
  toPersistedVersionScene,
  validatePersistedVersionScene,
  type PersistedSceneIdentity,
} from "./persisted-scene";
import {
  interpretVersionSceneLoadResponse,
  interpretVersionSceneSaveResponse,
  versionScenePutBody,
  versionSceneUrl,
} from "./scene-persistence-client";
import type { SceneObjectDefinition, SerializedRuntimeScene } from "./types";

export const PI4C_SCENE_SAVE_ERROR_MESSAGE =
  "Couldn't save this 3D scene. Your layout is still here.";

export type Persisted3dSceneState = Readonly<{
  objects: readonly SceneObjectDefinition[];
  sceneInstanceId: string;
  sceneReady: boolean;
  loading: boolean;
  loadRevision: number;
  saveError: string | null;
  origin: "default" | "persisted";
  onObjectTransformCommitted: (scene: SerializedRuntimeScene) => void;
}>;

type LoadedVersionScene = Readonly<{
  identity: PersistedSceneIdentity;
  objects: readonly SceneObjectDefinition[];
  origin: "default" | "persisted";
  dirty: boolean;
}>;

type PendingSave = Readonly<{
  identity: PersistedSceneIdentity;
  serialized: SerializedRuntimeScene;
}>;

function defaultObjects(): SceneObjectDefinition[] {
  // Missing scene row only. A persisted objects:[] snapshot is restored as-is.
  return persistenceSafeSceneObjects(createPi4bSceneObjectDefinitions());
}

function warnSceneRestore(detail: unknown) {
  if (typeof console === "undefined") return;
  console.warn("[afc-3d-scene] persisted scene was not restored", detail);
}

export function usePersisted3dScene(input: Readonly<{
  roomId: string | null;
  versionId: string | null;
  spatialAuthorityId: string | null;
  enabled: boolean;
}>): Persisted3dSceneState {
  const identity: PersistedSceneIdentity | null =
    input.enabled && input.roomId && input.versionId && input.spatialAuthorityId
      ? {
          roomId: input.roomId,
          versionId: input.versionId,
          afcGenerationId: input.spatialAuthorityId,
        }
      : null;

  const [objects, setObjects] = useState<readonly SceneObjectDefinition[]>([]);
  const [origin, setOrigin] = useState<"default" | "persisted">("default");
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadedIdentity, setLoadedIdentity] = useState<PersistedSceneIdentity | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);

  const latestLoadIdRef = useRef(0);
  const loadRevisionRef = useRef(0);
  const loadedRef = useRef<LoadedVersionScene | null>(null);
  const identityRef = useRef<PersistedSceneIdentity | null>(identity);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const saveGateRef = useRef<Promise<boolean> | null>(null);
  identityRef.current = identity;

  const persistIdentity = useCallback((
    target: PersistedSceneIdentity,
    serialized: SerializedRuntimeScene,
  ): Promise<boolean> => {
    pendingSaveRef.current = { identity: target, serialized };
    if (saveGateRef.current) return saveGateRef.current;

    const gate = (async () => {
      let ok = true;
      try {
        while (pendingSaveRef.current) {
          const job = pendingSaveRef.current;
          pendingSaveRef.current = null;
          try {
            const token = await getSupabaseBrowserAccessToken();
            if (!token) {
              ok = false;
              setSaveError(PI4C_SCENE_SAVE_ERROR_MESSAGE);
              continue;
            }
            const response = await fetch(versionSceneUrl(job.identity), {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(versionScenePutBody(job.identity, job.serialized)),
              cache: "no-store",
            });
            const payload = await response.json().catch(() => null);
            const interpreted = interpretVersionSceneSaveResponse({
              ok: response.ok,
              payload,
            });
            if (interpreted.status !== "saved") {
              ok = false;
              setSaveError(PI4C_SCENE_SAVE_ERROR_MESSAGE);
              continue;
            }
            if (
              loadedRef.current &&
              sceneIdentitiesEqual(loadedRef.current.identity, job.identity)
            ) {
              loadedRef.current = {
                ...loadedRef.current,
                objects: persistenceSafeSceneObjects(job.serialized.objects),
                origin: "persisted",
                dirty: false,
              };
            }
            if (sceneIdentitiesEqual(identityRef.current, job.identity)) {
              setOrigin("persisted");
              setSaveError(null);
            }
          } catch {
            ok = false;
            setSaveError(PI4C_SCENE_SAVE_ERROR_MESSAGE);
          }
        }
        return ok;
      } finally {
        saveGateRef.current = null;
      }
    })();
    saveGateRef.current = gate;
    return gate;
  }, []);

  const flushLoadedIfDirty = useCallback(async () => {
    const loaded = loadedRef.current;
    if (!loaded?.dirty) return true;
    return persistIdentity(loaded.identity, { objects: loaded.objects });
  }, [persistIdentity]);

  const restoreCachedScene = useCallback((cached: LoadedVersionScene) => {
    setObjects(cached.objects);
    setOrigin(cached.origin);
    setLoadedIdentity(cached.identity);
    setLoading(false);
  }, []);

  const commitResolvedSnapshot = useCallback((
    requestIdentity: PersistedSceneIdentity,
    nextObjects: readonly SceneObjectDefinition[],
    nextOrigin: "default" | "persisted",
  ) => {
    loadRevisionRef.current += 1;
    loadedRef.current = {
      identity: requestIdentity,
      objects: nextObjects,
      origin: nextOrigin,
      dirty: false,
    };
    setLoadRevision(loadRevisionRef.current);
    setObjects(nextObjects);
    setOrigin(nextOrigin);
    setLoadedIdentity(requestIdentity);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!identity) {
      latestLoadIdRef.current += 1;
      void flushLoadedIfDirty();
      return;
    }
    const requestIdentity = identity;
    if (
      loadedRef.current &&
      sceneIdentitiesEqual(loadedRef.current.identity, requestIdentity)
    ) {
      restoreCachedScene(loadedRef.current);
      return;
    }
    const requestId = latestLoadIdRef.current + 1;
    latestLoadIdRef.current = requestId;
    let cancelled = false;
    setLoading(true);
    setSaveError(null);

    async function load() {
      const previous = loadedRef.current;
      if (previous && !sceneIdentitiesEqual(previous.identity, requestIdentity)) {
        if (previous.dirty) {
          await persistIdentity(previous.identity, { objects: previous.objects });
        }
      }
      if (cancelled || requestId !== latestLoadIdRef.current) return;
      if (
        loadedRef.current &&
        sceneIdentitiesEqual(loadedRef.current.identity, requestIdentity)
      ) {
        restoreCachedScene(loadedRef.current);
        return;
      }
      try {
        const token = await getSupabaseBrowserAccessToken();
        if (!token) throw new Error("missing token");
        if (cancelled || requestId !== latestLoadIdRef.current) return;
        const response = await fetch(versionSceneUrl(requestIdentity), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (
          cancelled ||
          !shouldApplySceneRequest({
            requestId,
            latestRequestId: latestLoadIdRef.current,
            requestIdentity,
            currentIdentity: identityRef.current,
          })
        ) {
          return;
        }
        const interpreted = interpretVersionSceneLoadResponse({
          ok: response.ok,
          payload,
        });
        if (interpreted.status === "error") {
          warnSceneRestore(interpreted.message);
        } else if (
          interpreted.status === "incompatible" ||
          interpreted.status === "malformed"
        ) {
          warnSceneRestore({
            status: interpreted.status,
            reason: interpreted.reason,
            storedAfcGenerationId: "storedAfcGenerationId" in interpreted
              ? interpreted.storedAfcGenerationId
              : null,
          });
        }
        let nextObjects: readonly SceneObjectDefinition[] = defaultObjects();
        let nextOrigin: "default" | "persisted" = "default";
        if (interpreted.status === "ready") {
          const parsed = validatePersistedVersionScene(interpreted.scene);
          if (
            parsed.ok &&
            parsed.scene.roomId === requestIdentity.roomId &&
            parsed.scene.versionId === requestIdentity.versionId &&
            parsed.scene.afcGenerationId === requestIdentity.afcGenerationId
          ) {
            nextObjects = parsed.scene.objects;
            nextOrigin = "persisted";
          } else {
            warnSceneRestore(parsed.ok ? "scene identity mismatch" : parsed.reason);
          }
        }
        commitResolvedSnapshot(requestIdentity, nextObjects, nextOrigin);
      } catch (error) {
        if (
          cancelled ||
          !shouldApplySceneRequest({
            requestId,
            latestRequestId: latestLoadIdRef.current,
            requestIdentity,
            currentIdentity: identityRef.current,
          })
        ) {
          return;
        }
        warnSceneRestore(error);
        commitResolvedSnapshot(requestIdentity, defaultObjects(), "default");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // identity is reconstructed each render; depend on its fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    input.enabled,
    input.roomId,
    input.versionId,
    input.spatialAuthorityId,
    persistIdentity,
    flushLoadedIfDirty,
    restoreCachedScene,
    commitResolvedSnapshot,
  ]);

  useEffect(() => {
    return () => {
      void flushLoadedIfDirty();
    };
  }, [flushLoadedIfDirty]);

  const onObjectTransformCommitted = useCallback((scene: SerializedRuntimeScene) => {
    const current = identityRef.current;
    const loaded = loadedRef.current;
    if (!current || !loaded || !sceneIdentitiesEqual(loaded.identity, current)) {
      return;
    }
    const next = toPersistedVersionScene(current, scene);
    loadedRef.current = {
      identity: current,
      objects: next.objects,
      origin: loaded.origin,
      dirty: true,
    };
    setObjects(next.objects);
    void persistIdentity(current, scene);
  }, [persistIdentity]);

  const sceneReady =
    Boolean(loadedIdentity) &&
    !loading &&
    sceneIdentitiesEqual(loadedIdentity, identity);
  const sceneInstanceId = sceneReady && loadedIdentity
    ? createLoadedSceneInstanceId(loadedIdentity, loadRevision)
    : identity
      ? pendingSceneInstanceId(identity)
      : "local-unbound";

  return {
    objects: sceneReady ? objects : [],
    sceneInstanceId,
    sceneReady,
    loading,
    loadRevision,
    saveError,
    origin,
    onObjectTransformCommitted,
  };
}
