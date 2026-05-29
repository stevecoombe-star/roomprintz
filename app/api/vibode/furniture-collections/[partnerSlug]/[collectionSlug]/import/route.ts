import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCookieSupabaseClient, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { normalizePartnerSlug } from "@/lib/commercial/partners";
import { normalizeFurnitureCollectionSlug } from "@/lib/vibodeFurnitureCollectionsApi";

const COLLECTION_SESSION_COOKIE = "vibode_collection_session_id";
const COLLECTION_SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function buildCollectionSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `vibode-col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ partnerSlug: string; collectionSlug: string }> }
) {
  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for Furniture Collection import." });
  }

  const { partnerSlug, collectionSlug } = await context.params;
  const normalizedPartnerSlug = normalizePartnerSlug(partnerSlug);
  const normalizedCollectionSlug = normalizeFurnitureCollectionSlug(collectionSlug);
  if (!normalizedPartnerSlug || !normalizedCollectionSlug) {
    return json(404, { error: "Furniture Collection not found." });
  }

  const { data: partner, error: partnerError } = await supabaseAdmin
    .from("vibode_furniture_partners")
    .select("id,slug,status")
    .eq("slug", normalizedPartnerSlug)
    .eq("status", "active")
    .maybeSingle();

  if (partnerError) return json(500, { error: "Failed to resolve Furniture Collection." });
  if (!partner) return json(404, { error: "Furniture Collection not found." });

  const { data: collection, error: collectionError } = await supabaseAdmin
    .from("vibode_furniture_collections")
    .select("id,slug,status,visibility")
    .eq("partner_id", partner.id)
    .eq("slug", normalizedCollectionSlug)
    .eq("status", "active")
    .eq("visibility", "public")
    .maybeSingle();

  if (collectionError) return json(500, { error: "Failed to resolve Furniture Collection." });
  if (!collection) return json(404, { error: "Furniture Collection not found." });

  const cookieStore = await cookies();
  let sessionId = cookieStore.get(COLLECTION_SESSION_COOKIE)?.value ?? null;
  if (!sessionId) sessionId = buildCollectionSessionId();

  const cookieSupabase = await getCookieSupabaseClient();
  const { data: userData, error: userError } = cookieSupabase
    ? await cookieSupabase.auth.getUser()
    : { data: { user: null }, error: null };
  if (userError) return json(500, { error: "Failed to resolve user session." });
  const userId = userData.user?.id ?? null;

  const sourcePath = `/furniture-collections/${normalizedPartnerSlug}/${normalizedCollectionSlug}`;
  const referrer = request.headers.get("referer");
  const metadata = {
    partnerSlug: normalizedPartnerSlug,
    collectionSlug: normalizedCollectionSlug,
    sourcePath,
    referrer: referrer ?? null,
  };

  const scopedQuery = userId
    ? supabaseAdmin
        .from("vibode_furniture_collection_imports")
        .select("id")
        .eq("collection_id", collection.id)
        .eq("user_id", userId)
        .limit(1)
    : supabaseAdmin
        .from("vibode_furniture_collection_imports")
        .select("id")
        .eq("collection_id", collection.id)
        .eq("session_id", sessionId)
        .limit(1);

  const { data: existingRows, error: existingError } = await scopedQuery;
  if (existingError) return json(500, { error: "Failed to read existing collection import." });

  const existingImportId = Array.isArray(existingRows) && existingRows[0]?.id ? existingRows[0].id : null;

  let importId: string | null = null;
  if (existingImportId) {
    const { data: updatedImport, error: updateError } = await supabaseAdmin
      .from("vibode_furniture_collection_imports")
      .update({
        user_id: userId,
        session_id: sessionId,
        source: "public_collection_url",
        metadata,
      })
      .eq("id", existingImportId)
      .select("id")
      .single();
    if (updateError) return json(500, { error: "Failed to update collection import." });
    importId = updatedImport.id;
  } else {
    const { data: insertedImport, error: insertError } = await supabaseAdmin
      .from("vibode_furniture_collection_imports")
      .insert({
        user_id: userId,
        session_id: sessionId,
        collection_id: collection.id,
        source: "public_collection_url",
        metadata,
      })
      .select("id")
      .single();
    if (insertError) return json(500, { error: "Failed to create collection import." });
    importId = insertedImport.id;
  }

  const response = json(200, {
    ok: true,
    importId,
    redirectTo: "/",
  });

  response.cookies.set({
    name: COLLECTION_SESSION_COOKIE,
    value: sessionId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COLLECTION_SESSION_MAX_AGE_SEC,
    path: "/",
  });

  // TODO(vibode-furniture-collections): use the most recent import context in later My Furniture bridge phases.
  return response;
}
