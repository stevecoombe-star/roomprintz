import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type { VibodeFurniturePartnerStatus } from "@/lib/vibodeFurnitureCollections";
import {
  parseMetadataObject,
  parseOptionalString,
  parsePartnerStatus,
  parseRequiredId,
  resolveFurniturePartnerSlug,
} from "@/lib/vibodeFurnitureCollectionsApi";

type UpdateFurniturePartnerPayload = {
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ partnerId: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { partnerId } = await context.params;
  const parsedPartnerId = parseRequiredId(partnerId);
  if (!parsedPartnerId) return json(400, { error: "Invalid partner id." });

  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_partners")
    .select("*")
    .eq("id", parsedPartnerId)
    .maybeSingle();

  if (error) return json(500, { error: "Failed to load Furniture Partner." });
  if (!data) return json(404, { error: "Furniture Partner not found." });
  return json(200, { partner: data });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ partnerId: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { partnerId } = await context.params;
  const parsedPartnerId = parseRequiredId(partnerId);
  if (!parsedPartnerId) return json(400, { error: "Invalid partner id." });

  const payload = (await request.json().catch(() => ({}))) as UpdateFurniturePartnerPayload;
  const updates: Record<string, unknown> = {};

  if (payload.name !== undefined) {
    const name = parseOptionalString(payload.name);
    if (!name) return json(400, { error: "name must be a non-empty string when provided." });
    updates.name = name;
  }

  if (payload.slug !== undefined || (payload.slug === undefined && payload.name !== undefined)) {
    const slug = resolveFurniturePartnerSlug({ slug: payload.slug, name: payload.name });
    if (!slug) return json(400, { error: "slug must be slug-safe when provided." });
    updates.slug = slug;
  }

  if (payload.logo_url !== undefined) updates.logo_url = parseOptionalString(payload.logo_url);
  if (payload.website_url !== undefined) updates.website_url = parseOptionalString(payload.website_url);
  if (payload.description !== undefined) updates.description = parseOptionalString(payload.description);
  if (payload.internal_notes !== undefined) {
    updates.internal_notes = parseOptionalString(payload.internal_notes);
  }

  if (payload.status !== undefined) {
    const status = parsePartnerStatus(payload.status);
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
    .from("vibode_furniture_partners")
    .update(updates)
    .eq("id", parsedPartnerId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return json(409, { error: "A Furniture Partner with this slug already exists." });
    return json(500, { error: "Failed to update Furniture Partner." });
  }
  if (!data) return json(404, { error: "Furniture Partner not found." });
  return json(200, { partner: data });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ partnerId: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { partnerId } = await context.params;
  const parsedPartnerId = parseRequiredId(partnerId);
  if (!parsedPartnerId) return json(400, { error: "Invalid partner id." });

  const softDeletedStatus: VibodeFurniturePartnerStatus = "inactive";
  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_partners")
    .update({ status: softDeletedStatus })
    .eq("id", parsedPartnerId)
    .select("*")
    .maybeSingle();

  if (error) return json(500, { error: "Failed to disable Furniture Partner." });
  if (!data) return json(404, { error: "Furniture Partner not found." });
  return json(200, { ok: true, partner: data });
}
