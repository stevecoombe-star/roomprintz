import "server-only";

import {
  AfcDiagnosticSessionStoreError,
  ensureAfcDiagnosticSessionMembership,
  type AfcDiagnosticMembershipResult,
  type AfcDiagnosticSessionLifecycleOptions,
  type AfcDiagnosticSessionMembershipInput,
} from "./session-lifecycle.server";

/**
 * AFD-2B best-effort Diagnostic Session attach.
 *
 * Invokes the AFD-2A lifecycle primitive after a generation row exists.
 * Failures are logged compactly and swallowed so AFC can continue.
 */

export const AFC_DIAGNOSTIC_SESSION_ASSOCIATION_FAILED_EVENT =
  "afc_diagnostic_session_association_failed" as const;

export type AfcDiagnosticSessionAttachInput =
  AfcDiagnosticSessionMembershipInput;

export type AfcDiagnosticSessionAttachLog = Readonly<{
  event: typeof AFC_DIAGNOSTIC_SESSION_ASSOCIATION_FAILED_EVENT;
  generationId: string;
  roomId: string;
  errorName: string;
  postgresCode?: string;
}>;

export type AfcDiagnosticSessionAttachOptions =
  AfcDiagnosticSessionLifecycleOptions & {
    ensureMembership?: typeof ensureAfcDiagnosticSessionMembership;
    log?: (entry: AfcDiagnosticSessionAttachLog) => void;
  };

const SQLSTATE = /^[0-9A-Z]{5}$/;

function compactId(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name.length > 0) return error.name;
  return "Error";
}

function safePostgresCauseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if (error instanceof AfcDiagnosticSessionStoreError) {
    const cause = error.causeCode;
    if (typeof cause === "string" && SQLSTATE.test(cause)) return cause;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && SQLSTATE.test(code)) return code;
  if (typeof code === "number" && code >= 10000 && code <= 99999) {
    return String(code);
  }
  return undefined;
}

function defaultLog(entry: AfcDiagnosticSessionAttachLog): void {
  console.error("[afc-v2-diagnostics] generation session association failed", {
    event: entry.event,
    generationId: entry.generationId,
    roomId: entry.roomId,
    errorName: entry.errorName,
    ...(entry.postgresCode ? { postgresCode: entry.postgresCode } : {}),
  });
}

export async function attachAfcDiagnosticSessionBestEffort(
  input: AfcDiagnosticSessionAttachInput,
  options: AfcDiagnosticSessionAttachOptions = {},
): Promise<AfcDiagnosticMembershipResult | null> {
  const ensure = options.ensureMembership ?? ensureAfcDiagnosticSessionMembership;
  try {
    return await ensure(input, {
      env: options.env,
      store: options.store,
    });
  } catch (error) {
    const postgresCode = safePostgresCauseCode(error);
    const entry: AfcDiagnosticSessionAttachLog = {
      event: AFC_DIAGNOSTIC_SESSION_ASSOCIATION_FAILED_EVENT,
      generationId: compactId(input.generationId),
      roomId: compactId(input.roomId),
      errorName: errorName(error),
      ...(postgresCode ? { postgresCode } : {}),
    };
    (options.log ?? defaultLog)(Object.freeze(entry));
    return null;
  }
}
