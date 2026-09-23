import assert from "node:assert/strict";
import test from "node:test";

import type {
  VerifiedAfcCameraApplyQualificationInput,
  VerifiedAfcFloorCameraBinding,
} from "./afc-verified-camera-apply";
import {
  revalidateVerifiedAfcCameraApplyRequest,
  type VerifiedAfcCameraApplyRequest,
} from "./afc-verified-camera-apply-request";
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
    bindingGeneration: 1,
    ...overrides,
  };
}

function qualificationInput(
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

function request(bindingGeneration = 1): VerifiedAfcCameraApplyRequest {
  return { bindingGeneration };
}

test("accepts a valid request when current qualification remains eligible", () => {
  assert.deepEqual(
    revalidateVerifiedAfcCameraApplyRequest({
      request: request(),
      qualificationInput: qualificationInput(),
    }),
    { ok: true, bindingGeneration: 1 }
  );
});

test("rejects missing or malformed request generations before qualification", () => {
  const malformedRequests = [
    null,
    {},
    { bindingGeneration: 0 },
    { bindingGeneration: -1 },
    { bindingGeneration: 1.5 },
    { bindingGeneration: Number.MAX_SAFE_INTEGER + 1 },
  ];

  for (const malformed of malformedRequests) {
    assert.deepEqual(
      revalidateVerifiedAfcCameraApplyRequest({
        request: malformed as VerifiedAfcCameraApplyRequest | null,
        qualificationInput: qualificationInput(),
      }),
      { ok: false, reason: "request_invalid" }
    );
  }
});

test("rejects a displayed binding generation superseded by the current binding", () => {
  assert.deepEqual(
    revalidateVerifiedAfcCameraApplyRequest({
      request: request(1),
      qualificationInput: qualificationInput({ binding: binding({ bindingGeneration: 2 }) }),
    }),
    { ok: false, reason: "binding_superseded" }
  );
});

test("recomputes qualification and rejects all click-time invalidation paths", () => {
  const requestThatWasEligible = request();
  const invalidatedInputs: readonly VerifiedAfcCameraApplyQualificationInput[] = [
    qualificationInput({ currentFloorAuthorityKey: "different-current-floor" }),
    qualificationInput({
      currentLiveBasis: { basisFingerprint: "b".repeat(64), decodedWidth: 1264, decodedHeight: 848 },
    }),
    qualificationInput({
      currentLiveBasis: { basisFingerprint: FINGERPRINT, decodedWidth: 1265, decodedHeight: 848 },
    }),
    qualificationInput({ hasApplyCandidate: false }),
    qualificationInput({
      currentCameraApplyEvaluation: {
        available: false,
        reason: "camera pose confidence is not high",
        firstFailingGate: "confidence",
      },
    }),
    qualificationInput({ binding: null }),
  ];

  for (const current of invalidatedInputs) {
    assert.deepEqual(
      revalidateVerifiedAfcCameraApplyRequest({
        request: requestThatWasEligible,
        qualificationInput: current,
      }),
      { ok: false, reason: "invalidated_before_apply" }
    );
  }
});

test("request payload contains only the displayed binding generation", () => {
  const displayedRequest: VerifiedAfcCameraApplyRequest = request();
  assert.deepEqual(Object.keys(displayedRequest), ["bindingGeneration"]);
  for (const excludedField of ["candidate", "fov", "pose", "basis", "floorAuthorityKey"]) {
    assert.equal(excludedField in displayedRequest, false);
  }
  assert.deepEqual(
    revalidateVerifiedAfcCameraApplyRequest({
      request: displayedRequest,
      qualificationInput: qualificationInput(),
    }),
    { ok: true, bindingGeneration: 1 }
  );
});
