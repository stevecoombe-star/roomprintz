/**
 * Service-role entry points for the provisional generation ledger.
 * No route calls this module. The API credential is not read here.
 * Browser roles have no table grants and no execute grant.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

type RpcResult = { ok: true; data: unknown } | { ok: false; code: "unavailable" };

export function furnitureGenerationServices():
  | { ok: true; supabase: SupabaseClient }
  | { ok: false; error: string } {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, error: "Server misconfigured." };
  return { ok: true, supabase };
}

export async function reserveFurnitureGenerationJob(
  supabase: SupabaseClient,
  args: {
    p_user_id: string;
    p_job_id: string;
    p_idempotency_key: string;
    p_request_sha256: string;
    p_operation: "image-to-3d" | "multi-image-to-3d";
    p_ai_model: "meshy-7.1";
    p_settings: unknown;
    p_image_slots: string[];
    p_reserved_credits: number;
  },
): Promise<RpcResult> {
  return callRpc(supabase, "reserve_vibode_furniture_generation", args);
}

export async function readFurnitureGenerationJob(
  supabase: SupabaseClient,
  args: { p_user_id: string; p_job_id: string },
): Promise<RpcResult> {
  return callRpc(supabase, "read_vibode_furniture_generation", args);
}

async function callRpc(
  supabase: SupabaseClient,
  fn: "reserve_vibode_furniture_generation" | "read_vibode_furniture_generation",
  args: object,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error || data == null || typeof data !== "object") return { ok: false, code: "unavailable" };
  return { ok: true, data };
}
