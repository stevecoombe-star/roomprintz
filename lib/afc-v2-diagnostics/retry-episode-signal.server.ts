import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { parseUuid } from "@/lib/afc-v2-production/production-http";

import {
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
  isAfcDiagnosticMachineStatusSnapshot,
  isAfcDiagnosticSessionIntent,
  type AfcDiagnosticSessionIntent,
  type AfcDiagnosticSessionStatus,
} from "./contracts";

/**
 * AFD-2C Diagnostic Session retry-episode signal.
 *
 * Read-only derivation of compact machine facts for one Diagnostic Session.
 * Does not infer tester dissatisfaction, open/close Sessions, write
 * membership, touch Cases, or expose a browser route.
 *
 * Latest attempt is MAX(attempt_ordinal) over Session membership, not
 * lineage_seq, created_at, READY authority, or the current AFC pointer.
 *
 * Membership is append-only. This snapshot reads memberships first, then
 * generation statuses. A concurrent insert may produce a slightly stale
 * snapshot; that is acceptable without a transaction.
 */

export const AFC_GENERATION_TABLE = "vibode_afc_generations";

const SESSION_SIGNAL_COLUMNS = "id, user_id, status";
const MEMBERSHIP_SIGNAL_COLUMNS =
  "session_id, generation_id, attempt_ordinal, intent";
const GENERATION_SIGNAL_COLUMNS = "id, status";

export type AfcDiagnosticRetryEpisodeMachineStatus =
  "running" | "ready" | "failed";

export type AfcDiagnosticRetryEpisodeLatestAttempt = {
  generationId: string;
  attemptOrdinal: number;
  intent: AfcDiagnosticSessionIntent;
  machineStatus: AfcDiagnosticRetryEpisodeMachineStatus;
};

export type AfcDiagnosticRetryEpisodeSignal = {
  sessionId: string;
  sessionStatus: AfcDiagnosticSessionStatus;
  attemptCount: number;
  latestAttempt: AfcDiagnosticRetryEpisodeLatestAttempt | null;
  hasMultipleAttempts: boolean;
  hasFailedAttempt: boolean;
  hasReadyAttempt: boolean;
};

export type AfcDiagnosticRetryEpisodeSignalInput = {
  sessionId: unknown;
  userId: unknown;
};

export type AfcDiagnosticRetryEpisodeSessionRow = {
  id: string;
  userId: string;
  status: AfcDiagnosticSessionStatus;
};

export type AfcDiagnosticRetryEpisodeMembershipRow = {
  sessionId: string;
  generationId: string;
  attemptOrdinal: number;
  intent: AfcDiagnosticSessionIntent;
};

export type AfcDiagnosticRetryEpisodeGenerationStatusRow = {
  id: string;
  status: AfcDiagnosticRetryEpisodeMachineStatus;
};

export type AfcDiagnosticRetryEpisodeStore = {
  findSessionById(
    sessionId: string,
  ): Promise<AfcDiagnosticRetryEpisodeSessionRow | null>;
  listMembershipsBySessionId(
    sessionId: string,
  ): Promise<AfcDiagnosticRetryEpisodeMembershipRow[]>;
  listGenerationMachineStatuses(
    generationIds: readonly string[],
  ): Promise<AfcDiagnosticRetryEpisodeGenerationStatusRow[]>;
};

export type AfcDiagnosticRetryEpisodeDbClient = {
  from: (table: string) => any;
};

export type AfcDiagnosticRetryEpisodeSignalOptions = {
  store?: AfcDiagnosticRetryEpisodeStore;
};

export class AfcDiagnosticRetryEpisodeInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AfcDiagnosticRetryEpisodeInputError";
    this.code = code;
  }
}

export class AfcDiagnosticRetryEpisodeNotFoundError extends Error {
  readonly code = "session_not_found" as const;
  constructor(message: string) {
    super(message);
    this.name = "AfcDiagnosticRetryEpisodeNotFoundError";
  }
}

export class AfcDiagnosticRetryEpisodeOwnershipError extends Error {
  readonly code = "ownership_mismatch" as const;
  constructor(message: string) {
    super(message);
    this.name = "AfcDiagnosticRetryEpisodeOwnershipError";
  }
}

export class AfcDiagnosticRetryEpisodeIntegrityError extends Error {
  readonly code:
    | "missing_generation"
    | "duplicate_attempt_ordinal"
    | "invalid_machine_status";
  constructor(
    code: AfcDiagnosticRetryEpisodeIntegrityError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AfcDiagnosticRetryEpisodeIntegrityError";
    this.code = code;
  }
}

export class AfcDiagnosticRetryEpisodeStoreError extends Error {
  readonly code = "store_failed" as const;
  readonly causeCode?: string;
  constructor(message: string, causeCode?: string) {
    super(message);
    this.name = "AfcDiagnosticRetryEpisodeStoreError";
    this.causeCode = causeCode;
  }
}

function requireUuid(value: unknown, code: string, label: string): string {
  const id = parseUuid(value);
  if (!id) {
    throw new AfcDiagnosticRetryEpisodeInputError(code, `Invalid ${label}.`);
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
  throw new AfcDiagnosticRetryEpisodeStoreError(
    `Diagnostic retry-episode store failed (${postgresCode(error) ?? "unknown"}).`,
    postgresCode(error),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mapSession(row: unknown): AfcDiagnosticRetryEpisodeSessionRow | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (typeof row.user_id !== "string") return null;
  if (row.status !== "open" && row.status !== "closed") return null;
  return {
    id: row.id.toLowerCase(),
    userId: row.user_id.toLowerCase(),
    status: row.status,
  };
}

function mapMembership(
  row: unknown,
): AfcDiagnosticRetryEpisodeMembershipRow | null {
  if (!isRecord(row)) return null;
  if (typeof row.session_id !== "string") return null;
  if (typeof row.generation_id !== "string") return null;
  if (typeof row.attempt_ordinal !== "number" || row.attempt_ordinal < 1) {
    return null;
  }
  if (!isAfcDiagnosticSessionIntent(row.intent)) return null;
  return {
    sessionId: row.session_id.toLowerCase(),
    generationId: row.generation_id.toLowerCase(),
    attemptOrdinal: row.attempt_ordinal,
    intent: row.intent,
  };
}

function mapGenerationStatus(
  row: unknown,
): AfcDiagnosticRetryEpisodeGenerationStatusRow | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (!isAfcDiagnosticMachineStatusSnapshot(row.status)) {
    throw new AfcDiagnosticRetryEpisodeIntegrityError(
      "invalid_machine_status",
      "Generation machine status is not a known machine status.",
    );
  }
  return {
    id: row.id.toLowerCase(),
    status: row.status,
  };
}

function requireMapped<T>(value: T | null, label: string): T {
  if (!value) {
    throw new AfcDiagnosticRetryEpisodeStoreError(
      `Diagnostic retry-episode store failed (invalid ${label}).`,
    );
  }
  return value;
}

export function createSupabaseAfcDiagnosticRetryEpisodeStore(
  supabase: AfcDiagnosticRetryEpisodeDbClient,
): AfcDiagnosticRetryEpisodeStore {
  return {
    async findSessionById(sessionId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_TABLE)
        .select(SESSION_SIGNAL_COLUMNS)
        .eq("id", sessionId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(mapSession(data), "session");
    },

    async listMembershipsBySessionId(sessionId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE)
        .select(MEMBERSHIP_SIGNAL_COLUMNS)
        .eq("session_id", sessionId)
        .order("attempt_ordinal", { ascending: true });
      if (error) throwStoreError(error);
      if (!Array.isArray(data)) {
        throwStoreError({ code: "invalid_membership_rows" });
      }
      return data.map((row) => requireMapped(mapMembership(row), "membership"));
    },

    async listGenerationMachineStatuses(generationIds) {
      const ids = [...new Set(generationIds)];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from(AFC_GENERATION_TABLE)
        .select(GENERATION_SIGNAL_COLUMNS)
        .in("id", ids);
      if (error) throwStoreError(error);
      if (!Array.isArray(data)) {
        throwStoreError({ code: "invalid_generation_rows" });
      }
      return data.map((row) =>
        requireMapped(mapGenerationStatus(row), "generation"),
      );
    },
  };
}

function storeFromEnv(): AfcDiagnosticRetryEpisodeStore {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    throw new AfcDiagnosticRetryEpisodeStoreError(
      "Diagnostic retry-episode store failed (missing service role).",
      "missing_service_role",
    );
  }
  return createSupabaseAfcDiagnosticRetryEpisodeStore(supabase);
}

function emptySignal(
  sessionId: string,
  sessionStatus: AfcDiagnosticSessionStatus,
): AfcDiagnosticRetryEpisodeSignal {
  return {
    sessionId,
    sessionStatus,
    attemptCount: 0,
    latestAttempt: null,
    hasMultipleAttempts: false,
    hasFailedAttempt: false,
    hasReadyAttempt: false,
  };
}

function assertUniqueOrdinals(
  memberships: readonly AfcDiagnosticRetryEpisodeMembershipRow[],
): void {
  const seen = new Set<number>();
  for (const membership of memberships) {
    if (seen.has(membership.attemptOrdinal)) {
      throw new AfcDiagnosticRetryEpisodeIntegrityError(
        "duplicate_attempt_ordinal",
        "Diagnostic session membership has duplicate attempt ordinals.",
      );
    }
    seen.add(membership.attemptOrdinal);
  }
}

function statusByGenerationId(
  rows: readonly AfcDiagnosticRetryEpisodeGenerationStatusRow[],
): Map<string, AfcDiagnosticRetryEpisodeMachineStatus> {
  const statuses = new Map<string, AfcDiagnosticRetryEpisodeMachineStatus>();
  for (const row of rows) {
    statuses.set(row.id, row.status);
  }
  return statuses;
}

function deriveSignal(
  session: AfcDiagnosticRetryEpisodeSessionRow,
  memberships: readonly AfcDiagnosticRetryEpisodeMembershipRow[],
  generations: readonly AfcDiagnosticRetryEpisodeGenerationStatusRow[],
): AfcDiagnosticRetryEpisodeSignal {
  if (memberships.length === 0) {
    return emptySignal(session.id, session.status);
  }

  assertUniqueOrdinals(memberships);

  const statuses = statusByGenerationId(generations);
  let hasFailedAttempt = false;
  let hasReadyAttempt = false;
  let latest = memberships[0]!;

  for (const membership of memberships) {
    const machineStatus = statuses.get(membership.generationId);
    if (machineStatus == null) {
      throw new AfcDiagnosticRetryEpisodeIntegrityError(
        "missing_generation",
        "Diagnostic session membership references a missing generation.",
      );
    }
    if (machineStatus === "failed") hasFailedAttempt = true;
    if (machineStatus === "ready") hasReadyAttempt = true;
    if (membership.attemptOrdinal > latest.attemptOrdinal) {
      latest = membership;
    }
  }

  const latestStatus = statuses.get(latest.generationId);
  if (latestStatus == null) {
    throw new AfcDiagnosticRetryEpisodeIntegrityError(
      "missing_generation",
      "Diagnostic session membership references a missing generation.",
    );
  }

  return {
    sessionId: session.id,
    sessionStatus: session.status,
    attemptCount: memberships.length,
    latestAttempt: {
      generationId: latest.generationId,
      attemptOrdinal: latest.attemptOrdinal,
      intent: latest.intent,
      machineStatus: latestStatus,
    },
    hasMultipleAttempts: memberships.length >= 2,
    hasFailedAttempt,
    hasReadyAttempt,
  };
}

export async function getAfcDiagnosticRetryEpisodeSignal(
  input: AfcDiagnosticRetryEpisodeSignalInput,
  options: AfcDiagnosticRetryEpisodeSignalOptions = {},
): Promise<AfcDiagnosticRetryEpisodeSignal> {
  const sessionId = requireUuid(
    input.sessionId,
    "invalid_session_id",
    "sessionId",
  );
  const userId = requireUuid(input.userId, "invalid_user_id", "userId");
  const store = options.store ?? storeFromEnv();
  const session = await store.findSessionById(sessionId);
  if (!session) {
    throw new AfcDiagnosticRetryEpisodeNotFoundError(
      "Diagnostic session not found.",
    );
  }
  if (session.userId !== userId) {
    throw new AfcDiagnosticRetryEpisodeOwnershipError(
      "Diagnostic session ownership mismatch.",
    );
  }
  const memberships = await store.listMembershipsBySessionId(session.id);
  const generationIds = memberships.map((row) => row.generationId);
  const generations = await store.listGenerationMachineStatuses(generationIds);
  return deriveSignal(session, memberships, generations);
}
