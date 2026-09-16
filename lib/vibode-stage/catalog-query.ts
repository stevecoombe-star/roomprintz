import type { StageCatalogMode, StageProduct, StageVariant } from "./types";
import { isProductFavorited } from "./favorites";
import { isStageCommercialActive } from "./catalog";

export type StageCatalogQueryInput = Readonly<{
  products: readonly StageProduct[];
  variants?: readonly StageVariant[];
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

function favoriteVariantIdFromKey(key: string, productId: string): string | null {
  const prefix = `${productId}::`;
  if (!key.startsWith(prefix)) return null;
  const variantId = key.slice(prefix.length);
  return variantId.length > 0 ? variantId : null;
}

export function productHasActiveFavoriteVariant(
  product: StageProduct,
  favoriteKeys: ReadonlySet<string>,
  variants: readonly StageVariant[],
): boolean {
  if (!isStageCommercialActive(product.status)) return false;
  for (const key of favoriteKeys) {
    const variantId = favoriteVariantIdFromKey(key, product.productId);
    if (!variantId) continue;
    const variant = variants.find((item) => (
      item.variantId === variantId && item.productId === product.productId
    ));
    if (variant && isStageCommercialActive(variant.status)) return true;
  }
  return false;
}

export function filterStageCatalogProducts(input: StageCatalogQueryInput): StageProduct[] {
  const needle = input.query.trim().toLowerCase();
  const recentIds = input.recentlyUsedProductIds ?? [];
  return input.products.filter((product) => {
    if (!isStageCommercialActive(product.status)) return false;
    if (input.mode === "favorites") {
      const prefixOrDefault = isProductFavorited(product.productId, input.favoriteKeys)
        || input.favoriteKeys.has(input.favoriteKeyFor(product));
      if (!prefixOrDefault) return false;
      if (
        input.variants &&
        !productHasActiveFavoriteVariant(product, input.favoriteKeys, input.variants)
      ) {
        return false;
      }
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
