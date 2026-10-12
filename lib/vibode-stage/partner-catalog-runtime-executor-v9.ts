/**
 * HARMONIZE-2M planVersion 9 runtime apply-payload serializer.
 *
 * Inherits the v8 commercial payload. Material columns stay out of
 * productUpdates and variantUpdates so frozen v1–v8 publishers ignore
 * them instead of treating a material-only draft as a commercial no-op.
 */

import type { PartnerRuntimeUnsupportedOperation } from "./partner-catalog-runtime-executor";
import { persistableRuntimeApplyPayload } from "./partner-catalog-runtime-executor";
import {
  partnerRuntimePlanVersionForPublish as partnerRuntimePlanVersionForPublishV8,
  toRuntimeApplyPayloadV8,
  type PartnerRuntimeApplyPayloadV8,
} from "./partner-catalog-runtime-executor-v8";
import type {
  PartnerCatalogSyncPlan,
  PlannedMaterialFieldUpdate,
  PlannedProductCreate,
  PlannedVariantCreate,
} from "./partner-catalog-sync-types";

export const PARTNER_RUNTIME_PLAN_VERSION_9 = 9;

export type PartnerRuntimeMaterialUpdate = Readonly<{
  entity: "product" | "variant";
  productId: string;
  variantId: string | null;
  column: "primary_material" | "secondary_material";
  previous: string | null;
  next: string | null;
}>;

type MaterialCarrier = Readonly<{
  primaryMaterial?: string | null;
  secondaryMaterial?: string | null;
}>;

type PartnerRuntimeProductCreateV9 = PartnerRuntimeApplyPayloadV8["productCreates"][number] & MaterialCarrier;
type PartnerRuntimeVariantCreateV9 = PartnerRuntimeApplyPayloadV8["variantCreates"][number] & MaterialCarrier;

export type PartnerRuntimeApplyPayloadV9 = Omit<
  PartnerRuntimeApplyPayloadV8,
  "planVersion" | "productCreates" | "variantCreates"
> & Readonly<{
  planVersion: typeof PARTNER_RUNTIME_PLAN_VERSION_9;
  productCreates: readonly PartnerRuntimeProductCreateV9[];
  variantCreates: readonly PartnerRuntimeVariantCreateV9[];
  materialUpdates: readonly PartnerRuntimeMaterialUpdate[];
}>;

export type PartnerRuntimeSerializeResultV9 =
  | Readonly<{ ok: true; payload: PartnerRuntimeApplyPayloadV9 }>
  | Readonly<{ ok: false; error: PartnerRuntimeUnsupportedOperation }>;

function reject(operations: readonly string[]): PartnerRuntimeSerializeResultV9 {
  return {
    ok: false,
    error: {
      code: "UNSUPPORTED_PUBLISH_OPERATION",
      message: "This draft includes catalog changes that cannot be published yet.",
      operations,
    },
  };
}

function hasMaterial(entity: MaterialCarrier | null | undefined): boolean {
  if (!entity) return false;
  return typeof entity.primaryMaterial === "string" || typeof entity.secondaryMaterial === "string";
}

export function partnerRuntimePlanNeedsV9(
  plan: Pick<PartnerCatalogSyncPlan, "materialFieldUpdates" | "productCreates" | "variantCreates">,
): boolean {
  if ((plan.materialFieldUpdates ?? []).length > 0) return true;
  if (plan.productCreates.some((create) => hasMaterial(create.product))) return true;
  return plan.variantCreates.some((create) => hasMaterial(create.variant));
}

export function partnerRuntimePlanVersionForPublish(
  plan: Parameters<typeof partnerRuntimePlanVersionForPublishV8>[0] & Pick<
    PartnerCatalogSyncPlan,
    "materialFieldUpdates" | "productCreates" | "variantCreates"
  >,
): 1 | 4 | 5 | 6 | 7 | 8 | 9 {
  if (partnerRuntimePlanNeedsV9(plan)) return 9;
  return partnerRuntimePlanVersionForPublishV8(plan);
}

function materialFields(entity: MaterialCarrier): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  if (entity.primaryMaterial !== undefined) fields.primaryMaterial = entity.primaryMaterial;
  if (entity.secondaryMaterial !== undefined) fields.secondaryMaterial = entity.secondaryMaterial;
  return fields;
}

function decorateCreates<T extends { productId?: unknown; variantId?: unknown }>(
  creates: readonly T[],
  planned: readonly (PlannedProductCreate | PlannedVariantCreate)[],
  idOf: (create: T) => string,
  sourceOf: (plannedItem: PlannedProductCreate | PlannedVariantCreate) => MaterialCarrier & { id: string },
): readonly (T & MaterialCarrier)[] {
  return creates.map((create) => {
    const id = idOf(create);
    const source = planned
      .map(sourceOf)
      .find((item) => item.id === id);
    if (!source || !hasMaterial(source)) return create;
    return { ...create, ...materialFields(source) };
  });
}

function toMaterialUpdate(update: PlannedMaterialFieldUpdate): PartnerRuntimeMaterialUpdate | null {
  if (update.column !== "primary_material" && update.column !== "secondary_material") return null;
  if (update.entity !== "product" && update.entity !== "variant") return null;
  if (!update.productId) return null;
  if (update.entity === "variant" && !update.variantId) return null;
  if (update.entity === "product" && update.variantId) return null;
  if (update.next != null && typeof update.next !== "string") return null;
  if (update.previous != null && typeof update.previous !== "string") return null;
  if (update.entity === "product" && update.next === "") return null;
  return {
    entity: update.entity,
    productId: update.productId,
    variantId: update.entity === "variant" ? update.variantId : null,
    column: update.column,
    previous: update.previous,
    next: update.next,
  };
}

export function toRuntimeApplyPayloadV9(plan: PartnerCatalogSyncPlan): PartnerRuntimeSerializeResultV9 {
  if (!plan.ok) return reject(["plan"]);
  if (!plan.partnerId) return reject(["partnerId"]);
  const inherited = toRuntimeApplyPayloadV8(plan);
  if (!inherited.ok) return inherited;

  const materialUpdates: PartnerRuntimeMaterialUpdate[] = [];
  for (const update of [...(plan.materialFieldUpdates ?? [])].sort((left, right) => (
    left.entity.localeCompare(right.entity)
    || left.productId.localeCompare(right.productId)
    || (left.variantId ?? "").localeCompare(right.variantId ?? "")
    || left.column.localeCompare(right.column)
  ))) {
    const mapped = toMaterialUpdate(update);
    if (!mapped) return reject(["materialUpdates"]);
    materialUpdates.push(mapped);
  }

  const productCreates = decorateCreates(
    inherited.payload.productCreates,
    plan.productCreates,
    (create) => create.productId,
    (item) => ({ id: (item as PlannedProductCreate).product.productId, ...(item as PlannedProductCreate).product }),
  );
  const variantCreates = decorateCreates(
    inherited.payload.variantCreates,
    plan.variantCreates,
    (create) => create.variantId,
    (item) => ({ id: (item as PlannedVariantCreate).variant.variantId, ...(item as PlannedVariantCreate).variant }),
  );

  return {
    ok: true,
    payload: {
      ...inherited.payload,
      planVersion: PARTNER_RUNTIME_PLAN_VERSION_9,
      productCreates,
      variantCreates,
      materialUpdates,
    },
  };
}

export function persistableRuntimeApplyPayloadV9(payload: PartnerRuntimeApplyPayloadV9): Record<string, unknown> {
  return persistableRuntimeApplyPayload(payload);
}
