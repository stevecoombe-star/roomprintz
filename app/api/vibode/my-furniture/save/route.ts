import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectSourceType,
  extractDomain,
  parseDimensions,
  parsePrice,
} from "@/lib/attribution/parsers";
import { normalizeSupplier } from "@/lib/attribution/normalizers";
import { upsertVibodeUserFurniture } from "@/lib/vibodeMyFurniture";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getUserSupabaseClient(
  req: NextRequest
): { supabase: AnySupabaseClient | null; token: string | null } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { supabase: null, token: null };
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
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

export async function POST(req: NextRequest) {
  try {
    const { supabase, token } = getUserSupabaseClient(req);
    if (!token || !supabase) {
      return Response.json(
        {
          error:
            "Unauthorized: missing Authorization Bearer token. (Send Supabase access_token in the request.)",
        },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const userSkuId = asOptionalString((body as { userSkuId?: unknown } | null)?.userSkuId);
    if (!userSkuId) {
      return Response.json({ error: "userSkuId is required." }, { status: 400 });
    }

    const displayName = asOptionalString((body as { displayName?: unknown } | null)?.displayName);
    const previewImageUrl = asOptionalString((body as { previewImageUrl?: unknown } | null)?.previewImageUrl);
    const sourceUrl = asOptionalString((body as { sourceUrl?: unknown } | null)?.sourceUrl);
    const category = asOptionalString((body as { category?: unknown } | null)?.category);
    const priceText = asOptionalString((body as { priceText?: unknown } | null)?.priceText);
    const dimensionsText = asOptionalString((body as { dimensionsText?: unknown } | null)?.dimensionsText);

    const parsedSourceUrl = sourceUrl;
    const parsedSourceDomain = extractDomain(parsedSourceUrl);
    const parsedSupplierName = normalizeSupplier(parsedSourceDomain);
    const parsedPrice = parsePrice(priceText);
    const parsedDimensions = parseDimensions(dimensionsText);

    const row = await upsertVibodeUserFurniture(supabase, {
      userId: userData.user.id,
      userSkuId,
      displayName,
      previewImageUrl,
      sourceUrl,
      category,
      parsedDisplayName: displayName,
      parsedSourceUrl,
      parsedSourceDomain,
      parsedSupplierName,
      parsedPriceText: priceText,
      parsedPriceAmount: parsedPrice.amount,
      parsedPriceCurrency: parsedPrice.currency,
      parsedDimensionsText: dimensionsText,
      parsedWidthValue: parsedDimensions.width,
      parsedDepthValue: parsedDimensions.depth,
      parsedHeightValue: parsedDimensions.height,
      parsedDimensionUnit: parsedDimensions.unit,
      parsedCategory: category,
      priceSourceType: detectSourceType(parsedSourceDomain),
      priceConfidence: parsedPrice.confidence,
    });

    return Response.json({
      item: {
        id: row.id,
        user_sku_id: row.user_sku_id,
        display_name: row.display_name,
        preview_image_url: row.preview_image_url,
        source_url: row.source_url,
        category: row.category,
        parsed_display_name: row.parsed_display_name,
        parsed_source_url: row.parsed_source_url,
        parsed_source_domain: row.parsed_source_domain,
        parsed_supplier_name: row.parsed_supplier_name,
        parsed_price_text: row.parsed_price_text,
        parsed_price_amount: row.parsed_price_amount,
        parsed_price_currency: row.parsed_price_currency,
        parsed_dimensions_text: row.parsed_dimensions_text,
        parsed_width_value: row.parsed_width_value,
        parsed_depth_value: row.parsed_depth_value,
        parsed_height_value: row.parsed_height_value,
        parsed_dimension_unit: row.parsed_dimension_unit,
        parsed_category: row.parsed_category,
        price_source_type: row.price_source_type,
        price_confidence: row.price_confidence,
        times_used: row.times_used,
        last_used_at: row.last_used_at,
        created_at: row.created_at,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
