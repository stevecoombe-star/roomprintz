import { getAuthenticatedAdminUser, getCookieSupabaseClient } from "@/lib/adminServer";
import { ADMIN_MISCONFIGURED } from "@/lib/vibode-furniture/generation/admin-dashboard";
import { furnitureGenerationBudgetResponse } from "@/lib/vibode-furniture/generation/admin-budget";

import { furnitureGenerationDenied, furnitureGenerationJson } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return furnitureGenerationDenied();
  const supabase = await getCookieSupabaseClient();
  if (!supabase) {
    return furnitureGenerationJson({ status: 500, body: { ok: false, error: ADMIN_MISCONFIGURED } });
  }
  return furnitureGenerationJson(await furnitureGenerationBudgetResponse({
    getAdmin: async () => adminUser,
    adjust: async (args) => {
      const result = await supabase.rpc("admin_adjust_vibode_furniture_generation_budget", args);
      return {
        data: result.data,
        error: result.error ? { message: result.error.message } : null,
      };
    },
  }, request));
}
