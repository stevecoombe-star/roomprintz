import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  assembleStageCatalogFromRows,
  resolveLoadedStageCatalog,
  STAGE_CATALOG_TABLES,
  type StageCatalogLoadResult,
  type StageCatalogRows,
} from "@/lib/vibode-stage/catalog-store";

type AnySupabase = SupabaseClient;

async function selectRows(
  supabase: AnySupabase,
  table: string,
  columns: string,
  orderBy: string,
): Promise<{ rows: Record<string, unknown>[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .order(orderBy, { ascending: true });
  if (error) return { rows: null, error: error.message };
  const rows = Array.isArray(data)
    ? (data as unknown as Record<string, unknown>[])
    : [];
  return { rows, error: null };
}

export async function loadDurableStageCatalogRows(
  supabase: AnySupabase,
): Promise<{ rows: StageCatalogRows | null; error: string | null }> {
  const assets = await selectRows(
    supabase,
    STAGE_CATALOG_TABLES.assets,
    "asset_id, glb_url, authored_width_m, authored_height_m, authored_depth_m, status",
    "asset_id",
  );
  if (assets.error || !assets.rows) return { rows: null, error: assets.error };

  const products = await selectRows(
    supabase,
    STAGE_CATALOG_TABLES.products,
    "product_id, name, brand, retailer, image_url, product_url, price_amount, price_currency, category_id, subcategory_id, source, partner_id, default_variant_id, status, sort_order",
    "sort_order",
  );
  if (products.error || !products.rows) return { rows: null, error: products.error };

  const variants = await selectRows(
    supabase,
    STAGE_CATALOG_TABLES.variants,
    "variant_id, product_id, current_asset_id, finish_label, sku, price_amount, price_currency, product_url",
    "variant_id",
  );
  if (variants.error || !variants.rows) return { rows: null, error: variants.error };

  const collections = await selectRows(
    supabase,
    STAGE_CATALOG_TABLES.collections,
    "collection_id, name, owner, partner_name, partner_id, status, sort_order",
    "sort_order",
  );
  if (collections.error || !collections.rows) {
    return { rows: null, error: collections.error };
  }

  const memberships = await selectRows(
    supabase,
    STAGE_CATALOG_TABLES.productCollections,
    "product_id, collection_id, sort_order",
    "sort_order",
  );
  if (memberships.error || !memberships.rows) {
    return { rows: null, error: memberships.error };
  }

  const partners = await selectRows(
    supabase,
    STAGE_CATALOG_TABLES.partners,
    "partner_id, name, slug, status, website_url, logo_url",
    "partner_id",
  );
  if (partners.error || !partners.rows) {
    return { rows: null, error: partners.error };
  }

  return {
    rows: {
      assets: assets.rows,
      products: products.rows,
      variants: variants.rows,
      collections: collections.rows,
      memberships: memberships.rows,
      partners: partners.rows,
    },
    error: null,
  };
}

export async function loadStageCatalogFromClient(
  supabase: AnySupabase | null,
): Promise<StageCatalogLoadResult> {
  if (!supabase) {
    return resolveLoadedStageCatalog({ durable: null, reason: "missing_service_role" });
  }
  const loaded = await loadDurableStageCatalogRows(supabase);
  if (loaded.error || !loaded.rows) {
    return resolveLoadedStageCatalog({ durable: null, reason: "durable_load_failed" });
  }
  const durable = assembleStageCatalogFromRows(loaded.rows);
  if (!durable) {
    const reason = loaded.rows.products.length === 0 ? "durable_empty" : "durable_malformed";
    return resolveLoadedStageCatalog({ durable: null, reason });
  }
  return resolveLoadedStageCatalog({ durable });
}

export async function loadStageCatalogFromEnv(): Promise<StageCatalogLoadResult> {
  return loadStageCatalogFromClient(getServiceRoleSupabaseClient());
}
