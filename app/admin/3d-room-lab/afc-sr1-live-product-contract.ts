import type { AfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";
import type {
  AfcSr1SupportedRoomViewObservables,
} from "./afc-sr1-supported-room-view";
import type {
  AfcSr1V3ReaderDiagnosticsV1,
} from "./afc-sr1-v3-reader-diagnostics";

export const AFC_SR1_LIVE_PRODUCT_VERSION =
  "afc-sr1-complete-product-attempt/v2" as const;

export type AfcSr1LiveAnalyzeRequest = Readonly<{
  attemptId: string;
  sourceImageUrl: string;
  sourceImageIdentity: Readonly<{
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
  }>;
  labLoadGeneration: number;
  referenceDepthM: number;
}>;

export type AfcSr1LiveBasis = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  orientation: 1;
}>;

export type AfcSr1LiveAttemptCounts = Readonly<{
  originalQualification: number;
  emptyGeneration: number;
  tiledGeneration: number;
  tiledReader: number;
  geminiFloorProposal: number;
  supportedRoomClassifier: number;
  onAxisCorrection: number;
  pathA: number;
  rawReader: number;
  ts0: number;
  placement: number;
  childReader: number;
}>;

/**
 * Read-only diagnostic evidence of Gemini's accepted semantic Floor read.
 * This is intentionally separate from the derived AFC geometry and never
 * authorizes a Floor mutation.
 */
export type AfcSr1LiveFloorReadDiagnostic = Readonly<{
  detectorKind: "empty_room_assist_empty_arm";
  polygon: AfcSr1SourcePolygon;
  selectedCandidateId: string;
  selectedCandidateIndex: number;
  candidateCount: number;
  geometryScore: number;
  scoreBand: "high" | "medium" | "low";
  model: string;
  analysisBasis: Readonly<{
    decodedWidth: number;
    decodedHeight: number;
  }>;
  emptyImage: Readonly<{
    kind: "attempt_bound_empty_image";
    url: string;
  }>;
  originalPreview: Readonly<{
    kind: "current_qualified_original_preview_only";
    decodedWidth: number;
    decodedHeight: number;
  }>;
}>;

export type AfcSr1LiveDiagnostics = Readonly<{
  finalReason: string | null;
  placementStatus: "usable" | "rejected" | null;
  placementReason: string | null;
  validationP90Px: number | null;
  evidenceDigest: string;
  sameAttemptTs0Retained: boolean;
  attemptCounts: AfcSr1LiveAttemptCounts;
  floorReadDiagnostic: AfcSr1LiveFloorReadDiagnostic | null;
  /**
   * Bounded, receipt-derived V3 evidence only. It is intentionally distinct
   * from authoritative geometry and excluded from PATH A canonical evidence.
   */
  v3ReaderDiagnostics?: Readonly<{
    rawReader: AfcSr1V3ReaderDiagnosticsV1 | null;
    childReader: AfcSr1V3ReaderDiagnosticsV1 | null;
    authoritativeReaderRole: "rawReader" | "childReader" | null;
  }>;
  supportedRoomClassifier: Readonly<{
    classifierVersion: string;
    emptyDecodedWidth: number;
    emptyDecodedHeight: number;
    semanticFloorPolygon: Readonly<{
      NL: AfcSr1SourcePolygon[0];
      NR: AfcSr1SourcePolygon[1];
      FR: AfcSr1SourcePolygon[2];
      FL: AfcSr1SourcePolygon[3];
    }>;
    observables: AfcSr1SupportedRoomViewObservables;
    reason: string;
  }> | null;
}>;

export type AfcSr1LiveAuthoritativeGeometry = Readonly<{
  status: "authoritative_geometry";
  schemaVersion: typeof AFC_SR1_LIVE_PRODUCT_VERSION;
  attemptId: string;
  resultId: string;
  labLoadGeneration: number;
  originalBasis: AfcSr1LiveBasis;
  emptyBasis: AfcSr1LiveBasis;
  photoClass:
    | "off_axis_left_near"
    | "off_axis_right_near"
    | "on_axis"
    | "tiled_perspective_core";
  geometry: Readonly<{
    mode:
      | "raw-direct"
      | "tiled-placement"
      | "on-axis-parallel-width"
      | "tiled-perspective-core";
    geometryAuthority:
      | "supported_domain_near_side_derived"
      | "on_axis_parallel_width_derived"
      | "tiled_perspective_reader";
    sourceNormalizedPolygon: AfcSr1SourcePolygon;
    rawSourceNormalizedPolygon: AfcSr1SourcePolygon;
    fixedAnchor: "NL" | "NR" | null;
    adjustableCorner: "NL" | "NR" | null;
    baselineSeamT: number | null;
    acceptanceBasis: Readonly<{
      basisFingerprint: string;
      decodedWidth: number;
      decodedHeight: number;
      orientation: 1;
      transferKind:
        | "paired_cross_role_exact_grid"
        | "paired_cross_role_aspect_rescaled";
      transferProvenance: string;
    }>;
    classifierVersion: string | null;
    anchorAuthorityKind: "supported_domain_near_side_derived" | null;
    onAxisConstruction: "NL_fixed" | "NR_fixed" | null;
    tiledPerspective?: Readonly<{
      tiledBasis: AfcSr1LiveBasis;
      emptyToTiledLineageDigest: string;
      emptyToTiledTransfer: "identity_source_normalized";
      emptyToOriginalCompatibilityTier:
        | "exact_grid_compatible"
        | "aspect_compatible_rescaled";
      readerVersion: "afc-sr1-tiled-perspective-reader/s1";
      core: Readonly<{
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
    }>;
  }>;
  metric: Readonly<{
    perspectiveAuthority: "afc_derived" | "tiled_perspective_core";
    metricScaleAuthority: "provisional_reference_depth";
    referenceDepthM: number;
  }>;
  perspectiveAdjust: Readonly<{
    supported: boolean;
    reason:
      | "off_axis_live_baseline"
      | "on_axis_not_applicable_v1"
      | "tiled_cluster_not_applicable_v1";
  }>;
  diagnostics: AfcSr1LiveDiagnostics;
}>;

export type AfcSr1LiveDegradedEvidence = Readonly<{
  status: "degraded_evidence";
  schemaVersion: typeof AFC_SR1_LIVE_PRODUCT_VERSION;
  attemptId: string;
  resultId: string;
  labLoadGeneration: number;
  originalBasis: AfcSr1LiveBasis;
  emptyBasis: AfcSr1LiveBasis;
  photoClass: "off_axis_left_near" | "off_axis_right_near";
  geometryAuthority: "none";
  reason: "validation_residual_exceeds_limit";
  diagnostics: AfcSr1LiveDiagnostics;
}>;

export type AfcSr1LiveFailureReason =
  | "invalid_request"
  | "original_qualification_failed"
  | "source_identity_mismatch"
  | "empty_generation_failed"
  | "original_empty_incompatible"
  | "tiled_generation_failed"
  | "tiled_lineage_not_exact_grid"
  | "tiled_reader_transport_failed"
  | "tiled_identity_mismatch"
  | "no_complete_tile"
  | "no_coherent_lattice"
  | "lattice_assignment_conflict"
  | "no_rectangular_core"
  | "homography_failure"
  | "semantic_ordering_failure"
  | "gemini_transport_failed"
  | "gemini_response_invalid"
  | "gemini_insufficient_evidence"
  | "floor_proposal_invalid"
  | "floor_proposal_off_frame"
  | "supported_room_ambiguous"
  | "on_axis_correction_failed"
  | "path_a_failed";

export type AfcSr1LiveFailed = Readonly<{
  status: "failed";
  schemaVersion: typeof AFC_SR1_LIVE_PRODUCT_VERSION;
  attemptId: string;
  resultId: string;
  labLoadGeneration: number;
  reason: AfcSr1LiveFailureReason;
  detail: string;
  diagnostics: AfcSr1LiveDiagnostics;
}>;

export type AfcSr1LiveProductResult =
  | AfcSr1LiveAuthoritativeGeometry
  | AfcSr1LiveDegradedEvidence
  | AfcSr1LiveFailed;

export function isAfcSr1LiveAuthoritativeGeometry(
  value: AfcSr1LiveProductResult
): value is AfcSr1LiveAuthoritativeGeometry {
  return value.status === "authoritative_geometry";
}
