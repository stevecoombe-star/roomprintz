import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type { SupabaseClient } from "@supabase/supabase-js";

import { extraCommercialAssetIdsForDraft } from "./partner-draft-mutations";
import { resolvePartnerPortalContext } from "./partner-portal-auth.server";
import { loadAuthorizedPartnerPortalCatalog } from "./partner-portal-catalog.server";
import { loadPartnerCommercialAssetsForPortal } from "./partner-commercial-assets.server";
import { previewPartnerCatalogFromDurable } from "./partner-catalog-preview";
import type { PartnerPortalHttpResponse } from "./partner-portal-http";
import {
  getOpenPartnerPatchDraft,
  getOrCreatePartnerPatchDraft,
  getPartnerDraft,
  mapPartnerDraftRow,
  mutatePartnerDraft,
  previewPersistedPartnerDraft,
  STAGE_PARTNER_DRAFTS_TABLE,
  type PartnerDraftRow,
  type PartnerDraftStore,
  type PartnerPortalDraftDto,
  toPartnerDraftDto,
} from "./partner-portal-drafts";

const DRAFT_SELECT =
  "draft_id, partner_id, created_by_user_id, updated_by_user_id, document_kind, document, status, revision, base_catalog_hash, touched_base, created_at, updated_at";

function isUniqueConflict(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

function createSupabasePartnerDraftStore(supabase: SupabaseClient): PartnerDraftStore {
  return {
    async findOpenPatch(partnerId) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_DRAFTS_TABLE)
        .select(DRAFT_SELECT)
        .eq("partner_id", partnerId)
        .eq("status", "open")
        .eq("document_kind", "patch")
        .maybeSingle();
      if (error || !data) return null;
      return mapPartnerDraftRow(data as Record<string, unknown>);
    },
    async findById(partnerId, draftId) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_DRAFTS_TABLE)
        .select(DRAFT_SELECT)
        .eq("partner_id", partnerId)
        .eq("draft_id", draftId)
        .maybeSingle();
      if (error || !data) return null;
      return mapPartnerDraftRow(data as Record<string, unknown>);
    },
    async insertOpenPatch(row) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_DRAFTS_TABLE)
        .insert({
          draft_id: row.draftId,
          partner_id: row.partnerId,
          created_by_user_id: row.createdByUserId,
          updated_by_user_id: row.updatedByUserId,
          document_kind: row.documentKind,
          document: row.document,
          status: row.status,
          revision: row.revision,
          base_catalog_hash: row.baseCatalogHash,
          touched_base: row.touchedBase ?? {},
        })
        .select(DRAFT_SELECT)
        .maybeSingle();
      if (isUniqueConflict(error)) return { ok: false, code: "unique_conflict" };
      if (error || !data) return { ok: false, code: "failed" };
      const mapped = mapPartnerDraftRow(data as Record<string, unknown>);
      if (!mapped) return { ok: false, code: "failed" };
      return { ok: true, row: mapped };
    },
    async updateOpenPatch(input) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_DRAFTS_TABLE)
        .update({
          document: input.document,
          revision: input.expectedRevision + 1,
          updated_by_user_id: input.updatedByUserId,
          base_catalog_hash: input.baseCatalogHash,
          touched_base: input.touchedBase ?? {},
          status: input.status,
        })
        .eq("draft_id", input.draftId)
        .eq("partner_id", input.partnerId)
        .eq("status", "open")
        .eq("revision", input.expectedRevision)
        .select(DRAFT_SELECT)
        .maybeSingle();
      if (error) return { ok: false, code: "failed" };
      if (!data) return { ok: false, code: "no_row" };
      const mapped = mapPartnerDraftRow(data as Record<string, unknown>);
      if (!mapped) return { ok: false, code: "failed" };
      return { ok: true, row: mapped };
    },
  };
}

async function partnerDraftStore(): Promise<PartnerDraftStore | null> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return null;
  return createSupabasePartnerDraftStore(supabase);
}

export async function loadPartnerPortalDraftStore(): Promise<PartnerDraftStore | null> {
  return partnerDraftStore();
}

function unavailable(): PartnerPortalHttpResponse {
  return { status: 500, body: { ok: false, error: "Partner Portal is unavailable." } };
}

export async function partnerPortalDraftGetOrCreateResponse(): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const store = await partnerDraftStore();
  if (!store) {
    if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error } };
    return unavailable();
  }
  const catalog = auth.ok ? await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId) : null;
  return getOrCreatePartnerPatchDraft({ auth, store, catalog });
}

export async function partnerPortalDraftGetResponse(draftId: string): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const store = await partnerDraftStore();
  if (!store) {
    if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error } };
    return unavailable();
  }
  return getPartnerDraft({ auth, store, draftId });
}

export async function partnerPortalDraftMutateResponse(
  draftId: string,
  body: unknown,
): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const store = await partnerDraftStore();
  if (!store) {
    if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error } };
    return unavailable();
  }
  const catalog = auth.ok ? await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId) : null;
  let commercialAssetIds: ReadonlySet<string> | undefined;
  if (auth.ok && catalog?.ok) {
    const commercial = await loadPartnerCommercialAssetsForPortal(auth.context.partnerId, catalog.catalog);
    if (!commercial.ok) return unavailable();
    commercialAssetIds = new Set(commercial.options.map((item) => item.assetId));
  }
  return mutatePartnerDraft({ auth, store, catalog, draftId, body, commercialAssetIds });
}

export async function partnerPortalDraftPreviewResponse(
  draftId: string,
  body: unknown,
): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const store = await partnerDraftStore();
  if (!store) {
    if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error } };
    return unavailable();
  }
  const catalog = auth.ok ? await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId) : null;
  if (!auth.ok || !catalog?.ok) {
    return previewPersistedPartnerDraft({ auth, store, catalog, draftId, body });
  }
  const row = await store.findById(auth.context.partnerId, draftId);
  const dto = row ? toPartnerDraftDto(row, auth.context.partnerId) : null;
  const extraIds = dto ? extraCommercialAssetIdsForDraft(dto.document, catalog.catalog) : [];
  const commercial = await loadPartnerCommercialAssetsForPortal(auth.context.partnerId, catalog.catalog, extraIds);
  if (!commercial.ok) return unavailable();
  return previewPersistedPartnerDraft({
    auth,
    store,
    catalog,
    draftId,
    body,
    preview: (nextCatalog, partnerId, document) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document,
      commercialEligibility: commercial.context,
    }),
  });
}

export async function loadOpenPartnerPortalDraft(
  partnerId: string,
): Promise<PartnerPortalDraftDto | null> {
  const store = await partnerDraftStore();
  if (!store) return null;
  const row = await store.findOpenPatch(partnerId);
  if (!row) return null;
  return toPartnerDraftDto(row, partnerId);
}

export async function loadPartnerPortalDraft(
  partnerId: string,
  draftId: string,
): Promise<PartnerDraftRow | null> {
  const store = await partnerDraftStore();
  if (!store) return null;
  return store.findById(partnerId, draftId);
}

export async function partnerPortalOpenDraftResponse(): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const store = await partnerDraftStore();
  if (!store) {
    if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error } };
    return unavailable();
  }
  return getOpenPartnerPatchDraft({ auth, store });
}
