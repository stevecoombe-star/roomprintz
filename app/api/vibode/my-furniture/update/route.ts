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
import { updateVibodeUserFurnitureOverrides } from "@/lib/vibodeMyFurniture";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient<any, "public", any>;

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

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFurnitureId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const maybeId = (body as { id?: unknown }).id;
  return asOptionalString(maybeId);
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
    const id = parseFurnitureId(body);
    if (!id) {
      return Response.json({ error: "id is required." }, { status: 400 });
    }

    const row = await updateVibodeUserFurnitureOverrides(supabase, {
      userId: userData.user.id,
      id,
      overrideDisplayName: asOptionalString(
        (body as { overrideDisplayName?: unknown } | null)?.overrideDisplayName
      ),
      overrideSupplierName: asOptionalString(
        (body as { overrideSupplierName?: unknown } | null)?.overrideSupplierName
      ),
      overridePriceText: asOptionalString((body as { overridePriceText?: unknown } | null)?.overridePriceText),
      overridePriceAmount: asOptionalNumber(
        (body as { overridePriceAmount?: unknown } | null)?.overridePriceAmount
      ),
      overridePriceCurrency: asOptionalString(
        (body as { overridePriceCurrency?: unknown } | null)?.overridePriceCurrency
      ),
      overrideSourceUrl: asOptionalString((body as { overrideSourceUrl?: unknown } | null)?.overrideSourceUrl),
      overrideCategory: asOptionalString((body as { overrideCategory?: unknown } | null)?.overrideCategory),
    });

    const item = {
      ...row,
      resolved: {
        displayName: resolveDisplayName(row),
        sourceUrl: resolveSourceUrl(row),
        supplier: resolveSupplier(row),
        priceLabel: resolvePriceLabel(row),
        category: resolveCategory(row),
      },
    };

    return Response.json({ success: true, item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    const status = /not found/i.test(message) ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
