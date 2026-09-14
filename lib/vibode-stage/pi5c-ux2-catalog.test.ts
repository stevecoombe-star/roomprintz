import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  favoriteKey,
  STAGE_SEED_PRODUCTS,
  STAGE_STUDIO_CHAIR_PRODUCT_ID,
  STAGE_STUDIO_SETTEE_PRODUCT_ID,
  STAGE_STUDIO_SOFA_PRODUCT_ID,
} from "./catalog";
import {
  navigationStateAfterCatalogAdd,
  rememberRecentlyUsed,
  visibleStageCatalogProducts,
} from "./catalog-query";
import {
  STAGE_FAVORITES_STORAGE_KEY,
  toggleFavoriteKeys,
  writeFavoriteKeysToStorage,
  readFavoriteKeysFromStorage,
} from "./favorites";
import {
  STAGE_CATALOG_MODES,
  STAGE_DEFAULT_CATALOG_MODE,
  type StageCatalogMode,
} from "./types";

const ROOT = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function query(input: Partial<Parameters<typeof visibleStageCatalogProducts>[0]> = {}) {
  return visibleStageCatalogProducts({
    products: STAGE_SEED_PRODUCTS,
    mode: "browse",
    query: "",
    categoryId: "living-room",
    subcategoryId: null,
    collectionId: "col-vibode-picks",
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
    recentlyUsedProductIds: [],
    ...input,
  });
}

function navigation(mode: StageCatalogMode = STAGE_DEFAULT_CATALOG_MODE) {
  return {
    catalogMode: mode,
    catalogQuery: "sofa",
    catalogCategoryId: "living-room",
    catalogSubcategoryId: "sofas",
    collectionId: "col-small-spaces",
  };
}

test("PI-5C UX2 Catalog exposes four top-level modes and defaults to Browse", () => {
  assert.deepEqual(STAGE_CATALOG_MODES.map((mode) => mode.id), [
    "browse",
    "collections",
    "recently_used",
    "favorites",
  ]);
  assert.deepEqual(STAGE_CATALOG_MODES.map((mode) => mode.label), [
    "Browse",
    "Collections",
    "Recent",
    "Favorites",
  ]);
  assert.equal(STAGE_DEFAULT_CATALOG_MODE, "browse");
  assert.equal(STAGE_CATALOG_MODES.some((mode) => mode.id === "favorites"), true);

  const drawer = source("components/stage/StageCatalogDrawer.tsx");
  const context = source("components/stage/StageEditorContext.tsx");
  assert.match(drawer, /STAGE_CATALOG_MODES\.map/);
  assert.match(context, /STAGE_DEFAULT_CATALOG_MODE/);
  assert.match(drawer, /data-stage-catalog-mode=\{stage\.catalogMode\}/);
});

test("PI-5C UX2 Browse no longer renders Recently Used above results", () => {
  const drawer = source("components/stage/StageCatalogDrawer.tsx");
  assert.doesNotMatch(drawer, /Recently Used/);
  assert.doesNotMatch(drawer, /key=\{`recent-/);
  assert.doesNotMatch(drawer, /catalogMode === "browse" && recent/);
  const visible = query({
    mode: "browse",
    recentlyUsedProductIds: [STAGE_STUDIO_CHAIR_PRODUCT_ID],
  });
  assert.deepEqual(visible.map((product) => product.productId), [
    STAGE_STUDIO_SOFA_PRODUCT_ID,
    STAGE_STUDIO_SETTEE_PRODUCT_ID,
    STAGE_STUDIO_CHAIR_PRODUCT_ID,
  ]);
});

test("PI-5C UX2 Recently Used mode renders existing recently-used products in recency order", () => {
  const visible = query({
    mode: "recently_used",
    categoryId: "bedroom",
    subcategoryId: "chairs",
    recentlyUsedProductIds: [
      STAGE_STUDIO_CHAIR_PRODUCT_ID,
      STAGE_STUDIO_SOFA_PRODUCT_ID,
    ],
  });
  assert.deepEqual(visible.map((product) => product.productId), [
    STAGE_STUDIO_CHAIR_PRODUCT_ID,
    STAGE_STUDIO_SOFA_PRODUCT_ID,
  ]);
  const empty = query({ mode: "recently_used", recentlyUsedProductIds: [] });
  assert.equal(visible.length > 0, true);
  assert.equal(empty.length, 0);
});

test("PI-5C UX2 Collections and Favorites behavior remains unchanged", () => {
  const picks = query({
    mode: "collections",
    collectionId: "col-vibode-picks",
  });
  assert.equal(picks.length, 3);
  const small = query({
    mode: "collections",
    collectionId: "col-small-spaces",
  });
  assert.deepEqual(small.map((product) => product.productId), [
    STAGE_STUDIO_SETTEE_PRODUCT_ID,
    STAGE_STUDIO_CHAIR_PRODUCT_ID,
  ]);

  const favoriteKeys = new Set([
    favoriteKey(STAGE_STUDIO_SOFA_PRODUCT_ID, "var-vibode-studio-sofa-default"),
  ]);
  const favorites = query({ mode: "favorites", favoriteKeys });
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0]?.productId, STAGE_STUDIO_SOFA_PRODUCT_ID);

  const afterModes: StageCatalogMode[] = [
    "browse",
    "recently_used",
    "collections",
    "favorites",
  ];
  for (const mode of afterModes) {
    const still = query({ mode: "favorites", favoriteKeys });
    assert.equal(still.length, 1);
    assert.equal(mode === "favorites" || still.length === 1, true);
  }
});

test("PI-5C UX2 Favorites storage key and toggle behavior are unchanged", () => {
  assert.equal(STAGE_FAVORITES_STORAGE_KEY, "vibode:stage-favorites/v1");
  const next = toggleFavoriteKeys(new Set(), STAGE_STUDIO_SOFA_PRODUCT_ID, "var-1");
  assert.equal(next.has(favoriteKey(STAGE_STUDIO_SOFA_PRODUCT_ID, "var-1")), true);
  const cleared = toggleFavoriteKeys(next, STAGE_STUDIO_SOFA_PRODUCT_ID, "var-1");
  assert.equal(cleared.size, 0);
  const storage = new Map<string, string>();
  writeFavoriteKeysToStorage(
    { setItem: (key, value) => storage.set(key, value) },
    next,
  );
  assert.equal(storage.has(STAGE_FAVORITES_STORAGE_KEY), true);
  const restored = readFavoriteKeysFromStorage({
    getItem: (key) => storage.get(key) ?? null,
  });
  assert.equal(restored.has(favoriteKey(STAGE_STUDIO_SOFA_PRODUCT_ID, "var-1")), true);

  const drawer = source("components/stage/StageCatalogDrawer.tsx");
  const card = source("components/stage/StageProductCard.tsx");
  assert.match(drawer, /toggleFavorite/);
  assert.match(card, /onToggleFavorite/);
  assert.match(card, /favorited \? "♥" : "♡"/);
});

test("PI-5C UX2 adding a product does not change Catalog navigation state", () => {
  for (const mode of STAGE_CATALOG_MODES.map((item) => item.id)) {
    const current = navigation(mode);
    const after = navigationStateAfterCatalogAdd(current);
    assert.deepEqual(after, current);
    const recents = rememberRecentlyUsed(["prod-a"], STAGE_STUDIO_SOFA_PRODUCT_ID);
    assert.deepEqual(navigationStateAfterCatalogAdd({
      ...current,
    }), current);
    assert.equal(recents[0], STAGE_STUDIO_SOFA_PRODUCT_ID);
    assert.equal(after.catalogMode, mode);
    assert.equal(after.catalogQuery, "sofa");
    assert.equal(after.catalogCategoryId, "living-room");
    assert.equal(after.catalogSubcategoryId, "sofas");
    assert.equal(after.collectionId, "col-small-spaces");
  }

  const context = source("components/stage/StageEditorContext.tsx");
  const addStart = context.indexOf("const addProductToRoom = useCallback");
  const addEnd = context.indexOf("const pasteProductLink");
  const addBody = context.slice(addStart, addEnd);
  assert.match(addBody, /rememberRecentlyUsed/);
  assert.match(addBody, /setAddedProductId/);
  assert.doesNotMatch(addBody, /setCatalogMode/);
  assert.doesNotMatch(addBody, /setCatalogQuery/);
  assert.doesNotMatch(addBody, /setCatalogCategoryId/);
  assert.doesNotMatch(addBody, /setCatalogSubcategoryId/);
  assert.doesNotMatch(addBody, /setCollectionId/);
  assert.doesNotMatch(addBody, /setFavorites/);
});

test("PI-5C UX2 Add does not remount the Catalog scroller or switch to Recently Used", () => {
  const drawer = source("components/stage/StageCatalogDrawer.tsx");
  const card = source("components/stage/StageProductCard.tsx");
  assert.match(drawer, /addProductPreservingScroll/);
  assert.match(drawer, /pendingScrollTopRef/);
  assert.match(drawer, /data-stage-catalog-scroller="true"/);
  assert.match(drawer, /\[overflow-anchor:none\]/);
  assert.doesNotMatch(drawer, /scrollIntoView/);
  assert.doesNotMatch(drawer, /setCatalogMode\("recently_used"\)/);
  assert.doesNotMatch(drawer, /key=\{stage\.addedProductId/);
  assert.doesNotMatch(drawer, /key=\{stage\.catalogMode/);
  assert.match(drawer, /key=\{product\.productId\}/);
  assert.match(card, /onMouseDown/);
  assert.match(card, /event\.preventDefault\(\)/);
});

test("PI-5C UX2 favoriting does not replace four-mode navigation", () => {
  const favoriteKeys = new Set([
    favoriteKey(STAGE_STUDIO_CHAIR_PRODUCT_ID, "var-vibode-studio-chair-default"),
  ]);
  const sequence: StageCatalogMode[] = [
    "browse",
    "recently_used",
    "collections",
    "favorites",
    "browse",
  ];
  for (const mode of sequence) {
    const ids = query({
      mode,
      favoriteKeys,
      recentlyUsedProductIds: [STAGE_STUDIO_CHAIR_PRODUCT_ID],
      collectionId: "col-small-spaces",
    }).map((product) => product.productId);
    if (mode === "favorites" || mode === "recently_used") {
      assert.deepEqual(ids, [STAGE_STUDIO_CHAIR_PRODUCT_ID]);
    } else {
      assert.equal(ids.includes(STAGE_STUDIO_CHAIR_PRODUCT_ID), true);
    }
    assert.equal(favoriteKeys.has(
      favoriteKey(STAGE_STUDIO_CHAIR_PRODUCT_ID, "var-vibode-studio-chair-default"),
    ), true);
  }
});
