import {
  qualifyVerifiedAfcFloorApply,
  type AfcQualifiedLiveImageBasis,
  type VerifiedAfcFloorCandidate,
} from "./afc-verified-floor-apply";
import type { AfcProposalOverlayViewModel } from "./research/afc-proposal-overlay-view-model";

export type VerifiedAfcFloorApplyRequest = Readonly<{
  candidate: VerifiedAfcFloorCandidate;
}>;

export type VerifiedAfcFloorApplyActionStatus =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "applied" }>
  | Readonly<{ kind: "no_change" }>
  | Readonly<{ kind: "rejected" }>
  | Readonly<{ kind: "invalidated_before_apply" }>;

export type VerifiedAfcFloorApplyRequestRevalidation =
  | Readonly<{ ok: true; candidate: VerifiedAfcFloorCandidate }>
  | Readonly<{ ok: false; reason: "invalidated_before_apply" }>;

/**
 * Host-only click-time revalidation. The rendered candidate is an identity
 * claim, never authority: current replay evidence and current live basis must
 * independently qualify and match it exactly.
 */
export function revalidateVerifiedAfcFloorApplyRequest(input: Readonly<{
  request: VerifiedAfcFloorApplyRequest;
  viewModel: AfcProposalOverlayViewModel | null;
  liveBasis: AfcQualifiedLiveImageBasis | null;
}>): VerifiedAfcFloorApplyRequestRevalidation {
  const current = qualifyVerifiedAfcFloorApply({
    viewModel: input.viewModel,
    liveBasis: input.liveBasis,
  });
  if (!current.ok || !verifiedAfcFloorCandidatesMatch(input.request.candidate, current.candidate)) {
    return Object.freeze({ ok: false as const, reason: "invalidated_before_apply" as const });
  }
  return Object.freeze({ ok: true as const, candidate: current.candidate });
}

export function verifiedAfcFloorCandidatesMatch(
  left: VerifiedAfcFloorCandidate,
  right: VerifiedAfcFloorCandidate
): boolean {
  return (
    left.receiptFileName === right.receiptFileName &&
    left.receiptSha256 === right.receiptSha256 &&
    left.requestId === right.requestId &&
    left.r3bCandidateId === right.r3bCandidateId &&
    left.r3cCandidateId === right.r3cCandidateId &&
    left.imageRole === right.imageRole &&
    left.proposalImageMember === right.proposalImageMember &&
    left.matchedImageRole === right.matchedImageRole &&
    left.transferMode === right.transferMode &&
    left.pairCompatibilityTier === right.pairCompatibilityTier &&
    left.basisFingerprint === right.basisFingerprint &&
    left.width === right.width &&
    left.height === right.height &&
    left.coordinateSpace === right.coordinateSpace &&
    left.semanticOrder.every((corner, index) => corner === right.semanticOrder[index]) &&
    left.sourcePolygon.every((point, index) =>
      point.x === right.sourcePolygon[index]?.x && point.y === right.sourcePolygon[index]?.y
    )
  );
}
