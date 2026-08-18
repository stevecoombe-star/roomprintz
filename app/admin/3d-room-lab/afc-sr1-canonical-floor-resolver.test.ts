import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type {
  AutoFloorCalibrationCandidate,
  AutoFloorDetectionResult,
} from "./auto-floor-detection";
import type { DetectFloorArgs } from "@/lib/vibodeAutoFloorVisionDetect";
import type { Vec2 } from "./perspective-solve";
import {
  resolveCanonicalAfcFloorFromEmpty,
} from "./afc-sr1-canonical-floor-resolver";

const bytes = Uint8Array.from([1, 2, 3, 4]);
const sha256 = createHash("sha256").update(bytes).digest("hex");

function input(overrides: Partial<{
  decodedWidth: number;
  decodedHeight: number;
}> = {}) {
  return {
    empty: {
      bytes,
      sha256,
      byteCount: bytes.byteLength,
      mimeType: "image/png" as const,
      decodedWidth: overrides.decodedWidth ?? 2000,
      decodedHeight: overrides.decodedHeight ?? 1000,
      orientation: 1 as const,
    },
    attemptId: "afc-resolver-test",
  };
}

function candidate(
  id: string,
  quadNorm: [Vec2, Vec2, Vec2, Vec2] = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.7, y: 0.5 },
  { x: 0.3, y: 0.5 },
] 
): AutoFloorCalibrationCandidate {
  return {
    id,
    label: id,
    source: "vision_model_direct" as const,
    confidence: "high" as const,
    confidenceScore: 0.9,
    quadNorm,
    notes: [],
    risks: [],
  };
}

function outcome(result: AutoFloorDetectionResult) {
  return async () => ({
    ok: true as const,
    result,
    meta: {
      finishReason: "STOP",
      candidatesTokenCount: null,
      thoughtsTokenCount: null,
    },
  });
}

const configured = {
  isEnabled: () => true,
  getApiKey: () => "test-key",
  getModel: () => "test-auto-floor-model",
  getTimeoutMs: () => 1_000,
};

test("resolver wraps one shared detector call with identity EMPTY geometry", async () => {
  const selected = candidate("vision-cand-1");
  let calls = 0;
  let detectorArgs: DetectFloorArgs | null = null;
  const result = await resolveCanonicalAfcFloorFromEmpty(input(), {
    ...configured,
    detect: async (args) => {
      calls += 1;
      detectorArgs = args;
      return outcome({
        status: "ok",
        candidates: [candidate("vision-cand-0"), selected],
        selectedCandidateId: selected.id,
        notes: [],
        failureReasons: [],
      })();
    },
  });
  assert.equal(calls, 1);
  assert.ok(detectorArgs);
  const args = detectorArgs as DetectFloorArgs;
  assert.deepEqual(args.sourceSize, { width: 2000, height: 1000 });
  assert.equal(args.frameSize, args.sourceSize);
  assert.equal(args.maxCandidates, 3);
  assert.equal(result.status, "selected");
  if (result.status !== "selected") return;
  assert.equal(result.selectedCandidateId, selected.id);
  assert.equal(result.selectedCandidateIndex, 1);
  assert.equal(result.candidateCount, 2);
  assert.deepEqual(result.polygon, selected.quadNorm);
  assert.deepEqual(result.emptyBasis, {
    sha256,
    decodedWidth: 2000,
    decodedHeight: 1000,
    orientation: 1,
  });
});

test("three candidates preserve the detector-selected highest non-invalid result", async () => {
  const selected = candidate("vision-cand-2");
  const result = await resolveCanonicalAfcFloorFromEmpty(input(), {
    ...configured,
    detect: outcome({
      status: "ok",
      candidates: [candidate("vision-cand-0"), candidate("vision-cand-1"), selected],
      selectedCandidateId: selected.id,
      notes: [],
      failureReasons: [],
    }),
  });
  assert.equal(result.status, "selected");
  if (result.status !== "selected") return;
  assert.equal(result.selectedCandidateId, "vision-cand-2");
  assert.equal(result.selectedCandidateIndex, 2);
  assert.equal(result.candidateCount, 3);
});

test("a structurally valid low-band needs_review candidate remains selected", async () => {
  const low = candidate("vision-cand-low", [
    { x: 0.45, y: 0.8 },
    { x: 0.55, y: 0.8 },
    { x: 0.54, y: 0.7 },
    { x: 0.46, y: 0.7 },
  ]);
  const result = await resolveCanonicalAfcFloorFromEmpty(input(), {
    ...configured,
    detect: outcome({
      status: "needs_review",
      candidates: [low],
      selectedCandidateId: low.id,
      notes: [],
      failureReasons: [],
    }),
  });
  assert.equal(result.status, "selected");
  if (result.status !== "selected") return;
  assert.equal(result.scoreBand, "low");
});

test("zero or all-invalid detector results fail closed without a fallback", async () => {
  const zero = await resolveCanonicalAfcFloorFromEmpty(input(), {
    ...configured,
    detect: outcome({
      status: "failed",
      candidates: [],
      selectedCandidateId: null,
      notes: [],
      failureReasons: ["none"],
    }),
  });
  assert.deepEqual(zero, { status: "failed", reason: "zero_candidates" });

  const allInvalid = await resolveCanonicalAfcFloorFromEmpty(input(), {
    ...configured,
    detect: outcome({
      status: "failed",
      candidates: [candidate("invalid", [
        { x: 0.4, y: 0.6 },
        { x: 0.6, y: 0.6 },
        { x: 0.5, y: 0.61 },
        { x: 0.5, y: 0.59 },
      ])],
      selectedCandidateId: null,
      notes: [],
      failureReasons: ["all invalid"],
    }),
  });
  assert.deepEqual(allInvalid, { status: "failed", reason: "all_geometry_invalid" });
});

test("configuration and provider failures use bounded resolver reasons", async () => {
  const disabled = await resolveCanonicalAfcFloorFromEmpty(input(), {
    ...configured,
    isEnabled: () => false,
  });
  assert.deepEqual(disabled, { status: "failed", reason: "detector_disabled" });

  const timeout = await resolveCanonicalAfcFloorFromEmpty(input(), {
    ...configured,
    detect: async () => ({
      ok: false as const,
      failureKind: "gemini" as const,
      info: {
        uiReason: "timeout",
        stage: "gemini_transport" as const,
        code: "GEMINI_TIMEOUT",
        httpStatus: null,
        upstreamStatus: null,
        sanitizedMessage: null,
        diagnostics: null,
        debugExcerpt: null,
      },
    }),
  });
  assert.deepEqual(timeout, { status: "failed", reason: "provider_timeout" });
});
