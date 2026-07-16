import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createEmptyManualFloorSupportAnnotation,
  type ManualFloorSupportAnnotation,
  type ManualPhysicalSeam,
} from "./manual-floor-support-types";
import {
  generateManualFloorSupportTrials,
  type TrialGenerationCandidate,
} from "./manual-floor-support-trial-generation";
import { evaluateManualFloorSupportTrialSet } from "./manual-floor-support-trial-evaluation";
import {
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./manual-floor-support-trial-geometry";
import type { TrialQuadNorm } from "./manual-floor-support-trial-types";

const INTRINSIC: ImageIntrinsicSize = { width: 1000, height: 1000 };
const FRAME: ImageFrameSize = { width: 1000, height: 1000 };

// Canonical [NL, NR, FR, FL], y-down (near corners have larger y).
function baselineQuad(): TrialQuadNorm {
  return [
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
    { x: 0.7, y: 0.3 },
    { x: 0.3, y: 0.3 },
  ];
}

function candidate(): TrialGenerationCandidate {
  return { id: "cand-1", quadNorm: baselineQuad() };
}

// Horizontal far seam at y = 0.3 spanning x in [0.2, 0.8] (600 source px).
function farSeam(y = 0.3): ManualPhysicalSeam {
  return {
    id: "seam-far",
    kind: "physical_floor_wall_seam",
    points: [
      { x: 0.2, y },
      { x: 0.8, y },
    ],
    usableSpan: { startVertexIndex: 0, endVertexIndex: 1 },
    corridor: { halfWidthSourcePx: 6 },
  };
}

function directAnnotation(
  overrides: Partial<ManualFloorSupportAnnotation> = {}
): ManualFloorSupportAnnotation {
  return { ...createEmptyManualFloorSupportAnnotation(), ...overrides };
}

function singleCornerAnnotation(
  span: { startT: number; endT: number },
  overrides: Partial<ManualFloorSupportAnnotation> = {}
): ManualFloorSupportAnnotation {
  return {
    ...createEmptyManualFloorSupportAnnotation(),
    seams: [farSeam()],
    mode: "single_corner_constrained",
    adjustmentAuthority: {
      kind: "single_corner",
      corner: "FL",
      seamId: "seam-far",
      allowedSpan: span,
    },
    ...overrides,
  };
}

function coupledAnnotation(
  flSpan: { startT: number; endT: number },
  frSpan: { startT: number; endT: number }
): ManualFloorSupportAnnotation {
  return {
    ...createEmptyManualFloorSupportAnnotation(),
    seams: [farSeam()],
    mode: "coupled_far_edge_constrained",
    adjustmentAuthority: {
      kind: "coupled_far_edge",
      corners: ["FL", "FR"],
      seamId: "seam-far",
      flAllowedSpan: flSpan,
      frAllowedSpan: frSpan,
      coupling: {
        preserveOrder: true,
        preserveEdgeDirection: true,
        maxRelativeAlongSeamDeltaSourcePx: 12,
      },
    },
  };
}

const FOV_SCAN = { minFovDeg: 20, maxFovDeg: 90, stepDeg: 1 };
const EVAL_CONTEXT = {
  frame: FRAME,
  floorDimensions: { worldWidth: 4, worldDepth: 3 },
  currentVerticalFovDeg: 55,
  fovScanConfig: FOV_SCAN,
};

// --- Tests ------------------------------------------------------------------

test("1. baseline quad is cloned and the input candidate is unchanged", () => {
  const cand = candidate();
  const snapshot = JSON.stringify(cand);
  const set = generateManualFloorSupportTrials({
    candidate: cand,
    annotation: singleCornerAnnotation({ startT: 0, endT: 0.4 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  });
  assert.ok(set);
  const baseline = set.trials[0];
  assert.equal(baseline.kind, "baseline");
  assert.deepEqual(baseline.quadNorm, cand.quadNorm);
  // Cloned, not aliased.
  assert.notEqual(baseline.quadNorm, cand.quadNorm);
  assert.notEqual(baseline.quadNorm[0], cand.quadNorm[0]);
  // Candidate object itself is untouched.
  assert.equal(JSON.stringify(cand), snapshot);
});

test("2. direct mode generates baseline only", () => {
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: directAnnotation(),
    intrinsic: INTRINSIC,
    frame: FRAME,
  });
  assert.ok(set);
  assert.equal(set.trials.length, 1);
  assert.equal(set.trials[0].kind, "baseline");
});

test("3. abstain generates no trial run (null)", () => {
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: directAnnotation({ mode: "abstain" }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  });
  assert.equal(set, null);
});

test("4. valid single-corner authority generates only permitted-corner trials", () => {
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: singleCornerAnnotation({ startT: 0, endT: 0.4 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  const movement = set.trials.filter((t) => t.kind !== "baseline");
  assert.ok(movement.length > 0);
  for (const trial of movement) {
    assert.equal(trial.kind, "single_corner");
    assert.deepEqual(trial.changedCorners, ["FL"]);
  }
});

test("5. weak support state + valid seam authority still allows constrained trials", () => {
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: singleCornerAnnotation(
      { startT: 0, endT: 0.4 },
      { cornerSupport: { FL: { state: "uncertain", linkedSeamId: "seam-far" } } }
    ),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  const movement = set.trials.filter((t) => t.kind !== "baseline");
  assert.ok(movement.length > 0);
  assert.ok(movement.some((t) => t.constraint.canEvaluate));
});

test("6. weak support WITHOUT seam authority produces baseline-only behavior", () => {
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: directAnnotation({
      cornerSupport: { FL: { state: "uncertain" } },
    }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  assert.equal(set.trials.length, 1);
  assert.equal(set.trials[0].kind, "baseline");
});

test("7. single-corner fixed corners remain byte-identical to baseline", () => {
  const cand = candidate();
  const set = generateManualFloorSupportTrials({
    candidate: cand,
    annotation: singleCornerAnnotation({ startT: 0, endT: 0.4 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  for (const trial of set.trials.filter((t) => t.kind !== "baseline")) {
    assert.deepEqual(trial.quadNorm[0], cand.quadNorm[0]); // NL
    assert.deepEqual(trial.quadNorm[1], cand.quadNorm[1]); // NR
    assert.deepEqual(trial.quadNorm[2], cand.quadNorm[2]); // FR
  }
});

test("8. coupled mode only moves FL and FR", () => {
  const cand = candidate();
  const set = generateManualFloorSupportTrials({
    candidate: cand,
    annotation: coupledAnnotation({ startT: 0, endT: 0.5 }, { startT: 0.5, endT: 1.0 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  const movement = set.trials.filter((t) => t.kind !== "baseline");
  assert.ok(movement.length > 0);
  for (const trial of movement) {
    assert.deepEqual(trial.changedCorners, ["FL", "FR"]);
    assert.deepEqual(trial.quadNorm[0], cand.quadNorm[0]); // NL
    assert.deepEqual(trial.quadNorm[1], cand.quadNorm[1]); // NR
  }
});

test("9. coupled anchors derive from nearest baseline seam projection", () => {
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: coupledAnnotation({ startT: 0, endT: 0.5 }, { startT: 0.5, endT: 1.0 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  const zeroDelta = set.trials.find(
    (t) => t.kind === "coupled_far_edge" && Math.abs(t.generation.sharedDeltaSourcePx ?? 1) < 1e-9
  );
  assert.ok(zeroDelta, "expected a zero-shared-delta sample");
  // At zero shared delta the anchors are the baseline nearest-seam projections.
  assert.ok(Math.abs(zeroDelta.quadNorm[3].x - 0.3) < 1e-6); // FL
  assert.ok(Math.abs(zeroDelta.quadNorm[2].x - 0.7) < 1e-6); // FR
});

test("10. collapsed coupled anchors reject the coupled run (baseline preserved)", () => {
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: coupledAnnotation({ startT: 0.5, endT: 0.5 }, { startT: 0.5, endT: 0.5 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  assert.equal(set.trials.length, 1);
  assert.equal(set.trials[0].kind, "baseline");
  assert.ok(set.notes.some((n) => /collapse|separation/i.test(n)));
});

test("11+12. shared-delta interval intersection is used; no independent endpoint clamping", () => {
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: coupledAnnotation({ startT: 0, endT: 0.5 }, { startT: 0.5, endT: 1.0 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  const coupled = set.trials.filter((t) => t.kind === "coupled_far_edge");
  assert.ok(coupled.length > 0);
  // A genuine shared longitudinal delta preserves FR.x - FL.x exactly. If FL/FR
  // were clamped independently the separation would change at a span boundary.
  for (const trial of coupled) {
    const separation = trial.quadNorm[2].x - trial.quadNorm[3].x; // FR.x - FL.x
    assert.ok(Math.abs(separation - 0.4) < 1e-6, `separation drifted: ${separation}`);
  }
  // The shared interval is limited by FR's span (delta in [-100, +100] px). At the
  // max shared delta FL lands at x=0.4 (arc 200/600), NOT clamped to its own span
  // boundary x=0.5 (arc 300/600).
  const maxDelta = coupled.reduce(
    (acc, t) => Math.max(acc, t.generation.sharedDeltaSourcePx ?? -Infinity),
    -Infinity
  );
  assert.ok(Math.abs(maxDelta - 100) < 1e-6, `unexpected max shared delta: ${maxDelta}`);
  const maxTrial = coupled.find((t) => Math.abs((t.generation.sharedDeltaSourcePx ?? 0) - 100) < 1e-6)!;
  assert.ok(Math.abs(maxTrial.quadNorm[3].x - 0.4) < 1e-6); // FL not clamped to 0.5
});

test("13. trial generation is deterministic", () => {
  const ann = singleCornerAnnotation({ startT: 0, endT: 0.4 });
  const a = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: ann,
    intrinsic: INTRINSIC,
    frame: FRAME,
  });
  const b = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: ann,
    intrinsic: INTRINSIC,
    frame: FRAME,
  });
  assert.deepEqual(a, b);
});

test("14. trial count is capped (baseline + at most 7 samples)", () => {
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: singleCornerAnnotation({ startT: 0, endT: 1.0 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  assert.ok(set.trials.length <= 8);
  const movement = set.trials.filter((t) => t.kind !== "baseline");
  assert.ok(movement.length <= 7);
  assert.equal(set.truncated, true);
});

test("15+19. off-frame samples hard-reject before solver, and never reach the solver wrapper", () => {
  const shortFrame: ImageFrameSize = { width: 1000, height: 400 };
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: singleCornerAnnotation({ startT: 0, endT: 0.4 }, { seams: [farSeam(0.1)] }),
    intrinsic: INTRINSIC,
    frame: shortFrame,
  })!;
  const movement = set.trials.filter((t) => t.kind !== "baseline");
  assert.ok(movement.length > 0);
  for (const trial of movement) {
    assert.equal(trial.constraint.canEvaluate, false);
    assert.ok(trial.constraint.hardReasons.some((r) => /off-frame/.test(r)));
  }
  const evaluated = evaluateManualFloorSupportTrialSet(set, {
    ...EVAL_CONTEXT,
    frame: shortFrame,
  });
  for (const trial of evaluated.trials.filter((t) => t.kind !== "baseline")) {
    assert.equal(trial.solver, null);
  }
});

test("16. near-edge inside-frame samples warn but remain evaluable", () => {
  const nearEdgeFrame: ImageFrameSize = { width: 1000, height: 420 };
  const set = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: singleCornerAnnotation({ startT: 0, endT: 0.4 }, { seams: [farSeam(0.293)] }),
    intrinsic: INTRINSIC,
    frame: nearEdgeFrame,
  })!;
  const movement = set.trials.filter((t) => t.kind !== "baseline");
  assert.ok(movement.length > 0);
  assert.ok(
    movement.some(
      (t) => t.constraint.canEvaluate && t.constraint.warnings.some((w) => /near frame edge/.test(w))
    )
  );
});

test("17. corridor/span sampling operates in source-image pixel space (density)", () => {
  // Same span fraction but a longer seam (more source px) yields more samples.
  const shortSeam = farSeam(); // 600 px, span 0..0.4 -> 240px
  const longSeam: ManualPhysicalSeam = {
    ...farSeam(),
    points: [
      { x: 0.0, y: 0.3 },
      { x: 1.0, y: 0.3 },
    ],
  }; // 1000 px, span 0..0.4 -> 400px
  const shortSet = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: singleCornerAnnotation({ startT: 0, endT: 0.4 }, { seams: [shortSeam] }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  const longSet = generateManualFloorSupportTrials({
    candidate: candidate(),
    annotation: singleCornerAnnotation({ startT: 0, endT: 0.4 }, { seams: [longSeam] }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  const shortCount = shortSet.trials.filter((t) => t.kind !== "baseline").length;
  const longCount = longSet.trials.filter((t) => t.kind !== "baseline").length;
  assert.ok(longCount > shortCount, `${longCount} !> ${shortCount}`);
});

test("18. degenerate / inverted candidate quad input is rejected (null)", () => {
  const degenerate: TrialGenerationCandidate = {
    id: "bad",
    quadNorm: [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ],
  };
  // Out-of-range corner -> isFiniteQuadInUnitRange fails -> null.
  const outOfRange: TrialGenerationCandidate = {
    id: "oor",
    quadNorm: [
      { x: 1.5, y: 0.8 },
      { x: 0.8, y: 0.8 },
      { x: 0.7, y: 0.3 },
      { x: 0.3, y: 0.3 },
    ],
  };
  assert.equal(
    generateManualFloorSupportTrials({
      candidate: outOfRange,
      annotation: directAnnotation(),
      intrinsic: INTRINSIC,
      frame: FRAME,
    }),
    null
  );
  // A degenerate (zero-area) baseline still produces a baseline record whose
  // constraint is hard-rejected (so it is preserved but not solver-eligible).
  const set = generateManualFloorSupportTrials({
    candidate: degenerate,
    annotation: directAnnotation(),
    intrinsic: INTRINSIC,
    frame: FRAME,
  });
  // degenerate has duplicate points -> isFiniteQuadInUnitRange passes (in range)
  // but the baseline gate rejects it.
  assert.ok(set);
  assert.equal(set.trials[0].constraint.canEvaluate, false);
});

test("20. generation module does not import the solver", () => {
  const source = readFileSync(
    join(process.cwd(), "app", "admin", "3d-room-lab", "manual-floor-support-trial-generation.ts"),
    "utf8"
  );
  assert.ok(
    !/from\s+["'][^"']*quad-solvability[^"']*["']/.test(source),
    "generation must not import quad-solvability"
  );
});

test("21. trial modules never import forbidden live-state / apply / scene modules", () => {
  const labDir = join(process.cwd(), "app", "admin", "3d-room-lab");
  const moduleAllow: Record<string, Set<string>> = {
    "manual-floor-support-trial-types.ts": new Set(["./manual-floor-support-types"]),
    "manual-floor-support-trial-geometry.ts": new Set([
      "./image-space",
      "./manual-floor-support-types",
      "./perspective-solve",
      "./manual-floor-support-trial-types",
    ]),
    "manual-floor-support-trial-generation.ts": new Set([
      "./manual-floor-support-types",
      "./manual-floor-support-validation",
      "./manual-floor-support-trial-geometry",
      "./manual-floor-support-trial-types",
    ]),
    "manual-floor-support-trial-evaluation.ts": new Set([
      "./quad-solvability",
      "./image-space",
      "./manual-floor-support-trial-types",
    ]),
  };
  const forbiddenSubstrings = [
    "scene-state",
    "calibrated-camera-apply",
    "auto-floor-detection",
    "auto-floor-scoring",
    "snapshot",
  ];
  for (const [fileName, allow] of Object.entries(moduleAllow)) {
    const source = readFileSync(join(labDir, fileName), "utf8");
    const importRegex = /import[\s\S]*?from\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(source)) !== null) {
      const specifier = match[1];
      assert.ok(allow.has(specifier), `${fileName}: disallowed import "${specifier}"`);
    }
    for (const forbidden of forbiddenSubstrings) {
      assert.ok(
        !new RegExp(`from\\s+["'][^"']*${forbidden}[^"']*["']`).test(source),
        `${fileName} must not import ${forbidden}`
      );
    }
    // No live-state setters / React hooks / apply handlers.
    for (const banned of ["setFloorPolygon", "applyCalibrated", "useState", "useEffect", "Promote"]) {
      assert.ok(!source.includes(banned), `${fileName} must not reference ${banned}`);
    }
  }
});

test("22. candidate, FOV, and floor inputs are not mutated by generation", () => {
  const cand = candidate();
  const candSnapshot = JSON.stringify(cand);
  const ctxSnapshot = JSON.stringify(EVAL_CONTEXT);
  const set = generateManualFloorSupportTrials({
    candidate: cand,
    annotation: coupledAnnotation({ startT: 0, endT: 0.5 }, { startT: 0.5, endT: 1.0 }),
    intrinsic: INTRINSIC,
    frame: FRAME,
  })!;
  evaluateManualFloorSupportTrialSet(set, EVAL_CONTEXT);
  assert.equal(JSON.stringify(cand), candSnapshot);
  assert.equal(JSON.stringify(EVAL_CONTEXT), ctxSnapshot);
});
