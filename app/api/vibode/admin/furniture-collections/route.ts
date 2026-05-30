import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type { CreateVibodeFurnitureCollectionInput } from "@/lib/vibodeFurnitureCollections";
import {
  parseCollectionStatus,
  parseCollectionVisibility,
  parseMetadataObject,
  parseOptionalString,
  parseRequiredId,
  resolveFurnitureCollectionSlug,
} from "@/lib/vibodeFurnitureCollectionsApi";

type CreateFurnitureCollectionPayload = {
  partner_id?: unknown;
  name?: unknown;
  slug?: unknown;
  description?: unknown;
  hero_image_url?: unknown;
  visibility?: unknown;
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
  const partnerId = parseRequiredId(searchParams.get("partnerId"));

  let query = supabaseAdmin
    .from("vibode_furniture_collections")
    .select("*, partner:vibode_furniture_partners(*)")
    .order("created_at", { ascending: false });

  if (partnerId) query = query.eq("partner_id", partnerId);

  const { data, error } = await query;
  if (error) return json(500, { error: "Failed to load Furniture Collections." });
  return json(200, { collections: data ?? [] });
}

export async function POST(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const payload = (await request.json().catch(() => ({}))) as CreateFurnitureCollectionPayload;
  const partnerId = parseRequiredId(payload.partner_id);
  if (!partnerId) return json(400, { error: "partner_id is required." });

  const name = parseOptionalString(payload.name);
  if (!name) return json(400, { error: "name is required." });

  const slug = resolveFurnitureCollectionSlug({ slug: payload.slug, name: payload.name });
  if (!slug) return json(400, { error: "slug is required and must be slug-safe." });

  const visibility = parseCollectionVisibility(payload.visibility);
  if (payload.visibility !== undefined && !visibility) {
    return json(400, { error: "visibility must be one of: public, private, unlisted." });
  }

  const status = parseCollectionStatus(payload.status);
  if (payload.status !== undefined && !status) {
    return json(400, { error: "status must be one of: active, inactive, archived." });
  }

  const metadata = parseMetadataObject(payload.metadata);
  if (payload.metadata !== undefined && !metadata) {
    return json(400, { error: "metadata must be an object when provided." });
  }

  const insertPayload: CreateVibodeFurnitureCollectionInput = {
    partner_id: partnerId,
    name,
    slug,
    description: parseOptionalString(payload.description),
    hero_image_url: parseOptionalString(payload.hero_image_url),
    visibility,
    status,
    metadata,
  };

  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_collections")
    .insert(insertPayload)
    .select("*, partner:vibode_furniture_partners(*)")
    .single();

  if (error) {
    if (error.code === "23503") return json(400, { error: "partner_id must reference an existing Furniture Partner." });
    if (error.code === "23505") {
      return json(409, { error: "A Furniture Collection with this slug already exists for this partner." });
    }
    return json(500, { error: "Failed to create Furniture Collection." });
  }

  return json(201, { collection: data });
}
