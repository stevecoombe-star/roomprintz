/**
 * Process-local TILED artifact cache for the certified S2A live-product path.
 *
 * This caches the NBP TILED raster and its generation provenance, not Reader
 * or Gemini interpretation. vibodeTileGridScaffoldAssist remains uncached so
 * TS0 / research sampling stays independently stochastic.
 */
import "server-only";

import { createHash } from "node:crypto";

import {
  AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
  type AfcSr1TileGridScaffoldArgs,
  type AfcSr1TileGridScaffoldResult,
} from "./research/afc-sr1-tile-grid-scaffold";

export const AFC_SR1_TILED_ARTIFACT_CACHE_MAX_ENTRIES = 8;

export type AfcSr1TiledArtifactCacheKeyInput = Readonly<{
  emptySha256: string;
  generatorId?: string;
  profileId?: string;
  researchPreset?: string;
  requestedModelId?: string;
}>;

export type AfcSr1TiledArtifactGenerate = (
  args: AfcSr1TileGridScaffoldArgs,
) => Promise<AfcSr1TileGridScaffoldResult>;

export type AfcSr1TiledArtifactCacheResolve = Readonly<{
  result: AfcSr1TileGridScaffoldResult;
  source: "cache" | "generated";
}>;

export type AfcSr1GeneratedTiledArtifact = Extract<
  AfcSr1TileGridScaffoldResult,
  { status: "generated" }
>;

type GeneratedTiledArtifact = AfcSr1GeneratedTiledArtifact;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const completedTiled = new Map<string, GeneratedTiledArtifact>();
const inFlightTiled = new Map<string, Promise<AfcSr1TileGridScaffoldResult>>();

export function buildAfcSr1TiledArtifactCacheKey(
  input: AfcSr1TiledArtifactCacheKeyInput,
): string {
  return [
    input.emptySha256,
    input.generatorId ?? AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
    input.profileId ?? AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
    input.researchPreset ?? AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
    input.requestedModelId ?? AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
  ].join("\u001f");
}

export function resetAfcSr1TiledArtifactCacheForTests(): void {
  completedTiled.clear();
  inFlightTiled.clear();
}

export function evictAfcSr1TiledArtifactCacheEntry(cacheKey: string): void {
  completedTiled.delete(cacheKey);
}

export function peekAfcSr1CompletedTiledArtifact(
  cacheKey: string,
): GeneratedTiledArtifact | undefined {
  return completedTiled.get(cacheKey);
}

export function restoreAfcSr1CompletedTiledArtifact(
  cacheKey: string,
  artifact: GeneratedTiledArtifact,
): void {
  cacheSet(cacheKey, artifact);
}

function isCanonicalBase64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value) &&
    Buffer.from(value, "base64").toString("base64") === value
  );
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function freezeGenerated(result: GeneratedTiledArtifact): GeneratedTiledArtifact {
  const compatibility = result.compatibility && typeof result.compatibility === "object"
    ? Object.freeze({
      ...result.compatibility,
      originalDecodedDimensions: result.compatibility.originalDecodedDimensions
        ? Object.freeze({ ...result.compatibility.originalDecodedDimensions })
        : result.compatibility.originalDecodedDimensions,
      inputDecodedDimensions: result.compatibility.inputDecodedDimensions
        ? Object.freeze({ ...result.compatibility.inputDecodedDimensions })
        : result.compatibility.inputDecodedDimensions,
    })
    : result.compatibility;
  return Object.freeze({
    status: "generated" as const,
    input: Object.freeze({ ...result.input }),
    tiled: Object.freeze({
      base64: result.tiled.base64,
      identity: Object.freeze({ ...result.tiled.identity }),
    }),
    provenance: Object.freeze({ ...result.provenance }),
    compatibility,
  });
}

export function isAdmissibleAfcSr1TiledArtifact(
  result: AfcSr1TileGridScaffoldResult,
  emptySha256: string,
): result is GeneratedTiledArtifact {
  if (result.status !== "generated") return false;
  if (!isCanonicalBase64(result.tiled.base64)) return false;
  const bytes = Buffer.from(result.tiled.base64, "base64");
  if (
    bytes.byteLength < 8 ||
    !bytes.subarray(0, 8).equals(PNG_MAGIC) ||
    bytes.byteLength !== result.tiled.identity.byteCount ||
    sha256Hex(bytes) !== result.tiled.identity.sha256 ||
    result.tiled.identity.mimeType !== "image/png" ||
    result.tiled.identity.orientation !== 1 ||
    result.input.sha256 !== emptySha256 ||
    result.compatibility?.tier !== "exact_grid_compatible"
  ) {
    return false;
  }
  return true;
}

function cacheSet(
  key: string,
  result: GeneratedTiledArtifact,
): GeneratedTiledArtifact {
  const immutable = freezeGenerated(result);
  if (completedTiled.has(key)) completedTiled.delete(key);
  completedTiled.set(key, immutable);
  while (completedTiled.size > AFC_SR1_TILED_ARTIFACT_CACHE_MAX_ENTRIES) {
    const oldest = completedTiled.keys().next().value;
    if (typeof oldest !== "string") break;
    completedTiled.delete(oldest);
  }
  return immutable;
}

function inconsistentCacheFailure(
  runId: string,
): Extract<AfcSr1TileGridScaffoldResult, { status: "failure" }> {
  return Object.freeze({
    status: "failure",
    code: "basis_incompatible",
    runId,
  });
}

/**
 * Live-product get-or-generate wrapper. Completes only successful generated
 * TILED artifacts. Failures never populate the completed cache.
 *
 * Concurrency:
 * - Normal hits return the last completed artifact immediately.
 * - Concurrent misses share one in-flight generation.
 * - Concurrent forceRefresh callers skip completed lookup, share one in-flight
 *   generation, and never receive the previous completed artifact for that
 *   attempt. A successful result replaces the completed entry.
 * - A normal consumer during forceRefresh in-flight still receives the last
 *   completed valid artifact when one exists.
 * - Failed forceRefresh generation leaves the previous completed entry intact
 *   and does not fall back to it in the same call.
 */
export async function getOrGenerateCachedTiledArtifact(
  args: AfcSr1TileGridScaffoldArgs,
  generate: AfcSr1TiledArtifactGenerate,
  options?: Readonly<{
    keyParts?: Partial<Omit<AfcSr1TiledArtifactCacheKeyInput, "emptySha256">>;
    forceRefresh?: boolean;
  }>,
): Promise<AfcSr1TiledArtifactCacheResolve> {
  const emptySha256 = args.empty.identity.sha256;
  const key = buildAfcSr1TiledArtifactCacheKey({
    emptySha256,
    ...options?.keyParts,
  });
  const forceRefresh = options?.forceRefresh === true;
  if (!forceRefresh) {
    const cached = completedTiled.get(key);
    if (cached) {
      if (cached.input.sha256 !== emptySha256) {
        completedTiled.delete(key);
        return Object.freeze({
          result: inconsistentCacheFailure(cached.provenance.runId),
          source: "cache",
        });
      }
      return Object.freeze({ result: cached, source: "cache" });
    }
  }

  const existing = inFlightTiled.get(key);
  if (existing) {
    const result = await existing;
    return Object.freeze({
      result,
      source: forceRefresh ? "generated" : "cache",
    });
  }

  const promise = (async () => {
    const generated = await generate(args);
    if (!isAdmissibleAfcSr1TiledArtifact(generated, emptySha256)) {
      return generated;
    }
    return cacheSet(key, generated);
  })();
  inFlightTiled.set(key, promise);
  try {
    const result = await promise;
    return Object.freeze({ result, source: "generated" });
  } finally {
    inFlightTiled.delete(key);
  }
}
