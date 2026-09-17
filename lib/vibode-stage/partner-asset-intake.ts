/**
 * PI-5G5A Partner GLB intake foundation.
 *
 * Authorized Partner → server-minted private Storage object → certified
 * furniture-Asset validation → durable intake row. This is not runtime
 * Asset registration. G5A does not write vibode_stage_assets, does not
 * create Partner↔Asset eligibility, and does not mark an Asset ready.
 *
 * Failed intake retry policy: a failed intake remains failed. Changed
 * bytes require a new intake. After validation the Storage object is
 * immutable. G5A does not auto-delete orphan objects.
 *
 * Validator identity: validateFurnitureAsset still requires an assetId
 * argument. G5A passes `intake:{intakeId}` only to satisfy that check.
 * That value is not a runtime Asset ID and is not persisted as one.
 */

import { randomUUID } from "node:crypto";

import { isPlausibleFurnitureAxisM } from "@/lib/afc-v2-runtime/furniture-asset-policy";
import {
  sha256Hex,
  validateFurnitureAsset,
  type AssetValidationIssue,
  type AssetValidationResult,
} from "@/lib/afc-v2-runtime/furniture-asset-validate";

import type { PartnerPortalAuthResult } from "./partner-portal-auth";
import type { PartnerPortalHttpResponse } from "./partner-portal-http";
import {
  isForbiddenBrowserUploadObjectPath,
  PARTNER_RUNTIME_ASSET_OBJECT_PREFIX,
} from "./partner-runtime-asset-id";
import { asNonEmptyString, isPlainObject, isUuidLike } from "./product-variant-register";

export const STAGE_PARTNER_ASSET_INTAKES_TABLE = "vibode_stage_partner_asset_intakes";
export const PARTNER_ASSET_INTAKE_BUCKET = "vibode-stage-assets";
export const PARTNER_ASSET_SIGNED_UPLOAD_EXPIRES_SEC = 2 * 60 * 60;
export const PARTNER_ASSET_INTAKE_OBJECT_NAME = "model.glb";
export const PARTNER_ASSET_INTAKE_MAX_BYTES = 50 * 1024 * 1024;

export const PARTNER_ASSET_INTAKE_STATUSES = Object.freeze([
  "created",
  "uploaded",
  "validating",
  "validated",
  "failed",
] as const);

export type PartnerAssetIntakeStatus = (typeof PARTNER_ASSET_INTAKE_STATUSES)[number];

export const PARTNER_ASSET_INTAKE_DIMENSION_SOURCES = Object.freeze([
  "product",
  "glb",
] as const);

export type PartnerAssetIntakeDimensionSource =
  (typeof PARTNER_ASSET_INTAKE_DIMENSION_SOURCES)[number];

export const PARTNER_ASSET_INTAKE_RETRY_POLICY = Object.freeze({
  failedIntakeRemainsFailed: true,
  changedBytesRequireNewIntake: true,
  validatedObjectIsImmutable: true,
  noSilentByteReplacementAfterValidation: true,
  noGlobalDedupe: true,
  noRuntimeAssetRegistration: true,
});

const CREATE_BODY_KEYS = Object.freeze([
  "originalFileName",
  "byteSize",
  "dimensionSource",
  "authoredWidthM",
  "authoredHeightM",
  "authoredDepthM",
] as const);

const INTAKE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ORIGINAL_FILENAME_MAX = 200;
const VALIDATOR_INTAKE_ASSET_PREFIX = "intake:";

export type PartnerAssetIntakeWarning = Readonly<{
  code: string;
  message: string;
}>;

export type PartnerAssetIntakeRow = Readonly<{
  intakeId: string;
  partnerId: string;
  createdByUserId: string | null;
  status: PartnerAssetIntakeStatus;
  objectPath: string;
  originalFileName: string;
  byteSize: number;
  sha256: string | null;
  dimensionSource: PartnerAssetIntakeDimensionSource;
  authoredWidthM: number | null;
  authoredHeightM: number | null;
  authoredDepthM: number | null;
  measuredWidthM: number | null;
  measuredHeightM: number | null;
  measuredDepthM: number | null;
  placementScale: number | null;
  validationWarnings: readonly PartnerAssetIntakeWarning[];
  errorCode: string | null;
  errorDetail: string | null;
  assetId?: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PartnerAssetIntakeDto = Readonly<{
  intakeId: string;
  status: PartnerAssetIntakeStatus;
  originalFileName: string;
  dimensionSource: PartnerAssetIntakeDimensionSource;
  authoredWidthM: number | null;
  authoredHeightM: number | null;
  authoredDepthM: number | null;
  measuredWidthM: number | null;
  measuredHeightM: number | null;
  measuredDepthM: number | null;
  sha256: string | null;
  warnings: readonly PartnerAssetIntakeWarning[];
  errorCode: string | null;
  error: string | null;
  assetId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PartnerAssetSignedUpload = Readonly<{
  signedUrl: string;
  token: string;
  path: string;
  expiresInSec: number;
}>;

export type PartnerAssetIntakeStore = Readonly<{
  insertCreated(row: PartnerAssetIntakeRow): Promise<
    | { ok: true; row: PartnerAssetIntakeRow }
    | { ok: false; code: "unique_conflict" | "failed" }
  >;
  findById(partnerId: string, intakeId: string): Promise<PartnerAssetIntakeRow | null>;
  findByIntakeId(intakeId: string): Promise<PartnerAssetIntakeRow | null>;
  listByPartner(partnerId: string): Promise<readonly PartnerAssetIntakeRow[]>;
  claimForValidation(partnerId: string, intakeId: string, nowIso: string): Promise<
    | { ok: true; kind: "claimed"; row: PartnerAssetIntakeRow }
    | { ok: true; kind: "already_validated" | "already_failed"; row: PartnerAssetIntakeRow }
    | { ok: false; code: "not_found" | "conflict" | "failed" }
  >;
  completeValidation(input: Readonly<{
    partnerId: string;
    intakeId: string;
    status: "validated" | "failed";
    sha256: string | null;
    measuredWidthM: number | null;
    measuredHeightM: number | null;
    measuredDepthM: number | null;
    placementScale: number | null;
    validationWarnings: readonly PartnerAssetIntakeWarning[];
    errorCode: string | null;
    errorDetail: string | null;
    nowIso: string;
  }>): Promise<{ ok: true; row: PartnerAssetIntakeRow } | { ok: false; code: "failed" }>;
}>;

export type PartnerAssetIntakeObjectStore = Readonly<{
  createSignedUpload(input: Readonly<{
    objectPath: string;
    upsert: boolean;
  }>): Promise<{ ok: true; upload: PartnerAssetSignedUpload } | { ok: false }>;
  download(objectPath: string): Promise<
    | { ok: true; bytes: Uint8Array }
    | { ok: false; code: "missing" | "failed" }
  >;
}>;

function jsonError(
  status: number,
  errorCode: string,
  error: string,
  extra: Record<string, unknown> = {},
): PartnerPortalHttpResponse {
  return { status, body: { ok: false, error, errorCode, ...extra } };
}

export function merchantMessageForIntakeErrorCode(code: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Unauthorized";
    case "FORBIDDEN":
      return "Forbidden";
    case "INTAKE_NOT_FOUND":
      return "Intake not found.";
    case "INVALID_FILENAME":
      return "Choose a .glb file.";
    case "INVALID_DIMENSIONS":
      return "Width, height, and depth must be entered in metres as positive numbers.";
    case "INVALID_BYTE_SIZE":
      return "File size is invalid.";
    case "FILE_TOO_LARGE":
      return "The GLB must be 50 MiB or smaller.";
    case "BYTE_SIZE_MISMATCH":
      return "The uploaded file size does not match the declared size.";
    case "OBJECT_MISSING":
    case "FILE_MISSING":
      return "The uploaded file was not found. Upload the GLB and try again.";
    case "MALFORMED_GLB":
    case "PARSE_FAILED":
      return "This file is not a valid GLB.";
    case "EXTERNAL_URI":
      return "The GLB must be self-contained and cannot reference external files.";
    case "EMPTY_SCENE":
      return "The GLB has no mesh geometry.";
    case "IMPLAUSIBLE_SIZE":
      return "The GLB dimensions are not plausible furniture sizes in metres.";
    case "DIMENSION_MISMATCH":
      return "The GLB dimensions do not match the actual product dimensions you entered. Confirm the product dimensions and make sure the GLB is modeled at real-world scale.";
    case "NEGATIVE_SCALE":
      return "The GLB contains a negative scale and cannot be used.";
    case "NON_UNIT_PLACEMENT_SCALE":
      return "The GLB is not authored at real-world scale. Vibode does not automatically resize furniture.";
    case "FINALIZE_IN_PROGRESS":
      return "This upload is already being validated.";
    case "INVALID_REQUEST":
      return "Invalid request.";
    case "SERVICE_UNAVAILABLE":
      return "Partner Portal is unavailable.";
    default:
      return "The GLB could not be validated.";
  }
}

export function httpFromIntakeAuth(auth: PartnerPortalAuthResult): PartnerPortalHttpResponse | null {
  if (auth.ok) return null;
  const errorCode = auth.status === 401
    ? "UNAUTHORIZED"
    : auth.status === 403
      ? "FORBIDDEN"
      : auth.status === 409
        ? "MULTIPLE_MEMBERSHIPS"
        : "SERVICE_UNAVAILABLE";
  return jsonError(auth.status, errorCode, auth.error);
}

export function isPartnerAssetIntakeStatus(value: string): value is PartnerAssetIntakeStatus {
  return (PARTNER_ASSET_INTAKE_STATUSES as readonly string[]).includes(value);
}

export function isPartnerAssetIntakeDimensionSource(
  value: string,
): value is PartnerAssetIntakeDimensionSource {
  return (PARTNER_ASSET_INTAKE_DIMENSION_SOURCES as readonly string[]).includes(value);
}

export function canMintPartnerAssetIntakeUpload(status: PartnerAssetIntakeStatus): boolean {
  return status === "created" || status === "uploaded";
}

export function validatorAssetIdForIntake(intakeId: string): string {
  return `${VALIDATOR_INTAKE_ASSET_PREFIX}${intakeId}`;
}

export function partnerAssetIntakeObjectPath(partnerId: string, intakeId: string): string | null {
  if (!INTAKE_PATH_SEGMENT.test(partnerId) || partnerId.includes("..")) return null;
  if (!isUuidLike(intakeId)) return null;
  return `partners/${partnerId}/intakes/${intakeId}/${PARTNER_ASSET_INTAKE_OBJECT_NAME}`;
}

function basenameOf(fileName: string): string {
  const trimmed = fileName.trim();
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

export function sanitizeOriginalGlbFileName(value: unknown):
  | { ok: true; fileName: string }
  | { ok: false; errorCode: "INVALID_FILENAME" } {
  if (typeof value !== "string") return { ok: false, errorCode: "INVALID_FILENAME" };
  const base = basenameOf(value);
  if (!base || base === "." || base === ".." || base.includes("..")) {
    return { ok: false, errorCode: "INVALID_FILENAME" };
  }
  if (base.length > ORIGINAL_FILENAME_MAX) return { ok: false, errorCode: "INVALID_FILENAME" };
  if (/[\u0000-\u001f\u007f]/.test(base)) return { ok: false, errorCode: "INVALID_FILENAME" };
  if (!/^[A-Za-z0-9._ -]+\.glb$/i.test(base)) return { ok: false, errorCode: "INVALID_FILENAME" };
  if (base.toLowerCase() === ".glb") return { ok: false, errorCode: "INVALID_FILENAME" };
  return { ok: true, fileName: base };
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asPositiveInt(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function extraKeys(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body).filter((key) => !allowed.includes(key));
}

export function parsePartnerAssetIntakeCreateBody(body: unknown):
  | {
      ok: true;
      originalFileName: string;
      byteSize: number;
      dimensionSource: PartnerAssetIntakeDimensionSource;
      authoredWidthM: number | null;
      authoredHeightM: number | null;
      authoredDepthM: number | null;
    }
  | { ok: false; errorCode: string } {
  if (!isPlainObject(body)) return { ok: false, errorCode: "INVALID_REQUEST" };
  if (extraKeys(body, CREATE_BODY_KEYS).length > 0) {
    return { ok: false, errorCode: "INVALID_REQUEST" };
  }
  const fileName = sanitizeOriginalGlbFileName(body.originalFileName);
  if (!fileName.ok) return { ok: false, errorCode: "INVALID_FILENAME" };
  const byteSize = asPositiveInt(body.byteSize);
  if (byteSize == null) return { ok: false, errorCode: "INVALID_BYTE_SIZE" };
  if (byteSize > PARTNER_ASSET_INTAKE_MAX_BYTES) return { ok: false, errorCode: "FILE_TOO_LARGE" };

  let dimensionSource: PartnerAssetIntakeDimensionSource = "product";
  if (body.dimensionSource !== undefined) {
    if (
      typeof body.dimensionSource !== "string" ||
      !isPartnerAssetIntakeDimensionSource(body.dimensionSource)
    ) {
      return { ok: false, errorCode: "INVALID_REQUEST" };
    }
    dimensionSource = body.dimensionSource;
  }

  const authoredPresent =
    Object.hasOwn(body, "authoredWidthM") ||
    Object.hasOwn(body, "authoredHeightM") ||
    Object.hasOwn(body, "authoredDepthM");

  if (dimensionSource === "glb") {
    if (authoredPresent) return { ok: false, errorCode: "INVALID_REQUEST" };
    return {
      ok: true,
      originalFileName: fileName.fileName,
      byteSize,
      dimensionSource,
      authoredWidthM: null,
      authoredHeightM: null,
      authoredDepthM: null,
    };
  }

  const authoredWidthM = asFiniteNumber(body.authoredWidthM);
  const authoredHeightM = asFiniteNumber(body.authoredHeightM);
  const authoredDepthM = asFiniteNumber(body.authoredDepthM);
  if (
    authoredWidthM == null || authoredHeightM == null || authoredDepthM == null ||
    authoredWidthM <= 0 || authoredHeightM <= 0 || authoredDepthM <= 0
  ) {
    return { ok: false, errorCode: "INVALID_DIMENSIONS" };
  }
  if (
    !isPlausibleFurnitureAxisM(authoredWidthM) ||
    !isPlausibleFurnitureAxisM(authoredHeightM) ||
    !isPlausibleFurnitureAxisM(authoredDepthM)
  ) {
    return { ok: false, errorCode: "INVALID_DIMENSIONS" };
  }
  return {
    ok: true,
    originalFileName: fileName.fileName,
    byteSize,
    dimensionSource,
    authoredWidthM,
    authoredHeightM,
    authoredDepthM,
  };
}

export function parsePartnerAssetIntakeFinalizeBody(body: unknown):
  | { ok: true }
  | { ok: false; errorCode: "INVALID_REQUEST" } {
  if (body == null) return { ok: true };
  if (!isPlainObject(body)) return { ok: false, errorCode: "INVALID_REQUEST" };
  if (Object.keys(body).length > 0) return { ok: false, errorCode: "INVALID_REQUEST" };
  return { ok: true };
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseWarnings(value: unknown): PartnerAssetIntakeWarning[] {
  if (!Array.isArray(value)) return [];
  const warnings: PartnerAssetIntakeWarning[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const code = asNonEmptyString(item.code);
    const message = asNonEmptyString(item.message);
    if (!code || !message) continue;
    warnings.push({ code, message });
  }
  return warnings;
}

export function mapPartnerAssetIntakeRow(row: Record<string, unknown>): PartnerAssetIntakeRow | null {
  const intakeId = asNonEmptyString(row.intake_id);
  const partnerId = asNonEmptyString(row.partner_id);
  const statusRaw = asNonEmptyString(row.status);
  const objectPath = asNonEmptyString(row.object_path);
  const originalFileName = asNonEmptyString(row.original_filename);
  const byteSize = asNullableNumber(row.byte_size);
  const dimensionSourceRaw = asNonEmptyString(row.dimension_source) ?? "product";
  const authoredWidthM = asNullableNumber(row.authored_width_m);
  const authoredHeightM = asNullableNumber(row.authored_height_m);
  const authoredDepthM = asNullableNumber(row.authored_depth_m);
  const createdAt = asNonEmptyString(row.created_at);
  const updatedAt = asNonEmptyString(row.updated_at);
  if (
    !intakeId || !partnerId || !statusRaw || !isPartnerAssetIntakeStatus(statusRaw) ||
    !isPartnerAssetIntakeDimensionSource(dimensionSourceRaw) ||
    !objectPath || !originalFileName || byteSize == null || byteSize <= 0 ||
    !createdAt || !updatedAt
  ) {
    return null;
  }
  if (dimensionSourceRaw === "product") {
    if (authoredWidthM == null || authoredHeightM == null || authoredDepthM == null) return null;
  } else if (authoredWidthM != null || authoredHeightM != null || authoredDepthM != null) {
    return null;
  }
  return {
    intakeId,
    partnerId,
    createdByUserId: asNonEmptyString(row.created_by_user_id),
    status: statusRaw,
    objectPath,
    originalFileName,
    byteSize,
    sha256: asNonEmptyString(row.sha256),
    dimensionSource: dimensionSourceRaw,
    authoredWidthM,
    authoredHeightM,
    authoredDepthM,
    measuredWidthM: asNullableNumber(row.measured_width_m),
    measuredHeightM: asNullableNumber(row.measured_height_m),
    measuredDepthM: asNullableNumber(row.measured_depth_m),
    placementScale: asNullableNumber(row.placement_scale),
    validationWarnings: parseWarnings(row.validation_warnings),
    errorCode: asNonEmptyString(row.error_code),
    errorDetail: asNonEmptyString(row.error_detail),
    createdAt,
    updatedAt,
    ...(asNonEmptyString(row.asset_id) ? { assetId: asNonEmptyString(row.asset_id) } : {}),
  };
}

export function toPartnerAssetIntakeDto(row: PartnerAssetIntakeRow): PartnerAssetIntakeDto {
  return {
    intakeId: row.intakeId,
    status: row.status,
    originalFileName: row.originalFileName,
    dimensionSource: row.dimensionSource,
    authoredWidthM: row.authoredWidthM,
    authoredHeightM: row.authoredHeightM,
    authoredDepthM: row.authoredDepthM,
    measuredWidthM: row.measuredWidthM,
    measuredHeightM: row.measuredHeightM,
    measuredDepthM: row.measuredDepthM,
    sha256: row.sha256,
    warnings: row.validationWarnings,
    errorCode: row.errorCode,
    error: row.errorCode ? merchantMessageForIntakeErrorCode(row.errorCode) : null,
    assetId: row.assetId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createMemoryPartnerAssetIntakeStore(
  seed: readonly PartnerAssetIntakeRow[] = [],
): PartnerAssetIntakeStore & { rows: PartnerAssetIntakeRow[] } {
  const rows = [...seed];
  return {
    rows,
    async insertCreated(row) {
      if (rows.some((item) => item.intakeId === row.intakeId || item.objectPath === row.objectPath)) {
        return { ok: false, code: "unique_conflict" };
      }
      rows.push(row);
      return { ok: true, row };
    },
    async findById(partnerId, intakeId) {
      return rows.find((item) => item.partnerId === partnerId && item.intakeId === intakeId) ?? null;
    },
    async findByIntakeId(intakeId) {
      return rows.find((item) => item.intakeId === intakeId) ?? null;
    },
    async listByPartner(partnerId) {
      return rows
        .filter((item) => item.partnerId === partnerId)
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.intakeId.localeCompare(left.intakeId));
    },
    async claimForValidation(partnerId, intakeId, nowIso) {
      const index = rows.findIndex((item) => item.partnerId === partnerId && item.intakeId === intakeId);
      if (index < 0) return { ok: false, code: "not_found" };
      const current = rows[index]!;
      if (current.status === "validated") return { ok: true, kind: "already_validated", row: current };
      if (current.status === "failed") return { ok: true, kind: "already_failed", row: current };
      if (current.status === "validating") return { ok: false, code: "conflict" };
      if (current.status !== "created" && current.status !== "uploaded") {
        return { ok: false, code: "conflict" };
      }
      const next: PartnerAssetIntakeRow = { ...current, status: "validating", updatedAt: nowIso };
      rows[index] = next;
      return { ok: true, kind: "claimed", row: next };
    },
    async completeValidation(input) {
      const index = rows.findIndex((item) => item.partnerId === input.partnerId && item.intakeId === input.intakeId);
      if (index < 0) return { ok: false, code: "failed" };
      const current = rows[index]!;
      if (current.status !== "validating") return { ok: false, code: "failed" };
      const next: PartnerAssetIntakeRow = {
        ...current,
        status: input.status,
        sha256: input.sha256,
        measuredWidthM: input.measuredWidthM,
        measuredHeightM: input.measuredHeightM,
        measuredDepthM: input.measuredDepthM,
        placementScale: input.placementScale,
        validationWarnings: [...input.validationWarnings],
        errorCode: input.errorCode,
        errorDetail: input.errorDetail,
        updatedAt: input.nowIso,
      };
      rows[index] = next;
      return { ok: true, row: next };
    },
  };
}

export function createMemoryPartnerAssetObjectStore(): PartnerAssetIntakeObjectStore & {
  objects: Map<string, Uint8Array>;
  put(objectPath: string, bytes: Uint8Array): void;
  uploadFinal(input: Readonly<{
    objectPath: string;
    bytes: Uint8Array;
    contentType: string;
    upsert: false;
  }>): Promise<
    | { ok: true; kind: "written" | "exists" }
    | { ok: false; code: "failed" }
  >;
} {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put(objectPath, bytes) {
      objects.set(objectPath, bytes);
    },
    async createSignedUpload(input) {
      if (isForbiddenBrowserUploadObjectPath(input.objectPath)) return { ok: false };
      const token = `intake-upload:${input.objectPath}`;
      const signedUrl =
        `https://example.test/storage/v1/object/upload/sign/${PARTNER_ASSET_INTAKE_BUCKET}/` +
        `${input.objectPath}?token=${encodeURIComponent(token)}`;
      return {
        ok: true,
        upload: {
          signedUrl,
          token,
          path: input.objectPath,
          expiresInSec: PARTNER_ASSET_SIGNED_UPLOAD_EXPIRES_SEC,
        },
      };
    },
    async download(objectPath) {
      const bytes = objects.get(objectPath);
      if (!bytes) return { ok: false, code: "missing" };
      return { ok: true, bytes };
    },
    async uploadFinal(input) {
      if (input.upsert !== false) return { ok: false, code: "failed" };
      if (input.contentType !== "model/gltf-binary") return { ok: false, code: "failed" };
      if (
        !input.objectPath.startsWith(PARTNER_RUNTIME_ASSET_OBJECT_PREFIX) ||
        input.objectPath.includes("..") ||
        input.objectPath.startsWith("/")
      ) {
        return { ok: false, code: "failed" };
      }
      const existing = objects.get(input.objectPath);
      if (existing) return { ok: true, kind: "exists" };
      objects.set(input.objectPath, new Uint8Array(input.bytes));
      return { ok: true, kind: "written" };
    },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function createPartnerAssetIntake(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerAssetIntakeStore;
  objects: PartnerAssetIntakeObjectStore;
  body: unknown;
  intakeId?: string;
  nowIso?: string;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return httpFromIntakeAuth(input.auth)!;
  const parsed = parsePartnerAssetIntakeCreateBody(input.body);
  if (!parsed.ok) {
    return jsonError(400, parsed.errorCode, merchantMessageForIntakeErrorCode(parsed.errorCode));
  }
  const partnerId = input.auth.context.partnerId;
  const intakeId = input.intakeId ?? randomUUID();
  const objectPath = partnerAssetIntakeObjectPath(partnerId, intakeId);
  if (!objectPath) {
    return jsonError(500, "SERVICE_UNAVAILABLE", merchantMessageForIntakeErrorCode("SERVICE_UNAVAILABLE"));
  }
  const createdAt = input.nowIso ?? nowIso();
  const row: PartnerAssetIntakeRow = {
    intakeId,
    partnerId,
    createdByUserId: input.auth.context.userId,
    status: "created",
    objectPath,
    originalFileName: parsed.originalFileName,
    byteSize: parsed.byteSize,
    sha256: null,
    dimensionSource: parsed.dimensionSource,
    authoredWidthM: parsed.authoredWidthM,
    authoredHeightM: parsed.authoredHeightM,
    authoredDepthM: parsed.authoredDepthM,
    measuredWidthM: null,
    measuredHeightM: null,
    measuredDepthM: null,
    placementScale: null,
    validationWarnings: [],
    errorCode: null,
    errorDetail: null,
    createdAt,
    updatedAt: createdAt,
  };
  const inserted = await input.store.insertCreated(row);
  if (!inserted.ok) {
    return jsonError(500, "SERVICE_UNAVAILABLE", merchantMessageForIntakeErrorCode("SERVICE_UNAVAILABLE"));
  }
  const signed = await input.objects.createSignedUpload({ objectPath, upsert: true });
  if (!signed.ok) {
    return jsonError(500, "SERVICE_UNAVAILABLE", merchantMessageForIntakeErrorCode("SERVICE_UNAVAILABLE"));
  }
  return {
    status: 201,
    body: {
      ok: true,
      intakeId,
      objectPath,
      signedUrl: signed.upload.signedUrl,
      token: signed.upload.token,
      expiresInSec: signed.upload.expiresInSec,
      maxBytes: PARTNER_ASSET_INTAKE_MAX_BYTES,
      intake: toPartnerAssetIntakeDto(inserted.row),
    },
  };
}

export async function listPartnerAssetIntakes(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerAssetIntakeStore;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return httpFromIntakeAuth(input.auth)!;
  const rows = await input.store.listByPartner(input.auth.context.partnerId);
  return {
    status: 200,
    body: {
      ok: true,
      intakes: rows.map(toPartnerAssetIntakeDto),
    },
  };
}

export async function mintPartnerAssetIntakeUpload(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerAssetIntakeStore;
  objects: PartnerAssetIntakeObjectStore;
  intakeId: string;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return httpFromIntakeAuth(input.auth)!;
  if (!isUuidLike(input.intakeId)) {
    return jsonError(404, "INTAKE_NOT_FOUND", merchantMessageForIntakeErrorCode("INTAKE_NOT_FOUND"));
  }
  const row = await input.store.findById(input.auth.context.partnerId, input.intakeId);
  if (!row) {
    return jsonError(404, "INTAKE_NOT_FOUND", merchantMessageForIntakeErrorCode("INTAKE_NOT_FOUND"));
  }
  if (!canMintPartnerAssetIntakeUpload(row.status)) {
    return jsonError(409, "FINALIZE_CONFLICT", "This intake can no longer accept a new upload.");
  }
  const signed = await input.objects.createSignedUpload({ objectPath: row.objectPath, upsert: true });
  if (!signed.ok) {
    return jsonError(500, "SERVICE_UNAVAILABLE", merchantMessageForIntakeErrorCode("SERVICE_UNAVAILABLE"));
  }
  return {
    status: 200,
    body: {
      ok: true,
      intakeId: row.intakeId,
      objectPath: row.objectPath,
      signedUrl: signed.upload.signedUrl,
      token: signed.upload.token,
      expiresInSec: signed.upload.expiresInSec,
      maxBytes: PARTNER_ASSET_INTAKE_MAX_BYTES,
    },
  };
}

function warningsFrom(issues: readonly AssetValidationIssue[]): PartnerAssetIntakeWarning[] {
  return issues.map((item) => ({ code: item.code, message: item.message }));
}

export function persistableIntakeFromValidation(result: AssetValidationResult): Readonly<{
  status: "validated" | "failed";
  sha256: string | null;
  measuredWidthM: number | null;
  measuredHeightM: number | null;
  measuredDepthM: number | null;
  placementScale: number | null;
  validationWarnings: readonly PartnerAssetIntakeWarning[];
  errorCode: string | null;
  errorDetail: string | null;
}> {
  const warnings = warningsFrom(result.warnings);
  if (result.accepted) {
    return {
      status: "validated",
      sha256: result.sha256,
      measuredWidthM: result.measured?.widthM ?? null,
      measuredHeightM: result.measured?.heightM ?? null,
      measuredDepthM: result.measured?.depthM ?? null,
      placementScale: result.placementScale,
      validationWarnings: warnings,
      errorCode: null,
      errorDetail: null,
    };
  }
  const errorCode = result.errors[0]?.code ?? "VALIDATION_FAILED";
  return {
    status: "failed",
    sha256: result.sha256 || null,
    measuredWidthM: result.measured?.widthM ?? null,
    measuredHeightM: result.measured?.heightM ?? null,
    measuredDepthM: result.measured?.depthM ?? null,
    placementScale: result.placementScale,
    validationWarnings: warnings,
    errorCode,
    errorDetail: JSON.stringify(result.errors),
  };
}

async function failClaimedIntake(input: Readonly<{
  store: PartnerAssetIntakeStore;
  partnerId: string;
  intakeId: string;
  errorCode: string;
  errorDetail: string | null;
  sha256: string | null;
  nowIso: string;
}>): Promise<PartnerPortalHttpResponse> {
  const completed = await input.store.completeValidation({
    partnerId: input.partnerId,
    intakeId: input.intakeId,
    status: "failed",
    sha256: input.sha256,
    measuredWidthM: null,
    measuredHeightM: null,
    measuredDepthM: null,
    placementScale: null,
    validationWarnings: [],
    errorCode: input.errorCode,
    errorDetail: input.errorDetail,
    nowIso: input.nowIso,
  });
  if (!completed.ok) {
    return jsonError(500, "SERVICE_UNAVAILABLE", merchantMessageForIntakeErrorCode("SERVICE_UNAVAILABLE"));
  }
  return {
    status: 400,
    body: {
      ok: false,
      error: merchantMessageForIntakeErrorCode(input.errorCode),
      errorCode: input.errorCode,
      intake: toPartnerAssetIntakeDto(completed.row),
    },
  };
}

export async function finalizePartnerAssetIntake(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerAssetIntakeStore;
  objects: PartnerAssetIntakeObjectStore;
  intakeId: string;
  body?: unknown;
  nowIso?: string;
  validate?: typeof validateFurnitureAsset;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return httpFromIntakeAuth(input.auth)!;
  const parsedBody = parsePartnerAssetIntakeFinalizeBody(input.body ?? {});
  if (!parsedBody.ok) {
    return jsonError(400, parsedBody.errorCode, merchantMessageForIntakeErrorCode(parsedBody.errorCode));
  }
  if (!isUuidLike(input.intakeId)) {
    return jsonError(404, "INTAKE_NOT_FOUND", merchantMessageForIntakeErrorCode("INTAKE_NOT_FOUND"));
  }
  const partnerId = input.auth.context.partnerId;
  const existing = await input.store.findById(partnerId, input.intakeId);
  if (!existing) {
    return jsonError(404, "INTAKE_NOT_FOUND", merchantMessageForIntakeErrorCode("INTAKE_NOT_FOUND"));
  }
  if (existing.status === "validated") {
    return { status: 200, body: { ok: true, intake: toPartnerAssetIntakeDto(existing), idempotent: true } };
  }
  if (existing.status === "failed") {
    const dto = toPartnerAssetIntakeDto(existing);
    return {
      status: 400,
      body: {
        ok: false,
        error: dto.error ?? merchantMessageForIntakeErrorCode(dto.errorCode ?? "VALIDATION_FAILED"),
        errorCode: dto.errorCode ?? "VALIDATION_FAILED",
        intake: dto,
        idempotent: true,
      },
    };
  }
  if (existing.status === "validating") {
    return jsonError(409, "FINALIZE_IN_PROGRESS", merchantMessageForIntakeErrorCode("FINALIZE_IN_PROGRESS"));
  }

  const downloaded = await input.objects.download(existing.objectPath);
  if (!downloaded.ok) {
    if (downloaded.code === "missing") {
      return jsonError(409, "OBJECT_MISSING", merchantMessageForIntakeErrorCode("OBJECT_MISSING"));
    }
    return jsonError(500, "SERVICE_UNAVAILABLE", merchantMessageForIntakeErrorCode("SERVICE_UNAVAILABLE"));
  }

  const claimed = await input.store.claimForValidation(partnerId, input.intakeId, input.nowIso ?? nowIso());
  if (!claimed.ok) {
    if (claimed.code === "not_found") {
      return jsonError(404, "INTAKE_NOT_FOUND", merchantMessageForIntakeErrorCode("INTAKE_NOT_FOUND"));
    }
    if (claimed.code === "conflict") {
      return jsonError(409, "FINALIZE_IN_PROGRESS", merchantMessageForIntakeErrorCode("FINALIZE_IN_PROGRESS"));
    }
    return jsonError(500, "SERVICE_UNAVAILABLE", merchantMessageForIntakeErrorCode("SERVICE_UNAVAILABLE"));
  }
  if (claimed.kind === "already_validated") {
    return { status: 200, body: { ok: true, intake: toPartnerAssetIntakeDto(claimed.row), idempotent: true } };
  }
  if (claimed.kind === "already_failed") {
    const dto = toPartnerAssetIntakeDto(claimed.row);
    return {
      status: 400,
      body: {
        ok: false,
        error: dto.error ?? merchantMessageForIntakeErrorCode(dto.errorCode ?? "VALIDATION_FAILED"),
        errorCode: dto.errorCode ?? "VALIDATION_FAILED",
        intake: dto,
        idempotent: true,
      },
    };
  }

  const row = claimed.row;
  const stamp = input.nowIso ?? nowIso();

  const bytes = downloaded.bytes;
  const actualSize = bytes.byteLength;
  if (actualSize > PARTNER_ASSET_INTAKE_MAX_BYTES) {
    return failClaimedIntake({
      store: input.store,
      partnerId,
      intakeId: row.intakeId,
      errorCode: "FILE_TOO_LARGE",
      errorDetail: `Actual size ${actualSize} exceeds ${PARTNER_ASSET_INTAKE_MAX_BYTES}.`,
      sha256: sha256Hex(bytes),
      nowIso: stamp,
    });
  }
  if (actualSize !== row.byteSize) {
    return failClaimedIntake({
      store: input.store,
      partnerId,
      intakeId: row.intakeId,
      errorCode: "BYTE_SIZE_MISMATCH",
      errorDetail: `Declared ${row.byteSize} bytes, downloaded ${actualSize} bytes.`,
      sha256: sha256Hex(bytes),
      nowIso: stamp,
    });
  }

  const validate = input.validate ?? validateFurnitureAsset;
  let result: AssetValidationResult;
  try {
    const glbMode = row.dimensionSource === "glb";
    if (
      !glbMode &&
      (row.authoredWidthM == null || row.authoredHeightM == null || row.authoredDepthM == null)
    ) {
      return failClaimedIntake({
        store: input.store,
        partnerId,
        intakeId: row.intakeId,
        errorCode: "INVALID_DIMENSIONS",
        errorDetail: "Product-mode intake is missing authored dimensions.",
        sha256: sha256Hex(bytes),
        nowIso: stamp,
      });
    }
    result = await validate({
      bytes,
      glbPath: row.objectPath,
      assetId: validatorAssetIdForIntake(row.intakeId),
      maxBytes: PARTNER_ASSET_INTAKE_MAX_BYTES,
      ...(glbMode
        ? { dimensionAuthority: "measured" as const }
        : {
            declaredWidthM: row.authoredWidthM as number,
            declaredHeightM: row.authoredHeightM as number,
            declaredDepthM: row.authoredDepthM as number,
          }),
    });
  } catch (error) {
    return failClaimedIntake({
      store: input.store,
      partnerId,
      intakeId: row.intakeId,
      errorCode: "VALIDATION_FAILED",
      errorDetail: error instanceof Error ? error.message : "Validator threw.",
      sha256: sha256Hex(bytes),
      nowIso: stamp,
    });
  }

  const persistable = persistableIntakeFromValidation(result);
  const completed = await input.store.completeValidation({
    partnerId,
    intakeId: row.intakeId,
    ...persistable,
    nowIso: stamp,
  });
  if (!completed.ok) {
    return jsonError(500, "SERVICE_UNAVAILABLE", merchantMessageForIntakeErrorCode("SERVICE_UNAVAILABLE"));
  }
  const dto = toPartnerAssetIntakeDto(completed.row);
  if (persistable.status === "validated") {
    return { status: 200, body: { ok: true, intake: dto, idempotent: false } };
  }
  return {
    status: 400,
    body: {
      ok: false,
      error: dto.error ?? merchantMessageForIntakeErrorCode(dto.errorCode ?? "VALIDATION_FAILED"),
      errorCode: dto.errorCode ?? "VALIDATION_FAILED",
      intake: dto,
    },
  };
}
