/**
 * Administrator budget adjustment for the persistent furniture beta.
 * The signed-in session calls the database function. service_role cannot.
 * Historical consumed credits are not an input.
 */

import {
  ADMIN_BAD_REQUEST,
  ADMIN_MISCONFIGURED,
  ADMIN_REQUIRED,
  ADMIN_UNAVAILABLE,
  type AdminReadResult,
} from "@/lib/vibode-furniture/generation/admin-dashboard";

export const BETA_CREDIT_INFRASTRUCTURE_MAX = 1_000_000_000;
export const BETA_PAID_INFRASTRUCTURE_MAX = 1_000_000_000;
export const BETA_CREDIT_STEP_FLOOR = 10_000;
export const BETA_PAID_STEP_FLOOR = 20;

export const ADMIN_BUDGET_UNAUTHORIZED = "Budget changes are not authorized for this session.";
export const ADMIN_BUDGET_BOUNDS = "The ceiling must cover credits already consumed or reserved, and paid attempts must cover attempts already used. Neither value can pass 1000000000.";
export const ADMIN_BUDGET_STEP = "That increase is larger than one confirmed step. Raise the credit ceiling by at most 10,000 or double it, and raise paid attempts by at most 20 or double them. Save again to go further.";
export const ADMIN_BUDGET_CONFIRM = "Confirm the budget change before saving it.";

export function budgetIncreaseLimit(current: number, floor: number): number {
  return current + Math.max(floor, current);
}

export function budgetLimitsCoverObligations(input: {
  creditCeiling: number;
  paidSubmissionsAuthorized: number;
  currentCeiling: number;
  currentPaidSubmissionsAuthorized: number;
  creditsConsumed: number;
  creditsReserved: number;
  paidSubmissionsUsed: number;
}): boolean {
  const ceilingUnchanged = input.creditCeiling === input.currentCeiling;
  const paidUnchanged = input.paidSubmissionsAuthorized === input.currentPaidSubmissionsAuthorized;
  if (!ceilingUnchanged && input.creditCeiling < input.creditsConsumed + input.creditsReserved) return false;
  if (!paidUnchanged && input.paidSubmissionsAuthorized < input.paidSubmissionsUsed) return false;
  return true;
}

const LEAK = /users\/|candidate\.glb|msy_|api\.meshy|MESHY_API_KEY|supabase\.co|:\/\//i;

const SQL_ERRORS: Record<string, { status: number; error: string }> = {
  budget_unauthorized: { status: 403, error: ADMIN_BUDGET_UNAUTHORIZED },
  budget_bounds: { status: 400, error: ADMIN_BUDGET_BOUNDS },
  budget_step: { status: 400, error: ADMIN_BUDGET_STEP },
  budget_confirm: { status: 400, error: ADMIN_BUDGET_CONFIRM },
  invalid_input: { status: 400, error: ADMIN_BAD_REQUEST },
};

export type BudgetEventRecord = {
  eventId: string;
  actorUserId: string;
  reason: string;
  liveEnabledBefore: boolean;
  liveEnabledAfter: boolean;
  creditCeilingBefore: number;
  creditCeilingAfter: number;
  paidSubmissionsAuthorizedBefore: number;
  paidSubmissionsAuthorizedAfter: number;
  creditsConsumed: number;
  creditsReserved: number;
  paidSubmissionsUsed: number;
  createdAt: string;
};

export type BudgetAdjustment = {
  unchanged: boolean;
  liveEnabled: boolean;
  creditCeiling: number;
  paidSubmissionsAuthorized: number;
  creditsConsumed: number;
  creditsReserved: number;
  paidSubmissionsUsed: number;
};

type BudgetRpc = (args: {
  p_credit_ceiling: number;
  p_paid_submissions_authorized: number;
  p_live_enabled: boolean;
  p_reason: string;
  p_confirmed: boolean;
}) => Promise<{ data: unknown; error: { message: string } | null }>;

type BudgetRead = () => Promise<{ data: unknown; error: { message: string } | null }>;

export async function furnitureGenerationBudgetResponse(
  deps: {
    getAdmin: () => Promise<unknown>;
    adjust: BudgetRpc;
  },
  request: Request,
): Promise<AdminReadResult> {
  const actor = await deps.getAdmin();
  if (!actor || typeof actor !== "object" || !("id" in actor) || typeof actor.id !== "string") {
    return errorResult(403, ADMIN_REQUIRED);
  }
  if (!adminBudgetOriginAllowed(request)) return errorResult(403, "The request origin was not accepted.");
  const payload = await readPayload(request);
  if (!payload) return errorResult(400, ADMIN_BAD_REQUEST);
  if (payload.confirmed !== true) return errorResult(400, ADMIN_BUDGET_CONFIRM);
  const creditCeiling = readBoundedInteger(payload.creditCeiling, 0, BETA_CREDIT_INFRASTRUCTURE_MAX);
  const paidSubmissionsAuthorized = readBoundedInteger(payload.paidSubmissionsAuthorized, 0, BETA_PAID_INFRASTRUCTURE_MAX);
  const liveEnabled = typeof payload.liveEnabled === "boolean" ? payload.liveEnabled : null;
  const reason = readReason(payload.reason);
  if (creditCeiling == null || paidSubmissionsAuthorized == null || liveEnabled == null || !reason) {
    return errorResult(400, creditCeiling == null || paidSubmissionsAuthorized == null ? ADMIN_BUDGET_BOUNDS : ADMIN_BAD_REQUEST);
  }
  let written: { data: unknown; error: { message: string } | null };
  try {
    written = await deps.adjust({
      p_credit_ceiling: creditCeiling,
      p_paid_submissions_authorized: paidSubmissionsAuthorized,
      p_live_enabled: liveEnabled,
      p_reason: reason,
      p_confirmed: true,
    });
  } catch {
    return errorResult(500, ADMIN_UNAVAILABLE);
  }
  if (written.error || written.data == null) return errorResult(500, ADMIN_UNAVAILABLE);
  const failure = sqlFailure(written.data);
  if (failure) return failure;
  const parsed = parseBudgetAdjustment(written.data);
  if (!parsed) return errorResult(500, ADMIN_MISCONFIGURED);
  return { status: 200, body: { ok: true, ...parsed } };
}

export async function furnitureGenerationBudgetHistoryResponse(
  deps: {
    getAdmin: () => Promise<unknown>;
    read: BudgetRead;
  },
): Promise<AdminReadResult> {
  const actor = await deps.getAdmin();
  if (!actor || typeof actor !== "object" || !("id" in actor) || typeof actor.id !== "string") {
    return errorResult(403, ADMIN_REQUIRED);
  }
  let written: { data: unknown; error: { message: string } | null };
  try {
    written = await deps.read();
  } catch {
    return errorResult(500, ADMIN_UNAVAILABLE);
  }
  if (written.error || written.data == null) return errorResult(500, ADMIN_UNAVAILABLE);
  const failure = sqlFailure(written.data);
  if (failure) return failure;
  const events = parseBudgetHistory(written.data);
  if (!events) return errorResult(500, ADMIN_MISCONFIGURED);
  return { status: 200, body: { ok: true, events } };
}

export function parseBudgetHistory(value: unknown): BudgetEventRecord[] | null {
  const body = asObject(value);
  if (!body || body.ok !== true || !Array.isArray(body.events)) return null;
  const events: BudgetEventRecord[] = [];
  for (const item of body.events) {
    const parsed = parseBudgetEvent(item);
    if (!parsed) return null;
    events.push(parsed);
  }
  return events;
}

function parseBudgetEvent(value: unknown): BudgetEventRecord | null {
  const body = asObject(value);
  if (!body) return null;
  const eventId = readText(body.event_id ?? body.eventId);
  const actorUserId = readText(body.actor_user_id ?? body.actorUserId);
  const reason = readText(body.reason);
  const createdAt = readText(body.created_at ?? body.createdAt);
  const liveEnabledBefore = readBool(body.live_enabled_before ?? body.liveEnabledBefore);
  const liveEnabledAfter = readBool(body.live_enabled_after ?? body.liveEnabledAfter);
  const creditCeilingBefore = readCount(body.credit_ceiling_before ?? body.creditCeilingBefore);
  const creditCeilingAfter = readCount(body.credit_ceiling_after ?? body.creditCeilingAfter);
  const paidSubmissionsAuthorizedBefore = readCount(body.paid_submissions_authorized_before ?? body.paidSubmissionsAuthorizedBefore);
  const paidSubmissionsAuthorizedAfter = readCount(body.paid_submissions_authorized_after ?? body.paidSubmissionsAuthorizedAfter);
  const creditsConsumed = readCount(body.credits_consumed ?? body.creditsConsumed);
  const creditsReserved = readCount(body.credits_reserved ?? body.creditsReserved);
  const paidSubmissionsUsed = readCount(body.paid_submissions_used ?? body.paidSubmissionsUsed);
  if (
    !eventId || !actorUserId || !reason || !createdAt
    || liveEnabledBefore == null || liveEnabledAfter == null
    || creditCeilingBefore == null || creditCeilingAfter == null
    || paidSubmissionsAuthorizedBefore == null || paidSubmissionsAuthorizedAfter == null
    || creditsConsumed == null || creditsReserved == null || paidSubmissionsUsed == null
  ) return null;
  return {
    eventId,
    actorUserId,
    reason,
    liveEnabledBefore,
    liveEnabledAfter,
    creditCeilingBefore,
    creditCeilingAfter,
    paidSubmissionsAuthorizedBefore,
    paidSubmissionsAuthorizedAfter,
    creditsConsumed,
    creditsReserved,
    paidSubmissionsUsed,
    createdAt,
  };
}

export function parseBudgetAdjustment(value: unknown): BudgetAdjustment | null {
  const body = asObject(value);
  if (!body || body.ok !== true) return null;
  const liveEnabled = readBool(body.live_enabled ?? body.liveEnabled);
  const creditCeiling = readCount(body.credit_ceiling ?? body.creditCeiling);
  const paidSubmissionsAuthorized = readCount(body.paid_submissions_authorized ?? body.paidSubmissionsAuthorized);
  const creditsConsumed = readCount(body.credits_consumed ?? body.creditsConsumed);
  const creditsReserved = readCount(body.credits_reserved ?? body.creditsReserved);
  const paidSubmissionsUsed = readCount(body.paid_submissions_used ?? body.paidSubmissionsUsed);
  if (
    liveEnabled == null
    || creditCeiling == null
    || paidSubmissionsAuthorized == null
    || creditsConsumed == null
    || creditsReserved == null
    || paidSubmissionsUsed == null
  ) return null;
  return {
    unchanged: body.unchanged === true,
    liveEnabled,
    creditCeiling,
    paidSubmissionsAuthorized,
    creditsConsumed,
    creditsReserved,
    paidSubmissionsUsed,
  };
}

export function adminBudgetOriginAllowed(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;
  let expected = "";
  try {
    expected = new URL(request.url).origin;
  } catch {
    return false;
  }
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;
  return site === "same-origin";
}

function sqlFailure(value: unknown): AdminReadResult | null {
  const body = asObject(value);
  if (!body || body.ok !== false || typeof body.code !== "string") return null;
  const mapped = SQL_ERRORS[body.code];
  if (!mapped) return errorResult(500, ADMIN_UNAVAILABLE);
  return errorResult(mapped.status, mapped.error);
}

function readBoundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) return null;
  return value;
}

function readReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  if (!reason || reason.length > 200 || LEAK.test(reason) || /[\u0000-\u001f]/.test(reason)) return null;
  return reason;
}

function readBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

async function readPayload(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return asObject(await request.json());
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function errorResult(status: number, error: string): AdminReadResult {
  return { status, body: { ok: false, error } };
}
