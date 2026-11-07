/**
 * Private Supabase storage for generation inputs and candidate GLBs.
 * Paths outside the owner prefix, and personal asset paths, are refused
 * before any storage call. Signed URLs are not logged.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BucketObjectStore } from "./contracts";
import { generationObjectAllowed } from "./objects";

const SIGNED_URL_SECONDS = 60;

const CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "model/gltf-binary"]);

export function createSupabaseGenerationObjectStore(supabase: SupabaseClient): BucketObjectStore {
  return {
    async put(input) {
      if (!CONTENT_TYPES.has(input.contentType) || !generationObjectAllowed(input.bucket, input.path, ownerFromPath(input.path))) {
        throw new Error("generation_object_rejected");
      }
      const { error } = await supabase.storage.from(input.bucket).upload(input.path, Buffer.from(input.bytes), {
        contentType: input.contentType,
        upsert: true,
      });
      if (error) throw new Error("generation_object_rejected");
    },
    async get(input) {
      if (!generationObjectAllowed(input.bucket, input.path, ownerFromPath(input.path))) return null;
      const { data, error } = await supabase.storage.from(input.bucket).download(input.path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(input) {
      if (!generationObjectAllowed(input.bucket, input.path, ownerFromPath(input.path))) return;
      await supabase.storage.from(input.bucket).remove([input.path]);
    },
    async sign(input) {
      if (!generationObjectAllowed(input.bucket, input.path, input.ownerUserId)) return null;
      const { data, error } = await supabase.storage.from(input.bucket).createSignedUrl(input.path, SIGNED_URL_SECONDS);
      const signedUrl = data?.signedUrl?.trim() ?? "";
      if (error || !signedUrl) return null;
      return signedUrl;
    },
  };
}

function ownerFromPath(path: string): string {
  return path.split("/")[1] ?? "";
}
