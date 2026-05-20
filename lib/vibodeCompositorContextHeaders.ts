import { createRequestId, getRequestIdFromHeaders } from "@/lib/vibodeGeminiUsageAccounting";

type HeaderSource = Pick<Headers, "get"> | null | undefined;

type VibodeCompositorContext = {
  requestId?: string | null;
  operationId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  roomId?: string | null;
  versionId?: string | null;
  assetId?: string | null;
  workflowType?: string | null;
  actionType?: string | null;
  sourceTrigger?: string | null;
};

function safeHeaderValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[\r\n]+/g, " ");
}

export function resolveVibodeRequestIdFromHeaders(headers: HeaderSource): string {
  return getRequestIdFromHeaders(headers, "vibode");
}

export function resolveVibodeOperationIdFromHeaders(headers: HeaderSource): string {
  const existing = safeHeaderValue(headers?.get("x-vibode-operation-id"));
  return existing ?? createRequestId("vibode-op");
}

export function buildVibodeCompositorContextHeaders(
  context: VibodeCompositorContext
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: unknown) => {
    const safe = safeHeaderValue(value);
    if (safe) out[key] = safe;
  };

  put("x-vibode-request-id", context.requestId);
  put("x-vibode-operation-id", context.operationId);
  put("x-vibode-user-id", context.userId);
  put("x-vibode-user-email", context.userEmail);
  put("x-vibode-room-id", context.roomId);
  put("x-vibode-version-id", context.versionId);
  put("x-vibode-asset-id", context.assetId);
  put("x-vibode-workflow-type", context.workflowType);
  put("x-vibode-action-type", context.actionType);
  put("x-vibode-source-trigger", context.sourceTrigger);

  return out;
}
