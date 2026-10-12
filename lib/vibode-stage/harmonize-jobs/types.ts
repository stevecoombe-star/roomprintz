import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";
import type { HarmonizeExportCamera, HarmonizeExportObject } from "@/lib/vibode-stage/harmonize-export";
import type {
  HarmonizeMaterialCatalog,
  HarmonizeMaterialProvenance,
} from "@/lib/vibode-stage/harmonize-materials";

export type HarmonizeJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type HarmonizeMaterialDescriptor = Readonly<{
  objectId: string;
  primaryText: string | null;
  secondaryText: string | null;
  primaryProvenance: HarmonizeMaterialProvenance;
  secondaryProvenance: HarmonizeMaterialProvenance;
}>;

export type HarmonizeAcceptedSnapshot = Readonly<{
  generationId: string;
  roomScaleMultiplier: number;
  certifiedMetricScale: number;
  effectiveMetricScale: number;
  camera: HarmonizeExportCamera;
  objects: readonly HarmonizeExportObject[];
  unmountedObjectIds: readonly string[];
  uniformScales: readonly Readonly<{ objectId: string; uniformScale: number }>[];
  materials: readonly HarmonizeMaterialDescriptor[];
  prompt: string;
  backgroundSha256: string;
  compositeSha256: string;
  sourceVersionId: string;
  sceneSnapshotSha256: string;
}>;

export type HarmonizeJobInsert = Readonly<{
  userId: string;
  roomId: string;
  sourceVersionId: string;
  idempotencyKey: string;
  requestSha256: string;
  sceneSnapshotSha256: string;
  backgroundSha256: string;
  compositeSha256: string;
  promptSha256: string;
  promptVersion: string;
  assemblyVersion: string;
  afcGenerationId: string;
  snapshot: HarmonizeAcceptedSnapshot;
  compositePath: string;
  compositeByteLength: number;
  compositeWidth: number;
  compositeHeight: number;
  roomUserId: string;
  sourceUserId: string;
  sourceRoomId: string;
}>;

export type HarmonizeJobRow = {
  id: string;
  userId: string;
  roomId: string;
  sourceVersionId: string | null;
  idempotencyKey: string;
  kind: "initial";
  status: HarmonizeJobStatus;
  requestSha256: string;
  sceneSnapshotSha256: string;
  backgroundSha256: string;
  compositeSha256: string;
  promptSha256: string;
  promptVersion: string;
  assemblyVersion: string;
  afcGenerationId: string;
  snapshot: HarmonizeAcceptedSnapshot;
  compositeBucket: string;
  compositePath: string;
  promptPath: string | null;
  compositeByteLength: number;
  compositeWidth: number;
  compositeHeight: number;
  outputBucket: string | null;
  outputPath: string | null;
  outputSha256: string | null;
  outputMime: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  provider: string;
  requestedModelId: string;
  returnedModelId: string | null;
  providerStartedAtMs: number | null;
  providerAttemptId: string | null;
  claimNonce: string | null;
  claimExpiresAtMs: number | null;
  claimedAtMs: number | null;
  heartbeatAtMs: number | null;
  attemptCount: number;
  failureCode: string | null;
  failureMessage: string | null;
  providerStatus: string | null;
  providerHttpStatus: number | null;
  latencyMs: number | null;
  notBeforeMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs: number | null;
};

export type HarmonizeTrustedCamera = Readonly<{
  verticalFovDeg: number;
  frame: Readonly<{ width: number; height: number }>;
  pose: HarmonizeExportCamera["pose"];
}>;

export type HarmonizeTrustedRoom = Readonly<{
  userId: string;
  currentAfcGenerationId: string;
  roomScaleMultiplier: number;
  certifiedMetricScale: number;
  camera: HarmonizeTrustedCamera;
  sourceUserId: string;
  sourceRoomId: string;
  background: Uint8Array;
  scene: Readonly<{
    afcGenerationId: string;
    objects: readonly SceneObjectDefinition[];
  }>;
  catalog: HarmonizeMaterialCatalog;
}>;

export type HarmonizeTrustedLoad =
  | Readonly<{ ok: true; room: HarmonizeTrustedRoom }>
  | Readonly<{
      ok: false;
      code:
        | "not_found"
        | "source_version_not_found"
        | "scene_missing"
        | "authority_unavailable"
        | "catalog_unavailable"
        | "source_unreadable"
        | "stale_scene";
    }>;

export type HarmonizeJobStatusView = Readonly<{
  id: string;
  status: HarmonizeJobStatus;
  failureCode: string | null;
  failureMessage: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  outputMime: string | null;
  outputSha256: string | null;
  providerStartedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  requestedModel: string;
  returnedModel: string | null;
  latencyMs: number | null;
  providerHttpStatus: number | null;
  providerStatus: string | null;
}>;
