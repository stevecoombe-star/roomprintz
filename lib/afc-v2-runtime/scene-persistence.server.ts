import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
} from "@/lib/afc-v2-production/production-persistence.server";

import {
  PI4C_SCENE_TABLE,
  authorizeOwned3dSceneContext,
  validatePersistedVersionScene,
  type Owned3dSceneAuthorization,
  type PersistedVersionScene,
} from "./persisted-scene";
import { AFC_V2_RUNTIME_COORDINATE_SPACE } from "./types";

type AnySupabase = SupabaseClient;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function rowToScene(row: Record<string, unknown>): PersistedVersionScene | null {
  const parsed = validatePersistedVersionScene({
    roomId: row.room_id,
    versionId: row.version_id,
    afcGenerationId: row.afc_generation_id,
    coordinateSpace: row.coordinate_space,
    objects: row.objects_json,
  });
  return parsed.ok ? parsed.scene : null;
}

export async function authorizeOwnedVersionScene(input: Readonly<{
  userId: string;
  roomId: string;
  versionId: string;
  afcGenerationId: string;
}>): Promise<Owned3dSceneAuthorization> {
  const store = createProductionAfcStoreFromEnv();
  const supabase = getServiceRoleSupabaseClient();
  if (!store || !supabase) {
    return { ok: false, status: 500, error: "Server misconfigured." };
  }

  const room = await store.getRoom(input.roomId);
  const generation = await store.getGeneration(input.afcGenerationId);
  const { data: version } = await supabase
    .from("vibode_room_assets")
    .select("id, room_id, user_id")
    .eq("id", input.versionId)
    .maybeSingle();

  return authorizeOwned3dSceneContext({
    userId: input.userId,
    room: room
      ? {
          id: room.id,
          userId: room.userId,
          currentAfcGenerationId: room.currentAfcGenerationId,
        }
      : null,
    version: version && isRecord(version)
      ? {
          id: String(version.id),
          roomId: String(version.room_id),
          userId: String(version.user_id),
        }
      : null,
    generation: generation
      ? {
          id: generation.id,
          roomId: generation.roomId,
          userId: generation.userId,
          status: generation.status,
        }
      : null,
    requestedRoomId: input.roomId,
    requestedVersionId: input.versionId,
    requestedAfcGenerationId: input.afcGenerationId,
  });
}

export async function loadOwnedVersionScene(input: Readonly<{
  userId: string;
  roomId: string;
  versionId: string;
  afcGenerationId: string;
}>): Promise<
  | { ok: true; found: false }
  | { ok: true; found: true; scene: PersistedVersionScene }
  | { ok: true; found: true; malformed: true }
  | { ok: false; status: 400 | 401 | 404 | 500; error: string }
> {
  const authorized = await authorizeOwnedVersionScene(input);
  if (!authorized.ok) return authorized;
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    return { ok: false, status: 500, error: "Server misconfigured." };
  }
  const { data, error } = await supabase
    .from(PI4C_SCENE_TABLE)
    .select("room_id, version_id, afc_generation_id, coordinate_space, objects_json")
    .eq("room_id", input.roomId)
    .eq("version_id", input.versionId)
    .maybeSingle();
  if (error) {
    return { ok: false, status: 400, error: "Failed to load 3D scene." };
  }
  if (!data) return { ok: true, found: false };
  const scene = rowToScene(data as Record<string, unknown>);
  if (!scene) return { ok: true, found: true, malformed: true };
  return { ok: true, found: true, scene };
}

export async function saveOwnedVersionScene(input: Readonly<{
  userId: string;
  scene: PersistedVersionScene;
}>): Promise<
  | { ok: true; scene: PersistedVersionScene }
  | { ok: false; status: 400 | 401 | 404 | 500; error: string }
> {
  const authorized = await authorizeOwnedVersionScene({
    userId: input.userId,
    roomId: input.scene.roomId,
    versionId: input.scene.versionId,
    afcGenerationId: input.scene.afcGenerationId,
  });
  if (!authorized.ok) return authorized;
  const supabase: AnySupabase | null = getServiceRoleSupabaseClient();
  if (!supabase) {
    return { ok: false, status: 500, error: "Server misconfigured." };
  }
  const { data, error } = await supabase
    .from(PI4C_SCENE_TABLE)
    .upsert(
      {
        room_id: input.scene.roomId,
        version_id: input.scene.versionId,
        user_id: input.userId,
        afc_generation_id: input.scene.afcGenerationId,
        coordinate_space: AFC_V2_RUNTIME_COORDINATE_SPACE,
        objects_json: input.scene.objects,
      },
      { onConflict: "room_id,version_id" },
    )
    .select("room_id, version_id, afc_generation_id, coordinate_space, objects_json")
    .single();
  if (error || !data) {
    return { ok: false, status: 400, error: "Failed to save 3D scene." };
  }
  const scene = rowToScene(data as Record<string, unknown>);
  if (!scene) {
    return { ok: false, status: 400, error: "Saved 3D scene was malformed." };
  }
  return { ok: true, scene };
}
