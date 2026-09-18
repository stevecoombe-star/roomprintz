/**
 * PI-5G2 Partner-owned persistent patch drafts.
 *
 * Draft belongs to the Partner, not the creating user. Authorization is
 * G1 membership → server-derived partnerId. Optimistic integer revision
 * is the concurrency token. Abandoned drafts remain readable for
 * diagnostics and are previewable, but the merchant UI does not expose them.
 *
 * Zero live Product / Variant / Collection / Partner / Asset / Scene writes.
 */

import { createHash, randomUUID } from "node:crypto";

import {
  previewPartnerCatalogFromDurable,
  type PartnerCatalogPreviewResult,
} from "./partner-catalog-preview";
import type { PartnerCatalogSyncDocument } from "./partner-catalog-sync";
import type { PartnerPortalAuthResult } from "./partner-portal-auth";
import type { PartnerPortalCatalogLoadResult } from "./partner-portal-catalog";
import type { PartnerPortalHttpResponse } from "./partner-portal-http";
import {
  applyPartnerDraftMutations,
  countPartnerDraftOperations,
  emptyPartnerPatchDocument,
  parsePartnerDraftMutations,
  parsePersistedPartnerPatchDocument,
  partnerDraftJsonByteLength,
  persistablePartnerPatchDocument,
  PARTNER_DRAFT_MAX_JSON_BYTES,
  PARTNER_DRAFT_MAX_OPERATIONS,
} from "./partner-draft-mutations";
import {
  emptyPartnerDraftTouchedBase,
  nextPartnerDraftTouchedBase,
  parsePartnerDraftTouchedBase,
  persistablePartnerDraftTouchedBase,
  type PartnerDraftTouchedBase,
} from "./partner-draft-touched-base";
import { asNonEmptyString, isPlainObject } from "./product-variant-register";
import type { StageCatalogSnapshot } from "./types";

export const STAGE_PARTNER_DRAFTS_TABLE = "vibode_stage_partner_drafts";
export const PARTNER_DRAFT_DOCUMENT_KIND = "patch";
export const PARTNER_DRAFT_STATUSES = Object.freeze(["open", "abandoned", "published"] as const);

export type PartnerDraftStatus = (typeof PARTNER_DRAFT_STATUSES)[number];

export type PartnerPortalDraftDto = Readonly<{
  draftId: string;
  partnerId: string;
  documentKind: "patch";
  status: PartnerDraftStatus;
  revision: number;
  baseCatalogHash: string | null;
  touchedBase: PartnerDraftTouchedBase;
  document: PartnerCatalogSyncDocument;
  createdAt: string;
  updatedAt: string;
}>;

export type PartnerDraftRow = Readonly<{
  draftId: string;
  partnerId: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  documentKind: "patch";
  document: unknown;
  status: PartnerDraftStatus;
  revision: number;
  baseCatalogHash: string | null;
  touchedBase: unknown;
  createdAt: string;
  updatedAt: string;
}>;

export type PartnerDraftStore = Readonly<{
  findOpenPatch(partnerId: string): Promise<PartnerDraftRow | null>;
  findById(partnerId: string, draftId: string): Promise<PartnerDraftRow | null>;
  insertOpenPatch(
    row: PartnerDraftRow,
  ): Promise<Readonly<{ ok: true; row: PartnerDraftRow }> | Readonly<{ ok: false; code: "unique_conflict" | "failed" }>>;
  updateOpenPatch(input: Readonly<{
    draftId: string;
    partnerId: string;
    expectedRevision: number;
    document: unknown;
    status: PartnerDraftStatus;
    updatedByUserId: string;
    baseCatalogHash: string | null;
    touchedBase: unknown;
    updatedAt: string;
  }>): Promise<
    Readonly<{ ok: true; row: PartnerDraftRow }> | Readonly<{ ok: false; code: "no_row" | "failed" }>
  >;
}>;

function jsonError(status: number, error: string): PartnerPortalHttpResponse {
  return { status, body: { ok: false, error } };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) continue;
      next[key] = stableValue(item);
    }
    return next;
  }
  return value;
}

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sortIds<T>(items: readonly T[], id: (item: T) => string): T[] {
  return [...items].sort((left, right) => id(left).localeCompare(id(right)));
}

export function partnerCatalogCommercialFingerprint(catalog: StageCatalogSnapshot): string {
  const payload = {
    partners: sortIds(catalog.partners, (item) => item.partnerId).map((partner) => ({
      partnerId: partner.partnerId,
      name: partner.name,
      slug: partner.slug,
      status: partner.status,
    })),
    products: sortIds(catalog.products, (item) => item.productId).map((product) => ({
      productId: product.productId,
      name: product.name,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      priceAmount: product.priceAmount,
      priceCurrency: product.priceCurrency,
      categoryId: product.categoryId,
      subcategoryId: product.subcategoryId,
      defaultVariantId: product.defaultVariantId,
      brand: product.brand,
      retailer: product.retailer,
      partnerId: product.partnerId,
      source: product.source,
      status: product.status ?? "active",
      collectionIds: [...product.collectionIds].sort((left, right) => left.localeCompare(right)),
    })),
    variants: sortIds(catalog.variants, (item) => item.variantId).map((variant) => ({
      variantId: variant.variantId,
      productId: variant.productId,
      finishLabel: variant.finishLabel,
      sku: variant.sku,
      priceAmount: variant.priceAmount,
      priceCurrency: variant.priceCurrency,
      productUrl: variant.productUrl,
      status: variant.status ?? "active",
      currentAssetId: variant.assetId,
    })),
    collections: sortIds(catalog.collections, (item) => item.collectionId).map((collection) => ({
      collectionId: collection.collectionId,
      name: collection.name,
      owner: collection.owner,
      partnerId: collection.partnerId,
      productIds: [...collection.productIds].sort((left, right) => left.localeCompare(right)),
    })),
  };
  return sha256Utf8(JSON.stringify(stableValue(payload)));
}

function isoNow(): string {
  return new Date().toISOString();
}

function asDraftStatus(value: unknown): PartnerDraftStatus | null {
  return value === "open" || value === "abandoned" || value === "published" ? value : null;
}

function asRevision(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  return null;
}

export function toPartnerDraftDto(
  row: PartnerDraftRow,
  partnerId: string,
): PartnerPortalDraftDto | null {
  if (row.partnerId !== partnerId) return null;
  if (row.documentKind !== "patch") return null;
  const document = parsePersistedPartnerPatchDocument(row.document, partnerId);
  if (!document) return null;
  return {
    draftId: row.draftId,
    partnerId: row.partnerId,
    documentKind: "patch",
    status: row.status,
    revision: row.revision,
    baseCatalogHash: row.baseCatalogHash,
    touchedBase: parsePartnerDraftTouchedBase(row.touchedBase),
    document,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializePartnerDraftDto(dto: PartnerPortalDraftDto): Readonly<{
  ok: true;
  draft: PartnerPortalDraftDto;
}> {
  return { ok: true, draft: dto };
}

export function createMemoryPartnerDraftStore(options: Readonly<{
  now?: () => string;
}> = {}): PartnerDraftStore & { rows: PartnerDraftRow[] } {
  const rows: PartnerDraftRow[] = [];
  const now = options.now ?? isoNow;
  return {
    rows,
    async findOpenPatch(partnerId) {
      return rows.find((row) => (
        row.partnerId === partnerId && row.status === "open" && row.documentKind === "patch"
      )) ?? null;
    },
    async findById(partnerId, draftId) {
      return rows.find((row) => row.partnerId === partnerId && row.draftId === draftId) ?? null;
    },
    async insertOpenPatch(row) {
      if (row.status === "open" && row.documentKind === "patch") {
        const exists = rows.some((item) => (
          item.partnerId === row.partnerId
          && item.status === "open"
          && item.documentKind === "patch"
        ));
        if (exists) return { ok: false, code: "unique_conflict" };
      }
      if (rows.some((item) => item.draftId === row.draftId)) return { ok: false, code: "failed" };
      const stored: PartnerDraftRow = { ...row, createdAt: row.createdAt || now(), updatedAt: row.updatedAt || now() };
      rows.push(stored);
      return { ok: true, row: { ...stored } };
    },
    async updateOpenPatch(input) {
      const index = rows.findIndex((row) => (
        row.draftId === input.draftId
        && row.partnerId === input.partnerId
        && row.status === "open"
        && row.revision === input.expectedRevision
      ));
      if (index < 0) return { ok: false, code: "no_row" };
      const current = rows[index]!;
      const next: PartnerDraftRow = {
        ...current,
        document: input.document,
        status: input.status,
        revision: current.revision + 1,
        updatedByUserId: input.updatedByUserId,
        baseCatalogHash: input.baseCatalogHash,
        touchedBase: input.touchedBase,
        updatedAt: input.updatedAt,
      };
      rows[index] = next;
      return { ok: true, row: { ...next } };
    },
  };
}

function dtoResponse(status: number, dto: PartnerPortalDraftDto): PartnerPortalHttpResponse {
  return { status, body: serializePartnerDraftDto(dto) };
}

function missingDraft(): PartnerPortalHttpResponse {
  return jsonError(404, "Not found.");
}

function staleDraft(): PartnerPortalHttpResponse {
  return jsonError(409, "Draft revision is stale. Reload before saving.");
}

function catalogUnavailable(): PartnerPortalHttpResponse {
  return jsonError(500, "Partner catalog could not be loaded.");
}

function draftCorrupt(): PartnerPortalHttpResponse {
  return jsonError(500, "Partner draft could not be loaded.");
}

function scopedCatalog(
  catalog: PartnerPortalCatalogLoadResult | null,
): StageCatalogSnapshot | null {
  if (!catalog || !catalog.ok) return null;
  return catalog.catalog;
}

function expectedRevisionFrom(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null;
  return value;
}

export async function getOrCreatePartnerPatchDraft(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerDraftStore;
  catalog: PartnerPortalCatalogLoadResult | null;
  now?: string;
  draftId?: string;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return jsonError(input.auth.status, input.auth.error);
  const partnerId = input.auth.context.partnerId;
  const existing = await input.store.findOpenPatch(partnerId);
  if (existing) {
    const dto = toPartnerDraftDto(existing, partnerId);
    if (!dto) return draftCorrupt();
    return dtoResponse(200, dto);
  }
  const catalog = scopedCatalog(input.catalog);
  if (!catalog) return catalogUnavailable();
  const document = emptyPartnerPatchDocument(partnerId);
  const now = input.now ?? isoNow();
  const inserted = await input.store.insertOpenPatch({
    draftId: input.draftId ?? randomUUID(),
    partnerId,
    createdByUserId: input.auth.context.userId,
    updatedByUserId: input.auth.context.userId,
    documentKind: "patch",
    document: persistablePartnerPatchDocument(document),
    status: "open",
    revision: 1,
    baseCatalogHash: partnerCatalogCommercialFingerprint(catalog),
    touchedBase: persistablePartnerDraftTouchedBase(emptyPartnerDraftTouchedBase()),
    createdAt: now,
    updatedAt: now,
  });
  if (!inserted.ok) {
    if (inserted.code === "unique_conflict") {
      const raced = await input.store.findOpenPatch(partnerId);
      if (!raced) return jsonError(500, "Partner draft could not be loaded.");
      const dto = toPartnerDraftDto(raced, partnerId);
      if (!dto) return draftCorrupt();
      return dtoResponse(200, dto);
    }
    return jsonError(500, "Partner draft could not be saved.");
  }
  const dto = toPartnerDraftDto(inserted.row, partnerId);
  if (!dto) return draftCorrupt();
  return dtoResponse(201, dto);
}

export async function getPartnerDraft(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerDraftStore;
  draftId: string;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return jsonError(input.auth.status, input.auth.error);
  const row = await input.store.findById(input.auth.context.partnerId, input.draftId);
  if (!row) return missingDraft();
  const dto = toPartnerDraftDto(row, input.auth.context.partnerId);
  if (!dto) return draftCorrupt();
  return dtoResponse(200, dto);
}

export async function getOpenPartnerPatchDraft(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerDraftStore;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return jsonError(input.auth.status, input.auth.error);
  const row = await input.store.findOpenPatch(input.auth.context.partnerId);
  if (!row) return { status: 200, body: { ok: true, draft: null } };
  const dto = toPartnerDraftDto(row, input.auth.context.partnerId);
  if (!dto) return draftCorrupt();
  return dtoResponse(200, dto);
}

function mutationStatusCode(code: "invalid_mutation" | "unknown_id" | "forbidden" | "invalid_document"): number {
  if (code === "forbidden") return 400;
  if (code === "unknown_id") return 400;
  return 400;
}

export async function mutatePartnerDraft(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerDraftStore;
  catalog: PartnerPortalCatalogLoadResult | null;
  draftId: string;
  body: unknown;
  now?: string;
  commercialAssetIds?: ReadonlySet<string>;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return jsonError(input.auth.status, input.auth.error);
  const partnerId = input.auth.context.partnerId;
  if (!isPlainObject(input.body)) return jsonError(400, "Invalid draft mutation.");
  const expectedRevision = expectedRevisionFrom(input.body.expectedRevision);
  if (expectedRevision == null) return jsonError(400, "Invalid draft mutation.");

  const wantsAbandon = input.body.status === "abandoned";
  const hasMutations = "mutations" in input.body;
  if (wantsAbandon && hasMutations) return jsonError(400, "Invalid draft mutation.");
  if (!wantsAbandon && !hasMutations) return jsonError(400, "Invalid draft mutation.");
  if (wantsAbandon) {
    const extra = Object.keys(input.body).filter((key) => !["expectedRevision", "status"].includes(key));
    if (extra.length > 0) return jsonError(400, "Invalid draft mutation.");
  }
  if ("document" in input.body) return jsonError(400, "Invalid draft mutation.");

  const existing = await input.store.findById(partnerId, input.draftId);
  if (!existing) return missingDraft();
  const current = toPartnerDraftDto(existing, partnerId);
  if (!current) return draftCorrupt();
  if (current.status === "published") {
    return {
      status: 409,
      body: {
        ok: false,
        error: "This draft is published and can no longer be changed.",
        code: "DRAFT_PUBLISHED",
      },
    };
  }
  if (current.status !== "open") return missingDraft();

  let nextDocument = current.document;
  let nextStatus: PartnerDraftStatus = "open";
  let nextHash = current.baseCatalogHash;
  let nextTouchedBase = current.touchedBase;
  if (wantsAbandon) {
    nextStatus = "abandoned";
  } else {
    const catalog = scopedCatalog(input.catalog);
    if (!catalog) return catalogUnavailable();
    const parsed = parsePartnerDraftMutations(input.body.mutations);
    if (!parsed.ok) {
      return jsonError(mutationStatusCode(parsed.code), parsed.error);
    }
    const applied = applyPartnerDraftMutations(
      current.document,
      catalog,
      parsed.mutations,
      partnerId,
      input.commercialAssetIds ? { commercialAssetIds: input.commercialAssetIds } : undefined,
    );
    if (!applied.ok) {
      return jsonError(mutationStatusCode(applied.code), applied.error);
    }
    nextDocument = applied.document;
    nextTouchedBase = nextPartnerDraftTouchedBase({
      previous: current.touchedBase,
      nextDocument: applied.document,
      catalog,
    });
    const operations = countPartnerDraftOperations(nextDocument);
    if (operations > PARTNER_DRAFT_MAX_OPERATIONS) {
      return jsonError(413, "Draft is too large.");
    }
    const bytes = partnerDraftJsonByteLength(persistablePartnerPatchDocument(nextDocument));
    if (bytes > PARTNER_DRAFT_MAX_JSON_BYTES) {
      return jsonError(413, "Draft is too large.");
    }
    nextHash = partnerCatalogCommercialFingerprint(catalog);
  }

  const updated = await input.store.updateOpenPatch({
    draftId: input.draftId,
    partnerId,
    expectedRevision,
    document: persistablePartnerPatchDocument(nextDocument),
    status: nextStatus,
    updatedByUserId: input.auth.context.userId,
    baseCatalogHash: nextHash,
    touchedBase: persistablePartnerDraftTouchedBase(nextTouchedBase),
    updatedAt: input.now ?? isoNow(),
  });
  if (updated.ok) {
    const dto = toPartnerDraftDto(updated.row, partnerId);
    if (!dto) return draftCorrupt();
    return dtoResponse(200, dto);
  }
  if (updated.code === "failed") return jsonError(500, "Partner draft could not be saved.");
  const latest = await input.store.findById(partnerId, input.draftId);
  if (!latest || latest.status !== "open") return missingDraft();
  if (latest.revision !== expectedRevision) return staleDraft();
  return staleDraft();
}

function previewRejectsReplacement(body: unknown): boolean {
  if (!isPlainObject(body)) return false;
  return "document" in body || "mutations" in body || "status" in body;
}

export async function previewPersistedPartnerDraft(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerDraftStore;
  catalog: PartnerPortalCatalogLoadResult | null;
  draftId: string;
  body: unknown;
  preview?: (
    catalog: StageCatalogSnapshot,
    partnerId: string,
    document: unknown,
  ) => PartnerCatalogPreviewResult;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return jsonError(input.auth.status, input.auth.error);
  if (previewRejectsReplacement(input.body)) {
    return jsonError(400, "Preview uses the persisted draft.");
  }
  const partnerId = input.auth.context.partnerId;
  const row = await input.store.findById(partnerId, input.draftId);
  if (!row) return missingDraft();
  const dto = toPartnerDraftDto(row, partnerId);
  if (!dto) return draftCorrupt();
  if (isPlainObject(input.body) && "expectedRevision" in input.body) {
    const expectedRevision = expectedRevisionFrom(input.body.expectedRevision);
    if (expectedRevision == null) return jsonError(400, "Invalid draft mutation.");
    if (expectedRevision !== dto.revision) return staleDraft();
  }
  const catalog = scopedCatalog(input.catalog);
  if (!catalog) return catalogUnavailable();
  const preview = input.preview ?? ((nextCatalog, nextPartnerId, document) => (
    previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId: nextPartnerId,
      document,
    })
  ));
  const result = preview(catalog, partnerId, dto.document);
  if (result.kind === "invalid_document") {
    return { status: 400, body: result.dto };
  }
  return { status: 200, body: result.dto };
}

export function mapPartnerDraftRow(row: Record<string, unknown>): PartnerDraftRow | null {
  const draftId = asNonEmptyString(row.draft_id);
  const partnerId = asNonEmptyString(row.partner_id);
  const documentKind = asNonEmptyString(row.document_kind);
  const status = asDraftStatus(row.status);
  const revision = asRevision(row.revision);
  const createdAt = asNonEmptyString(row.created_at) ?? (row.created_at instanceof Date ? row.created_at.toISOString() : null);
  const updatedAt = asNonEmptyString(row.updated_at) ?? (row.updated_at instanceof Date ? row.updated_at.toISOString() : null);
  if (!draftId || !partnerId || documentKind !== "patch" || !status || revision == null || revision < 1 || !createdAt || !updatedAt) {
    return null;
  }
  return {
    draftId,
    partnerId,
    createdByUserId: asNonEmptyString(row.created_by_user_id),
    updatedByUserId: asNonEmptyString(row.updated_by_user_id),
    documentKind: "patch",
    document: row.document,
    status,
    revision,
    baseCatalogHash: asNonEmptyString(row.base_catalog_hash),
    touchedBase: row.touched_base ?? {},
    createdAt,
    updatedAt,
  };
}
