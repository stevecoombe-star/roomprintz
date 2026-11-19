/**
 * Service-role wiring for photo preparation. The browser receives a signed
 * upload URL and never receives this credential.
 */

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { MAX_OUTPUT_BYTES } from "@/lib/prepareRoomImageForUpload";
import { authorizeFurnitureGenerationCaller } from "@/lib/vibode-furniture/generation/production.server";
import { FURNITURE_PHOTO_MAX_OUTPUT_BYTES } from "@/lib/vibode-furniture/generator/photo-limits";

import type { PhotoPreparationDeps, PhotoPurpose } from "./handler";
import { PHOTO_PREPARATION_BUCKET, photoPreparationPathOwnedBy } from "./limits";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export function createPhotoPreparationDeps(supabase: SupabaseClient): PhotoPreparationDeps {
  return {
    now: () => new Date(),
    authorize: (request, purpose) => authorizePhotoPreparation(request, purpose),
    sweep: async (now) => readPaths(await rpc(supabase, "sweep_vibode_photo_preparations", { p_now: now.toISOString() })),
    removeObject: async (objectPath) => {
      if (!isOwnedPath(objectPath)) return;
      await supabase.storage.from(PHOTO_PREPARATION_BUCKET).remove([objectPath]);
    },
    begin: async (input) => {
      const row = await rpc(supabase, "begin_vibode_photo_preparation", {
        p_user_id: input.userId,
        p_purpose: input.purpose,
        p_byte_size: input.byteSize,
        p_now: input.now.toISOString(),
      });
      if (row.ok !== true) return { ok: false, code: failureCode(row.code) };
      const preparationId = text(row.preparationId);
      const objectPath = text(row.objectPath);
      if (!preparationId || !objectPath) return { ok: false, code: "unavailable" };
      return { ok: true, preparationId, objectPath };
    },
    signUpload: async (objectPath) => {
      if (!isOwnedPath(objectPath)) return null;
      const signed = await supabase.storage.from(PHOTO_PREPARATION_BUCKET).createSignedUploadUrl(objectPath, {
        upsert: false,
      });
      const signedUrl = signed.data?.signedUrl?.trim() ?? "";
      if (signed.error || !signedUrl.startsWith("https://")) return null;
      return { signedUrl };
    },
    close: async (input) => {
      const row = await rpc(supabase, "close_vibode_photo_preparation", {
        p_user_id: input.userId,
        p_preparation_id: input.preparationId,
        p_now: input.now.toISOString(),
      });
      if (row.ok !== true) {
        return { ok: false, code: row.code === "busy" ? "busy" : row.code === "not_found" ? "not_found" : "unavailable" };
      }
      return { ok: true, objectPath: text(row.objectPath) };
    },
    claim: async (input) => {
      const row = await rpc(supabase, "claim_vibode_photo_preparation", {
        p_user_id: input.userId,
        p_preparation_id: input.preparationId,
        p_now: input.now.toISOString(),
      });
      if (row.ok !== true) return { ok: false, code: claimCode(row.code) };
      const objectPath = text(row.objectPath);
      const purpose = row.purpose === "room" || row.purpose === "furniture" ? row.purpose : null;
      const byteSize = typeof row.byteSize === "number" ? row.byteSize : Number.NaN;
      if (!objectPath || !purpose || !Number.isInteger(byteSize)) return { ok: false, code: "unavailable" };
      return { ok: true, objectPath, byteSize, purpose };
    },
    download: async (objectPath) => {
      if (!isOwnedPath(objectPath)) return null;
      const downloaded = await supabase.storage.from(PHOTO_PREPARATION_BUCKET).download(objectPath);
      if (downloaded.error || !downloaded.data) return null;
      return new Uint8Array(await downloaded.data.arrayBuffer());
    },
    convert: async () => {
      throw new Error("photo_preparation_converter_unwired");
    },
    finish: async (input) => {
      const row = await rpc(supabase, "finish_vibode_photo_preparation", {
        p_user_id: input.userId,
        p_preparation_id: input.preparationId,
        p_now: input.now.toISOString(),
      });
      if (row.ok !== true) return { ok: false, code: "not_found" };
      return { ok: true, objectPath: text(row.objectPath) };
    },
    outputLimit: (purpose) => purpose === "room" ? MAX_OUTPUT_BYTES : FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  };
}

export function photoPreparationDeps(): PhotoPreparationDeps | null {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return null;
  return createPhotoPreparationDeps(supabase);
}

async function authorizePhotoPreparation(request: Request, purpose: PhotoPurpose) {
  if (purpose === "furniture") {
    const caller = await authorizeFurnitureGenerationCaller(request);
    if (!caller.ok) return { ok: false as const, status: caller.response.status, error: caller.response.body.error };
    return { ok: true as const, userId: caller.userId };
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: false as const, status: 500, error: "Server misconfigured." };
  const header = request.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return { ok: false as const, status: 401, error: "Unauthorized." };
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return { ok: false as const, status: 401, error: "Unauthorized." };
  return { ok: true as const, userId: data.user.id };
}

async function rpc(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, code: "unavailable" };
  }
  return data as Record<string, unknown>;
}

function readPaths(row: Record<string, unknown>): string[] {
  if (row.ok !== true || !Array.isArray(row.paths)) return [];
  return row.paths.filter((path): path is string => typeof path === "string" && isOwnedPath(path));
}

function isOwnedPath(path: string): boolean {
  return photoPreparationPathOwnedBy(path, path.split("/")[1] ?? "");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function failureCode(value: unknown): "invalid" | "too_large" | "capacity" | "rate" | "unavailable" {
  if (value === "invalid" || value === "too_large" || value === "capacity" || value === "rate") return value;
  return "unavailable";
}

function claimCode(value: unknown): "not_found" | "expired" | "busy" | "invalid" | "unavailable" {
  if (value === "not_found" || value === "expired" || value === "busy" || value === "invalid") return value;
  return "unavailable";
}
