/**
 * Browser call for one owner-authorized calibrated save.
 * The bearer token and any signed preview URL stay out of the result.
 */

import type { CalibrationAxis } from "@/lib/vibode-furniture/generation/calibrate";

import { candidateJobId } from "./calibration-ui";

export type CalibratedSaveClientResult =
  | Readonly<{
      ok: true;
      idempotent: boolean;
      assetId: string;
      displayName: string;
    }>
  | Readonly<{
      ok: false;
      errorCode: string;
      message: string;
    }>;

export async function saveCalibratedCandidate(input: Readonly<{
  jobId: string;
  token: string;
  displayName: string;
  category: string | null;
  axis: CalibrationAxis;
  targetM: number;
  fetchImpl?: typeof fetch;
}>): Promise<CalibratedSaveClientResult> {
  const jobId = candidateJobId(input.jobId);
  if (!jobId || !input.token) {
    return { ok: false, errorCode: "UNAUTHORIZED", message: messageFor(401, "UNAUTHORIZED") };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`/api/vibode/furniture-generations/${jobId}/save`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: input.displayName,
        category: input.category,
        axis: input.axis,
        targetM: input.targetM,
      }),
    });
  } catch {
    return {
      ok: false,
      errorCode: "NETWORK",
      message: "The model could not be saved. Check the connection and try again.",
    };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return readSaveResponse(response.status, payload);
}

function readSaveResponse(status: number, payload: unknown): CalibratedSaveClientResult {
  const record = payload && typeof payload === "object" ? payload as {
    ok?: unknown;
    idempotent?: unknown;
    error?: unknown;
    errorCode?: unknown;
    item?: { assetId?: unknown; displayName?: unknown };
  } : {};
  const errorCode = typeof record.errorCode === "string" ? record.errorCode : "";
  if (status === 200 && record.ok === true && record.item) {
    const assetId = record.item.assetId;
    const displayName = record.item.displayName;
    if (typeof assetId === "string" && typeof displayName === "string" && displayName.trim()) {
      return {
        ok: true,
        idempotent: record.idempotent === true,
        assetId,
        displayName,
      };
    }
  }
  const code = errorCode || (status === 401 ? "UNAUTHORIZED" : "SAVE_FAILED");
  return { ok: false, errorCode: code, message: messageFor(status, code) };
}

function messageFor(status: number, code: string): string {
  if (status === 401 || code === "UNAUTHORIZED") return "Sign in again to save this model.";
  if (code === "CANDIDATE_EXPIRED") return "This generated model has expired.";
  if (code === "ALREADY_SAVED") return "This model was already saved at a different size.";
  if (code === "NOT_FOUND" || code === "CANDIDATE_MISSING" || status === 404) {
    return "That generated model is not available. It may belong to another account or may have expired.";
  }
  if (code === "INVALID_NAME") return "Enter a name up to 80 characters.";
  if (code === "INVALID_CATEGORY") return "Category must be 40 characters or fewer.";
  if (code === "INVALID_TARGET" || code === "IMPLAUSIBLE_SIZE") {
    return "That size is outside the supported range of 0.05 m to 8 m.";
  }
  if (code === "SOURCE_MISMATCH" || code === "ASSET_EXISTS") {
    return "This model could not be saved from the current candidate.";
  }
  if (code === "FILE_TOO_LARGE") return "This model is too large to save.";
  if (code === "NETWORK") return "The model could not be saved. Check the connection and try again.";
  return "The model could not be saved. Please try again.";
}
