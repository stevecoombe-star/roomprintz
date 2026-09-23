import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  validatePendingAfcLabCameraApply,
  type AfcLabCameraApplyLiveState,
  type AfcLabCameraApplyToken,
} from "./afc-lab-apply-transaction";

const source = readFileSync(new URL("./ThreeRoomLab.tsx", import.meta.url), "utf8");
const effectStart = source.indexOf("// AFC-SR1 Phase 2A deferred camera transaction.");
const effectEnd = source.indexOf("const objectProjectionDiagnostic = useMemo(", effectStart);
const effect = source.slice(effectStart, effectEnd);

function validToken(): AfcLabCameraApplyToken {
  return {
    token: 7,
    floorAuthorityKey: "floor:room-c",
    basisFingerprint: "room-c-original",
    decodedWidth: 7360,
    decodedHeight: 4912,
    worldWidthM: 4.62,
    worldDepthM: 4,
    verticalFovDeg: 78.4,
    frameWidth: 1118,
    frameHeight: 698,
  };
}

function validLiveState(): AfcLabCameraApplyLiveState {
  return {
    currentToken: 7,
    floorAuthorityKey: "floor:room-c",
    basis: {
      basisFingerprint: "room-c-original",
      decodedWidth: 7360,
      decodedHeight: 4912,
    },
    worldWidthM: 4.62,
    worldDepthM: 4,
    verticalFovDeg: 78.4,
    frameWidth: 1118,
    frameHeight: 698,
    isCalibratedCameraActive: false,
  };
}

test("matching Room C AFC transaction state is eligible for a fresh camera resolution", () => {
  assert.deepEqual(validatePendingAfcLabCameraApply(validToken(), validLiveState()), { valid: true });
});

test("Room C AFC transaction blocks a stale token", () => {
  assert.deepEqual(validatePendingAfcLabCameraApply(validToken(), { ...validLiveState(), currentToken: 8 }), {
    valid: false,
    reason: "stale_token",
  });
});

test("a newer Perspective Adjust commit prevents the older pending camera transaction from winning", () => {
  const olderPerspectiveCommit: AfcLabCameraApplyToken = { ...validToken(), token: 21, verticalFovDeg: 70.2 };
  const newerLiveState: AfcLabCameraApplyLiveState = {
    ...validLiveState(),
    currentToken: 22,
    verticalFovDeg: 88.1,
  };
  assert.deepEqual(validatePendingAfcLabCameraApply(olderPerspectiveCommit, newerLiveState), {
    valid: false,
    reason: "stale_token",
  });
});

test("Room C AFC transaction blocks changed Floor authority", () => {
  assert.deepEqual(validatePendingAfcLabCameraApply(validToken(), { ...validLiveState(), floorAuthorityKey: "floor:other" }), {
    valid: false,
    reason: "floor_mismatch",
  });
});

test("Room C AFC transaction blocks a changed Original fingerprint", () => {
  assert.deepEqual(
    validatePendingAfcLabCameraApply(validToken(), {
      ...validLiveState(),
      basis: { ...validLiveState().basis!, basisFingerprint: "other-original" },
    }),
    { valid: false, reason: "basis_mismatch" }
  );
});

test("Room C AFC transaction blocks changed Original dimensions", () => {
  assert.deepEqual(
    validatePendingAfcLabCameraApply(validToken(), {
      ...validLiveState(),
      basis: { ...validLiveState().basis!, decodedWidth: 7361 },
    }),
    { valid: false, reason: "basis_mismatch" }
  );
});

test("Room C AFC transaction blocks changed Width", () => {
  assert.deepEqual(validatePendingAfcLabCameraApply(validToken(), { ...validLiveState(), worldWidthM: 4.61 }), {
    valid: false,
    reason: "mapping_mismatch",
  });
});

test("Room C AFC transaction blocks changed Depth", () => {
  assert.deepEqual(validatePendingAfcLabCameraApply(validToken(), { ...validLiveState(), worldDepthM: 4.01 }), {
    valid: false,
    reason: "mapping_mismatch",
  });
});

test("Room C AFC transaction blocks changed FOV", () => {
  assert.deepEqual(validatePendingAfcLabCameraApply(validToken(), { ...validLiveState(), verticalFovDeg: 78.5 }), {
    valid: false,
    reason: "fov_mismatch",
  });
});

test("Room C AFC transaction blocks a changed rendering frame", () => {
  assert.deepEqual(validatePendingAfcLabCameraApply(validToken(), { ...validLiveState(), frameHeight: 699 }), {
    valid: false,
    reason: "frame_mismatch",
  });
});

test("Room C AFC transaction blocks an already active calibrated camera", () => {
  assert.deepEqual(validatePendingAfcLabCameraApply(validToken(), { ...validLiveState(), isCalibratedCameraActive: true }), {
    valid: false,
    reason: "camera_already_active",
  });
});

test("Room C AFC deferred effect validates coherence before the unchanged fresh Apply gate", () => {
  assert.ok(effectStart >= 0);
  assert.match(effect, /validatePendingAfcLabCameraApply\(/);
  assert.match(effect, /cameraPoseApplyCandidateRef\.current/);
  assert.match(effect, /evaluateCalibratedCameraApply\(/);
  assert.match(effect, /setPendingAfcLabCameraApply\(null\);[\s\S]*applyCalibratedCameraSnapshotFromCandidate/);
});
