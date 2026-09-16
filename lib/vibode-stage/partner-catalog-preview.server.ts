import "server-only";

import { previewPartnerCatalogFromDurable } from "./partner-catalog-preview";
import {
  executePartnerPortalCatalog,
  executePartnerPortalPreview,
  executePartnerPortalSession,
  type PartnerPortalHttpResponse,
} from "./partner-portal-http";
import { resolvePartnerPortalContext } from "./partner-portal-auth.server";
import { loadAuthorizedPartnerPortalCatalog } from "./partner-portal-catalog.server";

export async function partnerPortalSessionResponse(): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  return executePartnerPortalSession(auth);
}

export async function partnerPortalCatalogResponse(): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  if (!auth.ok) return executePartnerPortalCatalog({ auth, catalog: { ok: false, code: "durable_load_failed" } });
  const catalog = await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId);
  return executePartnerPortalCatalog({ auth, catalog });
}

export async function partnerPortalPreviewResponse(
  body: unknown,
): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  if (!auth.ok) {
    return executePartnerPortalPreview({ auth, body, catalog: null });
  }
  const catalog = await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId);
  return executePartnerPortalPreview({
    auth,
    body,
    catalog,
    preview: (nextCatalog, partnerId, document) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document,
    }),
  });
}
