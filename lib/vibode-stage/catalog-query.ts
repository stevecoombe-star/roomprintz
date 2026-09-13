import type { StageCatalogMode, StageProduct } from "./types";

export function filterStageCatalogProducts(input: Readonly<{
  products: readonly StageProduct[];
  mode: StageCatalogMode;
  query: string;
  categoryId: string | null;
  subcategoryId: string | null;
  collectionId: string | null;
  favoriteKeys: ReadonlySet<string>;
  favoriteKeyFor: (product: StageProduct) => string;
}>): StageProduct[] {
  const needle = input.query.trim().toLowerCase();
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

export function rememberRecentlyUsed(
  current: readonly string[],
  productId: string,
  limit = 8,
): string[] {
  const next = [productId, ...current.filter((id) => id !== productId)];
  return next.slice(0, limit);
}
