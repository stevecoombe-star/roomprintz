/**
 * M2 observed-span physical estimate contract.
 *
 * Authority is physical_estimate_only. Gemini estimates metres of the
 * exact host-owned highlighted EMPTY segment. It does not choose
 * endpoints, complete walls, or return Auto / Floor / width / depth.
 */

export const AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_VERSION =
  "afc-v2-observed-span-physical-estimate/v1" as const;
export const AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_PROMPT_VERSION =
  "afc-v2-observed-span-physical-estimator/v1" as const;
export const AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_AUTHORITY =
  "physical_estimate_only" as const;
export const AFC_V2_OBSERVED_SPAN_PRIMARY_IMAGE_KIND =
  "EMPTY_OVERLAY" as const;
export const AFC_V2_OBSERVED_SPAN_CONTEXT_IMAGE_KIND =
  "ORIGINAL_CONTEXT" as const;
export const OBSERVED_SPAN_OVERLAY_CAPTION =
  "Estimate this highlighted observed wall segment only" as const;

export type ObservedSpanEstimateImageIdentity = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  orientation: 1;
}>;

export type ObservedSpanRangeM = Readonly<{
  low: number;
  best: number;
  high: number;
}>;

export type ObservedSpanEstimateStatus =
  | "recoverable"
  | "usable"
  | "weak"
  | "not_recoverable";

export type ObservedSpanPhysicalEstimate = Readonly<{
  status: "recoverable" | "weak" | "not_recoverable";
  estimatedLengthM: ObservedSpanRangeM | null;
  modelConfidence: number;
  basis: string | null;
  limitations: readonly string[];
  notes: string | null;
  ambiguity: string | null;
}>;

export type ObservedSpanEstimateHostAcceptanceClass =
  | "accepted"
  | "weak_rejected"
  | "implausible_rejected"
  | "unobservable_rejected"
  | "lineage_rejected"
  | "forbidden_geometry_rejected"
  | "unavailable";

export type ObservedSpanEstimateHostAcceptance = Readonly<{
  class: ObservedSpanEstimateHostAcceptanceClass;
  reasons: readonly string[];
  autoMetricScale: number | null;
}>;

export type ObservedSpanEstimateFailure = Readonly<{
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

export type ObservedSpanEstimateLineage = Readonly<{
  attemptId: string;
  loadGeneration: number;
  s4aCandidateId: string;
  sourceSeamId: string;
  observationSource: string;
  emptySha256: string;
  emptyByteCount: number;
  emptyDecodedWidth: number;
  emptyDecodedHeight: number;
  originalSha256: string | null;
  floorAuthorityKey: string;
  freezeReceiptVersion: string | null;
  freezePayloadSha256: string | null;
  emptyNormalizedA: Readonly<{ x: number; y: number }>;
  emptyNormalizedB: Readonly<{ x: number; y: number }>;
  canonicalWorldA: Readonly<{ x: number; z: number }>;
  canonicalWorldB: Readonly<{ x: number; z: number }>;
  canonicalLength: number;
  highlightedImageKind: typeof AFC_V2_OBSERVED_SPAN_PRIMARY_IMAGE_KIND;
  overlayRasterSha256: string;
  promptVersion: typeof AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_PROMPT_VERSION;
  schemaVersion: typeof AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_VERSION;
  junctionProofType: string | null;
  junctionMateCandidateId: string | null;
  junctionMateSourceSeamId: string | null;
}>;

export type ObservedSpanPhysicalEstimateReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_VERSION;
  authority: typeof AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_AUTHORITY;
  lineage: ObservedSpanEstimateLineage;
  sourceImageKind: typeof AFC_V2_OBSERVED_SPAN_PRIMARY_IMAGE_KIND;
  contextImageKind: typeof AFC_V2_OBSERVED_SPAN_CONTEXT_IMAGE_KIND | null;
  overlayImageHash: string;
  provider: "google_gemini" | "controlled_fixture";
  model: string;
  promptVersion: typeof AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_PROMPT_VERSION;
  estimate: ObservedSpanPhysicalEstimate | null;
  hostAcceptance: ObservedSpanEstimateHostAcceptance;
  failure: ObservedSpanEstimateFailure | null;
  diagnostics: Readonly<{
    estimatorLaunched: boolean;
    originalIncludedAsUnhighlightedContext: boolean;
    canonicalLengthSentToProvider: false;
    autoMetricScaleSentToProvider: false;
    widthDepthSentAsExpectedAnswer: false;
    forbiddenGeometryFieldsPresent: boolean;
  }>;
}>;

export type ObservedSpanEstimateParseResult =
  | Readonly<{ ok: true; estimate: ObservedSpanPhysicalEstimate }>
  | Readonly<{ ok: false; reason: string }>;

const MAX_LIMITATIONS = 24;
const MAX_LIMITATION_CHARS = 240;
const MAX_NOTES_CHARS = 480;

export const OBSERVED_SPAN_FORBIDDEN_GEOMETRY_KEYS = Object.freeze([
  "endpoints",
  "endpointA",
  "endpointB",
  "imageA",
  "imageB",
  "alternateSeam",
  "alternate_seam",
  "sourceSeamId",
  "completedWall",
  "completeWall",
  "hiddenContinuation",
  "estimatedRoomWidthM",
  "estimatedRoomDepthM",
  "roomWidthM",
  "roomDepthM",
  "roomWidth",
  "roomDepth",
  "autoMetricScale",
  "canonicalLength",
  "canonicalWorldA",
  "canonicalWorldB",
  "floorWidthM",
  "floorDepthM",
  "worldWidthM",
  "worldDepthM",
  "correctedGeometry",
  "worldA",
  "worldB",
  "polyline",
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRangeM(value: unknown): ObservedSpanRangeM | null | undefined {
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

function optionalText(value: unknown, maxChars: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim().slice(0, maxChars);
  return trimmed.length > 0 ? trimmed : null;
}

export function observedSpanForbiddenGeometryFields(
  value: unknown,
): readonly string[] {
  if (!isRecord(value)) return Object.freeze([]);
  return Object.freeze(
    OBSERVED_SPAN_FORBIDDEN_GEOMETRY_KEYS.filter((key) => key in value),
  );
}

export function parseObservedSpanPhysicalEstimate(
  value: unknown,
): ObservedSpanEstimateParseResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "provider_result_not_object" };
  }
  const forbidden = observedSpanForbiddenGeometryFields(value);
  if (forbidden.length > 0) {
    return { ok: false, reason: "forbidden_geometry_authority_fields" };
  }
  const rawStatus = value.status ?? value.observability;
  let status: ObservedSpanPhysicalEstimate["status"] | null = null;
  if (rawStatus === "recoverable" || rawStatus === "usable") {
    status = "recoverable";
  } else if (rawStatus === "weak" || rawStatus === "not_recoverable") {
    status = rawStatus;
  }
  if (!status) {
    return { ok: false, reason: "status_invalid" };
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
  const notes = optionalText(value.notes, MAX_NOTES_CHARS);
  if (notes === undefined) {
    return { ok: false, reason: "notes_invalid" };
  }
  const basis = optionalText(value.basis, MAX_NOTES_CHARS);
  if (basis === undefined) {
    return { ok: false, reason: "basis_invalid" };
  }
  const ambiguity = optionalText(value.ambiguity, MAX_LIMITATION_CHARS);
  if (ambiguity === undefined) {
    return { ok: false, reason: "ambiguity_invalid" };
  }
  return {
    ok: true,
    estimate: Object.freeze({
      status,
      estimatedLengthM,
      modelConfidence,
      basis,
      limitations,
      notes,
      ambiguity,
    }),
  };
}

export function unavailableObservedSpanEstimateAcceptance(
  reasons: readonly string[],
): ObservedSpanEstimateHostAcceptance {
  return Object.freeze({
    class: "unavailable",
    reasons: Object.freeze([...reasons]),
    autoMetricScale: null,
  });
}

export function buildObservedSpanPhysicalEstimateReceipt(input: Readonly<{
  lineage: ObservedSpanEstimateLineage;
  contextImageKind: typeof AFC_V2_OBSERVED_SPAN_CONTEXT_IMAGE_KIND | null;
  overlayImageHash: string;
  provider: "google_gemini" | "controlled_fixture";
  model: string;
  estimate: ObservedSpanPhysicalEstimate | null;
  hostAcceptance: ObservedSpanEstimateHostAcceptance;
  failure: ObservedSpanEstimateFailure | null;
  originalIncludedAsUnhighlightedContext: boolean;
  forbiddenGeometryFieldsPresent: boolean;
  estimatorLaunched?: boolean;
}>): ObservedSpanPhysicalEstimateReceipt {
  return Object.freeze({
    schemaVersion: AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_VERSION,
    authority: AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_AUTHORITY,
    lineage: input.lineage,
    sourceImageKind: AFC_V2_OBSERVED_SPAN_PRIMARY_IMAGE_KIND,
    contextImageKind: input.contextImageKind,
    overlayImageHash: input.overlayImageHash,
    provider: input.provider,
    model: input.model,
    promptVersion: AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_PROMPT_VERSION,
    estimate: input.estimate,
    hostAcceptance: input.hostAcceptance,
    failure: input.failure,
    diagnostics: Object.freeze({
      estimatorLaunched: input.estimatorLaunched !== false,
      originalIncludedAsUnhighlightedContext:
        input.originalIncludedAsUnhighlightedContext,
      canonicalLengthSentToProvider: false,
      autoMetricScaleSentToProvider: false,
      widthDepthSentAsExpectedAnswer: false,
      forbiddenGeometryFieldsPresent: input.forbiddenGeometryFieldsPresent,
    }),
  });
}

export function isObservedSpanPhysicalEstimateReceipt(
  value: unknown,
): value is ObservedSpanPhysicalEstimateReceipt {
  return isRecord(value) &&
    value.schemaVersion === AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_VERSION &&
    value.authority === AFC_V2_OBSERVED_SPAN_PHYSICAL_ESTIMATE_AUTHORITY;
}

export function observedSpanPhysicalEstimateIsAccepted(
  receipt: ObservedSpanPhysicalEstimateReceipt | null | undefined,
): boolean {
  return receipt?.hostAcceptance.class === "accepted";
}
