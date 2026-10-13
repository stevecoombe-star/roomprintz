/**
 * HARMONIZE-3A direct Nano Banana Pro proof.
 *
 * One Interactions API create. Follow-up GETs only read that same interaction.
 * This module does not enqueue jobs, write History, or call the compositor.
 */

import {
  classifyNanoBananaProAspectRatio,
  type NanoBananaProAspectRatio,
} from "@/lib/afc-image-models";

import {
  HARMONIZE_ASPECT_RELATIVE_TOLERANCE,
  readPngSize,
  sha256HexBytes,
} from "./harmonize-export";
import {
  HARMONIZE_UNIVERSAL_PROMPT_V2,
  HARMONIZE_UNIVERSAL_PROMPT_VERSION,
} from "./harmonize-universal-prompt-v2";

export const HARMONIZE_NBP_MODEL_ID = "gemini-3-pro-image" as const;

export const HARMONIZE_NBP_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions" as const;

export const HARMONIZE_NBP_ASPECT_RATIO = "4:3" as const;

export const HARMONIZE_NBP_IMAGE_SIZE = "2K" as const;

/** Official Gemini 3 Pro Image 2K frame for 4:3. */
export const HARMONIZE_NBP_OUTPUT_WIDTH = 2400;

export const HARMONIZE_NBP_OUTPUT_HEIGHT = 1792;

/**
 * Long-edge floor for a non-4:3 result requested at image_size 2K.
 *
 * The only verified 2K frame is 4:3 at 2400×1792. Its short edge is 1792.
 * Every documented 1K grid has a long edge of at most 1584, so this floor
 * rejects those grids. Exact 2K pixel sizes for the other nine ratios are
 * not verified and are not required. A result below 1792 on its long edge
 * is rejected. A result at or above 1792 can still fail the aspect checks.
 */
export const HARMONIZE_NBP_MIN_2K_LONG_EDGE = HARMONIZE_NBP_OUTPUT_HEIGHT;

/**
 * Decode and acceptance cap. This matches the composite edge cap.
 * It is not a verified provider maximum.
 */
export const HARMONIZE_NBP_OUTPUT_MAX_EDGE = 4096;

export const HARMONIZE_NBP_TIMEOUT_MS = 120_000;

/**
 * Published Standard paid-tier image prices for gemini-3-pro-image.
 * Output 1K and 2K: 1120 tokens at $120 / 1M = $0.134.
 * Image input: 560 tokens = $0.0011.
 * Text input is $2 / 1M tokens. Thinking output is $12 / 1M tokens.
 * Those two vary with the prompt and are not included below.
 */
export const HARMONIZE_NBP_PUBLISHED_OUTPUT_USD = 0.134;

export const HARMONIZE_NBP_PUBLISHED_IMAGE_INPUT_USD = 0.0011;

const COMPOSITE_NAME = "B-stage-composite.png";
const PROMPT_NAME = "F-harmonize-prompt.txt";
const MANIFEST_NAME = "manifest.json";
const PNG_MIME = "image/png";
const JPEG_MIME = "image/jpeg";

export type HarmonizeNbpImageMime = typeof PNG_MIME | typeof JPEG_MIME;

export type HarmonizeNbpProofErrorCode =
  | "missing_credentials"
  | "invalid_package"
  | "timeout"
  | "transport"
  | "provider_http"
  | "provider_incomplete"
  | "unexpected_output";

export class HarmonizeNbpProofError extends Error {
  readonly code: HarmonizeNbpProofErrorCode;
  readonly httpStatus: number | null;
  readonly providerStatus: string | null;
  readonly providerFields: readonly string[];

  constructor(
    code: HarmonizeNbpProofErrorCode,
    message: string,
    httpStatus: number | null = null,
    details?: Readonly<{ providerStatus?: string | null; providerFields?: readonly string[] }>,
  ) {
    super(message);
    this.name = "HarmonizeNbpProofError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.providerStatus = details?.providerStatus ?? null;
    this.providerFields = details?.providerFields ?? [];
  }
}

export type HarmonizeNbpRequest = Readonly<{
  model: typeof HARMONIZE_NBP_MODEL_ID;
  input: readonly [
    Readonly<{ type: "text"; text: string }>,
    Readonly<{ type: "image"; mime_type: typeof PNG_MIME; data: string }>,
  ];
  response_format: Readonly<{
    type: "image";
    mime_type: typeof JPEG_MIME;
    aspect_ratio: NanoBananaProAspectRatio;
    image_size: typeof HARMONIZE_NBP_IMAGE_SIZE;
  }>;
}>;

export type HarmonizeProofPackage = Readonly<{
  composite: Uint8Array;
  prompt: string;
  compositeSha256: string;
  promptSha256: string;
  inputWidth: number;
  inputHeight: number;
  coreVersion: typeof HARMONIZE_UNIVERSAL_PROMPT_VERSION;
  materialGuidanceIncluded: boolean;
  promptCorePresent: true;
}>;

export type HarmonizeNbpCallResult = Readonly<{
  httpStatus: number;
  requestedModel: typeof HARMONIZE_NBP_MODEL_ID;
  returnedModel: string | null;
  interactionId: string | null;
  providerStatus: string | null;
  latencyMs: number;
  output: Uint8Array;
  outputMime: HarmonizeNbpImageMime;
  usage: Readonly<Record<string, number>> | null;
  postCount: 1;
  getCount: number;
}>;

export type HarmonizeNbpFraming = Readonly<{
  requestedRatio: NanoBananaProAspectRatio | null;
  aspectErrorVsRequested: number;
  aspectErrorVsFourThree: number;
  aspectErrorVsInput: number;
  matches2kFourThree: boolean;
  meets2kClass: boolean;
  withinToleranceOfRequested: boolean;
  withinToleranceOfInput: boolean;
  accepted: boolean;
}>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const WAITING_STATUSES = new Set(["in_progress", "queued"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "incomplete", "requires_action"]);

export function readHarmonizeNbpApiKey(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const gemini = env.GEMINI_API_KEY?.trim() ?? "";
  if (gemini) return gemini;
  const google = env.GOOGLE_API_KEY?.trim() ?? "";
  return google || null;
}

export function buildHarmonizeNbpRequest(input: Readonly<{
  prompt: string;
  pngBase64: string;
  aspectRatio: NanoBananaProAspectRatio;
}>): HarmonizeNbpRequest {
  return {
    model: HARMONIZE_NBP_MODEL_ID,
    input: [
      { type: "text", text: input.prompt },
      { type: "image", mime_type: PNG_MIME, data: input.pngBase64 },
    ],
    response_format: {
      type: "image",
      mime_type: JPEG_MIME,
      aspect_ratio: input.aspectRatio,
      image_size: HARMONIZE_NBP_IMAGE_SIZE,
    },
  };
}

export function assessHarmonizeNbpFraming(input: Readonly<{
  width: number;
  height: number;
  inputWidth: number;
  inputHeight: number;
}>): HarmonizeNbpFraming {
  const classified = classifyNanoBananaProAspectRatio(input.inputWidth, input.inputHeight);
  const requestedRatio = classified.ok ? classified.ratio : null;
  const requestedAspect = requestedRatio ? nominalAspect(requestedRatio) : 0;
  const aspectErrorVsRequested = requestedRatio
    ? relativeAspectError(input.width, input.height, requestedAspect)
    : Number.POSITIVE_INFINITY;
  const aspectErrorVsFourThree = relativeAspectError(input.width, input.height, 4 / 3);
  const aspectErrorVsInput = relativeAspectError(
    input.width,
    input.height,
    input.inputWidth / input.inputHeight,
  );
  const matches2kFourThree =
    input.width === HARMONIZE_NBP_OUTPUT_WIDTH && input.height === HARMONIZE_NBP_OUTPUT_HEIGHT;
  const longEdge = Math.max(input.width, input.height);
  const meets2kClass = longEdge >= HARMONIZE_NBP_MIN_2K_LONG_EDGE
    && input.width <= HARMONIZE_NBP_OUTPUT_MAX_EDGE
    && input.height <= HARMONIZE_NBP_OUTPUT_MAX_EDGE;
  const withinToleranceOfRequested = aspectErrorVsRequested <= HARMONIZE_ASPECT_RELATIVE_TOLERANCE;
  const withinToleranceOfInput = aspectErrorVsInput <= HARMONIZE_ASPECT_RELATIVE_TOLERANCE;
  const accepted = requestedRatio === HARMONIZE_NBP_ASPECT_RATIO
    ? matches2kFourThree && withinToleranceOfInput
    : requestedRatio != null
      && meets2kClass
      && withinToleranceOfRequested
      && withinToleranceOfInput;
  return {
    requestedRatio,
    aspectErrorVsRequested,
    aspectErrorVsFourThree,
    aspectErrorVsInput,
    matches2kFourThree,
    meets2kClass,
    withinToleranceOfRequested,
    withinToleranceOfInput,
    accepted,
  };
}

export async function readHarmonizeProofPackage(
  zipBytes: Uint8Array,
): Promise<HarmonizeProofPackage> {
  const entries = readStoredZipEntries(zipBytes);
  const composite = requireEntry(entries, COMPOSITE_NAME);
  const promptBytes = requireEntry(entries, PROMPT_NAME);
  const manifestBytes = requireEntry(entries, MANIFEST_NAME);
  const manifest = parseManifest(manifestBytes);
  const compositeSha256 = await sha256HexBytes(composite);
  const promptSha256 = await sha256HexBytes(promptBytes);
  if (compositeSha256 !== manifest.compositeSha256) {
    throw new HarmonizeNbpProofError(
      "invalid_package",
      "B-stage-composite.png does not match the manifest SHA-256.",
    );
  }
  if (promptSha256 !== manifest.promptSha256) {
    throw new HarmonizeNbpProofError(
      "invalid_package",
      "F-harmonize-prompt.txt does not match the manifest SHA-256.",
    );
  }
  const size = readPngSize(composite);
  if (!size || size.width !== manifest.width || size.height !== manifest.height) {
    throw new HarmonizeNbpProofError(
      "invalid_package",
      "B-stage-composite.png dimensions do not match the manifest.",
    );
  }
  if (manifest.coreVersion !== HARMONIZE_UNIVERSAL_PROMPT_VERSION) {
    throw new HarmonizeNbpProofError(
      "invalid_package",
      "Manifest prompt core is not Universal Prompt V2.0.",
    );
  }
  let prompt: string;
  try {
    prompt = new TextDecoder("utf-8", { fatal: true }).decode(promptBytes);
  } catch {
    throw new HarmonizeNbpProofError("invalid_package", "Harmonize prompt is not UTF-8.");
  }
  if (!bytesEqual(new TextEncoder().encode(prompt), promptBytes)) {
    throw new HarmonizeNbpProofError(
      "invalid_package",
      "Harmonize prompt bytes are not stable UTF-8.",
    );
  }
  if (!prompt.startsWith(HARMONIZE_UNIVERSAL_PROMPT_V2)) {
    throw new HarmonizeNbpProofError(
      "invalid_package",
      "Harmonize prompt does not start with the installed Universal Prompt V2.0.",
    );
  }
  return {
    composite,
    prompt,
    compositeSha256,
    promptSha256,
    inputWidth: size.width,
    inputHeight: size.height,
    coreVersion: HARMONIZE_UNIVERSAL_PROMPT_VERSION,
    materialGuidanceIncluded: manifest.materialGuidanceIncluded,
    promptCorePresent: true,
  };
}

export async function callHarmonizeNbpProof(input: Readonly<{
  prompt: string;
  png: Uint8Array;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  pollIntervalMs?: number;
}>): Promise<HarmonizeNbpCallResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new HarmonizeNbpProofError(
      "missing_credentials",
      "Missing GEMINI_API_KEY or GOOGLE_API_KEY.",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? HARMONIZE_NBP_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;
  const measured = readPngSize(input.png);
  const classified = measured
    ? classifyNanoBananaProAspectRatio(measured.width, measured.height)
    : null;
  if (!measured || !classified?.ok) {
    throw new HarmonizeNbpProofError(
      "invalid_package",
      "B-stage-composite.png is outside the supported Nano Banana Pro aspect ratios.",
    );
  }
  const request = buildHarmonizeNbpRequest({
    prompt: input.prompt,
    pngBase64: Buffer.from(input.png).toString("base64"),
    aspectRatio: classified.ratio,
  });
  const started = Date.now();
  const deadline = started + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let postCount = 0;
  let getCount = 0;
  let lastStatus = 0;
  try {
    postCount += 1;
    const created = await requestInteraction(fetchImpl, apiKey, {
      method: "POST",
      url: HARMONIZE_NBP_ENDPOINT,
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    lastStatus = created.httpStatus;
    let current = created.payload;
    while (isWaiting(current)) {
      const id = readInteractionId(current);
      if (!id) {
        throw new HarmonizeNbpProofError(
          "provider_incomplete",
          "Nano Banana Pro returned an incomplete interaction without an id.",
          created.httpStatus,
        );
      }
      if (Date.now() >= deadline) break;
      if (pollIntervalMs > 0) {
        await delay(Math.min(pollIntervalMs, deadline - Date.now()), controller.signal);
      }
      if (controller.signal.aborted || Date.now() >= deadline) break;
      getCount += 1;
      const fetched = await requestInteraction(fetchImpl, apiKey, {
        method: "GET",
        url: `${HARMONIZE_NBP_ENDPOINT}/${encodeURIComponent(id)}`,
        body: null,
        signal: controller.signal,
      });
      lastStatus = fetched.httpStatus;
      current = fetched.payload;
    }
    if (isWaiting(current)) {
      throw new HarmonizeNbpProofError(
        "timeout",
        "Nano Banana Pro did not finish before the timeout.",
        lastStatus,
      );
    }
    const providerStatus = readStatus(current);
    if (providerStatus && FAILED_STATUSES.has(providerStatus)) {
      throw new HarmonizeNbpProofError(
        "provider_incomplete",
        `Nano Banana Pro interaction ended as ${providerStatus}.`,
        lastStatus,
      );
    }
    const image = await extractSingleImage(current, fetchImpl, controller.signal);
    if (postCount !== 1) {
      throw new HarmonizeNbpProofError("unexpected_output", "More than one provider create was attempted.");
    }
    return {
      httpStatus: lastStatus,
      requestedModel: HARMONIZE_NBP_MODEL_ID,
      returnedModel: readModel(current),
      interactionId: readInteractionId(current),
      providerStatus,
      latencyMs: Date.now() - started,
      output: image.bytes,
      outputMime: image.mime,
      usage: readUsage(current),
      postCount: 1,
      getCount,
    };
  } catch (error) {
    if (error instanceof HarmonizeNbpProofError) throw error;
    if (controller.signal.aborted) {
      throw new HarmonizeNbpProofError("timeout", "Nano Banana Pro did not finish before the timeout.", lastStatus || null);
    }
    throw new HarmonizeNbpProofError("transport", "Nano Banana Pro request failed before a response.", lastStatus || null);
  } finally {
    clearTimeout(timer);
  }
}

function nominalAspect(ratio: NanoBananaProAspectRatio): number {
  const [width, height] = ratio.split(":").map(Number);
  return width / height;
}

function relativeAspectError(width: number, height: number, target: number): number {
  if (height <= 0 || target <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(width / height - target) / target;
}

function requireEntry(entries: ReadonlyMap<string, Uint8Array>, name: string): Uint8Array {
  const bytes = entries.get(name);
  if (!bytes) {
    throw new HarmonizeNbpProofError("invalid_package", `Harmonize ZIP is missing ${name}.`);
  }
  return bytes;
}

type ManifestProof = Readonly<{
  compositeSha256: string;
  promptSha256: string;
  width: number;
  height: number;
  coreVersion: string;
  materialGuidanceIncluded: boolean;
}>;

function parseManifest(bytes: Uint8Array): ManifestProof {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HarmonizeNbpProofError("invalid_package", "Harmonize manifest is not JSON.");
  }
  if (!isRecord(parsed)) {
    throw new HarmonizeNbpProofError("invalid_package", "Harmonize manifest is not an object.");
  }
  const prompt = isRecord(parsed.harmonizePrompt) ? parsed.harmonizePrompt : null;
  const promptSha256 = prompt && typeof prompt.sha256 === "string" ? prompt.sha256 : "";
  const coreVersion = prompt && typeof prompt.coreVersion === "string" ? prompt.coreVersion : "";
  const materialGuidanceIncluded = prompt?.materialGuidanceIncluded === true;
  const composite = findCompositeRecord(parsed.images);
  if (!composite || !isSha256(composite.sha256) || !isSha256(promptSha256)) {
    throw new HarmonizeNbpProofError(
      "invalid_package",
      "Harmonize manifest is missing composite or prompt SHA-256.",
    );
  }
  if (!Number.isInteger(composite.width) || !Number.isInteger(composite.height)) {
    throw new HarmonizeNbpProofError("invalid_package", "Harmonize manifest composite size is invalid.");
  }
  return {
    compositeSha256: composite.sha256,
    promptSha256,
    width: composite.width,
    height: composite.height,
    coreVersion,
    materialGuidanceIncluded,
  };
}

function findCompositeRecord(images: unknown): { sha256: string; width: number; height: number } | null {
  if (!isRecord(images)) return null;
  for (const value of Object.values(images)) {
    if (!isRecord(value)) continue;
    if (value.role !== "stage-composite") continue;
    if (typeof value.sha256 !== "string") continue;
    if (typeof value.width !== "number" || typeof value.height !== "number") continue;
    return { sha256: value.sha256, width: value.width, height: value.height };
  }
  return null;
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

async function requestInteraction(
  fetchImpl: FetchLike,
  apiKey: string,
  input: Readonly<{ method: "POST" | "GET"; url: string; body: string | null; signal: AbortSignal }>,
): Promise<{ httpStatus: number; payload: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: input.method,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: input.body,
      signal: input.signal,
    });
  } catch {
    if (input.signal.aborted) {
      throw new HarmonizeNbpProofError("timeout", "Nano Banana Pro did not finish before the timeout.");
    }
    throw new HarmonizeNbpProofError("transport", "Nano Banana Pro request failed before a response.");
  }
  const text = await response.text();
  if (!response.ok) {
    const described = describeHarmonizeNbpHttpError(response.status, text);
    throw new HarmonizeNbpProofError(
      "provider_http",
      described.message,
      response.status,
      {
        providerStatus: described.providerStatus,
        providerFields: described.providerFields,
      },
    );
  }
  try {
    return { httpStatus: response.status, payload: JSON.parse(text) as unknown };
  } catch {
    throw new HarmonizeNbpProofError(
      "unexpected_output",
      "Nano Banana Pro returned a non-JSON body.",
      response.status,
    );
  }
}

async function extractSingleImage(
  payload: unknown,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; mime: HarmonizeNbpImageMime }> {
  const refs = collectImages(payload);
  if (refs.length === 0) {
    throw new HarmonizeNbpProofError("unexpected_output", "Nano Banana Pro returned no image.");
  }
  const unique = new Map<string, { bytes: Uint8Array; mime: HarmonizeNbpImageMime }>();
  for (const image of refs) {
    const bytes = image.data
      ? decodeBase64(image.data)
      : await readImageUri(image.uri, fetchImpl, signal);
    const decoded = readHarmonizeNbpImageSize(bytes);
    if (!decoded) {
      throw new HarmonizeNbpProofError(
        "unexpected_output",
        "Nano Banana Pro image is not a PNG or JPEG.",
      );
    }
    if (image.mime && image.mime !== decoded.mime) {
      throw new HarmonizeNbpProofError(
        "unexpected_output",
        "Nano Banana Pro image type does not match its bytes.",
      );
    }
    const hash = await sha256HexBytes(bytes);
    if (!unique.has(hash)) unique.set(hash, { bytes, mime: decoded.mime });
  }
  if (unique.size !== 1) {
    throw new HarmonizeNbpProofError("unexpected_output", "Nano Banana Pro returned more than one image.");
  }
  return [...unique.values()][0];
}

export function readHarmonizeNbpImageSize(
  bytes: Uint8Array,
): Readonly<{ width: number; height: number; mime: HarmonizeNbpImageMime }> | null {
  const png = readPngSize(bytes);
  if (png) return { width: png.width, height: png.height, mime: PNG_MIME };
  const jpeg = readJpegSize(bytes);
  if (jpeg) return { width: jpeg.width, height: jpeg.height, mime: JPEG_MIME };
  return null;
}

export function describeHarmonizeNbpHttpError(
  httpStatus: number,
  body: string,
): Readonly<{ message: string; providerStatus: string | null; providerFields: readonly string[] }> {
  const parsed = parseJsonObject(body);
  const error = parsed && isRecord(parsed.error) ? parsed.error : null;
  if (!error) {
    return {
      message: `Nano Banana Pro returned HTTP ${httpStatus}.`,
      providerStatus: null,
      providerFields: [],
    };
  }
  const providerStatus = typeof error.status === "string" && /^[A-Z0-9_]+$/.test(error.status)
    ? error.status
    : null;
  const providerFields = collectProviderFields(error);
  const detail = typeof error.message === "string" ? sanitizeProviderMessage(error.message) : "";
  const statusText = providerStatus ? ` ${providerStatus}` : "";
  const fieldText = providerFields.length > 0 ? ` at ${providerFields.join(", ")}` : "";
  const detailText = detail ? `: ${detail}` : "";
  return {
    message: `Nano Banana Pro returned HTTP ${httpStatus}${statusText}${fieldText}${detailText}.`,
    providerStatus,
    providerFields,
  };
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function collectProviderFields(error: Record<string, unknown>): string[] {
  const fields: string[] = [];
  const details = Array.isArray(error.details) ? error.details : [];
  for (const detail of details) {
    if (!isRecord(detail) || !Array.isArray(detail.fieldViolations)) continue;
    for (const violation of detail.fieldViolations) {
      if (!isRecord(violation) || typeof violation.field !== "string") continue;
      if (!/^[A-Za-z0-9_.[\]]{1,80}$/.test(violation.field)) continue;
      if (!fields.includes(violation.field)) fields.push(violation.field);
    }
  }
  return fields;
}

function sanitizeProviderMessage(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  const cuts = [
    collapsed.indexOf("Photorealistic Furniture Harmonization"),
    collapsed.indexOf("PRODUCT MATERIAL / FINISH REFERENCE"),
  ].filter((index) => index >= 0);
  const clipped = cuts.length > 0 ? collapsed.slice(0, Math.min(...cuts)).trim() : collapsed;
  const redacted = clipped
    .replace(/AIza[0-9A-Za-z_-]{8,}/g, "[redacted]")
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "[redacted]");
  return redacted.slice(0, 180);
}

function readJpegSize(bytes: Uint8Array): Readonly<{ width: number; height: number }> | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 3 >= bytes.length) return null;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function collectImages(payload: unknown): Array<{ data: string | null; uri: string | null; mime: string | null }> {
  const found: Array<{ data: string | null; uri: string | null; mime: string | null }> = [];
  const outputImage = isRecord(payload) ? payload.output_image ?? payload.outputImage : null;
  pushImage(found, outputImage);
  const steps = isRecord(payload) && Array.isArray(payload.steps) ? payload.steps : [];
  for (const step of steps) {
    if (!isRecord(step) || step.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const block of step.content) pushImage(found, block);
  }
  return found;
}

function pushImage(
  found: Array<{ data: string | null; uri: string | null; mime: string | null }>,
  value: unknown,
) {
  if (!isRecord(value)) return;
  if (value.type !== undefined && value.type !== "image") return;
  const data = typeof value.data === "string" && value.data.length > 0 ? value.data : null;
  const uri = typeof value.uri === "string" && value.uri.trim().length > 0 ? value.uri.trim() : null;
  if (!data && !uri) return;
  const mime = typeof value.mime_type === "string"
    ? value.mime_type
    : typeof value.mimeType === "string"
      ? value.mimeType
      : null;
  found.push({ data, uri, mime });
}

async function readImageUri(
  uri: string | null,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(uri ?? "");
  } catch {
    throw new HarmonizeNbpProofError("unexpected_output", "Nano Banana Pro image URI is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new HarmonizeNbpProofError("unexpected_output", "Nano Banana Pro image URI is not HTTPS.");
  }
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { method: "GET", signal });
  } catch (error) {
    if (signal.aborted) {
      throw new HarmonizeNbpProofError("timeout", "Nano Banana Pro did not finish before the timeout.");
    }
    throw error;
  }
  if (!response.ok) {
    throw new HarmonizeNbpProofError(
      "unexpected_output",
      `Nano Banana Pro image URI returned HTTP ${response.status}.`,
      response.status,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

function decodeBase64(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    throw new HarmonizeNbpProofError("unexpected_output", "Nano Banana Pro image data is not base64.");
  }
  return new Uint8Array(Buffer.from(trimmed, "base64"));
}

function readModel(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.model !== "string") return null;
  const model = payload.model.trim();
  return model || null;
}

function readInteractionId(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.id !== "string") return null;
  const id = payload.id.trim();
  return id || null;
}

function readStatus(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.status !== "string") return null;
  return payload.status;
}

function isWaiting(payload: unknown): boolean {
  const status = readStatus(payload);
  return status !== null && WAITING_STATUSES.has(status);
}

function readUsage(payload: unknown): Record<string, number> | null {
  if (!isRecord(payload) || !isRecord(payload.usage)) return null;
  const usage: Record<string, number> = {};
  for (const [key, value] of Object.entries(payload.usage)) {
    if (typeof value === "number" && Number.isFinite(value)) usage[key] = value;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new HarmonizeNbpProofError("timeout", "Nano Banana Pro did not finish before the timeout."));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function readStoredZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const eocd = findEocd(bytes);
  if (eocd < 0) {
    throw new HarmonizeNbpProofError("invalid_package", "Harmonize ZIP directory is missing.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new HarmonizeNbpProofError("invalid_package", "Harmonize ZIP directory is truncated.");
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    cursor += 46 + nameLength + extraLength + commentLength;
    if (method !== 0 || compressedSize !== uncompressedSize) {
      throw new HarmonizeNbpProofError(
        "invalid_package",
        "Harmonize ZIP entry is compressed. The proof reader expects a stored export.",
      );
    }
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new HarmonizeNbpProofError("invalid_package", "Harmonize ZIP local header is missing.");
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + uncompressedSize;
    if (dataEnd > bytes.length) {
      throw new HarmonizeNbpProofError("invalid_package", "Harmonize ZIP entry is truncated.");
    }
    entries.set(name, bytes.subarray(dataStart, dataEnd));
  }
  return entries;
}

function findEocd(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let index = bytes.length - 22; index >= min; index -= 1) {
    if (
      bytes[index] === 0x50
      && bytes[index + 1] === 0x4b
      && bytes[index + 2] === 0x05
      && bytes[index + 3] === 0x06
    ) {
      return index;
    }
  }
  return -1;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
