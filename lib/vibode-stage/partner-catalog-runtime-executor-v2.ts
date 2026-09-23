/**
 * PI-5G4a planVersion 2 runtime apply-payload serializer.
 *
 * Planner still decides WHAT. This module adds HOW for additional
 * Variant creates while reusing the frozen G3 update serialization.
 * It does not parse canonical documents, run planner logic, or emit SQL.
 */

import {
  g3UnsupportedPublishOperations,
  persistableRuntimeApplyPayload,
  toRuntimeApplyPayload,
  type PartnerRuntimeApplyPayload,
  type PartnerRuntimeCollectionUpdate,
  type PartnerRuntimeMembershipAdd,
  type PartnerRuntimeMembershipRemove,
  type PartnerRuntimeProductUpdate,
  type PartnerRuntimeUnsupportedOperation,
  type PartnerRuntimeVariantUpdate,
} from "./partner-catalog-runtime-executor";
import type { PartnerCatalogSyncPlan, PlannedVariantCreate } from "./partner-catalog-sync-types";

export const PARTNER_RUNTIME_PLAN_VERSION_2 = 2;

export type PartnerRuntimeVariantCreate = Readonly<{
  variantId: string;
  productId: string;
  currentAssetId: string;
  finishLabel: string | null;
  sku: string | null;
  priceAmount: number;
  priceCurrency: string;
  productUrl: string | null;
}>;

export type PartnerRuntimeApplyPayloadV2 = Readonly<{
  planVersion: typeof PARTNER_RUNTIME_PLAN_VERSION_2;
  partnerId: string;
  variantCreates: readonly PartnerRuntimeVariantCreate[];
  productUpdates: readonly PartnerRuntimeProductUpdate[];
  variantUpdates: readonly PartnerRuntimeVariantUpdate[];
  collectionUpdates: readonly PartnerRuntimeCollectionUpdate[];
  membershipAdds: readonly PartnerRuntimeMembershipAdd[];
  membershipRemoves: readonly PartnerRuntimeMembershipRemove[];
}>;

export type PartnerRuntimeSerializeResultV2 =
  | Readonly<{ ok: true; payload: PartnerRuntimeApplyPayloadV2 }>
  | Readonly<{ ok: false; error: PartnerRuntimeUnsupportedOperation }>;

function reject(operations: readonly string[]): PartnerRuntimeSerializeResultV2 {
  return {
    ok: false,
    error: {
      code: "UNSUPPORTED_PUBLISH_OPERATION",
      message: "This draft includes catalog changes that cannot be published yet.",
      operations,
    },
  };
}

export function g4aUnsupportedPublishOperations(plan: PartnerCatalogSyncPlan): string[] {
  return g3UnsupportedPublishOperations({
    ...plan,
    variantCreates: [],
  });
}

function toVariantCreate(create: PlannedVariantCreate): PartnerRuntimeVariantCreate | null {
  const assetId = create.variant.assetId;
  if (!assetId) return null;
  if (create.variant.priceAmount == null || !Number.isFinite(create.variant.priceAmount)) return null;
  return {
    variantId: create.variant.variantId,
    productId: create.variant.productId,
    currentAssetId: assetId,
    finishLabel: create.variant.finishLabel,
    sku: create.variant.sku,
    priceAmount: create.variant.priceAmount,
    priceCurrency: create.variant.priceCurrency,
    productUrl: create.variant.productUrl,
  };
}

export function toRuntimeApplyPayloadV2(plan: PartnerCatalogSyncPlan): PartnerRuntimeSerializeResultV2 {
  if (!plan.ok) return reject(["plan"]);
  if (!plan.partnerId) return reject(["partnerId"]);
  const unsupported = g4aUnsupportedPublishOperations(plan);
  if (unsupported.length > 0) return reject(unsupported);

  const updates = toRuntimeApplyPayload({
    ...plan,
    variantCreates: [],
  });
  if (!updates.ok) return reject(updates.error.operations);

  const variantCreates: PartnerRuntimeVariantCreate[] = [];
  for (const create of [...plan.variantCreates].sort((left, right) => (
    left.variant.variantId.localeCompare(right.variant.variantId)
  ))) {
    const mapped = toVariantCreate(create);
    if (!mapped) return reject(["variantCreates"]);
    variantCreates.push(mapped);
  }

  return {
    ok: true,
    payload: {
      planVersion: PARTNER_RUNTIME_PLAN_VERSION_2,
      partnerId: plan.partnerId,
      variantCreates,
      productUpdates: updates.payload.productUpdates,
      variantUpdates: updates.payload.variantUpdates,
      collectionUpdates: updates.payload.collectionUpdates,
      membershipAdds: updates.payload.membershipAdds,
      membershipRemoves: updates.payload.membershipRemoves,
    },
  };
}

export function persistableRuntimeApplyPayloadV2(payload: PartnerRuntimeApplyPayloadV2): Record<string, unknown> {
  return persistableRuntimeApplyPayload(payload as unknown as PartnerRuntimeApplyPayload);
}

export function partnerRuntimePlanNeedsV2(plan: PartnerCatalogSyncPlan): boolean {
  return plan.variantCreates.length > 0;
}
