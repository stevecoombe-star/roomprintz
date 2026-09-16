/**
 * PI-5G1 live durable Partner state adapter for certified PI-5F planning.
 *
 * Translates one Partner's durable STAGE catalog into FoldedPartnerCatalogState.
 * Does not fold repo JSON / certified fixture documents.
 */

import { createStageCatalogSnapshot } from "./catalog";
import type { FoldedPartnerCatalogState } from "./partner-catalog-sync-types";
import { scopeDurableCatalogToPartner } from "./partner-portal-catalog";
import type { StageCatalogSnapshot } from "./types";

export function foldedPartnerStateFromDurableCatalog(
  catalog: StageCatalogSnapshot,
  partnerId: string,
): FoldedPartnerCatalogState | null {
  const scoped = scopeDurableCatalogToPartner(catalog, partnerId);
  if (!scoped) return null;
  return Object.freeze({
    partners: scoped.partners,
    products: scoped.products,
    variants: scoped.variants,
    collections: scoped.collections,
  });
}

export function durableAssetCatalogForPlanning(
  catalog: StageCatalogSnapshot,
): StageCatalogSnapshot {
  return createStageCatalogSnapshot({
    authority: "durable",
    fallbackReason: null,
    products: [],
    variants: [],
    collections: [],
    partners: [],
    assets: catalog.assets,
  });
}
