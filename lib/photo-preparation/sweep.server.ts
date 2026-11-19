/**
 * Deletes expired scratch photographs for every account. The generation
 * worker calls this after its own pass. A failure here must not stop that pass.
 * A storage delete that fails does not retire the cleanup row.
 */

import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import { PHOTO_PREPARATION_BUCKET, isPhotoPreparationObjectPath } from "./limits";

export type PhotoSweepClient = Readonly<{
  sweep: (now: Date) => Promise<readonly string[]>;
  orphans: (now: Date) => Promise<readonly string[]>;
  remove: (objectPath: string) => Promise<boolean>;
  confirm: (objectPath: string, now: Date) => Promise<void>;
}>;

export function storageRemovalSucceeded(error: { message?: string } | null | undefined): boolean {
  if (!error) return true;
  return /not found|does not exist|404/i.test(error.message ?? "");
}

export async function sweepExpiredPhotoPreparations(
  now = new Date(),
  client?: PhotoSweepClient,
): Promise<{ deleted: number; orphans: number }> {
  const active = client ?? supabaseSweepClient();
  if (!active) return { deleted: 0, orphans: 0 };
  const paths = await active.sweep(now);
  let deleted = 0;
  for (const path of paths) {
    if (!isPhotoPreparationObjectPath(path)) continue;
    try {
      if (!await active.remove(path)) continue;
      await active.confirm(path, now);
      deleted += 1;
    } catch {
      // The cleanup row stays due, so the next pass retries this object.
    }
  }
  const extra = await active.orphans(now);
  let orphans = 0;
  for (const path of extra) {
    if (!isPhotoPreparationObjectPath(path)) continue;
    try {
      if (await active.remove(path)) orphans += 1;
    } catch {
      // The object stays visible to the next bounded pass.
    }
  }
  return { deleted, orphans };
}

function supabaseSweepClient(): PhotoSweepClient | null {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return null;
  return {
    sweep: (now) => readPaths(supabase, "sweep_vibode_photo_preparations", now),
    orphans: (now) => readPaths(supabase, "list_orphan_vibode_photo_preparations", now),
    remove: async (objectPath) => {
      if (!isPhotoPreparationObjectPath(objectPath)) return false;
      const removed = await supabase.storage.from(PHOTO_PREPARATION_BUCKET).remove([objectPath]);
      return storageRemovalSucceeded(removed.error);
    },
    confirm: async (objectPath, now) => {
      const { error } = await supabase.rpc("confirm_vibode_photo_preparation_cleared", {
        p_object_path: objectPath,
        p_now: now.toISOString(),
      });
      if (error) throw new Error("photo_preparation_sweep_failed");
    },
  };
}

async function readPaths(
  supabase: NonNullable<ReturnType<typeof getServiceRoleSupabaseClient>>,
  fn: string,
  now: Date,
): Promise<string[]> {
  const { data, error } = await supabase.rpc(fn, { p_now: now.toISOString() });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("photo_preparation_sweep_failed");
  }
  const paths = (data as { paths?: unknown }).paths;
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : [];
}
