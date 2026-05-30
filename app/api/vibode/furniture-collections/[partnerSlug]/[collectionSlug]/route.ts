import { NextResponse } from "next/server";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type {
  VibodeFurnitureCollectionItemRow,
  VibodeFurnitureCollectionRow,
  VibodeFurniturePartnerRow,
} from "@/lib/vibodeFurnitureCollections";
import {
  buildPublicFurnitureCollectionPayload,
  normalizeFurnitureCollectionSlug,
} from "@/lib/vibodeFurnitureCollectionsApi";
import { normalizePartnerSlug } from "@/lib/commercial/partners";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ partnerSlug: string; collectionSlug: string }> }
) {
  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for Furniture Collection reads." });
  }

  const { partnerSlug, collectionSlug } = await context.params;
  const normalizedPartnerSlug = normalizePartnerSlug(partnerSlug);
  const normalizedCollectionSlug = normalizeFurnitureCollectionSlug(collectionSlug);
  if (!normalizedPartnerSlug || !normalizedCollectionSlug) {
    return json(404, { error: "Furniture Collection not found." });
  }

  const { data: partnerData, error: partnerError } = await supabaseAdmin
    .from("vibode_furniture_partners")
    .select("*")
    .eq("slug", normalizedPartnerSlug)
    .eq("status", "active")
    .maybeSingle();

  if (partnerError) return json(500, { error: "Failed to load Furniture Collection." });
  if (!partnerData) return json(404, { error: "Furniture Collection not found." });

  const partner = partnerData as VibodeFurniturePartnerRow;

  const { data: collectionData, error: collectionError } = await supabaseAdmin
    .from("vibode_furniture_collections")
    .select("*")
    .eq("partner_id", partner.id)
    .eq("slug", normalizedCollectionSlug)
    .eq("status", "active")
    .eq("visibility", "public")
    .maybeSingle();

  if (collectionError) return json(500, { error: "Failed to load Furniture Collection." });
  if (!collectionData) return json(404, { error: "Furniture Collection not found." });

  const collection = collectionData as VibodeFurnitureCollectionRow;

  const { data: itemsData, error: itemsError } = await supabaseAdmin
    .from("vibode_furniture_collection_items")
    .select("*")
    .eq("collection_id", collection.id)
    .eq("status", "active")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (itemsError) return json(500, { error: "Failed to load Furniture Collection items." });

  const payload = buildPublicFurnitureCollectionPayload({
    partner,
    collection,
    items: (itemsData ?? []) as VibodeFurnitureCollectionItemRow[],
  });

  return json(200, payload);
}
