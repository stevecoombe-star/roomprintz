/**
 * UX-3b1 matched-span physical length estimate contract.
 *
 * Authority is prior_only. The host derives a shadow candidate scale from
 * the selected UX-3b0 canonical span and a physical length in metres:
 *
 *   candidateMetricScale = physicalLengthM / canonicalLength
 *
 * That helper is provider-agnostic. This matched-span estimate is
 * diagnostic only. It is not Floor, camera, FOV, S4, collision, or Auto
 * authority. UX-3C0 Auto does not read candidateMetricScale.
 */

export const AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_VERSION =
  "afc-v2-metric-correspondence-estimate/v1" as const;
export const AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_PROMPT_VERSION =
  "afc-v2-metric-correspondence-estimator/v1" as const;
export const AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_AUTHORITY =
  "prior_only" as const;
export const AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_SOURCE_IMAGE_KIND =
  "ORIGINAL_OVERLAY" as const;

export const METRIC_SPAN_ESTIMATE_UNRELIABLE_COPY =
  "Couldn't estimate highlighted span reliably" as const;
export const METRIC_SPAN_ESTIMATE_NOT_APPLIED_COPY = "Not applied" as const;
export const METRIC_SPAN_ESTIMATE_SHADOW_STATUS_COPY = "Shadow only" as const;

export type MetricCorrespondenceEstimateImageIdentity = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  orientation: 1;
}>;

export type MetricSpanRangeM = Readonly<{
  low: number;
  best: number;
  high: number;
}>;

export type MetricCorrespondenceEstimateObservability =
  | "recoverable"
  | "weak"
  | "not_recoverable";

export type MetricCorrespondencePhysicalEstimate = Readonly<{
  observability: MetricCorrespondenceEstimateObservability;
  estimatedLengthM: MetricSpanRangeM | null;
  modelConfidence: number;
  limitations: readonly string[];
  notes: string | null;
}>;

export type MetricCorrespondenceEstimateHostAcceptanceClass =
  | "accepted"
  | "weak_rejected"
  | "implausible_rejected"
  | "unobservable_rejected"
  | "unavailable";

export type MetricCorrespondenceEstimateHostAcceptance = Readonly<{
  class: MetricCorrespondenceEstimateHostAcceptanceClass;
  reasons: readonly string[];
  candidateMetricScale: number | null;
}>;

export type MetricCorrespondenceEstimateFailure = Readonly<{
  failureClass:
    | "configuration"
    | "basis_validation"
    | "overlay_generation"
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
    | "overlay_generation"
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

export type MetricCorrespondenceEstimateReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_VERSION;
  authority: typeof AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_AUTHORITY;
  correspondenceSpanId: string;
  sourceImageKind: typeof AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_SOURCE_IMAGE_KIND;
  sourceImageHash: string;
  overlayImageHash: string;
  attemptId: string;
  loadGeneration: number;
  provider: "google_gemini" | "controlled_fixture";
  model: string;
  promptVersion: typeof AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_PROMPT_VERSION;
  estimate: MetricCorrespondencePhysicalEstimate | null;
  hostAcceptance: MetricCorrespondenceEstimateHostAcceptance;
  failure: MetricCorrespondenceEstimateFailure | null;
}>;

export type MetricCorrespondenceEstimateReceiptContext = Readonly<{
  correspondenceSpanId: string;
  sourceImageHash: string;
  overlayImageHash: string;
  attemptId: string;
  loadGeneration: number;
  provider: "google_gemini" | "controlled_fixture";
  model: string;
}>;

export type MetricCorrespondenceEstimateParseResult =
  | Readonly<{ ok: true; estimate: MetricCorrespondencePhysicalEstimate }>
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

function parseRangeM(value: unknown): MetricSpanRangeM | null | undefined {
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

/**
 * Provider-agnostic similarity scale from a canonical gauge length and a
 * physical length in metres. Identical whether physical length later comes
 * from a matched-span estimate, a known-span measurement, or a trusted
 * sensor/reference.
 */
export function deriveMetricScaleFromSpan(
  canonicalLength: number,
  physicalLengthM: number,
): number | null {
  if (!Number.isFinite(canonicalLength) || canonicalLength <= 0) return null;
  if (!Number.isFinite(physicalLengthM) || physicalLengthM <= 0) return null;
  const scale = physicalLengthM / canonicalLength;
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

export function formatCandidateMetricScale(scale: number): string {
  return `${scale.toFixed(2)}×`;
}

export function parseMetricCorrespondencePhysicalEstimate(
  value: unknown,
): MetricCorrespondenceEstimateParseResult {
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
  const estimatedLengthM = parseRangeM(value.estimatedLengthM);
  if (estimatedLengthM === undefined) {
    return { ok: false, reason: "estimatedLengthM_invalid" };
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
      estimatedLengthM,
      modelConfidence,
      limitations,
      notes,
    }),
  };
}

export function unavailableMetricCorrespondenceEstimateAcceptance(
  reasons: readonly string[],
): MetricCorrespondenceEstimateHostAcceptance {
  return Object.freeze({
    class: "unavailable",
    reasons: Object.freeze([...reasons]),
    candidateMetricScale: null,
  });
}

export function buildMetricCorrespondenceEstimateReceipt(
  context: MetricCorrespondenceEstimateReceiptContext,
  estimate: MetricCorrespondencePhysicalEstimate | null,
  hostAcceptance: MetricCorrespondenceEstimateHostAcceptance,
  failure: MetricCorrespondenceEstimateFailure | null,
): MetricCorrespondenceEstimateReceipt {
  return Object.freeze({
    schemaVersion: AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_VERSION,
    authority: AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_AUTHORITY,
    correspondenceSpanId: context.correspondenceSpanId,
    sourceImageKind: AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_SOURCE_IMAGE_KIND,
    sourceImageHash: context.sourceImageHash,
    overlayImageHash: context.overlayImageHash,
    attemptId: context.attemptId,
    loadGeneration: context.loadGeneration,
    provider: context.provider,
    model: context.model,
    promptVersion: AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_PROMPT_VERSION,
    estimate,
    hostAcceptance,
    failure,
  });
}

export function buildUnavailableMetricCorrespondenceEstimateReceipt(
  context: MetricCorrespondenceEstimateReceiptContext,
  failure: MetricCorrespondenceEstimateFailure,
): MetricCorrespondenceEstimateReceipt {
  return buildMetricCorrespondenceEstimateReceipt(
    context,
    null,
    unavailableMetricCorrespondenceEstimateAcceptance([
      failure.contractValidationReason ?? failure.failureClass,
      failure.safeDetail,
    ].filter(Boolean)),
    failure,
  );
}

export function isMetricCorrespondenceEstimateReceipt(
  value: unknown,
): value is MetricCorrespondenceEstimateReceipt {
  return isRecord(value) &&
    value.schemaVersion === AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_VERSION &&
    value.authority === AFC_V2_METRIC_CORRESPONDENCE_ESTIMATE_AUTHORITY;
}

export function metricCorrespondenceEstimateIsAccepted(
  receipt: MetricCorrespondenceEstimateReceipt | null | undefined,
): boolean {
  return receipt?.hostAcceptance.class === "accepted";
}
