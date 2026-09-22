import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
} from "./contracts";
import {
  type AfcDiagnosticAwaitableQuery,
  type AfcDiagnosticFilterQuery,
  type AfcDiagnosticSelectHead,
  type AfcDiagnosticTableClient,
} from "./diagnostic-db-client";
import {
  afcDiagnosticsAdminJson,
  authorizeAfcDiagnosticsAdmin,
  type AfcDiagnosticsAdminAuth,
  type AuthorizeAfcDiagnosticsAdminOptions,
} from "./admin-auth.server";
import {
  assertAfcDiagnosticAdminPayloadPrivacy,
  encodeAfcDiagnosticAdminCaseListCursor,
  mapAfcDiagnosticAdminCaseDetail,
  mapAfcDiagnosticAdminCaseSummary,
  mapAfcDiagnosticAdminGenerationEvidence,
  mapAfcDiagnosticAdminSessionAttempt,
  mapAfcDiagnosticAdminSessionDetail,
  parseAfcDiagnosticAdminCaseDetailRecord,
  parseAfcDiagnosticAdminCaseListQuery,
  parseAfcDiagnosticAdminCaseListRecord,
  parseAfcDiagnosticAdminGenerationRecord,
  parseAfcDiagnosticAdminMembershipRecord,
  parseAfcDiagnosticAdminSessionRecord,
  parseAfcDiagnosticAdminSessionStatusRow,
  parseAfcDiagnosticAdminUuid,
  type AfcDiagnosticAdminCaseDetail,
  type AfcDiagnosticAdminCaseDetailRecord,
  type AfcDiagnosticAdminCaseListQuery,
  type AfcDiagnosticAdminCaseListRecord,
  type AfcDiagnosticAdminCaseListResult,
  type AfcDiagnosticAdminCaseSummary,
  type AfcDiagnosticAdminGenerationEvidence,
  type AfcDiagnosticAdminMembershipRecord,
  type AfcDiagnosticAdminSessionDetail,
  type AfcDiagnosticAdminSessionRecord,
  type AfcDiagnosticAdminSessionStatusRow,
} from "./admin-read-model";

export const AFC_GENERATION_TABLE = "vibode_afc_generations";

export const AFC_DIAGNOSTIC_ADMIN_CASE_LIST_COLUMNS = [
  "id",
  "submitted_at",
  "review_status",
  "trigger",
  "issue_codes",
  "taxonomy_version",
  "notes",
  "room_id",
  "session_id",
  "reported_generation_id",
  "machine_status_snapshot",
  "reporter_user_id",
].join(", ");

export const AFC_DIAGNOSTIC_ADMIN_CASE_DETAIL_COLUMNS = [
  AFC_DIAGNOSTIC_ADMIN_CASE_LIST_COLUMNS,
  "original_sha256",
  "original_identity",
  "reviewer_user_id",
  "review_notes",
  "reviewed_at",
].join(", ");

export const AFC_DIAGNOSTIC_ADMIN_SESSION_COLUMNS = [
  "id",
  "status",
  "room_id",
  "user_id",
  "original_sha256",
  "base_asset_id",
  "created_at",
  "updated_at",
].join(", ");

export const AFC_DIAGNOSTIC_ADMIN_SESSION_LIST_COLUMNS = "id, status";

export const AFC_DIAGNOSTIC_ADMIN_MEMBERSHIP_COLUMNS = [
  "session_id",
  "generation_id",
  "attempt_ordinal",
  "intent",
  "associated_at",
].join(", ");

export const AFC_DIAGNOSTIC_ADMIN_MEMBERSHIP_COUNT_COLUMNS = "session_id";

export const AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS = [
  "id",
  "room_id",
  "user_id",
  "parent_generation_id",
  "lineage_seq",
  "run_id",
  "intent",
  "status",
  "created_at",
  "completed_at",
  "frame_width",
  "frame_height",
  "failure_reason",
  "metric_status",
  "collision_status",
  "diagnostic_payload",
  "engine_fingerprint",
  "production_authority",
  "original_sha256",
  "original_decoded_width",
  "original_decoded_height",
  "original_byte_count",
  "original_mime_type",
  "original_orientation",
  "empty_sha256",
  "empty_artifact_source",
  "tiled_sha256",
  "tiled_artifact_source",
].join(", ");

type AdminReadFilter<S> = AfcDiagnosticFilterQuery<
  S,
  | "eq"
  | "in"
  | "contains"
  | "gte"
  | "lte"
  | "or"
  | "order"
  | "limit"
  | "maybeSingle"
> &
  AfcDiagnosticAwaitableQuery;

export type AfcDiagnosticAdminDbClient<
  S extends AdminReadFilter<S>,
> = AfcDiagnosticTableClient<AfcDiagnosticSelectHead<S>>;

export type AfcDiagnosticAdminReadStore = {
  listCases(
    query: AfcDiagnosticAdminCaseListQuery,
  ): Promise<readonly AfcDiagnosticAdminCaseListRecord[]>;
  findCaseById(caseId: string): Promise<AfcDiagnosticAdminCaseDetailRecord | null>;
  findSessionById(sessionId: string): Promise<AfcDiagnosticAdminSessionRecord | null>;
  listSessionStatusesByIds(
    sessionIds: readonly string[],
  ): Promise<readonly AfcDiagnosticAdminSessionStatusRow[]>;
  listMembershipSessionIds(
    sessionIds: readonly string[],
  ): Promise<readonly string[]>;
  listMembershipsBySessionId(
    sessionId: string,
  ): Promise<readonly AfcDiagnosticAdminMembershipRecord[]>;
  findGenerationById(
    generationId: string,
  ): Promise<AfcDiagnosticAdminGenerationEvidence | null>;
  listGenerationsByIds(
    generationIds: readonly string[],
  ): Promise<readonly AfcDiagnosticAdminGenerationEvidence[]>;
};

export class AfcDiagnosticAdminInputError extends Error {
  readonly code = "invalid_request" as const;
  constructor() {
    super("Invalid request.");
    this.name = "AfcDiagnosticAdminInputError";
  }
}

export class AfcDiagnosticAdminNotFoundError extends Error {
  readonly code = "not_found" as const;
  constructor() {
    super("Not found.");
    this.name = "AfcDiagnosticAdminNotFoundError";
  }
}

export class AfcDiagnosticAdminIntegrityError extends Error {
  readonly code = "integrity_failure" as const;
  constructor() {
    super("Server error.");
    this.name = "AfcDiagnosticAdminIntegrityError";
  }
}

export class AfcDiagnosticAdminStoreError extends Error {
  readonly code = "store_failed" as const;
  readonly causeCode?: string;
  constructor(causeCode?: string) {
    super("Server error.");
    this.name = "AfcDiagnosticAdminStoreError";
    this.causeCode = causeCode;
  }
}

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0) return code;
  if (typeof code === "number") return String(code);
  return undefined;
}

function throwStoreError(error: unknown): never {
  throw new AfcDiagnosticAdminStoreError(postgresCode(error) ?? "unknown");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- _label preserves call-site row identity while the stable error code intentionally remains `invalid_row`.
function requireMapped<T>(value: T | null, _label: string): T {
  if (!value) throw new AfcDiagnosticAdminStoreError("invalid_row");
  return value;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function quoteOrTimestamp(value: string): string {
  return `"${value}"`;
}

function keysetOrFilter(cursor: { submittedAt: string; id: string }): string {
  const submittedAt = quoteOrTimestamp(cursor.submittedAt);
  return `submitted_at.lt.${submittedAt},and(submitted_at.eq.${submittedAt},id.lt.${cursor.id})`;
}

function mapGenerationOrThrow(row: unknown): AfcDiagnosticAdminGenerationEvidence {
  const record = parseAfcDiagnosticAdminGenerationRecord(row);
  if (!record) throw new AfcDiagnosticAdminStoreError("invalid_generation");
  return mapAfcDiagnosticAdminGenerationEvidence(record);
}

export function createSupabaseAfcDiagnosticAdminReadStore<
  S extends AdminReadFilter<S>,
>(
  supabase: AfcDiagnosticAdminDbClient<S>,
): AfcDiagnosticAdminReadStore {
  return {
    async listCases(query) {
      let request = supabase
        .from(AFC_DIAGNOSTIC_CASE_TABLE)
        .select(AFC_DIAGNOSTIC_ADMIN_CASE_LIST_COLUMNS)
        .order("submitted_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(query.limit + 1);

      if (query.reviewStatus) {
        request = request.eq("review_status", query.reviewStatus);
      }
      if (query.trigger) {
        request = request.eq("trigger", query.trigger);
      }
      if (query.issueCode) {
        request = request.contains("issue_codes", [query.issueCode]);
      }
      if (query.machineStatusSnapshot) {
        request = request.eq(
          "machine_status_snapshot",
          query.machineStatusSnapshot,
        );
      }
      if (query.roomId) {
        request = request.eq("room_id", query.roomId);
      }
      if (query.submittedFrom) {
        request = request.gte("submitted_at", query.submittedFrom);
      }
      if (query.submittedTo) {
        request = request.lte("submitted_at", query.submittedTo);
      }
      if (query.cursor) {
        request = request.or(keysetOrFilter(query.cursor));
      }

      const { data, error } = await request;
      if (error) throwStoreError(error);
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row) =>
        requireMapped(parseAfcDiagnosticAdminCaseListRecord(row), "case"),
      );
    },

    async findCaseById(caseId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_CASE_TABLE)
        .select(AFC_DIAGNOSTIC_ADMIN_CASE_DETAIL_COLUMNS)
        .eq("id", caseId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(
        parseAfcDiagnosticAdminCaseDetailRecord(data),
        "case",
      );
    },

    async findSessionById(sessionId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_TABLE)
        .select(AFC_DIAGNOSTIC_ADMIN_SESSION_COLUMNS)
        .eq("id", sessionId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(parseAfcDiagnosticAdminSessionRecord(data), "session");
    },

    async listSessionStatusesByIds(sessionIds) {
      const ids = uniqueIds(sessionIds);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_TABLE)
        .select(AFC_DIAGNOSTIC_ADMIN_SESSION_LIST_COLUMNS)
        .in("id", ids);
      if (error) throwStoreError(error);
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row) =>
        requireMapped(parseAfcDiagnosticAdminSessionStatusRow(row), "session"),
      );
    },

    async listMembershipSessionIds(sessionIds) {
      const ids = uniqueIds(sessionIds);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE)
        .select(AFC_DIAGNOSTIC_ADMIN_MEMBERSHIP_COUNT_COLUMNS)
        .in("session_id", ids);
      if (error) throwStoreError(error);
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row) => {
        if (!row || typeof row !== "object") {
          throw new AfcDiagnosticAdminStoreError("invalid_membership");
        }
        const sessionId = (row as { session_id?: unknown }).session_id;
        if (typeof sessionId !== "string") {
          throw new AfcDiagnosticAdminStoreError("invalid_membership");
        }
        return sessionId.toLowerCase();
      });
    },

    async listMembershipsBySessionId(sessionId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE)
        .select(AFC_DIAGNOSTIC_ADMIN_MEMBERSHIP_COLUMNS)
        .eq("session_id", sessionId)
        .order("attempt_ordinal", { ascending: true });
      if (error) throwStoreError(error);
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row) =>
        requireMapped(
          parseAfcDiagnosticAdminMembershipRecord(row),
          "membership",
        ),
      );
    },

    async findGenerationById(generationId) {
      const { data, error } = await supabase
        .from(AFC_GENERATION_TABLE)
        .select(AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS)
        .eq("id", generationId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return mapGenerationOrThrow(data);
    },

    async listGenerationsByIds(generationIds) {
      const ids = uniqueIds(generationIds);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from(AFC_GENERATION_TABLE)
        .select(AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS)
        .in("id", ids);
      if (error) throwStoreError(error);
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row) => mapGenerationOrThrow(row));
    },
  };
}

function storeFromEnv(): AfcDiagnosticAdminReadStore {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    throw new AfcDiagnosticAdminStoreError("missing_service_role");
  }
  return createSupabaseAfcDiagnosticAdminReadStore(supabase);
}

function sessionAttemptCounts(sessionIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sessionId of sessionIds) {
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  }
  return counts;
}

export async function listAfcDiagnosticAdminCaseSummaries(
  store: AfcDiagnosticAdminReadStore,
  query: AfcDiagnosticAdminCaseListQuery,
): Promise<AfcDiagnosticAdminCaseListResult> {
  const rows = await store.listCases(query);
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  if (page.length === 0) {
    const empty = Object.freeze({
      items: Object.freeze([]) as readonly AfcDiagnosticAdminCaseSummary[],
      nextCursor: null,
    });
    assertAfcDiagnosticAdminPayloadPrivacy(empty);
    return empty;
  }

  const sessionIds = uniqueIds(page.map((row) => row.sessionId));
  const [sessions, membershipSessionIds] = await Promise.all([
    store.listSessionStatusesByIds(sessionIds),
    store.listMembershipSessionIds(sessionIds),
  ]);
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const attemptCounts = sessionAttemptCounts(membershipSessionIds);

  const items = page.map((caseRow) => {
    const session = sessionsById.get(caseRow.sessionId);
    if (!session) throw new AfcDiagnosticAdminIntegrityError();
    return mapAfcDiagnosticAdminCaseSummary({
      caseRow,
      sessionStatus: session.status,
      sessionAttemptCount: attemptCounts.get(caseRow.sessionId) ?? 0,
    });
  });

  const last = page[page.length - 1];
  const result = Object.freeze({
    items: Object.freeze(items),
    nextCursor: hasMore
      ? encodeAfcDiagnosticAdminCaseListCursor({
          submittedAt: last.submittedAt,
          id: last.id,
        })
      : null,
  });
  assertAfcDiagnosticAdminPayloadPrivacy(result);
  return result;
}

function assertCaseSessionIntegrity(
  caseRow: {
    sessionId: string;
    roomId: string;
    originalSha256: string;
  },
  session: AfcDiagnosticAdminSessionRecord,
): void {
  if (session.id !== caseRow.sessionId) {
    throw new AfcDiagnosticAdminIntegrityError();
  }
  if (session.roomId !== caseRow.roomId) {
    throw new AfcDiagnosticAdminIntegrityError();
  }
  if (session.originalSha256 !== caseRow.originalSha256) {
    throw new AfcDiagnosticAdminIntegrityError();
  }
}

function assertCaseGenerationIntegrity(input: {
  caseRow: {
    sessionId: string;
    roomId: string;
    originalSha256: string;
    reportedGenerationId: string;
  };
  session: AfcDiagnosticAdminSessionRecord;
  membership: AfcDiagnosticAdminMembershipRecord;
  generation: AfcDiagnosticAdminGenerationEvidence;
}): void {
  if (input.membership.generationId !== input.caseRow.reportedGenerationId) {
    throw new AfcDiagnosticAdminIntegrityError();
  }
  if (input.membership.sessionId !== input.caseRow.sessionId) {
    throw new AfcDiagnosticAdminIntegrityError();
  }
  if (input.generation.generationId !== input.caseRow.reportedGenerationId) {
    throw new AfcDiagnosticAdminIntegrityError();
  }
  if (input.generation.roomId !== input.caseRow.roomId) {
    throw new AfcDiagnosticAdminIntegrityError();
  }
  if (input.generation.userId !== input.session.userId) {
    throw new AfcDiagnosticAdminIntegrityError();
  }
  if (
    input.generation.original?.originalSha256 &&
    input.generation.original.originalSha256 !== input.caseRow.originalSha256
  ) {
    throw new AfcDiagnosticAdminIntegrityError();
  }
}

export async function getAfcDiagnosticAdminCaseDetail(
  store: AfcDiagnosticAdminReadStore,
  caseId: string,
): Promise<AfcDiagnosticAdminCaseDetail> {
  const caseRow = await store.findCaseById(caseId);
  if (!caseRow) throw new AfcDiagnosticAdminNotFoundError();

  const session = await store.findSessionById(caseRow.sessionId);
  if (!session) throw new AfcDiagnosticAdminIntegrityError();
  assertCaseSessionIntegrity(caseRow, session);

  const sessionMemberships = await store.listMembershipsBySessionId(session.id);
  const membership = sessionMemberships.find(
    (row) => row.generationId === caseRow.reportedGenerationId,
  );
  if (!membership) throw new AfcDiagnosticAdminIntegrityError();

  const generation = await store.findGenerationById(
    caseRow.reportedGenerationId,
  );
  if (!generation) throw new AfcDiagnosticAdminIntegrityError();
  assertCaseGenerationIntegrity({
    caseRow,
    session,
    membership,
    generation,
  });

  const detail = mapAfcDiagnosticAdminCaseDetail({
    caseRow,
    session,
    membership,
    generation,
    sessionAttemptCount: sessionMemberships.length,
  });
  assertAfcDiagnosticAdminPayloadPrivacy(detail);
  return detail;
}

export async function getAfcDiagnosticAdminSessionDetail(
  store: AfcDiagnosticAdminReadStore,
  sessionId: string,
): Promise<AfcDiagnosticAdminSessionDetail> {
  const session = await store.findSessionById(sessionId);
  if (!session) throw new AfcDiagnosticAdminNotFoundError();

  const memberships = [...(await store.listMembershipsBySessionId(session.id))]
    .sort((left, right) => left.attemptOrdinal - right.attemptOrdinal);

  const generationIds = memberships.map((membership) => membership.generationId);
  const generations = await store.listGenerationsByIds(generationIds);
  const generationsById = new Map(
    generations.map((generation) => [generation.generationId, generation]),
  );

  const attempts = memberships.map((membership) => {
    const generation = generationsById.get(membership.generationId);
    if (!generation) throw new AfcDiagnosticAdminIntegrityError();
    return mapAfcDiagnosticAdminSessionAttempt({ membership, generation });
  });

  const detail = mapAfcDiagnosticAdminSessionDetail({ session, attempts });
  assertAfcDiagnosticAdminPayloadPrivacy(detail);
  return detail;
}

function mapAdminHttpError(error: unknown) {
  if (error instanceof AfcDiagnosticAdminInputError) {
    return afcDiagnosticsAdminJson({ error: "Invalid request." }, 400);
  }
  if (error instanceof AfcDiagnosticAdminNotFoundError) {
    return afcDiagnosticsAdminJson({ error: "Not found." }, 404);
  }
  return afcDiagnosticsAdminJson({ error: "Server error." }, 500);
}

export type AfcDiagnosticAdminRouteDependencies = Readonly<{
  authorize?: (
    options?: AuthorizeAfcDiagnosticsAdminOptions,
  ) => Promise<AfcDiagnosticsAdminAuth>;
  store?: AfcDiagnosticAdminReadStore;
  getStore?: () => AfcDiagnosticAdminReadStore | null;
  authorizeOptions?: AuthorizeAfcDiagnosticsAdminOptions;
}>;

function resolveStore(
  dependencies: AfcDiagnosticAdminRouteDependencies,
): AfcDiagnosticAdminReadStore {
  if (dependencies.store) return dependencies.store;
  if (dependencies.getStore) {
    const store = dependencies.getStore();
    if (!store) throw new AfcDiagnosticAdminStoreError("missing_service_role");
    return store;
  }
  return storeFromEnv();
}

async function authorizeOrReject(
  dependencies: AfcDiagnosticAdminRouteDependencies,
): Promise<AfcDiagnosticsAdminAuth> {
  const authorize = dependencies.authorize ?? authorizeAfcDiagnosticsAdmin;
  return authorize(dependencies.authorizeOptions);
}

export async function handleAfcDiagnosticsAdminCasesGet(args: {
  request: Request;
} & AfcDiagnosticAdminRouteDependencies) {
  try {
    const auth = await authorizeOrReject(args);
    if (!auth.ok) return auth.response;
    const parsed = parseAfcDiagnosticAdminCaseListQuery(
      new URL(args.request.url).searchParams,
    );
    if (!parsed.ok) throw new AfcDiagnosticAdminInputError();
    const store = resolveStore(args);
    const result = await listAfcDiagnosticAdminCaseSummaries(
      store,
      parsed.value,
    );
    return afcDiagnosticsAdminJson(result, 200);
  } catch (error) {
    return mapAdminHttpError(error);
  }
}

export async function handleAfcDiagnosticsAdminCaseDetailGet(args: {
  request: Request;
  caseId: string;
} & AfcDiagnosticAdminRouteDependencies) {
  try {
    const auth = await authorizeOrReject(args);
    if (!auth.ok) return auth.response;
    const caseId = parseAfcDiagnosticAdminUuid(args.caseId);
    if (!caseId) throw new AfcDiagnosticAdminInputError();
    const store = resolveStore(args);
    const detail = await getAfcDiagnosticAdminCaseDetail(store, caseId);
    return afcDiagnosticsAdminJson(detail, 200);
  } catch (error) {
    return mapAdminHttpError(error);
  }
}

export async function handleAfcDiagnosticsAdminSessionDetailGet(args: {
  request: Request;
  sessionId: string;
} & AfcDiagnosticAdminRouteDependencies) {
  try {
    const auth = await authorizeOrReject(args);
    if (!auth.ok) return auth.response;
    const sessionId = parseAfcDiagnosticAdminUuid(args.sessionId);
    if (!sessionId) throw new AfcDiagnosticAdminInputError();
    const store = resolveStore(args);
    const detail = await getAfcDiagnosticAdminSessionDetail(store, sessionId);
    return afcDiagnosticsAdminJson(detail, 200);
  } catch (error) {
    return mapAdminHttpError(error);
  }
}
