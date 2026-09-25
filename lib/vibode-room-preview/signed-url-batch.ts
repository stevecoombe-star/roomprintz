import { ROOM_PREVIEW_BATCH_MAX } from "@/lib/vibode-room-preview/batch-limit";

const SIGN_PATH_CHUNK = ROOM_PREVIEW_BATCH_MAX;
const DEFAULT_REUSE_MS = 30 * 60 * 1000;
const EXPIRY_SKEW_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;

export type SignedUrlReuseEntry = {
  url: string;
  freshUntil: number;
};

export type SignedUrlReuseCache = Map<string, SignedUrlReuseEntry>;

const sharedCache: SignedUrlReuseCache = new Map();

export function sharedSignedUrlReuseCache(): SignedUrlReuseCache {
  return sharedCache;
}

export function previewObjectSignKey(bucket: string, storagePath: string): string {
  return `${bucket}\n${storagePath}`;
}

export type SignedUrlBatchRow = {
  path: string | null;
  signedUrl: string | null;
  error: string | null;
};

function chunkValues<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function evictSignedUrlCache(cache: SignedUrlReuseCache, nowMs: number) {
  if (cache.size < MAX_CACHE_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (entry.freshUntil <= nowMs) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Sign storage paths a few times per bucket, and reuse a URL while it is
 * still fresh. Supabase tokens include a new `iat` on every call, so the
 * only way to keep the browser cache key stable is to return the same URL.
 */
export async function signPreviewTargets(args: {
  targets: readonly { bucket: string; storagePath: string }[];
  expiresInSec: number;
  nowMs?: number;
  reuseMs?: number;
  cache?: SignedUrlReuseCache;
  createSignedUrls: (
    bucket: string,
    paths: string[],
    expiresInSec: number,
  ) => Promise<readonly SignedUrlBatchRow[]>;
}): Promise<Map<string, string>> {
  const nowMs = args.nowMs ?? Date.now();
  const cache = args.cache ?? sharedCache;
  const reuseMs = Math.min(
    args.reuseMs ?? DEFAULT_REUSE_MS,
    Math.max(0, args.expiresInSec * 1000 - EXPIRY_SKEW_MS),
  );
  const signed = new Map<string, string>();
  const pendingByBucket = new Map<string, Map<string, string>>();

  for (const target of args.targets) {
    const bucket = target.bucket.trim();
    const storagePath = target.storagePath.trim();
    if (!bucket || !storagePath) continue;
    const key = previewObjectSignKey(bucket, storagePath);
    if (signed.has(key)) continue;
    const cached = cache.get(key);
    if (cached && cached.freshUntil > nowMs) {
      signed.set(key, cached.url);
      continue;
    }
    const pending = pendingByBucket.get(bucket) ?? new Map<string, string>();
    pending.set(storagePath, key);
    pendingByBucket.set(bucket, pending);
  }

  for (const [bucket, pathsByKey] of pendingByBucket) {
    const paths = [...pathsByKey.keys()];
    for (const pathChunk of chunkValues(paths, SIGN_PATH_CHUNK)) {
      let rows: readonly SignedUrlBatchRow[] = [];
      try {
        rows = await args.createSignedUrls(bucket, pathChunk, args.expiresInSec);
      } catch (err) {
        console.warn("[vibode/room-preview] batch signing failed:", err);
        continue;
      }
      for (const row of rows) {
        if (!row.path || !row.signedUrl || row.error) continue;
        const key = pathsByKey.get(row.path);
        if (!key) continue;
        signed.set(key, row.signedUrl);
        if (reuseMs > 0) {
          cache.set(key, { url: row.signedUrl, freshUntil: nowMs + reuseMs });
        }
      }
    }
  }

  evictSignedUrlCache(cache, nowMs);
  return signed;
}
