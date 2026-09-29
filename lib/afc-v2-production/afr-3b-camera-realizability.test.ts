import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE } from "@/app/admin/3d-room-lab/afc-lab-geometry-candidate";
import {
  settleAfcFixedSeamCalibration,
  settleAfcFixedSeamCalibrationWithRatioExtension,
} from "@/app/admin/3d-room-lab/afc-fixed-seam-calibration";
import {
  floorVec3ToPlane2D,
  getFloorRectCorners,
} from "@/app/admin/3d-room-lab/perspective-solve";
import type { AfcV2AnalyzeResult } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";

import {
  AFC_V2_CAMERA_REALIZABILITY_DIAGNOSTIC_SCHEMA_VERSION,
  afcV2CameraRealizabilityAspectBasisFromSettle,
  evaluateAfcV2CameraRealizability,
  isAfcV2CameraRealizabilityRecorded,
  parseAfcV2CameraRealizability,
} from "./camera-realizability-diagnostic";
import { runProductionAfcAnalysis } from "./production-adapter.server";
import {
  AfcGenerationImmutabilityError,
  createMemoryAfcProductionStore,
} from "./production-store";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const IMAGE_1 = [
  { x: 0.2370453644228819, y: 0.9948381096093489 },
  { x: 0.6620500770539771, y: 0.7572163483736456 },
  { x: 0.44763728824207566, y: 0.6652712265752749 },
  { x: 0.12746642239141576, y: 0.7509666920045333 },
] as const;

const LIVE = [
  { x: 0.10345641758985938, y: 0.8502281159111699 },
  { x: 0.285650487293239, y: 0.7847795955191518 },
  { x: 0.22908210999228484, y: 0.7216762120066194 },
  { x: 0.08215266106703666, y: 0.7655805115886138 },
] as const;

const IMAGE_2 = [
  { x: 0.36474461944218345, y: 0.9983276427270031 },
  { x: 0.580486390524475, y: 0.7562544451517041 },
  { x: 0.4742008408059321, y: 0.666783332780376 },
  { x: 0.3143490871499137, y: 0.7506483187037403 },
] as const;

function near(actual: number | null, expected: number, tolerance: number) {
  assert.equal(typeof actual, "number");
  assert.ok(actual != null && Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
}

test("live success at the winning ratio 0.72 has agreeing focal constraints", () => {
  const frame = { width: 1144, height: 1534 };
  const input = {
    sourceNormalizedPolygon: LIVE,
    sourceImageSize: frame,
    frameSize: frame,
    referenceDepthM: 4,
  };
  const before = settleAfcFixedSeamCalibrationWithRatioExtension(input);
  const basis = afcV2CameraRealizabilityAspectBasisFromSettle(before);
  const diagnostic = evaluateAfcV2CameraRealizability({ ...input, aspectBasis: basis });
  const after = settleAfcFixedSeamCalibrationWithRatioExtension(input);
  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  if (!before.ok || !after.ok) return;
  assert.equal(before.winningCellId, "ratio=0.720;fov=84.9");
  assert.equal(before.verticalFovDeg, 84.9);
  assert.equal(before.widthDepthRatio, 0.72);
  assert.equal(before.applySafeCellCount, 332);
  assert.equal(after.winningCellId, before.winningCellId);
  assert.equal(after.verticalFovDeg, before.verticalFovDeg);
  assert.equal(diagnostic.status, "computed");
  assert.equal(diagnostic.aspectBasis?.kind, "winning_ratio");
  assert.equal(diagnostic.aspectBasis?.widthDepthRatio, 0.72);
  near(diagnostic.focalFromOrthogonalityPx, 837.9433201070884, 1e-6);
  near(diagnostic.focalFromEqualNormPx, 840.6587433950083, 1e-6);
  near(diagnostic.verticalFovFromOrthogonalityDeg, 84.93800373652282, 1e-6);
  near(diagnostic.verticalFovFromEqualNormDeg, 84.75338196618804, 1e-6);
  near(diagnostic.focalDisagreement, 0.003230113657003791, 1e-9);
  assert.ok((diagnostic.focalDisagreement ?? 1) < 0.01);
});

test("hard-fail quad 1 stays inconsistent at settle's best-rejected ratio", () => {
  const frame = { width: 1144, height: 1534 };
  const input = {
    sourceNormalizedPolygon: IMAGE_1,
    sourceImageSize: frame,
    frameSize: frame,
    referenceDepthM: 4,
  };
  const before = settleAfcFixedSeamCalibrationWithRatioExtension(input);
  const basis = afcV2CameraRealizabilityAspectBasisFromSettle(before);
  const diagnostic = evaluateAfcV2CameraRealizability({ ...input, aspectBasis: basis });
  const after = settleAfcFixedSeamCalibrationWithRatioExtension(input);
  assert.equal(before.ok, false);
  assert.equal(after.ok, false);
  if (before.ok || after.ok || before.reason !== "no_apply_safe_candidate") return;
  assert.equal(before.reason, "no_apply_safe_candidate");
  assert.equal(after.reason, before.reason);
  assert.equal(before.applySafeCellCount, 0);
  assert.equal(before.diagnostics.bestRejectedCandidate?.ratio, 1.23);
  assert.equal(before.diagnostics.bestRejectedCandidate?.verticalFovDeg, 90);
  assert.equal(before.diagnostics.bestRejectedCandidate?.firstFailingGate, "confidence");
  assert.equal(after.diagnostics.bestRejectedCandidate?.ratio, 1.23);
  near(before.diagnostics.bestRejectedCandidate?.cvAvgPx ?? null, 33.84207400752242, 1e-6);
  near(before.diagnostics.bestRejectedCandidate?.cvMaxPx ?? null, 60.821899408656904, 1e-6);
  assert.equal(diagnostic.status, "computed");
  assert.equal(diagnostic.aspectBasis?.kind, "best_rejected_ratio");
  assert.equal(diagnostic.aspectBasis?.widthDepthRatio, 1.23);
  near(diagnostic.verticalFovFromOrthogonalityDeg, 98.50945338479755, 1e-6);
  near(diagnostic.verticalFovFromEqualNormDeg, 145.14399368615398, 1e-6);
  near(diagnostic.focalDisagreement, 0.6356196382251585, 1e-9);
  assert.ok((diagnostic.focalDisagreement ?? 0) > 0.5);
});

test("hard-fail quad 2 stays inconsistent at settle's best-rejected ratio", () => {
  const frame = { width: 1800, height: 1200 };
  const input = {
    sourceNormalizedPolygon: IMAGE_2,
    sourceImageSize: frame,
    frameSize: frame,
    referenceDepthM: 4,
  };
  const before = settleAfcFixedSeamCalibrationWithRatioExtension(input);
  const basis = afcV2CameraRealizabilityAspectBasisFromSettle(before);
  const diagnostic = evaluateAfcV2CameraRealizability({ ...input, aspectBasis: basis });
  const after = settleAfcFixedSeamCalibrationWithRatioExtension(input);
  assert.equal(before.ok, false);
  assert.equal(after.ok, false);
  if (before.ok || after.ok || before.reason !== "no_apply_safe_candidate") return;
  assert.equal(before.applySafeCellCount, 0);
  assert.equal(after.reason, before.reason);
  assert.equal(before.diagnostics.bestRejectedCandidate?.ratio, 1.275);
  assert.equal(before.diagnostics.bestRejectedCandidate?.verticalFovDeg, 90);
  assert.equal(after.diagnostics.bestRejectedCandidate?.ratio, 1.275);
  near(before.diagnostics.bestRejectedCandidate?.cvAvgPx ?? null, 32.2962418797303, 1e-6);
  near(before.diagnostics.bestRejectedCandidate?.cvMaxPx ?? null, 60.64397236019436, 1e-6);
  assert.equal(diagnostic.status, "computed");
  assert.equal(diagnostic.aspectBasis?.kind, "best_rejected_ratio");
  assert.equal(diagnostic.aspectBasis?.widthDepthRatio, 1.275);
  near(diagnostic.verticalFovFromOrthogonalityDeg, 100.32549043461601, 1e-6);
  near(diagnostic.verticalFovFromEqualNormDeg, 173.0380253719421, 1e-6);
  near(diagnostic.focalDisagreement, 0.9270865599441186, 1e-9);
});

test("a camera-realizable 0.72 rectangle agrees only at that aspect", () => {
  const frame = { width: 896, height: 1200 };
  const verticalFovDeg = 70;
  const focal = frame.height / (2 * Math.tan((verticalFovDeg * Math.PI) / 360));
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  const normalize = (vector: readonly number[]) => {
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  };
  const r1 = normalize([0.8, 0.15, 0.35]);
  const tilted = normalize([0.1, 0.7, 0.45]);
  const along = r1[0] * tilted[0] + r1[1] * tilted[1] + r1[2] * tilted[2];
  const r2 = normalize([
    tilted[0] - along * r1[0],
    tilted[1] - along * r1[1],
    tilted[2] - along * r1[2],
  ]);
  const translation = [0.05, -0.15, 3.5];
  const rotation = [
    r1[0], r2[0], translation[0],
    r1[1], r2[1], translation[1],
    r1[2], r2[2], translation[2],
  ];
  const homography = [
    focal * rotation[0] + cx * rotation[6],
    focal * rotation[1] + cx * rotation[7],
    focal * rotation[2] + cx * rotation[8],
    focal * rotation[3] + cy * rotation[6],
    focal * rotation[4] + cy * rotation[7],
    focal * rotation[5] + cy * rotation[8],
    rotation[6],
    rotation[7],
    rotation[8],
  ];
  const rectangle = getFloorRectCorners({ widthMeters: 0.72, depthMeters: 1 });
  assert.equal(rectangle.ok, true);
  if (!rectangle.ok) return;
  const polygon = rectangle.value.asArray.map((corner) => {
    const plane = floorVec3ToPlane2D(corner);
    const u = homography[0] * plane.x + homography[1] * plane.y + homography[2];
    const v = homography[3] * plane.x + homography[4] * plane.y + homography[5];
    const w = homography[6] * plane.x + homography[7] * plane.y + homography[8];
    return { x: (u / w) / frame.width, y: (v / w) / frame.height };
  });
  const diagnostic = evaluateAfcV2CameraRealizability({
    sourceNormalizedPolygon: polygon,
    sourceImageSize: frame,
    frameSize: frame,
    aspectBasis: { kind: "winning_ratio", widthDepthRatio: 0.72 },
  });
  assert.equal(diagnostic.status, "computed");
  assert.equal(diagnostic.aspectBasis?.widthDepthRatio, 0.72);
  near(diagnostic.focalFromOrthogonalityPx, focal, 1e-6);
  near(diagnostic.focalFromEqualNormPx, focal, 1e-6);
  near(diagnostic.verticalFovFromOrthogonalityDeg, verticalFovDeg, 1e-6);
  near(diagnostic.verticalFovFromEqualNormDeg, verticalFovDeg, 1e-6);
  near(diagnostic.focalDisagreement, 0, 1e-9);
  const squareBasis = evaluateAfcV2CameraRealizability({
    sourceNormalizedPolygon: polygon,
    sourceImageSize: frame,
    frameSize: frame,
    aspectBasis: { kind: "winning_ratio", widthDepthRatio: 1 },
  });
  assert.ok(squareBasis.status === "non_finite" || (squareBasis.focalDisagreement ?? 0) > 0.2);
});

test("Room C at its winning ratio stays observational and does not change the settle winner", () => {
  assert.equal(ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok, true);
  if (!ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok) return;
  const candidate = ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.candidate;
  const input = {
    sourceNormalizedPolygon: candidate.sourceNormalizedPolygon,
    sourceImageSize: {
      width: candidate.acceptanceBasis.decodedWidth,
      height: candidate.acceptanceBasis.decodedHeight,
    },
    frameSize: { width: 1118, height: 698 },
    referenceDepthM: candidate.referenceDepthM,
  };
  const before = settleAfcFixedSeamCalibration(input);
  const diagnostic = evaluateAfcV2CameraRealizability({
    ...input,
    aspectBasis: afcV2CameraRealizabilityAspectBasisFromSettle(before),
  });
  const after = settleAfcFixedSeamCalibration(input);
  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  if (!before.ok || !after.ok) return;
  assert.equal(before.winningCellId, "ratio=1.155;fov=78.4");
  assert.equal(after.winningCellId, before.winningCellId);
  assert.equal(after.verticalFovDeg, 78.4);
  assert.equal(diagnostic.evaluated, true);
  assert.equal(diagnostic.status, "computed");
  assert.equal(diagnostic.aspectBasis?.kind, "winning_ratio");
  assert.equal(diagnostic.aspectBasis?.widthDepthRatio, 1.155);
  assert.equal(diagnostic.schemaVersion, AFC_V2_CAMERA_REALIZABILITY_DIAGNOSTIC_SCHEMA_VERSION);
  near(diagnostic.focalFromOrthogonalityPx, 428.02938748647534, 1e-6);
  near(diagnostic.focalFromEqualNormPx, 410.720527813226, 1e-6);
  near(diagnostic.verticalFovFromOrthogonalityDeg, 78.38516686008519, 1e-6);
  near(diagnostic.verticalFovFromEqualNormDeg, 80.71085685855606, 1e-6);
  near(diagnostic.focalDisagreement, 0.040438484317379404, 1e-9);
  assert.equal(Math.abs((diagnostic.verticalFovFromOrthogonalityDeg ?? 0) - before.verticalFovDeg) < 0.02, true);
});

test("missing and degenerate geometry never throw", () => {
  const missing = evaluateAfcV2CameraRealizability({
    sourceNormalizedPolygon: null,
    sourceImageSize: { width: 896, height: 1200 },
    frameSize: { width: 896, height: 1200 },
    aspectBasis: null,
  });
  assert.equal(missing.evaluated, false);
  assert.equal(missing.status, "not_evaluated");
  assert.equal(missing.aspectBasis, null);
  assert.equal(missing.focalDisagreement, null);

  const basis = { kind: "best_rejected_ratio" as const, widthDepthRatio: 1.23 };
  const short = evaluateAfcV2CameraRealizability({
    sourceNormalizedPolygon: IMAGE_1.slice(0, 3),
    sourceImageSize: { width: 896, height: 1200 },
    frameSize: { width: 896, height: 1200 },
    aspectBasis: basis,
  });
  assert.equal(short.status, "unavailable");
  assert.equal(short.aspectBasis?.widthDepthRatio, 1.23);
  assert.equal(short.focalFromOrthogonalityPx, null);

  const nan = evaluateAfcV2CameraRealizability({
    sourceNormalizedPolygon: [
      { x: Number.NaN, y: 0.1 },
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.3 },
      { x: 0.4, y: 0.4 },
    ],
    sourceImageSize: { width: 896, height: 1200 },
    frameSize: { width: 896, height: 1200 },
    aspectBasis: basis,
  });
  assert.equal(nan.status, "unavailable");

  const badFrame = evaluateAfcV2CameraRealizability({
    sourceNormalizedPolygon: IMAGE_1,
    sourceImageSize: { width: 896, height: 1200 },
    frameSize: { width: 0, height: 1200 },
    aspectBasis: basis,
  });
  assert.equal(badFrame.status, "unavailable");

  const throwing = [
    { get x(): number { throw new Error("boom"); }, y: 0.1 },
    { x: 0.2, y: 0.2 },
    { x: 0.3, y: 0.3 },
    { x: 0.4, y: 0.1 },
  ];
  const caught = evaluateAfcV2CameraRealizability({
    sourceNormalizedPolygon: throwing,
    sourceImageSize: { width: 896, height: 1200 },
    frameSize: { width: 896, height: 1200 },
    aspectBasis: basis,
  });
  assert.equal(caught.evaluated, true);
  assert.equal(caught.status, "unavailable");
});

test("parser accepts null, rejects malformed numbers, and preserves unknown schemas", () => {
  assert.deepEqual(parseAfcV2CameraRealizability(null), { ok: true, decision: null });
  const superseded = parseAfcV2CameraRealizability({
    schemaVersion: "afc-v2-camera-realizability-diagnostic/v1",
    evaluated: true,
    status: "computed",
    focalFromOrthogonalityPx: 837.9433201070881,
    focalFromEqualNormPx: 273.3268268800335,
    verticalFovFromOrthogonalityDeg: 84.93800373652283,
    verticalFovFromEqualNormDeg: 140.77210379351334,
    focalDisagreement: 0.6738122730722377,
  });
  assert.equal(superseded.ok, true);
  if (!superseded.ok || superseded.decision == null || !("kind" in superseded.decision)) return;
  assert.equal(superseded.decision.schemaVersion, "afc-v2-camera-realizability-diagnostic/v1");
  const unknown = parseAfcV2CameraRealizability({
    schemaVersion: "afc-v2-camera-realizability-diagnostic/v9",
    evaluated: true,
  });
  assert.equal(unknown.ok, true);
  if (!unknown.ok || unknown.decision == null || !("kind" in unknown.decision)) return;
  assert.equal(unknown.decision.kind, "unsupported_schema");
  assert.equal(unknown.decision.schemaVersion, "afc-v2-camera-realizability-diagnostic/v9");
  const malformed = parseAfcV2CameraRealizability({
    schemaVersion: AFC_V2_CAMERA_REALIZABILITY_DIAGNOSTIC_SCHEMA_VERSION,
    evaluated: true,
    status: "computed",
    aspectBasis: { kind: "winning_ratio", widthDepthRatio: 0.72 },
    focalFromOrthogonalityPx: Number.NaN,
    focalFromEqualNormPx: 1,
    verticalFovFromOrthogonalityDeg: 1,
    verticalFovFromEqualNormDeg: 1,
    focalDisagreement: 0,
  });
  assert.equal(malformed.ok, false);
});

test("terminal camera-realizability evidence cannot change after the generation fails", async () => {
  const store = createMemoryAfcProductionStore();
  await store.createRoom?.({
    id: ROOM_ID,
    userId: USER_ID,
    currentAfcGenerationId: null,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  });
  const running = await store.createGeneration({
    roomId: ROOM_ID,
    userId: USER_ID,
    parentGenerationId: null,
    runId: "run-camera",
    intent: "analyze",
    tiledForceRegeneration: false,
  });
  assert.equal(running.cameraRealizability, null);
  const diagnostic = evaluateAfcV2CameraRealizability({
    sourceNormalizedPolygon: IMAGE_1,
    sourceImageSize: { width: 1144, height: 1534 },
    frameSize: { width: 1144, height: 1534 },
    aspectBasis: { kind: "best_rejected_ratio", widthDepthRatio: 1.23 },
  });
  const failed = await store.updateGeneration(running.id, {
    status: "failed",
    completedAt: "2026-09-28T00:00:00.000Z",
    failureReason: "AFC settle failed closed: no_apply_safe_candidate.",
    metricStatus: "none",
    collisionStatus: "none",
    cameraRealizability: diagnostic,
  });
  assert.deepEqual(failed.cameraRealizability, diagnostic);
  const again = await store.updateGeneration(running.id, {
    cameraRealizability: failed.cameraRealizability,
  });
  assert.deepEqual(again.cameraRealizability, diagnostic);
  await assert.rejects(
    () => store.updateGeneration(running.id, {
      cameraRealizability: {
        schemaVersion: AFC_V2_CAMERA_REALIZABILITY_DIAGNOSTIC_SCHEMA_VERSION,
        evaluated: false,
        status: "not_evaluated",
        aspectBasis: null,
        focalFromOrthogonalityPx: null,
        focalFromEqualNormPx: null,
        verticalFovFromOrthogonalityDeg: null,
        verticalFovFromEqualNormDeg: null,
        focalDisagreement: null,
      },
    }),
    AfcGenerationImmutabilityError,
  );
  const preserved = await store.getGeneration(running.id);
  assert.deepEqual(preserved?.cameraRealizability, diagnostic);
});

test("failed production persistence keeps the diagnostic off the public response", async () => {
  const diagnostic = evaluateAfcV2CameraRealizability({
    sourceNormalizedPolygon: IMAGE_1,
    sourceImageSize: { width: 1144, height: 1534 },
    frameSize: { width: 1144, height: 1534 },
    aspectBasis: { kind: "best_rejected_ratio", widthDepthRatio: 1.23 },
  });
  const store = createMemoryAfcProductionStore();
  await store.createRoom?.({
    id: ROOM_ID,
    userId: USER_ID,
    currentAfcGenerationId: null,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  });
  const bytes = Uint8Array.from([9, 8, 7, 6]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const result = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
    original: {
      bytes,
      identity: {
        sha256: sha,
        byteCount: bytes.byteLength,
        decodedWidth: 1200,
        decodedHeight: 800,
        mimeType: "image/jpeg",
        orientation: 1,
      },
      sourceImageUrl: "https://example.test/original.jpg",
    },
    analyze: async () => ({
      status: "failed",
      reason: "AFC settle failed closed: no_apply_safe_candidate.",
      settleDecision: null,
      cameraRealizability: diagnostic,
    } as AfcV2AnalyzeResult),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "AFC settle failed closed: no_apply_safe_candidate.");
  assert.equal("cameraRealizability" in result, false);
  assert.equal(JSON.stringify(result).includes("focalDisagreement"), false);
  const generation = await store.getGeneration(result.generationId ?? "");
  assert.equal(isAfcV2CameraRealizabilityRecorded(generation?.cameraRealizability), true);
  assert.deepEqual(generation?.cameraRealizability, diagnostic);
  assert.equal(generation?.metricStatus, "none");
  assert.equal(generation?.collisionStatus, "none");
});
