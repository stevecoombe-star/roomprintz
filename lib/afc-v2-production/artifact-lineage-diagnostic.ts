/**
 * AFR-3D artifact-lineage diagnostic.
 *
 * Records which EMPTY and TILED bytes an attempt used, where those bytes
 * came from, and the reader core that attempt actually received. It is not
 * an acceptance input. Core shape, lattice residual, and artifact source do
 * not accept or reject a generation.
 *
 * The older engine labels are not this record:
 * - engineEmptyArtifactSource "cache" covers both the process-local EMPTY
 *   cache and a durable hit, because both return generated:false.
 * - engineTiledArtifactSource stays "generated" when production injects the
 *   TILED function and that function returns durable bytes.
 * - floorOnlyTiledGeneration stays 1 on that same durable short-circuit.
 * empty_artifact_source / tiled_artifact_source remain the historical
 * durable|generated columns. This diagnostic is the lineage authority.
 */

export const AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION =
  "afc-v2-artifact-lineage-diagnostic/v1" as const;

export const AFC_V2_ARTIFACT_LINEAGE_EMPTY_SOURCES = [
  "generated",
  "process_cache",
  "durable",
  "unknown",
] as const;

export const AFC_V2_ARTIFACT_LINEAGE_TILED_SOURCES = [
  "generated",
  "durable",
  "unknown",
] as const;

export const AFC_V2_ARTIFACT_LINEAGE_READER_STATUSES = ["ok", "failed"] as const;

export type AfcV2ArtifactLineageEmptySource =
  (typeof AFC_V2_ARTIFACT_LINEAGE_EMPTY_SOURCES)[number];

export type AfcV2ArtifactLineageTiledSource =
  (typeof AFC_V2_ARTIFACT_LINEAGE_TILED_SOURCES)[number];

export type AfcV2ArtifactLineageReaderStatus =
  (typeof AFC_V2_ARTIFACT_LINEAGE_READER_STATUSES)[number];

export type AfcV2ArtifactLineagePoint = Readonly<{ x: number; y: number }>;

export type AfcV2ArtifactLineagePolygon = readonly [
  AfcV2ArtifactLineagePoint,
  AfcV2ArtifactLineagePoint,
  AfcV2ArtifactLineagePoint,
  AfcV2ArtifactLineagePoint,
];

export type AfcV2ArtifactLineageEmpty = Readonly<{
  sha256: string | null;
  byteCount: number | null;
  width: number | null;
  height: number | null;
  source: AfcV2ArtifactLineageEmptySource;
  reusedFromGenerationId: string | null;
}>;

export type AfcV2ArtifactLineageTiled = Readonly<{
  sha256: string | null;
  byteCount: number | null;
  width: number | null;
  height: number | null;
  source: AfcV2ArtifactLineageTiledSource;
  reusedFromGenerationId: string | null;
  generatorId: string | null;
  profileId: string | null;
  researchPreset: string | null;
  requestedModelId: string | null;
  provenanceRunId: string | null;
}>;

export type AfcV2ArtifactLineageCore = Readonly<{
  rows: number;
  columns: number;
  j0: number;
  i0: number;
}>;

export type AfcV2ArtifactLineageReader = Readonly<{
  readerVersion: string | null;
  status: AfcV2ArtifactLineageReaderStatus | null;
  rawQuadCount: number | null;
  deduplicatedCellCount: number | null;
  selectedComponentTileCount: number | null;
  selectedCore: AfcV2ArtifactLineageCore | null;
  latticeReprojectionMeanPx: number | null;
  latticeReprojectionMaxPx: number | null;
  selectedPolygon: AfcV2ArtifactLineagePolygon | null;
}>;

export type AfcV2ArtifactLineageRecordedV1 = Readonly<{
  schemaVersion: typeof AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION;
  empty: AfcV2ArtifactLineageEmpty;
  tiled: AfcV2ArtifactLineageTiled;
  reader: AfcV2ArtifactLineageReader;
}>;

export type AfcV2ArtifactLineageUnsupportedSchema = Readonly<{
  kind: "unsupported_schema";
  schemaVersion: string;
}>;

export type AfcV2ArtifactLineagePersistedValue =
  | null
  | AfcV2ArtifactLineageRecordedV1
  | AfcV2ArtifactLineageUnsupportedSchema;

export type AfcV2ArtifactLineageParseResult =
  | Readonly<{ ok: true; decision: AfcV2ArtifactLineagePersistedValue }>
  | Readonly<{ ok: false; reason: string }>;

export type AfcV2ArtifactLineageBuildInput = Readonly<{
  empty: AfcV2ArtifactLineageEmpty;
  tiled: AfcV2ArtifactLineageTiled;
  reader: AfcV2ArtifactLineageReader;
}>;

const RECORDED_KEYS = ["schemaVersion", "empty", "tiled", "reader"] as const;
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

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_./:-]{1,160}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,80}$/;

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

function rejected(reason: string): AfcV2ArtifactLineageParseResult {
  return Object.freeze({ ok: false, reason });
}

function nullableSha(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
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

function nullableUuid(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined;
}

function nullableToken(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string" && TOKEN.test(value) ? value : undefined;
}

function nullableRunId(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string" && RUN_ID.test(value) ? value : undefined;
}

function nullableSafeInteger(value: unknown): number | null | undefined {
  if (value == null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function point(value: unknown): AfcV2ArtifactLineagePoint | null {
  if (!isRecord(value) || !exactKeys(value, ["x", "y"])) return null;
  if (typeof value.x !== "number" || typeof value.y !== "number") return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return Object.freeze({ x: value.x, y: value.y });
}

function polygon(value: unknown): AfcV2ArtifactLineagePolygon | null | undefined {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const points = value.map(point);
  if (points.some((entry) => entry == null)) return undefined;
  return Object.freeze(points) as AfcV2ArtifactLineagePolygon;
}

function core(value: unknown): AfcV2ArtifactLineageCore | null | undefined {
  if (value == null) return null;
  if (!isRecord(value) || !exactKeys(value, CORE_KEYS)) return undefined;
  const rows = nullablePositiveInteger(value.rows);
  const columns = nullablePositiveInteger(value.columns);
  const j0 = nullableSafeInteger(value.j0);
  const i0 = nullableSafeInteger(value.i0);
  if (rows == null || columns == null || j0 == null || i0 == null) return undefined;
  return Object.freeze({ rows, columns, j0, i0 });
}

function emptyOf(value: unknown): AfcV2ArtifactLineageEmpty | null {
  if (!isRecord(value) || !exactKeys(value, EMPTY_KEYS)) return null;
  const source = member(value.source, AFC_V2_ARTIFACT_LINEAGE_EMPTY_SOURCES);
  const sha256 = nullableSha(value.sha256);
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

function tiledOf(value: unknown): AfcV2ArtifactLineageTiled | null {
  if (!isRecord(value) || !exactKeys(value, TILED_KEYS)) return null;
  const source = member(value.source, AFC_V2_ARTIFACT_LINEAGE_TILED_SOURCES);
  const sha256 = nullableSha(value.sha256);
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

function readerOf(value: unknown): AfcV2ArtifactLineageReader | null {
  if (!isRecord(value) || !exactKeys(value, READER_KEYS)) return null;
  const readerVersion = nullableToken(value.readerVersion);
  const status = value.status == null
    ? null
    : member(value.status, AFC_V2_ARTIFACT_LINEAGE_READER_STATUSES);
  const rawQuadCount = nullableCount(value.rawQuadCount);
  const deduplicatedCellCount = nullableCount(value.deduplicatedCellCount);
  const selectedComponentTileCount = nullableCount(value.selectedComponentTileCount);
  const selectedCore = core(value.selectedCore);
  const latticeReprojectionMeanPx = nullableFinite(value.latticeReprojectionMeanPx);
  const latticeReprojectionMaxPx = nullableFinite(value.latticeReprojectionMaxPx);
  const selectedPolygon = polygon(value.selectedPolygon);
  if (readerVersion === undefined || status === undefined
    || rawQuadCount === undefined || deduplicatedCellCount === undefined
    || selectedComponentTileCount === undefined || selectedCore === undefined
    || latticeReprojectionMeanPx === undefined || latticeReprojectionMaxPx === undefined
    || selectedPolygon === undefined) {
    return null;
  }
  if (value.status != null && status == null) return null;
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

export function unknownAfcV2ArtifactLineageEmpty(): AfcV2ArtifactLineageEmpty {
  return Object.freeze({
    sha256: null,
    byteCount: null,
    width: null,
    height: null,
    source: "unknown",
    reusedFromGenerationId: null,
  });
}

export function unknownAfcV2ArtifactLineageTiled(): AfcV2ArtifactLineageTiled {
  return Object.freeze({
    sha256: null,
    byteCount: null,
    width: null,
    height: null,
    source: "unknown",
    reusedFromGenerationId: null,
    generatorId: null,
    profileId: null,
    researchPreset: null,
    requestedModelId: null,
    provenanceRunId: null,
  });
}

export function unknownAfcV2ArtifactLineageReader(): AfcV2ArtifactLineageReader {
  return Object.freeze({
    readerVersion: null,
    status: null,
    rawQuadCount: null,
    deduplicatedCellCount: null,
    selectedComponentTileCount: null,
    selectedCore: null,
    latticeReprojectionMeanPx: null,
    latticeReprojectionMaxPx: null,
    selectedPolygon: null,
  });
}

function degradeSha(value: string | null): string | null {
  return value != null && SHA256.test(value) ? value : null;
}

function degradePositiveInteger(value: number | null): number | null {
  return value != null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function degradeCount(value: number | null): number | null {
  return value != null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function degradeFinite(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function degradeUuid(value: string | null): string | null {
  return value != null && UUID.test(value) ? value.toLowerCase() : null;
}

function degradeToken(value: string | null): string | null {
  return value != null && TOKEN.test(value) ? value : null;
}

function degradeRunId(value: string | null): string | null {
  return value != null && RUN_ID.test(value) ? value : null;
}

function degradePolygon(
  value: readonly Readonly<{ x: number; y: number }>[] | null,
): AfcV2ArtifactLineagePolygon | null {
  if (value == null) return null;
  const parsed = polygon(value);
  return parsed === undefined ? null : parsed;
}

function degradeCore(value: AfcV2ArtifactLineageCore | null): AfcV2ArtifactLineageCore | null {
  if (value == null) return null;
  const parsed = core(value);
  return parsed === undefined ? null : parsed;
}

/**
 * Sanitizes a capture into the persisted shape. Non-finite numbers and
 * malformed identities become null. They do not reject the generation.
 * Newly generated and process-cache artifacts never claim a source generation.
 */
export function buildAfcV2ArtifactLineageDiagnostic(
  input: AfcV2ArtifactLineageBuildInput,
): AfcV2ArtifactLineageRecordedV1 {
  const emptySource = member(input.empty.source, AFC_V2_ARTIFACT_LINEAGE_EMPTY_SOURCES)
    ?? "unknown";
  const tiledSource = member(input.tiled.source, AFC_V2_ARTIFACT_LINEAGE_TILED_SOURCES)
    ?? "unknown";
  const readerStatus = input.reader.status == null
    ? null
    : member(input.reader.status, AFC_V2_ARTIFACT_LINEAGE_READER_STATUSES);
  return Object.freeze({
    schemaVersion: AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION,
    empty: Object.freeze({
      sha256: degradeSha(input.empty.sha256),
      byteCount: degradePositiveInteger(input.empty.byteCount),
      width: degradePositiveInteger(input.empty.width),
      height: degradePositiveInteger(input.empty.height),
      source: emptySource,
      reusedFromGenerationId: emptySource === "durable"
        ? degradeUuid(input.empty.reusedFromGenerationId)
        : null,
    }),
    tiled: Object.freeze({
      sha256: degradeSha(input.tiled.sha256),
      byteCount: degradePositiveInteger(input.tiled.byteCount),
      width: degradePositiveInteger(input.tiled.width),
      height: degradePositiveInteger(input.tiled.height),
      source: tiledSource,
      reusedFromGenerationId: tiledSource === "durable"
        ? degradeUuid(input.tiled.reusedFromGenerationId)
        : null,
      generatorId: degradeToken(input.tiled.generatorId),
      profileId: degradeToken(input.tiled.profileId),
      researchPreset: degradeToken(input.tiled.researchPreset),
      requestedModelId: degradeToken(input.tiled.requestedModelId),
      provenanceRunId: degradeRunId(input.tiled.provenanceRunId),
    }),
    reader: Object.freeze({
      readerVersion: degradeToken(input.reader.readerVersion),
      status: readerStatus,
      rawQuadCount: degradeCount(input.reader.rawQuadCount),
      deduplicatedCellCount: degradeCount(input.reader.deduplicatedCellCount),
      selectedComponentTileCount: degradeCount(input.reader.selectedComponentTileCount),
      selectedCore: degradeCore(input.reader.selectedCore),
      latticeReprojectionMeanPx: degradeFinite(input.reader.latticeReprojectionMeanPx),
      latticeReprojectionMaxPx: degradeFinite(input.reader.latticeReprojectionMaxPx),
      selectedPolygon: degradePolygon(input.reader.selectedPolygon),
    }),
  });
}

export function parseAfcV2ArtifactLineage(
  value: unknown,
): AfcV2ArtifactLineageParseResult {
  if (value == null) return Object.freeze({ ok: true, decision: null });
  if (!isRecord(value)) return rejected("artifact_lineage_not_object");
  if (value.kind === "unsupported_schema") {
    return typeof value.schemaVersion === "string"
      && value.schemaVersion.length > 0
      && value.schemaVersion.length <= 160
      ? Object.freeze({
        ok: true,
        decision: Object.freeze({
          kind: "unsupported_schema",
          schemaVersion: value.schemaVersion,
        }),
      })
      : rejected("artifact_lineage_schema_invalid");
  }
  if (value.schemaVersion !== AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION) {
    return typeof value.schemaVersion === "string"
      ? Object.freeze({
        ok: true,
        decision: Object.freeze({
          kind: "unsupported_schema",
          schemaVersion: value.schemaVersion,
        }),
      })
      : rejected("artifact_lineage_schema_invalid");
  }
  if (!exactKeys(value, RECORDED_KEYS)) return rejected("artifact_lineage_keys");
  const empty = emptyOf(value.empty);
  const tiled = tiledOf(value.tiled);
  const reader = readerOf(value.reader);
  if (!empty || !tiled || !reader) return rejected("artifact_lineage_section");
  return Object.freeze({
    ok: true,
    decision: Object.freeze({
      schemaVersion: AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION,
      empty,
      tiled,
      reader,
    }),
  });
}

export function isAfcV2ArtifactLineageRecorded(
  value: AfcV2ArtifactLineagePersistedValue,
): value is AfcV2ArtifactLineageRecordedV1 {
  return !!value && !("kind" in value);
}

type ReaderProduct = Readonly<{
  status?: string;
  geometry?: Readonly<{
    sourceNormalizedPolygon?: readonly Readonly<{ x: number; y: number }>[];
    tiledPerspective?: Readonly<{
      readerVersion?: string;
      core?: Readonly<{
        rows?: number;
        columns?: number;
        j0?: number;
        i0?: number;
      }>;
      selectedComponentTileCount?: number;
      rawQuadrilateralCount?: number;
      deduplicatedCellCount?: number;
      reprojectionMeanPx?: number;
      reprojectionMaxPx?: number;
    }>;
  }>;
  diagnostics?: Readonly<{
    tiledPerspectiveReader?: AfcV2ArtifactLineageReader;
  }>;
}>;

/**
 * Copies reader evidence already attached to the product. Does not call the
 * reader and does not read the settle polygon.
 */
export function afcV2ReaderEvidenceFromProduct(
  product: unknown,
): AfcV2ArtifactLineageReader {
  if (!isRecord(product)) return unknownAfcV2ArtifactLineageReader();
  const candidate = product as ReaderProduct;
  const perspective = candidate.status === "authoritative_geometry"
    ? candidate.geometry?.tiledPerspective
    : undefined;
  if (perspective && candidate.geometry?.sourceNormalizedPolygon) {
    const coreValue = perspective.core;
    return buildAfcV2ArtifactLineageDiagnostic({
      empty: unknownAfcV2ArtifactLineageEmpty(),
      tiled: unknownAfcV2ArtifactLineageTiled(),
      reader: {
        readerVersion: perspective.readerVersion ?? null,
        status: "ok",
        rawQuadCount: perspective.rawQuadrilateralCount ?? null,
        deduplicatedCellCount: perspective.deduplicatedCellCount ?? null,
        selectedComponentTileCount: perspective.selectedComponentTileCount ?? null,
        selectedCore: coreValue
          && typeof coreValue.rows === "number"
          && typeof coreValue.columns === "number"
          && typeof coreValue.j0 === "number"
          && typeof coreValue.i0 === "number"
          ? {
            rows: coreValue.rows,
            columns: coreValue.columns,
            j0: coreValue.j0,
            i0: coreValue.i0,
          }
          : null,
        latticeReprojectionMeanPx: perspective.reprojectionMeanPx ?? null,
        latticeReprojectionMaxPx: perspective.reprojectionMaxPx ?? null,
        selectedPolygon: polygon(candidate.geometry?.sourceNormalizedPolygon) ?? null,
      },
    }).reader;
  }
  const observed = candidate.diagnostics?.tiledPerspectiveReader;
  if (observed) {
    return buildAfcV2ArtifactLineageDiagnostic({
      empty: unknownAfcV2ArtifactLineageEmpty(),
      tiled: unknownAfcV2ArtifactLineageTiled(),
      reader: observed,
    }).reader;
  }
  return unknownAfcV2ArtifactLineageReader();
}
