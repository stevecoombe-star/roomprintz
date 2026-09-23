/**
 * AFC-UI2B — server-only controlled bridge from a strict UI2A package replay
 * to exactly one AFC-R3C proposal runner attempt.
 */
import "server-only";

import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";

import { resolveAfcUi2bGeminiApiKey, resolveAfcUi2bProposalRunnerModel } from "@/lib/vibodeAfcUi2bConfig";
import { replayAfcProposalOverlay } from "./afc-proposal-overlay-view-model";
import { replayAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package-replay";
import {
  AFC_R3C_CAPTURE_ROOT_RELATIVE,
  receiptFilename,
  stableReceiptBytes,
  writeAfcR3cImmutableCapture,
} from "./gemini-floor-proposal-capture";
import { deriveGeminiFloorBasisBinding, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY } from "./gemini-floor-proposal-contract";
import { buildAfcR3cGeminiFloorProposalPrompt } from "./gemini-floor-proposal-prompt";
import { resolveAfcR3cGenerationConfig } from "./gemini-floor-proposal-provider";
import type { AfcR3cProviderFetch } from "./gemini-floor-proposal-provider";
import { runAfcR3cGeminiFloorProposalStudy, verifyAfcR3cManifestImage } from "./gemini-floor-proposal-runner";
import {
  parseAfcUi2bProposalRunRequest,
  type AfcUi2bProposalRunRequest,
  type AfcUi2bStudyMode,
} from "./afc-ui2b-proposal-run-contract";

export const AFC_UI2B_BINDING_RECEIPT_VERSION = "afc-ui2b-proposal-run-binding-receipt/v1" as const;

export type AfcUi2bFailureCode =
  | "invalid_input" | "capture_not_authorized" | "provider_call_not_authorized"
  | "package_not_found" | "package_receipt_hash_mismatch" | "package_receipt_invalid" | "package_replay_failed"
  | "package_room_mismatch" | "unsupported_study_mode" | "runner_binding_invalid" | "manifest_validation_failed"
  | "selected_image_invalid" | "runner_validation_failed" | "provider_configuration_unavailable"
  | "provider_non_success" | "provider_response_invalid" | "proposal_contract_invalid"
  | "proposal_capture_failed" | "proposal_receipt_validation_failed" | "proposal_replay_failed"
  | "run_in_progress" | "unexpected_failure";

type SelectedImage = Readonly<{
  role: "original_photo_contextual_geometry" | "empty_room_boundary_specialist";
  fileName: string; sha256: string; byteCount: number; mimeType: string;
  decodedWidth: number; decodedHeight: number; orientation: number;
}>;
type BindingSafety = Readonly<{
  authoritative: false; applied: false; persistedToScene: false; activeCameraUnchanged: true;
  floorStateUnchanged: true; supportStateUnchanged: true; databaseWrites: false; productionAssetWrites: false;
  productionTokenAccountingUsed: false; compositorCalls: false; emptyRoomGenerationCalls: false;
  geminiFloorProposalCalls: true; afcR2Runs: false; proposalReceiptWritten: true;
}>;
export type AfcUi2bBindingReceipt = Readonly<{
  receiptContractVersion: typeof AFC_UI2B_BINDING_RECEIPT_VERSION;
  roomId: string;
  package: Readonly<{ packageId: string; receiptFileName: string; receiptSha256: string }>;
  manifest: Readonly<{ fileName: string; sha256: string }>;
  studyMode: AfcUi2bStudyMode;
  selectedImage: Readonly<{ role: SelectedImage["role"]; fileName: string; sha256: string }>;
  sharedContextDigest: string;
  proposal: Readonly<{ receiptFileName: string; receiptSha256: string }>;
  providerCallCount: 1;
  runner: Readonly<{ contractVersion: string; promptRole: SelectedImage["role"]; modelId: string }>;
  safety: BindingSafety;
}>;
type Binding = Readonly<{
  request: AfcUi2bProposalRunRequest;
  roomId: string;
  manifestDirectory: string;
  manifest: Readonly<{ fileName: string; sha256: string; contractVersion: string }>;
  selectedImage: SelectedImage;
  runnerImageRole: "original_contextual" | "empty_room_boundary_specialist";
  sharedContextDigest: string;
  compatibility: Readonly<{ version: string; tier: string; relativeAspectErrorRaw: number; relativeAspectError: number }>;
  modelId: string;
  runnerManifest: Parameters<typeof runAfcR3cGeminiFloorProposalStudy>[0]["manifest"];
}>;

export type AfcUi2bProposalRunResult =
  | Readonly<{
      status: "run_validated"; roomId: string; packageId: string; studyMode: AfcUi2bStudyMode;
      selectedImage: SelectedImage;
      manifest: Readonly<{ fileName: string; sha256: string; contractVersion: string }>;
      sharedContextDigest: string; compatibility: Binding["compatibility"];
      runner: Readonly<{ runnerContractVersion: string; promptRole: SelectedImage["role"]; modelId: string; providerCall: false; providerCallCount: 0; captureWrite: false }>;
      safety: ReturnType<typeof validationSafety>;
    }>
  | Readonly<{
      status: "run_completed"; roomId: string; packageId: string; studyMode: AfcUi2bStudyMode;
      selectedImage: SelectedImage;
      manifest: Readonly<{ fileName: string; sha256: string; contractVersion: string }>;
      sharedContextDigest: string; compatibility: Binding["compatibility"];
      runner: Readonly<{ runnerContractVersion: string; promptRole: SelectedImage["role"]; modelId: string; providerCall: true; providerCallCount: 1; captureWrite: true; companionReceiptWritten: true }>;
      proposal: Readonly<{ receiptFileName: string; receiptSha256: string; studyMode: string; armCount: number; candidateCount: number; acceptedCandidateIds: readonly string[]; warningCount: number; strictReplayVerified: true }>;
      safety: ReturnType<typeof executionSafety>;
    }>
  | Readonly<{
      status: "failure"; failureCode: AfcUi2bFailureCode; geminiFloorProposalCall: boolean; providerCallCount: 0 | 1;
      proposalReceiptWritten: boolean; companionReceiptWritten: boolean;
      message: string;
    }>;

type Reservation = Readonly<{ ok: true; filePath: string }> | Readonly<{ ok: false }>;
export type AfcUi2bProposalRunDependencies = Readonly<{
  replayPackage?: typeof replayAfcUi2aPreparedPackage;
  verifyImage?: typeof verifyAfcR3cManifestImage;
  runStudy?: typeof runAfcR3cGeminiFloorProposalStudy;
  replayProposal?: typeof replayAfcProposalOverlay;
  writeCapture?: typeof writeAfcR3cImmutableCapture;
  resolveModel?: () => string | null;
  resolveApiKey?: () => string | null;
  repositoryRoot?: () => string;
  captureRoot?: () => string;
  fetchImpl?: AfcR3cProviderFetch;
  acquireReservation?: (args: { captureRoot: string; packageId: string; studyMode: AfcUi2bStudyMode }) => Promise<Reservation>;
  releaseReservation?: (filePath: string) => Promise<void>;
}>;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const item = value as object;
    if (ArrayBuffer.isView(item) || seen.has(item)) return value;
    seen.add(item);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
    Object.freeze(item);
  }
  return value;
}
function validationSafety() {
  return {
    authoritative: false as const, applied: false as const, persistedToScene: false as const, activeCameraUnchanged: true as const,
    floorStateUnchanged: true as const, supportStateUnchanged: true as const, databaseWrites: false as const,
    productionAssetWrites: false as const, productionTokenAccountingUsed: false as const, compositorCalls: false as const,
    emptyRoomGenerationCalls: false as const, geminiFloorProposalCalls: false as const, afcR2Runs: false as const,
    proposalReceiptWritten: false as const,
  };
}
function executionSafety() {
  return {
    ...validationSafety(), geminiFloorProposalCalls: true as const, proposalReceiptWritten: true as const,
  };
}
function fail(
  failureCode: AfcUi2bFailureCode,
  providerCallCount: 0 | 1 = 0,
  proposalReceiptWritten = false,
  companionReceiptWritten = false,
): AfcUi2bProposalRunResult {
  const messages: Record<AfcUi2bFailureCode, string> = {
    invalid_input: "The controlled proposal request is invalid.",
    capture_not_authorized: "Immutable proposal capture was not explicitly authorized.",
    provider_call_not_authorized: "The live Gemini provider call was not explicitly authorized.",
    package_not_found: "The selected prepared package is unavailable.",
    package_receipt_hash_mismatch: "The selected prepared package receipt did not match its digest.",
    package_receipt_invalid: "The selected prepared package receipt is invalid.",
    package_replay_failed: "The selected prepared package did not pass strict replay.",
    package_room_mismatch: "The selected package does not belong to this room.",
    unsupported_study_mode: "The requested study mode is unavailable in UI2B.",
    runner_binding_invalid: "The prepared package cannot be bound to the proposal runner.",
    manifest_validation_failed: "The prepared manifest did not pass validation.",
    selected_image_invalid: "The selected prepared image did not pass verification.",
    runner_validation_failed: "The proposal runner preflight failed.",
    provider_configuration_unavailable: "The live proposal provider is not configured.",
    provider_non_success: "The live proposal provider did not complete successfully.",
    provider_response_invalid: "The live provider response was not accepted.",
    proposal_contract_invalid: "The proposal did not satisfy the AFC contract.",
    proposal_capture_failed: "The immutable proposal capture could not be completed.",
    proposal_receipt_validation_failed: "The proposal receipt could not be validated.",
    proposal_replay_failed: "The proposal receipt did not pass strict replay.",
    run_in_progress: "A live run for this package and study mode is already in progress.",
    unexpected_failure: "The controlled proposal operation could not be completed.",
  };
  return deepFreeze({
    status: "failure" as const, failureCode, message: messages[failureCode],
    geminiFloorProposalCall: providerCallCount === 1, providerCallCount, proposalReceiptWritten, companionReceiptWritten,
  });
}
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function safeName(value: unknown): value is string {
  return typeof value === "string" && value === path.basename(value) && value.length > 0 && !value.includes("\0");
}
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function reservationFilename(packageId: string, studyMode: AfcUi2bStudyMode): string {
  const digest = createHash("sha256").update(`${packageId}\n${studyMode}`, "utf8").digest("hex");
  return `.afc-ui2b-proposal-run.${digest}.reservation`;
}
async function preflightCaptureRoot(captureRoot: string): Promise<boolean> {
  try {
    try {
      const info = await lstat(captureRoot);
      return info.isDirectory() && !info.isSymbolicLink();
    } catch {
      await mkdir(captureRoot, { recursive: true });
      const created = await lstat(captureRoot);
      return created.isDirectory() && !created.isSymbolicLink();
    }
  } catch {
    return false;
  }
}
async function acquireReservation(args: { captureRoot: string; packageId: string; studyMode: AfcUi2bStudyMode }): Promise<Reservation> {
  try {
    await mkdir(args.captureRoot, { recursive: true });
    const filePath = path.join(args.captureRoot, reservationFilename(args.packageId, args.studyMode));
    const handle = await open(filePath, "wx", 0o600);
    await handle.close();
    return { ok: true, filePath };
  } catch {
    return { ok: false };
  }
}
async function releaseReservation(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}
function proposalBindingFilename(receiptSha256: string): string {
  return `afc-ui2b-run.${receiptSha256}.binding.json`;
}
function executionBindingSafety(value: unknown): value is BindingSafety {
  if (!plain(value) || !exactKeys(value, [
    "authoritative", "applied", "persistedToScene", "activeCameraUnchanged", "floorStateUnchanged", "supportStateUnchanged",
    "databaseWrites", "productionAssetWrites", "productionTokenAccountingUsed", "compositorCalls", "emptyRoomGenerationCalls",
    "geminiFloorProposalCalls", "afcR2Runs", "proposalReceiptWritten",
  ])) return false;
  return value.authoritative === false && value.applied === false && value.persistedToScene === false &&
    value.activeCameraUnchanged === true && value.floorStateUnchanged === true && value.supportStateUnchanged === true &&
    value.databaseWrites === false && value.productionAssetWrites === false && value.productionTokenAccountingUsed === false &&
    value.compositorCalls === false && value.emptyRoomGenerationCalls === false && value.geminiFloorProposalCalls === true &&
    value.afcR2Runs === false && value.proposalReceiptWritten === true;
}
/** Closed, path-free companion receipt authority. */
export function parseAfcUi2bBindingReceipt(value: unknown): Readonly<{ ok: true; receipt: AfcUi2bBindingReceipt }> | Readonly<{ ok: false }> {
  if (!plain(value) || !exactKeys(value, [
    "receiptContractVersion", "roomId", "package", "manifest", "studyMode", "selectedImage", "sharedContextDigest",
    "proposal", "providerCallCount", "runner", "safety",
  ]) || value.receiptContractVersion !== AFC_UI2B_BINDING_RECEIPT_VERSION || typeof value.roomId !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.roomId) || !digest(value.sharedContextDigest) ||
    (value.studyMode !== "original_only" && value.studyMode !== "empty_only") || value.providerCallCount !== 1 ||
    !plain(value.package) || !plain(value.manifest) || !plain(value.selectedImage) || !plain(value.proposal) ||
    !plain(value.runner) || !executionBindingSafety(value.safety)) return deepFreeze({ ok: false as const });
  const packageValue = value.package;
  const manifest = value.manifest;
  const selectedImage = value.selectedImage;
  const proposal = value.proposal;
  const runner = value.runner;
  const packageMatch = typeof packageValue.packageId === "string" &&
    packageValue.packageId.match(/^afc-ui2a-package:([a-z][a-z0-9-]{0,63}):([a-f0-9]{64})$/);
  if (!packageMatch || typeof packageValue.packageId !== "string" || packageMatch[1] !== value.roomId || !exactKeys(packageValue, ["packageId", "receiptFileName", "receiptSha256"]) ||
    !safeName(packageValue.receiptFileName) || !digest(packageValue.receiptSha256) ||
    packageValue.receiptFileName !== `afc-ui2a-prepared-input.${value.roomId}.${packageMatch[2]}.receipt.json` ||
    !exactKeys(manifest, ["fileName", "sha256"]) || !safeName(manifest.fileName) || !digest(manifest.sha256) ||
    !exactKeys(selectedImage, ["role", "fileName", "sha256"]) ||
    (selectedImage.role !== "original_photo_contextual_geometry" && selectedImage.role !== "empty_room_boundary_specialist") ||
    !safeName(selectedImage.fileName) || !digest(selectedImage.sha256) ||
    !exactKeys(proposal, ["receiptFileName", "receiptSha256"]) || typeof proposal.receiptFileName !== "string" ||
    !/^afc-r3c-run\.[A-Za-z0-9._-]{1,180}\.receipt\.json$/.test(proposal.receiptFileName) || !digest(proposal.receiptSha256) ||
    !exactKeys(runner, ["contractVersion", "promptRole", "modelId"]) || typeof runner.contractVersion !== "string" ||
    runner.contractVersion !== "afc-r3c-proposal-run-receipt/v1" || runner.promptRole !== selectedImage.role ||
    (runner.promptRole !== "original_photo_contextual_geometry" && runner.promptRole !== "empty_room_boundary_specialist") ||
    typeof runner.modelId !== "string" || runner.modelId.length === 0 ||
    (value.studyMode === "original_only" && selectedImage.role !== "original_photo_contextual_geometry") ||
    (value.studyMode === "empty_only" && selectedImage.role !== "empty_room_boundary_specialist")) return deepFreeze({ ok: false as const });
  return deepFreeze({
    ok: true as const,
    receipt: {
      receiptContractVersion: AFC_UI2B_BINDING_RECEIPT_VERSION, roomId: value.roomId,
      package: { packageId: packageValue.packageId, receiptFileName: packageValue.receiptFileName, receiptSha256: packageValue.receiptSha256 },
      manifest: { fileName: manifest.fileName, sha256: manifest.sha256 },
      studyMode: value.studyMode, selectedImage: { role: selectedImage.role, fileName: selectedImage.fileName, sha256: selectedImage.sha256 },
      sharedContextDigest: value.sharedContextDigest, proposal: { receiptFileName: proposal.receiptFileName, receiptSha256: proposal.receiptSha256 },
      providerCallCount: 1, runner: { contractVersion: runner.contractVersion, promptRole: runner.promptRole, modelId: runner.modelId },
      safety: value.safety,
    },
  });
}
async function readImmutableCapture(captureRoot: string, filename: string): Promise<Readonly<{ bytes: Buffer; sha256: string }> | null> {
  if (!safeName(filename)) return null;
  try {
    const rootInfo = await lstat(captureRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return null;
    const root = await realpath(captureRoot);
    const candidate = path.resolve(root, filename);
    if (!isInside(root, candidate)) return null;
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const actual = await realpath(candidate);
    if (!isInside(root, actual)) return null;
    const bytes = await readFile(actual);
    return deepFreeze({ bytes, sha256: createHash("sha256").update(bytes).digest("hex") });
  } catch {
    return null;
  }
}
function publicCompatibility(receipt: { compatibility: { version: string; tier: string; relativeAspectErrorRaw: number; relativeAspectError: number } }): Binding["compatibility"] {
  return {
    version: receipt.compatibility.version, tier: receipt.compatibility.tier,
    relativeAspectErrorRaw: receipt.compatibility.relativeAspectErrorRaw, relativeAspectError: receipt.compatibility.relativeAspectError,
  };
}
function runnerFailure(code: string | null): AfcUi2bFailureCode {
  if (code === "missing_api_key") return "provider_configuration_unavailable";
  if (code === "capture_write_failed") return "proposal_capture_failed";
  if (code === "provider_non_success" || code === "provider_transport_failed") return "provider_non_success";
  if (code === "provider_envelope_invalid" || code === "provider_envelope_ambiguous") return "provider_response_invalid";
  if (code === "r3b_contract_failure" || code === "comparison_context_invalid" || code === "composition_failure") return "proposal_contract_invalid";
  if (code === "image_read_failed" || code === "image_oversized" || code === "image_byte_count_mismatch" || code === "image_mime_mismatch" || code === "image_hash_mismatch" || code === "image_metadata_mismatch" || code === "image_orientation_unsupported") return "selected_image_invalid";
  return "runner_validation_failed";
}

async function bindRequest(
  request: AfcUi2bProposalRunRequest,
  dependencies: AfcUi2bProposalRunDependencies,
): Promise<Binding | AfcUi2bProposalRunResult> {
  const replay = await (dependencies.replayPackage ?? replayAfcUi2aPreparedPackage)({
    roomLabel: request.roomLabel,
    packageId: request.packageSelector.packageId,
    receiptFileName: request.packageSelector.receiptFileName,
    receiptSha256: request.packageSelector.receiptSha256,
  });
  if (!replay.ok) {
    const code = replay.failureCode;
    return fail(
      code === "package_not_found" || code === "package_receipt_hash_mismatch" || code === "package_receipt_invalid"
        ? code
        : code === "manifest_validation_failed" ? "manifest_validation_failed" : "package_replay_failed"
    );
  }
  const evidence = replay.evidence;
  if (evidence.roomId !== request.roomLabel || evidence.packageId !== request.packageSelector.packageId) return fail("package_room_mismatch");
  const source = request.studyMode === "original_only" ? evidence.receipt.original : evidence.receipt.emptyRoomAssist;
  const runnerImageRole = request.studyMode === "original_only" ? "original_contextual" as const : "empty_room_boundary_specialist" as const;
  const selectedImage: SelectedImage = {
    role: request.studyMode === "original_only" ? "original_photo_contextual_geometry" : "empty_room_boundary_specialist",
    fileName: source.fileName, sha256: source.sha256, byteCount: source.byteCount, mimeType: source.mimeType,
    decodedWidth: source.decodedWidth, decodedHeight: source.decodedHeight, orientation: source.orientation,
  };
  const descriptor = {
    filePath: source.fileName, sha256: source.sha256, byteCount: source.byteCount,
    mimeType: source.mimeType, decodedWidth: source.decodedWidth, decodedHeight: source.decodedHeight, orientation: source.orientation,
  };
  const verified = await (dependencies.verifyImage ?? verifyAfcR3cManifestImage)({
    descriptor, manifestDirectory: path.dirname(evidence.manifestFilePath),
  });
  if (!verified.ok) return fail("selected_image_invalid");
  const modelId = (dependencies.resolveModel ?? resolveAfcUi2bProposalRunnerModel)();
  if (!modelId) return fail("provider_configuration_unavailable");
  try {
    buildAfcR3cGeminiFloorProposalPrompt({
      imageRole: runnerImageRole,
      basisBinding: deriveGeminiFloorBasisBinding(evidence.receipt.sharedComparisonContext, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY),
    });
    resolveAfcR3cGenerationConfig(modelId);
  } catch {
    return fail("runner_binding_invalid");
  }
  return deepFreeze({
    request, roomId: evidence.roomId, manifestDirectory: path.dirname(evidence.manifestFilePath),
    manifest: { fileName: evidence.receipt.manifest.fileName, sha256: evidence.receipt.manifest.sha256, contractVersion: evidence.receipt.manifest.contractVersion },
    selectedImage, runnerImageRole, sharedContextDigest: evidence.receipt.sharedContextDigest,
    compatibility: publicCompatibility(evidence.receipt), modelId,
    runnerManifest: {
      contractVersion: evidence.receipt.manifest.contractVersion, roomId: evidence.roomId,
      original: { filePath: evidence.receipt.original.fileName, ...evidence.receipt.original },
      emptyRoomAssist: {
        filePath: evidence.receipt.emptyRoomAssist.fileName, ...evidence.receipt.emptyRoomAssist,
        generatorModelId: evidence.receipt.emptyRoomAssist.requestedModelId,
      },
      sharedComparisonContext: evidence.receipt.sharedComparisonContext,
    },
  });
}
function isFailure(value: Binding | AfcUi2bProposalRunResult): value is AfcUi2bProposalRunResult {
  return "status" in value;
}
function validated(binding: Binding): AfcUi2bProposalRunResult {
  return deepFreeze({
    status: "run_validated" as const, roomId: binding.roomId, packageId: binding.request.packageSelector.packageId, studyMode: binding.request.studyMode,
    selectedImage: binding.selectedImage, manifest: binding.manifest, sharedContextDigest: binding.sharedContextDigest, compatibility: binding.compatibility,
    runner: {
      runnerContractVersion: "afc-r3c-proposal-run-receipt/v1", promptRole: binding.selectedImage.role, modelId: binding.modelId,
      providerCall: false, providerCallCount: 0, captureWrite: false,
    },
    safety: validationSafety(),
  });
}

/** Replays the package on every request; validation never calls the provider or creates a capture. */
export async function runAfcUi2bControlledProposal(
  rawRequest: unknown,
  dependencies: AfcUi2bProposalRunDependencies = {},
): Promise<AfcUi2bProposalRunResult> {
  const parsed = parseAfcUi2bProposalRunRequest(rawRequest);
  if (!parsed.ok) return fail("invalid_input");
  const request = parsed.request;
  if (request.operation === "execute" && request.executeCapture !== true) return fail("capture_not_authorized");
  if (request.operation === "execute" && request.executeLiveProviderCall !== true) return fail("provider_call_not_authorized");
  const binding = await bindRequest(request, dependencies);
  if (isFailure(binding)) return binding;
  if (request.operation === "validate") return validated(binding);

  const apiKey = (dependencies.resolveApiKey ?? resolveAfcUi2bGeminiApiKey)();
  if (!apiKey) return fail("provider_configuration_unavailable");
  const captureRoot = (dependencies.captureRoot ?? (() => path.join(process.cwd(), AFC_R3C_CAPTURE_ROOT_RELATIVE)))();
  if (!await preflightCaptureRoot(captureRoot)) return fail("runner_validation_failed");
  let providerCallCount: 0 | 1 = 0;
  const attemptedProviderCalls = () => providerCallCount;
  let proposalReceiptWritten = false;
  let companionReceiptWritten = false;
  const reservation = await (dependencies.acquireReservation ?? acquireReservation)({
    captureRoot, packageId: binding.request.packageSelector.packageId, studyMode: binding.request.studyMode,
  });
  if (!reservation.ok) return fail("run_in_progress");
  try {
    const upstreamFetch = dependencies.fetchImpl ?? globalThis.fetch;
    const countedFetch: AfcR3cProviderFetch = async (input, init) => {
      if (providerCallCount !== 0) throw new Error("ui2b_single_arm_provider_limit");
      providerCallCount = 1;
      return upstreamFetch(input, init);
    };
    const result = await (dependencies.runStudy ?? runAfcR3cGeminiFloorProposalStudy)({
      manifest: binding.runnerManifest,
      manifestDirectory: binding.manifestDirectory, studyMode: request.studyMode, outputDir: captureRoot,
      apiKey, model: binding.modelId, executeLiveProviderCall: true, repositoryRoot: (dependencies.repositoryRoot ?? (() => process.cwd()))(),
      runAfcR2: false, fetchImpl: countedFetch,
    });
    const attempts = attemptedProviderCalls();
    if (result.arms.length > 1 || attempts !== 1) {
      return fail("runner_validation_failed", attempts, proposalReceiptWritten, companionReceiptWritten);
    }
    if (result.status !== "success") return fail(runnerFailure(result.failureCode), attempts, proposalReceiptWritten, companionReceiptWritten);
    const arm = result.arms[0];
    const receiptFileName = arm ? receiptFilename(arm.requestId) : null;
    if (!receiptFileName) return fail("proposal_receipt_validation_failed", attempts, proposalReceiptWritten, companionReceiptWritten);
    const receiptFile = await readImmutableCapture(captureRoot, receiptFileName);
    if (!receiptFile) return fail("proposal_receipt_validation_failed", attempts, proposalReceiptWritten, companionReceiptWritten);
    proposalReceiptWritten = true;
    const proposalReplay = await (dependencies.replayProposal ?? replayAfcProposalOverlay)({ receiptFileName, captureRoot });
    if (proposalReplay.status !== "valid" || proposalReplay.viewModel.artifactIdentity.receiptSha256 !== receiptFile.sha256) {
      return fail("proposal_replay_failed", attempts, proposalReceiptWritten, companionReceiptWritten);
    }
    const receiptSha256 = receiptFile.sha256;
    const bindingReceipt: AfcUi2bBindingReceipt = {
      receiptContractVersion: AFC_UI2B_BINDING_RECEIPT_VERSION,
      roomId: binding.roomId,
      package: {
        packageId: request.packageSelector.packageId,
        receiptFileName: request.packageSelector.receiptFileName,
        receiptSha256: request.packageSelector.receiptSha256,
      },
      manifest: { fileName: binding.manifest.fileName, sha256: binding.manifest.sha256 },
      studyMode: request.studyMode,
      selectedImage: { role: binding.selectedImage.role, fileName: binding.selectedImage.fileName, sha256: binding.selectedImage.sha256 },
      sharedContextDigest: binding.sharedContextDigest,
      proposal: { receiptFileName, receiptSha256 },
      providerCallCount: 1,
      runner: { contractVersion: "afc-r3c-proposal-run-receipt/v1", promptRole: binding.selectedImage.role, modelId: binding.modelId },
      safety: executionSafety(),
    };
    const bindingBytes = stableReceiptBytes(bindingReceipt);
    const bindingSha256 = createHash("sha256").update(bindingBytes).digest("hex");
    const savedBinding = await (dependencies.writeCapture ?? writeAfcR3cImmutableCapture)({
      outputDir: captureRoot, filename: proposalBindingFilename(receiptSha256), bytes: bindingBytes,
    });
    if (!savedBinding.ok) return fail("proposal_capture_failed", attempts, proposalReceiptWritten, companionReceiptWritten);
    const savedBindingFile = await readImmutableCapture(captureRoot, proposalBindingFilename(receiptSha256));
    if (!savedBindingFile || savedBindingFile.sha256 !== bindingSha256) {
      return fail("proposal_capture_failed", attempts, proposalReceiptWritten, companionReceiptWritten);
    }
    let parsedBinding: ReturnType<typeof parseAfcUi2bBindingReceipt>;
    try { parsedBinding = parseAfcUi2bBindingReceipt(JSON.parse(savedBindingFile.bytes.toString("utf8"))); }
    catch { parsedBinding = deepFreeze({ ok: false as const }); }
    if (!parsedBinding.ok || parsedBinding.receipt.proposal.receiptSha256 !== receiptSha256) {
      return fail("proposal_capture_failed", attempts, proposalReceiptWritten, companionReceiptWritten);
    }
    const { replayAfcUi2bBindingReceipt } = await import("./afc-ui2b-binding-replay");
    const companionReplay = await replayAfcUi2bBindingReceipt({
      roomLabel: binding.roomId, bindingFileName: proposalBindingFilename(receiptSha256),
    }, {
      captureRoot: () => captureRoot,
      replayPackage: dependencies.replayPackage,
      replayProposal: dependencies.replayProposal,
    });
    if (companionReplay.status !== "valid") {
      return fail("proposal_capture_failed", attempts, proposalReceiptWritten, companionReceiptWritten);
    }
    companionReceiptWritten = true;
    const view = proposalReplay.viewModel;
    return deepFreeze({
      status: "run_completed" as const, roomId: binding.roomId, packageId: request.packageSelector.packageId, studyMode: request.studyMode,
      selectedImage: binding.selectedImage, manifest: binding.manifest, sharedContextDigest: binding.sharedContextDigest, compatibility: binding.compatibility,
      runner: {
        runnerContractVersion: "afc-r3c-proposal-run-receipt/v1", promptRole: binding.selectedImage.role, modelId: binding.modelId,
        providerCall: true, providerCallCount: 1, captureWrite: true, companionReceiptWritten: true,
      },
      proposal: {
        receiptFileName, receiptSha256, studyMode: view.artifactIdentity.studyMode, armCount: result.arms.length,
        candidateCount: view.provenance.afcR3c.candidateIds.length, acceptedCandidateIds: [...view.provenance.afcR3c.candidateIds],
        warningCount: view.warnings.length, strictReplayVerified: true,
      },
      safety: executionSafety(),
    });
  } catch {
    return fail("unexpected_failure", attemptedProviderCalls(), proposalReceiptWritten, companionReceiptWritten);
  } finally {
    await (dependencies.releaseReservation ?? releaseReservation)(reservation.filePath).catch(() => undefined);
  }
}

export function afcUi2bProposalBindingReceiptFileName(receiptSha256: string): string {
  return proposalBindingFilename(receiptSha256);
}
