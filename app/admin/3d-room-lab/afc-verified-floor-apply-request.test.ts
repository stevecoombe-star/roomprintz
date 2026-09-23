import assert from "node:assert/strict";
import test from "node:test";

import { qualifyVerifiedAfcFloorApply } from "./afc-verified-floor-apply";
import {
  revalidateVerifiedAfcFloorApplyRequest,
  verifiedAfcFloorCandidatesMatch,
} from "./afc-verified-floor-apply-request";
import type { AfcProposalOverlayViewModel } from "./research/afc-proposal-overlay-view-model";

const SHA = "a".repeat(64);
const ORIGINAL_BASIS = { basisFingerprint: SHA, decodedWidth: 1264, decodedHeight: 848 };
const EMPTY_BASIS = { basisFingerprint: "c".repeat(64), decodedWidth: 960, decodedHeight: 640 };

function viewModel(
  imageRole: "empty_room_boundary_specialist" | "original_contextual" = "original_contextual"
): AfcProposalOverlayViewModel {
  return {
    artifactIdentity: {
      receiptFileName: "receipt.json",
      receiptSha256: "b".repeat(64),
      requestId: "request",
      createdAt: "2026-08-02T00:00:00.000Z",
      roomId: "room",
      studyMode: "parallel_union",
      imageRole,
    },
    imageBasis: {
      basisBinding: "verified-basis",
      manifestVersion: "afc-r3c-image-manifest/v1",
      original: { sha256: SHA, width: 1264, height: 848, mimeType: "image/jpeg" },
      emptyRoom: { sha256: EMPTY_BASIS.basisFingerprint, width: 960, height: 640, mimeType: "image/jpeg", generatedFromOriginalSha256: SHA },
    },
    pairCompatibility: { tier: "aspect_compatible_rescaled", relativeAspectErrorRaw: 0.0063, relativeAspectError: 0.0063 },
    candidate: {
      r3bCandidateId: "r3b",
      r3cCandidateId: "r3c",
      coordinateSpace: "source-normalized/v1",
      semanticOrder: ["NL", "NR", "FR", "FL"],
    },
    corners: {
      NL: { x: -0.1, y: 1.1, support: "direct_visible" },
      NR: { x: 0.7, y: 1.1, support: "direct_visible" },
      FR: { x: 0.8, y: 0.7, support: "direct_visible" },
      FL: { x: 0.2, y: 0.7, support: "direct_visible" },
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
      provider: { providerId: "test", modelId: "test", modelVersion: "test", finishReason: "STOP", extractionPolicyVersion: "test/v1", usageMetadata: null },
      afcR3b: { status: "proposals", candidateIds: ["r3b"] },
      afcR3c: { status: "proposals", candidateIds: ["r3c"] },
      afcR2: { selectionState: "not_run", comparisonFingerprint: null },
      artifactHashes: { providerEnvelopeSha256: "e".repeat(64), modelOutputSha256: "f".repeat(64), receiptSha256: "b".repeat(64) },
    },
    safety: { researchOnly: true, applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true },
    raw: { receipt: null, modelOutput: null },
  };
}

function request(
  imageRole: "empty_room_boundary_specialist" | "original_contextual" = "original_contextual",
  liveBasis = ORIGINAL_BASIS
) {
  const qualified = qualifyVerifiedAfcFloorApply({ viewModel: viewModel(imageRole), liveBasis });
  assert.equal(qualified.ok, true);
  if (!qualified.ok) throw new Error("fixture must qualify");
  return { candidate: qualified.candidate };
}

test("click-time revalidation accepts only the identical current candidate and exact source polygon", () => {
  const result = revalidateVerifiedAfcFloorApplyRequest({
    request: request(),
    viewModel: viewModel(),
    liveBasis: ORIGINAL_BASIS,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.candidate.sourcePolygon, [
    { x: -0.1, y: 1.1 },
    { x: 0.7, y: 1.1 },
    { x: 0.8, y: 0.7 },
    { x: 0.2, y: 0.7 },
  ]);
});

test("click-time revalidation fails closed after evidence clear, basis change, or candidate replacement", () => {
  const currentRequest = request();
  assert.deepEqual(
    revalidateVerifiedAfcFloorApplyRequest({ request: currentRequest, viewModel: null, liveBasis: ORIGINAL_BASIS }),
    { ok: false, reason: "invalidated_before_apply" }
  );
  assert.deepEqual(
    revalidateVerifiedAfcFloorApplyRequest({
      request: currentRequest,
      viewModel: viewModel(),
      liveBasis: { ...ORIGINAL_BASIS, decodedHeight: 849 },
    }),
    { ok: false, reason: "invalidated_before_apply" }
  );
  const changed = viewModel() as unknown as { candidate: { r3cCandidateId: string } };
  changed.candidate.r3cCandidateId = "replacement";
  assert.deepEqual(
    revalidateVerifiedAfcFloorApplyRequest({
      request: currentRequest,
      viewModel: changed as unknown as AfcProposalOverlayViewModel,
      liveBasis: ORIGINAL_BASIS,
    }),
    { ok: false, reason: "invalidated_before_apply" }
  );
});

test("cross-role request revalidation retains verified pair transfer identity", () => {
  const currentRequest = request("empty_room_boundary_specialist", ORIGINAL_BASIS);
  const accepted = revalidateVerifiedAfcFloorApplyRequest({
    request: currentRequest,
    viewModel: viewModel("empty_room_boundary_specialist"),
    liveBasis: ORIGINAL_BASIS,
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.candidate.matchedImageRole, "original");
  assert.equal(accepted.candidate.transferMode, "paired_cross_role_aspect_rescaled");

  assert.deepEqual(
    revalidateVerifiedAfcFloorApplyRequest({
      request: currentRequest,
      viewModel: viewModel("empty_room_boundary_specialist"),
      liveBasis: EMPTY_BASIS,
    }),
    { ok: false, reason: "invalidated_before_apply" }
  );

  const changedCompatibility = viewModel("empty_room_boundary_specialist") as unknown as {
    pairCompatibility: { tier: "exact_grid_compatible"; relativeAspectErrorRaw: number; relativeAspectError: number };
  };
  changedCompatibility.pairCompatibility = {
    tier: "exact_grid_compatible",
    relativeAspectErrorRaw: 0,
    relativeAspectError: 0,
  };
  assert.deepEqual(
    revalidateVerifiedAfcFloorApplyRequest({
      request: currentRequest,
      viewModel: changedCompatibility as unknown as AfcProposalOverlayViewModel,
      liveBasis: ORIGINAL_BASIS,
    }),
    { ok: false, reason: "invalidated_before_apply" }
  );
});

test("identity comparison includes source order and coordinates", () => {
  const original = request().candidate;
  const reordered = {
    ...original,
    sourcePolygon: [original.sourcePolygon[1], original.sourcePolygon[0], original.sourcePolygon[2], original.sourcePolygon[3]],
  } as typeof original;
  assert.equal(verifiedAfcFloorCandidatesMatch(original, reordered), false);
  assert.equal(
    verifiedAfcFloorCandidatesMatch(
      original,
      { ...original, transferMode: "paired_cross_role_exact_grid" }
    ),
    false
  );
  assert.equal(
    verifiedAfcFloorCandidatesMatch(
      original,
      { ...original, pairCompatibilityTier: "exact_grid_compatible" }
    ),
    false
  );
});
