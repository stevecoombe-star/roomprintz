"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAfcSceneObjectCrudSession } from "@/components/afc-3d/AfcSceneObjectCrudSession";
import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";
import type { RuntimeTransformMode } from "@/lib/afc-v2-runtime/types";
import type { SceneSelectionPresentation } from "@/lib/afc-v2-runtime/viewport-interaction";
import {
  EMPTY_BOUND_SCENE_OBJECTS,
  nextBoundScene,
  type BoundScene,
} from "@/lib/vibode-stage/bound-scene";
import { rememberRecentlyUsed } from "@/lib/vibode-stage/catalog-query";
import {
  acquireStageAddLock,
  releaseStageAddLock,
  stageAddLockKey,
} from "@/lib/vibode-stage/stage-runtime-placement";
import {
  allStageProducts,
  createPastedStageProduct,
  createPastedStageVariant,
  resolveStagePlacement,
  STAGE_SEED_CATALOG,
} from "@/lib/vibode-stage/catalog";
import { parseStageCatalogPayload } from "@/lib/vibode-stage/catalog-store";
import {
  readCatalogDrawerPreference,
  resolveCatalogDrawerOpen,
  writeCatalogDrawerPreference,
  type StageFurnitureBaseline,
} from "@/lib/vibode-stage/catalog-drawer-preference";
import {
  collapseCatalogDrawer,
  pinCatalogDrawer,
  toggleCatalogDrawer,
} from "@/lib/vibode-stage/drawer-state";
import {
  readFavoriteKeysFromStorage,
  toggleFavoriteKeys,
  writeFavoriteKeysToStorage,
} from "@/lib/vibode-stage/favorites";
import type {
  StageCatalogAuthority,
  StageCatalogMode,
  StageCatalogSnapshot,
  StageCollection,
  StageProduct,
  StageVariant,
} from "@/lib/vibode-stage/types";
import { STAGE_DEFAULT_CATALOG_MODE } from "@/lib/vibode-stage/types";

export type StageToolbarSlider = null | "rotate" | "size";

type StageEditorContextValue = Readonly<{
  active: boolean;
  catalogOpen: boolean;
  catalogSettled: boolean;
  catalogMotion: "instant" | "smooth";
  catalogPinned: boolean;
  summaryOpen: boolean;
  catalogMode: StageCatalogMode;
  catalogQuery: string;
  catalogCategoryId: string | null;
  catalogSubcategoryId: string | null;
  collectionId: string | null;
  detailProductId: string | null;
  pasteUrl: string;
  pasteError: string | null;
  pasteBusy: boolean;
  favorites: ReadonlySet<string>;
  recentlyUsedProductIds: readonly string[];
  extraProducts: readonly StageProduct[];
  extraVariants: readonly StageVariant[];
  catalog: StageCatalogSnapshot;
  catalogAuthority: StageCatalogAuthority;
  collections: readonly StageCollection[];
  objects: readonly SceneObjectDefinition[];
  canUndo: boolean;
  undo: () => void;
  selection: SceneSelectionPresentation | null;
  transformMode: RuntimeTransformMode;
  toolbarSlider: StageToolbarSlider;
  addedProductId: string | null;
  addPendingKey: string | null;
  addError: string | null;
  addErrorKey: string | null;
  toggleCatalog: () => void;
  pinCatalog: () => void;
  collapseCatalog: () => void;
  noteFurnitureBaseline: (roomId: string, baseline: StageFurnitureBaseline) => void;
  toggleSummary: () => void;
  closeSummary: () => void;
  setCatalogMode: (mode: StageCatalogMode) => void;
  setCatalogQuery: (query: string) => void;
  setCatalogCategoryId: (id: string | null) => void;
  setCatalogSubcategoryId: (id: string | null) => void;
  setCollectionId: (id: string | null) => void;
  openProductDetail: (productId: string) => void;
  closeProductDetail: () => void;
  setPasteUrl: (value: string) => void;
  pasteProductLink: () => Promise<void>;
  toggleFavorite: (productId: string, variantId?: string | null) => void;
  addProductToRoom: (productId: string, variantId?: string | null) => boolean;
  bindScene: (scene: BoundScene) => void;
  setSelection: (selection: SceneSelectionPresentation | null) => void;
  setTransformMode: (mode: RuntimeTransformMode) => void;
  setToolbarSlider: (slider: StageToolbarSlider) => void;
}>;

const EMPTY_SCENE: BoundScene = {
  objects: EMPTY_BOUND_SCENE_OBJECTS,
  canUndo: false,
  undo: () => undefined,
};

const StageEditorContext = createContext<StageEditorContextValue | null>(null);

function pastedProductId(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
  }
  return `prod-pasted-${hash.toString(16)}`;
}

export function StageEditorProvider({
  active,
  roomId,
  transformMode,
  onTransformModeChange,
  children,
}: {
  active: boolean;
  roomId: string | null;
  transformMode: RuntimeTransformMode;
  onTransformModeChange: (mode: RuntimeTransformMode) => void;
  children: ReactNode;
}) {
  const session = useAfcSceneObjectCrudSession();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSettled, setCatalogSettled] = useState(false);
  const [catalogMotion, setCatalogMotion] = useState<"instant" | "smooth">("instant");
  const [catalogPinned, setCatalogPinned] = useState(false);
  const [furnitureBaseline, setFurnitureBaseline] =
    useState<StageFurnitureBaseline>("unresolved");
  const [trackedRoomId, setTrackedRoomId] = useState(roomId);
  const catalogAppliedRoomRef = useRef<string | null>(null);
  if (roomId !== trackedRoomId) {
    setTrackedRoomId(roomId);
    setFurnitureBaseline("unresolved");
    setCatalogSettled(false);
    setCatalogMotion("instant");
    catalogAppliedRoomRef.current = null;
  }
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [catalogMode, setCatalogMode] = useState<StageCatalogMode>(STAGE_DEFAULT_CATALOG_MODE);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCategoryId, setCatalogCategoryIdState] = useState<string | null>("living-room");
  const [catalogSubcategoryId, setCatalogSubcategoryId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>("col-vibode-picks");
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [pasteUrl, setPasteUrl] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteBusy, setPasteBusy] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recentlyUsedProductIds, setRecentlyUsedProductIds] = useState<string[]>([]);
  const [extraProducts, setExtraProducts] = useState<StageProduct[]>([]);
  const [extraVariants, setExtraVariants] = useState<StageVariant[]>([]);
  const [catalog, setCatalog] = useState<StageCatalogSnapshot>(STAGE_SEED_CATALOG);
  const [boundScene, setBoundScene] = useState<BoundScene>(EMPTY_SCENE);
  const [selection, setSelection] = useState<SceneSelectionPresentation | null>(null);
  const [toolbarSlider, setToolbarSlider] = useState<StageToolbarSlider>(null);
  const [addedProductId, setAddedProductId] = useState<string | null>(null);
  const [addPendingKey, setAddPendingKey] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addErrorKey, setAddErrorKey] = useState<string | null>(null);
  const addLocksRef = useRef(new Set<string>());

  useEffect(() => {
    setFavorites(readFavoriteKeysFromStorage(
      typeof window === "undefined" ? null : window.localStorage,
    ));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/vibode/stage-catalog", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const payload: unknown = await response.json().catch(() => null);
        const parsed = parseStageCatalogPayload(payload);
        if (!cancelled && parsed) setCatalog(parsed.catalog);
      } catch {
        // Keep the explicit seed fixture. Catalog failure must not touch
        // AFC, scene persistence, History, or camera/world authority.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setSummaryOpen(false);
      setDetailProductId(null);
      setToolbarSlider(null);
    }
  }, [active]);

  const rememberCatalog = useCallback((open: boolean) => {
    setCatalogMotion("smooth");
    writeCatalogDrawerPreference(
      typeof window === "undefined" ? null : window.localStorage,
      roomId,
      open ? "expanded" : "collapsed",
    );
  }, [roomId]);

  useLayoutEffect(() => {
    if (!active || !roomId) return;
    if (catalogAppliedRoomRef.current === roomId) return;
    const preference = readCatalogDrawerPreference(
      typeof window === "undefined" ? null : window.localStorage,
      roomId,
    );
    const resolution = resolveCatalogDrawerOpen({
      preference,
      baseline: furnitureBaseline,
    });
    if (!resolution.settled) {
      setCatalogSettled(false);
      return;
    }
    catalogAppliedRoomRef.current = roomId;
    setCatalogMotion("instant");
    setCatalogOpen(resolution.open);
    setCatalogPinned(false);
    setCatalogSettled(true);
    if (resolution.establish) {
      writeCatalogDrawerPreference(
        window.localStorage,
        roomId,
        resolution.establish,
      );
    }
  }, [active, furnitureBaseline, roomId]);

  useEffect(() => {
    if (!addedProductId) return;
    const timer = window.setTimeout(() => setAddedProductId(null), 1200);
    return () => window.clearTimeout(timer);
  }, [addedProductId]);

  const toggleCatalog = useCallback(() => {
    const next = toggleCatalogDrawer({ open: catalogOpen, pinned: catalogPinned });
    setCatalogOpen(next.open);
    setCatalogPinned(next.pinned);
    setCatalogSettled(true);
    rememberCatalog(next.open);
    if (!next.open) setDetailProductId(null);
  }, [catalogOpen, catalogPinned, rememberCatalog]);

  const pinCatalog = useCallback(() => {
    const next = pinCatalogDrawer();
    setCatalogOpen(next.open);
    setCatalogPinned(next.pinned);
    setCatalogSettled(true);
    rememberCatalog(next.open);
  }, [rememberCatalog]);

  const collapseCatalog = useCallback(() => {
    const next = collapseCatalogDrawer();
    setCatalogOpen(next.open);
    setCatalogPinned(next.pinned);
    setCatalogSettled(true);
    rememberCatalog(next.open);
    setDetailProductId(null);
  }, [rememberCatalog]);

  const noteFurnitureBaseline = useCallback((
    notedRoomId: string,
    baseline: StageFurnitureBaseline,
  ) => {
    if (notedRoomId !== roomId) return;
    setFurnitureBaseline((current) => (current === baseline ? current : baseline));
  }, [roomId]);

  const toggleSummary = useCallback(() => {
    setSummaryOpen((open) => !open);
  }, []);

  const closeSummary = useCallback(() => {
    setSummaryOpen(false);
  }, []);

  const setCatalogCategoryId = useCallback((id: string | null) => {
    setCatalogCategoryIdState(id);
    setCatalogSubcategoryId(null);
  }, []);

  const openProductDetail = useCallback((productId: string) => {
    setDetailProductId(productId);
    if (!catalogOpen) {
      setCatalogOpen(true);
      setCatalogPinned(false);
      setCatalogSettled(true);
      rememberCatalog(true);
    }
  }, [catalogOpen, rememberCatalog]);

  const closeProductDetail = useCallback(() => {
    setDetailProductId(null);
  }, []);

  const toggleFavorite = useCallback((productId: string, variantId?: string | null) => {
    setFavorites((current) => {
      const next = toggleFavoriteKeys(current, productId, variantId);
      writeFavoriteKeysToStorage(
        typeof window === "undefined" ? null : window.localStorage,
        next,
      );
      return next;
    });
  }, []);

  const addProductToRoom = useCallback((productId: string, variantId?: string | null) => {
    const placement = resolveStagePlacement({
      productId,
      variantId,
      extras: extraProducts,
      extraVariants,
      catalog,
    });
    if (!placement || !session) return false;
    const key = stageAddLockKey(placement.product.productId, placement.variant.variantId);
    if (!acquireStageAddLock(addLocksRef.current, key)) return false;
    setAddPendingKey(key);
    setAddError(null);
    setAddErrorKey(null);
    void (async () => {
      try {
        const result = await session.addFurnitureWithIdentity(placement.assetId, {
          productId: placement.product.productId,
          variantId: placement.variant.variantId,
        });
        if (!result.ok) {
          setAddError(result.message);
          setAddErrorKey(key);
          return;
        }
        setRecentlyUsedProductIds((current) => rememberRecentlyUsed(current, productId));
        setAddedProductId(productId);
        onTransformModeChange("move");
        setToolbarSlider(null);
      } finally {
        releaseStageAddLock(addLocksRef.current, key);
        setAddPendingKey((current) => (current === key ? null : current));
      }
    })();
    return true;
  }, [catalog, extraProducts, extraVariants, onTransformModeChange, session]);

  const pasteProductLink = useCallback(async () => {
    const sourceUrl = pasteUrl.trim();
    if (!sourceUrl) {
      setPasteError("Paste a product link first.");
      return;
    }
    setPasteBusy(true);
    setPasteError(null);
    try {
      const response = await fetch("/api/vibode/product-url/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl }),
      });
      const payload = await response.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        title?: string | null;
        previewImageUrl?: string | null;
        domain?: string | null;
        normalizedUrl?: string;
      } | null;
      if (!payload?.ok || !payload.previewImageUrl || !payload.normalizedUrl) {
        setPasteError(payload?.error ?? "We couldn’t preview this product link.");
        return;
      }
      const productId = pastedProductId(payload.normalizedUrl);
      const product = createPastedStageProduct({
        productId,
        name: payload.title?.trim() || "Pasted product",
        brand: payload.domain || "Pasted",
        imageUrl: payload.previewImageUrl,
        productUrl: payload.normalizedUrl,
      });
      const variant = createPastedStageVariant(product);
      setExtraProducts((current) => [
        product,
        ...current.filter((item) => item.productId !== productId),
      ]);
      setExtraVariants((current) => [
        variant,
        ...current.filter((item) => item.variantId !== variant.variantId),
      ]);
      setDetailProductId(productId);
      setCatalogOpen(true);
      setCatalogSettled(true);
      rememberCatalog(true);
      setPasteUrl("");
    } catch {
      setPasteError("We couldn’t preview this product link.");
    } finally {
      setPasteBusy(false);
    }
  }, [pasteUrl, rememberCatalog]);

  const bindScene = useCallback((scene: BoundScene) => {
    setBoundScene((current) => nextBoundScene(current, scene));
  }, []);

  const setTransformMode = useCallback((mode: RuntimeTransformMode) => {
    onTransformModeChange(mode);
    if (mode === "move") setToolbarSlider(null);
    if (mode === "rotate") setToolbarSlider("rotate");
  }, [onTransformModeChange]);

  const value = useMemo<StageEditorContextValue>(() => ({
    active,
    catalogOpen,
    catalogSettled,
    catalogMotion,
    catalogPinned,
    summaryOpen,
    catalogMode,
    catalogQuery,
    catalogCategoryId,
    catalogSubcategoryId,
    collectionId,
    detailProductId,
    pasteUrl,
    pasteError,
    pasteBusy,
    favorites,
    recentlyUsedProductIds,
    extraProducts,
    extraVariants,
    catalog,
    catalogAuthority: catalog.authority,
    collections: catalog.collections,
    objects: boundScene.objects,
    canUndo: boundScene.canUndo,
    undo: boundScene.undo,
    selection,
    transformMode,
    toolbarSlider,
    addedProductId,
    addPendingKey,
    addError,
    addErrorKey,
    toggleCatalog,
    pinCatalog,
    collapseCatalog,
    noteFurnitureBaseline,
    toggleSummary,
    closeSummary,
    setCatalogMode,
    setCatalogQuery,
    setCatalogCategoryId,
    setCatalogSubcategoryId,
    setCollectionId,
    openProductDetail,
    closeProductDetail,
    setPasteUrl,
    pasteProductLink,
    toggleFavorite,
    addProductToRoom,
    bindScene,
    setSelection,
    setTransformMode,
    setToolbarSlider,
  }), [
    active,
    addedProductId,
    addPendingKey,
    addError,
    addErrorKey,
    addProductToRoom,
    bindScene,
    boundScene,
    catalog,
    catalogCategoryId,
    catalogMode,
    catalogMotion,
    catalogOpen,
    catalogPinned,
    catalogSettled,
    catalogQuery,
    catalogSubcategoryId,
    closeProductDetail,
    closeSummary,
    collapseCatalog,
    noteFurnitureBaseline,
    collectionId,
    detailProductId,
    extraProducts,
    extraVariants,
    favorites,
    openProductDetail,
    pasteBusy,
    pasteError,
    pasteProductLink,
    pasteUrl,
    pinCatalog,
    recentlyUsedProductIds,
    selection,
    setCatalogCategoryId,
    summaryOpen,
    toggleCatalog,
    toggleFavorite,
    toggleSummary,
    toolbarSlider,
    transformMode,
    setTransformMode,
  ]);

  return (
    <StageEditorContext.Provider value={value}>
      {children}
    </StageEditorContext.Provider>
  );
}

export function useStageEditor(): StageEditorContextValue {
  const value = useContext(StageEditorContext);
  if (!value) {
    throw new Error("useStageEditor must be used within StageEditorProvider");
  }
  return value;
}

export function useOptionalStageEditor(): StageEditorContextValue | null {
  return useContext(StageEditorContext);
}

export { allStageProducts };
