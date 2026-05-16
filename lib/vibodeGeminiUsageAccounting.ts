"server-only";

import { createClient } from "@supabase/supabase-js";

type JsonSafeValue =
  | null
  | boolean
  | number
  | string
  | JsonSafeValue[]
  | { [key: string]: JsonSafeValue };

type UsageStatus = "success" | "failure";

type GeminiUsageEventInput = {
  attemptId?: string | null;
  retryOfAttemptId?: string | null;
  isRetry?: boolean;
  requestId?: string | null;
  operationId?: string | null;
  providerRequestId?: string | null;
  userId?: string | null;
  roomId?: string | null;
  versionId?: string | null;
  assetId?: string | null;
  provider?: string | null;
  model: string;
  workflowType: string;
  actionType: string;
  route: string;
  service?: string | null;
  sourceTrigger?: string | null;
  status: UsageStatus;
  errorCode?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  imageCount?: number | null;
  referenceImageCount?: number | null;
  estimatedCostUsd?: number | null;
  metadata?: unknown;
};

type GeminiUsageEventRow = {
  attempt_id: string;
  retry_of_attempt_id: string | null;
  is_retry: boolean;
  request_id: string | null;
  operation_id: string | null;
  provider_request_id: string | null;
  user_id: string | null;
  room_id: string | null;
  version_id: string | null;
  asset_id: string | null;
  provider: string;
  model: string;
  workflow_type: string;
  action_type: string;
  route: string;
  service: string;
  source_trigger: string | null;
  status: UsageStatus;
  error_code: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  image_count: number | null;
  reference_image_count: number | null;
  estimated_cost_usd: number | null;
  metadata: JsonSafeValue;
};

type AccountingContext = Omit<GeminiUsageEventInput, "status" | "errorCode" | "latencyMs">;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

function hasSupabaseServiceRoleEnv(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function createSupabaseAdminClient() {
  if (!hasSupabaseServiceRoleEnv()) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFiniteInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const out = Math.trunc(value);
  return out >= 0 ? out : null;
}

function normalizeFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function toJsonSafe(value: unknown): JsonSafeValue {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (typeof value === "object") {
    const out: Record<string, JsonSafeValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "undefined") continue;
      out[key] = toJsonSafe(item);
    }
    return out;
  }
  return String(value);
}

function toErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const code = safeStr((err as Record<string, unknown>).code);
    if (code) return code;
    const status = (err as Record<string, unknown>).status;
    if (typeof status === "number" && Number.isFinite(status)) {
      return `HTTP_${Math.trunc(status)}`;
    }
  }
  if (err instanceof Error && safeStr(err.name)) {
    return err.name;
  }
  return "UNKNOWN_ERROR";
}

export function createRequestId(prefix = "vibode"): string {
  try {
    return `${prefix}-req-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function buildAttemptId(args?: {
  provider?: string | null;
  route?: string | null;
  requestId?: string | null;
}): string {
  const provider = safeStr(args?.provider) ?? "google_gemini";
  const route = safeStr(args?.route) ?? "unknown";
  const requestId = safeStr(args?.requestId) ?? createRequestId("vibode");
  const routeSafe = route.replace(/[^a-z0-9/_-]/gi, "_");
  try {
    return `${provider}:${routeSafe}:${requestId}:${crypto.randomUUID()}`;
  } catch {
    return `${provider}:${routeSafe}:${requestId}:${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}

export function getRequestIdFromHeaders(
  headers: Pick<Headers, "get"> | null | undefined,
  fallbackPrefix = "vibode"
): string {
  const candidate =
    safeStr(headers?.get("x-vibode-request-id")) ??
    safeStr(headers?.get("x-request-id")) ??
    safeStr(headers?.get("x-correlation-id"));
  return candidate ?? createRequestId(fallbackPrefix);
}

function toRow(input: GeminiUsageEventInput): GeminiUsageEventRow {
  const provider = safeStr(input.provider) ?? "google_gemini";
  const route = safeStr(input.route) ?? "unknown";
  const requestId = safeStr(input.requestId) ?? createRequestId("vibode");
  return {
    attempt_id:
      safeStr(input.attemptId) ?? buildAttemptId({ provider, route, requestId: requestId }),
    retry_of_attempt_id: safeStr(input.retryOfAttemptId),
    is_retry: input.isRetry === true,
    request_id: requestId,
    operation_id: safeStr(input.operationId),
    provider_request_id: safeStr(input.providerRequestId),
    user_id: safeStr(input.userId),
    room_id: safeStr(input.roomId),
    version_id: safeStr(input.versionId),
    asset_id: safeStr(input.assetId),
    provider,
    model: safeStr(input.model) ?? "unknown",
    workflow_type: safeStr(input.workflowType) ?? "unknown",
    action_type: safeStr(input.actionType) ?? "unknown",
    route,
    service: safeStr(input.service) ?? "roomprintz-ui",
    source_trigger: safeStr(input.sourceTrigger),
    status: input.status,
    error_code: safeStr(input.errorCode),
    latency_ms: normalizeFiniteInt(input.latencyMs),
    input_tokens: normalizeFiniteInt(input.inputTokens),
    output_tokens: normalizeFiniteInt(input.outputTokens),
    image_count: normalizeFiniteInt(input.imageCount),
    reference_image_count: normalizeFiniteInt(input.referenceImageCount),
    estimated_cost_usd: normalizeFiniteNumber(input.estimatedCostUsd),
    metadata: toJsonSafe(input.metadata),
  };
}

export async function recordGeminiUsageEvent(input: GeminiUsageEventInput): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    if (!supabase) return;
    const row = toRow(input);
    const { error } = await supabase.from("vibode_gemini_usage_events").upsert(row, {
      onConflict: "attempt_id",
      ignoreDuplicates: true,
    });
    if (error) {
      console.warn("[gemini-usage] failed to record usage event", {
        message: error.message,
        attemptId: row.attempt_id,
        route: row.route,
      });
    }
  } catch (err: unknown) {
    console.warn("[gemini-usage] unexpected accounting error", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function withGeminiUsageAccounting<T>(
  context: AccountingContext,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const requestId = safeStr(context.requestId) ?? createRequestId("vibode");
  const attemptId =
    safeStr(context.attemptId) ??
    buildAttemptId({
      provider: context.provider,
      route: context.route,
      requestId,
    });

  try {
    const result = await fn();
    await recordGeminiUsageEvent({
      ...context,
      requestId,
      attemptId,
      status: "success",
      latencyMs: Date.now() - startedAt,
    });
    return result;
  } catch (err: unknown) {
    await recordGeminiUsageEvent({
      ...context,
      requestId,
      attemptId,
      status: "failure",
      latencyMs: Date.now() - startedAt,
      errorCode: toErrorCode(err),
      metadata: {
        ...(toJsonSafe(context.metadata) as Record<string, JsonSafeValue>),
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}
