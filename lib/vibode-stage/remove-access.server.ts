import "server-only";

import { getCookieSupabaseClient } from "@/lib/adminServer";

/**
 * Signed-in Vibode user. Room ownership is enforced by each REMOVE operation.
 * This does not grant admin, diagnostic, or service-role access.
 */
export async function readRemoveActor(): Promise<{ id: string } | null> {
  const supabase = await getCookieSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return null;
  return { id: data.user.id };
}
