import type { AfcSr1LiveBasis } from "@/app/admin/3d-room-lab/afc-sr1-live-product-contract";
import type { AfcSr1GeneratedTiledArtifact } from "@/app/admin/3d-room-lab/afc-sr1-tiled-artifact-cache";
import { durableArtifactBytesMatch } from "./production-artifact-integrity";
import type { AfcV2ProductionRoomAuthority } from "./production-authority-contract";

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
  productionAuthority: AfcV2ProductionRoomAuthority | null;
  diagnosticPayload: unknown;
  failureReason: string | null;
  metricStatus: string | null;
  collisionStatus: string | null;
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
  productionAuthority?: AfcV2ProductionRoomAuthority | null;
  diagnosticPayload?: unknown;
  failureReason?: string | null;
  metricStatus?: string | null;
  collisionStatus?: string | null;
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
    providerProvenance: Object.freeze({ ...record.providerProvenance }),
  });
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
        productionAuthority: null,
        diagnosticPayload: null,
        failureReason: null,
        metricStatus: null,
        collisionStatus: null,
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
      if (existing.status === "ready") {
        if (
          patch.productionAuthority !== undefined &&
          patch.productionAuthority !== existing.productionAuthority
        ) {
          throw new AfcGenerationImmutabilityError(
            "AFC generation authority is immutable once ready",
          );
        }
        if (
          (patch.original && patch.original.sha256 !== existing.original?.sha256) ||
          (patch.empty && patch.empty.sha256 !== existing.empty?.sha256) ||
          (patch.tiled && patch.tiled.sha256 !== existing.tiled?.sha256) ||
          (patch.frame && (
            patch.frame.width !== existing.frame?.width ||
            patch.frame.height !== existing.frame?.height
          ))
        ) {
          throw new AfcGenerationImmutabilityError(
            "AFC generation authority is immutable once ready",
          );
        }
      }
      if (existing.status === "failed" && patch.status === "ready") {
        throw new AfcGenerationImmutabilityError(
          "AFC generation cannot be revived from failed to ready",
        );
      }
      const next: AfcGenerationRecord = Object.freeze({
        ...existing,
        ...patch,
        lineageSeq: existing.lineageSeq,
        original: patch.original !== undefined
          ? cloneIdentity(patch.original)
          : existing.original,
        empty: patch.empty !== undefined ? cloneIdentity(patch.empty) : existing.empty,
        tiled: patch.tiled !== undefined ? cloneIdentity(patch.tiled) : existing.tiled,
        frame: patch.frame !== undefined
          ? (patch.frame ? Object.freeze({ ...patch.frame }) : null)
          : existing.frame,
        providerProvenance: patch.providerProvenance
          ? Object.freeze({ ...patch.providerProvenance })
          : existing.providerProvenance,
      });
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
