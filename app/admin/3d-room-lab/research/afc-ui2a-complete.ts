import "server-only";

import { discoverAfcUi2aDurableEmptyEvidence, type AfcUi2aDurableEmptyDiscovery, type AfcUi2aVerifiedEmptyEvidence } from "./afc-ui2a-empty-evidence-replay";
import { resolveAfcUi2aEmptyEvidence } from "./afc-ui2a-empty-resolution";
import { replayAfcUi2aOriginalPreparation, type AfcUi2aOriginalPreparationReplayResult, type AfcUi2aVerifiedOriginalEvidence } from "./afc-ui2a-original-preparation-replay";
import { materializeAfcUi2aPreparedPackage, type AfcUi2aPreparedPackageResult } from "./afc-ui2a-prepared-package";
import {
  deepFreeze,
  parseAfcUi2aCompleteRequest,
  type AfcUi2aCompleteFailureCode,
  type AfcUi2aCompleteResult,
} from "./afc-ui2a-complete-contract";
import type { AfcUi2aEmptyResolutionResult } from "./afc-ui2a-package-contract";

export type { AfcUi2aCompleteResult } from "./afc-ui2a-complete-contract";

export type AfcUi2aCompleteDependencies = Readonly<{
  resolveEmpty?: (request: unknown) => Promise<AfcUi2aEmptyResolutionResult>;
  replayOriginal?: (args: { roomLabel: unknown; selector: AfcUi2aVerifiedOriginalEvidence["receipt"]["preparationId"] extends string ? { preparationId: string; receiptFileName: string; receiptSha256: string } : never; currentExpectedFingerprint?: string }) => Promise<AfcUi2aOriginalPreparationReplayResult>;
  discoverDurable?: (original: AfcUi2aVerifiedOriginalEvidence) => Promise<AfcUi2aDurableEmptyDiscovery>;
  materialize?: (args: {
    originalPreparation: { preparationId: string; receiptFileName: string; receiptSha256: string };
    originalEvidence: AfcUi2aVerifiedOriginalEvidence; emptyEvidence: AfcUi2aVerifiedEmptyEvidence; executeCapture: unknown;
  }) => Promise<AfcUi2aPreparedPackageResult>;
}>;

function failure(failureCode: AfcUi2aCompleteFailureCode, message: string, emptyRoomGenerationCall = false): AfcUi2aCompleteResult {
  return deepFreeze({ status: "failure" as const, failureCode, message, emptyRoomGenerationCall });
}
function mapFailure(code: string): AfcUi2aCompleteFailureCode {
  switch (code) {
    case "invalid_request": case "invalid_input": return "invalid_input";
    case "capture_not_authorized": return "capture_not_authorized";
    case "original_preparation_not_found": case "original_receipt_hash_mismatch": case "original_receipt_invalid":
    case "original_image_missing": case "original_evidence_invalid": return "original_evidence_invalid";
    case "original_image_mismatch": return "original_image_mismatch";
    case "empty_generation_disabled": return "empty_generation_disabled";
    case "empty_generation_in_progress": case "request_id_in_progress": return "empty_generation_in_progress";
    case "empty_generation_failed": case "empty_capture_failed": case "empty_generation_request_reused": return "empty_generation_failed";
    case "durable_empty_invalid": case "empty_evidence_invalid": case "empty_image_missing": return "empty_evidence_invalid";
    case "empty_image_mismatch": return "empty_image_mismatch";
    case "empty_lineage_mismatch": return "empty_lineage_mismatch";
    case "conflicting_empty_evidence": return "conflicting_empty_evidence";
    case "pair_incompatible": return "pair_incompatible";
    case "shared_context_invalid": return "shared_context_invalid";
    case "manifest_conflict": return "manifest_conflict";
    case "manifest_capture_failed": case "manifest_build_failed": return "manifest_capture_failed";
    case "manifest_validation_failed": return "manifest_validation_failed";
    case "package_receipt_capture_failed": return "package_receipt_capture_failed";
    case "package_receipt_validation_failed": return "package_receipt_validation_failed";
    case "package_replay_failed": return "package_replay_failed";
    default: return "unexpected_failure";
  }
}
function safeMessage(code: AfcUi2aCompleteFailureCode): string {
  const messages: Record<AfcUi2aCompleteFailureCode, string> = {
    invalid_input: "The prepared-package request is invalid.",
    capture_not_authorized: "Confirm prepared-package completion before accessing local evidence.",
    original_evidence_invalid: "The selected Original preparation is no longer valid.",
    original_image_mismatch: "The Original image no longer matches its verified evidence.",
    empty_generation_disabled: "Live Empty-Room generation is disabled.",
    empty_generation_in_progress: "An Empty-Room generation is already in progress.",
    empty_generation_failed: "The Empty-Room generation did not produce admissible evidence.",
    empty_evidence_invalid: "The durable Empty-Room evidence is invalid.",
    empty_image_mismatch: "The Empty-Room image no longer matches verified evidence.",
    empty_lineage_mismatch: "The Empty-Room evidence does not match the selected Original.",
    conflicting_empty_evidence: "More than one distinct verified Empty-Room image exists.",
    pair_incompatible: "The Original and Empty-Room images are not exact-grid compatible.",
    shared_context_invalid: "The shared comparison context is invalid.",
    manifest_conflict: "A conflicting immutable manifest exists.",
    manifest_capture_failed: "The immutable manifest could not be captured.",
    manifest_validation_failed: "The manifest did not pass verification.",
    package_receipt_capture_failed: "The prepared-package receipt could not be captured.",
    package_receipt_validation_failed: "The prepared-package receipt did not pass verification.",
    package_replay_failed: "The prepared package did not pass strict replay.",
    unexpected_failure: "The prepared package could not be completed.",
  };
  return messages[code];
}
function sameImage(a: { fileName: string; sha256: string; byteCount: number; mimeType: string; decodedWidth: number; decodedHeight: number; orientation: number }, b: typeof a): boolean {
  return a.fileName === b.fileName && a.sha256 === b.sha256 && a.byteCount === b.byteCount && a.mimeType === b.mimeType &&
    a.decodedWidth === b.decodedWidth && a.decodedHeight === b.decodedHeight && a.orientation === b.orientation;
}
function sameEmpty(a: AfcUi2aVerifiedEmptyEvidence["emptyRoomAssist"], b: AfcUi2aVerifiedEmptyEvidence["emptyRoomAssist"]): boolean {
  return sameImage(a, b) && a.generatedFromOriginalSha256 === b.generatedFromOriginalSha256 &&
    a.generatorId === b.generatorId && a.requestedModelId === b.requestedModelId &&
    a.resolvedModelId === b.resolvedModelId && a.resolvedModelStatus === b.resolvedModelStatus;
}

function projectSuccess(
  resolution: Extract<AfcUi2aEmptyResolutionResult, { status: "empty_resolved" }>,
  materialized: Extract<AfcUi2aPreparedPackageResult, { status: "package_materialized" }>,
): AfcUi2aCompleteResult {
  return deepFreeze({
    status: "package_completed" as const,
    roomId: materialized.roomId,
    originalPreparationId: materialized.originalPreparationId,
    emptyResolutionSource: resolution.resolutionSource,
    emptyRoomGenerationCall: resolution.emptyRoomGenerationCall,
    package: {
      packageId: materialized.packageId,
      original: {
        fileName: materialized.original.fileName, sha256: materialized.original.sha256, byteCount: materialized.original.byteCount,
        mimeType: materialized.original.mimeType, decodedWidth: materialized.original.decodedWidth, decodedHeight: materialized.original.decodedHeight, orientation: 1 as const,
      },
      emptyRoomAssist: {
        fileName: materialized.emptyRoomAssist.fileName, sha256: materialized.emptyRoomAssist.sha256, byteCount: materialized.emptyRoomAssist.byteCount,
        mimeType: materialized.emptyRoomAssist.mimeType, decodedWidth: materialized.emptyRoomAssist.decodedWidth, decodedHeight: materialized.emptyRoomAssist.decodedHeight,
        orientation: 1 as const, generatedFromOriginalSha256: materialized.emptyRoomAssist.generatedFromOriginalSha256,
        generatorId: materialized.emptyRoomAssist.generatorId, requestedModelId: "NBP" as const, resolvedModelStatus: "not_reported_by_compositor" as const,
      },
      compatibility: {
        version: materialized.compatibility.version,
        tier: materialized.compatibility.tier,
        relativeAspectErrorRaw: materialized.compatibility.relativeAspectErrorRaw,
        relativeAspectError: materialized.compatibility.relativeAspectError,
      },
      sharedContextDigest: materialized.sharedContextDigest,
      manifest: {
        fileName: materialized.manifest.fileName,
        sha256: materialized.manifest.sha256,
        contractVersion: materialized.manifest.contractVersion,
        disposition: materialized.manifest.disposition,
      },
      receipt: {
        fileName: materialized.receipt.fileName,
        sha256: materialized.receipt.sha256,
        reused: materialized.receipt.reused,
      },
      safety: {
        authoritative: materialized.safety.authoritative,
        applied: materialized.safety.applied,
        persistedToScene: materialized.safety.persistedToScene,
        activeCameraUnchanged: materialized.safety.activeCameraUnchanged,
        floorStateUnchanged: materialized.safety.floorStateUnchanged,
        supportStateUnchanged: materialized.safety.supportStateUnchanged,
        databaseWrites: materialized.safety.databaseWrites,
        productionAssetWrites: materialized.safety.productionAssetWrites,
        productionTokenAccountingUsed: materialized.safety.productionTokenAccountingUsed,
        emptyRoomGenerationCall: materialized.safety.emptyRoomGenerationCall,
        geminiFloorProposalCall: materialized.safety.geminiFloorProposalCall,
        afcR2Run: materialized.safety.afcR2Run,
        localResearchPackageWritten: materialized.safety.localResearchPackageWritten,
      },
    },
    attemptSafety: {
      authoritative: false as const, applied: false as const, persistedToScene: false as const, activeCameraUnchanged: true as const,
      floorStateUnchanged: true as const, supportStateUnchanged: true as const, databaseWrites: false as const,
      productionAssetWrites: false as const, productionTokenAccountingUsed: false as const,
      emptyRoomGenerationCall: resolution.emptyRoomGenerationCall, geminiFloorProposalCall: false as const,
      afcR2Run: false as const, packageReplayVerified: true as const,
    },
  });
}

/** Server-only orchestrator: resolution is attempted once, then path-bearing evidence is reacquired and cross-checked. */
export async function completeAfcUi2aPreparedPackage(rawRequest: unknown, dependencies: AfcUi2aCompleteDependencies = {}): Promise<AfcUi2aCompleteResult> {
  const parsed = parseAfcUi2aCompleteRequest(rawRequest);
  if (!parsed.ok) return failure("invalid_input", safeMessage("invalid_input"));
  const request = parsed.request;
  if (request.executeCapture !== true) return failure("capture_not_authorized", safeMessage("capture_not_authorized"));

  let resolution: AfcUi2aEmptyResolutionResult;
  try {
    resolution = await (dependencies.resolveEmpty ?? resolveAfcUi2aEmptyEvidence)({
      contractVersion: "afc-ui2a-empty-resolution-request/v1",
      roomLabel: request.roomLabel,
      originalPreparation: request.originalPreparation,
      ...(request.currentExpectedFingerprint === undefined ? {} : { currentExpectedFingerprint: request.currentExpectedFingerprint }),
      executeCapture: true,
      ...(request.executeEmptyRoomGeneration === true ? { executeEmptyRoomGeneration: true } : {}),
    });
  } catch {
    return failure("unexpected_failure", safeMessage("unexpected_failure"));
  }
  if (resolution.status === "empty_generation_required") {
    return deepFreeze({
      status: "empty_generation_required" as const, roomId: resolution.roomId, originalPreparationId: resolution.originalPreparationId,
      requestedModelId: "NBP" as const, expectedCompositorCallCount: 1 as const, emptyRoomGenerationCall: false as const,
    });
  }
  if (resolution.status === "failure") {
    const code = mapFailure(resolution.failureCode);
    return failure(code, safeMessage(code), resolution.emptyRoomGenerationCall);
  }
  const generationCall = resolution.emptyRoomGenerationCall;

  let original: AfcUi2aOriginalPreparationReplayResult;
  try {
    original = await (dependencies.replayOriginal ?? replayAfcUi2aOriginalPreparation)({
      roomLabel: request.roomLabel, selector: request.originalPreparation,
      ...(request.currentExpectedFingerprint === undefined ? {} : { currentExpectedFingerprint: request.currentExpectedFingerprint }),
    });
  } catch {
    return failure("unexpected_failure", safeMessage("unexpected_failure"), generationCall);
  }
  if (!original.ok) {
    const code = mapFailure(original.failureCode);
    return failure(code, safeMessage(code), generationCall);
  }
  if (original.evidence.roomId !== resolution.roomId || original.evidence.preparationId !== resolution.originalPreparationId ||
    !sameImage(original.evidence.original, resolution.original)) {
    return failure("original_evidence_invalid", safeMessage("original_evidence_invalid"), generationCall);
  }
  let durable: AfcUi2aDurableEmptyDiscovery;
  try { durable = await (dependencies.discoverDurable ?? discoverAfcUi2aDurableEmptyEvidence)(original.evidence); }
  catch { return failure("empty_evidence_invalid", safeMessage("empty_evidence_invalid"), generationCall); }
  if (durable.status !== "selected") {
    const code = durable.status === "absent" ? "empty_evidence_invalid" : mapFailure(durable.failureCode);
    return failure(code, safeMessage(code), generationCall);
  }
  if (!sameEmpty(durable.evidence.emptyRoomAssist, resolution.emptyRoomAssist)) {
    return failure("empty_evidence_invalid", safeMessage("empty_evidence_invalid"), generationCall);
  }
  let materialized: AfcUi2aPreparedPackageResult;
  try {
    materialized = await (dependencies.materialize ?? materializeAfcUi2aPreparedPackage)({
      originalPreparation: request.originalPreparation, originalEvidence: original.evidence, emptyEvidence: durable.evidence, executeCapture: true,
    });
  } catch {
    return failure("unexpected_failure", safeMessage("unexpected_failure"), generationCall);
  }
  if (materialized.status !== "package_materialized") {
    const code = mapFailure(materialized.failureCode);
    return failure(code, safeMessage(code), generationCall);
  }
  return projectSuccess(resolution, materialized);
}
