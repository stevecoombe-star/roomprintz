/**
 * AFC-R3C-B2 — manual, local-only proposal-run orchestration.
 *
 * No route, scene state, uploader, compositor, accounting wrapper, or Apply
 * authority is imported here. The only optional side effect is an explicitly
 * requested Gemini call through the narrow research transport.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  CANDIDATE_DISCRIMINATION_CONTRACT_VERSION,
  CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION,
  runCandidateDiscriminationExperiment,
  type CandidateDiscriminationResult,
} from "./candidate-discrimination-harness";
import {
  modelOutputFilename,
  prepareAfcR3cCaptureDirectory,
  providerEnvelopeFilename,
  receiptFilename,
  stableReceiptBytes,
  writeAfcR3cImmutableCapture,
} from "./gemini-floor-proposal-capture";
import {
  GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
  GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
  deriveGeminiFloorBasisBinding,
  parseGeminiFloorProposalResponse,
  type GeminiFloorProposalParseResult,
} from "./gemini-floor-proposal-contract";
import {
  classifyAfcR3cImagePairCompatibility,
  composeAfcR3cProposalRuns,
  createAfcR3cProposalRun,
  type AfcR3cCompositionResult,
  type AfcR3cProposalRun,
} from "./gemini-floor-proposal-composition";
import {
  validateSharedCandidateComparisonContext,
  type AfcR3cImageManifestV1,
  type AfcR3cManifestImage,
} from "./gemini-floor-proposal-manifest";
import {
  AFC_R3C_ENVELOPE_EXTRACTION_POLICY_VERSION,
  AFC_R3C_GEMINI_PROVIDER_ID,
  callAfcR3cGeminiProvider,
  extractAfcR3cModelOutputText,
  resolveAfcR3cGenerationConfig,
  type AfcR3cEnvelopeExtraction,
  type AfcR3cProviderFetch,
  type AfcR3cProviderResponse,
} from "./gemini-floor-proposal-provider";
import {
  buildAfcR3cGeminiFloorProposalPrompt,
  type AfcR3cInputImageRole,
  type AfcR3cStudyMode,
} from "./gemini-floor-proposal-prompt";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";

export const AFC_R3C_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const AFC_R3C_RUNNER_RECEIPT_VERSION = "afc-r3c-proposal-run-receipt/v1" as const;
export type AfcR3cCaptureWriter = typeof writeAfcR3cImmutableCapture;

export type AfcR3cVerifiedImage = Readonly<{
  descriptor: AfcR3cManifestImage;
  absolutePath: string;
  bytes: Buffer;
  fingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}>;

export type AfcR3cImageVerificationResult =
  | Readonly<{ ok: true; image: AfcR3cVerifiedImage }>
  | Readonly<{ ok: false; code: "image_read_failed" | "image_oversized" | "image_byte_count_mismatch" | "image_mime_mismatch" | "image_hash_mismatch" | "image_metadata_mismatch" | "image_orientation_unsupported"; reason: string }>;

export type AfcR3cRunnerFailureCode =
  | "invalid_arguments"
  | "image_read_failed"
  | "image_oversized"
  | "image_byte_count_mismatch"
  | "image_mime_mismatch"
  | "image_hash_mismatch"
  | "image_metadata_mismatch"
  | "image_orientation_unsupported"
  | "comparison_context_invalid"
  | "incompatible_image_pair"
  | "missing_api_key"
  | "provider_transport_failed"
  | "provider_non_success"
  | "provider_envelope_invalid"
  | "provider_envelope_ambiguous"
  | "r3b_contract_failure"
  | "capture_write_failed"
  | "composition_failure"
  | "afc_r2_context_failure";

type ArmOutcome = Readonly<{
  role: AfcR3cInputImageRole;
  requestId: string;
  modelId: string;
  image: AfcR3cVerifiedImage;
  prompt: ReturnType<typeof buildAfcR3cGeminiFloorProposalPrompt>;
  provider: AfcR3cProviderResponse | null;
  extraction: AfcR3cEnvelopeExtraction | null;
  r3bResult: GeminiFloorProposalParseResult | null;
  proposalRun: AfcR3cProposalRun | null;
  failureCode: AfcR3cRunnerFailureCode | null;
  failureReason: string | null;
  providerEnvelopePath: string | null;
  modelOutputPath: string | null;
  receiptPath: string | null;
}>;

export type AfcR3cRunnerResult = Readonly<{
  status: "success" | "failure";
  failureCode: AfcR3cRunnerFailureCode | null;
  manifestRoomId: string;
  studyMode: AfcR3cStudyMode;
  composition: AfcR3cCompositionResult | null;
  afcR2Result: CandidateDiscriminationResult | null;
  arms: readonly ArmOutcome[];
  safety: Readonly<{ applied: false; authoritative: false; persisted: false; activeCameraUnchanged: true }>;
}>;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    // Node forbids Object.freeze() on populated typed-array views. The exact
    // verified Buffer remains private to this server-only runner and is never
    // mutated after admission.
    if (ArrayBuffer.isView(object)) return value;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
    Object.freeze(object);
  }
  return value;
}

function mimeFromBytes(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function verifyAfcR3cManifestImage(args: {
  descriptor: AfcR3cManifestImage;
  manifestDirectory: string;
  maxBytes?: number;
}): Promise<AfcR3cImageVerificationResult> {
  const root = path.resolve(args.manifestDirectory);
  const absolutePath = path.resolve(root, args.descriptor.filePath);
  const relativePath = path.relative(root, absolutePath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    return { ok: false, code: "image_read_failed", reason: "Local image path is outside the manifest directory." };
  }
  let bytes: Buffer;
  try {
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("invalid_file");
    bytes = await readFile(absolutePath);
  } catch {
    return { ok: false, code: "image_read_failed", reason: "Local image could not be read." };
  }
  if (bytes.byteLength === 0 || bytes.byteLength > (args.maxBytes ?? AFC_R3C_MAX_IMAGE_BYTES)) {
    return { ok: false, code: "image_oversized", reason: "Local image exceeds the configured byte limit." };
  }
  if (bytes.byteLength !== args.descriptor.byteCount) {
    return { ok: false, code: "image_byte_count_mismatch", reason: "Manifest byte count does not match the exact local bytes." };
  }
  if (mimeFromBytes(bytes) !== args.descriptor.mimeType) {
    return { ok: false, code: "image_mime_mismatch", reason: "Manifest MIME does not match the image bytes." };
  }
  const fingerprint = computeCalibrationImageFingerprint(bytes);
  if (fingerprint !== args.descriptor.sha256) return { ok: false, code: "image_hash_mismatch", reason: "Manifest SHA-256 does not match the exact local bytes." };
  const metadata = await inspectImageMetadata(bytes);
  if (!metadata.ok) return { ok: false, code: "image_metadata_mismatch", reason: metadata.reason };
  if (metadata.width !== args.descriptor.decodedWidth || metadata.height !== args.descriptor.decodedHeight || metadata.orientation !== args.descriptor.orientation) {
    return { ok: false, code: "image_metadata_mismatch", reason: "Manifest image metadata does not match decoded bytes." };
  }
  if (metadata.orientation !== 1) return { ok: false, code: "image_orientation_unsupported", reason: "Only orientation=1 images are supported." };
  return deepFreeze({
    ok: true,
    image: {
      descriptor: args.descriptor,
      absolutePath,
      bytes,
      fingerprint,
      decodedWidth: metadata.width,
      decodedHeight: metadata.height,
      orientation: metadata.orientation,
      mimeType: args.descriptor.mimeType,
    },
  });
}

function armRoleName(role: AfcR3cInputImageRole): "empty" | "original" {
  return role === "empty_room_boundary_specialist" ? "empty" : "original";
}

function failureForExtraction(extraction: Exclude<AfcR3cEnvelopeExtraction, { ok: true }>): AfcR3cRunnerFailureCode {
  return extraction.reason === "candidates_ambiguous" || extraction.reason === "text_parts_ambiguous"
    ? "provider_envelope_ambiguous"
    : "provider_envelope_invalid";
}

function buildRequestId(prefix: string | undefined, role: AfcR3cInputImageRole): string {
  const safePrefix = prefix?.trim();
  if (safePrefix && /^[A-Za-z0-9._-]{1,180}$/.test(safePrefix)) return `${safePrefix}.${armRoleName(role)}`;
  return `afc-r3c.${randomUUID()}.${armRoleName(role)}`;
}

function armReceipt(args: {
  manifest: AfcR3cImageManifestV1;
  studyMode: AfcR3cStudyMode;
  arm: ArmOutcome;
  original: AfcR3cVerifiedImage;
  compatibility: ReturnType<typeof classifyAfcR3cImagePairCompatibility>;
  composition: AfcR3cCompositionResult | null;
  afcR2Result: CandidateDiscriminationResult | null;
}): Record<string, unknown> {
  const extraction = args.arm.extraction;
  const result = args.arm.r3bResult;
  return {
    receiptContractVersion: AFC_R3C_RUNNER_RECEIPT_VERSION,
    requestId: args.arm.requestId,
    createdAt: new Date().toISOString(),
    roomId: args.manifest.roomId,
    studyMode: args.studyMode,
    imageRole: args.arm.role,
    inputImage: {
      fingerprint: args.arm.image.fingerprint,
      decodedWidth: args.arm.image.decodedWidth,
      decodedHeight: args.arm.image.decodedHeight,
      orientation: args.arm.image.orientation,
      mimeType: args.arm.image.mimeType,
    },
    originalImageFingerprint: args.original.fingerprint,
    emptyRoomAssistFingerprint: args.manifest.emptyRoomAssist.sha256,
    compatibility: {
      tier: args.compatibility.tier,
      relativeAspectErrorRaw: args.compatibility.relativeAspectErrorRaw,
      relativeAspectError: args.compatibility.relativeAspectError,
    },
    prompt: {
      contractVersion: args.arm.prompt.contractVersion,
      version: args.arm.prompt.promptVersion,
      sha256: args.arm.prompt.promptSha256,
    },
    provider: {
      providerId: AFC_R3C_GEMINI_PROVIDER_ID,
      modelId: args.arm.modelId,
      generationConfig: resolveAfcR3cGenerationConfig(args.arm.modelId),
      providerEnvelopeSha256: args.arm.provider?.providerEnvelopeSha256 ?? null,
      providerEnvelopeByteLength: args.arm.provider?.providerEnvelopeByteLength ?? null,
      modelOutputTextSha256: extraction?.ok ? extraction.modelOutputTextSha256 : null,
      modelOutputUtf8ByteLength: extraction?.ok ? extraction.modelOutputUtf8ByteLength : null,
      finishReason: extraction?.finishReason ?? null,
      providerModelVersion: extraction?.providerModelVersion ?? null,
      usageMetadata: extraction?.usageMetadata ?? null,
      extractionPolicyVersion: AFC_R3C_ENVELOPE_EXTRACTION_POLICY_VERSION,
    },
    afcR3b: result
      ? {
          status: result.status,
          failureReason: result.status === "contract_failure" ? result.reason : null,
          failurePath: result.status === "contract_failure" ? result.path : null,
          candidateIds: result.status === "proposals" ? result.candidates.map((candidate) => candidate.candidateId) : [],
        }
      : null,
    afcR3c: {
      compositionStatus: args.composition?.status ?? null,
      candidateIds: args.composition?.status === "proposals" ? args.composition.candidates.map((candidate) => candidate.candidateId) : [],
    },
    afcR2: args.afcR2Result
      ? { comparisonFingerprint: args.afcR2Result.comparisonFingerprint, selectionState: args.afcR2Result.selectionState }
      : { comparisonFingerprint: null, selectionState: "not_run" },
    capture: {
      providerEnvelopePath: args.arm.providerEnvelopePath,
      modelOutputPath: args.arm.modelOutputPath,
    },
    safety: {
      researchOnly: true,
      applied: false,
      authoritative: false,
      persisted: false,
      activeCameraUnchanged: true,
      noCompositorCall: true,
      noUserTokenAccounting: true,
    },
  };
}

async function executeArm(args: {
  manifest: AfcR3cImageManifestV1;
  studyMode: AfcR3cStudyMode;
  role: AfcR3cInputImageRole;
  image: AfcR3cVerifiedImage;
  original: AfcR3cVerifiedImage;
  outputDir: string;
  apiKey: string;
  model: string;
  requestIdPrefix?: string;
  timeoutMs: number;
  fetchImpl?: AfcR3cProviderFetch;
  captureWriter: AfcR3cCaptureWriter;
}): Promise<ArmOutcome> {
  const requestId = buildRequestId(args.requestIdPrefix, args.role);
  const prompt = buildAfcR3cGeminiFloorProposalPrompt({
    imageRole: args.role,
    basisBinding: deriveGeminiFloorBasisBinding(args.manifest.sharedComparisonContext, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY),
  });
  const base = {
    role: args.role, requestId, modelId: args.model, image: args.image, prompt, provider: null, extraction: null,
    r3bResult: null, proposalRun: null, failureCode: null, failureReason: null,
    providerEnvelopePath: null, modelOutputPath: null, receiptPath: null,
  } as ArmOutcome;
  const providerCall = await callAfcR3cGeminiProvider({
    apiKey: args.apiKey, model: args.model, prompt, imageBytes: args.image.bytes, mimeType: args.image.mimeType,
    timeoutMs: args.timeoutMs, fetchImpl: args.fetchImpl,
  });
  if (!providerCall.ok) return deepFreeze({ ...base, failureCode: "provider_transport_failed", failureReason: providerCall.failure.kind });
  let arm: ArmOutcome = { ...base, provider: providerCall.response };
  const envelopeWrite = await args.captureWriter({
    outputDir: args.outputDir,
    filename: providerEnvelopeFilename(providerCall.response.providerEnvelopeSha256),
    bytes: providerCall.response.envelopeBytes,
  });
  if (!envelopeWrite.ok) return deepFreeze({ ...arm, failureCode: "capture_write_failed", failureReason: envelopeWrite.reason });
  arm = { ...arm, providerEnvelopePath: envelopeWrite.filePath };
  if (providerCall.response.httpStatus < 200 || providerCall.response.httpStatus >= 300) {
    return deepFreeze({ ...arm, failureCode: "provider_non_success", failureReason: `http_${providerCall.response.httpStatus}` });
  }
  const extraction = extractAfcR3cModelOutputText(providerCall.response.envelopeBytes);
  arm = { ...arm, extraction };
  if (!extraction.ok) return deepFreeze({ ...arm, failureCode: failureForExtraction(extraction), failureReason: extraction.reason });
  const textWrite = await args.captureWriter({
    outputDir: args.outputDir,
    filename: modelOutputFilename(extraction.modelOutputTextSha256),
    bytes: Buffer.from(extraction.modelOutputText, "utf8"),
  });
  if (!textWrite.ok) return deepFreeze({ ...arm, failureCode: "capture_write_failed", failureReason: textWrite.reason });
  const r3bResult = parseGeminiFloorProposalResponse(extraction.modelOutputText, {
    sharedComparisonContext: args.manifest.sharedComparisonContext,
    coordinateExtentPolicy: GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
    auditProvenance: {
      requestId,
      contractVersion: GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
      promptVersion: prompt.promptVersion,
      providerId: AFC_R3C_GEMINI_PROVIDER_ID,
      modelId: args.model,
      responseReceivedAt: new Date().toISOString(),
      rawResponseSha256: extraction.modelOutputTextSha256,
    },
  });
  const run = createAfcR3cProposalRun({
    studyMode: args.studyMode,
    imageRole: args.role,
    requestId,
    originalImage: {
      fingerprint: args.original.fingerprint, decodedWidth: args.original.decodedWidth,
      decodedHeight: args.original.decodedHeight, orientation: args.original.orientation,
    },
    inputImage: {
      fingerprint: args.image.fingerprint, decodedWidth: args.image.decodedWidth,
      decodedHeight: args.image.decodedHeight, orientation: args.image.orientation,
    },
    emptyRoomImageFingerprint: args.manifest.emptyRoomAssist.sha256,
    prompt,
    providerId: AFC_R3C_GEMINI_PROVIDER_ID,
    modelId: args.model,
    r3bResult,
  });
  if (!("r3bResult" in run)) {
    return deepFreeze({ ...arm, modelOutputPath: textWrite.filePath, r3bResult, failureCode: "incompatible_image_pair", failureReason: run.reason });
  }
  return deepFreeze({
    ...arm,
    modelOutputPath: textWrite.filePath,
    r3bResult,
    proposalRun: run,
    failureCode: r3bResult.status === "contract_failure"
      ? r3bResult.reason === "comparison_context_invalid" ? "comparison_context_invalid" : "r3b_contract_failure"
      : null,
    failureReason: r3bResult.status === "contract_failure" ? r3bResult.reason : null,
  });
}

export async function runAfcR3cGeminiFloorProposalStudy(args: {
  manifest: AfcR3cImageManifestV1;
  manifestDirectory: string;
  studyMode: AfcR3cStudyMode;
  outputDir: string;
  apiKey: string | null;
  model: string;
  /** Mandatory side-effect acknowledgement; guards programmatic callers too. */
  executeLiveProviderCall: true;
  repositoryRoot: string;
  requestIdPrefix?: string;
  runAfcR2?: boolean;
  timeoutMs?: number;
  fetchImpl?: AfcR3cProviderFetch;
  /** Test-only failure seam; default remains the immutable local writer. */
  captureWriter?: AfcR3cCaptureWriter;
}): Promise<AfcR3cRunnerResult> {
  const safety = Object.freeze({ applied: false as const, authoritative: false as const, persisted: false as const, activeCameraUnchanged: true as const });
  const failure = (failureCode: AfcR3cRunnerFailureCode): AfcR3cRunnerResult => deepFreeze({
    status: "failure", failureCode, manifestRoomId: args.manifest.roomId, studyMode: args.studyMode,
    composition: null, afcR2Result: null, arms: [], safety,
  });
  if (args.executeLiveProviderCall !== true || !["empty_only", "original_only", "parallel_union"].includes(args.studyMode) || !args.model.trim()) return failure("invalid_arguments");
  const originalResult = await verifyAfcR3cManifestImage({ descriptor: args.manifest.original, manifestDirectory: args.manifestDirectory });
  if (!originalResult.ok) return failure(originalResult.code);
  const emptyResult = await verifyAfcR3cManifestImage({
    descriptor: args.manifest.emptyRoomAssist,
    manifestDirectory: args.manifestDirectory,
  });
  if (!emptyResult.ok) return failure(emptyResult.code);
  const original = originalResult.image;
  const empty = emptyResult.image;
  // Proposal receipts bind the immutable manifest pair for every study mode.
  // Per-arm transfer/provenance remains derived from the selected input below.
  const pairCompatibility = classifyAfcR3cImagePairCompatibility(original, empty);
  if (pairCompatibility.tier === "incompatible") return failure("incompatible_image_pair");
  if (!validateSharedCandidateComparisonContext(args.manifest.sharedComparisonContext).ok) {
    return failure("comparison_context_invalid");
  }
  if (!args.apiKey) return failure("missing_api_key");
  // All image/context/key preflight has completed. Create + probe the capture
  // directory before any provider request so a response can never be accepted
  // without a feasible immutable local capture.
  const preparedCapture = await prepareAfcR3cCaptureDirectory({
    outputDir: args.outputDir,
    repositoryRoot: args.repositoryRoot,
  });
  if (!preparedCapture.ok) return failure("capture_write_failed");
  const armInputs: Array<{ role: AfcR3cInputImageRole; image: AfcR3cVerifiedImage }> = args.studyMode === "empty_only"
    ? [{ role: "empty_room_boundary_specialist", image: empty }]
    : args.studyMode === "original_only"
      ? [{ role: "original_contextual", image: original }]
      : [
          { role: "empty_room_boundary_specialist", image: empty },
          { role: "original_contextual", image: original },
        ];
  const arms: ArmOutcome[] = [];
  for (const armInput of armInputs) {
    arms.push(await executeArm({
      manifest: args.manifest, studyMode: args.studyMode, role: armInput.role, image: armInput.image,
      original, outputDir: preparedCapture.outputDir, apiKey: args.apiKey, model: args.model,
      requestIdPrefix: args.requestIdPrefix, timeoutMs: args.timeoutMs ?? 25_000, fetchImpl: args.fetchImpl,
      captureWriter: args.captureWriter ?? writeAfcR3cImmutableCapture,
    }));
    if (arms.at(-1)?.failureCode === "capture_write_failed") break;
  }
  const emptyRun = arms.find((arm) => arm.role === "empty_room_boundary_specialist")?.proposalRun;
  const originalRun = arms.find((arm) => arm.role === "original_contextual")?.proposalRun;
  const composition = emptyRun || originalRun
    ? composeAfcR3cProposalRuns({ studyMode: args.studyMode, emptyRun, originalRun })
    : null;
  let afcR2Result: CandidateDiscriminationResult | null = null;
  let terminalFailure: AfcR3cRunnerFailureCode | null = arms.find((arm) => arm.failureCode)?.failureCode ?? null;
  if (composition?.status === "contract_failure" && !terminalFailure) terminalFailure = "composition_failure";
  if (args.runAfcR2 && composition?.status === "proposals") {
    afcR2Result = runCandidateDiscriminationExperiment({
      contractVersion: CANDIDATE_DISCRIMINATION_CONTRACT_VERSION,
      sharedContext: args.manifest.sharedComparisonContext,
      candidates: composition.candidates,
      selectionPolicyVersion: CANDIDATE_DISCRIMINATION_SELECTION_POLICY_VERSION,
    });
    if (afcR2Result.selectionState === "comparison_context_invalid") terminalFailure = "afc_r2_context_failure";
  }
  const finalizedArms: ArmOutcome[] = [];
  for (const arm of arms) {
    const filename = receiptFilename(arm.requestId);
    if (!filename) {
      terminalFailure = "capture_write_failed";
      finalizedArms.push({ ...arm, failureCode: arm.failureCode ?? "capture_write_failed", failureReason: "receipt_request_id_invalid" });
      continue;
    }
    const receiptWrite = await (args.captureWriter ?? writeAfcR3cImmutableCapture)({
      outputDir: preparedCapture.outputDir,
      filename,
      bytes: stableReceiptBytes(armReceipt({ manifest: args.manifest, studyMode: args.studyMode, arm, original, compatibility: pairCompatibility, composition, afcR2Result })),
    });
    if (!receiptWrite.ok) {
      terminalFailure = "capture_write_failed";
      finalizedArms.push({ ...arm, failureCode: arm.failureCode ?? "capture_write_failed", failureReason: receiptWrite.reason });
    } else {
      finalizedArms.push({ ...arm, receiptPath: receiptWrite.filePath });
    }
  }
  return deepFreeze({
    status: terminalFailure ? "failure" : "success",
    failureCode: terminalFailure,
    manifestRoomId: args.manifest.roomId,
    studyMode: args.studyMode,
    composition,
    afcR2Result,
    arms: finalizedArms,
    safety,
  });
}
