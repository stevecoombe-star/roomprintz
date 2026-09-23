import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ThreeRoomLab.tsx", import.meta.url),
  "utf8"
);

function deferredAfcApplySource(): string {
  const start = source.indexOf(
    "// AFC-SR1 Phase 2A deferred camera transaction."
  );
  const end = source.indexOf(
    "const objectProjectionDiagnostic",
    start
  );
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function callbackSource(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function lifecycleHarness() {
  const state: {
    generation: number;
    receipt: string | null;
    freezeStatus: "idle" | "freezing" | "ready";
  } = {
    generation: 1,
    receipt: "ready-receipt",
    freezeStatus: "ready",
  };
  return {
    state,
    beginFreeze() {
      state.generation += 1;
      state.freezeStatus = "freezing";
      return state.generation;
    },
    invalidate() {
      state.generation += 1;
      state.receipt = null;
      state.freezeStatus = "idle";
    },
    completeFreeze(generation: number, receipt: string) {
      if (generation !== state.generation) return;
      state.receipt = receipt;
      state.freezeStatus = "ready";
    },
  };
}

test("host freezes only after the established camera writer returns a snapshot", () => {
  const effect = deferredAfcApplySource();
  const apply = effect.indexOf(
    "const applied = applyCalibratedCameraSnapshotFromCandidate"
  );
  const snapshotRead = effect.indexOf(
    "const appliedSnapshot = applied"
  );
  const successGuard = effect.indexOf(
    "if (appliedSnapshot && liveResult)"
  );
  const freeze = effect.indexOf(
    "freezeAppliedTiledAfcCamera({"
  );
  assert.ok(apply >= 0);
  assert.ok(snapshotRead > apply);
  assert.ok(successGuard > snapshotRead);
  assert.ok(freeze > successGuard);
  assert.doesNotMatch(
    effect.slice(apply, freeze),
    /evaluateCalibratedCameraApply|evaluateQuadSolvability|settleAfcFixedSeamCalibration/
  );
});

test("host passes the exact applied snapshot and structured successful gates", () => {
  const effect = deferredAfcApplySource();
  const freezeStart = effect.indexOf(
    "freezeAppliedTiledAfcCamera({"
  );
  const freezeEnd = effect.indexOf(
    "}).then((freezeResult)",
    freezeStart
  );
  assert.ok(freezeStart >= 0 && freezeEnd > freezeStart);
  const call = effect.slice(freezeStart, freezeEnd);
  assert.match(call, /\bappliedSnapshot,/);
  assert.match(call, /\bliveResult,/);
  assert.match(call, /\bpending,/);
  assert.match(call, /settle: pending\.settle/);
  assert.match(call, /\bcandidate,/);
  assert.match(call, /candidateEvaluation: freshEvaluation/);
  assert.match(call, /basisQualificationStatus === "qualified"/);
});

test("camera writer exposes the same snapshot object installed in React state", () => {
  const start = source.indexOf(
    "const applyCalibratedCameraSnapshotFromCandidate"
  );
  const end = source.indexOf(
    "useEffect(() => {",
    start
  );
  assert.ok(start >= 0 && end > start);
  const writer = source.slice(start, end);
  assert.match(
    writer,
    /const snapshot: CalibratedCameraSnapshot = \{/
  );
  assert.match(
    writer,
    /calibratedCameraSnapshotRef\.current = snapshot/
  );
  assert.match(
    writer,
    /setCalibratedCameraSnapshot\(snapshot\)/
  );
  assert.match(writer, /return true/);
});

test("Original/load supersession clears ready state and rejects stale checksum completion", async () => {
  const helper = callbackSource(
    "const invalidateAfcCameraFreeze = useCallback",
    "const [perspectiveAdjustSession"
  );
  const generation = helper.indexOf(
    "afcCameraFreezeGenerationRef.current += 1"
  );
  const clearReceipt = helper.indexOf(
    "setAfcCameraFreezeReceipt(null)"
  );
  const clearStatus = helper.indexOf(
    'setAfcCameraFreezeStatus({ kind: "idle" })'
  );
  assert.ok(generation >= 0);
  assert.ok(clearReceipt > generation);
  assert.ok(clearStatus > clearReceipt);
  assert.doesNotMatch(helper, /afcCameraFreezeReceipt\./);

  const supersede = callbackSource(
    "const supersedeAfcLiveAttemptForLoadChange",
    "useEffect(() => () =>"
  );
  assert.match(
    supersede,
    /invalidateAfcCameraFreeze\(\)[\s\S]*setAfcLiveResult\(null\)/
  );

  const harness = lifecycleHarness();
  const staleGeneration = harness.beginFreeze();
  let resolveChecksum!: () => void;
  const checksum = new Promise<void>((resolve) => {
    resolveChecksum = resolve;
  }).then(() => {
    harness.completeFreeze(staleGeneration, "stale-receipt");
  });
  harness.invalidate();
  assert.equal(harness.state.generation, staleGeneration + 1);
  resolveChecksum();
  await checksum;
  assert.equal(harness.state.receipt, null);
  assert.equal(harness.state.freezeStatus, "idle");
});

test("failed AFC rerun cannot retain the prior ready receipt", () => {
  const handler = callbackSource(
    "const handleAnalyzeAndApplyLiveAfc",
    "const restorePerspectivePreviewToCommitted"
  );
  const invalidate = handler.indexOf(
    "invalidateAfcCameraFreeze()"
  );
  const attempt = handler.indexOf(
    "const attemptId ="
  );
  const transport = handler.indexOf(
    "await fetch("
  );
  assert.ok(invalidate >= 0);
  assert.ok(attempt > invalidate);
  assert.ok(transport > attempt);

  const harness = lifecycleHarness();
  harness.invalidate();
  // The failed AFC status is separate; no freeze-success callback ran.
  assert.equal(harness.state.receipt, null);
  assert.equal(harness.state.freezeStatus, "idle");
});

test("central calibrated-camera deactivation invalidates AFC export authority", () => {
  const deactivate = callbackSource(
    "const deactivateCalibratedCameraMode",
    "// Every authority-eligible runtime Floor mutation"
  );
  const invalidate = deactivate.indexOf(
    "invalidateAfcCameraFreeze()"
  );
  const deactivateCamera = deactivate.indexOf(
    "setIsCalibratedCameraActive(false)"
  );
  assert.ok(invalidate >= 0);
  assert.ok(deactivateCamera > invalidate);

  const harness = lifecycleHarness();
  harness.invalidate();
  assert.equal(harness.state.receipt, null);
  assert.equal(harness.state.freezeStatus, "idle");
});

test("every successful non-AFC camera replacement invalidates through the shared writer", () => {
  const writer = callbackSource(
    "const applyCalibratedCameraSnapshotFromCandidate",
    "useEffect(() => {"
  );
  const refusal = writer.indexOf("return false;");
  const invalidate = writer.indexOf(
    "invalidateAfcCameraFreeze()"
  );
  const snapshot = writer.indexOf(
    "const snapshot: CalibratedCameraSnapshot"
  );
  assert.ok(refusal >= 0);
  assert.ok(invalidate > refusal);
  assert.ok(snapshot > invalidate);
  assert.equal(
    source.match(/freezeAppliedTiledAfcCamera\(\{/g)?.length,
    1,
    "only the automatic AFC effect creates a replacement receipt"
  );
});

test("generation guard precedes all asynchronous receipt installation", () => {
  const effect = deferredAfcApplySource();
  const guard = effect.indexOf(
    "freezeGeneration !=="
  );
  const install = effect.indexOf(
    "setAfcCameraFreezeReceipt(freezeResult.value)"
  );
  const ready = effect.indexOf(
    'kind: "ready"',
    install
  );
  assert.ok(guard >= 0);
  assert.ok(install > guard);
  assert.ok(ready > install);
});

test("Perspective Adjust has no standalone freeze invalidation side effect", () => {
  const commit = callbackSource(
    "const commitPerspectiveAdjust",
    "const handlePerspectiveAdjustPreviewChange"
  );
  assert.doesNotMatch(commit, /invalidateAfcCameraFreeze/);
  assert.match(commit, /realizeAfcLabGeometry\(\{/);
});
