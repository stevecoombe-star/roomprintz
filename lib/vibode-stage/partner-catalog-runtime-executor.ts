/**
 * PI-5G3 typed runtime apply-payload serializer.
 *
 * Planner decides WHAT. This module decides HOW that exact certified
 * G3 plan is represented as versioned JSON for the privileged RPC.
 * It does not parse canonical documents, run planner logic, or emit SQL.
 */

import type {
  PartnerCatalogSyncPlan,
  PlannedCollectionUpdate,
  PlannedFieldChange,
  PlannedMembership,
  PlannedProductUpdate,
  PlannedVariantUpdate,
} from "./partner-catalog-sync-types";

export const PARTNER_RUNTIME_PLAN_VERSION = 1;

export const PARTNER_RUNTIME_PRODUCT_COLUMNS = Object.freeze([
  "name",
  "image_url",
  "product_url",
  "price_amount",
] as const);

export const PARTNER_RUNTIME_VARIANT_COLUMNS = Object.freeze([
  "finish_label",
  "sku",
  "price_amount",
  "product_url",
] as const);

export type PartnerRuntimeProductColumn = (typeof PARTNER_RUNTIME_PRODUCT_COLUMNS)[number];
export type PartnerRuntimeVariantColumn = (typeof PARTNER_RUNTIME_VARIANT_COLUMNS)[number];

export type PartnerRuntimeFieldChange = Readonly<{
  column: PartnerRuntimeProductColumn | PartnerRuntimeVariantColumn;
  previous: string | number | null;
  next: string | number | null;
}>;

export type PartnerRuntimeProductUpdate = Readonly<{
  productId: string;
  changes: readonly PartnerRuntimeFieldChange[];
}>;

export type PartnerRuntimeVariantUpdate = Readonly<{
  variantId: string;
  productId: string;
  changes: readonly PartnerRuntimeFieldChange[];
}>;

export type PartnerRuntimeCollectionUpdate = Readonly<{
  collectionId: string;
  name: string;
  previousName: string;
}>;

export type PartnerRuntimeMembershipAdd = Readonly<{
  productId: string;
  collectionId: string;
  sortOrder: number;
}>;

export type PartnerRuntimeMembershipRemove = Readonly<{
  productId: string;
  collectionId: string;
}>;

export type PartnerRuntimeApplyPayload = Readonly<{
  planVersion: typeof PARTNER_RUNTIME_PLAN_VERSION;
  partnerId: string;
  productUpdates: readonly PartnerRuntimeProductUpdate[];
  variantUpdates: readonly PartnerRuntimeVariantUpdate[];
  collectionUpdates: readonly PartnerRuntimeCollectionUpdate[];
  membershipAdds: readonly PartnerRuntimeMembershipAdd[];
  membershipRemoves: readonly PartnerRuntimeMembershipRemove[];
}>;

export type PartnerRuntimeUnsupportedOperation = Readonly<{
  code: "UNSUPPORTED_PUBLISH_OPERATION";
  message: string;
  operations: readonly string[];
}>;

export type PartnerRuntimeSerializeResult =
  | Readonly<{ ok: true; payload: PartnerRuntimeApplyPayload }>
  | Readonly<{ ok: false; error: PartnerRuntimeUnsupportedOperation }>;

const PRODUCT_COLUMN_SET = new Set<string>(PARTNER_RUNTIME_PRODUCT_COLUMNS);
const VARIANT_COLUMN_SET = new Set<string>(PARTNER_RUNTIME_VARIANT_COLUMNS);

function sortById<T>(items: readonly T[], id: (item: T) => string): T[] {
  return [...items].sort((left, right) => id(left).localeCompare(id(right)));
}

function membershipKey(item: PlannedMembership): string {
  return `${item.collectionId}:${item.productId}`;
}

function isProductColumn(column: string): column is PartnerRuntimeProductColumn {
  return PRODUCT_COLUMN_SET.has(column);
}

function isVariantColumn(column: string): column is PartnerRuntimeVariantColumn {
  return VARIANT_COLUMN_SET.has(column);
}

function unsupportedColumns(changes: readonly PlannedFieldChange[], kind: "product" | "variant"): string[] {
  return changes
    .map((change) => change.column)
    .filter((column) => (kind === "product" ? !isProductColumn(column) : !isVariantColumn(column)));
}

export function g3UnsupportedPublishOperations(plan: PartnerCatalogSyncPlan): string[] {
  const operations: string[] = [];
  if (plan.partnerStatusTransition) operations.push("partnerStatusTransition");
  if (plan.productCreates.length > 0) operations.push("productCreates");
  if (plan.variantCreates.length > 0) operations.push("variantCreates");
  if (plan.collectionCreates.length > 0) operations.push("collectionCreates");
  if (plan.productDeactivations.length > 0) operations.push("productDeactivations");
  if (plan.productReactivations.length > 0) operations.push("productReactivations");
  if (plan.variantDeactivations.length > 0) operations.push("variantDeactivations");
  if (plan.variantReactivations.length > 0) operations.push("variantReactivations");
  for (const update of plan.productUpdates) {
    for (const column of unsupportedColumns(update.changes, "product")) {
      operations.push(`product.${column}`);
    }
  }
  for (const update of plan.variantUpdates) {
    for (const column of unsupportedColumns(update.changes, "variant")) {
      operations.push(`variant.${column}`);
    }
  }
  return [...new Set(operations)].sort((left, right) => left.localeCompare(right));
}

function toProductChanges(changes: readonly PlannedFieldChange[]): PartnerRuntimeFieldChange[] | null {
  const next: PartnerRuntimeFieldChange[] = [];
  for (const change of changes) {
    if (!isProductColumn(change.column)) return null;
    next.push({
      column: change.column,
      previous: change.previous,
      next: change.next,
    });
  }
  return next;
}

function toVariantChanges(changes: readonly PlannedFieldChange[]): PartnerRuntimeFieldChange[] | null {
  const next: PartnerRuntimeFieldChange[] = [];
  for (const change of changes) {
    if (!isVariantColumn(change.column)) return null;
    next.push({
      column: change.column,
      previous: change.previous,
      next: change.next,
    });
  }
  return next;
}

function reject(operations: readonly string[]): PartnerRuntimeSerializeResult {
  return {
    ok: false,
    error: {
      code: "UNSUPPORTED_PUBLISH_OPERATION",
      message: "This draft includes catalog changes that cannot be published yet.",
      operations,
    },
  };
}

export function toRuntimeApplyPayload(plan: PartnerCatalogSyncPlan): PartnerRuntimeSerializeResult {
  if (!plan.ok) {
    return reject(["plan"]);
  }
  if (!plan.partnerId) {
    return reject(["partnerId"]);
  }
  const unsupported = g3UnsupportedPublishOperations(plan);
  if (unsupported.length > 0) return reject(unsupported);

  const productUpdates: PartnerRuntimeProductUpdate[] = [];
  for (const update of sortById(plan.productUpdates, (item) => item.productId)) {
    const changes = toProductChanges(update.changes);
    if (!changes || changes.length === 0) return reject(["productUpdates"]);
    productUpdates.push({ productId: update.productId, changes });
  }

  const variantUpdates: PartnerRuntimeVariantUpdate[] = [];
  for (const update of sortById(plan.variantUpdates, (item) => item.variantId)) {
    const changes = toVariantChanges(update.changes);
    if (!changes || changes.length === 0) return reject(["variantUpdates"]);
    variantUpdates.push({
      variantId: update.variantId,
      productId: update.productId,
      changes,
    });
  }

  const collectionUpdates: PartnerRuntimeCollectionUpdate[] = sortById(
    plan.collectionUpdates,
    (item) => item.collectionId,
  ).map((item: PlannedCollectionUpdate) => ({
    collectionId: item.collectionId,
    name: item.name,
    previousName: item.previousName,
  }));

  const membershipAdds: PartnerRuntimeMembershipAdd[] = sortById(
    plan.membershipAdds,
    membershipKey,
  ).map((item) => ({
    productId: item.productId,
    collectionId: item.collectionId,
    sortOrder: item.sortOrder ?? 0,
  }));

  const membershipRemoves: PartnerRuntimeMembershipRemove[] = sortById(
    plan.membershipRemoves,
    membershipKey,
  ).map((item) => ({
    productId: item.productId,
    collectionId: item.collectionId,
  }));

  return {
    ok: true,
    payload: {
      planVersion: PARTNER_RUNTIME_PLAN_VERSION,
      partnerId: plan.partnerId,
      productUpdates,
      variantUpdates,
      collectionUpdates,
      membershipAdds,
      membershipRemoves,
    },
  };
}

export function emptyRuntimeApplyPayload(partnerId: string): PartnerRuntimeApplyPayload {
  return {
    planVersion: PARTNER_RUNTIME_PLAN_VERSION,
    partnerId,
    productUpdates: [],
    variantUpdates: [],
    collectionUpdates: [],
    membershipAdds: [],
    membershipRemoves: [],
  };
}

export function persistableRuntimeApplyPayload(payload: PartnerRuntimeApplyPayload): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

export function plannedProductUpdateColumns(update: PlannedProductUpdate): readonly string[] {
  return update.changes.map((change) => change.column);
}

export function plannedVariantUpdateColumns(update: PlannedVariantUpdate): readonly string[] {
  return update.changes.map((change) => change.column);
}
