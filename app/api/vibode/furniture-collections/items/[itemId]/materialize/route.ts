import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getCookieSupabaseClient,
  getServiceRoleSupabaseClient,
} from "@/lib/adminServer";
import {
  ensureCollectionImportAccess,
  ensurePartnerMyFurnitureFolder,
  FurnitureCollectionMaterializationError,
  materializeCollectionItemToMyFurniture,
  resolveMaterializableItemContext,
} from "@/lib/vibodeFurnitureCollectionMaterialization";

const COLLECTION_SESSION_COOKIE = "vibode_collection_session_id";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ itemId: string }> }
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

  const { itemId } = await context.params;
  const normalizedItemId = asOptionalString(itemId);
  if (!normalizedItemId) {
    return json(400, { error: "Collection item id is required." });
  }

  try {
    const { item, collection, partner } = await resolveMaterializableItemContext(
      supabaseAdmin,
      normalizedItemId
    );
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(COLLECTION_SESSION_COOKIE)?.value ?? null;

    await ensureCollectionImportAccess({
      supabaseAdmin,
      userId,
      collectionId: collection.id,
      sessionId,
    });

    const { folder, folderCreated } = await ensurePartnerMyFurnitureFolder({
      userSupabase: cookieSupabase,
      userId,
      partnerName: partner.name,
    });

    const materialized = await materializeCollectionItemToMyFurniture({
      userSupabase: cookieSupabase,
      userId,
      folderId: folder.id,
      item,
      collection,
      partner,
    });

    return json(200, {
      ok: true,
      alreadyExisted: materialized.alreadyExisted,
      folderCreated,
      message: "Added to My Furniture.",
      folder,
      userFurniture: {
        ...materialized.userFurniture,
        furniture_collection_context: {
          source: "furniture_collection",
          partner_id: partner.id,
          partner_slug: partner.slug,
          partner_name: partner.name,
          collection_id: collection.id,
          collection_slug: collection.slug,
          collection_name: collection.name,
          collection_item_id: item.id,
          product_url: item.product_url,
          price_amount: item.price_amount,
          price_currency: item.price_currency,
        },
      },
    });
  } catch (error: unknown) {
    if (error instanceof FurnitureCollectionMaterializationError) {
      return json(error.status, { error: error.message });
    }
    return json(500, { error: "Could not add this item yet. Please try again." });
  }
}
