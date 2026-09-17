/**
 * PI-5G4c planVersion 4 runtime apply-payload serializer.
 *
 * Planner still decides WHAT. This module adds HOW for Collection
 * creates on mixed plans, reusing frozen G4b Product/Variant
 * serialization and G3 updates. It does not parse canonical documents,
 * run planner logic, or emit SQL.
 */

import { persistableRuntimeApplyPayload } from "./partner-catalog-runtime-executor";
import {
  g4bUnsupportedPublishOperations,
  toRuntimeApplyPayloadV3,
  type PartnerRuntimeProductCreate,
} from "./partner-catalog-runtime-executor-v3";
import type { PartnerRuntimeVariantCreate } from "./partner-catalog-runtime-executor-v2";
import type {
  PartnerRuntimeCollectionUpdate,
  PartnerRuntimeMembershipAdd,
  PartnerRuntimeMembershipRemove,
  PartnerRuntimeProductUpdate,
  PartnerRuntimeUnsupportedOperation,
  PartnerRuntimeVariantUpdate,
} from "./partner-catalog-runtime-executor";
import type {
  PartnerCatalogSyncPlan,
  PlannedCollectionCreate,
} from "./partner-catalog-sync-types";

export const PARTNER_RUNTIME_PLAN_VERSION_4 = 4;

export type PartnerRuntimeCollectionCreate = Readonly<{
  collectionId: string;
  name: string;
  owner: "partner";
  partnerName: string;
  partnerId: string;
  status: "active";
  sortOrder: number;
}>;

export type PartnerRuntimeApplyPayloadV4 = Readonly<{
  planVersion: typeof PARTNER_RUNTIME_PLAN_VERSION_4;
  partnerId: string;
  productCreates: readonly PartnerRuntimeProductCreate[];
  variantCreates: readonly PartnerRuntimeVariantCreate[];
  collectionCreates: readonly PartnerRuntimeCollectionCreate[];
  productUpdates: readonly PartnerRuntimeProductUpdate[];
  variantUpdates: readonly PartnerRuntimeVariantUpdate[];
  collectionUpdates: readonly PartnerRuntimeCollectionUpdate[];
  membershipAdds: readonly PartnerRuntimeMembershipAdd[];
  membershipRemoves: readonly PartnerRuntimeMembershipRemove[];
}>;

export type PartnerRuntimeSerializeResultV4 =
  | Readonly<{ ok: true; payload: PartnerRuntimeApplyPayloadV4 }>
  | Readonly<{ ok: false; error: PartnerRuntimeUnsupportedOperation }>;

function reject(operations: readonly string[]): PartnerRuntimeSerializeResultV4 {
  return {
    ok: false,
    error: {
      code: "UNSUPPORTED_PUBLISH_OPERATION",
      message: "This draft includes catalog changes that cannot be published yet.",
      operations,
    },
  };
}

export function g4cUnsupportedPublishOperations(plan: PartnerCatalogSyncPlan): string[] {
  return g4bUnsupportedPublishOperations({
    ...plan,
    collectionCreates: [],
  });
}

function toCollectionCreate(create: PlannedCollectionCreate): PartnerRuntimeCollectionCreate | null {
  const collection = create.collection;
  if (!collection.collectionId || !collection.name) return null;
  if (collection.owner !== "partner") return null;
  if (!collection.partnerId || !collection.partnerName) return null;
  if (typeof create.sortOrder !== "number" || !Number.isFinite(create.sortOrder)) return null;
  return {
    collectionId: collection.collectionId,
    name: collection.name,
    owner: "partner",
    partnerName: collection.partnerName,
    partnerId: collection.partnerId,
    status: "active",
    sortOrder: create.sortOrder,
  };
}

export function toRuntimeApplyPayloadV4(plan: PartnerCatalogSyncPlan): PartnerRuntimeSerializeResultV4 {
  if (!plan.ok) return reject(["plan"]);
  if (!plan.partnerId) return reject(["partnerId"]);
  const unsupported = g4cUnsupportedPublishOperations(plan);
  if (unsupported.length > 0) return reject(unsupported);

  const mixed = toRuntimeApplyPayloadV3({
    ...plan,
    collectionCreates: [],
  });
  if (!mixed.ok) return reject(mixed.error.operations);

  const collectionCreates: PartnerRuntimeCollectionCreate[] = [];
  for (const create of [...plan.collectionCreates].sort((left, right) => (
    left.collection.collectionId.localeCompare(right.collection.collectionId)
  ))) {
    const mapped = toCollectionCreate(create);
    if (!mapped) return reject(["collectionCreates"]);
    collectionCreates.push(mapped);
  }

  return {
    ok: true,
    payload: {
      planVersion: PARTNER_RUNTIME_PLAN_VERSION_4,
      partnerId: plan.partnerId,
      productCreates: mixed.payload.productCreates,
      variantCreates: mixed.payload.variantCreates,
      collectionCreates,
      productUpdates: mixed.payload.productUpdates,
      variantUpdates: mixed.payload.variantUpdates,
      collectionUpdates: mixed.payload.collectionUpdates,
      membershipAdds: mixed.payload.membershipAdds,
      membershipRemoves: mixed.payload.membershipRemoves,
    },
  };
}

export function persistableRuntimeApplyPayloadV4(payload: PartnerRuntimeApplyPayloadV4): Record<string, unknown> {
  return persistableRuntimeApplyPayload(payload);
}

export function partnerRuntimePlanNeedsV4(plan: PartnerCatalogSyncPlan): boolean {
  return plan.collectionCreates.length > 0;
}
