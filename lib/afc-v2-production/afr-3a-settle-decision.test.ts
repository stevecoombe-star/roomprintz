import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE } from "@/app/admin/3d-room-lab/afc-lab-geometry-candidate";
import {
  settleAfcFixedSeamCalibration,
  settleAfcFixedSeamCalibrationWithRatioExtension,
} from "@/app/admin/3d-room-lab/afc-fixed-seam-calibration";
import type { AfcV2AnalyzeResult } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";

import { runProductionAfcAnalysis } from "./production-adapter.server";
import {
  AfcGenerationImmutabilityError,
  createMemoryAfcProductionStore,
} from "./production-store";
import {
  AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
  isAfcV2SettleDecisionNotReachedV1,
  isAfcV2SettleDecisionRecordedV1,
  parseAfcV2SettleDecision,
  projectAfcV2SettleDecisionDiagnostic,
} from "./settle-decision-diagnostic";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORIGINAL_BYTES = Uint8Array.from([9, 8, 7, 6]);

function roomCInput() {
  assert.equal(ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok, true);
  if (!ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok) throw new Error("Room C fixture did not parse.");
  const candidate = ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.candidate;
  return {
    sourceNormalizedPolygon: candidate.sourceNormalizedPolygon,
    sourceImageSize: {
      width: candidate.acceptanceBasis.decodedWidth,
      height: candidate.acceptanceBasis.decodedHeight,
    },
    frameSize: { width: 1118, height: 698 },
    referenceDepthM: candidate.referenceDepthM,
  };
}

test("successful settle projects a versioned JSON-safe diagnostic", () => {
  const input = roomCInput();
  const settle = settleAfcFixedSeamCalibration(input);
  assert.equal(settle.ok, true);
  if (!settle.ok) return;
  assert.equal(settle.widthDepthRatio, 1.155);
  assert.equal(settle.verticalFovDeg, 78.4);
  assert.equal(settle.winningCellId, "ratio=1.155;fov=78.4");
  assert.equal("diagnostics" in settle, false);

  const diagnostic = projectAfcV2SettleDecisionDiagnostic({
    settle,
    sourceNormalizedPolygon: input.sourceNormalizedPolygon,
  });
  assert.equal(diagnostic.schemaVersion, AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION);
  assert.equal(diagnostic.reached, true);
  assert.deepEqual(diagnostic.result, { ok: true, reason: null });
  assert.equal(diagnostic.applySafeCellCount > 0, true);
  assert.equal(diagnostic.successfulCellCount != null && diagnostic.successfulCellCount >= diagnostic.applySafeCellCount, true);
  assert.equal(diagnostic.evaluatedCellCount >= diagnostic.applySafeCellCount, true);
  assert.equal(diagnostic.ratioExtensionAttempted, false);
  assert.equal(diagnostic.bestRejectedCandidate, null);
  assert.equal(diagnostic.winningCandidate?.widthDepthRatio, 1.155);
  assert.equal(diagnostic.winningCandidate?.verticalFovDeg, 78.4);
  assert.equal(diagnostic.winningCandidate?.firstFailingGate, "none");
  assert.deepEqual(diagnostic.sourceNormalizedPolygon, input.sourceNormalizedPolygon);
  const serialized = JSON.stringify(diagnostic);
  assert.equal(serialized.includes("NaN"), false);
  assert.equal(serialized.includes("Infinity"), false);
  assert.doesNotMatch(serialized, /verticalFovFromOrthogonalityDeg|verticalFovFromEqualNormDeg|focalDisagreement/);
  assert.deepEqual(JSON.parse(serialized), diagnostic);
  assert.equal(isAfcV2SettleDecisionRecordedV1(JSON.parse(serialized)), true);
});

test("no-apply-safe settle preserves rejection evidence and the source polygon", () => {
  const input = {
    ...roomCInput(),
    ratioSearch: { min: 0.5, max: 0.5, step: 0.1 },
    fovSearch: { minDeg: 80, maxDeg: 80, stepDeg: 1 },
  };
  const settle = settleAfcFixedSeamCalibration(input);
  assert.equal(settle.ok, false);
  if (settle.ok || settle.reason !== "no_apply_safe_candidate") return;
  const diagnostic = projectAfcV2SettleDecisionDiagnostic({
    settle,
    sourceNormalizedPolygon: input.sourceNormalizedPolygon,
  });
  assert.deepEqual(diagnostic.result, {
    ok: false,
    reason: "no_apply_safe_candidate",
  });
  assert.equal(diagnostic.applySafeCellCount, 0);
  assert.equal(diagnostic.successfulCellCount, 2);
  assert.equal(diagnostic.rejectionCounts?.confidence, 2);
  assert.equal(diagnostic.bestRejectedCandidate?.ratio, 0.5);
  assert.equal(diagnostic.bestRejectedCandidate?.verticalFovDeg, 80);
  assert.equal(diagnostic.bestRejectedCandidate?.firstFailingGate, "confidence");
  assert.equal(diagnostic.bestRejectedCandidate?.atRatioMin, true);
  assert.equal(diagnostic.bestRejectedCandidate?.atFovMax, true);
  assert.equal(diagnostic.winningCandidate, null);
  assert.equal(diagnostic.ratioExtensionAttempted, false);
  assert.deepEqual(diagnostic.sourceNormalizedPolygon, input.sourceNormalizedPolygon);
  assert.equal(JSON.stringify(diagnostic).includes("NaN"), false);
  assert.deepEqual(parseAfcV2SettleDecision(JSON.parse(JSON.stringify(diagnostic))).ok, true);
});

test("parser keeps historical null distinct from not-reached and rejects unsafe json", () => {
  assert.deepEqual(parseAfcV2SettleDecision(null), { ok: true, decision: null });
  const notReached = {
    schemaVersion: AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    reached: false,
  };
  assert.equal(isAfcV2SettleDecisionNotReachedV1(notReached), true);
  assert.equal(isAfcV2SettleDecisionRecordedV1(notReached), false);
  const unsupported = parseAfcV2SettleDecision({
    schemaVersion: "afc-v2-settle-decision-diagnostic/v9",
    reached: true,
  });
  assert.equal(unsupported.ok, true);
  if (!unsupported.ok || !unsupported.decision || !("kind" in unsupported.decision)) return;
  assert.equal(unsupported.decision.kind, "unsupported_schema");
  assert.equal(parseAfcV2SettleDecision({ schemaVersion: AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION }).ok, false);
  assert.equal(parseAfcV2SettleDecision({
    schemaVersion: AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    reached: true,
    evaluatedCellCount: Number.NaN,
  }).ok, false);
});

test("ratio extension attempted is recorded only from the existing wrapper flag", () => {
  const input = {
    sourceNormalizedPolygon: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.75, y: 0.22 },
      { x: 0.25, y: 0.22 },
    ] as const,
    sourceImageSize: { width: 1200, height: 800 },
    frameSize: { width: 1200, height: 800 },
    referenceDepthM: 4,
  };
  const settle = settleAfcFixedSeamCalibrationWithRatioExtension(input);
  assert.equal(settle.ok, false);
  if (settle.ok) return;
  assert.equal(settle.reason, "no_apply_safe_candidate");
  const diagnostic = projectAfcV2SettleDecisionDiagnostic({
    settle,
    sourceNormalizedPolygon: input.sourceNormalizedPolygon,
  });
  assert.equal(diagnostic.result.reason, "no_apply_safe_candidate");
  assert.equal(diagnostic.applySafeCellCount, 0);
  assert.equal((diagnostic.successfulCellCount ?? 0) > 0, true);
  assert.equal(diagnostic.ratioExtensionAttempted, false);
  assert.equal(diagnostic.bestRejectedCandidate?.firstFailingGate, "confidence");
});

test("terminal settle evidence cannot change after the generation fails", async () => {
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
    runId: "run-settle",
    intent: "analyze",
    tiledForceRegeneration: false,
  });
  assert.equal(running.settleDecision, null);
  const input = roomCInput();
  const settle = settleAfcFixedSeamCalibration(input);
  const diagnostic = projectAfcV2SettleDecisionDiagnostic({
    settle,
    sourceNormalizedPolygon: input.sourceNormalizedPolygon,
  });
  const failed = await store.updateGeneration(running.id, {
    status: "failed",
    completedAt: "2026-09-28T00:00:00.000Z",
    failureReason: "AFC settle failed closed: no_apply_safe_candidate.",
    metricStatus: "none",
    collisionStatus: "none",
    settleDecision: diagnostic,
  });
  assert.deepEqual(failed.settleDecision, diagnostic);
  const again = await store.updateGeneration(running.id, {
    settleDecision: failed.settleDecision,
  });
  assert.deepEqual(again.settleDecision, diagnostic);
  await assert.rejects(
    () => store.updateGeneration(running.id, {
      settleDecision: {
        schemaVersion: AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
        reached: false,
      },
    }),
    AfcGenerationImmutabilityError,
  );
  const preserved = await store.getGeneration(running.id);
  assert.deepEqual(preserved?.settleDecision, diagnostic);
});

test("failed production persistence keeps the settle diagnostic off the public response", async () => {
  const input = roomCInput();
  const settle = settleAfcFixedSeamCalibration({
    ...input,
    ratioSearch: { min: 0.5, max: 0.5, step: 0.1 },
    fovSearch: { minDeg: 80, maxDeg: 80, stepDeg: 1 },
  });
  const diagnostic = projectAfcV2SettleDecisionDiagnostic({
    settle,
    sourceNormalizedPolygon: input.sourceNormalizedPolygon,
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
  const sha = createHash("sha256").update(ORIGINAL_BYTES).digest("hex");
  const result = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
    original: {
      bytes: ORIGINAL_BYTES,
      identity: {
        sha256: sha,
        byteCount: ORIGINAL_BYTES.byteLength,
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
      settleDecision: diagnostic,
    } as AfcV2AnalyzeResult),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "AFC settle failed closed: no_apply_safe_candidate.");
  assert.equal("settleDecision" in result, false);
  assert.equal(JSON.stringify(result).includes(AFC_V2_SETTLE_DECISION_DIAGNOSTIC_SCHEMA_VERSION), false);
  const generation = await store.getGeneration(result.generationId ?? "");
  assert.equal(generation?.failureReason, "AFC settle failed closed: no_apply_safe_candidate.");
  assert.equal(generation?.metricStatus, "none");
  assert.equal(generation?.collisionStatus, "none");
  assert.equal(isAfcV2SettleDecisionRecordedV1(generation?.settleDecision), true);
  assert.deepEqual(generation?.settleDecision, diagnostic);
  const payload = generation?.diagnosticPayload as { analysisStatus?: string; reason?: string };
  assert.equal(payload.analysisStatus, "failed");
  assert.equal(payload.reason, "AFC settle failed closed: no_apply_safe_candidate.");
});
