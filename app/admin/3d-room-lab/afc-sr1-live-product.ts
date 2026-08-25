import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  getAutoFloorVisionAllowedImageHosts,
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  getEmptyRoomAssistResultAllowedHosts,
  isAutoFloorVisionAllowLocalhostHttp,
} from "@/lib/vibodeAutoFloorVisionConfig";
import {
  fetchRoomImageSafely,
  inspectImageMetadata,
} from "@/lib/vibodeAutoFloorImageFetch";
import {
  getOrGenerateEmptyRoomImage,
  type EmptyRoomAssistGenerateResult,
} from "@/lib/vibodeEmptyRoomAssist";
import {
  AFC_SR1_LIVE_PRODUCT_VERSION,
  type AfcSr1LiveAnalyzeRequest,
  type AfcSr1LiveAttemptCounts,
  type AfcSr1LiveBasis,
  type AfcSr1LiveDiagnostics,
  type AfcSr1LiveFloorReadDiagnostic,
  type AfcSr1LiveFailureReason,
  type AfcSr1LiveProductResult,
} from "./afc-sr1-live-product-contract";
import {
  deriveAfcSr1OnAxisParallelWidthFloor,
  type AfcSr1OnAxisParallelWidthResult,
} from "./afc-sr1-on-axis-parallel-width";
import {
  AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION,
  classifyAfcSr1SupportedRoomView,
  type AfcSr1SupportedRoomViewResult,
} from "./afc-sr1-supported-room-view";
import {
  resolveCanonicalAfcFloorFromEmpty,
  type AfcSr1CanonicalFloorResolverResult,
} from "./afc-sr1-canonical-floor-resolver";
import { validateFloorSourcePolygonExtent } from "./floor-coordinate-extent";
import { validateOrderedFloorCorners } from "./perspective-solve";
import {
  buildAfcSr1BasisBoundSourcePolygon,
} from "./research/afc-sr1-basis-bound-source-polygon";
import type {
  AfcSr1ExplicitAnchorAuthorityV1,
} from "./research/afc-sr1-common-basis-tr0-handoff";
import {
  classifyAfcR3cImagePairCompatibility,
} from "./research/gemini-floor-proposal-composition";
import {
  executeAfcSr1RawFirstPlacementAwareOrchestration,
  type AfcSr1RawFirstPlacementAwareDependenciesV1,
  type AfcSr1RawFirstPlacementAwareOrchestrationInputV1,
  type AfcSr1RawFirstPlacementAwareOrchestrationResultV1,
} from "./research/afc-sr1-raw-first-placement-aware-orchestration";
import type {
  AfcSr1SourcePolygon,
} from "./research/afc-sr1-semantic-prior";
import { validateAfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ATTEMPT_EVIDENCE = 8;
const EMPTY_GENERATION_TIMEOUT_MS = 120_000;

export type AfcSr1QualifiedOriginal = Readonly<{
  basis: AfcSr1LiveBasis;
  sourceImageUrl: string;
}>;

export type AfcSr1ResolvedEmpty = Readonly<{
  basis: AfcSr1LiveBasis;
  bytes: Uint8Array;
  generated: boolean;
}>;

type FloorProposalResult =
  | Readonly<{
      status: "selected";
      polygon: AfcSr1SourcePolygon;
      selectedCandidateId: string;
      selectedCandidateIndex: number;
      candidateCount: number;
      geometryScore: number;
      scoreBand: "high" | "medium" | "low";
      model: string;
    }>
  | Readonly<{
      status: "insufficient_evidence";
      reason: string;
      evidenceDigest: string | null;
    }>
  | Readonly<{
      status: "failed";
      reason: string;
      evidenceDigest: string | null;
    }>;

export type AfcSr1LiveAttemptEvidence = {
  binding?: Readonly<{
    attemptId: string;
    resultId: string;
    labLoadGeneration: number;
    originalBasis: AfcSr1LiveBasis;
    emptyBasis: AfcSr1LiveBasis;
  }>;
  floorRead?: Readonly<{
    emptyBytes: Uint8Array;
    emptyBasis: AfcSr1LiveBasis;
  }>;
  tiledPerspective?: Readonly<{
    tiledBytes: Uint8Array;
    tiledBasis: AfcSr1LiveBasis;
    resultId?: string;
  }>;
  ts0Child?: Readonly<{
    bytes: Uint8Array;
    sha256: string;
    lineageEvidenceDigest: string;
  }>;
};

const attemptEvidence = new Map<string, AfcSr1LiveAttemptEvidence>();
const inFlightEmpty = new Map<string, Promise<EmptyRoomAssistGenerateResult>>();
const LIVE_EMPTY_DIAGNOSTIC_ROUTE =
  "/api/admin/3d-room-lab/afc-sr1/live-attempt-empty";
const LIVE_TILED_DIAGNOSTIC_ROUTE =
  "/api/admin/3d-room-lab/afc-sr1/live-attempt-tiled";

export function getAfcSr1LiveAttemptEvidence(
  attemptId: string
): Readonly<AfcSr1LiveAttemptEvidence> | null {
  return attemptEvidence.get(attemptId) ?? null;
}

export function retainAfcSr1LiveAttemptEmptyEvidence(
  input: Readonly<{
    attemptId: string;
    resultId: string;
    labLoadGeneration: number;
    originalBasis: AfcSr1LiveBasis;
    empty: AfcSr1ResolvedEmpty;
  }>
): void {
  const evidence: AfcSr1LiveAttemptEvidence = {
    binding: Object.freeze({
      attemptId: input.attemptId,
      resultId: input.resultId,
      labLoadGeneration: input.labLoadGeneration,
      originalBasis: Object.freeze({ ...input.originalBasis }),
      emptyBasis: Object.freeze({ ...input.empty.basis }),
    }),
    floorRead: Object.freeze({
      emptyBytes: Uint8Array.from(input.empty.bytes),
      emptyBasis: Object.freeze({ ...input.empty.basis }),
    }),
  };
  attemptEvidence.delete(input.attemptId);
  attemptEvidence.set(input.attemptId, evidence);
  evictOldestAttemptEvidence();
}

function evictOldestAttemptEvidence(): void {
  while (attemptEvidence.size > MAX_ATTEMPT_EVIDENCE) {
    const oldest = attemptEvidence.keys().next().value;
    if (typeof oldest !== "string") break;
    attemptEvidence.delete(oldest);
  }
}

function attemptBindingMatches(
  evidence: AfcSr1LiveAttemptEvidence,
  attemptId: string,
  resultId: string
): boolean {
  return (
    evidence.binding?.attemptId === attemptId &&
    evidence.binding.resultId === resultId
  );
}

/**
 * TILED is retained only beside the EMPTY/Original binding from the same
 * product result. A reused attempt key cannot splice evidence across results.
 */
export function retainAfcSr1LiveAttemptTiledEvidence(
  attemptId: string,
  resultId: string,
  tiledBytes: Uint8Array,
  tiledBasis: AfcSr1LiveBasis
): void {
  const evidence = attemptEvidence.get(attemptId);
  if (!evidence || !attemptBindingMatches(evidence, attemptId, resultId)) {
    return;
  }
  evidence.tiledPerspective = Object.freeze({
    tiledBytes: Uint8Array.from(tiledBytes),
    tiledBasis: Object.freeze({ ...tiledBasis }),
    resultId,
  });
}

export function afcSr1LiveTiledDiagnosticImages(attemptId: string) {
  const encodedAttemptId = encodeURIComponent(attemptId);
  return Object.freeze({
    emptyUrl: `${LIVE_EMPTY_DIAGNOSTIC_ROUTE}?attemptId=${encodedAttemptId}`,
    tiledUrl: `${LIVE_TILED_DIAGNOSTIC_ROUTE}?attemptId=${encodedAttemptId}`,
  });
}

function retainAttemptEvidence(attemptId: string): AfcSr1LiveAttemptEvidence {
  let evidence = attemptEvidence.get(attemptId);
  if (!evidence) {
    evidence = {};
    attemptEvidence.set(attemptId, evidence);
    evictOldestAttemptEvidence();
  }
  return evidence;
}

function hash(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function detectMime(
  bytes: Uint8Array
): AfcSr1LiveBasis["mimeType"] | null {
  const buffer = Buffer.from(bytes);
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function qualifyAfcSr1LiveOriginalDefault(
  request: AfcSr1LiveAnalyzeRequest
): Promise<AfcSr1QualifiedOriginal | null> {
  const fetched = await fetchRoomImageSafely(request.sourceImageUrl, {
    allowedHosts: getAutoFloorVisionAllowedImageHosts(),
    maxBytes: getAutoFloorVisionImageMaxBytes(),
    timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
    allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
  });
  if (!fetched.ok) return null;
  const mime = detectMime(fetched.buffer);
  if (!mime || mime !== fetched.mime) return null;
  const metadata = await inspectImageMetadata(fetched.buffer);
  if (!metadata.ok || metadata.orientation !== 1) return null;
  return Object.freeze({
    sourceImageUrl: request.sourceImageUrl,
    basis: Object.freeze({
      sha256: hash(fetched.buffer),
      byteCount: fetched.byteCount,
      decodedWidth: metadata.width,
      decodedHeight: metadata.height,
      mimeType: mime,
      orientation: 1,
    }),
  });
}

export async function resolveAfcSr1LiveEmptyDefault(
  original: AfcSr1QualifiedOriginal
): Promise<AfcSr1ResolvedEmpty | null> {
  const existing = inFlightEmpty.get(original.basis.sha256);
  let ownsGeneration = false;
  let promise = existing;
  if (!promise) {
    ownsGeneration = true;
    promise = getOrGenerateEmptyRoomImage({
      originalHash: original.basis.sha256,
      baseImageUrl: original.sourceImageUrl,
      resultAllowedHosts: getEmptyRoomAssistResultAllowedHosts(),
      maxBytes: getAutoFloorVisionImageMaxBytes(),
      fetchTimeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
      allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
      generationTimeoutMs: EMPTY_GENERATION_TIMEOUT_MS,
    });
    inFlightEmpty.set(original.basis.sha256, promise);
  }
  let result: EmptyRoomAssistGenerateResult;
  try {
    result = await promise;
  } finally {
    if (ownsGeneration) inFlightEmpty.delete(original.basis.sha256);
  }
  if (!result.ok) return null;
  const bytes = Buffer.from(result.image.base64, "base64");
  const mime = detectMime(bytes);
  const metadata = await inspectImageMetadata(bytes);
  if (!mime || mime !== result.image.mime || !metadata.ok ||
      metadata.orientation !== 1) {
    return null;
  }
  return Object.freeze({
    basis: Object.freeze({
      sha256: hash(bytes),
      byteCount: bytes.byteLength,
      decodedWidth: metadata.width,
      decodedHeight: metadata.height,
      mimeType: mime,
      orientation: 1,
    }),
    bytes: Uint8Array.from(bytes),
    generated: ownsGeneration && result.cacheStatus === "miss",
  });
}

function mapResolverFailure(
  result: Extract<AfcSr1CanonicalFloorResolverResult, { status: "failed" }>
): FloorProposalResult {
  if (result.reason === "zero_candidates" ||
      result.reason === "all_geometry_invalid") {
    return Object.freeze({
      status: "insufficient_evidence",
      reason: result.reason,
      evidenceDigest: null,
    });
  }
  return Object.freeze({
    status: "failed",
    reason: result.reason,
    evidenceDigest: null,
  });
}

async function resolveCanonicalFloorDefault(
  request: AfcSr1LiveAnalyzeRequest,
  _original: AfcSr1QualifiedOriginal,
  empty: AfcSr1ResolvedEmpty
): Promise<FloorProposalResult> {
  const resolved = await resolveCanonicalAfcFloorFromEmpty({
    empty: {
      bytes: empty.bytes,
      sha256: empty.basis.sha256,
      byteCount: empty.basis.byteCount,
      mimeType: empty.basis.mimeType,
      decodedWidth: empty.basis.decodedWidth,
      decodedHeight: empty.basis.decodedHeight,
      orientation: 1,
    },
    attemptId: request.attemptId,
  });
  if (resolved.status === "failed") return mapResolverFailure(resolved);
  return Object.freeze({
    status: "selected",
    polygon: resolved.polygon,
    selectedCandidateId: resolved.selectedCandidateId,
    selectedCandidateIndex: resolved.selectedCandidateIndex,
    candidateCount: resolved.candidateCount,
    geometryScore: resolved.geometryScore,
    scoreBand: resolved.scoreBand,
    model: resolved.model,
  });
}

export function isValidAfcSr1LiveAnalyzeRequest(value: AfcSr1LiveAnalyzeRequest): boolean {
  return (
    !!value &&
    typeof value.attemptId === "string" &&
    /^[A-Za-z0-9._-]{1,180}$/.test(value.attemptId) &&
    typeof value.sourceImageUrl === "string" &&
    value.sourceImageUrl.length > 0 &&
    value.sourceImageUrl.length <= 4096 &&
    Number.isSafeInteger(value.labLoadGeneration) &&
    value.labLoadGeneration >= 0 &&
    Number.isFinite(value.referenceDepthM) &&
    value.referenceDepthM > 0 &&
    !!value.sourceImageIdentity &&
    SHA256.test(value.sourceImageIdentity.sha256) &&
    Number.isSafeInteger(value.sourceImageIdentity.decodedWidth) &&
    value.sourceImageIdentity.decodedWidth > 0 &&
    Number.isSafeInteger(value.sourceImageIdentity.decodedHeight) &&
    value.sourceImageIdentity.decodedHeight > 0 &&
    value.sourceImageIdentity.orientation === 1
  );
}

export function afcSr1LiveSourceIdentityMatches(
  request: AfcSr1LiveAnalyzeRequest,
  original: AfcSr1QualifiedOriginal
): boolean {
  const expected = request.sourceImageIdentity;
  const actual = original.basis;
  return (
    expected.sha256 === actual.sha256 &&
    expected.decodedWidth === actual.decodedWidth &&
    expected.decodedHeight === actual.decodedHeight &&
    expected.orientation === actual.orientation
  );
}

export function isValidAfcSr1LiveProductPolygon(value: unknown): value is AfcSr1SourcePolygon {
  try {
    validateAfcSr1SourcePolygon(value);
  } catch {
    return false;
  }
  return (
    validateFloorSourcePolygonExtent(value).ok &&
    validateOrderedFloorCorners(value.map((point) => ({ ...point }))).ok
  );
}

function isInFrame(polygon: AfcSr1SourcePolygon): boolean {
  return polygon.every(
    (point) =>
      point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
  );
}

export function cloneAfcSr1LivePolygon(polygon: AfcSr1SourcePolygon): AfcSr1SourcePolygon {
  return Object.freeze(
    polygon.map((point) => Object.freeze({ ...point })) as unknown as
      AfcSr1SourcePolygon
  );
}

function floorReadDiagnostic(
  request: AfcSr1LiveAnalyzeRequest,
  resultId: string,
  original: AfcSr1QualifiedOriginal,
  empty: AfcSr1ResolvedEmpty,
  selected: Extract<FloorProposalResult, { status: "selected" }>
): AfcSr1LiveFloorReadDiagnostic {
  retainAfcSr1LiveAttemptEmptyEvidence({
    attemptId: request.attemptId,
    resultId,
    labLoadGeneration: request.labLoadGeneration,
    originalBasis: original.basis,
    empty,
  });
  return Object.freeze({
    detectorKind: "empty_room_assist_empty_arm",
    polygon: cloneAfcSr1LivePolygon(selected.polygon),
    selectedCandidateId: selected.selectedCandidateId,
    selectedCandidateIndex: selected.selectedCandidateIndex,
    candidateCount: selected.candidateCount,
    geometryScore: selected.geometryScore,
    scoreBand: selected.scoreBand,
    model: selected.model,
    analysisBasis: Object.freeze({
      decodedWidth: empty.basis.decodedWidth,
      decodedHeight: empty.basis.decodedHeight,
    }),
    emptyImage: Object.freeze({
      kind: "attempt_bound_empty_image",
      url: `${LIVE_EMPTY_DIAGNOSTIC_ROUTE}?attemptId=${encodeURIComponent(
        request.attemptId
      )}`,
    }),
    originalPreview: Object.freeze({
      kind: "current_qualified_original_preview_only",
      decodedWidth: original.basis.decodedWidth,
      decodedHeight: original.basis.decodedHeight,
    }),
  });
}

function correctedOffAxisPolygon(
  raw: AfcSr1SourcePolygon,
  adjustableCorner: "NL" | "NR",
  seamT: number
): AfcSr1SourcePolygon | null {
  if (!Number.isFinite(seamT) || seamT <= 0 || seamT >= 1) return null;
  const index = adjustableCorner === "NL" ? 0 : 1;
  const farIndex = adjustableCorner === "NL" ? 3 : 2;
  const near = raw[index];
  const far = raw[farIndex];
  const corrected = raw.map((point, pointIndex) =>
    pointIndex === index
      ? Object.freeze({
          x: near.x + seamT * (far.x - near.x),
          y: near.y + seamT * (far.y - near.y),
        })
      : Object.freeze({ ...point })
  ) as unknown as AfcSr1SourcePolygon;
  return isValidAfcSr1LiveProductPolygon(corrected) ? Object.freeze(corrected) : null;
}

type MutableAttemptCounts = {
  -readonly [Key in keyof AfcSr1LiveAttemptCounts]: AfcSr1LiveAttemptCounts[Key];
};

function emptyCounts(): MutableAttemptCounts {
  return {
    originalQualification: 0,
    emptyGeneration: 0,
    tiledGeneration: 0,
    tiledReader: 0,
    geminiFloorProposal: 0,
    supportedRoomClassifier: 0,
    onAxisCorrection: 0,
    pathA: 0,
    rawReader: 0,
    ts0: 0,
    placement: 0,
    childReader: 0,
  };
}

function evidenceDigest(
  request: AfcSr1LiveAnalyzeRequest,
  resultId: string,
  counts: AfcSr1LiveAttemptCounts,
  finalReason: string | null
): string {
  return hash(JSON.stringify({
    schemaVersion: AFC_SR1_LIVE_PRODUCT_VERSION,
    attemptId: request?.attemptId ?? "",
    resultId,
    sourceImageIdentity: request?.sourceImageIdentity ?? null,
    labLoadGeneration: request?.labLoadGeneration ?? -1,
    counts,
    finalReason,
  }));
}

type ClassifierFailureDiagnostics =
  NonNullable<AfcSr1LiveDiagnostics["supportedRoomClassifier"]>;

function classifierFailureDiagnostics(
  classification: AfcSr1SupportedRoomViewResult,
  polygon: AfcSr1SourcePolygon,
  empty: AfcSr1ResolvedEmpty
): ClassifierFailureDiagnostics | null {
  if (classification.status !== "unsupported" || !classification.observables) {
    return null;
  }
  const [NL, NR, FR, FL] = polygon;
  return Object.freeze({
    classifierVersion: classification.classifierVersion,
    emptyDecodedWidth: empty.basis.decodedWidth,
    emptyDecodedHeight: empty.basis.decodedHeight,
    semanticFloorPolygon: Object.freeze({
      NL: Object.freeze({ ...NL }),
      NR: Object.freeze({ ...NR }),
      FR: Object.freeze({ ...FR }),
      FL: Object.freeze({ ...FL }),
    }),
    observables: classification.observables,
    reason: classification.reason,
  });
}

function diagnostics(
  request: AfcSr1LiveAnalyzeRequest,
  resultId: string,
  counts: AfcSr1LiveAttemptCounts,
  finalReason: string | null,
  pathA: AfcSr1RawFirstPlacementAwareOrchestrationResultV1 | null,
  floorRead: AfcSr1LiveFloorReadDiagnostic | null = null,
  supportedRoomClassifier: ClassifierFailureDiagnostics | null = null
): AfcSr1LiveDiagnostics {
  return Object.freeze({
    finalReason,
    placementStatus: pathA?.fallbackAttempt?.placement?.status ?? null,
    placementReason:
      pathA?.diagnostics.placementReason ??
      pathA?.fallbackAttempt?.placement?.reason ??
      null,
    validationP90Px: pathA?.diagnostics.validationP90Px ?? null,
    evidenceDigest: pathA?.evidenceDigest.value ??
      evidenceDigest(request, resultId, counts, finalReason),
    sameAttemptTs0Retained:
      attemptEvidence.get(request.attemptId)?.ts0Child !== undefined,
    attemptCounts: Object.freeze({ ...counts }),
    floorReadDiagnostic: floorRead,
    v3ReaderDiagnostics: pathA?.diagnostics.v3ReaderDiagnostics ?? Object.freeze({
      rawReader: null,
      childReader: null,
      authoritativeReaderRole: null,
    }),
    supportedRoomClassifier,
  });
}

export type AfcSr1LiveProductDependencies = Readonly<{
  qualifyOriginal?: (
    request: AfcSr1LiveAnalyzeRequest
  ) => Promise<AfcSr1QualifiedOriginal | null>;
  resolveEmpty?: (
    original: AfcSr1QualifiedOriginal
  ) => Promise<AfcSr1ResolvedEmpty | null>;
  resolveCanonicalFloor?: (
    request: AfcSr1LiveAnalyzeRequest,
    original: AfcSr1QualifiedOriginal,
    empty: AfcSr1ResolvedEmpty
  ) => Promise<FloorProposalResult>;
  classifyRoom?: typeof classifyAfcSr1SupportedRoomView;
  deriveOnAxis?: typeof deriveAfcSr1OnAxisParallelWidthFloor;
  executePathA?: (
    input: AfcSr1RawFirstPlacementAwareOrchestrationInputV1,
    dependencies?: AfcSr1RawFirstPlacementAwareDependenciesV1
  ) => Promise<AfcSr1RawFirstPlacementAwareOrchestrationResultV1>;
  pathADependencies?: AfcSr1RawFirstPlacementAwareDependenciesV1;
  createResultId?: () => string;
}>;

export async function executeAfcSr1CompleteProductAttempt(
  request: AfcSr1LiveAnalyzeRequest,
  dependencies: AfcSr1LiveProductDependencies = {}
): Promise<AfcSr1LiveProductResult> {
  const resultId = dependencies.createResultId?.() ?? randomUUID();
  const counts = emptyCounts();
  retainAttemptEvidence(request?.attemptId ?? resultId);

  const failed = (
    reason: AfcSr1LiveFailureReason,
    detail: string,
    pathA: AfcSr1RawFirstPlacementAwareOrchestrationResultV1 | null = null,
    floorRead: AfcSr1LiveFloorReadDiagnostic | null = null,
    supportedRoomClassifier: ClassifierFailureDiagnostics | null = null
  ): AfcSr1LiveProductResult => Object.freeze({
    status: "failed",
    schemaVersion: AFC_SR1_LIVE_PRODUCT_VERSION,
    attemptId: request?.attemptId ?? "",
    resultId,
    labLoadGeneration: request?.labLoadGeneration ?? -1,
    reason,
    detail,
    diagnostics: diagnostics(
      request,
      resultId,
      counts,
      detail,
      pathA,
      floorRead,
      supportedRoomClassifier
    ),
  });

  if (!isValidAfcSr1LiveAnalyzeRequest(request)) {
    return failed("invalid_request", "request_contract_invalid");
  }

  counts.originalQualification = 1;
  const original = await (
    dependencies.qualifyOriginal ?? qualifyAfcSr1LiveOriginalDefault
  )(request);
  if (!original) {
    return failed(
      "original_qualification_failed",
      "original_refetch_or_decode_failed"
    );
  }
  if (!afcSr1LiveSourceIdentityMatches(request, original)) {
    return failed("source_identity_mismatch", "qualified_source_basis_mismatch");
  }

  const empty = await (dependencies.resolveEmpty ?? resolveAfcSr1LiveEmptyDefault)(
    original
  );
  if (!empty) {
    return failed("empty_generation_failed", "empty_generation_or_decode_failed");
  }
  counts.emptyGeneration = empty.generated ? 1 : 0;

  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: original.basis.sha256,
      decodedWidth: original.basis.decodedWidth,
      decodedHeight: original.basis.decodedHeight,
      orientation: original.basis.orientation,
    },
    {
      fingerprint: empty.basis.sha256,
      decodedWidth: empty.basis.decodedWidth,
      decodedHeight: empty.basis.decodedHeight,
      orientation: empty.basis.orientation,
    }
  );
  if (compatibility.tier === "incompatible") {
    return failed("original_empty_incompatible", "image_pair_incompatible");
  }

  // One call is the canonical EMPTY-arm detector; it is not an R3C proposal.
  counts.geminiFloorProposal = 1;
  const proposal = await (
    dependencies.resolveCanonicalFloor ?? resolveCanonicalFloorDefault
  )(request, original, empty);
  if (proposal.status === "insufficient_evidence") {
    return failed("gemini_insufficient_evidence", proposal.reason);
  }
  if (proposal.status === "failed") {
    return failed(
      proposal.reason === "provider_timeout" ||
      proposal.reason === "provider_transport"
        ? "gemini_transport_failed"
        : "gemini_response_invalid",
      proposal.reason
    );
  }
  if (!isValidAfcSr1LiveProductPolygon(proposal.polygon)) {
    return failed("floor_proposal_invalid", "canonical_floor_polygon_invalid");
  }
  if (!isInFrame(proposal.polygon)) {
    return failed("floor_proposal_off_frame", "path_a_roi_requires_unit_frame");
  }
  const acceptedFloorRead = floorReadDiagnostic(
    request,
    resultId,
    original,
    empty,
    proposal
  );

  counts.supportedRoomClassifier = 1;
  const classification: AfcSr1SupportedRoomViewResult = (
    dependencies.classifyRoom ?? classifyAfcSr1SupportedRoomView
  )(proposal.polygon, {
    decodedWidth: empty.basis.decodedWidth,
    decodedHeight: empty.basis.decodedHeight,
  });
  if (classification.status !== "supported") {
    return failed(
      "supported_room_ambiguous",
      classification.reason,
      null,
      acceptedFloorRead,
      classifierFailureDiagnostics(classification, proposal.polygon, empty)
    );
  }
  const transferKind = compatibility.tier === "exact_grid_compatible"
    ? "paired_cross_role_exact_grid" as const
    : "paired_cross_role_aspect_rescaled" as const;
  const acceptanceBasis = Object.freeze({
    basisFingerprint: original.basis.sha256,
    decodedWidth: original.basis.decodedWidth,
    decodedHeight: original.basis.decodedHeight,
    orientation: 1 as const,
    transferKind,
    transferProvenance: "afc-sr1-empty-room-assist-source-normalized/v1",
  });
  const metric = Object.freeze({
    perspectiveAuthority: "afc_derived" as const,
    metricScaleAuthority: "provisional_reference_depth" as const,
    referenceDepthM: request.referenceDepthM,
  });

  if (classification.photoClass === "on_axis") {
    counts.onAxisCorrection = 1;
    const onAxis: AfcSr1OnAxisParallelWidthResult = (
      dependencies.deriveOnAxis ?? deriveAfcSr1OnAxisParallelWidthFloor
    )(proposal.polygon);
    if (onAxis.status !== "derived") {
      return failed(
        "on_axis_correction_failed",
        onAxis.reason,
        null,
        acceptedFloorRead
      );
    }
    return Object.freeze({
      status: "authoritative_geometry",
      schemaVersion: AFC_SR1_LIVE_PRODUCT_VERSION,
      attemptId: request.attemptId,
      resultId,
      labLoadGeneration: request.labLoadGeneration,
      originalBasis: original.basis,
      emptyBasis: empty.basis,
      photoClass: "on_axis",
      geometry: Object.freeze({
        mode: "on-axis-parallel-width",
        geometryAuthority: "on_axis_parallel_width_derived",
        sourceNormalizedPolygon: cloneAfcSr1LivePolygon(onAxis.correctedPolygon),
        rawSourceNormalizedPolygon: cloneAfcSr1LivePolygon(proposal.polygon),
        fixedAnchor: null,
        adjustableCorner: null,
        baselineSeamT: null,
        acceptanceBasis,
        classifierVersion: classification.classifierVersion,
        anchorAuthorityKind: null,
        onAxisConstruction: onAxis.construction,
      }),
      metric,
      perspectiveAdjust: Object.freeze({
        supported: false,
        reason: "on_axis_not_applicable_v1",
      }),
      diagnostics: diagnostics(
        request,
        resultId,
        counts,
        null,
        null,
        acceptedFloorRead
      ),
    });
  }

  const truncatedAnchor = classification.truncatedAnchor;
  if (!truncatedAnchor) {
    return failed(
      "supported_room_ambiguous",
      "off_axis_anchor_unresolved",
      null,
      acceptedFloorRead
    );
  }
  const evidenceReference = [
    `attempt=${request.attemptId}`,
    "detector=empty_room_assist_empty_arm",
    `candidate=${proposal.selectedCandidateId}`,
    `candidateIndex=${proposal.selectedCandidateIndex}`,
    `candidateCount=${proposal.candidateCount}`,
    `scoreBand=${proposal.scoreBand}`,
    `geometryScore=${proposal.geometryScore}`,
    `model=${proposal.model}`,
    `classifier=${AFC_SR1_SUPPORTED_ROOM_VIEW_CLASSIFIER_VERSION}`,
    `empty=${empty.basis.sha256}`,
    `photoClass=${classification.photoClass}`,
    `truncatedAnchor=${truncatedAnchor}`,
    `leftVisibleRunPx=${classification.observables.leftVisibleRunPx}`,
    `rightVisibleRunPx=${classification.observables.rightVisibleRunPx}`,
    `truncationAsymmetry=${classification.observables.truncationAsymmetry}`,
  ].join(";");
  const basisBoundSourcePolygon = buildAfcSr1BasisBoundSourcePolygon({
    polygon: proposal.polygon,
    basis: {
      fingerprint: empty.basis.sha256,
      decodedWidth: empty.basis.decodedWidth,
      decodedHeight: empty.basis.decodedHeight,
      orientation: 1,
    },
    provenance: {
      kind: "empty_room_read",
      evidenceReference:
        evidenceReference,
    },
  });
  const anchorAuthority: AfcSr1ExplicitAnchorAuthorityV1 = Object.freeze({
    kind: "supported_domain_near_side_derived",
    truncatedAnchor,
    evidenceReference,
  });
  counts.pathA = 1;
  let pathA: AfcSr1RawFirstPlacementAwareOrchestrationResultV1;
  try {
    pathA = await (
      dependencies.executePathA ??
        executeAfcSr1RawFirstPlacementAwareOrchestration
    )({
      parentImageBytes: empty.bytes,
      parentImageIdentity: empty.basis,
      basisBoundSourcePolygon,
      truncatedAnchor,
      anchorAuthority,
      ts0ScaffoldOptions: {
        resultAllowedHosts: getEmptyRoomAssistResultAllowedHosts(),
        maxOutputBytes: getAutoFloorVisionImageMaxBytes(),
        fetchTimeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
        allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
      },
    }, {
      ...dependencies.pathADependencies,
      onTs0ChildValidated: async (artifact) => {
        const retainedBytes = Uint8Array.from(artifact.childBytes);
        if (hash(retainedBytes) !== artifact.identity.sha256) {
          throw new Error("Validated TS0 artifact identity did not match its bytes.");
        }
        retainAttemptEvidence(request.attemptId).ts0Child = Object.freeze({
          bytes: retainedBytes,
          sha256: artifact.identity.sha256,
          lineageEvidenceDigest: artifact.lineageEvidenceDigest,
        });
        await dependencies.pathADependencies?.onTs0ChildValidated?.(artifact);
      },
    });
  } catch {
    return failed(
      "path_a_failed",
      "path_a_transport_or_execution_failed",
      null,
      acceptedFloorRead
    );
  }
  counts.rawReader = pathA.attemptCounts.rawReader;
  counts.ts0 = pathA.attemptCounts.ts0;
  counts.placement = pathA.attemptCounts.placement;
  counts.childReader = pathA.attemptCounts.childReader;

  if (
    pathA.mode === "rejected" &&
    pathA.finalReason === "placement_rejected" &&
    pathA.diagnostics.placementReason ===
      "validation_residual_exceeds_limit"
  ) {
    return Object.freeze({
      status: "degraded_evidence",
      schemaVersion: AFC_SR1_LIVE_PRODUCT_VERSION,
      attemptId: request.attemptId,
      resultId,
      labLoadGeneration: request.labLoadGeneration,
      originalBasis: original.basis,
      emptyBasis: empty.basis,
      photoClass: classification.photoClass,
      geometryAuthority: "none",
      reason: "validation_residual_exceeds_limit",
      diagnostics: diagnostics(
        request,
        resultId,
        counts,
        "validation_residual_exceeds_limit",
        pathA,
        acceptedFloorRead
      ),
    });
  }
  if (pathA.mode === "rejected") {
    return failed(
      "path_a_failed",
      pathA.finalReason ?? "path_a_rejected",
      pathA,
      acceptedFloorRead
    );
  }
  const seamT = pathA.mode === "raw-direct"
    ? pathA.rawAttempt.projective?.seamT
    : pathA.fallbackAttempt?.finalProjective?.seamT;
  const adjustableCorner = truncatedAnchor === "NL" ? "NR" : "NL";
  const corrected = seamT === null || seamT === undefined
    ? null
    : correctedOffAxisPolygon(
        proposal.polygon,
        adjustableCorner,
        seamT
      );
  if (!corrected || seamT === null || seamT === undefined) {
    return failed(
      "path_a_failed",
      "path_a_authoritative_geometry_invalid",
      pathA,
      acceptedFloorRead
    );
  }

  return Object.freeze({
    status: "authoritative_geometry",
    schemaVersion: AFC_SR1_LIVE_PRODUCT_VERSION,
    attemptId: request.attemptId,
    resultId,
    labLoadGeneration: request.labLoadGeneration,
    originalBasis: original.basis,
    emptyBasis: empty.basis,
    photoClass: classification.photoClass,
    geometry: Object.freeze({
      mode: pathA.mode,
      geometryAuthority: "supported_domain_near_side_derived",
      sourceNormalizedPolygon: corrected,
        rawSourceNormalizedPolygon: cloneAfcSr1LivePolygon(proposal.polygon),
      fixedAnchor: truncatedAnchor,
      adjustableCorner,
      baselineSeamT: seamT,
      acceptanceBasis,
      classifierVersion: classification.classifierVersion,
      anchorAuthorityKind: "supported_domain_near_side_derived",
      onAxisConstruction: null,
    }),
    metric,
    perspectiveAdjust: Object.freeze({
      supported: true,
      mode: "historical_fixed_seam_v1",
      reason: "off_axis_live_baseline",
    }),
    diagnostics: diagnostics(
      request,
      resultId,
      counts,
      null,
      pathA,
      acceptedFloorRead
    ),
  });
}
