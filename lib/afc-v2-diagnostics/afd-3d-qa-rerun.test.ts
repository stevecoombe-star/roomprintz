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
  type AfcDiagnosticRetryEpisodeStore,
} from "./retry-episode-signal.server";
import {
  AFC_QA_READY_RERUN_PATH,
  AFC_QA_TESTER_COPY,
  afcQaReadyRerunErrorMessage,
  buildAfcQaReadyRerunBody,
  canShowAfcQaReadyRerun,
  collectAfcQaReadyRerunBodyPrivacyViolations,
  createInitialAfcQaTesterReportModel,
  deriveAfcQaTesterReportView,
  reduceAfcQaTesterReport,
  type AfcQaBrowserState,
  type AfcQaTesterReportEvent,
  type AfcQaTesterReportModel,
} from "./tester-report.client";
import {
  AFC_QA_READY_RERUN_INTENT,
  AFC_ROOM_TABLE,
  authorizeAfcQaReadyRerun,
  createSupabaseAfcQaReadyRerunStore,
  handleAfcQaReadyRerunPost,
  AfcQaReadyRerunGenerationError,
  AfcQaReadyRerunInputError,
  AfcQaReadyRerunMembershipError,
  AfcQaReadyRerunQaDisabledError,
  AfcQaReadyRerunRoomError,
  AfcQaReadyRerunSessionError,
  type AfcQaReadyRerunAnalysisResult,
  type AfcQaReadyRerunStartInput,
  type AfcQaReadyRerunStore,
} from "./qa-rerun.server";

const ROOT = process.cwd();
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GEN_1 = "11111111-1111-4111-8111-111111111111";
const GEN_2 = "12121212-1212-4121-8121-121212121212";
const GEN_3 = "13131313-1313-4131-8131-131313131313";
const SESSION_A = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

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
  user_id: string;
  room_id: string;
  status: string;
  original_sha256: string | null;
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
  if (!existsSync(dir)) return [];
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
    user_id: USER_A,
    room_id: ROOM_A,
    status: "ready",
    original_sha256: SHA_A,
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
    sessions: seed?.sessions ?? [sessionRow()],
    memberships: seed?.memberships ?? [membershipRow()],
    generations: seed?.generations ?? [generationRow()],
  });
  const client = db.client();
  return {
    db,
    store: createSupabaseAfcQaReadyRerunStore(client),
    retryStore: createSupabaseAfcDiagnosticRetryEpisodeStore(client),
  };
}

function readyWorld(overrides: {
  generationStatus?: string;
  extraAttempts?: Array<{
    generationId: string;
    status: string;
    intent?: string;
  }>;
} = {}) {
  const extra = overrides.extraAttempts ?? [];
  const memberships = [
    membershipRow(),
    ...extra.map((attempt, index) =>
      membershipRow({
        generation_id: attempt.generationId,
        attempt_ordinal: index + 2,
        intent: attempt.intent ?? "run_again",
      }),
    ),
  ];
  const generations = [
    generationRow({ status: overrides.generationStatus ?? "ready" }),
    ...extra.map((attempt) =>
      generationRow({
        id: attempt.generationId,
        status: attempt.status,
      }),
    ),
  ];
  return harness({ memberships, generations });
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

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const READY_RESULT: AfcQaReadyRerunAnalysisResult = {
  status: "ready",
  generationId: GEN_3,
  currentGenerationId: GEN_3,
  authority: { schemaVersion: "afc-v2-production-room-authority/v1" },
  failureReason: null,
  frame: { width: 8, height: 8 },
};

function recordingStart() {
  const calls: AfcQaReadyRerunStartInput[] = [];
  return {
    calls,
    start: async (input: AfcQaReadyRerunStartInput) => {
      calls.push(input);
      return READY_RESULT;
    },
  };
}

async function postRerun(args: {
  userId?: string | null;
  body?: unknown;
  env?: AfcQaCapabilityEnv;
  store?: AfcQaReadyRerunStore;
  retryStore?: AfcDiagnosticRetryEpisodeStore;
  start?: (input: AfcQaReadyRerunStartInput) => Promise<AfcQaReadyRerunAnalysisResult>;
}) {
  const recorder = recordingStart();
  return {
    response: await handleAfcQaReadyRerunPost({
      request: new Request("http://test/api/vibode/afc/qa/rerun", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body:
          args.body === undefined
            ? JSON.stringify({ roomId: ROOM_A, generationId: GEN_1 })
            : typeof args.body === "string"
              ? args.body
              : JSON.stringify(args.body),
      }),
      authorize: async () =>
        args.userId ? authorized(args.userId) : unauthorized(),
      env: args.env ?? QA_ALL,
      store: args.store,
      retryStore: args.retryStore,
      startProductionAnalysis: args.start ?? recorder.start,
    }),
    calls: recorder.calls,
  };
}

function projection(overrides: Partial<AfcQaBrowserState> = {}): AfcQaBrowserState {
  return {
    enabled: true,
    canReport: true,
    offerFeedback: false,
    reportGenerationId: GEN_1,
    ...overrides,
  };
}

function apply(
  model: AfcQaTesterReportModel,
  events: readonly AfcQaTesterReportEvent[],
  context?: { preparePhase?: string | null; prepareGenerationId?: string | null },
) {
  let current = model;
  let lastEffect = reduceAfcQaTesterReport(current, { type: "clear_success" }).effect;
  for (const event of events) {
    const result = reduceAfcQaTesterReport(current, event);
    current = result.state;
    lastEffect = result.effect;
  }
  return {
    state: current,
    effect: lastEffect,
    view: deriveAfcQaTesterReportView(current, context),
  };
}

function reportableReadyModel() {
  const initial = createInitialAfcQaTesterReportModel(ROOM_A);
  return reduceAfcQaTesterReport(initial, {
    type: "projection_ready",
    projection: projection(),
  }).state;
}

async function authorizeReady(
  store: AfcQaReadyRerunStore,
  retryStore: AfcDiagnosticRetryEpisodeStore,
  input: Partial<{ userId: string; roomId: string; generationId: string }> = {},
  env: AfcQaCapabilityEnv = QA_ALL,
) {
  return authorizeAfcQaReadyRerun(
    {
      userId: input.userId ?? USER_A,
      roomId: input.roomId ?? ROOM_A,
      generationId: input.generationId ?? GEN_1,
    },
    { store, retryStore, env },
  );
}

test("1) QA off hides rerun and server rejects without analyze", async () => {
  const { view } = apply(createInitialAfcQaTesterReportModel(ROOM_A), [
    {
      type: "projection_ready",
      projection: projection({
        enabled: false,
        canReport: false,
        reportGenerationId: null,
      }),
    },
  ], { preparePhase: "ready", prepareGenerationId: GEN_1 });
  assert.equal(view.showRerun, false);

  const { db, store, retryStore } = harness();
  await assert.rejects(
    () => authorizeReady(store, retryStore, {}, QA_OFF),
    (error: unknown) => error instanceof AfcQaReadyRerunQaDisabledError,
  );
  assert.equal(db.ops.length, 0);
  const posted = await postRerun({
    userId: USER_A,
    env: QA_OFF,
    store,
    retryStore,
  });
  assert.equal(posted.response.status, 404);
  assert.deepEqual(await jsonBody(posted.response), { error: "Not available." });
  assert.equal(posted.calls.length, 0);
});

test("2) QA on without a reportable generation hides the button", () => {
  assert.equal(
    canShowAfcQaReadyRerun({
      projection: projection({ canReport: false, reportGenerationId: null }),
      preparePhase: "ready",
      prepareGenerationId: GEN_1,
    }),
    false,
  );
});

test("3-4) RUNNING and FAILED editor states hide READY rerun", () => {
  const reportable = projection({ offerFeedback: false });
  assert.equal(
    canShowAfcQaReadyRerun({
      projection: reportable,
      preparePhase: "running",
      prepareGenerationId: GEN_1,
    }),
    false,
  );
  assert.equal(
    canShowAfcQaReadyRerun({
      projection: reportable,
      preparePhase: "error",
      prepareGenerationId: GEN_1,
    }),
    false,
  );
  assert.equal(
    canShowAfcQaReadyRerun({
      projection: projection({ offerFeedback: true }),
      preparePhase: "ready",
      prepareGenerationId: GEN_2,
    }),
    false,
  );
});

test("5) latest READY with matching prepare identity shows the button", () => {
  const { view } = apply(reportableReadyModel(), [], {
    preparePhase: "ready",
    prepareGenerationId: GEN_1,
  });
  assert.equal(view.showRerun, true);
  assert.equal(view.showManualReport, true);
  assert.equal(view.rerunDisabled, false);
});

test("UI does not infer READY from offerFeedback=false", () => {
  assert.equal(
    canShowAfcQaReadyRerun({
      projection: projection({ offerFeedback: false }),
      preparePhase: "idle",
      prepareGenerationId: GEN_1,
    }),
    false,
  );
  assert.equal(
    canShowAfcQaReadyRerun({
      projection: projection({ offerFeedback: false, reportGenerationId: GEN_2 }),
      preparePhase: "ready",
      prepareGenerationId: GEN_1,
    }),
    false,
  );
});

test("6) unauthenticated POST is 401 and does not start analyze", async () => {
  const { store, retryStore } = harness();
  const posted = await postRerun({ userId: null, store, retryStore });
  assert.equal(posted.response.status, 401);
  assert.deepEqual(await jsonBody(posted.response), { error: "Unauthorized." });
  assert.equal(posted.calls.length, 0);
});

test("7-8) invalid roomId or generationId is 400", async () => {
  const { store, retryStore } = harness();
  const badRoom = await postRerun({
    userId: USER_A,
    body: { roomId: "not-a-uuid", generationId: GEN_1 },
    store,
    retryStore,
  });
  assert.equal(badRoom.response.status, 400);
  assert.deepEqual(await jsonBody(badRoom.response), { error: "Invalid request." });
  assert.equal(badRoom.calls.length, 0);

  const badGen = await postRerun({
    userId: USER_A,
    body: { roomId: ROOM_A, generationId: "nope" },
    store,
    retryStore,
  });
  assert.equal(badGen.response.status, 400);
  assert.equal(badGen.calls.length, 0);
});

test("9-10) missing and unowned rooms are privacy-safe 404", async () => {
  const missing = harness({ rooms: [] });
  await assert.rejects(
    () => authorizeReady(missing.store, missing.retryStore),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunRoomError && error.code === "room_not_found",
  );
  const postedMissing = await postRerun({
    userId: USER_A,
    store: missing.store,
    retryStore: missing.retryStore,
  });
  assert.equal(postedMissing.response.status, 404);
  assert.deepEqual(await jsonBody(postedMissing.response), {
    error: "Room not found.",
  });
  assert.equal(postedMissing.calls.length, 0);

  const unowned = harness({ rooms: [roomRow({ user_id: USER_B })] });
  await assert.rejects(
    () => authorizeReady(unowned.store, unowned.retryStore),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunRoomError &&
      error.code === "room_ownership_mismatch",
  );
  const postedUnowned = await postRerun({
    userId: USER_A,
    store: unowned.store,
    retryStore: unowned.retryStore,
  });
  assert.equal(postedUnowned.response.status, 404);
  assert.deepEqual(await jsonBody(postedUnowned.response), {
    error: "Room not found.",
  });
});

test("11-13) missing, unowned, or wrong-room generations reject", async () => {
  const missing = harness({ generations: [] });
  await assert.rejects(
    () => authorizeReady(missing.store, missing.retryStore),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunGenerationError &&
      error.code === "generation_unavailable",
  );

  const wrongUser = harness({
    generations: [generationRow({ user_id: USER_B })],
  });
  await assert.rejects(
    () => authorizeReady(wrongUser.store, wrongUser.retryStore),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunGenerationError &&
      error.code === "generation_ownership_mismatch",
  );

  const wrongRoom = harness({
    generations: [generationRow({ room_id: ROOM_B })],
  });
  await assert.rejects(
    () => authorizeReady(wrongRoom.store, wrongRoom.retryStore),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunGenerationError &&
      error.code === "generation_room_mismatch",
  );
});

test("14-15) FAILED and RUNNING generations are ineligible", async () => {
  const failed = readyWorld({ generationStatus: "failed" });
  await assert.rejects(
    () => authorizeReady(failed.store, failed.retryStore),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunGenerationError &&
      error.code === "generation_ineligible",
  );
  const running = readyWorld({ generationStatus: "running" });
  await assert.rejects(
    () => authorizeReady(running.store, running.retryStore),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunGenerationError &&
      error.code === "generation_ineligible",
  );
  const posted = await postRerun({
    userId: USER_A,
    store: failed.store,
    retryStore: failed.retryStore,
  });
  assert.equal(posted.response.status, 404);
  assert.deepEqual(await jsonBody(posted.response), { error: "Not available." });
  assert.equal(posted.calls.length, 0);
});

test("16) READY current generation is eligible and starts analyze with run_again", async () => {
  const { store, retryStore } = harness();
  const authorizedRerun = await authorizeReady(store, retryStore);
  assert.deepEqual(authorizedRerun, {
    userId: USER_A,
    roomId: ROOM_A,
    generationId: GEN_1,
    intent: "run_again",
  });
  assert.equal(authorizedRerun.intent, AFC_QA_READY_RERUN_INTENT);

  const posted = await postRerun({
    userId: USER_A,
    body: {
      roomId: ROOM_A,
      generationId: GEN_1,
      intent: "analyze",
      sessionId: SESSION_A,
    },
    store,
    retryStore,
  });
  assert.equal(posted.response.status, 200);
  assert.deepEqual(posted.calls, [
    { userId: USER_A, roomId: ROOM_A, intent: "run_again" },
  ]);
  const body = await jsonBody(posted.response);
  assert.equal(body.status, "ready");
  assert.equal(body.generationId, GEN_3);
  assert.equal("sessionId" in body, false);
  assert.equal("intent" in body, false);
  assert.equal(collectProductionPayloadPrivacyViolations(body).length, 0);
});

test("17) stale non-latest Session attempt is rejected", async () => {
  const world = readyWorld({
    extraAttempts: [{ generationId: GEN_2, status: "ready" }],
  });
  await assert.rejects(
    () => authorizeReady(world.store, world.retryStore, { generationId: GEN_1 }),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunGenerationError &&
      error.code === "generation_not_current",
  );
});

test("18) unmembered generation is rejected", async () => {
  const world = harness({ memberships: [] });
  await assert.rejects(
    () => authorizeReady(world.store, world.retryStore),
    (error: unknown) => error instanceof AfcQaReadyRerunMembershipError,
  );
});

test("19) closed Session is rejected", async () => {
  const world = harness({
    sessions: [sessionRow({ status: "closed" })],
  });
  await assert.rejects(
    () => authorizeReady(world.store, world.retryStore),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunSessionError && error.code === "session_closed",
  );
});

test("20) source SHA mismatch is rejected", async () => {
  const world = harness({
    generations: [generationRow({ original_sha256: SHA_B })],
  });
  await assert.rejects(
    () => authorizeReady(world.store, world.retryStore),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunSessionError &&
      error.code === "session_sha_mismatch",
  );
});

test("21) browser cannot choose intent; server fixes run_again", () => {
  const body = buildAfcQaReadyRerunBody({
    roomId: ROOM_A,
    generationId: GEN_1,
  });
  assert.deepEqual(Object.keys(body), ["roomId", "generationId"]);
  assert.equal("intent" in body, false);
  assert.equal(AFC_QA_READY_RERUN_INTENT, "run_again");
  assert.deepEqual(collectAfcQaReadyRerunBodyPrivacyViolations({
    ...body,
    intent: "analyze",
    sessionId: SESSION_A,
  }), ["intent", "sessionId"]);
});

test("22-27) production analyze reuse is a wrapper, not a second insert path", () => {
  const route = source("app/api/vibode/afc/qa/rerun/route.ts");
  const implementation = source("lib/afc-v2-diagnostics/qa-rerun.server.ts");
  const analyze = source("app/api/vibode/afc/analyze/route.ts");
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  assert.match(route, /runProductionAfcAnalysis/);
  assert.match(route, /loadOwnedOriginalForProductionAnalysis/);
  assert.match(route, /onGenerationCreated: attachAfcDiagnosticSessionBestEffort/);
  assert.match(route, /intent: "run_again"/);
  assert.doesNotMatch(implementation, /runProductionAfcAnalysis|createGeneration\(/);
  assert.doesNotMatch(implementation, /parent_generation_id|lineage_seq/);
  assert.match(
    adapter,
    /parentGenerationId: parentId/,
  );
  assert.match(adapter, /const parentId = room.currentAfcGenerationId/);
  assert.match(analyze, /onGenerationCreated: attachAfcDiagnosticSessionBestEffort/);
  assert.doesNotMatch(analyze, /qa\/rerun|authorizeAfcQaReadyRerun/);
});

test("28-32) AFD-3D does not write Sessions, membership, or Cases", async () => {
  const { db, store, retryStore } = harness();
  const posted = await postRerun({ userId: USER_A, store, retryStore });
  assert.equal(posted.response.status, 200);
  assert.equal(
    db.ops.some((op) => op.action === "insert" || op.action === "update" || op.action === "delete"),
    false,
  );
  assert.equal(db.cases.length, 0);
  const implementation = source("lib/afc-v2-diagnostics/qa-rerun.server.ts");
  assert.doesNotMatch(
    implementation,
    /insertTesterCase|insertOpenSession|insertMembership|closeStaleOpenSessions|ensureAfcDiagnosticSessionMembership/,
  );
  assert.doesNotMatch(implementation, /\.update\(|\.insert\(|\.delete\(/);
});

test("33-35) first rerun request posts; a second click is ignored while pending", () => {
  const model = reportableReadyModel();
  const first = reduceAfcQaTesterReport(model, {
    type: "rerun_requested",
    preparePhase: "ready",
    prepareGenerationId: GEN_1,
  });
  assert.equal(first.effect.type, "post_rerun");
  if (first.effect.type === "post_rerun") {
    assert.equal(first.effect.url, AFC_QA_READY_RERUN_PATH);
    assert.deepEqual(first.effect.body, {
      roomId: ROOM_A,
      generationId: GEN_1,
    });
  }
  assert.equal(first.state.rerunPending, true);
  const second = reduceAfcQaTesterReport(first.state, {
    type: "rerun_requested",
    preparePhase: "ready",
    prepareGenerationId: GEN_1,
  });
  assert.equal(second.effect.type, "none");
  assert.equal(second.state.rerunPending, true);
  const view = deriveAfcQaTesterReportView(first.state, {
    preparePhase: "ready",
    prepareGenerationId: GEN_1,
  });
  assert.equal(view.rerunDisabled, true);
});

test("36) overlapping production starts remain the canonical concurrency model", () => {
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  const analyzeFn = adapter.slice(
    adapter.indexOf("export async function runProductionAfcAnalysis"),
  );
  assert.doesNotMatch(analyzeFn, /advisory lock|for update|inFlightGeneration|dedupe/);
  assert.match(analyzeFn, /createGeneration\(/);
  const implementation = source("lib/afc-v2-diagnostics/qa-rerun.server.ts");
  assert.doesNotMatch(
    implementation,
    /advisory lock|for update|dedupe|inFlightGeneration/,
  );
});

test("37-38) stale bound generation does not post", () => {
  const model = reportableReadyModel();
  const stale = reduceAfcQaTesterReport(model, {
    type: "rerun_requested",
    preparePhase: "ready",
    prepareGenerationId: GEN_2,
  });
  assert.equal(stale.effect.type, "none");
  assert.equal(stale.state.rerunPending, false);
});

test("39-42) success refreshes QA; report UI remains available", () => {
  const pending = reduceAfcQaTesterReport(reportableReadyModel(), {
    type: "rerun_requested",
    preparePhase: "ready",
    prepareGenerationId: GEN_1,
  }).state;
  const succeeded = reduceAfcQaTesterReport(pending, { type: "rerun_succeeded" });
  assert.equal(succeeded.effect.type, "refresh_qa");
  assert.equal(succeeded.state.rerunPending, false);
  const view = deriveAfcQaTesterReportView(succeeded.state, {
    preparePhase: "ready",
    prepareGenerationId: GEN_1,
  });
  assert.equal(view.showManualReport, true);
});

test("43-47) error copy is generic and internals stay off the wire", async () => {
  assert.equal(
    afcQaReadyRerunErrorMessage(400),
    AFC_QA_TESTER_COPY.rerunError400,
  );
  assert.equal(
    afcQaReadyRerunErrorMessage(404),
    AFC_QA_TESTER_COPY.rerunError404,
  );
  assert.equal(
    afcQaReadyRerunErrorMessage(500),
    AFC_QA_TESTER_COPY.rerunError500,
  );
  assert.equal(
    afcQaReadyRerunErrorMessage(401),
    AFC_QA_TESTER_COPY.sessionExpired,
  );

  const { store, retryStore } = harness();
  const invalid = await postRerun({
    userId: USER_A,
    body: "not-json",
    store,
    retryStore,
  });
  assert.equal(invalid.response.status, 400);
  const invalidBody = JSON.stringify(await jsonBody(invalid.response));
  assert.doesNotMatch(invalidBody, /sessionId|original_sha256|lineage_seq|SQL/);

  const stale = await postRerun({
    userId: USER_A,
    store: harness({ memberships: [] }).store,
    retryStore,
  });
  assert.equal(stale.response.status, 404);
  const staleBody = await jsonBody(stale.response);
  assert.deepEqual(staleBody, { error: "Not available." });
  assert.doesNotMatch(JSON.stringify(staleBody), /SESSION_A|machineStatus/);

  const pending = reduceAfcQaTesterReport(reportableReadyModel(), {
    type: "rerun_requested",
    preparePhase: "ready",
    prepareGenerationId: GEN_1,
  }).state;
  const notFound = reduceAfcQaTesterReport(pending, {
    type: "rerun_http_error",
    status: 404,
  });
  assert.equal(notFound.state.noticeMessage, AFC_QA_TESTER_COPY.rerunError404);
  assert.equal(notFound.effect.type, "refresh_qa");
  const unauthorizedUi = reduceAfcQaTesterReport(pending, {
    type: "rerun_http_error",
    status: 401,
  });
  assert.equal(unauthorizedUi.effect.type, "unauthorized");
});

test("48-56) isolation: no Case, Session close, 3B expansion, new intent, restore mutation, admin, corpus, or migration", () => {
  const implementation = source("lib/afc-v2-diagnostics/qa-rerun.server.ts");
  const route = source("app/api/vibode/afc/qa/rerun/route.ts");
  const client = source("lib/afc-v2-diagnostics/tester-report.client.ts");
  const ui = source("components/afc-qa/AfcQaTesterReport.tsx");
  const state = source("lib/afc-v2-diagnostics/browser-qa-state.server.ts");
  const restore = source("app/api/vibode/afc/restore/route.ts");
  const prepare = source("lib/afc-v2-runtime/prepare-3d-room-client.ts");
  const contracts = source("lib/afc-v2-diagnostics/contracts.ts");

  assert.doesNotMatch(`${implementation}\n${route}`, /insertTesterCase|vibode_afc_diagnostic_cases/);
  assert.doesNotMatch(implementation, /status: "closed"/);
  assert.doesNotMatch(state, /canRerun|isReady|latestStatus/);
  assert.match(
    state,
    /enabled: Boolean\(state.enabled\),\s+canReport: Boolean\(state.canReport\),\s+offerFeedback: Boolean\(state.offerFeedback\),\s+reportGenerationId:/,
  );
  assert.doesNotMatch(
    contracts,
    /ready_reread|qa_reread|reprocess|retry_ready/,
  );
  assert.doesNotMatch(restore, /qa\/rerun|requestRunningFromReady/);
  assert.match(prepare, /if \(state.phase === "error"\) return "Try Again"/);
  assert.match(prepare, /canRequestPrepare/);
  assert.doesNotMatch(prepare, /qa\/rerun|Re-run room read/);
  assert.match(ui, /rerunButton/);
  assert.match(client, /Re-run room read/);
  assert.match(client, /AFC_QA_READY_RERUN_PATH/);
  assert.doesNotMatch(`${implementation}\n${route}\n${ui}`, /getAuthenticatedAdminUser|app\/admin\/afc-qa/);
  assert.doesNotMatch(`${implementation}\n${route}`, /corpus|regression fixture/);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /afd.?3d|qa.?rerun|ready.?reread/i.test(name)),
    false,
  );
  assert.equal(existsSync(path.join(ROOT, "app/admin/afc-qa")), false);
});

test("allowlisted users can authorize; others cannot", async () => {
  const { store, retryStore } = harness();
  const allowed = await authorizeReady(store, retryStore, {}, QA_ALLOW);
  assert.equal(allowed.intent, "run_again");
  await assert.rejects(
    () =>
      authorizeAfcQaReadyRerun(
        { userId: USER_B, roomId: ROOM_A, generationId: GEN_1 },
        { store, retryStore, env: QA_ALLOW },
      ),
    (error: unknown) => error instanceof AfcQaReadyRerunQaDisabledError,
  );
});

test("invalid user id is a 400 before room reads", async () => {
  await assert.rejects(
    () =>
      authorizeAfcQaReadyRerun(
        { userId: "bad", roomId: ROOM_A, generationId: GEN_1 },
        { env: QA_ALL },
      ),
    (error: unknown) =>
      error instanceof AfcQaReadyRerunInputError && error.code === "invalid_user_id",
  );
});

test("component posts only roomId and generationId and wires prepare running", () => {
  const ui = source("components/afc-qa/AfcQaTesterReport.tsx");
  const editor = source("app/editor/page.tsx");
  assert.match(ui, /JSON\.stringify\(effect\.body\)/);
  assert.match(ui, /post_rerun/);
  assert.match(ui, /onRerunStart/);
  assert.match(ui, /data-afc-qa-ready-rerun/);
  assert.match(ui, /rerunInFlightRef/);
  assert.match(editor, /prepareGenerationId=\{prepare3d\.state\.generationId\}/);
  assert.match(editor, /onRerunStart=\{\(\) => prepare3d\.requestRunningFromReady\(\)\}/);
  assert.match(editor, /onRerunReverted=\{\(\) => prepare3d\.revertRunningToReady\(\)\}/);
  assert.match(editor, /onRerunSettled=\{\(result\) => prepare3d\.settleRunning\(result\)\}/);
  assert.doesNotMatch(editor, /Re-run room read|\/api\/vibode\/afc\/qa\/rerun/);
  assert.doesNotMatch(ui, /intent:/);
});

test("hook expose running-from-ready without QA routes", () => {
  const hook = source("lib/afc-v2-runtime/use-prepare-3d-room.ts");
  assert.match(hook, /requestRunningFromReady/);
  assert.match(hook, /revertRunningToReady/);
  assert.match(hook, /settleRunning/);
  assert.doesNotMatch(hook, /qa\/rerun|offerFeedback|canReport|Re-run room read/);
});

test("production and STAGE stay free of QA rerun internals", () => {
  const files = [
    ...walkTs(path.join(ROOT, "lib/afc-v2-production")),
    ...walkTs(path.join(ROOT, "components/stage")),
    ...walkTs(path.join(ROOT, "app/api/vibode/afc")).filter(
      (file) => !file.includes(`${path.sep}afc${path.sep}qa${path.sep}`),
    ),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /qa-rerun|authorizeAfcQaReadyRerun|AFC_QA_READY_RERUN_PATH|Re-run room read/,
      path.relative(ROOT, file),
    );
  }
});
