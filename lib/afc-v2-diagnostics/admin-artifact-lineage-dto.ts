/**
 * Browser-safe Admin artifact-lineage DTO.
 *
 * Decodes the sanitized inspector payload. Does not replay the reader and
 * does not import the production capture path.
 */

import {
  publishAfcDiagnosticMetricHash,
  publishAfcDiagnosticMetricToken,
} from "./admin-metric-decision-dto";

export const AFC_DIAGNOSTIC_ADMIN_ARTIFACT_LINEAGE_SCHEMA_VERSION =
  "afc-v2-artifact-lineage-diagnostic/v1" as const;

const EMPTY_SOURCES = ["generated", "process_cache", "durable", "unknown"] as const;
const TILED_SOURCES = ["generated", "durable", "unknown"] as const;
const READER_STATUSES = ["ok", "failed"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type AfcDiagnosticAdminArtifactLineagePoint = Readonly<{ x: number; y: number }>;

export type AfcDiagnosticAdminArtifactLineageEmpty = Readonly<{
  sha256: string | null;
  byteCount: number | null;
  width: number | null;
  height: number | null;
  source: (typeof EMPTY_SOURCES)[number];
  reusedFromGenerationId: string | null;
}>;

export type AfcDiagnosticAdminArtifactLineageTiled = Readonly<{
  sha256: string | null;
  byteCount: number | null;
  width: number | null;
  height: number | null;
  source: (typeof TILED_SOURCES)[number];
  reusedFromGenerationId: string | null;
  generatorId: string | null;
  profileId: string | null;
  researchPreset: string | null;
  requestedModelId: string | null;
  provenanceRunId: string | null;
}>;

export type AfcDiagnosticAdminArtifactLineageCore = Readonly<{
  rows: number;
  columns: number;
  j0: number;
  i0: number;
}>;

export type AfcDiagnosticAdminArtifactLineageReader = Readonly<{
  readerVersion: string | null;
  status: (typeof READER_STATUSES)[number] | null;
  rawQuadCount: number | null;
  deduplicatedCellCount: number | null;
  selectedComponentTileCount: number | null;
  selectedCore: AfcDiagnosticAdminArtifactLineageCore | null;
  latticeReprojectionMeanPx: number | null;
  latticeReprojectionMaxPx: number | null;
  selectedPolygon: readonly [
    AfcDiagnosticAdminArtifactLineagePoint,
    AfcDiagnosticAdminArtifactLineagePoint,
    AfcDiagnosticAdminArtifactLineagePoint,
    AfcDiagnosticAdminArtifactLineagePoint,
  ] | null;
}>;

export type AfcDiagnosticAdminArtifactLineageValue = Readonly<{
  empty: AfcDiagnosticAdminArtifactLineageEmpty;
  tiled: AfcDiagnosticAdminArtifactLineageTiled;
  reader: AfcDiagnosticAdminArtifactLineageReader;
}>;

export type AfcDiagnosticAdminArtifactLineage =
  | null
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "unsupported_schema"; schemaVersion: string }>
  | Readonly<{
      kind: "recorded";
      schemaVersion: typeof AFC_DIAGNOSTIC_ADMIN_ARTIFACT_LINEAGE_SCHEMA_VERSION;
      value: AfcDiagnosticAdminArtifactLineageValue;
    }>;

const VALUE_KEYS = ["empty", "tiled", "reader"] as const;
const EMPTY_KEYS = [
  "sha256",
  "byteCount",
  "width",
  "height",
  "source",
  "reusedFromGenerationId",
] as const;
const TILED_KEYS = [
  "sha256",
  "byteCount",
  "width",
  "height",
  "source",
  "reusedFromGenerationId",
  "generatorId",
  "profileId",
  "researchPreset",
  "requestedModelId",
  "provenanceRunId",
] as const;
const READER_KEYS = [
  "readerVersion",
  "status",
  "rawQuadCount",
  "deduplicatedCellCount",
  "selectedComponentTileCount",
  "selectedCore",
  "latticeReprojectionMeanPx",
  "latticeReprojectionMaxPx",
  "selectedPolygon",
] as const;
const CORE_KEYS = ["rows", "columns", "j0", "i0"] as const;

function unreadable(): AfcDiagnosticAdminArtifactLineage {
  return Object.freeze({ kind: "unreadable" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

function nullableHash(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string"
    ? publishAfcDiagnosticMetricHash(value)?.toLowerCase() ?? undefined
    : undefined;
}

function nullableToken(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string"
    ? publishAfcDiagnosticMetricToken(value) ?? undefined
    : undefined;
}

function nullableUuid(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined;
}

function nullableRunId(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string" && RUN_ID.test(value) ? value : undefined;
}

function nullablePositiveInteger(value: unknown): number | null | undefined {
  if (value == null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function nullableCount(value: unknown): number | null | undefined {
  if (value == null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function nullableFinite(value: unknown): number | null | undefined {
  if (value == null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function point(value: unknown): AfcDiagnosticAdminArtifactLineagePoint | null {
  if (!isRecord(value) || !exactKeys(value, ["x", "y"])) return null;
  if (typeof value.x !== "number" || typeof value.y !== "number") return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return Object.freeze({ x: value.x, y: value.y });
}

function polygon(
  value: unknown,
): AfcDiagnosticAdminArtifactLineageReader["selectedPolygon"] | null | undefined {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const points = value.map(point);
  if (points.some((entry) => entry == null)) return undefined;
  return Object.freeze(points) as AfcDiagnosticAdminArtifactLineageReader["selectedPolygon"];
}

function core(
  value: unknown,
): AfcDiagnosticAdminArtifactLineageCore | null | undefined {
  if (value == null) return null;
  if (!isRecord(value) || !exactKeys(value, CORE_KEYS)) return undefined;
  const rows = nullablePositiveInteger(value.rows);
  const columns = nullablePositiveInteger(value.columns);
  const j0 = nullableSafeInteger(value.j0);
  const i0 = nullableSafeInteger(value.i0);
  if (rows == null || columns == null || j0 === undefined || i0 === undefined) {
    return undefined;
  }
  return Object.freeze({ rows, columns, j0, i0 });
}

function emptyOf(value: unknown): AfcDiagnosticAdminArtifactLineageEmpty | null {
  if (!isRecord(value) || !exactKeys(value, EMPTY_KEYS)) return null;
  const source = member(value.source, EMPTY_SOURCES);
  const sha256 = nullableHash(value.sha256);
  const byteCount = nullablePositiveInteger(value.byteCount);
  const width = nullablePositiveInteger(value.width);
  const height = nullablePositiveInteger(value.height);
  const reusedFromGenerationId = nullableUuid(value.reusedFromGenerationId);
  if (!source || sha256 === undefined || byteCount === undefined || width === undefined
    || height === undefined || reusedFromGenerationId === undefined) {
    return null;
  }
  if (source !== "durable" && reusedFromGenerationId != null) return null;
  return Object.freeze({
    sha256,
    byteCount,
    width,
    height,
    source,
    reusedFromGenerationId: source === "durable" ? reusedFromGenerationId : null,
  });
}

function tiledOf(value: unknown): AfcDiagnosticAdminArtifactLineageTiled | null {
  if (!isRecord(value) || !exactKeys(value, TILED_KEYS)) return null;
  const source = member(value.source, TILED_SOURCES);
  const sha256 = nullableHash(value.sha256);
  const byteCount = nullablePositiveInteger(value.byteCount);
  const width = nullablePositiveInteger(value.width);
  const height = nullablePositiveInteger(value.height);
  const reusedFromGenerationId = nullableUuid(value.reusedFromGenerationId);
  const generatorId = nullableToken(value.generatorId);
  const profileId = nullableToken(value.profileId);
  const researchPreset = nullableToken(value.researchPreset);
  const requestedModelId = nullableToken(value.requestedModelId);
  const provenanceRunId = nullableRunId(value.provenanceRunId);
  if (!source || sha256 === undefined || byteCount === undefined || width === undefined
    || height === undefined || reusedFromGenerationId === undefined
    || generatorId === undefined || profileId === undefined
    || researchPreset === undefined || requestedModelId === undefined
    || provenanceRunId === undefined) {
    return null;
  }
  if (source !== "durable" && reusedFromGenerationId != null) return null;
  return Object.freeze({
    sha256,
    byteCount,
    width,
    height,
    source,
    reusedFromGenerationId: source === "durable" ? reusedFromGenerationId : null,
    generatorId,
    profileId,
    researchPreset,
    requestedModelId,
    provenanceRunId,
  });
}

function readerOf(value: unknown): AfcDiagnosticAdminArtifactLineageReader | null {
  if (!isRecord(value) || !exactKeys(value, READER_KEYS)) return null;
  const readerVersion = nullableToken(value.readerVersion);
  const status = value.status == null ? null : member(value.status, READER_STATUSES);
  const rawQuadCount = nullableCount(value.rawQuadCount);
  const deduplicatedCellCount = nullableCount(value.deduplicatedCellCount);
  const selectedComponentTileCount = nullableCount(value.selectedComponentTileCount);
  const selectedCore = core(value.selectedCore);
  const latticeReprojectionMeanPx = nullableFinite(value.latticeReprojectionMeanPx);
  const latticeReprojectionMaxPx = nullableFinite(value.latticeReprojectionMaxPx);
  const selectedPolygon = polygon(value.selectedPolygon);
  if (readerVersion === undefined || (value.status != null && status == null)
    || rawQuadCount === undefined || deduplicatedCellCount === undefined
    || selectedComponentTileCount === undefined || selectedCore === undefined
    || latticeReprojectionMeanPx === undefined || latticeReprojectionMaxPx === undefined
    || selectedPolygon === undefined) {
    return null;
  }
  return Object.freeze({
    readerVersion,
    status,
    rawQuadCount,
    deduplicatedCellCount,
    selectedComponentTileCount,
    selectedCore,
    latticeReprojectionMeanPx,
    latticeReprojectionMaxPx,
    selectedPolygon,
  });
}

function valueOf(value: unknown): AfcDiagnosticAdminArtifactLineageValue | null {
  if (!isRecord(value) || !exactKeys(value, VALUE_KEYS)) return null;
  const empty = emptyOf(value.empty);
  const tiled = tiledOf(value.tiled);
  const reader = readerOf(value.reader);
  if (!empty || !tiled || !reader) return null;
  return Object.freeze({ empty, tiled, reader });
}

export function parseAfcDiagnosticAdminArtifactLineageDto(
  value: unknown,
): AfcDiagnosticAdminArtifactLineage {
  if (value == null) return null;
  if (!isRecord(value) || typeof value.kind !== "string") return unreadable();
  if (value.kind === "unreadable") return unreadable();
  if (value.kind === "unsupported_schema") {
    const schemaVersion = typeof value.schemaVersion === "string"
      ? publishAfcDiagnosticMetricToken(value.schemaVersion) ?? "unavailable"
      : "unavailable";
    return Object.freeze({ kind: "unsupported_schema", schemaVersion });
  }
  if (value.kind !== "recorded") return unreadable();
  if (value.schemaVersion !== AFC_DIAGNOSTIC_ADMIN_ARTIFACT_LINEAGE_SCHEMA_VERSION) {
    return unreadable();
  }
  const parsed = valueOf(value.value);
  if (!parsed) return unreadable();
  return Object.freeze({
    kind: "recorded",
    schemaVersion: AFC_DIAGNOSTIC_ADMIN_ARTIFACT_LINEAGE_SCHEMA_VERSION,
    value: parsed,
  });
}
