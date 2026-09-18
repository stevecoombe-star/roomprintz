/**
 * PI-5G5B2 client/runtime DTOs for dynamic Partner Assets.
 *
 * Compatible with FurnitureAssetDefinition. Signed GET URLs are
 * transport-only and must never be persisted into Scene JSON.
 * This module is browser-safe and does not import server-only code.
 */

import {
  createFurnitureAssetResolver,
  furnitureAssetDefinition,
  type FurnitureAssetResolver,
} from "./furniture-assets";
import { PI4C_MAX_ASSET_ID_LENGTH, PI4C_MAX_SCENE_OBJECTS } from "./persisted-scene";
import type { FurnitureAssetDefinition } from "./types";

export const RUNTIME_ASSET_SIGNED_GET_EXPIRES_SEC = 3600;

export const RUNTIME_ASSET_RESOLVE_PATH = "/api/vibode/runtime/assets/resolve";

export const RUNTIME_ASSET_ISSUE_CODES = Object.freeze([
  "RUNTIME_ASSET_NOT_READY",
  "RUNTIME_ASSET_NOT_FOUND",
  "RUNTIME_ASSET_URL_MINT_FAILED",
  "RUNTIME_ASSET_COLLISION",
  "RUNTIME_ASSET_LOAD_FAILED",
] as const);

export type RuntimeAssetIssueCode = (typeof RUNTIME_ASSET_ISSUE_CODES)[number];

export type RuntimeFurnitureAssetDefinition = FurnitureAssetDefinition & Readonly<{
  expiresAt: string;
}>;

export type RuntimeAssetIssue = Readonly<{
  assetId: string;
  objectId?: string;
  code: RuntimeAssetIssueCode;
  message: string;
}>;

export type RuntimeAssetResolveResponse = Readonly<{
  assetDefinitions: RuntimeFurnitureAssetDefinition[];
  assetIssues?: RuntimeAssetIssue[];
}>;

const DTO_KEYS = Object.freeze([
  "assetId",
  "glbUrl",
  "authoredWidthM",
  "authoredHeightM",
  "authoredDepthM",
  "expiresAt",
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isIsoTimestamp(value: string): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

export function runtimeAssetIssueMessage(code: RuntimeAssetIssueCode): string {
  switch (code) {
    case "RUNTIME_ASSET_NOT_READY":
      return "Asset is not runtime-ready.";
    case "RUNTIME_ASSET_NOT_FOUND":
      return "Asset was not found.";
    case "RUNTIME_ASSET_URL_MINT_FAILED":
      return "Asset URL could not be created.";
    case "RUNTIME_ASSET_COLLISION":
      return "Asset ID collides with a generated Asset.";
    case "RUNTIME_ASSET_LOAD_FAILED":
      return "Asset could not be loaded.";
    default:
      return "Asset could not be resolved.";
  }
}

export function createRuntimeAssetIssue(
  assetId: string,
  code: RuntimeAssetIssueCode,
  objectId?: string,
): RuntimeAssetIssue {
  const issue: {
    assetId: string;
    code: RuntimeAssetIssueCode;
    message: string;
    objectId?: string;
  } = {
    assetId,
    code,
    message: runtimeAssetIssueMessage(code),
  };
  if (objectId) issue.objectId = objectId;
  return issue;
}

export function isRuntimeAssetIssueCode(value: string): value is RuntimeAssetIssueCode {
  return (RUNTIME_ASSET_ISSUE_CODES as readonly string[]).includes(value);
}

export function furnitureAssetDefinitionFromRuntime(
  dto: RuntimeFurnitureAssetDefinition,
): FurnitureAssetDefinition {
  return {
    assetId: dto.assetId,
    glbUrl: dto.glbUrl,
    authoredWidthM: dto.authoredWidthM,
    authoredHeightM: dto.authoredHeightM,
    authoredDepthM: dto.authoredDepthM,
  };
}

export function parseRuntimeFurnitureAssetDefinition(
  value: unknown,
): RuntimeFurnitureAssetDefinition | null {
  if (!isRecord(value)) return null;
  const assetId = typeof value.assetId === "string" ? value.assetId.trim() : "";
  const glbUrl = typeof value.glbUrl === "string" ? value.glbUrl.trim() : "";
  const expiresAt = typeof value.expiresAt === "string" ? value.expiresAt.trim() : "";
  if (
    !assetId ||
    assetId.length > PI4C_MAX_ASSET_ID_LENGTH ||
    assetId.includes("..") ||
    !glbUrl ||
    !isIsoTimestamp(expiresAt) ||
    !isFinitePositive(value.authoredWidthM) ||
    !isFinitePositive(value.authoredHeightM) ||
    !isFinitePositive(value.authoredDepthM)
  ) {
    return null;
  }
  void DTO_KEYS;
  return {
    assetId,
    glbUrl,
    authoredWidthM: value.authoredWidthM,
    authoredHeightM: value.authoredHeightM,
    authoredDepthM: value.authoredDepthM,
    expiresAt,
  };
}

export function parseRuntimeAssetIssue(value: unknown): RuntimeAssetIssue | null {
  if (!isRecord(value)) return null;
  const assetId = typeof value.assetId === "string" ? value.assetId.trim() : "";
  const code = typeof value.code === "string" ? value.code : "";
  if (!assetId || !isRuntimeAssetIssueCode(code)) return null;
  const objectId = typeof value.objectId === "string" ? value.objectId.trim() : "";
  return createRuntimeAssetIssue(assetId, code, objectId || undefined);
}

export function parseRuntimeAssetDefinitions(
  value: unknown,
): RuntimeFurnitureAssetDefinition[] {
  if (!Array.isArray(value)) return [];
  const parsed: RuntimeFurnitureAssetDefinition[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const dto = parseRuntimeFurnitureAssetDefinition(item);
    if (!dto || seen.has(dto.assetId)) continue;
    seen.add(dto.assetId);
    parsed.push(dto);
  }
  return parsed;
}

export function parseRuntimeAssetIssues(value: unknown): RuntimeAssetIssue[] {
  if (!Array.isArray(value)) return [];
  const parsed: RuntimeAssetIssue[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const issue = parseRuntimeAssetIssue(item);
    if (!issue) continue;
    const key = `${issue.code}:${issue.assetId}:${issue.objectId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(issue);
  }
  return parsed;
}

/**
 * Overlay for the furniture resolver. Static generated IDs are dropped
 * so a private DB row cannot shadow a certified Asset. expiresAt is not
 * part of FurnitureAssetDefinition and is kept separately.
 */
export function overlayFromRuntimeDefinitions(
  definitions: readonly RuntimeFurnitureAssetDefinition[],
): ReadonlyMap<string, FurnitureAssetDefinition> {
  const overlay = new Map<string, FurnitureAssetDefinition>();
  for (const dto of definitions) {
    if (furnitureAssetDefinition(dto.assetId)) continue;
    overlay.set(dto.assetId, furnitureAssetDefinitionFromRuntime(dto));
  }
  return overlay;
}

export function runtimeExpiryByAssetId(
  definitions: readonly RuntimeFurnitureAssetDefinition[],
): ReadonlyMap<string, string> {
  const expiry = new Map<string, string>();
  for (const dto of definitions) {
    if (furnitureAssetDefinition(dto.assetId)) continue;
    expiry.set(dto.assetId, dto.expiresAt);
  }
  return expiry;
}

export function resolverFromRuntimeDefinitions(
  definitions: readonly RuntimeFurnitureAssetDefinition[],
): FurnitureAssetResolver {
  return createFurnitureAssetResolver(overlayFromRuntimeDefinitions(definitions));
}

export function uniqueSceneAssetIds(
  assetIds: readonly string[],
  maxIds: number = PI4C_MAX_SCENE_OBJECTS,
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of assetIds) {
    const assetId = raw.trim();
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    unique.push(assetId);
    if (unique.length >= maxIds) break;
  }
  return unique;
}

export function interpretRuntimeAssetResolveResponse(payload: unknown): RuntimeAssetResolveResponse {
  const record = isRecord(payload) ? payload : null;
  return {
    assetDefinitions: parseRuntimeAssetDefinitions(record?.assetDefinitions),
    assetIssues: parseRuntimeAssetIssues(record?.assetIssues),
  };
}

export function runtimeDtoPrivacyViolations(
  dto: RuntimeFurnitureAssetDefinition,
): string[] {
  const json = JSON.stringify(dto);
  const violations: string[] = [];
  for (const token of [
    "storageBucket",
    "storage_bucket",
    "storageObjectPath",
    "storage_object_path",
    "sha256",
    "partner_id",
    "partnerId",
    "intake_id",
    "intakeId",
    "source",
    "service_role",
  ]) {
    if (json.includes(`"${token}"`)) violations.push(token);
  }
  return violations;
}
