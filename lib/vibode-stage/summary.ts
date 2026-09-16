import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";

import {
  fallbackProductIdForAsset,
  formatStagePrice,
  isStageCommercialActive,
  isStageProductAvailable,
  stageProductById,
  stageVariantById,
} from "./catalog";
import type {
  StageCatalogSnapshot,
  StageProduct,
  StageSummaryLine,
  StageSummaryModel,
  StageVariant,
} from "./types";

export function resolveSceneObjectCatalogRef(object: SceneObjectDefinition): Readonly<{
  productId: string | null;
  variantId: string | null;
}> {
  const productId = object.productId ?? fallbackProductIdForAsset(object.assetId);
  return {
    productId,
    variantId: object.variantId ?? null,
  };
}

export function summaryGroupKey(object: SceneObjectDefinition): string {
  const ref = resolveSceneObjectCatalogRef(object);
  if (ref.productId) {
    return `${ref.productId}::${ref.variantId ?? ""}`;
  }
  return `asset:${object.assetId}`;
}

export function buildStageSummary(input: Readonly<{
  objects: readonly SceneObjectDefinition[];
  extraProducts?: readonly StageProduct[];
  extraVariants?: readonly StageVariant[];
  catalog?: StageCatalogSnapshot;
}>): StageSummaryModel {
  const groups = new Map<string, SceneObjectDefinition[]>();
  for (const object of input.objects) {
    const key = summaryGroupKey(object);
    const group = groups.get(key);
    if (group) group.push(object);
    else groups.set(key, [object]);
  }

  const lines: StageSummaryLine[] = [];
  let currency = "USD";
  let shoppable = false;

  for (const [key, objects] of groups) {
    const first = objects[0];
    if (!first) continue;
    const ref = resolveSceneObjectCatalogRef(first);
    const product = stageProductById(ref.productId, input.extraProducts, input.catalog);
    const variant = stageVariantById(
      ref.variantId ?? product?.defaultVariantId,
      input.extraVariants,
      input.catalog,
    );
    const unitPrice = variant?.priceAmount ?? product?.priceAmount ?? null;
    const lineCurrency = variant?.priceCurrency ?? product?.priceCurrency ?? "USD";
    currency = lineCurrency;
    const quantity = objects.length;
    const lineTotal = unitPrice == null ? null : unitPrice * quantity;
    const lineShoppable = Boolean(
      product &&
      isStageProductAvailable(product, input.catalog) &&
      variant &&
      isStageCommercialActive(variant.status) &&
      (product.productUrl || variant.productUrl),
    );
    if (lineShoppable) shoppable = true;
    lines.push({
      key,
      productId: ref.productId,
      variantId: variant?.variantId ?? ref.variantId,
      assetId: first.assetId,
      brand: product?.brand ?? "Furniture",
      name: product?.name ?? "Placed item",
      variantLabel: variant?.finishLabel ?? null,
      imageUrl: product?.imageUrl ?? null,
      unitPrice,
      currency: lineCurrency,
      quantity,
      lineTotal,
      objectIds: objects.map((object) => object.objectId),
      shoppable: lineShoppable,
    });
  }

  const priced = lines.filter((line) => line.lineTotal != null);
  const estimatedTotal = priced.length === 0
    ? null
    : priced.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);

  return {
    itemCount: input.objects.length,
    lines,
    estimatedTotal,
    currency,
    shoppable,
  };
}

export function formatSummaryQuantityPrice(
  unitPrice: number | null,
  currency: string,
  quantity: number,
): string {
  const price = formatStagePrice(unitPrice, currency);
  if (!price) return quantity > 1 ? `× ${quantity}` : "";
  return quantity > 1 ? `${price} × ${quantity}` : price;
}

export function formatEstimatedTotal(
  total: number | null,
  currency: string,
): string {
  return formatStagePrice(total, currency) || "—";
}

export function summaryItemCountLabel(count: number): string {
  return count === 1 ? "1 item in this room" : `${count} items in this room`;
}
