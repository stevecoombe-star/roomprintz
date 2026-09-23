import "server-only";

import { isOwnedOriginalStoragePath } from "./production-original";
import {
  AFC_V2_PRODUCTION_STORAGE_BUCKET,
  afcGenerationStoragePrefix,
} from "./production-store";

export const AFC_V2_USER_STORAGE_PAGE_SIZE = 1000;
export const AFC_V2_STORAGE_REMOVE_BATCH_SIZE = 100;
export const AFC_V2_STORAGE_LIST_PAGE_SIZE = 100;
export const AFC_V2_USER_STORAGE_ROW_CAP = 100_000;
export const AFC_V2_STORAGE_LIST_DIRECTORY_CAP = 10_000;
export const AFC_V2_STORAGE_LIST_FILE_CAP = 100_000;

export const AFC_V2_GENERATION_TABLE = "vibode_afc_generations";
export const AFC_V2_DURABLE_EMPTY_TABLE = "vibode_afc_durable_empty_artifacts";
export const AFC_V2_DURABLE_TILED_TABLE = "vibode_afc_durable_tiled_artifacts";

export const AFC_V2_GENERATION_RECEIPT_RELATIVE_PATH =
  "admin/receipts/generation.json";

export const AFC_V2_GENERATION_DERIVED_RELATIVE_PATHS = Object.freeze([
  "empty.jpg",
  "empty.png",
  "empty.webp",
  "tiled.jpg",
  "tiled.png",
  "tiled.webp",
  AFC_V2_GENERATION_RECEIPT_RELATIVE_PATH,
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QueryError = {
  code?: string | null;
  message?: string | null;
};

type QueryResult<T> = {
  data: T[] | null;
  error: QueryError | null;
};

export type AfcV2StorageListEntry = {
  name?: string | null;
  id?: string | null;
  metadata?: unknown;
};

export type AfcV2StorageListOptions = {
  limit?: number;
  offset?: number;
  sortBy?: { column: string; order: string };
};

export type AfcV2UserStorageDeletionClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        range: (from: number, to: number) => PromiseLike<QueryResult<Record<string, unknown>>>;
      };
    };
  };
  storage: {
    from: (bucket: string) => {
      list: (
        path?: string,
        options?: AfcV2StorageListOptions,
      ) => PromiseLike<{
        data: AfcV2StorageListEntry[] | null;
        error: { message?: string | null } | null;
      }>;
      remove: (paths: string[]) => PromiseLike<{
        data?: unknown;
        error: { message?: string | null } | null;
      }>;
    };
  };
};

type AfcV2UserStorageDeletionClientLike = {
  from: (table: string) => unknown;
  storage: {
    from: (bucket: string) => {
      list: (
        path?: string,
        options?: AfcV2StorageListOptions,
      ) => PromiseLike<{
        data?: unknown;
        error: { message?: string | null } | null;
      }>;
      remove: (paths: string[]) => PromiseLike<{
        data?: unknown;
        error: { message?: string | null } | null;
      }>;
    };
  };
};

export type AfcV2GenerationStorageRow = Readonly<{
  id?: unknown;
  room_id?: unknown;
  user_id?: unknown;
  empty_storage_path?: unknown;
  tiled_storage_path?: unknown;
  empty_storage_bucket?: unknown;
  tiled_storage_bucket?: unknown;
}>;

export type AfcV2DurableStorageRow = Readonly<{
  user_id?: unknown;
  storage_path?: unknown;
  storage_bucket?: unknown;
}>;

export type AfcV2UserStorageObjectCollection = Readonly<{
  keys: readonly string[];
  skipped: number;
}>;

export type AfcV2UserStorageDeletionResult = Readonly<{
  ok: boolean;
  deleted: number;
  skipped: number;
}>;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function isMissingRelationOrColumnError(error: QueryError | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42703") return true;
  const message = error.message ?? "";
  return /relation .* does not exist/i.test(message) ||
    /column .* does not exist/i.test(message);
}

function isAlreadyGoneStorageError(message: string): boolean {
  return /not found|does not exist|no such|404|already deleted/i.test(message);
}

function isAfcV2Bucket(value: unknown): boolean {
  const bucket = asNonEmptyString(value);
  if (!bucket) return true;
  return bucket === AFC_V2_PRODUCTION_STORAGE_BUCKET;
}

/**
 * Normalize a stored AFC object key using the same ownership rules as
 * production ORIGINAL paths (`users/{userId}/...`), plus extra rejection of
 * URL/query forms that must never be passed to Storage.remove().
 */
export function normalizeAfcV2UserObjectKey(
  userId: string,
  path: unknown,
): string | null {
  if (!isUuid(userId)) return null;
  const raw = asNonEmptyString(path);
  if (!raw) return null;
  if (/[?#]|:\/\//.test(raw) || /storage\/v1\/object/i.test(raw)) return null;
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return null;
  if (normalized.includes("..") || normalized.includes("//")) return null;
  if (
    normalized === "." ||
    normalized === "/" ||
    normalized.endsWith("/")
  ) {
    return null;
  }
  if (!isOwnedOriginalStoragePath(userId, normalized)) return null;
  const prefix = `users/${userId}/`;
  if (!normalized.startsWith(prefix) || normalized.length <= prefix.length) {
    return null;
  }
  return normalized;
}

export function isAfcV2UserOwnedObjectKey(
  userId: string,
  path: unknown,
): boolean {
  return normalizeAfcV2UserObjectKey(userId, path) != null;
}

export function afcV2UserExclusiveStoragePrefix(userId: string): string {
  return `users/${userId}`;
}

function isOwnedAfcV2Directory(userId: string, directory: string): boolean {
  const root = afcV2UserExclusiveStoragePrefix(userId);
  return directory === root || directory.startsWith(`${root}/`);
}

function isSafeStorageListName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (name.includes("..")) return false;
  return true;
}

function isStorageListFile(entry: AfcV2StorageListEntry): boolean {
  if (entry.id === null) return false;
  if (typeof entry.id === "string" && entry.id.length > 0) return true;
  return Boolean(entry.metadata && typeof entry.metadata === "object");
}

function addOwnedKey(args: {
  into: Set<string>;
  userId: string;
  path: unknown;
  bucket?: unknown;
  skipped: { count: number };
}): void {
  if (!isAfcV2Bucket(args.bucket)) {
    args.skipped.count += 1;
    return;
  }
  const key = normalizeAfcV2UserObjectKey(args.userId, args.path);
  if (!key) {
    if (asNonEmptyString(args.path)) args.skipped.count += 1;
    return;
  }
  args.into.add(key);
}

function addDerivedGenerationKeys(args: {
  into: Set<string>;
  userId: string;
  roomId: string;
  generationId: string;
}): void {
  const prefix = afcGenerationStoragePrefix({
    userId: args.userId,
    roomId: args.roomId,
    generationId: args.generationId,
  });
  for (const relative of AFC_V2_GENERATION_DERIVED_RELATIVE_PATHS) {
    const key = normalizeAfcV2UserObjectKey(args.userId, `${prefix}/${relative}`);
    if (key) args.into.add(key);
  }
}

export function collectAfcV2UserStorageObjectKeys(input: Readonly<{
  userId: string;
  generations?: readonly AfcV2GenerationStorageRow[];
  durableEmpty?: readonly AfcV2DurableStorageRow[];
  durableTiled?: readonly AfcV2DurableStorageRow[];
  listedPaths?: readonly unknown[];
}>): AfcV2UserStorageObjectCollection {
  const keys = new Set<string>();
  const skipped = { count: 0 };
  const userId = asNonEmptyString(input.userId);
  if (!userId || !isUuid(userId)) {
    return Object.freeze({ keys: Object.freeze([]), skipped: 0 });
  }

  for (const row of input.generations ?? []) {
    const rowUserId = asNonEmptyString(row.user_id);
    if (rowUserId !== userId) {
      if (rowUserId) skipped.count += 1;
      continue;
    }
    addOwnedKey({
      into: keys,
      userId,
      path: row.empty_storage_path,
      bucket: row.empty_storage_bucket,
      skipped,
    });
    addOwnedKey({
      into: keys,
      userId,
      path: row.tiled_storage_path,
      bucket: row.tiled_storage_bucket,
      skipped,
    });
    const roomId = asNonEmptyString(row.room_id);
    const generationId = asNonEmptyString(row.id);
    if (roomId && generationId && isUuid(roomId) && isUuid(generationId)) {
      addDerivedGenerationKeys({
        into: keys,
        userId,
        roomId,
        generationId,
      });
    }
  }

  for (const row of [
    ...(input.durableEmpty ?? []),
    ...(input.durableTiled ?? []),
  ]) {
    const rowUserId = asNonEmptyString(row.user_id);
    if (rowUserId !== userId) {
      if (rowUserId) skipped.count += 1;
      continue;
    }
    addOwnedKey({
      into: keys,
      userId,
      path: row.storage_path,
      bucket: row.storage_bucket,
      skipped,
    });
  }

  for (const listedPath of input.listedPaths ?? []) {
    addOwnedKey({
      into: keys,
      userId,
      path: listedPath,
      skipped,
    });
  }

  return Object.freeze({
    keys: Object.freeze([...keys].sort()),
    skipped: skipped.count,
  });
}

async function loadUserScopedRows(
  supabase: AfcV2UserStorageDeletionClient,
  table: string,
  columns: string,
  userId: string,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false }> {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  while (offset <= AFC_V2_USER_STORAGE_ROW_CAP) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("user_id", userId)
      .range(offset, offset + AFC_V2_USER_STORAGE_PAGE_SIZE - 1);
    if (error) {
      if (isMissingRelationOrColumnError(error)) {
        return { ok: true, rows: [] };
      }
      return { ok: false };
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < AFC_V2_USER_STORAGE_PAGE_SIZE) {
      return { ok: true, rows };
    }
    offset += AFC_V2_USER_STORAGE_PAGE_SIZE;
  }
  return { ok: false };
}

async function listAfcV2UserPrefixPaths(
  supabase: AfcV2UserStorageDeletionClient,
  userId: string,
): Promise<{ ok: true; paths: string[]; skipped: number } | { ok: false }> {
  const root = afcV2UserExclusiveStoragePrefix(userId);
  const queue = [root];
  const visited = new Set<string>();
  const paths: string[] = [];
  let skipped = 0;
  const bucket = supabase.storage.from(AFC_V2_PRODUCTION_STORAGE_BUCKET);

  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    if (!current || visited.has(current)) continue;
    if (!isOwnedAfcV2Directory(userId, current)) {
      skipped += 1;
      continue;
    }
    visited.add(current);
    if (visited.size > AFC_V2_STORAGE_LIST_DIRECTORY_CAP) return { ok: false };

    let offset = 0;
    for (;;) {
      const { data, error } = await bucket.list(current, {
        limit: AFC_V2_STORAGE_LIST_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) {
        const message = error.message ?? "";
        if (current === root && isAlreadyGoneStorageError(message)) {
          return { ok: true, paths: [], skipped };
        }
        return { ok: false };
      }

      const entries = Array.isArray(data) ? data : [];
      for (const entry of entries) {
        const name = asNonEmptyString(entry.name);
        if (!name || !isSafeStorageListName(name)) {
          skipped += 1;
          continue;
        }
        const fullPath = `${current}/${name}`;
        if (isStorageListFile(entry)) {
          const owned = normalizeAfcV2UserObjectKey(userId, fullPath);
          if (!owned) {
            skipped += 1;
            continue;
          }
          paths.push(owned);
          if (paths.length > AFC_V2_STORAGE_LIST_FILE_CAP) return { ok: false };
          continue;
        }
        if (!isOwnedAfcV2Directory(userId, fullPath)) {
          skipped += 1;
          continue;
        }
        queue.push(fullPath);
      }

      if (entries.length < AFC_V2_STORAGE_LIST_PAGE_SIZE) break;
      offset += AFC_V2_STORAGE_LIST_PAGE_SIZE;
    }
  }

  return { ok: true, paths, skipped };
}

async function removeAfcV2ObjectKeys(
  supabase: AfcV2UserStorageDeletionClient,
  keys: readonly string[],
): Promise<{ ok: boolean; deleted: number; skipped: number }> {
  let deleted = 0;
  let skipped = 0;
  for (let index = 0; index < keys.length; index += AFC_V2_STORAGE_REMOVE_BATCH_SIZE) {
    const batch = keys.slice(index, index + AFC_V2_STORAGE_REMOVE_BATCH_SIZE);
    const { error } = await supabase.storage
      .from(AFC_V2_PRODUCTION_STORAGE_BUCKET)
      .remove([...batch]);
    if (!error) {
      deleted += batch.length;
      continue;
    }
    const message = error.message ?? "";
    if (isAlreadyGoneStorageError(message)) {
      skipped += batch.length;
      continue;
    }
    return { ok: false, deleted, skipped };
  }
  return { ok: true, deleted, skipped };
}

export async function deleteAfcV2UserStorage(args: Readonly<{
  supabase: AfcV2UserStorageDeletionClientLike;
  userId: string;
}>): Promise<AfcV2UserStorageDeletionResult> {
  const supabase = args.supabase as AfcV2UserStorageDeletionClient;
  const userId = asNonEmptyString(args.userId);
  if (!userId || !isUuid(userId)) {
    return Object.freeze({ ok: false, deleted: 0, skipped: 0 });
  }

  const generations = await loadUserScopedRows(
    supabase,
    AFC_V2_GENERATION_TABLE,
    "id,room_id,user_id,empty_storage_path,tiled_storage_path,empty_storage_bucket,tiled_storage_bucket",
    userId,
  );
  if (!generations.ok) return Object.freeze({ ok: false, deleted: 0, skipped: 0 });

  const durableEmpty = await loadUserScopedRows(
    supabase,
    AFC_V2_DURABLE_EMPTY_TABLE,
    "user_id,storage_path,storage_bucket",
    userId,
  );
  if (!durableEmpty.ok) return Object.freeze({ ok: false, deleted: 0, skipped: 0 });

  const durableTiled = await loadUserScopedRows(
    supabase,
    AFC_V2_DURABLE_TILED_TABLE,
    "user_id,storage_path,storage_bucket",
    userId,
  );
  if (!durableTiled.ok) return Object.freeze({ ok: false, deleted: 0, skipped: 0 });

  const listing = await listAfcV2UserPrefixPaths(supabase, userId);
  if (!listing.ok) return Object.freeze({ ok: false, deleted: 0, skipped: 0 });

  const collected = collectAfcV2UserStorageObjectKeys({
    userId,
    generations: generations.rows,
    durableEmpty: durableEmpty.rows,
    durableTiled: durableTiled.rows,
    listedPaths: listing.paths,
  });
  if (collected.keys.length === 0) {
    return Object.freeze({
      ok: true,
      deleted: 0,
      skipped: collected.skipped + listing.skipped,
    });
  }

  const removed = await removeAfcV2ObjectKeys(supabase, collected.keys);
  return Object.freeze({
    ok: removed.ok,
    deleted: removed.deleted,
    skipped: removed.skipped + collected.skipped + listing.skipped,
  });
}
