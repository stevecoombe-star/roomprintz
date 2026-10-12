import type { HarmonizeJobStatus, HarmonizeJobStatusView } from "./types";

const STATUSES = new Set<HarmonizeJobStatus>(["queued", "running", "succeeded", "failed", "cancelled"]);

/** Owner status. Prompt text, storage paths, and image bytes stay off this view. */
export function harmonizeJobStatusView(row: Readonly<{
  id: string;
  status: HarmonizeJobStatus;
  failureCode: string | null;
  failureMessage: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  outputMime: string | null;
  outputSha256: string | null;
  providerStartedAtMs: number | null;
  createdAtMs: number;
  completedAtMs: number | null;
  requestedModelId: string;
  returnedModelId: string | null;
  latencyMs: number | null;
  providerHttpStatus: number | null;
  providerStatus: string | null;
}>): HarmonizeJobStatusView {
  return {
    id: row.id,
    status: row.status,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    outputWidth: row.outputWidth,
    outputHeight: row.outputHeight,
    outputMime: row.outputMime,
    outputSha256: row.outputSha256,
    providerStartedAt: iso(row.providerStartedAtMs),
    createdAt: iso(row.createdAtMs) ?? new Date(0).toISOString(),
    completedAt: iso(row.completedAtMs),
    requestedModel: row.requestedModelId,
    returnedModel: row.returnedModelId,
    latencyMs: row.latencyMs,
    providerHttpStatus: row.providerHttpStatus,
    providerStatus: row.providerStatus,
  };
}

export function harmonizeStatusFromRecord(row: Record<string, unknown>): HarmonizeJobStatusView | null {
  const id = typeof row.id === "string" ? row.id : "";
  const status = typeof row.status === "string" && STATUSES.has(row.status as HarmonizeJobStatus)
    ? row.status as HarmonizeJobStatus
    : null;
  const requestedModel = typeof row.requested_model_id === "string" ? row.requested_model_id : "";
  const createdAt = typeof row.created_at === "string" ? Date.parse(row.created_at) : Number.NaN;
  if (!id || !status || !requestedModel || !Number.isFinite(createdAt)) return null;
  return harmonizeJobStatusView({
    id,
    status,
    failureCode: typeof row.failure_code === "string" ? row.failure_code : null,
    failureMessage: typeof row.failure_message === "string" ? row.failure_message : null,
    outputWidth: typeof row.output_width === "number" ? row.output_width : null,
    outputHeight: typeof row.output_height === "number" ? row.output_height : null,
    outputMime: typeof row.output_mime === "string" ? row.output_mime : null,
    outputSha256: typeof row.output_sha256 === "string" ? row.output_sha256 : null,
    providerStartedAtMs: typeof row.provider_started_at === "string" ? Date.parse(row.provider_started_at) : null,
    createdAtMs: createdAt,
    completedAtMs: typeof row.completed_at === "string" ? Date.parse(row.completed_at) : null,
    requestedModelId: requestedModel,
    returnedModelId: typeof row.returned_model_id === "string" ? row.returned_model_id : null,
    latencyMs: typeof row.latency_ms === "number" ? row.latency_ms : null,
    providerHttpStatus: typeof row.provider_http_status === "number" ? row.provider_http_status : null,
    providerStatus: typeof row.provider_status === "string" ? row.provider_status : null,
  });
}

export function harmonizePublicStatus(code: string): number {
  switch (code) {
    case "disabled":
    case "not_found":
    case "source_version_not_found":
    case "scene_missing":
      return 404;
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "daily_limit":
      return 429;
    case "active_job":
    case "idempotency_conflict":
    case "stale_scene":
    case "stale_background":
    case "stale_materials":
    case "stale_prompt":
    case "stale_generation":
      return 409;
    case "unavailable":
    case "authority_unavailable":
    case "catalog_unavailable":
    case "source_unreadable":
      return 503;
    default:
      return 400;
  }
}

export function harmonizePublicBody(code: string): Readonly<{ error: string }> {
  if (
    code === "disabled"
    || code === "unauthenticated"
    || code === "forbidden"
    || code === "not_found"
    || code === "source_version_not_found"
  ) {
    return { error: "Not found." };
  }
  return { error: code };
}

function iso(ms: number | null): string | null {
  if (ms == null) return null;
  return new Date(ms).toISOString();
}
