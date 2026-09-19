import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { collectProductionPayloadPrivacyViolations } from "@/lib/afc-v2-production/privacy";
import {
  productionAfcJson,
  type ProductionAfcAuth,
} from "@/lib/afc-v2-production/production-http";

import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
} from "./contracts";
import type { AfcQaCapabilityEnv } from "./qa-capability.server";
import {
  AFC_GENERATION_TABLE,
  createSupabaseAfcDiagnosticRetryEpisodeStore,
  AfcDiagnosticRetryEpisodeIntegrityError,
  AfcDiagnosticRetryEpisodeStoreError,
  type AfcDiagnosticRetryEpisodeStore,
} from "./retry-episode-signal.server";
import {
  AFC_ROOM_TABLE,
  createSupabaseAfcDiagnosticBrowserQaStateStore,
  freezeAfcDiagnosticBrowserQaState,
  getAfcDiagnosticBrowserQaState,
  handleAfcQaBrowserStateGet,
  projectAfcDiagnosticBrowserQaState,
  AfcDiagnosticBrowserQaStateIntegrityError,
  AfcDiagnosticBrowserQaStateRoomError,
  type AfcDiagnosticBrowserQaState,
  type AfcDiagnosticBrowserQaStateStore,
} from "./browser-qa-state.server";

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
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const PUBLIC_KEYS = [
  "enabled",
  "canReport",
  "offerFeedback",
  "reportGenerationId",
] as const;

const QA_ALL: AfcQaCapabilityEnv = { VIBODE_AFC_QA_MODE: "all" };
const QA_OFF: AfcQaCapabilityEnv = { VIBODE_AFC_QA_MODE: "off" };
const QA_ALLOW: AfcQaCapabilityEnv = {
  VIBODE_AFC_QA_MODE: "allowlist",
  VIBODE_AFC_QA_USER_IDS: USER_A,
};

type RoomRow = { id: string; user_id: string };

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
  status: string;
  lineage_seq?: number;
  created_at?: string;
  engine_fingerprint?: unknown;
  production_authority?: unknown;
  diagnostic_payload?: unknown;
  failure_reason?: unknown;
};

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
  cases: Record<string, unknown>[] = [];
  ops: DbOp[] = [];
  nextError: { code?: string | number; message?: string } | null = null;

  constructor(seed?: {
    rooms?: RoomRow[];
    sessions?: SessionRow[];
    memberships?: MembershipRow[];
    generations?: GenerationRow[];
  }) {
    this.rooms = seed?.rooms ? seed.rooms.map((row) => ({ ...row })) : [];
    this.sessions = seed?.sessions ? seed.sessions.map((row) => ({ ...row })) : [];
    this.memberships = seed?.memberships
      ? seed.memberships.map((row) => ({ ...row }))
      : [];
    this.generations = seed?.generations
      ? seed.generations.map((row) => ({ ...row }))
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
    if (this.action !== "select") {
      return {
        data: null,
        error: { code: "P0001", message: `unexpected ${this.action}` },
      };
    }
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
}

function roomRow(overrides: Partial<RoomRow> = {}): RoomRow {
  return { id: ROOM_A, user_id: USER_A, ...overrides };
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

function generationRow(overrides: Partial<GenerationRow> = {}): GenerationRow {
  return {
    id: GEN_1,
    status: "ready",
    lineage_seq: 99,
    created_at: "2020-01-01T00:00:00.000Z",
    engine_fingerprint: { gitSha: "deadbeef" },
    production_authority: { schemaVersion: "hidden" },
    diagnostic_payload: { prompt: "do not fetch" },
    failure_reason: "secret-failure",
    ...overrides,
  };
}

function harness(seed?: {
  rooms?: RoomRow[];
  sessions?: SessionRow[];
  memberships?: MembershipRow[];
  generations?: GenerationRow[];
}) {
  const db = new FakeDiagnosticDb({
    rooms: seed?.rooms ?? [roomRow()],
    sessions: seed?.sessions ?? [],
    memberships: seed?.memberships ?? [],
    generations: seed?.generations ?? [],
  });
  const client = db.client();
  return {
    db,
    store: createSupabaseAfcDiagnosticBrowserQaStateStore(client),
    retryStore: createSupabaseAfcDiagnosticRetryEpisodeStore(client),
  };
}

function episode(seed: {
  sessionStatus?: "open" | "closed";
  extraSessions?: SessionRow[];
  extraRooms?: RoomRow[];
  attempts: Array<{
    generationId?: string;
    intent?: string;
    status: string;
    sessionId?: string;
  }>;
}) {
  const gens = [GEN_1, GEN_2, GEN_3];
  const memberships = seed.attempts.map((attempt, index) =>
    membershipRow({
      session_id: attempt.sessionId ?? SESSION_A,
      generation_id: attempt.generationId ?? gens[index]!,
      attempt_ordinal: index + 1,
      intent: attempt.intent ?? (index === 0 ? "analyze" : "run_again"),
    }),
  );
  return harness({
    rooms: seed.extraRooms ?? [roomRow()],
    sessions: [
      sessionRow({ status: seed.sessionStatus ?? "open" }),
      ...(seed.extraSessions ?? []),
    ],
    memberships,
    generations: memberships.map((row, index) =>
      generationRow({
        id: row.generation_id,
        status: seed.attempts[index]!.status,
        lineage_seq: 100 - index,
      }),
    ),
  });
}

function throwingStateStore(): AfcDiagnosticBrowserQaStateStore {
  const fail = async () => {
    throw new Error("browser QA state store should not be used");
  };
  return {
    findRoom: fail,
    listOpenSessionsByUserAndRoom: fail,
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

function unauthorized(): ProductionAfcAuth {
  return {
    ok: false,
    response: productionAfcJson({ error: "Unauthorized." }, 401),
  };
}

function authorized(userId: string): ProductionAfcAuth {
  return { ok: true, userId };
}

function publicState(overrides: Partial<AfcDiagnosticBrowserQaState> = {}) {
  return {
    enabled: true,
    canReport: false,
    offerFeedback: false,
    reportGenerationId: null,
    ...overrides,
  };
}

function disabledPublicState() {
  return publicState({ enabled: false });
}

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function getState(args: {
  userId?: string | null;
  url?: string;
  env?: AfcQaCapabilityEnv;
  store?: AfcDiagnosticBrowserQaStateStore;
  retryStore?: AfcDiagnosticRetryEpisodeStore;
  retrySignal?: typeof import("./retry-episode-signal.server").getAfcDiagnosticRetryEpisodeSignal;
}) {
  return handleAfcQaBrowserStateGet({
    request: new Request(
      args.url ?? `http://test/api/vibode/afc/qa/state?roomId=${ROOM_A}`,
    ),
    authorize: async () =>
      args.userId ? authorized(args.userId) : unauthorized(),
    env: args.env ?? QA_ALL,
    store: args.store,
    retryStore: args.retryStore,
    retrySignal: args.retrySignal,
  });
}

async function assertPublic(
  response: Response,
  expected: AfcDiagnosticBrowserQaState,
) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await jsonBody(response);
  assert.deepEqual(body, expected);
  assert.deepEqual(Object.keys(body).sort(), [...PUBLIC_KEYS].sort());
  assert.deepEqual(collectProductionPayloadPrivacyViolations(body), []);
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "sessionId",
    "attemptCount",
    "latestAttempt",
    "issueCodes",
    "taxonomyVersion",
    "originalSha256",
    "machineStatus",
    "failureReason",
    "caseId",
    "sessionStatus",
    "hasFailedAttempt",
    "hasReadyAttempt",
    "hasMultipleAttempts",
    "canRerun",
    "trigger",
    "latestIntent",
    "latestStatus",
  ]) {
    assert.equal(forbidden in body, false, forbidden);
    assert.doesNotMatch(serialized, new RegExp(`"${forbidden}"`));
  }
}

test("1) QA off returns disabled state without diagnostic reads", async () => {
  const { db } = harness({
    sessions: [sessionRow()],
    memberships: [membershipRow()],
    generations: [generationRow({ status: "failed" })],
  });
  const response = await getState({
    userId: USER_A,
    env: QA_OFF,
    store: throwingStateStore(),
    retryStore: throwingRetryStore(),
  });
  await assertPublic(response, disabledPublicState());
  assert.equal(db.ops.length, 0);
});

test("2) QA allowlisted user is enabled", async () => {
  const { store, retryStore } = harness();
  const response = await getState({
    userId: USER_A,
    env: QA_ALLOW,
    store,
    retryStore,
  });
  await assertPublic(response, publicState());
});

test("3) non-allowlisted user receives disabled state", async () => {
  const response = await getState({
    userId: USER_B,
    env: QA_ALLOW,
    store: throwingStateStore(),
    retryStore: throwingRetryStore(),
  });
  await assertPublic(response, disabledPublicState());
});

test("4) unauthenticated route returns 401", async () => {
  const response = await getState({
    store: throwingStateStore(),
    retryStore: throwingRetryStore(),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await jsonBody(response), { error: "Unauthorized." });
});

test("5) invalid room UUID returns 400", async () => {
  const response = await getState({
    userId: USER_A,
    url: "http://test/api/vibode/afc/qa/state?roomId=not-a-room",
    store: throwingStateStore(),
    retryStore: throwingRetryStore(),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await jsonBody(response), { error: "Invalid request." });
});

test("missing roomId returns 400", async () => {
  const response = await getState({
    userId: USER_A,
    url: "http://test/api/vibode/afc/qa/state",
    store: throwingStateStore(),
    retryStore: throwingRetryStore(),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await jsonBody(response), { error: "Invalid request." });
});

test("6) missing room is privacy-safe 404", async () => {
  const { store, retryStore } = harness({ rooms: [] });
  const response = await getState({ userId: USER_A, store, retryStore });
  assert.equal(response.status, 404);
  assert.deepEqual(await jsonBody(response), { error: "Room not found." });
});

test("7) room owned by another user is the same privacy-safe 404", async () => {
  let listed = false;
  const store: AfcDiagnosticBrowserQaStateStore = {
    async findRoom() {
      return { id: ROOM_B, userId: USER_B };
    },
    async listOpenSessionsByUserAndRoom() {
      listed = true;
      return [{ id: SESSION_B }];
    },
  };
  const response = await getState({
    userId: USER_A,
    url: `http://test/api/vibode/afc/qa/state?roomId=${ROOM_B}`,
    store,
    retryStore: throwingRetryStore(),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await jsonBody(response), { error: "Room not found." });
  assert.equal(listed, false);
  await assert.rejects(
    () =>
      getAfcDiagnosticBrowserQaState(
        { userId: USER_A, roomId: ROOM_B },
        { store, env: QA_ALL, retryStore: throwingRetryStore() },
      ),
    (error: unknown) =>
      error instanceof AfcDiagnosticBrowserQaStateRoomError &&
      error.code === "room_ownership_mismatch",
  );
});

test("8) QA enabled + owned room + no open Session is idle enabled state", async () => {
  const { store, retryStore } = harness({
    sessions: [sessionRow({ status: "closed" })],
    memberships: [membershipRow()],
    generations: [generationRow({ status: "failed" })],
  });
  const response = await getState({
    userId: USER_A,
    store,
    retryStore: throwingRetryStore(),
  });
  await assertPublic(response, publicState());
  assert.equal(retryStore != null, true);
});

test("9) first READY attempt is reportable without feedback", async () => {
  const { store, retryStore } = episode({
    attempts: [{ status: "ready" }],
  });
  const response = await getState({ userId: USER_A, store, retryStore });
  await assertPublic(
    response,
    publicState({
      canReport: true,
      offerFeedback: false,
      reportGenerationId: GEN_1,
    }),
  );
});

test("10) first FAILED attempt is reportable without feedback", async () => {
  const { store, retryStore } = episode({
    attempts: [{ status: "failed" }],
  });
  const response = await getState({ userId: USER_A, store, retryStore });
  await assertPublic(
    response,
    publicState({
      canReport: true,
      offerFeedback: false,
      reportGenerationId: GEN_1,
    }),
  );
});

test("11) second FAILED attempt offers feedback", async () => {
  const { store, retryStore } = episode({
    attempts: [{ status: "failed" }, { status: "failed" }],
  });
  const response = await getState({ userId: USER_A, store, retryStore });
  await assertPublic(
    response,
    publicState({
      canReport: true,
      offerFeedback: true,
      reportGenerationId: GEN_2,
    }),
  );
});

test("12) later FAILED attempt still offers feedback", async () => {
  const { store, retryStore } = episode({
    attempts: [
      { status: "failed" },
      { status: "failed" },
      { status: "failed" },
    ],
  });
  const response = await getState({ userId: USER_A, store, retryStore });
  await assertPublic(
    response,
    publicState({
      canReport: true,
      offerFeedback: true,
      reportGenerationId: GEN_3,
    }),
  );
});

test("13) FAILED then READY reports the READY generation without feedback", async () => {
  const { store, retryStore } = episode({
    attempts: [{ status: "failed" }, { status: "ready" }],
  });
  const response = await getState({ userId: USER_A, store, retryStore });
  await assertPublic(
    response,
    publicState({
      canReport: true,
      offerFeedback: false,
      reportGenerationId: GEN_2,
    }),
  );
});

test("14) READY then FAILED reports the latest FAILED generation with feedback", async () => {
  const { store, retryStore } = episode({
    attempts: [{ status: "ready" }, { status: "failed" }],
  });
  const response = await getState({ userId: USER_A, store, retryStore });
  await assertPublic(
    response,
    publicState({
      canReport: true,
      offerFeedback: true,
      reportGenerationId: GEN_2,
    }),
  );
});

test("15) latest RUNNING cannot report even with historical failure", async () => {
  const { store, retryStore } = episode({
    attempts: [{ status: "failed" }, { status: "running" }],
  });
  const response = await getState({ userId: USER_A, store, retryStore });
  await assertPublic(response, publicState());
});

test("16) closed Session is not treated as current QA state", async () => {
  const { db, store } = episode({
    sessionStatus: "closed",
    attempts: [{ status: "failed" }, { status: "failed" }],
  });
  const response = await getState({
    userId: USER_A,
    store,
    retryStore: throwingRetryStore(),
  });
  await assertPublic(response, publicState());
  assert.equal(
    db.ops.some((op) => op.table === AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE),
    false,
  );
});

test("17) AFD-2C integrity/store failure maps to generic 500", async () => {
  const { store, retryStore } = episode({
    attempts: [{ status: "failed" }, { status: "failed" }],
  });
  const integrity = await getState({
    userId: USER_A,
    store,
    retryStore,
    retrySignal: async () => {
      throw new AfcDiagnosticRetryEpisodeIntegrityError(
        "duplicate_attempt_ordinal",
        "Diagnostic session membership has duplicate attempt ordinals.",
      );
    },
  });
  assert.equal(integrity.status, 500);
  assert.deepEqual(await jsonBody(integrity), { error: "Server misconfigured." });

  const storeFailed = await getState({
    userId: USER_A,
    store,
    retryStore,
    retrySignal: async () => {
      throw new AfcDiagnosticRetryEpisodeStoreError(
        "Diagnostic retry-episode store failed (57014).",
        "57014",
      );
    },
  });
  assert.equal(storeFailed.status, 500);
  const body = await jsonBody(storeFailed);
  assert.deepEqual(body, { error: "Server misconfigured." });
  assert.doesNotMatch(JSON.stringify(body), /57014|duplicate_attempt_ordinal|session/i);
});

test("18) malformed internal latest status is not feedback eligibility", async () => {
  const { store, retryStore } = episode({
    attempts: [{ status: "failed" }, { status: "READY" }],
  });
  const response = await getState({ userId: USER_A, store, retryStore });
  assert.equal(response.status, 500);
  assert.deepEqual(await jsonBody(response), { error: "Server misconfigured." });
});

test("multiple open Sessions are an integrity failure, not latest-created_at", async () => {
  const { store, retryStore } = harness({
    sessions: [
      sessionRow({ id: SESSION_A, original_sha256: SHA_A, created_at: "2026-09-18T00:00:00.000Z" }),
      sessionRow({
        id: SESSION_B,
        original_sha256: SHA_B,
        created_at: "2026-09-19T00:00:00.000Z",
      }),
    ],
  });
  await assert.rejects(
    () =>
      getAfcDiagnosticBrowserQaState(
        { userId: USER_A, roomId: ROOM_A },
        { store, retryStore, env: QA_ALL },
      ),
    (error: unknown) =>
      error instanceof AfcDiagnosticBrowserQaStateIntegrityError &&
      error.code === "multiple_open_sessions",
  );
  const response = await getState({ userId: USER_A, store, retryStore });
  assert.equal(response.status, 500);
  assert.deepEqual(await jsonBody(response), { error: "Server misconfigured." });
});

test("open Session with no attempts is idle enabled state", async () => {
  const { store, retryStore } = harness({ sessions: [sessionRow()] });
  const response = await getState({ userId: USER_A, store, retryStore });
  await assertPublic(response, publicState());
});

test("browser sessionId query is ignored; roomId comes from the query string only", async () => {
  const { store, retryStore } = episode({
    attempts: [{ status: "ready" }],
  });
  const response = await getState({
    userId: USER_A,
    url: `http://test/api/vibode/afc/qa/state?sessionId=${SESSION_B}&generationId=${GEN_2}&roomId=${ROOM_A}`,
    store,
    retryStore,
  });
  await assertPublic(
    response,
    publicState({
      canReport: true,
      reportGenerationId: GEN_1,
    }),
  );
});

test("hasFailedAttempt/hasMultipleAttempts alone do not offer feedback", () => {
  assert.deepEqual(
    projectAfcDiagnosticBrowserQaState({
      sessionId: SESSION_A,
      sessionStatus: "open",
      attemptCount: 2,
      latestAttempt: {
        generationId: GEN_2,
        attemptOrdinal: 2,
        intent: "run_again",
        machineStatus: "ready",
      },
      hasMultipleAttempts: true,
      hasFailedAttempt: true,
      hasReadyAttempt: true,
    }),
    publicState({
      canReport: true,
      offerFeedback: false,
      reportGenerationId: GEN_2,
    }),
  );
  assert.deepEqual(
    projectAfcDiagnosticBrowserQaState({
      sessionId: SESSION_A,
      sessionStatus: "open",
      attemptCount: 1,
      latestAttempt: {
        generationId: GEN_1,
        attemptOrdinal: 1,
        intent: "analyze",
        machineStatus: "failed",
      },
      hasMultipleAttempts: false,
      hasFailedAttempt: true,
      hasReadyAttempt: false,
    }),
    publicState({
      canReport: true,
      offerFeedback: false,
      reportGenerationId: GEN_1,
    }),
  );
});

test("reads are compact, Case-free, and mutation-free", async () => {
  const { db, store, retryStore } = episode({
    attempts: [{ status: "failed" }, { status: "failed" }],
  });
  await getAfcDiagnosticBrowserQaState(
    { userId: USER_A, roomId: ROOM_A },
    { store, retryStore, env: QA_ALL },
  );
  assert.equal(db.ops.every((op) => op.action === "select"), true);
  assert.equal(
    db.ops.some((op) => op.table === AFC_DIAGNOSTIC_CASE_TABLE),
    false,
  );
  const roomOp = db.ops.find((op) => op.table === AFC_ROOM_TABLE);
  const openSessionOp = db.ops.find(
    (op) =>
      op.table === AFC_DIAGNOSTIC_SESSION_TABLE &&
      op.filters.some((filter) => filter.type === "eq" && filter.column === "status"),
  );
  assert.equal(roomOp?.columns, "id, user_id");
  assert.equal(openSessionOp?.columns, "id");
  for (const forbidden of [
    "original_sha256",
    "engine_fingerprint",
    "production_authority",
    "diagnostic_payload",
    "failure_reason",
    "empty_storage_path",
    "current_afc_generation_id",
  ]) {
    assert.equal(roomOp?.columns.includes(forbidden), false, forbidden);
    assert.equal(openSessionOp?.columns.includes(forbidden), false, forbidden);
  }
});

test("frozen payload contains only the four public fields", () => {
  const frozen = freezeAfcDiagnosticBrowserQaState({
    enabled: true,
    canReport: true,
    offerFeedback: true,
    reportGenerationId: GEN_2,
  });
  assert.deepEqual(frozen, {
    enabled: true,
    canReport: true,
    offerFeedback: true,
    reportGenerationId: GEN_2,
  });
  assert.equal(Object.isFrozen(frozen), true);
});

test("AFD-3B isolation: no Case submit, analyze, persistence, UI, or READY rerun", () => {
  const implementation = source(
    "lib/afc-v2-diagnostics/browser-qa-state.server.ts",
  );
  const route = source("app/api/vibode/afc/qa/state/route.ts");
  const combined = `${implementation}\n${route}`;
  assert.match(implementation, /import "server-only"/);
  assert.match(implementation, /resolveAfcQaCapability\(/);
  assert.match(implementation, /getAfcDiagnosticRetryEpisodeSignal/);
  assert.doesNotMatch(
    combined,
    /submit-tester-case|submitAfcDiagnosticTesterCase|handleAfcQaTesterCasePost|insertTesterCase/,
  );
  assert.doesNotMatch(
    combined,
    /runProductionAfcAnalysis|production-adapter|production-persistence|production-authority-contract|createProductionAfcStoreFromEnv/,
  );
  assert.doesNotMatch(
    combined,
    /ensureAfcDiagnosticSessionMembership|closeStaleOpenSessions|insertOpenSession|insertMembership|session-attach/,
  );
  assert.doesNotMatch(
    combined,
    /handleAfcQaCapabilityGet|\/api\/vibode\/afc\/qa\/capability|fetch\(/,
  );
  assert.doesNotMatch(combined, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  assert.doesNotMatch(
    combined,
    /Re-run room read|analyze button|canRerun|reread action/,
  );
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(combined, /console\.(log|info|warn|error|debug)/);
  assert.doesNotMatch(implementation, /order\("created_at"|created_at desc/);
  assert.doesNotMatch(
    source("app/api/vibode/afc/qa/capability/route.ts"),
    /canReport|offerFeedback|reportGenerationId|browser-qa-state/,
  );
  const capability = source("lib/afc-v2-diagnostics/qa-capability.server.ts");
  assert.match(capability, /return productionAfcJson\(\s*freezeAfcQaCapability\(/);
  assert.doesNotMatch(
    source("app/editor/page.tsx"),
    /qa\/state|browser-qa-state|offerFeedback|canReport/,
  );
  assert.doesNotMatch(
    source("lib/afc-v2-runtime/use-prepare-3d-room.ts"),
    /qa\/state|browser-qa-state|offerFeedback/,
  );
});

test("AFD-2A still closes stale same-room Sessions on source sha change", () => {
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.match(lifecycle, /closeStaleOpenSessions/);
  assert.match(lifecycle, /\.eq\("status", "open"\)/);
  assert.match(lifecycle, /\.neq\("original_sha256", input\.originalSha256\)/);
  const migration = source(
    "supabase/migrations/20260921120000_vibode_afc_v2_diagnostic_foundation.sql",
  );
  assert.match(
    migration,
    /create unique index vibode_afc_diagnostic_sessions_one_open_uidx\s+on public\.vibode_afc_diagnostic_sessions \(user_id, room_id, original_sha256\)\s+where status = 'open'/,
  );
});

test("no AFD-3B migration and no Editor/admin/corpus wiring", () => {
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /afd.?3b|browser.?qa.?state/i.test(name)),
    false,
  );
  assert.equal(existsSync(path.join(ROOT, "app/admin/afc-qa")), false);
  const files = [
    ...walkTs(path.join(ROOT, "app/editor")),
    ...walkTs(path.join(ROOT, "lib/afc-v2-runtime")),
    ...walkTs(path.join(ROOT, "lib/afc-v2-production")),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /browser-qa-state|getAfcDiagnosticBrowserQaState|handleAfcQaBrowserStateGet|\/api\/vibode\/afc\/qa\/state/,
      path.relative(ROOT, file),
    );
  }
});
