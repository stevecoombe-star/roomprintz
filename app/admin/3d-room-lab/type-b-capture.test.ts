// --- Phase B3D-5B: Pure Snapshot and Coverage Capture Evaluator tests --------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST Type B capture
// evaluator. Fixtures are LOCAL, minimal, and hand-authored. The evaluator only
// builds capture INPUTS: it runs NO B3C tuple generation, NO B3D leaf, NO P3P,
// NO UI, NO calibration, NO ranking. B3C is imported HERE (test-only) purely to
// prove the captured coverage is run-level valid and that class-level B3C
// refusals remain capturable.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TYPE_B_CAPTURE_SCHEMA,
  makeTypeBCoverageFingerprint,
  makeTypeBEvidenceFingerprint,
} from "./type-b-capture-contract";
import {
  TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
} from "./type-b-evaluator-contract";
import type {
  TypeBEvidenceSnapshot,
  TypeBFrozenB1QualificationFingerprint,
} from "./type-b-evaluator-contract";
import type {
  TypeBDeclaredLineEvidence,
} from "./type-b-evidence-types";
import { generateTypeBBoundedDiagnosticTuples } from "./type-b-tuple-generation";
import type { TypeBExplicitCaptureInputs } from "./type-b-capture-contract";
import { TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA } from "./type-b-test-handoff-override";
import type { TypeBTestHandoffOverride } from "./type-b-test-handoff-override";

import * as captureModule from "./type-b-capture";
import {
  captureTypeBSnapshotAndCoverage,
  type TypeBSnapshotAndCoverageCaptureInput,
} from "./type-b-capture";

// --- Local fixtures ---------------------------------------------------------

// FRAME 1000x800 -> junction tolerance clamp(0.02*800=16, 8, 24) = 16 px.
function buildBasis(): TypeBEvidenceSnapshot["basis"] {
  return {
    sourceImageIdentity: "room.jpg",
    sourceFrameKey: "1000x800",
    sourceFrame: { width: 1000, height: 800 },
    candidateIdentity: "cand-1",
    floorPolygonKey: "poly-1",
  };
}

// Rear seam px: start (100,400), end (500,400). End is the shared junction.
function buildRearSeam(): TypeBDeclaredLineEvidence {
  return {
    role: "rear_floor_wall_seam",
    startNorm: { x: 0.1, y: 0.5 },
    endNorm: { x: 0.5, y: 0.5 },
    startEndpointStatus: "visible",
    endEndpointStatus: "visible",
    startFrameContact: "no_frame_contact",
    endFrameContact: "no_frame_contact",
    occlusionStatus: "none_observed",
    operatorDeclared: true,
  };
}

// Side seam px: start (500,400) at junction, end (500,720) latent terminus.
function buildSideSeam(): TypeBDeclaredLineEvidence {
  return {
    role: "side_wall_floor_seam",
    startNorm: { x: 0.5, y: 0.5 },
    endNorm: { x: 0.5, y: 0.9 },
    startEndpointStatus: "visible",
    endEndpointStatus: "frame_truncated",
    startFrameContact: "no_frame_contact",
    endFrameContact: "contacts_frame",
    occlusionStatus: "none_observed",
    operatorDeclared: true,
  };
}

function buildB1(): TypeBFrozenB1QualificationFingerprint {
  return {
    status: "type_b_diagnostic_eligible",
    blockingReasons: [],
    advisoryReasons: ["type_a_investigation_preferred"],
    evidenceSummary: {
      rearSeamUsable: true,
      strongSideSeamUsable: true,
      rearSideRelationshipUsable: true,
      latentNearCornerBounded: true,
      cropInterpretationUsable: null,
    },
  };
}

function buildExplicitInputs(): TypeBExplicitCaptureInputs {
  return {
    worldWidth: 3.2,
    authorizedAspectRatios: [1.0, 1.5, 2.0],
    primaryProductClasses: [
      {
        primaryProductClassIdentity: "p-050",
        latentDepthProduct: {
          formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
          value: 0.5,
        },
      },
      {
        primaryProductClassIdentity: "p-075",
        latentDepthProduct: {
          formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
          value: 0.75,
        },
      },
    ],
    fovProbesDeg: [40, 50, 60],
  };
}

function buildInput(
  overrides: Partial<TypeBSnapshotAndCoverageCaptureInput> = {}
): TypeBSnapshotAndCoverageCaptureInput {
  return {
    basis: buildBasis(),
    rearSeam: buildRearSeam(),
    strongSideSeam: buildSideSeam(),
    latentNearCornerCondition: "frame_truncated",
    actualTypeAContext: "type_a_exhausted_handoff_candidate",
    testHandoffOverride: null,
    b1Qualification: buildB1(),
    explicitInputs: buildExplicitInputs(),
    capturedAtIso: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

// A valid lab-only Type B test-handoff override (exact schema + enabled true).
function buildTestOverride(): TypeBTestHandoffOverride {
  return { schema: TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA, enabled: true };
}

const MODULE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "type-b-capture.ts"
);
const MODULE_SOURCE = readFileSync(MODULE_PATH, "utf8");

// --- 1. Runtime export surface ----------------------------------------------

test("capture module runtime surface exports only captureTypeBSnapshotAndCoverage", () => {
  const keys = Object.keys(captureModule).sort();
  assert.deepEqual(keys, ["captureTypeBSnapshotAndCoverage"]);
  assert.equal(typeof captureTypeBSnapshotAndCoverage, "function");
});

// --- 2. Contract ordering helper is the only ordering source ----------------

test("the contract-owned ordering helper is imported and is the only ordering source used", () => {
  // The evaluator imports orderTypeBCaptureRefusalReasons from the contract.
  assert.ok(
    /orderTypeBCaptureRefusalReasons/.test(MODULE_SOURCE),
    "evaluator must use the contract ordering helper"
  );
  // The evaluator does NOT declare its own capture-order array (no duplication).
  assert.ok(
    !/TYPE_B_CAPTURE_REFUSAL_ORDER/.test(MODULE_SOURCE),
    "evaluator must not duplicate the private capture-order array"
  );
  // Multi-reason refusals come back in the exact canonical order (proving the
  // single ordering source governs the evaluator's output too).
  const result = captureTypeBSnapshotAndCoverage(
    buildInput({
      explicitInputs: {
        ...buildExplicitInputs(),
        worldWidth: -1,
        fovProbesDeg: [],
      },
      actualTypeAContext: "type_a_strong_support",
    })
  );
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.deepEqual(result.refusalReasons, [
    "invalid_world_width",
    "type_a_context_not_exhausted_handoff",
    "no_fov_probes",
  ]);
});

// --- 3. Valid capture: complete pair + empty refusals -----------------------

test("valid explicit Type B capture returns a complete snapshot, coverage, identity, and empty refusals", () => {
  const result = captureTypeBSnapshotAndCoverage(buildInput());
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  assert.equal(result.schema, TYPE_B_CAPTURE_SCHEMA);
  assert.deepEqual(result.refusalReasons, []);
  assert.ok(result.snapshot);
  assert.ok(result.coverage);
  assert.ok(result.identity);
  assert.equal(typeof result.identity.evidenceFingerprint, "string");
  assert.equal(typeof result.identity.coverageFingerprint, "string");
});

// --- 4. Successful snapshot exact fields ------------------------------------

test("successful snapshot has exact committed families, handoff context, frozen junction/roles, floor assumptions, seam notes, and supplied timestamp", () => {
  const result = captureTypeBSnapshotAndCoverage(
    buildInput({
      rearSeam: { ...buildRearSeam(), notes: "rear note" },
      strongSideSeam: { ...buildSideSeam(), notes: "side note" },
    })
  );
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  const s = result.snapshot;
  assert.equal(s.schema, TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA);
  assert.equal(s.evidenceFamily, "rear_seam_plus_strong_side_seam");
  assert.equal(s.evaluatorFamily, TYPE_B_EVALUATOR_FAMILY);
  assert.equal(s.typeAContext, "type_a_exhausted_handoff_candidate");
  assert.equal(s.latentNearCornerCondition, "frame_truncated");
  assert.equal(s.capturedAtIso, "2026-07-01T00:00:00.000Z");
  assert.deepEqual(s.junction, {
    distanceSourcePx: 0,
    toleranceFormulaId: TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
    resolvedToleranceSourcePx: 16,
    established: true,
  });
  assert.deepEqual(s.endpointRoles, {
    resolutionRuleId: TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
    junctionRearEndpoint: "end",
    junctionSideEndpoint: "start",
  });
  assert.deepEqual(s.floorAssumptions, {
    worldWidth: 3.2,
    authorizedAspectRatios: [1.0, 1.5, 2.0],
  });
  // Seam notes are retained in the frozen copy.
  assert.equal(s.rearSeam.notes, "rear note");
  assert.equal(s.strongSideSeam.notes, "side note");
  // The frozen seam drops the input-only `operatorDeclared` flag.
  assert.equal(
    (s.rearSeam as { operatorDeclared?: unknown }).operatorDeclared,
    undefined
  );
});

// --- 5 & 18. Coverage preserves exact authored order ------------------------

test("successful coverage preserves exact authored aspect, product-class, and FOV-probe order (no sort/dedup/repair)", () => {
  const explicit: TypeBExplicitCaptureInputs = {
    worldWidth: 3.2,
    authorizedAspectRatios: [2.0, 1.0, 1.5],
    primaryProductClasses: [
      {
        primaryProductClassIdentity: "p-075",
        latentDepthProduct: {
          formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
          value: 0.75,
        },
      },
      {
        primaryProductClassIdentity: "p-050",
        latentDepthProduct: {
          formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
          value: 0.5,
        },
      },
    ],
    fovProbesDeg: [60, 40, 50],
  };
  const result = captureTypeBSnapshotAndCoverage(
    buildInput({ explicitInputs: explicit })
  );
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  assert.deepEqual(result.snapshot.floorAssumptions.authorizedAspectRatios, [
    2.0, 1.0, 1.5,
  ]);
  assert.deepEqual(
    result.coverage.primaryProductClasses.map(
      (c) => c.primaryProductClassIdentity
    ),
    ["p-075", "p-050"]
  );
  assert.deepEqual(
    result.coverage.primaryProductClasses.map((c) => c.latentDepthProduct.value),
    [0.75, 0.5]
  );
  assert.deepEqual(result.coverage.fovProbesDeg, [60, 40, 50]);
});

// --- 6. Identity fingerprints equal direct B3D-5A calls ---------------------

test("identity fingerprints exactly equal direct B3D-5A fingerprint calls", () => {
  const result = captureTypeBSnapshotAndCoverage(buildInput());
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  assert.equal(
    result.identity.evidenceFingerprint,
    makeTypeBEvidenceFingerprint(result.snapshot)
  );
  assert.equal(
    result.identity.coverageFingerprint,
    makeTypeBCoverageFingerprint(result.snapshot, result.coverage)
  );
});

// --- 7. Valid captured coverage produces no B3C run-level refusal ------------

test("valid captured coverage produces no B3C run-level refusal when passed to B3C", () => {
  const result = captureTypeBSnapshotAndCoverage(buildInput());
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  const b3c = generateTypeBBoundedDiagnosticTuples(
    result.snapshot,
    result.coverage
  );
  assert.equal(b3c.status, "generated");
  assert.deepEqual(b3c.refusalReasons, []);
});

// --- 8. A B3C class-level refusal remains capturable ------------------------

test("a B3C class-level refusal (below-threshold product) remains capturable and is not rejected prematurely", () => {
  const explicit: TypeBExplicitCaptureInputs = {
    ...buildExplicitInputs(),
    primaryProductClasses: [
      {
        primaryProductClassIdentity: "p-050",
        latentDepthProduct: {
          formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
          value: 0.5,
        },
      },
      {
        // Below the provisional conditioning threshold => B3C class-level
        // refusal (latent_depth_product_not_conditioned), NOT a run refusal.
        primaryProductClassIdentity: "p-weak",
        latentDepthProduct: {
          formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
          value: 0.05,
        },
      },
    ],
  };
  const result = captureTypeBSnapshotAndCoverage(
    buildInput({ explicitInputs: explicit })
  );
  // Capture succeeds despite the class-level condition.
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;

  const b3c = generateTypeBBoundedDiagnosticTuples(
    result.snapshot,
    result.coverage
  );
  // Run-level generated; the weak class is refused only at class level.
  assert.equal(b3c.status, "generated");
  assert.deepEqual(b3c.refusalReasons, []);
  const weak = b3c.productClasses.find(
    (c) => c.primaryProductClassIdentity === "p-weak"
  );
  assert.ok(weak);
  assert.equal(weak?.status, "refused");
  assert.deepEqual(weak?.refusalReasons, [
    "latent_depth_product_not_conditioned",
  ]);
});

// --- 9. Non-eligible B1 -----------------------------------------------------

test("non-eligible B1 produces type_b_not_qualified with no snapshot/coverage/identity", () => {
  const cases: unknown[] = [
    { ...buildB1(), status: "type_b_diagnostic_ineligible" },
    { ...buildB1(), blockingReasons: ["shared_junction_absent"] },
    null,
    { status: "type_b_diagnostic_eligible" },
  ];
  for (const b1 of cases) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({ b1Qualification: b1 as never })
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(result.refusalReasons.includes("type_b_not_qualified"));
    assert.equal((result as { snapshot?: unknown }).snapshot, undefined);
    assert.equal((result as { coverage?: unknown }).coverage, undefined);
    assert.equal((result as { identity?: unknown }).identity, undefined);
  }
});

// --- 10. Wrong Type A context -----------------------------------------------

test("wrong Type A context produces type_a_context_not_exhausted_handoff with no snapshot/coverage/identity", () => {
  for (const ctx of [
    "type_a_not_run_or_unknown",
    "type_a_strong_support",
    "type_a_weak_support",
    "type_a_investigation_case",
  ] as const) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({ actualTypeAContext: ctx })
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(
      result.refusalReasons.includes("type_a_context_not_exhausted_handoff")
    );
    assert.equal((result as { snapshot?: unknown }).snapshot, undefined);
    assert.equal((result as { identity?: unknown }).identity, undefined);
  }
});

// --- 11. Invalid basis or timestamp -----------------------------------------

test("invalid basis or timestamp produces invalid_snapshot_basis with no partial capture", () => {
  const cases: Partial<TypeBSnapshotAndCoverageCaptureInput>[] = [
    { basis: { ...buildBasis(), sourceImageIdentity: "  " } as never },
    { basis: { ...buildBasis(), sourceFrameKey: "" } as never },
    { basis: { ...buildBasis(), candidateIdentity: null } as never },
    { basis: { ...buildBasis(), floorPolygonKey: null } as never },
    { capturedAtIso: "   " },
    { capturedAtIso: "" },
  ];
  for (const override of cases) {
    const result = captureTypeBSnapshotAndCoverage(buildInput(override));
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(result.refusalReasons.includes("invalid_snapshot_basis"));
    assert.equal((result as { snapshot?: unknown }).snapshot, undefined);
    assert.equal((result as { coverage?: unknown }).coverage, undefined);
    assert.equal((result as { identity?: unknown }).identity, undefined);
  }
});

// --- 12. Invalid world width; resolver never emits it -----------------------

test("invalid world width alone produces invalid_world_width, not invalid_floor_assumptions; resolver never emits it", () => {
  for (const worldWidth of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({
        explicitInputs: { ...buildExplicitInputs(), worldWidth: worldWidth as number },
      })
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(result.refusalReasons.includes("invalid_world_width"));
    // Aspects are valid here, so the aspect-validity literal must NOT appear.
    assert.ok(!result.refusalReasons.includes("invalid_floor_assumptions"));
    assert.equal((result as { snapshot?: unknown }).snapshot, undefined);
  }
});

// --- 12b. Invalid aspect alone / both invalid -------------------------------

test("invalid authorized aspect alone produces invalid_floor_assumptions, not invalid_world_width", () => {
  for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({
        explicitInputs: {
          ...buildExplicitInputs(),
          authorizedAspectRatios: [1.0, bad as number, 2.0],
        },
      })
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(result.refusalReasons.includes("invalid_floor_assumptions"));
    // World width is valid here, so the world-width literal must NOT appear.
    assert.ok(!result.refusalReasons.includes("invalid_world_width"));
    assert.equal((result as { snapshot?: unknown }).snapshot, undefined);
  }
});

test("invalid world width plus invalid aspect emits both literals in canonical order", () => {
  const result = captureTypeBSnapshotAndCoverage(
    buildInput({
      explicitInputs: {
        ...buildExplicitInputs(),
        worldWidth: -1,
        authorizedAspectRatios: [1.0, Number.NaN, 2.0],
      },
    })
  );
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  const idxWorldWidth = result.refusalReasons.indexOf("invalid_world_width");
  const idxFloor = result.refusalReasons.indexOf("invalid_floor_assumptions");
  assert.ok(idxWorldWidth >= 0, "invalid_world_width expected");
  assert.ok(idxFloor >= 0, "invalid_floor_assumptions expected");
  assert.equal(idxFloor, idxWorldWidth + 1);
});

// --- 13. Unauthorized latent condition --------------------------------------

test("unauthorized latent condition produces latent_condition_not_authorized", () => {
  for (const condition of ["unresolved", "not_needed_visible"] as const) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({ latentNearCornerCondition: condition })
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(
      result.refusalReasons.includes("latent_condition_not_authorized")
    );
    assert.equal((result as { snapshot?: unknown }).snapshot, undefined);
  }
});

// --- 14. Resolver refusals pass through, canonically ordered with others -----

test("resolver refusals pass through unchanged and remain canonically ordered with global/eligibility/coverage failures", () => {
  const result = captureTypeBSnapshotAndCoverage(
    buildInput({
      // Global: invalid world width.
      // Eligibility: wrong Type A context.
      // Resolver: certainty + latent-mismatch facts (occluded endpoints vs
      //           frame_truncated condition).
      // Coverage: empty FOV probes.
      explicitInputs: {
        ...buildExplicitInputs(),
        worldWidth: -5,
        fovProbesDeg: [],
      },
      actualTypeAContext: "type_a_strong_support",
      rearSeam: {
        ...buildRearSeam(),
        startEndpointStatus: "occluded",
        endEndpointStatus: "occluded",
      },
      strongSideSeam: {
        ...buildSideSeam(),
        startEndpointStatus: "occluded",
        endEndpointStatus: "occluded",
        endFrameContact: "no_frame_contact",
      },
    })
  );
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.deepEqual(result.refusalReasons, [
    "invalid_world_width",
    "type_a_context_not_exhausted_handoff",
    "junction_endpoint_not_position_certain",
    "non_junction_rear_endpoint_not_position_certain",
    "latent_condition_side_terminus_status_mismatch",
    "no_fov_probes",
  ]);
});

test("a resolver tie and a missing-contacts_frame terminus pass through as capture refusals", () => {
  // Exact tie: two declared pairs share the minimum distance.
  const tie = captureTypeBSnapshotAndCoverage(
    buildInput({
      rearSeam: {
        ...buildRearSeam(),
        startNorm: { x: 0.5, y: 0.5 },
        endNorm: { x: 0.6, y: 0.5 },
      },
      strongSideSeam: {
        ...buildSideSeam(),
        startNorm: { x: 0.5, y: 0.5 },
        endNorm: { x: 0.6, y: 0.5 },
      },
    })
  );
  assert.equal(tie.status, "refused");
  if (tie.status === "refused") {
    assert.ok(tie.refusalReasons.includes("junction_endpoint_pair_tied"));
  }

  // frame_truncated terminus that does not contact the frame.
  const contact = captureTypeBSnapshotAndCoverage(
    buildInput({
      strongSideSeam: {
        ...buildSideSeam(),
        endEndpointStatus: "frame_truncated",
        endFrameContact: "no_frame_contact",
      },
    })
  );
  assert.equal(contact.status, "refused");
  if (contact.status === "refused") {
    assert.ok(
      contact.refusalReasons.includes(
        "frame_truncated_side_terminus_not_contacts_frame"
      )
    );
  }
});

// --- 15. Authorized aspect coverage: B3C run-level semantics -----------------

test("empty/duplicate/malformed authorized aspect coverage follows B3C run-level semantics and capture literals", () => {
  const empty = captureTypeBSnapshotAndCoverage(
    buildInput({
      explicitInputs: { ...buildExplicitInputs(), authorizedAspectRatios: [] },
    })
  );
  assert.equal(empty.status, "refused");
  if (empty.status === "refused") {
    assert.ok(empty.refusalReasons.includes("no_authorized_aspect_ratios"));
  }

  const dup = captureTypeBSnapshotAndCoverage(
    buildInput({
      explicitInputs: {
        ...buildExplicitInputs(),
        authorizedAspectRatios: [1.0, 1.5, 1.0],
      },
    })
  );
  assert.equal(dup.status, "refused");
  if (dup.status === "refused") {
    assert.ok(dup.refusalReasons.includes("duplicate_authorized_aspect_ratio"));
  }

  // A malformed aspect member reuses B3C's exact run-level
  // `invalid_floor_assumptions` literal (never collapsed into
  // `invalid_world_width`).
  for (const bad of [0, -2, Number.NaN]) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({
        explicitInputs: {
          ...buildExplicitInputs(),
          authorizedAspectRatios: [1.0, bad as number, 2.0],
        },
      })
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(result.refusalReasons.includes("invalid_floor_assumptions"));
    assert.ok(!result.refusalReasons.includes("invalid_world_width"));
    // Cross-check: the same aspect input run-level-refuses in B3C with the exact
    // same literal.
    const b3c = generateTypeBBoundedDiagnosticTuples(
      buildValidSnapshotWithAspects([1.0, bad as number, 2.0]),
      {
        primaryProductClasses: buildExplicitInputs().primaryProductClasses,
        fovProbesDeg: buildExplicitInputs().fovProbesDeg,
      }
    );
    assert.equal(b3c.status, "refused");
    assert.ok(b3c.refusalReasons.includes("invalid_floor_assumptions"));
  }
});

// Small helper for the B3C cross-check above: a valid snapshot whose floor
// assumptions carry the supplied (possibly malformed) authorized aspects.
function buildValidSnapshotWithAspects(
  authorizedAspectRatios: readonly number[]
): TypeBEvidenceSnapshot {
  const captured = captureTypeBSnapshotAndCoverage(buildInput());
  assert.equal(captured.status, "captured");
  if (captured.status !== "captured") throw new Error("fixture capture failed");
  return {
    ...captured.snapshot,
    floorAssumptions: {
      worldWidth: captured.snapshot.floorAssumptions.worldWidth,
      authorizedAspectRatios,
    },
  };
}

// --- 16. Product-class coverage: B3C run-level semantics ---------------------

test("empty/duplicate/invalid product-class coverage follows B3C run-level semantics and capture literals", () => {
  const empty = captureTypeBSnapshotAndCoverage(
    buildInput({
      explicitInputs: { ...buildExplicitInputs(), primaryProductClasses: [] },
    })
  );
  assert.equal(empty.status, "refused");
  if (empty.status === "refused") {
    assert.ok(empty.refusalReasons.includes("no_primary_product_classes"));
  }

  const dupIdentity = captureTypeBSnapshotAndCoverage(
    buildInput({
      explicitInputs: {
        ...buildExplicitInputs(),
        primaryProductClasses: [
          {
            primaryProductClassIdentity: "same",
            latentDepthProduct: {
              formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
              value: 0.5,
            },
          },
          {
            primaryProductClassIdentity: "same",
            latentDepthProduct: {
              formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
              value: 0.75,
            },
          },
        ],
      },
    })
  );
  assert.equal(dupIdentity.status, "refused");
  if (dupIdentity.status === "refused") {
    assert.ok(
      dupIdentity.refusalReasons.includes(
        "duplicate_primary_product_class_identity"
      )
    );
  }

  const dupProduct = captureTypeBSnapshotAndCoverage(
    buildInput({
      explicitInputs: {
        ...buildExplicitInputs(),
        primaryProductClasses: [
          {
            primaryProductClassIdentity: "p-a",
            latentDepthProduct: {
              formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
              value: 0.5,
            },
          },
          {
            primaryProductClassIdentity: "p-b",
            latentDepthProduct: {
              formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
              value: 0.5,
            },
          },
        ],
      },
    })
  );
  assert.equal(dupProduct.status, "refused");
  if (dupProduct.status === "refused") {
    assert.ok(
      dupProduct.refusalReasons.includes("duplicate_primary_latent_depth_product")
    );
  }

  const blank = captureTypeBSnapshotAndCoverage(
    buildInput({
      explicitInputs: {
        ...buildExplicitInputs(),
        primaryProductClasses: [
          {
            primaryProductClassIdentity: "   ",
            latentDepthProduct: {
              formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
              value: 0.5,
            },
          },
        ],
      },
    })
  );
  assert.equal(blank.status, "refused");
  if (blank.status === "refused") {
    assert.ok(blank.refusalReasons.includes("invalid_primary_product_class"));
  }
});

// --- 17. FOV probe coverage: B3C run-level semantics ------------------------

test("empty/duplicate/out-of-range/non-finite FOV probes follow B3C run-level semantics and capture literals", () => {
  const empty = captureTypeBSnapshotAndCoverage(
    buildInput({
      explicitInputs: { ...buildExplicitInputs(), fovProbesDeg: [] },
    })
  );
  assert.equal(empty.status, "refused");
  if (empty.status === "refused") {
    assert.ok(empty.refusalReasons.includes("no_fov_probes"));
  }

  for (const probes of [[10, 50], [50, 200], [50, Number.NaN]]) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({
        explicitInputs: { ...buildExplicitInputs(), fovProbesDeg: probes },
      })
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(result.refusalReasons.includes("invalid_fov_probe"));
  }

  const dup = captureTypeBSnapshotAndCoverage(
    buildInput({
      explicitInputs: { ...buildExplicitInputs(), fovProbesDeg: [40, 50, 40] },
    })
  );
  assert.equal(dup.status, "refused");
  if (dup.status === "refused") {
    assert.ok(dup.refusalReasons.includes("duplicate_fov_probe"));
  }
});

// --- 19. No Type A / calibration data can enter capture ---------------------

test("no Type A dimensions, aspect data, FOV values, corridors, confidence, or calibration state seed successful output", () => {
  const result = captureTypeBSnapshotAndCoverage(buildInput());
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  const forbidden = [
    "dimensions",
    "aspectGrid",
    "fovRange",
    "fovStep",
    "corridor",
    "corridors",
    "confidence",
    "calibration",
    "calibrationState",
    "root",
    "branch",
    "rank",
    "score",
    "winner",
    "recommendation",
    "selected",
    "preview",
    "load",
    "apply",
    "diagnosticResult",
  ];
  for (const key of forbidden) {
    assert.equal((result as Record<string, unknown>)[key], undefined);
    assert.equal((result.snapshot as unknown as Record<string, unknown>)[key], undefined);
    assert.equal((result.coverage as unknown as Record<string, unknown>)[key], undefined);
  }
});

// --- 20. Refusal has no snapshot/coverage/identity; success has empty refusals

test("refusal result has no snapshot/coverage/identity keys; success has empty refusal reasons", () => {
  const refused = captureTypeBSnapshotAndCoverage(
    buildInput({ actualTypeAContext: "type_a_strong_support" })
  );
  assert.equal(refused.status, "refused");
  if (refused.status === "refused") {
    assert.ok(!("snapshot" in refused));
    assert.ok(!("coverage" in refused));
    assert.ok(!("identity" in refused));
    assert.ok(refused.refusalReasons.length > 0);
  }

  const captured = captureTypeBSnapshotAndCoverage(buildInput());
  assert.equal(captured.status, "captured");
  if (captured.status === "captured") {
    assert.deepEqual(captured.refusalReasons, []);
  }
});

// --- 21 & 22. Import containment (source inspection) ------------------------

test("capture module imports only approved pure Type B contracts and no B3C/B3D implementation", () => {
  const specifierRegex = /from\s+"([^"]+)"/g;
  const specifiers = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = specifierRegex.exec(MODULE_SOURCE)) !== null) {
    specifiers.add(match[1]);
  }
  const allowed = new Set([
    "./type-b-capture-contract",
    "./type-b-evaluator-contract",
    "./type-b-evidence-types",
    "./type-b-tuple-generation",
    "./type-b-test-handoff-override",
  ]);
  for (const spec of specifiers) {
    assert.ok(allowed.has(spec), `unexpected import specifier: ${spec}`);
  }

  // The B3C tuple-generation FUNCTION is never imported or called.
  assert.ok(
    !/generateTypeBBoundedDiagnosticTuples/.test(MODULE_SOURCE),
    "capture must not import or call the B3C generator"
  );
  // No B3D leaf modules.
  for (const forbidden of [
    "type-b-p3p-diagnostic-evaluation",
    "type-b-p3p-branch-association",
    "type-b-frame-truncation-compatibility",
    "type-b-diagnostic-run-assembly",
  ]) {
    assert.ok(
      !MODULE_SOURCE.includes(forbidden),
      `forbidden B3D import present: ${forbidden}`
    );
  }
});

test("capture module has no forbidden runtime dependency and data-shape imports are import type", () => {
  for (const forbidden of [
    "react",
    "three",
    "next/",
    "type-a",
    "homography",
    "solve",
    "calibrat",
    "persist",
    "/api/",
    "konva",
    "zustand",
  ]) {
    assert.ok(
      !MODULE_SOURCE.toLowerCase().includes(`"${forbidden}`),
      `forbidden import fragment present: ${forbidden}`
    );
  }

  // Exactly four VALUE import statements (the three prior approved runtime
  // imports plus the B3F-O effective-context resolver); every other import is
  // `import type`.
  const valueImports = MODULE_SOURCE.split("\n").filter(
    (line) => /^\s*import\s*\{/.test(line) && !/^\s*import\s+type/.test(line)
  );
  assert.equal(valueImports.length, 4);
});

// --- 23. Malformed runtime input safety -------------------------------------

test("malformed runtime inputs are non-throwing, deterministic, non-mutating, and never succeed", () => {
  const malformed: unknown[] = [null, undefined, 5, "x", true, [], {}, () => {}];
  for (const bad of malformed) {
    const a = captureTypeBSnapshotAndCoverage(bad as never);
    const b = captureTypeBSnapshotAndCoverage(bad as never);
    assert.equal(a.status, "refused");
    assert.deepEqual(a, b);
    if (a.status === "refused") {
      assert.ok(a.refusalReasons.length > 0);
      assert.ok(a.refusalReasons.includes("invalid_snapshot_basis"));
    }
  }
});

// --- 24. Inputs and nested objects unchanged after success and refusal ------

test("inputs and nested arrays/objects remain unchanged after both success and refusal", () => {
  const success = buildInput({
    rearSeam: { ...buildRearSeam(), notes: "n1" },
    strongSideSeam: { ...buildSideSeam(), notes: "n2" },
  });
  const successBefore = structuredClone(success);
  captureTypeBSnapshotAndCoverage(success);
  assert.deepEqual(success, successBefore);

  const refusal = buildInput({ actualTypeAContext: "type_a_strong_support" });
  const refusalBefore = structuredClone(refusal);
  captureTypeBSnapshotAndCoverage(refusal);
  assert.deepEqual(refusal, refusalBefore);
});

// --- B3F-O. Lab-only Type B test-handoff override ---------------------------

test("a non-exhausted actual Type A context without override still refuses with type_a_context_not_exhausted_handoff", () => {
  for (const ctx of [
    "type_a_not_run_or_unknown",
    "type_a_strong_support",
    "type_a_weak_support",
    "type_a_investigation_case",
  ] as const) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({ actualTypeAContext: ctx, testHandoffOverride: null })
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(
      result.refusalReasons.includes("type_a_context_not_exhausted_handoff")
    );
  }
});

test("a valid test override lets a non-exhausted actual Type A context capture when all other Type B conditions are valid", () => {
  for (const ctx of [
    "type_a_not_run_or_unknown",
    "type_a_strong_support",
    "type_a_weak_support",
    "type_a_investigation_case",
  ] as const) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({
        actualTypeAContext: ctx,
        testHandoffOverride: buildTestOverride(),
      })
    );
    assert.equal(result.status, "captured", `ctx=${ctx}`);
  }
});

test("a successful override capture snapshot carries the EFFECTIVE exhausted typeAContext", () => {
  const result = captureTypeBSnapshotAndCoverage(
    buildInput({
      actualTypeAContext: "type_a_weak_support",
      testHandoffOverride: buildTestOverride(),
    })
  );
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  assert.equal(
    result.snapshot.typeAContext,
    "type_a_exhausted_handoff_candidate"
  );
});

test("a successful override capture carries exact lab_test_handoff_override provenance with the actual context preserved", () => {
  const result = captureTypeBSnapshotAndCoverage(
    buildInput({
      actualTypeAContext: "type_a_investigation_case",
      testHandoffOverride: buildTestOverride(),
    })
  );
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  assert.deepEqual(result.typeAHandoffProvenance, {
    kind: "lab_test_handoff_override",
    actualTypeAContext: "type_a_investigation_case",
    effectiveTypeAContext: "type_a_exhausted_handoff_candidate",
    labTestOverrideActive: true,
    overrideSchema: TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA,
  });
});

test("a genuine exhausted capture carries exact actual_type_a_exhausted_handoff provenance, even if an override is supplied", () => {
  for (const override of [null, buildTestOverride()]) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({
        actualTypeAContext: "type_a_exhausted_handoff_candidate",
        testHandoffOverride: override,
      })
    );
    assert.equal(result.status, "captured");
    if (result.status !== "captured") continue;
    assert.deepEqual(result.typeAHandoffProvenance, {
      kind: "actual_type_a_exhausted_handoff",
      actualTypeAContext: "type_a_exhausted_handoff_candidate",
      effectiveTypeAContext: "type_a_exhausted_handoff_candidate",
      labTestOverrideActive: false,
    });
  }
});

test("an override never bypasses ineligible B1, invalid basis, endpoint-role refusal, or invalid coverage", () => {
  const override = buildTestOverride();
  const actualTypeAContext = "type_a_strong_support" as const;

  // Non-eligible B1.
  const badB1 = captureTypeBSnapshotAndCoverage(
    buildInput({
      actualTypeAContext,
      testHandoffOverride: override,
      b1Qualification: { ...buildB1(), status: "type_b_diagnostic_ineligible" } as never,
    })
  );
  assert.equal(badB1.status, "refused");
  if (badB1.status === "refused") {
    assert.ok(badB1.refusalReasons.includes("type_b_not_qualified"));
    // The override cleared the handoff gate; only B1 remains.
    assert.ok(
      !badB1.refusalReasons.includes("type_a_context_not_exhausted_handoff")
    );
  }

  // Invalid basis.
  const badBasis = captureTypeBSnapshotAndCoverage(
    buildInput({
      actualTypeAContext,
      testHandoffOverride: override,
      basis: { ...buildBasis(), sourceFrameKey: "" } as never,
    })
  );
  assert.equal(badBasis.status, "refused");
  if (badBasis.status === "refused") {
    assert.ok(badBasis.refusalReasons.includes("invalid_snapshot_basis"));
  }

  // Endpoint-role refusal (frame_truncated terminus not contacting the frame).
  const badRole = captureTypeBSnapshotAndCoverage(
    buildInput({
      actualTypeAContext,
      testHandoffOverride: override,
      strongSideSeam: {
        ...buildSideSeam(),
        endEndpointStatus: "frame_truncated",
        endFrameContact: "no_frame_contact",
      },
    })
  );
  assert.equal(badRole.status, "refused");
  if (badRole.status === "refused") {
    assert.ok(
      badRole.refusalReasons.includes(
        "frame_truncated_side_terminus_not_contacts_frame"
      )
    );
  }

  // Invalid world width / aspects / product / FOV.
  const badCoverage = captureTypeBSnapshotAndCoverage(
    buildInput({
      actualTypeAContext,
      testHandoffOverride: override,
      explicitInputs: {
        ...buildExplicitInputs(),
        worldWidth: -1,
        authorizedAspectRatios: [1.0, Number.NaN, 2.0],
        primaryProductClasses: [],
        fovProbesDeg: [],
      },
    })
  );
  assert.equal(badCoverage.status, "refused");
  if (badCoverage.status === "refused") {
    assert.ok(badCoverage.refusalReasons.includes("invalid_world_width"));
    assert.ok(badCoverage.refusalReasons.includes("invalid_floor_assumptions"));
    assert.ok(badCoverage.refusalReasons.includes("no_primary_product_classes"));
    assert.ok(badCoverage.refusalReasons.includes("no_fov_probes"));
  }
});

test("a malformed runtime override never grants a handoff", () => {
  const malformedOverrides: unknown[] = [
    { schema: "wrong-schema", enabled: true },
    { schema: TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA, enabled: false },
    { schema: TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA },
    { enabled: true },
    {},
    "on",
    5,
    true,
  ];
  for (const bad of malformedOverrides) {
    const result = captureTypeBSnapshotAndCoverage(
      buildInput({
        actualTypeAContext: "type_a_strong_support",
        testHandoffOverride: bad as never,
      })
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(
      result.refusalReasons.includes("type_a_context_not_exhausted_handoff"),
      `malformed override must not grant handoff: ${JSON.stringify(bad)}`
    );
  }
});

test("override capture is deterministic and non-mutating for both success and refusal", () => {
  const success = buildInput({
    actualTypeAContext: "type_a_weak_support",
    testHandoffOverride: buildTestOverride(),
  });
  const successBefore = structuredClone(success);
  const a = captureTypeBSnapshotAndCoverage(success);
  const b = captureTypeBSnapshotAndCoverage(success);
  assert.deepEqual(a, b);
  assert.deepEqual(success, successBefore);

  const refusal = buildInput({
    actualTypeAContext: "type_a_strong_support",
    testHandoffOverride: { schema: "wrong", enabled: true } as never,
  });
  const refusalBefore = structuredClone(refusal);
  captureTypeBSnapshotAndCoverage(refusal);
  assert.deepEqual(refusal, refusalBefore);
});

// --- 25. Repeat successful capture is deeply equal --------------------------

test("repeat successful capture is deeply equal, including fingerprints, with the same injected timestamp", () => {
  const a = captureTypeBSnapshotAndCoverage(buildInput());
  const b = captureTypeBSnapshotAndCoverage(buildInput());
  assert.deepEqual(a, b);
  if (a.status === "captured" && b.status === "captured") {
    assert.equal(
      a.identity.evidenceFingerprint,
      b.identity.evidenceFingerprint
    );
    assert.equal(
      a.identity.coverageFingerprint,
      b.identity.coverageFingerprint
    );
  }
});
