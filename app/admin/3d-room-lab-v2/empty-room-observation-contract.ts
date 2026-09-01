import {
  normalizeEmptyRoomObservationEvidence,
  type EmptyObservationAdjacency,
  type EmptyObservationRejection,
  type EmptyRoomObservationNormalizationDiagnostics,
} from "./empty-room-observation-normalization";

export const AFC_V2_EMPTY_ROOM_OBSERVATION_VERSION =
  "afc-v2-empty-room-observation-evidence/v1" as const;
export const AFC_V2_EMPTY_ROOM_OBSERVATION_COORDINATE_SPACE =
  "empty-source-normalized-image/v1" as const;
export const AFC_V2_EMPTY_ROOM_OBSERVATION_AUTHORITY =
  "observation_only" as const;

export type RoomObservationImageIdentity = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  orientation: 1;
}>;

export type SourceNormalizedPoint = Readonly<{ x: number; y: number }>;

export type EmptyObservedPlaneCategory =
  | "floor"
  | "wall"
  | "ceiling"
  | "unknown";
export type EmptyObservedSeamCategory =
  | "floor_wall"
  | "wall_wall"
  | "wall_ceiling"
  | "unknown";
export type EmptyObservedOpeningCategory =
  | "door"
  | "doorway"
  | "window"
  | "archway"
  | "pass_through"
  | "other_major_opening"
  | "unknown";
export type EmptyObservedJunctionCategory =
  | "room_corner"
  | "seam_junction"
  | "opening_boundary_intersection"
  | "unknown";

export type EmptyObservedPlane = Readonly<{
  id: string;
  category: EmptyObservedPlaneCategory;
  sourceNormalizedPolygon: readonly SourceNormalizedPoint[];
  regionRole:
    | "observed_visible_floor_region"
    | "observed_visible_plane_region";
  confidence: number;
  ambiguity: string | null;
  evidenceClass: "provider_reported_visible_evidence";
}>;

export type EmptyObservedSeamObservationSource =
  | "general_empty_observer"
  | "focused_side_ceiling_wall";

export type EmptyObservedSeam = Readonly<{
  id: string;
  category: EmptyObservedSeamCategory;
  planeIds: readonly string[];
  sourceNormalizedPolyline: readonly SourceNormalizedPoint[];
  endpointPolicy: "preserve_observed_open_endpoints";
  confidence: number;
  ambiguity: string | null;
  evidenceClass: "provider_reported_visible_evidence";
  observationSource: EmptyObservedSeamObservationSource;
}>;

export type EmptyObservedOpening = Readonly<{
  id: string;
  category: EmptyObservedOpeningCategory;
  hostPlaneId: string | null;
  sourceNormalizedBoundary: readonly SourceNormalizedPoint[];
  boundaryClosure:
    | "complete_visible_outline"
    | "partial_visible_outline";
  providerClaimedBoundaryClosure:
    | "complete_visible_outline"
    | "partial_visible_outline";
  boundaryEvidenceCompleteness:
    | "all_edges_visibly_traced"
    | "partial_edges_only";
  closureValidation:
    | "consistent_complete"
    | "consistent_partial"
    | "downgraded_to_partial_due_incomplete_visible_edge_evidence"
    | "conservative_partial_preserved_despite_complete_edge_evidence";
  confidence: number;
  ambiguity: string | null;
  evidenceClass: "provider_reported_visible_evidence";
}>;

export type EmptyObservedJunction = Readonly<{
  id: string;
  category: EmptyObservedJunctionCategory;
  sourceNormalizedPoint: SourceNormalizedPoint;
  seamIds: readonly string[];
  openingIds: readonly string[];
  confidence: number;
  ambiguity: string | null;
  evidenceClass: "provider_reported_visible_evidence";
}>;

export type EmptyRoomObservationFailureDiagnostic = Readonly<{
  failureClass:
    | "configuration"
    | "basis_validation"
    | "transport"
    | "provider_http"
    | "provider_response"
    | "json_parse"
    | "contract_validation"
    | "timeout"
    | "unknown";
  failureStage:
    | "configuration"
    | "basis_validation"
    | "provider_invocation"
    | "provider_response"
    | "response_extraction"
    | "json_parse"
    | "contract_validation";
  provider: "google_gemini" | "controlled_fixture";
  model: string;
  providerStatus: number | null;
  safeDetail: string;
  contractValidationReason: string | null;
}>;

export type FocusedSideCeilingWallMergeReceipt = Readonly<{
  observerStatus: "observed" | "partial" | "failed" | "empty" | "not_run";
  promptVersion: string | null;
  emptyIdentitySha256: string | null;
  addedSeamIds: readonly string[];
  skippedDuplicateSeamIds: readonly string[];
  rejectedSeamIds: readonly string[];
  suppressedGeneralSeamIds: readonly string[];
  skippedJunctionIds: readonly string[];
  resolutionReasons: readonly string[];
  geometryManufactured: false;
  hiddenContinuationAdded: false;
  failure: EmptyRoomObservationFailureDiagnostic | null;
}>;

export const AFC_V2_FOCUSED_SIDE_CEILING_WALL_NOT_RUN =
  Object.freeze({
    observerStatus: "not_run",
    promptVersion: null,
    emptyIdentitySha256: null,
    addedSeamIds: Object.freeze([] as const),
    skippedDuplicateSeamIds: Object.freeze([] as const),
    rejectedSeamIds: Object.freeze([] as const),
    suppressedGeneralSeamIds: Object.freeze([] as const),
    skippedJunctionIds: Object.freeze([] as const),
    resolutionReasons: Object.freeze([] as const),
    geometryManufactured: false,
    hiddenContinuationAdded: false,
    failure: null,
  }) satisfies FocusedSideCeilingWallMergeReceipt;

export type FocusedSideFloorWallMergeReceipt = Readonly<{
  observerStatus: "observed" | "partial" | "failed" | "empty" | "not_run";
  promptVersion: string | null;
  emptyIdentitySha256: string | null;
  addedPlaneIds: readonly string[];
  addedSeamIds: readonly string[];
  skippedDuplicatePlaneIds: readonly string[];
  skippedDuplicateSeamIds: readonly string[];
  rejectedPlaneIds: readonly string[];
  rejectedSeamIds: readonly string[];
  resolutionReasons: readonly string[];
  geometryManufactured: false;
  hiddenContinuationAdded: false;
  failure: EmptyRoomObservationFailureDiagnostic | null;
}>;

export const AFC_V2_FOCUSED_SIDE_FLOOR_WALL_NOT_RUN =
  Object.freeze({
    observerStatus: "not_run",
    promptVersion: null,
    emptyIdentitySha256: null,
    addedPlaneIds: Object.freeze([] as const),
    addedSeamIds: Object.freeze([] as const),
    skippedDuplicatePlaneIds: Object.freeze([] as const),
    skippedDuplicateSeamIds: Object.freeze([] as const),
    rejectedPlaneIds: Object.freeze([] as const),
    rejectedSeamIds: Object.freeze([] as const),
    resolutionReasons: Object.freeze([] as const),
    geometryManufactured: false,
    hiddenContinuationAdded: false,
    failure: null,
  }) satisfies FocusedSideFloorWallMergeReceipt;

type EvidenceContext = Readonly<{
  attemptId: string;
  loadGeneration: number;
  emptyIdentity: RoomObservationImageIdentity;
  originalAncestorSha256: string;
  provider: EmptyRoomObservationFailureDiagnostic["provider"];
  model: string;
  observerProfile: string;
  promptVersion: string;
  generatedAt: string;
}>;

type CommonEvidence = Readonly<{
  schemaVersion: typeof AFC_V2_EMPTY_ROOM_OBSERVATION_VERSION;
  basis: Readonly<{
    kind: "EMPTY";
    identity: RoomObservationImageIdentity;
    originalAncestorSha256: string;
    attemptId: string;
    loadGeneration: number;
    exactRetainedBytesConsumed: true;
  }>;
  coordinateSpace: typeof AFC_V2_EMPTY_ROOM_OBSERVATION_COORDINATE_SPACE;
  authority: typeof AFC_V2_EMPTY_ROOM_OBSERVATION_AUTHORITY;
  observer: Readonly<{
    provider: string;
    model: string;
    profile: string;
    promptVersion: string;
    generatedAt: string;
  }>;
  authoritySeparation: Readonly<{
    cameraAuthorityConsumed: false;
    floorAuthorityConsumed: false;
    worldProjectionPerformed: false;
    tiledEvidenceConsumed: false;
    fullyTiledEvidenceConsumed: false;
  }>;
}>;

export type EmptyRoomObservationAcceptedEvidence = CommonEvidence & Readonly<{
  observerStatus: "observed" | "partial";
  observedPlanes: readonly EmptyObservedPlane[];
  observedVisibleFloorRegions: readonly Readonly<{
    planeId: string;
    sourceNormalizedPolygon: readonly SourceNormalizedPoint[];
    confidence: number;
    ambiguity: string | null;
    role: "observed_visible_floor_region_not_floor_authority";
  }>[];
  observedSeams: readonly EmptyObservedSeam[];
  observedOpenings: readonly EmptyObservedOpening[];
  observedJunctions: readonly EmptyObservedJunction[];
  observedAdjacency: readonly EmptyObservationAdjacency[];
  qualityGate: Readonly<{
    status: "accepted" | "partial";
    rejectedForbiddenProviderFields: readonly string[];
    parserRejections: readonly EmptyObservationRejection[];
    normalization: EmptyRoomObservationNormalizationDiagnostics;
    unresolved: readonly string[];
    partialReasons: readonly string[];
    openingClosureAdjustments: readonly Readonly<{
      openingId: string;
      providerClaim: "complete_visible_outline" | "partial_visible_outline";
      normalizedClosure: "partial_visible_outline";
      reason:
        | "provider_complete_claim_conflicted_with_partial_visible_edge_evidence"
        | "provider_partial_claim_preserved_despite_complete_edge_evidence";
    }>[];
    focusedSideCeilingWall: FocusedSideCeilingWallMergeReceipt;
    focusedSideFloorWall: FocusedSideFloorWallMergeReceipt;
  }>;
  failure: null;
}>;

export type EmptyRoomObservationFailedEvidence = CommonEvidence & Readonly<{
  observerStatus: "failed";
  observedPlanes: readonly [];
  observedVisibleFloorRegions: readonly [];
  observedSeams: readonly [];
  observedOpenings: readonly [];
  observedJunctions: readonly [];
  observedAdjacency: readonly [];
  qualityGate: Readonly<{
    status: "failed";
    rejectedForbiddenProviderFields: readonly [];
    parserRejections: readonly [];
    normalization: null;
    unresolved: readonly [];
    partialReasons: readonly [];
    openingClosureAdjustments: readonly [];
    focusedSideCeilingWall: null;
    focusedSideFloorWall: null;
  }>;
  failure: EmptyRoomObservationFailureDiagnostic;
}>;

export type EmptyRoomObservationEvidence =
  | EmptyRoomObservationAcceptedEvidence
  | EmptyRoomObservationFailedEvidence;

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const MAX_PLANES = 24;
const MAX_SEAMS = 48;
const MAX_OPENINGS = 32;
const MAX_JUNCTIONS = 64;
const MAX_POINTS = 96;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function point(value: unknown): SourceNormalizedPoint | null {
  const candidate = record(value);
  return candidate &&
      typeof candidate.x === "number" &&
      typeof candidate.y === "number" &&
      Number.isFinite(candidate.x) &&
      Number.isFinite(candidate.y) &&
      candidate.x >= 0 &&
      candidate.x <= 1 &&
      candidate.y >= 0 &&
      candidate.y <= 1
    ? Object.freeze({ x: candidate.x, y: candidate.y })
    : null;
}

function points(
  value: unknown,
  minimum: number,
): readonly SourceNormalizedPoint[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_POINTS) {
    return null;
  }
  const parsed = value.map(point);
  return parsed.every((item): item is SourceNormalizedPoint => item !== null)
    ? Object.freeze(parsed)
    : null;
}

function confidence(value: unknown): number | null {
  return typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1
    ? value
    : null;
}

function ambiguity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 240) : null;
}

function uniqueId(value: unknown, seen: Set<string>): string | null {
  if (typeof value !== "string" || !ID_PATTERN.test(value) || seen.has(value)) {
    return null;
  }
  seen.add(value);
  return value;
}

function references(value: unknown, maximum: number): readonly string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const parsed = [...new Set(value)];
  return parsed.every((item): item is string =>
      typeof item === "string" && ID_PATTERN.test(item)
    )
    ? Object.freeze(parsed)
    : null;
}

function planeCategory(value: unknown): EmptyObservedPlaneCategory | null {
  return value === "floor" ||
      value === "wall" ||
      value === "ceiling" ||
      value === "unknown"
    ? value
    : null;
}

function seamCategory(value: unknown): EmptyObservedSeamCategory | null {
  return value === "floor_wall" ||
      value === "wall_wall" ||
      value === "wall_ceiling" ||
      value === "unknown"
    ? value
    : null;
}

function openingCategory(value: unknown): EmptyObservedOpeningCategory | null {
  return value === "door" ||
      value === "doorway" ||
      value === "window" ||
      value === "archway" ||
      value === "pass_through" ||
      value === "other_major_opening" ||
      value === "unknown"
    ? value
    : null;
}

function junctionCategory(value: unknown): EmptyObservedJunctionCategory | null {
  return value === "room_corner" ||
      value === "seam_junction" ||
      value === "opening_boundary_intersection" ||
      value === "unknown"
    ? value
    : null;
}

function common(context: EvidenceContext): CommonEvidence {
  return Object.freeze({
    schemaVersion: AFC_V2_EMPTY_ROOM_OBSERVATION_VERSION,
    basis: Object.freeze({
      kind: "EMPTY" as const,
      identity: context.emptyIdentity,
      originalAncestorSha256: context.originalAncestorSha256,
      attemptId: context.attemptId,
      loadGeneration: context.loadGeneration,
      exactRetainedBytesConsumed: true as const,
    }),
    coordinateSpace: AFC_V2_EMPTY_ROOM_OBSERVATION_COORDINATE_SPACE,
    authority: AFC_V2_EMPTY_ROOM_OBSERVATION_AUTHORITY,
    observer: Object.freeze({
      provider: context.provider,
      model: context.model,
      profile: context.observerProfile,
      promptVersion: context.promptVersion,
      generatedAt: context.generatedAt,
    }),
    authoritySeparation: Object.freeze({
      cameraAuthorityConsumed: false as const,
      floorAuthorityConsumed: false as const,
      worldProjectionPerformed: false as const,
      tiledEvidenceConsumed: false as const,
      fullyTiledEvidenceConsumed: false as const,
    }),
  });
}

/**
 * Maps untrusted provider JSON into source-normalized, visible-only EMPTY
 * evidence. Invalid primitives are omitted and receipted instead of repaired.
 */
export function buildEmptyRoomObservationEvidence(
  raw: unknown,
  context: EvidenceContext,
): EmptyRoomObservationAcceptedEvidence {
  const root = record(raw) ?? {};
  const parserRejections: EmptyObservationRejection[] = [];
  const reject = (
    kind: EmptyObservationRejection["kind"],
    rawId: unknown,
    reason: string,
  ) => {
    parserRejections.push(Object.freeze({
      kind,
      rawId: typeof rawId === "string" && ID_PATTERN.test(rawId) ? rawId : null,
      reason,
    }));
  };

  const planeIds = new Set<string>();
  const planes: EmptyObservedPlane[] = [];
  const rawPlanes = Array.isArray(root.observedPlanes)
    ? root.observedPlanes.slice(0, MAX_PLANES)
    : [];
  for (const value of rawPlanes) {
    const candidate = record(value);
    const id = uniqueId(candidate?.id, planeIds);
    const category = planeCategory(candidate?.category);
    const polygon = points(candidate?.sourceNormalizedPolygon, 3);
    const certainty = confidence(candidate?.confidence);
    if (
      !candidate ||
      !id ||
      !category ||
      !polygon ||
      certainty === null ||
      candidate.visibility !== "observed"
    ) {
      reject("plane", candidate?.id, "malformed_or_nonvisible_plane");
      if (id) planeIds.delete(id);
      continue;
    }
    planes.push(Object.freeze({
      id,
      category,
      sourceNormalizedPolygon: polygon,
      regionRole: category === "floor"
        ? "observed_visible_floor_region"
        : "observed_visible_plane_region",
      confidence: certainty,
      ambiguity: ambiguity(candidate.ambiguity),
      evidenceClass: "provider_reported_visible_evidence",
    }));
  }

  const seamIds = new Set<string>();
  const seams: EmptyObservedSeam[] = [];
  const rawSeams = Array.isArray(root.observedSeams)
    ? root.observedSeams.slice(0, MAX_SEAMS)
    : [];
  for (const value of rawSeams) {
    const candidate = record(value);
    const id = uniqueId(candidate?.id, seamIds);
    const category = seamCategory(candidate?.category);
    const planeReferences = references(candidate?.planeIds, 2);
    const polyline = points(candidate?.sourceNormalizedPolyline, 2);
    const certainty = confidence(candidate?.confidence);
    if (
      !candidate ||
      !id ||
      !category ||
      !planeReferences ||
      planeReferences.length === 0 ||
      !polyline ||
      certainty === null ||
      candidate.visibility !== "observed"
    ) {
      reject("seam", candidate?.id, "malformed_or_nonvisible_seam");
      if (id) seamIds.delete(id);
      continue;
    }
    seams.push(Object.freeze({
      id,
      category,
      planeIds: planeReferences,
      sourceNormalizedPolyline: polyline,
      endpointPolicy: "preserve_observed_open_endpoints",
      confidence: certainty,
      ambiguity: ambiguity(candidate.ambiguity),
      evidenceClass: "provider_reported_visible_evidence",
      observationSource: "general_empty_observer",
    }));
  }

  const openingIds = new Set<string>();
  const openings: EmptyObservedOpening[] = [];
  const openingClosureAdjustments: {
    openingId: string;
    providerClaim: "complete_visible_outline" | "partial_visible_outline";
    normalizedClosure: "partial_visible_outline";
    reason:
      | "provider_complete_claim_conflicted_with_partial_visible_edge_evidence"
      | "provider_partial_claim_preserved_despite_complete_edge_evidence";
  }[] = [];
  const rawOpenings = Array.isArray(root.observedOpenings)
    ? root.observedOpenings.slice(0, MAX_OPENINGS)
    : [];
  for (const value of rawOpenings) {
    const candidate = record(value);
    const id = uniqueId(candidate?.id, openingIds);
    const category = openingCategory(candidate?.category);
    const providerClaimedClosure =
        candidate?.boundaryClosure === "complete_visible_outline" ||
        candidate?.boundaryClosure === "partial_visible_outline"
      ? candidate.boundaryClosure
      : null;
    const boundaryEvidenceCompleteness =
        candidate?.boundaryEvidenceCompleteness === "all_edges_visibly_traced" ||
        candidate?.boundaryEvidenceCompleteness === "partial_edges_only"
      ? candidate.boundaryEvidenceCompleteness
      : null;
    const closure = providerClaimedClosure === "complete_visible_outline" &&
        boundaryEvidenceCompleteness === "all_edges_visibly_traced"
      ? "complete_visible_outline" as const
      : providerClaimedClosure
      ? "partial_visible_outline" as const
      : null;
    const boundary = points(
      candidate?.sourceNormalizedBoundary,
      closure === "complete_visible_outline" ? 3 : 2,
    );
    const certainty = confidence(candidate?.confidence);
    const hostPlaneId = candidate?.hostPlaneId === null
      ? null
      : typeof candidate?.hostPlaneId === "string" &&
          ID_PATTERN.test(candidate.hostPlaneId)
      ? candidate.hostPlaneId
      : undefined;
    if (
      !candidate ||
      !id ||
      !category ||
      !providerClaimedClosure ||
      !boundaryEvidenceCompleteness ||
      !closure ||
      !boundary ||
      certainty === null ||
      hostPlaneId === undefined ||
      candidate.visibility !== "observed"
    ) {
      reject("opening", candidate?.id, "malformed_or_nonvisible_opening");
      if (id) openingIds.delete(id);
      continue;
    }
    const closureValidation =
      providerClaimedClosure === "complete_visible_outline" &&
        boundaryEvidenceCompleteness === "all_edges_visibly_traced"
        ? "consistent_complete" as const
        : providerClaimedClosure === "partial_visible_outline" &&
            boundaryEvidenceCompleteness === "partial_edges_only"
        ? "consistent_partial" as const
        : providerClaimedClosure === "complete_visible_outline"
        ? "downgraded_to_partial_due_incomplete_visible_edge_evidence" as const
        : "conservative_partial_preserved_despite_complete_edge_evidence" as const;
    if (
      closureValidation ===
        "downgraded_to_partial_due_incomplete_visible_edge_evidence"
    ) {
      openingClosureAdjustments.push({
        openingId: id,
        providerClaim: providerClaimedClosure,
        normalizedClosure: "partial_visible_outline",
        reason:
          "provider_complete_claim_conflicted_with_partial_visible_edge_evidence",
      });
    } else if (
      closureValidation ===
        "conservative_partial_preserved_despite_complete_edge_evidence"
    ) {
      openingClosureAdjustments.push({
        openingId: id,
        providerClaim: providerClaimedClosure,
        normalizedClosure: "partial_visible_outline",
        reason:
          "provider_partial_claim_preserved_despite_complete_edge_evidence",
      });
    }
    openings.push(Object.freeze({
      id,
      category,
      hostPlaneId,
      sourceNormalizedBoundary: boundary,
      boundaryClosure: closure,
      providerClaimedBoundaryClosure: providerClaimedClosure,
      boundaryEvidenceCompleteness,
      closureValidation,
      confidence: certainty,
      ambiguity: ambiguity(candidate.ambiguity),
      evidenceClass: "provider_reported_visible_evidence",
    }));
  }

  const junctionIds = new Set<string>();
  const junctions: EmptyObservedJunction[] = [];
  const rawJunctions = Array.isArray(root.observedJunctions)
    ? root.observedJunctions.slice(0, MAX_JUNCTIONS)
    : [];
  for (const value of rawJunctions) {
    const candidate = record(value);
    const id = uniqueId(candidate?.id, junctionIds);
    const category = junctionCategory(candidate?.category);
    const location = point(candidate?.sourceNormalizedPoint);
    const seamReferences = references(candidate?.seamIds, 8);
    const openingReferences = references(candidate?.openingIds, 8);
    const certainty = confidence(candidate?.confidence);
    if (
      !candidate ||
      !id ||
      !category ||
      !location ||
      !seamReferences ||
      !openingReferences ||
      certainty === null ||
      candidate.visibility !== "observed"
    ) {
      reject("junction", candidate?.id, "malformed_or_nonvisible_junction");
      if (id) junctionIds.delete(id);
      continue;
    }
    junctions.push(Object.freeze({
      id,
      category,
      sourceNormalizedPoint: location,
      seamIds: seamReferences,
      openingIds: openingReferences,
      confidence: certainty,
      ambiguity: ambiguity(candidate.ambiguity),
      evidenceClass: "provider_reported_visible_evidence",
    }));
  }

  const forbiddenProviderFields = [
    "camera",
    "calibratedCamera",
    "cameraPose",
    "fov",
    "verticalFovDeg",
    "floorAuthority",
    "authoritativeFloorQuad",
    "worldPlanes",
    "worldGeometry",
    "worldCoordinates",
    "wallHeights",
    "roomMesh",
    "collisionSurfaces",
    "supportSurfaces",
    "fullyTiled",
    "tiled",
  ].filter((field) => field in root);

  const normalized = normalizeEmptyRoomObservationEvidence({
    planes,
    seams,
    openings,
    junctions,
    parserRejections,
  });
  const providerUnresolved = Array.isArray(root.unresolved)
    ? root.unresolved
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.replace(/\s+/g, " ").trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 48)
    : [];
  const unresolved = Object.freeze([
    ...providerUnresolved,
    ...normalized.diagnostics.unresolvedTopology.map((entry) =>
      `${entry.reason}: ${entry.rawIds.join(",")}`.slice(0, 240)
    ),
  ].slice(0, 64));
  const partialReasons = Object.freeze([
    ...(forbiddenProviderFields.length > 0
      ? ["provider_returned_forbidden_authority_or_world_fields"]
      : []),
    ...(parserRejections.length > 0 ? ["provider_primitives_rejected"] : []),
    ...(normalized.diagnostics.rejectedEvidence.length > parserRejections.length
      ? ["normalization_rejected_degenerate_or_unbound_geometry"]
      : []),
    ...(openingClosureAdjustments.length > 0
      ? ["opening_closure_claim_adjusted_conservatively"]
      : []),
    ...(unresolved.length > 0 ? ["provider_or_topology_uncertainty_remains"] : []),
    ...(normalized.planes.length === 0 ? ["no_visible_plane_region_accepted"] : []),
  ]);
  const status = partialReasons.length > 0 ? "partial" as const : "accepted" as const;

  return Object.freeze({
    ...common(context),
    observerStatus: status === "accepted" ? "observed" as const : "partial" as const,
    observedPlanes: normalized.planes,
    observedVisibleFloorRegions: Object.freeze(
      normalized.planes
        .filter((plane) => plane.category === "floor")
        .map((plane) => Object.freeze({
          planeId: plane.id,
          sourceNormalizedPolygon: plane.sourceNormalizedPolygon,
          confidence: plane.confidence,
          ambiguity: plane.ambiguity,
          role: "observed_visible_floor_region_not_floor_authority" as const,
        })),
    ),
    observedSeams: normalized.seams,
    observedOpenings: normalized.openings,
    observedJunctions: normalized.junctions,
    observedAdjacency: normalized.adjacency,
    qualityGate: Object.freeze({
      status,
      rejectedForbiddenProviderFields: Object.freeze(forbiddenProviderFields),
      parserRejections: Object.freeze(parserRejections),
      normalization: normalized.diagnostics,
      unresolved,
      partialReasons,
      openingClosureAdjustments: Object.freeze(openingClosureAdjustments),
      focusedSideCeilingWall: AFC_V2_FOCUSED_SIDE_CEILING_WALL_NOT_RUN,
      focusedSideFloorWall: AFC_V2_FOCUSED_SIDE_FLOOR_WALL_NOT_RUN,
    }),
    failure: null,
  });
}

export function buildFailedEmptyRoomObservationEvidence(
  context: EvidenceContext,
  failure: EmptyRoomObservationFailureDiagnostic,
): EmptyRoomObservationFailedEvidence {
  return Object.freeze({
    ...common(context),
    observerStatus: "failed",
    observedPlanes: [] as const,
    observedVisibleFloorRegions: [] as const,
    observedSeams: [] as const,
    observedOpenings: [] as const,
    observedJunctions: [] as const,
    observedAdjacency: [] as const,
    qualityGate: Object.freeze({
      status: "failed",
      rejectedForbiddenProviderFields: [] as const,
      parserRejections: [] as const,
      normalization: null,
      unresolved: [] as const,
      partialReasons: [] as const,
      openingClosureAdjustments: [] as const,
      focusedSideCeilingWall: null,
      focusedSideFloorWall: null,
    }),
    failure,
  });
}
