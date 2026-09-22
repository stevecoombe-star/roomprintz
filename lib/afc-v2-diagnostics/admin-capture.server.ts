import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import {
  afcDiagnosticsAdminJson,
  authorizeAfcDiagnosticsAdmin,
  type AfcDiagnosticsAdminAuth,
  type AuthorizeAfcDiagnosticsAdminOptions,
} from "./admin-auth.server";
import {
  parseAfcDiagnosticAdminCaptureRequest,
  AFC_DIAGNOSTIC_ADMIN_CAPTURE_TRIGGER,
  isAfcDiagnosticAdminCaptureGenerationStatusEligible,
  type AfcDiagnosticAdminCaptureRequest,
} from "./admin-capture";
import {
  assertAfcDiagnosticAdminPayloadPrivacy,
  parseAfcDiagnosticAdminUuid,
  type AfcDiagnosticAdminCaseDetail,
} from "./admin-read-model";
import {
  AFC_GENERATION_TABLE,
  AfcDiagnosticAdminInputError,
  AfcDiagnosticAdminNotFoundError,
  AfcDiagnosticAdminStoreError,
  createSupabaseAfcDiagnosticAdminReadStore,
  getAfcDiagnosticAdminCaseDetail,
  type AfcDiagnosticAdminReadStore,
} from "./admin-read-model.server";
import {
  type AfcDiagnosticFilterQuery,
  type AfcDiagnosticInsertQuery,
  type AfcDiagnosticSelectHead,
  type AfcDiagnosticTableClient,
} from "./diagnostic-db-client";
import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
  type AfcDiagnosticOriginalIdentity,
  type AfcDiagnosticSessionRecord,
} from "./contracts";
import { parseAfcOriginalSha256 } from "./session-lifecycle.server";
import {
  buildAfcDiagnosticOriginalIdentity,
  type AfcDiagnosticGenerationEvidence,
} from "./submit-tester-case.server";
import { AFC_QA_ISSUE_TAXONOMY_VERSION, type AfcQaIssueCode } from "./taxonomy";

export const AFC_DIAGNOSTIC_ADMIN_CAPTURE_INSERT_COLUMNS = [
  "session_id",
  "room_id",
  "reporter_user_id",
  "reported_generation_id",
  "original_sha256",
  "original_identity",
  "taxonomy_version",
  "issue_codes",
  "notes",
  "trigger",
  "machine_status_snapshot",
] as const;

const SESSION_COLUMNS =
  "id, room_id, user_id, original_sha256, base_asset_id, status, created_at, updated_at";
const MEMBERSHIP_COLUMNS = "session_id, generation_id";
const GENERATION_EVIDENCE_COLUMNS = [
  "id",
  "user_id",
  "room_id",
  "status",
  "original_sha256",
  "original_decoded_width",
  "original_decoded_height",
  "original_byte_count",
  "original_mime_type",
  "original_orientation",
].join(", ");

export type AfcDiagnosticAdminCaptureInsert = Readonly<{
  session_id: string;
  room_id: string;
  reporter_user_id: string;
  reported_generation_id: string;
  original_sha256: string;
  original_identity: AfcDiagnosticOriginalIdentity | null;
  taxonomy_version: string;
  issue_codes: readonly AfcQaIssueCode[];
  notes: string | null;
  trigger: typeof AFC_DIAGNOSTIC_ADMIN_CAPTURE_TRIGGER;
  machine_status_snapshot: "ready" | "failed";
}>;

export type AfcDiagnosticAdminCaptureStore = {
  findSessionById(sessionId: string): Promise<AfcDiagnosticSessionRecord | null>;
  findMembership(
    sessionId: string,
    generationId: string,
  ): Promise<{ sessionId: string; generationId: string } | null>;
  findGenerationById(
    generationId: string,
  ): Promise<AfcDiagnosticGenerationEvidence | null>;
  insertAdminCaptureCase(input: AfcDiagnosticAdminCaptureInsert): Promise<string>;
};

export type AfcDiagnosticAdminCaptureRouteDependencies = Readonly<{
  authorize?: (
    options?: AuthorizeAfcDiagnosticsAdminOptions,
  ) => Promise<AfcDiagnosticsAdminAuth>;
  authorizeOptions?: AuthorizeAfcDiagnosticsAdminOptions;
  captureStore?: AfcDiagnosticAdminCaptureStore;
  readStore?: AfcDiagnosticAdminReadStore;
  getCaptureStore?: () => AfcDiagnosticAdminCaptureStore | null;
  getReadStore?: () => AfcDiagnosticAdminReadStore | null;
}>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapSession(row: unknown): AfcDiagnosticSessionRecord | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (typeof row.room_id !== "string") return null;
  if (typeof row.user_id !== "string") return null;
  if (typeof row.original_sha256 !== "string") return null;
  if (row.status !== "open" && row.status !== "closed") return null;
  if (typeof row.created_at !== "string") return null;
  if (typeof row.updated_at !== "string") return null;
  if (row.base_asset_id != null && typeof row.base_asset_id !== "string") {
    return null;
  }
  return {
    id: row.id.toLowerCase(),
    roomId: row.room_id.toLowerCase(),
    userId: row.user_id.toLowerCase(),
    originalSha256: row.original_sha256.toLowerCase(),
    baseAssetId: row.base_asset_id ? row.base_asset_id.toLowerCase() : null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMembership(
  row: unknown,
): { sessionId: string; generationId: string } | null {
  if (!isRecord(row)) return null;
  if (typeof row.session_id !== "string") return null;
  if (typeof row.generation_id !== "string") return null;
  return {
    sessionId: row.session_id.toLowerCase(),
    generationId: row.generation_id.toLowerCase(),
  };
}

function mapGeneration(row: unknown): AfcDiagnosticGenerationEvidence | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (typeof row.user_id !== "string") return null;
  if (typeof row.room_id !== "string") return null;
  if (typeof row.status !== "string") return null;
  if (row.original_sha256 != null && typeof row.original_sha256 !== "string") {
    return null;
  }
  if (row.original_mime_type != null && typeof row.original_mime_type !== "string") {
    return null;
  }
  return {
    id: row.id.toLowerCase(),
    userId: row.user_id.toLowerCase(),
    roomId: row.room_id.toLowerCase(),
    status: row.status,
    originalSha256:
      typeof row.original_sha256 === "string" ? row.original_sha256 : null,
    originalDecodedWidth: optionalNumber(row.original_decoded_width),
    originalDecodedHeight: optionalNumber(row.original_decoded_height),
    originalByteCount: optionalNumber(row.original_byte_count),
    originalMimeType:
      typeof row.original_mime_type === "string" ? row.original_mime_type : null,
    originalOrientation: optionalNumber(row.original_orientation),
  };
}

function requireMapped<T>(value: T | null, _label: string): T {
  if (!value) throw new AfcDiagnosticAdminStoreError("invalid_row");
  return value;
}

type AdminCaptureFilter<S> = AfcDiagnosticFilterQuery<S, "eq" | "maybeSingle">;

export function createSupabaseAfcDiagnosticAdminCaptureStore<
  S extends AdminCaptureFilter<S>,
>(
  supabase: AfcDiagnosticTableClient<
    AfcDiagnosticSelectHead<S> & {
      insert(values: Record<string, unknown>): AfcDiagnosticInsertQuery;
    }
  >,
): AfcDiagnosticAdminCaptureStore {
  return {
    async findSessionById(sessionId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_TABLE)
        .select(SESSION_COLUMNS)
        .eq("id", sessionId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(mapSession(data), "session");
    },

    async findMembership(sessionId, generationId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE)
        .select(MEMBERSHIP_COLUMNS)
        .eq("session_id", sessionId)
        .eq("generation_id", generationId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(mapMembership(data), "membership");
    },

    async findGenerationById(generationId) {
      const { data, error } = await supabase
        .from(AFC_GENERATION_TABLE)
        .select(GENERATION_EVIDENCE_COLUMNS)
        .eq("id", generationId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(mapGeneration(data), "generation");
    },

    async insertAdminCaptureCase(input) {
      const payload = {
        session_id: input.session_id,
        room_id: input.room_id,
        reporter_user_id: input.reporter_user_id,
        reported_generation_id: input.reported_generation_id,
        original_sha256: input.original_sha256,
        original_identity: input.original_identity,
        taxonomy_version: input.taxonomy_version,
        issue_codes: [...input.issue_codes],
        notes: input.notes,
        trigger: input.trigger,
        machine_status_snapshot: input.machine_status_snapshot,
      };
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_CASE_TABLE)
        .insert(payload)
        .select("id")
        .maybeSingle();
      if (error || data == null) throwStoreError(error ?? { code: "empty_insert" });
      const caseId = parseAfcDiagnosticAdminUuid(
        isRecord(data) ? data.id : null,
      );
      if (!caseId) throw new AfcDiagnosticAdminStoreError("invalid_insert_id");
      return caseId;
    },
  };
}

function storesFromEnv(): {
  captureStore: AfcDiagnosticAdminCaptureStore;
  readStore: AfcDiagnosticAdminReadStore;
} {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    throw new AfcDiagnosticAdminStoreError("missing_service_role");
  }
  return {
    captureStore: createSupabaseAfcDiagnosticAdminCaptureStore(supabase),
    readStore: createSupabaseAfcDiagnosticAdminReadStore(supabase),
  };
}

function resolveStores(
  dependencies: AfcDiagnosticAdminCaptureRouteDependencies,
): {
  captureStore: AfcDiagnosticAdminCaptureStore;
  readStore: AfcDiagnosticAdminReadStore;
} {
  if (dependencies.captureStore && dependencies.readStore) {
    return {
      captureStore: dependencies.captureStore,
      readStore: dependencies.readStore,
    };
  }
  if (dependencies.getCaptureStore || dependencies.getReadStore) {
    const captureStore = dependencies.getCaptureStore?.() ?? null;
    const readStore = dependencies.getReadStore?.() ?? null;
    if (!captureStore || !readStore) {
      throw new AfcDiagnosticAdminStoreError("missing_service_role");
    }
    return { captureStore, readStore };
  }
  return storesFromEnv();
}

async function authorizeOrReject(
  dependencies: AfcDiagnosticAdminCaptureRouteDependencies,
): Promise<AfcDiagnosticsAdminAuth> {
  const authorize = dependencies.authorize ?? authorizeAfcDiagnosticsAdmin;
  return authorize(dependencies.authorizeOptions);
}

async function readJsonBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false };
  }
}

function mapCaptureHttpError(error: unknown) {
  if (error instanceof AfcDiagnosticAdminInputError) {
    return afcDiagnosticsAdminJson({ error: "Invalid request." }, 400);
  }
  if (error instanceof AfcDiagnosticAdminNotFoundError) {
    return afcDiagnosticsAdminJson({ error: "Not found." }, 404);
  }
  return afcDiagnosticsAdminJson({ error: "Server error." }, 500);
}

export function deriveAfcDiagnosticAdminCaptureInsert(input: {
  session: AfcDiagnosticSessionRecord;
  generation: AfcDiagnosticGenerationEvidence;
  request: AfcDiagnosticAdminCaptureRequest;
  originalSha256: string;
}): AfcDiagnosticAdminCaptureInsert {
  if (
    !isAfcDiagnosticAdminCaptureGenerationStatusEligible(input.generation.status)
  ) {
    throw new AfcDiagnosticAdminNotFoundError();
  }
  return Object.freeze({
    session_id: input.session.id,
    room_id: input.session.roomId,
    reporter_user_id: input.session.userId,
    reported_generation_id: input.generation.id,
    original_sha256: input.originalSha256,
    original_identity: buildAfcDiagnosticOriginalIdentity({
      generation: input.generation,
      session: input.session,
    }),
    taxonomy_version: AFC_QA_ISSUE_TAXONOMY_VERSION,
    issue_codes: input.request.issueCodes,
    notes: input.request.notes ?? null,
    trigger: AFC_DIAGNOSTIC_ADMIN_CAPTURE_TRIGGER,
    machine_status_snapshot: input.generation.status,
  });
}

export async function handleAfcDiagnosticsAdminCapturePost(
  args: {
    request: Request;
    sessionId: string;
  } & AfcDiagnosticAdminCaptureRouteDependencies,
): Promise<Response> {
  try {
    const auth = await authorizeOrReject(args);
    if (!auth.ok) return auth.response;

    const sessionId = parseAfcDiagnosticAdminUuid(args.sessionId);
    if (!sessionId) throw new AfcDiagnosticAdminInputError();

    const raw = await readJsonBody(args.request);
    if (!raw.ok) throw new AfcDiagnosticAdminInputError();
    const parsed = parseAfcDiagnosticAdminCaptureRequest(raw.value);
    if (!parsed.ok) throw new AfcDiagnosticAdminInputError();

    const stores = resolveStores(args);
    const session = await stores.captureStore.findSessionById(sessionId);
    if (!session) throw new AfcDiagnosticAdminNotFoundError();

    const membership = await stores.captureStore.findMembership(
      session.id,
      parsed.value.generationId,
    );
    if (!membership) throw new AfcDiagnosticAdminNotFoundError();

    const generation = await stores.captureStore.findGenerationById(
      membership.generationId,
    );
    if (!generation) throw new AfcDiagnosticAdminNotFoundError();

    if (generation.roomId !== session.roomId) {
      throw new AfcDiagnosticAdminNotFoundError();
    }
    if (generation.userId !== session.userId) {
      throw new AfcDiagnosticAdminNotFoundError();
    }

    const originalSha256 = parseAfcOriginalSha256(generation.originalSha256);
    if (!originalSha256) throw new AfcDiagnosticAdminNotFoundError();
    const sessionSha = parseAfcOriginalSha256(session.originalSha256);
    if (!sessionSha || sessionSha !== originalSha256) {
      throw new AfcDiagnosticAdminNotFoundError();
    }

    if (!isAfcDiagnosticAdminCaptureGenerationStatusEligible(generation.status)) {
      throw new AfcDiagnosticAdminNotFoundError();
    }

    const insert = deriveAfcDiagnosticAdminCaptureInsert({
      session,
      generation,
      request: parsed.value,
      originalSha256,
    });
    const caseId = await stores.captureStore.insertAdminCaptureCase(insert);
    const detail: AfcDiagnosticAdminCaseDetail =
      await getAfcDiagnosticAdminCaseDetail(stores.readStore, caseId);
    assertAfcDiagnosticAdminPayloadPrivacy(detail);
    return afcDiagnosticsAdminJson(detail, 201);
  } catch (error) {
    return mapCaptureHttpError(error);
  }
}
