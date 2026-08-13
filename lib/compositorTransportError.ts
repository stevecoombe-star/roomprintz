import "server-only";

export type CompositorTransportSeam =
  | "tile-floor-reader"
  | "ts0-child-placement"
  | "readiness"
  | "stage-run";

export type CompositorTransportErrorClass =
  | "connection_failure"
  | "timeout"
  | "http_404"
  | "http_401"
  | "http_403"
  | "http_422"
  | "http_5xx"
  | "http_other"
  | "malformed_response"
  | "missing_image_artifact"
  | "client_construction_failure";

export type SanitizedCompositorEndpoint = Readonly<{
  host: string;
  port: string;
  path: string;
}>;

export type CompositorTransportDiagnostic = Readonly<{
  seam: CompositorTransportSeam;
  class: CompositorTransportErrorClass;
  httpStatus: number | null;
  osCode: string | null;
  message: string;
  endpoint: SanitizedCompositorEndpoint | null;
}>;

const ENDPOINT_SUFFIXES = Object.freeze([
  /\/stage-room\/?$/,
  /\/api\/vibode\/stage-run\/?$/,
  /\/vibode\/stage-run\/?$/,
  /\/vibode\/compose\/?$/,
  /\/vibode\/remove\/?$/,
  /\/vibode\/swap\/?$/,
  /\/vibode\/rotate\/?$/,
  /\/vibode\/full_vibe\/?$/,
]);

function fixedMessage(
  classification: CompositorTransportErrorClass,
  httpStatus: number | null
): string {
  if (classification.startsWith("http_")) {
    return `Compositor returned HTTP ${httpStatus ?? "error"}.`;
  }
  switch (classification) {
    case "connection_failure":
      return "Compositor connection failed.";
    case "timeout":
      return "Compositor request timed out.";
    case "malformed_response":
      return "Compositor returned malformed JSON.";
    case "missing_image_artifact":
      return "Compositor response did not contain an image artifact.";
    case "client_construction_failure":
      return "Compositor client request could not be constructed.";
    default:
      return "Compositor transport failed.";
  }
}

function safeOsCode(error: unknown): string | null {
  let value = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.code === "string" &&
      /^[A-Z0-9_]{1,64}$/.test(record.code)
    ) {
      return record.code;
    }
    value = record.cause;
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function httpClass(status: number): CompositorTransportErrorClass {
  if (status === 404) return "http_404";
  if (status === 401) return "http_401";
  if (status === 403) return "http_403";
  if (status === 422) return "http_422";
  if (status >= 500 && status <= 599) return "http_5xx";
  return "http_other";
}

export class CompositorTransportError extends Error {
  readonly seam: CompositorTransportSeam;
  readonly classification: CompositorTransportErrorClass;
  readonly httpStatus: number | null;
  readonly osCode: string | null;
  readonly endpoint: SanitizedCompositorEndpoint | null;

  constructor(args: {
    seam: CompositorTransportSeam;
    classification: CompositorTransportErrorClass;
    httpStatus?: number | null;
    osCode?: string | null;
    endpoint?: SanitizedCompositorEndpoint | null;
  }) {
    const httpStatus = args.httpStatus ?? null;
    super(fixedMessage(args.classification, httpStatus));
    this.name = "CompositorTransportError";
    this.seam = args.seam;
    this.classification = args.classification;
    this.httpStatus = httpStatus;
    this.osCode = args.osCode ?? null;
    this.endpoint = args.endpoint ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function toCompositorTransportDiagnostic(
  error: CompositorTransportError
): CompositorTransportDiagnostic {
  return Object.freeze({
    seam: error.seam,
    class: error.classification,
    httpStatus: error.httpStatus,
    osCode: error.osCode,
    message: error.message,
    endpoint:
      error.endpoint === null ? null : Object.freeze({ ...error.endpoint }),
  });
}

export function resolveCompositorEndpoint(path: string): Readonly<{
  url: string;
  endpoint: SanitizedCompositorEndpoint;
}> {
  const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();
  if (!endpointBase) {
    throw new Error("missing compositor URL");
  }
  let normalized = endpointBase;
  for (const suffix of ENDPOINT_SUFFIXES) {
    normalized = normalized.replace(suffix, "");
  }
  normalized = normalized.replace(/\/$/, "");
  const url = new URL(`${normalized}${path}`);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("invalid compositor URL");
  }
  return Object.freeze({
    url: url.toString(),
    endpoint: Object.freeze({
      host: url.hostname,
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
      path: url.pathname,
    }),
  });
}

export async function callCompositorJson(args: {
  seam: CompositorTransportSeam;
  path: string;
  method?: "GET" | "POST";
  payload?: unknown;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}): Promise<unknown> {
  let resolved: ReturnType<typeof resolveCompositorEndpoint>;
  let body: string | undefined;
  try {
    resolved = resolveCompositorEndpoint(args.path);
    body =
      args.payload === undefined ? undefined : JSON.stringify(args.payload);
  } catch {
    throw new CompositorTransportError({
      seam: args.seam,
      classification: "client_construction_failure",
    });
  }

  const headers: Record<string, string> = { ...(args.headers ?? {}) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(resolved.url, {
      method: args.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
      signal: args.signal,
    });
  } catch (error) {
    throw new CompositorTransportError({
      seam: args.seam,
      classification: isAbortError(error) ? "timeout" : "connection_failure",
      osCode: safeOsCode(error),
      endpoint: resolved.endpoint,
    });
  }

  if (!response.ok) {
    throw new CompositorTransportError({
      seam: args.seam,
      classification: httpClass(response.status),
      httpStatus: response.status,
      endpoint: resolved.endpoint,
    });
  }
  try {
    return await response.json();
  } catch {
    throw new CompositorTransportError({
      seam: args.seam,
      classification: "malformed_response",
      httpStatus: response.status,
      endpoint: resolved.endpoint,
    });
  }
}
