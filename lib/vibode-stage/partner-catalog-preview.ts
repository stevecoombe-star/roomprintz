/**
 * PI-5G1 Partner catalog preview adapter.
 *
 * Portal request → authoritative Partner ID → live durable current state →
 * certified parsePartnerCatalogSyncJson / planPartnerCatalogSync.
 * Zero writes. sqlPlan is never returned to the browser.
 */

import {
  durableAssetCatalogForPlanning,
  foldedPartnerStateFromDurableCatalog,
} from "./partner-catalog-live-state";
import {
  parsePartnerCatalogSyncJson,
  planPartnerCatalogSync,
} from "./partner-catalog-sync";
import type { PartnerCommercialEligibilityContext } from "./partner-commercial-assets";
import { partnerRuntimePlanVersionFor } from "./partner-catalog-runtime-executor-v5";
import type {
  PartnerCatalogSyncPlan,
  PlannedCollectionCreate,
  PlannedCollectionUpdate,
  PlannedMembership,
  PlannedPartnerStatusTransition,
  PlannedProductCreate,
  PlannedProductStatusTransition,
  PlannedProductUpdate,
  PlannedVariantCreate,
  PlannedVariantStatusTransition,
  PlannedVariantUpdate,
} from "./partner-catalog-sync-types";
import type { ProductVariantIssue } from "./product-variant-register";
import type { StageCatalogSnapshot } from "./types";

export type PartnerCatalogPreviewRequest = Readonly<{
  catalog: StageCatalogSnapshot;
  partnerId: string;
  document: unknown;
  repoRoot?: string;
  commercialEligibility?: PartnerCommercialEligibilityContext;
}>;

export type PartnerCatalogPreviewDto = Readonly<{
  ok: boolean;
  noOp: boolean;
  partnerId: string | null;
  planVersion: 1 | 4 | 5 | null;
  issues: readonly ProductVariantIssue[];
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
}>;

export type PartnerCatalogPreviewResult = Readonly<{
  kind: "preview" | "invalid_document";
  dto: PartnerCatalogPreviewDto;
}>;

function stampAuthoritativePartnerId(document: unknown, partnerId: string): unknown {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { partnerId, mode: "patch" };
  }
  return { ...(document as Record<string, unknown>), partnerId };
}

export function presentPartnerCatalogSyncPlan(
  plan: Pick<
    PartnerCatalogSyncPlan,
    | "ok"
    | "noOp"
    | "partnerId"
    | "issues"
    | "partnerStatusTransition"
    | "productCreates"
    | "productUpdates"
    | "variantCreates"
    | "variantUpdates"
    | "collectionCreates"
    | "collectionUpdates"
    | "membershipAdds"
    | "membershipRemoves"
    | "productDeactivations"
    | "productReactivations"
    | "variantDeactivations"
    | "variantReactivations"
  >,
): PartnerCatalogPreviewDto {
  return {
    ok: plan.ok,
    noOp: plan.noOp,
    partnerId: plan.partnerId,
    planVersion: plan.ok && plan.issues.length === 0 ? partnerRuntimePlanVersionFor(plan) : null,
    issues: plan.issues,
    partnerStatusTransition: plan.partnerStatusTransition,
    productCreates: plan.productCreates,
    productUpdates: plan.productUpdates,
    variantCreates: plan.variantCreates,
    variantUpdates: plan.variantUpdates,
    collectionCreates: plan.collectionCreates,
    collectionUpdates: plan.collectionUpdates,
    membershipAdds: plan.membershipAdds,
    membershipRemoves: plan.membershipRemoves,
    productDeactivations: plan.productDeactivations,
    productReactivations: plan.productReactivations,
    variantDeactivations: plan.variantDeactivations,
    variantReactivations: plan.variantReactivations,
  };
}

function invalidDocument(
  issues: readonly ProductVariantIssue[],
  partnerId: string | null,
): PartnerCatalogPreviewResult {
  return {
    kind: "invalid_document",
    dto: presentPartnerCatalogSyncPlan({
      ok: false,
      noOp: false,
      partnerId,
      issues,
      partnerStatusTransition: null,
      productCreates: [],
      productUpdates: [],
      variantCreates: [],
      variantUpdates: [],
      collectionCreates: [],
      collectionUpdates: [],
      membershipAdds: [],
      membershipRemoves: [],
      productDeactivations: [],
      productReactivations: [],
      variantDeactivations: [],
      variantReactivations: [],
    }),
  };
}

export function previewPartnerCatalogFromDurable(
  input: PartnerCatalogPreviewRequest,
): PartnerCatalogPreviewResult {
  const folded = foldedPartnerStateFromDurableCatalog(input.catalog, input.partnerId);
  if (!folded) {
    return invalidDocument(
      [{ code: "PARTNER_MISMATCH", message: "Durable Partner catalog is missing." }],
      input.partnerId,
    );
  }
  const stamped = stampAuthoritativePartnerId(input.document, input.partnerId);
  const parsed = parsePartnerCatalogSyncJson(stamped);
  if (!parsed.ok) {
    return invalidDocument(parsed.issues, input.partnerId);
  }
  const plan = planPartnerCatalogSync({
    current: folded,
    document: parsed.document,
    catalog: durableAssetCatalogForPlanning(input.catalog),
    seedAssets: input.catalog.assets,
    repoRoot: input.repoRoot,
    commercialEligibility: input.commercialEligibility,
  });
  return {
    kind: "preview",
    dto: presentPartnerCatalogSyncPlan(plan),
  };
}
