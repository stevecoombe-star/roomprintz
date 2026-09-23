/**
 * PI-5G5C1 planVersion 5 runtime apply-payload serializer.
 *
 * Inherits v4 Product/Variant/Collection payload capabilities. The only
 * commercial change is new-Variant Asset eligibility: Partner↔Asset
 * mapping + ready, instead of an existing Partner Variant already
 * referencing the Asset. Planner still decides WHAT. Frozen v1–v4
 * serializers are unchanged.
 */

import { persistableRuntimeApplyPayload } from "./partner-catalog-runtime-executor";
import {
  g4cUnsupportedPublishOperations,
  toRuntimeApplyPayloadV4,
  type PartnerRuntimeApplyPayloadV4,
} from "./partner-catalog-runtime-executor-v4";
import type { PartnerRuntimeUnsupportedOperation } from "./partner-catalog-runtime-executor";
import type { PartnerCatalogSyncPlan } from "./partner-catalog-sync-types";

export const PARTNER_RUNTIME_PLAN_VERSION_5 = 5;

export type PartnerRuntimeApplyPayloadV5 = Omit<PartnerRuntimeApplyPayloadV4, "planVersion"> & Readonly<{
  planVersion: typeof PARTNER_RUNTIME_PLAN_VERSION_5;
}>;

export type PartnerRuntimeSerializeResultV5 =
  | Readonly<{ ok: true; payload: PartnerRuntimeApplyPayloadV5 }>
  | Readonly<{ ok: false; error: PartnerRuntimeUnsupportedOperation }>;

export function g5c1UnsupportedPublishOperations(plan: PartnerCatalogSyncPlan): string[] {
  return g4cUnsupportedPublishOperations(plan);
}

export function toRuntimeApplyPayloadV5(plan: PartnerCatalogSyncPlan): PartnerRuntimeSerializeResultV5 {
  const inherited = toRuntimeApplyPayloadV4(plan);
  if (!inherited.ok) return inherited;
  return {
    ok: true,
    payload: {
      ...inherited.payload,
      planVersion: PARTNER_RUNTIME_PLAN_VERSION_5,
    },
  };
}

export function persistableRuntimeApplyPayloadV5(payload: PartnerRuntimeApplyPayloadV5): Record<string, unknown> {
  return persistableRuntimeApplyPayload(payload);
}

export function partnerRuntimePlanNeedsV5(
  plan: Pick<PartnerCatalogSyncPlan, "productCreates" | "variantCreates">,
): boolean {
  return plan.productCreates.length > 0 || plan.variantCreates.length > 0;
}

export function partnerRuntimePlanVersionFor(
  plan: Pick<PartnerCatalogSyncPlan, "noOp" | "productCreates" | "variantCreates" | "collectionCreates">,
): 1 | 4 | 5 {
  if (plan.noOp) return 1;
  if (partnerRuntimePlanNeedsV5(plan)) return 5;
  if (plan.collectionCreates.length > 0) return 4;
  return 1;
}
