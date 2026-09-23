import {
  validateFloorSourcePolygonExtent,
  type FloorSourcePoint,
} from "./floor-coordinate-extent";
import type {
  SupportReviewStatus,
  SupportSource,
} from "./support-model";
import { AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE } from "./research/afc-r3c-image-pair-compatibility";
import type { AfcProposalOverlayViewModel } from "./research/afc-proposal-overlay-view-model";

const AFC_FLOOR_SEMANTIC_ORDER = ["NL", "NR", "FR", "FL"] as const;

type AfcFloorSemanticCorner = (typeof AFC_FLOOR_SEMANTIC_ORDER)[number];
type AfcVerifiedImageRole = "original" | "empty";
type AfcVerifiedPairCompatibilityTier = "exact_grid_compatible" | "aspect_compatible_rescaled";
type AfcVerifiedFloorApplyTransferMode =
  | "exact_role_match"
  | "paired_cross_role_exact_grid"
  | "paired_cross_role_aspect_rescaled";

/**
 * An already-qualified live room-image identity. Qualification ownership stays
 * with the caller; this seam only compares the resulting receipt fields.
 */
export type AfcQualifiedLiveImageBasis = Readonly<{
  basisFingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
}>;

export type VerifiedAfcFloorApplyQualificationInput = Readonly<{
  viewModel: AfcProposalOverlayViewModel | null;
  liveBasis: AfcQualifiedLiveImageBasis | null;
}>;

export type VerifiedAfcFloorApplyRejectionCode =
  | "no_view_model"
  | "missing_candidate"
  | "missing_candidate_identity"
  | "incomplete_corners"
  | "non_finite_coordinates"
  | "semantic_order_mismatch"
  | "coordinate_space_mismatch"
  | "no_qualified_basis"
  | "unsupported_image_role"
  | "missing_role_image_identity"
  | "pair_identity_mismatch"
  | "missing_pair_compatibility"
  | "pair_compatibility_rejected"
  | "fingerprint_mismatch"
  | "dimension_mismatch"
  | "source_extent_rejected";

export type VerifiedAfcFloorCandidate = Readonly<{
  sourcePolygon: readonly [
    FloorSourcePoint,
    FloorSourcePoint,
    FloorSourcePoint,
    FloorSourcePoint,
  ];
  semanticOrder: readonly ["NL", "NR", "FR", "FL"];
  coordinateSpace: "source-normalized/v1";
  receiptFileName: string;
  receiptSha256: string;
  requestId: string;
  r3bCandidateId: string;
  r3cCandidateId: string;
  imageRole: "empty_room_boundary_specialist" | "original_contextual";
  proposalImageMember: AfcVerifiedImageRole;
  matchedImageRole: AfcVerifiedImageRole;
  transferMode: AfcVerifiedFloorApplyTransferMode;
  pairCompatibilityTier: AfcVerifiedPairCompatibilityTier | null;
  basisFingerprint: string;
  width: number;
  height: number;
  source: Extract<SupportSource, "model_suggested">;
  reviewStatus: Extract<SupportReviewStatus, "needs_review">;
}>;

export type VerifiedAfcFloorApplyQualification =
  | Readonly<{ ok: true; candidate: VerifiedAfcFloorCandidate }>
  | Readonly<{ ok: false; reason: VerifiedAfcFloorApplyRejectionCode }>;

type UnknownRecord = Record<string, unknown>;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(value as UnknownRecord)) deepFreeze(child, seen);
    Object.freeze(object);
  }
  return value;
}

function rejected(reason: VerifiedAfcFloorApplyRejectionCode): VerifiedAfcFloorApplyQualification {
  return Object.freeze({ ok: false as const, reason });
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasQualifiedLiveBasis(
  value: AfcQualifiedLiveImageBasis | null
): value is AfcQualifiedLiveImageBasis {
  return !!value &&
    hasNonEmptyText(value.basisFingerprint) &&
    Number.isFinite(value.decodedWidth) &&
    value.decodedWidth > 0 &&
    Number.isFinite(value.decodedHeight) &&
    value.decodedHeight > 0;
}

function hasExactSemanticOrder(value: unknown): value is readonly [
  AfcFloorSemanticCorner,
  AfcFloorSemanticCorner,
  AfcFloorSemanticCorner,
  AfcFloorSemanticCorner,
] {
  return Array.isArray(value) &&
    value.length === AFC_FLOOR_SEMANTIC_ORDER.length &&
    value.every((corner, index) => corner === AFC_FLOOR_SEMANTIC_ORDER[index]);
}

function roleImage(
  viewModel: AfcProposalOverlayViewModel,
  role: AfcVerifiedImageRole
): Readonly<{ sha256: string; width: number; height: number }> | null {
  const image = role === "original"
    ? viewModel.imageBasis?.original
    : viewModel.imageBasis?.emptyRoom;
  if (
    !image ||
    !hasNonEmptyText(image.sha256) ||
    !Number.isFinite(image.width) ||
    image.width <= 0 ||
    !Number.isFinite(image.height) ||
    image.height <= 0
  ) {
    return null;
  }
  return image;
}

function imageExactlyMatchesLiveBasis(
  image: Readonly<{ sha256: string; width: number; height: number }>,
  liveBasis: AfcQualifiedLiveImageBasis
): boolean {
  return (
    liveBasis.basisFingerprint === image.sha256 &&
    liveBasis.decodedWidth === image.width &&
    liveBasis.decodedHeight === image.height
  );
}

function liveFingerprintMatchesImage(
  image: Readonly<{ sha256: string; width: number; height: number }>,
  liveBasis: AfcQualifiedLiveImageBasis
): boolean {
  return liveBasis.basisFingerprint === image.sha256;
}

function acceptedPairCompatibility(
  viewModel: AfcProposalOverlayViewModel
): AfcVerifiedPairCompatibilityTier | null {
  const compatibility = viewModel.pairCompatibility;
  if (
    !compatibility ||
    !Number.isFinite(compatibility.relativeAspectErrorRaw) ||
    compatibility.relativeAspectErrorRaw < 0 ||
    !Number.isFinite(compatibility.relativeAspectError) ||
    !["exact_grid_compatible", "aspect_compatible_rescaled"].includes(compatibility.tier)
  ) {
    return null;
  }
  if (
    compatibility.tier === "aspect_compatible_rescaled" &&
    compatibility.relativeAspectErrorRaw > AFC_R3C_ASPECT_RELATIVE_ERROR_TOLERANCE
  ) {
    return null;
  }
  return compatibility.tier;
}

function extractSourcePolygon(
  viewModel: AfcProposalOverlayViewModel
):
  | Readonly<{ ok: true; sourcePolygon: readonly [FloorSourcePoint, FloorSourcePoint, FloorSourcePoint, FloorSourcePoint] }>
  | Readonly<{ ok: false; reason: "incomplete_corners" | "non_finite_coordinates" | "source_extent_rejected" }> {
  const corners = viewModel.corners;
  if (!isRecord(corners) || Object.keys(corners).length !== AFC_FLOOR_SEMANTIC_ORDER.length) {
    return { ok: false, reason: "incomplete_corners" };
  }

  const points: FloorSourcePoint[] = [];
  for (const name of AFC_FLOOR_SEMANTIC_ORDER) {
    const corner = corners[name];
    if (!isRecord(corner)) return { ok: false, reason: "incomplete_corners" };
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) {
      return { ok: false, reason: "non_finite_coordinates" };
    }
    points.push({ x: corner.x as number, y: corner.y as number });
  }

  const extent = validateFloorSourcePolygonExtent(points);
  if (!extent.ok) {
    return {
      ok: false,
      reason: extent.reason === "source_x_not_finite" || extent.reason === "source_y_not_finite"
        ? "non_finite_coordinates"
        : "source_extent_rejected",
    };
  }

  return {
    ok: true,
    sourcePolygon: points as [
      FloorSourcePoint,
      FloorSourcePoint,
      FloorSourcePoint,
      FloorSourcePoint,
    ],
  };
}

/**
 * Purely qualifies a replay-verified AFC proposal for a later explicit Floor
 * Apply. It never projects, plans, commits, persists, or mutates Floor state.
 */
export function qualifyVerifiedAfcFloorApply(
  input: VerifiedAfcFloorApplyQualificationInput
): VerifiedAfcFloorApplyQualification {
  const viewModel = input.viewModel;
  if (!viewModel) return rejected("no_view_model");
  if (!hasQualifiedLiveBasis(input.liveBasis)) return rejected("no_qualified_basis");

  const candidate = viewModel.candidate;
  if (!candidate || !isRecord(candidate)) return rejected("missing_candidate");
  if (
    !hasNonEmptyText(candidate.r3bCandidateId) ||
    !hasNonEmptyText(candidate.r3cCandidateId) ||
    !hasNonEmptyText(viewModel.artifactIdentity?.receiptFileName) ||
    !hasNonEmptyText(viewModel.artifactIdentity?.receiptSha256) ||
    !hasNonEmptyText(viewModel.artifactIdentity?.requestId)
  ) {
    return rejected("missing_candidate_identity");
  }
  if (!hasExactSemanticOrder(candidate.semanticOrder)) return rejected("semantic_order_mismatch");
  if (candidate.coordinateSpace !== "source-normalized/v1") return rejected("coordinate_space_mismatch");

  const imageRole = viewModel.artifactIdentity?.imageRole;
  const proposalImageMember = imageRole === "original_contextual"
    ? "original"
    : imageRole === "empty_room_boundary_specialist"
      ? "empty"
      : null;
  if (!proposalImageMember) return rejected("unsupported_image_role");

  const proposalImage = roleImage(viewModel, proposalImageMember);
  const pairedRole = proposalImageMember === "original" ? "empty" : "original";
  const pairedImage = roleImage(viewModel, pairedRole);
  if (!proposalImage || !pairedImage) return rejected("missing_role_image_identity");

  let matchedImageRole: AfcVerifiedImageRole;
  let transferMode: AfcVerifiedFloorApplyTransferMode;
  let pairCompatibilityTier: AfcVerifiedPairCompatibilityTier | null;
  if (imageExactlyMatchesLiveBasis(proposalImage, input.liveBasis)) {
    matchedImageRole = proposalImageMember;
    transferMode = "exact_role_match";
    pairCompatibilityTier = acceptedPairCompatibility(viewModel);
  } else if (imageExactlyMatchesLiveBasis(pairedImage, input.liveBasis)) {
    if (viewModel.imageBasis.emptyRoom.generatedFromOriginalSha256 !== viewModel.imageBasis.original.sha256) {
      return rejected("pair_identity_mismatch");
    }
    const compatibility = acceptedPairCompatibility(viewModel);
    if (!compatibility) {
      return viewModel.pairCompatibility ? rejected("pair_compatibility_rejected") : rejected("missing_pair_compatibility");
    }
    matchedImageRole = pairedRole;
    pairCompatibilityTier = compatibility;
    transferMode = compatibility === "exact_grid_compatible"
      ? "paired_cross_role_exact_grid"
      : "paired_cross_role_aspect_rescaled";
  } else if (
    liveFingerprintMatchesImage(proposalImage, input.liveBasis) ||
    liveFingerprintMatchesImage(pairedImage, input.liveBasis)
  ) {
    return rejected("dimension_mismatch");
  } else {
    return rejected("fingerprint_mismatch");
  }

  const sourcePolygon = extractSourcePolygon(viewModel);
  if (!sourcePolygon.ok) return rejected(sourcePolygon.reason);

  return deepFreeze({
    ok: true as const,
    candidate: {
      sourcePolygon: sourcePolygon.sourcePolygon,
      semanticOrder: [...AFC_FLOOR_SEMANTIC_ORDER] as ["NL", "NR", "FR", "FL"],
      coordinateSpace: "source-normalized/v1" as const,
      receiptFileName: viewModel.artifactIdentity.receiptFileName,
      receiptSha256: viewModel.artifactIdentity.receiptSha256,
      requestId: viewModel.artifactIdentity.requestId,
      r3bCandidateId: candidate.r3bCandidateId,
      r3cCandidateId: candidate.r3cCandidateId,
      imageRole,
      proposalImageMember,
      matchedImageRole,
      transferMode,
      pairCompatibilityTier,
      basisFingerprint: input.liveBasis.basisFingerprint,
      width: input.liveBasis.decodedWidth,
      height: input.liveBasis.decodedHeight,
      source: "model_suggested" as const,
      reviewStatus: "needs_review" as const,
    },
  });
}
