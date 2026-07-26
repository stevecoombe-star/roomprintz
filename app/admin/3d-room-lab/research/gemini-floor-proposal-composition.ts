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
  type AfcR3cInputImageRole,
  type AfcR3cPromptBuildResult,
  type AfcR3cStudyMode,
} from "./gemini-floor-proposal-prompt";

export const AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION = "afc-r3c-image-pair-compatibility/v1" as const;
export const AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION = "afc-r3c-source-normalized-transfer/v1" as const;
export const AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE = 0.015;

export type AfcR3cCompatibilityTier =
  | "exact_grid_compatible"
  | "aspect_compatible_rescaled"
  | "incompatible";

export type AfcR3cDecodedImage = Readonly<{
  fingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: number;
}>;

export type AfcR3cImagePairCompatibility = Readonly<{
  version: typeof AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION;
  tier: AfcR3cCompatibilityTier;
  originalDecodedDimensions: Readonly<{ width: number; height: number }> | null;
  inputDecodedDimensions: Readonly<{ width: number; height: number }> | null;
  originalOrientation: number | null;
  inputOrientation: number | null;
  originalAspect: number | null;
  inputAspect: number | null;
  relativeAspectError: number | null;
  reason: string | null;
}>;

export type AfcR3cSourceNormalizedTransferRecord = Readonly<{
  transferPolicyVersion: typeof AFC_R3C_SOURCE_NORMALIZED_TRANSFER_VERSION;
  inputImageRole: AfcR3cInputImageRole;
  compatibilityTier: AfcR3cCompatibilityTier;
  originalDecodedDimensions: Readonly<{ width: number; height: number }>;
  inputDecodedDimensions: Readonly<{ width: number; height: number }>;
  originalOrientation: number;
  inputOrientation: number;
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
      reason: "r3b_contract_failure" | "composition_input_invalid";
      candidates: readonly [];
      candidateProvenanceById: Readonly<Record<string, never>>;
    }>);

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

function knownRole(value: unknown): value is AfcR3cInputImageRole {
  return value === "empty_room_boundary_specialist" || value === "original_contextual";
}
function knownStudyMode(value: unknown): value is AfcR3cStudyMode {
  return value === "empty_only" || value === "original_only" || value === "parallel_union";
}
function finitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}
function round4(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? value : Number(value.toFixed(4));
}
function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function dimensions(image: AfcR3cDecodedImage): { width: number; height: number } {
  return { width: image.decodedWidth, height: image.decodedHeight };
}
function validImage(image: unknown): image is AfcR3cDecodedImage {
  return !!image && typeof image === "object" && validFingerprint((image as AfcR3cDecodedImage).fingerprint) &&
    finitePositiveInteger((image as AfcR3cDecodedImage).decodedWidth) &&
    finitePositiveInteger((image as AfcR3cDecodedImage).decodedHeight) &&
    Number.isFinite((image as AfcR3cDecodedImage).orientation);
}

/**
 * Exact formula/boundary parity with route-local classifyCompatibility:
 * |inputAspect - originalAspect| / originalAspect, accepted at <= 0.015.
 */
export function classifyAfcR3cImagePairCompatibility(
  original: AfcR3cDecodedImage,
  input: AfcR3cDecodedImage
): AfcR3cImagePairCompatibility {
  if (!validImage(original) || !validImage(input)) {
    return deepFreeze({
      version: AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION, tier: "incompatible",
      originalDecodedDimensions: validImage(original) ? dimensions(original) : null,
      inputDecodedDimensions: validImage(input) ? dimensions(input) : null,
      originalOrientation: validImage(original) ? original.orientation : null,
      inputOrientation: validImage(input) ? input.orientation : null,
      originalAspect: null, inputAspect: null, relativeAspectError: null,
      reason: "Image metadata is invalid for transfer.",
    });
  }
  const originalAspect = original.decodedWidth / original.decodedHeight;
  const inputAspect = input.decodedWidth / input.decodedHeight;
  const relativeAspectError = Math.abs(inputAspect - originalAspect) / originalAspect;
  // The gate uses the raw route-parity calculation; provenance mirrors the
  // route's externally reported four-decimal values.
  const shared = {
    version: AFC_R3C_IMAGE_PAIR_COMPATIBILITY_VERSION,
    originalDecodedDimensions: dimensions(original),
    inputDecodedDimensions: dimensions(input),
    originalOrientation: original.orientation,
    inputOrientation: input.orientation,
    originalAspect: round4(originalAspect),
    inputAspect: round4(inputAspect),
    relativeAspectError: round4(relativeAspectError),
  } as const;
  if (original.orientation !== 1 || input.orientation !== 1) {
    return deepFreeze({ ...shared, tier: "incompatible" as const, reason: "Image orientation is not supported for calibration transfer." });
  }
  if (original.decodedWidth === input.decodedWidth && original.decodedHeight === input.decodedHeight) {
    return deepFreeze({ ...shared, tier: "exact_grid_compatible" as const, reason: null });
  }
  if (relativeAspectError <= AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE) {
    return deepFreeze({ ...shared, tier: "aspect_compatible_rescaled" as const, reason: null });
  }
  return deepFreeze({ ...shared, tier: "incompatible" as const, reason: "Input image aspect ratio diverges too far for transfer." });
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
  if (compatibility.tier === "incompatible" || compatibility.relativeAspectError === null) {
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

function isR3bResult(value: unknown): value is GeminiFloorProposalParseResult {
  if (!value || typeof value !== "object") return false;
  const result = value as GeminiFloorProposalParseResult;
  return (result.status === "proposals" || result.status === "insufficient_evidence" || result.status === "contract_failure") &&
    result.contractVersion === GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION &&
    result.safety.applied === false && result.safety.authoritative === false;
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
function requiredRuns(input: AfcR3cCompositionInput): AfcR3cProposalRun[] | null {
  if (!knownStudyMode(input?.studyMode)) return null;
  if (input.studyMode === "empty_only") return input.emptyRun?.imageRole === "empty_room_boundary_specialist" ? [input.emptyRun] : null;
  if (input.studyMode === "original_only") return input.originalRun?.imageRole === "original_contextual" ? [input.originalRun] : null;
  return input.emptyRun?.imageRole === "empty_room_boundary_specialist" && input.originalRun?.imageRole === "original_contextual"
    ? [input.emptyRun, input.originalRun]
    : null;
}
function emptyRecord(): Readonly<Record<string, never>> {
  return Object.freeze({});
}
function base(studyMode: AfcR3cStudyMode, arms: readonly AfcR3cArmStatus[]): CompositionBase {
  return { contractVersion: AFC_R3C_PROMPT_CONTRACT_VERSION, studyMode, safety: SAFETY, armStatuses: arms };
}

/**
 * Combines only independently validated R3B results. Parallel union is atomic:
 * one malformed arm blocks every candidate from the requested composition.
 */
export function composeAfcR3cProposalRuns(input: AfcR3cCompositionInput): AfcR3cCompositionResult {
  const runs = requiredRuns(input);
  if (!runs || !knownStudyMode(input?.studyMode) || runs.some((run) => !isR3bResult(run.r3bResult))) {
    return deepFreeze({ ...base((input?.studyMode ?? "parallel_union") as AfcR3cStudyMode, []), status: "contract_failure", reason: "composition_input_invalid", candidates: [], candidateProvenanceById: emptyRecord() });
  }
  const arms = runs.map(armStatus).sort((a, b) => compareCanonicalStrings(roleToken(a.imageRole), roleToken(b.imageRole)));
  if (runs.some((run) => run.r3bResult.status === "contract_failure")) {
    return deepFreeze({ ...base(input.studyMode, arms), status: "contract_failure", reason: "r3b_contract_failure", candidates: [], candidateProvenanceById: emptyRecord() });
  }
  const proposalRuns = runs.filter((run): run is AfcR3cProposalRun & { r3bResult: Extract<GeminiFloorProposalParseResult, { status: "proposals" }> } => run.r3bResult.status === "proposals");
  if (!proposalRuns.length) {
    return deepFreeze({ ...base(input.studyMode, arms), status: "insufficient_evidence", candidates: [], candidateProvenanceById: emptyRecord() });
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
  const provenanceById: Record<string, AfcR3cCandidateProvenance> = {};
  for (const item of staged) provenanceById[item.candidate.candidateId] = item.provenance;
  return deepFreeze({
    ...base(input.studyMode, arms),
    status: "proposals",
    candidates: staged.map((item) => item.candidate),
    candidateProvenanceById: provenanceById,
  });
}
