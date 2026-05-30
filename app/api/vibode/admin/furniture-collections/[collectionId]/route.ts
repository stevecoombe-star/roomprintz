import { NextResponse } from "next/server";
import type { VibodeFurnitureCollectionStatus } from "@/lib/vibodeFurnitureCollections";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  parseCollectionStatus,
  parseCollectionVisibility,
  parseMetadataObject,
  parseOptionalString,
  parseRequiredId,
  resolveFurnitureCollectionSlug,
} from "@/lib/vibodeFurnitureCollectionsApi";

type UpdateFurnitureCollectionPayload = {
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ collectionId: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { collectionId } = await context.params;
  const parsedCollectionId = parseRequiredId(collectionId);
  if (!parsedCollectionId) return json(400, { error: "Invalid collection id." });

  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_collections")
    .select("*, partner:vibode_furniture_partners(*)")
    .eq("id", parsedCollectionId)
    .maybeSingle();

  if (error) return json(500, { error: "Failed to load Furniture Collection." });
  if (!data) return json(404, { error: "Furniture Collection not found." });
  return json(200, { collection: data });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ collectionId: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { collectionId } = await context.params;
  const parsedCollectionId = parseRequiredId(collectionId);
  if (!parsedCollectionId) return json(400, { error: "Invalid collection id." });

  const payload = (await request.json().catch(() => ({}))) as UpdateFurnitureCollectionPayload;
  const updates: Record<string, unknown> = {};

  if (payload.partner_id !== undefined) {
    const partnerId = parseRequiredId(payload.partner_id);
    if (!partnerId) return json(400, { error: "partner_id must be a valid id when provided." });
    updates.partner_id = partnerId;
  }

  if (payload.name !== undefined) {
    const name = parseOptionalString(payload.name);
    if (!name) return json(400, { error: "name must be a non-empty string when provided." });
    updates.name = name;
  }

  if (payload.slug !== undefined || (payload.slug === undefined && payload.name !== undefined)) {
    const slug = resolveFurnitureCollectionSlug({ slug: payload.slug, name: payload.name });
    if (!slug) return json(400, { error: "slug must be slug-safe when provided." });
    updates.slug = slug;
  }

  if (payload.description !== undefined) updates.description = parseOptionalString(payload.description);
  if (payload.hero_image_url !== undefined) {
    updates.hero_image_url = parseOptionalString(payload.hero_image_url);
  }

  if (payload.visibility !== undefined) {
    const visibility = parseCollectionVisibility(payload.visibility);
    if (!visibility) return json(400, { error: "visibility must be one of: public, private, unlisted." });
    updates.visibility = visibility;
  }

  if (payload.status !== undefined) {
    const status = parseCollectionStatus(payload.status);
    if (!status) return json(400, { error: "status must be one of: active, inactive, archived." });
    updates.status = status;
  }

  if (payload.metadata !== undefined) {
    const metadata = parseMetadataObject(payload.metadata);
    if (!metadata) return json(400, { error: "metadata must be an object when provided." });
    updates.metadata = metadata;
  }

  if (Object.keys(updates).length === 0) return json(400, { error: "No valid fields provided for update." });

  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_collections")
    .update(updates)
    .eq("id", parsedCollectionId)
    .select("*, partner:vibode_furniture_partners(*)")
    .maybeSingle();

  if (error) {
    if (error.code === "23503") return json(400, { error: "partner_id must reference an existing Furniture Partner." });
    if (error.code === "23505") {
      return json(409, { error: "A Furniture Collection with this slug already exists for this partner." });
    }
    return json(500, { error: "Failed to update Furniture Collection." });
  }
  if (!data) return json(404, { error: "Furniture Collection not found." });
  return json(200, { collection: data });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ collectionId: string }> }
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) return json(500, { error: "Server configuration missing for admin controls." });

  const { collectionId } = await context.params;
  const parsedCollectionId = parseRequiredId(collectionId);
  if (!parsedCollectionId) return json(400, { error: "Invalid collection id." });

  const softDeletedStatus: VibodeFurnitureCollectionStatus = "archived";
  const { data, error } = await supabaseAdmin
    .from("vibode_furniture_collections")
    .update({ status: softDeletedStatus })
    .eq("id", parsedCollectionId)
    .select("*, partner:vibode_furniture_partners(*)")
    .maybeSingle();

  if (error) return json(500, { error: "Failed to archive Furniture Collection." });
  if (!data) return json(404, { error: "Furniture Collection not found." });
  return json(200, { ok: true, collection: data });
}
