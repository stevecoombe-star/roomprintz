/**
 * Parsers for the account-deletion admission barrier.
 * The SQL functions are the authority. These readers accept only the
 * fields the route is allowed to act on.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BeginDecision =
  | { status: "ready"; attemptId: string; phase: "admitted" | "destructive" }
  | { status: "blocked" }
  | { status: "missing" }
  | { status: "unavailable" };

export type OperatorDecision =
  | { status: "ok" }
  | { status: "mismatch" }
  | { status: "busy" }
  | { status: "cleanup_started" }
  | { status: "missing" }
  | { status: "unavailable" };

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function attemptId(value: unknown): string | null {
  if (typeof value !== "string" || !UUID.test(value)) return null;
  return value.toLowerCase();
}

export function beginDecision(data: unknown): BeginDecision {
  const body = record(data);
  if (!body) return { status: "unavailable" };
  if (body.ok === false && body.code === "unsettled_hold") return { status: "blocked" };
  if (body.ok === false && body.code === "not_found") return { status: "missing" };
  const id = attemptId(body.attempt_id);
  const phase = body.phase === "destructive" ? "destructive" : body.phase === "admitted" ? "admitted" : null;
  if (body.ok === true && id && phase && (body.code === "begun" || body.code === "in_progress")) {
    return { status: "ready", attemptId: id, phase };
  }
  return { status: "unavailable" };
}

export function claimDecision(data: unknown): "claimed" | "busy" | "unavailable" {
  const body = record(data);
  if (!body) return "unavailable";
  if (body.ok === true) return "claimed";
  if (body.ok === false && body.code === "deletion_in_progress") return "busy";
  return "unavailable";
}

export function markedDecision(data: unknown): "marked" | "unavailable" {
  const body = record(data);
  if (body?.ok === true) return "marked";
  return "unavailable";
}

export function operatorDecision(data: unknown): OperatorDecision {
  const body = record(data);
  if (!body) return { status: "unavailable" };
  if (body.ok === true) return { status: "ok" };
  if (body.code === "attempt_mismatch") return { status: "mismatch" };
  if (body.code === "deletion_in_progress") return { status: "busy" };
  if (body.code === "cleanup_started") return { status: "cleanup_started" };
  if (body.code === "not_found") return { status: "missing" };
  return { status: "unavailable" };
}
