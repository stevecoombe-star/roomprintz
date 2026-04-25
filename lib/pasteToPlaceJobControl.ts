export const PASTE_TO_PLACE_JOB_ID_HEADER = "x-vibode-paste-to-place-job-id";
export const PASTE_TO_PLACE_SCOPE_ID_HEADER = "x-vibode-paste-to-place-scope-id";

export const PASTE_TO_PLACE_CANCELLED_CODE = "PASTE_TO_PLACE_CANCELLED";

export type PasteToPlaceJobControl = {
  jobId: string;
  scopeId: string;
};

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function parsePasteToPlaceJobControlFromBody(
  body: Record<string, unknown>
): PasteToPlaceJobControl | null {
  const raw = body.pasteToPlaceControl;
  if (!isRecord(raw)) return null;
  const jobId = safeString(raw.jobId);
  const scopeId = safeString(raw.scopeId);
  if (!jobId || !scopeId) return null;
  return { jobId, scopeId };
}

export function isPasteToPlaceCancelledResponsePayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (payload.code === PASTE_TO_PLACE_CANCELLED_CODE) return true;
  return payload.cancelled === true;
}
