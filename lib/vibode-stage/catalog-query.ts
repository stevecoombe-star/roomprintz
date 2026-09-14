import type { StageCatalogMode, StageProduct } from "./types";

export type StageCatalogQueryInput = Readonly<{
  products: readonly StageProduct[];
  mode: StageCatalogMode;
  query: string;
  categoryId: string | null;
  subcategoryId: string | null;
  collectionId: string | null;
  favoriteKeys: ReadonlySet<string>;
  favoriteKeyFor: (product: StageProduct) => string;
  recentlyUsedProductIds?: readonly string[];
}>;

export type StageCatalogNavigationState = Readonly<{
  catalogMode: StageCatalogMode;
  catalogQuery: string;
  catalogCategoryId: string | null;
  catalogSubcategoryId: string | null;
  collectionId: string | null;
}>;

export function filterStageCatalogProducts(input: StageCatalogQueryInput): StageProduct[] {
  const needle = input.query.trim().toLowerCase();
  const recentIds = input.recentlyUsedProductIds ?? [];
  return input.products.filter((product) => {
    if (input.mode === "favorites" && !input.favoriteKeys.has(input.favoriteKeyFor(product))) {
      return false;
    }
    if (
      input.mode === "collections" &&
      input.collectionId &&
      !product.collectionIds.includes(input.collectionId)
    ) {
      return false;
    }
    if (input.mode === "recently_used" && !recentIds.includes(product.productId)) {
      return false;
    }
    if (input.mode === "browse" && input.categoryId && product.categoryId !== input.categoryId) {
      return false;
    }
    if (
      input.mode === "browse" &&
      input.subcategoryId &&
      product.subcategoryId !== input.subcategoryId
    ) {
      return false;
    }
    if (!needle) return true;
    const haystack = `${product.brand} ${product.name} ${product.retailer}`.toLowerCase();
    return haystack.includes(needle);
  });
}

export function orderStageProductsByRecentIds(
  products: readonly StageProduct[],
  recentlyUsedProductIds: readonly string[],
): StageProduct[] {
  const byId = new Map(products.map((product) => [product.productId, product]));
  return recentlyUsedProductIds.flatMap((productId) => {
    const product = byId.get(productId);
    return product ? [product] : [];
  });
}

export function visibleStageCatalogProducts(input: StageCatalogQueryInput): StageProduct[] {
  const filtered = filterStageCatalogProducts(input);
  if (input.mode !== "recently_used") return filtered;
  return orderStageProductsByRecentIds(filtered, input.recentlyUsedProductIds ?? []);
}

export function navigationStateAfterCatalogAdd<T extends StageCatalogNavigationState>(
  current: T,
): T {
  return current;
}

export function rememberRecentlyUsed(
  current: readonly string[],
  productId: string,
  limit = 8,
): string[] {
  const next = [productId, ...current.filter((id) => id !== productId)];
  return next.slice(0, limit);
}
