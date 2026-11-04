import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { scheduleVibodeThumbnailAfterSceneSave } from "@/lib/vibode-thumbnail-jobs/jobs.server";

/**
 * After a committed Bring Forward save, refresh the active room still.
 * A missing scene or a failed enqueue leaves the selection in place.
 * This does not render a second thumbnail and does not call a provider.
 */
export async function scheduleThumbnailAfterBringForwardCommit(input: Readonly<{
  userId: string;
  roomId: string;
}>): Promise<void> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return;
  const { data: room, error: roomError } = await supabase
    .from("vibode_rooms")
    .select("id, active_asset_id")
    .eq("id", input.roomId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (roomError || !room) return;
  const activeId = typeof room.active_asset_id === "string" ? room.active_asset_id : "";
  let versionId = activeId;
  if (!versionId) {
    const { data: active, error } = await supabase
      .from("vibode_room_assets")
      .select("id")
      .eq("room_id", input.roomId)
      .eq("user_id", input.userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !active || typeof active.id !== "string") return;
    versionId = active.id;
  } else {
    const { data: asset, error } = await supabase
      .from("vibode_room_assets")
      .select("id")
      .eq("id", versionId)
      .eq("room_id", input.roomId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (error || !asset) return;
  }
  await scheduleVibodeThumbnailAfterSceneSave(
    { roomId: input.roomId, versionId },
    { immediate: true },
  );
}
