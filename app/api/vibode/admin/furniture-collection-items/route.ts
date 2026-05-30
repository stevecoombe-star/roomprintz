import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type { CreateVibodeFurnitureCollectionItemInput } from "@/lib/vibodeFurnitureCollections";
import {
  parseCollectionItemStatus,
  parseInteger,
  parseMetadataObject,
  parseNumeric,
  parseOptionalString,
  parseRequiredId,
} from "@/lib/vibodeFurnitureCollectionsApi";

type CreateFurnitureCollectionItemPayload = {
  collection_id?: unknown;
  product_name?: unknown;
  product_url?: unknown;
  image_url?: unknown;
  stored_asset_id?: unknown;
  brand?: unknown;
  category?: unknown;
  price_amount?: unknown;
  price_currency?: unknown;
  sort_order?: unknown;
  status?: unknown;
  metadata?: unknown;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { searchParams } = new URL(request.url);
  const collectionId = parseRequiredId(searchParams.get("collectionId"));

  let query = supabaseAdmin
    .from("vibode_furniture_collection_items")
    .select("*, collection:vibode_furniture_collections(*)")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (collectionId) query = query.eq("collection_id", collectionId);

  const { data, error } = await query;
  if (error) return json(500, { error: "Failed to load Furniture Collection items." });
  return json(200, { items: data ?? [] });
}

export async function POST(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const payload = (await request.json().catch(() => ({}))) as CreateFurnitureCollectionItemPayload;
  const collectionId = parseRequiredId(payload.collection_id);
  if (!collectionId) return json(400, { error: "collection_id is required." });

  const productName = parseOptionalString(payload.product_name);
  if (!productName) return json(400, { error: "product_name is required." });

  const status = parseCollectionItemStatus(payload.status);
  if (payload.status !== undefined && !status) {
    return json(400, { error: "status must be one of: active, inactive." });
  }

  const sortOrder = parseInteger(payload.sort_order);
  if (payload.sort_order !== undefined && sortOrder === undefined) {
    return json(400, { error: "sort_order must be an integer when provided." });
  }

  const priceAmount = parseNumeric(payload.price_amount);
  if (payload.price_amount !== undefined && priceAmount === undefined) {
    return json(400, { error: "price_amount must be numeric when provided." });
  }

  const metadata = parseMetadataObject(payload.metadata);
  if (payload.metadata !== undefined && !metadata) {
    return json(400, { error: "metadata must be an object when provided." });
  }

  const insertPayload: CreateVibodeFurnitureCollectionItemInput = {
    collection_id: collectionId,
    product_name: productName,
    product_url: parseOptionalString(payload.product_url),
    image_url: parseOptionalString(payload.image_url),
    stored_asset_id: parseOptionalString(payload.stored_asset_id),
    brand: parseOptionalString(payload.brand),
    category: parseOptionalString(payload.category),
    price_amount: priceAmount,
    price_currency: parseOptionalString(payload.price_currency),
    sort_order: sortOrder,
    status,
    metadata,
  };

  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_collection_items")
    .insert(insertPayload)
    .select("*, collection:vibode_furniture_collections(*)")
    .single();

  if (error) {
    if (error.code === "23503") {
      return json(400, { error: "collection_id must reference an existing Furniture Collection." });
    }
    return json(500, { error: "Failed to create Furniture Collection item." });
  }

  return json(201, { item: data });
}
