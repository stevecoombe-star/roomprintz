import "server-only";

import { open, rm } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

import { isAfcUi2aEmptyGenerationEnabled } from "@/lib/vibodeAfcUi2aConfig";
import {
  AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_REQUEST_VERSION,
  captureAfcR3cFixedEmptyRoom,
  type AfcR3cFixedEmptyRoomCaptureResult,
} from "./afc-r3c-fixed-empty-room-capture";
import { discoverAfcUi2aDurableEmptyEvidence, type AfcUi2aDurableEmptyDiscovery } from "./afc-ui2a-empty-evidence-replay";
import { replayAfcUi2aOriginalPreparation, type AfcUi2aOriginalPreparationReplayResult, type AfcUi2aVerifiedOriginalEvidence } from "./afc-ui2a-original-preparation-replay";
import {
  deepFreeze,
  parseAfcUi2aEmptyResolutionRequest,
  type AfcUi2aEmptyResolutionFailure,
  type AfcUi2aEmptyResolutionResult,
  type AfcUi2aPackageFailureCode,
} from "./afc-ui2a-package-contract";

type ReservationResult = { ok: true; filePath: string } | { ok: false; code: "empty_generation_in_progress" | "unexpected_failure" };

export type AfcUi2aEmptyResolutionDependencies = Readonly<{
  replayOriginal?: (args: { roomLabel: unknown; selector: Parameters<typeof replayAfcUi2aOriginalPreparation>[0]["selector"]; currentExpectedFingerprint?: string }) => Promise<AfcUi2aOriginalPreparationReplayResult>;
  discoverDurable?: (original: AfcUi2aVerifiedOriginalEvidence) => Promise<AfcUi2aDurableEmptyDiscovery>;
  capture?: (request: unknown) => Promise<AfcR3cFixedEmptyRoomCaptureResult>;
  emptyGenerationEnabled?: () => boolean;
  now?: () => Date;
  randomHex?: () => string;
  acquireReservation?: (args: { roomDirectory: string; originalSha256: string }) => Promise<ReservationResult>;
  releaseReservation?: (filePath: string) => Promise<void>;
}>;

function failure(failureCode: AfcUi2aPackageFailureCode, message: string, emptyRoomGenerationCall = false): AfcUi2aEmptyResolutionFailure {
  return deepFreeze({ status: "failure" as const, failureCode, message, emptyRoomGenerationCall });
}
function generationRequired(original: AfcUi2aVerifiedOriginalEvidence): AfcUi2aEmptyResolutionResult {
  return deepFreeze({
    status: "empty_generation_required" as const,
    roomId: original.roomId,
    originalPreparationId: original.preparationId,
    requestedModelId: "NBP" as const,
    expectedCompositorCallCount: 1 as const,
    emptyRoomGenerationCall: false as const,
  });
}
function resolved(original: AfcUi2aVerifiedOriginalEvidence, discovery: Extract<AfcUi2aDurableEmptyDiscovery, { status: "selected" }>, source: "disk_reused" | "cache_hit" | "generated", generationCall: boolean): AfcUi2aEmptyResolutionResult {
  return deepFreeze({
    status: "empty_resolved" as const,
    roomId: original.roomId,
    originalPreparationId: original.preparationId,
    resolutionSource: source,
    original: { ...original.original },
    emptyRoomAssist: { ...discovery.evidence.emptyRoomAssist },
    emptyRoomGenerationCall: generationCall,
    safety: {
      geminiFloorProposalCall: false as const,
      afcR2Run: false as const,
      floorStateUnchanged: true as const,
      supportStateUnchanged: true as const,
      activeCameraUnchanged: true as const,
      sceneStateUnchanged: true as const,
      productionTokenAccountingUsed: false as const,
    },
  });
}
function mapDiscoveryFailure(discovery: Exclude<AfcUi2aDurableEmptyDiscovery, { status: "absent" | "selected" }>, generationCall = false): AfcUi2aEmptyResolutionFailure {
  const messages: Record<string, string> = {
    durable_empty_invalid: "Stored Empty-Room evidence is invalid and must be corrected before retrying.",
    empty_lineage_mismatch: "Stored Empty-Room evidence does not match the verified Original.",
    pair_incompatible: "Stored Empty-Room evidence has dimensions incompatible with the verified Original.",
    conflicting_empty_evidence: "More than one distinct verified Empty-Room image exists for this Original.",
  };
  return failure(discovery.failureCode, messages[discovery.failureCode], generationCall);
}
function requestId(roomId: string, originalSha: string, now: Date, randomHex: string): string {
  const compact = now.toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
  const suffix = /^[a-f0-9]{6,}$/.test(randomHex) ? randomHex.slice(0, 6) : crypto.randomBytes(3).toString("hex");
  return `${roomId}-ui2a-empty-${originalSha.slice(0, 8)}-${compact}-${suffix}`;
}
function reservationName(originalSha256: string): string {
  return `.afc-ui2a-empty-generation.${originalSha256}.reservation`;
}
async function acquireReservation(args: { roomDirectory: string; originalSha256: string }): Promise<ReservationResult> {
  const filePath = path.join(args.roomDirectory, reservationName(args.originalSha256));
  try {
    const handle = await open(filePath, "wx", 0o600);
    await handle.close();
    return { ok: true, filePath };
  } catch (error) {
    return { ok: false, code: (error as NodeJS.ErrnoException).code === "EEXIST" ? "empty_generation_in_progress" : "unexpected_failure" };
  }
}
async function releaseReservation(filePath: string): Promise<void> { await rm(filePath, { force: true }).catch(() => undefined); }
function mapCaptureFailure(result: Extract<AfcR3cFixedEmptyRoomCaptureResult, { status: "failure" }>): AfcUi2aEmptyResolutionFailure {
  const generation = result.emptyRoomGenerationCall;
  if (result.failureCode === "request_id_in_progress") return failure("empty_generation_in_progress", "An Empty-Room generation is already in progress.", generation);
  if (result.failureCode === "request_id_reused") return failure("empty_generation_request_reused", "The Empty-Room capture request could not be accepted.", generation);
  if (result.failureCode === "empty_generation_failed") return failure("empty_generation_failed", "The authorized Empty-Room generation did not produce an admissible image.", generation);
  return failure("empty_capture_failed", "The Empty-Room capture could not be verified and saved.", generation);
}

/**
 * Server-only UI2A-2A policy boundary. It always replay-verifies newly written
 * durable evidence and is the sole UI2A importer of the fixed capture service.
 */
export async function resolveAfcUi2aEmptyEvidence(rawRequest: unknown, dependencies: AfcUi2aEmptyResolutionDependencies = {}): Promise<AfcUi2aEmptyResolutionResult> {
  const parsed = parseAfcUi2aEmptyResolutionRequest(rawRequest);
  if (!parsed.ok) return failure("invalid_request", "The Empty-Room resolution request is invalid.");
  const request = parsed.request;
  if (request.executeCapture !== true) return failure("capture_not_authorized", "Confirm Empty-Room resolution before accessing local research evidence.");

  const replay = await (dependencies.replayOriginal ?? replayAfcUi2aOriginalPreparation)({
    roomLabel: request.roomLabel,
    selector: request.originalPreparation,
    ...(request.currentExpectedFingerprint === undefined ? {} : { currentExpectedFingerprint: request.currentExpectedFingerprint }),
  });
  if (!replay.ok) return failure(replay.failureCode, replay.message);
  const original = replay.evidence;
  const discover = dependencies.discoverDurable ?? discoverAfcUi2aDurableEmptyEvidence;
  const disk = await discover(original);
  if (disk.status === "selected") return resolved(original, disk, "disk_reused", false);
  if (disk.status !== "absent") return mapDiscoveryFailure(disk);

  const capture = dependencies.capture ?? captureAfcR3cFixedEmptyRoom;
  const makeRequest = (generate: boolean) => ({
    contractVersion: AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_REQUEST_VERSION,
    roomId: original.roomId,
    requestId: requestId(original.roomId, original.original.sha256, (dependencies.now ?? (() => new Date()))(), (dependencies.randomHex ?? (() => crypto.randomBytes(3).toString("hex")))()),
    originalFilePath: original.originalFilePath,
    originalImageUrl: original.sanitizedImageUrl,
    expectedOriginalSha256: original.original.sha256,
    outputDir: original.roomDirectory,
    executeCapture: true as const,
    ...(generate ? { executeEmptyRoomGeneration: true } : {}),
  });
  let cacheAttempt: AfcR3cFixedEmptyRoomCaptureResult;
  try { cacheAttempt = await capture(makeRequest(false)); }
  catch { return failure("unexpected_failure", "The Empty-Room cache check could not be completed."); }
  if (cacheAttempt.status === "captured") {
    const replayed = await discover(original);
    if (replayed.status === "selected") return resolved(original, replayed, "cache_hit", false);
    return replayed.status === "absent"
      ? failure("empty_capture_failed", "The cached Empty-Room capture did not produce durable evidence.")
      : mapDiscoveryFailure(replayed);
  }
  if (cacheAttempt.status === "failure") return mapCaptureFailure(cacheAttempt);
  if (request.executeEmptyRoomGeneration !== true) return generationRequired(original);
  if (!(dependencies.emptyGenerationEnabled ?? isAfcUi2aEmptyGenerationEnabled)()) {
    return failure("empty_generation_disabled", "Live Empty-Room generation is disabled.");
  }

  const reservation = await (dependencies.acquireReservation ?? acquireReservation)({ roomDirectory: original.roomDirectory, originalSha256: original.original.sha256 });
  if (!reservation.ok) return failure(reservation.code, reservation.code === "empty_generation_in_progress" ? "An Empty-Room generation is already in progress." : "The Empty-Room generation reservation could not be acquired.");
  try {
    let generated: AfcR3cFixedEmptyRoomCaptureResult;
    try { generated = await capture(makeRequest(true)); }
    catch { return failure("unexpected_failure", "The authorized Empty-Room generation did not complete.", true); }
    if (generated.status === "failure") return mapCaptureFailure(generated);
    if (generated.status !== "captured") return failure("empty_capture_failed", "The authorized Empty-Room generation did not produce a capture.", generated.emptyRoomGenerationCall);
    const replayed = await discover(original);
    if (replayed.status === "selected") return resolved(original, replayed, "generated", generated.emptyRoomGenerationCall);
    return replayed.status === "absent"
      ? failure("empty_capture_failed", "The generated Empty-Room capture did not produce durable evidence.", generated.emptyRoomGenerationCall)
      : mapDiscoveryFailure(replayed, generated.emptyRoomGenerationCall);
  } finally {
    await (dependencies.releaseReservation ?? releaseReservation)(reservation.filePath);
  }
}

export const afcUi2aEmptyGenerationReservationFilename = reservationName;
