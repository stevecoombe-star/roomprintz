import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  harmonizeHistoryAccess,
  type HarmonizeHistoryAccess,
} from "@/lib/vibode-stage/harmonize-experience";

type ServiceClient = SupabaseClient;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Owner-scoped read of a published Harmonize capture.
 * Generation mode, enqueue, and recovery are not consulted.
 */
export async function readHarmonizeHistoryView(input: Readonly<{
  userId: string;
  roomId: string;
  assetId: string;
}>): Promise<{ ok: true; access: HarmonizeHistoryAccess } | { ok: false }> {
  const supabase: ServiceClient | null = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false };
  const assetResult = await supabase
    .from("vibode_room_assets")
    .select("id, room_id, user_id, harmonize_job_id, is_active")
    .eq("id", input.assetId)
    .eq("room_id", input.roomId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (assetResult.error) return { ok: false };
  const assetRow = assetResult.data as Record<string, unknown> | null;
  if (!assetRow) return { ok: true, access: { status: "hidden" } };

  const harmonizeJobId = text(assetRow.harmonize_job_id);
  let job: {
    id: string;
    userId: string;
    roomId: string;
    outputAssetId: string | null;
    sourceVersionId: string | null;
    afcGenerationId: string | null;
    backdropKind: string | null;
    historyState: string | null;
    status: string;
  } | null = null;
  if (harmonizeJobId) {
    const jobResult = await supabase
      .from("vibode_harmonize_generations")
      .select(
        "id, user_id, room_id, output_asset_id, source_version_id, afc_generation_id, backdrop_kind, history_state, status",
      )
      .eq("id", harmonizeJobId)
      .eq("user_id", input.userId)
      .eq("room_id", input.roomId)
      .maybeSingle();
    if (jobResult.error) return { ok: false };
    const jobRow = jobResult.data as Record<string, unknown> | null;
    const id = text(jobRow?.id);
    const userId = text(jobRow?.user_id);
    const roomId = text(jobRow?.room_id);
    const status = text(jobRow?.status);
    if (jobRow && id && userId && roomId && status) {
      job = {
        id,
        userId,
        roomId,
        outputAssetId: text(jobRow.output_asset_id),
        sourceVersionId: text(jobRow.source_version_id),
        afcGenerationId: text(jobRow.afc_generation_id),
        backdropKind: text(jobRow.backdrop_kind),
        historyState: text(jobRow.history_state),
        status,
      };
    }
  }

  const id = text(assetRow.id);
  const roomId = text(assetRow.room_id);
  const userId = text(assetRow.user_id);
  if (!id || !roomId || !userId) return { ok: false };
  return {
    ok: true,
    access: harmonizeHistoryAccess({
      callerUserId: input.userId,
      roomId: input.roomId,
      assetId: input.assetId,
      asset: {
        id,
        roomId,
        userId,
        harmonizeJobId,
        isActive: assetRow.is_active === true,
      },
      job,
    }),
  };
}
