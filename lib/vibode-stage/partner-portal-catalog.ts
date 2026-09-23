/**
 * PI-5G1 Partner-scoped durable catalog read model.
 *
 * Durable STAGE rows only. No curated seed fallback. Inactive Product /
 * Variant identities remain visible. Commercial Partner status does not
 * hide Portal catalog rows.
 */

import { createStageCatalogSnapshot } from "./catalog";
import type {
  StageAsset,
  StageCatalogSnapshot,
  StageCollection,
  StagePartner,
  StageProduct,
  StageVariant,
} from "./types";

export type PartnerPortalCatalogErrorCode =
  | "durable_load_failed"
  | "seed_fallback_forbidden"
  | "partner_missing";

export type PartnerPortalCatalogLoadResult =
  | Readonly<{ ok: true; catalog: StageCatalogSnapshot }>
  | Readonly<{ ok: false; code: PartnerPortalCatalogErrorCode }>;

function freezeStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

export function scopeDurableCatalogToPartner(
  catalog: StageCatalogSnapshot,
  partnerId: string,
): StageCatalogSnapshot | null {
  if (catalog.authority !== "durable") return null;
  if (catalog.fallbackReason) return null;
  const partner = catalog.partners.find((item) => item.partnerId === partnerId) ?? null;
  if (!partner) return null;

  const products: StageProduct[] = catalog.products
    .filter((product) => (
      product.partnerId === partnerId && product.source === "partner_catalog"
    ))
    .map((product) => Object.freeze({ ...product }));

  const productIds = new Set(products.map((product) => product.productId));
  const variants: StageVariant[] = catalog.variants
    .filter((variant) => productIds.has(variant.productId))
    .map((variant) => Object.freeze({ ...variant }));

  const collections: StageCollection[] = catalog.collections
    .filter((collection) => (
      collection.partnerId === partnerId && collection.owner === "partner"
    ))
    .map((collection) => Object.freeze({
      ...collection,
      productIds: freezeStrings(
        collection.productIds.filter((productId) => productIds.has(productId)),
      ),
    }));

  const collectionIds = new Set(collections.map((collection) => collection.collectionId));
  const productsWithMembership = products.map((product) => Object.freeze({
    ...product,
    collectionIds: freezeStrings(
      product.collectionIds.filter((collectionId) => collectionIds.has(collectionId)),
    ),
  }));

  const assetIds = new Set(
    variants.flatMap((variant) => (variant.assetId ? [variant.assetId] : [])),
  );
  const assets: StageAsset[] = catalog.assets
    .filter((asset) => assetIds.has(asset.assetId))
    .map((asset) => Object.freeze({ ...asset }));

  return createStageCatalogSnapshot({
    authority: "durable",
    fallbackReason: null,
    partners: [Object.freeze({ ...partner })],
    products: productsWithMembership,
    variants,
    collections,
    assets,
  });
}

export function partnerCatalogFromDurableSnapshot(input: Readonly<{
  catalog: StageCatalogSnapshot | null;
  partnerId: string;
  authority?: StageCatalogSnapshot["authority"];
  fallbackReason?: string | null;
}>): PartnerPortalCatalogLoadResult {
  if (!input.catalog) {
    return { ok: false, code: "durable_load_failed" };
  }
  const authority = input.authority ?? input.catalog.authority;
  const fallbackReason = input.fallbackReason ?? input.catalog.fallbackReason;
  if (authority !== "durable" || fallbackReason) {
    return { ok: false, code: "seed_fallback_forbidden" };
  }
  const scoped = scopeDurableCatalogToPartner(input.catalog, input.partnerId);
  if (!scoped) return { ok: false, code: "partner_missing" };
  return { ok: true, catalog: scoped };
}

export function serializePartnerPortalCatalog(catalog: StageCatalogSnapshot): Readonly<{
  ok: true;
  partner: StagePartner;
  products: readonly StageProduct[];
  variants: readonly StageVariant[];
  collections: readonly StageCollection[];
}> {
  const partner = catalog.partners[0];
  if (!partner) {
    throw new Error("Partner-scoped catalog is missing the Partner row.");
  }
  return {
    ok: true,
    partner,
    products: catalog.products,
    variants: catalog.variants,
    collections: catalog.collections,
  };
}
