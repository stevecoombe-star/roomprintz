"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { defaultFurnitureAssetId } from "@/lib/afc-v2-runtime/furniture-assets";
import { PI4C_MAX_SCENE_OBJECTS } from "@/lib/afc-v2-runtime/persisted-scene";
import {
  PI5A_MISSING_OBJECT_MESSAGE,
  PI5A_NOT_READY_MESSAGE,
  PI5A_SCENE_AT_CAPACITY_MESSAGE,
  type LiveSceneCrudSnapshot,
  type ProductionSceneCrudHost,
} from "@/lib/afc-v2-runtime/scene-crud";

type SceneObjectCrudSession = Readonly<{
  selectedObjectId: string | null;
  objectCount: number;
  liveReady: boolean;
  atObjectLimit: boolean;
  actionError: string | null;
  setSelectedObjectId: (objectId: string | null) => void;
  setHost: (host: ProductionSceneCrudHost | null) => void;
  setSnapshot: (snapshot: LiveSceneCrudSnapshot) => void;
  addFurniture: () => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
}>;

const SceneObjectCrudContext = createContext<SceneObjectCrudSession | null>(null);

export function AfcSceneObjectCrudSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const hostRef = useRef<ProductionSceneCrudHost | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [objectCount, setObjectCount] = useState(0);
  const [liveReady, setLiveReady] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const setHost = useCallback((host: ProductionSceneCrudHost | null) => {
    hostRef.current = host;
    setLiveReady(host?.canMutate() ?? false);
    setObjectCount(host?.objectCount() ?? 0);
    if (!host) {
      setSelectedObjectId(null);
    }
  }, []);

  const setSnapshot = useCallback((snapshot: LiveSceneCrudSnapshot) => {
    setObjectCount(snapshot.objectCount);
    setSelectedObjectId(snapshot.selectedObjectId);
    setLiveReady(snapshot.liveReady);
  }, []);

  const addFurniture = useCallback(() => {
    const host = hostRef.current;
    if (!host?.canMutate()) {
      setActionError(PI5A_NOT_READY_MESSAGE);
      return;
    }
    if (host.objectCount() >= PI4C_MAX_SCENE_OBJECTS) {
      setActionError(PI5A_SCENE_AT_CAPACITY_MESSAGE);
      return;
    }
    const result = host.addSceneObject(defaultFurnitureAssetId());
    setObjectCount(host.objectCount());
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    setActionError(null);
    setSelectedObjectId(result.selectedObjectId);
  }, []);

  const duplicateSelected = useCallback(() => {
    const host = hostRef.current;
    if (!host?.canMutate()) {
      setActionError(PI5A_NOT_READY_MESSAGE);
      return;
    }
    if (!selectedObjectId) {
      setActionError(PI5A_MISSING_OBJECT_MESSAGE);
      return;
    }
    if (host.objectCount() >= PI4C_MAX_SCENE_OBJECTS) {
      setActionError(PI5A_SCENE_AT_CAPACITY_MESSAGE);
      return;
    }
    const result = host.duplicateSceneObject(selectedObjectId);
    setObjectCount(host.objectCount());
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    setActionError(null);
    setSelectedObjectId(result.selectedObjectId);
  }, [selectedObjectId]);

  const deleteSelected = useCallback(() => {
    const host = hostRef.current;
    if (!host?.canMutate()) {
      setActionError(PI5A_NOT_READY_MESSAGE);
      return;
    }
    if (!selectedObjectId) {
      setActionError(PI5A_MISSING_OBJECT_MESSAGE);
      return;
    }
    const result = host.deleteSceneObject(selectedObjectId);
    setObjectCount(host.objectCount());
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    setActionError(null);
    setSelectedObjectId(result.selectedObjectId);
  }, [selectedObjectId]);

  const value = useMemo<SceneObjectCrudSession>(() => ({
    selectedObjectId,
    objectCount,
    liveReady,
    atObjectLimit: objectCount >= PI4C_MAX_SCENE_OBJECTS,
    actionError,
    setSelectedObjectId,
    setHost,
    setSnapshot,
    addFurniture,
    duplicateSelected,
    deleteSelected,
  }), [
    actionError,
    addFurniture,
    deleteSelected,
    duplicateSelected,
    liveReady,
    objectCount,
    selectedObjectId,
    setHost,
    setSnapshot,
  ]);

  return (
    <SceneObjectCrudContext.Provider value={value}>
      {children}
    </SceneObjectCrudContext.Provider>
  );
}

export function useAfcSceneObjectCrudSession(): SceneObjectCrudSession | null {
  return useContext(SceneObjectCrudContext);
}
