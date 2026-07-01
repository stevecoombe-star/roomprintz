// --- Phase B3A: Type B evaluator contract unit tests ------------------------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST Type B
// evaluator CONTRACT. B3A is a pure vocabulary phase: these tests exercise the
// two pure helpers (canonical junction tolerance + exact basis-staleness
// comparison), pin the required schema/family/formula identifiers, and use
// compile-valid fixtures to prove the frozen snapshot + exact one-latent tuple
// can be declared from copied evidence with no live-state references. There is
// no solver, tuple generation, FOV scan, UI, preview, load, Apply, or
// calibration mutation anywhere in the contract module or these tests.

import assert from "node:assert/strict";
import test from "node:test";

import * as contract from "./type-b-evaluator-contract";
import {
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MAX_PX,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MIN_PX,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_RATIO,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  compareTypeBEvidenceSnapshotBasis,
  resolveTypeBEvaluatorJunctionTolerancePx,
  type TypeBDiagnosticTuple,
  type TypeBEvidenceSnapshot,
  type TypeBEvidenceSnapshotBasis,
} from "./type-b-evaluator-contract";

// --- Fixtures ---------------------------------------------------------------

function basis(
  overrides: Partial<TypeBEvidenceSnapshotBasis> = {}
): TypeBEvidenceSnapshotBasis {
  return {
    sourceImageIdentity: "room-a.jpg",
    sourceFrameKey: "1000x1000",
    sourceFrame: { width: 1000, height: 1000 },
    candidateIdentity: "cand-1",
    floorPolygonKey: "0.100000,0.900000;0.900000,0.900000",
    ...overrides,
  };
}

// A representative frozen snapshot declared from ONLY: B1-eligible context, one
// latent side condition, one evaluator family, copied source/basis evidence, and
// canonical frozen junction evidence. No live React/UI references anywhere.
function snapshotFixture(): TypeBEvidenceSnapshot {
  return {
    schema: TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    evidenceFamily: "rear_seam_plus_strong_side_seam",
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    basis: basis(),
    rearSeam: {
      role: "rear_floor_wall_seam",
      startNorm: { x: 0.2, y: 0.8 },
      endNorm: { x: 0.6, y: 0.8 },
      startEndpointStatus: "visible",
      endEndpointStatus: "visible",
      startFrameContact: "no_frame_contact",
      endFrameContact: "no_frame_contact",
      occlusionStatus: "none_observed",
      notes: "rear seam",
    },
    strongSideSeam: {
      role: "side_wall_floor_seam",
      startNorm: { x: 0.2, y: 0.8 },
      endNorm: { x: 0.15, y: 0.35 },
      startEndpointStatus: "visible",
      endEndpointStatus: "frame_truncated",
      startFrameContact: "no_frame_contact",
      endFrameContact: "contacts_frame",
      occlusionStatus: "none_observed",
    },
    latentNearCornerCondition: "frame_truncated",
    floorAssumptions: {
      worldWidth: 1,
      authorizedAspectRatios: [0.8, 1.0, 1.3],
    },
    typeAContext: "type_a_exhausted_handoff_candidate",
    b1Qualification: {
      status: "type_b_diagnostic_eligible",
      blockingReasons: [],
      advisoryReasons: [],
      evidenceSummary: {
        rearSeamUsable: true,
        strongSideSeamUsable: true,
        rearSideRelationshipUsable: true,
        latentNearCornerBounded: true,
        cropInterpretationUsable: true,
      },
    },
    junction: {
      distanceSourcePx: 0,
      toleranceFormulaId: TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
      resolvedToleranceSourcePx: 20,
      established: true,
    },
    capturedAtIso: "2026-07-01T00:00:00.000Z",
  };
}

// --- 1-4. Canonical junction tolerance --------------------------------------

test("1: canonical tolerance resolves to 8 px at the lower clamp", () => {
  // 0.02 * 100 = 2, clamped up to the 8 px floor.
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 100, height: 100 }),
    8
  );
});

test("2: canonical tolerance resolves to 20 px for a 1000 x 1000 frame", () => {
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 1000, height: 1000 }),
    20
  );
  // Uses min(width, height): a wide frame still resolves off the shorter side.
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 4000, height: 1000 }),
    20
  );
});

test("3: canonical tolerance resolves to 24 px at the upper clamp", () => {
  // 0.02 * 2000 = 40, clamped down to the 24 px ceiling.
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 2000, height: 2000 }),
    24
  );
});

test("4: invalid / missing / non-finite / non-positive frames return null", () => {
  assert.equal(resolveTypeBEvaluatorJunctionTolerancePx(null), null);
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({
      width: Number.NaN,
      height: 1000,
    }),
    null
  );
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({
      width: 1000,
      height: Number.POSITIVE_INFINITY,
    }),
    null
  );
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 0, height: 1000 }),
    null
  );
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 1000, height: -5 }),
    null
  );
});

// --- 5-11. Snapshot-basis staleness comparison ------------------------------

test("5: basis comparison reports fresh for exact equality", () => {
  const result = compareTypeBEvidenceSnapshotBasis(basis(), basis());
  assert.equal(result.kind, "fresh");
  assert.deepEqual(result.staleFields, []);
});

test("6: source-image mismatch reports only source_image_identity", () => {
  const result = compareTypeBEvidenceSnapshotBasis(
    basis(),
    basis({ sourceImageIdentity: "room-b.jpg" })
  );
  assert.equal(result.kind, "stale");
  assert.equal(
    result.kind === "stale" ? result.reason : null,
    "evidence_snapshot_stale"
  );
  assert.deepEqual(result.staleFields, ["source_image_identity"]);
});

test("7: source-frame mismatch reports only source_frame", () => {
  const result = compareTypeBEvidenceSnapshotBasis(
    basis(),
    basis({ sourceFrameKey: "800x600" })
  );
  assert.equal(result.kind, "stale");
  assert.deepEqual(result.staleFields, ["source_frame"]);
});

test("8: candidate mismatch reports only candidate_identity", () => {
  const result = compareTypeBEvidenceSnapshotBasis(
    basis(),
    basis({ candidateIdentity: "cand-2" })
  );
  assert.equal(result.kind, "stale");
  assert.deepEqual(result.staleFields, ["candidate_identity"]);
});

test("9: polygon mismatch reports only floor_polygon", () => {
  const result = compareTypeBEvidenceSnapshotBasis(
    basis(),
    basis({ floorPolygonKey: "different" })
  );
  assert.equal(result.kind, "stale");
  assert.deepEqual(result.staleFields, ["floor_polygon"]);
});

test("10: multiple mismatches return in stable declared order", () => {
  const result = compareTypeBEvidenceSnapshotBasis(
    basis(),
    basis({
      floorPolygonKey: "different",
      sourceImageIdentity: "room-b.jpg",
      candidateIdentity: "cand-2",
      sourceFrameKey: "800x600",
    })
  );
  assert.equal(result.kind, "stale");
  assert.deepEqual(result.staleFields, [
    "source_image_identity",
    "source_frame",
    "candidate_identity",
    "floor_polygon",
  ]);
});

test("11: basis comparison does not mutate either input", () => {
  const a = basis();
  const b = basis({ candidateIdentity: "cand-2" });
  const aSnapshot = structuredClone(a);
  const bSnapshot = structuredClone(b);
  compareTypeBEvidenceSnapshotBasis(a, b);
  assert.deepEqual(a, aSnapshot);
  assert.deepEqual(b, bSnapshot);
});

// --- 12. Required identifiers -----------------------------------------------

test("12: required identifiers equal the exact agreed values", () => {
  assert.equal(
    TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    "vibode-type-b-evidence-snapshot/v0"
  );
  assert.equal(TYPE_B_EVALUATOR_FAMILY, "rear_points_side_line_one_latent");
  assert.equal(
    TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
    "min_dim_ratio_clamped/v0"
  );
  assert.equal(TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_RATIO, 0.02);
  assert.equal(TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MIN_PX, 8);
  assert.equal(TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MAX_PX, 24);
});

// --- 13. Representative snapshot fixture ------------------------------------

test("13: a representative Type B snapshot fixture is declarable + self-consistent", () => {
  const snapshot = snapshotFixture();
  // Both family identifiers are present and distinct concepts.
  assert.equal(snapshot.evidenceFamily, "rear_seam_plus_strong_side_seam");
  assert.equal(snapshot.evaluatorFamily, "rear_points_side_line_one_latent");
  assert.notEqual(snapshot.evidenceFamily, snapshot.evaluatorFamily);
  // One authorized latent side condition; hard exhausted-handoff precondition.
  assert.equal(snapshot.latentNearCornerCondition, "frame_truncated");
  assert.equal(snapshot.typeAContext, "type_a_exhausted_handoff_candidate");
  // B1 fingerprint carries eligibility with no blocking reasons.
  assert.equal(snapshot.b1Qualification.status, "type_b_diagnostic_eligible");
  assert.deepEqual(snapshot.b1Qualification.blockingReasons, []);
  // Frozen junction stores the resolved tolerance beside the formula identity.
  assert.equal(
    snapshot.junction.toleranceFormulaId,
    TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA
  );
  assert.equal(snapshot.junction.established, true);
  assert.equal(
    snapshot.junction.resolvedToleranceSourcePx,
    resolveTypeBEvaluatorJunctionTolerancePx(snapshot.basis.sourceFrame)
  );
  // The captured basis is fresh against itself.
  assert.equal(
    compareTypeBEvidenceSnapshotBasis(snapshot.basis, snapshot.basis).kind,
    "fresh"
  );
});

// --- 14. Representative exact tuple -----------------------------------------

test("14: a representative exact tuple contains only the four authorized fields", () => {
  const tuple: TypeBDiagnosticTuple = {
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    latentSideExtent: 0.6,
    floorAspectRatio: 1.0,
    fovProbeDeg: 55,
  };
  assert.deepEqual(Object.keys(tuple).sort(), [
    "evaluatorFamily",
    "floorAspectRatio",
    "fovProbeDeg",
    "latentSideExtent",
  ]);
  // The aspect must later be one of the snapshot's authorized ratios (contract
  // intent; not enforced by B3A). This asserts the fixture is consistent.
  assert.ok(
    snapshotFixture().floorAssumptions.authorizedAspectRatios.includes(
      tuple.floorAspectRatio
    )
  );
});

// --- 15. No solver / React / UI / calibration runtime surface ---------------

test("15: the contract module's runtime surface is only pure constants + helpers", () => {
  // Types are erased at runtime; the ONLY runtime exports are the six
  // identifier/constant values and the two pure helpers. Any accidental solver /
  // React / UI / calibration runtime import would surface as extra exports here.
  const runtimeKeys = Object.keys(contract).sort();
  assert.deepEqual(runtimeKeys, [
    "TYPE_B_EVALUATOR_FAMILY",
    "TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA",
    "TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MAX_PX",
    "TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MIN_PX",
    "TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_RATIO",
    "TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA",
    "compareTypeBEvidenceSnapshotBasis",
    "resolveTypeBEvaluatorJunctionTolerancePx",
  ]);
  assert.equal(typeof resolveTypeBEvaluatorJunctionTolerancePx, "function");
  assert.equal(typeof compareTypeBEvidenceSnapshotBasis, "function");
});
