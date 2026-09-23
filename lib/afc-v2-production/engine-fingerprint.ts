/**
 * Durable AFC engine/build identity persisted on every generation.
 *
 * This is production generation evidence, not diagnostic metadata.
 * READY production authority and fingerprints share
 * `afcV2ProductionEngineVersions()`.
 */

import {
  AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
} from "@/app/admin/3d-room-lab/research/afc-sr1-tile-grid-scaffold";
import { AFC_V2_ROOM_OBSERVATION_DEFAULT_MODEL } from "@/app/admin/3d-room-lab-v2/room-observation.server";

import {
  AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
  afcV2ProductionEngineVersions,
  type AfcV2ProductionEngineVersions,
} from "./production-authority-contract";

export const AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION =
  "afc-v2-engine-fingerprint/v1" as const;

export type AfcV2EngineFingerprintTiledV1 = Readonly<{
  generatorId: string;
  profileId: string;
  researchPreset: string;
  requestedModelId: string;
  readerVersion: string | null;
}>;

export type AfcV2EngineFingerprintV1 = Readonly<{
  fingerprintSchemaVersion: typeof AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION;
  productionSchemaVersion: typeof AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION | string;
  engineVersions: AfcV2ProductionEngineVersions | Readonly<{
    liveProduct: string;
    autoMetric: string;
    cameraCalibration: string;
    cameraAuthority: string;
    collision: string;
    emptyAuthoritativeCollision: string;
  }>;
  tiled: AfcV2EngineFingerprintTiledV1;
  observationModelId: string;
  gitSha: string | null;
}>;

export const AFC_V2_ENGINE_FINGERPRINT_KEYS = [
  "fingerprintSchemaVersion",
  "productionSchemaVersion",
  "engineVersions",
  "tiled",
  "observationModelId",
  "gitSha",
] as const;

export const AFC_V2_ENGINE_VERSION_KEYS = [
  "liveProduct",
  "autoMetric",
  "cameraCalibration",
  "cameraAuthority",
  "collision",
  "emptyAuthoritativeCollision",
] as const;

export const AFC_V2_ENGINE_FINGERPRINT_TILED_KEYS = [
  "generatorId",
  "profileId",
  "researchPreset",
  "requestedModelId",
  "readerVersion",
] as const;

export type AfcEngineFingerprintEnv = Readonly<{
  AFC_V2_ROOM_OBSERVATION_MODEL?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
}>;

function readEnvString(env: unknown, key: string): string | undefined {
  if (!env || typeof env !== "object") return undefined;
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveAfcV2ObservationModelId(
  env: AfcEngineFingerprintEnv | NodeJS.ProcessEnv = process.env,
): string {
  const configured = readEnvString(env, "AFC_V2_ROOM_OBSERVATION_MODEL")?.trim();
  return configured && configured.length > 0
    ? configured
    : AFC_V2_ROOM_OBSERVATION_DEFAULT_MODEL;
}

export function resolveAfcV2EngineGitSha(
  env: AfcEngineFingerprintEnv | NodeJS.ProcessEnv = process.env,
): string | null {
  const sha = readEnvString(env, "VERCEL_GIT_COMMIT_SHA")?.trim();
  return sha && sha.length > 0 ? sha : null;
}

export function productionTiledEngineIdentity(): Readonly<{
  generatorId: typeof AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID;
  profileId: typeof AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE;
  researchPreset: typeof AFC_SR1_TILE_GRID_SCAFFOLD_PRESET;
  requestedModelId: typeof AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID;
}> {
  return Object.freeze({
    generatorId: AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
    profileId: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
    researchPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
    requestedModelId: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
  });
}

export function cloneAfcV2EngineFingerprint(
  fingerprint: AfcV2EngineFingerprintV1,
): AfcV2EngineFingerprintV1 {
  return Object.freeze({
    fingerprintSchemaVersion: fingerprint.fingerprintSchemaVersion,
    productionSchemaVersion: fingerprint.productionSchemaVersion,
    engineVersions: Object.freeze({ ...fingerprint.engineVersions }),
    tiled: Object.freeze({ ...fingerprint.tiled }),
    observationModelId: fingerprint.observationModelId,
    gitSha: fingerprint.gitSha,
  });
}

export function buildAfcV2EngineFingerprint(
  options: Readonly<{
    readerVersion?: string | null;
    env?: AfcEngineFingerprintEnv | NodeJS.ProcessEnv;
  }> = {},
): AfcV2EngineFingerprintV1 {
  const env = options.env ?? process.env;
  const tiled = productionTiledEngineIdentity();
  const readerVersion = options.readerVersion ?? null;
  return Object.freeze({
    fingerprintSchemaVersion: AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION,
    productionSchemaVersion: AFC_V2_PRODUCTION_ROOM_AUTHORITY_VERSION,
    engineVersions: afcV2ProductionEngineVersions(),
    tiled: Object.freeze({
      generatorId: tiled.generatorId,
      profileId: tiled.profileId,
      researchPreset: tiled.researchPreset,
      requestedModelId: tiled.requestedModelId,
      readerVersion: typeof readerVersion === "string" && readerVersion.length > 0
        ? readerVersion
        : null,
    }),
    observationModelId: resolveAfcV2ObservationModelId(env),
    gitSha: resolveAfcV2EngineGitSha(env),
  });
}

/**
 * Terminal enrichment: fill `tiled.readerVersion` once when it becomes
 * known. Other fingerprint keys stay untouched.
 */
export function withAfcV2EngineFingerprintReaderVersion(
  fingerprint: AfcV2EngineFingerprintV1,
  readerVersion: string | null | undefined,
): AfcV2EngineFingerprintV1 {
  if (readerVersion == null || readerVersion.length === 0) {
    return cloneAfcV2EngineFingerprint(fingerprint);
  }
  if (fingerprint.tiled.readerVersion === readerVersion) {
    return cloneAfcV2EngineFingerprint(fingerprint);
  }
  if (fingerprint.tiled.readerVersion != null) {
    return cloneAfcV2EngineFingerprint(fingerprint);
  }
  return Object.freeze({
    ...cloneAfcV2EngineFingerprint(fingerprint),
    tiled: Object.freeze({
      ...fingerprint.tiled,
      readerVersion,
    }),
  });
}

export function isAfcV2EngineFingerprintV1(
  value: unknown,
): value is AfcV2EngineFingerprintV1 {
  if (!isRecord(value)) return false;
  if (value.fingerprintSchemaVersion !== AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION) {
    return false;
  }
  if (typeof value.productionSchemaVersion !== "string") return false;
  if (typeof value.observationModelId !== "string") return false;
  if (value.gitSha !== null && typeof value.gitSha !== "string") return false;
  if (!isRecord(value.engineVersions)) return false;
  for (const key of AFC_V2_ENGINE_VERSION_KEYS) {
    if (typeof value.engineVersions[key] !== "string") return false;
  }
  if (!isRecord(value.tiled)) return false;
  if (!nonEmptyString(value.tiled.generatorId)) return false;
  if (!nonEmptyString(value.tiled.profileId)) return false;
  if (!nonEmptyString(value.tiled.researchPreset)) return false;
  if (!nonEmptyString(value.tiled.requestedModelId)) return false;
  if (
    value.tiled.readerVersion !== null &&
    typeof value.tiled.readerVersion !== "string"
  ) {
    return false;
  }
  return AFC_V2_ENGINE_FINGERPRINT_KEYS.every((key) => key in value);
}
