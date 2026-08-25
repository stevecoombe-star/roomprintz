import "server-only";

import { randomUUID } from "node:crypto";

import {
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  getEmptyRoomAssistResultAllowedHosts,
  isAutoFloorVisionAllowLocalhostHttp,
} from "@/lib/vibodeAutoFloorVisionConfig";
import {
  callCompositorAfcSr1TiledPerspectiveReader,
  type AfcSr1TiledPerspectiveReaderIdentity,
  type AfcSr1TiledPerspectiveReaderResponse,
} from "@/lib/callCompositorAfcSr1TiledPerspectiveReader";
import {
  vibodeTileGridScaffoldAssist,
  type AfcSr1TileGridScaffoldResult,
} from "./research/afc-sr1-tile-grid-scaffold";
import {
  AfcSr1TiledPerspectiveExactGridLineageError,
  validateAfcSr1TiledPerspectiveExactGridLineage,
  type AfcSr1TiledPerspectiveExactGridLineage,
} from "./research/afc-sr1-tiled-perspective-exact-grid-lineage";
import { classifyAfcR3cImagePairCompatibility } from "./research/gemini-floor-proposal-composition";
import type { AfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";
import {
  afcSr1LiveSourceIdentityMatches,
  cloneAfcSr1LivePolygon,
  isValidAfcSr1LiveAnalyzeRequest,
  isValidAfcSr1LiveProductPolygon,
  afcSr1LiveTiledDiagnosticImages,
  qualifyAfcSr1LiveOriginalDefault,
  resolveAfcSr1LiveEmptyDefault,
  retainAfcSr1LiveAttemptEmptyEvidence,
  retainAfcSr1LiveAttemptTiledEvidence,
  type AfcSr1QualifiedOriginal,
  type AfcSr1ResolvedEmpty,
} from "./afc-sr1-live-product";
import {
  AFC_SR1_LIVE_PRODUCT_VERSION,
  type AfcSr1LiveAnalyzeRequest,
  type AfcSr1LiveAttemptCounts,
  type AfcSr1LiveFailureReason,
  type AfcSr1LiveProductResult,
} from "./afc-sr1-live-product-contract";

type MutableCounts = {
  -readonly [Key in keyof AfcSr1LiveAttemptCounts]: AfcSr1LiveAttemptCounts[Key];
};

function emptyCounts(): MutableCounts {
  return {
    originalQualification: 0,
    emptyGeneration: 0,
    tiledGeneration: 0,
    tiledReader: 0,
    geminiFloorProposal: 0,
    supportedRoomClassifier: 0,
    onAxisCorrection: 0,
    pathA: 0,
    rawReader: 0,
    ts0: 0,
    placement: 0,
    childReader: 0,
  };
}

function diagnostics(
  counts: AfcSr1LiveAttemptCounts,
  detail: string | null
) {
  return Object.freeze({
    finalReason: detail,
    placementStatus: null,
    placementReason: null,
    validationP90Px: null,
    evidenceDigest: `s2a:${counts.originalQualification}:${counts.emptyGeneration}:${counts.tiledGeneration}:${counts.tiledReader}`,
    sameAttemptTs0Retained: false,
    attemptCounts: Object.freeze({ ...counts }),
    floorReadDiagnostic: null,
    supportedRoomClassifier: null,
  });
}

function matchingIdentity(
  left: AfcSr1TiledPerspectiveReaderIdentity,
  right: AfcSr1TiledPerspectiveReaderIdentity
): boolean {
  return left.sha256 === right.sha256 &&
    left.byteCount === right.byteCount &&
    left.decodedWidth === right.decodedWidth &&
    left.decodedHeight === right.decodedHeight &&
    left.mimeType === right.mimeType &&
    left.orientation === right.orientation;
}

function readerPolygon(
  response: Extract<AfcSr1TiledPerspectiveReaderResponse, { status: "ok" }>
): AfcSr1SourcePolygon | null {
  const polygon = response.authoritativeQuadSourceNormalized.map((point) =>
    Object.freeze({ x: point.x, y: point.y })
  ) as unknown as AfcSr1SourcePolygon;
  return isValidAfcSr1LiveProductPolygon(polygon) &&
    polygon.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)
    ? cloneAfcSr1LivePolygon(polygon)
    : null;
}

export type AfcSr1TiledLiveProductDependencies = Readonly<{
  qualifyOriginal?: (
    request: AfcSr1LiveAnalyzeRequest
  ) => Promise<AfcSr1QualifiedOriginal | null>;
  resolveEmpty?: (
    original: AfcSr1QualifiedOriginal
  ) => Promise<AfcSr1ResolvedEmpty | null>;
  generateTiled?: typeof vibodeTileGridScaffoldAssist;
  validateTiledLineage?: (
    result: AfcSr1TileGridScaffoldResult,
    emptyBytes: Uint8Array,
    tiledBytes: Uint8Array
  ) => Promise<AfcSr1TiledPerspectiveExactGridLineage>;
  readTiledPerspective?: (args: {
    imageBase64: string;
    claimedIdentity: AfcSr1TiledPerspectiveReaderIdentity;
  }) => Promise<AfcSr1TiledPerspectiveReaderResponse>;
  createResultId?: () => string;
}>;

/**
 * S2A's sole live perspective authority. Historical PATH A remains isolated
 * in afc-sr1-live-product.ts for research and regression tests.
 */
export async function executeAfcSr1TiledLiveProductAttempt(
  request: AfcSr1LiveAnalyzeRequest,
  dependencies: AfcSr1TiledLiveProductDependencies = {}
): Promise<AfcSr1LiveProductResult> {
  const resultId = dependencies.createResultId?.() ?? randomUUID();
  const counts = emptyCounts();
  const failed = (
    reason: AfcSr1LiveFailureReason,
    detail: string
  ): AfcSr1LiveProductResult => Object.freeze({
    status: "failed",
    schemaVersion: AFC_SR1_LIVE_PRODUCT_VERSION,
    attemptId: request?.attemptId ?? "",
    resultId,
    labLoadGeneration: request?.labLoadGeneration ?? -1,
    reason,
    detail,
    diagnostics: diagnostics(counts, detail),
  });

  if (!isValidAfcSr1LiveAnalyzeRequest(request)) {
    return failed("invalid_request", "request_contract_invalid");
  }
  counts.originalQualification = 1;
  const original = await (
    dependencies.qualifyOriginal ?? qualifyAfcSr1LiveOriginalDefault
  )(request);
  if (!original) {
    return failed("original_qualification_failed", "original_refetch_or_decode_failed");
  }
  if (!afcSr1LiveSourceIdentityMatches(request, original)) {
    return failed("source_identity_mismatch", "qualified_source_basis_mismatch");
  }

  const empty = await (
    dependencies.resolveEmpty ?? resolveAfcSr1LiveEmptyDefault
  )(original);
  if (!empty) {
    return failed("empty_generation_failed", "empty_generation_or_decode_failed");
  }
  counts.emptyGeneration = empty.generated ? 1 : 0;
  retainAfcSr1LiveAttemptEmptyEvidence({
    attemptId: request.attemptId,
    resultId,
    labLoadGeneration: request.labLoadGeneration,
    originalBasis: original.basis,
    empty,
  });

  const emptyToOriginal = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: original.basis.sha256,
      decodedWidth: original.basis.decodedWidth,
      decodedHeight: original.basis.decodedHeight,
      orientation: original.basis.orientation,
    },
    {
      fingerprint: empty.basis.sha256,
      decodedWidth: empty.basis.decodedWidth,
      decodedHeight: empty.basis.decodedHeight,
      orientation: empty.basis.orientation,
    }
  );
  if (emptyToOriginal.tier === "incompatible") {
    return failed("original_empty_incompatible", "image_pair_incompatible");
  }

  counts.tiledGeneration = 1;
  const tiled = await (
    dependencies.generateTiled ?? vibodeTileGridScaffoldAssist
  )({
    empty: {
      base64: Buffer.from(empty.bytes).toString("base64"),
      identity: empty.basis,
    },
    resultAllowedHosts: getEmptyRoomAssistResultAllowedHosts(),
    maxOutputBytes: getAutoFloorVisionImageMaxBytes(),
    fetchTimeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
    allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
  });
  if (tiled.status !== "generated") {
    return failed("tiled_generation_failed", tiled.code);
  }
  const tiledBytes = Buffer.from(tiled.tiled.base64, "base64");
  retainAfcSr1LiveAttemptTiledEvidence(
    request.attemptId,
    resultId,
    tiledBytes,
    tiled.tiled.identity
  );
  let lineage: AfcSr1TiledPerspectiveExactGridLineage;
  try {
    lineage = await (
      dependencies.validateTiledLineage ??
      validateAfcSr1TiledPerspectiveExactGridLineage
    )(tiled, empty.bytes, tiledBytes);
  } catch (error) {
    return failed(
      "tiled_lineage_not_exact_grid",
      error instanceof AfcSr1TiledPerspectiveExactGridLineageError
        ? error.reason
        : "tiled_lineage_invalid"
    );
  }

  counts.tiledReader = 1;
  let reader: AfcSr1TiledPerspectiveReaderResponse;
  try {
    reader = await (
      dependencies.readTiledPerspective ?? callCompositorAfcSr1TiledPerspectiveReader
    )({
      imageBase64: tiled.tiled.base64,
      claimedIdentity: lineage.tiledIdentity,
    });
  } catch {
    return failed("tiled_reader_transport_failed", "tiled_reader_transport_or_contract_failed");
  }
  if (!matchingIdentity(reader.decodedIdentity, lineage.tiledIdentity)) {
    return failed("tiled_identity_mismatch", "reader_identity_does_not_bind_generated_tiled");
  }
  if (reader.status === "failed") {
    return reader.reason === "invalid_input_image"
      ? failed("tiled_reader_transport_failed", reader.reason)
      : failed(reader.reason, reader.reason);
  }
  const sourceNormalizedPolygon = readerPolygon(reader);
  if (!sourceNormalizedPolygon) {
    return failed("tiled_reader_transport_failed", "reader_authoritative_quad_invalid");
  }

  const transferKind = emptyToOriginal.tier === "exact_grid_compatible"
    ? "paired_cross_role_exact_grid" as const
    : "paired_cross_role_aspect_rescaled" as const;
  return Object.freeze({
    status: "authoritative_geometry",
    schemaVersion: AFC_SR1_LIVE_PRODUCT_VERSION,
    attemptId: request.attemptId,
    resultId,
    labLoadGeneration: request.labLoadGeneration,
    originalBasis: original.basis,
    emptyBasis: empty.basis,
    diagnosticImages: afcSr1LiveTiledDiagnosticImages(request.attemptId),
    photoClass: "tiled_perspective_core",
    geometry: Object.freeze({
      mode: "tiled-perspective-core",
      geometryAuthority: "tiled_perspective_reader",
      sourceNormalizedPolygon,
      rawSourceNormalizedPolygon: cloneAfcSr1LivePolygon(sourceNormalizedPolygon),
      fixedAnchor: null,
      adjustableCorner: null,
      baselineSeamT: null,
      acceptanceBasis: Object.freeze({
        basisFingerprint: original.basis.sha256,
        decodedWidth: original.basis.decodedWidth,
        decodedHeight: original.basis.decodedHeight,
        orientation: 1,
        transferKind,
        transferProvenance: "afc-sr1-tiled-perspective-core/tiled-to-empty-identity/v1",
      }),
      classifierVersion: null,
      anchorAuthorityKind: null,
      onAxisConstruction: null,
      tiledPerspective: Object.freeze({
        tiledBasis: lineage.tiledIdentity,
        emptyToTiledLineageDigest: lineage.authority.lineageEvidenceDigest,
        emptyToTiledTransfer: "identity_source_normalized",
        emptyToOriginalCompatibilityTier: emptyToOriginal.tier,
        readerVersion: reader.readerVersion,
        core: reader.authoritativeCore,
        selectedComponentTileCount: reader.selectedComponentTileCount,
        rawQuadrilateralCount: reader.rawQuadrilateralCount,
        deduplicatedCellCount: reader.deduplicatedCellCount,
        reprojectionMeanPx: reader.reprojectionMeanPx,
        reprojectionMaxPx: reader.reprojectionMaxPx,
      }),
    }),
    metric: Object.freeze({
      perspectiveAuthority: "tiled_perspective_core",
      metricScaleAuthority: "provisional_reference_depth",
      referenceDepthM: request.referenceDepthM,
    }),
    perspectiveAdjust: Object.freeze({
      supported: true,
      mode: "tiled_symmetric_near_edge_v1",
      reason: "tiled_automatic_baseline_v1",
    }),
    diagnostics: diagnostics(counts, null),
  });
}
