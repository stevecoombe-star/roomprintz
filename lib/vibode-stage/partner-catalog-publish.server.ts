import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import { publishPartnerPatchDraft } from "./partner-catalog-publish";
import {
  createSupabasePartnerPublishAuditStore,
  createSupabasePartnerRuntimeApply,
} from "./partner-catalog-runtime-executor.server";
import { resolvePartnerPortalContext } from "./partner-portal-auth.server";
import { loadAuthorizedPartnerPortalCatalog } from "./partner-portal-catalog.server";
import { loadPartnerPortalDraftStore } from "./partner-portal-drafts.server";
import type { PartnerPortalHttpResponse } from "./partner-portal-http";

function unavailable(): PartnerPortalHttpResponse {
  return { status: 500, body: { ok: false, error: "Partner Portal is unavailable." } };
}

export async function partnerPortalDraftPublishResponse(
  draftId: string,
  body: unknown,
): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const supabase = getServiceRoleSupabaseClient();
  const store = await loadPartnerPortalDraftStore();
  if (!supabase || !store) {
    if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error } };
    return unavailable();
  }
  const partnerId = auth.ok ? auth.context.partnerId : null;
  const catalog = partnerId ? await loadAuthorizedPartnerPortalCatalog(partnerId) : null;
  return publishPartnerPatchDraft({
    auth,
    store,
    catalog,
    audit: createSupabasePartnerPublishAuditStore(supabase),
    apply: createSupabasePartnerRuntimeApply(supabase),
    draftId,
    body,
    reloadCatalog: partnerId
      ? () => loadAuthorizedPartnerPortalCatalog(partnerId)
      : undefined,
  });
}
