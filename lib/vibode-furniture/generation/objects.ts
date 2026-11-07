/**
 * Private generation object paths. Personal asset paths are refused.
 */

import { PERSONAL_FURNITURE_BUCKET } from "@/lib/vibode-furniture/asset-id";

import { GENERATION_INPUT_BUCKET } from "./policy";
import { pathOwnedBy } from "./output";
import type { BucketObjectStore } from "./contracts";

const INPUT_PATH =
  /^users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/inputs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(front|left|right|back)\.(jpg|png|webp)$/;

const CANDIDATE_PATH =
  /^users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/generations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/candidate\.glb$/;

export function generationObjectAllowed(bucket: string, path: string, ownerUserId: string): boolean {
  if (!pathOwnedBy(path, ownerUserId) || path.includes("/assets/")) return false;
  if (bucket === GENERATION_INPUT_BUCKET) return INPUT_PATH.test(path);
  if (bucket === PERSONAL_FURNITURE_BUCKET) return CANDIDATE_PATH.test(path);
  return false;
}

export function createMemoryBucketStore(): BucketObjectStore {
  const objects = new Map<string, Uint8Array>();
  const key = (bucket: string, path: string) => `${bucket}\n${path}`;
  return {
    async put(input) {
      if (!generationObjectAllowed(input.bucket, input.path, ownerFromPath(input.path))) {
        throw new Error("generation_object_rejected");
      }
      objects.set(key(input.bucket, input.path), Uint8Array.from(input.bytes));
    },
    async get(input) {
      if (!generationObjectAllowed(input.bucket, input.path, ownerFromPath(input.path))) return null;
      const found = objects.get(key(input.bucket, input.path));
      return found ? Uint8Array.from(found) : null;
    },
    async remove(input) {
      if (!generationObjectAllowed(input.bucket, input.path, ownerFromPath(input.path))) return;
      objects.delete(key(input.bucket, input.path));
    },
    async sign(input) {
      if (!generationObjectAllowed(input.bucket, input.path, input.ownerUserId)) return null;
      if (!objects.has(key(input.bucket, input.path))) return null;
      return `signed://vibode-private/${input.bucket}/${input.path}`;
    },
  };
}

function ownerFromPath(path: string): string {
  const parts = path.split("/");
  return parts[1] ?? "";
}
