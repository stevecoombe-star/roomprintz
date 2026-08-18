import assert from "node:assert/strict";
import test from "node:test";
import { validateAfcSr1LiveResultAcceptance } from "./afc-sr1-live-acceptance";
import type { AfcSr1LiveAuthoritativeGeometry } from "./afc-sr1-live-product-contract";

const result = {
  attemptId: "attempt-2",
  labLoadGeneration: 4,
  originalBasis: {
    sha256: "a".repeat(64),
    decodedWidth: 1200,
    decodedHeight: 800,
    orientation: 1,
  },
} as AfcSr1LiveAuthoritativeGeometry;

const acceptedState = {
  currentAttemptId: "attempt-2",
  labLoadGeneration: 4,
  qualifiedBasis: {
    basisFingerprint: "a".repeat(64),
    decodedWidth: 1200,
    decodedHeight: 800,
    orientation: 1,
  },
} as const;

test("accepts only the current attempt on the exact current source basis", () => {
  assert.deepEqual(
    validateAfcSr1LiveResultAcceptance(result, acceptedState),
    { accepted: true }
  );
});

test("a second AFC click supersedes the first result", () => {
  const validation = validateAfcSr1LiveResultAcceptance(result, {
    ...acceptedState,
    currentAttemptId: "attempt-3",
  });
  assert.deepEqual(validation, {
    accepted: false,
    reason: "attempt_superseded",
  });
});

test("an image load generation change makes the old result inert", () => {
  const validation = validateAfcSr1LiveResultAcceptance(result, {
    ...acceptedState,
    labLoadGeneration: 5,
  });
  assert.deepEqual(validation, {
    accepted: false,
    reason: "load_generation_mismatch",
  });
});

test("source SHA, dimensions, and orientation are independently bound", () => {
  assert.equal(
    validateAfcSr1LiveResultAcceptance(result, {
      ...acceptedState,
      qualifiedBasis: {
        ...acceptedState.qualifiedBasis,
        basisFingerprint: "b".repeat(64),
      },
    }).accepted,
    false
  );
  assert.equal(
    validateAfcSr1LiveResultAcceptance(result, {
      ...acceptedState,
      qualifiedBasis: {
        ...acceptedState.qualifiedBasis,
        decodedWidth: 1199,
      },
    }).accepted,
    false
  );
  assert.equal(
    validateAfcSr1LiveResultAcceptance(result, {
      ...acceptedState,
      qualifiedBasis: {
        ...acceptedState.qualifiedBasis,
        orientation: 8,
      },
    }).accepted,
    false
  );
});
