/**
 * PARTNER-UX-10 planVersion 7 runtime apply-payload serializer.
 *
 * Inherits v6 commercial and Product-status payload capabilities and adds
 * guarded Variant status transitions. Planner still decides WHAT.
 * Frozen v1–v6 serializers are unchanged. Generic set_status mutations stay forbidden.
 *
 * Variant status cannot ride on planVersion 6: that function is already
 * deployed and ignores unknown keys, so a variant-only v6 payload would
 * publish as a no-op.
 */

import type { PartnerRuntimeUnsupportedOperation } from "./partner-catalog-runtime-executor";
import { persistableRuntimeApplyPayload } from "./partner-catalog-runtime-executor";
import {
  g5c1UnsupportedPublishOperations,
  toRuntimeApplyPayloadV5,
  type PartnerRuntimeApplyPayloadV5,
} from "./partner-catalog-runtime-executor-v5";
import type { PartnerRuntimeProductStatusTransition } from "./partner-catalog-runtime-executor-v6";
import type {
  PartnerCatalogSyncPlan,
  PlannedProductStatusTransition,
  PlannedVariantStatusTransition,
} from "./partner-catalog-sync-types";

export const PARTNER_RUNTIME_PLAN_VERSION_7 = 7;

const LIFECYCLE_OPERATIONS = new Set([
  "productDeactivations",
  "productReactivations",
  "variantDeactivations",
  "variantReactivations",
]);

export type PartnerRuntimeVariantStatusTransition = Readonly<{
  variantId: string;
  productId: string;
  from: "active" | "inactive";
  to: "active" | "inactive";
}>;

export type PartnerRuntimeApplyPayloadV7 = Omit<PartnerRuntimeApplyPayloadV5, "planVersion"> & Readonly<{
  planVersion: typeof PARTNER_RUNTIME_PLAN_VERSION_7;
  productStatusTransitions: readonly PartnerRuntimeProductStatusTransition[];
  variantStatusTransitions: readonly PartnerRuntimeVariantStatusTransition[];
}>;

export type PartnerRuntimeSerializeResultV7 =
  | Readonly<{ ok: true; payload: PartnerRuntimeApplyPayloadV7 }>
  | Readonly<{ ok: false; error: PartnerRuntimeUnsupportedOperation }>;

function reject(operations: readonly string[]): PartnerRuntimeSerializeResultV7 {
  return {
    ok: false,
    error: {
      code: "UNSUPPORTED_PUBLISH_OPERATION",
      message: "This draft includes catalog changes that cannot be published yet.",
      operations,
    },
  };
}

export function partnerRuntimePlanNeedsV7(
  plan: Pick<PartnerCatalogSyncPlan, "variantDeactivations" | "variantReactivations">,
): boolean {
  return plan.variantDeactivations.length > 0 || plan.variantReactivations.length > 0;
}

export function g7UnsupportedPublishOperations(plan: PartnerCatalogSyncPlan): string[] {
  return g5c1UnsupportedPublishOperations(plan).filter((operation) => !LIFECYCLE_OPERATIONS.has(operation));
}

function toProductStatusTransition(
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

function toVariantStatusTransition(
  transition: PlannedVariantStatusTransition,
): PartnerRuntimeVariantStatusTransition | null {
  if (!transition.variantId || !transition.productId) return null;
  if (transition.from !== "active" && transition.from !== "inactive") return null;
  if (transition.to !== "active" && transition.to !== "inactive") return null;
  if (transition.from === transition.to) return null;
  return {
    variantId: transition.variantId,
    productId: transition.productId,
    from: transition.from,
    to: transition.to,
  };
}

export function toRuntimeApplyPayloadV7(plan: PartnerCatalogSyncPlan): PartnerRuntimeSerializeResultV7 {
  if (!plan.ok) return reject(["plan"]);
  if (!plan.partnerId) return reject(["partnerId"]);
  const unsupported = g7UnsupportedPublishOperations(plan);
  if (unsupported.length > 0) return reject(unsupported);

  const inherited = toRuntimeApplyPayloadV5({
    ...plan,
    productDeactivations: [],
    productReactivations: [],
    variantDeactivations: [],
    variantReactivations: [],
  });
  if (!inherited.ok) return inherited;

  const productStatusTransitions: PartnerRuntimeProductStatusTransition[] = [];
  for (const transition of [...plan.productDeactivations, ...plan.productReactivations].sort((left, right) => (
    left.productId.localeCompare(right.productId)
  ))) {
    const mapped = toProductStatusTransition(transition);
    if (!mapped) return reject(["productStatusTransitions"]);
    productStatusTransitions.push(mapped);
  }

  const variantStatusTransitions: PartnerRuntimeVariantStatusTransition[] = [];
  for (const transition of [...plan.variantDeactivations, ...plan.variantReactivations].sort((left, right) => (
    left.variantId.localeCompare(right.variantId)
  ))) {
    const mapped = toVariantStatusTransition(transition);
    if (!mapped) return reject(["variantStatusTransitions"]);
    variantStatusTransitions.push(mapped);
  }
  if (variantStatusTransitions.length === 0) return reject(["variantStatusTransitions"]);

  return {
    ok: true,
    payload: {
      ...inherited.payload,
      planVersion: PARTNER_RUNTIME_PLAN_VERSION_7,
      productStatusTransitions,
      variantStatusTransitions,
    },
  };
}

export function persistableRuntimeApplyPayloadV7(payload: PartnerRuntimeApplyPayloadV7): Record<string, unknown> {
  return persistableRuntimeApplyPayload(payload);
}
