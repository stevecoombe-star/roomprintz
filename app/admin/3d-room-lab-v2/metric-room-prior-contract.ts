/**
 * UX-3a shadow metric-prior contract.
 *
 * Authority is prior_only. This receipt must never become Floor, camera,
 * FOV, S4, collision, or geometry-correction authority.
 *
 * UX-3C0 may use accepted estimatedRoomWidthM.best as a physical length
 * source. Live Auto is derived outside this receipt.
 *
 * autoMetricScaleSource is intentionally provider-agnostic so a future
 * known-span / depth-metadata / catalogue-reference source can outrank
 * this automatic prior without changing UX-2b realization.
 */

export const AFC_V2_METRIC_ROOM_PRIOR_EVIDENCE_VERSION =
  "afc-v2-metric-room-prior-evidence/v1" as const;
export const AFC_V2_METRIC_ROOM_PRIOR_PROMPT_VERSION =
  "afc-v2-metric-room-prior/v1" as const;
export const AFC_V2_METRIC_ROOM_PRIOR_AUTHORITY = "prior_only" as const;
export const AFC_V2_METRIC_ROOM_PRIOR_SOURCE_IMAGE_KIND = "ORIGINAL" as const;

export const AUTO_METRIC_SCALE_SOURCE = {
  none: "none",
  metric_prior: "metric_prior",
} as const;

/**
 * Implemented UX-3a sources. Reserved (not implemented) Auto sources:
 * `"known_span" | "depth_metadata" | "catalogue_reference"`.
 */
export type AutoMetricScaleSource =
  | typeof AUTO_METRIC_SCALE_SOURCE.none
  | typeof AUTO_METRIC_SCALE_SOURCE.metric_prior;

export const METRIC_ROOM_PRIOR_UNRELIABLE_COPY =
  "Couldn't estimate reliably" as const;
export const METRIC_ROOM_PRIOR_ACCEPTED_STATUS_COPY =
  "Approximate estimate" as const;
export const METRIC_ROOM_PRIOR_NOT_APPLIED_COPY = "Not applied" as const;

export type MetricPriorImageIdentity = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  orientation: 1;
}>;

export type MetricRangeM = Readonly<{
  low: number;
  best: number;
  high: number;
}>;

export type MetricRoomPriorObservability =
  | "recoverable"
  | "weak"
  | "not_recoverable";

export type MetricRoomPriorModelEstimate = Readonly<{
  observability: MetricRoomPriorObservability;
  estimatedRoomDepthM: MetricRangeM | null;
  estimatedRoomWidthM: MetricRangeM | null;
  estimatedCeilingHeightM: number | null;
  modelConfidence: number;
  limitations: readonly string[];
  notes: string | null;
}>;

export type MetricRoomPriorHostAcceptanceClass =
  | "accepted"
  | "weak_rejected"
  | "implausible_rejected"
  | "unobservable_rejected"
  | "unavailable";

export type MetricRoomPriorHostAcceptance = Readonly<{
  class: MetricRoomPriorHostAcceptanceClass;
  reasons: readonly string[];
  /**
   * Legacy diagnostic: estimatedRoomDepthM.best / projective gauge 4.
   * Deprecated. Not used for acceptance, Auto, UI authority, or runtime.
   */
  derivedAutoMetricScale: number | null;
}>;

export type MetricRoomPriorFailure = Readonly<{
  failureClass:
    | "configuration"
    | "basis_validation"
    | "transport"
    | "provider_http"
    | "provider_response"
    | "json_parse"
    | "contract_validation"
    | "timeout"
    | "unknown";
  failureStage:
    | "configuration"
    | "basis_validation"
    | "provider_invocation"
    | "provider_response"
    | "response_extraction"
    | "json_parse"
    | "contract_validation";
  provider: "google_gemini" | "controlled_fixture";
  model: string;
  providerStatus: number | null;
  safeDetail: string;
  contractValidationReason: string | null;
}>;

export type MetricRoomPriorReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_METRIC_ROOM_PRIOR_EVIDENCE_VERSION;
  authority: typeof AFC_V2_METRIC_ROOM_PRIOR_AUTHORITY;
  sourceImageKind: typeof AFC_V2_METRIC_ROOM_PRIOR_SOURCE_IMAGE_KIND;
  sourceImageHash: string;
  originalAncestorSha256: string;
  attemptId: string;
  loadGeneration: number;
  provider: "google_gemini" | "controlled_fixture";
  model: string;
  promptVersion: typeof AFC_V2_METRIC_ROOM_PRIOR_PROMPT_VERSION;
  autoMetricScaleSource: AutoMetricScaleSource;
  estimate: MetricRoomPriorModelEstimate | null;
  hostAcceptance: MetricRoomPriorHostAcceptance;
  failure: MetricRoomPriorFailure | null;
}>;

export type MetricRoomPriorReceiptContext = Readonly<{
  sourceImageHash: string;
  originalAncestorSha256: string;
  attemptId: string;
  loadGeneration: number;
  provider: "google_gemini" | "controlled_fixture";
  model: string;
}>;

export type MetricRoomPriorParseResult =
  | Readonly<{ ok: true; estimate: MetricRoomPriorModelEstimate }>
  | Readonly<{ ok: false; reason: string }>;

const MAX_LIMITATIONS = 24;
const MAX_LIMITATION_CHARS = 240;
const MAX_NOTES_CHARS = 480;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRangeM(value: unknown): MetricRangeM | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const low = finiteNumber(value.low);
  const best = finiteNumber(value.best);
  const high = finiteNumber(value.high);
  if (low === null || best === null || high === null) return undefined;
  return Object.freeze({ low, best, high });
}

function parseLimitations(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return Object.freeze(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.replace(/\s+/g, " ").trim().slice(0, MAX_LIMITATION_CHARS))
      .filter(Boolean)
      .slice(0, MAX_LIMITATIONS),
  );
}

export function parseMetricRoomPriorModelEstimate(
  value: unknown,
): MetricRoomPriorParseResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "provider_result_not_object" };
  }
  const observability = value.observability;
  if (
    observability !== "recoverable" &&
    observability !== "weak" &&
    observability !== "not_recoverable"
  ) {
    return { ok: false, reason: "observability_invalid" };
  }
  const depth = parseRangeM(value.estimatedRoomDepthM);
  if (depth === undefined) {
    return { ok: false, reason: "estimatedRoomDepthM_invalid" };
  }
  const width = parseRangeM(value.estimatedRoomWidthM);
  if (width === undefined) {
    return { ok: false, reason: "estimatedRoomWidthM_invalid" };
  }
  let ceiling: number | null;
  if (value.estimatedCeilingHeightM === null ||
      value.estimatedCeilingHeightM === undefined) {
    ceiling = null;
  } else {
    const parsedCeiling = finiteNumber(value.estimatedCeilingHeightM);
    if (parsedCeiling === null) {
      return { ok: false, reason: "estimatedCeilingHeightM_invalid" };
    }
    ceiling = parsedCeiling;
  }
  const modelConfidence = finiteNumber(value.modelConfidence);
  if (
    modelConfidence === null ||
    modelConfidence < 0 ||
    modelConfidence > 1
  ) {
    return { ok: false, reason: "modelConfidence_invalid" };
  }
  const limitations = parseLimitations(
    value.limitations === undefined ? [] : value.limitations,
  );
  if (!limitations) {
    return { ok: false, reason: "limitations_invalid" };
  }
  let notes: string | null = null;
  if (value.notes !== null && value.notes !== undefined) {
    if (typeof value.notes !== "string") {
      return { ok: false, reason: "notes_invalid" };
    }
    const trimmed = value.notes.replace(/\s+/g, " ").trim().slice(0, MAX_NOTES_CHARS);
    notes = trimmed.length > 0 ? trimmed : null;
  }
  return {
    ok: true,
    estimate: Object.freeze({
      observability,
      estimatedRoomDepthM: depth,
      estimatedRoomWidthM: width,
      estimatedCeilingHeightM: ceiling,
      modelConfidence,
      limitations,
      notes,
    }),
  };
}

export function unavailableMetricRoomPriorAcceptance(
  reasons: readonly string[],
): MetricRoomPriorHostAcceptance {
  return Object.freeze({
    class: "unavailable",
    reasons: Object.freeze([...reasons]),
    derivedAutoMetricScale: null,
  });
}

export function buildMetricRoomPriorReceipt(
  context: MetricRoomPriorReceiptContext,
  estimate: MetricRoomPriorModelEstimate | null,
  hostAcceptance: MetricRoomPriorHostAcceptance,
  failure: MetricRoomPriorFailure | null,
): MetricRoomPriorReceipt {
  return Object.freeze({
    schemaVersion: AFC_V2_METRIC_ROOM_PRIOR_EVIDENCE_VERSION,
    authority: AFC_V2_METRIC_ROOM_PRIOR_AUTHORITY,
    sourceImageKind: AFC_V2_METRIC_ROOM_PRIOR_SOURCE_IMAGE_KIND,
    sourceImageHash: context.sourceImageHash,
    originalAncestorSha256: context.originalAncestorSha256,
    attemptId: context.attemptId,
    loadGeneration: context.loadGeneration,
    provider: context.provider,
    model: context.model,
    promptVersion: AFC_V2_METRIC_ROOM_PRIOR_PROMPT_VERSION,
    autoMetricScaleSource: hostAcceptance.class === "accepted"
      ? AUTO_METRIC_SCALE_SOURCE.metric_prior
      : AUTO_METRIC_SCALE_SOURCE.none,
    estimate,
    hostAcceptance,
    failure,
  });
}

export function buildUnavailableMetricRoomPriorReceipt(
  context: MetricRoomPriorReceiptContext,
  failure: MetricRoomPriorFailure,
): MetricRoomPriorReceipt {
  return buildMetricRoomPriorReceipt(
    context,
    null,
    unavailableMetricRoomPriorAcceptance([
      failure.contractValidationReason ?? failure.failureClass,
      failure.safeDetail,
    ].filter(Boolean)),
    failure,
  );
}

export function isMetricRoomPriorReceipt(
  value: unknown,
): value is MetricRoomPriorReceipt {
  return isRecord(value) &&
    value.schemaVersion === AFC_V2_METRIC_ROOM_PRIOR_EVIDENCE_VERSION &&
    value.authority === AFC_V2_METRIC_ROOM_PRIOR_AUTHORITY;
}

export function metricRoomPriorIsAccepted(
  receipt: MetricRoomPriorReceipt | null | undefined,
): boolean {
  return receipt?.hostAcceptance.class === "accepted";
}

export function formatMetricMetres(value: number): string {
  return `${value.toFixed(1)} m`;
}
