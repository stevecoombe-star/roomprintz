/**
 * Partner product variant manual order.
 *
 * Manual sequence is vibode_stage_variants.sort_order within one product.
 * Name sorts are a Partner Portal view and never call the reorder API.
 * The shopper-facing selector reads the same sort_order and ignores this view.
 */

import type { StageVariant } from "./types";

const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_VARIANTS = 500;

export const PARTNER_VARIANT_ORDER_SAVED_EVENT = "partner-product-variant-order-saved";

export type PartnerVariantSort = "manual" | "name_asc" | "name_desc";

export type PartnerVariantOrderIssue =
  | "malformed"
  | "duplicate_variant"
  | "unknown_variant"
  | "unknown_product"
  | "incomplete_order";

export type PartnerVariantSortAssignment = Readonly<{
  variantId: string;
  sortOrder: number;
}>;

export type PartnerVariantOrderCard = Readonly<{
  id: string;
  label: string;
  published: boolean;
}>;

export type PartnerVariantOrderRequest = Readonly<{
  productId: string;
  variantIds: readonly string[];
}>;

const VARIANT_LABEL_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/**
 * Merchant-facing variant label. Matches the product editor heading
 * (finish, then finish · sku, then sku). A blank finish and sku fall
 * back to the variant id so unnamed variants stay deterministic.
 */
export function partnerVariantOrderLabel(input: Readonly<{
  finish: string | null | undefined;
  sku: string | null | undefined;
  variantId: string;
}>): string {
  const finish = input.finish?.trim() ?? "";
  const sku = input.sku?.trim() ?? "";
  if (finish && sku) return `${finish} · ${sku}`;
  if (finish) return finish;
  if (sku) return sku;
  return input.variantId;
}

export function partnerVariantManualIds(variants: readonly StageVariant[]): readonly string[] {
  const ranked = variants.map((variant, index) => ({ variant, index }));
  const hasOrder = ranked.some((item) => (
    typeof item.variant.sortOrder === "number" && Number.isFinite(item.variant.sortOrder)
  ));
  if (!hasOrder) return variants.map((variant) => variant.variantId);
  return [...ranked].sort((left, right) => {
    const leftOrder = typeof left.variant.sortOrder === "number" && Number.isFinite(left.variant.sortOrder)
      ? left.variant.sortOrder
      : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.variant.sortOrder === "number" && Number.isFinite(right.variant.sortOrder)
      ? right.variant.sortOrder
      : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.index - right.index;
  }).map((item) => item.variant.variantId);
}

export function comparePartnerVariantLabels(
  left: Readonly<{ id: string; label: string }>,
  right: Readonly<{ id: string; label: string }>,
): number {
  const byLabel = VARIANT_LABEL_COLLATOR.compare(left.label, right.label);
  if (byLabel !== 0) return byLabel;
  return left.id.localeCompare(right.id, "en");
}

export function orderPartnerVariantCards(
  cards: readonly PartnerVariantOrderCard[],
  sort: PartnerVariantSort,
  manualIds: readonly string[],
): readonly PartnerVariantOrderCard[] {
  if (sort !== "manual") {
    const ascending = [...cards].sort((left, right) => comparePartnerVariantLabels(left, right));
    return sort === "name_asc" ? ascending : [...ascending].reverse();
  }
  const byId = new Map(cards.map((card) => [card.id, card]));
  const ordered: PartnerVariantOrderCard[] = [];
  const seen = new Set<string>();
  for (const id of manualIds) {
    const card = byId.get(id);
    if (!card?.published || seen.has(id)) continue;
    ordered.push(card);
    seen.add(id);
  }
  for (const card of cards) {
    if (!card.published || seen.has(card.id)) continue;
    ordered.push(card);
    seen.add(card.id);
  }
  for (const card of cards) {
    if (card.published || seen.has(card.id)) continue;
    ordered.push(card);
    seen.add(card.id);
  }
  return ordered;
}

export function movePartnerVariant(
  variantIds: readonly string[],
  fromIndex: number,
  toIndex: number,
): readonly string[] {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return variantIds;
  if (
    fromIndex < 0
    || toIndex < 0
    || fromIndex >= variantIds.length
    || toIndex >= variantIds.length
    || fromIndex === toIndex
  ) {
    return variantIds;
  }
  const next = [...variantIds];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return variantIds;
  next.splice(toIndex, 0, moved);
  return next;
}

export function nextPartnerVariantSortOrder(
  variants: readonly Pick<StageVariant, "sortOrder">[],
  additionalCreates = 0,
): number {
  const explicit = variants.flatMap((variant) => (
    typeof variant.sortOrder === "number" && Number.isFinite(variant.sortOrder)
      ? [Math.trunc(variant.sortOrder)]
      : []
  ));
  if (explicit.length === 0) return variants.length + additionalCreates;
  return Math.max(...explicit) + 1 + additionalCreates;
}

/**
 * Reuse the product's existing sort_order slots, made strictly increasing,
 * so a reorder keeps the same numeric band when the current values already
 * increase. Tied values expand by one.
 */
export function assignPartnerVariantSortOrders(
  orderedVariantIds: readonly string[],
  current: readonly PartnerVariantSortAssignment[],
): readonly PartnerVariantSortAssignment[] {
  const slots = [...current]
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.variantId.localeCompare(right.variantId, "en");
    })
    .map((item) => item.sortOrder);
  const assigned: number[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const slot of slots) {
    const next = slot > previous ? slot : previous + 1;
    assigned.push(next);
    previous = next;
  }
  return orderedVariantIds.map((variantId, index) => ({
    variantId,
    sortOrder: assigned[index] ?? index,
  }));
}

export function samePartnerVariantOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function readPartnerVariantOrderRequest(body: unknown): PartnerVariantOrderRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const productId = (body as { productId?: unknown }).productId;
  const variantIds = (body as { variantIds?: unknown }).variantIds;
  if (typeof productId !== "string" || !ID_SHAPE.test(productId)) return null;
  if (!Array.isArray(variantIds) || variantIds.length > MAX_VARIANTS) return null;
  const ids: string[] = [];
  for (const item of variantIds) {
    if (typeof item !== "string" || !ID_SHAPE.test(item)) return null;
    ids.push(item);
  }
  return { productId, variantIds: ids };
}

export function validatePartnerVariantReorder(
  variantIds: readonly string[],
  ownedVariantIds: readonly string[],
): PartnerVariantOrderIssue | null {
  const seen = new Set<string>();
  for (const id of variantIds) {
    if (seen.has(id)) return "duplicate_variant";
    seen.add(id);
  }
  const owned = new Set(ownedVariantIds);
  for (const id of variantIds) {
    if (!owned.has(id)) return "unknown_variant";
  }
  if (seen.size !== ownedVariantIds.length) return "incomplete_order";
  for (const id of ownedVariantIds) {
    if (!seen.has(id)) return "incomplete_order";
  }
  return null;
}

export function partnerVariantOrderMessage(issue: PartnerVariantOrderIssue): string {
  if (issue === "duplicate_variant") return "That order includes the same variant more than once.";
  if (issue === "unknown_variant") return "That order includes a variant from outside this product.";
  if (issue === "unknown_product") return "That product is not in your catalog.";
  if (issue === "incomplete_order") return "The variant order must include every variant.";
  return "The variant order could not be read.";
}
