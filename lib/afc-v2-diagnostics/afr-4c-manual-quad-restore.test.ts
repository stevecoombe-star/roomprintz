import assert from "node:assert/strict";
import test from "node:test";

import { createPi3aAuthority } from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import { AFC_V2_REFERENCE_DEPTH_M } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import {
  handleManualPerspectiveGet,
  type ManualPerspectiveGenerationRow,
  type ManualPerspectiveStore,
} from "./manual-perspective.server";
import { afcQaAccessConfig } from "./qa-access";
import {
  buildManualPerspectiveRecord,
  editManualPerspectivePoint,
  openManualPerspectiveBootstrapSession,
  revertManualPerspectiveSession,
  selectLatestManualRecoveryQuad,
  type ManualRecoveryQuadCandidate,
} from "./manual-perspective";
import {
  imagePointsEqual,
  MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD,
  type ManualPerspectiveImagePoints,
  manualPerspectiveBootstrapQuad,
  quadFromImagePoints,
} from "./manual-perspective-geometry";
import { solveManualPerspectiveCalibration } from "./manual-perspective-solve";

const SOURCE = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const CASE_ID = "44444444-4444-4444-8444-444444444444";
const FRAME = { width: 1200, height: 800 };

const QUAD_A: ManualPerspectiveImagePoints = {
  NL: { x: 0.1, y: 0.9 },
  NR: { x: 0.9, y: 0.9 },
  FR: { x: 0.65, y: 0.55 },
  FL: { x: 0.35, y: 0.55 },
};
const QUAD_B: ManualPerspectiveImagePoints = {
  NL: { x: 0.12, y: 0.88 },
  NR: { x: 0.88, y: 0.88 },
  FR: { x: 0.62, y: 0.52 },
  FL: { x: 0.38, y: 0.52 },
};

function provenance(
  points: ManualPerspectiveImagePoints | null,
  recoveredAt: string,
  sourceGenerationId = SOURCE,
  intent = "manual_perspective_recovery",
) {
  return {
    recoveryIntent: intent,
    sourceGenerationId,
    recoveredAt,
    ...(points ? { appliedSourceQuad: quadFromImagePoints(points) } : {}),
  };
}

function attempt(
  generationId: string,
  lineageSeq: number,
  recoveryProvenance: unknown,
): ManualRecoveryQuadCandidate {
  return { generationId, lineageSeq, recoveryProvenance };
}

function failedRow(manualPerspective: unknown = null): ManualPerspectiveGenerationRow {
  return {
    id: SOURCE,
    roomId: ROOM,
    userId: USER,
    status: "failed",
    frameWidth: FRAME.width,
    frameHeight: FRAME.height,
    originalDecodedWidth: FRAME.width,
    originalDecodedHeight: FRAME.height,
    productionAuthority: null,
    settleDecision: { marker: "failed-settle" },
    cameraRealizability: { marker: "failed-camera" },
    artifactLineage: { marker: "failed-lineage" },
    manualPerspective,
  };
}

function store(
  generation: ManualPerspectiveGenerationRow,
  attempts: readonly ManualRecoveryQuadCandidate[] = [],
): ManualPerspectiveStore & { saves: number; listed: number } {
  return {
    saves: 0,
    listed: 0,
    async loadGeneration() {
      return generation;
    },
    async saveManualPerspective() {
      this.saves += 1;
    },
    async listRecoveryAttempts() {
      this.listed += 1;
      return attempts;
    },
  };
}

async function readBootstrap(memory: ManualPerspectiveStore) {
  const response = await handleManualPerspectiveGet({
    request: new Request("http://local/manual"),
    caseId: CASE_ID,
    generationId: SOURCE,
    dependencies: {
      authorize: async () => ({
        ok: true,
        admin: { userId: USER, email: "qa@example.com" },
      }),
      store: memory,
      qaAccess: afcQaAccessConfig(true, USER),
    },
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("a failed source with no recovery child opens the default trapezoid", async () => {
  const memory = store(failedRow());
  const body = await readBootstrap(memory);
  assert.equal(body.automatic, null);
  assert.equal(body.applied, null);
  assert.equal(body.bootstrap.restoredFromRecovery, false);
  assert.equal(body.bootstrap.imagePoints.NL.x, MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD.NL.x);
  assert.equal(body.bootstrap.imagePoints.NR.x, MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD.NR.x);
  assert.equal(memory.saves, 0);
  assert.equal(memory.listed, 1);
});

test("a recovery applied quad restores the failed source editor", async () => {
  const memory = store(failedRow(), [
    attempt("55555555-5555-4555-8555-555555555555", 4, provenance(QUAD_A, "2026-09-30T18:00:00.000Z")),
  ]);
  const body = await readBootstrap(memory);
  assert.equal(body.bootstrap.restoredFromRecovery, true);
  assert.equal(body.automatic, null);
  assert.equal(imagePointsEqual(body.bootstrap.imagePoints, QUAD_A), true);
  assert.equal(memory.saves, 0);
  assert.equal(failedRow().productionAuthority, null);
});

test("the highest lineage recovery quad wins, including a later failed attempt", () => {
  const selected = selectLatestManualRecoveryQuad(SOURCE, [
    attempt("66666666-6666-4666-8666-666666666666", 3, provenance(QUAD_A, "2026-09-30T19:00:00.000Z")),
    attempt("77777777-7777-4777-8777-777777777777", 8, provenance(QUAD_B, "2026-09-30T18:00:00.000Z")),
    attempt("88888888-8888-4888-8888-888888888888", 9, {
      recoveryIntent: "manual_perspective_recovery",
      sourceGenerationId: SOURCE,
      recoveredAt: "2026-09-30T20:00:00.000Z",
      appliedSourceQuad: [{ x: 2, y: 0.9 }, { x: 0.9, y: 0.9 }, { x: 0.65, y: 0.55 }, { x: 0.35, y: 0.55 }],
    }),
    attempt("99999999-9999-4999-8999-999999999999", 2, provenance(QUAD_A, "2026-09-30T21:00:00.000Z", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),
    attempt("abababab-abab-4aba-8aba-abababababab", 1, {
      recoveryIntent: "other",
      sourceGenerationId: SOURCE,
      appliedSourceQuad: quadFromImagePoints(QUAD_B),
    }),
  ]);
  assert.ok(selected);
  assert.equal(imagePointsEqual(selected, QUAD_B), true);
});

test("equal lineage uses the later recovered timestamp", () => {
  const selected = selectLatestManualRecoveryQuad(SOURCE, [
    attempt("66666666-6666-4666-8666-666666666666", 5, provenance(QUAD_A, "2026-09-30T18:00:00.000Z")),
    attempt("77777777-7777-4777-8777-777777777777", 5, provenance(QUAD_B, "2026-09-30T18:05:00.000Z")),
  ]);
  assert.ok(selected);
  assert.equal(imagePointsEqual(selected, QUAD_B), true);
});

test("malformed recovery provenance falls through to the default trapezoid", async () => {
  const memory = store(failedRow(), [
    attempt("55555555-5555-4555-8555-555555555555", 6, {
      recoveryIntent: "manual_perspective_recovery",
      sourceGenerationId: SOURCE,
      appliedSourceQuad: [{ x: 0.1, y: 0.9 }],
    }),
    attempt("66666666-6666-4666-8666-666666666666", 7, {
      recoveryIntent: "manual_perspective_recovery",
      sourceGenerationId: SOURCE,
    }),
  ]);
  const body = await readBootstrap(memory);
  assert.equal(body.bootstrap.restoredFromRecovery, false);
  assert.equal(body.bootstrap.imagePoints.NL.x, MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD.NL.x);
});

test("a saved source manual record stays ahead of recovery provenance", async () => {
  const solution = solveManualPerspectiveCalibration({
    imagePoints: QUAD_A,
    sourceImageSize: FRAME,
    frameSize: FRAME,
    referenceDepthM: AFC_V2_REFERENCE_DEPTH_M,
  });
  const record = buildManualPerspectiveRecord({
    generationId: SOURCE,
    referenceDepthM: AFC_V2_REFERENCE_DEPTH_M,
    origin: "manual_quad_bootstrap",
    originalPoints: null,
    initialBootstrapPoints: manualPerspectiveBootstrapQuad(),
    solution,
    appliedAt: "2026-09-30T17:00:00.000Z",
  });
  assert.ok(record);
  const memory = store(failedRow(record), [
    attempt("55555555-5555-4555-8555-555555555555", 9, provenance(QUAD_B, "2026-09-30T18:00:00.000Z")),
  ]);
  const body = await readBootstrap(memory);
  assert.equal(body.bootstrap.restoredFromRecovery, false);
  assert.equal(body.bootstrap.imagePoints.NL.x, MANUAL_PERSPECTIVE_BOOTSTRAP_QUAD.NL.x);
  assert.equal(body.applied.adjustedSourceQuad[0].x, QUAD_A.NL.x);
  assert.equal(memory.listed, 0);
});

test("revert uses the restored recovery quad as the session baseline", () => {
  const session = openManualPerspectiveBootstrapSession({
    generationId: SOURCE,
    imagePoints: QUAD_A,
    referenceDepthM: AFC_V2_REFERENCE_DEPTH_M,
    sourceImageSize: FRAME,
    frameSize: FRAME,
    runtime: "diagnostic_only",
    restoredFromRecovery: true,
  }, null);
  assert.equal(imagePointsEqual(session.imagePoints, QUAD_A), true);
  assert.equal(imagePointsEqual(session.openedPoints, QUAD_A), true);
  const edited = editManualPerspectivePoint(session, "NL", 0.2, 0.86);
  assert.equal(edited.imagePoints.NL.x, 0.2);
  const reverted = revertManualPerspectiveSession(edited);
  assert.equal(imagePointsEqual(reverted.imagePoints, QUAD_A), true);
});

test("a ready generation with an automatic quad does not read recovery provenance", async () => {
  const generation: ManualPerspectiveGenerationRow = {
    ...failedRow(),
    status: "ready",
    productionAuthority: createPi3aAuthority({ generationId: SOURCE }),
  };
  const memory = store(generation, [
    attempt("55555555-5555-4555-8555-555555555555", 4, provenance(QUAD_A, "2026-09-30T18:00:00.000Z")),
  ]);
  const body = await readBootstrap(memory);
  assert.ok(body.automatic);
  assert.equal(body.bootstrap, null);
  assert.equal(memory.listed, 0);
});
