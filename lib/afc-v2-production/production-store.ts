import type { AfcSr1LiveBasis } from "@/app/admin/3d-room-lab/afc-sr1-live-product-contract";
import type { AfcSr1GeneratedTiledArtifact } from "@/app/admin/3d-room-lab/afc-sr1-tiled-artifact-cache";
import {
  buildAfcV2EngineFingerprint,
  cloneAfcV2EngineFingerprint,
  type AfcV2EngineFingerprintV1,
} from "./engine-fingerprint";
import { durableArtifactBytesMatch } from "./production-artifact-integrity";
import type { AfcV2ProductionRoomAuthority } from "./production-authority-contract";
import type { AfcV2MetricDecisionPersistedValue } from "./metric-decision-diagnostic";

export const AFC_V2_ORIGINAL_STORAGE_BUCKET = "vibode-base-images";
export const AFC_V2_PRODUCTION_STORAGE_BUCKET = "vibode-afc-v2";

export type AfcGenerationIntent =
  | "analyze"
  | "run_again"
  | "reread_perspective";

export type AfcGenerationStatus = "running" | "ready" | "failed";

export type AfcArtifactSource = "durable" | "generated";

export type AfcStoredImageIdentity = AfcSr1LiveBasis;

export type AfcRoomBaseAsset = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  storageBucket: string | null;
  storagePath: string | null;
}>;

export type AfcRoomPointer = Readonly<{
  id: string;
  userId: string;
  currentAfcGenerationId: string | null;
  baseStorageBucket: string | null;
  baseStoragePath: string | null;
  baseAsset: AfcRoomBaseAsset | null;
}>;

export type AfcGenerationRecord = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  parentGenerationId: string | null;
  lineageSeq: number;
  runId: string;
  intent: AfcGenerationIntent;
  status: AfcGenerationStatus;
  createdAt: string;
  completedAt: string | null;
  original: AfcStoredImageIdentity | null;
  empty: AfcStoredImageIdentity | null;
  tiled: AfcStoredImageIdentity | null;
  emptyArtifactSource: AfcArtifactSource | null;
  tiledArtifactSource: AfcArtifactSource | null;
  emptyStoragePath: string | null;
  tiledStoragePath: string | null;
  tiledCacheKey: string | null;
  tiledForceRegeneration: boolean;
  frame: Readonly<{ width: number; height: number }> | null;
  engineFingerprint: AfcV2EngineFingerprintV1 | null;
  productionAuthority: AfcV2ProductionRoomAuthority | null;
  diagnosticPayload: unknown;
  failureReason: string | null;
  metricStatus: string | null;
  collisionStatus: string | null;
  metricDecision: AfcV2MetricDecisionPersistedValue;
  providerProvenance: Readonly<Record<string, unknown>>;
}>;

export type DurableEmptyArtifact = Readonly<{
  userId: string;
  originalSha256: string;
  basis: AfcSr1LiveBasis;
  bytes: Uint8Array;
  storageBucket: string;
  storagePath: string;
  sourceGenerationId: string | null;
}>;

export type DurableTiledArtifact = Readonly<{
  userId: string;
  cacheKey: string;
  emptySha256: string;
  result: AfcSr1GeneratedTiledArtifact;
  bytes: Uint8Array;
  storageBucket: string;
  storagePath: string;
  sourceGenerationId: string | null;
}>;

export type CreateAfcGenerationInput = Readonly<{
  id?: string;
  roomId: string;
  userId: string;
  parentGenerationId: string | null;
  runId: string;
  intent: AfcGenerationIntent;
  tiledForceRegeneration: boolean;
}>;

export type UpdateAfcGenerationInput = Readonly<{
  status?: AfcGenerationStatus;
  completedAt?: string | null;
  original?: AfcStoredImageIdentity | null;
  empty?: AfcStoredImageIdentity | null;
  tiled?: AfcStoredImageIdentity | null;
  emptyArtifactSource?: AfcArtifactSource | null;
  tiledArtifactSource?: AfcArtifactSource | null;
  emptyStoragePath?: string | null;
  tiledStoragePath?: string | null;
  tiledCacheKey?: string | null;
  frame?: Readonly<{ width: number; height: number }> | null;
  engineFingerprint?: AfcV2EngineFingerprintV1 | null;
  productionAuthority?: AfcV2ProductionRoomAuthority | null;
  diagnosticPayload?: unknown;
  failureReason?: string | null;
  metricStatus?: string | null;
  collisionStatus?: string | null;
  metricDecision?: AfcV2MetricDecisionPersistedValue;
  providerProvenance?: Readonly<Record<string, unknown>>;
}>;

export class AfcGenerationImmutabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AfcGenerationImmutabilityError";
  }
}

export interface AfcProductionStore {
  getRoom(roomId: string): Promise<AfcRoomPointer | null>;
  createRoom?(room: AfcRoomPointer): Promise<void>;
  createGeneration(input: CreateAfcGenerationInput): Promise<AfcGenerationRecord>;
  updateGeneration(
    generationId: string,
    patch: UpdateAfcGenerationInput,
  ): Promise<AfcGenerationRecord>;
  getGeneration(generationId: string): Promise<AfcGenerationRecord | null>;
  activateGeneration(input: Readonly<{
    roomId: string;
    userId: string;
    generationId: string;
  }>): Promise<string>;
  lookupDurableEmpty(
    userId: string,
    originalSha256: string,
  ): Promise<DurableEmptyArtifact | null>;
  publishDurableEmpty(artifact: DurableEmptyArtifact): Promise<void>;
  lookupDurableTiled(
    userId: string,
    cacheKey: string,
  ): Promise<DurableTiledArtifact | null>;
  publishDurableTiled(artifact: DurableTiledArtifact): Promise<void>;
  putArtifact(input: Readonly<{
    path: string;
    bytes: Uint8Array;
    contentType: string;
  }>): Promise<Readonly<{ bucket: string; path: string }>>;
  getArtifact(path: string): Promise<Uint8Array | null>;
}

export interface MemoryAfcProductionStore extends AfcProductionStore {
  replaceDurableEmptyBytes(
    userId: string,
    originalSha256: string,
    bytes: Uint8Array,
  ): void;
  replaceDurableTiledBytes(
    userId: string,
    cacheKey: string,
    bytes: Uint8Array,
  ): void;
}

function cloneIdentity(
  identity: AfcSr1LiveBasis | null | undefined,
): AfcSr1LiveBasis | null {
  return identity ? Object.freeze({ ...identity }) : null;
}

function cloneRecord(record: AfcGenerationRecord): AfcGenerationRecord {
  return Object.freeze({
    ...record,
    original: cloneIdentity(record.original),
    empty: cloneIdentity(record.empty),
    tiled: cloneIdentity(record.tiled),
    frame: record.frame ? Object.freeze({ ...record.frame }) : null,
    engineFingerprint: record.engineFingerprint
      ? cloneAfcV2EngineFingerprint(record.engineFingerprint)
      : null,
    providerProvenance: Object.freeze({ ...record.providerProvenance }),
    metricDecision: cloneMetricDecision(record.metricDecision),
  });
}

function cloneMetricDecision(
  value: AfcV2MetricDecisionPersistedValue,
): AfcV2MetricDecisionPersistedValue {
  if (value === null) return null;
  return structuredClone(value);
}

function isTerminalStatus(status: AfcGenerationStatus): boolean {
  return status === "ready" || status === "failed";
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function identityFieldsEqual(
  existing: AfcGenerationRecord,
  next: AfcGenerationRecord,
): boolean {
  return existing.id === next.id
    && existing.roomId === next.roomId
    && existing.userId === next.userId
    && existing.parentGenerationId === next.parentGenerationId
    && existing.lineageSeq === next.lineageSeq
    && existing.runId === next.runId
    && existing.createdAt === next.createdAt;
}

function terminalEvidenceEqual(
  existing: AfcGenerationRecord,
  next: AfcGenerationRecord,
): boolean {
  return existing.status === next.status
    && existing.intent === next.intent
    && jsonEqual(existing.engineFingerprint, next.engineFingerprint)
    && jsonEqual(existing.productionAuthority, next.productionAuthority)
    && jsonEqual(existing.original, next.original)
    && jsonEqual(existing.empty, next.empty)
    && jsonEqual(existing.tiled, next.tiled)
    && existing.emptyArtifactSource === next.emptyArtifactSource
    && existing.tiledArtifactSource === next.tiledArtifactSource
    && existing.emptyStoragePath === next.emptyStoragePath
    && existing.tiledStoragePath === next.tiledStoragePath
    && existing.tiledCacheKey === next.tiledCacheKey
    && existing.tiledForceRegeneration === next.tiledForceRegeneration
    && jsonEqual(existing.frame, next.frame)
    && jsonEqual(existing.diagnosticPayload, next.diagnosticPayload)
    && existing.failureReason === next.failureReason
    && jsonEqual(existing.providerProvenance, next.providerProvenance)
    && existing.metricStatus === next.metricStatus
    && existing.collisionStatus === next.collisionStatus
    && jsonEqual(existing.metricDecision, next.metricDecision)
    && existing.completedAt === next.completedAt;
}

export function afcGenerationStoragePrefix(input: Readonly<{
  userId: string;
  roomId: string;
  generationId: string;
}>): string {
  return `users/${input.userId}/rooms/${input.roomId}/afc/${input.generationId}`;
}

export function createMemoryAfcProductionStore(
  rooms: readonly AfcRoomPointer[] = [],
): MemoryAfcProductionStore {
  const roomMap = new Map(rooms.map((room) => [room.id, { ...room }]));
  const generations = new Map<string, AfcGenerationRecord>();
  const durableEmpty = new Map<string, DurableEmptyArtifact>();
  const durableTiled = new Map<string, DurableTiledArtifact>();
  const artifacts = new Map<string, Uint8Array>();
  let nextLineageSeq = 1;

  function emptyKey(userId: string, originalSha256: string) {
    return `${userId}\u001f${originalSha256}`;
  }
  function tiledKey(userId: string, cacheKey: string) {
    return `${userId}\u001f${cacheKey}`;
  }

  return {
    async getRoom(roomId) {
      const room = roomMap.get(roomId);
      return room ? Object.freeze({ ...room }) : null;
    },
    async createRoom(room) {
      roomMap.set(room.id, { ...room });
    },
    async createGeneration(input) {
      const id = input.id ?? crypto.randomUUID();
      const record: AfcGenerationRecord = Object.freeze({
        id,
        roomId: input.roomId,
        userId: input.userId,
        parentGenerationId: input.parentGenerationId,
        lineageSeq: nextLineageSeq++,
        runId: input.runId,
        intent: input.intent,
        status: "running",
        createdAt: new Date().toISOString(),
        completedAt: null,
        original: null,
        empty: null,
        tiled: null,
        emptyArtifactSource: null,
        tiledArtifactSource: null,
        emptyStoragePath: null,
        tiledStoragePath: null,
        tiledCacheKey: null,
        tiledForceRegeneration: input.tiledForceRegeneration,
        frame: null,
        engineFingerprint: buildAfcV2EngineFingerprint(),
        productionAuthority: null,
        diagnosticPayload: null,
        failureReason: null,
        metricStatus: null,
        collisionStatus: null,
        metricDecision: null,
        providerProvenance: Object.freeze({}),
      });
      generations.set(id, record);
      return cloneRecord(record);
    },
    async updateGeneration(generationId, patch) {
      const existing = generations.get(generationId);
      if (!existing) {
        throw new Error(`AFC generation not found: ${generationId}`);
      }
      const next: AfcGenerationRecord = Object.freeze({
        ...existing,
        ...patch,
        id: existing.id,
        roomId: existing.roomId,
        userId: existing.userId,
        parentGenerationId: existing.parentGenerationId,
        lineageSeq: existing.lineageSeq,
        runId: existing.runId,
        createdAt: existing.createdAt,
        original: patch.original !== undefined
          ? cloneIdentity(patch.original)
          : existing.original,
        empty: patch.empty !== undefined ? cloneIdentity(patch.empty) : existing.empty,
        tiled: patch.tiled !== undefined ? cloneIdentity(patch.tiled) : existing.tiled,
        frame: patch.frame !== undefined
          ? (patch.frame ? Object.freeze({ ...patch.frame }) : null)
          : existing.frame,
        engineFingerprint: patch.engineFingerprint !== undefined
          ? (patch.engineFingerprint
            ? cloneAfcV2EngineFingerprint(patch.engineFingerprint)
            : null)
          : existing.engineFingerprint,
        providerProvenance: patch.providerProvenance
          ? Object.freeze({ ...patch.providerProvenance })
          : existing.providerProvenance,
        metricDecision: patch.metricDecision !== undefined
          ? cloneMetricDecision(patch.metricDecision)
          : existing.metricDecision,
      });
      if (!identityFieldsEqual(existing, next)) {
        throw new AfcGenerationImmutabilityError(
          "AFC generation identity is immutable",
        );
      }
      if (isTerminalStatus(existing.status)) {
        if (!terminalEvidenceEqual(existing, next)) {
          throw new AfcGenerationImmutabilityError(
            "AFC generation historical evidence is immutable once terminal",
          );
        }
      }
      generations.set(generationId, next);
      return cloneRecord(next);
    },
    async getGeneration(generationId) {
      const record = generations.get(generationId);
      return record ? cloneRecord(record) : null;
    },
    async activateGeneration(input) {
      const generation = generations.get(input.generationId);
      if (!generation) {
        throw new Error("AFC generation not found");
      }
      if (
        generation.roomId !== input.roomId ||
        generation.userId !== input.userId
      ) {
        throw new Error("AFC generation does not belong to room owner");
      }
      if (generation.status !== "ready" || !generation.productionAuthority) {
        throw new Error("AFC generation is not production-ready");
      }
      const room = roomMap.get(input.roomId);
      if (!room || room.userId !== input.userId) {
        throw new Error("AFC room pointer update failed");
      }
      const currentId = room.currentAfcGenerationId;
      if (!currentId || currentId === input.generationId) {
        roomMap.set(input.roomId, {
          ...room,
          currentAfcGenerationId: input.generationId,
        });
        return input.generationId;
      }
      const current = generations.get(currentId);
      if (!current || generation.lineageSeq > current.lineageSeq) {
        roomMap.set(input.roomId, {
          ...room,
          currentAfcGenerationId: input.generationId,
        });
        return input.generationId;
      }
      return currentId;
    },
    async lookupDurableEmpty(userId, originalSha256) {
      const found = durableEmpty.get(emptyKey(userId, originalSha256));
      if (!found) return null;
      if (
        !durableArtifactBytesMatch({
          bytes: found.bytes,
          sha256: found.basis.sha256,
          byteCount: found.basis.byteCount,
        })
      ) {
        return null;
      }
      return Object.freeze({
        ...found,
        bytes: Uint8Array.from(found.bytes),
        basis: Object.freeze({ ...found.basis }),
      });
    },
    async publishDurableEmpty(artifact) {
      durableEmpty.set(
        emptyKey(artifact.userId, artifact.originalSha256),
        Object.freeze({
          ...artifact,
          bytes: Uint8Array.from(artifact.bytes),
          basis: Object.freeze({ ...artifact.basis }),
        }),
      );
    },
    async lookupDurableTiled(userId, cacheKey) {
      const found = durableTiled.get(tiledKey(userId, cacheKey));
      if (!found) return null;
      if (
        !durableArtifactBytesMatch({
          bytes: found.bytes,
          sha256: found.result.tiled.identity.sha256,
          byteCount: found.result.tiled.identity.byteCount,
        })
      ) {
        return null;
      }
      return Object.freeze({
        ...found,
        bytes: Uint8Array.from(found.bytes),
        result: found.result,
      });
    },
    async publishDurableTiled(artifact) {
      durableTiled.set(
        tiledKey(artifact.userId, artifact.cacheKey),
        Object.freeze({
          ...artifact,
          bytes: Uint8Array.from(artifact.bytes),
        }),
      );
    },
    async putArtifact(input) {
      artifacts.set(input.path, Uint8Array.from(input.bytes));
      return Object.freeze({
        bucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
        path: input.path,
      });
    },
    async getArtifact(path) {
      const bytes = artifacts.get(path);
      return bytes ? Uint8Array.from(bytes) : null;
    },
    replaceDurableEmptyBytes(userId, originalSha256, bytes) {
      const found = durableEmpty.get(emptyKey(userId, originalSha256));
      if (!found) {
        throw new Error("durable EMPTY artifact is not published");
      }
      durableEmpty.set(
        emptyKey(userId, originalSha256),
        Object.freeze({
          ...found,
          bytes: Uint8Array.from(bytes),
        }),
      );
    },
    replaceDurableTiledBytes(userId, cacheKey, bytes) {
      const found = durableTiled.get(tiledKey(userId, cacheKey));
      if (!found) {
        throw new Error("durable TILED artifact is not published");
      }
      durableTiled.set(
        tiledKey(userId, cacheKey),
        Object.freeze({
          ...found,
          bytes: Uint8Array.from(bytes),
        }),
      );
    },
  };
}
