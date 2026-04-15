import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveCategory,
  resolveDisplayName,
  resolvePriceLabel,
  resolveSourceUrl,
  resolveSupplier,
} from "@/lib/myFurniture";
import { resolveMyFurnitureImageUrl } from "@/lib/myFurnitureImageUrl.server";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;
type UnknownRecord = Record<string, unknown>;

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

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asOptionalNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asOptionalBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null;
  return value;
}

export async function GET(req: NextRequest) {
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
    const userId = userData.user.id;

    const { data, error } = await supabase
      .from("vibode_user_furniture")
      .select("*")
      .eq("user_id", userId)
      .eq("is_archived", false)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      return Response.json(
        { error: `Failed to load My Furniture items: ${error.message}` },
        { status: 500 }
      );
    }

    const items = Array.isArray(data)
      ? data
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const item = row as UnknownRecord;
            const id = asOptionalString(item.id);
            const userSkuId = asOptionalString(item.user_sku_id ?? item.userSkuId);
            const createdAt = asOptionalString(item.created_at ?? item.createdAt);
            if (!id || !userSkuId || !createdAt) return null;
            return {
              id,
              user_sku_id: userSkuId,
              display_name: asOptionalString(item.display_name ?? item.displayName),
              category: asOptionalString(item.category),
              source_label: asOptionalString(item.source_label ?? item.sourceLabel),
              source_url: asOptionalString(item.source_url ?? item.sourceUrl),
              preview_image_url: asOptionalString(item.preview_image_url ?? item.previewImageUrl),
              normalized_preview_url: asOptionalString(
                item.normalized_preview_url ?? item.normalizedPreviewUrl
              ),
              times_used: Math.max(0, asNumber(item.times_used ?? item.timesUsed)),
              last_used_at: asOptionalString(item.last_used_at ?? item.lastUsedAt),
              created_at: createdAt,
              status: asOptionalString(item.status) ?? "ready",
              parsed_display_name: asOptionalString(item.parsed_display_name ?? item.parsedDisplayName),
              override_display_name: asOptionalString(item.override_display_name ?? item.overrideDisplayName),
              parsed_source_url: asOptionalString(item.parsed_source_url ?? item.parsedSourceUrl),
              override_source_url: asOptionalString(item.override_source_url ?? item.overrideSourceUrl),
              parsed_source_domain: asOptionalString(item.parsed_source_domain ?? item.parsedSourceDomain),
              parsed_supplier_name: asOptionalString(item.parsed_supplier_name ?? item.parsedSupplierName),
              override_supplier_name: asOptionalString(
                item.override_supplier_name ?? item.overrideSupplierName
              ),
              parsed_price_text: asOptionalString(item.parsed_price_text ?? item.parsedPriceText),
              parsed_price_amount: asOptionalNumber(item.parsed_price_amount ?? item.parsedPriceAmount),
              parsed_price_currency: asOptionalString(item.parsed_price_currency ?? item.parsedPriceCurrency),
              override_price_text: asOptionalString(item.override_price_text ?? item.overridePriceText),
              override_price_amount: asOptionalNumber(
                item.override_price_amount ?? item.overridePriceAmount
              ),
              override_price_currency: asOptionalString(
                item.override_price_currency ?? item.overridePriceCurrency
              ),
              parsed_dimensions_text: asOptionalString(
                item.parsed_dimensions_text ?? item.parsedDimensionsText
              ),
              parsed_width_value: asOptionalNumber(item.parsed_width_value ?? item.parsedWidthValue),
              parsed_depth_value: asOptionalNumber(item.parsed_depth_value ?? item.parsedDepthValue),
              parsed_height_value: asOptionalNumber(item.parsed_height_value ?? item.parsedHeightValue),
              parsed_dimension_unit: asOptionalString(
                item.parsed_dimension_unit ?? item.parsedDimensionUnit
              ),
              override_dimensions_text: asOptionalString(
                item.override_dimensions_text ?? item.overrideDimensionsText
              ),
              override_width_value: asOptionalNumber(item.override_width_value ?? item.overrideWidthValue),
              override_depth_value: asOptionalNumber(item.override_depth_value ?? item.overrideDepthValue),
              override_height_value: asOptionalNumber(item.override_height_value ?? item.overrideHeightValue),
              override_dimension_unit: asOptionalString(
                item.override_dimension_unit ?? item.overrideDimensionUnit
              ),
              parsed_category: asOptionalString(item.parsed_category ?? item.parsedCategory),
              override_category: asOptionalString(item.override_category ?? item.overrideCategory),
              price_source_type: asOptionalString(item.price_source_type ?? item.priceSourceType),
              price_confidence: asOptionalString(item.price_confidence ?? item.priceConfidence),
              partner_id: asOptionalString(item.partner_id ?? item.partnerId),
              affiliate_url: asOptionalString(item.affiliate_url ?? item.affiliateUrl),
              affiliate_network: asOptionalString(item.affiliate_network ?? item.affiliateNetwork),
              affiliate_last_resolved_at: asOptionalString(
                item.affiliate_last_resolved_at ?? item.affiliateLastResolvedAt
              ),
              discount_percent: asOptionalNumber(item.discount_percent ?? item.discountPercent),
              discount_label: asOptionalString(item.discount_label ?? item.discountLabel),
              discount_code: asOptionalString(item.discount_code ?? item.discountCode),
              discount_url: asOptionalString(item.discount_url ?? item.discountUrl),
              discount_source: asOptionalString(item.discount_source ?? item.discountSource),
              discount_is_exclusive: asOptionalBoolean(
                item.discount_is_exclusive ?? item.discountIsExclusive
              ),
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [];

    const partnerIds = [...new Set(items.map((item) => item.partner_id).filter((value): value is string => Boolean(value)))];
    const partnerNameById = new Map<string, string>();
    if (partnerIds.length > 0) {
      const { data: partnerRows } = await supabase
        .from("vibode_partners")
        .select("id,name")
        .in("id", partnerIds)
        .eq("is_active", true);
      if (Array.isArray(partnerRows)) {
        for (const row of partnerRows) {
          const partner = row as UnknownRecord;
          const id = asOptionalString(partner.id);
          const name = asOptionalString(partner.name);
          if (id && name) partnerNameById.set(id, name);
        }
      }
    }

    const enriched = await Promise.all(
      items.map(async (item) => {
        const previewImageUrl = await resolveMyFurnitureImageUrl(supabase, item.preview_image_url);
        const normalizedPreviewUrl = await resolveMyFurnitureImageUrl(
          supabase,
          item.normalized_preview_url
        );
        return {
          ...item,
          preview_image_url: previewImageUrl,
          normalized_preview_url: normalizedPreviewUrl,
          partner_name: item.partner_id ? partnerNameById.get(item.partner_id) ?? null : null,
          resolved: {
            displayName: resolveDisplayName(item),
            sourceUrl: resolveSourceUrl(item),
            supplier: resolveSupplier(item),
            priceLabel: resolvePriceLabel(item),
            category: resolveCategory(item),
          },
        };
      })
    );

    return Response.json({ items: enriched });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
