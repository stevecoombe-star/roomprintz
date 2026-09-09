import "server-only";

import { randomUUID } from "node:crypto";

import {
  resolveAfcSr1LiveEmptyDefault,
  type AfcSr1ResolvedEmpty,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product";
import type { AfcSr1LiveBasis } from "@/app/admin/3d-room-lab/afc-sr1-live-product-contract";
import {
  buildAfcSr1TiledArtifactCacheKey,
  type AfcSr1GeneratedTiledArtifact,
} from "@/app/admin/3d-room-lab/afc-sr1-tiled-artifact-cache";
import { vibodeTileGridScaffoldAssist } from "@/app/admin/3d-room-lab/research/afc-sr1-tile-grid-scaffold";
import {
  AFC_V2_REFERENCE_DEPTH_M,
  executeAfcV2Analysis,
  type AfcV2AnalysisDependencies,
  type AfcV2AnalyzeResult,
} from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import { selectActiveRuntimeCollisionWalls } from "@/app/admin/3d-room-lab-v2/room-envelope-collision-authority-contract";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";

import { durableArtifactBytesMatch, sha256Hex } from "./production-artifact-integrity";
import { deriveProductionAutoMetric } from "./production-auto-metric";
import {
  buildAfcV2ProductionRoomAuthority,
  type AfcV2ProductionRoomAuthority,
} from "./production-authority-contract";
import { isProductionOriginalSourceUrl } from "./production-original";
import { assertProductionPayloadPrivacy } from "./privacy";
import {
  AFC_V2_PRODUCTION_STORAGE_BUCKET,
  afcGenerationStoragePrefix,
  type AfcArtifactSource,
  type AfcGenerationIntent,
  type AfcGenerationRecord,
  type AfcProductionStore,
  type AfcStoredImageIdentity,
} from "./production-store";

export type ProductionAfcIntent = AfcGenerationIntent;

export type ProductionOriginalInput = Readonly<{
  bytes: Uint8Array;
  identity?: AfcStoredImageIdentity;
  sourceImageUrl?: string;
}>;

export type RunProductionAfcAnalysisInput = Readonly<{
  roomId: string;
  userId: string;
  intent?: ProductionAfcIntent;
  store: AfcProductionStore;
  original: ProductionOriginalInput;
  analysisDependencies?: AfcV2AnalysisDependencies;
  analyze?: typeof executeAfcV2Analysis;
}>;

export type RestoreProductionAfcInput = Readonly<{
  roomId: string;
  userId: string;
  store: AfcProductionStore;
}>;

export type ProductionAfcPublicResponse = Readonly<{
  status: "ready" | "failed" | "none";
  generationId: string | null;
  currentGenerationId: string | null;
  authority: AfcV2ProductionRoomAuthority | null;
  failureReason: string | null;
  frame: Readonly<{ width: number; height: number }> | null;
}>;

type ArtifactCapture = {
  empty: AfcSr1ResolvedEmpty | null;
  emptySource: AfcArtifactSource | null;
  emptyStoragePath: string | null;
  tiled: AfcSr1GeneratedTiledArtifact | null;
  tiledBytes: Uint8Array | null;
  tiledSource: AfcArtifactSource | null;
  tiledCacheKey: string | null;
};

function detectMime(bytes: Uint8Array): AfcSr1LiveBasis["mimeType"] | null {
  const buffer = Buffer.from(bytes);
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "application/json") return "json";
  return "png";
}

function publicResponse(input: ProductionAfcPublicResponse): ProductionAfcPublicResponse {
  const payload = Object.freeze({
    status: input.status,
    generationId: input.generationId,
    currentGenerationId: input.currentGenerationId,
    authority: input.authority,
    failureReason: input.failureReason,
    frame: input.frame ? Object.freeze({ ...input.frame }) : null,
  });
  assertProductionPayloadPrivacy(payload);
  return payload;
}

async function resolveOriginalIdentity(
  original: ProductionOriginalInput,
): Promise<AfcStoredImageIdentity> {
  const bytes = original.bytes;
  const digest = sha256Hex(bytes);
  if (original.identity) {
    if (original.identity.sha256 !== digest) {
      throw new Error("ORIGINAL identity sha256 does not match supplied bytes");
    }
    if (original.identity.orientation !== 1) {
      throw new Error("ORIGINAL orientation must be 1");
    }
    return Object.freeze({ ...original.identity, sha256: digest });
  }
  const mime = detectMime(bytes);
  const metadata = await inspectImageMetadata(Buffer.from(bytes));
  if (!mime || !metadata.ok || metadata.orientation !== 1) {
    throw new Error("ORIGINAL could not be decoded as a certified AFC image");
  }
  return Object.freeze({
    sha256: digest,
    byteCount: bytes.byteLength,
    decodedWidth: metadata.width,
    decodedHeight: metadata.height,
    mimeType: mime,
    orientation: 1 as const,
  });
}

function lineageFromBasis(basis: AfcSr1LiveBasis) {
  return Object.freeze({
    sha256: basis.sha256,
    decodedWidth: basis.decodedWidth,
    decodedHeight: basis.decodedHeight,
    orientation: 1 as const,
  });
}

function currentAuthorityFromGeneration(
  generation: AfcGenerationRecord | null,
): AfcV2ProductionRoomAuthority | null {
  return generation?.status === "ready" ? generation.productionAuthority : null;
}

export async function restoreProductionAfcRoom(
  input: RestoreProductionAfcInput,
): Promise<ProductionAfcPublicResponse> {
  const room = await input.store.getRoom(input.roomId);
  if (!room || room.userId !== input.userId) {
    return publicResponse({
      status: "none",
      generationId: null,
      currentGenerationId: null,
      authority: null,
      failureReason: "Room not found.",
      frame: null,
    });
  }
  const currentId = room.currentAfcGenerationId;
  if (!currentId) {
    return publicResponse({
      status: "none",
      generationId: null,
      currentGenerationId: null,
      authority: null,
      failureReason: null,
      frame: null,
    });
  }
  const generation = await input.store.getGeneration(currentId);
  if (
    !generation ||
    generation.userId !== input.userId ||
    generation.roomId !== input.roomId ||
    generation.status !== "ready" ||
    !generation.productionAuthority
  ) {
    return publicResponse({
      status: "none",
      generationId: null,
      currentGenerationId: currentId,
      authority: null,
      failureReason: "Persisted AFC generation is not production-ready.",
      frame: generation?.frame ?? null,
    });
  }
  return publicResponse({
    status: "ready",
    generationId: generation.id,
    currentGenerationId: generation.id,
    authority: generation.productionAuthority,
    failureReason: null,
    frame: generation.frame,
  });
}

export async function runProductionAfcAnalysis(
  input: RunProductionAfcAnalysisInput,
): Promise<ProductionAfcPublicResponse> {
  const room = await input.store.getRoom(input.roomId);
  if (!room || room.userId !== input.userId) {
    return publicResponse({
      status: "failed",
      generationId: null,
      currentGenerationId: null,
      authority: null,
      failureReason: "Room not found.",
      frame: null,
    });
  }

  const parentId = room.currentAfcGenerationId;
  const parent = parentId ? await input.store.getGeneration(parentId) : null;
  const parentAuthority = currentAuthorityFromGeneration(parent);
  const sourceImageUrl = input.original.sourceImageUrl?.trim() ?? "";
  if (!isProductionOriginalSourceUrl(sourceImageUrl)) {
    return publicResponse({
      status: "failed",
      generationId: null,
      currentGenerationId: parentId,
      authority: parentAuthority,
      failureReason: "ORIGINAL image is unavailable.",
      frame: null,
    });
  }
  const intent: ProductionAfcIntent = input.intent ??
    (parentId ? "run_again" : "analyze");
  const forceTiledRegeneration = intent === "reread_perspective";
  const originalIdentity = await resolveOriginalIdentity(input.original);
  const frame = Object.freeze({
    width: originalIdentity.decodedWidth,
    height: originalIdentity.decodedHeight,
  });
  const generation = await input.store.createGeneration({
    roomId: input.roomId,
    userId: input.userId,
    parentGenerationId: parentId,
    runId: randomUUID(),
    intent,
    tiledForceRegeneration: forceTiledRegeneration,
  });
  const prefix = afcGenerationStoragePrefix({
    userId: input.userId,
    roomId: input.roomId,
    generationId: generation.id,
  });
  const capture: ArtifactCapture = {
    empty: null,
    emptySource: null,
    emptyStoragePath: null,
    tiled: null,
    tiledBytes: null,
    tiledSource: null,
    tiledCacheKey: null,
  };
  const innerResolveEmpty = input.analysisDependencies?.product?.resolveEmpty ??
    resolveAfcSr1LiveEmptyDefault;
  const innerGenerateTiled = input.analysisDependencies?.product?.generateTiled ??
    vibodeTileGridScaffoldAssist;
  const analyze = input.analyze ?? executeAfcV2Analysis;

  await input.store.updateGeneration(generation.id, {
    original: originalIdentity,
    frame,
  });

  let analysis: AfcV2AnalyzeResult;
  try {
    analysis = await analyze({
      attemptId: `afcv2-${generation.id}`,
      sourceImageUrl,
      sourceImageIdentity: {
        sha256: originalIdentity.sha256,
        decodedWidth: originalIdentity.decodedWidth,
        decodedHeight: originalIdentity.decodedHeight,
        orientation: 1,
      },
      loadGeneration: 0,
      frame,
      referenceDepthM: AFC_V2_REFERENCE_DEPTH_M,
      forceTiledRegeneration,
    }, {
      ...input.analysisDependencies,
      product: {
        ...input.analysisDependencies?.product,
        qualifyOriginal: async () => Object.freeze({
          sourceImageUrl,
          basis: originalIdentity,
        }),
        resolveEmpty: async (original) => {
          const durable = await input.store.lookupDurableEmpty(
            input.userId,
            original.basis.sha256,
          );
          if (
            durable &&
            durableArtifactBytesMatch({
              bytes: durable.bytes,
              sha256: durable.basis.sha256,
              byteCount: durable.basis.byteCount,
            })
          ) {
            capture.emptySource = "durable";
            capture.empty = Object.freeze({
              basis: durable.basis,
              bytes: durable.bytes,
              generated: false,
            });
            return capture.empty;
          }
          const resolved = await innerResolveEmpty(original);
          if (!resolved) return null;
          capture.emptySource = "generated";
          capture.empty = resolved;
          const stored = await persistImageArtifact({
            store: input.store,
            prefix,
            name: "empty",
            identity: resolved.basis,
            bytes: resolved.bytes,
          });
          capture.emptyStoragePath = stored.path;
          return resolved;
        },
        generateTiled: async (args) => {
          const cacheKey = buildAfcSr1TiledArtifactCacheKey({
            emptySha256: args.empty.identity.sha256,
          });
          capture.tiledCacheKey = cacheKey;
          if (!forceTiledRegeneration) {
            const durable = await input.store.lookupDurableTiled(
              input.userId,
              cacheKey,
            );
            if (
              durable &&
              durable.emptySha256 === args.empty.identity.sha256 &&
              durableArtifactBytesMatch({
                bytes: durable.bytes,
                sha256: durable.result.tiled.identity.sha256,
                byteCount: durable.result.tiled.identity.byteCount,
              })
            ) {
              capture.tiledSource = "durable";
              capture.tiled = durable.result;
              capture.tiledBytes = durable.bytes;
              return durable.result;
            }
          }
          const result = await innerGenerateTiled(args);
          if (result.status === "generated") {
            capture.tiledSource = "generated";
            capture.tiled = result;
            capture.tiledBytes = Uint8Array.from(
              Buffer.from(result.tiled.base64, "base64"),
            );
          }
          return result;
        },
        useTiledArtifactCache: false,
      },
      registrationRasters: {
        originalBytes: input.original.bytes,
        get emptyBytes() {
          return capture.empty?.bytes ?? new Uint8Array();
        },
      },
    });
  } catch (error) {
    await persistFailedGeneration({
      store: input.store,
      generationId: generation.id,
      prefix,
      capture,
      originalIdentity,
      frame,
      forceTiledRegeneration,
      reason: error instanceof Error ? error.message : "AFC analysis failed.",
      analysis: null,
    });
    return publicResponse({
      status: "failed",
      generationId: generation.id,
      currentGenerationId: parentId,
      authority: parentAuthority,
      failureReason: "AFC analysis failed.",
      frame,
    });
  }

  if (analysis.status !== "applied") {
    await persistFailedGeneration({
      store: input.store,
      generationId: generation.id,
      prefix,
      capture,
      originalIdentity,
      frame,
      forceTiledRegeneration,
      reason: analysis.reason,
      analysis,
    });
    return publicResponse({
      status: "failed",
      generationId: generation.id,
      currentGenerationId: parentId,
      authority: parentAuthority,
      failureReason: analysis.reason,
      frame,
    });
  }

  const empty = capture.empty;
  const tiled = capture.tiled;
  if (!empty || !tiled || !capture.tiledCacheKey || !capture.emptySource ||
    !capture.tiledSource) {
    await persistFailedGeneration({
      store: input.store,
      generationId: generation.id,
      prefix,
      capture,
      originalIdentity,
      frame,
      forceTiledRegeneration,
      reason: "Production AFC artifacts were incomplete after analysis.",
      analysis,
    });
    return publicResponse({
      status: "failed",
      generationId: generation.id,
      currentGenerationId: parentId,
      authority: parentAuthority,
      failureReason: "Production AFC artifacts were incomplete after analysis.",
      frame,
    });
  }

  const emptyStored = capture.emptyStoragePath
    ? { path: capture.emptyStoragePath }
    : await persistImageArtifact({
      store: input.store,
      prefix,
      name: "empty",
      identity: empty.basis,
      bytes: empty.bytes,
    });
  const tiledStored = await persistImageArtifact({
    store: input.store,
    prefix,
    name: "tiled",
    identity: tiled.tiled.identity,
    bytes: capture.tiledBytes ?? Buffer.from(tiled.tiled.base64, "base64"),
  });

  const autoMetric = deriveProductionAutoMetric(analysis);
  const collisionSelection = selectActiveRuntimeCollisionWalls({
    emptyAuthoritativeCollision: analysis.emptyAuthoritativeCollision,
    originalLocalizedCollision: analysis.originalLocalizedCollision,
    envelopeCollision: analysis.roomEnvelopeCollision,
    roomCollision: analysis.roomCollision,
  });
  const authority = buildAfcV2ProductionRoomAuthority({
    generationId: generation.id,
    runId: generation.runId,
    createdAt: generation.createdAt,
    original: lineageFromBasis(originalIdentity),
    empty: lineageFromBasis(empty.basis),
    tiled: lineageFromBasis(tiled.tiled.identity),
    emptyArtifactSource: capture.emptySource,
    tiledArtifactSource: capture.tiledSource,
    tiledCacheKey: capture.tiledCacheKey,
    tiledForceRegeneration: forceTiledRegeneration,
    readerVersion: analysis.tiled?.floorReaderContract.readerVersion ?? null,
    frame,
    analysis,
    autoMetric,
    collision: {
      source: collisionSelection.source,
      collisionAuthority: collisionSelection.walls.length > 0,
      walls: collisionSelection.walls,
    },
  });
  assertProductionPayloadPrivacy(authority);

  if (capture.emptySource === "generated") {
    await input.store.publishDurableEmpty({
      userId: input.userId,
      originalSha256: originalIdentity.sha256,
      basis: empty.basis,
      bytes: empty.bytes,
      storageBucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
      storagePath: emptyStored.path,
      sourceGenerationId: generation.id,
    });
  }
  if (capture.tiledSource === "generated" && capture.tiledBytes) {
    await input.store.publishDurableTiled({
      userId: input.userId,
      cacheKey: capture.tiledCacheKey,
      emptySha256: empty.basis.sha256,
      result: tiled,
      bytes: capture.tiledBytes,
      storageBucket: AFC_V2_PRODUCTION_STORAGE_BUCKET,
      storagePath: tiledStored.path,
      sourceGenerationId: generation.id,
    });
  }

  await persistAdminReceipt({
    store: input.store,
    prefix,
    payload: compactDiagnostic(analysis, capture, forceTiledRegeneration),
  });

  await input.store.updateGeneration(generation.id, {
    status: "ready",
    completedAt: new Date().toISOString(),
    original: originalIdentity,
    empty: empty.basis,
    tiled: tiled.tiled.identity,
    emptyArtifactSource: capture.emptySource,
    tiledArtifactSource: capture.tiledSource,
    emptyStoragePath: emptyStored.path,
    tiledStoragePath: tiledStored.path,
    tiledCacheKey: capture.tiledCacheKey,
    frame,
    productionAuthority: authority,
    diagnosticPayload: compactDiagnostic(
      analysis,
      capture,
      forceTiledRegeneration,
    ),
    failureReason: null,
    metricStatus: autoMetric.path,
    collisionStatus: collisionSelection.source,
    providerProvenance: Object.freeze({
      emptyArtifactSource: capture.emptySource,
      tiledArtifactSource: capture.tiledSource,
      tiledForceRegeneration: forceTiledRegeneration,
      readerRerun: true,
    }),
  });
  const currentGenerationId = await input.store.activateGeneration({
    roomId: input.roomId,
    userId: input.userId,
    generationId: generation.id,
  });
  const currentGeneration = currentGenerationId === generation.id
    ? null
    : await input.store.getGeneration(currentGenerationId);
  const currentAuthority = currentGenerationId === generation.id
    ? authority
    : currentAuthorityFromGeneration(currentGeneration) ?? authority;
  const currentFrame = currentGenerationId === generation.id
    ? frame
    : currentGeneration?.frame ?? frame;

  return publicResponse({
    status: "ready",
    generationId: generation.id,
    currentGenerationId,
    authority: currentAuthority,
    failureReason: null,
    frame: currentFrame,
  });
}

async function persistImageArtifact(input: Readonly<{
  store: AfcProductionStore;
  prefix: string;
  name: "empty" | "tiled";
  identity: AfcSr1LiveBasis;
  bytes: Uint8Array;
}>) {
  const path = `${input.prefix}/${input.name}.${extensionForMime(input.identity.mimeType)}`;
  return input.store.putArtifact({
    path,
    bytes: input.bytes,
    contentType: input.identity.mimeType,
  });
}

async function persistAdminReceipt(input: Readonly<{
  store: AfcProductionStore;
  prefix: string;
  payload: unknown;
}>) {
  const bytes = new TextEncoder().encode(JSON.stringify(input.payload));
  await input.store.putArtifact({
    path: `${input.prefix}/admin/receipts/generation.json`,
    bytes,
    contentType: "application/json",
  });
}

function compactDiagnostic(
  analysis: AfcV2AnalyzeResult | null,
  capture: ArtifactCapture,
  forceTiledRegeneration: boolean,
) {
  return Object.freeze({
    analysisStatus: analysis?.status ?? "failed",
    reason: analysis && analysis.status === "failed" ? analysis.reason : null,
    emptyArtifactSource: capture.emptySource,
    tiledArtifactSource: capture.tiledSource,
    tiledForceRegeneration: forceTiledRegeneration,
    engineEmptyArtifactSource: analysis?.emptyArtifactSource ?? null,
    engineTiledArtifactSource: analysis?.tiledArtifactSource ?? null,
    executionCounts: analysis?.executionCounts ?? null,
  });
}

async function persistFailedGeneration(input: Readonly<{
  store: AfcProductionStore;
  generationId: string;
  prefix: string;
  capture: ArtifactCapture;
  originalIdentity: AfcStoredImageIdentity;
  frame: Readonly<{ width: number; height: number }>;
  forceTiledRegeneration: boolean;
  reason: string;
  analysis: AfcV2AnalyzeResult | null;
}>) {
  let emptyStoragePath: string | null = input.capture.emptyStoragePath;
  let tiledStoragePath: string | null = null;
  if (input.capture.empty && !emptyStoragePath) {
    const stored = await persistImageArtifact({
      store: input.store,
      prefix: input.prefix,
      name: "empty",
      identity: input.capture.empty.basis,
      bytes: input.capture.empty.bytes,
    });
    emptyStoragePath = stored.path;
  }
  if (input.capture.tiled && input.capture.tiledBytes) {
    const stored = await persistImageArtifact({
      store: input.store,
      prefix: input.prefix,
      name: "tiled",
      identity: input.capture.tiled.tiled.identity,
      bytes: input.capture.tiledBytes,
    });
    tiledStoragePath = stored.path;
  }
  await persistAdminReceipt({
    store: input.store,
    prefix: input.prefix,
    payload: compactDiagnostic(
      input.analysis,
      input.capture,
      input.forceTiledRegeneration,
    ),
  });
  await input.store.updateGeneration(input.generationId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    original: input.originalIdentity,
    empty: input.capture.empty?.basis ?? null,
    tiled: input.capture.tiled?.tiled.identity ?? null,
    emptyArtifactSource: input.capture.emptySource,
    tiledArtifactSource: input.capture.tiledSource,
    emptyStoragePath,
    tiledStoragePath,
    tiledCacheKey: input.capture.tiledCacheKey,
    frame: input.frame,
    productionAuthority: null,
    diagnosticPayload: compactDiagnostic(
      input.analysis,
      input.capture,
      input.forceTiledRegeneration,
    ),
    failureReason: input.reason,
    metricStatus: "none",
    collisionStatus: "none",
    providerProvenance: Object.freeze({
      emptyArtifactSource: input.capture.emptySource,
      tiledArtifactSource: input.capture.tiledSource,
      tiledForceRegeneration: input.forceTiledRegeneration,
      readerRerun: true,
    }),
  });
}
