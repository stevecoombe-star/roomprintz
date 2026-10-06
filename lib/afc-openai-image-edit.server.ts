import "server-only";

import { createHash } from "node:crypto";

import {
  AFC_SUNBURST_PROVIDER_MODEL_ID,
  AFC_SUNBURST_QUALITY,
  afcImageStageProvenance,
  resolveAfcImageModel,
  normalizeAfcSunburstOutputSize,
  type AfcImageStageProvenance,
} from "@/lib/afc-image-models";
import {
  afcEmptyRoomImagePrompt,
  afcTiledScaffoldImagePrompt,
} from "@/lib/afc-image-generation-prompts";

export const AFC_OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";
export const AFC_OPENAI_IMAGE_EDIT_TIMEOUT_MS = 120_000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RULE = "==================================================";
const PROMPT_RULE = "----------------------------------------";
const SUNBURST = resolveAfcImageModel("gpt-image-2.5-sunburst-high");

export type AfcOpenAiImageEditInput = Readonly<{
  stage: "empty" | "tiled";
  imageBytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  prompt?: string;
}>;

export type AfcOpenAiImageEditSuccess = Readonly<{
  ok: true;
  base64: string;
  bytes: Buffer;
  outputSize: string;
  provenance: AfcImageStageProvenance;
}>;

export type AfcOpenAiImageEditFailure = Readonly<{
  ok: false;
  reason: string;
}>;

export type AfcOpenAiImageEditResult =
  | AfcOpenAiImageEditSuccess
  | AfcOpenAiImageEditFailure;

/** Server-terminal sink. The default writes to the Next.js server log. */
export type AfcSunburstDiagnosticLogger = (message: string) => void;

export type AfcOpenAiImageEditDependencies = Readonly<{
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
  timeoutMs?: number;
  log?: AfcSunburstDiagnosticLogger;
  now?: () => number;
  /**
   * Test override. When omitted, the full prompt body is printed only when
   * VIBODE_LOG_AFC_IMAGE_PROMPTS=1.
   */
  logFullPrompt?: boolean;
}>;

type DiagnosticPhase = "before request" | "http" | "decode" | "png validation";

type SanitizedProviderError = Readonly<{
  type: string;
  code: string;
  message: string;
}>;

const UNAVAILABLE_ERROR: SanitizedProviderError = Object.freeze({
  type: "unavailable",
  code: "unavailable",
  message: "unavailable",
});

function stagePrompt(stage: "empty" | "tiled"): string {
  return stage === "empty" ? afcEmptyRoomImagePrompt() : afcTiledScaffoldImagePrompt();
}

function fileName(mimeType: AfcOpenAiImageEditInput["mimeType"]): string {
  if (mimeType === "image/jpeg") return "source.jpg";
  if (mimeType === "image/webp") return "source.webp";
  return "source.png";
}

function isCanonicalBase64(value: string): boolean {
  return value.length > 0
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
    && Buffer.from(value, "base64").toString("base64") === value;
}

function failure(reason: string): AfcOpenAiImageEditFailure {
  return Object.freeze({ ok: false, reason });
}

function readApiKey(explicit: string | null | undefined): string | null {
  if (explicit === null) return null;
  const value = (explicit ?? process.env.OPENAI_API_KEY ?? "").trim();
  return value.length > 0 ? value : null;
}

function decodePngBase64(value: unknown): Buffer | null {
  if (typeof value !== "string" || !isCanonicalBase64(value)) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength < PNG_MAGIC.byteLength) return null;
  if (!bytes.subarray(0, PNG_MAGIC.byteLength).equals(PNG_MAGIC)) return null;
  return bytes;
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  if (!bytes.subarray(0, PNG_MAGIC.byteLength).equals(PNG_MAGIC)) return null;
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

function stageLabel(stage: "empty" | "tiled"): "EMPTY" | "TILED" {
  return stage === "empty" ? "EMPTY" : "TILED";
}

function defaultDiagnosticLog(message: string): void {
  console.info(message);
}

function redactSecrets(message: string, apiKey: string | null): string {
  let text = message;
  if (apiKey && apiKey.length > 0) text = text.split(apiKey).join("[redacted]");
  return text
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/OPENAI_API_KEY/g, "API key");
}

function emitDiagnostic(
  log: AfcSunburstDiagnosticLogger,
  apiKey: string | null,
  message: string,
): void {
  try {
    log(redactSecrets(message, apiKey));
  } catch {
    // Terminal diagnostics must not change generation.
  }
}

function sanitizeToken(value: unknown): string {
  if (typeof value !== "string") return "unavailable";
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(trimmed) ? trimmed : "unavailable";
}

function sanitizeDiagnosticText(value: string): string {
  const text = redactSecrets(value, null).replace(/[\r\n\t]+/g, " ").trim();
  if (text.length === 0) return "unavailable";
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function localError(message: string): SanitizedProviderError {
  return Object.freeze({
    type: "unavailable",
    code: "unavailable",
    message: sanitizeDiagnosticText(message),
  });
}

function parseOpenAiError(text: string): SanitizedProviderError {
  try {
    const payload = JSON.parse(text.length > 8_000 ? text.slice(0, 8_000) : text) as {
      error?: unknown;
    };
    if (!payload.error || typeof payload.error !== "object" || Array.isArray(payload.error)) {
      return UNAVAILABLE_ERROR;
    }
    const record = payload.error as { type?: unknown; code?: unknown; message?: unknown };
    const message = typeof record.message === "string"
      ? sanitizeDiagnosticText(record.message)
      : "unavailable";
    return Object.freeze({
      type: sanitizeToken(record.type),
      code: sanitizeToken(record.code),
      message,
    });
  } catch {
    return UNAVAILABLE_ERROR;
  }
}

async function readOpenAiError(response: Response): Promise<SanitizedProviderError> {
  try {
    return parseOpenAiError(await response.text());
  } catch {
    return UNAVAILABLE_ERROR;
  }
}

function formatElapsed(startedAt: number, now: () => number): string {
  const elapsedMs = Math.max(0, now() - startedAt);
  return `${(elapsedMs / 1000).toFixed(2)}s`;
}

function identityLines(stage: "empty" | "tiled"): string[] {
  return [
    `[AFC SUNBURST ${stageLabel(stage)}] ${SUNBURST.displayName}`,
    `Stage: ${stageLabel(stage)}`,
    `Provider: ${SUNBURST.provider}`,
    `Model: ${SUNBURST.modelId}`,
    `Quality: ${SUNBURST.quality ?? "unavailable"}`,
  ];
}

function sourceLines(input: AfcOpenAiImageEditInput): string[] {
  return [
    "Source:",
    `  dimensions: ${input.width}x${input.height}`,
    `  bytes: ${input.imageBytes.byteLength}`,
    `  mime: ${input.mimeType}`,
  ];
}

function fullPromptLoggingEnabled(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  return process.env.VIBODE_LOG_AFC_IMAGE_PROMPTS?.trim() === "1";
}

function summarizePrompt(prompt: string): Readonly<{
  length: number;
  hash: string;
  firstLine: string;
}> {
  const first = prompt.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const firstLine = first.length > 120 ? `${first.slice(0, 117)}...` : first;
  return Object.freeze({
    length: prompt.length,
    hash: createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 12),
    firstLine,
  });
}

function promptLines(prompt: string, logFullPrompt: boolean): string[] {
  if (logFullPrompt) {
    return ["Prompt:", PROMPT_RULE, prompt, PROMPT_RULE];
  }
  const summary = summarizePrompt(prompt);
  return [
    "Prompt:",
    `  length: ${summary.length}`,
    `  hash: ${summary.hash}`,
    `  first_line: ${summary.firstLine}`,
  ];
}

function formatStart(
  input: AfcOpenAiImageEditInput,
  outputWidth: number,
  outputHeight: number,
  prompt: string,
  logFullPrompt: boolean,
): string {
  return [
    RULE,
    ...identityLines(input.stage),
    "",
    ...sourceLines(input),
    "",
    "Output request:",
    `  dimensions: ${outputWidth}x${outputHeight}`,
    "  format: png",
    "  background: opaque",
    "",
    ...promptLines(prompt, logFullPrompt),
    "",
    "Request started...",
    RULE,
  ].join("\n");
}

function formatSuccess(
  stage: "empty" | "tiled",
  elapsed: string,
  bytes: Buffer,
): string {
  const dimensions = readPngDimensions(bytes);
  return [
    RULE,
    `[AFC SUNBURST ${stageLabel(stage)}] Request completed in ${elapsed}`,
    "Result:",
    `  dimensions: ${dimensions ? `${dimensions.width}x${dimensions.height}` : "unavailable"}`,
    `  bytes: ${bytes.byteLength}`,
    "  format: png",
    RULE,
  ].join("\n");
}

function formatFailure(args: {
  stage: "empty" | "tiled";
  elapsed: string;
  phase: DiagnosticPhase;
  httpStatus: number | null;
  requestedDimensions: string;
  error: SanitizedProviderError;
}): string {
  return [
    RULE,
    `[AFC SUNBURST ${stageLabel(args.stage)}] Request failed in ${args.elapsed}`,
    `Phase: ${args.phase}`,
    `HTTP status: ${args.httpStatus ?? "unavailable"}`,
    `Requested dimensions: ${args.requestedDimensions}`,
    `Error type: ${args.error.type}`,
    `Error code: ${args.error.code}`,
    `Error message: ${args.error.message}`,
    RULE,
  ].join("\n");
}

function httpReason(status: number): string {
  if (status === 401 || status === 403) {
    return "GPT Image 2.5 Sunburst High authentication failed.";
  }
  if (status === 429) return "GPT Image 2.5 Sunburst High rate limit was reached.";
  if (status === 400) return "GPT Image 2.5 Sunburst High rejected the image edit request.";
  if (status >= 500 && status <= 599) {
    return "GPT Image 2.5 Sunburst High image edit failed upstream.";
  }
  return "GPT Image 2.5 Sunburst High image edit failed.";
}

/**
 * OpenAI Image Edit for GPT Image 2.5 Sunburst High.
 * The API key is read only on the server and is never returned or logged.
 * Diagnostic blocks go to the server terminal only.
 */
export async function editAfcImageWithOpenAi(
  input: AfcOpenAiImageEditInput,
  dependencies: AfcOpenAiImageEditDependencies = {},
): Promise<AfcOpenAiImageEditResult> {
  const now = dependencies.now ?? (() => performance.now());
  const startedAt = now();
  const log = dependencies.log ?? defaultDiagnosticLog;
  const apiKey = readApiKey(dependencies.apiKey);
  const elapsed = () => formatElapsed(startedAt, now);

  const failClosed = (
    reason: string,
    phase: DiagnosticPhase,
    httpStatus: number | null,
    requestedDimensions: string,
    error: SanitizedProviderError,
  ): AfcOpenAiImageEditFailure => {
    emitDiagnostic(log, apiKey, formatFailure({
      stage: input.stage,
      elapsed: elapsed(),
      phase,
      httpStatus,
      requestedDimensions,
      error,
    }));
    return failure(reason);
  };

  if (!apiKey) {
    return failClosed(
      "GPT Image 2.5 Sunburst High is not configured (missing OPENAI_API_KEY).",
      "before request",
      null,
      "unavailable",
      localError("GPT Image 2.5 Sunburst High is not configured (missing OPENAI_API_KEY)."),
    );
  }
  if (input.imageBytes.byteLength === 0) {
    return failClosed(
      "GPT Image 2.5 Sunburst High received an empty source image.",
      "before request",
      null,
      "unavailable",
      localError("GPT Image 2.5 Sunburst High received an empty source image."),
    );
  }
  const size = normalizeAfcSunburstOutputSize(input.width, input.height);
  if (!size.ok) {
    return failClosed(
      `GPT Image 2.5 Sunburst High ${size.reason}`,
      "before request",
      null,
      "unavailable",
      localError(`GPT Image 2.5 Sunburst High ${size.reason}`),
    );
  }

  const prompt = input.prompt ?? stagePrompt(input.stage);
  const logFullPrompt = fullPromptLoggingEnabled(dependencies.logFullPrompt);
  const requestedDimensions = `${size.width}x${size.height}`;
  const form = new FormData();
  form.set("model", AFC_SUNBURST_PROVIDER_MODEL_ID);
  form.set("prompt", prompt);
  form.set("quality", AFC_SUNBURST_QUALITY);
  form.set("size", size.size);
  form.set("output_format", "png");
  form.set("background", "opaque");
  form.set(
    "image",
    new File(
      [Uint8Array.from(input.imageBytes)],
      fileName(input.mimeType),
      { type: input.mimeType },
    ),
  );

  emitDiagnostic(
    log,
    apiKey,
    formatStart(input, size.width, size.height, prompt, logFullPrompt),
  );

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? AFC_OPENAI_IMAGE_EDIT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(AFC_OPENAI_IMAGE_EDIT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = typeof error === "object"
      && error !== null
      && (error as { name?: unknown }).name === "AbortError";
    return failClosed(
      aborted
        ? "GPT Image 2.5 Sunburst High image edit timed out."
        : "GPT Image 2.5 Sunburst High image edit request failed.",
      "http",
      null,
      requestedDimensions,
      localError(aborted ? "image edit timed out" : "image edit request failed"),
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const providerError = await readOpenAiError(response);
    const reason = httpReason(response.status);
    const error = providerError.type === "unavailable"
      && providerError.code === "unavailable"
      && providerError.message === "unavailable"
      ? localError(reason)
      : Object.freeze({
        ...providerError,
        message: providerError.message === "unavailable"
          ? sanitizeDiagnosticText(reason)
          : providerError.message,
      });
    return failClosed(
      reason,
      "http",
      response.status,
      requestedDimensions,
      error,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failClosed(
      "GPT Image 2.5 Sunburst High returned a malformed response.",
      "decode",
      response.status,
      requestedDimensions,
      localError("GPT Image 2.5 Sunburst High returned a malformed response."),
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return failClosed(
      "GPT Image 2.5 Sunburst High returned a malformed response.",
      "decode",
      response.status,
      requestedDimensions,
      localError("GPT Image 2.5 Sunburst High returned a malformed response."),
    );
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) {
    return failClosed(
      "GPT Image 2.5 Sunburst High returned an empty image result.",
      "decode",
      response.status,
      requestedDimensions,
      localError("GPT Image 2.5 Sunburst High returned an empty image result."),
    );
  }
  const first = data[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return failClosed(
      "GPT Image 2.5 Sunburst High returned a malformed response.",
      "decode",
      response.status,
      requestedDimensions,
      localError("GPT Image 2.5 Sunburst High returned a malformed response."),
    );
  }
  const encoded = (first as { b64_json?: unknown }).b64_json;
  if (typeof encoded !== "string" || encoded.trim().length === 0) {
    return failClosed(
      "GPT Image 2.5 Sunburst High did not return base64 image data.",
      "decode",
      response.status,
      requestedDimensions,
      localError("GPT Image 2.5 Sunburst High did not return base64 image data."),
    );
  }
  const bytes = decodePngBase64(encoded);
  if (!bytes) {
    return failClosed(
      "GPT Image 2.5 Sunburst High returned malformed image data.",
      "png validation",
      response.status,
      requestedDimensions,
      localError("GPT Image 2.5 Sunburst High returned malformed image data."),
    );
  }
  emitDiagnostic(
    log,
    apiKey,
    formatSuccess(input.stage, elapsed(), bytes),
  );
  return Object.freeze({
    ok: true,
    base64: bytes.toString("base64"),
    bytes,
    outputSize: size.size,
    provenance: afcImageStageProvenance(input.stage, "gpt-image-2.5-sunburst-high"),
  });
}
