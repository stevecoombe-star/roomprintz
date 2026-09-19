import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import {
  parseUuid,
  productionAfcJson,
  type ProductionAfcAuth,
} from "@/lib/afc-v2-production/production-http";

import { AFC_DIAGNOSTIC_SESSION_TABLE } from "./contracts";
import {
  resolveAfcQaCapability,
  type AfcQaCapabilityEnv,
} from "./qa-capability.server";
import {
  getAfcDiagnosticRetryEpisodeSignal,
  type AfcDiagnosticRetryEpisodeSignal,
  type AfcDiagnosticRetryEpisodeStore,
} from "./retry-episode-signal.server";

/**
 * AFD-3B browser-safe QA state.
 *
 * Read-only projection for the future tester UI. Does not create Cases,
 * mutate Sessions, or expose retry-episode internals.
 *
 * Capability-first: if QA is disabled, return the disabled public state
 * without room or diagnostic reads. That avoids a room/diagnostic oracle
 * for ineligible users. Invalid `roomId` format is still a 400 request
 * error. Owned-room existence is checked only after capability is on,
 * using the same missing/unowned 404 wording as production AFC / AFD-3A.
 *
 * Current open Session is the unique open Diagnostic Session for
 * authenticated user + room. AFD-2A closes stale same-user/room Sessions
 * on source-sha change, so a healthy room has at most one open Session.
 * Multiple open Sessions are treated as integrity failure, not "latest
 * created_at wins."
 */

export const AFC_ROOM_TABLE = "vibode_rooms";

const ROOM_COLUMNS = "id, user_id";
const OPEN_SESSION_COLUMNS = "id";

export type AfcDiagnosticBrowserQaState = {
  enabled: boolean;
  canReport: boolean;
  offerFeedback: boolean;
  reportGenerationId: string | null;
};

export type AfcDiagnosticBrowserQaStateInput = {
  userId: unknown;
  roomId: unknown;
};

export type AfcDiagnosticBrowserQaStateStore = {
  findRoom(roomId: string): Promise<{ id: string; userId: string } | null>;
  listOpenSessionsByUserAndRoom(input: {
    userId: string;
    roomId: string;
  }): Promise<readonly { id: string }[]>;
};

export type AfcDiagnosticBrowserQaStateDbClient = {
  from: (table: string) => any;
};

export type AfcDiagnosticBrowserQaStateOptions = {
  env?: AfcQaCapabilityEnv | NodeJS.ProcessEnv;
  store?: AfcDiagnosticBrowserQaStateStore;
  retryStore?: AfcDiagnosticRetryEpisodeStore;
  retrySignal?: typeof getAfcDiagnosticRetryEpisodeSignal;
};

export class AfcDiagnosticBrowserQaStateInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AfcDiagnosticBrowserQaStateInputError";
    this.code = code;
  }
}

export class AfcDiagnosticBrowserQaStateRoomError extends Error {
  readonly code: "room_not_found" | "room_ownership_mismatch";
  constructor(
    code: AfcDiagnosticBrowserQaStateRoomError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AfcDiagnosticBrowserQaStateRoomError";
    this.code = code;
  }
}

export class AfcDiagnosticBrowserQaStateIntegrityError extends Error {
  readonly code = "multiple_open_sessions" as const;
  constructor(message: string) {
    super(message);
    this.name = "AfcDiagnosticBrowserQaStateIntegrityError";
  }
}

export class AfcDiagnosticBrowserQaStateStoreError extends Error {
  readonly code = "store_failed" as const;
  readonly causeCode?: string;
  constructor(message: string, causeCode?: string) {
    super(message);
    this.name = "AfcDiagnosticBrowserQaStateStoreError";
    this.causeCode = causeCode;
  }
}

function requireUuid(value: unknown, code: string, label: string): string {
  const id = parseUuid(value);
  if (!id) {
    throw new AfcDiagnosticBrowserQaStateInputError(code, `Invalid ${label}.`);
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
  throw new AfcDiagnosticBrowserQaStateStoreError(
    `Diagnostic browser QA state store failed (${postgresCode(error) ?? "unknown"}).`,
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

function mapOpenSession(row: unknown): { id: string } | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  return { id: row.id.toLowerCase() };
}

function requireMapped<T>(value: T | null, label: string): T {
  if (!value) {
    throw new AfcDiagnosticBrowserQaStateStoreError(
      `Diagnostic browser QA state store failed (invalid ${label}).`,
    );
  }
  return value;
}

export function createSupabaseAfcDiagnosticBrowserQaStateStore(
  supabase: AfcDiagnosticBrowserQaStateDbClient,
): AfcDiagnosticBrowserQaStateStore {
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

function storeFromEnv(): AfcDiagnosticBrowserQaStateStore {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    throw new AfcDiagnosticBrowserQaStateStoreError(
      "Diagnostic browser QA state store failed (missing service role).",
      "missing_service_role",
    );
  }
  return createSupabaseAfcDiagnosticBrowserQaStateStore(supabase);
}

function disabledState(): AfcDiagnosticBrowserQaState {
  return {
    enabled: false,
    canReport: false,
    offerFeedback: false,
    reportGenerationId: null,
  };
}

function idleEnabledState(): AfcDiagnosticBrowserQaState {
  return {
    enabled: true,
    canReport: false,
    offerFeedback: false,
    reportGenerationId: null,
  };
}

function isTerminalMachineStatus(status: string): status is "ready" | "failed" {
  return status === "ready" || status === "failed";
}

export function projectAfcDiagnosticBrowserQaState(
  signal: AfcDiagnosticRetryEpisodeSignal,
): AfcDiagnosticBrowserQaState {
  if (signal.sessionStatus !== "open") return idleEnabledState();

  const latest = signal.latestAttempt;
  if (!latest) return idleEnabledState();

  const canReport = isTerminalMachineStatus(latest.machineStatus);
  const offerFeedback =
    latest.machineStatus === "failed" && signal.attemptCount >= 2;

  return {
    enabled: true,
    canReport,
    offerFeedback,
    reportGenerationId: canReport ? latest.generationId : null,
  };
}

export function freezeAfcDiagnosticBrowserQaState(
  state: AfcDiagnosticBrowserQaState,
): AfcDiagnosticBrowserQaState {
  const payload = Object.freeze({
    enabled: Boolean(state.enabled),
    canReport: Boolean(state.canReport),
    offerFeedback: Boolean(state.offerFeedback),
    reportGenerationId:
      typeof state.reportGenerationId === "string"
        ? state.reportGenerationId
        : null,
  });
  assertProductionPayloadPrivacy(payload);
  return payload;
}

export async function getAfcDiagnosticBrowserQaState(
  input: AfcDiagnosticBrowserQaStateInput,
  options: AfcDiagnosticBrowserQaStateOptions = {},
): Promise<AfcDiagnosticBrowserQaState> {
  const userId = requireUuid(input.userId, "invalid_user_id", "userId");
  const roomId = requireUuid(input.roomId, "invalid_room_id", "roomId");
  const capability = resolveAfcQaCapability(
    userId,
    options.env ?? process.env,
  );
  if (!capability.enabled) return disabledState();

  const store = options.store ?? storeFromEnv();
  const room = await store.findRoom(roomId);
  if (!room) {
    throw new AfcDiagnosticBrowserQaStateRoomError(
      "room_not_found",
      "Room not found.",
    );
  }
  if (room.userId !== userId) {
    throw new AfcDiagnosticBrowserQaStateRoomError(
      "room_ownership_mismatch",
      "Room not found.",
    );
  }

  const openSessions = await store.listOpenSessionsByUserAndRoom({
    userId,
    roomId,
  });
  if (openSessions.length === 0) return idleEnabledState();
  if (openSessions.length > 1) {
    throw new AfcDiagnosticBrowserQaStateIntegrityError(
      "Multiple open diagnostic sessions for this room.",
    );
  }

  const retrySignal = options.retrySignal ?? getAfcDiagnosticRetryEpisodeSignal;
  const signal = await retrySignal(
    { sessionId: openSessions[0]!.id, userId },
    options.retryStore ? { store: options.retryStore } : {},
  );
  return projectAfcDiagnosticBrowserQaState(signal);
}

function mapPublicBrowserQaStateError(error: unknown) {
  if (error instanceof AfcDiagnosticBrowserQaStateInputError) {
    return productionAfcJson({ error: "Invalid request." }, 400);
  }
  if (error instanceof AfcDiagnosticBrowserQaStateRoomError) {
    return productionAfcJson({ error: "Room not found." }, 404);
  }
  return productionAfcJson({ error: "Server misconfigured." }, 500);
}

export async function handleAfcQaBrowserStateGet(args: {
  request: Request;
  authorize: (request: Request) => Promise<ProductionAfcAuth>;
  env?: AfcQaCapabilityEnv | NodeJS.ProcessEnv;
  store?: AfcDiagnosticBrowserQaStateStore;
  retryStore?: AfcDiagnosticRetryEpisodeStore;
  retrySignal?: typeof getAfcDiagnosticRetryEpisodeSignal;
}) {
  const auth = await args.authorize(args.request);
  if (!auth.ok) return auth.response;

  const roomId = parseUuid(new URL(args.request.url).searchParams.get("roomId"));
  if (!roomId) {
    return productionAfcJson({ error: "Invalid request." }, 400);
  }

  try {
    const state = await getAfcDiagnosticBrowserQaState(
      { userId: auth.userId, roomId },
      {
        env: args.env ?? process.env,
        store: args.store,
        retryStore: args.retryStore,
        retrySignal: args.retrySignal,
      },
    );
    return productionAfcJson(freezeAfcDiagnosticBrowserQaState(state), 200);
  } catch (error) {
    return mapPublicBrowserQaStateError(error);
  }
}
