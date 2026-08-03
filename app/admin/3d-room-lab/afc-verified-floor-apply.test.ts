import assert from "node:assert/strict";
import test from "node:test";

import {
  qualifyVerifiedAfcFloorApply,
  type AfcQualifiedLiveImageBasis,
  type VerifiedAfcFloorApplyQualification,
} from "./afc-verified-floor-apply";
import type { AfcProposalOverlayViewModel } from "./research/afc-proposal-overlay-view-model";

const ORIGINAL_SHA = "a".repeat(64);
const EMPTY_SHA = "b".repeat(64);

const BASE_POLYGON = [
  { x: 0.38, y: 1.1, support: "direct_visible" },
  { x: 0.62, y: 1.1, support: "direct_visible" },
  { x: 0.82, y: 0.76, support: "direct_visible" },
  { x: 0.18, y: 0.76, support: "direct_visible" },
] as const;

function viewModel(
  imageRole: "empty_room_boundary_specialist" | "original_contextual" = "original_contextual"
): AfcProposalOverlayViewModel {
  return {
    artifactIdentity: {
      receiptFileName: "afc-r3c-run.room-a.receipt.json",
      receiptSha256: "c".repeat(64),
      requestId: "request-a",
      createdAt: "2026-08-02T00:00:00.000Z",
      roomId: "room-a",
      studyMode: "parallel_union",
      imageRole,
    },
    imageBasis: {
      basisBinding: "verified-basis",
      manifestVersion: "afc-r3c-image-manifest/v1",
      original: { sha256: ORIGINAL_SHA, width: 1264, height: 848, mimeType: "image/jpeg" },
      emptyRoom: {
        sha256: EMPTY_SHA,
        width: 960,
        height: 640,
        mimeType: "image/jpeg",
        generatedFromOriginalSha256: ORIGINAL_SHA,
      },
    },
    pairCompatibility: {
      tier: "aspect_compatible_rescaled",
      relativeAspectErrorRaw: 0.0063,
      relativeAspectError: 0.0063,
    },
    candidate: {
      r3bCandidateId: "afc-r3b:01",
      r3cCandidateId: "afc-r3c:original:afc-r3b:01",
      coordinateSpace: "source-normalized/v1",
      semanticOrder: ["NL", "NR", "FR", "FL"],
    },
    corners: {
      NL: { ...BASE_POLYGON[0] },
      NR: { ...BASE_POLYGON[1] },
      FR: { ...BASE_POLYGON[2] },
      FL: { ...BASE_POLYGON[3] },
    },
    edges: {
      near: { support: "direct_visible", note: "near" },
      right: { support: "direct_visible", note: "right" },
      far: { support: "direct_visible", note: "far" },
      left: { support: "direct_visible", note: "left" },
    },
    warnings: [],
    provenance: {
      prompt: { contractVersion: "test/v1", version: "test", sha256: "d".repeat(64) },
      provider: {
        providerId: "test",
        modelId: "test",
        modelVersion: "test",
        finishReason: "STOP",
        extractionPolicyVersion: "test/v1",
        usageMetadata: null,
      },
      afcR3b: { status: "proposals", candidateIds: ["afc-r3b:01"] },
      afcR3c: { status: "proposals", candidateIds: ["afc-r3c:original:afc-r3b:01"] },
      afcR2: { selectionState: "not_run", comparisonFingerprint: null },
      artifactHashes: {
        providerEnvelopeSha256: "e".repeat(64),
        modelOutputSha256: "f".repeat(64),
        receiptSha256: "c".repeat(64),
      },
    },
    safety: {
      researchOnly: true,
      applied: false,
      authoritative: false,
      persisted: false,
      activeCameraUnchanged: true,
    },
    raw: { receipt: null, modelOutput: null },
  };
}

function basis(role: "original" | "empty" = "original"): AfcQualifiedLiveImageBasis {
  const image = role === "original"
    ? { basisFingerprint: ORIGINAL_SHA, decodedWidth: 1264, decodedHeight: 848 }
    : { basisFingerprint: EMPTY_SHA, decodedWidth: 960, decodedHeight: 640 };
  return { ...image };
}

function qualify(
  viewModelInput: AfcProposalOverlayViewModel | null,
  liveBasis: AfcQualifiedLiveImageBasis | null
): VerifiedAfcFloorApplyQualification {
  return qualifyVerifiedAfcFloorApply({ viewModel: viewModelInput, liveBasis });
}

function assertEligible(
  result: VerifiedAfcFloorApplyQualification
): asserts result is Extract<VerifiedAfcFloorApplyQualification, { ok: true }> {
  assert.equal(result.ok, true);
}

test("qualifies Original-role AFC evidence with exact source corners and verified identity", () => {
  const result = qualify(viewModel("original_contextual"), basis("original"));
  assertEligible(result);

  assert.deepEqual(result.candidate.sourcePolygon, BASE_POLYGON.map(({ x, y }) => ({ x, y })));
  assert.deepEqual(result.candidate.semanticOrder, ["NL", "NR", "FR", "FL"]);
  assert.equal(result.candidate.coordinateSpace, "source-normalized/v1");
  assert.equal(result.candidate.matchedImageRole, "original");
  assert.equal(result.candidate.imageRole, "original_contextual");
  assert.equal(result.candidate.proposalImageMember, "original");
  assert.equal(result.candidate.transferMode, "exact_role_match");
  assert.equal(result.candidate.pairCompatibilityTier, "aspect_compatible_rescaled");
  assert.deepEqual(
    {
      receiptFileName: result.candidate.receiptFileName,
      receiptSha256: result.candidate.receiptSha256,
      requestId: result.candidate.requestId,
      r3bCandidateId: result.candidate.r3bCandidateId,
      r3cCandidateId: result.candidate.r3cCandidateId,
      basisFingerprint: result.candidate.basisFingerprint,
      width: result.candidate.width,
      height: result.candidate.height,
      source: result.candidate.source,
      reviewStatus: result.candidate.reviewStatus,
    },
    {
      receiptFileName: "afc-r3c-run.room-a.receipt.json",
      receiptSha256: "c".repeat(64),
      requestId: "request-a",
      r3bCandidateId: "afc-r3b:01",
      r3cCandidateId: "afc-r3c:original:afc-r3b:01",
      basisFingerprint: ORIGINAL_SHA,
      width: 1264,
      height: 848,
      source: "model_suggested",
      reviewStatus: "needs_review",
    }
  );
});

test("qualifies Empty-role AFC evidence only against the verified Empty basis", () => {
  const result = qualify(viewModel("empty_room_boundary_specialist"), basis("empty"));
  assertEligible(result);
  assert.equal(result.candidate.matchedImageRole, "empty");
  assert.equal(result.candidate.imageRole, "empty_room_boundary_specialist");
  assert.deepEqual(result.candidate.sourcePolygon, BASE_POLYGON.map(({ x, y }) => ({ x, y })));
});

test("qualifies paired cross-role evidence through replay-verified aspect compatibility", () => {
  const emptyProposal = qualify(viewModel("empty_room_boundary_specialist"), basis("original"));
  assertEligible(emptyProposal);
  assert.equal(emptyProposal.candidate.proposalImageMember, "empty");
  assert.equal(emptyProposal.candidate.matchedImageRole, "original");
  assert.equal(emptyProposal.candidate.transferMode, "paired_cross_role_aspect_rescaled");
  assert.equal(emptyProposal.candidate.pairCompatibilityTier, "aspect_compatible_rescaled");

  const originalProposal = qualify(viewModel("original_contextual"), basis("empty"));
  assertEligible(originalProposal);
  assert.equal(originalProposal.candidate.proposalImageMember, "original");
  assert.equal(originalProposal.candidate.matchedImageRole, "empty");
  assert.equal(originalProposal.candidate.transferMode, "paired_cross_role_aspect_rescaled");
  assert.deepEqual(originalProposal.candidate.sourcePolygon, BASE_POLYGON.map(({ x, y }) => ({ x, y })));
});

test("qualifies paired cross-role evidence through replay-verified exact-grid compatibility", () => {
  const exactGrid = viewModel("empty_room_boundary_specialist") as unknown as {
    imageBasis: { emptyRoom: { width: number; height: number } };
    pairCompatibility: { tier: string; relativeAspectErrorRaw: number; relativeAspectError: number };
  };
  exactGrid.imageBasis.emptyRoom.width = 1264;
  exactGrid.imageBasis.emptyRoom.height = 848;
  exactGrid.pairCompatibility = {
    tier: "exact_grid_compatible",
    relativeAspectErrorRaw: 0,
    relativeAspectError: 0,
  };
  const result = qualify(exactGrid as unknown as AfcProposalOverlayViewModel, basis("original"));
  assertEligible(result);
  assert.equal(result.candidate.transferMode, "paired_cross_role_exact_grid");
  assert.equal(result.candidate.pairCompatibilityTier, "exact_grid_compatible");
});

test("cross-role transfer rejects unverified pair compatibility without relaxing live member identity", () => {
  const rejectedCompatibility = viewModel("empty_room_boundary_specialist") as unknown as {
    pairCompatibility: { tier: string; relativeAspectErrorRaw: number; relativeAspectError: number };
  };
  rejectedCompatibility.pairCompatibility.tier = "incompatible";
  assert.deepEqual(
    qualify(rejectedCompatibility as unknown as AfcProposalOverlayViewModel, basis("original")),
    { ok: false, reason: "pair_compatibility_rejected" }
  );

  const outsideTolerance = viewModel("empty_room_boundary_specialist") as unknown as {
    pairCompatibility: { tier: string; relativeAspectErrorRaw: number; relativeAspectError: number };
  };
  outsideTolerance.pairCompatibility.relativeAspectErrorRaw = 0.01500001;
  assert.deepEqual(
    qualify(outsideTolerance as unknown as AfcProposalOverlayViewModel, basis("original")),
    { ok: false, reason: "pair_compatibility_rejected" }
  );
});

test("cross-role transfer accepts the inclusive replay-verified aspect boundary", () => {
  const boundary = viewModel("empty_room_boundary_specialist") as unknown as {
    pairCompatibility: { tier: string; relativeAspectErrorRaw: number; relativeAspectError: number };
  };
  boundary.pairCompatibility.relativeAspectErrorRaw = 0.015;
  boundary.pairCompatibility.relativeAspectError = 0.015;
  const result = qualify(boundary as unknown as AfcProposalOverlayViewModel, basis("original"));
  assertEligible(result);
  assert.equal(result.candidate.transferMode, "paired_cross_role_aspect_rescaled");
});

test("rejects fingerprint and independent width or height mismatches", () => {
  assert.deepEqual(
    qualify(viewModel(), { ...basis(), basisFingerprint: "z".repeat(64) }),
    { ok: false, reason: "fingerprint_mismatch" }
  );
  assert.deepEqual(
    qualify(viewModel(), { ...basis(), decodedWidth: 1265 }),
    { ok: false, reason: "dimension_mismatch" }
  );
  assert.deepEqual(
    qualify(viewModel(), { ...basis(), decodedHeight: 849 }),
    { ok: false, reason: "dimension_mismatch" }
  );
});

test("rejects absent or malformed qualified live basis", () => {
  assert.deepEqual(qualify(viewModel(), null), { ok: false, reason: "no_qualified_basis" });
  assert.deepEqual(
    qualify(viewModel(), { basisFingerprint: "", decodedWidth: 1264, decodedHeight: 848 }),
    { ok: false, reason: "no_qualified_basis" }
  );
});

test("rejects an absent candidate and incomplete corner sets", () => {
  const withoutCandidate = viewModel() as unknown as { candidate?: unknown };
  delete withoutCandidate.candidate;
  assert.deepEqual(
    qualify(withoutCandidate as AfcProposalOverlayViewModel, basis()),
    { ok: false, reason: "missing_candidate" }
  );

  const missingCorner = viewModel() as unknown as { corners: Record<string, unknown> };
  delete missingCorner.corners.FL;
  assert.deepEqual(
    qualify(missingCorner as AfcProposalOverlayViewModel, basis()),
    { ok: false, reason: "incomplete_corners" }
  );

  const extraCorner = viewModel() as unknown as { corners: Record<string, unknown> };
  extraCorner.corners.EXTRA = { x: 0.5, y: 0.5 };
  assert.deepEqual(
    qualify(extraCorner as AfcProposalOverlayViewModel, basis()),
    { ok: false, reason: "incomplete_corners" }
  );
});

test("rejects every non-finite coordinate", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const malformed = viewModel() as unknown as { corners: { NL: { x: number; y: number } } };
    malformed.corners.NL.x = value;
    assert.deepEqual(
      qualify(malformed as AfcProposalOverlayViewModel, basis()),
      { ok: false, reason: "non_finite_coordinates" }
    );
  }
});

test("rejects semantic-order and coordinate-space changes", () => {
  for (const semanticOrder of [
    ["NL", "NR", "FL", "FR"],
    ["NR", "NL", "FR", "FL"],
  ]) {
    const malformed = viewModel() as unknown as { candidate: { semanticOrder: string[] } };
    malformed.candidate.semanticOrder = semanticOrder;
    assert.deepEqual(
      qualify(malformed as unknown as AfcProposalOverlayViewModel, basis()),
      { ok: false, reason: "semantic_order_mismatch" }
    );
  }

  const wrongSpace = viewModel() as unknown as { candidate: { coordinateSpace: string } };
  wrongSpace.candidate.coordinateSpace = "container-normalized/v0";
  assert.deepEqual(
    qualify(wrongSpace as AfcProposalOverlayViewModel, basis()),
    { ok: false, reason: "coordinate_space_mismatch" }
  );
});

test("preserves truthful positive and negative off-frame source coordinates", () => {
  const positive = qualify(viewModel(), basis());
  assertEligible(positive);
  assert.equal(positive.candidate.sourcePolygon[0].y, 1.1);
  assert.equal(positive.candidate.sourcePolygon[1].y, 1.1);
  assert.deepEqual(positive.candidate.sourcePolygon.map((point) => point.x), [0.38, 0.62, 0.82, 0.18]);

  const negativeModel = viewModel();
  const mutableCorners = negativeModel.corners as unknown as {
    NL: { x: number; y: number };
    NR: { x: number; y: number };
  };
  mutableCorners.NL.x = -0.25;
  mutableCorners.NR.y = -0.2;
  const negative = qualify(negativeModel, basis());
  assertEligible(negative);
  assert.equal(negative.candidate.sourcePolygon[0].x, -0.25);
  assert.equal(negative.candidate.sourcePolygon[1].y, -0.2);
});

test("rejects source points outside the committed Floor source extent", () => {
  const tooFar = viewModel();
  const mutableCorners = tooFar.corners as unknown as { NL: { x: number; y: number } };
  mutableCorners.NL.x = 1.250001;
  assert.deepEqual(qualify(tooFar, basis()), { ok: false, reason: "source_extent_rejected" });
});

test("copies and freezes source geometry without projection values or retained references", () => {
  const source = viewModel();
  const result = qualify(source, basis());
  assertEligible(result);

  const sourceCorners = source.corners as unknown as { NL: { x: number; y: number } };
  sourceCorners.NL.x = 0.99;
  assert.equal(result.candidate.sourcePolygon[0].x, 0.38);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.candidate), true);
  assert.equal(Object.isFrozen(result.candidate.sourcePolygon), true);
  assert.equal(Object.isFrozen(result.candidate.sourcePolygon[0]), true);
  assert.throws(() => Object.assign(result.candidate.sourcePolygon[0], { x: 0 }), TypeError);
  assert.deepEqual(Object.keys(result.candidate).sort(), [
    "basisFingerprint",
    "coordinateSpace",
    "height",
    "imageRole",
    "matchedImageRole",
    "pairCompatibilityTier",
    "proposalImageMember",
    "r3bCandidateId",
    "r3cCandidateId",
    "receiptFileName",
    "receiptSha256",
    "requestId",
    "reviewStatus",
    "semanticOrder",
    "source",
    "sourcePolygon",
    "transferMode",
    "width",
  ]);
});

test("is deterministic and rejects absent view models, missing identity, unsupported roles, or missing role image evidence", () => {
  assert.deepEqual(qualify(viewModel(), basis()), qualify(viewModel(), basis()));
  assert.deepEqual(qualify(null, basis()), { ok: false, reason: "no_view_model" });

  const missingIdentity = viewModel() as unknown as {
    artifactIdentity: { receiptSha256: string };
  };
  missingIdentity.artifactIdentity.receiptSha256 = "";
  assert.deepEqual(
    qualify(missingIdentity as AfcProposalOverlayViewModel, basis()),
    { ok: false, reason: "missing_candidate_identity" }
  );

  const unsupportedRole = viewModel() as unknown as {
    artifactIdentity: { imageRole: string };
  };
  unsupportedRole.artifactIdentity.imageRole = "display_original";
  assert.deepEqual(
    qualify(unsupportedRole as AfcProposalOverlayViewModel, basis()),
    { ok: false, reason: "unsupported_image_role" }
  );

  const missingRoleImage = viewModel("empty_room_boundary_specialist") as unknown as {
    imageBasis: { emptyRoom?: unknown };
  };
  delete missingRoleImage.imageBasis.emptyRoom;
  assert.deepEqual(
    qualify(missingRoleImage as AfcProposalOverlayViewModel, basis("empty")),
    { ok: false, reason: "missing_role_image_identity" }
  );
});
