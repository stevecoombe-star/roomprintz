import "server-only";

import { callCompositorJson } from "./compositorTransportError";

export const AFC_SR1_TILED_PERSPECTIVE_READER_PATH =
  "/api/research/afc-sr1/tiled-perspective-reader" as const;
export const AFC_SR1_TILED_PERSPECTIVE_READER_PROFILE =
  "afc-sr1-tiled-perspective-reader/s1" as const;

export type AfcSr1TiledPerspectiveReaderIdentity = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  orientation: 1;
}>;

type AfcSr1TiledPerspectiveQuad = readonly [
  Readonly<{ x: number; y: number }>,
  Readonly<{ x: number; y: number }>,
  Readonly<{ x: number; y: number }>,
  Readonly<{ x: number; y: number }>,
];

export type AfcSr1TiledPerspectiveReaderResponse =
  | Readonly<{
      status: "ok";
      decodedIdentity: AfcSr1TiledPerspectiveReaderIdentity;
      readerVersion: typeof AFC_SR1_TILED_PERSPECTIVE_READER_PROFILE;
      authoritativeQuadSourceNormalized: AfcSr1TiledPerspectiveQuad;
      authoritativeQuadPixel: AfcSr1TiledPerspectiveQuad;
      authoritativeCore: Readonly<{
        rows: number;
        columns: number;
        j0: number;
        i0: number;
        cellIds: readonly number[];
      }>;
      selectedComponentTileCount: number;
      rawQuadrilateralCount: number;
      deduplicatedCellCount: number;
      reprojectionMeanPx: number;
      reprojectionMaxPx: number;
    }>
  | Readonly<{
      status: "failed";
      reason:
        | "invalid_input_image"
        | "no_complete_tile"
        | "no_coherent_lattice"
        | "lattice_assignment_conflict"
        | "no_rectangular_core"
        | "homography_failure"
        | "semantic_ordering_failure";
      decodedIdentity: AfcSr1TiledPerspectiveReaderIdentity;
      readerVersion: typeof AFC_SR1_TILED_PERSPECTIVE_READER_PROFILE;
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function finitePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseIdentity(value: unknown): AfcSr1TiledPerspectiveReaderIdentity | null {
  if (!isRecord(value) || !exactKeys(value, [
    "sha256", "byteCount", "decodedWidth", "decodedHeight", "mimeType", "orientation",
  ]) ||
    typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !finitePositiveInteger(value.byteCount) ||
    !finitePositiveInteger(value.decodedWidth) ||
    !finitePositiveInteger(value.decodedHeight) ||
    (value.mimeType !== "image/jpeg" && value.mimeType !== "image/png" &&
      value.mimeType !== "image/webp") ||
    value.orientation !== 1
  ) return null;
  return Object.freeze({
    sha256: value.sha256,
    byteCount: value.byteCount,
    decodedWidth: value.decodedWidth,
    decodedHeight: value.decodedHeight,
    mimeType: value.mimeType,
    orientation: 1,
  });
}

function parseQuad(value: unknown): AfcSr1TiledPerspectiveQuad | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points = value.map((point) => {
    if (!Array.isArray(point) || point.length !== 2 ||
      !finiteNumber(point[0]) || !finiteNumber(point[1])) return null;
    return Object.freeze({ x: point[0], y: point[1] });
  });
  return points.some((point) => point === null)
    ? null
    : Object.freeze(points) as AfcSr1TiledPerspectiveQuad;
}

function parseResponse(value: unknown): AfcSr1TiledPerspectiveReaderResponse {
  if (!isRecord(value) || (value.status !== "ok" && value.status !== "failed")) {
    throw new Error("TILED perspective reader response is invalid.");
  }
  const identity = parseIdentity(value.decodedIdentity);
  if (!identity || value.readerVersion !== AFC_SR1_TILED_PERSPECTIVE_READER_PROFILE) {
    throw new Error("TILED perspective reader identity response is invalid.");
  }
  if (value.status === "failed") {
    if (!exactKeys(value, ["status", "reason", "decodedIdentity", "readerVersion"]) ||
      !["invalid_input_image", "no_complete_tile", "no_coherent_lattice", "lattice_assignment_conflict",
        "no_rectangular_core", "homography_failure", "semantic_ordering_failure"].includes(
        String(value.reason)
      )) {
      throw new Error("TILED perspective reader failure response is invalid.");
    }
    return Object.freeze({
      status: "failed",
      reason: value.reason as Extract<AfcSr1TiledPerspectiveReaderResponse, { status: "failed" }>["reason"],
      decodedIdentity: identity,
      readerVersion: AFC_SR1_TILED_PERSPECTIVE_READER_PROFILE,
    });
  }
  const sourceQuad = parseQuad(value.authoritativeQuadSourceNormalized);
  const pixelQuad = parseQuad(value.authoritativeQuadPixel);
  const core = value.authoritativeCore;
  if (!exactKeys(value, [
    "status", "decodedIdentity", "readerVersion", "authoritativeQuadSourceNormalized",
    "authoritativeQuadPixel", "authoritativeCore", "selectedComponentTileCount",
    "rawQuadrilateralCount", "deduplicatedCellCount", "reprojectionMeanPx", "reprojectionMaxPx",
  ]) || !sourceQuad || !pixelQuad || !isRecord(core) ||
    !exactKeys(core, ["rows", "columns", "j0", "i0", "cellIds"]) ||
    !finitePositiveInteger(core.rows) || !finitePositiveInteger(core.columns) ||
    !Number.isSafeInteger(core.j0) || !Number.isSafeInteger(core.i0) ||
    !Array.isArray(core.cellIds) || !core.cellIds.every(Number.isSafeInteger) ||
    !finitePositiveInteger(value.selectedComponentTileCount) ||
    !finitePositiveInteger(value.rawQuadrilateralCount) ||
    !finitePositiveInteger(value.deduplicatedCellCount) ||
    !finiteNumber(value.reprojectionMeanPx) || !finiteNumber(value.reprojectionMaxPx)
  ) {
    throw new Error("TILED perspective reader success response is invalid.");
  }
  const validatedCore = core as Readonly<{
    rows: number;
    columns: number;
    j0: number;
    i0: number;
    cellIds: readonly number[];
  }>;
  return Object.freeze({
    status: "ok",
    decodedIdentity: identity,
    readerVersion: AFC_SR1_TILED_PERSPECTIVE_READER_PROFILE,
    authoritativeQuadSourceNormalized: sourceQuad,
    authoritativeQuadPixel: pixelQuad,
    authoritativeCore: Object.freeze({
      rows: validatedCore.rows,
      columns: validatedCore.columns,
      j0: validatedCore.j0,
      i0: validatedCore.i0,
      cellIds: Object.freeze([...validatedCore.cellIds]),
    }),
    selectedComponentTileCount: value.selectedComponentTileCount,
    rawQuadrilateralCount: value.rawQuadrilateralCount,
    deduplicatedCellCount: value.deduplicatedCellCount,
    reprojectionMeanPx: value.reprojectionMeanPx,
    reprojectionMaxPx: value.reprojectionMaxPx,
  });
}

export async function callCompositorAfcSr1TiledPerspectiveReader(args: {
  imageBase64: string;
  claimedIdentity: AfcSr1TiledPerspectiveReaderIdentity;
  signal?: AbortSignal;
}): Promise<AfcSr1TiledPerspectiveReaderResponse> {
  const response = await callCompositorJson({
    seam: "tiled-perspective-reader",
    path: AFC_SR1_TILED_PERSPECTIVE_READER_PATH,
    method: "POST",
    payload: {
      researchProfile: AFC_SR1_TILED_PERSPECTIVE_READER_PROFILE,
      imageBase64: args.imageBase64,
      claimedIdentity: args.claimedIdentity,
    },
    signal: args.signal ?? AbortSignal.timeout(30_000),
  });
  return parseResponse(response);
}
