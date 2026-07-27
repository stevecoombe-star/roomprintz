import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAfcR3cImageManifest,
  validateSharedCandidateComparisonContext,
} from "./gemini-floor-proposal-manifest";
import {
  deriveGeminiFloorBasisBinding,
  GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
} from "./gemini-floor-proposal-contract";
import type { SharedCandidateComparisonContext } from "./candidate-discrimination-harness";

const SHA = "a".repeat(64);

function context() {
  return {
    ratioFovContractVersion: "ratio-fov-harness/v1",
    basisId: "fixture-basis",
    basisFingerprint: SHA,
    decoderId: "fixture/decoder-v1",
    normalizationPolicyVersion: "source-normalized/v1",
    decodedWidth: 1,
    decodedHeight: 1,
    frameSize: { width: 1, height: 1 },
    orientationApplied: false,
    basisKind: "original",
    ratioDomain: { min: 1, max: 1, step: 0.1 },
    fovDomain: { minDeg: 45, maxDeg: 45, stepDeg: 1 },
    refinement: { enabled: false, ratioStep: 0.1, fovStepDeg: 1, basinFactor: 1, additivePxAllowance: 0 },
    referenceDepth: 1,
  };
}

function manifest() {
  return {
    contractVersion: "afc-r3c-image-manifest/v1",
    roomId: "fixture-room-a",
    original: { filePath: "original.png", sha256: SHA, byteCount: 1, decodedWidth: 1, decodedHeight: 1, orientation: 1, mimeType: "image/png" },
    emptyRoomAssist: {
      filePath: "empty.png", sha256: SHA, byteCount: 1, decodedWidth: 1, decodedHeight: 1, orientation: 1, mimeType: "image/png",
      generatedFromOriginalSha256: SHA, generatorId: "fixture-generator", generatorModelId: "fixture-model",
    },
    sharedComparisonContext: context(),
  };
}

test("shared comparison-context validator is closed, structural, and fail-closed", () => {
  assert.equal(validateSharedCandidateComparisonContext(context()).ok, true);
  const invalid: unknown[] = [
    undefined, null, {}, "garbage", 1, false, [], { basisId: "x" },
    { ...context(), ratioFovContractVersion: "unknown" },
    { ...context(), basisId: "" },
    { ...context(), decodedWidth: Number.MAX_SAFE_INTEGER + 1 },
    { ...context(), frameSize: { width: 0, height: 1 } },
    { ...context(), ratioDomain: { min: 2, max: 1, step: 0.1 } },
    { ...context(), ratioDomain: { min: 1, max: Number.NaN, step: 0.1 } },
    { ...context(), fovDomain: { minDeg: 90, maxDeg: 20, stepDeg: 1 } },
    { ...context(), unknown: true },
  ];
  for (const value of invalid) {
    const result = validateSharedCandidateComparisonContext(value);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failureCode, "comparison_context_invalid");
  }
});

test("manifest parser rejects traversal, duplicate paths, mismatched images, and invalid context", () => {
  assert.equal(parseAfcR3cImageManifest(manifest()).ok, true);
  const rows: Array<(value: ReturnType<typeof manifest>) => void> = [
    (value) => { value.original.filePath = "../escape.png"; },
    (value) => { value.emptyRoomAssist.filePath = "original.png"; },
    (value) => { value.emptyRoomAssist.decodedWidth = 2; },
    (value) => { value.original.orientation = 2; },
    (value) => { value.original.mimeType = "image/jpeg"; },
    (value) => { value.sharedComparisonContext = {} as ReturnType<typeof context>; },
  ];
  for (const mutate of rows) {
    const value = structuredClone(manifest());
    mutate(value);
    assert.equal(parseAfcR3cImageManifest(value).ok, false);
  }
});

test("generatorModelId accepts the requested generator label without claiming resolution", () => {
  const value = manifest();
  value.emptyRoomAssist.generatorModelId = "NBP";
  const parsed = parseAfcR3cImageManifest(value);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.manifest.emptyRoomAssist.generatorModelId, "NBP");
  assert.equal("resolvedModelId" in parsed.manifest.emptyRoomAssist, false);
});

test("refinement.enabled is closed and accepts only booleans", () => {
  const validStates: boolean[] = [false, true];
  for (const enabled of validStates) {
    const value = structuredClone(manifest());
    value.sharedComparisonContext.refinement.enabled = enabled;
    assert.equal(parseAfcR3cImageManifest(value).ok, true);
  }
  const invalidRefinements: unknown[] = [
    (() => {
      const refinement: Record<string, unknown> = { ...context().refinement };
      delete refinement.enabled;
      return refinement;
    })(),
    { ...context().refinement, enabled: "false" },
    { ...context().refinement, enabled: 0 },
    { ...context().refinement, enabled: null },
    { ...context().refinement, enabled: false, unexpected: true },
  ];
  for (const refinement of invalidRefinements) {
    const value = structuredClone(manifest());
    value.sharedComparisonContext.refinement = refinement as typeof value.sharedComparisonContext.refinement;
    assert.equal(parseAfcR3cImageManifest(value).ok, false);
    assert.equal(validateSharedCandidateComparisonContext({
      ...context(),
      refinement,
    }).ok, false);
  }
});

test("basis-binding API requires a validated shared comparison context", () => {
  const raw = context() as SharedCandidateComparisonContext;
  const validated = validateSharedCandidateComparisonContext(raw);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.match(
    deriveGeminiFloorBasisBinding(validated.value, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY),
    /^afc-r3b:[a-f0-9]{64}$/
  );
  if (false) {
    // @ts-expect-error The binding API must not admit an unvalidated context.
    deriveGeminiFloorBasisBinding(raw, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY);
  }
});
