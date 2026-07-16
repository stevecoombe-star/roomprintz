import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { AutoFloorCandidateGeometryScore, AutoFloorCandidateScoreBand } from "./auto-floor-scoring";
import type { QuadSolvabilityResult } from "./quad-solvability";
import type { AutoFloorSupportPoint } from "./auto-floor-support-types";
import { classifyAutoFloorSupport } from "./auto-floor-support-classification";
import { evaluateCalibratedCameraApply } from "./calibrated-camera-apply";
import { evaluateQuadSolvability } from "./quad-solvability";

// --- Deterministic fixtures (only the fields the classifier reads) ----------

function geometryScore(scoreBand: AutoFloorCandidateScoreBand): AutoFloorCandidateGeometryScore {
  return {
    candidateId: "test",
    scoreBand,
    score: scoreBand === "high" ? 0.9 : scoreBand === "medium" ? 0.6 : scoreBand === "low" ? 0.4 : 0,
    polygon: {
      ok: scoreBand !== "invalid",
      areaNorm: 0.1,
      convex: true,
      selfIntersecting: false,
      nearFarOrderingOk: true,
      skinnyRisk: false,
      notes: [],
    },
    cornerOrdering: { ok: true, confidence: "high", notes: [] },
    homography: { ok: true, notes: [] },
    overallNotes: [],
    risks: [],
  } as unknown as AutoFloorCandidateGeometryScore;
}

function solvability(options: {
  poseAvailable: boolean;
  perCornerResidualPx: (number | null)[] | null;
  applyAvailable?: boolean;
}): QuadSolvabilityResult {
  return {
    poseAvailable: options.poseAvailable,
    cv: {
      averagePx: null,
      maximumPx: null,
      perCornerResidualPx: options.perCornerResidualPx,
    },
    applyEvaluation: {
      available: options.applyAvailable ?? false,
      reason: options.applyAvailable ? "available" : "CV reprojection max is too high",
      firstFailingGate: options.applyAvailable ? "none" : "cv-max",
    },
  } as unknown as QuadSolvabilityResult;
}

// Clean centered quad in [NL, NR, FR, FL] order; no corner near the frame edge.
const CLEAN_QUAD: AutoFloorSupportPoint[] = [
  { x: 0.3, y: 0.85 },
  { x: 0.7, y: 0.85 },
  { x: 0.6, y: 0.5 },
  { x: 0.4, y: 0.5 },
];

test("strong geometry + available solver evidence -> directly_supported", () => {
  const result = classifyAutoFloorSupport({
    quadNorm: CLEAN_QUAD,
    geometryScore: geometryScore("high"),
    solvability: solvability({ poseAvailable: true, perCornerResidualPx: [1, 1.2, 0.8, 1.1], applyAvailable: true }),
  });
  assert.equal(result.supportClass, "directly_supported");
  assert.equal(result.underSupportTarget, null);
  assert.equal(result.corridorAvailable, false);
});

test("dominant worst corner -> under_support_suspected names that corner", () => {
  const result = classifyAutoFloorSupport({
    quadNorm: CLEAN_QUAD,
    // FR (index 2) clearly dominates.
    geometryScore: geometryScore("high"),
    solvability: solvability({ poseAvailable: true, perCornerResidualPx: [1, 1, 9, 1] }),
  });
  assert.equal(result.supportClass, "under_support_suspected");
  assert.deepEqual(result.underSupportTarget, { kind: "corner", corner: "FR" });
  assert.equal(result.corridorAvailable, false);
  assert.ok(result.reasons.some((reason) => /not proof of a physical floor-wall seam/i.test(reason)));
  // The corrected disclaimer must NOT deny the labels' near/far image-space meaning.
  assert.ok(result.reasons.every((reason) => !/no near\/rear|carry no near/i.test(reason)));
});

test("paired-corner pattern -> neutral corner_pair target only when defensible", () => {
  const result = classifyAutoFloorSupport({
    quadNorm: CLEAN_QUAD,
    // NL + NR jointly dominate the other pair. Reported as the detected pair
    // only — NO rear/near physical claim.
    geometryScore: geometryScore("high"),
    solvability: solvability({ poseAvailable: true, perCornerResidualPx: [8, 7, 1, 1] }),
  });
  assert.equal(result.supportClass, "under_support_suspected");
  assert.deepEqual(result.underSupportTarget, { kind: "corner_pair", corners: ["NL", "NR"] });
  assert.equal(result.corridorAvailable, false);
  // The neutral term must not reintroduce a physical "rear edge" claim. (A
  // disclaimer mentioning "near/rear physical meaning" is allowed and intended.)
  assert.ok(result.reasons.every((reason) => !/rear[ -]?edge/i.test(reason)));
});

test("non-defensible elevated pair does NOT fabricate a corner_pair target", () => {
  const result = classifyAutoFloorSupport({
    quadNorm: CLEAN_QUAD,
    // NL/NR elevated but FR is also high -> not a clean, defensible pair.
    geometryScore: geometryScore("high"),
    solvability: solvability({ poseAvailable: true, perCornerResidualPx: [7, 6, 4, 1] }),
  });
  // No dominant single corner and no defensible rear pair -> falls through to
  // directly_supported (conservative; never invents an under-support target).
  assert.equal(result.underSupportTarget, null);
  assert.equal(result.corridorAvailable, false);
});

test("invalid geometry -> insufficient_visual_evidence", () => {
  const result = classifyAutoFloorSupport({
    quadNorm: CLEAN_QUAD,
    geometryScore: geometryScore("invalid"),
    solvability: solvability({ poseAvailable: true, perCornerResidualPx: [1, 1, 1, 1] }),
  });
  assert.equal(result.supportClass, "insufficient_visual_evidence");
  assert.equal(result.underSupportTarget, null);
  assert.equal(result.corridorAvailable, false);
});

test("missing solver evidence -> insufficient_visual_evidence (cannot confirm direct support)", () => {
  const result = classifyAutoFloorSupport({
    quadNorm: CLEAN_QUAD,
    geometryScore: geometryScore("high"),
    solvability: null,
  });
  assert.equal(result.supportClass, "insufficient_visual_evidence");
  assert.equal(result.corridorAvailable, false);
});

test("frame-edge proximity is reported as geometry only, not truncation truth", () => {
  const edgeQuad: AutoFloorSupportPoint[] = [
    { x: 0.005, y: 0.85 }, // NL within the 1% frame-edge margin
    { x: 0.7, y: 0.85 },
    { x: 0.6, y: 0.5 },
    { x: 0.4, y: 0.5 },
  ];
  const result = classifyAutoFloorSupport({
    quadNorm: edgeQuad,
    geometryScore: geometryScore("high"),
    solvability: solvability({ poseAvailable: true, perCornerResidualPx: [1, 1, 1, 1], applyAvailable: true }),
  });
  assert.deepEqual(result.frameEdgeContacts, ["NL"]);
  // Frame-edge contact must NOT, on its own, drive an under-support verdict.
  assert.equal(result.supportClass, "directly_supported");
  assert.equal(result.corridorAvailable, false);
  assert.ok(
    result.reasons.some((reason) => /geometry only.*NOT truncation\/occlusion/i.test(reason)),
    "frame-edge reason must disclaim truncation/occlusion truth"
  );
});

test("every classification output guarantees corridorAvailable === false", () => {
  const scenarios = [
    { band: "high" as const, pose: true, residuals: [1, 1, 1, 1] },
    { band: "high" as const, pose: true, residuals: [1, 1, 9, 1] },
    { band: "high" as const, pose: true, residuals: [8, 7, 1, 1] },
    { band: "low" as const, pose: true, residuals: [1, 1, 1, 1] },
    { band: "medium" as const, pose: false, residuals: null },
    { band: "invalid" as const, pose: true, residuals: [1, 1, 1, 1] },
  ];
  for (const scenario of scenarios) {
    const result = classifyAutoFloorSupport({
      quadNorm: CLEAN_QUAD,
      geometryScore: geometryScore(scenario.band),
      solvability: solvability({ poseAvailable: scenario.pose, perCornerResidualPx: scenario.residuals }),
    });
    assert.equal(result.corridorAvailable, false);
  }
});

test("classifier imports no dashed/grid/UI/production/server modules", () => {
  const labDir = join(process.cwd(), "app", "admin", "3d-room-lab");
  const sources = ["auto-floor-support-classification.ts", "auto-floor-support-types.ts"].map((fileName) =>
    readFileSync(join(labDir, fileName), "utf8")
  );
  const allowedSpecifiers = new Set([
    "./quad-solvability",
    "./auto-floor-support-types",
    "./auto-floor-scoring",
  ]);
  for (const source of sources) {
    const importRegex = /import[\s\S]*?from\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(source)) !== null) {
      const specifier = match[1];
      assert.ok(specifier.startsWith("./"), `unexpected non-local import: ${specifier}`);
      assert.ok(!specifier.includes(".."), `import escapes the lab directory: ${specifier}`);
      assert.ok(allowedSpecifiers.has(specifier), `disallowed import specifier: ${specifier}`);
    }
  }
});

test("Phase 2N Apply evaluator behavior is unchanged (no-candidate gate)", () => {
  const evaluation = evaluateCalibratedCameraApply(null);
  assert.equal(evaluation.available, false);
  assert.equal(evaluation.firstFailingGate, "no-candidate");
  // The Phase 2N solvability evaluator remains a callable export.
  assert.equal(typeof evaluateQuadSolvability, "function");
});
