import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getVibodeUserFurnitureById } from "@/lib/vibodeMyFurniture";

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

function parseFurnitureId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const maybeId = (body as { id?: unknown }).id;
  if (typeof maybeId !== "string") return null;
  const id = maybeId.trim();
  return id.length > 0 ? id : null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isImageUrlLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("data:image/")
  );
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function collectStrictVariantImageUrls(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const urls: string[] = [];
  for (const item of raw) {
    const imageUrl = normalizeOptionalString(item);
    if (!imageUrl || !isImageUrlLike(imageUrl)) {
      return null;
    }
    urls.push(imageUrl);
  }
  const uniqueUrls = uniqueStrings(urls);
  return uniqueUrls.length > 0 ? uniqueUrls : null;
}

function collectReusableImageUrls(
  rawVariantImageUrls: unknown,
  rawPreviewImageUrl: unknown
): string[] | null {
  const variantUrls = collectStrictVariantImageUrls(rawVariantImageUrls);
  if (variantUrls) return variantUrls;

  const previewImageUrl = normalizeOptionalString(rawPreviewImageUrl);
  if (!previewImageUrl || !isImageUrlLike(previewImageUrl)) return null;
  return [previewImageUrl];
}

function isReadyStatus(raw: unknown): boolean {
  const status = normalizeOptionalString(raw)?.toLowerCase();
  return status === "ready";
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
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    const furnitureId = parseFurnitureId(body);
    if (!furnitureId) {
      return Response.json({ error: "id is required." }, { status: 400 });
    }

    const row = await getVibodeUserFurnitureById(supabase, userId, furnitureId);
    if (!row) {
      return Response.json({ error: "Saved furniture item was not found." }, { status: 404 });
    }
    if (row.is_archived) {
      return Response.json({ error: "Saved furniture item is archived." }, { status: 400 });
    }
    if (!isReadyStatus((row as Record<string, unknown>).status)) {
      return Response.json({ error: "Saved furniture item is not ready." }, { status: 400 });
    }
    const variants = collectReusableImageUrls(
      (row as Record<string, unknown>).variant_image_urls,
      (row as Record<string, unknown>).preview_image_url
    );
    if (!variants) {
      return Response.json({ error: "Saved furniture item is missing a reusable image." }, { status: 400 });
    }

    const eligibleSku = {
      skuId: row.user_sku_id,
      label: normalizeOptionalString(row.display_name) ?? row.user_sku_id,
      source: "user" as const,
      variants: variants.map((imageUrl) => ({ imageUrl })),
    };

    return Response.json({
      id: row.id,
      userSkuId: row.user_sku_id,
      eligibleSku,
      item: {
        displayName: row.display_name,
        previewImageUrl: row.preview_image_url,
        sourceUrl: row.source_url,
        category: row.category,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    const isNotFound = /not found/i.test(message);
    const isBadRequest =
      /archived|not ready|does not belong|missing reusable|missing linked prepared|invalid/i.test(message);
    return Response.json({ error: message }, { status: isNotFound ? 404 : isBadRequest ? 400 : 500 });
  }
}
