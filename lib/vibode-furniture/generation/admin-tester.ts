/**
 * Administrator mutations for beta tester approval and allowances.
 * The actor id comes from the authenticated session. Storage paths and
 * provider secrets are not accepted or returned.
 */

import {
  ADMIN_BAD_REQUEST,
  ADMIN_MISCONFIGURED,
  ADMIN_REQUIRED,
  ADMIN_UNAVAILABLE,
  parseBetaTester,
  type AdminReadResult,
  type BetaTesterRecord,
  type TesterClassification,
} from "@/lib/vibode-furniture/generation/admin-dashboard";

export const ADMIN_ACCOUNT_MISSING = "That Vibode account could not be found.";
export const ADMIN_ALREADY_APPROVED = "That account is already an approved tester.";
export const ADMIN_CLASSIFICATION = "Classification must be Individual Beta or Furniture Partner.";
export const ADMIN_ALLOWANCE = "Allowance must be a whole number from 0 to 50.";
export const ADMIN_OBLIGATION = "Allowance cannot be lower than reserved plus consumed generations.";
export const ADMIN_CONFLICT = "This tester changed before the update was saved. Refresh and try again.";
export const ADMIN_CONFIRM = "Confirm the change before saving it.";
export const ADMIN_ORIGIN = "The request origin was not accepted.";
export const ADMIN_AMBIGUOUS = "That email matches more than one account.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEAK = /users\/|candidate\.glb|msy_|api\.meshy|MESHY_API_KEY|supabase\.co|:\/\//i;
const CLASSIFICATIONS = ["individual_beta", "furniture_partner"] as const;

const WRITE_FUNCTIONS = new Set<string>([
  "admin_approve_vibode_furniture_generation_tester",
  "admin_update_vibode_furniture_generation_tester",
]);

const SQL_ERRORS: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: ADMIN_ACCOUNT_MISSING },
  ambiguous_account: { status: 409, error: ADMIN_AMBIGUOUS },
  invalid_classification: { status: 400, error: ADMIN_CLASSIFICATION },
  invalid_allowance: { status: 400, error: ADMIN_ALLOWANCE },
  allowance_obligation: { status: 409, error: ADMIN_OBLIGATION },
  already_approved: { status: 409, error: ADMIN_ALREADY_APPROVED },
  conflict: { status: 409, error: ADMIN_CONFLICT },
  invalid_input: { status: 400, error: ADMIN_BAD_REQUEST },
  email_unavailable: { status: 500, error: ADMIN_UNAVAILABLE },
};

export type AdminWriteName =
  | "admin_approve_vibode_furniture_generation_tester"
  | "admin_update_vibode_furniture_generation_tester";

export type AdminWriteClient = {
  rpc: (
    fn: AdminWriteName,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type TesterMutation = {
  tester: BetaTesterRecord;
  idempotent: boolean;
  unchanged: boolean;
};

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export function adminWriteGateway(client: RpcClient | null): AdminWriteClient | null {
  if (!client) return null;
  return {
    async rpc(fn, args) {
      if (!WRITE_FUNCTIONS.has(fn)) return { data: null, error: { message: "rpc_failed" } };
      const { data, error } = await client.rpc(fn, args);
      if (error || data == null) return { data: null, error: { message: "rpc_failed" } };
      return { data, error: null };
    },
  };
}

export function adminMutationOriginAllowed(request: Request): boolean {
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

export async function furnitureGenerationApproveResponse(
  deps: {
    getAdmin: () => Promise<unknown>;
    getServiceClient: () => AdminWriteClient | null;
  },
  request: Request,
): Promise<AdminReadResult> {
  const actor = await readActor(deps.getAdmin);
  if (actor.status) return actor.status;
  if (!adminMutationOriginAllowed(request)) return errorResult(403, ADMIN_ORIGIN);
  const payload = await readPayload(request);
  if (!payload) return errorResult(400, ADMIN_BAD_REQUEST);
  if (payload.confirmed !== true) return errorResult(400, ADMIN_CONFIRM);
  const email = readEmail(payload.email);
  const classification = readClassification(payload.classification);
  const allowance = readAllowance(payload.authorizedGenerations);
  const enabled = readEnabled(payload.enabled);
  const reason = readReason(payload.reason);
  if (!email || !classification || allowance == null || enabled == null || !reason) {
    return errorResult(400, inputError(email, classification, allowance, enabled, reason));
  }
  return writeTester(deps.getServiceClient, "admin_approve_vibode_furniture_generation_tester", {
    p_actor_user_id: actor.id,
    p_email: email,
    p_classification: classification,
    p_authorized_generations: allowance,
    p_enabled: enabled,
    p_reason: reason,
  });
}

export async function furnitureGenerationUpdateResponse(
  deps: {
    getAdmin: () => Promise<unknown>;
    getServiceClient: () => AdminWriteClient | null;
  },
  request: Request,
  userId: string,
): Promise<AdminReadResult> {
  const actor = await readActor(deps.getAdmin);
  if (actor.status) return actor.status;
  if (!adminMutationOriginAllowed(request)) return errorResult(403, ADMIN_ORIGIN);
  if (!UUID.test(userId)) return errorResult(400, ADMIN_BAD_REQUEST);
  const payload = await readPayload(request);
  if (!payload) return errorResult(400, ADMIN_BAD_REQUEST);
  if (payload.confirmed !== true) return errorResult(400, ADMIN_CONFIRM);
  const classification = readClassification(payload.classification);
  const allowance = readAllowance(payload.authorizedGenerations);
  const enabled = readEnabled(payload.enabled);
  const reason = readReason(payload.reason);
  const expectedUpdatedAt = readTimestamp(payload.expectedUpdatedAt);
  if (!classification) return errorResult(400, ADMIN_CLASSIFICATION);
  if (allowance == null) return errorResult(400, ADMIN_ALLOWANCE);
  if (enabled == null || !reason || !expectedUpdatedAt) return errorResult(400, ADMIN_BAD_REQUEST);
  return writeTester(deps.getServiceClient, "admin_update_vibode_furniture_generation_tester", {
    p_actor_user_id: actor.id,
    p_user_id: userId.toLowerCase(),
    p_classification: classification,
    p_authorized_generations: allowance,
    p_enabled: enabled,
    p_expected_updated_at: expectedUpdatedAt,
    p_reason: reason,
  });
}

export function parseTesterMutation(value: unknown): TesterMutation | null {
  const body = asObject(value);
  if (!body || body.ok === false) return null;
  const tester = parseBetaTester(body.tester);
  if (!tester || typeof body.idempotent !== "boolean" || typeof body.unchanged !== "boolean") return null;
  return { tester, idempotent: body.idempotent, unchanged: body.unchanged };
}

async function writeTester(
  getServiceClient: () => AdminWriteClient | null,
  fn: AdminWriteName,
  args: Record<string, unknown>,
): Promise<AdminReadResult> {
  const client = getServiceClient();
  if (!client) return errorResult(500, ADMIN_MISCONFIGURED);
  const written = await client.rpc(fn, args);
  if (written.error) return errorResult(500, ADMIN_UNAVAILABLE);
  const failure = sqlFailure(written.data);
  if (failure) return failure;
  const parsed = parseTesterMutation(written.data);
  if (!parsed) return errorResult(500, ADMIN_UNAVAILABLE);
  return { status: 200, body: JSON.parse(JSON.stringify(parsed)) as Record<string, unknown> };
}

async function readActor(
  getAdmin: () => Promise<unknown>,
): Promise<{ id: string; status?: undefined } | { id?: undefined; status: AdminReadResult }> {
  const admin = await getAdmin();
  if (!admin || typeof admin !== "object") return { status: errorResult(403, ADMIN_REQUIRED) };
  const id = "id" in admin && typeof admin.id === "string" ? admin.id.toLowerCase() : "";
  if (!UUID.test(id)) return { status: errorResult(500, ADMIN_MISCONFIGURED) };
  return { id };
}

async function readPayload(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const payload = await request.json();
    return asObject(payload);
  } catch {
    return null;
  }
}

function inputError(
  email: string | null,
  classification: TesterClassification | null,
  allowance: number | null,
  enabled: boolean | null,
  reason: string | null,
): string {
  if (!classification) return ADMIN_CLASSIFICATION;
  if (allowance == null) return ADMIN_ALLOWANCE;
  if (enabled == null || !reason || !email) return ADMIN_BAD_REQUEST;
  return ADMIN_BAD_REQUEST;
}

function sqlFailure(value: unknown): AdminReadResult | null {
  const body = asObject(value);
  if (!body || body.ok !== false || typeof body.code !== "string") return null;
  const mapped = SQL_ERRORS[body.code];
  if (!mapped) return errorResult(500, ADMIN_UNAVAILABLE);
  return errorResult(mapped.status, mapped.error);
}

function readEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || LEAK.test(email) || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email;
}

function readClassification(value: unknown): TesterClassification | null {
  return typeof value === "string" && CLASSIFICATIONS.includes(value as TesterClassification)
    ? value as TesterClassification
    : null;
}

function readAllowance(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 50) return null;
  return value;
}

function readEnabled(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  if (!reason || reason.length > 200 || LEAK.test(reason) || /[\u0000-\u001f]/.test(reason)) return null;
  return reason;
}

function readTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40 || LEAK.test(value) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return null;
  }
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function errorResult(status: number, error: string): AdminReadResult {
  return { status, body: { error } };
}
