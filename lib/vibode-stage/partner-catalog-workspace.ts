/**
 * Partner-facing catalog workspace view model.
 *
 * Derived from an already-loaded Partner-scoped catalog. Presentation only:
 * no catalog writes, draft mutation, or Asset state changes.
 */

import { formatStagePrice, isStageAssetReady } from "./catalog";
import type { StageAsset, StageCatalogSnapshot, StageProduct, StageVariant } from "./types";

export type PartnerCatalogStatusFilter = "all" | "active" | "inactive";
export type PartnerCatalogReadinessFilter = "all" | "ready" | "no_model" | "needs_attention";
export type PartnerCatalogReadinessKind = "ready" | "no_model" | "needs_attention";
export type PartnerCatalogEditorIntent = "manage" | "add-product";

export type PartnerCatalogReadiness = Readonly<{
  kind: PartnerCatalogReadinessKind;
  label: string;
}>;

export type PartnerCatalogProductRow = Readonly<{
  productKey: string;
  name: string;
  imageUrl: string;
  status: "active" | "inactive";
  statusLabel: "Active" | "Inactive";
  variantCountLabel: string;
  variantSummary: string | null;
  priceLabel: string;
  collectionNames: readonly string[];
  readiness: PartnerCatalogReadinessKind;
  readinessLabel: string;
  searchText: string;
}>;

export type PartnerCatalogRowFilter = Readonly<{
  query: string;
  status: PartnerCatalogStatusFilter;
  readiness: PartnerCatalogReadinessFilter;
}>;

type VariantModelState = "ready" | "no_model" | "needs_attention";

function trimmed(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function variantModelState(
  variant: StageVariant,
  assetsById: ReadonlyMap<string, StageAsset>,
): VariantModelState {
  const assetId = trimmed(variant.assetId);
  if (!assetId) return "no_model";
  return isStageAssetReady(assetsById.get(assetId)) ? "ready" : "needs_attention";
}

export function derivePartnerCatalogReadiness(
  variants: readonly StageVariant[],
  assets: readonly StageAsset[],
): PartnerCatalogReadiness {
  const assetsById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const states = variants.map((variant) => variantModelState(variant, assetsById));
  if (states.length === 0 || states.every((state) => state === "no_model")) {
    return { kind: "no_model", label: "No model" };
  }
  const readyCount = states.filter((state) => state === "ready").length;
  if (readyCount === states.length) return { kind: "ready", label: "Ready" };
  if (readyCount > 0) {
    return { kind: "needs_attention", label: `${readyCount} of ${states.length} ready` };
  }
  return { kind: "needs_attention", label: "Needs attention" };
}

function variantCountLabel(count: number): string {
  if (count === 0) return "No variants";
  if (count === 1) return "1 variant";
  return `${count} variants`;
}

function compactVariantSummary(variants: readonly StageVariant[]): string | null {
  if (variants.length === 0) return null;
  if (variants.length === 1) {
    const variant = variants[0];
    if (!variant) return null;
    const parts: string[] = [];
    const finish = trimmed(variant.finishLabel);
    const sku = trimmed(variant.sku);
    if (finish) parts.push(finish);
    if (sku) parts.push(`SKU ${sku}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  const finishes: string[] = [];
  const seen = new Set<string>();
  for (const variant of variants) {
    const finish = trimmed(variant.finishLabel);
    if (!finish) continue;
    const key = finish.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    finishes.push(finish);
  }
  if (finishes.length === 0) return null;
  const shown = finishes.slice(0, 3);
  const extra = finishes.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra}` : shown.join(", ");
}

function collectionNamesFor(
  product: StageProduct,
  namesById: ReadonlyMap<string, string>,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const collectionId of product.collectionIds) {
    if (seen.has(collectionId)) continue;
    seen.add(collectionId);
    const name = namesById.get(collectionId);
    if (name) names.push(name);
  }
  return names;
}

function priceLabel(product: StageProduct, variants: readonly StageVariant[]): string {
  const direct = formatStagePrice(product.priceAmount, product.priceCurrency);
  if (direct) return direct;
  const preferred = variants.find((variant) => variant.variantId === product.defaultVariantId) ?? variants[0];
  if (!preferred) return "";
  return formatStagePrice(preferred.priceAmount, preferred.priceCurrency || product.priceCurrency);
}

function searchTextFor(
  product: StageProduct,
  variants: readonly StageVariant[],
  collectionNames: readonly string[],
): string {
  const fields = [
    product.name,
    ...variants.flatMap((variant) => [variant.sku ?? "", variant.finishLabel ?? ""]),
    ...collectionNames,
  ];
  return fields.join("\n").toLowerCase();
}

export function buildPartnerCatalogRows(
  catalog: StageCatalogSnapshot,
): readonly PartnerCatalogProductRow[] {
  const variantsByProduct = new Map<string, StageVariant[]>();
  for (const variant of catalog.variants) {
    const current = variantsByProduct.get(variant.productId) ?? [];
    current.push(variant);
    variantsByProduct.set(variant.productId, current);
  }
  const collectionNames = new Map(
    catalog.collections.map((collection) => [collection.collectionId, collection.name]),
  );

  return catalog.products.map((product) => {
    const variants = variantsByProduct.get(product.productId) ?? [];
    const names = collectionNamesFor(product, collectionNames);
    const readiness = derivePartnerCatalogReadiness(variants, catalog.assets);
    const status = product.status === "inactive" ? "inactive" : "active";
    return {
      productKey: product.productId,
      name: product.name,
      imageUrl: product.imageUrl,
      status,
      statusLabel: status === "inactive" ? "Inactive" : "Active",
      variantCountLabel: variantCountLabel(variants.length),
      variantSummary: compactVariantSummary(variants),
      priceLabel: priceLabel(product, variants),
      collectionNames: names,
      readiness: readiness.kind,
      readinessLabel: readiness.label,
      searchText: searchTextFor(product, variants, names),
    };
  });
}

export function filterPartnerCatalogRows(
  rows: readonly PartnerCatalogProductRow[],
  filter: PartnerCatalogRowFilter,
): readonly PartnerCatalogProductRow[] {
  const tokens = filter.query.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0);
  return rows.filter((row) => {
    if (filter.status !== "all" && row.status !== filter.status) return false;
    if (filter.readiness !== "all" && row.readiness !== filter.readiness) return false;
    if (tokens.length === 0) return true;
    return tokens.every((token) => row.searchText.includes(token));
  });
}

export function partnerCatalogEditorPath(
  draftId: string,
  intent: PartnerCatalogEditorIntent,
): string {
  const path = `/partner/catalog/drafts/${encodeURIComponent(draftId)}`;
  return intent === "add-product" ? `${path}?intent=add-product` : path;
}

export function partnerProductEditorPath(productId: string): string {
  return `/partner/catalog/products/${encodeURIComponent(productId)}`;
}
