import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCookieSupabaseClient, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { normalizePartnerSlug } from "@/lib/commercial/partners";
import { normalizeFurnitureCollectionSlug } from "@/lib/vibodeFurnitureCollectionsApi";
import {
  ensureCollectionImportAccess,
  ensurePartnerMyFurnitureFolder,
  FurnitureCollectionMaterializationError,
  materializeCollectionItemToMyFurniture,
  type MaterializableCollection,
  type MaterializableItem,
  type MaterializablePartner,
} from "@/lib/vibodeFurnitureCollectionMaterialization";

const COLLECTION_SESSION_COOKIE = "vibode_collection_session_id";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

type ItemMaterializationResult = {
  itemId: string;
  ok: boolean;
  alreadyExisted: boolean;
  error?: string;
  userFurnitureId?: string;
};

export async function POST(
  _request: Request,
  context: { params: Promise<{ partnerSlug: string; collectionSlug: string }> }
) {
  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, {
      error: "Server configuration missing for Furniture Collection materialization.",
    });
  }

  const cookieSupabase = await getCookieSupabaseClient();
  if (!cookieSupabase) {
    return json(500, { error: "Server configuration missing for authentication." });
  }

  const { data: userData, error: userError } = await cookieSupabase.auth.getUser();
  if (userError || !userData.user?.id) {
    return json(401, { error: "Please sign in to use this item." });
  }
  const userId = userData.user.id;

  const { partnerSlug, collectionSlug } = await context.params;
  const normalizedPartnerSlug = normalizePartnerSlug(partnerSlug);
  const normalizedCollectionSlug = normalizeFurnitureCollectionSlug(collectionSlug);
  if (!normalizedPartnerSlug || !normalizedCollectionSlug) {
    return json(404, { error: "Furniture Collection not found." });
  }

  const { data: partnerData, error: partnerError } = await supabaseAdmin
    .from("vibode_furniture_partners")
    .select("id,name,slug,status")
    .eq("slug", normalizedPartnerSlug)
    .eq("status", "active")
    .maybeSingle();
  if (partnerError) {
    return json(500, { error: "Failed to resolve Furniture Partner." });
  }
  if (!partnerData) {
    return json(404, { error: "Furniture Collection not found." });
  }
  const partner = partnerData as MaterializablePartner;

  const { data: collectionData, error: collectionError } = await supabaseAdmin
    .from("vibode_furniture_collections")
    .select("id,partner_id,name,slug,status,visibility")
    .eq("partner_id", partner.id)
    .eq("slug", normalizedCollectionSlug)
    .eq("status", "active")
    .eq("visibility", "public")
    .maybeSingle();
  if (collectionError) {
    return json(500, { error: "Failed to resolve Furniture Collection." });
  }
  if (!collectionData) {
    return json(404, { error: "Furniture Collection not found." });
  }
  const collection = collectionData as MaterializableCollection;

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COLLECTION_SESSION_COOKIE)?.value ?? null;

  try {
    await ensureCollectionImportAccess({
      supabaseAdmin,
      userId,
      collectionId: collection.id,
      sessionId,
    });
  } catch (error: unknown) {
    if (error instanceof FurnitureCollectionMaterializationError) {
      return json(error.status, { error: error.message });
    }
    return json(500, { error: "Failed to verify Furniture Collection import access." });
  }

  const { data: itemRows, error: itemError } = await supabaseAdmin
    .from("vibode_furniture_collection_items")
    .select(
      "id,collection_id,product_name,product_url,image_url,brand,category,price_amount,price_currency,status,sort_order,created_at"
    )
    .eq("collection_id", collection.id)
    .eq("status", "active")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (itemError) {
    return json(500, { error: "Failed to resolve Furniture Collection items." });
  }

  const items = (itemRows ?? []) as MaterializableItem[];
  if (items.length === 0) {
    return json(200, {
      ok: true,
      folder: null,
      folderCreated: false,
      totalCount: 0,
      addedCount: 0,
      alreadyExistedCount: 0,
      failedCount: 0,
      results: [] as ItemMaterializationResult[],
      message: "No active collection items were available.",
    });
  }

  let folder;
  let folderCreated = false;
  try {
    const ensured = await ensurePartnerMyFurnitureFolder({
      userSupabase: cookieSupabase,
      userId,
      partnerName: partner.name,
    });
    folder = ensured.folder;
    folderCreated = ensured.folderCreated;
  } catch (error: unknown) {
    if (error instanceof FurnitureCollectionMaterializationError) {
      return json(error.status, { error: error.message });
    }
    return json(500, { error: "Failed to create My Furniture folder." });
  }

  const results: ItemMaterializationResult[] = [];
  let addedCount = 0;
  let alreadyExistedCount = 0;
  let failedCount = 0;

  for (const item of items) {
    try {
      const materialized = await materializeCollectionItemToMyFurniture({
        userSupabase: cookieSupabase,
        userId,
        folderId: folder.id,
        item,
        collection,
        partner,
      });
      if (materialized.alreadyExisted) {
        alreadyExistedCount += 1;
      } else {
        addedCount += 1;
      }
      results.push({
        itemId: item.id,
        ok: true,
        alreadyExisted: materialized.alreadyExisted,
        userFurnitureId: materialized.userFurniture.id,
      });
    } catch (error: unknown) {
      failedCount += 1;
      const message =
        error instanceof FurnitureCollectionMaterializationError
          ? error.message
          : "Could not add this item yet. Please try again.";
      results.push({
        itemId: item.id,
        ok: false,
        alreadyExisted: false,
        error: message,
      });
    }
  }

  return json(200, {
    ok: true,
    folder,
    folderCreated,
    totalCount: items.length,
    addedCount,
    alreadyExistedCount,
    failedCount,
    results,
  });
}
