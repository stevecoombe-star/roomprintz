import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_V2_DURABLE_EMPTY_TABLE,
  AFC_V2_DURABLE_TILED_TABLE,
  AFC_V2_GENERATION_DERIVED_RELATIVE_PATHS,
  AFC_V2_GENERATION_TABLE,
  AFC_V2_STORAGE_LIST_PAGE_SIZE,
  AFC_V2_STORAGE_REMOVE_BATCH_SIZE,
  afcV2UserExclusiveStoragePrefix,
  collectAfcV2UserStorageObjectKeys,
  deleteAfcV2UserStorage,
  isAfcV2UserOwnedObjectKey,
  normalizeAfcV2UserObjectKey,
  type AfcV2StorageListEntry,
  type AfcV2UserStorageDeletionClient,
} from "./delete-user-afc-storage.server";
import {
  AFC_V2_PRODUCTION_STORAGE_BUCKET,
  afcGenerationStoragePrefix,
} from "./production-store";

const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "44444444-4444-4444-8444-444444444444";
const ROOM_SHARED = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "33333333-3333-4333-8333-333333333333";
const GEN_A1 = "55555555-5555-4555-8555-555555555555";
const GEN_A2 = "66666666-6666-4666-8666-666666666666";
const GEN_B1 = "77777777-7777-4777-8777-777777777777";

function prefixFor(
  userId: string,
  roomId: string,
  generationId: string,
) {
  return afcGenerationStoragePrefix({ userId, roomId, generationId });
}

function derivedKeys(userId: string, roomId: string, generationId: string) {
  const prefix = prefixFor(userId, roomId, generationId);
  return AFC_V2_GENERATION_DERIVED_RELATIVE_PATHS.map(
    (relative) => `${prefix}/${relative}`,
  );
}

function generationRow(args: {
  userId: string;
  roomId: string;
  id: string;
  emptyPath?: string | null;
  tiledPath?: string | null;
  emptyBucket?: string | null;
  tiledBucket?: string | null;
}) {
  return {
    id: args.id,
    room_id: args.roomId,
    user_id: args.userId,
    empty_storage_path: args.emptyPath,
    tiled_storage_path: args.tiledPath,
    empty_storage_bucket: args.emptyBucket,
    tiled_storage_bucket: args.tiledBucket,
  };
}

type FakeTableRows = Record<string, Record<string, unknown>[]>;
type FakeListEntry = {
  name: string;
  id: string | null;
  metadata?: unknown;
};

function addListEntry(
  index: Map<string, FakeListEntry[]>,
  dir: string,
  entry: FakeListEntry,
) {
  const existing = index.get(dir) ?? [];
  if (!existing.some((item) => item.name === entry.name)) existing.push(entry);
  index.set(dir, existing);
}

function indexListedFiles(files: readonly string[]): Map<string, FakeListEntry[]> {
  const index = new Map<string, FakeListEntry[]>();
  for (const file of files) {
    const parts = file.split("/").filter((part) => part.length > 0);
    for (let indexPart = 1; indexPart < parts.length; indexPart += 1) {
      const dir = parts.slice(0, indexPart).join("/");
      const name = parts[indexPart] ?? "";
      const isFile = indexPart === parts.length - 1;
      addListEntry(index, dir, {
        name,
        id: isFile ? `id-${file}` : null,
        metadata: isFile ? { size: 1 } : null,
      });
    }
  }
  return index;
}

function createDeletionClient(args: {
  generations?: FakeTableRows;
  durableEmpty?: FakeTableRows;
  durableTiled?: FakeTableRows;
  tableError?: { table: string; code?: string; message: string };
  listedFiles?: readonly string[];
  extraListEntries?: Readonly<Record<string, readonly FakeListEntry[]>>;
  listError?: { message: string };
  removeImpl?: (
    bucket: string,
    paths: string[],
  ) => Promise<{ error: { message?: string } | null }>;
}): AfcV2UserStorageDeletionClient & {
  ops: string[];
  removed: string[];
  buckets: string[];
  listPaths: string[];
} {
  const ops: string[] = [];
  const removed: string[] = [];
  const buckets: string[] = [];
  const listPaths: string[] = [];
  const tables: Record<string, FakeTableRows> = {
    [AFC_V2_GENERATION_TABLE]: args.generations ?? {},
    [AFC_V2_DURABLE_EMPTY_TABLE]: args.durableEmpty ?? {},
    [AFC_V2_DURABLE_TILED_TABLE]: args.durableTiled ?? {},
  };
  const listIndex = indexListedFiles(args.listedFiles ?? []);
  for (const [dir, entries] of Object.entries(args.extraListEntries ?? {})) {
    for (const entry of entries) addListEntry(listIndex, dir, entry);
  }

  return {
    ops,
    removed,
    buckets,
    listPaths,
    from(table: string) {
      ops.push(`from:${table}`);
      let userId = "";
      const builder = {
        select(columns: string) {
          ops.push(`select:${table}:${columns}`);
          return builder;
        },
        eq(column: string, value: string) {
          ops.push(`eq:${table}:${column}`);
          if (column === "user_id") userId = value;
          return builder;
        },
        async range(from: number, to: number) {
          ops.push(`range:${table}:${from}:${to}`);
          if (args.tableError?.table === table) {
            return {
              data: null,
              error: {
                code: args.tableError.code,
                message: args.tableError.message,
              },
            };
          }
          const rows = tables[table]?.[userId] ?? [];
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return builder;
    },
    storage: {
      from(bucket: string) {
        ops.push(`storage:${bucket}`);
        buckets.push(bucket);
        return {
          async list(path = "", options?: { limit?: number; offset?: number }) {
            const offset = options?.offset ?? 0;
            const limit = options?.limit ?? AFC_V2_STORAGE_LIST_PAGE_SIZE;
            ops.push(`list:${bucket}|${path}|${offset}|${limit}`);
            listPaths.push(path);
            if (args.listError) {
              return { data: null, error: args.listError };
            }
            const entries = [...(listIndex.get(path) ?? [])].sort((left, right) =>
              left.name.localeCompare(right.name)
            );
            return {
              data: entries.slice(offset, offset + limit) as AfcV2StorageListEntry[],
              error: null,
            };
          },
          async remove(paths: string[]) {
            ops.push(`remove:${bucket}:${paths.length}`);
            if (args.removeImpl) return args.removeImpl(bucket, paths);
            removed.push(...paths);
            return { error: null };
          },
        };
      },
    },
  };
}

test("1) zero AFC generations → zero AFC storage objects", () => {
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [],
    durableEmpty: [],
    durableTiled: [],
  });
  assert.deepEqual([...collected.keys], []);
  assert.equal(collected.skipped, 0);
});

test("2) one generation with one artifact path includes that path", () => {
  const emptyPath = `${prefixFor(USER_A, ROOM_SHARED, GEN_A1)}/empty.png`;
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A1,
        emptyPath,
      }),
    ],
  });
  assert.equal(collected.keys.includes(emptyPath), true);
});

test("3) one generation with multiple artifact paths includes empty and tiled", () => {
  const prefix = prefixFor(USER_A, ROOM_SHARED, GEN_A1);
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A1,
        emptyPath: `${prefix}/empty.png`,
        tiledPath: `${prefix}/tiled.png`,
      }),
    ],
  });
  assert.equal(collected.keys.includes(`${prefix}/empty.png`), true);
  assert.equal(collected.keys.includes(`${prefix}/tiled.png`), true);
});

test("4) multiple generations contribute distinct prefixes", () => {
  const first = prefixFor(USER_A, ROOM_SHARED, GEN_A1);
  const second = prefixFor(USER_A, ROOM_SHARED, GEN_A2);
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A1,
        emptyPath: `${first}/empty.png`,
      }),
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A2,
        tiledPath: `${second}/tiled.jpg`,
      }),
    ],
  });
  assert.equal(collected.keys.includes(`${first}/empty.png`), true);
  assert.equal(collected.keys.includes(`${second}/tiled.jpg`), true);
});

test("5) duplicate object path → one deletion target", () => {
  const prefix = prefixFor(USER_A, ROOM_SHARED, GEN_A1);
  const emptyPath = `${prefix}/empty.png`;
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A1,
        emptyPath,
        tiledPath: emptyPath,
      }),
    ],
    durableEmpty: [
      {
        user_id: USER_A,
        storage_path: emptyPath,
        storage_bucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
      },
    ],
  });
  assert.equal(collected.keys.filter((key) => key === emptyPath).length, 1);
});

test("6) null path ignored", () => {
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A1,
        emptyPath: null,
        tiledPath: null,
      }),
    ],
    durableEmpty: [{ user_id: USER_A, storage_path: null, storage_bucket: null }],
  });
  assert.equal(collected.keys.some((key) => key.length === 0), false);
});

test("7) empty path ignored", () => {
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A1,
        emptyPath: "   ",
        tiledPath: "",
      }),
    ],
    durableTiled: [{ user_id: USER_A, storage_path: "", storage_bucket: AFC_V2_PRODUCTION_STORAGE_BUCKET }],
  });
  assert.equal(
    collected.keys.some((key) => key.trim().length === 0),
    false,
  );
});

test("8) different user’s generation excluded", () => {
  const otherEmpty = `${prefixFor(USER_B, ROOM_B, GEN_B1)}/empty.png`;
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_B,
        roomId: ROOM_B,
        id: GEN_B1,
        emptyPath: otherEmpty,
      }),
    ],
  });
  assert.equal(collected.keys.includes(otherEmpty), false);
  for (const key of collected.keys) {
    assert.equal(key.startsWith(`users/${USER_A}/`), true);
  }
});

test("9) malformed path handled safely", () => {
  assert.equal(normalizeAfcV2UserObjectKey(USER_A, "../etc/passwd"), null);
  assert.equal(
    normalizeAfcV2UserObjectKey(
      USER_A,
      `users/${USER_A}/../users/${USER_B}/afc/x/empty.png`,
    ),
    null,
  );
  assert.equal(
    normalizeAfcV2UserObjectKey(
      USER_A,
      `https://example.test/storage/v1/object/sign/${AFC_V2_PRODUCTION_STORAGE_BUCKET}/users/${USER_A}/empty.png?token=secret`,
    ),
    null,
  );
  assert.equal(
    normalizeAfcV2UserObjectKey(USER_A, `users/${USER_A}/empty.png?token=secret`),
    null,
  );
  assert.equal(isAfcV2UserOwnedObjectKey(USER_A, "/"), false);
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A1,
        emptyPath: `users/${USER_A}/../users/${USER_B}/secret.png`,
      }),
    ],
  });
  assert.equal(
    collected.keys.some((key) => key.includes("..") || key.includes(USER_B)),
    false,
  );
});

test("10) only vibode-afc-v2 bucket targeted", async () => {
  const prefix = prefixFor(USER_A, ROOM_SHARED, GEN_A1);
  const client = createDeletionClient({
    generations: {
      [USER_A]: [
        generationRow({
          userId: USER_A,
          roomId: ROOM_SHARED,
          id: GEN_A1,
          emptyPath: `${prefix}/empty.png`,
          emptyBucket: "vibode-base-images",
          tiledPath: `${prefix}/tiled.png`,
          tiledBucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
        }),
      ],
    },
    durableEmpty: {
      [USER_A]: [
        {
          user_id: USER_A,
          storage_path: `${prefix}/empty.png`,
          storage_bucket: "room-originals",
        },
      ],
    },
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.deepEqual([...new Set(client.buckets)], [AFC_V2_PRODUCTION_STORAGE_BUCKET]);
  assert.equal(client.ops.some((op) => op.startsWith("storage:vibode-base-images")), false);
  assert.equal(client.ops.some((op) => op.startsWith("storage:room-originals")), false);
  assert.equal(client.removed.includes(`${prefix}/tiled.png`), true);
});

test("11) deleting User A does not include User B’s AFC paths", () => {
  const pathA = `${prefixFor(USER_A, ROOM_SHARED, GEN_A1)}/empty.png`;
  const pathB = `${prefixFor(USER_B, ROOM_SHARED, GEN_B1)}/empty.png`;
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A1,
        emptyPath: pathA,
      }),
      generationRow({
        userId: USER_B,
        roomId: ROOM_SHARED,
        id: GEN_B1,
        emptyPath: pathB,
      }),
    ],
    durableEmpty: [
      {
        user_id: USER_B,
        storage_path: pathB,
        storage_bucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
      },
    ],
  });
  assert.equal(collected.keys.includes(pathA), true);
  assert.equal(collected.keys.includes(pathB), false);
});

test("12) shared room/generation-like ids do not bypass ownership", () => {
  const pathA = `${prefixFor(USER_A, ROOM_SHARED, GEN_A1)}/tiled.webp`;
  const pathB = `${prefixFor(USER_B, ROOM_SHARED, GEN_A1)}/tiled.webp`;
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A1,
        tiledPath: pathA,
      }),
      generationRow({
        userId: USER_B,
        roomId: ROOM_SHARED,
        id: GEN_A1,
        tiledPath: pathB,
      }),
    ],
  });
  assert.equal(collected.keys.includes(pathA), true);
  assert.equal(collected.keys.includes(pathB), false);
  for (const key of collected.keys) {
    assert.match(key, new RegExp(`^users/${USER_A}/`));
    assert.doesNotMatch(key, new RegExp(`^users/${USER_B}/`));
  }
});

test("derived generation artifacts include receipt, empty, and tiled names", () => {
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [
      generationRow({
        userId: USER_A,
        roomId: ROOM_SHARED,
        id: GEN_A1,
      }),
    ],
  });
  for (const key of derivedKeys(USER_A, ROOM_SHARED, GEN_A1)) {
    assert.equal(collected.keys.includes(key), true, key);
  }
});

test("durable artifacts are enumerated when generation rows omit the path", () => {
  const durablePath = `${prefixFor(USER_A, ROOM_SHARED, GEN_A2)}/empty.webp`;
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    generations: [],
    durableEmpty: [
      {
        user_id: USER_A,
        storage_path: durablePath,
        storage_bucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
      },
    ],
    durableTiled: [
      {
        user_id: USER_A,
        storage_path: `${prefixFor(USER_A, ROOM_SHARED, GEN_A2)}/tiled.webp`,
        storage_bucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
      },
    ],
  });
  assert.equal(collected.keys.includes(durablePath), true);
  assert.equal(
    collected.keys.includes(`${prefixFor(USER_A, ROOM_SHARED, GEN_A2)}/tiled.webp`),
    true,
  );
});

test("20) retry after already-removed objects remains safe", async () => {
  const prefix = prefixFor(USER_A, ROOM_SHARED, GEN_A1);
  const client = createDeletionClient({
    generations: {
      [USER_A]: [
        generationRow({
          userId: USER_A,
          roomId: ROOM_SHARED,
          id: GEN_A1,
          emptyPath: `${prefix}/empty.png`,
        }),
      ],
    },
    removeImpl: async () => ({ error: { message: "Object not found" } }),
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(result.deleted, 0);
  assert.ok(result.skipped > 0);
});

test("21) duplicate paths do not cause incorrect failure", async () => {
  const prefix = prefixFor(USER_A, ROOM_SHARED, GEN_A1);
  const emptyPath = `${prefix}/empty.png`;
  const client = createDeletionClient({
    generations: {
      [USER_A]: [
        generationRow({
          userId: USER_A,
          roomId: ROOM_SHARED,
          id: GEN_A1,
          emptyPath,
          tiledPath: emptyPath,
        }),
      ],
    },
    durableEmpty: {
      [USER_A]: [
        {
          user_id: USER_A,
          storage_path: emptyPath,
          storage_bucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
        },
      ],
    },
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(client.removed.filter((path) => path === emptyPath).length, 1);
});

test("22) service-role storage client only and query-then-remove order", async () => {
  const prefix = prefixFor(USER_A, ROOM_SHARED, GEN_A1);
  const client = createDeletionClient({
    generations: {
      [USER_A]: [
        generationRow({
          userId: USER_A,
          roomId: ROOM_SHARED,
          id: GEN_A1,
          emptyPath: `${prefix}/empty.png`,
        }),
      ],
    },
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  const firstFrom = client.ops.findIndex((op) => op.startsWith("from:"));
  const firstStorage = client.ops.findIndex((op) => op.startsWith("storage:"));
  const firstRemove = client.ops.findIndex((op) => op.startsWith("remove:"));
  assert.ok(firstFrom >= 0);
  assert.ok(firstStorage > firstFrom);
  assert.ok(firstRemove > firstStorage);
  assert.equal(
    client.ops.filter((op) => op.startsWith("from:"))[0],
    `from:${AFC_V2_GENERATION_TABLE}`,
  );
  assert.ok(
    client.ops.some((op) => op === `from:${AFC_V2_DURABLE_EMPTY_TABLE}`),
  );
  assert.ok(
    client.ops.some((op) => op === `from:${AFC_V2_DURABLE_TILED_TABLE}`),
  );
  const userRoot = afcV2UserExclusiveStoragePrefix(USER_A);
  assert.ok(client.listPaths.includes(userRoot));
  assert.equal(client.listPaths.includes("users"), false);
  assert.equal(client.listPaths.includes(""), false);
  assert.ok(
    client.listPaths.every((path) => path === userRoot || path.startsWith(`${userRoot}/`)),
  );
  assert.deepEqual([...new Set(client.buckets)], [AFC_V2_PRODUCTION_STORAGE_BUCKET]);
});

test("storage remove failure is not reported as success", async () => {
  const prefix = prefixFor(USER_A, ROOM_SHARED, GEN_A1);
  const client = createDeletionClient({
    generations: {
      [USER_A]: [
        generationRow({
          userId: USER_A,
          roomId: ROOM_SHARED,
          id: GEN_A1,
          emptyPath: `${prefix}/empty.png`,
        }),
      ],
    },
    removeImpl: async () => ({ error: { message: "permission denied" } }),
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, false);
});

test("enumeration failure is not reported as success and does not remove", async () => {
  const client = createDeletionClient({
    tableError: {
      table: AFC_V2_GENERATION_TABLE,
      message: "connection refused",
    },
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, false);
  assert.deepEqual(client.removed, []);
  assert.deepEqual(client.buckets, []);
});

test("missing AFC tables are treated as zero objects when the prefix is empty", async () => {
  const client = createDeletionClient({
    tableError: {
      table: AFC_V2_GENERATION_TABLE,
      code: "42P01",
      message: "relation \"vibode_afc_generations\" does not exist",
    },
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(result.deleted, 0);
  assert.deepEqual(client.removed, []);
  assert.ok(client.listPaths.includes(afcV2UserExclusiveStoragePrefix(USER_A)));
});

test("zero AFC objects does not call storage remove", async () => {
  const client = createDeletionClient({});
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(result.deleted, 0);
  assert.deepEqual(client.removed, []);
  assert.ok(client.listPaths.includes(afcV2UserExclusiveStoragePrefix(USER_A)));
});

test("invalid user id fails closed without storage access", async () => {
  const client = createDeletionClient({});
  const result = await deleteAfcV2UserStorage({
    supabase: client,
    userId: "not-a-user",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(client.ops, []);
});

test("owned-path validation uses users/{userId}/ and rejects cross-user keys", () => {
  const owned = `${prefixFor(USER_A, ROOM_SHARED, GEN_A1)}/empty.png`;
  const other = `${prefixFor(USER_B, ROOM_SHARED, GEN_A1)}/empty.png`;
  assert.equal(isAfcV2UserOwnedObjectKey(USER_A, owned), true);
  assert.equal(isAfcV2UserOwnedObjectKey(USER_A, `/${owned}`), true);
  assert.equal(isAfcV2UserOwnedObjectKey(USER_A, other), false);
  assert.equal(isAfcV2UserOwnedObjectKey(USER_A, `${owned}/`), false);
});

test("remove batches stay within the SDK helper limit", () => {
  assert.ok(AFC_V2_STORAGE_REMOVE_BATCH_SIZE <= 100);
  assert.ok(AFC_V2_STORAGE_LIST_PAGE_SIZE <= 100);
  assert.ok(AFC_V2_GENERATION_DERIVED_RELATIVE_PATHS.includes("empty.png"));
  assert.ok(AFC_V2_GENERATION_DERIVED_RELATIVE_PATHS.includes("tiled.webp"));
  assert.ok(
    AFC_V2_GENERATION_DERIVED_RELATIVE_PATHS.includes(
      "admin/receipts/generation.json",
    ),
  );
});

test("FIX1 1) DB-derived object is deleted", async () => {
  const dbPath = `${prefixFor(USER_A, ROOM_SHARED, GEN_A1)}/empty.png`;
  const client = createDeletionClient({
    generations: {
      [USER_A]: [
        generationRow({
          userId: USER_A,
          roomId: ROOM_SHARED,
          id: GEN_A1,
          emptyPath: dbPath,
        }),
      ],
    },
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(client.removed.includes(dbPath), true);
});

test("FIX1 2) prefix-listed orphan with no DB row is deleted", async () => {
  const orphan = `${afcV2UserExclusiveStoragePrefix(USER_A)}/orphans/leftover.png`;
  const client = createDeletionClient({
    listedFiles: [orphan],
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(client.removed.includes(orphan), true);
});

test("FIX1 3) nested objects beneath the user prefix are discovered", async () => {
  const nested =
    `${prefixFor(USER_A, ROOM_SHARED, GEN_A1)}/admin/receipts/generation.json`;
  const client = createDeletionClient({
    listedFiles: [nested],
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(client.removed.includes(nested), true);
  const root = afcV2UserExclusiveStoragePrefix(USER_A);
  assert.ok(client.listPaths.includes(root));
  assert.ok(client.listPaths.includes(`${root}/rooms`));
  assert.ok(client.listPaths.includes(`${prefixFor(USER_A, ROOM_SHARED, GEN_A1)}/admin`));
});

test("FIX1 4) pagination does not omit later objects", async () => {
  const root = afcV2UserExclusiveStoragePrefix(USER_A);
  const files = Array.from(
    { length: AFC_V2_STORAGE_LIST_PAGE_SIZE + 1 },
    (_value, index) =>
      `${root}/orphan-${String(index).padStart(3, "0")}.png`,
  );
  const client = createDeletionClient({ listedFiles: files });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  for (const file of files) {
    assert.equal(client.removed.includes(file), true, file);
  }
  assert.ok(
    client.ops.some((op) => op === `list:${AFC_V2_PRODUCTION_STORAGE_BUCKET}|${root}|0|${AFC_V2_STORAGE_LIST_PAGE_SIZE}`),
  );
  assert.ok(
    client.ops.some((op) =>
      op === `list:${AFC_V2_PRODUCTION_STORAGE_BUCKET}|${root}|${AFC_V2_STORAGE_LIST_PAGE_SIZE}|${AFC_V2_STORAGE_LIST_PAGE_SIZE}`
    ),
  );
});

test("FIX1 5) User B prefix is never traversed or deleted", async () => {
  const pathA = `${prefixFor(USER_A, ROOM_SHARED, GEN_A1)}/empty.png`;
  const pathB = `${prefixFor(USER_B, ROOM_SHARED, GEN_B1)}/empty.png`;
  const client = createDeletionClient({
    generations: {
      [USER_A]: [
        generationRow({
          userId: USER_A,
          roomId: ROOM_SHARED,
          id: GEN_A1,
          emptyPath: pathA,
        }),
      ],
    },
    listedFiles: [pathA, pathB],
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  const userARoot = afcV2UserExclusiveStoragePrefix(USER_A);
  const userBRoot = afcV2UserExclusiveStoragePrefix(USER_B);
  assert.equal(client.removed.includes(pathB), false);
  assert.equal(client.listPaths.includes(userBRoot), false);
  assert.ok(
    client.listPaths.every((path) => path === userARoot || path.startsWith(`${userARoot}/`)),
  );
});

test("FIX1 6) malformed/out-of-prefix listed key is excluded", async () => {
  const owned = `${afcV2UserExclusiveStoragePrefix(USER_A)}/keep.png`;
  const collected = collectAfcV2UserStorageObjectKeys({
    userId: USER_A,
    listedPaths: [
      owned,
      `users/${USER_B}/secret.png`,
      `users/${USER_A}/../users/${USER_B}/escape.png`,
      `${afcV2UserExclusiveStoragePrefix(USER_A)}/empty.png?token=secret`,
    ],
  });
  assert.equal(collected.keys.includes(owned), true);
  assert.equal(collected.keys.some((key) => key.includes(USER_B)), false);
  assert.equal(collected.keys.some((key) => key.includes("?")), false);

  const client = createDeletionClient({
    listedFiles: [owned],
    extraListEntries: {
      [afcV2UserExclusiveStoragePrefix(USER_A)]: [
        { name: `../users/${USER_B}/secret.png`, id: "escaped", metadata: { size: 1 } },
      ],
    },
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(client.removed.includes(owned), true);
  assert.equal(
    client.removed.some((path) => path.includes(USER_B) || path.includes("..")),
    false,
  );
});

test("FIX1 7) duplicate DB + prefix-listed key is deleted once", async () => {
  const emptyPath = `${prefixFor(USER_A, ROOM_SHARED, GEN_A1)}/empty.png`;
  const client = createDeletionClient({
    generations: {
      [USER_A]: [
        generationRow({
          userId: USER_A,
          roomId: ROOM_SHARED,
          id: GEN_A1,
          emptyPath,
        }),
      ],
    },
    listedFiles: [emptyPath],
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(client.removed.filter((path) => path === emptyPath).length, 1);
});

test("FIX1 8) prefix listing failure prevents delete-user success", async () => {
  const client = createDeletionClient({
    generations: {
      [USER_A]: [
        generationRow({
          userId: USER_A,
          roomId: ROOM_SHARED,
          id: GEN_A1,
          emptyPath: `${prefixFor(USER_A, ROOM_SHARED, GEN_A1)}/empty.png`,
        }),
      ],
    },
    listError: { message: "storage listing timeout" },
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, false);
  assert.deepEqual(client.removed, []);
});

test("FIX1 9) missing AFC table + successful prefix sweep still cleans storage", async () => {
  const orphan = `${afcV2UserExclusiveStoragePrefix(USER_A)}/rooms/orphan/empty.png`;
  const client = createDeletionClient({
    tableError: {
      table: AFC_V2_GENERATION_TABLE,
      code: "42P01",
      message: "relation \"vibode_afc_generations\" does not exist",
    },
    listedFiles: [orphan],
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(client.removed.includes(orphan), true);
});

test("FIX1 10) zero objects remains successful", async () => {
  const client = createDeletionClient({});
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(result.deleted, 0);
  assert.deepEqual(client.removed, []);
});

test("FIX1 11) retry after prior object removal remains safe", async () => {
  const orphan = `${afcV2UserExclusiveStoragePrefix(USER_A)}/already-gone.png`;
  const client = createDeletionClient({
    listedFiles: [orphan],
    removeImpl: async () => ({ error: { message: "Object not found" } }),
  });
  const result = await deleteAfcV2UserStorage({ supabase: client, userId: USER_A });
  assert.equal(result.ok, true);
  assert.equal(result.deleted, 0);
  assert.ok(result.skipped > 0);
});
