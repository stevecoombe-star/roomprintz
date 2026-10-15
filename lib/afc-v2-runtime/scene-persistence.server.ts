import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
} from "@/lib/afc-v2-production/production-persistence.server";

import { resolveCanonicalImmediateParentVersionId } from "@/lib/vibode/version-lineage";

import { harmonizeSourceSceneResolution } from "@/lib/vibode-stage/harmonize-experience";

import {
  PI4C_SCENE_TABLE,
  authorizeOwned3dSceneContext,
  resolvePersistedSceneCompatibility,
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

async function harmonizeOutputGuard(
  supabase: AnySupabase,
  input: Readonly<{ userId: string; roomId: string; versionId: string }>,
): Promise<"harmonized" | "ordinary" | "error"> {
  const { data, error } = await supabase
    .from("vibode_room_assets")
    .select("id, harmonize_job_id")
    .eq("id", input.versionId)
    .eq("room_id", input.roomId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) return "error";
  const jobId = typeof data?.harmonize_job_id === "string" ? data.harmonize_job_id.trim() : "";
  return jobId ? "harmonized" : "ordinary";
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

function textId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Load the source scene for a published Harmonized image.
 * A missing row stays missing. This path does not inherit or insert.
 */
export async function readOwnedHarmonizeSourceScene(input: Readonly<{
  userId: string;
  roomId: string;
  versionId: string;
  afcGenerationId: string;
  harmonizeAssetId: string;
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
  const assetResult = await supabase
    .from("vibode_room_assets")
    .select("id, room_id, user_id, harmonize_job_id")
    .eq("id", input.harmonizeAssetId)
    .eq("room_id", input.roomId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (assetResult.error) {
    return { ok: false, status: 500, error: "Failed to load 3D scene." };
  }
  const assetRow = assetResult.data as Record<string, unknown> | null;
  const harmonizeJobId = textId(assetRow?.harmonize_job_id);
  let job: {
    id: string;
    userId: string;
    roomId: string;
    sourceVersionId: string | null;
    outputAssetId: string | null;
    historyState: string | null;
    status: string;
  } | null = null;
  if (harmonizeJobId) {
    const jobResult = await supabase
      .from("vibode_harmonize_generations")
      .select("id, user_id, room_id, source_version_id, output_asset_id, history_state, status")
      .eq("id", harmonizeJobId)
      .eq("user_id", input.userId)
      .eq("room_id", input.roomId)
      .maybeSingle();
    if (jobResult.error) {
      return { ok: false, status: 500, error: "Failed to load 3D scene." };
    }
    const jobRow = jobResult.data as Record<string, unknown> | null;
    const id = textId(jobRow?.id);
    const userId = textId(jobRow?.user_id);
    const roomId = textId(jobRow?.room_id);
    const status = textId(jobRow?.status);
    if (jobRow && id && userId && roomId && status) {
      job = {
        id,
        userId,
        roomId,
        sourceVersionId: textId(jobRow.source_version_id),
        outputAssetId: textId(jobRow.output_asset_id),
        historyState: textId(jobRow.history_state),
        status,
      };
    }
  }
  const loaded = await loadSceneRow(supabase, input.roomId, input.versionId);
  if ("ok" in loaded) {
    return { ok: false, status: 500, error: loaded.error };
  }
  const scene = loaded.found
    ? ("malformed" in loaded ? "malformed" : "present")
    : "missing";
  const decision = harmonizeSourceSceneResolution({
    callerUserId: input.userId,
    roomId: input.roomId,
    sourceVersionId: input.versionId,
    harmonizeAssetId: input.harmonizeAssetId,
    asset: assetRow && textId(assetRow.id) && textId(assetRow.room_id) && textId(assetRow.user_id)
      ? {
          id: textId(assetRow.id) as string,
          roomId: textId(assetRow.room_id) as string,
          userId: textId(assetRow.user_id) as string,
          harmonizeJobId,
        }
      : null,
    job,
    scene,
  });
  if (decision === "deny") {
    return { ok: false, status: 404, error: "Not found." };
  }
  if (decision === "missing") {
    return {
      ok: true,
      resolved: {
        status: "none",
        origin: "default",
        scene: null,
        reason: "harmonize-source-missing",
      },
    };
  }
  if (decision === "malformed" || !loaded.found || "malformed" in loaded) {
    return {
      ok: true,
      resolved: {
        status: "malformed",
        origin: "default",
        scene: null,
        reason: "Stored 3D scene cannot be restored.",
      },
    };
  }
  const compatibility = resolvePersistedSceneCompatibility({
    storedAfcGenerationId: loaded.scene.afcGenerationId,
    currentAfcGenerationId: input.afcGenerationId,
  });
  if (!compatibility.ok) {
    return {
      ok: true,
      resolved: {
        status: "incompatible",
        origin: "default",
        scene: null,
        reason: "Stored 3D scene belongs to a different AFC generation.",
        storedAfcGenerationId: loaded.scene.afcGenerationId,
      },
    };
  }
  return {
    ok: true,
    resolved: {
      status: "ready",
      origin: "persisted",
      scene: loaded.scene,
    },
  };
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
  const harmonized = await harmonizeOutputGuard(supabase, input);
  if (harmonized === "error") {
    return { ok: false, status: 500, error: "Failed to load 3D scene." };
  }
  if (harmonized === "harmonized") {
    return {
      ok: true,
      resolved: {
        status: "none",
        origin: "default",
        scene: null,
        reason: "harmonize-output",
      },
    };
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
  const harmonized = await harmonizeOutputGuard(supabase, {
    userId: input.userId,
    roomId: input.scene.roomId,
    versionId: input.scene.versionId,
  });
  if (harmonized === "error") {
    return { ok: false, status: 500, error: "Failed to save 3D scene." };
  }
  if (harmonized === "harmonized") {
    return { ok: false, status: 400, error: "Harmonized images do not have an editable 3D scene." };
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
