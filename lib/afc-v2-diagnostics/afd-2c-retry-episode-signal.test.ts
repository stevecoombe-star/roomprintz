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
  AFC_GENERATION_TABLE,
  createSupabaseAfcDiagnosticRetryEpisodeStore,
  getAfcDiagnosticRetryEpisodeSignal,
  AfcDiagnosticRetryEpisodeInputError,
  AfcDiagnosticRetryEpisodeIntegrityError,
  AfcDiagnosticRetryEpisodeNotFoundError,
  AfcDiagnosticRetryEpisodeOwnershipError,
  AfcDiagnosticRetryEpisodeStoreError,
  type AfcDiagnosticRetryEpisodeSignal,
  type AfcDiagnosticRetryEpisodeStore,
} from "./retry-episode-signal.server";

const ROOT = process.cwd();
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_A = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SESSION_B = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const GEN_1 = "11111111-1111-4111-8111-111111111111";
const GEN_2 = "12121212-1212-4121-8121-121212121212";
const GEN_3 = "13131313-1313-4131-8131-131313131313";
const GEN_EXTRA = "14141414-1414-4141-8141-141414141414";
const SHA_A = "a".repeat(64);
const SIGNAL_KEYS = [
  "attemptCount",
  "hasFailedAttempt",
  "hasMultipleAttempts",
  "hasReadyAttempt",
  "latestAttempt",
  "sessionId",
  "sessionStatus",
] as const;

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
  sessions: SessionRow[] = [];
  memberships: MembershipRow[] = [];
  generations: GenerationRow[] = [];
  cases: Record<string, unknown>[] = [];
  ops: DbOp[] = [];
  nextError: { code?: string | number; message?: string } | null = null;

  constructor(seed?: {
    sessions?: SessionRow[];
    memberships?: MembershipRow[];
    generations?: GenerationRow[];
  }) {
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
      return filter.value.includes(value);
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
    lineage_seq: 1,
    created_at: "2026-09-19T00:00:00.000Z",
    engine_fingerprint: { gitSha: "deadbeef" },
    production_authority: { schemaVersion: "hidden" },
    diagnostic_payload: { prompt: "do not fetch" },
    failure_reason: "secret-failure",
    ...overrides,
  };
}

function harness(seed?: {
  sessions?: SessionRow[];
  memberships?: MembershipRow[];
  generations?: GenerationRow[];
}) {
  const db = new FakeDiagnosticDb(seed);
  const store = createSupabaseAfcDiagnosticRetryEpisodeStore(db.client());
  return { db, store };
}

function throwingStore(): AfcDiagnosticRetryEpisodeStore {
  const fail = async () => {
    throw new Error("diagnostic retry-episode store should not be used");
  };
  return {
    findSessionById: fail,
    listMembershipsBySessionId: fail,
    listGenerationMachineStatuses: fail,
  };
}

function snapshot(seed: {
  status?: string;
  userId?: string;
  memberships: Array<Partial<MembershipRow> & { status?: string }>;
  extraGenerations?: GenerationRow[];
  extraSessions?: SessionRow[];
}) {
  const memberships = seed.memberships.map((row, index) =>
    membershipRow({
      generation_id: [GEN_1, GEN_2, GEN_3][index] ?? crypto.randomUUID(),
      attempt_ordinal: index + 1,
      ...row,
    }),
  );
  const generations = [
    ...memberships.map((row, index) =>
      generationRow({
        id: row.generation_id,
        status: seed.memberships[index]?.status ?? "ready",
        lineage_seq: index + 1,
      }),
    ),
    ...(seed.extraGenerations ?? []),
  ];
  return harness({
    sessions: [
      sessionRow({
        status: seed.status ?? "open",
        user_id: seed.userId ?? USER_A,
      }),
      ...(seed.extraSessions ?? []),
    ],
    memberships,
    generations,
  });
}

async function signal(
  store: AfcDiagnosticRetryEpisodeStore,
  input: { sessionId?: unknown; userId?: unknown } = {},
) {
  return getAfcDiagnosticRetryEpisodeSignal(
    {
      sessionId: input.sessionId ?? SESSION_A,
      userId: input.userId ?? USER_A,
    },
    { store },
  );
}

function assertContract(value: AfcDiagnosticRetryEpisodeSignal) {
  assert.deepEqual(Object.keys(value).sort(), [...SIGNAL_KEYS].sort());
  for (const forbidden of [
    "needsFeedback",
    "shouldPrompt",
    "unsuccessful",
    "repeatedUnsuccessful",
    "badRead",
    "userDissatisfied",
    "needsRerun",
    "severity",
    "allAttemptsFailed",
  ]) {
    assert.equal(forbidden in value, false, forbidden);
  }
}

test("1) Session with zero memberships", async () => {
  const { db, store } = harness({
    sessions: [sessionRow()],
  });
  const result = await signal(store);
  assertContract(result);
  assert.deepEqual(result, {
    sessionId: SESSION_A,
    sessionStatus: "open",
    attemptCount: 0,
    latestAttempt: null,
    hasMultipleAttempts: false,
    hasFailedAttempt: false,
    hasReadyAttempt: false,
  });
  assert.equal(
    db.ops.some((op) => op.table === AFC_GENERATION_TABLE),
    false,
  );
});

test("2) one membership", async () => {
  const { store } = snapshot({
    memberships: [{ intent: "analyze", status: "ready" }],
  });
  const result = await signal(store);
  assert.equal(result.attemptCount, 1);
  assert.equal(result.latestAttempt?.attemptOrdinal, 1);
  assert.equal(result.latestAttempt?.generationId, GEN_1);
  assert.equal(result.hasMultipleAttempts, false);
});

test("3) two memberships", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "failed" },
      { intent: "run_again", status: "ready" },
    ],
  });
  const result = await signal(store);
  assert.equal(result.attemptCount, 2);
  assert.equal(result.latestAttempt?.attemptOrdinal, 2);
  assert.equal(result.hasMultipleAttempts, true);
});

test("4) three memberships use latest ordinal 3", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "failed" },
      { intent: "run_again", status: "failed" },
      { intent: "reread_perspective", status: "ready" },
    ],
  });
  const result = await signal(store);
  assert.equal(result.attemptCount, 3);
  assert.equal(result.latestAttempt?.attemptOrdinal, 3);
  assert.equal(result.latestAttempt?.generationId, GEN_3);
  assert.equal(result.hasMultipleAttempts, true);
});

test("5) latest running", async () => {
  const { store } = snapshot({
    memberships: [{ intent: "analyze", status: "running" }],
  });
  const result = await signal(store);
  assert.equal(result.latestAttempt?.machineStatus, "running");
  assert.equal(result.hasFailedAttempt, false);
  assert.equal(result.hasReadyAttempt, false);
});

test("6) latest ready", async () => {
  const { store } = snapshot({
    memberships: [{ intent: "analyze", status: "ready" }],
  });
  const result = await signal(store);
  assert.equal(result.latestAttempt?.machineStatus, "ready");
});

test("7) latest failed", async () => {
  const { store } = snapshot({
    memberships: [{ intent: "analyze", status: "failed" }],
  });
  const result = await signal(store);
  assert.equal(result.latestAttempt?.machineStatus, "failed");
});

test("8) latest intent analyze", async () => {
  const { store } = snapshot({
    memberships: [{ intent: "analyze", status: "ready" }],
  });
  assert.equal((await signal(store)).latestAttempt?.intent, "analyze");
});

test("9) latest intent run_again", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "failed" },
      { intent: "run_again", status: "running" },
    ],
  });
  assert.equal((await signal(store)).latestAttempt?.intent, "run_again");
});

test("10) latest intent reread_perspective", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "ready" },
      { intent: "reread_perspective", status: "ready" },
    ],
  });
  assert.equal((await signal(store)).latestAttempt?.intent, "reread_perspective");
});

test("11) failed then ready", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "failed" },
      { intent: "run_again", status: "ready" },
    ],
  });
  const result = await signal(store);
  assert.equal(result.latestAttempt?.machineStatus, "ready");
  assert.equal(result.hasFailedAttempt, true);
  assert.equal(result.hasReadyAttempt, true);
  assert.equal("unsuccessful" in result, false);
});

test("12) ready then failed", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "ready" },
      { intent: "run_again", status: "failed" },
    ],
  });
  const result = await signal(store);
  assert.equal(result.latestAttempt?.machineStatus, "failed");
  assert.equal(result.hasFailedAttempt, true);
  assert.equal(result.hasReadyAttempt, true);
});

test("13) running then ready", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "running" },
      { intent: "run_again", status: "ready" },
    ],
  });
  const result = await signal(store);
  assert.equal(result.latestAttempt?.machineStatus, "ready");
  assert.equal(result.hasFailedAttempt, false);
  assert.equal(result.hasReadyAttempt, true);
});

test("14) multiple READY attempts remain descriptive facts", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "ready" },
      { intent: "run_again", status: "ready" },
      { intent: "reread_perspective", status: "ready" },
    ],
  });
  const result = await signal(store);
  assert.equal(result.attemptCount, 3);
  assert.equal(result.latestAttempt?.machineStatus, "ready");
  assert.equal(result.hasReadyAttempt, true);
  assert.equal(result.hasFailedAttempt, false);
  assert.equal("repeatedUnsuccessful" in result, false);
});

test("15) closed Session still returns historical signal", async () => {
  const { store } = snapshot({
    status: "closed",
    memberships: [
      { intent: "analyze", status: "failed" },
      { intent: "run_again", status: "ready" },
    ],
  });
  const result = await signal(store);
  assert.equal(result.sessionStatus, "closed");
  assert.equal(result.attemptCount, 2);
  assert.equal(result.latestAttempt?.attemptOrdinal, 2);
  assert.equal(result.hasMultipleAttempts, true);
  assert.equal(result.hasFailedAttempt, true);
  assert.equal(result.hasReadyAttempt, true);
});

test("16) latest is chosen by attempt_ordinal, not generation created_at", async () => {
  const { store } = harness({
    sessions: [sessionRow()],
    memberships: [
      membershipRow({
        generation_id: GEN_1,
        attempt_ordinal: 1,
        intent: "analyze",
      }),
      membershipRow({
        generation_id: GEN_2,
        attempt_ordinal: 2,
        intent: "run_again",
      }),
    ],
    generations: [
      generationRow({
        id: GEN_1,
        status: "failed",
        created_at: "2026-09-19T12:00:00.000Z",
        lineage_seq: 9,
      }),
      generationRow({
        id: GEN_2,
        status: "ready",
        created_at: "2026-09-18T00:00:00.000Z",
        lineage_seq: 1,
      }),
    ],
  });
  const result = await signal(store);
  assert.equal(result.latestAttempt?.generationId, GEN_2);
  assert.equal(result.latestAttempt?.attemptOrdinal, 2);
  assert.equal(result.latestAttempt?.machineStatus, "ready");
});

test("17) latest is chosen by ordinal, not lineage_seq", async () => {
  const { db, store } = harness({
    sessions: [sessionRow()],
    memberships: [
      membershipRow({
        generation_id: GEN_1,
        attempt_ordinal: 2,
        intent: "run_again",
      }),
      membershipRow({
        generation_id: GEN_2,
        attempt_ordinal: 1,
        intent: "analyze",
      }),
    ],
    generations: [
      generationRow({
        id: GEN_1,
        status: "running",
        lineage_seq: 1,
        created_at: "2026-09-18T00:00:00.000Z",
      }),
      generationRow({
        id: GEN_2,
        status: "ready",
        lineage_seq: 80,
        created_at: "2026-09-20T00:00:00.000Z",
      }),
      generationRow({
        id: GEN_EXTRA,
        status: "ready",
        lineage_seq: 100,
        created_at: "2026-09-21T00:00:00.000Z",
      }),
    ],
  });
  const result = await signal(store);
  assert.equal(result.latestAttempt?.generationId, GEN_1);
  assert.equal(result.latestAttempt?.attemptOrdinal, 2);
  assert.equal(result.latestAttempt?.machineStatus, "running");
  const generationOp = db.ops.find((op) => op.table === AFC_GENERATION_TABLE);
  assert.equal(generationOp?.columns, "id, status");
  assert.equal(generationOp?.columns.includes("lineage_seq"), false);
  assert.equal(generationOp?.columns.includes("created_at"), false);
});

test("18) membership referencing a missing generation is an integrity error", async () => {
  const { store } = harness({
    sessions: [sessionRow()],
    memberships: [membershipRow()],
    generations: [],
  });
  await assert.rejects(
    () => signal(store),
    (error: unknown) =>
      error instanceof AfcDiagnosticRetryEpisodeIntegrityError &&
      error.code === "missing_generation",
  );
});

test("19) duplicate ordinal in fake store surfaces an integrity error", async () => {
  const { store } = harness({
    sessions: [sessionRow()],
    memberships: [
      membershipRow({ generation_id: GEN_1, attempt_ordinal: 1 }),
      membershipRow({ generation_id: GEN_2, attempt_ordinal: 1, intent: "run_again" }),
    ],
    generations: [
      generationRow({ id: GEN_1, status: "failed" }),
      generationRow({ id: GEN_2, status: "ready" }),
    ],
  });
  await assert.rejects(
    () => signal(store),
    (error: unknown) =>
      error instanceof AfcDiagnosticRetryEpisodeIntegrityError &&
      error.code === "duplicate_attempt_ordinal",
  );
});

test("20) invalid Session ID is rejected", async () => {
  await assert.rejects(
    () => signal(throwingStore(), { sessionId: "not-a-session" }),
    (error: unknown) =>
      error instanceof AfcDiagnosticRetryEpisodeInputError &&
      error.code === "invalid_session_id",
  );
});

test("21) Session not found", async () => {
  const { store } = harness({ sessions: [sessionRow({ id: SESSION_B })] });
  await assert.rejects(
    () => signal(store),
    (error: unknown) =>
      error instanceof AfcDiagnosticRetryEpisodeNotFoundError &&
      error.code === "session_not_found",
  );
});

test("22) ownership mismatch", async () => {
  const { db, store } = snapshot({
    memberships: [{ intent: "analyze", status: "ready" }],
  });
  await assert.rejects(
    () => signal(store, { userId: USER_B }),
    (error: unknown) =>
      error instanceof AfcDiagnosticRetryEpisodeOwnershipError &&
      error.code === "ownership_mismatch",
  );
  assert.equal(
    db.ops.some((op) => op.table === AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE),
    false,
  );
});

test("23-30) isolation: no writes, Cases, activation, public route, migration, or Editor", async () => {
  const { db, store } = snapshot({
    memberships: [
      { intent: "analyze", status: "failed" },
      { intent: "run_again", status: "ready" },
    ],
  });
  await signal(store);
  assert.equal(
    db.ops.every((op) => op.action === "select"),
    true,
  );
  assert.equal(
    db.ops.some((op) => op.table === AFC_DIAGNOSTIC_CASE_TABLE),
    false,
  );
  assert.equal(db.cases.length, 0);
  const implementation = source(
    "lib/afc-v2-diagnostics/retry-episode-signal.server.ts",
  );
  assert.match(implementation, /import "server-only"/);
  assert.match(implementation, /getServiceRoleSupabaseClient/);
  assert.doesNotMatch(
    implementation,
    /\.insert\(|\.update\(|\.delete\(|\.rpc\(|activate_vibode_afc_generation|current_afc_generation_id|production_authority|engine_fingerprint|diagnostic_payload|parent_generation_id|ensureAfcDiagnosticSessionMembership|closeStaleOpenSessions|insertMembership|insertOpenSession/,
  );
  assert.doesNotMatch(
    implementation,
    /vibode_afc_diagnostic_cases|repeated_unsuccessful|issue_codes|needsFeedback|shouldPrompt|unsuccessful|badRead|userDissatisfied|needsRerun|severity|allAttemptsFailed/,
  );
  assert.doesNotMatch(
    implementation,
    /NextResponse|handleAfc|export async function GET|export async function POST/,
  );
  assert.doesNotMatch(
    implementation,
    /createBrowserClient|getCookieSupabaseClient|SUPABASE_ANON_KEY|authenticated|create policy|grant /i,
  );
  assert.doesNotMatch(implementation, /console\.(log|info|warn|error|debug)/);
  const apiFiles = walkTs(path.join(ROOT, "app/api"));
  for (const file of apiFiles) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /retry-episode-signal|getAfcDiagnosticRetryEpisodeSignal/,
      path.relative(ROOT, file),
    );
  }
  assert.doesNotMatch(
    source("app/editor/page.tsx"),
    /retry-episode-signal|getAfcDiagnosticRetryEpisodeSignal/,
  );
  assert.doesNotMatch(
    source("lib/afc-v2-runtime/use-prepare-3d-room.ts"),
    /retry-episode-signal|getAfcDiagnosticRetryEpisodeSignal/,
  );
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /afd.?2c|retry.?episode/i.test(name)),
    false,
  );
});

test("31) failed history sets hasFailedAttempt", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "failed" },
      { intent: "run_again", status: "running" },
    ],
  });
  const result = await signal(store);
  assert.equal(result.hasFailedAttempt, true);
  assert.equal(result.hasReadyAttempt, false);
});

test("32) ready history sets hasReadyAttempt", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "ready" },
      { intent: "run_again", status: "running" },
    ],
  });
  const result = await signal(store);
  assert.equal(result.hasReadyAttempt, true);
  assert.equal(result.hasFailedAttempt, false);
});

test("33) running only leaves both aggregates false", async () => {
  const { store } = snapshot({
    memberships: [
      { intent: "analyze", status: "running" },
      { intent: "run_again", status: "running" },
    ],
  });
  const result = await signal(store);
  assert.equal(result.hasFailedAttempt, false);
  assert.equal(result.hasReadyAttempt, false);
  assert.equal(result.latestAttempt?.machineStatus, "running");
});

test("selects only compact Session, membership, and generation fields", async () => {
  const { db, store } = snapshot({
    memberships: [{ intent: "analyze", status: "ready" }],
  });
  await signal(store);
  const sessionOp = db.ops.find((op) => op.table === AFC_DIAGNOSTIC_SESSION_TABLE);
  const membershipOp = db.ops.find(
    (op) => op.table === AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  );
  const generationOp = db.ops.find((op) => op.table === AFC_GENERATION_TABLE);
  assert.equal(sessionOp?.columns, "id, user_id, status");
  assert.equal(
    membershipOp?.columns,
    "session_id, generation_id, attempt_ordinal, intent",
  );
  assert.equal(generationOp?.columns, "id, status");
  for (const forbidden of [
    "original_sha256",
    "engine_fingerprint",
    "production_authority",
    "diagnostic_payload",
    "failure_reason",
    "lineage_seq",
    "empty_storage_path",
    "tiled_storage_path",
  ]) {
    assert.equal(sessionOp?.columns.includes(forbidden), false, forbidden);
    assert.equal(membershipOp?.columns.includes(forbidden), false, forbidden);
    assert.equal(generationOp?.columns.includes(forbidden), false, forbidden);
  }
});

test("store errors surface without fabricating status", async () => {
  const { db, store } = harness({ sessions: [sessionRow()] });
  db.failNext({ code: "57014", message: "canceling statement due to statement timeout" });
  await assert.rejects(
    () => signal(store),
    (error: unknown) =>
      error instanceof AfcDiagnosticRetryEpisodeStoreError &&
      error.causeCode === "57014",
  );
});

test("unknown generation status is an integrity error, not a fabricated failed label", async () => {
  const { store } = harness({
    sessions: [sessionRow()],
    memberships: [membershipRow()],
    generations: [generationRow({ status: "READY" })],
  });
  await assert.rejects(
    () => signal(store),
    (error: unknown) =>
      error instanceof AfcDiagnosticRetryEpisodeIntegrityError &&
      error.code === "invalid_machine_status",
  );
});

test("invalid user UUID is rejected before store access", async () => {
  await assert.rejects(
    () => signal(throwingStore(), { userId: "bad-user" }),
    (error: unknown) =>
      error instanceof AfcDiagnosticRetryEpisodeInputError &&
      error.code === "invalid_user_id",
  );
});

test("AFD-2C does not import production authority, adapter, persistence, or lifecycle writes", () => {
  const implementation = source(
    "lib/afc-v2-diagnostics/retry-episode-signal.server.ts",
  );
  assert.doesNotMatch(
    implementation,
    /production-adapter|production-persistence|production-authority-contract|runProductionAfcAnalysis|session-lifecycle|session-attach|qa-capability/,
  );
  for (const relative of [
    "app/api/vibode/afc/analyze/route.ts",
    "app/api/vibode/afc/restore/route.ts",
    "app/api/vibode/afc/runtime/route.ts",
    "lib/afc-v2-production/production-adapter.server.ts",
    "lib/afc-v2-production/production-persistence.server.ts",
  ]) {
    assert.doesNotMatch(
      source(relative),
      /retry-episode-signal|getAfcDiagnosticRetryEpisodeSignal/,
    );
  }
});
