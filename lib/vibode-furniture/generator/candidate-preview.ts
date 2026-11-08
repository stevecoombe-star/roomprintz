import { previewLoadPlan } from "./preview";

const JOB_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CandidatePreviewResult =
  | Readonly<{ ok: true; previewUrl: string }>
  | Readonly<{ ok: false; message: string }>;

export function candidatePreviewVisible(isAdmin: boolean | null): boolean {
  return isAdmin === true;
}

export function candidatePreviewFailure(status: number): string {
  if (status === 401) return "Sign in again to preview this model.";
  if (status === 404) {
    return "That generated model is not available. It may belong to another account or may have expired.";
  }
  return "The preview could not be opened.";
}

export async function requestCandidatePreview(input: Readonly<{
  jobId: string;
  token: string;
  fetchImpl?: typeof fetch;
}>): Promise<CandidatePreviewResult> {
  const jobId = input.jobId.trim();
  if (!JOB_ID.test(jobId)) return { ok: false, message: "Enter a valid generation job ID." };
  if (!input.token) return { ok: false, message: "Sign in again to preview this model." };
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`/api/vibode/furniture-generations/${jobId}/preview`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.token}` },
    });
  } catch {
    return { ok: false, message: "The preview could not be opened." };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) return { ok: false, message: candidatePreviewFailure(response.status) };
  const previewUrl = readPreviewUrl(payload);
  if (!previewUrl) return { ok: false, message: "The preview could not be opened." };
  const plan = previewLoadPlan({ kind: "candidate", label: "Generated model", url: previewUrl, jobId });
  if (plan.action !== "load") return { ok: false, message: plan.message };
  return { ok: true, previewUrl };
}

function readPreviewUrl(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const record = payload as { ok?: unknown; previewUrl?: unknown };
  if (record.ok !== true || typeof record.previewUrl !== "string") return "";
  return record.previewUrl;
}
