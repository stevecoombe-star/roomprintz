/**
 * Deletes expired scratch photographs for every account. The generation
 * worker calls this after its own sweep. A failure here must not stop that sweep.
 */

import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import { PHOTO_PREPARATION_BUCKET, isPhotoPreparationObjectPath } from "./limits";

export async function sweepExpiredPhotoPreparations(now = new Date()): Promise<{ deleted: number }> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { deleted: 0 };
  const { data, error } = await supabase.rpc("sweep_vibode_photo_preparations", {
    p_now: now.toISOString(),
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("photo_preparation_sweep_failed");
  }
  const paths = Array.isArray((data as { paths?: unknown }).paths)
    ? (data as { paths: unknown[] }).paths
    : [];
  let deleted = 0;
  for (const path of paths) {
    if (typeof path !== "string" || !isPhotoPreparationObjectPath(path)) continue;
    const removed = await supabase.storage.from(PHOTO_PREPARATION_BUCKET).remove([path]);
    if (!removed.error) deleted += 1;
  }
  return { deleted };
}
