import assert from "node:assert/strict";
import test from "node:test";

import {
  establishVerifiedAfcFloorCameraBinding,
  shouldClearVerifiedAfcFloorCameraBindingForFloorAuthorityChange,
} from "./afc-verified-camera-binding";

const liveBasis = Object.freeze({
  basisFingerprint: "basis-current",
  decodedWidth: 1600,
  decodedHeight: 900,
});

test("verified AFC Floor outcomes establish exact bindings and refresh generation", () => {
  const applied = establishVerifiedAfcFloorCameraBinding({
    outcome: "applied",
    previousGeneration: 0,
    floorAuthorityKey: "floor-current",
    liveBasis,
  });
  assert.deepEqual(applied, {
    nextGeneration: 1,
    binding: {
      floorAuthorityKey: "floor-current",
      basisFingerprint: "basis-current",
      decodedWidth: 1600,
      decodedHeight: 900,
      bindingGeneration: 1,
    },
  });

  const noChangeRefresh = establishVerifiedAfcFloorCameraBinding({
    outcome: "no_change",
    previousGeneration: applied!.nextGeneration,
    floorAuthorityKey: "floor-current",
    liveBasis: { basisFingerprint: "basis-new", decodedWidth: 1920, decodedHeight: 1080 },
  });
  assert.equal(noChangeRefresh?.nextGeneration, 2);
  assert.deepEqual(noChangeRefresh?.binding, {
    floorAuthorityKey: "floor-current",
    basisFingerprint: "basis-new",
    decodedWidth: 1920,
    decodedHeight: 1080,
    bindingGeneration: 2,
  });
});

test("rejected Floor outcomes and invalid or exhausted inputs fail closed", () => {
  for (const input of [
    { outcome: "rejected" as const, previousGeneration: 4, floorAuthorityKey: "floor", liveBasis },
    { outcome: "applied" as const, previousGeneration: Number.MAX_SAFE_INTEGER, floorAuthorityKey: "floor", liveBasis },
    { outcome: "applied" as const, previousGeneration: 0, floorAuthorityKey: null, liveBasis },
    { outcome: "applied" as const, previousGeneration: 0, floorAuthorityKey: "floor", liveBasis: null },
  ]) {
    assert.equal(establishVerifiedAfcFloorCameraBinding(input), null);
  }
});

test("only material Floor authority changes invalidate a binding", () => {
  assert.equal(
    shouldClearVerifiedAfcFloorCameraBindingForFloorAuthorityChange("floor-current", "floor-current"),
    false
  );
  assert.equal(
    shouldClearVerifiedAfcFloorCameraBindingForFloorAuthorityChange("floor-current", "floor-replaced"),
    true
  );
});
