import controlFixture from "./research/fixtures/afc-sr1-room-c-lab-apply-control.v1.json";
import { validateFloorSourcePolygonExtent } from "./floor-coordinate-extent";
import { validateOrderedFloorCorners } from "./perspective-solve";
import { classifyAfcR3cImagePairCompatibility } from "./research/afc-r3c-image-pair-compatibility";

export const AFC_LAB_GEOMETRY_SEMANTIC_ORDER = ["NL", "NR", "FR", "FL"] as const;

type Point = Readonly<{ x: number; y: number }>;
type Polygon = readonly [Point, Point, Point, Point];
type RecordValue = Record<string, unknown>;

const ROOM_C_ORIGINAL_BASIS_FINGERPRINT = "32edb8294a3e5c68d0e54bd5c387eb408b0bc1e15dad781cef0206090df4df1e";

export type AfcLabGeometryCandidateFailure =
  | "fixture_shape_invalid"
  | "coordinate_space_invalid"
  | "semantic_order_invalid"
  | "source_polygon_invalid"
  | "seam_invalid"
  | "reference_depth_invalid"
  | "acceptance_basis_invalid"
  | "diagnostic_control_invalid";

export type AfcLabDiagnosticSidecar = Readonly<{
  caseId: "C-P04";
  placementStatus: "rejected";
  placementReason: "validation_residual_exceeds_limit";
  validationP90Px: number;
  geometryAuthority: "none";
  provenance: string;
}>;

export type AfcLabGeometryCandidate = Readonly<{
  roomId: "room-c";
  roomLabel: "Room C Original";
  source: "raw-direct-path-a";
  semanticOrder: typeof AFC_LAB_GEOMETRY_SEMANTIC_ORDER;
  sourceNormalizedPolygon: Polygon;
  rawSourceNormalizedPolygon: Polygon;
  adjustableCorner: "NR";
  baselineSeamT: number;
  seamT: number;
  referenceDepthM: number;
  acceptanceBasis: Readonly<{
    basisFingerprint: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
    transferKind: "paired_cross_role_aspect_rescaled";
    transferProvenance: string;
  }>;
  geometryProvenance: Readonly<{
    emptyBasisFingerprint: string;
    emptyDecodedWidth: number;
    emptyDecodedHeight: number;
    polygonFingerprint: string;
    pathAEvidenceIdentity: string;
    pathAEvidenceDigest: string;
    pathAEvidenceProvenance: string;
  }>;
  diagnostics: AfcLabDiagnosticSidecar;
}>;

export type AfcLabGeometryCandidateResult =
  | Readonly<{ ok: true; candidate: AfcLabGeometryCandidate }>
  | Readonly<{ ok: false; reason: AfcLabGeometryCandidateFailure }>;

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function point(value: unknown): Point | null {
  if (!isRecord(value)) return null;
  const x = finite(value.x);
  const y = finite(value.y);
  return x === null || y === null ? null : Object.freeze({ x, y });
}

function polygon(value: unknown): Polygon | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points = value.map(point);
  if (points.some((candidate) => !candidate)) return null;
  const result = points as [Point, Point, Point, Point];
  if (!validateFloorSourcePolygonExtent(result).ok || !validateOrderedFloorCorners(result).ok) return null;
  return Object.freeze(result);
}

function exactSemanticOrder(value: unknown): value is typeof AFC_LAB_GEOMETRY_SEMANTIC_ORDER {
  return (
    Array.isArray(value) &&
    value.length === AFC_LAB_GEOMETRY_SEMANTIC_ORDER.length &&
    value.every((corner, index) => corner === AFC_LAB_GEOMETRY_SEMANTIC_ORDER[index])
  );
}

function constructNrAdjustedPolygon(raw: Polygon, seamT: number): Polygon | null {
  if (!Number.isFinite(seamT) || seamT < 0 || seamT > 1) return null;
  const nr = raw[1];
  const fr = raw[2];
  const adjustedNr = Object.freeze({
    x: nr.x + seamT * (fr.x - nr.x),
    y: nr.y + seamT * (fr.y - nr.y),
  });
  const adjusted = Object.freeze([raw[0], adjustedNr, raw[2], raw[3]] as const);
  return (
    validateFloorSourcePolygonExtent(adjusted).ok &&
    validateOrderedFloorCorners(adjusted.map((point) => ({ ...point }))).ok
  )
    ? adjusted
    : null;
}

function invalid(reason: AfcLabGeometryCandidateFailure): AfcLabGeometryCandidateResult {
  return Object.freeze({ ok: false as const, reason });
}

/**
 * Constructs only the frozen Room C RAW-direct geometry candidate. C-P04 is
 * carried as display-only diagnostics and is deliberately not read by polygon
 * construction or seam selection.
 */
export function buildAfcLabGeometryCandidate(control: unknown): AfcLabGeometryCandidateResult {
  if (!isRecord(control) || control.schemaVersion !== "afc-sr1-room-c-lab-apply-control/v1") {
    return invalid("fixture_shape_invalid");
  }
  const room = isRecord(control.room) ? control.room : null;
  const acceptanceImage = isRecord(control.acceptanceImage) ? control.acceptanceImage : null;
  const geometry = isRecord(control.geometryControl) ? control.geometryControl : null;
  const diagnosticsControls = isRecord(control.diagnosticControls) ? control.diagnosticControls : null;
  const cp04 = diagnosticsControls && isRecord(diagnosticsControls["C-P04"]) ? diagnosticsControls["C-P04"] : null;
  if (!room || room.id !== "room-c" || room.label !== "Room C Original" || !geometry) {
    return invalid("fixture_shape_invalid");
  }
  if (geometry.source !== "raw-direct-path-a" || geometry.coordinateSpace !== "source-normalized/v1") {
    return invalid("coordinate_space_invalid");
  }
  if (!exactSemanticOrder(geometry.semanticOrder)) return invalid("semantic_order_invalid");

  const emptyPolygon = isRecord(geometry.emptyBasisBoundPolygon) ? geometry.emptyBasisBoundPolygon : null;
  const rawPolygon = emptyPolygon ? polygon(emptyPolygon.polygon) : null;
  if (!emptyPolygon || !rawPolygon) return invalid("source_polygon_invalid");

  const seam = isRecord(geometry.seam) ? geometry.seam : null;
  const seamT = seam ? finite(seam.seamT) : null;
  if (
    !seam ||
    seam.adjustableCorner !== "NR" ||
    seam.direction !== "near_to_far" ||
    seam.baselineImmutable !== true ||
    seamT === null ||
    seamT < 0 ||
    seamT > 1
  ) {
    return invalid("seam_invalid");
  }
  const sourceNormalizedPolygon = constructNrAdjustedPolygon(rawPolygon, seamT);
  if (!sourceNormalizedPolygon) return invalid("seam_invalid");

  const referenceDepthM = finite(geometry.referenceDepthM);
  if (referenceDepthM === null || referenceDepthM <= 0) return invalid("reference_depth_invalid");

  const basisFingerprint = acceptanceImage ? string(acceptanceImage.basisFingerprint) : null;
  const decodedWidth = acceptanceImage ? finite(acceptanceImage.decodedWidth) : null;
  const decodedHeight = acceptanceImage ? finite(acceptanceImage.decodedHeight) : null;
  const transfer = acceptanceImage && isRecord(acceptanceImage.transfer) ? acceptanceImage.transfer : null;
  if (
    !acceptanceImage ||
    acceptanceImage.role !== "original" ||
    acceptanceImage.orientation !== 1 ||
    !basisFingerprint ||
    basisFingerprint !== ROOM_C_ORIGINAL_BASIS_FINGERPRINT ||
    decodedWidth === null ||
    decodedHeight === null ||
    decodedWidth <= 0 ||
    decodedHeight <= 0 ||
    !transfer ||
    transfer.kind !== "paired_cross_role_aspect_rescaled" ||
    transfer.sourceCoordinateSpace !== "source-normalized/v1" ||
    !string(transfer.provenance)
  ) {
    return invalid("acceptance_basis_invalid");
  }

  const pathAEvidence = isRecord(geometry.pathAEvidence) ? geometry.pathAEvidence : null;
  const emptyBasisFingerprint = string(emptyPolygon.basisFingerprint);
  const emptyDecodedWidth = finite(emptyPolygon.decodedWidth);
  const emptyDecodedHeight = finite(emptyPolygon.decodedHeight);
  const polygonFingerprint = string(emptyPolygon.polygonFingerprint);
  const pathAEvidenceIdentity = pathAEvidence ? string(pathAEvidence.identity) : null;
  const pathAEvidenceDigest = pathAEvidence ? string(pathAEvidence.digest) : null;
  const pathAEvidenceProvenance = pathAEvidence ? string(pathAEvidence.provenance) : null;
  if (
    emptyPolygon.orientation !== 1 ||
    !emptyBasisFingerprint ||
    emptyDecodedWidth === null ||
    emptyDecodedHeight === null ||
    !polygonFingerprint ||
    !pathAEvidenceIdentity ||
    !pathAEvidenceDigest ||
    !pathAEvidenceProvenance
  ) {
    return invalid("fixture_shape_invalid");
  }
  if (emptyPolygon.generatedFromOriginalSha256 !== basisFingerprint) {
    return invalid("acceptance_basis_invalid");
  }
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: basisFingerprint,
      decodedWidth,
      decodedHeight,
      orientation: 1,
    },
    {
      fingerprint: emptyBasisFingerprint,
      decodedWidth: emptyDecodedWidth,
      decodedHeight: emptyDecodedHeight,
      orientation: 1,
    }
  );
  if (compatibility.tier !== "aspect_compatible_rescaled") {
    return invalid("acceptance_basis_invalid");
  }

  const validationP90Px = cp04 ? finite(cp04.validationP90Px) : null;
  const diagnosticProvenance = cp04 ? string(cp04.provenance) : null;
  if (
    !cp04 ||
    cp04.caseId !== "C-P04" ||
    cp04.placementStatus !== "rejected" ||
    cp04.placementReason !== "validation_residual_exceeds_limit" ||
    validationP90Px === null ||
    cp04.geometryAuthority !== "none" ||
    !diagnosticProvenance
  ) {
    return invalid("diagnostic_control_invalid");
  }

  return Object.freeze({
    ok: true as const,
    candidate: Object.freeze({
      roomId: "room-c",
      roomLabel: "Room C Original",
      source: "raw-direct-path-a",
      semanticOrder: AFC_LAB_GEOMETRY_SEMANTIC_ORDER,
      sourceNormalizedPolygon,
      rawSourceNormalizedPolygon: rawPolygon,
      adjustableCorner: "NR",
      baselineSeamT: seamT,
      seamT,
      referenceDepthM,
      acceptanceBasis: Object.freeze({
        basisFingerprint,
        decodedWidth,
        decodedHeight,
        orientation: 1,
        transferKind: "paired_cross_role_aspect_rescaled",
        transferProvenance: transfer.provenance as string,
      }),
      geometryProvenance: Object.freeze({
        emptyBasisFingerprint,
        emptyDecodedWidth,
        emptyDecodedHeight,
        polygonFingerprint,
        pathAEvidenceIdentity,
        pathAEvidenceDigest,
        pathAEvidenceProvenance,
      }),
      diagnostics: Object.freeze({
        caseId: "C-P04",
        placementStatus: "rejected",
        placementReason: "validation_residual_exceeds_limit",
        validationP90Px,
        geometryAuthority: "none",
        provenance: diagnosticProvenance,
      }),
    }),
  });
}

export const ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE = buildAfcLabGeometryCandidate(controlFixture);
