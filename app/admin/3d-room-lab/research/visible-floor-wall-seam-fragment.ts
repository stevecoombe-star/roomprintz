import {
  BACK_WALL_SEAM_PROPOSAL_FAMILY,
  type BackWallSeamProposal,
  type BackWallSeamReadResult,
  type CandidateRejectionReason,
  type CandidateStatus,
  type PixelPolyline,
  type SourcePoint,
  pointToFinitePolylinesDistance,
  readCertifiedEmptyBackWallSeamCandidates,
  samplePolyline,
  toPixelPolyline,
} from "./empty-back-wall-seam-candidate";
import {
  EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
  type EmptyPhysicalBoundaryAnnotation,
  type EmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";

export const VISIBLE_FLOOR_WALL_SEAM_PROPOSAL_FAMILY =
  "p2-s1b-dual-orientation-companion" as const;
export const VISIBLE_FLOOR_WALL_SEAM_PROPOSAL_VERSION = "p2-s1c/v1" as const;
export const OUTSIDE_BACK_WALL_FAMILY_REASON =
  "angle_outside_back_wall_family" as const;

type SuccessfulBackWallRead = Extract<BackWallSeamReadResult, { ok: true }>;

export type VisibleFloorWallSeamFragment = Readonly<{
  id: string;
  roomId: string;
  emptyImageSha256: string;
  coordinateSpace: typeof EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE;
  proposalFamily: typeof VISIBLE_FLOOR_WALL_SEAM_PROPOSAL_FAMILY;
  proposalVersion: typeof VISIBLE_FLOOR_WALL_SEAM_PROPOSAL_VERSION;
  lineage: Readonly<{
    sourceProposalId: string;
    sourceProposalFamily: typeof BACK_WALL_SEAM_PROPOSAL_FAMILY;
    sourceProposalVersion: BackWallSeamProposal["proposalVersion"];
    sourceBackWallStatus: BackWallSeamProposal["status"];
    sourceBackWallRejectionReasons: readonly CandidateRejectionReason[];
  }>;
  status: CandidateStatus;
  rejectionReasons: readonly CandidateRejectionReason[];
  geometryKind: "ordered_finite_observed_support";
  pointsSourceNormalized: readonly SourcePoint[];
  sourcePixelMeasurements: Readonly<{
    polylineLengthPx: number;
    xSpanPx: number;
  }>;
  imageSpaceAngleDeg: number;
  evidence: BackWallSeamProposal["evidence"];
}>;

export type VisibleFloorWallSeamReadResult =
  | Readonly<{
      ok: true;
      observedIdentity: SuccessfulBackWallRead["observedIdentity"];
      certifiedBackWall: SuccessfulBackWallRead;
      proposals: readonly VisibleFloorWallSeamFragment[];
      accepted: readonly VisibleFloorWallSeamFragment[];
    }>
  | Readonly<{ ok: false; reason: "decode_failed" | "fixture_identity_mismatch" }>;

/**
 * Reconsiders only P2-S1B proposals that were rejected outside the certified
 * back-wall family. The family reason is removed, while every other P2-S1B
 * safety rejection remains in force. Geometry and appearance are copied
 * without interpolation, extrapolation, rescanning, or oracle input.
 */
export function classifyVisibleFloorWallSeamFragments(
  backWallProposals: readonly BackWallSeamProposal[]
): readonly VisibleFloorWallSeamFragment[] {
  return Object.freeze(backWallProposals
    .filter(proposal =>
      proposal.status === "rejected" &&
      proposal.rejectionReasons.includes(OUTSIDE_BACK_WALL_FAMILY_REASON)
    )
    .map((proposal, index) => {
      const rejectionReasons = proposal.rejectionReasons.filter(
        reason => reason !== OUTSIDE_BACK_WALL_FAMILY_REASON
      );
      return Object.freeze({
        id: `${VISIBLE_FLOOR_WALL_SEAM_PROPOSAL_VERSION}:${proposal.roomId}:${String(index).padStart(4, "0")}`,
        roomId: proposal.roomId,
        emptyImageSha256: proposal.emptyImageSha256,
        coordinateSpace: proposal.coordinateSpace,
        proposalFamily: VISIBLE_FLOOR_WALL_SEAM_PROPOSAL_FAMILY,
        proposalVersion: VISIBLE_FLOOR_WALL_SEAM_PROPOSAL_VERSION,
        lineage: Object.freeze({
          sourceProposalId: proposal.id,
          sourceProposalFamily: proposal.proposalFamily,
          sourceProposalVersion: proposal.proposalVersion,
          sourceBackWallStatus: proposal.status,
          sourceBackWallRejectionReasons: Object.freeze([...proposal.rejectionReasons]),
        }),
        status: rejectionReasons.length === 0 ? "accepted_research" as const : "rejected" as const,
        rejectionReasons: Object.freeze(rejectionReasons),
        geometryKind: "ordered_finite_observed_support" as const,
        pointsSourceNormalized: proposal.pointsSourceNormalized,
        sourcePixelMeasurements: Object.freeze({
          polylineLengthPx: proposal.sourcePixelLength,
          xSpanPx: proposal.evidence.xSpanPx,
        }),
        imageSpaceAngleDeg: proposal.imageSpaceAngleDeg,
        evidence: proposal.evidence,
      });
    }));
}

/**
 * Executes the certified P2-S1B reader once, preserves its complete result,
 * then classifies only its already-produced out-of-family fragments.
 */
export async function readCertifiedEmptyVisibleFloorWallSeamFragments(
  imageBytes: Uint8Array,
  fixture: EmptyPhysicalBoundaryFixture
): Promise<VisibleFloorWallSeamReadResult> {
  const certifiedBackWall = await readCertifiedEmptyBackWallSeamCandidates(imageBytes, fixture);
  if (!certifiedBackWall.ok) return certifiedBackWall;
  const proposals = classifyVisibleFloorWallSeamFragments(certifiedBackWall.proposals);
  return Object.freeze({
    ok: true,
    observedIdentity: certifiedBackWall.observedIdentity,
    certifiedBackWall,
    proposals,
    accepted: Object.freeze(proposals.filter(fragment => fragment.status === "accepted_research")),
  });
}

type TrustedOracle = Readonly<{
  annotation: EmptyPhysicalBoundaryAnnotation;
  polyline: PixelPolyline;
}>;

export type VisibleFloorWallFragmentOracleSupport = Readonly<{
  fragmentId: string;
  sourceProposalId: string;
  supportedAnnotationIds: readonly string[];
  supportedSideWallAnnotationIds: readonly string[];
  supportedRearWallAnnotationIds: readonly string[];
  sampleCount: number;
  supportedSampleCount: number;
  supportedSampleFraction: number;
  meanSupportedDistancePx: number | null;
  maxDistancePx: number | null;
  offOracle: boolean;
}>;

export type VisibleFloorWallSeamHardFailures = Readonly<{
  offOracleAcceptance: boolean;
  roomCIllegalBridge: boolean;
  roomCInGapFalseAcceptance: boolean;
  inFamilyCandidateAcceptance: boolean;
  roomEMixedLeftRearChord: boolean;
  roomEOffOracle0020ClassAcceptance: boolean;
  imageBorderAcceptance: boolean;
  hiddenContinuation: false;
  closure: false;
  cameraManufacturedPositive: false;
}>;

export type VisibleFloorWallSeamRoomEvaluation = Readonly<{
  roomId: string;
  experimentalProposalCount: number;
  experimentalRejectedCount: number;
  experimentalAcceptedCount: number;
  rejectionReasonCounts: Readonly<Partial<Record<CandidateRejectionReason, number>>>;
  acceptedOracleSupport: readonly VisibleFloorWallFragmentOracleSupport[];
  acceptedSupportedBySideWallCount: number;
  oracleCoverageFraction: number;
  hardFailures: VisibleFloorWallSeamHardFailures;
  hardFail: boolean;
}>;

const TRUSTED_INTERPRETATIONS = new Set([
  "rear_floor_wall_seam",
  "side_wall_floor_seam",
  "physical_floor_wall_seam",
]);

function trustedOracles(
  fixture: EmptyPhysicalBoundaryFixture
): readonly TrustedOracle[] {
  const { width, height } = fixture.emptyImage.dimensions;
  return fixture.annotations
    .filter(annotation =>
      annotation.evidenceKind === "direct_visible" &&
      TRUSTED_INTERPRETATIONS.has(annotation.interpretation)
    )
    .map(annotation => Object.freeze({
      annotation,
      polyline: toPixelPolyline(annotation.pointsSourceNormalized, width, height),
    }));
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function oracleSupportForFragment(
  fragment: VisibleFloorWallSeamFragment,
  fixture: EmptyPhysicalBoundaryFixture,
  oracles: readonly TrustedOracle[]
): VisibleFloorWallFragmentOracleSupport {
  const { width, height } = fixture.emptyImage.dimensions;
  const samples = samplePolyline(toPixelPolyline(
    fragment.pointsSourceNormalized,
    width,
    height
  ));
  const distances = samples.map(sample =>
    pointToFinitePolylinesDistance(sample, oracles.map(oracle => oracle.polyline))
  );
  const supportedDistances = distances.filter(
    distance => distance <= fixture.evaluationCorridorSourcePx
  );
  const supported = oracles.filter(oracle =>
    samples.some(sample =>
      pointToFinitePolylinesDistance(sample, [oracle.polyline]) <=
      fixture.evaluationCorridorSourcePx
    )
  );
  return Object.freeze({
    fragmentId: fragment.id,
    sourceProposalId: fragment.lineage.sourceProposalId,
    supportedAnnotationIds: Object.freeze(supported.map(oracle => oracle.annotation.id)),
    supportedSideWallAnnotationIds: Object.freeze(supported
      .filter(oracle => oracle.annotation.interpretation === "side_wall_floor_seam")
      .map(oracle => oracle.annotation.id)),
    supportedRearWallAnnotationIds: Object.freeze(supported
      .filter(oracle => oracle.annotation.interpretation === "rear_floor_wall_seam")
      .map(oracle => oracle.annotation.id)),
    sampleCount: samples.length,
    supportedSampleCount: supportedDistances.length,
    supportedSampleFraction: samples.length === 0 ? 0 : supportedDistances.length / samples.length,
    meanSupportedDistancePx: mean(supportedDistances),
    maxDistancePx: distances.length === 0 ? null : Math.max(...distances),
    offOracle: distances.some(distance => distance > fixture.evaluationCorridorSourcePx),
  });
}

function roomCGapBounds(oracles: readonly TrustedOracle[]): readonly (readonly [number, number])[] {
  const rear = oracles
    .filter(oracle => oracle.annotation.interpretation === "rear_floor_wall_seam")
    .map(oracle => ({
      minimumX: Math.min(...oracle.polyline.map(point => point.x)),
      maximumX: Math.max(...oracle.polyline.map(point => point.x)),
    }))
    .sort((left, right) => left.minimumX - right.minimumX);
  return Object.freeze(rear.slice(1).map((current, index) =>
    Object.freeze([rear[index].maximumX, current.minimumX] as const)
  ));
}

function candidateSamples(
  fragment: VisibleFloorWallSeamFragment,
  fixture: EmptyPhysicalBoundaryFixture
): readonly SourcePoint[] {
  return samplePolyline(toPixelPolyline(
    fragment.pointsSourceNormalized,
    fixture.emptyImage.dimensions.width,
    fixture.emptyImage.dimensions.height
  ));
}

/**
 * Post-hoc only: compares accepted experimental fragments with all trusted
 * direct-visible P2-S1A finite polylines using the fixture's source-pixel
 * corridor. Oracle coordinates never participate in classification.
 */
export function evaluateVisibleFloorWallSeamFragments(
  proposals: readonly VisibleFloorWallSeamFragment[],
  fixture: EmptyPhysicalBoundaryFixture
): VisibleFloorWallSeamRoomEvaluation {
  const oracles = trustedOracles(fixture);
  const accepted = proposals.filter(fragment => fragment.status === "accepted_research");
  const acceptedOracleSupport = accepted.map(fragment =>
    oracleSupportForFragment(fragment, fixture, oracles)
  );
  const acceptedSamples = accepted.map(fragment => candidateSamples(fragment, fixture));
  const gaps = fixture.roomId === "room-c" ? roomCGapBounds(oracles) : [];
  const rearOracles = oracles.filter(
    oracle => oracle.annotation.interpretation === "rear_floor_wall_seam"
  );

  const roomCIllegalBridge = fixture.roomId === "room-c" && acceptedSamples.some(samples => {
    const touchedRearCount = rearOracles.filter(oracle =>
      samples.some(sample =>
        pointToFinitePolylinesDistance(sample, [oracle.polyline]) <=
        fixture.evaluationCorridorSourcePx
      )
    ).length;
    return touchedRearCount > 1 || gaps.some(([gapStart, gapEnd]) =>
      samples.some(sample =>
        sample.x > gapStart &&
        sample.x < gapEnd &&
        pointToFinitePolylinesDistance(sample, rearOracles.map(oracle => oracle.polyline)) >
          fixture.evaluationCorridorSourcePx
      )
    );
  });
  const roomCInGapFalseAcceptance = fixture.roomId === "room-c" &&
    acceptedSamples.some(samples => gaps.some(([gapStart, gapEnd]) =>
      samples.some(sample =>
        sample.x > gapStart &&
        sample.x < gapEnd &&
        pointToFinitePolylinesDistance(sample, oracles.map(oracle => oracle.polyline)) >
          fixture.evaluationCorridorSourcePx
      )
    ));
  const roomEMixedLeftRearChord = fixture.roomId === "room-e" &&
    acceptedOracleSupport.some(support =>
      support.supportedSideWallAnnotationIds.length > 0 &&
      support.supportedRearWallAnnotationIds.length > 0
    );
  const offOracleAcceptance = acceptedOracleSupport.some(support => support.offOracle);
  const roomEOffOracle0020ClassAcceptance = fixture.roomId === "room-e" &&
    acceptedOracleSupport.some(support =>
      support.offOracle &&
      support.sourceProposalId === "p2-s1b/v1:room-e:0020"
    );
  const inFamilyCandidateAcceptance = accepted.some(fragment =>
    !fragment.lineage.sourceBackWallRejectionReasons.includes(OUTSIDE_BACK_WALL_FAMILY_REASON)
  );
  const imageBorderAcceptance = accepted.some(fragment =>
    fragment.lineage.sourceBackWallRejectionReasons.includes("touches_image_border_margin")
  );
  const hardFailures: VisibleFloorWallSeamHardFailures = Object.freeze({
    offOracleAcceptance,
    roomCIllegalBridge,
    roomCInGapFalseAcceptance,
    inFamilyCandidateAcceptance,
    roomEMixedLeftRearChord,
    roomEOffOracle0020ClassAcceptance,
    imageBorderAcceptance,
    hiddenContinuation: false,
    closure: false,
    cameraManufacturedPositive: false,
  });
  const rejectionReasonCounts: Partial<Record<CandidateRejectionReason, number>> = {};
  for (const proposal of proposals.filter(fragment => fragment.status === "rejected")) {
    for (const reason of proposal.rejectionReasons) {
      rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] ?? 0) + 1;
    }
  }
  const oracleSamples = oracles.flatMap(oracle => samplePolyline(oracle.polyline));
  const coveredOracleSamples = oracleSamples.filter(sample =>
    acceptedSamples.some(samples =>
      pointToFinitePolylinesDistance(sample, [samples]) <=
      fixture.evaluationCorridorSourcePx
    )
  );
  return Object.freeze({
    roomId: fixture.roomId,
    experimentalProposalCount: proposals.length,
    experimentalRejectedCount: proposals.filter(fragment => fragment.status === "rejected").length,
    experimentalAcceptedCount: accepted.length,
    rejectionReasonCounts: Object.freeze(rejectionReasonCounts),
    acceptedOracleSupport: Object.freeze(acceptedOracleSupport),
    acceptedSupportedBySideWallCount: acceptedOracleSupport.filter(
      support => support.supportedSideWallAnnotationIds.length > 0
    ).length,
    oracleCoverageFraction: oracleSamples.length === 0
      ? 0
      : coveredOracleSamples.length / oracleSamples.length,
    hardFailures,
    hardFail: Object.values(hardFailures).some(Boolean),
  });
}

export type P2S1CScientificInterpretation =
  | "P2-S1C DUAL-ORIENTATION VIABLE"
  | "P2-S1C FAILS — MULTI-RESPONSE/LOWER-CONTACT PRIMITIVE NEEDED"
  | "P2-S1C CONSERVATIVE SILENCE — MORE LOCAL EVIDENCE WORK NEEDED";

export function interpretP2S1CExperiment(
  evaluations: readonly VisibleFloorWallSeamRoomEvaluation[]
): P2S1CScientificInterpretation {
  if (evaluations.some(evaluation => evaluation.hardFail)) {
    return "P2-S1C FAILS — MULTI-RESPONSE/LOWER-CONTACT PRIMITIVE NEEDED";
  }
  if (evaluations.some(evaluation => evaluation.acceptedSupportedBySideWallCount > 0)) {
    return "P2-S1C DUAL-ORIENTATION VIABLE";
  }
  return "P2-S1C CONSERVATIVE SILENCE — MORE LOCAL EVIDENCE WORK NEEDED";
}
