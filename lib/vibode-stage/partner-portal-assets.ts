/**
 * PI-5G4a Partner-scoped certified-ready Asset picker.
 *
 * Portal tenancy enforcement: G4a only offers Assets already referenced
 * by this Partner's existing Variants that are durable ready and pass
 * the same runtime/manifest/definition checks as validateTargetAsset.
 *
 * This is not a new PI-5F business validation and does not modify
 * validateTargetAsset. No Asset upload, registration, or DML.
 */

import { isStageAssetReady } from "./catalog";
import { validateTargetAsset } from "./product-variant-register";
import type { StageAsset, StageCatalogSnapshot, StageProduct, StageVariant } from "./types";

export type PartnerReadyAssetReference = Readonly<{
  productId: string;
  variantId: string;
  productName: string;
  finishLabel: string | null;
}>;

export type PartnerReadyAssetChoice = Readonly<{
  assetId: string;
  label: string;
  glbFileName: string | null;
  referencedBy: readonly PartnerReadyAssetReference[];
}>;

function glbFileNameFromUrl(glbUrl: string): string | null {
  const trimmed = glbUrl.trim();
  if (!trimmed) return null;
  const fileName = trimmed.split("/").pop() ?? "";
  return fileName.length > 0 ? fileName : null;
}

function assetLabel(
  asset: StageAsset,
  referencedBy: readonly PartnerReadyAssetReference[],
): string {
  const first = referencedBy[0];
  const glbFileName = glbFileNameFromUrl(asset.glbUrl);
  if (first) {
    const finish = first.finishLabel ? ` · ${first.finishLabel}` : "";
    return `${first.productName}${finish}`;
  }
  return glbFileName ?? asset.assetId;
}

function partnerReferencedAssetIds(catalog: StageCatalogSnapshot): string[] {
  const ids = new Set<string>();
  for (const variant of catalog.variants) {
    if (variant.assetId) ids.add(variant.assetId);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function referencesFor(
  assetId: string,
  variants: readonly StageVariant[],
  products: readonly StageProduct[],
): PartnerReadyAssetReference[] {
  const refs: PartnerReadyAssetReference[] = [];
  for (const variant of variants) {
    if (variant.assetId !== assetId) continue;
    const product = products.find((item) => item.productId === variant.productId);
    refs.push({
      productId: variant.productId,
      variantId: variant.variantId,
      productName: product?.name ?? variant.productId,
      finishLabel: variant.finishLabel,
    });
  }
  return refs.sort((left, right) => (
    left.productId.localeCompare(right.productId) || left.variantId.localeCompare(right.variantId)
  ));
}

function assetPassesCertifiedRuntime(
  assetId: string,
  catalog: StageCatalogSnapshot,
  repoRoot: string,
): boolean {
  const errors: { code: string; message: string }[] = [];
  validateTargetAsset(assetId, {
    catalog,
    seedAssets: catalog.assets,
    repoRoot,
  }, errors);
  return errors.length === 0;
}

export function listPartnerReadyAssetsForVariantCreate(
  catalog: StageCatalogSnapshot,
  options: Readonly<{ repoRoot?: string }> = {},
): readonly PartnerReadyAssetChoice[] {
  const repoRoot = options.repoRoot ?? process.cwd();
  const choices: PartnerReadyAssetChoice[] = [];
  for (const assetId of partnerReferencedAssetIds(catalog)) {
    const asset = catalog.assets.find((item) => item.assetId === assetId) ?? null;
    if (!asset || !isStageAssetReady(asset)) continue;
    if (!assetPassesCertifiedRuntime(assetId, catalog, repoRoot)) continue;
    const referencedBy = referencesFor(assetId, catalog.variants, catalog.products);
    choices.push({
      assetId,
      label: assetLabel(asset, referencedBy),
      glbFileName: glbFileNameFromUrl(asset.glbUrl),
      referencedBy,
    });
  }
  return choices;
}

export function partnerReadyAssetIdSet(
  catalog: StageCatalogSnapshot,
  options: Readonly<{ repoRoot?: string }> = {},
): ReadonlySet<string> {
  return new Set(listPartnerReadyAssetsForVariantCreate(catalog, options).map((item) => item.assetId));
}

export function isPartnerReadyAssetId(
  catalog: StageCatalogSnapshot,
  assetId: string,
  options: Readonly<{ repoRoot?: string }> = {},
): boolean {
  return partnerReadyAssetIdSet(catalog, options).has(assetId);
}
