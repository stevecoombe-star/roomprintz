import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCookieSupabaseClient, getServiceRoleSupabaseClient } from "@/lib/adminServer";

const COLLECTION_SESSION_COOKIE = "vibode_collection_session_id";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function GET() {
  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for Furniture Collection imports." });
  }

  const cookieSupabase = await getCookieSupabaseClient();
  const { data: userData, error: userError } = cookieSupabase
    ? await cookieSupabase.auth.getUser()
    : { data: { user: null }, error: null };
  if (userError) return json(500, { error: "Failed to resolve user session." });

  const currentUserId = userData.user?.id ?? null;
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COLLECTION_SESSION_COOKIE)?.value ?? null;

  if (!currentUserId && !sessionId) {
    return json(200, { collectionImport: null });
  }

  let importQuery = supabaseAdmin
    .from("vibode_furniture_collection_imports")
    .select("id,source,created_at,updated_at,collection_id")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (currentUserId) {
    importQuery = importQuery.eq("user_id", currentUserId);
  } else {
    importQuery = importQuery.eq("session_id", sessionId);
  }

  const { data: latestImport, error: importError } = await importQuery.maybeSingle();
  if (importError) return json(500, { error: "Failed to resolve latest Furniture Collection import." });
  if (!latestImport) return json(200, { collectionImport: null });

  const { data: collection, error: collectionError } = await supabaseAdmin
    .from("vibode_furniture_collections")
    .select("id,partner_id,name,slug,description,hero_image_url,status,visibility")
    .eq("id", latestImport.collection_id)
    .eq("status", "active")
    .eq("visibility", "public")
    .maybeSingle();
  if (collectionError) return json(500, { error: "Failed to resolve imported Furniture Collection." });
  if (!collection) return json(200, { collectionImport: null });

  const { data: partner, error: partnerError } = await supabaseAdmin
    .from("vibode_furniture_partners")
    .select("id,name,slug,logo_url,website_url,status")
    .eq("id", collection.partner_id)
    .eq("status", "active")
    .maybeSingle();
  if (partnerError) return json(500, { error: "Failed to resolve Furniture Partner." });
  if (!partner) return json(200, { collectionImport: null });

  const { count: itemCount, error: itemCountError } = await supabaseAdmin
    .from("vibode_furniture_collection_items")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", collection.id)
    .eq("status", "active");
  if (itemCountError) return json(500, { error: "Failed to resolve Furniture Collection item count." });

  return json(200, {
    collectionImport: {
      import: {
        id: latestImport.id,
        source: latestImport.source,
        created_at: latestImport.created_at,
        updated_at: latestImport.updated_at,
      },
      partner: {
        id: partner.id,
        name: partner.name,
        slug: partner.slug,
        logo_url: partner.logo_url,
        website_url: partner.website_url,
      },
      collection: {
        id: collection.id,
        name: collection.name,
        slug: collection.slug,
        description: collection.description,
        hero_image_url: collection.hero_image_url,
      },
      itemCount: itemCount ?? 0,
      publicUrl: `/furniture-collections/${partner.slug}/${collection.slug}`,
    },
  });
}
