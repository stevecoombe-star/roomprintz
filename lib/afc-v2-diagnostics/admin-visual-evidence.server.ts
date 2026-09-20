import "server-only";

import { NextResponse } from "next/server";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { durableArtifactBytesMatch } from "@/lib/afc-v2-production/production-artifact-integrity";
import { isOwnedOriginalStoragePath } from "@/lib/afc-v2-production/production-original";
import {
  AFC_V2_ORIGINAL_STORAGE_BUCKET,
  AFC_V2_PRODUCTION_STORAGE_BUCKET,
} from "@/lib/afc-v2-production/production-store";

import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
} from "./contracts";
import {
  authorizeAfcDiagnosticsAdmin,
  type AfcDiagnosticsAdminAuth,
  type AuthorizeAfcDiagnosticsAdminOptions,
} from "./admin-auth.server";
import { parseAfcDiagnosticAdminUuid } from "./admin-read-model";
import { AFC_GENERATION_TABLE } from "./admin-read-model.server";

export const AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS = [
  "original",
  "empty",
  "tiled",
] as const;

export type AfcDiagnosticVisualArtifactKind =
  (typeof AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS)[number];

export const AFC_DIAGNOSTIC_VISUAL_MAX_BYTES = 50 * 1024 * 1024;
export const AFC_DIAGNOSTIC_ORIGINAL_HISTORY_LIMIT = 8;

export const AFC_DIAGNOSTIC_VISUAL_ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AfcDiagnosticVisualAllowedMime =
  (typeof AFC_DIAGNOSTIC_VISUAL_ALLOWED_MIMES)[number];

const KIND_SET = new Set<string>(AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS);
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const ALLOWED_MIME_SET = new Set<string>(AFC_DIAGNOSTIC_VISUAL_ALLOWED_MIMES);

export const AFC_DIAGNOSTIC_VISUAL_CASE_COLUMNS = "id, session_id, room_id";
export const AFC_DIAGNOSTIC_VISUAL_SESSION_COLUMNS =
  "id, room_id, user_id, base_asset_id";
export const AFC_DIAGNOSTIC_VISUAL_MEMBERSHIP_COLUMNS =
  "session_id, generation_id";
export const AFC_DIAGNOSTIC_VISUAL_GENERATION_COLUMNS = [
  "id",
  "room_id",
  "user_id",
  "original_sha256",
  "original_decoded_width",
  "original_decoded_height",
  "original_byte_count",
  "original_mime_type",
  "empty_sha256",
  "empty_decoded_width",
  "empty_decoded_height",
  "empty_byte_count",
  "empty_mime_type",
  "empty_storage_bucket",
  "empty_storage_path",
  "tiled_sha256",
  "tiled_decoded_width",
  "tiled_decoded_height",
  "tiled_byte_count",
  "tiled_mime_type",
  "tiled_storage_bucket",
  "tiled_storage_path",
  "tiled_cache_key",
].join(", ");
export const AFC_DIAGNOSTIC_VISUAL_ROOM_COLUMNS = "id, user_id, base_asset_id";
export const AFC_DIAGNOSTIC_VISUAL_ROOM_ASSET_COLUMNS =
  "id, room_id, user_id, storage_bucket, storage_path, created_at";
export const AFC_DIAGNOSTIC_VISUAL_DURABLE_EMPTY_COLUMNS = [
  "user_id",
  "original_sha256",
  "empty_sha256",
  "byte_count",
  "mime_type",
  "storage_bucket",
  "storage_path",
].join(", ");
export const AFC_DIAGNOSTIC_VISUAL_DURABLE_TILED_COLUMNS = [
  "user_id",
  "cache_key",
  "empty_sha256",
  "tiled_sha256",
  "byte_count",
  "mime_type",
  "storage_bucket",
  "storage_path",
].join(", ");

export type AfcDiagnosticVisualCaseRecord = Readonly<{
  id: string;
  sessionId: string;
  roomId: string;
}>;

export type AfcDiagnosticVisualSessionRecord = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  baseAssetId: string | null;
}>;

export type AfcDiagnosticVisualMembershipRecord = Readonly<{
  sessionId: string;
  generationId: string;
}>;

export type AfcDiagnosticVisualGenerationRecord = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  originalSha256: string | null;
  originalDecodedWidth: number | null;
  originalDecodedHeight: number | null;
  originalByteCount: number | null;
  originalMimeType: string | null;
  emptySha256: string | null;
  emptyDecodedWidth: number | null;
  emptyDecodedHeight: number | null;
  emptyByteCount: number | null;
  emptyMimeType: string | null;
  emptyStorageBucket: string | null;
  emptyStoragePath: string | null;
  tiledSha256: string | null;
  tiledDecodedWidth: number | null;
  tiledDecodedHeight: number | null;
  tiledByteCount: number | null;
  tiledMimeType: string | null;
  tiledStorageBucket: string | null;
  tiledStoragePath: string | null;
  tiledCacheKey: string | null;
}>;

export type AfcDiagnosticVisualRoomAssetRecord = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  storageBucket: string | null;
  storagePath: string | null;
  createdAt: string | null;
}>;

export type AfcDiagnosticVisualRoomPointer = Readonly<{
  id: string;
  userId: string;
  baseAssetId: string | null;
}>;

export type AfcDiagnosticVisualDurableEmptyRecord = Readonly<{
  userId: string;
  originalSha256: string;
  emptySha256: string;
  byteCount: number | null;
  mimeType: string | null;
  storageBucket: string;
  storagePath: string;
}>;

export type AfcDiagnosticVisualDurableTiledRecord = Readonly<{
  userId: string;
  cacheKey: string;
  emptySha256: string;
  tiledSha256: string;
  byteCount: number | null;
  mimeType: string | null;
  storageBucket: string;
  storagePath: string;
}>;

export type AfcDiagnosticVisualMembershipIdentity = Readonly<{
  id: string;
  roomId: string;
  userId: string;
}>;

export type AfcDiagnosticVisualMembershipStore<
  G extends AfcDiagnosticVisualMembershipIdentity,
> = {
  findCaseById(
    caseId: string,
  ): Promise<AfcDiagnosticVisualCaseRecord | null>;
  findSessionById(
    sessionId: string,
  ): Promise<AfcDiagnosticVisualSessionRecord | null>;
  findMembership(
    sessionId: string,
    generationId: string,
  ): Promise<AfcDiagnosticVisualMembershipRecord | null>;
  findGenerationById(generationId: string): Promise<G | null>;
};

export type AfcDiagnosticVisualEvidenceStore =
  AfcDiagnosticVisualMembershipStore<AfcDiagnosticVisualGenerationRecord> & {
  findRoomAssetById(
    assetId: string,
  ): Promise<AfcDiagnosticVisualRoomAssetRecord | null>;
  findRoomPointer(
    roomId: string,
  ): Promise<AfcDiagnosticVisualRoomPointer | null>;
  listRecentRoomAssets(
    roomId: string,
    userId: string,
    limit: number,
  ): Promise<readonly AfcDiagnosticVisualRoomAssetRecord[]>;
  findDurableEmpty(
    userId: string,
    originalSha256: string,
  ): Promise<AfcDiagnosticVisualDurableEmptyRecord | null>;
  findDurableTiled(
    userId: string,
    cacheKey: string,
  ): Promise<AfcDiagnosticVisualDurableTiledRecord | null>;
  download(bucket: string, path: string): Promise<Uint8Array | null>;
};

export type AfcDiagnosticVisualDimensions = Readonly<{
  width: number;
  height: number;
}>;

export type AfcDiagnosticVisualInspectDimensions = (
  bytes: Uint8Array,
) => Promise<AfcDiagnosticVisualDimensions | null>;

export type AfcDiagnosticVisualEvidenceLog = Readonly<{
  caseId: string;
  generationId: string;
  kind: AfcDiagnosticVisualArtifactKind | string;
  expectedShaPrefix: string;
  actualByteLength: number | null;
  reason: string;
}>;

export class AfcDiagnosticVisualInputError extends Error {
  readonly code = "invalid_request" as const;
  constructor() {
    super("Invalid request.");
    this.name = "AfcDiagnosticVisualInputError";
  }
}

export class AfcDiagnosticVisualNotFoundError extends Error {
  readonly code = "not_found" as const;
  constructor() {
    super("Not found.");
    this.name = "AfcDiagnosticVisualNotFoundError";
  }
}

export class AfcDiagnosticVisualIntegrityError extends Error {
  readonly code = "integrity_failure" as const;
  readonly reason: string;
  readonly expectedShaPrefix: string;
  readonly actualByteLength: number | null;
  constructor(input: {
    reason: string;
    expectedShaPrefix?: string;
    actualByteLength?: number | null;
  }) {
    super("Artifact evidence could not be verified.");
    this.name = "AfcDiagnosticVisualIntegrityError";
    this.reason = input.reason;
    this.expectedShaPrefix = input.expectedShaPrefix ?? "none";
    this.actualByteLength =
      typeof input.actualByteLength === "number" ? input.actualByteLength : null;
  }
}

export class AfcDiagnosticVisualStoreError extends Error {
  readonly code = "store_failed" as const;
  constructor() {
    super("Server error.");
    this.name = "AfcDiagnosticVisualStoreError";
  }
}

type VisualDbClient = {
  from: (table: string) => any;
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{
        data: { arrayBuffer: () => Promise<ArrayBuffer> } | null;
        error: unknown;
      }>;
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function postgresError(error: unknown): never {
  void error;
  throw new AfcDiagnosticVisualStoreError();
}

export function parseAfcDiagnosticVisualArtifactKind(
  value: unknown,
): AfcDiagnosticVisualArtifactKind | null {
  if (typeof value !== "string") return null;
  const kind = value.trim();
  return KIND_SET.has(kind)
    ? (kind as AfcDiagnosticVisualArtifactKind)
    : null;
}

export function detectAllowedImageMime(
  bytes: Uint8Array,
): AfcDiagnosticVisualAllowedMime | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function sha256Prefix(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0) return "none";
  return value.slice(0, 8);
}

function normalizeSha256(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!SHA256_HEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function parseCaseRow(row: unknown): AfcDiagnosticVisualCaseRecord | null {
  if (!isRecord(row)) return null;
  const id = parseAfcDiagnosticAdminUuid(row.id);
  const sessionId = parseAfcDiagnosticAdminUuid(row.session_id);
  const roomId = parseAfcDiagnosticAdminUuid(row.room_id);
  if (!id || !sessionId || !roomId) return null;
  return Object.freeze({ id, sessionId, roomId });
}

function parseSessionRow(
  row: unknown,
): AfcDiagnosticVisualSessionRecord | null {
  if (!isRecord(row)) return null;
  const id = parseAfcDiagnosticAdminUuid(row.id);
  const roomId = parseAfcDiagnosticAdminUuid(row.room_id);
  const userId = parseAfcDiagnosticAdminUuid(row.user_id);
  if (!id || !roomId || !userId) return null;
  const baseAssetId =
    row.base_asset_id == null
      ? null
      : parseAfcDiagnosticAdminUuid(row.base_asset_id);
  if (row.base_asset_id != null && !baseAssetId) return null;
  return Object.freeze({ id, roomId, userId, baseAssetId });
}

function parseMembershipRow(
  row: unknown,
): AfcDiagnosticVisualMembershipRecord | null {
  if (!isRecord(row)) return null;
  const sessionId = parseAfcDiagnosticAdminUuid(row.session_id);
  const generationId = parseAfcDiagnosticAdminUuid(row.generation_id);
  if (!sessionId || !generationId) return null;
  return Object.freeze({ sessionId, generationId });
}

function parseGenerationRow(
  row: unknown,
): AfcDiagnosticVisualGenerationRecord | null {
  if (!isRecord(row)) return null;
  const id = parseAfcDiagnosticAdminUuid(row.id);
  const roomId = parseAfcDiagnosticAdminUuid(row.room_id);
  const userId = parseAfcDiagnosticAdminUuid(row.user_id);
  if (!id || !roomId || !userId) return null;
  return Object.freeze({
    id,
    roomId,
    userId,
    originalSha256: optionalString(row.original_sha256),
    originalDecodedWidth: optionalFiniteNumber(row.original_decoded_width),
    originalDecodedHeight: optionalFiniteNumber(row.original_decoded_height),
    originalByteCount: optionalFiniteNumber(row.original_byte_count),
    originalMimeType: optionalString(row.original_mime_type),
    emptySha256: optionalString(row.empty_sha256),
    emptyDecodedWidth: optionalFiniteNumber(row.empty_decoded_width),
    emptyDecodedHeight: optionalFiniteNumber(row.empty_decoded_height),
    emptyByteCount: optionalFiniteNumber(row.empty_byte_count),
    emptyMimeType: optionalString(row.empty_mime_type),
    emptyStorageBucket: optionalString(row.empty_storage_bucket),
    emptyStoragePath: optionalString(row.empty_storage_path),
    tiledSha256: optionalString(row.tiled_sha256),
    tiledDecodedWidth: optionalFiniteNumber(row.tiled_decoded_width),
    tiledDecodedHeight: optionalFiniteNumber(row.tiled_decoded_height),
    tiledByteCount: optionalFiniteNumber(row.tiled_byte_count),
    tiledMimeType: optionalString(row.tiled_mime_type),
    tiledStorageBucket: optionalString(row.tiled_storage_bucket),
    tiledStoragePath: optionalString(row.tiled_storage_path),
    tiledCacheKey: optionalString(row.tiled_cache_key),
  });
}

function parseRoomAssetRow(
  row: unknown,
): AfcDiagnosticVisualRoomAssetRecord | null {
  if (!isRecord(row)) return null;
  const id = parseAfcDiagnosticAdminUuid(row.id);
  const roomId = parseAfcDiagnosticAdminUuid(row.room_id);
  const userId = parseAfcDiagnosticAdminUuid(row.user_id);
  if (!id || !roomId || !userId) return null;
  return Object.freeze({
    id,
    roomId,
    userId,
    storageBucket: optionalString(row.storage_bucket),
    storagePath: optionalString(row.storage_path),
    createdAt: optionalString(row.created_at),
  });
}

function parseRoomPointer(row: unknown): AfcDiagnosticVisualRoomPointer | null {
  if (!isRecord(row)) return null;
  const id = parseAfcDiagnosticAdminUuid(row.id);
  const userId = parseAfcDiagnosticAdminUuid(row.user_id);
  if (!id || !userId) return null;
  const baseAssetId =
    row.base_asset_id == null
      ? null
      : parseAfcDiagnosticAdminUuid(row.base_asset_id);
  if (row.base_asset_id != null && !baseAssetId) return null;
  return Object.freeze({ id, userId, baseAssetId });
}

function parseDurableEmptyRow(
  row: unknown,
): AfcDiagnosticVisualDurableEmptyRecord | null {
  if (!isRecord(row)) return null;
  const userId = parseAfcDiagnosticAdminUuid(row.user_id);
  const originalSha256 = optionalString(row.original_sha256);
  const emptySha256 = optionalString(row.empty_sha256);
  const storageBucket = optionalString(row.storage_bucket);
  const storagePath = optionalString(row.storage_path);
  if (
    !userId ||
    !originalSha256 ||
    !emptySha256 ||
    !storageBucket ||
    !storagePath
  ) {
    return null;
  }
  return Object.freeze({
    userId,
    originalSha256,
    emptySha256,
    byteCount: optionalFiniteNumber(row.byte_count),
    mimeType: optionalString(row.mime_type),
    storageBucket,
    storagePath,
  });
}

function parseDurableTiledRow(
  row: unknown,
): AfcDiagnosticVisualDurableTiledRecord | null {
  if (!isRecord(row)) return null;
  const userId = parseAfcDiagnosticAdminUuid(row.user_id);
  const cacheKey = optionalString(row.cache_key);
  const emptySha256 = optionalString(row.empty_sha256);
  const tiledSha256 = optionalString(row.tiled_sha256);
  const storageBucket = optionalString(row.storage_bucket);
  const storagePath = optionalString(row.storage_path);
  if (
    !userId ||
    !cacheKey ||
    !emptySha256 ||
    !tiledSha256 ||
    !storageBucket ||
    !storagePath
  ) {
    return null;
  }
  return Object.freeze({
    userId,
    cacheKey,
    emptySha256,
    tiledSha256,
    byteCount: optionalFiniteNumber(row.byte_count),
    mimeType: optionalString(row.mime_type),
    storageBucket,
    storagePath,
  });
}

export function createSupabaseAfcDiagnosticVisualEvidenceStore(
  supabase: VisualDbClient,
): AfcDiagnosticVisualEvidenceStore {
  return {
    async findCaseById(caseId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_CASE_TABLE)
        .select(AFC_DIAGNOSTIC_VISUAL_CASE_COLUMNS)
        .eq("id", caseId)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseCaseRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async findSessionById(sessionId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_TABLE)
        .select(AFC_DIAGNOSTIC_VISUAL_SESSION_COLUMNS)
        .eq("id", sessionId)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseSessionRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async findMembership(sessionId, generationId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE)
        .select(AFC_DIAGNOSTIC_VISUAL_MEMBERSHIP_COLUMNS)
        .eq("session_id", sessionId)
        .eq("generation_id", generationId)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseMembershipRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async findGenerationById(generationId) {
      const { data, error } = await supabase
        .from(AFC_GENERATION_TABLE)
        .select(AFC_DIAGNOSTIC_VISUAL_GENERATION_COLUMNS)
        .eq("id", generationId)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseGenerationRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async findRoomAssetById(assetId) {
      const { data, error } = await supabase
        .from("vibode_room_assets")
        .select(AFC_DIAGNOSTIC_VISUAL_ROOM_ASSET_COLUMNS)
        .eq("id", assetId)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseRoomAssetRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async findRoomPointer(roomId) {
      const { data, error } = await supabase
        .from("vibode_rooms")
        .select(AFC_DIAGNOSTIC_VISUAL_ROOM_COLUMNS)
        .eq("id", roomId)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseRoomPointer(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async listRecentRoomAssets(roomId, userId, limit) {
      const { data, error } = await supabase
        .from("vibode_room_assets")
        .select(AFC_DIAGNOSTIC_VISUAL_ROOM_ASSET_COLUMNS)
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .not("storage_path", "is", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) postgresError(error);
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row) => {
        const parsed = parseRoomAssetRow(row);
        if (!parsed) throw new AfcDiagnosticVisualStoreError();
        return parsed;
      });
    },
    async findDurableEmpty(userId, originalSha256) {
      const { data, error } = await supabase
        .from("vibode_afc_durable_empty_artifacts")
        .select(AFC_DIAGNOSTIC_VISUAL_DURABLE_EMPTY_COLUMNS)
        .eq("user_id", userId)
        .eq("original_sha256", originalSha256)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseDurableEmptyRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async findDurableTiled(userId, cacheKey) {
      const { data, error } = await supabase
        .from("vibode_afc_durable_tiled_artifacts")
        .select(AFC_DIAGNOSTIC_VISUAL_DURABLE_TILED_COLUMNS)
        .eq("user_id", userId)
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (error) postgresError(error);
      if (data == null) return null;
      const parsed = parseDurableTiledRow(data);
      if (!parsed) throw new AfcDiagnosticVisualStoreError();
      return parsed;
    },
    async download(bucket, path) {
      const { data, error } = await supabase.storage.from(bucket).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

function storeFromEnv(): AfcDiagnosticVisualEvidenceStore {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) throw new AfcDiagnosticVisualStoreError();
  return createSupabaseAfcDiagnosticVisualEvidenceStore(
    supabase as unknown as VisualDbClient,
  );
}

function defaultLog(entry: AfcDiagnosticVisualEvidenceLog): void {
  console.error("[afc-v2-diagnostics] visual evidence integrity failure", {
    caseId: entry.caseId,
    generationId: entry.generationId,
    kind: entry.kind,
    expectedShaPrefix: entry.expectedShaPrefix,
    actualByteLength: entry.actualByteLength,
    reason: entry.reason,
  });
}

function unexpectedLog(entry: AfcDiagnosticVisualEvidenceLog): void {
  console.error("[afc-v2-diagnostics] visual evidence failed", {
    caseId: entry.caseId,
    generationId: entry.generationId,
    kind: entry.kind,
    expectedShaPrefix: entry.expectedShaPrefix,
    actualByteLength: entry.actualByteLength,
    reason: entry.reason,
  });
}

type IntegrityExpectation = Readonly<{
  sha256: string;
  byteCount: number | null;
  mimeType: string | null;
  decodedWidth: number | null;
  decodedHeight: number | null;
}>;

type VerifiedBytes = Readonly<{
  bytes: Uint8Array;
  mimeType: AfcDiagnosticVisualAllowedMime;
}>;

type CandidateScan =
  | { status: "match"; value: VerifiedBytes }
  | { status: "missing" }
  | { status: "mismatch"; actualByteLength: number | null; reason: string };

async function verifyDownloadedBytes(input: {
  bytes: Uint8Array;
  expected: IntegrityExpectation;
  inspectDimensions?: AfcDiagnosticVisualInspectDimensions;
}): Promise<VerifiedBytes | { reason: string }> {
  const { bytes, expected } = input;
  if (bytes.byteLength === 0) {
    return { reason: "zero_byte" };
  }
  if (bytes.byteLength > AFC_DIAGNOSTIC_VISUAL_MAX_BYTES) {
    return { reason: "oversize" };
  }
  if (
    typeof expected.byteCount === "number" &&
    bytes.byteLength !== expected.byteCount
  ) {
    return { reason: "byte_count_mismatch" };
  }
  if (
    !durableArtifactBytesMatch({
      bytes,
      sha256: expected.sha256,
      byteCount: expected.byteCount,
    })
  ) {
    return { reason: "sha_mismatch" };
  }
  const mime = detectAllowedImageMime(bytes);
  if (!mime || !ALLOWED_MIME_SET.has(mime)) {
    return { reason: "unsupported_mime" };
  }
  if (expected.mimeType && expected.mimeType !== mime) {
    return { reason: "stored_mime_mismatch" };
  }
  if (
    expected.decodedWidth != null &&
    expected.decodedHeight != null &&
    input.inspectDimensions
  ) {
    const dimensions = await input.inspectDimensions(bytes);
    if (
      dimensions &&
      (dimensions.width !== expected.decodedWidth ||
        dimensions.height !== expected.decodedHeight)
    ) {
      return { reason: "dimension_mismatch" };
    }
  }
  return { bytes, mimeType: mime };
}

function storedCountExceedsCap(byteCount: number | null): boolean {
  return typeof byteCount === "number" && byteCount > AFC_DIAGNOSTIC_VISUAL_MAX_BYTES;
}

function originalStorageRef(
  asset: AfcDiagnosticVisualRoomAssetRecord,
  roomId: string,
  userId: string,
): { bucket: string; path: string } | null {
  if (asset.roomId !== roomId || asset.userId !== userId) return null;
  if (!asset.storagePath) return null;
  if (!isOwnedOriginalStoragePath(userId, asset.storagePath)) return null;
  const bucket = asset.storageBucket ?? AFC_V2_ORIGINAL_STORAGE_BUCKET;
  if (bucket !== AFC_V2_ORIGINAL_STORAGE_BUCKET) return null;
  return { bucket, path: asset.storagePath };
}

async function tryOriginalCandidate(input: {
  store: AfcDiagnosticVisualEvidenceStore;
  asset: AfcDiagnosticVisualRoomAssetRecord | null;
  roomId: string;
  userId: string;
  expected: IntegrityExpectation;
  inspectDimensions?: AfcDiagnosticVisualInspectDimensions;
}): Promise<CandidateScan> {
  if (!input.asset) return { status: "missing" };
  const ref = originalStorageRef(input.asset, input.roomId, input.userId);
  if (!ref) return { status: "missing" };
  const bytes = await input.store.download(ref.bucket, ref.path);
  if (!bytes) return { status: "missing" };
  const verified = await verifyDownloadedBytes({
    bytes,
    expected: input.expected,
    inspectDimensions: input.inspectDimensions,
  });
  if ("bytes" in verified) {
    return { status: "match", value: verified };
  }
  if (
    verified.reason === "unsupported_mime" ||
    verified.reason === "stored_mime_mismatch" ||
    verified.reason === "dimension_mismatch"
  ) {
    throw new AfcDiagnosticVisualIntegrityError({
      reason: verified.reason,
      expectedShaPrefix: sha256Prefix(input.expected.sha256),
      actualByteLength: bytes.byteLength,
    });
  }
  return {
    status: "mismatch",
    actualByteLength: bytes.byteLength,
    reason: verified.reason,
  };
}

async function resolveOriginal(input: {
  store: AfcDiagnosticVisualEvidenceStore;
  session: AfcDiagnosticVisualSessionRecord;
  generation: AfcDiagnosticVisualGenerationRecord;
  inspectDimensions?: AfcDiagnosticVisualInspectDimensions;
}): Promise<VerifiedBytes> {
  const expectedSha = normalizeSha256(input.generation.originalSha256);
  if (!expectedSha) {
    if (input.generation.originalSha256) {
      throw new AfcDiagnosticVisualIntegrityError({
        reason: "invalid_expected_sha",
        expectedShaPrefix: sha256Prefix(input.generation.originalSha256),
      });
    }
    throw new AfcDiagnosticVisualNotFoundError();
  }
  if (storedCountExceedsCap(input.generation.originalByteCount)) {
    throw new AfcDiagnosticVisualIntegrityError({
      reason: "oversize",
      expectedShaPrefix: sha256Prefix(expectedSha),
      actualByteLength: input.generation.originalByteCount,
    });
  }
  const expected: IntegrityExpectation = {
    sha256: expectedSha,
    byteCount: input.generation.originalByteCount,
    mimeType: input.generation.originalMimeType,
    decodedWidth: input.generation.originalDecodedWidth,
    decodedHeight: input.generation.originalDecodedHeight,
  };

  const tried = new Set<string>();
  let mismatched = false;
  let lastMismatchLength: number | null = null;
  let lastMismatchReason = "sha_mismatch";

  const consider = async (asset: AfcDiagnosticVisualRoomAssetRecord | null) => {
    if (!asset || tried.has(asset.id)) return null;
    tried.add(asset.id);
    const result = await tryOriginalCandidate({
      store: input.store,
      asset,
      roomId: input.generation.roomId,
      userId: input.generation.userId,
      expected,
      inspectDimensions: input.inspectDimensions,
    });
    if (result.status === "match") return result.value;
    if (result.status === "mismatch") {
      mismatched = true;
      lastMismatchLength = result.actualByteLength;
      lastMismatchReason = result.reason;
    }
    return null;
  };

  const sessionAsset = input.session.baseAssetId
    ? await input.store.findRoomAssetById(input.session.baseAssetId)
    : null;
  const sessionHit = await consider(sessionAsset);
  if (sessionHit) return sessionHit;

  const room = await input.store.findRoomPointer(input.generation.roomId);
  const currentAsset =
    room?.baseAssetId && room.id === input.generation.roomId
      ? await input.store.findRoomAssetById(room.baseAssetId)
      : null;
  const currentHit = await consider(currentAsset);
  if (currentHit) return currentHit;

  const historical = await input.store.listRecentRoomAssets(
    input.generation.roomId,
    input.generation.userId,
    AFC_DIAGNOSTIC_ORIGINAL_HISTORY_LIMIT,
  );
  for (const asset of historical) {
    const hit = await consider(asset);
    if (hit) return hit;
  }

  if (mismatched) {
    throw new AfcDiagnosticVisualIntegrityError({
      reason: lastMismatchReason,
      expectedShaPrefix: sha256Prefix(expectedSha),
      actualByteLength: lastMismatchLength,
    });
  }
  throw new AfcDiagnosticVisualNotFoundError();
}

function productionStorageRef(
  bucket: string | null,
  path: string | null,
): { bucket: string; path: string } | null {
  if (!path) return null;
  const resolvedBucket = bucket ?? AFC_V2_PRODUCTION_STORAGE_BUCKET;
  if (resolvedBucket !== AFC_V2_PRODUCTION_STORAGE_BUCKET) return null;
  return { bucket: resolvedBucket, path };
}

async function downloadAndVerify(input: {
  store: AfcDiagnosticVisualEvidenceStore;
  bucket: string;
  path: string;
  expected: IntegrityExpectation;
  inspectDimensions?: AfcDiagnosticVisualInspectDimensions;
}): Promise<CandidateScan> {
  if (storedCountExceedsCap(input.expected.byteCount)) {
    return {
      status: "mismatch",
      actualByteLength: input.expected.byteCount,
      reason: "oversize",
    };
  }
  const bytes = await input.store.download(input.bucket, input.path);
  if (!bytes) return { status: "missing" };
  const verified = await verifyDownloadedBytes({
    bytes,
    expected: input.expected,
    inspectDimensions: input.inspectDimensions,
  });
  if ("bytes" in verified) {
    return { status: "match", value: verified };
  }
  return {
    status: "mismatch",
    actualByteLength: bytes.byteLength,
    reason: verified.reason,
  };
}

function throwScan(result: CandidateScan, expectedSha: string): VerifiedBytes {
  if (result.status === "match") return result.value;
  if (result.status === "missing") throw new AfcDiagnosticVisualNotFoundError();
  throw new AfcDiagnosticVisualIntegrityError({
    reason: result.reason,
    expectedShaPrefix: sha256Prefix(expectedSha),
    actualByteLength: result.actualByteLength,
  });
}

async function resolveEmpty(input: {
  store: AfcDiagnosticVisualEvidenceStore;
  generation: AfcDiagnosticVisualGenerationRecord;
  inspectDimensions?: AfcDiagnosticVisualInspectDimensions;
}): Promise<VerifiedBytes> {
  const expectedSha = normalizeSha256(input.generation.emptySha256);
  if (!expectedSha) {
    if (input.generation.emptySha256) {
      throw new AfcDiagnosticVisualIntegrityError({
        reason: "invalid_expected_sha",
        expectedShaPrefix: sha256Prefix(input.generation.emptySha256),
      });
    }
    throw new AfcDiagnosticVisualNotFoundError();
  }
  const expected: IntegrityExpectation = {
    sha256: expectedSha,
    byteCount: input.generation.emptyByteCount,
    mimeType: input.generation.emptyMimeType,
    decodedWidth: input.generation.emptyDecodedWidth,
    decodedHeight: input.generation.emptyDecodedHeight,
  };
  const local = productionStorageRef(
    input.generation.emptyStorageBucket,
    input.generation.emptyStoragePath,
  );
  if (local) {
    const localScan = await downloadAndVerify({
      store: input.store,
      bucket: local.bucket,
      path: local.path,
      expected,
      inspectDimensions: input.inspectDimensions,
    });
    if (localScan.status !== "missing") {
      return throwScan(localScan, expectedSha);
    }
  }

  const originalSha = normalizeSha256(input.generation.originalSha256);
  if (!originalSha) throw new AfcDiagnosticVisualNotFoundError();
  const durable = await input.store.findDurableEmpty(
    input.generation.userId,
    originalSha,
  );
  if (!durable) throw new AfcDiagnosticVisualNotFoundError();
  const durableSha = normalizeSha256(durable.emptySha256);
  if (!durableSha || durableSha !== expectedSha) {
    throw new AfcDiagnosticVisualIntegrityError({
      reason: "durable_sha_mismatch",
      expectedShaPrefix: sha256Prefix(expectedSha),
    });
  }
  const durableRef = productionStorageRef(
    durable.storageBucket,
    durable.storagePath,
  );
  if (!durableRef) throw new AfcDiagnosticVisualNotFoundError();
  const durableExpected: IntegrityExpectation = {
    sha256: expectedSha,
    byteCount: durable.byteCount ?? expected.byteCount,
    mimeType: durable.mimeType ?? expected.mimeType,
    decodedWidth: expected.decodedWidth,
    decodedHeight: expected.decodedHeight,
  };
  const durableScan = await downloadAndVerify({
    store: input.store,
    bucket: durableRef.bucket,
    path: durableRef.path,
    expected: durableExpected,
    inspectDimensions: input.inspectDimensions,
  });
  return throwScan(durableScan, expectedSha);
}

async function resolveTiled(input: {
  store: AfcDiagnosticVisualEvidenceStore;
  generation: AfcDiagnosticVisualGenerationRecord;
  inspectDimensions?: AfcDiagnosticVisualInspectDimensions;
}): Promise<VerifiedBytes> {
  const expectedSha = normalizeSha256(input.generation.tiledSha256);
  if (!expectedSha) {
    if (input.generation.tiledSha256) {
      throw new AfcDiagnosticVisualIntegrityError({
        reason: "invalid_expected_sha",
        expectedShaPrefix: sha256Prefix(input.generation.tiledSha256),
      });
    }
    throw new AfcDiagnosticVisualNotFoundError();
  }
  const expected: IntegrityExpectation = {
    sha256: expectedSha,
    byteCount: input.generation.tiledByteCount,
    mimeType: input.generation.tiledMimeType,
    decodedWidth: input.generation.tiledDecodedWidth,
    decodedHeight: input.generation.tiledDecodedHeight,
  };
  const local = productionStorageRef(
    input.generation.tiledStorageBucket,
    input.generation.tiledStoragePath,
  );
  if (local) {
    const localScan = await downloadAndVerify({
      store: input.store,
      bucket: local.bucket,
      path: local.path,
      expected,
      inspectDimensions: input.inspectDimensions,
    });
    if (localScan.status !== "missing") {
      return throwScan(localScan, expectedSha);
    }
  }

  if (!input.generation.tiledCacheKey) {
    throw new AfcDiagnosticVisualNotFoundError();
  }
  const durable = await input.store.findDurableTiled(
    input.generation.userId,
    input.generation.tiledCacheKey,
  );
  if (!durable) throw new AfcDiagnosticVisualNotFoundError();
  const durableSha = normalizeSha256(durable.tiledSha256);
  if (!durableSha || durableSha !== expectedSha) {
    throw new AfcDiagnosticVisualIntegrityError({
      reason: "durable_sha_mismatch",
      expectedShaPrefix: sha256Prefix(expectedSha),
    });
  }
  const generationEmptySha = normalizeSha256(input.generation.emptySha256);
  const durableEmptySha = normalizeSha256(durable.emptySha256);
  if (
    generationEmptySha &&
    durableEmptySha &&
    generationEmptySha !== durableEmptySha
  ) {
    throw new AfcDiagnosticVisualIntegrityError({
      reason: "durable_empty_sha_mismatch",
      expectedShaPrefix: sha256Prefix(expectedSha),
    });
  }
  const durableRef = productionStorageRef(
    durable.storageBucket,
    durable.storagePath,
  );
  if (!durableRef) throw new AfcDiagnosticVisualNotFoundError();
  const durableExpected: IntegrityExpectation = {
    sha256: expectedSha,
    byteCount: durable.byteCount ?? expected.byteCount,
    mimeType: durable.mimeType ?? expected.mimeType,
    decodedWidth: expected.decodedWidth,
    decodedHeight: expected.decodedHeight,
  };
  const durableScan = await downloadAndVerify({
    store: input.store,
    bucket: durableRef.bucket,
    path: durableRef.path,
    expected: durableExpected,
    inspectDimensions: input.inspectDimensions,
  });
  return throwScan(durableScan, expectedSha);
}

export async function resolveAfcDiagnosticVisualMembershipContext<
  G extends AfcDiagnosticVisualMembershipIdentity,
>(input: {
  store: AfcDiagnosticVisualMembershipStore<G>;
  caseId: string;
  generationId: string;
}): Promise<{
  caseRow: AfcDiagnosticVisualCaseRecord;
  session: AfcDiagnosticVisualSessionRecord;
  generation: G;
}> {
  const caseRow = await input.store.findCaseById(input.caseId);
  if (!caseRow) throw new AfcDiagnosticVisualNotFoundError();

  const session = await input.store.findSessionById(caseRow.sessionId);
  if (!session || session.id !== caseRow.sessionId) {
    throw new AfcDiagnosticVisualNotFoundError();
  }

  const membership = await input.store.findMembership(
    session.id,
    input.generationId,
  );
  if (
    !membership ||
    membership.sessionId !== session.id ||
    membership.generationId !== input.generationId
  ) {
    throw new AfcDiagnosticVisualNotFoundError();
  }

  const generation = await input.store.findGenerationById(input.generationId);
  if (!generation || generation.id !== input.generationId) {
    throw new AfcDiagnosticVisualNotFoundError();
  }
  if (generation.roomId !== caseRow.roomId) {
    throw new AfcDiagnosticVisualNotFoundError();
  }
  if (generation.userId !== session.userId) {
    throw new AfcDiagnosticVisualNotFoundError();
  }

  return { caseRow, session, generation };
}

export async function resolveAfcDiagnosticVisualArtifact(input: {
  store: AfcDiagnosticVisualEvidenceStore;
  caseId: string;
  generationId: string;
  kind: AfcDiagnosticVisualArtifactKind;
  inspectDimensions?: AfcDiagnosticVisualInspectDimensions;
}): Promise<VerifiedBytes> {
  const { session, generation } =
    await resolveAfcDiagnosticVisualMembershipContext({
      store: input.store,
      caseId: input.caseId,
      generationId: input.generationId,
    });

  if (input.kind === "original") {
    return resolveOriginal({
      store: input.store,
      session,
      generation,
      inspectDimensions: input.inspectDimensions,
    });
  }
  if (input.kind === "empty") {
    return resolveEmpty({
      store: input.store,
      generation,
      inspectDimensions: input.inspectDimensions,
    });
  }
  return resolveTiled({
    store: input.store,
    generation,
    inspectDimensions: input.inspectDimensions,
  });
}

function artifactErrorResponse(status: number, message: string) {
  const response = NextResponse.json({ error: message }, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function artifactBytesResponse(
  bytes: Uint8Array,
  mimeType: AfcDiagnosticVisualAllowedMime,
) {
  const response = new NextResponse(Buffer.from(bytes), { status: 200 });
  response.headers.set("Content-Type", mimeType);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export type AfcDiagnosticVisualRouteDependencies = Readonly<{
  authorize?: (
    options?: AuthorizeAfcDiagnosticsAdminOptions,
  ) => Promise<AfcDiagnosticsAdminAuth>;
  store?: AfcDiagnosticVisualEvidenceStore;
  getStore?: () => AfcDiagnosticVisualEvidenceStore | null;
  authorizeOptions?: AuthorizeAfcDiagnosticsAdminOptions;
  inspectDimensions?: AfcDiagnosticVisualInspectDimensions;
  log?: (entry: AfcDiagnosticVisualEvidenceLog) => void;
}>;

function resolveStore(
  dependencies: AfcDiagnosticVisualRouteDependencies,
): AfcDiagnosticVisualEvidenceStore {
  if (dependencies.store) return dependencies.store;
  if (dependencies.getStore) {
    const store = dependencies.getStore();
    if (!store) throw new AfcDiagnosticVisualStoreError();
    return store;
  }
  return storeFromEnv();
}

async function defaultInspectDimensions(
  bytes: Uint8Array,
): Promise<AfcDiagnosticVisualDimensions | null> {
  try {
    const { inspectImageMetadata } = await import(
      "@/lib/vibodeAutoFloorImageFetch"
    );
    const result = await inspectImageMetadata(Buffer.from(bytes));
    if (!result.ok) return null;
    return { width: result.width, height: result.height };
  } catch {
    return null;
  }
}

export async function handleAfcDiagnosticsAdminVisualArtifactGet(args: {
  request: Request;
  caseId: string;
  generationId: string;
  kind: string;
} & AfcDiagnosticVisualRouteDependencies) {
  const log = args.log ?? defaultLog;
  const caseIdRaw = args.caseId;
  const generationIdRaw = args.generationId;
  const kindRaw = args.kind;
  try {
    const authorize = args.authorize ?? authorizeAfcDiagnosticsAdmin;
    const auth = await authorize(args.authorizeOptions);
    if (!auth.ok) return auth.response;

    const caseId = parseAfcDiagnosticAdminUuid(caseIdRaw);
    const generationId = parseAfcDiagnosticAdminUuid(generationIdRaw);
    const kind = parseAfcDiagnosticVisualArtifactKind(kindRaw);
    if (!caseId || !generationId || !kind) {
      throw new AfcDiagnosticVisualInputError();
    }

    const store = resolveStore(args);
    const artifact = await resolveAfcDiagnosticVisualArtifact({
      store,
      caseId,
      generationId,
      kind,
      inspectDimensions: args.inspectDimensions ?? defaultInspectDimensions,
    });
    return artifactBytesResponse(artifact.bytes, artifact.mimeType);
  } catch (error) {
    if (error instanceof AfcDiagnosticVisualInputError) {
      return artifactErrorResponse(400, "Invalid request.");
    }
    if (error instanceof AfcDiagnosticVisualNotFoundError) {
      return artifactErrorResponse(404, "Not found.");
    }
    if (error instanceof AfcDiagnosticVisualIntegrityError) {
      log({
        caseId: parseAfcDiagnosticAdminUuid(caseIdRaw) ?? "invalid",
        generationId: parseAfcDiagnosticAdminUuid(generationIdRaw) ?? "invalid",
        kind: parseAfcDiagnosticVisualArtifactKind(kindRaw) ?? String(kindRaw),
        expectedShaPrefix: error.expectedShaPrefix,
        actualByteLength: error.actualByteLength,
        reason: error.reason,
      });
      return artifactErrorResponse(
        409,
        "Artifact evidence could not be verified.",
      );
    }
    const parsedCase = parseAfcDiagnosticAdminUuid(caseIdRaw) ?? "invalid";
    const parsedGeneration =
      parseAfcDiagnosticAdminUuid(generationIdRaw) ?? "invalid";
    const parsedKind =
      parseAfcDiagnosticVisualArtifactKind(kindRaw) ?? String(kindRaw);
    const unexpected = args.log ?? unexpectedLog;
    unexpected({
      caseId: parsedCase,
      generationId: parsedGeneration,
      kind: parsedKind,
      expectedShaPrefix: "none",
      actualByteLength: null,
      reason: error instanceof Error ? error.name : "unknown",
    });
    return artifactErrorResponse(500, "Server error.");
  }
}
