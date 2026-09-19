import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import {
  parseUuid,
  productionAfcJson,
  type ProductionAfcAuth,
} from "@/lib/afc-v2-production/production-http";

import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_NOTES_MAX_CHARS,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
  isAfcDiagnosticMachineStatusSnapshot,
  type AfcDiagnosticOriginalIdentity,
  type AfcDiagnosticSessionRecord,
} from "./contracts";
import {
  resolveAfcQaCapability,
  type AfcQaCapabilityEnv,
} from "./qa-capability.server";
import {
  AFC_GENERATION_TABLE,
  getAfcDiagnosticRetryEpisodeSignal,
  type AfcDiagnosticRetryEpisodeSignal,
  type AfcDiagnosticRetryEpisodeStore,
} from "./retry-episode-signal.server";
import {
  isPostgresUniqueViolation,
  parseAfcOriginalSha256,
} from "./session-lifecycle.server";
import {
  AFC_QA_ISSUE_TAXONOMY_VERSION,
  validateAfcQaIssueTaxonomy,
  type AfcQaIssueCode,
} from "./taxonomy";

/**
 * AFD-3A tester Diagnostic Case submission.
 *
 * Server-only. Creates a Case only from an explicit tester submit.
 * Does not close Sessions, mutate AFC, or expose Session internals.
 */

export const AFC_ROOM_TABLE = "vibode_rooms";

export const AFC_DIAGNOSTIC_TESTER_CASE_TRIGGERS = [
  "manual_report",
  "repeated_unsuccessful",
] as const;

export type AfcDiagnosticTesterCaseTrigger =
  (typeof AFC_DIAGNOSTIC_TESTER_CASE_TRIGGERS)[number];

const TESTER_TRIGGER_SET: ReadonlySet<string> = new Set(
  AFC_DIAGNOSTIC_TESTER_CASE_TRIGGERS,
);

const ROOM_COLUMNS = "id, user_id";
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
const SESSION_COLUMNS =
  "id, room_id, user_id, original_sha256, base_asset_id, status, created_at, updated_at";
const MEMBERSHIP_COLUMNS = "session_id, generation_id";
const TESTER_CASE_LOOKUP_COLUMNS =
  "id, reporter_user_id, reported_generation_id, trigger, issue_codes, notes";

export type AfcDiagnosticTesterCaseSubmitInput = {
  userId: unknown;
  roomId: unknown;
  generationId: unknown;
  issueCodes: unknown;
  notes?: unknown;
  trigger: unknown;
};

export type AfcDiagnosticTesterCaseSubmitResult = {
  submitted: true;
  idempotent: boolean;
};

export type AfcDiagnosticGenerationEvidence = {
  id: string;
  userId: string;
  roomId: string;
  status: string;
  originalSha256: string | null;
  originalDecodedWidth: number | null;
  originalDecodedHeight: number | null;
  originalByteCount: number | null;
  originalMimeType: string | null;
  originalOrientation: number | null;
};

export type AfcDiagnosticTesterCaseLookup = {
  id: string;
  reporterUserId: string;
  reportedGenerationId: string;
  trigger: string;
  issueCodes: readonly string[];
  notes: string | null;
};

export type AfcDiagnosticTesterCaseInsert = {
  sessionId: string;
  roomId: string;
  reporterUserId: string;
  reportedGenerationId: string;
  originalSha256: string;
  originalIdentity: AfcDiagnosticOriginalIdentity | null;
  taxonomyVersion: string;
  issueCodes: readonly AfcQaIssueCode[];
  notes: string | null;
  trigger: AfcDiagnosticTesterCaseTrigger;
  machineStatusSnapshot: "ready" | "failed";
};

export type AfcDiagnosticTesterCaseStore = {
  findRoom(roomId: string): Promise<{ id: string; userId: string } | null>;
  findGenerationEvidence(
    generationId: string,
  ): Promise<AfcDiagnosticGenerationEvidence | null>;
  findMembershipByGenerationId(
    generationId: string,
  ): Promise<{ sessionId: string; generationId: string } | null>;
  findSessionById(sessionId: string): Promise<AfcDiagnosticSessionRecord | null>;
  findTesterCase(input: {
    reporterUserId: string;
    reportedGenerationId: string;
  }): Promise<AfcDiagnosticTesterCaseLookup | null>;
  insertTesterCase(
    input: AfcDiagnosticTesterCaseInsert,
  ): Promise<{ ok: true } | { ok: false; code: "unique_tester_conflict" }>;
};

export type AfcDiagnosticTesterCaseDbClient = {
  from: (table: string) => any;
};

export type AfcDiagnosticTesterCaseOptions = {
  env?: AfcQaCapabilityEnv | NodeJS.ProcessEnv;
  store?: AfcDiagnosticTesterCaseStore;
  retryStore?: AfcDiagnosticRetryEpisodeStore;
  retrySignal?: typeof getAfcDiagnosticRetryEpisodeSignal;
};

export class AfcDiagnosticTesterCaseInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AfcDiagnosticTesterCaseInputError";
    this.code = code;
  }
}

export class AfcDiagnosticTesterCaseQaDisabledError extends Error {
  readonly code = "qa_disabled" as const;
  constructor() {
    super("AFC QA is not available.");
    this.name = "AfcDiagnosticTesterCaseQaDisabledError";
  }
}

export class AfcDiagnosticTesterCaseRoomError extends Error {
  readonly code: "room_not_found" | "room_ownership_mismatch";
  constructor(
    code: AfcDiagnosticTesterCaseRoomError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AfcDiagnosticTesterCaseRoomError";
    this.code = code;
  }
}

export class AfcDiagnosticTesterCaseGenerationError extends Error {
  readonly code:
    | "generation_unavailable"
    | "generation_ineligible"
    | "generation_ownership_mismatch"
    | "generation_room_mismatch";
  constructor(
    code: AfcDiagnosticTesterCaseGenerationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AfcDiagnosticTesterCaseGenerationError";
    this.code = code;
  }
}

export class AfcDiagnosticTesterCaseMembershipError extends Error {
  readonly code = "membership_missing" as const;
  constructor() {
    super("Diagnostic session membership is not available.");
    this.name = "AfcDiagnosticTesterCaseMembershipError";
  }
}

export class AfcDiagnosticTesterCaseSessionError extends Error {
  readonly code:
    | "session_not_found"
    | "session_user_mismatch"
    | "session_room_mismatch"
    | "session_sha_mismatch"
    | "session_closed";
  constructor(
    code: AfcDiagnosticTesterCaseSessionError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AfcDiagnosticTesterCaseSessionError";
    this.code = code;
  }
}

export class AfcDiagnosticTesterCaseTaxonomyError extends Error {
  readonly code:
    | "empty_codes"
    | "unknown_code"
    | "invalid_codes"
    | "notes_too_long"
    | "invalid_notes";
  constructor(
    code: AfcDiagnosticTesterCaseTaxonomyError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AfcDiagnosticTesterCaseTaxonomyError";
    this.code = code;
  }
}

export class AfcDiagnosticTesterCaseTriggerError extends Error {
  readonly code = "repeated_unsuccessful_ineligible" as const;
  constructor() {
    super("repeated_unsuccessful is not eligible for this generation.");
    this.name = "AfcDiagnosticTesterCaseTriggerError";
  }
}

export class AfcDiagnosticTesterCaseStoreError extends Error {
  readonly code = "store_failed" as const;
  readonly causeCode?: string;
  constructor(message: string, causeCode?: string) {
    super(message);
    this.name = "AfcDiagnosticTesterCaseStoreError";
    this.causeCode = causeCode;
  }
}

function requireUuid(value: unknown, code: string, label: string): string {
  const id = parseUuid(value);
  if (!id) {
    throw new AfcDiagnosticTesterCaseInputError(code, `Invalid ${label}.`);
  }
  return id.toLowerCase();
}

function parseTesterTrigger(value: unknown): AfcDiagnosticTesterCaseTrigger {
  if (value === "admin_capture") {
    throw new AfcDiagnosticTesterCaseInputError(
      "admin_capture_rejected",
      "admin_capture is not allowed on the tester Case path.",
    );
  }
  if (typeof value !== "string" || !TESTER_TRIGGER_SET.has(value)) {
    throw new AfcDiagnosticTesterCaseInputError(
      "invalid_trigger",
      "Invalid trigger.",
    );
  }
  return value as AfcDiagnosticTesterCaseTrigger;
}

function parseNotes(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new AfcDiagnosticTesterCaseTaxonomyError(
      "invalid_notes",
      "Invalid notes.",
    );
  }
  const notes = value.trim();
  if (notes.length === 0) return null;
  if (notes.length > AFC_DIAGNOSTIC_NOTES_MAX_CHARS) {
    throw new AfcDiagnosticTesterCaseTaxonomyError(
      "notes_too_long",
      "Notes exceed the maximum length.",
    );
  }
  return notes;
}

function parseIssueCodes(value: unknown): readonly AfcQaIssueCode[] {
  const taxonomy = validateAfcQaIssueTaxonomy({
    version: AFC_QA_ISSUE_TAXONOMY_VERSION,
    codes: value,
  });
  if (!taxonomy.ok) {
    throw new AfcDiagnosticTesterCaseTaxonomyError(
      taxonomy.reason === "unknown_taxonomy_version"
        ? "invalid_codes"
        : taxonomy.reason,
      "Invalid issue codes.",
    );
  }
  const seen = new Set<AfcQaIssueCode>();
  const codes: AfcQaIssueCode[] = [];
  for (const code of taxonomy.codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0) return code;
  if (typeof code === "number") return String(code);
  return undefined;
}

function throwStoreError(error: unknown): never {
  throw new AfcDiagnosticTesterCaseStoreError(
    `Diagnostic case store failed (${postgresCode(error) ?? "unknown"}).`,
    postgresCode(error),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapRoom(row: unknown): { id: string; userId: string } | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (typeof row.user_id !== "string") return null;
  return { id: row.id.toLowerCase(), userId: row.user_id.toLowerCase() };
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

function mapTesterCase(row: unknown): AfcDiagnosticTesterCaseLookup | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (typeof row.reporter_user_id !== "string") return null;
  if (typeof row.reported_generation_id !== "string") return null;
  if (typeof row.trigger !== "string") return null;
  if (!Array.isArray(row.issue_codes)) return null;
  if (row.notes != null && typeof row.notes !== "string") return null;
  return {
    id: row.id.toLowerCase(),
    reporterUserId: row.reporter_user_id.toLowerCase(),
    reportedGenerationId: row.reported_generation_id.toLowerCase(),
    trigger: row.trigger,
    issueCodes: row.issue_codes.map((code) => String(code)),
    notes: row.notes ?? null,
  };
}

function requireMapped<T>(value: T | null, label: string): T {
  if (!value) {
    throw new AfcDiagnosticTesterCaseStoreError(
      `Diagnostic case store failed (invalid ${label}).`,
    );
  }
  return value;
}

function optionalPositiveInt(value: number | null): number | undefined {
  return value != null && Number.isInteger(value) && value > 0 ? value : undefined;
}

function optionalNonNegativeInt(value: number | null): number | undefined {
  return value != null && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function optionalMime(value: string | null): string | undefined {
  if (value == null) return undefined;
  const mime = value.trim();
  return mime.length > 0 ? mime : undefined;
}

function optionalOrientation(value: number | null): number | undefined {
  return value != null && Number.isInteger(value) ? value : undefined;
}

export function buildAfcDiagnosticOriginalIdentity(input: {
  generation: AfcDiagnosticGenerationEvidence;
  session: AfcDiagnosticSessionRecord;
}): AfcDiagnosticOriginalIdentity | null {
  const identity: {
    decodedWidth?: number;
    decodedHeight?: number;
    byteCount?: number;
    mimeType?: string;
    orientation?: number;
    baseAssetId?: string;
  } = {};
  const decodedWidth = optionalPositiveInt(input.generation.originalDecodedWidth);
  const decodedHeight = optionalPositiveInt(
    input.generation.originalDecodedHeight,
  );
  const byteCount = optionalNonNegativeInt(input.generation.originalByteCount);
  const mimeType = optionalMime(input.generation.originalMimeType);
  const orientation = optionalOrientation(input.generation.originalOrientation);
  const baseAssetId = parseUuid(input.session.baseAssetId)?.toLowerCase();
  if (decodedWidth != null) identity.decodedWidth = decodedWidth;
  if (decodedHeight != null) identity.decodedHeight = decodedHeight;
  if (byteCount != null) identity.byteCount = byteCount;
  if (mimeType != null) identity.mimeType = mimeType;
  if (orientation != null) identity.orientation = orientation;
  if (baseAssetId) identity.baseAssetId = baseAssetId;
  return Object.keys(identity).length > 0 ? Object.freeze(identity) : null;
}

export function isRepeatedUnsuccessfulEligible(
  signal: AfcDiagnosticRetryEpisodeSignal,
  generationId: string,
): boolean {
  const latest = signal.latestAttempt;
  return (
    signal.attemptCount >= 2 &&
    latest != null &&
    latest.generationId === generationId &&
    latest.machineStatus === "failed"
  );
}

export function createSupabaseAfcDiagnosticTesterCaseStore(
  supabase: AfcDiagnosticTesterCaseDbClient,
): AfcDiagnosticTesterCaseStore {
  return {
    async findRoom(roomId) {
      const { data, error } = await supabase
        .from(AFC_ROOM_TABLE)
        .select(ROOM_COLUMNS)
        .eq("id", roomId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(mapRoom(data), "room");
    },

    async findGenerationEvidence(generationId) {
      const { data, error } = await supabase
        .from(AFC_GENERATION_TABLE)
        .select(GENERATION_EVIDENCE_COLUMNS)
        .eq("id", generationId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(mapGeneration(data), "generation");
    },

    async findMembershipByGenerationId(generationId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE)
        .select(MEMBERSHIP_COLUMNS)
        .eq("generation_id", generationId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(mapMembership(data), "membership");
    },

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

    async findTesterCase(input) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_CASE_TABLE)
        .select(TESTER_CASE_LOOKUP_COLUMNS)
        .eq("reporter_user_id", input.reporterUserId)
        .eq("reported_generation_id", input.reportedGenerationId)
        .in("trigger", [...AFC_DIAGNOSTIC_TESTER_CASE_TRIGGERS])
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(mapTesterCase(data), "case");
    },

    async insertTesterCase(input) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_CASE_TABLE)
        .insert({
          session_id: input.sessionId,
          room_id: input.roomId,
          reporter_user_id: input.reporterUserId,
          reported_generation_id: input.reportedGenerationId,
          original_sha256: input.originalSha256,
          original_identity: input.originalIdentity,
          taxonomy_version: input.taxonomyVersion,
          issue_codes: [...input.issueCodes],
          notes: input.notes,
          trigger: input.trigger,
          machine_status_snapshot: input.machineStatusSnapshot,
        })
        .select("id")
        .maybeSingle();
      if (isPostgresUniqueViolation(error)) {
        return { ok: false, code: "unique_tester_conflict" };
      }
      if (error || data == null) throwStoreError(error ?? { code: "empty_insert" });
      return { ok: true };
    },
  };
}

function storeFromEnv(): AfcDiagnosticTesterCaseStore {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    throw new AfcDiagnosticTesterCaseStoreError(
      "Diagnostic case store failed (missing service role).",
      "missing_service_role",
    );
  }
  return createSupabaseAfcDiagnosticTesterCaseStore(supabase);
}

function freezeSubmitted(): { submitted: true } {
  const payload = Object.freeze({ submitted: true as const });
  assertProductionPayloadPrivacy(payload);
  return payload;
}

function mapPublicTesterCaseError(error: unknown) {
  if (error instanceof AfcDiagnosticTesterCaseQaDisabledError) {
    return productionAfcJson({ error: "Not available." }, 404);
  }
  if (error instanceof AfcDiagnosticTesterCaseInputError) {
    return productionAfcJson({ error: "Invalid request." }, 400);
  }
  if (error instanceof AfcDiagnosticTesterCaseTaxonomyError) {
    return productionAfcJson({ error: "Invalid request." }, 400);
  }
  if (error instanceof AfcDiagnosticTesterCaseRoomError) {
    return productionAfcJson({ error: "Room not found." }, 404);
  }
  if (
    error instanceof AfcDiagnosticTesterCaseGenerationError ||
    error instanceof AfcDiagnosticTesterCaseMembershipError ||
    error instanceof AfcDiagnosticTesterCaseSessionError ||
    error instanceof AfcDiagnosticTesterCaseTriggerError
  ) {
    return productionAfcJson({ error: "Not available." }, 404);
  }
  return productionAfcJson({ error: "Server misconfigured." }, 500);
}

export async function submitAfcDiagnosticTesterCase(
  input: AfcDiagnosticTesterCaseSubmitInput,
  options: AfcDiagnosticTesterCaseOptions = {},
): Promise<AfcDiagnosticTesterCaseSubmitResult> {
  const userId = requireUuid(input.userId, "invalid_user_id", "userId");
  const capability = resolveAfcQaCapability(
    userId,
    options.env ?? process.env,
  );
  if (!capability.enabled) {
    throw new AfcDiagnosticTesterCaseQaDisabledError();
  }

  const roomId = requireUuid(input.roomId, "invalid_room_id", "roomId");
  const generationId = requireUuid(
    input.generationId,
    "invalid_generation_id",
    "generationId",
  );
  const trigger = parseTesterTrigger(input.trigger);
  const issueCodes = parseIssueCodes(input.issueCodes);
  const notes = parseNotes(input.notes);

  const store = options.store ?? storeFromEnv();
  const room = await store.findRoom(roomId);
  if (!room) {
    throw new AfcDiagnosticTesterCaseRoomError(
      "room_not_found",
      "Room not found.",
    );
  }
  if (room.userId !== userId) {
    throw new AfcDiagnosticTesterCaseRoomError(
      "room_ownership_mismatch",
      "Room not found.",
    );
  }

  const generation = await store.findGenerationEvidence(generationId);
  if (!generation) {
    throw new AfcDiagnosticTesterCaseGenerationError(
      "generation_unavailable",
      "Generation is not available.",
    );
  }
  if (generation.userId !== userId) {
    throw new AfcDiagnosticTesterCaseGenerationError(
      "generation_ownership_mismatch",
      "Generation is not available.",
    );
  }
  if (generation.roomId !== roomId) {
    throw new AfcDiagnosticTesterCaseGenerationError(
      "generation_room_mismatch",
      "Generation is not available.",
    );
  }
  if (
    !isAfcDiagnosticMachineStatusSnapshot(generation.status) ||
    generation.status === "running"
  ) {
    throw new AfcDiagnosticTesterCaseGenerationError(
      "generation_ineligible",
      "Generation is not eligible.",
    );
  }
  const originalSha256 = parseAfcOriginalSha256(generation.originalSha256);
  if (!originalSha256) {
    throw new AfcDiagnosticTesterCaseGenerationError(
      "generation_ineligible",
      "Generation is not eligible.",
    );
  }

  const membership = await store.findMembershipByGenerationId(generationId);
  if (!membership) {
    throw new AfcDiagnosticTesterCaseMembershipError();
  }

  const session = await store.findSessionById(membership.sessionId);
  if (!session) {
    throw new AfcDiagnosticTesterCaseSessionError(
      "session_not_found",
      "Diagnostic session is not available.",
    );
  }
  if (session.userId !== userId) {
    throw new AfcDiagnosticTesterCaseSessionError(
      "session_user_mismatch",
      "Diagnostic session is not available.",
    );
  }
  if (session.roomId !== roomId) {
    throw new AfcDiagnosticTesterCaseSessionError(
      "session_room_mismatch",
      "Diagnostic session is not available.",
    );
  }
  if (session.originalSha256 !== originalSha256) {
    throw new AfcDiagnosticTesterCaseSessionError(
      "session_sha_mismatch",
      "Diagnostic session is not available.",
    );
  }
  if (session.status !== "open") {
    throw new AfcDiagnosticTesterCaseSessionError(
      "session_closed",
      "Diagnostic session is not available.",
    );
  }

  if (trigger === "repeated_unsuccessful") {
    const retrySignal = options.retrySignal ?? getAfcDiagnosticRetryEpisodeSignal;
    const signal = await retrySignal(
      { sessionId: session.id, userId },
      options.retryStore ? { store: options.retryStore } : {},
    );
    if (!isRepeatedUnsuccessfulEligible(signal, generationId)) {
      throw new AfcDiagnosticTesterCaseTriggerError();
    }
  }

  const existing = await store.findTesterCase({
    reporterUserId: userId,
    reportedGenerationId: generationId,
  });
  if (existing) {
    return { submitted: true, idempotent: true };
  }

  const inserted = await store.insertTesterCase({
    sessionId: session.id,
    roomId,
    reporterUserId: userId,
    reportedGenerationId: generationId,
    originalSha256,
    originalIdentity: buildAfcDiagnosticOriginalIdentity({
      generation,
      session,
    }),
    taxonomyVersion: AFC_QA_ISSUE_TAXONOMY_VERSION,
    issueCodes,
    notes,
    trigger,
    machineStatusSnapshot: generation.status,
  });
  if (!inserted.ok) {
    const raced = await store.findTesterCase({
      reporterUserId: userId,
      reportedGenerationId: generationId,
    });
    if (raced) return { submitted: true, idempotent: true };
    throw new AfcDiagnosticTesterCaseStoreError(
      "Diagnostic case store failed (unique_tester_conflict).",
      "unique_tester_conflict",
    );
  }
  return { submitted: true, idempotent: false };
}

export async function handleAfcQaTesterCasePost(args: {
  request: Request;
  authorize: (request: Request) => Promise<ProductionAfcAuth>;
  env?: AfcQaCapabilityEnv | NodeJS.ProcessEnv;
  store?: AfcDiagnosticTesterCaseStore;
  retryStore?: AfcDiagnosticRetryEpisodeStore;
  retrySignal?: typeof getAfcDiagnosticRetryEpisodeSignal;
}) {
  const auth = await args.authorize(args.request);
  if (!auth.ok) return auth.response;

  const body = await args.request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return productionAfcJson({ error: "Invalid request." }, 400);
  }
  const record = body as Record<string, unknown>;

  try {
    await submitAfcDiagnosticTesterCase(
      {
        userId: auth.userId,
        roomId: record.roomId,
        generationId: record.generationId,
        issueCodes: record.issueCodes,
        notes: record.notes,
        trigger: record.trigger,
      },
      {
        env: args.env ?? process.env,
        store: args.store,
        retryStore: args.retryStore,
        retrySignal: args.retrySignal,
      },
    );
    return productionAfcJson(freezeSubmitted(), 200);
  } catch (error) {
    return mapPublicTesterCaseError(error);
  }
}
