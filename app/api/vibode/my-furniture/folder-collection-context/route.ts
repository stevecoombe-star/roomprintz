import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const COLLECTION_ITEM_SKU_PREFIX = "furniture-collection-item:";

function getUserSupabaseClient(
  req: NextRequest
): { supabase: AnySupabaseClient | null; token: string | null } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { supabase: null, token: null };
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : null;
  if (!token) return { supabase: null, token: null };

  const supabase: AnySupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { supabase, token };
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function extractCollectionItemIdFromUserSku(userSkuId: string | null): string | null {
  if (!userSkuId) return null;
  if (!userSkuId.startsWith(COLLECTION_ITEM_SKU_PREFIX)) return null;
  const collectionItemId = userSkuId.slice(COLLECTION_ITEM_SKU_PREFIX.length).trim();
  return collectionItemId.length > 0 ? collectionItemId : null;
}

export async function GET(req: NextRequest) {
  try {
    const { supabase, token } = getUserSupabaseClient(req);
    if (!token || !supabase) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = userData.user.id;

    const folderId = asOptionalString(req.nextUrl.searchParams.get("folderId"));
    if (!folderId) {
      return Response.json({ error: "folderId is required." }, { status: 400 });
    }

    const { data: folder, error: folderError } = await supabase
      .from("vibode_user_furniture_folders")
      .select("id,name")
      .eq("id", folderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (folderError) {
      return Response.json({ error: `Failed to resolve folder: ${folderError.message}` }, { status: 500 });
    }
    if (!folder) {
      return Response.json({ error: "Folder not found." }, { status: 404 });
    }

    const { data: folderItems, error: folderItemsError } = await supabase
      .from("vibode_user_furniture")
      .select("id,user_sku_id")
      .eq("user_id", userId)
      .eq("folder_id", folderId)
      .eq("is_archived", false);
    if (folderItemsError) {
      return Response.json(
        { error: `Failed to resolve folder items: ${folderItemsError.message}` },
        { status: 500 }
      );
    }

    const orderedCollectionItemIds = Array.isArray(folderItems)
      ? folderItems
          .map((row) => extractCollectionItemIdFromUserSku(asOptionalString(row.user_sku_id)))
          .filter((value): value is string => Boolean(value))
      : [];

    if (orderedCollectionItemIds.length === 0) {
      return Response.json({ context: null });
    }

    const uniqueCollectionItemIds = uniqueStrings(orderedCollectionItemIds);
    const { data: collectionItems, error: collectionItemsError } = await supabase
      .from("vibode_furniture_collection_items")
      .select("id,collection_id,status")
      .in("id", uniqueCollectionItemIds)
      .eq("status", "active");
    if (collectionItemsError) {
      return Response.json(
        { error: `Failed to resolve Furniture Collection items: ${collectionItemsError.message}` },
        { status: 500 }
      );
    }
    if (!Array.isArray(collectionItems) || collectionItems.length === 0) {
      return Response.json({ context: null });
    }

    const collectionIdByItemId = new Map<string, string>();
    for (const row of collectionItems) {
      const itemId = asOptionalString(row.id);
      const collectionId = asOptionalString(row.collection_id);
      if (!itemId || !collectionId) continue;
      collectionIdByItemId.set(itemId, collectionId);
    }
    if (collectionIdByItemId.size === 0) {
      return Response.json({ context: null });
    }

    const uniqueCollectionIds = uniqueStrings([...collectionIdByItemId.values()]);
    const { data: collections, error: collectionsError } = await supabase
      .from("vibode_furniture_collections")
      .select("id,partner_id,name,slug,status,visibility")
      .in("id", uniqueCollectionIds)
      .eq("status", "active")
      .eq("visibility", "public");
    if (collectionsError) {
      return Response.json(
        { error: `Failed to resolve Furniture Collections: ${collectionsError.message}` },
        { status: 500 }
      );
    }
    if (!Array.isArray(collections) || collections.length === 0) {
      return Response.json({ context: null });
    }

    const collectionById = new Map<
      string,
      { id: string; partner_id: string; name: string; slug: string }
    >();
    for (const row of collections) {
      const id = asOptionalString(row.id);
      const partnerId = asOptionalString(row.partner_id);
      const name = asOptionalString(row.name);
      const slug = asOptionalString(row.slug);
      if (!id || !partnerId || !name || !slug) continue;
      collectionById.set(id, { id, partner_id: partnerId, name, slug });
    }
    if (collectionById.size === 0) {
      return Response.json({ context: null });
    }

    const uniquePartnerIds = uniqueStrings([...collectionById.values()].map((entry) => entry.partner_id));
    const { data: partners, error: partnersError } = await supabase
      .from("vibode_furniture_partners")
      .select("id,name,slug,logo_url,website_url,status")
      .in("id", uniquePartnerIds)
      .eq("status", "active");
    if (partnersError) {
      return Response.json(
        { error: `Failed to resolve Furniture Partners: ${partnersError.message}` },
        { status: 500 }
      );
    }
    if (!Array.isArray(partners) || partners.length === 0) {
      return Response.json({ context: null });
    }

    const partnerById = new Map<
      string,
      { id: string; name: string; slug: string; logo_url: string | null; website_url: string | null }
    >();
    for (const row of partners) {
      const id = asOptionalString(row.id);
      const name = asOptionalString(row.name);
      const slug = asOptionalString(row.slug);
      if (!id || !name || !slug) continue;
      partnerById.set(id, {
        id,
        name,
        slug,
        logo_url: asOptionalString(row.logo_url),
        website_url: asOptionalString(row.website_url),
      });
    }
    if (partnerById.size === 0) {
      return Response.json({ context: null });
    }

    const resolvedCollectionIdsInFolderOrder: string[] = [];
    for (const itemId of orderedCollectionItemIds) {
      const collectionId = collectionIdByItemId.get(itemId);
      if (!collectionId) continue;
      if (!collectionById.has(collectionId)) continue;
      const collection = collectionById.get(collectionId);
      if (!collection || !partnerById.has(collection.partner_id)) continue;
      resolvedCollectionIdsInFolderOrder.push(collectionId);
    }
    if (resolvedCollectionIdsInFolderOrder.length === 0) {
      return Response.json({ context: null });
    }

    const uniqueResolvedCollectionIds = uniqueStrings(resolvedCollectionIdsInFolderOrder);
    const primaryCollectionId = resolvedCollectionIdsInFolderOrder[0]!;
    const primaryCollection = collectionById.get(primaryCollectionId);
    if (!primaryCollection) {
      return Response.json({ context: null });
    }
    const primaryPartner = partnerById.get(primaryCollection.partner_id);
    if (!primaryPartner) {
      return Response.json({ context: null });
    }

    const primaryCollectionItemCount = resolvedCollectionIdsInFolderOrder.filter(
      (collectionId) => collectionId === primaryCollectionId
    ).length;

    return Response.json({
      context: {
        folder: {
          id: folder.id,
          name: folder.name,
        },
        partner: primaryPartner,
        collection: primaryCollection,
        itemCount: primaryCollectionItemCount,
        publicUrl: `/furniture-collections/${primaryPartner.slug}/${primaryCollection.slug}`,
        multiCollection: uniqueResolvedCollectionIds.length > 1,
        collectionCount: uniqueResolvedCollectionIds.length,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
