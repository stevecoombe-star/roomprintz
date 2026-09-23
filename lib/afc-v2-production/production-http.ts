import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ProductionAfcIntent } from "./production-adapter.server";

const SUPABASE_URL = process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProductionAfcAuth =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function productionAfcJson(body: unknown, status: number) {
  return json(body, status);
}

function getBearerToken(headers: Headers): string | null {
  const authHeader = headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function authorizeProductionAfcUser(
  req: Request,
): Promise<ProductionAfcAuth> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      ok: false,
      response: json({ error: "Server misconfigured: missing Supabase env." }, 500),
    };
  }
  const token = getBearerToken(req.headers);
  if (!token) {
    return {
      ok: false,
      response: json({ error: "Unauthorized." }, 401),
    };
  }
  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return {
      ok: false,
      response: json({ error: "Unauthorized." }, 401),
    };
  }
  return { ok: true, userId: data.user.id };
}

export function parseUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return UUID.test(id) ? id : null;
}

export function parseRoomId(value: unknown): string | null {
  return parseUuid(value);
}

export function parseVersionId(value: unknown): string | null {
  return parseUuid(value);
}

export function parseAfcGenerationId(value: unknown): string | null {
  return parseUuid(value);
}

export function parseProductionAfcIntent(
  value: unknown,
): ProductionAfcIntent | undefined | "invalid" {
  if (value === undefined || value === null) return undefined;
  if (
    value === "analyze" ||
    value === "run_again" ||
    value === "reread_perspective"
  ) {
    return value;
  }
  return "invalid";
}
