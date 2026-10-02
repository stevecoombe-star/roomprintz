import "server-only";

import { revalidatePath } from "next/cache";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import {
  assignPartnerVariantSortOrders,
  partnerVariantManualIds,
  partnerVariantOrderMessage,
  readPartnerVariantOrderRequest,
  samePartnerVariantOrder,
  validatePartnerVariantReorder,
} from "./partner-variant-order";
import { httpFromPartnerPortalAuth, type PartnerPortalHttpResponse } from "./partner-portal-http";
import { resolvePartnerPortalContext } from "./partner-portal-auth.server";
import { loadAuthorizedPartnerPortalCatalog } from "./partner-portal-catalog.server";

export const STAGE_PARTNER_VARIANT_ORDER_RPC = "vibode_stage_reorder_partner_product_variants";

function jsonError(status: number, error: string): PartnerPortalHttpResponse {
  return { status, body: { ok: false, error } };
}

export async function partnerPortalVariantOrderResponse(
  body: unknown,
): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const denied = httpFromPartnerPortalAuth(auth);
  if (denied || !auth.ok) return denied ?? jsonError(401, "Unauthorized");

  const request = readPartnerVariantOrderRequest(body);
  if (!request) return jsonError(400, partnerVariantOrderMessage("malformed"));

  const loaded = await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId);
  if (!loaded.ok) return jsonError(500, "Your catalog could not be loaded. Try again in a moment.");

  const product = loaded.catalog.products.find((item) => item.productId === request.productId) ?? null;
  if (!product) return jsonError(400, partnerVariantOrderMessage("unknown_product"));

  const productVariants = loaded.catalog.variants.filter((variant) => variant.productId === product.productId);
  const manualIds = partnerVariantManualIds(productVariants);
  const byId = new Map(productVariants.map((variant) => [variant.variantId, variant]));
  const owned = manualIds.map((variantId, index) => ({
    variantId,
    sortOrder: byId.get(variantId)?.sortOrder ?? index,
  }));
  const issue = validatePartnerVariantReorder(request.variantIds, manualIds);
  if (issue) return jsonError(400, partnerVariantOrderMessage(issue));
  if (samePartnerVariantOrder(request.variantIds, manualIds)) {
    return { status: 200, body: { ok: true } };
  }

  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return jsonError(500, "Partner Portal is unavailable.");

  const items = assignPartnerVariantSortOrders(request.variantIds, owned);
  const { error } = await supabase.rpc(STAGE_PARTNER_VARIANT_ORDER_RPC, {
    p_partner_id: auth.context.partnerId,
    p_product_id: product.productId,
    p_items: items.map((item) => ({
      variantId: item.variantId,
      sortOrder: item.sortOrder,
    })),
  });
  if (error) {
    if (/duplicate_variant|duplicate_position|unknown_variant|unknown_product|incomplete_order|invalid_order/.test(error.message)) {
      return jsonError(409, "The variants changed. Reload and try again.");
    }
    return jsonError(500, "The variant order could not be saved.");
  }
  revalidatePath(`/partner/catalog/products/${product.productId}`);
  return { status: 200, body: { ok: true } };
}
