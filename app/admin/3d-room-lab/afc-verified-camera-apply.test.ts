import assert from "node:assert/strict";
import test from "node:test";

import {
  qualifyVerifiedAfcCameraApply,
  type VerifiedAfcCameraApplyQualificationInput,
  type VerifiedAfcFloorCameraBinding,
} from "./afc-verified-camera-apply";
import type { CalibratedCameraApplyEvaluation } from "./calibrated-camera-apply";

const FLOOR_KEY = "0.2,0.8|0.8,0.8|0.9,0.4|0.1,0.4";
const FINGERPRINT = "a".repeat(64);

const AVAILABLE_EVALUATION: CalibratedCameraApplyEvaluation = {
  available: true,
  reason: "available",
  firstFailingGate: "none",
};

function binding(overrides: Partial<VerifiedAfcFloorCameraBinding> = {}): VerifiedAfcFloorCameraBinding {
  return {
    floorAuthorityKey: FLOOR_KEY,
    basisFingerprint: FINGERPRINT,
    decodedWidth: 1264,
    decodedHeight: 848,
    bindingGeneration: 7,
    ...overrides,
  };
}

function input(
  overrides: Partial<VerifiedAfcCameraApplyQualificationInput> = {}
): VerifiedAfcCameraApplyQualificationInput {
  return {
    binding: binding(),
    currentFloorAuthorityKey: FLOOR_KEY,
    currentLiveBasis: {
      basisFingerprint: FINGERPRINT,
      decodedWidth: 1264,
      decodedHeight: 848,
    },
    currentCameraApplyEvaluation: AVAILABLE_EVALUATION,
    hasApplyCandidate: true,
    ...overrides,
  };
}

test("qualifies an exact AFC Floor binding with an available current camera candidate", () => {
  assert.deepEqual(qualifyVerifiedAfcCameraApply(input()), {
    ok: true,
    bindingGeneration: 7,
  });
});

test("rejects a missing or structurally malformed AFC Floor binding", () => {
  assert.deepEqual(
    qualifyVerifiedAfcCameraApply(input({ binding: null })),
    { ok: false, reason: "no_afc_floor_binding" }
  );

  const malformedBindings: readonly VerifiedAfcFloorCameraBinding[] = [
    binding({ floorAuthorityKey: "" }),
    binding({ basisFingerprint: "" }),
    binding({ decodedWidth: 0 }),
    binding({ decodedHeight: 0 }),
    binding({ decodedWidth: 12.5 }),
    binding({ decodedHeight: Number.POSITIVE_INFINITY }),
    binding({ bindingGeneration: 0 }),
    binding({ bindingGeneration: -1 }),
    binding({ bindingGeneration: 1.5 }),
    binding({ bindingGeneration: Number.MAX_SAFE_INTEGER + 1 }),
  ];

  for (const malformed of malformedBindings) {
    assert.deepEqual(
      qualifyVerifiedAfcCameraApply(input({ binding: malformed })),
      { ok: false, reason: "no_afc_floor_binding" }
    );
  }
});

test("requires the exact current durable Floor authority key without normalization", () => {
  assert.deepEqual(
    qualifyVerifiedAfcCameraApply(input({ currentFloorAuthorityKey: null })),
    { ok: false, reason: "current_floor_authority_unavailable" }
  );
  assert.deepEqual(
    qualifyVerifiedAfcCameraApply(input({ currentFloorAuthorityKey: `${FLOOR_KEY} ` })),
    { ok: false, reason: "floor_authority_mismatch" }
  );
  assert.deepEqual(
    qualifyVerifiedAfcCameraApply(input({ currentFloorAuthorityKey: FLOOR_KEY })),
    { ok: true, bindingGeneration: 7 }
  );
});

test("requires the exact current image fingerprint and decoded dimensions", () => {
  assert.deepEqual(
    qualifyVerifiedAfcCameraApply(input({ currentLiveBasis: null })),
    { ok: false, reason: "live_image_basis_unavailable" }
  );
  assert.deepEqual(
    qualifyVerifiedAfcCameraApply(input({
      currentLiveBasis: { basisFingerprint: "b".repeat(64), decodedWidth: 1264, decodedHeight: 848 },
    })),
    { ok: false, reason: "support_image_basis_mismatch" }
  );
  assert.deepEqual(
    qualifyVerifiedAfcCameraApply(input({
      currentLiveBasis: { basisFingerprint: FINGERPRINT, decodedWidth: 1265, decodedHeight: 848 },
    })),
    { ok: false, reason: "support_image_basis_mismatch" }
  );
  assert.deepEqual(
    qualifyVerifiedAfcCameraApply(input({
      currentLiveBasis: { basisFingerprint: FINGERPRINT, decodedWidth: 1264, decodedHeight: 849 },
    })),
    { ok: false, reason: "support_image_basis_mismatch" }
  );

  for (const malformed of [
    { basisFingerprint: "", decodedWidth: 1264, decodedHeight: 848 },
    { basisFingerprint: FINGERPRINT, decodedWidth: 0, decodedHeight: 848 },
    { basisFingerprint: FINGERPRINT, decodedWidth: 1264, decodedHeight: 0 },
    { basisFingerprint: FINGERPRINT, decodedWidth: 1264.5, decodedHeight: 848 },
    { basisFingerprint: FINGERPRINT, decodedWidth: Number.NaN, decodedHeight: 848 },
  ]) {
    assert.deepEqual(
      qualifyVerifiedAfcCameraApply(input({ currentLiveBasis: malformed })),
      { ok: false, reason: "live_image_basis_unavailable" }
    );
  }

  assert.deepEqual(qualifyVerifiedAfcCameraApply(input()), { ok: true, bindingGeneration: 7 });
});

test("requires a current candidate and preserves the existing camera gate failure", () => {
  assert.deepEqual(
    qualifyVerifiedAfcCameraApply(input({ hasApplyCandidate: false })),
    { ok: false, reason: "camera_candidate_unavailable" }
  );
  assert.deepEqual(
    qualifyVerifiedAfcCameraApply(input({
      currentCameraApplyEvaluation: {
        available: false,
        reason: "CV reprojection max is too high",
        firstFailingGate: "cv-max",
      },
    })),
    {
      ok: false,
      reason: "camera_apply_gates_failed",
      cameraReason: "CV reprojection max is too high",
      firstFailingGate: "cv-max",
    }
  );
  assert.deepEqual(qualifyVerifiedAfcCameraApply(input()), { ok: true, bindingGeneration: 7 });
});

test("consumes only committed Floor identity, live basis, candidate presence, and camera gates", () => {
  const qualificationInput = input();
  assert.deepEqual(Object.keys(qualificationInput).sort(), [
    "binding",
    "currentCameraApplyEvaluation",
    "currentFloorAuthorityKey",
    "currentLiveBasis",
    "hasApplyCandidate",
  ]);
  assert.deepEqual(qualifyVerifiedAfcCameraApply(qualificationInput), { ok: true, bindingGeneration: 7 });
});
