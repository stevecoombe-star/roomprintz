import { NextResponse } from "next/server";
import type { VibodeFurnitureCollectionItemStatus } from "@/lib/vibodeFurnitureCollections";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  parseCollectionItemStatus,
  parseInteger,
  parseMetadataObject,
  parseNumeric,
  parseOptionalString,
  parseRequiredId,
} from "@/lib/vibodeFurnitureCollectionsApi";

type UpdateFurnitureCollectionItemPayload = {
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { itemId } = await context.params;
  const parsedItemId = parseRequiredId(itemId);
  if (!parsedItemId) return json(400, { error: "Invalid item id." });

  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_collection_items")
    .select("*, collection:vibode_furniture_collections(*)")
    .eq("id", parsedItemId)
    .maybeSingle();

  if (error) return json(500, { error: "Failed to load Furniture Collection item." });
  if (!data) return json(404, { error: "Furniture Collection item not found." });
  return json(200, { item: data });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { itemId } = await context.params;
  const parsedItemId = parseRequiredId(itemId);
  if (!parsedItemId) return json(400, { error: "Invalid item id." });

  const payload = (await request.json().catch(() => ({}))) as UpdateFurnitureCollectionItemPayload;
  const updates: Record<string, unknown> = {};

  if (payload.collection_id !== undefined) {
    const collectionId = parseRequiredId(payload.collection_id);
    if (!collectionId) return json(400, { error: "collection_id must be a valid id when provided." });
    updates.collection_id = collectionId;
  }

  if (payload.product_name !== undefined) {
    const productName = parseOptionalString(payload.product_name);
    if (!productName) return json(400, { error: "product_name must be a non-empty string when provided." });
    updates.product_name = productName;
  }

  if (payload.product_url !== undefined) updates.product_url = parseOptionalString(payload.product_url);
  if (payload.image_url !== undefined) updates.image_url = parseOptionalString(payload.image_url);
  if (payload.stored_asset_id !== undefined) {
    updates.stored_asset_id = parseOptionalString(payload.stored_asset_id);
  }
  if (payload.brand !== undefined) updates.brand = parseOptionalString(payload.brand);
  if (payload.category !== undefined) updates.category = parseOptionalString(payload.category);
  if (payload.price_currency !== undefined) {
    updates.price_currency = parseOptionalString(payload.price_currency);
  }

  if (payload.sort_order !== undefined) {
    const sortOrder = parseInteger(payload.sort_order);
    if (sortOrder === undefined) return json(400, { error: "sort_order must be an integer when provided." });
    updates.sort_order = sortOrder;
  }

  if (payload.price_amount !== undefined) {
    const priceAmount = parseNumeric(payload.price_amount);
    if (priceAmount === undefined) return json(400, { error: "price_amount must be numeric when provided." });
    updates.price_amount = priceAmount;
  }

  if (payload.status !== undefined) {
    const status = parseCollectionItemStatus(payload.status);
    if (!status) return json(400, { error: "status must be one of: active, inactive." });
    updates.status = status;
  }

  if (payload.metadata !== undefined) {
    const metadata = parseMetadataObject(payload.metadata);
    if (!metadata) return json(400, { error: "metadata must be an object when provided." });
    updates.metadata = metadata;
  }

  if (Object.keys(updates).length === 0) return json(400, { error: "No valid fields provided for update." });

  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_collection_items")
    .update(updates)
    .eq("id", parsedItemId)
    .select("*, collection:vibode_furniture_collections(*)")
    .maybeSingle();

  if (error) {
    if (error.code === "23503") {
      return json(400, { error: "collection_id must reference an existing Furniture Collection." });
    }
    return json(500, { error: "Failed to update Furniture Collection item." });
  }
  if (!data) return json(404, { error: "Furniture Collection item not found." });
  return json(200, { item: data });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { itemId } = await context.params;
  const parsedItemId = parseRequiredId(itemId);
  if (!parsedItemId) return json(400, { error: "Invalid item id." });

  const softDeletedStatus: VibodeFurnitureCollectionItemStatus = "inactive";
  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_collection_items")
    .update({ status: softDeletedStatus })
    .eq("id", parsedItemId)
    .select("*, collection:vibode_furniture_collections(*)")
    .maybeSingle();

  if (error) return json(500, { error: "Failed to disable Furniture Collection item." });
  if (!data) return json(404, { error: "Furniture Collection item not found." });
  return json(200, { ok: true, item: data });
}
