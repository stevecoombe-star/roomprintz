"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

import {
  furnitureAssetDefinitionFromRuntime,
  interpretRuntimeAssetResolveResponse,
  overlayFromRuntimeDefinitions,
  replaceRuntimeAssetDefinitionList,
  RUNTIME_ASSET_RESOLVE_PATH,
  upsertRuntimeOverlayDefinition,
  type RuntimeAssetIssue,
  type RuntimeFurnitureAssetDefinition,
} from "./runtime-furniture-assets";
import {
  fetchStageRuntimePlacement,
  isCurrentStageSceneGuard,
  parseStageRuntimePlacementRequest,
  type EnsureStageCommercialPlacement,
  type StageRuntimePlacementClientResult,
} from "@/lib/vibode-stage/stage-runtime-placement";
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
  resolveProductionFurnitureSnapshot,
  versionScenePutBody,
  versionSceneUrl,
} from "./scene-persistence-client";
import type {
  FurnitureAssetDefinition,
  SceneObjectDefinition,
  SerializedRuntimeScene,
} from "./types";

export const PI4C_SCENE_SAVE_ERROR_MESSAGE =
  "Couldn't save this 3D scene. Your layout is still here.";

export const EMPTY_PERSISTED_SCENE_OBJECTS: readonly SceneObjectDefinition[] =
  Object.freeze([]);

export type Persisted3dSceneState = Readonly<{
  objects: readonly SceneObjectDefinition[];
  sceneInstanceId: string;
  sceneReady: boolean;
  loading: boolean;
  loadRevision: number;
  saveError: string | null;
  origin: "default" | "persisted";
  assetDefinitions: readonly RuntimeFurnitureAssetDefinition[];
  assetIssues: readonly RuntimeAssetIssue[];
  runtimeAssetOverlay: ReadonlyMap<string, FurnitureAssetDefinition>;
  refreshRuntimeAsset: (
    assetId: string,
  ) => Promise<FurnitureAssetDefinition | null>;
  upsertRuntimeAssetDefinition: (
    definition: RuntimeFurnitureAssetDefinition,
  ) => boolean;
  ensureCommercialPlacement: EnsureStageCommercialPlacement;
  canUndo: boolean;
  undo: () => void;
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

const SCENE_UNDO_LIMIT = 40;

function sceneSignature(objects: readonly SceneObjectDefinition[]): string {
  return JSON.stringify(persistenceSafeSceneObjects(objects));
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

  const [objects, setObjects] = useState<readonly SceneObjectDefinition[]>(
    EMPTY_PERSISTED_SCENE_OBJECTS,
  );
  const [origin, setOrigin] = useState<"default" | "persisted">("default");
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadedIdentity, setLoadedIdentity] = useState<PersistedSceneIdentity | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [assetDefinitions, setAssetDefinitions] = useState<
    readonly RuntimeFurnitureAssetDefinition[]
  >([]);
  const [assetIssues, setAssetIssues] = useState<readonly RuntimeAssetIssue[]>([]);
  const overlayRef = useRef<Map<string, FurnitureAssetDefinition>>(new Map());

  const latestLoadIdRef = useRef(0);
  const loadRevisionRef = useRef(0);
  const loadedRef = useRef<LoadedVersionScene | null>(null);
  const identityRef = useRef<PersistedSceneIdentity | null>(identity);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const saveGateRef = useRef<Promise<boolean> | null>(null);
  const undoStackRef = useRef<SceneObjectDefinition[][]>([]);
  const applyingUndoRef = useRef(false);
  identityRef.current = identity;

  const clearUndoStack = useCallback(() => {
    undoStackRef.current = [];
    setCanUndo(false);
  }, []);

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
    nextDefinitions: readonly RuntimeFurnitureAssetDefinition[] = [],
    nextIssues: readonly RuntimeAssetIssue[] = [],
  ) => {
    loadRevisionRef.current += 1;
    loadedRef.current = {
      identity: requestIdentity,
      objects: nextObjects,
      origin: nextOrigin,
      dirty: false,
    };
    overlayRef.current = new Map(overlayFromRuntimeDefinitions(nextDefinitions));
    setLoadRevision(loadRevisionRef.current);
    setObjects(nextObjects);
    setOrigin(nextOrigin);
    setLoadedIdentity(requestIdentity);
    setAssetDefinitions(nextDefinitions);
    setAssetIssues(nextIssues);
    setLoading(false);
    clearUndoStack();
  }, [clearUndoStack]);

  useEffect(() => {
    if (!identity) {
      latestLoadIdRef.current += 1;
      overlayRef.current = new Map();
      setAssetDefinitions([]);
      setAssetIssues([]);
      clearUndoStack();
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
        const resolution = resolveProductionFurnitureSnapshot({
          interpreted,
          requestIdentity,
        });
        if (resolution.status !== "authoritative") {
          setLoading(false);
          return;
        }
        const snapshot = resolution.snapshot;
        if (interpreted.status === "ready" && snapshot.origin !== "persisted") {
          const parsed = validatePersistedVersionScene(interpreted.scene);
          warnSceneRestore(parsed.ok ? "scene identity mismatch" : parsed.reason);
        }
        const nextObjects = snapshot.objects;
        const nextOrigin = snapshot.origin;
        const nextDefinitions = snapshot.assetDefinitions;
        const nextIssues = snapshot.assetIssues;
        if (nextIssues.length > 0 && typeof console !== "undefined") {
          for (const issue of nextIssues) {
            console.warn("[afc-3d-scene] runtime asset issue", {
              assetId: issue.assetId,
              issueCode: issue.code,
            });
          }
        }
        commitResolvedSnapshot(
          requestIdentity,
          nextObjects,
          nextOrigin,
          nextDefinitions,
          nextIssues,
        );
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
        setLoading(false);
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
    clearUndoStack,
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
    if (
      !applyingUndoRef.current &&
      sceneSignature(loaded.objects) !== sceneSignature(next.objects)
    ) {
      undoStackRef.current = [
        ...undoStackRef.current,
        persistenceSafeSceneObjects(loaded.objects),
      ].slice(-SCENE_UNDO_LIMIT);
      setCanUndo(true);
    }
    applyingUndoRef.current = false;
    loadedRef.current = {
      identity: current,
      objects: next.objects,
      origin: loaded.origin,
      dirty: true,
    };
    setObjects(next.objects);
    void persistIdentity(current, scene);
  }, [persistIdentity]);

  const undo = useCallback(() => {
    const current = identityRef.current;
    const loaded = loadedRef.current;
    const previous = undoStackRef.current.pop();
    if (!current || !loaded || !previous) {
      setCanUndo(undoStackRef.current.length > 0);
      return;
    }
    applyingUndoRef.current = true;
    loadRevisionRef.current += 1;
    loadedRef.current = {
      identity: current,
      objects: previous,
      origin: loaded.origin,
      dirty: true,
    };
    setLoadRevision(loadRevisionRef.current);
    setObjects(previous);
    setCanUndo(undoStackRef.current.length > 0);
    void persistIdentity(current, { objects: previous });
  }, [persistIdentity]);

  const upsertRuntimeAssetDefinition = useCallback((
    definition: RuntimeFurnitureAssetDefinition,
  ): boolean => {
    const current = identityRef.current;
    const loaded = loadedRef.current;
    if (!current || !loaded || !sceneIdentitiesEqual(loaded.identity, current)) {
      return false;
    }
    if (!upsertRuntimeOverlayDefinition(overlayRef.current, definition)) {
      return false;
    }
    setAssetDefinitions((currentDefinitions) =>
      replaceRuntimeAssetDefinitionList(currentDefinitions, definition),
    );
    return true;
  }, []);

  const ensureCommercialPlacement = useCallback(async (
    input: Readonly<{
      productId: string;
      variantId: string;
      expectedAssetId: string;
    }>,
  ): Promise<StageRuntimePlacementClientResult> => {
    const capturedIdentity = identityRef.current;
    const capturedRevision = loadRevisionRef.current;
    if (!capturedIdentity) {
      return {
        ok: false,
        errorCode: "VERSION_NOT_FOUND",
        error: "Furniture isn't ready yet.",
        message: "Furniture isn't ready yet.",
      };
    }
    const parsed = parseStageRuntimePlacementRequest({
      roomId: capturedIdentity.roomId,
      versionId: capturedIdentity.versionId,
      afcGenerationId: capturedIdentity.afcGenerationId,
      productId: input.productId,
      variantId: input.variantId,
      expectedAssetId: input.expectedAssetId,
    });
    if (!parsed.ok) {
      return {
        ok: false,
        errorCode: "INVALID_REQUEST",
        error: "This furniture model is temporarily unavailable.",
        message: "This furniture model is temporarily unavailable.",
      };
    }
    const stillCurrent = () => isCurrentStageSceneGuard({
      capturedIdentity,
      currentIdentity: identityRef.current,
      capturedRevision,
      currentRevision: loadRevisionRef.current,
    });
    try {
      const token = await getSupabaseBrowserAccessToken();
      if (!token) {
        return {
          ok: false,
          errorCode: "UNAUTHORIZED",
          error: "Unauthorized.",
          message: "Unauthorized.",
        };
      }
      if (!stillCurrent()) {
        return {
          ok: false,
          errorCode: "VERSION_NOT_FOUND",
          error: "Furniture isn't ready yet.",
          message: "Furniture isn't ready yet.",
          cancelled: true,
        };
      }
      const placed = await fetchStageRuntimePlacement({
        request: parsed.request,
        token,
      });
      if (!stillCurrent()) {
        return {
          ok: false,
          errorCode: "VERSION_NOT_FOUND",
          error: "Furniture isn't ready yet.",
          message: "Furniture isn't ready yet.",
          cancelled: true,
        };
      }
      if (!placed.ok) return placed;
      if (placed.placementKind === "dynamic" && placed.runtimeAsset) {
        if (!upsertRuntimeAssetDefinition(placed.runtimeAsset)) {
          return {
            ok: false,
            errorCode: "VERSION_NOT_FOUND",
            error: "Furniture isn't ready yet.",
            message: "Furniture isn't ready yet.",
            cancelled: true,
          };
        }
      }
      return placed;
    } catch {
      return {
        ok: false,
        errorCode: "RUNTIME_DEFINITION_UNAVAILABLE",
        error: "This furniture model is temporarily unavailable.",
        message: "This furniture model is temporarily unavailable.",
      };
    }
  }, [upsertRuntimeAssetDefinition]);

  const refreshRuntimeAsset = useCallback(async (
    assetId: string,
  ): Promise<FurnitureAssetDefinition | null> => {
    const current = identityRef.current;
    if (!current || !assetId.trim()) return null;
    try {
      const token = await getSupabaseBrowserAccessToken();
      if (!token) return null;
      const response = await fetch(RUNTIME_ASSET_RESOLVE_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          roomId: current.roomId,
          versionId: current.versionId,
          afcGenerationId: current.afcGenerationId,
          assetIds: [assetId],
        }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) return null;
      const resolved = interpretRuntimeAssetResolveResponse(payload);
      const dto = resolved.assetDefinitions.find((item) => item.assetId === assetId);
      if (!dto) return null;
      const definition = furnitureAssetDefinitionFromRuntime(dto);
      overlayRef.current.set(assetId, definition);
      setAssetDefinitions((currentDefinitions) => {
        const next = currentDefinitions.filter((item) => item.assetId !== assetId);
        next.push(dto);
        return next;
      });
      return definition;
    } catch {
      return null;
    }
  }, []);

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
    objects: sceneReady ? objects : EMPTY_PERSISTED_SCENE_OBJECTS,
    sceneInstanceId,
    sceneReady,
    loading,
    loadRevision,
    saveError,
    origin,
    assetDefinitions: sceneReady ? assetDefinitions : [],
    assetIssues: sceneReady ? assetIssues : [],
    runtimeAssetOverlay: overlayRef.current,
    refreshRuntimeAsset,
    upsertRuntimeAssetDefinition,
    ensureCommercialPlacement,
    canUndo,
    undo,
    onObjectTransformCommitted,
  };
}
