// --- Phase B3G-2: Run-Level Literal Partitions and Refusal Preservation tests --
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-ONLY, READ-ONLY,
// NON-AUTHORITATIVE observation-summary derivation. Fixtures are produced
// through the REAL B3E presentation boundary (`presentTypeBDiagnosticRun`)
// fed by the REAL committed capture evaluator plus hand-authored envelope
// records, exactly as the existing B3E presentation tests do. The B3G
// summary is proven against the presentation layer only — no raw B3D
// envelope is handed to the summary directly.
//
// B3G-2 retains every B3G-1 guard (type-only import boundary, determinism,
// non-mutation, deep freezing, source-order preservation, forbidden-key and
// forbidden-copy containment) and adds: /v1 schema evolution, verbatim
// refusal / non-assessment preservation, tuple-generation reconciliation,
// probe / hypothesis reconciliation, closed four-state plausibility and
// frame-truncation partitions, association containment, and extended
// structural authority guards.

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
import type { TypeBCaptureResult } from "./type-b-capture-contract";
import type { TypeBDiagnosticRunAssemblyResult } from "./type-b-diagnostic-run-assembly";
import {
  presentTypeBDiagnosticRun,
  type TypeBDiagnosticRunPresentation,
} from "./type-b-diagnostic-run-presentation";

import * as summaryModule from "./type-b-observation-summary";
import {
  TYPE_B_OBSERVATION_SUMMARY_SCHEMA,
  deriveTypeBObservationSummary,
  type TypeBObservationSummary,
} from "./type-b-observation-summary";

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
    actualTypeAContext: "type_a_exhausted_handoff_candidate",
    testHandoffOverride: null,
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

function realOverrideCaptured() {
  const result = captureTypeBSnapshotAndCoverage(
    buildCaptureInput({
      actualTypeAContext: "type_a_weak_support",
      testHandoffOverride: {
        schema: "vibode-type-b-test-handoff-override/v0",
        enabled: true,
      },
    })
  );
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

// --- Hand-authored envelope fixtures (fed through the REAL B3E boundary) -----

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
        generatedAspectMemberCount: 1,
        generatedTupleCount: 2,
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
          ],
        },
        rootCensus: {
          algebraicCandidateCount: 4,
          realRootCount: 2,
          positiveDistanceRootCount: 2,
          deduplicatedRootCount: 2,
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

function buildFrameTruncation(
  diagnosticRun: unknown,
  overrides: Record<string, unknown> = {}
) {
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
    ],
    notAssessedReasons: [],
    ...overrides,
  };
}

function buildEnvelope(options: {
  requested: boolean;
  runOverrides?: Record<string, unknown>;
  associationOverrides?: Record<string, unknown>;
  frameTruncationOverrides?: Record<string, unknown>;
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
    frameTruncationCompatibility: buildFrameTruncation(
      diagnosticRun,
      options.frameTruncationOverrides
    ),
  } as unknown as TypeBDiagnosticRunAssemblyResult;
}

// B3G fixtures are always full B3E presentations (the real safe boundary).
function fullPresentation(options?: {
  requested?: boolean;
  override?: boolean;
  runOverrides?: Record<string, unknown>;
  associationOverrides?: Record<string, unknown>;
  frameTruncationOverrides?: Record<string, unknown>;
}): TypeBDiagnosticRunPresentation {
  return presentTypeBDiagnosticRun({
    capture: options?.override ? realOverrideCaptured() : realCaptured(),
    envelope: buildEnvelope({
      requested: options?.requested ?? true,
      runOverrides: options?.runOverrides,
      associationOverrides: options?.associationOverrides,
      frameTruncationOverrides: options?.frameTruncationOverrides,
    }),
  });
}

// A hand-authored pose-probe set with two enumerated-hypothesis probes plus a
// refused pose stage, mixing all four plausibility states across two checks.
function buildMixedPoseProbeResults() {
  const hypothesis = (
    hypothesisIndex: number,
    plausibility: readonly { checkId: string; state: string }[]
  ) => ({
    hypothesisIndex,
    poseComparisonReferenceFrame: "type_b_junction_anchored/v0",
    cameraPositionWorld: { x: 0, y: 1, z: 0 },
    worldToCameraRotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    constructionObservations: [],
    plausibility,
  });
  const probeBase = (fovProbeDeg: number) => ({
    poseProbeEquivalence: {
      latentDepthEquivalenceClassKey: "class-050",
      fovProbeDeg,
      poseProbeEquivalenceKey: `ppk-050-${fovProbeDeg}`,
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
    rootCensus: {
      algebraicCandidateCount: 4,
      realRootCount: 2,
      positiveDistanceRootCount: 2,
      deduplicatedRootCount: 2,
    },
  });
  return [
    {
      ...probeBase(40),
      poseStageResult: {
        kind: "pose_hypotheses",
        hypotheses: [
          hypothesis(0, [
            { checkId: "positive_root_distance/v0", state: "passed" },
            { checkId: "camera_above_floor/v0", state: "failed" },
          ]),
          hypothesis(1, [
            { checkId: "positive_root_distance/v0", state: "not_evaluated" },
            { checkId: "camera_above_floor/v0", state: "not_applicable" },
          ]),
        ],
      },
    },
    {
      ...probeBase(50),
      poseStageResult: {
        kind: "pose_hypotheses",
        hypotheses: [
          hypothesis(0, [
            { checkId: "positive_root_distance/v0", state: "passed" },
            { checkId: "camera_above_floor/v0", state: "passed" },
          ]),
        ],
      },
    },
    {
      ...probeBase(60),
      poseStageResult: {
        kind: "refusal",
        reason: "latent_depth_product_not_positive",
      },
      rootCensus: null,
    },
  ];
}

function mixedPresentation(): TypeBDiagnosticRunPresentation {
  return fullPresentation({
    requested: false,
    runOverrides: { poseProbeResults: buildMixedPoseProbeResults() },
  });
}

// --- Shared guard helpers -----------------------------------------------------

// Case-insensitive forbidden key fragments for the B3G summary output ONLY.
const FORBIDDEN_KEY_FRAGMENTS = [
  "score",
  "confidence",
  "rank",
  "weight",
  "quality",
  "winner",
  "best",
  "recommend",
  "select",
  "prefer",
  "apply",
  "preview",
  "load",
  "ready",
  "usable",
  "viable",
  "approved",
  "camera",
  "calibration",
  "percent",
];

// Prohibited authority language for the serialized B3G summary copy ONLY.
const FORBIDDEN_COPY = [
  "best",
  "winner",
  "recommended",
  "preferred",
  "valid solution",
  "usable",
  "ready",
  "approved",
  "successful",
  "confirmed",
  "matched",
  "camera authority",
  "calibration authority",
  "percentage",
  "success rate",
  "completion score",
];

// Explicit composite / selection field names (spec section I) whose absence
// is asserted against the lowercased serialized summary.
const FORBIDDEN_EXPLICIT_STRINGS = [
  "passedallchecks",
  "allcheckspassed",
  "besthypothesis",
  "bestroot",
  "bestbranch",
  "recommendedfov",
  "recommendedcamera",
  "selectedroot",
  "selectedbranch",
  "previewroot",
  "applycalibration",
];

function collectKeysDeep(value: unknown, keys: Set<string> = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeysDeep(entry, keys);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      collectKeysDeep(v, keys);
    }
  }
  return keys;
}

function assertNoForbiddenKeys(summary: TypeBObservationSummary) {
  const keys = collectKeysDeep(summary);
  for (const key of keys) {
    const lower = key.toLowerCase();
    for (const fragment of FORBIDDEN_KEY_FRAGMENTS) {
      assert.ok(
        !lower.includes(fragment),
        `summary key "${key}" must not contain forbidden fragment "${fragment}"`
      );
    }
  }
}

function assertNoForbiddenCopy(summary: TypeBObservationSummary) {
  const serialized = JSON.stringify(summary).toLowerCase();
  for (const phrase of [...FORBIDDEN_COPY, ...FORBIDDEN_EXPLICIT_STRINGS]) {
    assert.ok(
      !serialized.includes(phrase),
      `serialized summary must not contain "${phrase}"`
    );
  }
}

function deepFreezeInPlace(value: unknown) {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreezeInPlace(entry);
    Object.freeze(value);
  }
  return value;
}

function assertDeepFrozen(value: unknown) {
  if (value && typeof value === "object") {
    assert.ok(Object.isFrozen(value), "summary output must be deeply frozen");
    for (const entry of Object.values(value)) assertDeepFrozen(entry);
  }
}

function assertNumericFree(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(assertNumericFree);
  } else if (value && typeof value === "object") {
    Object.values(value).forEach(assertNumericFree);
  } else {
    assert.notEqual(
      typeof value,
      "number",
      "summary must contain no numeric fact here"
    );
  }
}

function assembledRun(summary: TypeBObservationSummary) {
  assert.equal(summary.run.condition, "assembled");
  if (summary.run.condition !== "assembled") throw new Error("unreachable");
  return summary.run;
}

const EXPECTED_EMPTY: TypeBObservationSummary = {
  schema: "vibode-type-b-observation-summary/v1",
  status: "no_presentation",
  capture: { condition: "absent" },
  run: { condition: "absent" },
  association: { condition: "absent" },
  frameTruncation: { condition: "absent" },
  sourceReferences: {
    sourceImageIdentityRef: null,
    sourceFrameKeyRef: null,
    tupleClassIdentityRefs: [],
  },
};

// --- 1. Schema and empty behavior --------------------------------------------

test("schema literal is the /v1 contract, exported verbatim, and never the /v0 shape", () => {
  assert.equal(
    TYPE_B_OBSERVATION_SUMMARY_SCHEMA,
    "vibode-type-b-observation-summary/v1"
  );
  const summaries = [
    deriveTypeBObservationSummary(null),
    deriveTypeBObservationSummary(fullPresentation()),
  ];
  for (const summary of summaries) {
    assert.equal(summary.schema, "vibode-type-b-observation-summary/v1");
    assert.notEqual(summary.schema, "vibode-type-b-observation-summary/v0");
  }
});

test("null and undefined presentations return the stable no-presentation shape without throwing", () => {
  const fromNull = deriveTypeBObservationSummary(null);
  const fromUndefined = deriveTypeBObservationSummary(undefined);
  assert.deepEqual(fromNull, EXPECTED_EMPTY);
  assert.deepEqual(fromUndefined, EXPECTED_EMPTY);
  assert.deepEqual(fromNull, fromUndefined);
});

test("no-presentation shape manufactures no evaluated-looking fact", () => {
  const summary = deriveTypeBObservationSummary(null);
  // No numeric field exists anywhere (no fake totals or partitions).
  assertNumericFree(summary);
  // No section claims evaluation or non-assessment when nothing existed.
  assert.equal(summary.status, "no_presentation");
  assert.equal(summary.capture.condition, "absent");
  assert.equal(summary.run.condition, "absent");
  assert.equal(summary.association.condition, "absent");
  assert.equal(summary.frameTruncation.condition, "absent");
  const serialized = JSON.stringify(summary).toLowerCase();
  for (const phrase of [
    "hypothes",
    "compatible",
    "evaluated",
    "count",
    "denominator",
    "partition",
    "refusal",
  ]) {
    assert.ok(
      !serialized.includes(phrase),
      `empty summary must not imply evaluation via "${phrase}"`
    );
  }
});

test("runtime export surface is the schema literal plus deriveTypeBObservationSummary only", () => {
  const keys = Object.keys(summaryModule).sort();
  assert.deepEqual(keys, [
    "TYPE_B_OBSERVATION_SUMMARY_SCHEMA",
    "deriveTypeBObservationSummary",
  ]);
  assert.equal(typeof deriveTypeBObservationSummary, "function");
});

test("run-level B3G-2 facts appear only for an actual assembled diagnostic presentation", () => {
  // Refused capture, no envelope: no run-level fact may exist.
  const captureOnly = deriveTypeBObservationSummary(
    presentTypeBDiagnosticRun({ capture: realRefusal(), envelope: null })
  );
  assert.deepEqual(captureOnly.run, { condition: "absent" });
  const serialized = JSON.stringify(captureOnly).toLowerCase();
  for (const phrase of [
    "tuplegeneration",
    "probefacts",
    "plausibilitypartitions",
    "denominator",
    "recordcount",
  ]) {
    assert.ok(
      !serialized.includes(phrase),
      `capture-only summary must not carry run-level fact "${phrase}"`
    );
  }
  // No false zero totals anywhere outside the assembled arm: the only numeric
  // facts in the whole contract live inside assembled/evaluated arms.
  assertNumericFree(captureOnly);

  // Assembled presentation: run-level facts exist.
  const run = assembledRun(deriveTypeBObservationSummary(fullPresentation()));
  assert.equal(typeof run.tupleGeneration.requestedProductClassCount, "number");
  assert.equal(typeof run.probeFacts.poseProbeCount, "number");
  assert.ok(Array.isArray(run.plausibilityPartitions));
});

// --- 2. Determinism ------------------------------------------------------------

test("repeated derivation from the same input is deeply equal", () => {
  const presentation = fullPresentation();
  const first = deriveTypeBObservationSummary(presentation);
  const second = deriveTypeBObservationSummary(presentation);
  assert.deepEqual(first, second);
});

test("structurally equal cloned inputs produce deeply equal output", () => {
  const presentation = fullPresentation();
  const clone = structuredClone(presentation);
  assert.deepEqual(
    deriveTypeBObservationSummary(presentation),
    deriveTypeBObservationSummary(clone)
  );
});

test("derivation output is independent of when or how often it runs", () => {
  const presentation = fullPresentation({ requested: false });
  const results = [
    deriveTypeBObservationSummary(presentation),
    deriveTypeBObservationSummary(structuredClone(presentation)),
    deriveTypeBObservationSummary(presentation),
  ];
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
  // JSON round-trip is identical: no Date objects, functions, or other
  // non-literal values exist in the output.
  assert.deepEqual(JSON.parse(JSON.stringify(results[0])), results[0]);
});

// --- 3. Non-mutation and freezing ------------------------------------------------

test("derivation from a deep-frozen presentation neither throws nor mutates the input", () => {
  const presentation = fullPresentation({ override: true });
  const before = structuredClone(presentation);
  deepFreezeInPlace(presentation);

  const summary = deriveTypeBObservationSummary(presentation);
  assert.equal(summary.status, "presentation_observed");

  // Input deeply identical afterward; nested arrays/objects unreordered.
  assert.deepEqual(presentation, before);
  assert.deepEqual(
    presentation.tupleClasses.map((cls) => cls.primaryProductClassIdentity),
    before.tupleClasses.map((cls) => cls.primaryProductClassIdentity)
  );
  assert.deepEqual(presentation.poseProbeOutcomes, before.poseProbeOutcomes);
  assert.deepEqual(presentation.branchCorridors, before.branchCorridors);
});

test("summary output is deeply frozen for empty and full derivations", () => {
  assertDeepFrozen(deriveTypeBObservationSummary(null));
  assertDeepFrozen(deriveTypeBObservationSummary(fullPresentation()));
  assertDeepFrozen(deriveTypeBObservationSummary(mixedPresentation()));
});

// --- 4. Type-only safe boundary --------------------------------------------------

const MODULE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "type-b-observation-summary.ts"
);
const MODULE_SOURCE = readFileSync(MODULE_PATH, "utf8");

test("summary module imports are type-only and limited to the B3E presentation contract", () => {
  const importLines = MODULE_SOURCE.match(
    /^\s*import\b[^\n]*from\s+["'][^"']+["'];?/gm
  );
  assert.ok(importLines && importLines.length > 0, "module must have imports");
  for (const line of importLines) {
    assert.ok(
      /^\s*import\s+type\b/.test(line),
      `import must be type-only: ${line}`
    );
    const from = line.match(/from\s+["']([^"']+)["']/);
    assert.ok(from, `import must have a module specifier: ${line}`);
    assert.equal(
      from[1],
      "./type-b-diagnostic-run-presentation",
      `only the presentation contract may be imported: ${from[1]}`
    );
  }
});

test("summary module has no runtime dependency on raw B3D, solver, or lab UI modules", () => {
  for (const forbidden of [
    "type-b-diagnostic-run-assembly",
    "type-b-p3p-diagnostic-evaluation",
    "type-b-p3p-branch-association",
    "type-b-frame-truncation-compatibility",
    "type-b-tuple-generation",
    "type-b-evaluator-contract",
    "ThreeRoomLab",
    "react",
    "three",
    "next",
    "perspective-solve",
    "floor-math",
    "scene-state",
  ]) {
    assert.ok(
      !MODULE_SOURCE.includes(`"${forbidden}"`) &&
        !MODULE_SOURCE.includes(`'${forbidden}'`) &&
        !MODULE_SOURCE.includes(`/${forbidden}"`) &&
        !MODULE_SOURCE.includes(`/${forbidden}'`),
      `summary module must not reference ${forbidden}`
    );
  }
});

test("summary module source uses no time, randomness, locale formatting, sorting, or hooks", () => {
  for (const forbidden of [
    "new Date",
    "Date.now",
    "Math.random",
    "toLocale",
    ".sort(",
    ".reverse(",
    "useMemo",
    "useState",
    "useEffect",
  ]) {
    assert.ok(
      !MODULE_SOURCE.includes(forbidden),
      `summary module must not use ${forbidden}`
    );
  }
});

// --- 5. Provenance safety --------------------------------------------------------

test("actual (non-override) handoff provenance passes through verbatim", () => {
  const presentation = fullPresentation({ override: false });
  const summary = deriveTypeBObservationSummary(presentation);
  assert.equal(summary.capture.condition, "captured");
  if (summary.capture.condition !== "captured") return;
  const captured = presentation.capture;
  assert.ok(captured && captured.status === "captured");
  if (!captured || captured.status !== "captured") return;
  // Verbatim, field-for-field pass-through of the B3E provenance facts.
  assert.deepEqual(
    summary.capture.typeAHandoffProvenance,
    captured.typeAHandoffProvenance
  );
  assert.equal(summary.capture.typeAHandoffProvenance.labTestOverrideActive, false);
  const run = assembledRun(summary);
  assert.equal(run.labTestOverrideActive, false);
  assert.equal(run.actualTypeAContext, presentation.runManifest?.actualTypeAContext);
  assert.equal(
    run.effectiveTypeAContext,
    presentation.runManifest?.effectiveTypeAContext
  );
});

test("lab test-handoff override provenance passes through literally without reinterpretation", () => {
  const presentation = fullPresentation({ override: true });
  const summary = deriveTypeBObservationSummary(presentation);
  assert.equal(summary.capture.condition, "captured");
  if (summary.capture.condition !== "captured") return;
  assert.deepEqual(summary.capture.typeAHandoffProvenance, {
    kind: "lab_test_handoff_override",
    actualTypeAContext: "type_a_weak_support",
    effectiveTypeAContext: "type_a_exhausted_handoff_candidate",
    labTestOverrideActive: true,
    overrideSchema: "vibode-type-b-test-handoff-override/v0",
  });
  // The actual Type A context is NOT rewritten to look exhausted/qualified.
  assert.equal(
    summary.capture.typeAHandoffProvenance.actualTypeAContext,
    "type_a_weak_support"
  );
  const run = assembledRun(summary);
  assert.equal(run.labTestOverrideActive, true);
  assert.equal(run.handoffKind, "lab_test_handoff_override");
});

test("summary contains no freshness/staleness verdict and no Type A qualification wording", () => {
  for (const override of [false, true]) {
    const summary = deriveTypeBObservationSummary(fullPresentation({ override }));
    const keys = collectKeysDeep(summary);
    for (const key of keys) {
      const lower = key.toLowerCase();
      for (const fragment of ["fresh", "stale", "aged", "expired", "verdict"]) {
        assert.ok(
          !lower.includes(fragment),
          `summary must not carry freshness/staleness key "${key}"`
        );
      }
    }
    const serialized = JSON.stringify(summary).toLowerCase();
    for (const phrase of [
      "type_a_qualified",
      "qualified",
      "genuine",
      "authoritative",
    ]) {
      assert.ok(
        !serialized.includes(phrase),
        `summary copy must not convert the override into qualification via "${phrase}"`
      );
    }
  }
});

// --- 6. Forbidden-field / forbidden-copy guard ------------------------------------

test("summary output keys contain no forbidden score/recommendation/action fragments", () => {
  for (const summary of [
    deriveTypeBObservationSummary(null),
    deriveTypeBObservationSummary(fullPresentation({ requested: false })),
    deriveTypeBObservationSummary(fullPresentation({ requested: true })),
    deriveTypeBObservationSummary(fullPresentation({ override: true })),
    deriveTypeBObservationSummary(mixedPresentation()),
  ]) {
    assertNoForbiddenKeys(summary);
  }
});

test("serialized summary copy contains no prohibited authority language", () => {
  for (const summary of [
    deriveTypeBObservationSummary(null),
    deriveTypeBObservationSummary(fullPresentation({ requested: false })),
    deriveTypeBObservationSummary(fullPresentation({ requested: true })),
    deriveTypeBObservationSummary(fullPresentation({ override: true })),
    deriveTypeBObservationSummary(mixedPresentation()),
    deriveTypeBObservationSummary(
      fullPresentation({
        requested: true,
        associationOverrides: {
          status: "not_assessed",
          notAssessedReasons: ["invalid_diagnostic_run_linkage"],
        },
      })
    ),
  ]) {
    assertNoForbiddenCopy(summary);
  }
});

test("raw B3D-2 'associated' status never appears as a summary condition", () => {
  const summary = deriveTypeBObservationSummary(
    fullPresentation({ requested: true })
  );
  assert.equal(summary.association.condition, "evaluated");
  const serialized = JSON.stringify(summary).toLowerCase();
  assert.ok(
    !serialized.includes("associated"),
    "summary must not expose the raw 'associated' status"
  );
});

test("association condition is a closed union across requested/not-requested/not-assessed", () => {
  const notRequested = deriveTypeBObservationSummary(
    fullPresentation({ requested: false })
  );
  assert.equal(notRequested.association.condition, "not_requested");

  const notAssessed = deriveTypeBObservationSummary(
    fullPresentation({
      requested: true,
      associationOverrides: {
        status: "not_assessed",
        notAssessedReasons: ["invalid_diagnostic_run_linkage"],
      },
    })
  );
  assert.equal(notAssessed.association.condition, "not_assessed");

  const evaluated = deriveTypeBObservationSummary(
    fullPresentation({ requested: true })
  );
  assert.equal(evaluated.association.condition, "evaluated");
});

test("refused-capture presentation yields the refused condition with its verbatim literals only", () => {
  const presentation = presentTypeBDiagnosticRun({
    capture: realRefusal(),
    envelope: null,
  });
  const summary = deriveTypeBObservationSummary(presentation);
  assert.equal(summary.status, "presentation_observed");
  const sourceLiterals =
    presentation.capture && presentation.capture.status === "refused"
      ? presentation.capture.refusalLiterals
      : [];
  assert.ok(sourceLiterals.length > 0, "real refusal must carry literals");
  // The refused arm carries the verbatim literals and nothing else.
  assert.deepEqual(summary.capture, {
    condition: "refused",
    refusalLiterals: [...sourceLiterals],
  });
  assert.equal(summary.run.condition, "absent");
  assert.equal(summary.association.condition, "absent");
  assert.equal(summary.frameTruncation.condition, "absent");
  assert.deepEqual(summary.sourceReferences, {
    sourceImageIdentityRef: null,
    sourceFrameKeyRef: null,
    tupleClassIdentityRefs: [],
  });
  assertNoForbiddenKeys(summary);
  assertNoForbiddenCopy(summary);
});

// --- 7. Source-order containment -----------------------------------------------

test("opaque tuple-class references preserve exact presentation source order", () => {
  const presentation = fullPresentation();
  const summary = deriveTypeBObservationSummary(presentation);
  assert.deepEqual(
    summary.sourceReferences.tupleClassIdentityRefs,
    presentation.tupleClasses.map((cls) => cls.primaryProductClassIdentity)
  );
});

test("a superficially favorable class later in source order is not moved forward", () => {
  // The refused class comes FIRST and the generated ("favorable-looking")
  // class comes SECOND in raw source order. The summary must keep that order.
  const base = buildDiagnosticRun();
  const tupleGeneration = base.tupleGeneration as unknown as {
    productClasses: unknown[];
  };
  const reordered = {
    ...base.tupleGeneration,
    productClasses: [...tupleGeneration.productClasses].reverse(),
  };
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope: buildEnvelope({
      requested: false,
      runOverrides: { tupleGeneration: reordered },
    }),
  });
  assert.deepEqual(
    presentation.tupleClasses.map((cls) => cls.primaryProductClassIdentity),
    ["p-bad", "p-050"]
  );
  const summary = deriveTypeBObservationSummary(presentation);
  assert.deepEqual(summary.sourceReferences.tupleClassIdentityRefs, [
    "p-bad",
    "p-050",
  ]);
  // Counts are order-independent while refusal records keep source position.
  const run = assembledRun(summary);
  assert.equal(run.tupleGeneration.requestedProductClassCount, 2);
  assert.equal(run.tupleGeneration.generatedProductClassCount, 1);
  assert.equal(run.tupleGeneration.refusedProductClassCount, 1);
  assert.deepEqual(run.tupleGeneration.classRefusalRecords, [
    {
      classIdentityRef: "p-bad",
      refusalLiterals: ["invalid_primary_product_class"],
    },
  ]);
});

test("summary carries no numeric ordering or ranking-friendly field", () => {
  for (const summary of [
    deriveTypeBObservationSummary(fullPresentation()),
    deriveTypeBObservationSummary(mixedPresentation()),
  ]) {
    const keys = collectKeysDeep(summary);
    for (const key of keys) {
      const lower = key.toLowerCase();
      for (const fragment of ["order", "position", "index", "sorted"]) {
        assert.ok(
          !lower.includes(fragment),
          `summary must not carry ordering key "${key}"`
        );
      }
    }
  }
});

// --- 8. Refusal preservation (B3G-2) --------------------------------------------

test("capture refusal literals survive verbatim, source ordered, and undeduplicated", () => {
  // Hand-authored refused capture record fed through the REAL B3E boundary,
  // with a deliberate duplicate and non-alphabetical order.
  const refusedCapture = {
    status: "refused",
    refusalReasons: [
      "world_width_not_positive",
      "world_width_not_positive",
      "frame_key_missing",
    ],
  } as unknown as TypeBCaptureResult;
  const presentation = presentTypeBDiagnosticRun({
    capture: refusedCapture,
    envelope: null,
  });
  const summary = deriveTypeBObservationSummary(presentation);
  assert.equal(summary.capture.condition, "refused");
  if (summary.capture.condition !== "refused") return;
  assert.deepEqual(summary.capture.refusalLiterals, [
    "world_width_not_positive",
    "world_width_not_positive",
    "frame_key_missing",
  ]);
});

test("tuple-generation run-level refusal literals survive verbatim with honest zero counts", () => {
  const summary = deriveTypeBObservationSummary(
    fullPresentation({
      requested: false,
      runOverrides: {
        tupleGeneration: {
          schema: "vibode-type-b-tuple-generation/v0",
          snapshotBasis: buildBasis(),
          status: "refused",
          refusalReasons: [
            "no_authorized_aspect",
            "no_authorized_aspect",
            "world_width_not_positive",
          ],
          coverage: { primaryProductClasses: [], fovProbesDeg: [] },
          productClasses: [],
        },
        poseProbeResults: [],
      },
    })
  );
  const run = assembledRun(summary);
  assert.equal(run.tupleGeneration.status, "refused");
  // Verbatim, ordered, undeduplicated — never replaced by a bare count.
  assert.deepEqual(run.tupleGeneration.refusalLiterals, [
    "no_authorized_aspect",
    "no_authorized_aspect",
    "world_width_not_positive",
  ]);
  // Zeroes are honest here: the run exists and the refused status makes the
  // empty class list literal.
  assert.equal(run.tupleGeneration.requestedProductClassCount, 0);
  assert.equal(run.tupleGeneration.generatedProductClassCount, 0);
  assert.equal(run.tupleGeneration.refusedProductClassCount, 0);
  assert.equal(run.tupleGeneration.memberCount, 0);
  assert.equal(run.tupleGeneration.tupleCount, 0);
});

test("refused product-class literals keep their owning class identity reference", () => {
  const run = assembledRun(deriveTypeBObservationSummary(fullPresentation()));
  // Scope-honest: the class refusal is attributed to its class, never
  // presented as a whole-run refusal.
  assert.deepEqual(run.tupleGeneration.classRefusalRecords, [
    {
      classIdentityRef: "p-bad",
      refusalLiterals: ["invalid_primary_product_class"],
    },
  ]);
  // The run-level refusal lists remain empty for this fixture.
  assert.deepEqual(run.tupleGeneration.refusalLiterals, []);
  assert.deepEqual(run.refusalLiterals, []);
});

test("diagnostic-run refusal literals survive verbatim and undeduplicated", () => {
  const summary = deriveTypeBObservationSummary(
    fullPresentation({
      requested: false,
      runOverrides: {
        refusalReasons: [
          "pose_stage_exhausted",
          "pose_stage_exhausted",
          "tuple_generation_refused",
        ],
      },
    })
  );
  const run = assembledRun(summary);
  assert.deepEqual(run.refusalLiterals, [
    "pose_stage_exhausted",
    "pose_stage_exhausted",
    "tuple_generation_refused",
  ]);
});

test("association and frame-truncation non-assessment literals survive verbatim", () => {
  const summary = deriveTypeBObservationSummary(
    fullPresentation({
      requested: true,
      associationOverrides: {
        status: "not_assessed",
        notAssessedReasons: [
          "reason_b",
          "reason_a",
          "reason_a",
        ],
      },
      frameTruncationOverrides: {
        status: "not_assessed",
        notAssessedReasons: [
          "diagnostic_run_missing_pose_hypotheses",
          "diagnostic_run_missing_pose_hypotheses",
        ],
        records: [],
      },
    })
  );
  assert.deepEqual(summary.association, {
    condition: "not_assessed",
    notAssessedLiterals: ["reason_b", "reason_a", "reason_a"],
  });
  assert.deepEqual(summary.frameTruncation, {
    condition: "not_assessed",
    notAssessedLiterals: [
      "diagnostic_run_missing_pose_hypotheses",
      "diagnostic_run_missing_pose_hypotheses",
    ],
  });
});

test("non-assessment is never transformed into failure and literal lists are never count-only", () => {
  const summary = deriveTypeBObservationSummary(
    fullPresentation({
      requested: true,
      associationOverrides: {
        status: "not_assessed",
        notAssessedReasons: ["invalid_diagnostic_run_linkage"],
      },
      frameTruncationOverrides: {
        status: "not_assessed",
        notAssessedReasons: ["diagnostic_run_missing_pose_hypotheses"],
        records: [],
      },
    })
  );
  // Non-assessment stays "not_assessed": no failure wording anywhere in
  // either non-assessed section.
  for (const section of [summary.association, summary.frameTruncation]) {
    assert.equal(section.condition, "not_assessed");
    const serialized = JSON.stringify(section).toLowerCase();
    for (const phrase of ["fail", "error", "invalid_run", "broken"]) {
      assert.ok(
        !serialized.includes(phrase),
        `non-assessed section must not read as failure via "${phrase}"`
      );
    }
  }
  // Literal lists exist as real arrays next to any counts; a count never
  // replaces them.
  const run = assembledRun(summary);
  assert.ok(Array.isArray(run.tupleGeneration.refusalLiterals));
  assert.ok(Array.isArray(run.refusalLiterals));
  assert.ok(Array.isArray(run.probeFacts.poseStageRefusalLiterals));
  assert.ok(
    summary.frameTruncation.condition === "not_assessed" &&
      Array.isArray(summary.frameTruncation.notAssessedLiterals)
  );
});

// --- 9. Tuple-generation reconciliation (B3G-2) ----------------------------------

test("requested = generated + refused and member/tuple totals match source facts", () => {
  const presentation = fullPresentation();
  const run = assembledRun(deriveTypeBObservationSummary(presentation));
  const facts = run.tupleGeneration;
  assert.equal(facts.status, "generated");
  assert.equal(
    facts.requestedProductClassCount,
    facts.generatedProductClassCount + facts.refusedProductClassCount
  );
  assert.equal(facts.requestedProductClassCount, presentation.tupleClasses.length);
  assert.equal(
    facts.memberCount,
    presentation.tupleClasses.reduce((total, cls) => total + cls.members.length, 0)
  );
  assert.equal(
    facts.tupleCount,
    presentation.tupleClasses.reduce(
      (total, cls) =>
        total +
        cls.members.reduce(
          (memberTotal, member) => memberTotal + member.probeListDeg.length,
          0
        ),
      0
    )
  );
});

test("recounted presentation facts reconcile with the stored B3C summary in the source envelope", () => {
  // B3E does NOT project the stored B3C tupleGeneration.summary, so the B3G
  // counts are recounts of presentation records. This test proves the recount
  // agrees with the stored source-of-truth values rather than silently
  // diverging from them.
  const envelope = buildEnvelope({ requested: false });
  const presentation = presentTypeBDiagnosticRun({
    capture: realCaptured(),
    envelope,
  });
  const run = assembledRun(deriveTypeBObservationSummary(presentation));
  const stored = (
    envelope as unknown as {
      diagnosticRun: {
        tupleGeneration: {
          summary: {
            requestedPrimaryProductClassCount: number;
            generatedPrimaryProductClassCount: number;
            refusedPrimaryProductClassCount: number;
            generatedAspectMemberCount: number;
            generatedTupleCount: number;
          };
        };
      };
    }
  ).diagnosticRun.tupleGeneration.summary;
  assert.equal(
    run.tupleGeneration.requestedProductClassCount,
    stored.requestedPrimaryProductClassCount
  );
  assert.equal(
    run.tupleGeneration.generatedProductClassCount,
    stored.generatedPrimaryProductClassCount
  );
  assert.equal(
    run.tupleGeneration.refusedProductClassCount,
    stored.refusedPrimaryProductClassCount
  );
  assert.equal(run.tupleGeneration.memberCount, stored.generatedAspectMemberCount);
  assert.equal(run.tupleGeneration.tupleCount, stored.generatedTupleCount);
});

test("a refused class does not disappear because another class was generated", () => {
  const run = assembledRun(deriveTypeBObservationSummary(fullPresentation()));
  assert.equal(run.tupleGeneration.generatedProductClassCount, 1);
  assert.equal(run.tupleGeneration.refusedProductClassCount, 1);
  assert.equal(run.tupleGeneration.classRefusalRecords.length, 1);
  assert.equal(
    run.tupleGeneration.classRefusalRecords[0].classIdentityRef,
    "p-bad"
  );
});

// --- 10. Probe and hypothesis reconciliation (B3G-2) -----------------------------

test("pose-probe and enumerated-hypothesis totals reconcile to the presentation", () => {
  const presentation = mixedPresentation();
  const run = assembledRun(deriveTypeBObservationSummary(presentation));
  assert.equal(run.probeFacts.poseProbeCount, presentation.poseProbeOutcomes.length);
  assert.equal(run.probeFacts.poseProbeCount, 3);
  assert.equal(
    run.probeFacts.enumeratedHypothesisCount,
    presentation.poseProbeOutcomes.reduce(
      (total, probe) => total + probe.hypotheses.length,
      0
    )
  );
  assert.equal(run.probeFacts.enumeratedHypothesisCount, 3);
});

test("pose-stage refusals are counted and preserved without fabricating hypotheses", () => {
  const presentation = mixedPresentation();
  const run = assembledRun(deriveTypeBObservationSummary(presentation));
  assert.equal(run.probeFacts.poseStageRefusalCount, 1);
  assert.deepEqual(run.probeFacts.poseStageRefusalLiterals, [
    "latent_depth_product_not_positive",
  ]);
  // The refused stage contributes zero hypotheses: the enumerated total is
  // exactly the hypotheses of the two pose_hypotheses stages.
  assert.equal(run.probeFacts.enumeratedHypothesisCount, 3);
});

test("authored FOV-probe facts are counts only and no FOV value or identifier leaks", () => {
  const presentation = fullPresentation();
  const summary = deriveTypeBObservationSummary(presentation);
  const run = assembledRun(summary);
  const captured = presentation.capture;
  assert.ok(captured && captured.status === "captured");
  if (!captured || captured.status !== "captured") return;
  assert.equal(run.probeFacts.authoredFovProbeCount, captured.fovProbesDeg.length);
  assert.equal(run.probeFacts.authoredFovProbeCount, 3);
  // No numeric array (probe list, pose, rotation) exists anywhere in the
  // summary; the only "fov" key is the count.
  const scanForNumericArrays = (value: unknown): void => {
    if (Array.isArray(value)) {
      assert.ok(
        !value.some((entry) => typeof entry === "number"),
        "summary must not carry a numeric list"
      );
      value.forEach(scanForNumericArrays);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(scanForNumericArrays);
    }
  };
  scanForNumericArrays(summary);
  const fovKeys = [...collectKeysDeep(summary)].filter((key) =>
    key.toLowerCase().includes("fov")
  );
  assert.deepEqual(fovKeys, ["authoredFovProbeCount"]);
  // No root / equivalence / degree identifier keys exist.
  for (const key of collectKeysDeep(summary)) {
    const lower = key.toLowerCase();
    for (const fragment of ["root", "equivalence", "deg", "residual", "pose_"]) {
      assert.ok(
        !lower.includes(fragment),
        `summary must not carry identifier key "${key}"`
      );
    }
  }
});

test("no-presentation and no-run summaries carry no false zero totals", () => {
  assertNumericFree(deriveTypeBObservationSummary(null));
  assertNumericFree(
    deriveTypeBObservationSummary(
      presentTypeBDiagnosticRun({ capture: realRefusal(), envelope: null })
    )
  );
});

// --- 11. Plausibility partition correctness (B3G-2) ------------------------------

test("every projected check yields a complete four-state partition summing to its denominator", () => {
  const run = assembledRun(deriveTypeBObservationSummary(mixedPresentation()));
  assert.equal(run.plausibilityPartitions.length, 2);
  for (const partition of run.plausibilityPartitions) {
    assert.equal(typeof partition.checkId, "string");
    const states = partition.states;
    assert.deepEqual(Object.keys(states), [
      "passed",
      "failed",
      "not_evaluated",
      "not_applicable",
    ]);
    for (const count of Object.values(states)) {
      assert.ok(Number.isInteger(count) && count >= 0);
    }
    assert.equal(
      states.passed + states.failed + states.not_evaluated + states.not_applicable,
      partition.denominator
    );
    // Every hypothesis carries every check in this fixture, so each check
    // denominator reconciles to the total enumerated hypotheses.
    assert.equal(partition.denominator, run.probeFacts.enumeratedHypothesisCount);
  }
  const byCheckId = new Map(
    run.plausibilityPartitions.map((partition) => [partition.checkId, partition])
  );
  assert.deepEqual(byCheckId.get("positive_root_distance/v0")?.states, {
    passed: 2,
    failed: 0,
    not_evaluated: 1,
    not_applicable: 0,
  });
  assert.deepEqual(byCheckId.get("camera_above_floor/v0")?.states, {
    passed: 1,
    failed: 1,
    not_evaluated: 0,
    not_applicable: 1,
  });
});

test("check order follows first source appearance, never count or apparent favorability", () => {
  const run = assembledRun(deriveTypeBObservationSummary(mixedPresentation()));
  assert.deepEqual(
    run.plausibilityPartitions.map((partition) => partition.checkId),
    ["positive_root_distance/v0", "camera_above_floor/v0"]
  );
});

test("a single-check run still carries all four states including zeroes", () => {
  // Default fixture: one hypothesis with one passed check.
  const run = assembledRun(deriveTypeBObservationSummary(fullPresentation()));
  assert.deepEqual(run.plausibilityPartitions, [
    {
      checkId: "rotation_numerical_health/v0",
      denominator: 1,
      states: { passed: 1, failed: 0, not_evaluated: 0, not_applicable: 0 },
    },
  ]);
});

test("a failed camera_above_floor observation stays a literal partition fact", () => {
  const summary = deriveTypeBObservationSummary(mixedPresentation());
  const run = assembledRun(summary);
  const partition = run.plausibilityPartitions.find(
    (candidate) => candidate.checkId === "camera_above_floor/v0"
  );
  assert.ok(partition);
  assert.equal(partition?.states.failed, 1);
  // The raw checkId appears only as the literal checkId VALUE, never as a
  // key, and no calibration/readiness judgment is derived from the failure.
  for (const key of collectKeysDeep(summary)) {
    assert.ok(!key.toLowerCase().includes("camera"));
    assert.ok(!key.toLowerCase().includes("calibration"));
  }
  const serialized = JSON.stringify(summary).toLowerCase();
  for (const phrase of ["readiness", "not ready", "unusable", "judgment"]) {
    assert.ok(!serialized.includes(phrase));
  }
});

test("no combined all-checks pass field exists anywhere", () => {
  const summary = deriveTypeBObservationSummary(mixedPresentation());
  const serialized = JSON.stringify(summary).toLowerCase();
  for (const phrase of [
    "passedallchecks",
    "allcheckspassed",
    "allpassed",
    "passed_all",
    "composite",
    "combined",
    "overall",
  ]) {
    assert.ok(
      !serialized.includes(phrase),
      `summary must not carry combined pass fact "${phrase}"`
    );
  }
});

// --- 12. Frame-truncation partition correctness (B3G-2) --------------------------

test("evaluated frame truncation yields a closed four-state partition with an explicit denominator", () => {
  const summary = deriveTypeBObservationSummary(
    fullPresentation({
      requested: false,
      frameTruncationOverrides: {
        status: "evaluated",
        notAssessedReasons: [],
        records: [
          "incompatible",
          "compatible",
          "not_evaluated",
          "incompatible",
          "not_applicable",
        ].map((cropCompatibility, position) => ({
          primaryProductClassIdentity: "p-050",
          floorAspectRatio: 1.0,
          latentSideExtent: 0.5,
          poseProbeEquivalenceKey: "ppk-050-40",
          hypothesisIndex: position,
          cropCompatibility,
        })),
      },
    })
  );
  assert.equal(summary.frameTruncation.condition, "evaluated");
  if (summary.frameTruncation.condition !== "evaluated") return;
  assert.equal(summary.frameTruncation.recordCount, 5);
  assert.deepEqual(summary.frameTruncation.states, {
    compatible: 1,
    incompatible: 2,
    not_evaluated: 1,
    not_applicable: 1,
  });
  const states = summary.frameTruncation.states;
  assert.equal(
    states.compatible +
      states.incompatible +
      states.not_evaluated +
      states.not_applicable,
    summary.frameTruncation.recordCount
  );
});

test("zero-count compatibility states appear only for an honestly evaluated section", () => {
  // Default fixture: one compatible record. The other three states must still
  // appear, as literal zeroes over an explicit denominator.
  const summary = deriveTypeBObservationSummary(fullPresentation());
  assert.deepEqual(summary.frameTruncation, {
    condition: "evaluated",
    recordCount: 1,
    states: { compatible: 1, incompatible: 0, not_evaluated: 0, not_applicable: 0 },
  });
});

test("not-assessed frame truncation carries reasons and no fabricated state partition", () => {
  const summary = deriveTypeBObservationSummary(
    fullPresentation({
      requested: false,
      frameTruncationOverrides: {
        status: "not_assessed",
        notAssessedReasons: ["diagnostic_run_missing_pose_hypotheses"],
        records: [],
      },
    })
  );
  assert.deepEqual(summary.frameTruncation, {
    condition: "not_assessed",
    notAssessedLiterals: ["diagnostic_run_missing_pose_hypotheses"],
  });
  const serialized = JSON.stringify(summary.frameTruncation).toLowerCase();
  for (const phrase of ["recordcount", "compatible", "states"]) {
    assert.ok(
      !serialized.includes(phrase),
      `not-assessed frame truncation must not fabricate "${phrase}"`
    );
  }
});

test("frame-truncation facts are independent of association and plausibility", () => {
  // The frame-truncation section is identical whether or not association was
  // requested and regardless of plausibility outcomes.
  const withAssociation = deriveTypeBObservationSummary(
    fullPresentation({ requested: true })
  );
  const withoutAssociation = deriveTypeBObservationSummary(
    fullPresentation({ requested: false })
  );
  const withMixedPlausibility = deriveTypeBObservationSummary(mixedPresentation());
  assert.deepEqual(withAssociation.frameTruncation, withoutAssociation.frameTruncation);
  assert.deepEqual(
    withAssociation.frameTruncation,
    withMixedPlausibility.frameTruncation
  );
  // No percentage, ratio, or recommendation vocabulary exists.
  const serialized = JSON.stringify(withAssociation.frameTruncation).toLowerCase();
  for (const phrase of ["percent", "ratio", "rate", "recommend", "proportion"]) {
    assert.ok(!serialized.includes(phrase));
  }
});

// --- 13. Association containment (B3G-2) -----------------------------------------

test("association arms expose only their closed condition plus not-assessed literals", () => {
  const evaluated = deriveTypeBObservationSummary(
    fullPresentation({ requested: true })
  );
  assert.deepEqual(Object.keys(evaluated.association), ["condition"]);

  const notRequested = deriveTypeBObservationSummary(
    fullPresentation({ requested: false })
  );
  assert.deepEqual(Object.keys(notRequested.association), ["condition"]);

  const notAssessed = deriveTypeBObservationSummary(
    fullPresentation({
      requested: true,
      associationOverrides: {
        status: "not_assessed",
        notAssessedReasons: ["invalid_diagnostic_run_linkage"],
      },
    })
  );
  assert.deepEqual(Object.keys(notAssessed.association), [
    "condition",
    "notAssessedLiterals",
  ]);
  assert.deepEqual(notAssessed.association, {
    condition: "not_assessed",
    notAssessedLiterals: ["invalid_diagnostic_run_linkage"],
  });
});

test("no branch, component, annotation, or match fact enters the B3G-2 output", () => {
  for (const summary of [
    deriveTypeBObservationSummary(fullPresentation({ requested: true })),
    deriveTypeBObservationSummary(mixedPresentation()),
  ]) {
    for (const key of collectKeysDeep(summary)) {
      const lower = key.toLowerCase();
      for (const fragment of [
        "branch",
        "component",
        "annotation",
        "topolog",
        "policy",
        "link",
        "match",
      ]) {
        assert.ok(
          !lower.includes(fragment),
          `summary must not carry association-detail key "${key}"`
        );
      }
    }
    const serialized = JSON.stringify(summary).toLowerCase();
    for (const phrase of ["associated", "unmatched", "matched", "branch"]) {
      assert.ok(
        !serialized.includes(phrase),
        `summary copy must not carry association detail "${phrase}"`
      );
    }
  }
});

// --- 14. Cross-dimension independence (B3G-2) ------------------------------------

test("no cross-dimension composite, intersection, or ranking-friendly fact exists", () => {
  const summary = deriveTypeBObservationSummary(mixedPresentation());
  const serialized = JSON.stringify(summary).toLowerCase();
  for (const phrase of [
    "compatible and",
    "passing all",
    "intersect",
    "and associated",
    "solution",
  ]) {
    assert.ok(
      !serialized.includes(phrase),
      `summary must not carry cross-dimension fact "${phrase}"`
    );
  }
  // Each dimension lives only in its own section: plausibility facts never
  // appear under frameTruncation and vice versa.
  assert.ok(
    !JSON.stringify(summary.frameTruncation).includes("checkId") &&
      !JSON.stringify(summary.frameTruncation).toLowerCase().includes("plausibility")
  );
  const run = assembledRun(summary);
  assert.ok(
    !JSON.stringify(run.plausibilityPartitions).toLowerCase().includes("compat")
  );
});
