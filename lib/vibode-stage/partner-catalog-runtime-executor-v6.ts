/**
 * PARTNER-UX-9 planVersion 6 runtime apply-payload serializer.
 *
 * Inherits v5 Product/Variant/Collection payload capabilities and adds
 * guarded Product status transitions. Planner still decides WHAT.
 * Frozen v1–v5 serializers are unchanged. Variant status stays unsupported.
 */

import type { PartnerRuntimeUnsupportedOperation } from "./partner-catalog-runtime-executor";
import { persistableRuntimeApplyPayload } from "./partner-catalog-runtime-executor";
import {
  g5c1UnsupportedPublishOperations,
  toRuntimeApplyPayloadV5,
  type PartnerRuntimeApplyPayloadV5,
} from "./partner-catalog-runtime-executor-v5";
import type {
  PartnerCatalogSyncPlan,
  PlannedProductStatusTransition,
} from "./partner-catalog-sync-types";

export const PARTNER_RUNTIME_PLAN_VERSION_6 = 6;

const PRODUCT_STATUS_OPERATIONS = new Set(["productDeactivations", "productReactivations"]);

export type PartnerRuntimeProductStatusTransition = Readonly<{
  productId: string;
  from: "active" | "inactive";
  to: "active" | "inactive";
}>;

export type PartnerRuntimeApplyPayloadV6 = Omit<PartnerRuntimeApplyPayloadV5, "planVersion"> & Readonly<{
  planVersion: typeof PARTNER_RUNTIME_PLAN_VERSION_6;
  productStatusTransitions: readonly PartnerRuntimeProductStatusTransition[];
}>;

export type PartnerRuntimeSerializeResultV6 =
  | Readonly<{ ok: true; payload: PartnerRuntimeApplyPayloadV6 }>
  | Readonly<{ ok: false; error: PartnerRuntimeUnsupportedOperation }>;

function reject(operations: readonly string[]): PartnerRuntimeSerializeResultV6 {
  return {
    ok: false,
    error: {
      code: "UNSUPPORTED_PUBLISH_OPERATION",
      message: "This draft includes catalog changes that cannot be published yet.",
      operations,
    },
  };
}

export function partnerRuntimePlanNeedsV6(
  plan: Pick<PartnerCatalogSyncPlan, "productDeactivations" | "productReactivations">,
): boolean {
  return plan.productDeactivations.length > 0 || plan.productReactivations.length > 0;
}

export function g6UnsupportedPublishOperations(plan: PartnerCatalogSyncPlan): string[] {
  return g5c1UnsupportedPublishOperations(plan).filter((operation) => !PRODUCT_STATUS_OPERATIONS.has(operation));
}

function toStatusTransition(
  transition: PlannedProductStatusTransition,
): PartnerRuntimeProductStatusTransition | null {
  if (!transition.productId) return null;
  if (transition.from !== "active" && transition.from !== "inactive") return null;
  if (transition.to !== "active" && transition.to !== "inactive") return null;
  if (transition.from === transition.to) return null;
  return {
    productId: transition.productId,
    from: transition.from,
    to: transition.to,
  };
}

export function toRuntimeApplyPayloadV6(plan: PartnerCatalogSyncPlan): PartnerRuntimeSerializeResultV6 {
  if (!plan.ok) return reject(["plan"]);
  if (!plan.partnerId) return reject(["partnerId"]);
  const unsupported = g6UnsupportedPublishOperations(plan);
  if (unsupported.length > 0) return reject(unsupported);

  const inherited = toRuntimeApplyPayloadV5({
    ...plan,
    productDeactivations: [],
    productReactivations: [],
  });
  if (!inherited.ok) return inherited;

  const productStatusTransitions: PartnerRuntimeProductStatusTransition[] = [];
  for (const transition of [...plan.productDeactivations, ...plan.productReactivations].sort((left, right) => (
    left.productId.localeCompare(right.productId)
  ))) {
    const mapped = toStatusTransition(transition);
    if (!mapped) return reject(["productStatusTransitions"]);
    productStatusTransitions.push(mapped);
  }
  if (productStatusTransitions.length === 0) return reject(["productStatusTransitions"]);

  return {
    ok: true,
    payload: {
      ...inherited.payload,
      planVersion: PARTNER_RUNTIME_PLAN_VERSION_6,
      productStatusTransitions,
    },
  };
}

export function persistableRuntimeApplyPayloadV6(payload: PartnerRuntimeApplyPayloadV6): Record<string, unknown> {
  return persistableRuntimeApplyPayload(payload);
}
