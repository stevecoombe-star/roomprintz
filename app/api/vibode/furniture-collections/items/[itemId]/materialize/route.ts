import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { detectSourceType, extractDomain } from "@/lib/attribution/parsers";
import {
  getCookieSupabaseClient,
  getServiceRoleSupabaseClient,
} from "@/lib/adminServer";
import { upsertVibodeUserFurniture } from "@/lib/vibodeMyFurniture";

const COLLECTION_SESSION_COOKIE = "vibode_collection_session_id";

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asHttpUrl(value: unknown): string | null {
  const raw = asOptionalString(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function formatPriceText(currency: string | null, amount: number | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  const normalizedCurrency = asOptionalString(currency)?.toUpperCase() ?? "CAD";
  return `${normalizedCurrency} ${amount.toFixed(2)}`;
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

  const { data: item, error: itemError } = await supabaseAdmin
    .from("vibode_furniture_collection_items")
    .select(
      "id,collection_id,product_name,product_url,image_url,brand,category,price_amount,price_currency,status,sort_order,created_at"
    )
    .eq("id", normalizedItemId)
    .eq("status", "active")
    .maybeSingle();
  if (itemError) {
    return json(500, { error: "Failed to resolve Furniture Collection item." });
  }
  if (!item) {
    return json(404, { error: "This collection item is no longer available." });
  }

  const { data: collection, error: collectionError } = await supabaseAdmin
    .from("vibode_furniture_collections")
    .select("id,partner_id,name,slug,status,visibility")
    .eq("id", item.collection_id)
    .eq("status", "active")
    .eq("visibility", "public")
    .maybeSingle();
  if (collectionError) {
    return json(500, { error: "Failed to resolve Furniture Collection." });
  }
  if (!collection) {
    return json(404, { error: "This collection item is no longer available." });
  }

  const { data: partner, error: partnerError } = await supabaseAdmin
    .from("vibode_furniture_partners")
    .select("id,name,slug,status")
    .eq("id", collection.partner_id)
    .eq("status", "active")
    .maybeSingle();
  if (partnerError) {
    return json(500, { error: "Failed to resolve Furniture Partner." });
  }
  if (!partner) {
    return json(404, { error: "This collection item is no longer available." });
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COLLECTION_SESSION_COOKIE)?.value ?? null;

  const { data: importsForUser, error: importErrorForUser } = await supabaseAdmin
    .from("vibode_furniture_collection_imports")
    .select("id")
    .eq("user_id", userId)
    .eq("collection_id", collection.id)
    .limit(1);
  if (importErrorForUser) {
    return json(500, { error: "Failed to verify Furniture Collection import access." });
  }

  const hasUserImport = Array.isArray(importsForUser) && importsForUser.length > 0;
  let hasAccess = hasUserImport;

  if (!hasAccess && sessionId) {
    const { data: importsForSession, error: importErrorForSession } = await supabaseAdmin
      .from("vibode_furniture_collection_imports")
      .select("id")
      .eq("session_id", sessionId)
      .eq("collection_id", collection.id)
      .limit(1);
    if (importErrorForSession) {
      return json(500, { error: "Failed to verify Furniture Collection import access." });
    }
    hasAccess = Array.isArray(importsForSession) && importsForSession.length > 0;
  }

  if (!hasAccess) {
    return json(403, { error: "Furniture Collection has not been added yet." });
  }

  const displayName = asOptionalString(item.product_name) ?? "Furniture item";
  const previewImageUrl = asHttpUrl(item.image_url);
  if (!previewImageUrl) {
    return json(409, { error: "This collection item is no longer available." });
  }
  const sourceUrl = asHttpUrl(item.product_url);
  const sourceDomain = extractDomain(sourceUrl);
  const priceAmount = asOptionalNumber(item.price_amount);
  const priceCurrency = asOptionalString(item.price_currency)?.toUpperCase() ?? "CAD";
  const category = asOptionalString(item.category);
  const supplierName = asOptionalString(item.brand) ?? asOptionalString(partner.name);

  const userSkuId = `furniture-collection-item:${item.id}`;

  const { data: existingRow, error: existingRowError } = await cookieSupabase
    .from("vibode_user_furniture")
    .select("id")
    .eq("user_id", userId)
    .eq("user_sku_id", userSkuId)
    .maybeSingle();
  if (existingRowError) {
    return json(500, { error: "Failed to read existing My Furniture item." });
  }
  const alreadyExisted = Boolean(existingRow?.id);

  let saved;
  try {
    saved = await upsertVibodeUserFurniture(cookieSupabase, {
      userId,
      userSkuId,
      sourceType: "furniture_collection",
      displayName,
      previewImageUrl,
      sourceUrl,
      category,
      parsedDisplayName: displayName,
      parsedSourceUrl: sourceUrl,
      parsedSourceDomain: sourceDomain,
      parsedSupplierName: supplierName,
      parsedPriceText: formatPriceText(priceCurrency, priceAmount),
      parsedPriceAmount: priceAmount,
      parsedPriceCurrency: priceCurrency,
      parsedCategory: category,
      priceSourceType: detectSourceType(sourceDomain),
      priceConfidence: priceAmount !== null ? "high" : "none",
    });
  } catch {
    return json(500, { error: "Could not add this item yet. Please try again." });
  }

  return json(200, {
    ok: true,
    alreadyExisted,
    message: "Added to My Furniture.",
    userFurniture: {
      id: saved.id,
      user_sku_id: saved.user_sku_id,
      display_name: saved.display_name,
      preview_image_url: saved.preview_image_url,
      source_url: saved.source_url,
      category: saved.category,
      parsed_supplier_name: saved.parsed_supplier_name,
      parsed_price_amount: saved.parsed_price_amount,
      parsed_price_currency: saved.parsed_price_currency,
      created_at: saved.created_at,
      source_type: saved.source_type,
      furniture_collection_context: {
        source: "furniture_collection",
        partner_id: partner.id,
        partner_slug: partner.slug,
        partner_name: partner.name,
        collection_id: collection.id,
        collection_slug: collection.slug,
        collection_name: collection.name,
        collection_item_id: item.id,
        product_url: sourceUrl,
        price_amount: priceAmount,
        price_currency: priceCurrency,
      },
    },
  });
}
