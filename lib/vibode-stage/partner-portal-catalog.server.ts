import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import { assembleStageCatalogFromRows } from "./catalog-store";
import { loadDurableStageCatalogRows } from "./catalog-persistence.server";
import {
  partnerCatalogFromDurableSnapshot,
  type PartnerPortalCatalogLoadResult,
} from "./partner-portal-catalog";

export async function loadAuthorizedPartnerPortalCatalog(
  partnerId: string,
): Promise<PartnerPortalCatalogLoadResult> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, code: "durable_load_failed" };
  const loaded = await loadDurableStageCatalogRows(supabase);
  if (loaded.error || !loaded.rows) {
    return { ok: false, code: "durable_load_failed" };
  }
  const durable = assembleStageCatalogFromRows(loaded.rows);
  return partnerCatalogFromDurableSnapshot({
    catalog: durable,
    partnerId,
  });
}
