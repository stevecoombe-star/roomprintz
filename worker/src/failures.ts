export const WORKER_FAILURE_CODES = [
  "browser_launch_failed",
  "navigation_timeout",
  "render_timeout",
  "render_access_denied",
  "render_page_error",
  "glb_load_failed",
  "signed_url_failed",
  "screenshot_failed",
  "encode_failed",
  "publish_failed",
  "upload_failed",
] as const;

export type WorkerFailureCode = (typeof WORKER_FAILURE_CODES)[number];

const RETRYABLE = new Set<string>([
  "browser_launch_failed",
  "navigation_timeout",
  "render_timeout",
  "render_page_error",
  "glb_load_failed",
  "signed_url_failed",
  "screenshot_failed",
  "encode_failed",
  "publish_failed",
  "upload_failed",
]);

const PAGE_CODES = new Set<string>([
  "render_access_denied",
  "scene_missing",
  "scene_empty",
  "generation_mismatch",
  "background_missing",
  "camera_authority_missing",
  "glb_identity_missing",
  "signed_url_failed",
  "glb_load_failed",
  "render_page_error",
]);

export type WorkerFailure = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export function workerFailure(code: string, message: string): WorkerFailure {
  const safeCode = code.trim().slice(0, 80) || "render_page_error";
  return {
    code: safeCode,
    message: message.trim().slice(0, 240) || safeCode,
    retryable: RETRYABLE.has(safeCode),
  };
}

export function failureFromPage(code: string | undefined, message: string | undefined): WorkerFailure {
  const safe = code && PAGE_CODES.has(code) ? code : "render_page_error";
  return workerFailure(safe, message || "Render page failed.");
}

export function failureFromTimeout(stage: "navigation" | "ready" | "screenshot" | "publish"): WorkerFailure {
  if (stage === "navigation") return workerFailure("navigation_timeout", "Render page navigation timed out.");
  if (stage === "ready") return workerFailure("render_timeout", "Render readiness timed out.");
  if (stage === "screenshot") return workerFailure("screenshot_failed", "Thumbnail frame screenshot timed out.");
  return workerFailure("publish_failed", "Thumbnail publish timed out.");
}

export function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout/i.test(message);
}
