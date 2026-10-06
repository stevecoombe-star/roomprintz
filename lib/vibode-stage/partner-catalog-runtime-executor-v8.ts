/**
 * PARTNER-UX-13 planVersion 8 runtime apply-payload serializer.
 *
 * Inherits v7 commercial, Product-status, and Variant-status payloads.
 * Adds Variant physical dimensions. Frozen v1–v7 serializers are unchanged.
 * Dimension-only publishes cannot ride on v7: that function ignores unknown
 * keys, so the dimensions would publish as a no-op.
 */

import type { PartnerRuntimeUnsupportedOperation } from "./partner-catalog-runtime-executor";
import {
  persistableRuntimeApplyPayload,
  toRuntimeApplyPayload,
} from "./partner-catalog-runtime-executor";
import {
  partnerRuntimePlanNeedsV4,
  toRuntimeApplyPayloadV4,
} from "./partner-catalog-runtime-executor-v4";
import {
  partnerRuntimePlanNeedsV5,
  partnerRuntimePlanVersionFor,
  toRuntimeApplyPayloadV5,
} from "./partner-catalog-runtime-executor-v5";
import {
  partnerRuntimePlanNeedsV6,
  toRuntimeApplyPayloadV6,
} from "./partner-catalog-runtime-executor-v6";
import {
  g7UnsupportedPublishOperations,
  partnerRuntimePlanNeedsV7,
  toRuntimeApplyPayloadV7,
  type PartnerRuntimeApplyPayloadV7,
} from "./partner-catalog-runtime-executor-v7";
import {
  explicitModelDimensions,
  isModelSizingMode,
  isPlausibleModelSize,
  type ModelDimensions,
} from "./model-dimensions";
import type {
  PartnerCatalogSyncPlan,
  PlannedVariantCreate,
  PlannedVariantModelDimensions,
} from "./partner-catalog-sync-types";

export const PARTNER_RUNTIME_PLAN_VERSION_8 = 8;

export type PartnerRuntimeVariantModelDimensions = Readonly<{
  variantId: string;
  productId: string;
  previousWidthM: number | null;
  previousHeightM: number | null;
  previousDepthM: number | null;
  previousSizingMode: ModelDimensions["sizingMode"] | null;
  widthM: number;
  heightM: number;
  depthM: number;
  sizingMode: ModelDimensions["sizingMode"];
}>;

type PartnerRuntimeVariantCreateV8 = PartnerRuntimeApplyPayloadV7["variantCreates"][number] & Readonly<{
  modelWidthM?: number;
  modelHeightM?: number;
  modelDepthM?: number;
  modelSizingMode?: ModelDimensions["sizingMode"];
}>;

export type PartnerRuntimeApplyPayloadV8 = Omit<
  PartnerRuntimeApplyPayloadV7,
  "planVersion" | "variantCreates"
> & Readonly<{
  planVersion: typeof PARTNER_RUNTIME_PLAN_VERSION_8;
  variantCreates: readonly PartnerRuntimeVariantCreateV8[];
  variantModelDimensions: readonly PartnerRuntimeVariantModelDimensions[];
}>;

export type PartnerRuntimeSerializeResultV8 =
  | Readonly<{ ok: true; payload: PartnerRuntimeApplyPayloadV8 }>
  | Readonly<{ ok: false; error: PartnerRuntimeUnsupportedOperation }>;

function reject(operations: readonly string[]): PartnerRuntimeSerializeResultV8 {
  return {
    ok: false,
    error: {
      code: "UNSUPPORTED_PUBLISH_OPERATION",
      message: "This draft includes catalog changes that cannot be published yet.",
      operations,
    },
  };
}

export function partnerRuntimePlanNeedsV8(
  plan: Pick<PartnerCatalogSyncPlan, "variantCreates" | "variantModelDimensionUpdates">,
): boolean {
  if ((plan.variantModelDimensionUpdates ?? []).length > 0) return true;
  return plan.variantCreates.some((create) => explicitModelDimensions(create.variant) != null);
}

export function g8UnsupportedPublishOperations(plan: PartnerCatalogSyncPlan): string[] {
  return g7UnsupportedPublishOperations(plan);
}

export function partnerRuntimePlanVersionForPublish(
  plan: Parameters<typeof partnerRuntimePlanVersionFor>[0] & Pick<
    PartnerCatalogSyncPlan,
    "variantCreates" | "variantModelDimensionUpdates"
  >,
): 1 | 4 | 5 | 6 | 7 | 8 {
  if (partnerRuntimePlanNeedsV8(plan)) return 8;
  return partnerRuntimePlanVersionFor(plan);
}

function asRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

function toDimensionUpdate(
  update: PlannedVariantModelDimensions,
): PartnerRuntimeVariantModelDimensions | null {
  const next = update.next;
  if (!isPlausibleModelSize(next) || !isModelSizingMode(next.sizingMode)) return null;
  const previous = update.previous;
  if (previous && (!isPlausibleModelSize(previous) || !isModelSizingMode(previous.sizingMode))) return null;
  return {
    variantId: update.variantId,
    productId: update.productId,
    previousWidthM: previous?.widthM ?? null,
    previousHeightM: previous?.heightM ?? null,
    previousDepthM: previous?.depthM ?? null,
    previousSizingMode: previous?.sizingMode ?? null,
    widthM: next.widthM,
    heightM: next.heightM,
    depthM: next.depthM,
    sizingMode: next.sizingMode,
  };
}

function decorateVariantCreates(
  creates: readonly Record<string, unknown>[],
  planned: readonly PlannedVariantCreate[],
): readonly Record<string, unknown>[] | null {
  const decorated: Record<string, unknown>[] = [];
  for (const create of creates) {
    const variantId = typeof create.variantId === "string" ? create.variantId : "";
    const source = planned.find((item) => item.variant.variantId === variantId) ?? null;
    const dimensions = source ? explicitModelDimensions(source.variant) : null;
    if (!dimensions) {
      decorated.push(create);
      continue;
    }
    decorated.push({
      ...create,
      modelWidthM: dimensions.widthM,
      modelHeightM: dimensions.heightM,
      modelDepthM: dimensions.depthM,
      modelSizingMode: dimensions.sizingMode,
    });
  }
  return decorated;
}

export function toRuntimeApplyPayloadV8(plan: PartnerCatalogSyncPlan): PartnerRuntimeSerializeResultV8 {
  if (!plan.ok) return reject(["plan"]);
  if (!plan.partnerId) return reject(["partnerId"]);
  const unsupported = g8UnsupportedPublishOperations(plan);
  if (unsupported.length > 0) return reject(unsupported);

  const inherited = partnerRuntimePlanNeedsV7(plan)
    ? toRuntimeApplyPayloadV7(plan)
    : partnerRuntimePlanNeedsV6(plan)
      ? toRuntimeApplyPayloadV6(plan)
      : partnerRuntimePlanNeedsV5(plan)
        ? toRuntimeApplyPayloadV5(plan)
        : partnerRuntimePlanNeedsV4(plan)
          ? toRuntimeApplyPayloadV4(plan)
          : toRuntimeApplyPayload(plan);
  if (!inherited.ok) return inherited;

  const payload = inherited.payload as unknown as Record<string, unknown>;
  const variantCreates = decorateVariantCreates(asRecordArray(payload.variantCreates), plan.variantCreates);
  if (!variantCreates) return reject(["variantCreates"]);

  const variantModelDimensions: PartnerRuntimeVariantModelDimensions[] = [];
  for (const update of [...(plan.variantModelDimensionUpdates ?? [])].sort((left, right) => (
    left.variantId.localeCompare(right.variantId)
  ))) {
    const mapped = toDimensionUpdate(update);
    if (!mapped) return reject(["variantModelDimensions"]);
    variantModelDimensions.push(mapped);
  }

  return {
    ok: true,
    payload: {
      planVersion: PARTNER_RUNTIME_PLAN_VERSION_8,
      partnerId: plan.partnerId,
      productCreates: asRecordArray(payload.productCreates),
      variantCreates,
      collectionCreates: asRecordArray(payload.collectionCreates),
      productUpdates: asRecordArray(payload.productUpdates),
      variantUpdates: asRecordArray(payload.variantUpdates),
      collectionUpdates: asRecordArray(payload.collectionUpdates),
      membershipAdds: asRecordArray(payload.membershipAdds),
      membershipRemoves: asRecordArray(payload.membershipRemoves),
      productStatusTransitions: asRecordArray(payload.productStatusTransitions),
      variantStatusTransitions: asRecordArray(payload.variantStatusTransitions),
      variantModelDimensions,
    } as unknown as PartnerRuntimeApplyPayloadV8,
  };
}

export function persistableRuntimeApplyPayloadV8(payload: PartnerRuntimeApplyPayloadV8): Record<string, unknown> {
  return persistableRuntimeApplyPayload(payload);
}
