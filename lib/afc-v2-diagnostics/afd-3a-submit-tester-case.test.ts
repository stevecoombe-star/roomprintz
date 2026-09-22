import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { collectProductionPayloadPrivacyViolations } from "@/lib/afc-v2-production/privacy";
import {
  productionAfcJson,
  type ProductionAfcAuth,
} from "@/lib/afc-v2-production/production-http";

import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_NOTES_MAX_CHARS,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
} from "./contracts";
import type { AfcQaCapabilityEnv } from "./qa-capability.server";
import {
  AFC_GENERATION_TABLE,
  createSupabaseAfcDiagnosticRetryEpisodeStore,
  getAfcDiagnosticRetryEpisodeSignal,
  type AfcDiagnosticRetryEpisodeStore,
} from "./retry-episode-signal.server";
import {
  AFC_DIAGNOSTIC_TESTER_CASE_TRIGGERS,
  AFC_ROOM_TABLE,
  buildAfcDiagnosticOriginalIdentity,
  createSupabaseAfcDiagnosticTesterCaseStore,
  handleAfcQaTesterCasePost,
  isRepeatedUnsuccessfulEligible,
  submitAfcDiagnosticTesterCase,
  AfcDiagnosticTesterCaseGenerationError,
  AfcDiagnosticTesterCaseInputError,
  AfcDiagnosticTesterCaseMembershipError,
  AfcDiagnosticTesterCaseQaDisabledError,
  AfcDiagnosticTesterCaseRoomError,
  AfcDiagnosticTesterCaseSessionError,
  AfcDiagnosticTesterCaseTaxonomyError,
  AfcDiagnosticTesterCaseTriggerError,
  type AfcDiagnosticTesterCaseStore,
  type AfcDiagnosticTesterCaseSubmitInput,
} from "./submit-tester-case.server";
import { AFC_QA_ISSUE_TAXONOMY_VERSION } from "./taxonomy";

const ROOT = process.cwd();
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GEN_1 = "11111111-1111-4111-8111-111111111111";
const GEN_2 = "12121212-1212-4121-8121-121212121212";
const GEN_3 = "13131313-1313-4131-8131-131313131313";
const SESSION_A = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SESSION_B = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ASSET_SESSION = "99999999-9999-4999-8999-999999999999";
const ASSET_ROOM = "88888888-8888-4888-8888-888888888888";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const AFD3A_MIGRATION =
  "supabase/migrations/20260923120000_vibode_afc_v2_diagnostic_tester_case_unique.sql";
const AFD1A_MIGRATION =
  "supabase/migrations/20260921120000_vibode_afc_v2_diagnostic_foundation.sql";

const QA_ALL: AfcQaCapabilityEnv = { VIBODE_AFC_QA_MODE: "all" };
const QA_OFF: AfcQaCapabilityEnv = { VIBODE_AFC_QA_MODE: "off" };
const QA_ALLOW: AfcQaCapabilityEnv = {
  VIBODE_AFC_QA_MODE: "allowlist",
  VIBODE_AFC_QA_USER_IDS: USER_A,
};

type RoomRow = {
  id: string;
  user_id: string;
  base_asset_id?: string | null;
  current_afc_generation_id?: string | null;
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

type GenerationRow = {
  id: string;
  user_id: string;
  room_id: string;
  status: string;
  original_sha256: string | null;
  original_decoded_width?: number | null;
  original_decoded_height?: number | null;
  original_byte_count?: number | null;
  original_mime_type?: string | null;
  original_orientation?: number | null;
  production_authority?: unknown;
  diagnostic_payload?: unknown;
  engine_fingerprint?: unknown;
  empty_storage_path?: unknown;
  tiled_storage_path?: unknown;
  provider_provenance?: unknown;
  failure_reason?: unknown;
};

type CaseRow = Record<string, unknown>;

type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "in"; column: string; value: unknown[] };

type DbOp = {
  table: string;
  action: "select" | "insert" | "update" | "delete";
  columns: string;
  payload?: Record<string, unknown>;
  filters: Filter[];
};

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function withoutComments(sql: string) {
  return sql.replace(/--[^\n]*/g, "");
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
  return "2026-09-19T12:00:00.000Z";
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
  rooms: RoomRow[] = [];
  sessions: SessionRow[] = [];
  memberships: MembershipRow[] = [];
  generations: GenerationRow[] = [];
  cases: CaseRow[] = [];
  ops: DbOp[] = [];
  nextError: { code?: string | number; message?: string } | null = null;

  constructor(seed?: {
    rooms?: RoomRow[];
    sessions?: SessionRow[];
    memberships?: MembershipRow[];
    generations?: GenerationRow[];
    cases?: CaseRow[];
  }) {
    this.rooms = seed?.rooms ? seed.rooms.map((row) => ({ ...row })) : [];
    this.sessions = seed?.sessions ? seed.sessions.map((row) => ({ ...row })) : [];
    this.memberships = seed?.memberships
      ? seed.memberships.map((row) => ({ ...row }))
      : [];
    this.generations = seed?.generations
      ? seed.generations.map((row) => ({ ...row }))
      : [];
    this.cases = seed?.cases ? seed.cases.map((row) => ({ ...row })) : [];
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
    if (table === AFC_ROOM_TABLE) return this.rooms;
    if (table === AFC_DIAGNOSTIC_SESSION_TABLE) return this.sessions;
    if (table === AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE) return this.memberships;
    if (table === AFC_GENERATION_TABLE) return this.generations;
    if (table === AFC_DIAGNOSTIC_CASE_TABLE) return this.cases;
    throw new Error(`unexpected table ${table}`);
  }
}

class FakeQuery {
  private action: "select" | "insert" | "update" | "delete" = "select";
  private columns = "*";
  private payload: Record<string, unknown> | null = null;
  private filters: Filter[] = [];
  private orderColumn: string | null = null;
  private orderAscending = true;

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

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ type: "in", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderColumn = column;
    this.orderAscending = options?.ascending !== false;
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
      if (filter.type === "eq") return value === filter.value;
      return Array.isArray(filter.value) && filter.value.includes(value);
    });
  }

  private execute(mode: "maybeSingle" | "rows") {
    this.db.ops.push({
      table: this.table,
      action: this.action,
      columns: this.columns,
      payload: this.payload ?? undefined,
      filters: [...this.filters],
    });
    if (this.db.nextError) {
      const error = this.db.nextError;
      this.db.nextError = null;
      return { data: null, error };
    }
    if (this.action === "insert") return this.executeInsert(mode);
    if (this.action === "update" || this.action === "delete") {
      return { data: null, error: { code: "P0001", message: `${this.action} not expected` } };
    }
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
    if (this.table !== AFC_DIAGNOSTIC_CASE_TABLE) {
      return { data: null, error: { code: "42P01", message: "unexpected insert" } };
    }
    const testerTriggers = new Set<string>(AFC_DIAGNOSTIC_TESTER_CASE_TRIGGERS);
    const row: CaseRow = {
      id: typeof payload.id === "string" ? payload.id : crypto.randomUUID(),
      session_id: payload.session_id,
      room_id: payload.room_id,
      reporter_user_id: payload.reporter_user_id,
      reported_generation_id: payload.reported_generation_id,
      original_sha256: payload.original_sha256,
      original_identity: payload.original_identity ?? null,
      taxonomy_version: payload.taxonomy_version,
      issue_codes: payload.issue_codes,
      notes: payload.notes ?? null,
      trigger: payload.trigger,
      machine_status_snapshot: payload.machine_status_snapshot,
      submitted_at:
        typeof payload.submitted_at === "string" ? payload.submitted_at : nowIso(),
      review_status:
        typeof payload.review_status === "string" ? payload.review_status : "new",
      reviewer_user_id: payload.reviewer_user_id ?? null,
      review_notes: payload.review_notes ?? null,
      reviewed_at: payload.reviewed_at ?? null,
    };
    if (testerTriggers.has(String(row.trigger))) {
      const conflict = this.db.cases.some(
        (existing) =>
          testerTriggers.has(String(existing.trigger)) &&
          existing.reporter_user_id === row.reporter_user_id &&
          existing.reported_generation_id === row.reported_generation_id,
      );
      if (conflict) return { data: null, error: { code: "23505" } };
    }
    this.db.cases.push(row);
    const projected = project(row, this.columns);
    return mode === "maybeSingle"
      ? { data: projected, error: null }
      : { data: [projected], error: null };
  }
}

function roomRow(overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    id: ROOM_A,
    user_id: USER_A,
    base_asset_id: ASSET_ROOM,
    current_afc_generation_id: GEN_3,
    ...overrides,
  };
}

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: SESSION_A,
    room_id: ROOM_A,
    user_id: USER_A,
    original_sha256: SHA_A,
    base_asset_id: ASSET_SESSION,
    status: "open",
    created_at: nowIso(),
    updated_at: nowIso(),
    ...overrides,
  };
}

function membershipRow(overrides: Partial<MembershipRow> = {}): MembershipRow {
  return {
    session_id: SESSION_A,
    generation_id: GEN_1,
    attempt_ordinal: 1,
    intent: "analyze",
    associated_at: nowIso(),
    ...overrides,
  };
}

function generationRow(overrides: Partial<GenerationRow> = {}): GenerationRow {
  return {
    id: GEN_1,
    user_id: USER_A,
    room_id: ROOM_A,
    status: "ready",
    original_sha256: SHA_A,
    original_decoded_width: 1200,
    original_decoded_height: 800,
    original_byte_count: 4096,
    original_mime_type: "image/jpeg",
    original_orientation: 1,
    production_authority: { schemaVersion: "hidden" },
    diagnostic_payload: { prompt: "do not fetch" },
    engine_fingerprint: { gitSha: "deadbeef" },
    empty_storage_path: "users/secret/empty.png",
    tiled_storage_path: "users/secret/tiled.png",
    provider_provenance: { model: "hidden" },
    failure_reason: "secret-failure",
    ...overrides,
  };
}

function caseRow(overrides: CaseRow = {}): CaseRow {
  return {
    id: "ccccccc1-cccc-4ccc-8ccc-ccccccccccc1",
    session_id: SESSION_A,
    room_id: ROOM_A,
    reporter_user_id: USER_A,
    reported_generation_id: GEN_1,
    original_sha256: SHA_A,
    original_identity: { decodedWidth: 1 },
    taxonomy_version: AFC_QA_ISSUE_TAXONOMY_VERSION,
    issue_codes: ["perspective_off"],
    notes: "keep me",
    trigger: "manual_report",
    machine_status_snapshot: "ready",
    submitted_at: nowIso(),
    review_status: "new",
    reviewer_user_id: null,
    review_notes: null,
    reviewed_at: null,
    ...overrides,
  };
}

function validWorld(overrides?: {
  rooms?: RoomRow[];
  sessions?: SessionRow[];
  memberships?: MembershipRow[];
  generations?: GenerationRow[];
  cases?: CaseRow[];
}) {
  return {
    rooms: overrides?.rooms ?? [roomRow()],
    sessions: overrides?.sessions ?? [sessionRow()],
    memberships: overrides?.memberships ?? [membershipRow()],
    generations: overrides?.generations ?? [generationRow()],
    cases: overrides?.cases ?? [],
  };
}

function harness(seed?: Parameters<typeof validWorld>[0]) {
  const db = new FakeDiagnosticDb(validWorld(seed));
  const client = db.client();
  const store = createSupabaseAfcDiagnosticTesterCaseStore(client);
  const retryStore = createSupabaseAfcDiagnosticRetryEpisodeStore(client);
  return { db, store, retryStore };
}

function throwingStore(): AfcDiagnosticTesterCaseStore {
  const fail = async () => {
    throw new Error("diagnostic case store should not be used");
  };
  return {
    findRoom: fail,
    findGenerationEvidence: fail,
    findMembershipByGenerationId: fail,
    findSessionById: fail,
    findTesterCase: fail,
    insertTesterCase: fail,
  };
}

function throwingRetryStore(): AfcDiagnosticRetryEpisodeStore {
  const fail = async () => {
    throw new Error("retry-episode store should not be used");
  };
  return {
    findSessionById: fail,
    listMembershipsBySessionId: fail,
    listGenerationMachineStatuses: fail,
  };
}

async function submit(
  store: AfcDiagnosticTesterCaseStore,
  retryStore: AfcDiagnosticRetryEpisodeStore,
  input: Partial<AfcDiagnosticTesterCaseSubmitInput> = {},
  env: AfcQaCapabilityEnv = QA_ALL,
) {
  return submitAfcDiagnosticTesterCase(
    {
      userId: USER_A,
      roomId: ROOM_A,
      generationId: GEN_1,
      issueCodes: ["perspective_off"],
      trigger: "manual_report",
      ...input,
    },
    { store, retryStore, env },
  );
}

function unauthorized(): ProductionAfcAuth {
  return {
    ok: false,
    response: productionAfcJson({ error: "Unauthorized." }, 401),
  };
}

function authorized(userId: string): ProductionAfcAuth {
  return { ok: true, userId };
}

async function postCase(args: {
  userId?: string | null;
  body?: unknown;
  env?: AfcQaCapabilityEnv;
  store?: AfcDiagnosticTesterCaseStore;
  retryStore?: AfcDiagnosticRetryEpisodeStore;
}) {
  return handleAfcQaTesterCasePost({
    request: new Request("http://test/api/vibode/afc/qa/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body:
        args.body === undefined
          ? JSON.stringify({
              roomId: ROOM_A,
              generationId: GEN_1,
              issueCodes: ["perspective_off"],
              trigger: "manual_report",
            })
          : typeof args.body === "string"
            ? args.body
            : JSON.stringify(args.body),
    }),
    authorize: async () =>
      args.userId ? authorized(args.userId) : unauthorized(),
    env: args.env ?? QA_ALL,
    store: args.store,
    retryStore: args.retryStore,
  });
}

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function insertedCase(db: FakeDiagnosticDb) {
  assert.equal(db.cases.length, 1);
  return db.cases[0]!;
}

test("1) QA disabled → no insert", async () => {
  const { db, store, retryStore } = harness();
  await assert.rejects(
    () => submit(store, retryStore, {}, QA_OFF),
    (error: unknown) => error instanceof AfcDiagnosticTesterCaseQaDisabledError,
  );
  assert.equal(db.cases.length, 0);
  assert.equal(db.ops.length, 0);
});

test("2) allowlist miss → no insert", async () => {
  const { db, store, retryStore } = harness();
  await assert.rejects(
    () => submit(store, retryStore, { userId: USER_B }, QA_ALLOW),
    (error: unknown) => error instanceof AfcDiagnosticTesterCaseQaDisabledError,
  );
  assert.equal(db.cases.length, 0);
  assert.equal(db.ops.length, 0);
});

test("3) eligible user proceeds", async () => {
  const { db, store, retryStore } = harness();
  const result = await submit(store, retryStore, {}, QA_ALLOW);
  assert.deepEqual(result, { submitted: true, idempotent: false });
  assert.equal(db.cases.length, 1);
});

test("4) room not found rejected", async () => {
  const { db, store, retryStore } = harness({ rooms: [] });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseRoomError &&
      error.code === "room_not_found",
  );
  assert.equal(db.cases.length, 0);
});

test("5) room wrong owner rejected", async () => {
  const { db, store, retryStore } = harness({
    rooms: [roomRow({ user_id: USER_B })],
  });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseRoomError &&
      error.code === "room_ownership_mismatch",
  );
  assert.equal(db.cases.length, 0);
});

test("6) generation wrong user rejected", async () => {
  const { db, store, retryStore } = harness({
    generations: [generationRow({ user_id: USER_B })],
  });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseGenerationError &&
      error.code === "generation_ownership_mismatch",
  );
  assert.equal(db.cases.length, 0);
});

test("7) generation wrong room rejected", async () => {
  const { db, store, retryStore } = harness({
    generations: [generationRow({ room_id: ROOM_B })],
  });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseGenerationError &&
      error.code === "generation_room_mismatch",
  );
  assert.equal(db.cases.length, 0);
});

test("8) generation without membership rejected", async () => {
  const { db, store, retryStore } = harness({ memberships: [] });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) => error instanceof AfcDiagnosticTesterCaseMembershipError,
  );
  assert.equal(db.cases.length, 0);
  assert.equal(
    db.ops.some((op) => op.table === AFC_DIAGNOSTIC_SESSION_TABLE),
    false,
  );
});

test("9) membership resolves Session server-side", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  assert.equal(insertedCase(db).session_id, SESSION_A);
  const membershipOp = db.ops.find(
    (op) =>
      op.table === AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE &&
      op.action === "select",
  );
  assert.equal(
    membershipOp?.filters.some(
      (filter) => filter.type === "eq" && filter.column === "generation_id",
    ),
    true,
  );
});

test("10) browser cannot choose Session", async () => {
  const { db, store, retryStore } = harness();
  await submitAfcDiagnosticTesterCase(
    {
      userId: USER_A,
      roomId: ROOM_A,
      generationId: GEN_1,
      issueCodes: ["perspective_off"],
      trigger: "manual_report",
      sessionId: SESSION_B,
    } as never,
    { store, retryStore, env: QA_ALL },
  );
  assert.equal(insertedCase(db).session_id, SESSION_A);
  assert.notEqual(insertedCase(db).session_id, SESSION_B);
});

test("11) Session wrong user rejected", async () => {
  const { db, store, retryStore } = harness({
    sessions: [sessionRow({ user_id: USER_B })],
  });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseSessionError &&
      error.code === "session_user_mismatch",
  );
  assert.equal(db.cases.length, 0);
});

test("12) Session wrong room rejected", async () => {
  const { db, store, retryStore } = harness({
    sessions: [sessionRow({ room_id: ROOM_B })],
  });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseSessionError &&
      error.code === "session_room_mismatch",
  );
  assert.equal(db.cases.length, 0);
});

test("13) Session sha mismatch rejected", async () => {
  const { db, store, retryStore } = harness({
    sessions: [sessionRow({ original_sha256: SHA_B })],
  });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseSessionError &&
      error.code === "session_sha_mismatch",
  );
  assert.equal(db.cases.length, 0);
});

test("14) closed Session rejected", async () => {
  const { db, store, retryStore } = harness({
    sessions: [sessionRow({ status: "closed" })],
  });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseSessionError &&
      error.code === "session_closed",
  );
  assert.equal(db.cases.length, 0);
});

test("15) open valid Session accepted", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  assert.equal(insertedCase(db).session_id, SESSION_A);
  assert.equal(db.sessions[0]?.status, "open");
});

test("16) READY generation accepted for manual_report", async () => {
  const { db, store, retryStore } = harness({
    generations: [generationRow({ status: "ready" })],
  });
  await submit(store, retryStore, { trigger: "manual_report" });
  assert.equal(insertedCase(db).machine_status_snapshot, "ready");
});

test("17) FAILED generation accepted for manual_report", async () => {
  const { db, store, retryStore } = harness({
    generations: [generationRow({ status: "failed" })],
  });
  await submit(store, retryStore, { trigger: "manual_report" });
  assert.equal(insertedCase(db).machine_status_snapshot, "failed");
});

test("18) RUNNING generation rejected", async () => {
  const { db, store, retryStore } = harness({
    generations: [generationRow({ status: "running" })],
  });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseGenerationError &&
      error.code === "generation_ineligible",
  );
  assert.equal(db.cases.length, 0);
});

test("19) machine_status_snapshot server-derived", async () => {
  const { db, store, retryStore } = harness({
    generations: [generationRow({ status: "ready" })],
  });
  await submitAfcDiagnosticTesterCase(
    {
      userId: USER_A,
      roomId: ROOM_A,
      generationId: GEN_1,
      issueCodes: ["perspective_off"],
      trigger: "manual_report",
      machineStatusSnapshot: "failed",
    } as never,
    { store, retryStore, env: QA_ALL },
  );
  assert.equal(insertedCase(db).machine_status_snapshot, "ready");
});

test("20) one valid code", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore, { issueCodes: ["scale_incorrect"] });
  assert.deepEqual(insertedCase(db).issue_codes, ["scale_incorrect"]);
});

test("21) multiple valid codes", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore, {
    issueCodes: ["perspective_off", "wall_edges_unrecognized", "other"],
  });
  assert.deepEqual(insertedCase(db).issue_codes, [
    "perspective_off",
    "wall_edges_unrecognized",
    "other",
  ]);
});

test("22) duplicate codes deduped preserving order", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore, {
    issueCodes: [
      "scale_incorrect",
      "perspective_off",
      "scale_incorrect",
      "other",
      "perspective_off",
    ],
  });
  assert.deepEqual(insertedCase(db).issue_codes, [
    "scale_incorrect",
    "perspective_off",
    "other",
  ]);
});

test("23) unknown code rejected", async () => {
  await assert.rejects(
    () =>
      submit(throwingStore(), throwingRetryStore(), {
        issueCodes: ["perspective_off", "not_a_code"],
      }),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseTaxonomyError &&
      error.code === "unknown_code",
  );
});

test("24) empty code list rejected", async () => {
  await assert.rejects(
    () => submit(throwingStore(), throwingRetryStore(), { issueCodes: [] }),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseTaxonomyError &&
      error.code === "empty_codes",
  );
});

test("25) notes trimmed", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore, { notes: "  walls drift left  " });
  assert.equal(insertedCase(db).notes, "walls drift left");
});

test("26) blank notes → null", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore, { notes: "   " });
  assert.equal(insertedCase(db).notes, null);
});

test("27) > 2000 notes rejected", async () => {
  await assert.rejects(
    () =>
      submit(throwingStore(), throwingRetryStore(), {
        notes: "x".repeat(AFC_DIAGNOSTIC_NOTES_MAX_CHARS + 1),
      }),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseTaxonomyError &&
      error.code === "notes_too_long",
  );
});

test("28) other without notes accepted", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore, { issueCodes: ["other"] });
  assert.deepEqual(insertedCase(db).issue_codes, ["other"]);
  assert.equal(insertedCase(db).notes, null);
});

test("29) taxonomy version server-fixed to v1", async () => {
  const { db, store, retryStore } = harness();
  await submitAfcDiagnosticTesterCase(
    {
      userId: USER_A,
      roomId: ROOM_A,
      generationId: GEN_1,
      issueCodes: ["perspective_off"],
      trigger: "manual_report",
      taxonomyVersion: "afc-qa-issue-taxonomy/v2",
    } as never,
    { store, retryStore, env: QA_ALL },
  );
  assert.equal(insertedCase(db).taxonomy_version, AFC_QA_ISSUE_TAXONOMY_VERSION);
});

test("30) manual_report accepted on valid terminal generation", async () => {
  const { store, retryStore } = harness({
    generations: [generationRow({ status: "failed" })],
  });
  const result = await submit(store, retryStore, { trigger: "manual_report" });
  assert.equal(result.submitted, true);
});

test("31) admin_capture rejected", async () => {
  await assert.rejects(
    () =>
      submit(throwingStore(), throwingRetryStore(), { trigger: "admin_capture" }),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseInputError &&
      error.code === "admin_capture_rejected",
  );
});

function failedRetryWorld(latest: {
  generationId: string;
  status: string;
  extra?: Array<{ generationId: string; status: string; ordinal: number }>;
}) {
  const extras = latest.extra ?? [
    { generationId: GEN_1, status: "failed", ordinal: 1 },
  ];
  return validWorld({
    generations: [
      ...extras.map((row) =>
        generationRow({
          id: row.generationId,
          status: row.status,
        }),
      ),
      generationRow({ id: latest.generationId, status: latest.status }),
    ],
    memberships: [
      ...extras.map((row) =>
        membershipRow({
          generation_id: row.generationId,
          attempt_ordinal: row.ordinal,
        }),
      ),
      membershipRow({
        generation_id: latest.generationId,
        attempt_ordinal: extras.length + 1,
        intent: "run_again",
      }),
    ],
  });
}

test("32) repeated_unsuccessful accepted only with attemptCount >=2 + latest same generation + latest failed", async () => {
  const seed = failedRetryWorld({ generationId: GEN_2, status: "failed" });
  const { db, store, retryStore } = harness(seed);
  const result = await submit(store, retryStore, {
    generationId: GEN_2,
    trigger: "repeated_unsuccessful",
  });
  assert.equal(result.idempotent, false);
  assert.equal(insertedCase(db).trigger, "repeated_unsuccessful");
  assert.equal(insertedCase(db).reported_generation_id, GEN_2);
});

test("33) first failed attempt rejected for repeated_unsuccessful", async () => {
  const { db, store, retryStore } = harness({
    generations: [generationRow({ status: "failed" })],
    memberships: [membershipRow()],
  });
  await assert.rejects(
    () =>
      submit(store, retryStore, {
        trigger: "repeated_unsuccessful",
      }),
    (error: unknown) => error instanceof AfcDiagnosticTesterCaseTriggerError,
  );
  assert.equal(db.cases.length, 0);
});

test("34) latest READY rejected for repeated_unsuccessful", async () => {
  const { db, store, retryStore } = harness(
    failedRetryWorld({ generationId: GEN_2, status: "ready" }),
  );
  await assert.rejects(
    () =>
      submit(store, retryStore, {
        generationId: GEN_2,
        trigger: "repeated_unsuccessful",
      }),
    (error: unknown) => error instanceof AfcDiagnosticTesterCaseTriggerError,
  );
  assert.equal(db.cases.length, 0);
});

test("35) historical failed but latest READY rejected", async () => {
  const { db, store, retryStore } = harness(
    failedRetryWorld({
      generationId: GEN_2,
      status: "ready",
      extra: [{ generationId: GEN_1, status: "failed", ordinal: 1 }],
    }),
  );
  await assert.rejects(
    () =>
      submit(store, retryStore, {
        generationId: GEN_2,
        trigger: "repeated_unsuccessful",
      }),
    (error: unknown) => error instanceof AfcDiagnosticTesterCaseTriggerError,
  );
  assert.equal(db.cases.length, 0);
});

test("36) requested generation not latest rejected", async () => {
  const { db, store, retryStore } = harness(
    failedRetryWorld({ generationId: GEN_2, status: "failed" }),
  );
  await assert.rejects(
    () =>
      submit(store, retryStore, {
        generationId: GEN_1,
        trigger: "repeated_unsuccessful",
      }),
    (error: unknown) => error instanceof AfcDiagnosticTesterCaseTriggerError,
  );
  assert.equal(db.cases.length, 0);
});

test("37) sha copied from generation", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  assert.equal(insertedCase(db).original_sha256, SHA_A);
});

test("38) identity snapshot built only from server evidence", async () => {
  const { db, store, retryStore } = harness();
  await submitAfcDiagnosticTesterCase(
    {
      userId: USER_A,
      roomId: ROOM_A,
      generationId: GEN_1,
      issueCodes: ["perspective_off"],
      trigger: "manual_report",
      originalIdentity: { decodedWidth: 1, mimeType: "image/gif" },
    } as never,
    { store, retryStore, env: QA_ALL },
  );
  assert.deepEqual(insertedCase(db).original_identity, {
    decodedWidth: 1200,
    decodedHeight: 800,
    byteCount: 4096,
    mimeType: "image/jpeg",
    orientation: 1,
    baseAssetId: ASSET_SESSION,
  });
});

test("39) browser cannot override original sha/identity", async () => {
  const { db, store, retryStore } = harness();
  await submitAfcDiagnosticTesterCase(
    {
      userId: USER_A,
      roomId: ROOM_A,
      generationId: GEN_1,
      issueCodes: ["perspective_off"],
      trigger: "manual_report",
      originalSha256: SHA_B,
      originalIdentity: { baseAssetId: ASSET_ROOM },
    } as never,
    { store, retryStore, env: QA_ALL },
  );
  assert.equal(insertedCase(db).original_sha256, SHA_A);
  assert.equal(
    (insertedCase(db).original_identity as { baseAssetId?: string }).baseAssetId,
    ASSET_SESSION,
  );
});

test("40) baseAssetId source follows frozen Session snapshot rule", async () => {
  const { db, store, retryStore } = harness({
    rooms: [roomRow({ base_asset_id: ASSET_ROOM })],
    sessions: [sessionRow({ base_asset_id: ASSET_SESSION })],
  });
  await submit(store, retryStore);
  const identity = insertedCase(db).original_identity as {
    baseAssetId?: string;
  };
  assert.equal(identity.baseAssetId, ASSET_SESSION);
  assert.notEqual(identity.baseAssetId, ASSET_ROOM);
  const roomOp = db.ops.find((op) => op.table === AFC_ROOM_TABLE);
  assert.equal(roomOp?.columns.includes("base_asset_id"), false);
  assert.deepEqual(
    buildAfcDiagnosticOriginalIdentity({
      generation: {
        id: GEN_1,
        userId: USER_A,
        roomId: ROOM_A,
        status: "ready",
        originalSha256: SHA_A,
        originalDecodedWidth: null,
        originalDecodedHeight: null,
        originalByteCount: null,
        originalMimeType: null,
        originalOrientation: null,
      },
      session: {
        id: SESSION_A,
        roomId: ROOM_A,
        userId: USER_A,
        originalSha256: SHA_A,
        baseAssetId: null,
        status: "open",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    }),
    null,
  );
});

test("41) first submission inserts Case", async () => {
  const { db, store, retryStore } = harness();
  const result = await submit(store, retryStore);
  assert.equal(result.idempotent, false);
  assert.equal(db.cases.length, 1);
  assert.equal(insertedCase(db).reporter_user_id, USER_A);
  assert.equal(insertedCase(db).reported_generation_id, GEN_1);
});

test("42) second same reporter+generation returns idempotent success", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  const second = await submit(store, retryStore, {
    issueCodes: ["other"],
    notes: "changed",
  });
  assert.deepEqual(second, { submitted: true, idempotent: true });
  assert.equal(db.cases.length, 1);
});

test("43) second submission does not mutate existing codes/notes", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore, {
    issueCodes: ["perspective_off"],
    notes: "keep me",
  });
  await submit(store, retryStore, {
    issueCodes: ["other", "scale_incorrect"],
    notes: "changed",
  });
  assert.deepEqual(insertedCase(db).issue_codes, ["perspective_off"]);
  assert.equal(insertedCase(db).notes, "keep me");
});

test("44) concurrent/unique-conflict path resolves as idempotent success", async () => {
  const { db, store, retryStore } = harness({
    cases: [caseRow({ issue_codes: ["perspective_off"], notes: "keep me" })],
  });
  let finds = 0;
  const racing: AfcDiagnosticTesterCaseStore = {
    ...store,
    async findTesterCase(input) {
      finds += 1;
      if (finds === 1) return null;
      return store.findTesterCase(input);
    },
    async insertTesterCase() {
      return { ok: false, code: "unique_tester_conflict" };
    },
  };
  const result = await submit(racing, retryStore, {
    issueCodes: ["other"],
    notes: "changed",
  });
  assert.deepEqual(result, { submitted: true, idempotent: true });
  assert.equal(db.cases.length, 1);
  assert.deepEqual(db.cases[0]?.issue_codes, ["perspective_off"]);
  assert.equal(db.cases[0]?.notes, "keep me");
  assert.equal(finds, 2);
});

test("45) another generation in same Session may create another Case", async () => {
  const { db, store, retryStore } = harness({
    generations: [
      generationRow({ id: GEN_1, status: "failed" }),
      generationRow({ id: GEN_2, status: "ready" }),
    ],
    memberships: [
      membershipRow({ generation_id: GEN_1, attempt_ordinal: 1 }),
      membershipRow({
        generation_id: GEN_2,
        attempt_ordinal: 2,
        intent: "run_again",
      }),
    ],
  });
  await submit(store, retryStore, { generationId: GEN_1 });
  await submit(store, retryStore, { generationId: GEN_2 });
  assert.equal(db.cases.length, 2);
  assert.deepEqual(
    db.cases.map((row) => row.reported_generation_id).sort(),
    [GEN_1, GEN_2].sort(),
  );
});

test("46) admin_capture is not blocked by tester partial unique index at schema level", async () => {
  const migration = source(AFD3A_MIGRATION);
  assert.match(
    withoutComments(migration),
    /create unique index vibode_afc_diagnostic_cases_one_tester_reporter_generation_uidx\s+on public\.vibode_afc_diagnostic_cases \(\s+reporter_user_id,\s+reported_generation_id\s+\)\s+where "trigger" in \('manual_report', 'repeated_unsuccessful'\)/,
  );
  assert.doesNotMatch(withoutComments(migration), /admin_capture/);
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  const { error } = await db.client().from(AFC_DIAGNOSTIC_CASE_TABLE).insert({
    session_id: SESSION_A,
    room_id: ROOM_A,
    reporter_user_id: USER_A,
    reported_generation_id: GEN_1,
    original_sha256: SHA_A,
    taxonomy_version: AFC_QA_ISSUE_TAXONOMY_VERSION,
    issue_codes: ["other"],
    trigger: "admin_capture",
    machine_status_snapshot: "ready",
  }).maybeSingle();
  assert.equal(error, null);
  assert.equal(db.cases.length, 2);
  assert.equal(
    db.cases.filter((row) => row.trigger === "admin_capture").length,
    1,
  );
});

test("47) Session remains open after Case insert", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  assert.equal(db.sessions[0]?.status, "open");
  assert.equal(db.sessions[0]?.updated_at, nowIso());
});

test("48) no Session UPDATE", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  assert.equal(
    db.ops.some(
      (op) => op.table === AFC_DIAGNOSTIC_SESSION_TABLE && op.action === "update",
    ),
    false,
  );
});

test("49) no generation UPDATE", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  assert.equal(
    db.ops.some((op) => op.table === AFC_GENERATION_TABLE && op.action === "update"),
    false,
  );
});

test("50) no activation", async () => {
  const implementation = source(
    "lib/afc-v2-diagnostics/submit-tester-case.server.ts",
  );
  assert.doesNotMatch(
    implementation,
    /activate_vibode_afc_generation|current_afc_generation_id|activateGeneration/,
  );
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  assert.equal(
    db.ops.some((op) => op.table === "vibode_rooms" && op.action === "update"),
    false,
  );
});

test("51) no Case auto-create from signal alone", async () => {
  const { db, retryStore } = harness(
    failedRetryWorld({ generationId: GEN_2, status: "failed" }),
  );
  const signal = await getAfcDiagnosticRetryEpisodeSignal(
    { sessionId: SESSION_A, userId: USER_A },
    { store: retryStore },
  );
  assert.equal(signal.attemptCount >= 2, true);
  assert.equal(isRepeatedUnsuccessfulEligible(signal, GEN_2), true);
  assert.equal(db.cases.length, 0);
  const implementation = source(
    "lib/afc-v2-diagnostics/retry-episode-signal.server.ts",
  );
  assert.doesNotMatch(implementation, /vibode_afc_diagnostic_cases|insertTesterCase/);
});

test("52) no Editor changes", () => {
  assert.doesNotMatch(
    source("app/editor/page.tsx"),
    /submit-tester-case|\/api\/vibode\/afc\/qa\/cases|issueCodes/,
  );
  assert.doesNotMatch(
    source("lib/afc-v2-runtime/use-prepare-3d-room.ts"),
    /submit-tester-case|\/api\/vibode\/afc\/qa\/cases/,
  );
});

test("53) AFD-3A Case submit does not implement browser QA state", () => {
  const implementation = source(
    "lib/afc-v2-diagnostics/submit-tester-case.server.ts",
  );
  const route = source("app/api/vibode/afc/qa/cases/route.ts");
  assert.doesNotMatch(
    `${implementation}\n${route}`,
    /offerFeedback|canReport|reportGenerationId|qa\/state|handleAfcQaBrowserStateGet/,
  );
  assert.doesNotMatch(route, /export async function GET/);
});

test("54) no READY rerun changes", () => {
  const analyze = source("app/api/vibode/afc/analyze/route.ts");
  assert.match(analyze, /onGenerationCreated: attachAfcDiagnosticSessionBestEffort/);
  assert.doesNotMatch(analyze, /submit-tester-case|qa\/cases/);
  const implementation = source(
    "lib/afc-v2-diagnostics/submit-tester-case.server.ts",
  );
  assert.doesNotMatch(
    implementation,
    /runProductionAfcAnalysis|run_again|reread_perspective/,
  );
});

test("review fields stay at SQL defaults and are not written by the primitive", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  const insertOp = db.ops.find(
    (op) => op.table === AFC_DIAGNOSTIC_CASE_TABLE && op.action === "insert",
  );
  assert.ok(insertOp?.payload);
  for (const forbidden of [
    "review_status",
    "reviewer_user_id",
    "review_notes",
    "reviewed_at",
    "id",
    "submitted_at",
  ]) {
    assert.equal(forbidden in insertOp.payload, false, forbidden);
  }
  assert.equal(insertedCase(db).review_status, "new");
  assert.equal(insertedCase(db).reviewer_user_id, null);
  assert.equal(insertedCase(db).review_notes, null);
  assert.equal(insertedCase(db).reviewed_at, null);
});

test("generation select is compact Case evidence only", async () => {
  const { db, store, retryStore } = harness();
  await submit(store, retryStore);
  const generationOp = db.ops.find(
    (op) => op.table === AFC_GENERATION_TABLE && op.action === "select",
  );
  assert.equal(
    generationOp?.columns,
    "id, user_id, room_id, status, original_sha256, original_decoded_width, original_decoded_height, original_byte_count, original_mime_type, original_orientation",
  );
  for (const forbidden of [
    "production_authority",
    "diagnostic_payload",
    "engine_fingerprint",
    "empty_storage_path",
    "tiled_storage_path",
    "provider_provenance",
    "failure_reason",
  ]) {
    assert.equal(generationOp?.columns.includes(forbidden), false, forbidden);
  }
});

test("manual_report does not consult the retry-episode store", async () => {
  const { store } = harness();
  await submit(store, throwingRetryStore(), { trigger: "manual_report" });
});

test("missing generation is unavailable", async () => {
  const { store, retryStore } = harness({ generations: [] });
  await assert.rejects(
    () => submit(store, retryStore),
    (error: unknown) =>
      error instanceof AfcDiagnosticTesterCaseGenerationError &&
      error.code === "generation_unavailable",
  );
});

test("public POST maps errors without leaking internals", async () => {
  const { db, store, retryStore } = harness();
  const unauthorizedResponse = await postCase({ userId: null });
  assert.equal(unauthorizedResponse.status, 401);
  assert.deepEqual(await jsonBody(unauthorizedResponse), {
    error: "Unauthorized.",
  });

  const invalidJson = await postCase({
    userId: USER_A,
    body: "not-json",
    store,
    retryStore,
  });
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await jsonBody(invalidJson), { error: "Invalid request." });

  const qaOff = await postCase({
    userId: USER_A,
    env: QA_OFF,
    store,
    retryStore,
  });
  assert.equal(qaOff.status, 404);
  assert.deepEqual(await jsonBody(qaOff), { error: "Not available." });

  const missingRoom = await postCase({
    userId: USER_A,
    store: createSupabaseAfcDiagnosticTesterCaseStore(
      new FakeDiagnosticDb(validWorld({ rooms: [] })).client(),
    ),
    retryStore,
  });
  assert.equal(missingRoom.status, 404);
  assert.deepEqual(await jsonBody(missingRoom), { error: "Room not found." });

  const adminCapture = await postCase({
    userId: USER_A,
    body: {
      roomId: ROOM_A,
      generationId: GEN_1,
      issueCodes: ["perspective_off"],
      trigger: "admin_capture",
    },
    store: throwingStore(),
    retryStore: throwingRetryStore(),
  });
  assert.equal(adminCapture.status, 400);
  assert.deepEqual(await jsonBody(adminCapture), { error: "Invalid request." });

  const success = await postCase({
    userId: USER_A,
    body: {
      roomId: ROOM_A,
      generationId: GEN_1,
      issueCodes: ["perspective_off"],
      notes: "ok",
      trigger: "manual_report",
      sessionId: SESSION_B,
      reporterUserId: USER_B,
      taxonomyVersion: "v2",
      machineStatusSnapshot: "failed",
      originalSha256: SHA_B,
    },
    store,
    retryStore,
  });
  assert.equal(success.status, 200);
  const body = await jsonBody(success);
  assert.deepEqual(body, { submitted: true });
  assert.equal("caseId" in body, false);
  assert.equal("sessionId" in body, false);
  assert.equal("idempotent" in body, false);
  assert.deepEqual(collectProductionPayloadPrivacyViolations(body), []);
  assert.equal(success.headers.get("Cache-Control"), "no-store");
  assert.equal(insertedCase(db).session_id, SESSION_A);
  assert.equal(insertedCase(db).reporter_user_id, USER_A);
  assert.equal(insertedCase(db).original_sha256, SHA_A);
  assert.equal(insertedCase(db).taxonomy_version, AFC_QA_ISSUE_TAXONOMY_VERSION);
  assert.equal(insertedCase(db).machine_status_snapshot, "ready");
});

test("store failure maps to generic 500 wording", async () => {
  const { db, store, retryStore } = harness();
  db.failNext({ code: "57014", message: "canceling statement due to statement timeout" });
  const response = await postCase({ userId: USER_A, store, retryStore });
  assert.equal(response.status, 500);
  const body = await jsonBody(response);
  assert.deepEqual(body, { error: "Server misconfigured." });
  assert.doesNotMatch(JSON.stringify(body), /57014|statement timeout|constraint/);
});

test("AFD-3A migration is partial unique tester hardening only", () => {
  const migration = source(AFD3A_MIGRATION);
  const sql = withoutComments(migration);
  assert.match(sql, /create unique index vibode_afc_diagnostic_cases_one_tester_reporter_generation_uidx/);
  assert.match(sql, /reporter_user_id,/);
  assert.match(sql, /reported_generation_id/);
  assert.match(sql, /where "trigger" in \('manual_report', 'repeated_unsuccessful'\)/);
  assert.doesNotMatch(sql, /create table|alter table|create policy|grant /i);
  assert.doesNotMatch(sql, /to anon|to authenticated/);
  assert.doesNotMatch(sql, /issue_codes|original_identity|taxonomy_version/);
  assert.doesNotMatch(
    source(AFD1A_MIGRATION),
    /vibode_afc_diagnostic_cases_one_tester_reporter_generation_uidx/,
  );
});

test("AFD-3A does not import production authority, adapter, or persistence", () => {
  const implementation = source(
    "lib/afc-v2-diagnostics/submit-tester-case.server.ts",
  );
  assert.doesNotMatch(
    implementation,
    /production-adapter|production-persistence|production-authority-contract|runProductionAfcAnalysis|session-attach|ensureAfcDiagnosticSessionMembership|closeStaleOpenSessions/,
  );
  assert.match(implementation, /resolveAfcQaCapability\(/);
  assert.match(implementation, /getAfcDiagnosticRetryEpisodeSignal/);
  assert.doesNotMatch(
    implementation,
    /handleAfcQaCapabilityGet|\/api\/vibode\/afc\/qa\/capability|fetch\(/,
  );
});

test("ordinary Case submission does not log", () => {
  const implementation = source(
    "lib/afc-v2-diagnostics/submit-tester-case.server.ts",
  );
  const route = source("app/api/vibode/afc/qa/cases/route.ts");
  assert.doesNotMatch(
    `${implementation}\n${route}`,
    /console\.(log|info|warn|error|debug)/,
  );
});

test("browser API surfaces outside QA cases do not import the tester Case primitive", () => {
  const files = [
    ...walkTs(path.join(ROOT, "app/api/vibode/afc")).filter(
      (file) => !file.includes(`${path.sep}afc${path.sep}qa${path.sep}`),
    ),
    ...walkTs(path.join(ROOT, "lib/afc-v2-production")),
    ...walkTs(path.join(ROOT, "lib/afc-v2-runtime")),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /submit-tester-case|submitAfcDiagnosticTesterCase|handleAfcQaTesterCasePost/,
      path.relative(ROOT, file),
    );
  }
});
