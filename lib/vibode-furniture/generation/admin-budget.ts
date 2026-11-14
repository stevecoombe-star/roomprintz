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

export const BETA_CREDIT_CEILING_MAX = 600;
export const BETA_PAID_ATTEMPT_MAX = 20;

export const ADMIN_BUDGET_UNAUTHORIZED = "Budget changes are not authorized for this session.";
export const ADMIN_BUDGET_BOUNDS = "The ceiling must cover credits already used and stay within 600. Paid attempts must cover attempts already used and stay within 20.";
export const ADMIN_BUDGET_CONFIRM = "Confirm the budget change before saving it.";

const LEAK = /users\/|candidate\.glb|msy_|api\.meshy|MESHY_API_KEY|supabase\.co|:\/\//i;

const SQL_ERRORS: Record<string, { status: number; error: string }> = {
  budget_unauthorized: { status: 403, error: ADMIN_BUDGET_UNAUTHORIZED },
  budget_bounds: { status: 400, error: ADMIN_BUDGET_BOUNDS },
  invalid_input: { status: 400, error: ADMIN_BAD_REQUEST },
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
}) => Promise<{ data: unknown; error: { message: string } | null }>;

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
  const creditCeiling = readBoundedInteger(payload.creditCeiling, 0, BETA_CREDIT_CEILING_MAX);
  const paidSubmissionsAuthorized = readBoundedInteger(payload.paidSubmissionsAuthorized, 0, BETA_PAID_ATTEMPT_MAX);
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
