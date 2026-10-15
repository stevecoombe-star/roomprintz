import { getCookieSupabaseClient } from "@/lib/adminServer";
import { readHarmonizeActor } from "@/lib/vibode-stage/harmonize-jobs/access.server";
import { harmonizeError, harmonizeJson } from "@/lib/vibode-stage/harmonize-jobs/http";
import { HARMONIZE_AI_DISCLOSURE_KEY } from "@/lib/vibode-stage/harmonize-experience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await readHarmonizeActor();
  if (!actor.ok) return harmonizeError(actor.code);
  const supabase = await getCookieSupabaseClient();
  if (!supabase) return harmonizeError("unauthenticated");
  const { data, error } = await supabase
    .from("vibode_user_acknowledgements")
    .select("acknowledgement_key")
    .eq("user_id", actor.userId)
    .eq("acknowledgement_key", HARMONIZE_AI_DISCLOSURE_KEY)
    .maybeSingle();
  if (error) return harmonizeError("unavailable");
  return harmonizeJson({ acknowledged: Boolean(data) }, 200);
}

export async function POST() {
  const actor = await readHarmonizeActor();
  if (!actor.ok) return harmonizeError(actor.code);
  const supabase = await getCookieSupabaseClient();
  if (!supabase) return harmonizeError("unauthenticated");
  const { error } = await supabase
    .from("vibode_user_acknowledgements")
    .insert({
      user_id: actor.userId,
      acknowledgement_key: HARMONIZE_AI_DISCLOSURE_KEY,
    });
  if (error && error.code !== "23505") return harmonizeError("unavailable");
  return harmonizeJson({ acknowledged: true }, 200);
}
