/**
 * PI-5G3 Partner catalog publish orchestration.
 *
 * Fresh durable catalog → frozen PI-5F parser/planner → draft revision
 * and touched-base stale checks → G3 runtime payload → privileged RPC.
 * Does not execute Preview output, rendered SQL, or route-level DML.
 */

import {
  durableAssetCatalogForPlanning,
  foldedPartnerStateFromDurableCatalog,
} from "./partner-catalog-live-state";
import { presentPartnerCatalogSyncPlan } from "./partner-catalog-preview";
import {
  parsePartnerCatalogSyncJson,
  planPartnerCatalogSync,
} from "./partner-catalog-sync";
import type { PartnerCatalogSyncPlan } from "./partner-catalog-sync-types";
import {
  emptyRuntimeApplyPayload,
  g3UnsupportedPublishOperations,
  persistableRuntimeApplyPayload,
  toRuntimeApplyPayload,
  type PartnerRuntimeApplyPayload,
} from "./partner-catalog-runtime-executor";
import {
  g4aUnsupportedPublishOperations,
  partnerRuntimePlanNeedsV2,
  toRuntimeApplyPayloadV2,
} from "./partner-catalog-runtime-executor-v2";
import { persistablePartnerPatchDocument } from "./partner-draft-mutations";
import {
  parsePartnerDraftTouchedBase,
  sortedMembershipProductIds,
  type PartnerDraftTouchedBase,
} from "./partner-draft-touched-base";
import type { PartnerPortalAuthResult } from "./partner-portal-auth";
import type { PartnerPortalCatalogLoadResult } from "./partner-portal-catalog";
import {
  partnerCatalogCommercialFingerprint,
  toPartnerDraftDto,
  type PartnerDraftRow,
  type PartnerDraftStore,
  type PartnerPortalDraftDto,
} from "./partner-portal-drafts";
import type { PartnerPortalHttpResponse } from "./partner-portal-http";
import {
  PARTNER_PUBLISH_MODE,
  PARTNER_PUBLISH_SOURCE,
  type PartnerPublishAuditStore,
} from "./partner-publish-audit";
import { asNonEmptyString, isPlainObject } from "./product-variant-register";
import type { StageCatalogSnapshot, StageCollection } from "./types";

export const STAGE_PARTNER_APPLY_RPC = "vibode_stage_apply_partner_patch";
export const STAGE_PARTNER_APPLY_RPC_V2 = "vibode_stage_apply_partner_patch_v2";

export const PARTNER_PUBLISH_REJECT_BODY_KEYS = Object.freeze([
  "partnerId",
  "userId",
  "actor",
  "document",
  "plan",
  "mutations",
  "sqlPlan",
] as const);

export type PartnerPublishConflict = Readonly<{
  entity: "product" | "variant" | "collection" | "catalog";
  id: string;
  field: string;
  expected: unknown;
  live: unknown;
}>;

export type PartnerRuntimeApplySuccess = Readonly<{
  ok: true;
  status: "accepted" | "noop";
  publishId: string;
  idempotent: boolean;
}>;

export type PartnerRuntimeApplyFailure = Readonly<{
  ok: false;
  errorCode: string;
  errorDetail?: unknown;
}>;

export type PartnerRuntimeApplyResult = PartnerRuntimeApplySuccess | PartnerRuntimeApplyFailure;

export type PartnerRuntimeApplyFn = (payload: Record<string, unknown>) => Promise<PartnerRuntimeApplyResult>;

const RPC_PREFIX = "VIBODE_STAGE_PUBLISH:";

function jsonError(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
): PartnerPortalHttpResponse {
  return { status, body: { ok: false, error, ...extra } };
}

function expectedRevisionFrom(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null;
  return value;
}

function sameTouchedValue(left: unknown, right: unknown): boolean {
  if (left == null && right == null) return true;
  return left === right;
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  const a = sortedMembershipProductIds(left);
  const b = sortedMembershipProductIds(right);
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

function findCollection(catalog: StageCatalogSnapshot, collectionId: string): StageCollection | null {
  return catalog.collections.find((item) => item.collectionId === collectionId) ?? null;
}

function sortConflicts(conflicts: PartnerPublishConflict[]): PartnerPublishConflict[] {
  const entityOrder = { product: 0, variant: 1, collection: 2, catalog: 3 };
  return [...conflicts].sort((left, right) => (
    entityOrder[left.entity] - entityOrder[right.entity]
    || left.id.localeCompare(right.id)
    || left.field.localeCompare(right.field)
  ));
}

export type PartnerPublishConflictCheck = Readonly<{
  conflicts: readonly PartnerPublishConflict[];
  missingCoverage: boolean;
}>;

export function detectPartnerPublishConflicts(input: Readonly<{
  touchedBase: PartnerDraftTouchedBase;
  catalog: StageCatalogSnapshot;
  plan: PartnerCatalogSyncPlan;
}>): PartnerPublishConflictCheck {
  const conflicts: PartnerPublishConflict[] = [];
  let missingCoverage = false;

  for (const update of input.plan.productUpdates) {
    const base = input.touchedBase.products[update.productId];
    for (const change of update.changes) {
      if (!base || !(change.column in base)) {
        missingCoverage = true;
        continue;
      }
      const expected = (base as Record<string, unknown>)[change.column];
      if (!sameTouchedValue(expected, change.previous)) {
        conflicts.push({
          entity: "product",
          id: update.productId,
          field: change.column,
          expected,
          live: change.previous,
        });
      }
    }
  }

  for (const update of input.plan.variantUpdates) {
    const base = input.touchedBase.variants[update.variantId];
    for (const change of update.changes) {
      if (!base || !(change.column in base)) {
        missingCoverage = true;
        continue;
      }
      const expected = (base as Record<string, unknown>)[change.column];
      if (!sameTouchedValue(expected, change.previous)) {
        conflicts.push({
          entity: "variant",
          id: update.variantId,
          field: change.column,
          expected,
          live: change.previous,
        });
      }
    }
  }

  for (const update of input.plan.collectionUpdates) {
    const base = input.touchedBase.collections[update.collectionId];
    if (!base || base.name === undefined) {
      missingCoverage = true;
    } else if (!sameTouchedValue(base.name, update.previousName)) {
      conflicts.push({
        entity: "collection",
        id: update.collectionId,
        field: "name",
        expected: base.name,
        live: update.previousName,
      });
    }
  }

  const membershipCollections = new Set([
    ...input.plan.membershipAdds.map((item) => item.collectionId),
    ...input.plan.membershipRemoves.map((item) => item.collectionId),
  ]);
  for (const collectionId of membershipCollections) {
    const base = input.touchedBase.collections[collectionId];
    const live = findCollection(input.catalog, collectionId);
    if (!base || base.membership_product_ids === undefined) {
      missingCoverage = true;
      continue;
    }
    const liveIds = live ? live.productIds : [];
    if (!sameIdSet(base.membership_product_ids, liveIds)) {
      conflicts.push({
        entity: "collection",
        id: collectionId,
        field: "membership_product_ids",
        expected: sortedMembershipProductIds(base.membership_product_ids),
        live: sortedMembershipProductIds(liveIds),
      });
    }
  }

  return { conflicts: sortConflicts(conflicts), missingCoverage };
}

export function parsePartnerPublishBody(body: unknown): Readonly<{
  ok: true;
  expectedDraftRevision: number;
}> | Readonly<{ ok: false; error: string }> {
  if (!isPlainObject(body)) return { ok: false, error: "Invalid publish request." };
  for (const key of PARTNER_PUBLISH_REJECT_BODY_KEYS) {
    if (key in body) return { ok: false, error: "Invalid publish request." };
  }
  const extra = Object.keys(body).filter((key) => key !== "expectedDraftRevision");
  if (extra.length > 0) return { ok: false, error: "Invalid publish request." };
  const expectedDraftRevision = expectedRevisionFrom(body.expectedDraftRevision);
  if (expectedDraftRevision == null) return { ok: false, error: "Invalid publish request." };
  return { ok: true, expectedDraftRevision };
}

export function parseRuntimeApplyRpcError(message: string | null | undefined): string | null {
  if (!message) return null;
  const index = message.indexOf(RPC_PREFIX);
  if (index < 0) return null;
  const rest = message.slice(index + RPC_PREFIX.length);
  const match = rest.match(/^([A-Z0-9_]+)/);
  return match?.[1] ?? null;
}

export function httpStatusForPublishErrorCode(code: string): number {
  switch (code) {
    case "DRAFT_NOT_FOUND":
    case "DRAFT_ABANDONED":
      return 404;
    case "DRAFT_REVISION_MISMATCH":
    case "DRAFT_PUBLISHED":
    case "STALE_SYNC":
    case "STALE_LIVE_FIELD":
    case "STALE_CATALOG_BASE":
    case "DUPLICATE_SKU":
    case "DUPLICATE_VARIANT_ID":
    case "PARENT_PRODUCT_MISMATCH":
    case "ASSET_NOT_READY":
    case "PARTNER_ASSET_UNASSOCIATED":
    case "COLLECTION_OWNER_MISMATCH":
    case "MEMBERSHIP_CONFLICT":
      return 409;
    case "UNSUPPORTED_PUBLISH_OPERATION":
    case "PLANNER_ISSUE":
    case "INVALID_DOCUMENT":
    case "INVALID_APPLY_PAYLOAD":
    case "UNSUPPORTED_COLUMN":
    case "PLAN_VERSION_UNSUPPORTED":
      return 400;
    default:
      return 500;
  }
}

export function merchantMessageForPublishErrorCode(code: string): string {
  switch (code) {
    case "DRAFT_NOT_FOUND":
    case "DRAFT_ABANDONED":
      return "Not found.";
    case "DRAFT_REVISION_MISMATCH":
      return "Draft revision is stale. Reload before publishing.";
    case "DRAFT_PUBLISHED":
      return "This draft is published and can no longer be changed.";
    case "STALE_SYNC":
      return "Live catalog changed while publishing. Reload and review before publishing.";
    case "STALE_LIVE_FIELD":
    case "STALE_CATALOG_BASE":
      return "Live catalog changed since this draft edit. Reload and review before publishing.";
    case "DUPLICATE_SKU":
      return "That SKU is already used by another variant for this partner.";
    case "DUPLICATE_VARIANT_ID":
      return "A variant with this identity already exists.";
    case "PARENT_PRODUCT_MISMATCH":
      return "The selected product is not available for this partner.";
    case "ASSET_NOT_READY":
    case "PARTNER_ASSET_UNASSOCIATED":
      return "The selected asset is not available for this partner.";
    case "UNSUPPORTED_PUBLISH_OPERATION":
      return "This draft includes catalog changes that cannot be published yet.";
    case "PLANNER_ISSUE":
    case "INVALID_DOCUMENT":
      return "This draft cannot be published until catalog issues are resolved.";
    case "COLLECTION_OWNER_MISMATCH":
      return "Collection membership could not be published.";
    default:
      return "Publish could not be completed.";
  }
}

function successBody(input: Readonly<{
  status: "accepted" | "noop";
  publishId: string;
  draft: PartnerPortalDraftDto;
  idempotent: boolean;
  prePublishCatalogHash: string;
  postPublishCatalogHash: string | null;
}>): PartnerPortalHttpResponse {
  return {
    status: 200,
    body: {
      ok: true,
      status: input.status,
      publishId: input.publishId,
      draftId: input.draft.draftId,
      draftRevision: input.draft.revision,
      idempotent: input.idempotent,
      prePublishCatalogHash: input.prePublishCatalogHash,
      postPublishCatalogHash: input.postPublishCatalogHash,
    },
  };
}

function plannerRejectBody(plan: PartnerCatalogSyncPlan, error: string, code: string): PartnerPortalHttpResponse {
  return {
    status: 400,
    body: {
      ...presentPartnerCatalogSyncPlan(plan),
      ok: false,
      error,
      code,
    },
  };
}

async function recordRejected(input: Readonly<{
  audit: PartnerPublishAuditStore;
  partnerId: string;
  userId: string;
  draftId: string;
  draftRevision: number;
  document: unknown;
  plan: unknown;
  errorCode: string;
  errorDetail: unknown;
  baseCatalogHash: string | null;
  prePublishCatalogHash: string | null;
}>): Promise<void> {
  await input.audit.insert({
    partnerId: input.partnerId,
    userId: input.userId,
    draftId: input.draftId,
    draftRevision: input.draftRevision,
    document: isPlainObject(input.document) ? input.document : {},
    plan: input.plan,
    status: "rejected",
    errorCode: input.errorCode,
    errorDetail: input.errorDetail,
    baseCatalogHash: input.baseCatalogHash,
    prePublishCatalogHash: input.prePublishCatalogHash,
  });
}

async function recordFailed(input: Readonly<{
  audit: PartnerPublishAuditStore;
  partnerId: string;
  userId: string;
  draftId: string;
  draftRevision: number;
  document: unknown;
  plan: unknown;
  errorCode: string;
  errorDetail: unknown;
  baseCatalogHash: string | null;
  prePublishCatalogHash: string | null;
}>): Promise<void> {
  await input.audit.insert({
    partnerId: input.partnerId,
    userId: input.userId,
    draftId: input.draftId,
    draftRevision: input.draftRevision,
    document: isPlainObject(input.document) ? input.document : {},
    plan: input.plan,
    status: "failed",
    errorCode: input.errorCode,
    errorDetail: input.errorDetail,
    baseCatalogHash: input.baseCatalogHash,
    prePublishCatalogHash: input.prePublishCatalogHash,
  });
}

function catalogUnavailable(): PartnerPortalHttpResponse {
  return jsonError(500, "Partner catalog could not be loaded.");
}

function draftCorrupt(): PartnerPortalHttpResponse {
  return jsonError(500, "Partner draft could not be loaded.");
}

function missingDraft(): PartnerPortalHttpResponse {
  return jsonError(404, "Not found.");
}

function staleDraft(): PartnerPortalHttpResponse {
  return jsonError(409, "Draft revision is stale. Reload before publishing.", { code: "STALE_DRAFT_REVISION" });
}

export function publishedDraftMutationResponse(): PartnerPortalHttpResponse {
  return jsonError(409, "This draft is published and can no longer be changed.", { code: "DRAFT_PUBLISHED" });
}

export function planPartnerPatchForPublish(input: Readonly<{
  catalog: StageCatalogSnapshot;
  partnerId: string;
  document: unknown;
  repoRoot?: string;
}>): Readonly<{
  parsed: ReturnType<typeof parsePartnerCatalogSyncJson>;
  plan: PartnerCatalogSyncPlan | null;
}> {
  const folded = foldedPartnerStateFromDurableCatalog(input.catalog, input.partnerId);
  if (!folded) {
    return {
      parsed: {
        ok: false,
        document: null,
        issues: [{ code: "PARTNER_MISMATCH", message: "Durable Partner catalog is missing." }],
      },
      plan: null,
    };
  }
  const stamped = isPlainObject(input.document)
    ? { ...input.document, partnerId: input.partnerId }
    : { partnerId: input.partnerId, mode: "patch" };
  const parsed = parsePartnerCatalogSyncJson(stamped);
  if (!parsed.ok) return { parsed, plan: null };
  const plan = planPartnerCatalogSync({
    current: folded,
    document: parsed.document,
    catalog: durableAssetCatalogForPlanning(input.catalog),
    seedAssets: input.catalog.assets,
    repoRoot: input.repoRoot,
  });
  return { parsed, plan };
}

export function createMemoryPartnerRuntimeApply(input: Readonly<{
  store: PartnerDraftStore & { rows: PartnerDraftRow[] };
  audit: PartnerPublishAuditStore;
  now?: () => string;
}>): PartnerRuntimeApplyFn {
  return async (payload) => {
    const partnerId = asNonEmptyString(payload.partnerId);
    const draftId = asNonEmptyString(payload.draftId);
    const draftRevision = expectedRevisionFrom(payload.draftRevision);
    const userId = asNonEmptyString(payload.userId);
    if (!partnerId || !draftId || draftRevision == null) {
      return { ok: false, errorCode: "INVALID_APPLY_PAYLOAD" };
    }
    const existing = await input.audit.findSuccessful(draftId, draftRevision);
    if (existing) {
      return {
        ok: true,
        status: existing.status === "noop" ? "noop" : "accepted",
        publishId: existing.publishId,
        idempotent: true,
      };
    }
    const row = input.store.rows.find((item) => item.draftId === draftId && item.partnerId === partnerId);
    if (!row) return { ok: false, errorCode: "DRAFT_NOT_FOUND" };
    if (row.status === "abandoned") return { ok: false, errorCode: "DRAFT_ABANDONED" };
    if (row.status === "published") return { ok: false, errorCode: "DRAFT_PUBLISHED" };
    if (row.status !== "open") return { ok: false, errorCode: "DRAFT_NOT_OPEN" };
    if (row.revision !== draftRevision) return { ok: false, errorCode: "DRAFT_REVISION_MISMATCH" };

    const productUpdates = Array.isArray(payload.productUpdates) ? payload.productUpdates : [];
    const variantUpdates = Array.isArray(payload.variantUpdates) ? payload.variantUpdates : [];
    const variantCreates = Array.isArray(payload.variantCreates) ? payload.variantCreates : [];
    const collectionUpdates = Array.isArray(payload.collectionUpdates) ? payload.collectionUpdates : [];
    const membershipAdds = Array.isArray(payload.membershipAdds) ? payload.membershipAdds : [];
    const membershipRemoves = Array.isArray(payload.membershipRemoves) ? payload.membershipRemoves : [];
    const isNoop = (
      productUpdates.length
      + variantUpdates.length
      + variantCreates.length
      + collectionUpdates.length
      + membershipAdds.length
      + membershipRemoves.length
    ) === 0;
    const status = isNoop ? "noop" : "accepted";
    const plan: Record<string, unknown> = {
      planVersion: payload.planVersion,
      partnerId,
      productUpdates,
      variantUpdates,
      collectionUpdates,
      membershipAdds,
      membershipRemoves,
    };
    if (payload.planVersion === 2 || variantCreates.length > 0) {
      plan.variantCreates = variantCreates;
    }
    const inserted = await input.audit.insert({
      partnerId,
      userId,
      draftId,
      draftRevision,
      document: payload.document,
      plan,
      status,
      baseCatalogHash: asNonEmptyString(payload.baseCatalogHash),
      prePublishCatalogHash: asNonEmptyString(payload.prePublishCatalogHash),
    });
    if (!inserted.ok) {
      if (inserted.code === "unique_conflict") {
        const raced = await input.audit.findSuccessful(draftId, draftRevision);
        if (raced) {
          return {
            ok: true,
            status: raced.status === "noop" ? "noop" : "accepted",
            publishId: raced.publishId,
            idempotent: true,
          };
        }
      }
      return { ok: false, errorCode: "FAILED" };
    }
    const index = input.store.rows.findIndex((item) => item.draftId === draftId);
    if (index < 0) return { ok: false, errorCode: "DRAFT_NOT_FOUND" };
    input.store.rows[index] = {
      ...input.store.rows[index]!,
      status: "published",
      updatedAt: input.now?.() ?? new Date().toISOString(),
    };
    return {
      ok: true,
      status,
      publishId: inserted.row.publishId,
      idempotent: false,
    };
  };
}

export async function publishPartnerPatchDraft(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerDraftStore;
  catalog: PartnerPortalCatalogLoadResult | null;
  audit: PartnerPublishAuditStore;
  apply: PartnerRuntimeApplyFn;
  draftId: string;
  body: unknown;
  reloadCatalog?: () => Promise<PartnerPortalCatalogLoadResult | null>;
  repoRoot?: string;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return jsonError(input.auth.status, input.auth.error);
  const parsedBody = parsePartnerPublishBody(input.body);
  if (!parsedBody.ok) return jsonError(400, parsedBody.error);
  const partnerId = input.auth.context.partnerId;
  const userId = input.auth.context.userId;
  const expectedDraftRevision = parsedBody.expectedDraftRevision;

  const existing = await input.store.findById(partnerId, input.draftId);
  if (!existing) return missingDraft();
  const dto = toPartnerDraftDto(existing, partnerId);
  if (!dto) return draftCorrupt();

  if (dto.status === "abandoned") return missingDraft();
  if (dto.status === "published") {
    const prior = await input.audit.findSuccessful(dto.draftId, expectedDraftRevision);
    if (prior && (prior.status === "accepted" || prior.status === "noop")) {
      const catalog = input.catalog && input.catalog.ok ? input.catalog.catalog : null;
      const hash = catalog ? partnerCatalogCommercialFingerprint(catalog) : dto.baseCatalogHash;
      return successBody({
        status: prior.status,
        publishId: prior.publishId,
        draft: dto,
        idempotent: true,
        prePublishCatalogHash: prior.prePublishCatalogHash ?? hash ?? "",
        postPublishCatalogHash: prior.postPublishCatalogHash ?? hash,
      });
    }
    return jsonError(409, "This draft is published and can no longer be changed.", { code: "DRAFT_PUBLISHED" });
  }
  if (dto.status !== "open") return missingDraft();
  if (dto.revision !== expectedDraftRevision) return staleDraft();

  if (!input.catalog || !input.catalog.ok) return catalogUnavailable();
  const catalog = input.catalog.catalog;
  const prePublishCatalogHash = partnerCatalogCommercialFingerprint(catalog);
  const touchedBase = parsePartnerDraftTouchedBase(existing.touchedBase);

  const planned = planPartnerPatchForPublish({
    catalog,
    partnerId,
    document: dto.document,
    repoRoot: input.repoRoot,
  });
  if (!planned.parsed.ok || !planned.plan) {
    const issues = planned.parsed.ok ? [] : planned.parsed.issues;
    await recordRejected({
      audit: input.audit,
      partnerId,
      userId,
      draftId: dto.draftId,
      draftRevision: dto.revision,
      document: persistablePartnerPatchDocument(dto.document),
      plan: null,
      errorCode: "INVALID_DOCUMENT",
      errorDetail: { issues },
      baseCatalogHash: dto.baseCatalogHash,
      prePublishCatalogHash,
    });
    return jsonError(400, merchantMessageForPublishErrorCode("INVALID_DOCUMENT"), {
      code: "INVALID_DOCUMENT",
      issues,
    });
  }

  const plan = planned.plan;
  if (!plan.ok || plan.issues.length > 0) {
    await recordRejected({
      audit: input.audit,
      partnerId,
      userId,
      draftId: dto.draftId,
      draftRevision: dto.revision,
      document: persistablePartnerPatchDocument(dto.document),
      plan: presentPartnerCatalogSyncPlan(plan),
      errorCode: "PLANNER_ISSUE",
      errorDetail: { issues: plan.issues },
      baseCatalogHash: dto.baseCatalogHash,
      prePublishCatalogHash,
    });
    return plannerRejectBody(plan, merchantMessageForPublishErrorCode("PLANNER_ISSUE"), "PLANNER_ISSUE");
  }

  const unsupported = partnerRuntimePlanNeedsV2(plan)
    ? g4aUnsupportedPublishOperations(plan)
    : g3UnsupportedPublishOperations(plan);
  if (unsupported.length > 0) {
    await recordRejected({
      audit: input.audit,
      partnerId,
      userId,
      draftId: dto.draftId,
      draftRevision: dto.revision,
      document: persistablePartnerPatchDocument(dto.document),
      plan: presentPartnerCatalogSyncPlan(plan),
      errorCode: "UNSUPPORTED_PUBLISH_OPERATION",
      errorDetail: { operations: unsupported },
      baseCatalogHash: dto.baseCatalogHash,
      prePublishCatalogHash,
    });
    return jsonError(400, merchantMessageForPublishErrorCode("UNSUPPORTED_PUBLISH_OPERATION"), {
      code: "UNSUPPORTED_PUBLISH_OPERATION",
      operations: unsupported,
    });
  }

  const conflictCheck = detectPartnerPublishConflicts({
    touchedBase,
    catalog,
    plan,
  });
  if (conflictCheck.conflicts.length > 0) {
    await recordRejected({
      audit: input.audit,
      partnerId,
      userId,
      draftId: dto.draftId,
      draftRevision: dto.revision,
      document: persistablePartnerPatchDocument(dto.document),
      plan: presentPartnerCatalogSyncPlan(plan),
      errorCode: "STALE_LIVE_FIELD",
      errorDetail: { conflicts: conflictCheck.conflicts },
      baseCatalogHash: dto.baseCatalogHash,
      prePublishCatalogHash,
    });
    return jsonError(409, merchantMessageForPublishErrorCode("STALE_LIVE_FIELD"), {
      code: "STALE_LIVE_FIELD",
      conflicts: conflictCheck.conflicts,
    });
  }
  if (conflictCheck.missingCoverage && prePublishCatalogHash !== dto.baseCatalogHash) {
    const coarse: PartnerPublishConflict = {
      entity: "catalog",
      id: partnerId,
      field: "base_catalog_hash",
      expected: dto.baseCatalogHash,
      live: prePublishCatalogHash,
    };
    await recordRejected({
      audit: input.audit,
      partnerId,
      userId,
      draftId: dto.draftId,
      draftRevision: dto.revision,
      document: persistablePartnerPatchDocument(dto.document),
      plan: presentPartnerCatalogSyncPlan(plan),
      errorCode: "STALE_CATALOG_BASE",
      errorDetail: { conflicts: [coarse] },
      baseCatalogHash: dto.baseCatalogHash,
      prePublishCatalogHash,
    });
    return jsonError(409, merchantMessageForPublishErrorCode("STALE_CATALOG_BASE"), {
      code: "STALE_CATALOG_BASE",
      conflicts: [coarse],
    });
  }

  const serialized = plan.noOp
    ? { ok: true as const, payload: emptyRuntimeApplyPayload(partnerId) }
    : partnerRuntimePlanNeedsV2(plan)
      ? toRuntimeApplyPayloadV2(plan)
      : toRuntimeApplyPayload(plan);
  if (!serialized.ok) {
    await recordRejected({
      audit: input.audit,
      partnerId,
      userId,
      draftId: dto.draftId,
      draftRevision: dto.revision,
      document: persistablePartnerPatchDocument(dto.document),
      plan: presentPartnerCatalogSyncPlan(plan),
      errorCode: serialized.error.code,
      errorDetail: { operations: serialized.error.operations },
      baseCatalogHash: dto.baseCatalogHash,
      prePublishCatalogHash,
    });
    return jsonError(400, serialized.error.message, {
      code: serialized.error.code,
      operations: serialized.error.operations,
    });
  }

  const applyPayload: Record<string, unknown> = {
    ...persistableRuntimeApplyPayload(serialized.payload),
    userId,
    draftId: dto.draftId,
    draftRevision: dto.revision,
    source: PARTNER_PUBLISH_SOURCE,
    mode: PARTNER_PUBLISH_MODE,
    document: persistablePartnerPatchDocument(dto.document),
    baseCatalogHash: dto.baseCatalogHash,
    prePublishCatalogHash,
  };

  const applied = await input.apply(applyPayload);
  if (!applied.ok) {
    const code = applied.errorCode || "FAILED";
    await recordFailed({
      audit: input.audit,
      partnerId,
      userId,
      draftId: dto.draftId,
      draftRevision: dto.revision,
      document: persistablePartnerPatchDocument(dto.document),
      plan: persistableRuntimeApplyPayload(serialized.payload),
      errorCode: code,
      errorDetail: { code },
      baseCatalogHash: dto.baseCatalogHash,
      prePublishCatalogHash,
    });
    const status = httpStatusForPublishErrorCode(code);
    return jsonError(status, merchantMessageForPublishErrorCode(code), { code });
  }

  const reloaded = input.reloadCatalog ? await input.reloadCatalog() : input.catalog;
  const postCatalog = reloaded && reloaded.ok ? reloaded.catalog : catalog;
  const postPublishCatalogHash = partnerCatalogCommercialFingerprint(postCatalog);
  const published = await input.store.findById(partnerId, dto.draftId);
  const publishedDto = published ? toPartnerDraftDto(published, partnerId) : dto;

  return successBody({
    status: applied.status,
    publishId: applied.publishId,
    draft: publishedDto ?? dto,
    idempotent: applied.idempotent,
    prePublishCatalogHash,
    postPublishCatalogHash,
  });
}

export function runtimeApplyEnvelope(
  payload: PartnerRuntimeApplyPayload,
  extra: Readonly<{
    userId: string | null;
    draftId: string;
    draftRevision: number;
    document: unknown;
    baseCatalogHash: string | null;
    prePublishCatalogHash: string;
  }>,
): Record<string, unknown> {
  return {
    ...persistableRuntimeApplyPayload(payload),
    userId: extra.userId,
    draftId: extra.draftId,
    draftRevision: extra.draftRevision,
    source: PARTNER_PUBLISH_SOURCE,
    mode: PARTNER_PUBLISH_MODE,
    document: extra.document,
    baseCatalogHash: extra.baseCatalogHash,
    prePublishCatalogHash: extra.prePublishCatalogHash,
  };
}

export function sanitizePublishFailureDetail(code: string): Readonly<{ code: string }> {
  return { code };
}
