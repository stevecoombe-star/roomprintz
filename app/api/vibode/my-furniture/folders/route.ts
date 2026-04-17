import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

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

function parseFolderName(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  return asOptionalString((body as { name?: unknown }).name);
}

function parseFolderId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  return asOptionalString((body as { id?: unknown }).id);
}

function isMissingTableError(error: { message?: string | null; code?: string | null } | null): boolean {
  if (!error) return false;
  if (typeof error.code === "string" && error.code.toUpperCase() === "42P01") return true;
  return typeof error.message === "string" && /does not exist/i.test(error.message);
}

export async function GET(req: NextRequest) {
  try {
    const { supabase, token } = getUserSupabaseClient(req);
    if (!token || !supabase) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("vibode_user_furniture_folders")
      .select("id,name,created_at,updated_at")
      .eq("user_id", userData.user.id)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingTableError(error)) {
        return Response.json(
          { error: "Folders are not available yet for this environment." },
          { status: 501 }
        );
      }
      return Response.json({ error: `Failed to load folders: ${error.message}` }, { status: 500 });
    }

    const folders = Array.isArray(data)
      ? data
          .map((folder) => {
            const row = folder as UnknownRecord;
            const id = asOptionalString(row.id);
            const name = asOptionalString(row.name);
            if (!id || !name) return null;
            return {
              id,
              name,
              created_at: asOptionalString(row.created_at),
              updated_at: asOptionalString(row.updated_at),
            };
          })
          .filter((folder): folder is NonNullable<typeof folder> => Boolean(folder))
      : [];

    return Response.json({ folders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
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
    const mode = asOptionalString((body as { mode?: unknown } | null)?.mode) ?? "create";
    if (mode === "create") {
      const name = parseFolderName(body);
      if (!name) {
        return Response.json({ error: "name is required." }, { status: 400 });
      }
      const { data, error } = await supabase
        .from("vibode_user_furniture_folders")
        .insert({ user_id: userData.user.id, name })
        .select("id,name,created_at,updated_at")
        .single();
      if (error || !data) {
        if (isMissingTableError(error)) {
          return Response.json(
            { error: "Folders are not available yet for this environment." },
            { status: 501 }
          );
        }
        return Response.json(
          { error: `Failed to create folder: ${error?.message ?? "unknown error"}` },
          { status: 500 }
        );
      }
      return Response.json({ folder: data });
    }

    if (mode === "rename") {
      const id = parseFolderId(body);
      const name = parseFolderName(body);
      if (!id || !name) {
        return Response.json({ error: "id and name are required." }, { status: 400 });
      }
      const { data, error } = await supabase
        .from("vibode_user_furniture_folders")
        .update({ name })
        .eq("id", id)
        .eq("user_id", userData.user.id)
        .select("id,name,created_at,updated_at")
        .maybeSingle();
      if (error) {
        if (isMissingTableError(error)) {
          return Response.json(
            { error: "Folders are not available yet for this environment." },
            { status: 501 }
          );
        }
        return Response.json({ error: `Failed to rename folder: ${error.message}` }, { status: 500 });
      }
      if (!data) {
        return Response.json({ error: "Folder not found." }, { status: 404 });
      }
      return Response.json({ folder: data });
    }

    if (mode === "delete") {
      const id = parseFolderId(body);
      if (!id) {
        return Response.json({ error: "id is required." }, { status: 400 });
      }

      const { error: unfileErr } = await supabase
        .from("vibode_user_furniture")
        .update({ folder_id: null })
        .eq("user_id", userData.user.id)
        .eq("folder_id", id);
      if (unfileErr) {
        if (isMissingTableError(unfileErr)) {
          return Response.json(
            { error: "Folders are not available yet for this environment." },
            { status: 501 }
          );
        }
        return Response.json({ error: `Failed to unfile folder items: ${unfileErr.message}` }, { status: 500 });
      }

      const { error } = await supabase
        .from("vibode_user_furniture_folders")
        .delete()
        .eq("id", id)
        .eq("user_id", userData.user.id);
      if (error) {
        if (isMissingTableError(error)) {
          return Response.json(
            { error: "Folders are not available yet for this environment." },
            { status: 501 }
          );
        }
        return Response.json({ error: `Failed to delete folder: ${error.message}` }, { status: 500 });
      }
      return Response.json({ success: true, id });
    }

    return Response.json({ error: "Unsupported mode." }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
