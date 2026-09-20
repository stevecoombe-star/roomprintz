import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { isAdminEmail } from "@/lib/adminAccess";

import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
} from "./contracts";
import { AFC_QA_ISSUE_TAXONOMY_VERSION } from "./taxonomy";
import {
  afcDiagnosticsAdminJson,
  authorizeAfcDiagnosticsAdmin,
  type AfcDiagnosticsAdminAuth,
} from "./admin-auth.server";
import {
  AFC_DIAGNOSTIC_ADMIN_CASE_LIST_DEFAULT_LIMIT,
  AFC_DIAGNOSTIC_ADMIN_CASE_LIST_MAX_LIMIT,
  AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION_V1,
  assertAfcDiagnosticAdminPayloadPrivacy,
  collectAfcDiagnosticAdminPayloadPrivacyViolations,
  decodeAfcDiagnosticAdminCaseListCursor,
  encodeAfcDiagnosticAdminCaseListCursor,
  mapAfcDiagnosticAdminEngineFingerprint,
  mapAfcDiagnosticAdminGenerationEvidence,
  parseAfcDiagnosticAdminCaseListQuery,
  parseAfcDiagnosticAdminGenerationRecord,
  parseAfcDiagnosticAdminUuid,
} from "./admin-read-model";
import {
  AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS,
  AFC_GENERATION_TABLE,
  createSupabaseAfcDiagnosticAdminReadStore,
  handleAfcDiagnosticsAdminCaseDetailGet,
  handleAfcDiagnosticsAdminCasesGet,
  handleAfcDiagnosticsAdminSessionDetailGet,
  type AfcDiagnosticAdminReadStore,
} from "./admin-read-model.server";

const ROOT = process.cwd();
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_A = "99999999-9999-4999-8999-999999999999";
const SESSION_A = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const SESSION_B = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const GEN_2 = "85feaef6-d53a-4a28-a557-04e6abb975d9";
const GEN_3 = "13131313-1313-4131-8131-131313131313";
const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const CASE_2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const CASE_3 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const EMPTY_SHA = "e".repeat(64);
const TILED_SHA = "f".repeat(64);

const SUMMARY_KEYS = [
  "caseId",
  "submittedAt",
  "reviewStatus",
  "trigger",
  "origin",
  "issueCodes",
  "taxonomyVersion",
  "hasNotes",
  "roomId",
  "sessionId",
  "sessionStatus",
  "sessionAttemptCount",
  "reportedGenerationId",
  "machineStatusSnapshot",
  "reporterUserId",
] as const;

type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "in"; column: string; value: unknown[] }
  | { type: "contains"; column: string; value: unknown[] }
  | { type: "gte"; column: string; value: unknown }
  | { type: "lte"; column: string; value: unknown }
  | { type: "or"; value: string };

type DbOp = {
  table: string;
  action: "select" | "insert" | "update" | "delete";
  columns: string;
  payload?: Record<string, unknown>;
  filters: Filter[];
  orders: { column: string; ascending: boolean }[];
  limit: number | null;
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

function afd4aOperationalSources() {
  return [
    source("lib/afc-v2-diagnostics/admin-auth.server.ts"),
    source("lib/afc-v2-diagnostics/admin-read-model.server.ts"),
    source("app/api/admin/afc-diagnostics/cases/route.ts"),
    source("app/api/admin/afc-diagnostics/cases/[caseId]/route.ts"),
    source("app/api/admin/afc-diagnostics/sessions/[sessionId]/route.ts"),
  ].join("\n");
}

function afd4aSources() {
  return [
    afd4aOperationalSources(),
    source("lib/afc-v2-diagnostics/admin-read-model.ts"),
  ].join("\n");
}

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function validFingerprint(extra: Record<string, unknown> = {}) {
  return {
    fingerprintSchemaVersion: AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION_V1,
    productionSchemaVersion: "afc-v2-production-room-authority/v1",
    gitSha: "abc123",
    observationModelId: "obs-model",
    engineVersions: {
      liveProduct: "lp",
      autoMetric: "am",
      cameraCalibration: "cc",
      cameraAuthority: "ca",
      collision: "col",
      emptyAuthoritativeCollision: "eac",
    },
    tiled: {
      generatorId: "gen",
      profileId: "prof",
      researchPreset: "preset",
      requestedModelId: "model",
      readerVersion: null,
    },
    ...extra,
  };
}

function generationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GEN_1,
    room_id: ROOM_A,
    user_id: USER_A,
    parent_generation_id: null,
    lineage_seq: 1,
    run_id: "run-1",
    intent: "analyze",
    status: "ready",
    created_at: "2026-09-18T12:00:00.000Z",
    completed_at: "2026-09-18T12:00:01.000Z",
    frame_width: 1200,
    frame_height: 800,
    failure_reason: null,
    metric_status: "path_a",
    collision_status: "empty_authoritative",
    diagnostic_payload: {
      analysisStatus: "applied",
      reason: null,
      executionCounts: { tiledReader: 1 },
    },
    engine_fingerprint: validFingerprint(),
    production_authority: {
      recovery: { safeFailureState: "none" },
      frozenCamera: { applied: true },
    },
    original_sha256: SHA_A,
    original_decoded_width: 1200,
    original_decoded_height: 800,
    original_byte_count: 1234,
    original_mime_type: "image/jpeg",
    original_orientation: 1,
    empty_sha256: EMPTY_SHA,
    empty_artifact_source: "generated",
    tiled_sha256: TILED_SHA,
    tiled_artifact_source: "durable",
    ...overrides,
  };
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_A,
    status: "open",
    room_id: ROOM_A,
    user_id: USER_A,
    original_sha256: SHA_A,
    base_asset_id: ASSET_A,
    created_at: "2026-09-18T11:00:00.000Z",
    updated_at: "2026-09-18T12:00:00.000Z",
    ...overrides,
  };
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: SESSION_A,
    generation_id: GEN_1,
    attempt_ordinal: 1,
    intent: "analyze",
    associated_at: "2026-09-18T12:00:00.000Z",
    ...overrides,
  };
}

function caseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CASE_1,
    submitted_at: "2026-09-19T12:00:00.000Z",
    review_status: "new",
    trigger: "manual_report",
    issue_codes: ["perspective_off"],
    taxonomy_version: AFC_QA_ISSUE_TAXONOMY_VERSION,
    notes: "looks tilted",
    room_id: ROOM_A,
    session_id: SESSION_A,
    reported_generation_id: GEN_1,
    machine_status_snapshot: "ready",
    reporter_user_id: USER_A,
    original_sha256: SHA_A,
    original_identity: {
      decodedWidth: 1200,
      decodedHeight: 800,
      byteCount: 1234,
      mimeType: "image/jpeg",
      orientation: 1,
      baseAssetId: ASSET_A,
    },
    reviewer_user_id: null,
    review_notes: null,
    reviewed_at: null,
    ...overrides,
  };
}

function project(row: Record<string, unknown>, columns: string) {
  if (columns === "*" || columns.length === 0) return { ...row };
  const out: Record<string, unknown> = {};
  for (const column of columns.split(",").map((part) => part.trim())) {
    out[column] = row[column];
  }
  return out;
}

function parseKeyset(raw: string): { submittedAt: string; id: string } | null {
  const match = raw.match(
    /^submitted_at\.lt\."([^"]+)",and\(submitted_at\.eq\."([^"]+)",id\.lt\.([^)]+)\)$/,
  );
  if (!match || match[1] !== match[2]) return null;
  return { submittedAt: match[1], id: match[3].toLowerCase() };
}

class FakeDiagnosticDb {
  sessions: Record<string, unknown>[] = [];
  memberships: Record<string, unknown>[] = [];
  generations: Record<string, unknown>[] = [];
  cases: Record<string, unknown>[] = [];
  ops: DbOp[] = [];
  nextError: { code?: string | number; message?: string } | null = null;

  constructor(seed?: {
    sessions?: Record<string, unknown>[];
    memberships?: Record<string, unknown>[];
    generations?: Record<string, unknown>[];
    cases?: Record<string, unknown>[];
  }) {
    this.sessions = (seed?.sessions ?? []).map((row) => ({ ...row }));
    this.memberships = (seed?.memberships ?? []).map((row) => ({ ...row }));
    this.generations = (seed?.generations ?? []).map((row) => ({ ...row }));
    this.cases = (seed?.cases ?? []).map((row) => ({ ...row }));
  }

  failNext(error: { code?: string | number; message?: string }) {
    this.nextError = error;
  }

  client() {
    return { from: (table: string) => new FakeQuery(this, table) };
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
  private orders: { column: string; ascending: boolean }[] = [];
  private limitValue: number | null = null;

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

  contains(column: string, value: unknown[]) {
    this.filters.push({ type: "contains", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ type: "gte", column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ type: "lte", column, value });
    return this;
  }

  or(value: string) {
    this.filters.push({ type: "or", value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({
      column,
      ascending: options?.ascending !== false,
    });
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
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
      if (filter.type === "or") {
        const cursor = parseKeyset(filter.value);
        if (!cursor) return false;
        const rowTime = Date.parse(String(row.submitted_at));
        const cursorTime = Date.parse(cursor.submittedAt);
        const rowId = String(row.id).toLowerCase();
        return (
          rowTime < cursorTime ||
          (rowTime === cursorTime && rowId < cursor.id)
        );
      }
      const value = row[filter.column];
      if (filter.type === "eq") {
        if (filter.column.endsWith("_at") || filter.column === "submitted_at") {
          return Date.parse(String(value)) === Date.parse(String(filter.value));
        }
        return String(value).toLowerCase() === String(filter.value).toLowerCase();
      }
      if (filter.type === "in") {
        const allowed = filter.value.map((entry) => String(entry).toLowerCase());
        return allowed.includes(String(value).toLowerCase());
      }
      if (filter.type === "contains") {
        return (
          Array.isArray(value) &&
          filter.value.every((entry) => value.includes(entry))
        );
      }
      const rowTime = Date.parse(String(value));
      const bound = Date.parse(String(filter.value));
      if (filter.type === "gte") return rowTime >= bound;
      return rowTime <= bound;
    });
  }

  private compare(left: Record<string, unknown>, right: Record<string, unknown>) {
    for (const order of this.orders) {
      const av = left[order.column];
      const bv = right[order.column];
      let cmp = 0;
      if (order.column === "submitted_at" || String(order.column).endsWith("_at")) {
        cmp = Date.parse(String(av)) - Date.parse(String(bv));
      } else if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else if (String(av) < String(bv)) cmp = -1;
      else if (String(av) > String(bv)) cmp = 1;
      if (cmp !== 0) return order.ascending ? cmp : -cmp;
    }
    return 0;
  }

  private execute(mode: "rows" | "maybeSingle") {
    this.db.ops.push({
      table: this.table,
      action: this.action,
      columns: this.columns,
      payload: this.payload ?? undefined,
      filters: [...this.filters],
      orders: [...this.orders],
      limit: this.limitValue,
    });
    if (this.db.nextError) {
      const error = this.db.nextError;
      this.db.nextError = null;
      return { data: null, error };
    }
    let rows = this.db.tableRows(this.table).filter((row) => this.matches(row));
    if (this.orders.length > 0) rows = [...rows].sort((a, b) => this.compare(a, b));
    if (this.limitValue != null) rows = rows.slice(0, this.limitValue);
    const projected = rows.map((row) => project(row, this.columns));
    if (mode === "maybeSingle") {
      return { data: projected[0] ?? null, error: null };
    }
    return { data: projected, error: null };
  }
}

function harness(seed?: ConstructorParameters<typeof FakeDiagnosticDb>[0]) {
  const db = new FakeDiagnosticDb(seed);
  const store = createSupabaseAfcDiagnosticAdminReadStore(db.client());
  return { db, store };
}

function typicalSeed() {
  return {
    sessions: [sessionRow()],
    memberships: [
      membershipRow(),
      membershipRow({
        generation_id: GEN_2,
        attempt_ordinal: 2,
        intent: "run_again",
        associated_at: "2026-09-18T12:05:00.000Z",
      }),
    ],
    generations: [
      generationRow(),
      generationRow({
        id: GEN_2,
        parent_generation_id: GEN_1,
        lineage_seq: 2,
        run_id: "run-2",
        intent: "run_again",
        status: "failed",
        failure_reason: "supported_room_ambiguous",
        metric_status: "none",
        collision_status: "none",
        completed_at: "2026-09-18T12:05:01.000Z",
        diagnostic_payload: {
          analysisStatus: "failed",
          reason: "supported_room_ambiguous",
        },
        production_authority: null,
        engine_fingerprint: validFingerprint(),
      }),
    ],
    cases: [caseRow()],
  };
}

function unauthorized(): AfcDiagnosticsAdminAuth {
  return {
    ok: false,
    response: afcDiagnosticsAdminJson({ error: "Unauthorized." }, 401),
  };
}

function forbidden(): AfcDiagnosticsAdminAuth {
  return {
    ok: false,
    response: afcDiagnosticsAdminJson({ error: "Admin access required." }, 403),
  };
}

function adminOk(): AfcDiagnosticsAdminAuth {
  return {
    ok: true,
    admin: Object.freeze({
      userId: ADMIN_ID,
      email: "admin@example.com",
    }),
  };
}

async function listGet(
  url: string,
  store: AfcDiagnosticAdminReadStore,
  authorize: () => Promise<AfcDiagnosticsAdminAuth> = async () => adminOk(),
  getStore?: () => AfcDiagnosticAdminReadStore | null,
) {
  return handleAfcDiagnosticsAdminCasesGet({
    request: new Request(url),
    authorize,
    store: getStore ? undefined : store,
    getStore,
  });
}

async function caseGet(
  caseId: string,
  store: AfcDiagnosticAdminReadStore,
  authorize: () => Promise<AfcDiagnosticsAdminAuth> = async () => adminOk(),
) {
  return handleAfcDiagnosticsAdminCaseDetailGet({
    request: new Request(`http://test/api/admin/afc-diagnostics/cases/${caseId}`),
    caseId,
    authorize,
    store,
  });
}

async function sessionGet(
  sessionId: string,
  store: AfcDiagnosticAdminReadStore,
  authorize: () => Promise<AfcDiagnosticsAdminAuth> = async () => adminOk(),
) {
  return handleAfcDiagnosticsAdminSessionDetailGet({
    request: new Request(
      `http://test/api/admin/afc-diagnostics/sessions/${sessionId}`,
    ),
    sessionId,
    authorize,
    store,
  });
}

function cookieClient(user: { id: string; email?: string | null } | null, error: { message: string } | null = null) {
  return async () => ({
    auth: {
      getUser: async () => ({
        data: { user },
        error: user ? null : error ?? { message: "not authenticated" },
      }),
    },
  });
}

async function withAdminEmail<T>(
  email: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  try {
    if (email === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = email;
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
}

function padCaseId(index: number) {
  const hex = index.toString(16).padStart(12, "0");
  return `ca5e0000-0000-4000-8000-${hex}`;
}

test("1-3) unauthenticated list, case detail, and session detail → 401", async () => {
  const { store } = harness(typicalSeed());
  for (const response of [
    await listGet("http://test/api/admin/afc-diagnostics/cases", store, async () => unauthorized()),
    await caseGet(CASE_1, store, async () => unauthorized()),
    await sessionGet(SESSION_A, store, async () => unauthorized()),
  ]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await jsonBody(response), { error: "Unauthorized." });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("4) authenticated non-admin → 403", async () => {
  const { store } = harness(typicalSeed());
  const response = await listGet(
    "http://test/api/admin/afc-diagnostics/cases",
    store,
    async () => forbidden(),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await jsonBody(response), { error: "Admin access required." });
});

test("5) admin exact normalized email is allowed", async () => {
  const auth = await withAdminEmail("Admin@Example.com", () =>
    authorizeAfcDiagnosticsAdmin({
      getCookieClient: cookieClient({
        id: ADMIN_ID,
        email: " admin@example.com ",
      }),
      isAdmin: isAdminEmail,
    }),
  );
  assert.equal(auth.ok, true);
  if (auth.ok) {
    assert.equal(auth.admin.userId, ADMIN_ID);
    assert.equal(auth.admin.email, " admin@example.com ");
  }
});

test("6) VIBODE_ADMIN_EMAIL unset fails closed", async () => {
  const auth = await withAdminEmail(undefined, () =>
    authorizeAfcDiagnosticsAdmin({
      getCookieClient: cookieClient({
        id: ADMIN_ID,
        email: "admin@example.com",
      }),
      isAdmin: isAdminEmail,
    }),
  );
  assert.equal(auth.ok, false);
  if (!auth.ok) {
    const body = await jsonBody(auth.response);
    assert.equal(auth.response.status, 403);
    assert.deepEqual(body, {
      error: "Admin access required.",
    });
    assert.doesNotMatch(JSON.stringify(body), /admin@example.com|VIBODE_ADMIN_EMAIL/);
  }
});

test("7-9) diagnostics admin auth does not use QA tester env or bearer AFC auth and reuses isAdminEmail", () => {
  const operational = afd4aOperationalSources();
  assert.doesNotMatch(operational, /VIBODE_AFC_QA_MODE|VIBODE_AFC_QA_USER_IDS/);
  assert.doesNotMatch(operational, /authorizeProductionAfcUser|getBearerToken/);
  assert.match(source("lib/afc-v2-diagnostics/admin-auth.server.ts"), /isAdminEmail/);
  assert.match(
    source("lib/afc-v2-diagnostics/admin-auth.server.ts"),
    /from "@\/lib\/adminAccess"/,
  );
  assert.match(
    source("lib/afc-v2-diagnostics/admin-auth.server.ts"),
    /auth\.getUser\(\)/,
  );
  assert.doesNotMatch(operational, /getAuthenticatedAdminUser/);
});

test("10-12) routes are GET-only node runtime", () => {
  for (const relative of [
    "app/api/admin/afc-diagnostics/cases/route.ts",
    "app/api/admin/afc-diagnostics/cases/[caseId]/route.ts",
    "app/api/admin/afc-diagnostics/sessions/[sessionId]/route.ts",
  ]) {
    const route = source(relative);
    assert.match(route, /export const runtime = "nodejs"/);
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /export async function (POST|PATCH|DELETE|PUT)/);
  }
});

test("unauthorized requests do not create a service-role store", async () => {
  let built = false;
  const { store } = harness(typicalSeed());
  const response = await listGet(
    "http://test/api/admin/afc-diagnostics/cases",
    store,
    async () => unauthorized(),
    () => {
      built = true;
      return store;
    },
  );
  assert.equal(response.status, 401);
  assert.equal(built, false);
});

test("13-15) list default limit 25, max 50, invalid limits 400", async () => {
  const cases = Array.from({ length: 51 }, (_, index) =>
    caseRow({
      id: padCaseId(index + 1),
      submitted_at: new Date(Date.parse("2026-09-19T12:00:00.000Z") - index * 1000).toISOString(),
      notes: null,
    }),
  );
  const { store } = harness({
    ...typicalSeed(),
    cases,
  });
  const defaulted = await listGet("http://test/api/admin/afc-diagnostics/cases", store);
  assert.equal(defaulted.status, 200);
  const defaultBody = await jsonBody(defaulted);
  assert.equal((defaultBody.items as unknown[]).length, AFC_DIAGNOSTIC_ADMIN_CASE_LIST_DEFAULT_LIMIT);
  assert.equal(typeof defaultBody.nextCursor, "string");

  const maxed = await listGet(
    "http://test/api/admin/afc-diagnostics/cases?limit=50",
    store,
  );
  const maxBody = await jsonBody(maxed);
  assert.equal((maxBody.items as unknown[]).length, AFC_DIAGNOSTIC_ADMIN_CASE_LIST_MAX_LIMIT);
  assert.equal(typeof maxBody.nextCursor, "string");

  for (const limit of ["0", "-1", "51", "1.5", "abc"]) {
    const response = await listGet(
      `http://test/api/admin/afc-diagnostics/cases?limit=${limit}`,
      store,
    );
    assert.equal(response.status, 400, limit);
    assert.deepEqual(await jsonBody(response), { error: "Invalid request." });
  }
});

test("16-22) newest-first keyset pagination with id tie-breaker and cursor validation", async () => {
  const sameTime = "2026-09-19T15:00:00.000Z";
  const { store } = harness({
    ...typicalSeed(),
    cases: [
      caseRow({
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        submitted_at: sameTime,
        notes: null,
      }),
      caseRow({
        id: "11111111-1111-4111-8111-111111111111",
        submitted_at: sameTime,
        notes: null,
      }),
      caseRow({
        id: CASE_3,
        submitted_at: "2026-09-19T16:00:00.000Z",
        notes: null,
      }),
    ],
  });
  const first = await listGet(
    "http://test/api/admin/afc-diagnostics/cases?limit=2",
    store,
  );
  const firstBody = await jsonBody(first);
  const items = firstBody.items as Array<Record<string, unknown>>;
  assert.equal(items.map((item) => item.caseId).join(","), `${CASE_3},eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee`);
  assert.equal(typeof firstBody.nextCursor, "string");
  const decoded = decodeAfcDiagnosticAdminCaseListCursor(String(firstBody.nextCursor));
  assert.equal(decoded.ok, true);

  const second = await listGet(
    `http://test/api/admin/afc-diagnostics/cases?limit=2&cursor=${encodeURIComponent(String(firstBody.nextCursor))}`,
    store,
  );
  const secondBody = await jsonBody(second);
  const secondItems = secondBody.items as Array<Record<string, unknown>>;
  assert.deepEqual(secondItems.map((item) => item.caseId), [
    "11111111-1111-4111-8111-111111111111",
  ]);
  assert.equal(secondBody.nextCursor, null);

  const malformed = await listGet(
    "http://test/api/admin/afc-diagnostics/cases?cursor=not-a-cursor",
    store,
  );
  assert.equal(malformed.status, 400);
  const badId = encodeAfcDiagnosticAdminCaseListCursor({
    submittedAt: sameTime,
    id: "not-a-uuid",
  } as never);
  const badIdResponse = await listGet(
    `http://test/api/admin/afc-diagnostics/cases?cursor=${badId}`,
    store,
  );
  assert.equal(badIdResponse.status, 400);
});

test("23-43) v1 list filters validate exactly and do not ignore malformed values", async () => {
  const { store } = harness({
    ...typicalSeed(),
    cases: [
      caseRow({ notes: null }),
      caseRow({
        id: CASE_2,
        review_status: "in_review",
        trigger: "repeated_unsuccessful",
        issue_codes: ["scale_incorrect"],
        machine_status_snapshot: "failed",
        room_id: ROOM_B,
        submitted_at: "2026-09-18T12:00:00.000Z",
        notes: null,
      }),
      caseRow({
        id: CASE_3,
        review_status: "closed",
        trigger: "admin_capture",
        issue_codes: ["other"],
        machine_status_snapshot: "running",
        submitted_at: "2026-09-17T12:00:00.000Z",
        notes: "  ",
      }),
    ],
    sessions: [
      sessionRow(),
      sessionRow({ id: SESSION_B, room_id: ROOM_B, original_sha256: SHA_B }),
    ],
  });

  async function ids(query: string) {
    const response = await listGet(
      `http://test/api/admin/afc-diagnostics/cases?${query}`,
      store,
    );
    assert.equal(response.status, 200, query);
    const body = await jsonBody(response);
    return (body.items as Array<Record<string, unknown>>).map((item) => item.caseId);
  }

  assert.deepEqual(await ids("reviewStatus=new"), [CASE_1]);
  assert.deepEqual(await ids("reviewStatus=in_review"), [CASE_2]);
  assert.deepEqual(await ids("reviewStatus=closed"), [CASE_3]);
  assert.equal(
    (await listGet("http://test/api/admin/afc-diagnostics/cases?reviewStatus=done", store)).status,
    400,
  );

  assert.deepEqual(await ids("trigger=manual_report"), [CASE_1]);
  assert.deepEqual(await ids("trigger=repeated_unsuccessful"), [CASE_2]);
  assert.deepEqual(await ids("trigger=admin_capture"), [CASE_3]);
  assert.equal(
    (await listGet("http://test/api/admin/afc-diagnostics/cases?trigger=other", store)).status,
    400,
  );

  assert.deepEqual(await ids("issueCode=perspective_off"), [CASE_1]);
  assert.equal(
    (await listGet("http://test/api/admin/afc-diagnostics/cases?issueCode=not_a_code", store)).status,
    400,
  );

  assert.deepEqual(await ids("machineStatusSnapshot=ready"), [CASE_1]);
  assert.deepEqual(await ids("machineStatusSnapshot=failed"), [CASE_2]);
  assert.deepEqual(await ids("machineStatusSnapshot=running"), [CASE_3]);
  assert.equal(
    (await listGet("http://test/api/admin/afc-diagnostics/cases?machineStatusSnapshot=success", store)).status,
    400,
  );

  assert.deepEqual(await ids(`roomId=${ROOM_B}`), [CASE_2]);
  assert.equal(
    (await listGet("http://test/api/admin/afc-diagnostics/cases?roomId=not-uuid", store)).status,
    400,
  );

  assert.deepEqual(
    await ids("submittedFrom=2026-09-19T00:00:00.000Z"),
    [CASE_1],
  );
  assert.deepEqual(
    await ids("submittedTo=2026-09-18T00:00:00.000Z"),
    [CASE_3],
  );
  const inclusive = await ids(
    "submittedFrom=2026-09-18T12:00:00.000Z&submittedTo=2026-09-18T12:00:00.000Z",
  );
  assert.deepEqual(inclusive, [CASE_2]);
  assert.equal(
    (
      await listGet(
        "http://test/api/admin/afc-diagnostics/cases?submittedFrom=2026-09-19T00:00:00.000Z&submittedTo=2026-09-18T00:00:00.000Z",
        store,
      )
    ).status,
    400,
  );
  assert.equal(
    (await listGet("http://test/api/admin/afc-diagnostics/cases?submittedFrom=yesterday", store)).status,
    400,
  );
});

test("44-55) case summary DTO shape, origin, hasNotes, and privacy of notes/email/generation internals", async () => {
  const { store } = harness({
    ...typicalSeed(),
    cases: [
      caseRow({ notes: "looks tilted" }),
      caseRow({
        id: CASE_2,
        trigger: "admin_capture",
        notes: null,
        submitted_at: "2026-09-18T12:00:00.000Z",
      }),
      caseRow({
        id: CASE_3,
        trigger: "repeated_unsuccessful",
        notes: "   ",
        submitted_at: "2026-09-17T12:00:00.000Z",
      }),
    ],
  });
  const response = await listGet("http://test/api/admin/afc-diagnostics/cases", store);
  const body = await jsonBody(response);
  const items = body.items as Array<Record<string, unknown>>;
  assert.deepEqual(Object.keys(items[0]), [...SUMMARY_KEYS]);
  assert.equal(items[0].origin, "tester");
  assert.equal(items[0].hasNotes, true);
  assert.equal(items[1].origin, "admin");
  assert.equal(items[1].hasNotes, false);
  assert.equal(items[2].hasNotes, false);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /looks tilted|review_notes|reviewNotes/);
  assert.doesNotMatch(serialized, /@example\.com|reporterEmail|displayName/);
  assert.equal(items[0].sessionStatus, "open");
  assert.equal(items[0].sessionAttemptCount, 2);
  assert.equal(items[0].reporterUserId, USER_A);
  assert.doesNotMatch(serialized, /storage_path|provider_provenance|diagnostic_payload|production_authority/);
  assert.equal("notes" in items[0], false);
  assert.equal("review" in items[0], false);
});

test("56-58) case list uses three constant queries and batches sessions/memberships", async () => {
  const cases = Array.from({ length: 3 }, (_, index) =>
    caseRow({
      id: padCaseId(index + 1),
      submitted_at: new Date(Date.parse("2026-09-19T12:00:00.000Z") - index * 1000).toISOString(),
      notes: null,
    }),
  );
  const { db, store } = harness({
    ...typicalSeed(),
    cases,
  });
  const response = await listGet("http://test/api/admin/afc-diagnostics/cases", store);
  assert.equal(response.status, 200);
  const selects = db.ops.filter((op) => op.action === "select");
  assert.equal(selects.length, 3);
  assert.equal(selects[0].table, AFC_DIAGNOSTIC_CASE_TABLE);
  assert.equal(selects[0].limit, 26);
  assert.equal(selects[1].table, AFC_DIAGNOSTIC_SESSION_TABLE);
  assert.equal(selects[1].columns, "id, status");
  assert.ok(selects[1].filters.some((filter) => filter.type === "in"));
  assert.equal(selects[2].table, AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE);
  assert.equal(selects[2].columns, "session_id");
  assert.ok(selects[2].filters.some((filter) => filter.type === "in"));
});

test("59-69) case detail happy path, validation, missing, integrity, and compact evidence", async () => {
  const { store, db } = harness({
    ...typicalSeed(),
    cases: [
      caseRow({
        notes: "looks tilted",
        review_status: "in_review",
        reviewer_user_id: ADMIN_ID,
        review_notes: "checking walls",
        reviewed_at: "2026-09-19T13:00:00.000Z",
      }),
    ],
  });
  const response = await caseGet(CASE_1, store);
  assert.equal(response.status, 200);
  const body = await jsonBody(response);
  assert.equal(body.caseId, CASE_1);
  assert.equal(body.notes, "looks tilted");
  assert.equal(body.reportedAttemptOrdinal, 1);
  assert.equal((body.review as Record<string, unknown>).reviewStatus, "in_review");
  assert.equal((body.review as Record<string, unknown>).reviewerUserId, ADMIN_ID);
  assert.equal((body.review as Record<string, unknown>).reviewNotes, "checking walls");
  assert.equal((body.source as Record<string, unknown>).originalSha256, SHA_A);
  assert.equal((body.source as Record<string, unknown>).baseAssetId, ASSET_A);
  assert.equal((body.session as Record<string, unknown>).sessionUserId, USER_A);
  const generation = body.reportedGeneration as Record<string, unknown>;
  assert.equal(generation.generationId, GEN_1);
  assert.equal(generation.status, "ready");
  assert.equal((generation.engineFingerprint as Record<string, unknown>).gitSha, "abc123");
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /@reporter|reporterEmail|storage_path|storage_bucket|signedUrl|provider_provenance/);
  assert.doesNotMatch(serialized, /executionCounts|frozenCamera/);

  assert.equal((await caseGet("not-a-uuid", store)).status, 400);
  assert.deepEqual(await jsonBody(await caseGet("not-a-uuid", store)), {
    error: "Invalid request.",
  });
  const missing = await caseGet("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9", store);
  assert.equal(missing.status, 404);
  assert.deepEqual(await jsonBody(missing), { error: "Not found." });

  db.sessions = [];
  const sessionMissing = await caseGet(CASE_1, store);
  assert.equal(sessionMissing.status, 500);
  assert.deepEqual(await jsonBody(sessionMissing), { error: "Server error." });
});

test("63) missing reported generation is an integrity 500", async () => {
  const { store } = harness({
    ...typicalSeed(),
    generations: [],
  });
  const response = await caseGet(CASE_1, store);
  assert.equal(response.status, 500);
  assert.deepEqual(await jsonBody(response), { error: "Server error." });
});

test("70-78) session detail orders attempts by ordinal, batches generations, and hides storage paths", async () => {
  const { db, store } = harness({
    ...typicalSeed(),
    generations: [
      generationRow({
        id: GEN_2,
        created_at: "2026-09-18T11:00:00.000Z",
        lineage_seq: 9,
        intent: "run_again",
        run_id: "run-2",
      }),
      generationRow(),
    ],
    memberships: [
      membershipRow({
        generation_id: GEN_2,
        attempt_ordinal: 2,
        intent: "run_again",
        associated_at: "2026-09-18T12:05:00.000Z",
      }),
      membershipRow(),
    ],
  });
  db.ops = [];
  const response = await sessionGet(SESSION_A, store);
  assert.equal(response.status, 200);
  const body = await jsonBody(response);
  assert.equal(body.sessionId, SESSION_A);
  assert.equal(body.sessionUserId, USER_A);
  assert.equal(body.originalSha256, SHA_A);
  assert.equal(body.baseAssetId, ASSET_A);
  assert.equal(body.attemptCount, 2);
  const attempts = body.attempts as Array<Record<string, unknown>>;
  assert.deepEqual(
    attempts.map((attempt) => [attempt.attemptOrdinal, attempt.generationId, attempt.intent]),
    [
      [1, GEN_1, "analyze"],
      [2, GEN_2, "run_again"],
    ],
  );
  const genOps = db.ops.filter((op) => op.table === AFC_GENERATION_TABLE);
  assert.equal(genOps.length, 1);
  assert.ok(genOps[0].filters.some((filter) => filter.type === "in"));
  assert.equal(genOps[0].columns, AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS);
  assert.doesNotMatch(genOps[0].columns, /\*/);
  assert.doesNotMatch(
    genOps[0].columns,
    /storage_path|storage_bucket|provider_provenance|tiled_cache_key/,
  );
  assert.doesNotMatch(JSON.stringify(body), /storage_path|storage_bucket|signedUrl/);
  assert.equal((await sessionGet("bad", store)).status, 400);
  assert.equal(
    (await sessionGet("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9", store)).status,
    404,
  );
});

test("76) missing referenced generation is an integrity 500", async () => {
  const { store } = harness({
    ...typicalSeed(),
    generations: [generationRow()],
  });
  const response = await sessionGet(SESSION_A, store);
  assert.equal(response.status, 500);
  assert.deepEqual(await jsonBody(response), { error: "Server error." });
});

test("79-100) generation evidence allowlist, fingerprint mapping, and dropped internals", () => {
  const ready = mapAfcDiagnosticAdminGenerationEvidence(
    parseAfcDiagnosticAdminGenerationRecord(generationRow())!,
  );
  assert.equal(ready.status, "ready");
  assert.equal(ready.parentGenerationId, null);
  assert.equal(ready.lineageSeq, 1);
  assert.equal(ready.runId, "run-1");
  assert.deepEqual(ready.frame, { width: 1200, height: 800 });
  assert.equal(ready.failureReason, null);
  assert.equal(ready.metricStatus, "path_a");
  assert.equal(ready.collisionStatus, "empty_authoritative");
  assert.equal(ready.analysisStatus, "applied");
  assert.equal(ready.analysisReason, null);
  assert.equal(ready.recoverySafeFailureState, "none");
  assert.equal(ready.empty.present, true);
  assert.equal(ready.empty.sha256, EMPTY_SHA);
  assert.equal(ready.empty.artifactSource, "generated");
  assert.equal(ready.tiled.present, true);
  assert.equal(ready.tiled.artifactSource, "durable");
  assert.equal(ready.original?.originalSha256, SHA_A);
  assert.equal("providerProvenance" in ready, false);
  assert.equal("diagnosticPayload" in ready, false);
  assert.equal("productionAuthority" in ready, false);
  assert.equal("storagePath" in ready, false);

  const failed = mapAfcDiagnosticAdminGenerationEvidence(
    parseAfcDiagnosticAdminGenerationRecord(
      generationRow({
        status: "failed",
        failure_reason: "boom",
        diagnostic_payload: { analysisStatus: "failed", reason: "boom" },
        production_authority: null,
        parent_generation_id: GEN_1,
      }),
    )!,
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureReason, "boom");
  assert.equal(failed.analysisReason, "boom");
  assert.equal(failed.parentGenerationId, GEN_1);
  assert.equal(failed.recoverySafeFailureState, null);

  const running = mapAfcDiagnosticAdminGenerationEvidence(
    parseAfcDiagnosticAdminGenerationRecord(
      generationRow({
        status: "running",
        completed_at: null,
        frame_width: null,
        frame_height: null,
        original_sha256: null,
        empty_sha256: null,
        tiled_sha256: null,
        engine_fingerprint: null,
        diagnostic_payload: null,
        production_authority: null,
      }),
    )!,
  );
  assert.equal(running.status, "running");
  assert.equal(running.frame, null);
  assert.equal(running.original, null);
  assert.equal(running.engineFingerprint, null);
  assert.equal(running.empty.present, false);

  const mapped = mapAfcDiagnosticAdminEngineFingerprint(
    validFingerprint({ extraSecret: "nope", debug: true }),
  );
  assert.ok(mapped);
  assert.equal("extraSecret" in mapped, false);
  assert.equal(mapped.fingerprintSchemaVersion, AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION_V1);
  assert.equal(mapAfcDiagnosticAdminEngineFingerprint(null), null);
  assert.equal(mapAfcDiagnosticAdminEngineFingerprint({ foo: 1 }), null);
  assert.equal(
    mapAfcDiagnosticAdminEngineFingerprint(
      validFingerprint({ fingerprintSchemaVersion: "afc-v2-engine-fingerprint/v2" }),
    ),
    null,
  );
});

test("101-107) admin privacy assertion and generic error bodies", async () => {
  const valid = {
    items: [
      {
        caseId: CASE_1,
        reporterUserId: USER_A,
        hasNotes: true,
      },
    ],
    nextCursor: null,
  };
  assert.deepEqual(collectAfcDiagnosticAdminPayloadPrivacyViolations(valid), []);
  assert.doesNotThrow(() => assertAfcDiagnosticAdminPayloadPrivacy(valid));
  assert.ok(
    collectAfcDiagnosticAdminPayloadPrivacyViolations({
      storage_bucket: "vibode-afc-v2",
    }).length > 0,
  );
  assert.ok(
    collectAfcDiagnosticAdminPayloadPrivacyViolations({
      path: "users/x/storage_path",
    }).some((entry) => entry.includes("storage_path")),
  );
  assert.ok(
    collectAfcDiagnosticAdminPayloadPrivacyViolations({
      signedUrl: "https://example.com",
    }).length > 0,
  );
  assert.ok(
    collectAfcDiagnosticAdminPayloadPrivacyViolations({
      providerProvenance: { model: "x" },
    }).length > 0,
  );
  assert.ok(
    collectAfcDiagnosticAdminPayloadPrivacyViolations({
      token: "service_role",
    }).length > 0,
  );
  assert.deepEqual(
    collectAfcDiagnosticAdminPayloadPrivacyViolations({
      notes: "mentions storage_path and https://example.com",
      caseId: CASE_1,
    }),
    [],
  );

  const { store } = harness({
    ...typicalSeed(),
    sessions: [],
  });
  const response = await caseGet(CASE_1, store);
  assert.equal(response.status, 500);
  const body = await jsonBody(response);
  assert.deepEqual(body, { error: "Server error." });
  assert.doesNotMatch(
    JSON.stringify(body),
    /integrity|session|postgres|SQLSTATE|vibode_afc_diagnostic/,
  );
});

test("108-120) AFD-4A is read-only, has no UI/migration/image/review mutation, and stays in /api/admin/afc-diagnostics", () => {
  const operational = afd4aOperationalSources();
  const joined = afd4aSources();
  assert.doesNotMatch(joined, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  assert.doesNotMatch(
    operational,
    /submitAfcDiagnosticTesterCase|insertTesterCase|ensureAfcDiagnosticSessionMembership|closeStaleOpenSessions|insertMembership|insertOpenSession/,
  );
  assert.doesNotMatch(
    operational,
    /createSignedUrl|signOwnedOriginal|streamOriginal/,
  );
  assert.doesNotMatch(
    operational,
    /runProductionAfcAnalysis|restoreProductionAfcRoom|activateGeneration|authorizeAfcQaReadyRerun/,
  );
  assert.doesNotMatch(joined, /export async function (POST|PATCH|DELETE|PUT)/);
  assert.equal(
    existsSync(path.join(ROOT, "app/api/admin/afc-diagnostics/cases/route.ts")),
    true,
  );
  assert.equal(
    existsSync(path.join(ROOT, "app/api/admin/afc-diagnostics/cases/[caseId]/route.ts")),
    true,
  );
  assert.equal(
    existsSync(
      path.join(ROOT, "app/api/admin/afc-diagnostics/sessions/[sessionId]/route.ts"),
    ),
    true,
  );
  assert.doesNotMatch(
    source("lib/afc-v2-diagnostics/admin-read-model.server.ts"),
    /VIBODE_AFC_QA_MODE|qa-capability|authorizeProductionAfcUser/,
  );
  assert.equal(existsSync(path.join(ROOT, "app/admin/afc-qa")), false);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(
    migrations.some((name) => /afd.?4a|admin.?diagnostic.?read/i.test(name)),
    false,
  );
  assert.doesNotMatch(
    source("app/admin/AdminControls.tsx"),
    /admin-read-model|authorizeAfcDiagnosticsAdmin|\/api\/admin\/afc-diagnostics/,
  );
  for (const file of [
    "app/editor/page.tsx",
    "components/afc-qa/AfcQaTesterReport.tsx",
  ]) {
    assert.doesNotMatch(
      source(file),
      /afc-diagnostics|admin-read-model|authorizeAfcDiagnosticsAdmin/,
    );
  }
  assert.match(
    source("lib/afc-v2-production/engine-fingerprint.ts"),
    /afc-v2-engine-fingerprint\/v1/,
  );
  assert.equal(
    AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION_V1,
    "afc-v2-engine-fingerprint/v1",
  );
  const apiFiles = walkTs(path.join(ROOT, "app/api/admin/afc-diagnostics"));
  assert.equal(apiFiles.length, 3);
});

test("parse helpers reject invalid uuids and accept list query defaults", () => {
  assert.equal(parseAfcDiagnosticAdminUuid("not"), null);
  assert.equal(parseAfcDiagnosticAdminUuid(CASE_1.toUpperCase()), CASE_1);
  const parsed = parseAfcDiagnosticAdminCaseListQuery(new URLSearchParams());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.limit, 25);
    assert.equal(parsed.value.cursor, null);
  }
});

test("cookie client missing is a generic 500 and does not leak admin email", async () => {
  const auth = await withAdminEmail("secret-admin@example.com", () =>
    authorizeAfcDiagnosticsAdmin({
      getCookieClient: async () => null,
      isAdmin: isAdminEmail,
    }),
  );
  assert.equal(auth.ok, false);
  if (!auth.ok) {
    assert.equal(auth.response.status, 500);
    const body = await jsonBody(auth.response);
    assert.deepEqual(body, { error: "Server error." });
    assert.doesNotMatch(JSON.stringify(body), /secret-admin/);
  }
});
