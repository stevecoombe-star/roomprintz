import "server-only";

import { randomUUID } from "node:crypto";

import {
  type AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import {
  generateFullyTiledFromOriginal,
  retainFullyTiledEvidence,
  type FullyTiledGenerationInput,
  type FullyTiledGenerationResult,
} from "./fully-tiled-generation.server";
import {
  executeAfcV2FullyTiledFloorAnalysis,
  prepareAfcV2OriginalAndEmpty,
  type AfcV2FullyTiledFloorAnalyzeResult,
  type AfcV2FullyTiledFloorProduct,
  type PreparedAfcV2FloorInputs,
} from "./fully-tiled-floor-authority.server";
import {
  observeFullyTiledRoomEnvelope,
  type RoomObservationFailureDiagnostic,
  type RoomObservationResult,
} from "./room-observation.server";
import type {
  RoomObservationImageIdentity,
} from "./room-observation-contract";

type AppliedFloorResult = Extract<
  AfcV2FullyTiledFloorAnalyzeResult,
  { status: "applied" }
>;
type FullyTiledSummary = Readonly<{
  imageUrl: string;
  identity: RoomObservationImageIdentity;
  provenance: Extract<
    FullyTiledGenerationResult,
    { status: "generated" }
  >["value"]["provenance"];
  binding: Readonly<{
    floorResultId: string;
    floorAuthorityKey: string | null;
    floorObservationSource: "FULLY_TILED";
  }>;
}>;

type ExecutionCounts = Readonly<{
  emptyGeneration: 0 | 1;
  fullyTiledGeneration: 0 | 1;
  floorOnlyTiledGeneration: 0;
  fullyTiledFloorReader: 0 | 1;
  roomObserver: 0 | 1;
}>;

type PipelineEvidence = Readonly<{
  emptyImageUrl: string | null;
  fullyTiled: FullyTiledSummary | null;
  liveGeneratedRepresentations: readonly ["EMPTY", "FULLY_TILED"];
  executionCounts: ExecutionCounts;
}>;

export type AfcV2S3AnalyzeResult =
  | Readonly<
    PipelineEvidence & {
      status: "failed";
      stage:
        | "original_empty_preparation"
        | "fully_tiled_generation"
        | "floor_camera";
      reason: string;
      floorCameraApplied: false;
      product: AfcV2FullyTiledFloorProduct | null;
      roomObservation: null;
      roomObservationDiagnostic: null;
    }
  >
  | Readonly<
      Omit<AppliedFloorResult, "status"> & PipelineEvidence & {
        status: "partial";
        stage: "room_observation";
        reason: string;
        floorCameraApplied: true;
        fullyTiled: FullyTiledSummary;
        roomObservation: null;
        roomObservationDiagnostic: RoomObservationFailureDiagnostic;
      }
    >
  | Readonly<
      AppliedFloorResult & PipelineEvidence & {
        floorCameraApplied: true;
        fullyTiled: FullyTiledSummary;
        roomObservation: Extract<
          RoomObservationResult,
          { status: "observed" }
        >["contract"];
      }
    >;

export type AfcV2S3AnalysisDependencies = Readonly<{
  prepareFloorInputs?: (
    input: AfcV2AnalyzeInput,
    resultId: string,
  ) => Promise<
    | Readonly<{ status: "prepared"; value: PreparedAfcV2FloorInputs }>
    | Readonly<{ status: "failed"; reason: string }>
  >;
  generateFullyTiled?: (
    input: FullyTiledGenerationInput,
  ) => Promise<FullyTiledGenerationResult>;
  executeFloorAnalysis?: (
    input: AfcV2AnalyzeInput,
    prepared: PreparedAfcV2FloorInputs,
    generation: Extract<
      FullyTiledGenerationResult,
      { status: "generated" }
    >["value"],
  ) => Promise<AfcV2FullyTiledFloorAnalyzeResult>;
  observeRoom?: typeof observeFullyTiledRoomEnvelope;
  createResultId?: () => string;
}>;

/**
 * Retired S3B reference pipeline. The live V2 analyze route no longer calls
 * this FULLY_TILED experiment; it remains executable for historical receipts
 * and regression coverage only.
 */
export async function executeAfcV2S3Analysis(
  input: AfcV2AnalyzeInput,
  dependencies: AfcV2S3AnalysisDependencies = {},
): Promise<AfcV2S3AnalyzeResult> {
  const resultId = (dependencies.createResultId ?? randomUUID)();
  const baseCounts: ExecutionCounts = Object.freeze({
    emptyGeneration: 0,
    fullyTiledGeneration: 0,
    floorOnlyTiledGeneration: 0,
    fullyTiledFloorReader: 0,
    roomObserver: 0,
  });
  const liveGeneratedRepresentations =
    Object.freeze(["EMPTY", "FULLY_TILED"] as const);
  const prepared = await (
    dependencies.prepareFloorInputs ?? prepareAfcV2OriginalAndEmpty
  )(input, resultId);
  if (prepared.status !== "prepared") {
    return {
      status: "failed",
      stage: "original_empty_preparation",
      reason: prepared.reason,
      floorCameraApplied: false,
      product: null,
      emptyImageUrl: null,
      fullyTiled: null,
      roomObservation: null,
      roomObservationDiagnostic: null,
      liveGeneratedRepresentations,
      executionCounts: baseCounts,
    };
  }
  const emptyImageUrl =
    `/api/admin/3d-room-lab-v2/attempt-empty?attemptId=${encodeURIComponent(input.attemptId)}`;
  const afterEmptyCounts: ExecutionCounts = Object.freeze({
    ...baseCounts,
    emptyGeneration: prepared.value.empty.generated ? 1 : 0,
  });

  const generated = await (
    dependencies.generateFullyTiled ?? generateFullyTiledFromOriginal
  )({
    sourceImageUrl: input.sourceImageUrl,
    sourceImageIdentity: input.sourceImageIdentity,
  });
  if (generated.status !== "generated") {
    return {
      status: "failed",
      stage: "fully_tiled_generation",
      reason: generated.reason,
      floorCameraApplied: false,
      product: null,
      emptyImageUrl,
      fullyTiled: null,
      roomObservation: null,
      roomObservationDiagnostic: null,
      liveGeneratedRepresentations,
      executionCounts: afterEmptyCounts,
    };
  }

  let binding = Object.freeze({
    floorResultId: resultId,
    floorAuthorityKey: null as string | null,
    floorObservationSource: "FULLY_TILED" as const,
  });
  let fullyTiled: FullyTiledSummary = Object.freeze({
    imageUrl:
      `/api/admin/3d-room-lab-v2/attempt-fully-tiled?attemptId=${encodeURIComponent(input.attemptId)}&resultId=${encodeURIComponent(resultId)}`,
    identity: generated.value.identity,
    provenance: generated.value.provenance,
    binding,
  });
  retainFullyTiledEvidence(
    input.attemptId,
    resultId,
    generated.value,
    binding,
  );
  const afterGenerationCounts: ExecutionCounts = Object.freeze({
    ...afterEmptyCounts,
    fullyTiledGeneration: 1,
  });

  const floorResult = await (
    dependencies.executeFloorAnalysis ?? executeAfcV2FullyTiledFloorAnalysis
  )(input, prepared.value, generated.value);
  if (floorResult.status !== "applied") {
    return {
      status: "failed",
      stage: "floor_camera",
      reason: floorResult.reason,
      floorCameraApplied: false,
      product: floorResult.product,
      emptyImageUrl,
      fullyTiled,
      roomObservation: null,
      roomObservationDiagnostic: null,
      liveGeneratedRepresentations,
      executionCounts: Object.freeze({
        ...afterGenerationCounts,
        fullyTiledFloorReader: 1,
      }),
    };
  }
  binding = Object.freeze({
    floorResultId: floorResult.product.resultId,
    floorAuthorityKey: floorResult.floor.authorityKey,
    floorObservationSource: "FULLY_TILED" as const,
  });
  fullyTiled = Object.freeze({
    ...fullyTiled,
    binding,
  });
  retainFullyTiledEvidence(
    input.attemptId,
    resultId,
    generated.value,
    binding,
  );

  const observed = await (
    dependencies.observeRoom ?? observeFullyTiledRoomEnvelope
  )({
    attemptId: input.attemptId,
    floorResultId: floorResult.product.resultId,
    generation: generated.value,
    floor: Object.freeze({
      ...floorResult.floor,
      observationSource: "FULLY_TILED" as const,
    }),
    camera: floorResult.camera,
  });
  if (observed.status !== "observed") {
    return {
      product: floorResult.product,
      floor: floorResult.floor,
      camera: floorResult.camera,
      analysisMode: floorResult.analysisMode,
      freezeReceipt: floorResult.freezeReceipt,
      status: "partial",
      stage: "room_observation",
      reason: observed.reason,
      floorCameraApplied: true,
      fullyTiled,
      roomObservation: null,
      roomObservationDiagnostic: observed.diagnostic,
      emptyImageUrl,
      liveGeneratedRepresentations,
      executionCounts: Object.freeze({
        ...afterGenerationCounts,
        fullyTiledFloorReader: 1,
        roomObserver: 1,
      }),
    };
  }

  return Object.freeze({
    ...floorResult,
    floorCameraApplied: true,
    emptyImageUrl,
    fullyTiled,
    roomObservation: observed.contract,
    liveGeneratedRepresentations,
    executionCounts: Object.freeze({
      ...afterGenerationCounts,
      fullyTiledFloorReader: 1,
      roomObserver: 1,
    }),
  });
}
