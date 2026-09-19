import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { parseUuid } from "@/lib/afc-v2-production/production-http";

import {
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
  isAfcDiagnosticSessionIntent,
  type AfcDiagnosticSessionIntent,
} from "./contracts";
import {
  resolveAfcQaCapability,
  type AfcQaCapabilityEnv,
} from "./qa-capability.server";

/**
 * AFD-2A Diagnostic Session lifecycle primitive.
 *
 * Server-only. Does not activate generations, write Cases, or expose
 * membership to the browser. AFD-2B will invoke this after generation
 * creation and catch failures so diagnostics stay non-fatal to AFC.
 */

export const AFC_DIAGNOSTIC_SESSION_OPEN_RETRY_LIMIT = 4;
export const AFC_DIAGNOSTIC_MEMBERSHIP_ORDINAL_RETRY_LIMIT = 8;

const AFC_ORIGINAL_SHA256_HEX = /^[0-9a-f]{64}$/;

const SESSION_COLUMNS =
  "id, room_id, user_id, original_sha256, base_asset_id, status, created_at, updated_at";
const MEMBERSHIP_COLUMNS =
  "session_id, generation_id, attempt_ordinal, intent, associated_at";

export type AfcDiagnosticMembershipResult =
  | { enabled: false }
  | {
      enabled: true;
      sessionId: string;
      generationId: string;
      attemptOrdinal: number;
      sessionCreated: boolean;
      membershipCreated: boolean;
      staleSessionsClosed: number;
    };

export type AfcDiagnosticSessionMembershipInput = {
  userId: unknown;
  roomId: unknown;
  originalSha256: unknown;
  baseAssetId?: unknown;
  generationId: unknown;
  intent: unknown;
};

export type AfcDiagnosticSessionRow = {
  id: string;
  roomId: string;
  userId: string;
  originalSha256: string;
  baseAssetId: string | null;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
};

export type AfcDiagnosticMembershipRow = {
  sessionId: string;
  generationId: string;
  attemptOrdinal: number;
  intent: AfcDiagnosticSessionIntent;
  associatedAt: string;
};

export type AfcDiagnosticSessionInsertResult =
  | { ok: true; session: AfcDiagnosticSessionRow }
  | { ok: false; code: "unique_open_conflict" };

export type AfcDiagnosticMembershipInsertResult =
  | { ok: true; membership: AfcDiagnosticMembershipRow }
  | { ok: false; code: "unique_generation_conflict" | "unique_ordinal_conflict" };

export type AfcDiagnosticSessionStore = {
  closeStaleOpenSessions(input: {
    userId: string;
    roomId: string;
    originalSha256: string;
  }): Promise<number>;
  findOpenSession(input: {
    userId: string;
    roomId: string;
    originalSha256: string;
  }): Promise<AfcDiagnosticSessionRow | null>;
  insertOpenSession(input: {
    userId: string;
    roomId: string;
    originalSha256: string;
    baseAssetId: string | null;
  }): Promise<AfcDiagnosticSessionInsertResult>;
  findMembershipByGenerationId(
    generationId: string,
  ): Promise<AfcDiagnosticMembershipRow | null>;
  maxAttemptOrdinal(sessionId: string): Promise<number>;
  insertMembership(input: {
    sessionId: string;
    generationId: string;
    attemptOrdinal: number;
    intent: AfcDiagnosticSessionIntent;
  }): Promise<AfcDiagnosticMembershipInsertResult>;
};

export type AfcDiagnosticDbClient = {
  from: (table: string) => any;
};

export type AfcDiagnosticSessionLifecycleOptions = {
  env?: AfcQaCapabilityEnv | NodeJS.ProcessEnv;
  store?: AfcDiagnosticSessionStore;
};

export class AfcDiagnosticSessionInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AfcDiagnosticSessionInputError";
    this.code = code;
  }
}

export class AfcDiagnosticSessionIntegrityError extends Error {
  readonly code = "generation_session_mismatch" as const;
  constructor(message: string) {
    super(message);
    this.name = "AfcDiagnosticSessionIntegrityError";
  }
}

export class AfcDiagnosticSessionConcurrencyError extends Error {
  readonly code = "retry_exhausted" as const;
  constructor(message: string) {
    super(message);
    this.name = "AfcDiagnosticSessionConcurrencyError";
  }
}

export class AfcDiagnosticSessionStoreError extends Error {
  readonly code = "store_failed" as const;
  readonly causeCode?: string;
  constructor(message: string, causeCode?: string) {
    super(message);
    this.name = "AfcDiagnosticSessionStoreError";
    this.causeCode = causeCode;
  }
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "23505" || code === 23505;
}

export function parseAfcOriginalSha256(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sha = value.trim().toLowerCase();
  return AFC_ORIGINAL_SHA256_HEX.test(sha) ? sha : null;
}

function requireUuid(value: unknown, code: string, label: string): string {
  const id = parseUuid(value);
  if (!id) {
    throw new AfcDiagnosticSessionInputError(code, `Invalid ${label}.`);
  }
  return id.toLowerCase();
}

function parseOptionalBaseAssetId(value: unknown): string | null {
  if (value == null || value === "") return null;
  const id = parseUuid(value);
  if (!id) {
    throw new AfcDiagnosticSessionInputError(
      "invalid_base_asset_id",
      "Invalid baseAssetId.",
    );
  }
  return id.toLowerCase();
}

function parseIntent(value: unknown): AfcDiagnosticSessionIntent {
  if (!isAfcDiagnosticSessionIntent(value)) {
    throw new AfcDiagnosticSessionInputError("invalid_intent", "Invalid intent.");
  }
  return value;
}

function parseMembershipInput(input: AfcDiagnosticSessionMembershipInput): {
  userId: string;
  roomId: string;
  originalSha256: string;
  baseAssetId: string | null;
  generationId: string;
  intent: AfcDiagnosticSessionIntent;
} {
  const userId = requireUuid(input.userId, "invalid_user_id", "userId");
  const roomId = requireUuid(input.roomId, "invalid_room_id", "roomId");
  const generationId = requireUuid(
    input.generationId,
    "invalid_generation_id",
    "generationId",
  );
  const originalSha256 = parseAfcOriginalSha256(input.originalSha256);
  if (!originalSha256) {
    throw new AfcDiagnosticSessionInputError(
      "invalid_original_sha256",
      "Invalid originalSha256.",
    );
  }
  return {
    userId,
    roomId,
    originalSha256,
    baseAssetId: parseOptionalBaseAssetId(input.baseAssetId),
    generationId,
    intent: parseIntent(input.intent),
  };
}

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0) return code;
  if (typeof code === "number") return String(code);
  return undefined;
}

function throwStoreError(error: unknown): never {
  throw new AfcDiagnosticSessionStoreError(
    `Diagnostic session store failed (${postgresCode(error) ?? "unknown"}).`,
    postgresCode(error),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mapSession(row: unknown): AfcDiagnosticSessionRow | null {
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
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    originalSha256: row.original_sha256,
    baseAssetId: row.base_asset_id ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMembership(row: unknown): AfcDiagnosticMembershipRow | null {
  if (!isRecord(row)) return null;
  if (typeof row.session_id !== "string") return null;
  if (typeof row.generation_id !== "string") return null;
  if (typeof row.attempt_ordinal !== "number" || row.attempt_ordinal < 1) {
    return null;
  }
  if (!isAfcDiagnosticSessionIntent(row.intent)) return null;
  if (typeof row.associated_at !== "string") return null;
  return {
    sessionId: row.session_id,
    generationId: row.generation_id,
    attemptOrdinal: row.attempt_ordinal,
    intent: row.intent,
    associatedAt: row.associated_at,
  };
}

function requireMapped<T>(value: T | null, label: string): T {
  if (!value) {
    throw new AfcDiagnosticSessionStoreError(
      `Diagnostic session store failed (invalid ${label}).`,
    );
  }
  return value;
}

export function createSupabaseAfcDiagnosticSessionStore(
  supabase: AfcDiagnosticDbClient,
): AfcDiagnosticSessionStore {
  const store: AfcDiagnosticSessionStore = {
    async closeStaleOpenSessions(input) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_TABLE)
        .update({ status: "closed" })
        .eq("user_id", input.userId)
        .eq("room_id", input.roomId)
        .eq("status", "open")
        .neq("original_sha256", input.originalSha256)
        .select("id");
      if (error) throwStoreError(error);
      return Array.isArray(data) ? data.length : 0;
    },

    async findOpenSession(input) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_TABLE)
        .select(SESSION_COLUMNS)
        .eq("user_id", input.userId)
        .eq("room_id", input.roomId)
        .eq("original_sha256", input.originalSha256)
        .eq("status", "open")
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      return requireMapped(mapSession(data), "session");
    },

    async insertOpenSession(input) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_TABLE)
        .insert({
          user_id: input.userId,
          room_id: input.roomId,
          original_sha256: input.originalSha256,
          base_asset_id: input.baseAssetId,
          status: "open",
        })
        .select(SESSION_COLUMNS)
        .maybeSingle();
      if (isPostgresUniqueViolation(error)) {
        return { ok: false, code: "unique_open_conflict" };
      }
      if (error || data == null) throwStoreError(error ?? { code: "empty_insert" });
      return { ok: true, session: requireMapped(mapSession(data), "session") };
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

    async maxAttemptOrdinal(sessionId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE)
        .select("attempt_ordinal")
        .eq("session_id", sessionId)
        .order("attempt_ordinal", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (!isRecord(data) || typeof data.attempt_ordinal !== "number") return 0;
      return data.attempt_ordinal;
    },

    async insertMembership(input) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE)
        .insert({
          session_id: input.sessionId,
          generation_id: input.generationId,
          attempt_ordinal: input.attemptOrdinal,
          intent: input.intent,
        })
        .select(MEMBERSHIP_COLUMNS)
        .maybeSingle();
      if (isPostgresUniqueViolation(error)) {
        const existing = await store.findMembershipByGenerationId(input.generationId);
        if (existing) return { ok: false, code: "unique_generation_conflict" };
        return { ok: false, code: "unique_ordinal_conflict" };
      }
      if (error || data == null) throwStoreError(error ?? { code: "empty_insert" });
      return {
        ok: true,
        membership: requireMapped(mapMembership(data), "membership"),
      };
    },
  };
  return store;
}

function storeFromEnv(): AfcDiagnosticSessionStore {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    throw new AfcDiagnosticSessionStoreError(
      "Diagnostic session store failed (missing service role).",
      "missing_service_role",
    );
  }
  return createSupabaseAfcDiagnosticSessionStore(supabase);
}

async function findOrCreateOpenSession(
  store: AfcDiagnosticSessionStore,
  input: {
    userId: string;
    roomId: string;
    originalSha256: string;
    baseAssetId: string | null;
  },
): Promise<{ session: AfcDiagnosticSessionRow; created: boolean }> {
  for (let attempt = 0; attempt < AFC_DIAGNOSTIC_SESSION_OPEN_RETRY_LIMIT; attempt++) {
    const existing = await store.findOpenSession(input);
    if (existing) return { session: existing, created: false };
    const inserted = await store.insertOpenSession(input);
    if (inserted.ok) return { session: inserted.session, created: true };
  }
  throw new AfcDiagnosticSessionConcurrencyError(
    "Open diagnostic session retry exhausted.",
  );
}

function integrityMismatch(): never {
  throw new AfcDiagnosticSessionIntegrityError(
    "Generation already belongs to a different diagnostic session.",
  );
}

async function appendMembership(
  store: AfcDiagnosticSessionStore,
  input: {
    sessionId: string;
    generationId: string;
    intent: AfcDiagnosticSessionIntent;
  },
): Promise<{ membership: AfcDiagnosticMembershipRow; created: boolean }> {
  const existing = await store.findMembershipByGenerationId(input.generationId);
  if (existing) {
    if (existing.sessionId !== input.sessionId) integrityMismatch();
    return { membership: existing, created: false };
  }

  for (let attempt = 0; attempt < AFC_DIAGNOSTIC_MEMBERSHIP_ORDINAL_RETRY_LIMIT; attempt++) {
    const maxOrdinal = await store.maxAttemptOrdinal(input.sessionId);
    const inserted = await store.insertMembership({
      sessionId: input.sessionId,
      generationId: input.generationId,
      attemptOrdinal: maxOrdinal + 1,
      intent: input.intent,
    });
    if (inserted.ok) return { membership: inserted.membership, created: true };
    if (inserted.code === "unique_generation_conflict") {
      const found = await store.findMembershipByGenerationId(input.generationId);
      if (!found) continue;
      if (found.sessionId !== input.sessionId) integrityMismatch();
      return { membership: found, created: false };
    }
  }
  throw new AfcDiagnosticSessionConcurrencyError(
    "Diagnostic membership ordinal retry exhausted.",
  );
}

export async function ensureAfcDiagnosticSessionMembership(
  input: AfcDiagnosticSessionMembershipInput,
  options: AfcDiagnosticSessionLifecycleOptions = {},
): Promise<AfcDiagnosticMembershipResult> {
  const parsed = parseMembershipInput(input);
  const capability = resolveAfcQaCapability(
    parsed.userId,
    options.env ?? process.env,
  );
  if (!capability.enabled) return { enabled: false };

  const store = options.store ?? storeFromEnv();
  const staleSessionsClosed = await store.closeStaleOpenSessions({
    userId: parsed.userId,
    roomId: parsed.roomId,
    originalSha256: parsed.originalSha256,
  });
  const opened = await findOrCreateOpenSession(store, {
    userId: parsed.userId,
    roomId: parsed.roomId,
    originalSha256: parsed.originalSha256,
    baseAssetId: parsed.baseAssetId,
  });
  const attached = await appendMembership(store, {
    sessionId: opened.session.id,
    generationId: parsed.generationId,
    intent: parsed.intent,
  });

  return {
    enabled: true,
    sessionId: opened.session.id,
    generationId: attached.membership.generationId,
    attemptOrdinal: attached.membership.attemptOrdinal,
    sessionCreated: opened.created,
    membershipCreated: attached.created,
    staleSessionsClosed,
  };
}
