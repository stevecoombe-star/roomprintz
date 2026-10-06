import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import {
  assignPartnerManualSortOrders,
  partnerCatalogOrderMessage,
  readPartnerCatalogOrderIds,
  validatePartnerCatalogReorder,
} from "./partner-catalog-order";
import { httpFromPartnerPortalAuth, type PartnerPortalHttpResponse } from "./partner-portal-http";
import { resolvePartnerPortalContext } from "./partner-portal-auth.server";
import { loadAuthorizedPartnerPortalCatalog } from "./partner-portal-catalog.server";

export const STAGE_PARTNER_CATALOG_ORDER_RPC = "vibode_stage_reorder_partner_catalog";

function jsonError(status: number, error: string): PartnerPortalHttpResponse {
  return { status, body: { ok: false, error } };
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export async function partnerPortalCatalogOrderResponse(
  body: unknown,
): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const denied = httpFromPartnerPortalAuth(auth);
  if (denied || !auth.ok) return denied ?? jsonError(401, "Unauthorized");

  const productIds = readPartnerCatalogOrderIds(body);
  if (!productIds) return jsonError(400, partnerCatalogOrderMessage("malformed"));

  const loaded = await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId);
  if (!loaded.ok) return jsonError(500, "Your catalog could not be loaded. Try again in a moment.");

  const owned = loaded.catalog.products.map((product) => ({
    productId: product.productId,
    sortOrder: product.sortOrder ?? 0,
  }));
  const issue = validatePartnerCatalogReorder(
    productIds,
    owned.map((product) => product.productId),
  );
  if (issue) return jsonError(400, partnerCatalogOrderMessage(issue));
  if (sameOrder(productIds, owned.map((product) => product.productId))) {
    return { status: 200, body: { ok: true } };
  }

  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return jsonError(500, "Partner Portal is unavailable.");

  const items = assignPartnerManualSortOrders(productIds, owned);
  const { error } = await supabase.rpc(STAGE_PARTNER_CATALOG_ORDER_RPC, {
    p_partner_id: auth.context.partnerId,
    p_items: items.map((item) => ({
      productId: item.productId,
      sortOrder: item.sortOrder,
    })),
  });
  if (error) {
    if (/duplicate_product|unknown_product|incomplete_order|invalid_order/.test(error.message)) {
      return jsonError(409, "The catalog changed. Reload and try again.");
    }
    return jsonError(500, "The catalog order could not be saved.");
  }
  return { status: 200, body: { ok: true } };
}
