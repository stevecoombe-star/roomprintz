import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type { CreateVibodeFurniturePartnerInput } from "@/lib/vibodeFurnitureCollections";
import {
  parseMetadataObject,
  parseOptionalString,
  parsePartnerStatus,
  resolveFurniturePartnerSlug,
} from "@/lib/vibodeFurnitureCollectionsApi";

type CreateFurniturePartnerPayload = {
  name?: unknown;
  slug?: unknown;
  logo_url?: unknown;
  website_url?: unknown;
  description?: unknown;
  status?: unknown;
  internal_notes?: unknown;
  metadata?: unknown;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function GET() {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_partners")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return json(500, { error: "Failed to load Furniture Partners." });
  return json(200, { partners: data ?? [] });
}

export async function POST(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const payload = (await request.json().catch(() => ({}))) as CreateFurniturePartnerPayload;
  const name = parseOptionalString(payload.name);
  if (!name) return json(400, { error: "name is required." });

  const slug = resolveFurniturePartnerSlug({ slug: payload.slug, name: payload.name });
  if (!slug) return json(400, { error: "slug is required and must be slug-safe." });

  const status = parsePartnerStatus(payload.status);
  if (payload.status !== undefined && !status) {
    return json(400, { error: "status must be one of: active, inactive." });
  }

  const metadata = parseMetadataObject(payload.metadata);
  if (payload.metadata !== undefined && !metadata) {
    return json(400, { error: "metadata must be an object when provided." });
  }

  const insertPayload: CreateVibodeFurniturePartnerInput = {
    name,
    slug,
    logo_url: parseOptionalString(payload.logo_url),
    website_url: parseOptionalString(payload.website_url),
    description: parseOptionalString(payload.description),
    status,
    internal_notes: parseOptionalString(payload.internal_notes),
    metadata,
  };

  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_partners")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return json(409, { error: "A Furniture Partner with this slug already exists." });
    return json(500, { error: "Failed to create Furniture Partner." });
  }

  return json(201, { partner: data });
}
