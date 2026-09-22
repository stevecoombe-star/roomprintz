import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import {
  parseUuid,
  productionAfcJson,
  type ProductionAfcAuth,
} from "@/lib/afc-v2-production/production-http";

import {
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
  type AfcDiagnosticSessionRecord,
} from "./contracts";
import {
  type AfcDiagnosticAwaitableQuery,
  type AfcDiagnosticFilterQuery,
  type AfcDiagnosticSelectHead,
  type AfcDiagnosticTableClient,
} from "./diagnostic-db-client";
import {
  resolveAfcQaCapability,
  type AfcQaCapabilityEnv,
} from "./qa-capability.server";
import {
  AFC_GENERATION_TABLE,
  getAfcDiagnosticRetryEpisodeSignal,
  type AfcDiagnosticRetryEpisodeStore,
} from "./retry-episode-signal.server";
import { parseAfcOriginalSha256 } from "./session-lifecycle.server";

/**
 * AFD-3D QA READY rerun authorization.
 *
 * Server-only. Decides whether a tester may request another AFC room read
 * against the current READY generation. Does not create generations,
 * Sessions, membership, or Cases. The HTTP handler invokes injected
 * production analyze orchestration with a fixed intent of `run_again`.
 */

export const AFC_ROOM_TABLE = "vibode_rooms";
export const AFC_QA_READY_RERUN_INTENT = "run_again" as const;

const ROOM_COLUMNS = "id, user_id";
const GENERATION_COLUMNS = "id, user_id, room_id, status, original_sha256";
const SESSION_COLUMNS =
  "id, room_id, user_id, original_sha256, base_asset_id, status, created_at, updated_at";
const MEMBERSHIP_COLUMNS = "session_id, generation_id";
const OPEN_SESSION_COLUMNS = "id";

export type AfcQaReadyRerunIntent = typeof AFC_QA_READY_RERUN_INTENT;

export type AfcQaReadyRerunInput = {
  userId: unknown;
  roomId: unknown;
  generationId: unknown;
};

export type AfcQaReadyRerunAuthorized = {
  userId: string;
  roomId: string;
  generationId: string;
  intent: AfcQaReadyRerunIntent;
};

export type AfcQaReadyRerunGeneration = {
  id: string;
  userId: string;
  roomId: string;
  status: string;
  originalSha256: string | null;
};

export type AfcQaReadyRerunStore = {
  findRoom(roomId: string): Promise<{ id: string; userId: string } | null>;
  findGeneration(
    generationId: string,
  ): Promise<AfcQaReadyRerunGeneration | null>;
  findMembershipByGenerationId(
    generationId: string,
  ): Promise<{ sessionId: string; generationId: string } | null>;
  findSessionById(sessionId: string): Promise<AfcDiagnosticSessionRecord | null>;
  listOpenSessionsByUserAndRoom(input: {
    userId: string;
    roomId: string;
  }): Promise<readonly { id: string }[]>;
};

type QaReadyRerunFilter<S> = AfcDiagnosticFilterQuery<S, "eq" | "maybeSingle"> &
  AfcDiagnosticAwaitableQuery;

export type AfcQaReadyRerunDbClient<
  S extends QaReadyRerunFilter<S>,
> = AfcDiagnosticTableClient<AfcDiagnosticSelectHead<S>>;

export type AfcQaReadyRerunAnalysisResult = {
  status: "ready" | "failed" | "none";
  generationId: string | null;
  currentGenerationId: string | null;
  authority: unknown;
  failureReason: string | null;
  frame: unknown;
};

export type AfcQaReadyRerunStartInput = {
  userId: string;
  roomId: string;
  intent: AfcQaReadyRerunIntent;
};

export type AfcQaReadyRerunOptions = {
  env?: AfcQaCapabilityEnv | NodeJS.ProcessEnv;
  store?: AfcQaReadyRerunStore;
  retryStore?: AfcDiagnosticRetryEpisodeStore;
  retrySignal?: typeof getAfcDiagnosticRetryEpisodeSignal;
};

export class AfcQaReadyRerunInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AfcQaReadyRerunInputError";
    this.code = code;
  }
}

export class AfcQaReadyRerunQaDisabledError extends Error {
  readonly code = "qa_disabled" as const;
  constructor() {
    super("AFC QA is not available.");
    this.name = "AfcQaReadyRerunQaDisabledError";
  }
}

export class AfcQaReadyRerunRoomError extends Error {
  readonly code: "room_not_found" | "room_ownership_mismatch";
  constructor(code: AfcQaReadyRerunRoomError["code"], message: string) {
    super(message);
    this.name = "AfcQaReadyRerunRoomError";
    this.code = code;
  }
}

export class AfcQaReadyRerunGenerationError extends Error {
  readonly code:
    | "generation_unavailable"
    | "generation_ineligible"
    | "generation_ownership_mismatch"
    | "generation_room_mismatch"
    | "generation_not_current";
  constructor(
    code: AfcQaReadyRerunGenerationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AfcQaReadyRerunGenerationError";
    this.code = code;
  }
}

export class AfcQaReadyRerunMembershipError extends Error {
  readonly code = "membership_missing" as const;
  constructor() {
    super("Diagnostic session membership is not available.");
    this.name = "AfcQaReadyRerunMembershipError";
  }
}

export class AfcQaReadyRerunSessionError extends Error {
  readonly code:
    | "session_not_found"
    | "session_user_mismatch"
    | "session_room_mismatch"
    | "session_sha_mismatch"
    | "session_closed"
    | "session_not_current";
  constructor(code: AfcQaReadyRerunSessionError["code"], message: string) {
    super(message);
    this.name = "AfcQaReadyRerunSessionError";
    this.code = code;
  }
}

export class AfcQaReadyRerunIntegrityError extends Error {
  readonly code = "multiple_open_sessions" as const;
  constructor(message: string) {
    super(message);
    this.name = "AfcQaReadyRerunIntegrityError";
  }
}

export class AfcQaReadyRerunStoreError extends Error {
  readonly code = "store_failed" as const;
  readonly causeCode?: string;
  constructor(message: string, causeCode?: string) {
    super(message);
    this.name = "AfcQaReadyRerunStoreError";
    this.code = "store_failed";
    this.causeCode = causeCode;
  }
}

function requireUuid(value: unknown, code: string, label: string): string {
  const id = parseUuid(value);
  if (!id) {
    throw new AfcQaReadyRerunInputError(code, `Invalid ${label}.`);
  }
  return id.toLowerCase();
}

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0) return code;
  if (typeof code === "number") return String(code);
  return undefined;
}

function throwStoreError(error: unknown): never {
  throw new AfcQaReadyRerunStoreError(
    `Diagnostic QA rerun store failed (${postgresCode(error) ?? "unknown"}).`,
    postgresCode(error),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mapRoom(row: unknown): { id: string; userId: string } | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (typeof row.user_id !== "string") return null;
  return { id: row.id.toLowerCase(), userId: row.user_id.toLowerCase() };
}

function mapGeneration(row: unknown): AfcQaReadyRerunGeneration | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (typeof row.user_id !== "string") return null;
  if (typeof row.room_id !== "string") return null;
  if (typeof row.status !== "string") return null;
  if (row.original_sha256 != null && typeof row.original_sha256 !== "string") {
    return null;
  }
  return {
    id: row.id.toLowerCase(),
    userId: row.user_id.toLowerCase(),
    roomId: row.room_id.toLowerCase(),
    status: row.status,
    originalSha256:
      typeof row.original_sha256 === "string" ? row.original_sha256 : null,
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

function mapOpenSession(row: unknown): { id: string } | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  return { id: row.id.toLowerCase() };
}

function requireMapped<T>(value: T | null, label: string): T {
  if (!value) {
    throw new AfcQaReadyRerunStoreError(
      `Diagnostic QA rerun store failed (invalid ${label}).`,
    );
  }
  return value;
}

export function createSupabaseAfcQaReadyRerunStore<
  S extends QaReadyRerunFilter<S>,
>(
  supabase: AfcQaReadyRerunDbClient<S>,
): AfcQaReadyRerunStore {
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

    async findGeneration(generationId) {
      const { data, error } = await supabase
        .from(AFC_GENERATION_TABLE)
        .select(GENERATION_COLUMNS)
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

    async listOpenSessionsByUserAndRoom(input) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_TABLE)
        .select(OPEN_SESSION_COLUMNS)
        .eq("user_id", input.userId)
        .eq("room_id", input.roomId)
        .eq("status", "open");
      if (error) throwStoreError(error);
      if (!Array.isArray(data)) {
        throwStoreError({ code: "invalid_open_session_rows" });
      }
      return data.map((row) => requireMapped(mapOpenSession(row), "session"));
    },
  };
}

function storeFromEnv(): AfcQaReadyRerunStore {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    throw new AfcQaReadyRerunStoreError(
      "Diagnostic QA rerun store failed (missing service role).",
      "missing_service_role",
    );
  }
  return createSupabaseAfcQaReadyRerunStore(supabase);
}

export async function authorizeAfcQaReadyRerun(
  input: AfcQaReadyRerunInput,
  options: AfcQaReadyRerunOptions = {},
): Promise<AfcQaReadyRerunAuthorized> {
  const userId = requireUuid(input.userId, "invalid_user_id", "userId");
  const capability = resolveAfcQaCapability(
    userId,
    options.env ?? process.env,
  );
  if (!capability.enabled) {
    throw new AfcQaReadyRerunQaDisabledError();
  }

  const roomId = requireUuid(input.roomId, "invalid_room_id", "roomId");
  const generationId = requireUuid(
    input.generationId,
    "invalid_generation_id",
    "generationId",
  );

  const store = options.store ?? storeFromEnv();
  const room = await store.findRoom(roomId);
  if (!room) {
    throw new AfcQaReadyRerunRoomError("room_not_found", "Room not found.");
  }
  if (room.userId !== userId) {
    throw new AfcQaReadyRerunRoomError(
      "room_ownership_mismatch",
      "Room not found.",
    );
  }

  const generation = await store.findGeneration(generationId);
  if (!generation) {
    throw new AfcQaReadyRerunGenerationError(
      "generation_unavailable",
      "Generation is not available.",
    );
  }
  if (generation.userId !== userId) {
    throw new AfcQaReadyRerunGenerationError(
      "generation_ownership_mismatch",
      "Generation is not available.",
    );
  }
  if (generation.roomId !== roomId) {
    throw new AfcQaReadyRerunGenerationError(
      "generation_room_mismatch",
      "Generation is not available.",
    );
  }
  if (generation.status !== "ready") {
    throw new AfcQaReadyRerunGenerationError(
      "generation_ineligible",
      "Generation is not eligible.",
    );
  }
  const originalSha256 = parseAfcOriginalSha256(generation.originalSha256);
  if (!originalSha256) {
    throw new AfcQaReadyRerunGenerationError(
      "generation_ineligible",
      "Generation is not eligible.",
    );
  }

  const membership = await store.findMembershipByGenerationId(generationId);
  if (!membership) {
    throw new AfcQaReadyRerunMembershipError();
  }

  const session = await store.findSessionById(membership.sessionId);
  if (!session) {
    throw new AfcQaReadyRerunSessionError(
      "session_not_found",
      "Diagnostic session is not available.",
    );
  }
  if (session.userId !== userId) {
    throw new AfcQaReadyRerunSessionError(
      "session_user_mismatch",
      "Diagnostic session is not available.",
    );
  }
  if (session.roomId !== roomId) {
    throw new AfcQaReadyRerunSessionError(
      "session_room_mismatch",
      "Diagnostic session is not available.",
    );
  }
  if (session.originalSha256 !== originalSha256) {
    throw new AfcQaReadyRerunSessionError(
      "session_sha_mismatch",
      "Diagnostic session is not available.",
    );
  }
  if (session.status !== "open") {
    throw new AfcQaReadyRerunSessionError(
      "session_closed",
      "Diagnostic session is not available.",
    );
  }

  const openSessions = await store.listOpenSessionsByUserAndRoom({
    userId,
    roomId,
  });
  if (openSessions.length === 0) {
    throw new AfcQaReadyRerunSessionError(
      "session_not_current",
      "Diagnostic session is not available.",
    );
  }
  if (openSessions.length > 1) {
    throw new AfcQaReadyRerunIntegrityError(
      "Multiple open diagnostic sessions for this room.",
    );
  }
  if (openSessions[0]!.id !== session.id) {
    throw new AfcQaReadyRerunSessionError(
      "session_not_current",
      "Diagnostic session is not available.",
    );
  }

  const retrySignal = options.retrySignal ?? getAfcDiagnosticRetryEpisodeSignal;
  const signal = await retrySignal(
    { sessionId: session.id, userId },
    options.retryStore ? { store: options.retryStore } : {},
  );
  const latest = signal.latestAttempt;
  if (
    signal.sessionStatus !== "open" ||
    latest == null ||
    latest.generationId !== generationId ||
    latest.machineStatus !== "ready"
  ) {
    throw new AfcQaReadyRerunGenerationError(
      "generation_not_current",
      "Generation is not eligible.",
    );
  }

  return {
    userId,
    roomId,
    generationId,
    intent: AFC_QA_READY_RERUN_INTENT,
  };
}

function freezeAnalysisResult(
  result: AfcQaReadyRerunAnalysisResult,
): AfcQaReadyRerunAnalysisResult {
  const payload = Object.freeze({
    status: result.status,
    generationId: result.generationId,
    currentGenerationId: result.currentGenerationId,
    authority: result.authority,
    failureReason: result.failureReason,
    frame: result.frame,
  });
  assertProductionPayloadPrivacy(payload);
  return payload;
}

function mapPublicQaReadyRerunError(error: unknown) {
  if (error instanceof AfcQaReadyRerunQaDisabledError) {
    return productionAfcJson({ error: "Not available." }, 404);
  }
  if (error instanceof AfcQaReadyRerunInputError) {
    return productionAfcJson({ error: "Invalid request." }, 400);
  }
  if (error instanceof AfcQaReadyRerunRoomError) {
    return productionAfcJson({ error: "Room not found." }, 404);
  }
  if (
    error instanceof AfcQaReadyRerunGenerationError ||
    error instanceof AfcQaReadyRerunMembershipError ||
    error instanceof AfcQaReadyRerunSessionError
  ) {
    return productionAfcJson({ error: "Not available." }, 404);
  }
  return productionAfcJson({ error: "Server misconfigured." }, 500);
}

export async function handleAfcQaReadyRerunPost(args: {
  request: Request;
  authorize: (request: Request) => Promise<ProductionAfcAuth>;
  startProductionAnalysis: (
    input: AfcQaReadyRerunStartInput,
  ) => Promise<AfcQaReadyRerunAnalysisResult>;
  env?: AfcQaCapabilityEnv | NodeJS.ProcessEnv;
  store?: AfcQaReadyRerunStore;
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
    const authorized = await authorizeAfcQaReadyRerun(
      {
        userId: auth.userId,
        roomId: record.roomId,
        generationId: record.generationId,
      },
      {
        env: args.env ?? process.env,
        store: args.store,
        retryStore: args.retryStore,
        retrySignal: args.retrySignal,
      },
    );
    const result = await args.startProductionAnalysis({
      userId: authorized.userId,
      roomId: authorized.roomId,
      intent: AFC_QA_READY_RERUN_INTENT,
    });
    if (result.status === "failed" && result.generationId === null) {
      return productionAfcJson(
        { error: result.failureReason ?? "AFC analysis failed." },
        404,
      );
    }
    return productionAfcJson(
      freezeAnalysisResult(result),
      result.status === "ready" ? 200 : 422,
    );
  } catch (error) {
    return mapPublicQaReadyRerunError(error);
  }
}
