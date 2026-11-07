/**
 * Production wiring for the generation routes. The signed-in user comes
 * from the bearer token. Administrator checks use that user's email.
 * This module does not read a Meshy API key.
 */

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isAdminEmail } from "@/lib/adminAccess";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import type { GenerationHttpDeps } from "./http";
import {
  GENERATION_RPC_ARGUMENTS,
  createSqlGenerationCommands,
  type GenerationRpcName,
} from "./sql-commands";
import { createSupabaseGenerationObjectStore } from "./storage.server";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export async function authorizeFurnitureGenerationCaller(request: Request): Promise<
  | { ok: true; userId: string; email: string | null }
  | { ok: false; response: { status: number; body: { ok: false; error: string } } }
> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, response: { status: 500, body: { ok: false, error: "Server misconfigured." } } };
  }
  const header = request.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return { ok: false, response: { status: 401, body: { ok: false, error: "Unauthorized." } } };
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    return { ok: false, response: { status: 401, body: { ok: false, error: "Unauthorized." } } };
  }
  return { ok: true, userId: data.user.id, email: data.user.email ?? null };
}

export function productionFurnitureGenerationDeps(): GenerationHttpDeps | null {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return null;
  return {
    authorize: authorizeFurnitureGenerationCaller,
    commands: createSqlGenerationCommands((fn, values) => callGenerationRpc(supabase, fn, values)),
    objects: createSupabaseGenerationObjectStore(supabase),
    env: process.env,
    isAdmin: isAdminEmail,
    nowMs: () => Date.now(),
  };
}

async function callGenerationRpc(
  supabase: SupabaseClient,
  fn: GenerationRpcName,
  values: readonly unknown[],
): Promise<unknown> {
  const args: Record<string, unknown> = {};
  GENERATION_RPC_ARGUMENTS[fn].forEach((name, index) => {
    args[name] = values[index] ?? null;
  });
  const { data, error } = await supabase.rpc(fn, args);
  if (error || data == null) throw new Error("generation_unavailable");
  return data;
}
