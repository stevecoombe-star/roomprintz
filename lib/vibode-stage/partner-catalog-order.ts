/**
 * Partner catalog manual order.
 *
 * Manual sequence is vibode_stage_products.sort_order for the partner's
 * partner_catalog products. Name sorts are display-only and never call this.
 */

import type { StageProduct } from "./types";

const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PRODUCTS = 2000;

export type PartnerCatalogOrderIssue =
  | "malformed"
  | "duplicate_product"
  | "unknown_product"
  | "incomplete_order";

export type PartnerCatalogSortAssignment = Readonly<{
  productId: string;
  sortOrder: number;
}>;

export function nextPartnerProductSortOrder(
  products: readonly Pick<StageProduct, "sortOrder">[],
  additionalCreates = 0,
): number {
  const explicit = products.flatMap((product) => (
    typeof product.sortOrder === "number" && Number.isFinite(product.sortOrder)
      ? [Math.trunc(product.sortOrder)]
      : []
  ));
  if (explicit.length === 0) return products.length + additionalCreates;
  return Math.max(...explicit) + 1 + additionalCreates;
}

export function movePartnerCatalogProduct(
  productIds: readonly string[],
  fromIndex: number,
  toIndex: number,
): readonly string[] {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return productIds;
  if (
    fromIndex < 0
    || toIndex < 0
    || fromIndex >= productIds.length
    || toIndex >= productIds.length
    || fromIndex === toIndex
  ) {
    return productIds;
  }
  const next = [...productIds];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return productIds;
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Reuse the partner's existing sort_order slots, made strictly increasing,
 * so a reorder keeps the same numeric band when the current values already
 * increase. Tied values expand by one so the new sequence is deterministic
 * without pulling a higher unique band back to zero.
 */
export function assignPartnerManualSortOrders(
  orderedProductIds: readonly string[],
  current: readonly PartnerCatalogSortAssignment[],
): readonly PartnerCatalogSortAssignment[] {
  const slots = [...current]
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.productId.localeCompare(right.productId, "en");
    })
    .map((item) => item.sortOrder);
  const assigned: number[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const slot of slots) {
    const next = slot > previous ? slot : previous + 1;
    assigned.push(next);
    previous = next;
  }
  return orderedProductIds.map((productId, index) => ({
    productId,
    sortOrder: assigned[index] ?? index,
  }));
}

export function readPartnerCatalogOrderIds(body: unknown): readonly string[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const productIds = (body as { productIds?: unknown }).productIds;
  if (!Array.isArray(productIds) || productIds.length > MAX_PRODUCTS) return null;
  const ids: string[] = [];
  for (const item of productIds) {
    if (typeof item !== "string" || !PRODUCT_ID.test(item)) return null;
    ids.push(item);
  }
  return ids;
}

export function validatePartnerCatalogReorder(
  productIds: readonly string[],
  ownedProductIds: readonly string[],
): PartnerCatalogOrderIssue | null {
  const seen = new Set<string>();
  for (const id of productIds) {
    if (seen.has(id)) return "duplicate_product";
    seen.add(id);
  }
  const owned = new Set(ownedProductIds);
  for (const id of productIds) {
    if (!owned.has(id)) return "unknown_product";
  }
  if (seen.size !== ownedProductIds.length) return "incomplete_order";
  for (const id of ownedProductIds) {
    if (!seen.has(id)) return "incomplete_order";
  }
  return null;
}

export function partnerCatalogOrderMessage(issue: PartnerCatalogOrderIssue): string {
  if (issue === "duplicate_product") return "That order includes the same product more than once.";
  if (issue === "unknown_product") return "That order includes a product from outside this catalog.";
  if (issue === "incomplete_order") return "The catalog order must include every product.";
  return "The catalog order could not be read.";
}
