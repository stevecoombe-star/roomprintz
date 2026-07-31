/**
 * AFC-R3C-B1 — provider-free image-pair compatibility and proposal composition.
 *
 * Provenance is intentionally a sidecar: AFC-R2 receives only its canonical
 * original source-normalized candidate geometry.
 *
 * Compatibility formula parity source:
 * app/api/admin/3d-room-lab/empty-room-assist/run/route.ts classifyCompatibility
 */
import {
  candidateCanonicalPolygon,
  compareCanonicalStrings,
  type FloorCandidateInput,
} from "./candidate-discrimination-harness";
import {
  GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION,
  GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
  type GeminiFloorProposalParseResult,
} from "./gemini-floor-proposal-contract";
import {
  AFC_R3C_PROMPT_CONTRACT_VERSION,
  AFC_R3C_EMPTY_BOUNDARY_PROMPT_VERSION,
  AFC_R3C_ORIGINAL_CONTEXT_PROMPT_VERSION,
  type AfcR3cInputImageRole,
  type AfcR3cPromptBuildResult,
  type AfcR3cStudyMode,
} from "./gemini-floor-proposal-prompt";
import {
  classifyAfcR3cImagePairCompatibility,
  type AfcR3cCompatibilityTier,
  type AfcR3cDecodedImage,
  type AfcR3cImagePairCompatibility,
} from "./afc-r3c-image-pair-compatibility";

export {
  AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE,
  AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION,
  classifyAfcR3cImagePairCompatibility,
} from "./afc-r3c-image-pair-compatibility";
export type {
  AfcR3cCompatibilityTier,
  AfcR3cDecodedImage,
  AfcR3cImagePairCompatibility,
} from "./afc-r3c-image-pair-compatibility";
export const AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION = "afc-r3c-source-normalized-transfer/v1" as const;

export type AfcR3cSourceNormalizedTransferRecord = Readonly<{
  transferPolicyVersion: typeof AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION;
  inputImageRole: AfcR3cInputImageRole;
  compatibilityTier: AfcR3cCompatibilityTier;
  originalDecodedDimensions: Readonly<{ width: number; height: number }>;
  inputDecodedDimensions: Readonly<{ width: number; height: number }>;
  originalOrientation: number;
  inputOrientation: number;
  relativeAspectErrorRaw: number;
  relativeAspectError: number;
  numericalCoordinatesReinterpreted: boolean;
  exactGrid: boolean;
  aspectCompatible: boolean;
  clamped: false;
  reordered: false;
  repaired: false;
  containerSpaceUsed: false;
}>;

export type AfcR3cInvocationProvenance = Readonly<{
  contractVersion: typeof AFC_R3C_PROMPT_CONTRACT_VERSION;
  studyMode: AfcR3cStudyMode;
  inputImageRole: AfcR3cInputImageRole;
  requestId: string;
  originalImageFingerprint: string;
  inputImageFingerprint: string;
  emptyRoomImageFingerprint: string | null;
  originalDecodedDimensions: Readonly<{ width: number; height: number }>;
  inputDecodedDimensions: Readonly<{ width: number; height: number }>;
  originalOrientation: number;
  inputOrientation: number;
  compatibilityTier: AfcR3cCompatibilityTier;
  relativeAspectErrorRaw: number;
  relativeAspectError: number;
  transferPolicyVersion: typeof AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION;
  promptVersion: string;
  promptSha256: string;
  afcR3bContractVersion: typeof GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION;
  r3bSchemaVersion: typeof GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION;
  providerId: string;
  modelId: string;
  rawResponseSha256: string | null;
  inputResponseStatus: GeminiFloorProposalParseResult["status"];
}>;

export type AfcR3cInvocationRefusal = Readonly<{
  status: "incompatible_input";
  safety: AfcR3cSafety;
  imageRole: AfcR3cInputImageRole;
  compatibility: AfcR3cImagePairCompatibility;
  reason: string;
}>;

export type AfcR3cProposalRun = Readonly<{
  imageRole: AfcR3cInputImageRole;
  r3bResult: GeminiFloorProposalParseResult;
  provenance: AfcR3cInvocationProvenance;
  transfer: AfcR3cSourceNormalizedTransferRecord;
}>;

export type AfcR3cSafety = Readonly<{
  applied: false;
  authoritative: false;
  persisted: false;
  activeCameraUnchanged: true;
}>;

export type AfcR3cInvocationInput = Readonly<{
  studyMode: AfcR3cStudyMode;
  imageRole: AfcR3cInputImageRole;
  requestId: string;
  originalImage: AfcR3cDecodedImage;
  inputImage: AfcR3cDecodedImage;
  emptyRoomImageFingerprint?: string;
  prompt: AfcR3cPromptBuildResult;
  providerId: string;
  modelId: string;
  r3bResult: GeminiFloorProposalParseResult;
}>;

export type AfcR3cCandidateProvenance = Readonly<{
  imageRole: AfcR3cInputImageRole;
  sourceR3bCandidateId: string;
  inputImageFingerprint: string;
  originalImageFingerprint: string;
  emptyRoomImageFingerprint: string | null;
  compatibilityTier: AfcR3cCompatibilityTier;
  relativeAspectErrorRaw: number;
  relativeAspectError: number;
  transfer: AfcR3cSourceNormalizedTransferRecord;
  promptVersion: string;
  promptSha256: string;
  providerId: string;
  modelId: string;
  rawResponseSha256: string | null;
  sourceResponseStatus: "proposals";
  rawSourceOrdinal: number;
}>;

export type AfcR3cArmStatus = Readonly<{
  imageRole: AfcR3cInputImageRole;
  status: GeminiFloorProposalParseResult["status"];
  reason: string | null;
}>;

type CompositionBase = Readonly<{
  contractVersion: typeof AFC_R3C_PROMPT_CONTRACT_VERSION;
  studyMode: AfcR3cStudyMode;
  safety: AfcR3cSafety;
  armStatuses: readonly AfcR3cArmStatus[];
}>;
type CompositionInputFailure = Readonly<{
  contractVersion: typeof AFC_R3C_PROMPT_CONTRACT_VERSION;
  studyMode: AfcR3cStudyMode | null;
  safety: AfcR3cSafety;
  armStatuses: readonly [];
  status: "contract_failure";
  reason: "composition_input_invalid";
  detail: "Composition input is invalid.";
  candidates: readonly [];
  candidateProvenanceById: Readonly<Record<string, never>>;
}>;
export type AfcR3cCompositionResult =
  | (CompositionBase & Readonly<{
      status: "proposals";
      candidates: readonly FloorCandidateInput[];
      candidateProvenanceById: Readonly<Record<string, AfcR3cCandidateProvenance>>;
    }>)
  | (CompositionBase & Readonly<{
      status: "insufficient_evidence";
      candidates: readonly [];
      candidateProvenanceById: Readonly<Record<string, never>>;
    }>)
  | (CompositionBase & Readonly<{
      status: "contract_failure";
      reason: "r3b_contract_failure";
      candidates: readonly [];
      candidateProvenanceById: Readonly<Record<string, never>>;
    }>)
  | CompositionInputFailure;

export type AfcR3cCompositionInput = Readonly<{
  studyMode: AfcR3cStudyMode;
  emptyRun?: AfcR3cProposalRun;
  originalRun?: AfcR3cProposalRun;
}>;

const SAFETY: AfcR3cSafety = Object.freeze({
  applied: false,
  authoritative: false,
  persisted: false,
  activeCameraUnchanged: true,
});

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (visited.has(object)) return value;
    visited.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, visited);
    if (!Object.isFrozen(object)) Object.freeze(object);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function knownRole(value: unknown): value is AfcR3cInputImageRole {
  return value === "empty_room_boundary_specialist" || value === "original_contextual";
}
function knownStudyMode(value: unknown): value is AfcR3cStudyMode {
  return value === "empty_only" || value === "original_only" || value === "parallel_union";
}
function finitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}
function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function dimensions(image: AfcR3cDecodedImage): { width: number; height: number } {
  return { width: image.decodedWidth, height: image.decodedHeight };
}
function validImage(image: unknown): image is AfcR3cDecodedImage {
  return !!image && typeof image === "object" && validFingerprint((image as AfcR3cDecodedImage).fingerprint) &&
    Number.isFinite((image as AfcR3cDecodedImage).decodedWidth) && Number.isInteger((image as AfcR3cDecodedImage).decodedWidth) &&
    (image as AfcR3cDecodedImage).decodedWidth > 0 &&
    Number.isFinite((image as AfcR3cDecodedImage).decodedHeight) && Number.isInteger((image as AfcR3cDecodedImage).decodedHeight) &&
    (image as AfcR3cDecodedImage).decodedHeight > 0 &&
    Number.isFinite((image as AfcR3cDecodedImage).orientation);
}

function rawResponseSha(result: GeminiFloorProposalParseResult): string | null {
  return result.auditProvenance.rawResponseSha256;
}

function transferRecord(
  imageRole: AfcR3cInputImageRole,
  original: AfcR3cDecodedImage,
  input: AfcR3cDecodedImage,
  compatibility: AfcR3cImagePairCompatibility
): AfcR3cSourceNormalizedTransferRecord {
  if (compatibility.tier === "incompatible" || compatibility.relativeAspectErrorRaw === null || compatibility.relativeAspectError === null) {
    throw new TypeError("Incompatible image pair cannot establish a source-normalized transfer.");
  }
  return deepFreeze({
    transferPolicyVersion: AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION,
    inputImageRole: imageRole,
    compatibilityTier: compatibility.tier,
    originalDecodedDimensions: dimensions(original),
    inputDecodedDimensions: dimensions(input),
    originalOrientation: original.orientation,
    inputOrientation: input.orientation,
    relativeAspectErrorRaw: compatibility.relativeAspectErrorRaw,
    relativeAspectError: compatibility.relativeAspectError,
    numericalCoordinatesReinterpreted: imageRole === "empty_room_boundary_specialist",
    exactGrid: compatibility.tier === "exact_grid_compatible",
    aspectCompatible: compatibility.tier === "aspect_compatible_rescaled",
    clamped: false,
    reordered: false,
    repaired: false,
    containerSpaceUsed: false,
  });
}

function hasExactSafety(value: unknown): value is AfcR3cSafety {
  return isPlainObject(value) &&
    value.applied === false &&
    value.authoritative === false &&
    value.persisted === false &&
    value.activeCameraUnchanged === true;
}

function validCandidateSource(value: unknown): value is FloorCandidateInput {
  if (!isPlainObject(value) || !validFingerprint(value.candidateId) || value.candidateSource !== "gemini-proposal" ||
    value.coordinateSpace !== "source-normalized/v1" || !Array.isArray(value.semanticOrder) ||
    value.semanticOrder.length !== 4 || value.semanticOrder[0] !== "NL" || value.semanticOrder[1] !== "NR" ||
    value.semanticOrder[2] !== "FR" || value.semanticOrder[3] !== "FL" || !Array.isArray(value.sourceFloorPolygon) ||
    value.sourceFloorPolygon.length !== 4) return false;
  return value.sourceFloorPolygon.every((point) => isPlainObject(point) &&
    typeof point.x === "number" && Number.isFinite(point.x) &&
    typeof point.y === "number" && Number.isFinite(point.y));
}

function validReviewEvidenceByCandidateId(value: unknown, candidates: readonly FloorCandidateInput[]): boolean {
  if (!isPlainObject(value)) return false;
  return candidates.every((candidate) => {
    const evidence = value[candidate.candidateId];
    return isPlainObject(evidence) &&
      typeof evidence.rawSourceOrdinal === "number" &&
      Number.isInteger(evidence.rawSourceOrdinal) &&
      evidence.rawSourceOrdinal >= 0;
  });
}

/**
 * Defensive recognition only. AFC-R3B remains the authoritative raw-response
 * parser; this guard must be total because composition is a public batch entry.
 */
function isR3bResult(value: unknown): value is GeminiFloorProposalParseResult {
  if (!isPlainObject(value) ||
    (value.status !== "proposals" && value.status !== "insufficient_evidence" && value.status !== "contract_failure") ||
    value.contractVersion !== GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION ||
    !hasExactSafety(value.safety) ||
    !isPlainObject(value.auditProvenance)) return false;
  if (value.status === "proposals") {
    return Array.isArray(value.candidates) &&
      value.candidates.every(validCandidateSource) &&
      validReviewEvidenceByCandidateId(value.reviewEvidenceByCandidateId, value.candidates as readonly FloorCandidateInput[]);
  }
  if (value.status === "insufficient_evidence") {
    return typeof value.reasonCode === "string" && typeof value.note === "string";
  }
  return typeof value.reason === "string" && typeof value.path === "string" && typeof value.detail === "string";
}

/**
 * Establishes a trusted, immutable source-run record from an already parsed
 * AFC-R3B result. It accepts neither raw model JSON nor production mapper data.
 */
export function createAfcR3cProposalRun(input: AfcR3cInvocationInput): AfcR3cProposalRun | AfcR3cInvocationRefusal {
  if (!input || !knownStudyMode(input.studyMode) || !knownRole(input.imageRole) || !validImage(input.originalImage) ||
    !validImage(input.inputImage) || !validFingerprint(input.requestId) || !validFingerprint(input.providerId) ||
    !validFingerprint(input.modelId) || !input.prompt || !isR3bResult(input.r3bResult)) {
    throw new TypeError("AFC-R3C invocation input is invalid or does not contain an AFC-R3B parse result.");
  }
  if (input.prompt.contractVersion !== AFC_R3C_PROMPT_CONTRACT_VERSION ||
    input.prompt.imageRole !== input.imageRole ||
    input.prompt.expectedR3bSchemaVersion !== GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION ||
    !/^[a-f0-9]{64}$/.test(input.prompt.promptSha256)) {
    throw new TypeError("AFC-R3C prompt artifact does not match the invocation role or R3B schema.");
  }
  const compatibility = classifyAfcR3cImagePairCompatibility(input.originalImage, input.inputImage);
  const originalRoleInvalid = input.imageRole === "original_contextual" &&
    (input.inputImage.fingerprint !== input.originalImage.fingerprint ||
      input.inputImage.decodedWidth !== input.originalImage.decodedWidth ||
      input.inputImage.decodedHeight !== input.originalImage.decodedHeight ||
      input.inputImage.orientation !== input.originalImage.orientation);
  const emptyFingerprint = input.imageRole === "empty_room_boundary_specialist"
    ? input.emptyRoomImageFingerprint
    : null;
  if (originalRoleInvalid || (input.imageRole === "empty_room_boundary_specialist" && !validFingerprint(emptyFingerprint)) ||
    compatibility.tier === "incompatible") {
    return deepFreeze({
      status: "incompatible_input",
      safety: SAFETY,
      imageRole: input.imageRole,
      compatibility,
      reason: originalRoleInvalid
        ? "Original contextual input must exactly equal the canonical original image."
        : compatibility.reason ?? "Empty-room input fingerprint is required.",
    });
  }
  const transfer = transferRecord(input.imageRole, input.originalImage, input.inputImage, compatibility);
  const provenance: AfcR3cInvocationProvenance = {
    contractVersion: AFC_R3C_PROMPT_CONTRACT_VERSION,
    studyMode: input.studyMode,
    inputImageRole: input.imageRole,
    requestId: input.requestId,
    originalImageFingerprint: input.originalImage.fingerprint,
    inputImageFingerprint: input.inputImage.fingerprint,
    emptyRoomImageFingerprint: emptyFingerprint ?? null,
    originalDecodedDimensions: dimensions(input.originalImage),
    inputDecodedDimensions: dimensions(input.inputImage),
    originalOrientation: input.originalImage.orientation,
    inputOrientation: input.inputImage.orientation,
    compatibilityTier: compatibility.tier,
    relativeAspectErrorRaw: compatibility.relativeAspectErrorRaw!,
    relativeAspectError: compatibility.relativeAspectError!,
    transferPolicyVersion: AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION,
    promptVersion: input.prompt.promptVersion,
    promptSha256: input.prompt.promptSha256,
    afcR3bContractVersion: GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
    r3bSchemaVersion: GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION,
    providerId: input.providerId,
    modelId: input.modelId,
    rawResponseSha256: rawResponseSha(input.r3bResult),
    inputResponseStatus: input.r3bResult.status,
  };
  return deepFreeze({ imageRole: input.imageRole, r3bResult: input.r3bResult, provenance, transfer });
}

/** Exact numerical clone only: no clamp, repair, reordering, or space conversion. */
export function transferAfcR3cCandidateToOriginalBasis(
  candidate: FloorCandidateInput,
  transfer: AfcR3cSourceNormalizedTransferRecord
): FloorCandidateInput {
  if (candidate.coordinateSpace !== "source-normalized/v1" || transfer.clamped || transfer.reordered || transfer.repaired || transfer.containerSpaceUsed) {
    throw new TypeError("AFC-R3C accepts only unmodified source-normalized candidate transfer.");
  }
  return deepFreeze({
    candidateId: candidate.candidateId,
    candidateSource: "gemini-proposal",
    coordinateSpace: "source-normalized/v1",
    semanticOrder: [candidate.semanticOrder[0], candidate.semanticOrder[1], candidate.semanticOrder[2], candidate.semanticOrder[3]],
    sourceFloorPolygon: [
      { x: candidate.sourceFloorPolygon[0].x, y: candidate.sourceFloorPolygon[0].y },
      { x: candidate.sourceFloorPolygon[1].x, y: candidate.sourceFloorPolygon[1].y },
      { x: candidate.sourceFloorPolygon[2].x, y: candidate.sourceFloorPolygon[2].y },
      { x: candidate.sourceFloorPolygon[3].x, y: candidate.sourceFloorPolygon[3].y },
    ],
  });
}

function armStatus(run: AfcR3cProposalRun): AfcR3cArmStatus {
  return deepFreeze({
    imageRole: run.imageRole,
    status: run.r3bResult.status,
    reason: run.r3bResult.status === "contract_failure" ? run.r3bResult.reason : null,
  });
}
function roleToken(role: AfcR3cInputImageRole): "empty" | "original" {
  return role === "empty_room_boundary_specialist" ? "empty" : "original";
}
function validDimensionRecord(value: unknown): boolean {
  return isPlainObject(value) && finitePositiveInteger(value.width) && finitePositiveInteger(value.height);
}
function acceptedTier(value: unknown): value is Exclude<AfcR3cCompatibilityTier, "incompatible"> {
  return value === "exact_grid_compatible" || value === "aspect_compatible_rescaled";
}
function validTransferForRun(value: unknown, imageRole: AfcR3cInputImageRole): value is AfcR3cSourceNormalizedTransferRecord {
  if (!isPlainObject(value) ||
    value.transferPolicyVersion !== AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION ||
    value.inputImageRole !== imageRole ||
    !acceptedTier(value.compatibilityTier) ||
    !validDimensionRecord(value.originalDecodedDimensions) ||
    !validDimensionRecord(value.inputDecodedDimensions) ||
    typeof value.originalOrientation !== "number" || !Number.isFinite(value.originalOrientation) ||
    typeof value.inputOrientation !== "number" || !Number.isFinite(value.inputOrientation) ||
    typeof value.relativeAspectErrorRaw !== "number" || !Number.isFinite(value.relativeAspectErrorRaw) ||
    typeof value.relativeAspectError !== "number" || !Number.isFinite(value.relativeAspectError) ||
    typeof value.numericalCoordinatesReinterpreted !== "boolean" ||
    value.clamped !== false || value.reordered !== false || value.repaired !== false || value.containerSpaceUsed !== false) return false;
  return value.compatibilityTier === "exact_grid_compatible"
    ? value.exactGrid === true && value.aspectCompatible === false
    : value.exactGrid === false && value.aspectCompatible === true;
}
function validProvenanceForRun(value: unknown, imageRole: AfcR3cInputImageRole, transfer: AfcR3cSourceNormalizedTransferRecord, r3bResult: GeminiFloorProposalParseResult): boolean {
  if (!isPlainObject(value) ||
    value.contractVersion !== AFC_R3C_PROMPT_CONTRACT_VERSION ||
    !knownStudyMode(value.studyMode) ||
    value.inputImageRole !== imageRole ||
    !validFingerprint(value.originalImageFingerprint) ||
    !validFingerprint(value.inputImageFingerprint) ||
    (imageRole === "empty_room_boundary_specialist" && !validFingerprint(value.emptyRoomImageFingerprint)) ||
    (imageRole === "original_contextual" && value.emptyRoomImageFingerprint !== null) ||
    value.compatibilityTier !== transfer.compatibilityTier ||
    value.transferPolicyVersion !== AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION ||
    value.relativeAspectErrorRaw !== transfer.relativeAspectErrorRaw ||
    value.relativeAspectError !== transfer.relativeAspectError ||
    value.afcR3bContractVersion !== GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION ||
    value.r3bSchemaVersion !== GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION ||
    !validFingerprint(value.providerId) || !validFingerprint(value.modelId) ||
    !/^[a-f0-9]{64}$/.test(value.promptSha256 as string) ||
    value.inputResponseStatus !== r3bResult.status) return false;
  const expectedPromptVersion = imageRole === "empty_room_boundary_specialist"
    ? AFC_R3C_EMPTY_BOUNDARY_PROMPT_VERSION
    : AFC_R3C_ORIGINAL_CONTEXT_PROMPT_VERSION;
  return value.promptVersion === expectedPromptVersion &&
    (value.rawResponseSha256 === null || (typeof value.rawResponseSha256 === "string" && /^[a-f0-9]{64}$/.test(value.rawResponseSha256)));
}
function validRun(value: unknown, expectedRole: AfcR3cInputImageRole): value is AfcR3cProposalRun {
  if (!isPlainObject(value) || value.imageRole !== expectedRole || !isR3bResult(value.r3bResult) ||
    !validTransferForRun(value.transfer, expectedRole)) return false;
  return validProvenanceForRun(value.provenance, expectedRole, value.transfer, value.r3bResult);
}
function requiredRuns(input: unknown): { studyMode: AfcR3cStudyMode; runs: AfcR3cProposalRun[] } | null {
  if (!isPlainObject(input) || !knownStudyMode(input.studyMode)) return null;
  const hasEmpty = input.emptyRun !== undefined;
  const hasOriginal = input.originalRun !== undefined;
  if (input.studyMode === "empty_only") {
    return hasEmpty && !hasOriginal && validRun(input.emptyRun, "empty_room_boundary_specialist")
      ? { studyMode: input.studyMode, runs: [input.emptyRun] }
      : null;
  }
  if (input.studyMode === "original_only") {
    return hasOriginal && !hasEmpty && validRun(input.originalRun, "original_contextual")
      ? { studyMode: input.studyMode, runs: [input.originalRun] }
      : null;
  }
  return hasEmpty && hasOriginal &&
    validRun(input.emptyRun, "empty_room_boundary_specialist") &&
    validRun(input.originalRun, "original_contextual")
    ? { studyMode: input.studyMode, runs: [input.emptyRun, input.originalRun] }
    : null;
}
function emptyRecord(): Readonly<Record<string, never>> {
  return Object.freeze({});
}
function base(studyMode: AfcR3cStudyMode, arms: readonly AfcR3cArmStatus[]): CompositionBase {
  return { contractVersion: AFC_R3C_PROMPT_CONTRACT_VERSION, studyMode, safety: SAFETY, armStatuses: arms };
}
function inputFailure(studyMode: AfcR3cStudyMode | null): CompositionInputFailure {
  return deepFreeze({
    contractVersion: AFC_R3C_PROMPT_CONTRACT_VERSION,
    studyMode,
    safety: SAFETY,
    armStatuses: [],
    status: "contract_failure",
    reason: "composition_input_invalid",
    detail: "Composition input is invalid.",
    candidates: [],
    candidateProvenanceById: emptyRecord(),
  });
}
function safeStudyMode(input: unknown): AfcR3cStudyMode | null {
  try {
    return isPlainObject(input) && knownStudyMode(input.studyMode) ? input.studyMode : null;
  } catch {
    return null;
  }
}

/**
 * Combines only independently validated R3B results. Parallel union is atomic:
 * one malformed arm blocks every candidate from the requested composition.
 */
export function composeAfcR3cProposalRuns(input: unknown): AfcR3cCompositionResult {
  const requestedStudyMode = safeStudyMode(input);
  try {
    const required = requiredRuns(input);
    if (!required) return inputFailure(requestedStudyMode);
    const { studyMode, runs } = required;
    const arms = runs.map(armStatus).sort((a, b) => compareCanonicalStrings(roleToken(a.imageRole), roleToken(b.imageRole)));
    if (runs.some((run) => run.r3bResult.status === "contract_failure")) {
      return deepFreeze({ ...base(studyMode, arms), status: "contract_failure", reason: "r3b_contract_failure", candidates: [], candidateProvenanceById: emptyRecord() });
    }
    const proposalRuns = runs.filter((run): run is AfcR3cProposalRun & { r3bResult: Extract<GeminiFloorProposalParseResult, { status: "proposals" }> } => run.r3bResult.status === "proposals");
    if (!proposalRuns.length) {
      return deepFreeze({ ...base(studyMode, arms), status: "insufficient_evidence", candidates: [], candidateProvenanceById: emptyRecord() });
    }
    const staged: Array<{ candidate: FloorCandidateInput; provenance: AfcR3cCandidateProvenance; canonical: string }> = [];
    for (const run of proposalRuns) {
      for (const source of run.r3bResult.candidates) {
        const transferred = transferAfcR3cCandidateToOriginalBasis(source, run.transfer);
        const candidateId = `afc-r3c:${roleToken(run.imageRole)}:${source.candidateId}`;
        const review = run.r3bResult.reviewEvidenceByCandidateId[source.candidateId];
        staged.push({
          candidate: deepFreeze({ ...transferred, candidateId }),
          canonical: candidateCanonicalPolygon(transferred),
          provenance: deepFreeze({
            imageRole: run.imageRole,
            sourceR3bCandidateId: source.candidateId,
            inputImageFingerprint: run.provenance.inputImageFingerprint,
            originalImageFingerprint: run.provenance.originalImageFingerprint,
            emptyRoomImageFingerprint: run.provenance.emptyRoomImageFingerprint,
            compatibilityTier: run.provenance.compatibilityTier,
            relativeAspectErrorRaw: run.provenance.relativeAspectErrorRaw,
            relativeAspectError: run.provenance.relativeAspectError,
            transfer: run.transfer,
            promptVersion: run.provenance.promptVersion,
            promptSha256: run.provenance.promptSha256,
            providerId: run.provenance.providerId,
            modelId: run.provenance.modelId,
            rawResponseSha256: run.provenance.rawResponseSha256,
            sourceResponseStatus: "proposals",
            rawSourceOrdinal: review.rawSourceOrdinal,
          }),
        });
      }
    }
    staged.sort((a, b) =>
      compareCanonicalStrings(a.canonical, b.canonical) ||
      compareCanonicalStrings(roleToken(a.provenance.imageRole), roleToken(b.provenance.imageRole)) ||
      compareCanonicalStrings(a.provenance.sourceR3bCandidateId, b.provenance.sourceR3bCandidateId)
    );
    if (new Set(staged.map((item) => item.candidate.candidateId)).size !== staged.length) return inputFailure(studyMode);
    const provenanceById: Record<string, AfcR3cCandidateProvenance> = {};
    for (const item of staged) provenanceById[item.candidate.candidateId] = item.provenance;
    return deepFreeze({
      ...base(studyMode, arms),
      status: "proposals",
      candidates: staged.map((item) => item.candidate),
      candidateProvenanceById: provenanceById,
    });
  } catch {
    return inputFailure(requestedStudyMode);
  }
}
