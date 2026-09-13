"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  createPastedStageProduct,
  createPastedStageVariant,
  favoriteKey,
  resolveStagePlacement,
  STAGE_SEED_PRODUCTS,
} from "@/lib/vibode-stage/catalog";
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
  StageCatalogMode,
  StageProduct,
  StageVariant,
} from "@/lib/vibode-stage/types";

export type StageToolbarSlider = null | "rotate" | "size";

type StageEditorContextValue = Readonly<{
  active: boolean;
  catalogOpen: boolean;
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
  objects: readonly SceneObjectDefinition[];
  canUndo: boolean;
  undo: () => void;
  selection: SceneSelectionPresentation | null;
  transformMode: RuntimeTransformMode;
  toolbarSlider: StageToolbarSlider;
  addedProductId: string | null;
  toggleCatalog: () => void;
  pinCatalog: () => void;
  collapseCatalog: () => void;
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
  transformMode,
  onTransformModeChange,
  children,
}: {
  active: boolean;
  transformMode: RuntimeTransformMode;
  onTransformModeChange: (mode: RuntimeTransformMode) => void;
  children: ReactNode;
}) {
  const session = useAfcSceneObjectCrudSession();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogPinned, setCatalogPinned] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [catalogMode, setCatalogMode] = useState<StageCatalogMode>("browse");
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
  const [boundScene, setBoundScene] = useState<BoundScene>(EMPTY_SCENE);
  const [selection, setSelection] = useState<SceneSelectionPresentation | null>(null);
  const [toolbarSlider, setToolbarSlider] = useState<StageToolbarSlider>(null);
  const [addedProductId, setAddedProductId] = useState<string | null>(null);

  useEffect(() => {
    setFavorites(readFavoriteKeysFromStorage(
      typeof window === "undefined" ? null : window.localStorage,
    ));
  }, []);

  useEffect(() => {
    if (!active) {
      setCatalogOpen(false);
      setCatalogPinned(false);
      setSummaryOpen(false);
      setDetailProductId(null);
      setToolbarSlider(null);
    }
  }, [active]);

  useEffect(() => {
    if (!addedProductId) return;
    const timer = window.setTimeout(() => setAddedProductId(null), 1200);
    return () => window.clearTimeout(timer);
  }, [addedProductId]);

  const toggleCatalog = useCallback(() => {
    const next = toggleCatalogDrawer({ open: catalogOpen, pinned: catalogPinned });
    setCatalogOpen(next.open);
    setCatalogPinned(next.pinned);
    if (!next.open) setDetailProductId(null);
  }, [catalogOpen, catalogPinned]);

  const pinCatalog = useCallback(() => {
    const next = pinCatalogDrawer();
    setCatalogOpen(next.open);
    setCatalogPinned(next.pinned);
  }, []);

  const collapseCatalog = useCallback(() => {
    const next = collapseCatalogDrawer();
    setCatalogOpen(next.open);
    setCatalogPinned(next.pinned);
    setDetailProductId(null);
  }, []);

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
    }
  }, [catalogOpen]);

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
    });
    if (!placement || !session) return false;
    session.addFurnitureWithIdentity(placement.assetId, {
      productId: placement.product.productId,
      variantId: placement.variant.variantId,
    });
    setRecentlyUsedProductIds((current) => rememberRecentlyUsed(current, productId));
    setAddedProductId(productId);
    onTransformModeChange("move");
    setToolbarSlider(null);
    return true;
  }, [extraProducts, extraVariants, onTransformModeChange, session]);

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
      setPasteUrl("");
    } catch {
      setPasteError("We couldn’t preview this product link.");
    } finally {
      setPasteBusy(false);
    }
  }, [pasteUrl]);

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
    objects: boundScene.objects,
    canUndo: boundScene.canUndo,
    undo: boundScene.undo,
    selection,
    transformMode,
    toolbarSlider,
    addedProductId,
    toggleCatalog,
    pinCatalog,
    collapseCatalog,
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
    addProductToRoom,
    bindScene,
    boundScene,
    catalogCategoryId,
    catalogMode,
    catalogOpen,
    catalogPinned,
    catalogQuery,
    catalogSubcategoryId,
    closeProductDetail,
    closeSummary,
    collapseCatalog,
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

export function allStageProducts(
  extras: readonly StageProduct[] = [],
): StageProduct[] {
  const byId = new Map<string, StageProduct>();
  for (const product of STAGE_SEED_PRODUCTS) byId.set(product.productId, product);
  for (const product of extras) byId.set(product.productId, product);
  return [...byId.values()];
}
