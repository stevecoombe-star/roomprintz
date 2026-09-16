/**
 * PI-5G1 Partner Portal HTTP mapping.
 *
 * Fail-closed status codes. Browser-supplied partnerId is untrusted.
 * Preview never mutates durable catalog state.
 */

import {
  previewPartnerCatalogFromDurable,
  type PartnerCatalogPreviewRequest,
  type PartnerCatalogPreviewResult,
} from "./partner-catalog-preview";
import type { PartnerPortalAuthResult } from "./partner-portal-auth";
import {
  serializePartnerPortalCatalog,
  type PartnerPortalCatalogLoadResult,
} from "./partner-portal-catalog";
import type { StageCatalogSnapshot } from "./types";

export type PartnerPortalHttpResponse = Readonly<{
  status: number;
  body: unknown;
}>;

function jsonError(status: number, error: string): PartnerPortalHttpResponse {
  return { status, body: { ok: false, error } };
}

export function httpFromPartnerPortalAuth(
  auth: PartnerPortalAuthResult,
): PartnerPortalHttpResponse | null {
  if (auth.ok) return null;
  return jsonError(auth.status, auth.error);
}

export function executePartnerPortalSession(
  auth: PartnerPortalAuthResult,
): PartnerPortalHttpResponse {
  if (!auth.ok) return jsonError(auth.status, auth.error);
  return {
    status: 200,
    body: {
      ok: true,
      userId: auth.context.userId,
      partnerId: auth.context.partnerId,
      role: auth.context.role,
      partner: {
        partnerId: auth.context.partner.partnerId,
        name: auth.context.partner.name,
        slug: auth.context.partner.slug,
        status: auth.context.partner.status,
      },
    },
  };
}

export function executePartnerPortalCatalog(input: Readonly<{
  auth: PartnerPortalAuthResult;
  catalog: PartnerPortalCatalogLoadResult;
}>): PartnerPortalHttpResponse {
  if (!input.auth.ok) return jsonError(input.auth.status, input.auth.error);
  if (!input.catalog.ok) {
    return jsonError(500, "Partner catalog could not be loaded.");
  }
  return {
    status: 200,
    body: serializePartnerPortalCatalog(input.catalog.catalog),
  };
}

function requestedPartnerId(document: unknown): string | null {
  if (!document || typeof document !== "object" || Array.isArray(document)) return null;
  const partnerId = (document as { partnerId?: unknown }).partnerId;
  if (typeof partnerId !== "string") return null;
  const trimmed = partnerId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractPartnerPreviewDocument(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as { document?: unknown };
  if ("document" in record) return record.document;
  return body;
}

export function executePartnerPortalPreview(input: Readonly<{
  auth: PartnerPortalAuthResult;
  body: unknown;
  catalog: PartnerPortalCatalogLoadResult | null;
  preview?: (
    catalog: StageCatalogSnapshot,
    partnerId: string,
    document: unknown,
  ) => PartnerCatalogPreviewResult;
}>): PartnerPortalHttpResponse {
  if (!input.auth.ok) return jsonError(input.auth.status, input.auth.error);
  const document = extractPartnerPreviewDocument(input.body);
  const requested = requestedPartnerId(document);
  if (requested && requested !== input.auth.context.partnerId) {
    return jsonError(403, "Forbidden");
  }
  if (!input.catalog || !input.catalog.ok) {
    return jsonError(500, "Partner catalog could not be loaded.");
  }
  const preview = input.preview ?? ((catalog, partnerId, nextDocument) => (
    previewPartnerCatalogFromDurable({
      catalog,
      partnerId,
      document: nextDocument as PartnerCatalogPreviewRequest["document"],
    })
  ));
  const result = preview(input.catalog.catalog, input.auth.context.partnerId, document);
  if (result.kind === "invalid_document") {
    return { status: 400, body: result.dto };
  }
  return { status: 200, body: result.dto };
}
