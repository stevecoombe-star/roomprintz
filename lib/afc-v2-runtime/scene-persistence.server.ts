import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
} from "@/lib/afc-v2-production/production-persistence.server";

import { resolveCanonicalImmediateParentVersionId } from "@/lib/vibode/version-lineage";

import {
  PI4C_SCENE_TABLE,
  authorizeOwned3dSceneContext,
  validatePersistedVersionScene,
  type Owned3dSceneAuthorization,
  type PersistedVersionScene,
} from "./persisted-scene";
import {
  resolveVersionScene,
  type LoadedSceneRow,
  type ResolvedVersionScene,
} from "./scene-inheritance";
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

async function loadSceneRow(
  supabase: AnySupabase,
  roomId: string,
  versionId: string,
): Promise<LoadedSceneRow | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from(PI4C_SCENE_TABLE)
    .select("room_id, version_id, afc_generation_id, coordinate_space, objects_json")
    .eq("room_id", roomId)
    .eq("version_id", versionId)
    .maybeSingle();
  if (error) {
    return { ok: false, error: "Failed to load 3D scene." };
  }
  if (!data) return { found: false };
  const scene = rowToScene(data as Record<string, unknown>);
  if (!scene) return { found: true, malformed: true };
  return { found: true, scene };
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function asLoadedSceneRow(
  loaded: LoadedSceneRow | { ok: false; error: string },
): LoadedSceneRow {
  if ("ok" in loaded) {
    throw new Error(loaded.error);
  }
  return loaded;
}

async function insertOwnedVersionSceneIfAbsent(input: Readonly<{
  supabase: AnySupabase;
  userId: string;
  scene: PersistedVersionScene;
}>): Promise<{ ok: true; inserted: boolean } | { ok: false; error: string }> {
  const { data, error } = await input.supabase
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
      { onConflict: "room_id,version_id", ignoreDuplicates: true },
    )
    .select("room_id, version_id, afc_generation_id, coordinate_space, objects_json")
    .maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: true, inserted: false };
    }
    return { ok: false, error: "Failed to initialize 3D scene." };
  }
  return { ok: true, inserted: Boolean(data) };
}

async function resolveOwnedParentVersionId(input: Readonly<{
  supabase: AnySupabase;
  userId: string;
  roomId: string;
  versionId: string;
}>): Promise<string | null> {
  const { data: version, error: versionError } = await input.supabase
    .from("vibode_room_assets")
    .select("id, metadata")
    .eq("id", input.versionId)
    .eq("room_id", input.roomId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (versionError || !version || !isRecord(version)) return null;

  const { data: runs, error: runsError } = await input.supabase
    .from("vibode_generation_runs")
    .select("output_asset_id, source_asset_id")
    .eq("room_id", input.roomId)
    .eq("user_id", input.userId)
    .eq("output_asset_id", input.versionId)
    .order("created_at", { ascending: false });
  if (runsError) return null;

  return resolveCanonicalImmediateParentVersionId(
    { id: String(version.id), metadata: version.metadata },
    ((runs ?? []) as Array<{ output_asset_id: string | null; source_asset_id: string | null }>),
  );
}

async function loadOwnedParentVersion(input: Readonly<{
  supabase: AnySupabase;
  parentVersionId: string;
}>): Promise<{ id: string; roomId: string; userId: string } | null> {
  const { data, error } = await input.supabase
    .from("vibode_room_assets")
    .select("id, room_id, user_id")
    .eq("id", input.parentVersionId)
    .maybeSingle();
  if (error || !data || !isRecord(data)) return null;
  return {
    id: String(data.id),
    roomId: String(data.room_id),
    userId: String(data.user_id),
  };
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
  const loaded = await loadSceneRow(supabase, input.roomId, input.versionId);
  if ("ok" in loaded) {
    return { ok: false, status: 400, error: loaded.error };
  }
  if (!loaded.found) {
    return { ok: true, found: false };
  }
  if ("malformed" in loaded) {
    return { ok: true, found: true, malformed: true };
  }
  return { ok: true, found: true, scene: loaded.scene };
}

export async function resolveOwnedVersionScene(input: Readonly<{
  userId: string;
  roomId: string;
  versionId: string;
  afcGenerationId: string;
}>): Promise<
  | { ok: true; resolved: ResolvedVersionScene }
  | { ok: false; status: 400 | 401 | 404 | 500; error: string }
> {
  const authorized = await authorizeOwnedVersionScene(input);
  if (!authorized.ok) return authorized;
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    return { ok: false, status: 500, error: "Server misconfigured." };
  }

  try {
    const resolved = await resolveVersionScene({
      childRoomId: input.roomId,
      childVersionId: input.versionId,
      userId: input.userId,
      currentAfcGenerationId: input.afcGenerationId,
      loadChildScene: async () => asLoadedSceneRow(
        await loadSceneRow(supabase, input.roomId, input.versionId),
      ),
      resolveParentVersionId: () => resolveOwnedParentVersionId({
        supabase,
        userId: input.userId,
        roomId: input.roomId,
        versionId: input.versionId,
      }),
      loadParentVersion: (parentVersionId) => loadOwnedParentVersion({
        supabase,
        parentVersionId,
      }),
      loadParentScene: async (parentVersionId) => asLoadedSceneRow(
        await loadSceneRow(supabase, input.roomId, parentVersionId),
      ),
      insertChildSceneIfAbsent: (scene) => insertOwnedVersionSceneIfAbsent({
        supabase,
        userId: input.userId,
        scene,
      }),
    });
    return { ok: true, resolved };
  } catch {
    return { ok: false, status: 400, error: "Failed to load 3D scene." };
  }
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
