import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { parseUuid } from "@/lib/afc-v2-production/production-http";

import { isAfcDiagnosticSessionIntent } from "./contracts";
import type { AfcQaAccessConfig } from "./qa-access";
import {
  ensureAfcDiagnosticSessionMembership,
  parseAfcOriginalSha256,
} from "./session-lifecycle.server";

/**
 * Read-only view of the room's current terminal AFC generation.
 * Used when an authorized tester has a STAGE room that was analyzed
 * before that tester was on the QA allowlist.
 */
export type AfcQaOwnedCurrentGeneration = Readonly<{
  generationId: string;
  status: "ready" | "failed";
  intent: string;
  originalSha256: string;
  baseAssetId: string | null;
}>;

export async function readOwnedCurrentTerminalGeneration(input: {
  userId: string;
  roomId: string;
}): Promise<AfcQaOwnedCurrentGeneration | null> {
  const client = getServiceRoleSupabaseClient();
  if (!client) return null;
  const userId = parseUuid(input.userId)?.toLowerCase() ?? null;
  const roomId = parseUuid(input.roomId)?.toLowerCase() ?? null;
  if (!userId || !roomId) return null;
  try {
    const room = await client
      .from("vibode_rooms")
      .select("id, user_id, current_afc_generation_id, base_asset_id")
      .eq("id", roomId)
      .maybeSingle();
    if (room.error || !room.data) return null;
    if (String(room.data.user_id).toLowerCase() !== userId) return null;
    const generationId = parseUuid(room.data.current_afc_generation_id)?.toLowerCase() ?? null;
    if (!generationId) return null;
    const generation = await client
      .from("vibode_afc_generations")
      .select("id, user_id, room_id, status, intent, original_sha256")
      .eq("id", generationId)
      .maybeSingle();
    if (generation.error || !generation.data) return null;
    const row = generation.data;
    if (String(row.user_id).toLowerCase() !== userId) return null;
    if (String(row.room_id).toLowerCase() !== roomId) return null;
    if (row.status !== "ready" && row.status !== "failed") return null;
    const originalSha256 = parseAfcOriginalSha256(row.original_sha256);
    if (!originalSha256 || !isAfcDiagnosticSessionIntent(row.intent)) return null;
    const baseAssetId = parseUuid(room.data.base_asset_id)?.toLowerCase() ?? null;
    return {
      generationId,
      status: row.status,
      intent: row.intent,
      originalSha256,
      baseAssetId,
    };
  } catch {
    return null;
  }
}

export async function prepareCurrentGenerationDiagnosticMembership(
  input: {
    userId: string;
    roomId: string;
    generationId: string;
    qaAccess?: AfcQaAccessConfig;
  },
  dependencies?: {
    readCurrent?: typeof readOwnedCurrentTerminalGeneration;
    ensureMembership?: typeof ensureAfcDiagnosticSessionMembership;
  },
): Promise<void> {
  const requested = parseUuid(input.generationId)?.toLowerCase() ?? null;
  if (!requested) return;
  const readCurrent = dependencies?.readCurrent ?? readOwnedCurrentTerminalGeneration;
  const current = await readCurrent({
    userId: input.userId,
    roomId: input.roomId,
  });
  if (!current || current.generationId !== requested) return;
  const ensureMembership = dependencies?.ensureMembership ?? ensureAfcDiagnosticSessionMembership;
  await ensureMembership(
    {
      userId: input.userId,
      roomId: input.roomId,
      originalSha256: current.originalSha256,
      baseAssetId: current.baseAssetId,
      generationId: current.generationId,
      intent: current.intent,
    },
    { qaAccess: input.qaAccess },
  );
}
