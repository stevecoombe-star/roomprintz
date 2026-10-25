import "server-only";

import { createCleanupServiceClient } from "@/lib/vibode-stage/remove-cleanup-jobs/service-client";

export type RemoveSegmentationReservation =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "user_limit" | "global_limit" | "unavailable" | "not_found" }>;

/**
 * Reserve one SAM 3 attempt before the provider is contacted.
 * A missing function or database error refuses the attempt.
 */
export async function reserveRemoveSegmentation(input: Readonly<{
  userId: string;
  roomId: string;
  generationId: string;
  originalSha256: string;
}>): Promise<RemoveSegmentationReservation> {
  const client = createCleanupServiceClient();
  if (!client) return { ok: false, code: "unavailable" };
  const { data, error } = await client.rpc("reserve_vibode_remove_segmentation", {
    p_user_id: input.userId,
    p_room_id: input.roomId,
    p_generation_id: input.generationId,
    p_original_sha256: input.originalSha256.toLowerCase(),
  });
  if (error || !data || typeof data !== "object") return { ok: false, code: "unavailable" };
  const body = data as { ok?: unknown; code?: unknown };
  if (body.ok === true) return { ok: true };
  if (body.code === "user_limit" || body.code === "global_limit" || body.code === "not_found") {
    return { ok: false, code: body.code };
  }
  return { ok: false, code: "unavailable" };
}
