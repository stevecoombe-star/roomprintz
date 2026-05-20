import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabaseClient = SupabaseClient;

type StorageRef = {
  bucket: string;
  path: string;
};

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decodePathValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseFromBucketPath(raw: string): StorageRef | null {
  const normalized = raw.trim().replace(/^\/+/, "");
  if (!normalized) return null;
  if (/^(https?:|data:|blob:)/i.test(normalized)) return null;
  const [bucket, ...rest] = normalized.split("/");
  const path = rest.join("/");
  if (!bucket || !path) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(bucket)) return null;
  return {
    bucket: decodePathValue(bucket),
    path: decodePathValue(path),
  };
}

function parseFromUrl(rawUrl: string): StorageRef | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const objectIndex = parts.indexOf("object");
  if (objectIndex < 0) return null;

  const nextPart = parts[objectIndex + 1] ?? "";
  const offset = nextPart === "sign" || nextPart === "public" || nextPart === "authenticated" ? 2 : 1;
  const bucket = parts[objectIndex + offset];
  const pathParts = parts.slice(objectIndex + offset + 1);
  if (!bucket || pathParts.length === 0) return null;

  return {
    bucket: decodePathValue(bucket),
    path: decodePathValue(pathParts.join("/")),
  };
}

export function parsePlacementStorageRef(
  storagePath: string | null | undefined,
  candidateUrl?: string | null | undefined
): StorageRef | null {
  const pathRaw = safeStr(storagePath);
  if (pathRaw) {
    if (pathRaw.startsWith("storage://")) {
      const parsed = parseFromBucketPath(pathRaw.slice("storage://".length));
      if (parsed) return parsed;
    }
    const parsed = parseFromBucketPath(pathRaw);
    if (parsed) return parsed;
    const fromUrl = parseFromUrl(pathRaw);
    if (fromUrl) return fromUrl;
  }

  const urlRaw = safeStr(candidateUrl);
  if (!urlRaw) return null;
  return parseFromUrl(urlRaw);
}

export function isLikelyExpiringSignedImageUrl(url: string | null | undefined): boolean {
  const raw = safeStr(url);
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.pathname.includes("/storage/v1/object/sign/")) return true;
  if (parsed.searchParams.has("token")) return true;
  if (parsed.searchParams.has("X-Amz-Signature")) return true;
  if (parsed.searchParams.has("X-Amz-Credential")) return true;
  return false;
}

export async function resolvePlacementDisplayImageUrl(args: {
  supabase: AnySupabaseClient;
  storagePath?: string | null;
  candidateUrl?: string | null;
  expiresInSeconds?: number;
}): Promise<string | null> {
  const candidateUrl = safeStr(args.candidateUrl);
  const storageRef = parsePlacementStorageRef(args.storagePath, candidateUrl);
  if (!storageRef) return candidateUrl;

  const expiresInSeconds = Math.max(60, Math.round(args.expiresInSeconds ?? 60 * 60 * 8));
  try {
    const { data, error } = await args.supabase.storage
      .from(storageRef.bucket)
      .createSignedUrl(storageRef.path, expiresInSeconds);
    if (!error && data?.signedUrl) return data.signedUrl;
  } catch {
    // fall through to candidate
  }

  return candidateUrl;
}
