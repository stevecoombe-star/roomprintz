import assert from "node:assert/strict";
import test from "node:test";

import type { ImageFrameSize, ImageIntrinsicSize } from "./image-space";
import {
  createDefaultCoupledSearchConfig,
  TYPE_A_COUPLED_SEARCH_SET_SCHEMA,
  type CoupledSearchPrimaryState,
  type CoupledSearchResultSet,
  type CoupledSearchTrial,
} from "./manual-floor-support-coupled-search-types";
import { qualifyTypeASupport } from "./manual-floor-support-qualification";
import type { QualifyTypeASupportInput } from "./manual-floor-support-qualification-types";
import {
  createEmptyManualFloorSupportAnnotation,
  MANUAL_FLOOR_SUPPORT_ANNOTATION_SCHEMA,
  type ManualFloorSupportAnnotation,
  type ManualPhysicalSeam,
} from "./manual-floor-support-types";

// Square 1000x1000 intrinsic => source-pixel arc length = 1000 * source-norm
// distance, so spans below are exact and predictable.
const INTRINSIC: ImageIntrinsicSize = { width: 1000, height: 1000 };
const FRAME: ImageFrameSize = { width: 1000, height: 1000 };

function seam(id: string, points: { x: number; y: number }[]): ManualPhysicalSeam {
  return {
    id,
    kind: "physical_floor_wall_seam",
    points,
    usableSpan: { startVertexIndex: 0, endVertexIndex: points.length - 1 },
    corridor: { halfWidthSourcePx: 6 },
  };
}

// Long interior movable seam (~701 px).
function movableSeamLong(): ManualPhysicalSeam {
  return seam("seam-move", [
    { x: 0.2, y: 0.85 },
    { x: 0.25, y: 0.15 },
  ]);
}

// Long interior determining seam (~700 px), endpoints well inside the frame.
function determiningHealthy(): ManualPhysicalSeam {
  return seam("seam-det", [
    { x: 0.8, y: 0.85 },
    { x: 0.78, y: 0.15 },
  ]);
}

// Short interior determining seam (~50 px), endpoints interior.
function determiningShortInterior(): ManualPhysicalSeam {
  return seam("seam-det", [
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.55 },
  ]);
}

// Frame-edge-collapsed determining seam (~90 px) with one endpoint ~5 px from
// the left source-frame edge (mirrors the difficult-room FR->NR fixture).
function determiningCollapsed(): ManualPhysicalSeam {
  return seam("seam-det", [
    { x: 0.995, y: 0.5 },
    { x: 0.905, y: 0.5 },
  ]);
}

// Structurally tiny determining seam (~10 px) — below the usable floor.
function determiningTiny(): ManualPhysicalSeam {
  return seam("seam-det", [
    { x: 0.5, y: 0.5 },
    { x: 0.51, y: 0.5 },
  ]);
}

function typeAAnnotation(opts: {
  movableSeam?: ManualPhysicalSeam;
  determiningSeam: ManualPhysicalSeam;
  movableCorner?: "NL" | "NR";
  determiningRole?: "rear_floor_wall_edge" | "other_visible_floor_boundary";
}): ManualFloorSupportAnnotation {
  const move = opts.movableSeam ?? movableSeamLong();
  const det = opts.determiningSeam;
  const corner = opts.movableCorner ?? "NL";
  return {
    schema: MANUAL_FLOOR_SUPPORT_ANNOTATION_SCHEMA,
    seams: [move, det],
    cornerSupport: {
      NL: { state: "frame_truncated" },
      NR: { state: "frame_truncated" },
      FL: { state: "trustworthy" },
      FR: { state: "trustworthy" },
    },
    mode: "single_corner_constrained",
    adjustmentAuthority: {
      kind: "single_corner",
      corner,
      seamId: move.id,
      allowedSpan: { startT: 0, endT: 1 },
    },
    determiningEdge: {
      seamId: det.id,
      role: opts.determiningRole ?? "other_visible_floor_boundary",
      intendedCanonicalSupport: ["NR", "FR"],
    },
  };
}

function coupledTrial(
  state: CoupledSearchPrimaryState,
  highConfidence = false
): CoupledSearchTrial {
  return {
    trialId: `t-${state}`,
    sourceCandidateId: "cand-1",
    movableCorner: "NL",
    seamId: "seam-move",
    tuple: { tNear: 0.5, aspectRatio: 1, fovDeg: null },
    worldWidth: 1,
    worldDepth: 1,
    quadNorm: [
      { x: 0.2, y: 0.8 },
      { x: 0.8, y: 0.8 },
      { x: 0.7, y: 0.3 },
      { x: 0.3, y: 0.3 },
    ],
    changedCorners: [],
    sampledCornerMoves: [],
    constraint: { canEvaluate: true, hardReasons: [], warnings: [] },
    state,
    solver: null,
    fovCorridors: { valid: null, highConfidence: highConfidence ? [[34, 42]] : null },
    generation: { tIndex: 0, aspectIndex: 0 },
    provenance: "diagnostic_trial_only",
  };
}

function broadSearch(
  trials: CoupledSearchTrial[],
  truncated = false
): CoupledSearchResultSet {
  return {
    schema: TYPE_A_COUPLED_SEARCH_SET_SCHEMA,
    sourceCandidateId: "cand-1",
    movableCorner: "NL",
    seamId: "seam-move",
    config: createDefaultCoupledSearchConfig(),
    generatedFor: { mode: "single_corner_constrained", corner: "NL" },
    trials,
    truncated,
    notes: [],
  };
}

// Exhausted run mirroring the difficult room: 54 no_pose + 9 invalid_geometry,
// no high-confidence corridor, 0 apply-safe.
function exhaustedTrials(): CoupledSearchTrial[] {
  const arr: CoupledSearchTrial[] = [];
  for (let i = 0; i < 54; i += 1) arr.push(coupledTrial("no_pose"));
  for (let i = 0; i < 9; i += 1) arr.push(coupledTrial("invalid_geometry"));
  return arr;
}

function baseInput(overrides: Partial<QualifyTypeASupportInput>): QualifyTypeASupportInput {
  return {
    annotation: null,
    candidateQuadNorm: null,
    intrinsicSize: INTRINSIC,
    frameSize: FRAME,
    broadSearch: null,
    broadSearchEvidenceSignature: null,
    currentEvidenceSignature: null,
    localSeedEligible: null,
    ...overrides,
  };
}

// --- 1. qualification_not_run ------------------------------------------------

test("1a: null annotation => qualification_not_run", () => {
  const out = qualifyTypeASupport(baseInput({ annotation: null }));
  assert.equal(out.classification, "qualification_not_run");
  assert.equal(out.exhaustion, null);
});

test("1b: structurally empty annotation => qualification_not_run (not insufficient)", () => {
  const out = qualifyTypeASupport(
    baseInput({ annotation: createEmptyManualFloorSupportAnnotation() })
  );
  assert.equal(out.classification, "qualification_not_run");
});

// --- 2. insufficient_support_or_unknown -------------------------------------

test("2a: invalid annotation (determining edge references missing seam) => insufficient", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningHealthy() });
  ann.determiningEdge = {
    seamId: "does-not-exist",
    role: "other_visible_floor_boundary",
    intendedCanonicalSupport: ["FR"],
  };
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.classification, "insufficient_support_or_unknown");
  assert.equal(out.facts.annotationValid, false);
});

test("2b: missing determining edge => insufficient", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningHealthy() });
  ann.determiningEdge = null;
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.classification, "insufficient_support_or_unknown");
  assert.equal(out.facts.annotationValid, true);
});

test("2c: missing / invalid intrinsic size => insufficient", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningHealthy() });
  const out = qualifyTypeASupport(baseInput({ annotation: ann, intrinsicSize: null }));
  assert.equal(out.classification, "insufficient_support_or_unknown");
});

test("2d: not a valid Type A single-corner config => insufficient", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningHealthy() });
  ann.mode = "direct";
  ann.adjustmentAuthority = { kind: "none" };
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.classification, "insufficient_support_or_unknown");
});

test("2e: structurally tiny determining span => insufficient", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningTiny() });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.classification, "insufficient_support_or_unknown");
  assert.ok((out.facts.determiningSideSpanSourcePx ?? 0) < 24);
});

// --- 3. type_a_strong_support -----------------------------------------------

test("3: healthy interior determining seam, no broad search => strong support", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningHealthy() });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.classification, "type_a_strong_support");
  assert.deepEqual(out.weakSupportIndicators, []);
  assert.equal(out.exhaustion, null);
  assert.equal(out.facts.determiningSeamFrameEdgeCollapsed, false);
  assert.ok((out.facts.determiningSideSpanSourcePx ?? 0) > 600);
});

// --- 4. type_a_weak_support -------------------------------------------------

test("4a: short-but-interior determining seam => weak support", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningShortInterior() });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.classification, "type_a_weak_support");
  assert.equal(out.facts.determiningSeamFrameEdgeCollapsed, false);
  assert.ok(out.weakSupportIndicators.includes("short_determining_span_absolute"));
});

test("4b: severe span imbalance alone => weak support", () => {
  const ann = typeAAnnotation({
    movableSeam: seam("seam-move", [
      { x: 0.1, y: 0.95 },
      { x: 0.1, y: 0.05 },
    ]),
    determiningSeam: seam("seam-det", [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.63 },
    ]),
  });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.classification, "type_a_weak_support");
  assert.deepEqual(out.weakSupportIndicators, [
    "severe_determining_to_movable_span_imbalance",
  ]);
});

test("4c: near-frame endpoint without collapse => weak support (not collapsed)", () => {
  const ann = typeAAnnotation({
    determiningSeam: seam("seam-det", [
      { x: 0.995, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ]),
  });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.classification, "type_a_weak_support");
  assert.equal(out.facts.determiningSeamFrameEdgeCollapsed, false);
  assert.deepEqual(out.weakSupportIndicators, ["determining_endpoint_near_frame"]);
});

test("4d: frame-edge collapse WITHOUT broad search => weak support (not candidate)", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningCollapsed() });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.classification, "type_a_weak_support");
  assert.equal(out.facts.determiningSeamFrameEdgeCollapsed, true);
  assert.ok(out.exhaustion && out.exhaustion.missing.includes("no_broad_search"));
});

// --- 5. frame-edge collapse facts -------------------------------------------

test("5a: short seam + near-frame endpoint => collapsed true", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningCollapsed() });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.facts.determiningSeamFrameEdgeCollapsed, true);
});

test("5b: short seam with interior endpoints => NOT collapsed", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningShortInterior() });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.facts.determiningSeamFrameEdgeCollapsed, false);
});

test("5c: deterministic endpoint-distance facts", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningCollapsed() });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  const dist = out.facts.determiningEndpointMinEdgeDistanceSourcePx;
  const near = out.facts.determiningEndpointNearFrame;
  assert.ok(dist, "distances present");
  assert.ok(Math.abs(dist![0] - 5) < 1e-3);
  assert.ok(Math.abs(dist![1] - 95) < 1e-3);
  assert.deepEqual(near, [true, false]);
});

test("5d: threshold override changes weak vs strong", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningShortInterior() });
  const out = qualifyTypeASupport(
    baseInput({
      annotation: ann,
      thresholds: {
        weakDeterminingSpanPx: 40,
        weakDeterminingSpanImageDiagonalRatio: 0.01,
        weakDeterminingToMovableSpanRatio: 0.01,
      },
    })
  );
  assert.equal(out.classification, "type_a_strong_support");
  assert.equal(out.thresholdsUsed.weakDeterminingSpanPx, 40);
});

// --- 6. exhausted Type B candidate ------------------------------------------

test("6: weak/collapsed support + current complete exhausted search => candidate", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningCollapsed() });
  const out = qualifyTypeASupport(
    baseInput({
      annotation: ann,
      broadSearch: broadSearch(exhaustedTrials(), false),
      broadSearchEvidenceSignature: "sig-1",
      currentEvidenceSignature: "sig-1",
      localSeedEligible: false,
    })
  );
  assert.equal(out.classification, "type_a_exhausted_type_b_candidate");
  assert.ok(out.exhaustion);
  assert.equal(out.exhaustion!.eligible, true);
  assert.equal(out.exhaustion!.noUsableBasin, true);
  assert.deepEqual(out.exhaustion!.missing, []);
  assert.equal(out.facts.broadSearchStateCounts!.no_pose, 54);
  assert.equal(out.facts.broadSearchStateCounts!.invalid_geometry, 9);
  assert.ok(out.reasons.some((r) => r.toLowerCase().includes("conditional")));
});

// --- 7. no false handoff (each remains weak) --------------------------------

function collapsedInputWith(overrides: Partial<QualifyTypeASupportInput>): QualifyTypeASupportInput {
  return baseInput({
    annotation: typeAAnnotation({ determiningSeam: determiningCollapsed() }),
    broadSearchEvidenceSignature: "sig-1",
    currentEvidenceSignature: "sig-1",
    localSeedEligible: false,
    broadSearch: broadSearch(exhaustedTrials(), false),
    ...overrides,
  });
}

test("7a: weak + stale broad search => weak (not candidate)", () => {
  const out = qualifyTypeASupport(
    collapsedInputWith({ broadSearchEvidenceSignature: "sig-old" })
  );
  assert.equal(out.classification, "type_a_weak_support");
  assert.ok(out.exhaustion!.missing.includes("broad_search_stale_or_signature_mismatch"));
});

test("7b: weak + truncated broad search => weak", () => {
  const out = qualifyTypeASupport(
    collapsedInputWith({ broadSearch: broadSearch(exhaustedTrials(), true) })
  );
  assert.equal(out.classification, "type_a_weak_support");
  assert.ok(out.exhaustion!.missing.includes("broad_search_truncated"));
});

test("7c: weak + any high-confidence corridor => weak", () => {
  const trials = exhaustedTrials();
  trials[0] = coupledTrial("no_pose", true);
  const out = qualifyTypeASupport(collapsedInputWith({ broadSearch: broadSearch(trials, false) }));
  assert.equal(out.classification, "type_a_weak_support");
  assert.ok(out.exhaustion!.missing.includes("high_confidence_corridor_present"));
});

test("7d: weak + high_confidence_not_apply_safe count > 0 => weak", () => {
  const trials = exhaustedTrials();
  trials.push(coupledTrial("high_confidence_not_apply_safe"));
  const out = qualifyTypeASupport(collapsedInputWith({ broadSearch: broadSearch(trials, false) }));
  assert.equal(out.classification, "type_a_weak_support");
  assert.ok(out.exhaustion!.missing.includes("high_confidence_not_apply_safe_present"));
});

test("7e: weak + eligible local seed => weak", () => {
  const out = qualifyTypeASupport(collapsedInputWith({ localSeedEligible: true }));
  assert.equal(out.classification, "type_a_weak_support");
  assert.ok(out.exhaustion!.missing.includes("local_seed_eligible"));
});

test("7f: weak + apply-safe count > 0 => weak", () => {
  const trials = exhaustedTrials();
  trials.push(coupledTrial("apply_safe_diagnostic"));
  const out = qualifyTypeASupport(collapsedInputWith({ broadSearch: broadSearch(trials, false) }));
  assert.equal(out.classification, "type_a_weak_support");
  assert.ok(out.exhaustion!.missing.includes("apply_safe_diagnostic_present"));
});

test("7g: weak + unknown local-seed eligibility => weak (basin unknown)", () => {
  const out = qualifyTypeASupport(collapsedInputWith({ localSeedEligible: null }));
  assert.equal(out.classification, "type_a_weak_support");
  assert.equal(out.exhaustion!.noUsableBasin, null);
  assert.ok(out.exhaustion!.missing.includes("local_seed_eligibility_unknown"));
});

// --- 8. evidence / config provenance ----------------------------------------

test("8a: broad config/grid summary + tuple count captured", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningCollapsed() });
  const out = qualifyTypeASupport(
    baseInput({
      annotation: ann,
      broadSearch: broadSearch(exhaustedTrials(), false),
      broadSearchEvidenceSignature: "sig-1",
      currentEvidenceSignature: "sig-1",
      localSeedEligible: false,
    })
  );
  assert.ok(out.broadSearchProvenance);
  assert.equal(out.broadSearchProvenance!.tupleCount, 63);
  assert.equal(out.broadSearchProvenance!.configSummary!.tNearSampleCount, 7);
  assert.equal(out.broadSearchProvenance!.configSummary!.aspectRatioCount, 9);
  assert.equal(out.broadSearchProvenance!.configSummary!.maxEvaluations, 64);
});

test("8b: provenance is null when no broad search supplied", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningHealthy() });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.broadSearchProvenance, null);
});

// --- 9. authority containment -----------------------------------------------

test("9a: determining edge is read-only evidence; movable corner comes from authority only", () => {
  // Determining seam is much longer than the movable seam; this must NOT flip
  // authority to the determining side.
  const ann = typeAAnnotation({
    movableSeam: seam("seam-move", [
      { x: 0.5, y: 0.55 },
      { x: 0.5, y: 0.5 },
    ]),
    determiningSeam: determiningHealthy(),
    movableCorner: "NR",
  });
  const out = qualifyTypeASupport(baseInput({ annotation: ann }));
  assert.equal(out.facts.movableCorner, "NR");
  assert.equal(out.facts.movableSeamId, "seam-move");
  assert.equal(out.facts.determiningSeamId, "seam-det");
});

test("9b: input annotation is not mutated", () => {
  const ann = typeAAnnotation({ determiningSeam: determiningCollapsed() });
  const snapshot = structuredClone(ann);
  qualifyTypeASupport(
    baseInput({
      annotation: ann,
      broadSearch: broadSearch(exhaustedTrials(), false),
      broadSearchEvidenceSignature: "sig-1",
      currentEvidenceSignature: "sig-1",
      localSeedEligible: false,
    })
  );
  assert.deepEqual(ann, snapshot);
});

// --- 10. purity / determinism -----------------------------------------------

test("10a: full input object is not mutated", () => {
  const input = baseInput({
    annotation: typeAAnnotation({ determiningSeam: determiningCollapsed() }),
    broadSearch: broadSearch(exhaustedTrials(), false),
    broadSearchEvidenceSignature: "sig-1",
    currentEvidenceSignature: "sig-1",
    localSeedEligible: false,
  });
  const snapshot = structuredClone(input);
  qualifyTypeASupport(input);
  assert.deepEqual(input, snapshot);
});

test("10b: outputs deep-equal across repeated calls", () => {
  const input = baseInput({
    annotation: typeAAnnotation({ determiningSeam: determiningCollapsed() }),
    broadSearch: broadSearch(exhaustedTrials(), false),
    broadSearchEvidenceSignature: "sig-1",
    currentEvidenceSignature: "sig-1",
    localSeedEligible: false,
  });
  const a = qualifyTypeASupport(input);
  const b = qualifyTypeASupport(input);
  assert.deepEqual(a, b);
});
