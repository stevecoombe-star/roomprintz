// --- Phase B3E: Read-Only Type B Diagnostic Run Presentation tests -----------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY
// presentation projection. The presentation module is React-free and pure. It
// projects a committed capture result plus an assembled diagnostic-run envelope
// into safe literal display rows and never surfaces a pose coordinate,
// rotation, score, rank, confidence, selection, recommendation, preview, load,
// Apply, or calibration value. The upstream capture is exercised with the REAL
// committed capture evaluator; envelopes are hand-authored fixtures (the pure
// projection only copies verbatim, so it needs no live solver).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  captureTypeBSnapshotAndCoverage,
  type TypeBSnapshotAndCoverageCaptureInput,
} from "./type-b-capture";
import { TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA } from "./type-b-evaluator-contract";
import type { TypeBEvidenceSnapshot } from "./type-b-evaluator-contract";
import type { TypeBDeclaredLineEvidence } from "./type-b-evidence-types";
import type { TypeBExplicitCaptureInputs } from "./type-b-capture-contract";
import type { TypeBDiagnosticRunAssemblyResult } from "./type-b-diagnostic-run-assembly";

import * as presentationModule from "./type-b-diagnostic-run-presentation";
import { presentTypeBDiagnosticRun } from "./type-b-diagnostic-run-presentation";

// --- Capture fixtures (real committed evaluator) ----------------------------

function buildBasis(): TypeBEvidenceSnapshot["basis"] {
  return {
    sourceImageIdentity: "room.jpg",
    sourceFrameKey: "1000x800",
    sourceFrame: { width: 1000, height: 800 },
    candidateIdentity: "cand-1",
    floorPolygonKey: "poly-1",
  };
}

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

function buildB1(): TypeBEvidenceSnapshot["b1Qualification"] {
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

function buildCaptureInput(
  overrides: Partial<TypeBSnapshotAndCoverageCaptureInput> = {}
): TypeBSnapshotAndCoverageCaptureInput {
  return {
    basis: buildBasis(),
    rearSeam: buildRearSeam(),
    strongSideSeam: buildSideSeam(),
    latentNearCornerCondition: "frame_truncated",
    typeAContext: "type_a_exhausted_handoff_candidate",
    b1Qualification: buildB1(),
    explicitInputs: buildExplicitInputs(),
    capturedAtIso: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function realCaptured() {
  const result = captureTypeBSnapshotAndCoverage(buildCaptureInput());
  assert.equal(result.status, "captured");
  return result;
}

function realRefusal() {
  const result = captureTypeBSnapshotAndCoverage(
    buildCaptureInput({
      explicitInputs: { ...buildExplicitInputs(), worldWidth: -1 },
    })
  );
  assert.equal(result.status, "refused");
  return result;
}

// --- Hand-authored envelope fixtures ----------------------------------------
// The projection copies verbatim, so a hand-authored envelope deterministically
// exercises every branch (generated + refused classes, pose_hypotheses +
// refusal probes, requested / not-requested association, frame-truncation
// records). Pose hypotheses deliberately CARRY `cameraPositionWorld` and
// `worldToCameraRotation` so the tests can prove the projection strips them.

function buildDiagnosticRun(runOverrides: Record<string, unknown> = {}) {
  return {
    schema: "vibode-type-b-p3p-diagnostic/v0",
    snapshotBasis: buildBasis(),
    tupleGeneration: {
      schema: "vibode-type-b-tuple-generation/v0",
      snapshotBasis: buildBasis(),
      status: "generated",
      refusalReasons: [],
      coverage: {
        primaryProductClasses: [],
        fovProbesDeg: [40, 50],
      },
      productClasses: [
        {
          primaryProductClassIdentity: "p-050",
          latentDepthEquivalence: {
            formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
            latentDepthProduct: {
              formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
              value: 0.5,
            },
            equivalenceClassKey: "class-050",
            poseComparisonReferenceFrame: "type_b_junction_anchored/v0",
          },
          status: "generated",
          refusalReasons: [],
          members: [
            {
              floorAspectRatio: 1.0,
              latentSideExtent: 0.5,
              cropCompatibility: "not_evaluated",
              tuples: [
                { tuple: { fovProbeDeg: 40 } },
                { tuple: { fovProbeDeg: 50 } },
              ],
            },
            {
              floorAspectRatio: 2.0,
              latentSideExtent: 0.25,
              cropCompatibility: "not_evaluated",
              tuples: [
                { tuple: { fovProbeDeg: 40 } },
                { tuple: { fovProbeDeg: 50 } },
              ],
            },
          ],
        },
        {
          primaryProductClassIdentity: "p-bad",
          latentDepthEquivalence: null,
          status: "refused",
          refusalReasons: ["invalid_primary_product_class"],
          members: [],
        },
      ],
      summary: {
        requestedPrimaryProductClassCount: 2,
        generatedPrimaryProductClassCount: 1,
        refusedPrimaryProductClassCount: 1,
        generatedAspectMemberCount: 2,
        generatedTupleCount: 4,
      },
    },
    poseProbeResults: [
      {
        poseProbeEquivalence: {
          latentDepthEquivalenceClassKey: "class-050",
          fovProbeDeg: 40,
          poseProbeEquivalenceKey: "ppk-050-40",
        },
        latentDepthEquivalence: {
          equivalenceClassKey: "class-050",
          poseComparisonReferenceFrame: "type_b_junction_anchored/v0",
          latentDepthProduct: {
            formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
            value: 0.5,
          },
        },
        latentDepthProduct: {
          formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
          value: 0.5,
        },
        poseStageResult: {
          kind: "pose_hypotheses",
          hypotheses: [
            {
              hypothesisIndex: 0,
              poseComparisonReferenceFrame: "type_b_junction_anchored/v0",
              cameraPositionWorld: { x: 1.1, y: 2.2, z: 3.3 },
              worldToCameraRotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
              constructionObservations: [
                {
                  kind: "junction_rear_point",
                  residualPx: 0.012,
                  interpretation: "construction_satisfying",
                },
              ],
              plausibility: [
                {
                  checkId: "rotation_numerical_health/v0",
                  state: "passed",
                },
              ],
            },
            {
              hypothesisIndex: 1,
              poseComparisonReferenceFrame: "type_b_junction_anchored/v0",
              cameraPositionWorld: { x: 9.9, y: 8.8, z: 7.7 },
              worldToCameraRotation: [0, 1, 0, 1, 0, 0, 0, 0, 1],
              constructionObservations: [
                {
                  kind: "side_terminus_point",
                  residualPx: null,
                  interpretation: "construction_satisfying",
                },
              ],
              plausibility: [
                {
                  checkId: "image_ray_conditioning/v0",
                  state: "not_evaluated",
                },
              ],
            },
          ],
        },
        rootCensus: {
          algebraicCandidateCount: 4,
          realRootCount: 2,
          positiveDistanceRootCount: 2,
          deduplicatedRootCount: 2,
        },
      },
      {
        poseProbeEquivalence: {
          latentDepthEquivalenceClassKey: "class-050",
          fovProbeDeg: 50,
          poseProbeEquivalenceKey: "ppk-050-50",
        },
        latentDepthEquivalence: {
          equivalenceClassKey: "class-050",
          poseComparisonReferenceFrame: "type_b_junction_anchored/v0",
          latentDepthProduct: {
            formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
            value: 0.5,
          },
        },
        latentDepthProduct: {
          formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
          value: 0.5,
        },
        poseStageResult: {
          kind: "refusal",
          reason: "pose_stage_no_rigid_solution",
        },
        rootCensus: {
          algebraicCandidateCount: 0,
          realRootCount: 0,
          positiveDistanceRootCount: 0,
          deduplicatedRootCount: 0,
        },
      },
    ],
    memberCompatibilityRecords: [],
    branchCorridors: [
      {
        schema: "vibode-type-b-branch-fov-corridor/v0",
        branchIndex: 0,
        poseComparisonReferenceFrame: "type_b_junction_anchored/v0",
        poseProbeRootReferences: [
          {
            poseProbeEquivalenceKey: "ppk-050-40",
            fovProbeDeg: 40,
            hypothesisIndex: 0,
          },
        ],
        associationAnnotations: [
          {
            from: {
              poseProbeEquivalenceKey: "ppk-050-40",
              fovProbeDeg: 40,
              hypothesisIndex: 0,
            },
            to: null,
            state: "unmatched_terminated",
          },
        ],
      },
    ],
    fovTopology: {
      schema: "vibode-type-b-fov-probe-topology/v0",
      orderedProbesDeg: [40, 50],
      stepDeg: 10,
    },
    refusalReasons: [],
    ...runOverrides,
  };
}

function buildFrameTruncation(diagnosticRun: unknown) {
  return {
    schema: "vibode-type-b-frame-truncation-compatibility/v0",
    status: "evaluated",
    diagnosticRun,
    records: [
      {
        primaryProductClassIdentity: "p-050",
        floorAspectRatio: 1.0,
        latentSideExtent: 0.5,
        poseProbeEquivalenceKey: "ppk-050-40",
        hypothesisIndex: 0,
        cropCompatibility: "compatible",
      },
      {
        primaryProductClassIdentity: "p-050",
        floorAspectRatio: 1.0,
        latentSideExtent: 0.5,
        poseProbeEquivalenceKey: "ppk-050-40",
        hypothesisIndex: 1,
        cropCompatibility: "incompatible",
      },
      {
        primaryProductClassIdentity: "p-050",
        floorAspectRatio: 2.0,
        latentSideExtent: 0.25,
        poseProbeEquivalenceKey: "ppk-050-40",
        hypothesisIndex: 0,
        cropCompatibility: "not_evaluated",
      },
      {
        primaryProductClassIdentity: "p-050",
        floorAspectRatio: 2.0,
        latentSideExtent: 0.25,
        poseProbeEquivalenceKey: "ppk-050-40",
        hypothesisIndex: 1,
        cropCompatibility: "not_applicable",
      },
    ],
    notAssessedReasons: [],
  };
}

// Assembled envelope. `requested` toggles whether branch association was asked
// for; `associationOverrides` / `runOverrides` tune refusal / non-assessment.
function buildEnvelope(options: {
  requested: boolean;
  runOverrides?: Record<string, unknown>;
  associationOverrides?: Record<string, unknown>;
}): TypeBDiagnosticRunAssemblyResult {
  const diagnosticRun = buildDiagnosticRun(options.runOverrides);
  const branchAssociation = options.requested
    ? {
        schema: "vibode-type-b-branch-association/v0",
        status: "associated",
        policy: {
          schema: "vibode-type-b-branch-association-policy/v0",
          maxNormalizedCameraPositionDelta: 0.1,
          maxRotationDeltaDeg: 5,
          tieMarginNormalizedCameraPosition: 0.01,
          tieMarginRotationDeg: 0.5,
          nearCoincidentNormalizedCameraPositionDelta: 0.02,
          nearCoincidentRotationDeltaDeg: 1,
        },
        diagnosticRun,
        notAssessedReasons: [],
        ...options.associationOverrides,
      }
    : null;

  return {
    schema: "vibode-type-b-diagnostic-run-assembly/v0",
    p3pDiagnosticRun: diagnosticRun,
    branchAssociation,
    diagnosticRun,
    frameTruncationCompatibility: buildFrameTruncation(diagnosticRun),
  } as unknown as TypeBDiagnosticRunAssemblyResult;
}

const MODULE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "type-b-diagnostic-run-presentation.ts"
);
const MODULE_SOURCE = readFileSync(MODULE_PATH, "utf8");

const FORBIDDEN_TOKENS = [
  "cameraPositionWorld",
  "worldToCameraRotation",
  "translation",
  "projected",
  "sourcePixel",
  "implied",
  "corner",
  "score",
  "confidence",
  "rank",
  "winner",
  "recommended",
  "selected",
  "preview",
  "load",
  "apply",
  "calibration",
];

// --- 1. Runtime export surface ----------------------------------------------

test("presentation runtime surface exports only presentTypeBDiagnosticRun", () => {
  const keys = Object.keys(presentationModule).sort();
  assert.deepEqual(keys, ["presentTypeBDiagnosticRun"]);
  assert.equal(typeof presentTypeBDiagnosticRun, "function");
});

// --- 2. Capture refusal: literal facts only, no snapshot/coverage fields ----

test("capture refusal presentation exposes literal refusal facts and no snapshot/coverage fields", () => {
  const capture = realRefusal();
  const presentation = presentTypeBDiagnosticRun({ capture, envelope: null });
  const c = presentation.capture;
  assert.ok(c);
  assert.equal(c.status, "refused");
  assert.deepEqual(c.refusalLiterals, [...capture.refusalReasons]);
  // No snapshot / coverage-derived field is present on a refusal projection.
  for (const key of [
    "evidenceFingerprint",
    "coverageFingerprint",
    "capturedAtIso",
    "basis",
    "worldWidth",
    "authorizedAspectRatios",
    "productClasses",
    "fovProbesDeg",
  ]) {
    assert.ok(!(key in c), `refusal must not expose ${key}`);
  }
});

// --- 3. Captured: fingerprints, timestamp, basis, authored order ------------

test("captured presentation exposes fingerprints, timestamp, basis, and authored order", () => {
  const capture = realCaptured();
  assert.equal(capture.status, "captured");
  if (capture.status !== "captured") return;
  const presentation = presentTypeBDiagnosticRun({ capture, envelope: null });
  const c = presentation.capture;
  assert.ok(c);
  assert.equal(c.status, "captured");
  if (c.status !== "captured") return;

  assert.equal(c.evidenceFingerprint, capture.identity.evidenceFingerprint);
  assert.equal(c.coverageFingerprint, capture.identity.coverageFingerprint);
  assert.equal(c.capturedAtIso, "2026-07-01T00:00:00.000Z");
  assert.deepEqual(c.basis, {
    sourceImageIdentity: "room.jpg",
    sourceFrameKey: "1000x800",
    sourceFrameWidth: 1000,
    sourceFrameHeight: 800,
    candidateIdentity: "cand-1",
    floorPolygonKey: "poly-1",
  });
  assert.equal(c.worldWidth, 3.2);
  // Authored order preserved exactly.
  assert.deepEqual(c.authorizedAspectRatios, [1.0, 1.5, 2.0]);
  assert.deepEqual(c.fovProbesDeg, [40, 50, 60]);
  assert.deepEqual(
    c.productClasses.map((entry) => entry.primaryProductClassIdentity),
    ["p-050", "p-075"]
  );
  assert.deepEqual(
    c.productClasses.map((entry) => entry.latentDepthProductValue),
    [0.5, 0.75]
  );
});

// --- 4. No-association envelope: no branch corridor section -----------------

test("no-association diagnostic presentation exposes no branch corridor section", () => {
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope: buildEnvelope({ requested: false }),
  });
  assert.equal(presentation.branchCorridors, null);
  assert.ok(presentation.runManifest);
  assert.equal(presentation.runManifest.associationRequested, false);
});

// --- 5. Requested association: B3D-2 status/topology/policy/non-assessment --

test("requested-association presentation shows B3D-2 status/topology/policy/non-assessment facts without selection semantics", () => {
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope: buildEnvelope({
      requested: true,
      associationOverrides: { notAssessedReasons: ["fov_topology_unresolved"] },
    }),
  });
  const b = presentation.branchCorridors;
  assert.ok(b);
  assert.equal(b.status, "associated");
  assert.deepEqual(b.topology, { orderedProbesDeg: [40, 50], stepDeg: 10 });
  assert.ok(b.policy);
  assert.equal(b.policy.maxNormalizedCameraPositionDelta, 0.1);
  assert.equal(b.policy.maxRotationDeltaDeg, 5);
  assert.deepEqual(b.notAssessedLiterals, ["fov_topology_unresolved"]);
  assert.equal(presentation.runManifest?.associationRequested, true);
  // No selection semantics anywhere in the branch section.
  const serialized = JSON.stringify(b).toLowerCase();
  for (const token of ["score", "rank", "confidence", "winner", "selected"]) {
    assert.ok(
      !serialized.includes(token),
      `branch section must not include ${token}`
    );
  }
});

// --- 6. Tuple/member/probe ordering follows upstream order exactly ----------

test("tuple/member/probe ordering follows upstream captured/run order exactly", () => {
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope: buildEnvelope({ requested: false }),
  });
  const classes = presentation.tupleClasses;
  assert.deepEqual(
    classes.map((cls) => cls.primaryProductClassIdentity),
    ["p-050", "p-bad"]
  );
  assert.deepEqual(
    classes.map((cls) => cls.status),
    ["generated", "refused"]
  );
  const generated = classes[0];
  assert.deepEqual(
    generated.members.map((member) => member.memberAspectRatio),
    [1.0, 2.0]
  );
  assert.deepEqual(
    generated.members.map((member) => member.memberLatentSideExtent),
    [0.5, 0.25]
  );
  assert.deepEqual(generated.members[0].probeListDeg, [40, 50]);
  assert.equal(generated.productEquivalenceKey, "class-050");
  assert.equal(generated.primaryLatentDepthProduct, 0.5);
  // Refused class retains its literal facts and a null equivalence key.
  assert.deepEqual(classes[1].refusalLiterals, ["invalid_primary_product_class"]);
  assert.equal(classes[1].productEquivalenceKey, null);
});

// --- 7. P3P: indices + observation labels/states, no pose/rotation fields ---

test("P3P presentation exposes indices and observation labels/states but no pose-coordinate or rotation fields", () => {
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope: buildEnvelope({ requested: false }),
  });
  const probes = presentation.poseProbeOutcomes;
  assert.equal(probes.length, 2);

  const first = probes[0];
  assert.equal(first.productEquivalenceKey, "class-050");
  assert.equal(first.fovProbeDeg, 40);
  assert.equal(first.poseStageKind, "pose_hypotheses");
  assert.deepEqual(first.stageRefusalLiterals, []);
  assert.deepEqual(first.rootCensus, {
    algebraicCandidateCount: 4,
    realRootCount: 2,
    positiveDistanceRootCount: 2,
    deduplicatedRootCount: 2,
  });
  assert.deepEqual(
    first.hypotheses.map((hypothesis) => hypothesis.hypothesisIndex),
    [0, 1]
  );
  assert.deepEqual(first.hypotheses[0].constructionObservations, [
    { label: "junction_rear_point", state: "construction_satisfying", residual: 0.012 },
  ]);
  assert.deepEqual(first.hypotheses[0].plausibilityObservations, [
    { label: "rotation_numerical_health/v0", state: "passed" },
  ]);
  assert.equal(first.hypotheses[1].constructionObservations[0].residual, null);

  // The refusal probe carries its stage refusal literal and no hypotheses.
  const second = probes[1];
  assert.equal(second.poseStageKind, "refusal");
  assert.deepEqual(second.stageRefusalLiterals, ["pose_stage_no_rigid_solution"]);
  assert.deepEqual(second.hypotheses, []);

  // No pose-coordinate or rotation field anywhere in the P3P section.
  const serialized = JSON.stringify(probes);
  assert.ok(!serialized.includes("cameraPositionWorld"));
  assert.ok(!serialized.includes("worldToCameraRotation"));
});

// --- 8. Branch index enumeration-only; no ranking/selection fields ----------

test("branch presentation labels branch index as enumeration only and includes no ranking/selection fields", () => {
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope: buildEnvelope({ requested: true }),
  });
  const branches = presentation.branchCorridors?.branches ?? [];
  assert.equal(branches.length, 1);
  const branch = branches[0];
  assert.equal(branch.branchIndex, 0);
  assert.equal(branch.branchIndexLabel, "Enumeration only");
  assert.deepEqual(branch.rootReferences, [
    { poseProbeEquivalenceKey: "ppk-050-40", fovProbeDeg: 40, hypothesisIndex: 0 },
  ]);
  assert.equal(branch.annotations[0].state, "unmatched_terminated");
  assert.equal(branch.annotations[0].toReference, null);

  const branchKeys = new Set<string>();
  const collectKeys = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collectKeys);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        branchKeys.add(k);
        collectKeys(v);
      }
    }
  };
  collectKeys(branch);
  for (const forbidden of [
    "score",
    "rank",
    "confidence",
    "winner",
    "recommended",
    "recommendation",
    "selected",
    "selection",
  ]) {
    assert.ok(!branchKeys.has(forbidden), `branch must not include ${forbidden} key`);
  }
});

// --- 9. Frame-truncation: only allowed coordinate-free fields ---------------

test("frame-truncation presentation exposes only allowed coordinate-free fields", () => {
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope: buildEnvelope({ requested: false }),
  });
  const frame = presentation.frameTruncation;
  assert.ok(frame);
  assert.equal(frame.status, "evaluated");
  assert.deepEqual(frame.notAssessedLiterals, []);
  assert.equal(frame.records.length, 4);
  for (const record of frame.records) {
    assert.deepEqual(Object.keys(record).sort(), [
      "cropCompatibility",
      "floorAspectRatio",
      "hypothesisIndex",
      "latentSideExtent",
      "poseProbeEquivalenceKey",
      "primaryProductClassIdentity",
    ]);
  }
});

// --- 10. Neutral literal crop-compatibility states --------------------------

test("compatible, incompatible, not_evaluated, and not_applicable remain neutral literal states", () => {
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope: buildEnvelope({ requested: false }),
  });
  const states = (presentation.frameTruncation?.records ?? []).map(
    (record) => record.cropCompatibility
  );
  assert.deepEqual(states, [
    "compatible",
    "incompatible",
    "not_evaluated",
    "not_applicable",
  ]);
});

// --- 11. All run-level and local refusal/non-assessment literals verbatim ----

test("all run-level and local refusal/non-assessment literals are retained verbatim", () => {
  const envelope = buildEnvelope({
    requested: true,
    runOverrides: {
      tupleGeneration: {
        ...buildDiagnosticRun().tupleGeneration,
        status: "refused",
        refusalReasons: ["no_fov_probes", "invalid_floor_assumptions"],
        productClasses: [],
      },
      refusalReasons: ["fov_topology_unresolved"],
    },
    associationOverrides: {
      status: "not_assessed",
      notAssessedReasons: ["invalid_diagnostic_run_linkage"],
    },
  });
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope,
  });
  assert.deepEqual(presentation.runManifest?.tupleGenerationRefusalLiterals, [
    "no_fov_probes",
    "invalid_floor_assumptions",
  ]);
  assert.deepEqual(presentation.runManifest?.runRefusalLiterals, [
    "fov_topology_unresolved",
  ]);
  assert.deepEqual(presentation.branchCorridors?.notAssessedLiterals, [
    "invalid_diagnostic_run_linkage",
  ]);
});

// --- 12. Repeated projection deeply equal; inputs never mutated -------------

test("repeated presentation is deeply equal and does not mutate capture or envelope input", () => {
  const capture = realCaptured();
  const envelope = buildEnvelope({ requested: true });
  const captureBefore = structuredClone(capture);
  const envelopeBefore = structuredClone(envelope);

  const first = presentTypeBDiagnosticRun({ capture, envelope });
  const second = presentTypeBDiagnosticRun({ capture, envelope });
  assert.deepEqual(first, second);

  // Inputs are untouched.
  assert.deepEqual(capture, captureBefore);
  assert.deepEqual(envelope, envelopeBefore);
});

// --- 13. Source / import containment ----------------------------------------

test("source imports are type-only Type B contracts with no React/UI/Type A/solver/calibration/persistence/API dependency", () => {
  const importLines = MODULE_SOURCE.match(
    /^\s*import\b[^\n]*from\s+["'][^"']+["'];?/gm
  );
  assert.ok(importLines && importLines.length > 0, "module must have imports");
  const allowedModules = new Set([
    "./type-b-capture-contract",
    "./type-b-diagnostic-run-assembly",
  ]);
  for (const line of importLines) {
    // Every import is type-only (no runtime dependency).
    assert.ok(/^\s*import\s+type\b/.test(line), `import must be type-only: ${line}`);
    const from = line.match(/from\s+["']([^"']+)["']/);
    assert.ok(from, `import must have a module specifier: ${line}`);
    assert.ok(
      allowedModules.has(from[1]),
      `import module not allowed: ${from[1]}`
    );
  }
  // No forbidden dependency specifiers appear as import sources.
  for (const forbidden of [
    "react",
    "three",
    "next",
    "type-a",
    "solver",
    "calibration",
    "persistence",
    "/api",
    "manual-floor-support",
  ]) {
    for (const line of importLines) {
      assert.ok(
        !line.includes(forbidden),
        `import must not depend on ${forbidden}: ${line}`
      );
    }
  }
});

// --- 14. Forbidden output-key and vocabulary guard --------------------------

test("presentation output contains no forbidden coordinate/authority vocabulary", () => {
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope: buildEnvelope({ requested: true }),
  });
  // The two capture fingerprints are opaque structural identifiers that
  // legitimately embed schema field names (e.g. "latentNearCorner..."). They
  // are not coordinate exposures, so they are excluded from the vocabulary
  // scan; every other emitted field must be forbidden-token-free.
  const scan = JSON.parse(JSON.stringify(presentation));
  if (scan.capture && scan.capture.status === "captured") {
    scan.capture.evidenceFingerprint = "";
    scan.capture.coverageFingerprint = "";
  }
  const serialized = JSON.stringify(scan).toLowerCase();
  for (const token of FORBIDDEN_TOKENS) {
    assert.ok(
      !serialized.includes(token.toLowerCase()),
      `presentation output must not contain "${token}"`
    );
  }
});
