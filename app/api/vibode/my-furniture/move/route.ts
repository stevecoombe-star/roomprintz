import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

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

function parseItemIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const itemId = asOptionalString((body as { itemId?: unknown }).itemId);
  const itemIdsRaw = (body as { itemIds?: unknown[] }).itemIds;
  const itemIds = Array.isArray(itemIdsRaw)
    ? itemIdsRaw
        .map((value) => asOptionalString(value))
        .filter((value): value is string => Boolean(value))
    : [];
  if (itemId && !itemIds.includes(itemId)) {
    itemIds.push(itemId);
  }
  return itemIds;
}

function parseFolderId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  return asOptionalString((body as { folderId?: unknown }).folderId);
}

function isMissingTableError(error: { message?: string | null; code?: string | null } | null): boolean {
  if (!error) return false;
  if (typeof error.code === "string" && error.code.toUpperCase() === "42P01") return true;
  return typeof error.message === "string" && /does not exist/i.test(error.message);
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, token } = getUserSupabaseClient(req);
    if (!token || !supabase) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const itemIds = parseItemIds(body);
    const folderId = parseFolderId(body);
    if (itemIds.length === 0) {
      return Response.json({ error: "At least one item id is required." }, { status: 400 });
    }
    if (folderId) {
      const { data: folder, error: folderErr } = await supabase
        .from("vibode_user_furniture_folders")
        .select("id")
        .eq("id", folderId)
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (folderErr) {
        if (isMissingTableError(folderErr)) {
          return Response.json(
            { error: "Folder assignment is not available yet for this environment." },
            { status: 501 }
          );
        }
        return Response.json(
          { error: `Failed to validate folder for move: ${folderErr.message}` },
          { status: 500 }
        );
      }
      if (!folder) {
        return Response.json({ error: "Folder not found." }, { status: 404 });
      }
    }

    const { data, error } = await supabase
      .from("vibode_user_furniture")
      .update({ folder_id: folderId })
      .eq("user_id", userData.user.id)
      .eq("is_archived", false)
      .in("id", itemIds)
      .select("id");
    if (error) {
      if (isMissingTableError(error)) {
        return Response.json(
          { error: "Folder assignment is not available yet for this environment." },
          { status: 501 }
        );
      }
      return Response.json({ error: `Failed to move items: ${error.message}` }, { status: 500 });
    }

    const updatedIds = Array.isArray(data)
      ? data
          .map((row) => asOptionalString((row as { id?: unknown }).id))
          .filter((value): value is string => Boolean(value))
      : [];
    return Response.json({ success: true, updatedIds, folderId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
