import "server-only";

import { previewPartnerCatalogFromDurable } from "./partner-catalog-preview";
import {
  executePartnerPortalCatalog,
  executePartnerPortalPreview,
  executePartnerPortalSession,
  extractPartnerPreviewDocument,
  type PartnerPortalHttpResponse,
} from "./partner-portal-http";
import { resolvePartnerPortalContext } from "./partner-portal-auth.server";
import { loadAuthorizedPartnerPortalCatalog } from "./partner-portal-catalog.server";
import { collectAssetIdsFromUnknownPatch } from "./partner-commercial-assets";
import { loadPartnerCommercialAssetsForPortal } from "./partner-commercial-assets.server";

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
  const document = extractPartnerPreviewDocument(body);
  if (!catalog.ok) {
    return executePartnerPortalPreview({ auth, body, catalog });
  }
  const commercial = await loadPartnerCommercialAssetsForPortal(
    auth.context.partnerId,
    catalog.catalog,
    collectAssetIdsFromUnknownPatch(document),
  );
  if (!commercial.ok) {
    return { status: 500, body: { ok: false, error: "Partner commercial Assets could not be loaded." } };
  }
  return executePartnerPortalPreview({
    auth,
    body,
    catalog,
    preview: (nextCatalog, partnerId, nextDocument) => previewPartnerCatalogFromDurable({
      catalog: nextCatalog,
      partnerId,
      document: nextDocument,
      commercialEligibility: commercial.context,
    }),
  });
}
