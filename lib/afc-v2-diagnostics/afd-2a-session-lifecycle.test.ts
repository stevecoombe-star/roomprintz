import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
} from "./contracts";
import {
  AFC_DIAGNOSTIC_MEMBERSHIP_ORDINAL_RETRY_LIMIT,
  AFC_DIAGNOSTIC_SESSION_OPEN_RETRY_LIMIT,
  createSupabaseAfcDiagnosticSessionStore,
  ensureAfcDiagnosticSessionMembership,
  isPostgresUniqueViolation,
  parseAfcOriginalSha256,
  AfcDiagnosticSessionConcurrencyError,
  AfcDiagnosticSessionInputError,
  AfcDiagnosticSessionIntegrityError,
  AfcDiagnosticSessionStoreError,
  type AfcDiagnosticMembershipResult,
  type AfcDiagnosticSessionStore,
} from "./session-lifecycle.server";
import type { AfcQaCapabilityEnv } from "./qa-capability.server";

const ROOT = process.cwd();
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GEN_1 = "11111111-1111-4111-8111-111111111111";
const GEN_2 = "12121212-1212-4121-8121-121212121212";
const GEN_3 = "13131313-1313-4131-8131-131313131313";
const GEN_OTHER = "14141414-1414-4141-8141-141414141414";
const ASSET_A = "99999999-9999-4999-8999-999999999999";
const SESSION_A = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SESSION_B = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const SESSION_ROOM_B = "ccccccc1-cccc-4ccc-8ccc-ccccccccccc1";
const SESSION_USER_B = "ddddddd1-dddd-4ddd-8ddd-ddddddddddd1";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const YESTERDAY = "2026-09-18T12:00:00.000Z";

const QA_ALL: AfcQaCapabilityEnv = { VIBODE_AFC_QA_MODE: "all" };
const QA_OFF: AfcQaCapabilityEnv = { VIBODE_AFC_QA_MODE: "off" };
const QA_INVALID: AfcQaCapabilityEnv = { VIBODE_AFC_QA_MODE: "enabled" };
const QA_MISSING: AfcQaCapabilityEnv = {};
const QA_ALLOW: AfcQaCapabilityEnv = {
  VIBODE_AFC_QA_MODE: "allowlist",
  VIBODE_AFC_QA_USER_IDS: USER_A,
};

type SessionRow = {
  id: string;
  room_id: string;
  user_id: string;
  original_sha256: string;
  base_asset_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type MembershipRow = {
  session_id: string;
  generation_id: string;
  attempt_ordinal: number;
  intent: string;
  associated_at: string;
};

type Filter = { type: "eq" | "neq"; column: string; value: unknown };

type DbOp = {
  table: string;
  action: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: Filter[];
};

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function walkTs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTs(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function nowIso() {
  return new Date().toISOString();
}

function project(row: Record<string, unknown>, columns: string) {
  if (columns === "*" || columns.length === 0) return { ...row };
  const out: Record<string, unknown> = {};
  for (const column of columns.split(",").map((part) => part.trim())) {
    out[column] = row[column];
  }
  return out;
}

class FakeDiagnosticDb {
  sessions: SessionRow[] = [];
  memberships: MembershipRow[] = [];
  cases: Record<string, unknown>[] = [];
  ops: DbOp[] = [];
  nextError: { code?: string | number; message?: string } | null = null;

  constructor(seed?: {
    sessions?: SessionRow[];
    memberships?: MembershipRow[];
  }) {
    this.sessions = seed?.sessions ? seed.sessions.map((row) => ({ ...row })) : [];
    this.memberships = seed?.memberships
      ? seed.memberships.map((row) => ({ ...row }))
      : [];
  }

  failNext(error: { code?: string | number; message?: string }) {
    this.nextError = error;
  }

  client() {
    return {
      from: (table: string) => new FakeQuery(this, table),
    };
  }

  tableRows(table: string): Record<string, unknown>[] {
    if (table === AFC_DIAGNOSTIC_SESSION_TABLE) return this.sessions;
    if (table === AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE) return this.memberships;
    if (table === AFC_DIAGNOSTIC_CASE_TABLE) return this.cases;
    throw new Error(`unexpected table ${table}`);
  }
}

class FakeQuery {
  private action: "select" | "insert" | "update" = "select";
  private columns = "*";
  private payload: Record<string, unknown> | null = null;
  private filters: Filter[] = [];
  private orderColumn: string | null = null;
  private orderAscending = true;
  private limitCount: number | null = null;

  constructor(
    private readonly db: FakeDiagnosticDb,
    private readonly table: string,
  ) {}

  select(columns: string) {
    this.columns = columns;
    return this;
  }

  insert(values: Record<string, unknown>) {
    this.action = "insert";
    this.payload = values;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.action = "update";
    this.payload = values;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ type: "neq", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderColumn = column;
    this.orderAscending = options?.ascending !== false;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.execute("maybeSingle"));
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute("rows")).then(onfulfilled, onrejected);
  }

  private matches(row: Record<string, unknown>) {
    return this.filters.every((filter) => {
      const value = row[filter.column];
      return filter.type === "eq" ? value === filter.value : value !== filter.value;
    });
  }

  private execute(mode: "maybeSingle" | "rows") {
    this.db.ops.push({
      table: this.table,
      action: this.action,
      payload: this.payload ?? undefined,
      filters: [...this.filters],
    });
    if (this.db.nextError) {
      const error = this.db.nextError;
      this.db.nextError = null;
      return { data: null, error };
    }
    if (this.action === "insert") return this.executeInsert(mode);
    if (this.action === "update") return this.executeUpdate();
    return this.executeSelect(mode);
  }

  private executeSelect(mode: "maybeSingle" | "rows") {
    let rows = this.db.tableRows(this.table).filter((row) => this.matches(row));
    if (this.orderColumn) {
      const column = this.orderColumn;
      const direction = this.orderAscending ? 1 : -1;
      rows = [...rows].sort((left, right) => {
        const a = left[column];
        const b = right[column];
        if (a === b) return 0;
        return (a as number) > (b as number) ? direction : -direction;
      });
    }
    if (this.limitCount != null) rows = rows.slice(0, this.limitCount);
    const projected = rows.map((row) => project(row, this.columns));
    if (mode === "maybeSingle") {
      if (projected.length === 0) return { data: null, error: null };
      if (projected.length === 1) return { data: projected[0], error: null };
      return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
    }
    return { data: projected, error: null };
  }

  private executeInsert(mode: "maybeSingle" | "rows") {
    const payload = this.payload ?? {};
    if (this.table === AFC_DIAGNOSTIC_SESSION_TABLE) {
      const row: SessionRow = {
        id: typeof payload.id === "string" ? payload.id : crypto.randomUUID(),
        room_id: String(payload.room_id),
        user_id: String(payload.user_id),
        original_sha256: String(payload.original_sha256),
        base_asset_id:
          payload.base_asset_id == null ? null : String(payload.base_asset_id),
        status: typeof payload.status === "string" ? payload.status : "open",
        created_at:
          typeof payload.created_at === "string" ? payload.created_at : nowIso(),
        updated_at:
          typeof payload.updated_at === "string" ? payload.updated_at : nowIso(),
      };
      const openConflict = this.db.sessions.some(
        (existing) =>
          existing.status === "open" &&
          existing.user_id === row.user_id &&
          existing.room_id === row.room_id &&
          existing.original_sha256 === row.original_sha256 &&
          row.status === "open",
      );
      if (openConflict) return { data: null, error: { code: "23505" } };
      this.db.sessions.push(row);
      const projected = project(row, this.columns);
      return mode === "maybeSingle"
        ? { data: projected, error: null }
        : { data: [projected], error: null };
    }
    if (this.table === AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE) {
      const row: MembershipRow = {
        session_id: String(payload.session_id),
        generation_id: String(payload.generation_id),
        attempt_ordinal: Number(payload.attempt_ordinal),
        intent: String(payload.intent),
        associated_at:
          typeof payload.associated_at === "string" ? payload.associated_at : nowIso(),
      };
      const generationConflict = this.db.memberships.some(
        (existing) => existing.generation_id === row.generation_id,
      );
      const ordinalConflict = this.db.memberships.some(
        (existing) =>
          existing.session_id === row.session_id &&
          existing.attempt_ordinal === row.attempt_ordinal,
      );
      if (generationConflict || ordinalConflict) {
        return { data: null, error: { code: "23505" } };
      }
      this.db.memberships.push(row);
      const projected = project(row, this.columns);
      return mode === "maybeSingle"
        ? { data: projected, error: null }
        : { data: [projected], error: null };
    }
    if (this.table === AFC_DIAGNOSTIC_CASE_TABLE) {
      this.db.cases.push({ ...payload });
      return { data: payload, error: null };
    }
    return { data: null, error: { code: "42P01", message: "undefined table" } };
  }

  private executeUpdate() {
    if (this.table === AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE) {
      return {
        data: null,
        error: { code: "P0001", message: "AFC diagnostic session generation membership is immutable" },
      };
    }
    const payload = this.payload ?? {};
    const matched = this.db
      .tableRows(this.table)
      .filter((row) => this.matches(row));
    for (const row of matched) {
      if (this.table === AFC_DIAGNOSTIC_SESSION_TABLE) {
        for (const identity of [
          "room_id",
          "user_id",
          "original_sha256",
          "base_asset_id",
          "created_at",
        ] as const) {
          if (
            identity in payload &&
            payload[identity] !== undefined &&
            payload[identity] !== row[identity]
          ) {
            return {
              data: null,
              error: { code: "P0001", message: "AFC diagnostic session identity is immutable" },
            };
          }
        }
      }
      Object.assign(row, payload);
      if (this.table === AFC_DIAGNOSTIC_SESSION_TABLE) {
        (row as SessionRow).updated_at = nowIso();
      }
    }
    return {
      data: matched.map((row) => project(row, this.columns)),
      error: null,
    };
  }
}

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: SESSION_A,
    room_id: ROOM_A,
    user_id: USER_A,
    original_sha256: SHA_A,
    base_asset_id: null,
    status: "open",
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
    ...overrides,
  };
}

function membershipRow(overrides: Partial<MembershipRow> = {}): MembershipRow {
  return {
    session_id: SESSION_A,
    generation_id: GEN_1,
    attempt_ordinal: 1,
    intent: "analyze",
    associated_at: "2026-09-19T00:00:00.000Z",
    ...overrides,
  };
}

function harness(seed?: {
  sessions?: SessionRow[];
  memberships?: MembershipRow[];
}) {
  const db = new FakeDiagnosticDb(seed);
  const store = createSupabaseAfcDiagnosticSessionStore(db.client());
  return { db, store };
}

function throwingStore(): AfcDiagnosticSessionStore {
  const fail = async () => {
    throw new Error("diagnostic store should not be used");
  };
  return {
    closeStaleOpenSessions: fail,
    findOpenSession: fail,
    insertOpenSession: fail,
    findMembershipByGenerationId: fail,
    maxAttemptOrdinal: fail,
    insertMembership: fail,
  };
}

function enabledResult(
  result: AfcDiagnosticMembershipResult,
): Extract<AfcDiagnosticMembershipResult, { enabled: true }> {
  assert.equal(result.enabled, true);
  if (!result.enabled) throw new Error("expected enabled membership result");
  return result;
}

async function run(
  store: AfcDiagnosticSessionStore,
  input: Record<string, unknown> = {},
  env: AfcQaCapabilityEnv = QA_ALL,
) {
  return ensureAfcDiagnosticSessionMembership(
    {
      userId: USER_A,
      roomId: ROOM_A,
      originalSha256: SHA_A,
      generationId: GEN_1,
      intent: "analyze",
      ...input,
    },
    { store, env },
  );
}

test("1) QA off → no DB writes", async () => {
  const { db, store } = harness();
  const result = await run(store, {}, QA_OFF);
  assert.deepEqual(result, { enabled: false });
  assert.equal(db.sessions.length, 0);
  assert.equal(db.memberships.length, 0);
  assert.equal(db.ops.length, 0);
  await assert.doesNotReject(() =>
    ensureAfcDiagnosticSessionMembership(
      {
        userId: USER_A,
        roomId: ROOM_A,
        originalSha256: SHA_A,
        generationId: GEN_1,
        intent: "analyze",
      },
      { store: throwingStore(), env: QA_OFF },
    ),
  );
});

test("2) invalid/missing QA mode → no DB writes", async () => {
  const missing = harness();
  assert.deepEqual(await run(missing.store, {}, QA_MISSING), { enabled: false });
  assert.equal(missing.db.ops.length, 0);
  const invalid = harness();
  assert.deepEqual(await run(invalid.store, {}, QA_INVALID), { enabled: false });
  assert.equal(invalid.db.ops.length, 0);
  const junk = harness();
  assert.deepEqual(
    await run(junk.store, {}, { VIBODE_AFC_QA_MODE: "true" }),
    { enabled: false },
  );
  assert.equal(junk.db.ops.length, 0);
});

test("3) allowlist matching user → writes allowed", async () => {
  const { db, store } = harness();
  const result = enabledResult(await run(store, {}, QA_ALLOW));
  assert.equal(result.sessionCreated, true);
  assert.equal(result.membershipCreated, true);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.memberships.length, 1);
});

test("4) allowlist non-matching user → no writes", async () => {
  const { db, store } = harness();
  const result = await run(store, { userId: USER_B }, QA_ALLOW);
  assert.deepEqual(result, { enabled: false });
  assert.equal(db.sessions.length, 0);
  assert.equal(db.memberships.length, 0);
  assert.equal(db.ops.length, 0);
});

test("5) all mode → authenticated valid UUID enabled", async () => {
  const { store } = harness();
  const result = enabledResult(await run(store, { userId: USER_B }, QA_ALL));
  assert.equal(result.membershipCreated, true);
  assert.equal(result.sessionCreated, true);
});

test("6) first generation creates open Session", async () => {
  const { db, store } = harness();
  const result = enabledResult(await run(store));
  assert.equal(result.sessionCreated, true);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.sessions[0]?.status, "open");
  assert.equal(db.sessions[0]?.user_id, USER_A);
  assert.equal(db.sessions[0]?.room_id, ROOM_A);
  assert.equal(db.sessions[0]?.original_sha256, SHA_A);
  assert.equal(result.sessionId, db.sessions[0]?.id);
});

test("7) first membership gets ordinal 1", async () => {
  const { db, store } = harness();
  const result = enabledResult(await run(store));
  assert.equal(result.attemptOrdinal, 1);
  assert.equal(db.memberships[0]?.attempt_ordinal, 1);
  assert.equal(db.memberships[0]?.generation_id, GEN_1);
  assert.equal(db.memberships[0]?.intent, "analyze");
});

test("8) second generation same source reuses Session", async () => {
  const { db, store } = harness();
  const first = enabledResult(await run(store, { generationId: GEN_1 }));
  const second = enabledResult(await run(store, { generationId: GEN_2 }));
  assert.equal(first.sessionCreated, true);
  assert.equal(second.sessionCreated, false);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.sessions[0]?.status, "open");
});

test("9) second membership gets ordinal 2", async () => {
  const { store } = harness();
  enabledResult(await run(store, { generationId: GEN_1 }));
  const second = enabledResult(
    await run(store, { generationId: GEN_2, intent: "run_again" }),
  );
  assert.equal(second.attemptOrdinal, 2);
  assert.equal(second.membershipCreated, true);
});

test("10) same source next day/time still reuses same open Session", async () => {
  const { store } = harness({
    sessions: [sessionRow({ created_at: YESTERDAY, updated_at: YESTERDAY })],
  });
  const result = enabledResult(await run(store, { generationId: GEN_2 }));
  assert.equal(result.sessionId, SESSION_A);
  assert.equal(result.sessionCreated, false);
  assert.equal(result.attemptOrdinal, 1);
});

test("11) same SHA in different room creates different Session", async () => {
  const { db, store } = harness();
  const first = enabledResult(await run(store, { roomId: ROOM_A, generationId: GEN_1 }));
  const second = enabledResult(await run(store, { roomId: ROOM_B, generationId: GEN_2 }));
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(db.sessions.length, 2);
  assert.equal(
    db.sessions.filter((row) => row.status === "open").length,
    2,
  );
});

test("12) different user cannot reuse Session", async () => {
  const { db, store } = harness();
  const first = enabledResult(await run(store, { userId: USER_A, generationId: GEN_1 }));
  const second = enabledResult(await run(store, { userId: USER_B, generationId: GEN_2 }));
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(db.sessions.length, 2);
});

test("13) open sha A + new sha B closes A", async () => {
  const { db, store } = harness();
  const first = enabledResult(
    await run(store, { originalSha256: SHA_A, generationId: GEN_1 }),
  );
  await run(store, { originalSha256: SHA_B, generationId: GEN_2 });
  const closed = db.sessions.find((row) => row.id === first.sessionId);
  assert.equal(closed?.status, "closed");
  assert.equal(closed?.original_sha256, SHA_A);
});

test("14) B gets a new open Session", async () => {
  const { db, store } = harness();
  const first = enabledResult(
    await run(store, { originalSha256: SHA_A, generationId: GEN_1 }),
  );
  const second = enabledResult(
    await run(store, { originalSha256: SHA_B, generationId: GEN_2 }),
  );
  assert.equal(second.sessionCreated, true);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(second.staleSessionsClosed, 1);
  const opened = db.sessions.find((row) => row.id === second.sessionId);
  assert.equal(opened?.status, "open");
  assert.equal(opened?.original_sha256, SHA_B);
});

test("15) old A memberships remain immutable/history-preserved", async () => {
  const { db, store } = harness();
  const first = enabledResult(
    await run(store, { originalSha256: SHA_A, generationId: GEN_1 }),
  );
  await run(store, { originalSha256: SHA_B, generationId: GEN_2 });
  const preserved = db.memberships.find((row) => row.generation_id === GEN_1);
  assert.equal(preserved?.session_id, first.sessionId);
  assert.equal(preserved?.attempt_ordinal, 1);
  assert.equal(preserved?.intent, "analyze");
  assert.equal(
    db.ops.some(
      (op) =>
        op.table === AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE && op.action === "update",
    ),
    false,
  );
});

test("16) only same user+room stale Session closes", async () => {
  const { db, store } = harness({
    sessions: [
      sessionRow({ id: SESSION_A, original_sha256: SHA_A }),
      sessionRow({
        id: SESSION_ROOM_B,
        room_id: ROOM_B,
        original_sha256: SHA_C,
      }),
      sessionRow({
        id: SESSION_USER_B,
        user_id: USER_B,
        original_sha256: SHA_C,
      }),
    ],
    memberships: [membershipRow()],
  });
  const result = enabledResult(
    await run(store, { originalSha256: SHA_B, generationId: GEN_2 }),
  );
  assert.equal(result.staleSessionsClosed, 1);
  assert.equal(db.sessions.find((row) => row.id === SESSION_A)?.status, "closed");
  assert.equal(db.sessions.find((row) => row.id === SESSION_ROOM_B)?.status, "open");
  assert.equal(db.sessions.find((row) => row.id === SESSION_USER_B)?.status, "open");
});

test("17) unrelated room Session remains open", async () => {
  const { db, store } = harness({
    sessions: [
      sessionRow({ id: SESSION_A, original_sha256: SHA_A }),
      sessionRow({
        id: SESSION_ROOM_B,
        room_id: ROOM_B,
        original_sha256: SHA_A,
      }),
    ],
  });
  await run(store, { originalSha256: SHA_B, generationId: GEN_2 });
  assert.equal(db.sessions.find((row) => row.id === SESSION_ROOM_B)?.status, "open");
});

test("18) unrelated user Session remains open", async () => {
  const { db, store } = harness({
    sessions: [
      sessionRow({ id: SESSION_A, original_sha256: SHA_A }),
      sessionRow({
        id: SESSION_USER_B,
        user_id: USER_B,
        original_sha256: SHA_A,
      }),
    ],
  });
  await run(store, { originalSha256: SHA_B, generationId: GEN_2 });
  assert.equal(db.sessions.find((row) => row.id === SESSION_USER_B)?.status, "open");
});

test("19) same generation invoked twice does not duplicate membership", async () => {
  const { db, store } = harness();
  await run(store, { generationId: GEN_1 });
  await run(store, { generationId: GEN_1 });
  assert.equal(db.memberships.length, 1);
});

test("20) second invocation returns original ordinal", async () => {
  const { store } = harness();
  const first = enabledResult(await run(store, { generationId: GEN_1 }));
  const second = enabledResult(
    await run(store, { generationId: GEN_1, intent: "run_again" }),
  );
  assert.equal(second.attemptOrdinal, first.attemptOrdinal);
  assert.equal(second.membershipCreated, false);
  assert.equal(second.sessionId, first.sessionId);
});

test("21) same generation already in another Session causes integrity failure", async () => {
  const { db, store } = harness({
    sessions: [
      sessionRow({ id: SESSION_A, original_sha256: SHA_A, status: "open" }),
    ],
    memberships: [membershipRow({ session_id: SESSION_A, generation_id: GEN_1 })],
  });
  await assert.rejects(
    () => run(store, { originalSha256: SHA_B, generationId: GEN_1 }),
    (error: unknown) =>
      error instanceof AfcDiagnosticSessionIntegrityError &&
      error.code === "generation_session_mismatch",
  );
  assert.equal(
    db.memberships.filter((row) => row.generation_id === GEN_1).length,
    1,
  );
  assert.equal(
    db.memberships.find((row) => row.generation_id === GEN_1)?.session_id,
    SESSION_A,
  );
});

test("22) competing open-Session insert unique conflict selects winner", async () => {
  const { db, store } = harness({
    sessions: [sessionRow({ id: SESSION_A })],
  });
  const conflict = await store.insertOpenSession({
    userId: USER_A,
    roomId: ROOM_A,
    originalSha256: SHA_A,
    baseAssetId: null,
  });
  assert.deepEqual(conflict, { ok: false, code: "unique_open_conflict" });

  let finds = 0;
  const racing: AfcDiagnosticSessionStore = {
    ...store,
    async findOpenSession(input) {
      finds += 1;
      if (finds === 1) return null;
      return store.findOpenSession(input);
    },
  };
  const result = enabledResult(await run(racing, { generationId: GEN_2 }));
  assert.equal(result.sessionId, SESSION_A);
  assert.equal(result.sessionCreated, false);
  assert.equal(db.sessions.length, 1);
  assert.equal(finds >= 2, true);
});

test("23) competing ordinal insert retries and obtains a distinct ordinal", async () => {
  const { db, store } = harness({
    sessions: [sessionRow({ id: SESSION_A })],
  });
  let forced = false;
  const racing: AfcDiagnosticSessionStore = {
    ...store,
    async insertMembership(input) {
      if (!forced && input.attemptOrdinal === 1) {
        forced = true;
        const competitor = await store.insertMembership({
          ...input,
          generationId: GEN_OTHER,
        });
        assert.equal(competitor.ok, true);
        return { ok: false, code: "unique_ordinal_conflict" };
      }
      return store.insertMembership(input);
    },
  };
  const result = enabledResult(await run(racing, { generationId: GEN_1 }));
  assert.equal(result.attemptOrdinal, 2);
  assert.equal(result.membershipCreated, true);
  assert.deepEqual(
    db.memberships.map((row) => [row.generation_id, row.attempt_ordinal]).sort(),
    [
      [GEN_1, 2],
      [GEN_OTHER, 1],
    ],
  );
});

test("24) retry bound prevents infinite loop", async () => {
  const { store } = harness({
    sessions: [sessionRow({ id: SESSION_A })],
  });
  let inserts = 0;
  const stuck: AfcDiagnosticSessionStore = {
    ...store,
    async insertMembership() {
      inserts += 1;
      return { ok: false, code: "unique_ordinal_conflict" };
    },
  };
  await assert.rejects(
    () => run(stuck, { generationId: GEN_1 }),
    (error: unknown) =>
      error instanceof AfcDiagnosticSessionConcurrencyError &&
      error.code === "retry_exhausted",
  );
  assert.equal(inserts, AFC_DIAGNOSTIC_MEMBERSHIP_ORDINAL_RETRY_LIMIT);
  assert.equal(AFC_DIAGNOSTIC_MEMBERSHIP_ORDINAL_RETRY_LIMIT > 0, true);
  assert.equal(AFC_DIAGNOSTIC_SESSION_OPEN_RETRY_LIMIT > 0, true);
});

test("25) non-unique/non-concurrency DB error is surfaced", async () => {
  const { db, store } = harness();
  db.failNext({ code: "40001", message: "serialization_failure" });
  await assert.rejects(
    () =>
      store.insertOpenSession({
        userId: USER_A,
        roomId: ROOM_A,
        originalSha256: SHA_A,
        baseAssetId: null,
      }),
    (error: unknown) =>
      error instanceof AfcDiagnosticSessionStoreError &&
      error.causeCode === "40001",
  );

  const broken: AfcDiagnosticSessionStore = {
    ...store,
    async closeStaleOpenSessions() {
      throw new AfcDiagnosticSessionStoreError(
        "Diagnostic session store failed (57014).",
        "57014",
      );
    },
  };
  await assert.rejects(
    () => run(broken),
    (error: unknown) =>
      error instanceof AfcDiagnosticSessionStoreError &&
      error.causeCode === "57014",
  );
});

test("26) invalid user UUID rejected", async () => {
  await assert.rejects(
    () => run(throwingStore(), { userId: "not-a-user" }, QA_ALL),
    (error: unknown) =>
      error instanceof AfcDiagnosticSessionInputError &&
      error.code === "invalid_user_id",
  );
});

test("27) invalid room UUID rejected", async () => {
  await assert.rejects(
    () => run(throwingStore(), { roomId: "bad-room" }, QA_OFF),
    (error: unknown) =>
      error instanceof AfcDiagnosticSessionInputError &&
      error.code === "invalid_room_id",
  );
});

test("28) invalid generation UUID rejected", async () => {
  await assert.rejects(
    () => run(throwingStore(), { generationId: 123 }, QA_ALL),
    (error: unknown) =>
      error instanceof AfcDiagnosticSessionInputError &&
      error.code === "invalid_generation_id",
  );
});

test("29) invalid baseAssetId rejected", async () => {
  await assert.rejects(
    () => run(throwingStore(), { baseAssetId: "asset" }, QA_ALL),
    (error: unknown) =>
      error instanceof AfcDiagnosticSessionInputError &&
      error.code === "invalid_base_asset_id",
  );
});

test("30) empty/invalid ORIGINAL sha rejected", async () => {
  for (const originalSha256 of ["", "   ", "abc", "a".repeat(63), "a".repeat(65), "g".repeat(64)]) {
    await assert.rejects(
      () => run(throwingStore(), { originalSha256 }, QA_ALL),
      (error: unknown) =>
        error instanceof AfcDiagnosticSessionInputError &&
        error.code === "invalid_original_sha256",
      String(originalSha256),
    );
  }
  assert.equal(parseAfcOriginalSha256(SHA_A), SHA_A);
  assert.equal(parseAfcOriginalSha256("A".repeat(64)), SHA_A);
  assert.equal(parseAfcOriginalSha256("  " + SHA_B + "  "), SHA_B);
  assert.equal(parseAfcOriginalSha256(""), null);
});

test("31) invalid intent rejected", async () => {
  for (const intent of ["retry", "READY", "", "analyze ", "Run_again"]) {
    await assert.rejects(
      () => run(throwingStore(), { intent }, QA_ALL),
      (error: unknown) =>
        error instanceof AfcDiagnosticSessionInputError &&
        error.code === "invalid_intent",
      intent,
    );
  }
  const { store } = harness();
  enabledResult(await run(store, { intent: "reread_perspective", generationId: GEN_3 }));
});

test("32) no generation row UPDATE", async () => {
  const { db, store } = harness();
  await run(store, { generationId: GEN_1 });
  await run(store, { generationId: GEN_2, originalSha256: SHA_B });
  assert.equal(
    db.ops.some((op) => op.table === "vibode_afc_generations"),
    false,
  );
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.doesNotMatch(lifecycle, /vibode_afc_generations/);
  assert.doesNotMatch(lifecycle, /status:\s*["']READY["']|generation status/);
});

test("33) no activation/current pointer calls", async () => {
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.doesNotMatch(
    lifecycle,
    /activate_vibode_afc_generation|current_afc_generation_id|production_authority|engine_fingerprint|parent_generation_id|lineage_seq/,
  );
  const { db, store } = harness();
  await run(store);
  assert.equal(
    db.ops.some((op) => op.table === "vibode_rooms" || op.table === "vibode_afc_generations"),
    false,
  );
});

test("34) no Case writes", async () => {
  const { db, store } = harness();
  await run(store);
  await run(store, { originalSha256: SHA_B, generationId: GEN_2 });
  assert.equal(db.cases.length, 0);
  assert.equal(
    db.ops.some((op) => op.table === AFC_DIAGNOSTIC_CASE_TABLE),
    false,
  );
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.doesNotMatch(
    lifecycle,
    /vibode_afc_diagnostic_cases|repeated_unsuccessful|issue_codes/,
  );
});

test("35) no public route added", async () => {
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.match(lifecycle, /import "server-only"/);
  assert.doesNotMatch(lifecycle, /NextResponse|handleAfc|export async function GET|export async function POST/);
  const apiFiles = walkTs(path.join(ROOT, "app/api"));
  for (const file of apiFiles) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /session-lifecycle|ensureAfcDiagnosticSessionMembership/,
      path.relative(ROOT, file),
    );
  }
  assert.doesNotMatch(
    source("app/editor/page.tsx"),
    /session-lifecycle|ensureAfcDiagnosticSessionMembership/,
  );
  assert.doesNotMatch(
    source("lib/afc-v2-runtime/use-prepare-3d-room.ts"),
    /session-lifecycle|ensureAfcDiagnosticSessionMembership/,
  );
});

test("36) no migration added", async () => {
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /lifecycle|afd.?2|session_membership/i.test(name)),
    false,
  );
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.doesNotMatch(lifecycle, /create table|create unique index|create policy|grant /i);
});

test("37) no browser grants/policies added", async () => {
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.match(lifecycle, /getServiceRoleSupabaseClient/);
  assert.doesNotMatch(
    lifecycle,
    /createBrowserClient|getCookieSupabaseClient|SUPABASE_ANON_KEY|authenticated|create policy|grant /i,
  );
  const migration = source(
    "supabase/migrations/20260921120000_vibode_afc_v2_diagnostic_foundation.sql",
  );
  assert.match(migration, /revoke all on table public\.vibode_afc_diagnostic_sessions/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /create policy/);
});

test("store classifies generation unique vs ordinal unique via 23505 lookup", async () => {
  const { store } = harness({
    sessions: [
      sessionRow({ id: SESSION_A }),
      sessionRow({
        id: SESSION_B,
        original_sha256: SHA_B,
      }),
    ],
  });
  const first = await store.insertMembership({
    sessionId: SESSION_A,
    generationId: GEN_1,
    attemptOrdinal: 1,
    intent: "analyze",
  });
  assert.equal(first.ok, true);
  const generationConflict = await store.insertMembership({
    sessionId: SESSION_B,
    generationId: GEN_1,
    attemptOrdinal: 1,
    intent: "analyze",
  });
  assert.deepEqual(generationConflict, {
    ok: false,
    code: "unique_generation_conflict",
  });
  const ordinalConflict = await store.insertMembership({
    sessionId: SESSION_A,
    generationId: GEN_2,
    attemptOrdinal: 1,
    intent: "run_again",
  });
  assert.deepEqual(ordinalConflict, {
    ok: false,
    code: "unique_ordinal_conflict",
  });
});

test("source-change close is a no-op when no stale Session exists", async () => {
  const { db, store } = harness();
  const result = enabledResult(await run(store));
  assert.equal(result.staleSessionsClosed, 0);
  assert.equal(db.sessions[0]?.status, "open");
});

test("READY/FAILED/RUNNING is not a Session close or membership prerequisite", async () => {
  const { db, store } = harness();
  const first = enabledResult(await run(store, { generationId: GEN_1 }));
  const second = enabledResult(await run(store, { generationId: GEN_2 }));
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(db.sessions[0]?.status, "open");
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.doesNotMatch(lifecycle, /READY|FAILED|RUNNING/);
});

test("closed Session for the same source is not reused; a new open Session is created", async () => {
  const { db, store } = harness({
    sessions: [sessionRow({ id: SESSION_A, status: "closed" })],
    memberships: [membershipRow()],
  });
  const result = enabledResult(await run(store, { generationId: GEN_2 }));
  assert.equal(result.sessionCreated, true);
  assert.notEqual(result.sessionId, SESSION_A);
  assert.equal(db.sessions.find((row) => row.id === SESSION_A)?.status, "closed");
  assert.equal(db.memberships.find((row) => row.generation_id === GEN_1)?.session_id, SESSION_A);
});

test("baseAssetId snapshot is stored on create and ignored on reuse", async () => {
  const { db, store } = harness();
  const first = enabledResult(await run(store, { baseAssetId: ASSET_A }));
  assert.equal(db.sessions.find((row) => row.id === first.sessionId)?.base_asset_id, ASSET_A);
  await run(store, { generationId: GEN_2, baseAssetId: null });
  assert.equal(db.sessions.find((row) => row.id === first.sessionId)?.base_asset_id, ASSET_A);
  assert.equal(
    db.ops.some(
      (op) =>
        op.action === "update" &&
        op.table === AFC_DIAGNOSTIC_SESSION_TABLE &&
        op.payload != null &&
        "base_asset_id" in op.payload,
    ),
    false,
  );
});

test("close filters require exact user, room, open status, and different sha", async () => {
  const { store } = harness({
    sessions: [
      sessionRow({ id: SESSION_A, original_sha256: SHA_A, status: "open" }),
      sessionRow({
        id: "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        original_sha256: SHA_C,
        status: "closed",
      }),
    ],
  });
  const closed = await store.closeStaleOpenSessions({
    userId: USER_A,
    roomId: ROOM_A,
    originalSha256: SHA_B,
  });
  assert.equal(closed, 1);
  const none = await store.closeStaleOpenSessions({
    userId: USER_A,
    roomId: ROOM_A,
    originalSha256: SHA_A,
  });
  assert.equal(none, 0);
});

test("isPostgresUniqueViolation uses SQLSTATE 23505, not message parsing", () => {
  assert.equal(isPostgresUniqueViolation({ code: "23505" }), true);
  assert.equal(isPostgresUniqueViolation({ code: 23505 }), true);
  assert.equal(
    isPostgresUniqueViolation({
      message: "duplicate key value violates unique constraint",
    }),
    false,
  );
  assert.equal(isPostgresUniqueViolation({ code: "23503" }), false);
});

test("open-session retry bound is finite when unique conflict never resolves", async () => {
  const { store } = harness();
  let inserts = 0;
  const stuck: AfcDiagnosticSessionStore = {
    ...store,
    async findOpenSession() {
      return null;
    },
    async insertOpenSession() {
      inserts += 1;
      return { ok: false, code: "unique_open_conflict" };
    },
  };
  await assert.rejects(
    () => run(stuck),
    (error: unknown) => error instanceof AfcDiagnosticSessionConcurrencyError,
  );
  assert.equal(inserts, AFC_DIAGNOSTIC_SESSION_OPEN_RETRY_LIMIT);
});

test("capability HTTP endpoint is not called and caller enabled flags are ignored", async () => {
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.match(lifecycle, /resolveAfcQaCapability\(/);
  assert.doesNotMatch(
    lifecycle,
    /handleAfcQaCapabilityGet|\/api\/vibode\/afc\/qa\/capability|fetch\(/,
  );
  assert.doesNotMatch(lifecycle, /options\.enabled|input\.enabled|qaMode/);
  const { db, store } = harness();
  const result = await ensureAfcDiagnosticSessionMembership(
    {
      userId: USER_A,
      roomId: ROOM_A,
      originalSha256: SHA_A,
      generationId: GEN_1,
      intent: "analyze",
      enabled: true,
    } as never,
    { store, env: QA_OFF },
  );
  assert.deepEqual(result, { enabled: false });
  assert.equal(db.ops.length, 0);
});

test("production AFC surfaces are not imported by the lifecycle primitive", () => {
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.doesNotMatch(
    lifecycle,
    /production-adapter|production-persistence|production-authority-contract|runProductionAfcAnalysis/,
  );
  for (const relative of [
    "app/api/vibode/afc/analyze/route.ts",
    "lib/afc-v2-production/production-adapter.server.ts",
    "lib/afc-v2-production/production-persistence.server.ts",
  ]) {
    assert.doesNotMatch(
      source(relative),
      /session-lifecycle|ensureAfcDiagnosticSessionMembership/,
    );
  }
});

test("ordinary lifecycle evaluation does not log", () => {
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.doesNotMatch(lifecycle, /console\.(log|info|warn|error|debug)/);
});
