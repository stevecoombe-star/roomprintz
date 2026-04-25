import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabaseClient = SupabaseClient;

const SIGNED_URL_EXPIRES_IN_SEC = 60 * 60 * 24;
const STORAGE_PATH_PATTERNS = [
  /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/i,
  /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/i,
  /^\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/i,
];

type ParsedStorageRef = {
  bucket: string;
  path: string;
};

function normalizeOptionalString(value: unknown): string | null {
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

function asPathSegments(value: string): string[] {
  return value
    .split("/")
    .map((segment) => decodePathValue(segment.trim()))
    .filter((segment) => segment.length > 0);
}

function parseBucketAndPath(value: string): ParsedStorageRef | null {
  const segments = asPathSegments(value);
  if (segments.length < 2) return null;
  const [bucket, ...rest] = segments;
  const path = rest.join("/");
  if (!bucket || !path) return null;
  return { bucket, path };
}

function parseSupabaseStoragePathname(pathname: string): ParsedStorageRef | null {
  for (const pattern of STORAGE_PATH_PATTERNS) {
    const match = pathname.match(pattern);
    if (!match) continue;
    const bucket = decodePathValue(match[1] ?? "");
    const path = decodePathValue(match[2] ?? "");
    if (!bucket || !path) return null;
    return { bucket, path };
  }
  return null;
}

function parseStorageRef(raw: string): ParsedStorageRef | null {
  if (raw.startsWith("data:")) return null;

  if (raw.startsWith("storage://")) {
    return parseBucketAndPath(raw.slice("storage://".length));
  }

  const maybeUrl = (() => {
    try {
      return new URL(raw);
    } catch {
      return null;
    }
  })();

  if (maybeUrl) {
    const fromPathname = parseSupabaseStoragePathname(maybeUrl.pathname);
    if (fromPathname) return fromPathname;
    return null;
  }

  return null;
}

export async function resolveMyFurnitureImageUrl(
  supabase: AnySupabaseClient,
  value: unknown
): Promise<string | null> {
  const input = normalizeOptionalString(value);
  if (!input) return null;

  const storageRef = parseStorageRef(input);
  if (!storageRef) return input;

  try {
    const { data, error } = await supabase.storage
      .from(storageRef.bucket)
      .createSignedUrl(storageRef.path, SIGNED_URL_EXPIRES_IN_SEC);
    if (error || !data?.signedUrl) return input;
    return data.signedUrl;
  } catch {
    return input;
  }
}
