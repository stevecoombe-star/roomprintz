/**
 * Shared Partner catalog sync plan types.
 *
 * Kept out of partner-catalog-sync.ts so the snapshot planner can
 * import them without a runtime cycle into the patch module.
 */

import type { ProductVariantIssue } from "./product-variant-register";
import type {
  StageCollection,
  StageCommercialStatus,
  StagePartner,
  StagePartnerStatus,
  StageProduct,
  StageVariant,
} from "./types";

export type FoldedPartnerCatalogState = Readonly<{
  partners: readonly StagePartner[];
  products: readonly StageProduct[];
  variants: readonly StageVariant[];
  collections: readonly StageCollection[];
}>;

export type PlannedFieldChange = Readonly<{
  column: string;
  next: string | number | null;
  previous: string | number | null;
}>;

export type PlannedProductUpdate = Readonly<{
  productId: string;
  changes: readonly PlannedFieldChange[];
}>;

export type PlannedVariantUpdate = Readonly<{
  variantId: string;
  productId: string;
  changes: readonly PlannedFieldChange[];
}>;

export type PlannedVariantCreate = Readonly<{
  variant: StageVariant;
}>;

export type PlannedCollectionUpdate = Readonly<{
  collectionId: string;
  name: string;
  previousName: string;
}>;

export type PlannedMembership = Readonly<{
  productId: string;
  collectionId: string;
  sortOrder?: number;
}>;

export type PlannedProductStatusTransition = Readonly<{
  productId: string;
  from: StageCommercialStatus;
  to: StageCommercialStatus;
}>;

export type PlannedVariantStatusTransition = Readonly<{
  variantId: string;
  productId: string;
  from: StageCommercialStatus;
  to: StageCommercialStatus;
}>;

export type PlannedPartnerStatusTransition = Readonly<{
  partnerId: string;
  from: StagePartnerStatus;
  to: StagePartnerStatus;
}>;

export type PlannedProductCreate = Readonly<{
  product: StageProduct;
  sortOrder: number;
}>;

export type PlannedCollectionCreate = Readonly<{
  collection: StageCollection;
  sortOrder: number;
}>;

export type PartnerCatalogSyncSqlPlan = Readonly<{
  sql: string;
  migration: string;
}>;

export type PartnerCatalogSyncPlan = Readonly<{
  ok: boolean;
  noOp: boolean;
  issues: readonly ProductVariantIssue[];
  partnerId: string | null;
  partnerStatusTransition: PlannedPartnerStatusTransition | null;
  productCreates: readonly PlannedProductCreate[];
  productUpdates: readonly PlannedProductUpdate[];
  variantCreates: readonly PlannedVariantCreate[];
  variantUpdates: readonly PlannedVariantUpdate[];
  collectionCreates: readonly PlannedCollectionCreate[];
  collectionUpdates: readonly PlannedCollectionUpdate[];
  membershipAdds: readonly PlannedMembership[];
  membershipRemoves: readonly PlannedMembership[];
  productDeactivations: readonly PlannedProductStatusTransition[];
  productReactivations: readonly PlannedProductStatusTransition[];
  variantDeactivations: readonly PlannedVariantStatusTransition[];
  variantReactivations: readonly PlannedVariantStatusTransition[];
  sqlPlan: PartnerCatalogSyncSqlPlan | null;
  nextState: FoldedPartnerCatalogState | null;
}>;
