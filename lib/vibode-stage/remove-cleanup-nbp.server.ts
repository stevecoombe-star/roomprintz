/**
 * REMOVE-2D2 Clean Up Room Nano Banana Pro adapter.
 *
 * This module builds one two-image Interactions request from a REMOVE-2D1
 * snapshot and reads the response. It does not enqueue a job, store a
 * candidate, publish History, or change Harmonize's one-image request.
 *
 * The paid-request fingerprint is an identity for a future worker. It is
 * not permission to call Google, and this module never repeats a POST.
 *
 * Output pixels are checked for integrity, bounds, and aspect. They are not
 * resized, and a matching aspect is not STAGE registration.
 */

import sharp from "sharp";

import type { NanoBananaProAspectRatio } from "@/lib/afc-image-models";
import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import { HARMONIZE_ASPECT_RELATIVE_TOLERANCE } from "@/lib/vibode-stage/harmonize-export";
import {
  HARMONIZE_OUTPUT_MAX_BYTES,
  HARMONIZE_PROVIDER_ID,
} from "@/lib/vibode-stage/harmonize-jobs/policy";
import {
  HARMONIZE_NBP_ENDPOINT,
  HARMONIZE_NBP_MIN_2K_LONG_EDGE,
  HARMONIZE_NBP_MODEL_ID,
  HARMONIZE_NBP_OUTPUT_MAX_EDGE,
  HARMONIZE_NBP_TIMEOUT_MS,
  describeHarmonizeNbpHttpError,
  readHarmonizeNbpApiKey,
  readHarmonizeNbpImageSize,
} from "@/lib/vibode-stage/harmonize-nbp-proof";
import {
  REMOVE_CLEANUP_OUTPUT_CONFIG_VERSION,
  REMOVE_CLEANUP_STAGE_REGISTRATION,
  removeCleanupPaidRequestFingerprint,
  type RemoveCleanupGenerationInputSnapshot,
  type RemoveCleanupOutputResolutionClass,
  type RemoveCleanupProviderOutputConfig,
} from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

export const REMOVE_CLEANUP_NBP_PROVIDER_ID = HARMONIZE_PROVIDER_ID;
export const REMOVE_CLEANUP_NBP_MODEL_ID = HARMONIZE_NBP_MODEL_ID;
export const REMOVE_CLEANUP_NBP_OUTPUT_MIME = "image/jpeg" as const;
export const REMOVE_CLEANUP_NBP_DEFAULT_RESOLUTION_CLASS = "2K" as const;
export const REMOVE_CLEANUP_NBP_MAX_GETS = 30;
export const REMOVE_CLEANUP_NBP_ASPECT_TOLERANCE = HARMONIZE_ASPECT_RELATIVE_TOLERANCE;

const WAITING_STATUSES = new Set(["in_progress", "queued"]);
const TERMINAL_FAILURE_STATUSES = new Set(["failed", "cancelled", "incomplete", "requires_action"]);
const REJECTED_HTTP = new Set([400, 401, 403, 413, 422]);
const MAX_DECODED_PIXELS = HARMONIZE_NBP_OUTPUT_MAX_EDGE * HARMONIZE_NBP_OUTPUT_MAX_EDGE;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type OriginalMime = RemoveCleanupGenerationInputSnapshot["original"]["mimeType"];
type FailurePhase = "before_contact" | "provider_rejected" | "provider_uncertain";

export type RemoveCleanupNbpRequest = Readonly<{
  model: typeof REMOVE_CLEANUP_NBP_MODEL_ID;
  input: readonly [
    Readonly<{ type: "text"; text: string }>,
    Readonly<{ type: "image"; mime_type: OriginalMime; data: string }>,
    Readonly<{ type: "image"; mime_type: "image/png"; data: string }>,
  ];
  response_format: Readonly<{
    type: "image";
    mime_type: typeof REMOVE_CLEANUP_NBP_OUTPUT_MIME;
    aspect_ratio: NanoBananaProAspectRatio;
    image_size: RemoveCleanupOutputResolutionClass;
  }>;
}>;

export type RemoveCleanupNbpCandidate = Readonly<{
  ok: true;
  providerId: typeof REMOVE_CLEANUP_NBP_PROVIDER_ID;
  modelId: typeof REMOVE_CLEANUP_NBP_MODEL_ID;
  returnedModel: string | null;
  paidRequestFingerprint: string;
  inputFingerprint: string;
  promptVersion: RemoveCleanupGenerationInputSnapshot["prompt"]["version"];
  promptSha256: string;
  originalSha256: string;
  overlaySha256: string;
  requestedAspectRatio: NanoBananaProAspectRatio;
  requestedResolutionClass: RemoveCleanupOutputResolutionClass;
  outputMime: typeof REMOVE_CLEANUP_NBP_OUTPUT_MIME;
  outputWidth: number;
  outputHeight: number;
  outputSha256: string;
  outputBytes: () => Uint8Array;
  interactionId: string | null;
  latencyMs: number;
  usage: Readonly<Record<string, number>> | null;
  providerStatus: string | null;
  httpStatus: number;
  postCount: 1;
  getCount: number;
  stageRegistration: typeof REMOVE_CLEANUP_STAGE_REGISTRATION;
  dimensionAssessment: Readonly<{
    exactOutputGrid: "unverified";
    aspectTolerance: number;
    aspectError: number;
    maxEdge: number;
    twoKLongEdgeFloor: number | null;
  }>;
}>;

export type RemoveCleanupNbpFailure = Readonly<{
  ok: false;
  phase: FailurePhase;
  code: string;
  message: string;
  retryable: false;
  httpStatus: number | null;
  providerStatus: string | null;
  providerFields: readonly string[];
  postCount: number;
  getCount: number;
}>;

export type RemoveCleanupNbpResult = RemoveCleanupNbpCandidate | RemoveCleanupNbpFailure;

/**
 * Proposed output settings for one snapshot.
 * The resolution argument is explicit; omitting it selects the initial 2K
 * class without writing that choice into the snapshot identity.
 * Returns null when the snapshot has no admissible provider family.
 */
export function removeCleanupNbpOutputConfig(
  snapshot: RemoveCleanupGenerationInputSnapshot,
  resolutionClass: RemoveCleanupOutputResolutionClass = REMOVE_CLEANUP_NBP_DEFAULT_RESOLUTION_CLASS,
): RemoveCleanupProviderOutputConfig | null {
  if (!snapshot.aspect.providerFamily.admissible) return null;
  return {
    schemaVersion: REMOVE_CLEANUP_OUTPUT_CONFIG_VERSION,
    providerId: REMOVE_CLEANUP_NBP_PROVIDER_ID,
    modelId: REMOVE_CLEANUP_NBP_MODEL_ID,
    aspectRatioFamily: snapshot.aspect.providerFamily.family,
    resolutionClass,
    mimeType: REMOVE_CLEANUP_NBP_OUTPUT_MIME,
  };
}

/**
 * Validate output settings against the snapshot and build the provider body.
 * Inadmissible sources and contradictory aspect families fail here, before a
 * paid-request fingerprint or a transport call.
 */
export function buildAuthorizedRemoveCleanupNbpRequest(input: Readonly<{
  snapshot: RemoveCleanupGenerationInputSnapshot;
  output: RemoveCleanupProviderOutputConfig;
}>): Readonly<{ ok: true; request: RemoveCleanupNbpRequest; paidRequestFingerprint: string }> | RemoveCleanupNbpFailure {
  const supported = supportedOutput(input.output);
  if (!supported.ok) return beforeContact(supported.code, supported.message);
  const family = input.snapshot.aspect.providerFamily;
  if (!family.admissible) {
    return beforeContact(
      "inadmissible_aspect",
      "The ORIGINAL aspect is outside the supported Nano Banana Pro families.",
    );
  }
  if (input.output.aspectRatioFamily !== family.family) {
    return beforeContact(
      "aspect_conflict",
      "The requested aspect family does not match the ORIGINAL.",
    );
  }
  const originalBytes = input.snapshot.artifacts.originalBytes();
  const overlayBytes = input.snapshot.artifacts.overlayPng();
  const promptBytes = new TextEncoder().encode(input.snapshot.prompt.text);
  if (
    sha256Hex(originalBytes) !== input.snapshot.original.sha256
    || sha256Hex(overlayBytes) !== input.snapshot.overlay.sha256
    || sha256Hex(promptBytes) !== input.snapshot.prompt.sha256
    || input.snapshot.prompt.text.length === 0
  ) {
    return beforeContact("snapshot_inconsistent", "The generation snapshot bytes do not match its hashes.");
  }
  const request: RemoveCleanupNbpRequest = {
    model: REMOVE_CLEANUP_NBP_MODEL_ID,
    input: [
      { type: "text", text: input.snapshot.prompt.text },
      {
        type: "image",
        mime_type: input.snapshot.original.mimeType,
        data: Buffer.from(originalBytes).toString("base64"),
      },
      { type: "image", mime_type: "image/png", data: Buffer.from(overlayBytes).toString("base64") },
    ],
    response_format: {
      type: "image",
      mime_type: REMOVE_CLEANUP_NBP_OUTPUT_MIME,
      aspect_ratio: family.family,
      image_size: input.output.resolutionClass,
    },
  };
  const paidRequestFingerprint = removeCleanupPaidRequestFingerprint(
    input.snapshot.inputFingerprint,
    input.output,
  );
  if (!paidRequestFingerprint) {
    return beforeContact("snapshot_inconsistent", "The paid-request fingerprint could not be derived.");
  }
  return { ok: true, request, paidRequestFingerprint };
}

export async function requestRemoveCleanupNbpCandidate(input: Readonly<{
  snapshot: RemoveCleanupGenerationInputSnapshot;
  output: RemoveCleanupProviderOutputConfig;
  apiKey?: string;
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}>): Promise<RemoveCleanupNbpResult> {
  const authorized = buildAuthorizedRemoveCleanupNbpRequest(input);
  if (!authorized.ok) return authorized;
  const apiKey = resolveApiKey(input);
  if (!apiKey) return beforeContact("missing_credentials", "Missing GEMINI_API_KEY or GOOGLE_API_KEY.");

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? HARMONIZE_NBP_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;
  const started = Date.now();
  const deadline = started + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const onCallerAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onCallerAbort, { once: true });
  let postCount = 0;
  let getCount = 0;
  let lastStatus = 0;
  try {
    if (input.signal?.aborted) {
      return beforeContact("cancelled", "Clean Up generation was cancelled before contact.");
    }
    postCount += 1;
    const created = await requestInteraction(fetchImpl, apiKey, {
      method: "POST",
      url: HARMONIZE_NBP_ENDPOINT,
      body: JSON.stringify(authorized.request),
      signal: controller.signal,
    });
    lastStatus = created.httpStatus;
    let current = created.payload;
    while (isWaiting(current) && getCount < REMOVE_CLEANUP_NBP_MAX_GETS) {
      const id = readInteractionId(current);
      if (!id) {
        return failure("provider_uncertain", "provider_incomplete", "The provider interaction has no id.", {
          httpStatus: lastStatus,
          postCount,
          getCount,
        });
      }
      if (controller.signal.aborted || Date.now() >= deadline) break;
      await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), controller.signal);
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
    if (isWaiting(current) || controller.signal.aborted) {
      return uncertainStop(input.signal, lastStatus, postCount, getCount);
    }
    const terminal = terminalFailure(current);
    if (terminal) {
      return failure(terminal.phase, terminal.code, terminal.message, {
        httpStatus: lastStatus,
        providerStatus: terminal.providerStatus,
        postCount,
        getCount,
      });
    }
    const image = await extractSingleJpeg(current);
    const assessed = await assessCleanupJpeg(image, authorized.request.response_format);
    if (!assessed.ok) {
      return failure("provider_rejected", assessed.code, assessed.message, {
        httpStatus: lastStatus,
        providerStatus: readStatus(current),
        postCount,
        getCount,
      });
    }
    return {
      ok: true,
      providerId: REMOVE_CLEANUP_NBP_PROVIDER_ID,
      modelId: REMOVE_CLEANUP_NBP_MODEL_ID,
      returnedModel: readModel(current),
      paidRequestFingerprint: authorized.paidRequestFingerprint,
      inputFingerprint: input.snapshot.inputFingerprint,
      promptVersion: input.snapshot.prompt.version,
      promptSha256: input.snapshot.prompt.sha256,
      originalSha256: input.snapshot.original.sha256,
      overlaySha256: input.snapshot.overlay.sha256,
      requestedAspectRatio: authorized.request.response_format.aspect_ratio,
      requestedResolutionClass: authorized.request.response_format.image_size,
      outputMime: REMOVE_CLEANUP_NBP_OUTPUT_MIME,
      outputWidth: assessed.width,
      outputHeight: assessed.height,
      outputSha256: assessed.sha256,
      outputBytes: ownedBytes(image),
      interactionId: readInteractionId(current),
      latencyMs: Math.max(0, Date.now() - started),
      usage: readUsage(current),
      providerStatus: readStatus(current),
      httpStatus: lastStatus,
      postCount: 1,
      getCount,
      stageRegistration: REMOVE_CLEANUP_STAGE_REGISTRATION,
      dimensionAssessment: assessed.assessment,
    };
  } catch (error) {
    if (input.signal?.aborted) {
      return failure(
        postCount > 0 ? "provider_uncertain" : "before_contact",
        "cancelled",
        postCount > 0
          ? "Clean Up generation was cancelled after provider contact."
          : "Clean Up generation was cancelled before contact.",
        { httpStatus: lastStatus || null, postCount, getCount },
      );
    }
    if (error instanceof CleanupFlowError) {
      return failure(error.phase, error.code, error.message, {
        httpStatus: error.httpStatus ?? (lastStatus || null),
        providerStatus: error.providerStatus,
        providerFields: error.providerFields,
        postCount,
        getCount,
      });
    }
    return uncertainStop(input.signal, lastStatus || null, postCount, getCount);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function supportedOutput(
  output: RemoveCleanupProviderOutputConfig,
): Readonly<{ ok: true }> | Readonly<{ ok: false; code: string; message: string }> {
  if (output.schemaVersion !== REMOVE_CLEANUP_OUTPUT_CONFIG_VERSION) {
    return { ok: false, code: "unsupported_output", message: "The output configuration is not supported." };
  }
  if (output.providerId !== REMOVE_CLEANUP_NBP_PROVIDER_ID || output.modelId !== REMOVE_CLEANUP_NBP_MODEL_ID) {
    return { ok: false, code: "unsupported_output", message: "The Clean Up provider or model is not supported." };
  }
  if (output.mimeType !== REMOVE_CLEANUP_NBP_OUTPUT_MIME) {
    return { ok: false, code: "unsupported_output", message: "Clean Up output must be JPEG." };
  }
  if (output.resolutionClass !== "1K" && output.resolutionClass !== "2K" && output.resolutionClass !== "4K") {
    return { ok: false, code: "unsupported_output", message: "The resolution class is not supported." };
  }
  return { ok: true };
}

function resolveApiKey(input: Readonly<{
  apiKey?: string;
  env?: Readonly<Record<string, string | undefined>>;
}>): string | null {
  if (input.apiKey !== undefined) return input.apiKey.trim() || null;
  return readHarmonizeNbpApiKey(input.env ?? process.env);
}

async function assessCleanupJpeg(
  bytes: Uint8Array,
  requested: RemoveCleanupNbpRequest["response_format"],
): Promise<
  | Readonly<{
      ok: true;
      width: number;
      height: number;
      sha256: string;
      assessment: RemoveCleanupNbpCandidate["dimensionAssessment"];
    }>
  | Readonly<{ ok: false; code: string; message: string }>
> {
  if (bytes.byteLength === 0 || bytes.byteLength > HARMONIZE_OUTPUT_MAX_BYTES) {
    return { ok: false, code: "output_bounds", message: "The provider image exceeds the output limit." };
  }
  const header = readHarmonizeNbpImageSize(bytes);
  if (!header || header.mime !== "image/jpeg") {
    return { ok: false, code: "corrupt_output", message: "The provider image is not a JPEG." };
  }
  if (
    header.width > HARMONIZE_NBP_OUTPUT_MAX_EDGE
    || header.height > HARMONIZE_NBP_OUTPUT_MAX_EDGE
    || header.width < 1
    || header.height < 1
  ) {
    return { ok: false, code: "output_bounds", message: "The provider image is outside the output bounds." };
  }
  const longEdge = Math.max(header.width, header.height);
  const floor = requested.image_size === "2K" ? HARMONIZE_NBP_MIN_2K_LONG_EDGE : null;
  if (floor != null && longEdge < floor) {
    return {
      ok: false,
      code: "resolution_class",
      message: "The provider image is below the requested resolution class.",
    };
  }
  let decoded: Readonly<{ width: number; height: number; orientation: number }>;
  try {
    decoded = await decodeJpeg(bytes);
  } catch {
    return { ok: false, code: "corrupt_output", message: "The provider image could not be decoded." };
  }
  if (decoded.orientation !== 1) {
    return { ok: false, code: "output_orientation", message: "The provider image orientation is not upright." };
  }
  if (decoded.width !== header.width || decoded.height !== header.height) {
    return { ok: false, code: "corrupt_output", message: "The provider image dimensions do not agree." };
  }
  const aspectError = relativeAspectError(decoded.width, decoded.height, nominalAspect(requested.aspect_ratio));
  if (!(aspectError <= REMOVE_CLEANUP_NBP_ASPECT_TOLERANCE)) {
    return { ok: false, code: "aspect_mismatch", message: "The provider image aspect does not match the request." };
  }
  return {
    ok: true,
    width: decoded.width,
    height: decoded.height,
    sha256: sha256Hex(bytes),
    assessment: {
      exactOutputGrid: "unverified",
      aspectTolerance: REMOVE_CLEANUP_NBP_ASPECT_TOLERANCE,
      aspectError,
      maxEdge: HARMONIZE_NBP_OUTPUT_MAX_EDGE,
      twoKLongEdgeFloor: floor,
    },
  };
}

export async function assessRemoveCleanupCandidateBytes(
  bytes: Uint8Array,
  requested: RemoveCleanupNbpRequest["response_format"],
): Promise<
  | Readonly<{
      ok: true;
      width: number;
      height: number;
      sha256: string;
      assessment: RemoveCleanupNbpCandidate["dimensionAssessment"];
    }>
  | Readonly<{ ok: false; code: string; message: string }>
> {
  return assessCleanupJpeg(bytes, requested);
}

async function decodeJpeg(
  bytes: Uint8Array,
): Promise<Readonly<{ width: number; height: number; orientation: number }>> {
  const buffer = Buffer.from(bytes);
  const meta = await sharp(buffer, {
    failOn: "error",
    animated: false,
    limitInputPixels: MAX_DECODED_PIXELS,
  }).metadata();
  const orientation = typeof meta.orientation === "number" ? meta.orientation : 1;
  const decoded = await sharp(buffer, {
    failOn: "error",
    animated: false,
    limitInputPixels: MAX_DECODED_PIXELS,
  }).raw().toBuffer({ resolveWithObject: true });
  return { width: decoded.info.width, height: decoded.info.height, orientation };
}

async function extractSingleJpeg(payload: unknown): Promise<Uint8Array> {
  const refs = collectImages(payload);
  if (refs.length === 0) {
    throw new CleanupFlowError("provider_rejected", "unexpected_output", "The provider returned no image.");
  }
  const unique = new Map<string, Uint8Array>();
  for (const image of refs) {
    if (image.uri && !image.data) {
      throw new CleanupFlowError(
        "provider_rejected",
        "unexpected_output",
        "The provider image must be inline JPEG data.",
      );
    }
    if (image.mime != null && image.mime !== "image/jpeg") {
      throw new CleanupFlowError("provider_rejected", "unexpected_output", "The provider image MIME is not JPEG.");
    }
    const bytes = image.data != null ? decodeBase64(image.data) : null;
    if (!bytes) {
      throw new CleanupFlowError("provider_rejected", "unexpected_output", "The provider image data is not base64.");
    }
    const hash = sha256Hex(bytes);
    if (!unique.has(hash)) unique.set(hash, bytes);
  }
  if (unique.size !== 1) {
    throw new CleanupFlowError("provider_rejected", "unexpected_output", "The provider returned more than one image.");
  }
  return [...unique.values()][0] ?? new Uint8Array();
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
      throw new CleanupFlowError("provider_uncertain", "timeout", "Provider contact ended before a response.");
    }
    throw new CleanupFlowError("provider_uncertain", "transport", "Provider contact failed before a response.");
  }
  const body = await readBoundedBody(response);
  if (body === "too-large") {
    throw new CleanupFlowError(
      "provider_uncertain",
      "response_too_large",
      "The provider response exceeded the size limit.",
      response.status,
    );
  }
  if (!response.ok) {
    const described = describeHarmonizeNbpHttpError(response.status, new TextDecoder().decode(body));
    const refused = contentStatus(described.providerStatus);
    throw new CleanupFlowError(
      httpPhase(response.status),
      refused ? "content_refused" : httpPhase(response.status) === "provider_rejected" ? "provider_rejected" : "provider_uncertain",
      refused
        ? "The provider refused the generation."
        : `Provider returned HTTP ${response.status}.`,
      response.status,
      described.providerStatus,
      described.providerFields,
    );
  }
  try {
    return { httpStatus: response.status, payload: JSON.parse(new TextDecoder().decode(body)) as unknown };
  } catch {
    throw new CleanupFlowError(
      "provider_uncertain",
      "unexpected_output",
      "The provider returned a non-JSON body.",
      response.status,
    );
  }
}

async function readBoundedBody(response: Response): Promise<Uint8Array | "too-large"> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > HARMONIZE_OUTPUT_MAX_BYTES) return "too-large";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > HARMONIZE_OUTPUT_MAX_BYTES) return "too-large";
  return bytes;
}

function terminalFailure(
  payload: unknown,
): Readonly<{ phase: "provider_rejected"; code: string; message: string; providerStatus: string | null }> | null {
  const providerStatus = readStatus(payload);
  const blocked = blockReason(payload) ?? (contentStatus(providerStatus) ? providerStatus : null);
  if (blocked) {
    return {
      phase: "provider_rejected",
      code: "content_refused",
      message: "The provider refused the generation.",
      providerStatus: blocked,
    };
  }
  if (providerStatus && TERMINAL_FAILURE_STATUSES.has(providerStatus)) {
    return {
      phase: "provider_rejected",
      code: "provider_status",
      message: "The provider interaction ended without an image.",
      providerStatus,
    };
  }
  return null;
}

function uncertainStop(
  caller: AbortSignal | undefined,
  httpStatus: number | null,
  postCount: number,
  getCount: number,
): RemoveCleanupNbpFailure {
  const cancelled = caller?.aborted === true;
  return failure(
    postCount > 0 ? "provider_uncertain" : "before_contact",
    cancelled ? "cancelled" : "timeout",
    cancelled
      ? "Clean Up generation was cancelled after provider contact."
      : "The provider did not finish before the timeout.",
    { httpStatus, postCount, getCount },
  );
}

function beforeContact(code: string, message: string): RemoveCleanupNbpFailure {
  return failure("before_contact", code, message, { postCount: 0, getCount: 0 });
}

function failure(
  phase: FailurePhase,
  code: string,
  message: string,
  extra: Readonly<{
    httpStatus?: number | null;
    providerStatus?: string | null;
    providerFields?: readonly string[];
    postCount: number;
    getCount: number;
  }>,
): RemoveCleanupNbpFailure {
  return {
    ok: false,
    phase,
    code,
    message,
    retryable: false,
    httpStatus: extra.httpStatus ?? null,
    providerStatus: extra.providerStatus ?? null,
    providerFields: extra.providerFields ?? [],
    postCount: extra.postCount,
    getCount: extra.getCount,
  };
}

function httpPhase(status: number): FailurePhase {
  return REJECTED_HTTP.has(status) ? "provider_rejected" : "provider_uncertain";
}

function contentStatus(status: string | null): boolean {
  return status != null && /PROHIBITED|SAFETY|BLOCKED|RECITATION/.test(status);
}

function nominalAspect(ratio: string): number {
  const [widthText, heightText] = ratio.split(":");
  const width = Number(widthText);
  const height = Number(heightText);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) return Number.NaN;
  return width / height;
}

function relativeAspectError(width: number, height: number, target: number): number {
  if (height <= 0 || !(target > 0)) return Number.POSITIVE_INFINITY;
  return Math.abs(width / height - target) / target;
}

function ownedBytes(bytes: Uint8Array): () => Uint8Array {
  const stored = Uint8Array.from(bytes);
  return () => Uint8Array.from(stored);
}

function collectImages(
  payload: unknown,
): Array<{ data: string | null; uri: string | null; mime: string | null }> {
  const found: Array<{ data: string | null; uri: string | null; mime: string | null }> = [];
  if (!isRecord(payload)) return found;
  pushImage(found, payload.output_image ?? payload.outputImage);
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
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
  if (!isRecord(value) || (value.type !== undefined && value.type !== "image")) return;
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

function decodeBase64(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) return null;
  const bytes = Buffer.from(trimmed, "base64");
  if (bytes.toString("base64") !== trimmed) return null;
  return new Uint8Array(bytes);
}

function readModel(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.model !== "string") return null;
  const model = payload.model.trim();
  return model || null;
}

function readInteractionId(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.id !== "string") return null;
  const id = payload.id.trim();
  return /^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : null;
}

function readStatus(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.status !== "string") return null;
  return payload.status;
}

function isWaiting(payload: unknown): boolean {
  const status = readStatus(payload);
  return status != null && WAITING_STATUSES.has(status);
}

function blockReason(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const feedback = isRecord(payload.promptFeedback)
    ? payload.promptFeedback
    : isRecord(payload.prompt_feedback)
      ? payload.prompt_feedback
      : null;
  const reason = feedback?.blockReason ?? feedback?.block_reason;
  return typeof reason === "string" && /^[A-Z0-9_]+$/.test(reason) ? reason : null;
}

function readUsage(payload: unknown): Record<string, number> | null {
  if (!isRecord(payload) || !isRecord(payload.usage)) return null;
  const usage: Record<string, number> = {};
  for (const [key, value] of Object.entries(payload.usage)) {
    if (typeof value === "number" && Number.isFinite(value)) usage[key] = value;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

class CleanupFlowError extends Error {
  readonly phase: FailurePhase;
  readonly code: string;
  readonly httpStatus: number | null;
  readonly providerStatus: string | null;
  readonly providerFields: readonly string[];

  constructor(
    phase: FailurePhase,
    code: string,
    message: string,
    httpStatus: number | null = null,
    providerStatus: string | null = null,
    providerFields: readonly string[] = [],
  ) {
    super(message);
    this.name = "CleanupFlowError";
    this.phase = phase;
    this.code = code;
    this.httpStatus = httpStatus;
    this.providerStatus = providerStatus;
    this.providerFields = providerFields;
  }
}
