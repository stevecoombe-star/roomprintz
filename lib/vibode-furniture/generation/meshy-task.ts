/**
 * Meshy task parsing, HTTP error normalization, and list reconciliation.
 *
 * Create returns 202 `{ "result": "<task id>" }`. Status values are
 * PENDING, IN_PROGRESS, SUCCEEDED, FAILED, and CANCELED. A timeout, a
 * network failure, or a 5xx on create is ambiguous: Meshy may already
 * have billed a task. GET failures are not task failures.
 *
 * OpenAPI and the errors guide, checked 2026-11-06.
 */

import { MESHY_ASSET_HOST } from "./policy";
import { redactSensitiveGenerationText } from "./redact";

export const MESHY_TASK_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
] as const;

export type MeshyTaskStatus = (typeof MESHY_TASK_STATUSES)[number];

export type MeshyProviderErrorClass =
  | "provider_rejected"
  | "provider_payment"
  | "provider_auth"
  | "provider_forbidden"
  | "rate_limited"
  | "ambiguous_timeout"
  | "provider_failed"
  | "credit_unreported";

export type MeshyTaskError = Readonly<{
  type: string | null;
  code: string | null;
  message: string;
}>;

export type MeshyTask = Readonly<{
  id: string;
  name: string | null;
  type: string | null;
  status: MeshyTaskStatus;
  progress: number;
  createdAtMs: number | null;
  expiresAtMs: number | null;
  consumedCredits: number | null;
  glbUrl: string | null;
  taskError: MeshyTaskError | null;
}>;

export type MeshyTransportCall = Readonly<{
  method: "GET" | "POST";
  path: string;
  body?: Readonly<Record<string, unknown>>;
  timeoutMs: number;
}>;

export type MeshyTransportResult =
  | Readonly<{
    kind: "response";
    status: number;
    headers: Readonly<Record<string, string>>;
    body: unknown;
    unparsed: boolean;
  }>
  | Readonly<{ kind: "timeout" }>
  | Readonly<{ kind: "network" }>;

export type MeshyTransport = {
  request(call: MeshyTransportCall): Promise<MeshyTransportResult>;
};

const TASK_ID = /^[A-Za-z0-9-]{8,80}$/;

export function normalizeMeshyHttpFailure(input: Readonly<{
  status: number;
  body: unknown;
  method: "GET" | "POST";
}>): Readonly<{
  errorClass: MeshyProviderErrorClass;
  errorCode: string;
  message: string;
  retryAfterMs: number | null;
  ambiguous: boolean;
}> {
  const message = sanitizeMessage(readMessage(input.body));
  if (input.status === 429) {
    return {
      errorClass: "rate_limited",
      errorCode: "rate_limited",
      message: message || "Meshy asked Vibode to wait.",
      retryAfterMs: null,
      ambiguous: false,
    };
  }
  if (input.status === 401) {
    return {
      errorClass: "provider_auth",
      errorCode: "provider_auth",
      message: "Meshy rejected the server credential.",
      retryAfterMs: null,
      ambiguous: false,
    };
  }
  if (input.status === 402) {
    return {
      errorClass: "provider_payment",
      errorCode: "provider_payment",
      message: "Meshy refused the task for credits or plan.",
      retryAfterMs: null,
      ambiguous: false,
    };
  }
  if (input.status === 403) {
    return {
      errorClass: "provider_forbidden",
      errorCode: "provider_forbidden",
      message: "Meshy refused the task.",
      retryAfterMs: null,
      ambiguous: false,
    };
  }
  if (input.status === 400 || input.status === 404 || input.status === 409 || input.status === 422) {
    return {
      errorClass: "provider_rejected",
      errorCode: `http_${input.status}`,
      message: message || "Meshy rejected the request.",
      retryAfterMs: null,
      ambiguous: false,
    };
  }
  return {
    errorClass: "ambiguous_timeout",
    errorCode: input.method === "POST" ? "create_unconfirmed" : "status_unconfirmed",
    message: "Meshy did not confirm the request.",
    retryAfterMs: null,
    ambiguous: input.method === "POST",
  };
}

export function normalizeMeshyTaskFailure(task: MeshyTask): Readonly<{
  errorClass: "provider_failed";
  errorCode: string;
  message: string;
}> {
  const type = task.taskError?.type ?? "unknown";
  const code = task.taskError?.code ?? type;
  return {
    errorClass: "provider_failed",
    errorCode: code.slice(0, 80),
    message: redactSensitiveGenerationText(task.taskError?.message || "Meshy failed the task."),
  };
}

export function parseMeshyTask(value: unknown): MeshyTask | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !TASK_ID.test(record.id)) return null;
  if (!isStatus(record.status)) return null;
  const progress = typeof record.progress === "number" && Number.isFinite(record.progress)
    ? Math.max(0, Math.min(100, Math.trunc(record.progress)))
    : 0;
  const modelUrls = record.model_urls;
  let glbUrl: string | null = null;
  if (modelUrls && typeof modelUrls === "object" && "glb" in modelUrls) {
    const glb = (modelUrls as { glb?: unknown }).glb;
    glbUrl = typeof glb === "string" && glb.trim() ? glb.trim() : null;
  }
  return {
    id: record.id,
    name: typeof record.name === "string" ? record.name : null,
    type: typeof record.type === "string" ? record.type : null,
    status: record.status,
    progress,
    createdAtMs: epochMs(record.created_at),
    expiresAtMs: epochMs(record.expires_at),
    consumedCredits: credits(record.consumed_credits),
    glbUrl,
    taskError: parseTaskError(record.task_error),
  };
}

export function parseMeshyTaskId(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("result" in body)) return null;
  const result = (body as { result?: unknown }).result;
  if (typeof result !== "string" || !TASK_ID.test(result)) return null;
  return result;
}

export type MeshyListMatch =
  | Readonly<{ kind: "unique"; task: MeshyTask }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "incomplete" }>
  | Readonly<{ kind: "conflict" }>;

/**
 * A full page whose oldest row is still inside the search window is not
 * proof of absence. Reconciliation must not resubmit in that case.
 */
export function matchListedMeshyTask(input: Readonly<{
  tasks: readonly MeshyTask[];
  taskName: string;
  contactedAtMs: number;
  pageFull: boolean;
}>): MeshyListMatch {
  const windowStart = input.contactedAtMs - 5_000;
  const matches = input.tasks.filter((task) => {
    if (task.name !== input.taskName) return false;
    if (task.createdAtMs == null) return true;
    return task.createdAtMs >= windowStart;
  });
  if (matches.length > 1) return { kind: "conflict" };
  if (matches.length === 1) return { kind: "unique", task: matches[0] };
  const created = input.tasks.flatMap((task) => task.createdAtMs == null ? [] : [task.createdAtMs]);
  const oldest = created.length > 0 ? Math.min(...created) : null;
  if (input.pageFull && (oldest == null || oldest >= windowStart)) return { kind: "incomplete" };
  return { kind: "absent" };
}

export function meshyAssetUrlDecision(input: Readonly<{
  url: string;
  nowMs: number;
  expiresAtMs: number | null;
}>): "ok" | "invalid" | "host" | "protocol" | "credentials" | "expired" {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return "invalid";
  }
  if (parsed.username || parsed.password) return "credentials";
  if (parsed.protocol !== "https:") return "protocol";
  if (parsed.hostname !== MESHY_ASSET_HOST) return "host";
  if (!parsed.pathname.includes("/tasks/") || !parsed.pathname.toLowerCase().endsWith(".glb")) {
    return "invalid";
  }
  const expires = parsed.searchParams.get("Expires");
  if (expires) {
    const seconds = Number(expires);
    if (!Number.isFinite(seconds) || seconds * 1000 <= input.nowMs) return "expired";
  }
  if (input.expiresAtMs != null && input.expiresAtMs <= input.nowMs) return "expired";
  return "ok";
}

export function headerValue(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}

function parseTaskError(value: unknown): MeshyTaskError | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const message = typeof record.message === "string" ? redactSensitiveGenerationText(record.message) : "";
  if (!message) return null;
  return {
    type: typeof record.type === "string" ? record.type.slice(0, 80) : null,
    code: typeof record.code === "string" ? record.code.slice(0, 80) : null,
    message,
  };
}

function isStatus(value: unknown): value is MeshyTaskStatus {
  return typeof value === "string" && (MESHY_TASK_STATUSES as readonly string[]).includes(value);
}

function epochMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

function credits(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000) return null;
  return value;
}

function readMessage(body: unknown): string {
  if (!body || typeof body !== "object" || !("message" in body)) return "";
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function sanitizeMessage(message: string): string {
  return redactSensitiveGenerationText(message);
}
