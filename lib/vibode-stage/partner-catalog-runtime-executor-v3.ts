/**
 * PI-5G4b planVersion 3 runtime apply-payload serializer.
 *
 * Planner still decides WHAT. This module adds HOW for Product creates
 * plus their required default Variant creates, while reusing the frozen
 * G3 update serialization and G4a Variant-create payload. It does not
 * parse canonical documents, run planner logic, or emit SQL.
 */

import {
  g3UnsupportedPublishOperations,
  persistableRuntimeApplyPayload,
  toRuntimeApplyPayload,
  type PartnerRuntimeCollectionUpdate,
  type PartnerRuntimeMembershipAdd,
  type PartnerRuntimeMembershipRemove,
  type PartnerRuntimeProductUpdate,
  type PartnerRuntimeUnsupportedOperation,
  type PartnerRuntimeVariantUpdate,
} from "./partner-catalog-runtime-executor";
import {
  toRuntimeApplyPayloadV2,
  type PartnerRuntimeVariantCreate,
} from "./partner-catalog-runtime-executor-v2";
import type {
  PartnerCatalogSyncPlan,
  PlannedProductCreate,
} from "./partner-catalog-sync-types";

export const PARTNER_RUNTIME_PLAN_VERSION_3 = 3;

export type PartnerRuntimeProductCreate = Readonly<{
  productId: string;
  name: string;
  brand: string;
  retailer: string;
  imageUrl: string;
  productUrl: string;
  priceAmount: number;
  priceCurrency: string;
  categoryId: string;
  subcategoryId: string | null;
  source: "partner_catalog";
  partnerId: string;
  defaultVariantId: string;
  status: "active";
  sortOrder: number;
}>;

export type PartnerRuntimeApplyPayloadV3 = Readonly<{
  planVersion: typeof PARTNER_RUNTIME_PLAN_VERSION_3;
  partnerId: string;
  productCreates: readonly PartnerRuntimeProductCreate[];
  variantCreates: readonly PartnerRuntimeVariantCreate[];
  collectionCreates: readonly [];
  productUpdates: readonly PartnerRuntimeProductUpdate[];
  variantUpdates: readonly PartnerRuntimeVariantUpdate[];
  collectionUpdates: readonly PartnerRuntimeCollectionUpdate[];
  membershipAdds: readonly PartnerRuntimeMembershipAdd[];
  membershipRemoves: readonly PartnerRuntimeMembershipRemove[];
}>;

export type PartnerRuntimeSerializeResultV3 =
  | Readonly<{ ok: true; payload: PartnerRuntimeApplyPayloadV3 }>
  | Readonly<{ ok: false; error: PartnerRuntimeUnsupportedOperation }>;

function reject(operations: readonly string[]): PartnerRuntimeSerializeResultV3 {
  return {
    ok: false,
    error: {
      code: "UNSUPPORTED_PUBLISH_OPERATION",
      message: "This draft includes catalog changes that cannot be published yet.",
      operations,
    },
  };
}

export function g4bUnsupportedPublishOperations(plan: PartnerCatalogSyncPlan): string[] {
  return g3UnsupportedPublishOperations({
    ...plan,
    productCreates: [],
    variantCreates: [],
  });
}

function toProductCreate(create: PlannedProductCreate): PartnerRuntimeProductCreate | null {
  const product = create.product;
  if (!product.productUrl) return null;
  if (product.priceAmount == null || !Number.isFinite(product.priceAmount)) return null;
  if (product.source !== "partner_catalog" || !product.partnerId) return null;
  if (!product.defaultVariantId || !product.categoryId) return null;
  return {
    productId: product.productId,
    name: product.name,
    brand: product.brand,
    retailer: product.retailer,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    priceAmount: product.priceAmount,
    priceCurrency: product.priceCurrency,
    categoryId: product.categoryId,
    subcategoryId: product.subcategoryId,
    source: "partner_catalog",
    partnerId: product.partnerId,
    defaultVariantId: product.defaultVariantId,
    status: "active",
    sortOrder: create.sortOrder,
  };
}

export function toRuntimeApplyPayloadV3(plan: PartnerCatalogSyncPlan): PartnerRuntimeSerializeResultV3 {
  if (!plan.ok) return reject(["plan"]);
  if (!plan.partnerId) return reject(["partnerId"]);
  if (plan.collectionCreates.length > 0) return reject(["collectionCreates"]);
  const unsupported = g4bUnsupportedPublishOperations(plan);
  if (unsupported.length > 0) return reject(unsupported);

  const updates = toRuntimeApplyPayload({
    ...plan,
    productCreates: [],
    variantCreates: [],
  });
  if (!updates.ok) return reject(updates.error.operations);

  const variants = toRuntimeApplyPayloadV2({
    ...plan,
    productCreates: [],
    collectionCreates: [],
  });
  if (!variants.ok) return reject(variants.error.operations);

  const productCreates: PartnerRuntimeProductCreate[] = [];
  for (const create of [...plan.productCreates].sort((left, right) => (
    left.product.productId.localeCompare(right.product.productId)
  ))) {
    const mapped = toProductCreate(create);
    if (!mapped) return reject(["productCreates"]);
    productCreates.push(mapped);
  }

  return {
    ok: true,
    payload: {
      planVersion: PARTNER_RUNTIME_PLAN_VERSION_3,
      partnerId: plan.partnerId,
      productCreates,
      variantCreates: variants.payload.variantCreates,
      collectionCreates: [],
      productUpdates: updates.payload.productUpdates,
      variantUpdates: updates.payload.variantUpdates,
      collectionUpdates: updates.payload.collectionUpdates,
      membershipAdds: updates.payload.membershipAdds,
      membershipRemoves: updates.payload.membershipRemoves,
    },
  };
}

export function persistableRuntimeApplyPayloadV3(payload: PartnerRuntimeApplyPayloadV3): Record<string, unknown> {
  return persistableRuntimeApplyPayload(payload);
}

export function partnerRuntimePlanNeedsV3(plan: PartnerCatalogSyncPlan): boolean {
  return plan.productCreates.length > 0;
}
