import type { SupabaseClient } from "@supabase/supabase-js";

type JsonObject = Record<string, unknown>;

type AnySupabaseClient = SupabaseClient;

export type VibodeRoomRow = {
  id: string;
  user_id: string;
  title: string;
  folder_id: string | null;
  status: string;
  source_type: string;
  aspect_ratio: string | null;
  selected_model: string | null;
  base_asset_id: string | null;
  active_asset_id: string | null;
  current_stage: number;
  cover_image_url: string | null;
  last_opened_at: string | null;
  sort_key: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type VibodeRoomAssetRow = {
  id: string;
  room_id: string;
  user_id: string;
  asset_type: string;
  stage_number: number | null;
  storage_bucket: string | null;
  storage_path: string | null;
  thumbnail_storage_bucket: string | null;
  thumbnail_storage_path: string | null;
  image_url: string;
  width: number | null;
  height: number | null;
  model_version: string | null;
  is_active: boolean;
  metadata: JsonObject;
  created_at: string;
};

export type VibodeGenerationRunRow = {
  id: string;
  room_id: string;
  user_id: string;
  run_type: string;
  stage_number: number | null;
  source_asset_id: string | null;
  output_asset_id: string | null;
  model_version: string | null;
  aspect_ratio: string | null;
  status: string;
  request_payload: JsonObject;
  response_payload: JsonObject;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export type CreateVibodeRoomInput = {
  user_id: string;
  title?: string;
  status?: string;
  source_type?: string;
  aspect_ratio?: string | null;
  selected_model?: string | null;
  metadata?: JsonObject;
};

export type CreateVibodeRoomAssetInput = {
  room_id: string;
  user_id: string;
  asset_type: string;
  stage_number?: number | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  thumbnail_storage_bucket?: string | null;
  thumbnail_storage_path?: string | null;
  image_url: string;
  width?: number | null;
  height?: number | null;
  model_version?: string | null;
  is_active?: boolean;
  metadata?: JsonObject;
};

export type UpdateVibodeRoomAssetInput = {
  storage_bucket?: string | null;
  storage_path?: string | null;
  thumbnail_storage_bucket?: string | null;
  thumbnail_storage_path?: string | null;
  image_url?: string;
  width?: number | null;
  height?: number | null;
  model_version?: string | null;
  is_active?: boolean;
  metadata?: JsonObject;
};

export type UpdateVibodeRoomInput = {
  title?: string;
  folder_id?: string | null;
  status?: string;
  source_type?: string;
  aspect_ratio?: string | null;
  selected_model?: string | null;
  base_asset_id?: string | null;
  active_asset_id?: string | null;
  current_stage?: number;
  cover_image_url?: string | null;
  last_opened_at?: string | null;
  sort_key?: string;
  metadata?: JsonObject;
};

export type CreateVibodeGenerationRunInput = {
  room_id: string;
  user_id: string;
  run_type: string;
  stage_number?: number | null;
  source_asset_id?: string | null;
  output_asset_id?: string | null;
  model_version?: string | null;
  aspect_ratio?: string | null;
  status?: string;
  request_payload?: JsonObject;
  response_payload?: JsonObject;
  error_message?: string | null;
  completed_at?: string | null;
};

export async function createVibodeRoom(
  supabase: AnySupabaseClient,
  input: CreateVibodeRoomInput
): Promise<VibodeRoomRow> {
  const { data, error } = await supabase.from("vibode_rooms").insert(input).select("*").single();
  if (error || !data) {
    throw new Error(`[vibode] failed to create room: ${error?.message ?? "unknown error"}`);
  }
  return data as VibodeRoomRow;
}

export async function getVibodeRoomById(
  supabase: AnySupabaseClient,
  roomId: string
): Promise<VibodeRoomRow | null> {
  const { data, error } = await supabase.from("vibode_rooms").select("*").eq("id", roomId).maybeSingle();
  if (error) {
    throw new Error(`[vibode] failed to fetch room: ${error.message}`);
  }
  return (data as VibodeRoomRow | null) ?? null;
}

export async function createVibodeRoomAsset(
  supabase: AnySupabaseClient,
  input: CreateVibodeRoomAssetInput
): Promise<VibodeRoomAssetRow> {
  const { data, error } = await supabase
    .from("vibode_room_assets")
    .insert(input)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`[vibode] failed to create room asset: ${error?.message ?? "unknown error"}`);
  }
  return data as VibodeRoomAssetRow;
}

export async function updateVibodeRoomAsset(
  supabase: AnySupabaseClient,
  assetId: string,
  input: UpdateVibodeRoomAssetInput
): Promise<VibodeRoomAssetRow> {
  const { data, error } = await supabase
    .from("vibode_room_assets")
    .update(input)
    .eq("id", assetId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`[vibode] failed to update room asset: ${error?.message ?? "unknown error"}`);
  }
  return data as VibodeRoomAssetRow;
}

export async function updateVibodeRoom(
  supabase: AnySupabaseClient,
  roomId: string,
  input: UpdateVibodeRoomInput
): Promise<VibodeRoomRow> {
  const { data, error } = await supabase
    .from("vibode_rooms")
    .update(input)
    .eq("id", roomId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`[vibode] failed to update room: ${error?.message ?? "unknown error"}`);
  }
  return data as VibodeRoomRow;
}

export async function createVibodeGenerationRun(
  supabase: AnySupabaseClient,
  input: CreateVibodeGenerationRunInput
): Promise<VibodeGenerationRunRow> {
  const { data, error } = await supabase
    .from("vibode_generation_runs")
    .insert(input)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `[vibode] failed to create generation run: ${error?.message ?? "unknown error"}`
    );
  }
  return data as VibodeGenerationRunRow;
}
