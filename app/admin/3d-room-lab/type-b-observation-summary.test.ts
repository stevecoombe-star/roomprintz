// --- Phase B3G-1: Pure Type B Observation Summary Contract tests -------------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-ONLY, READ-ONLY,
// NON-AUTHORITATIVE observation-summary derivation. Fixtures are produced
// through the REAL B3E presentation boundary (`presentTypeBDiagnosticRun`)
// fed by the REAL committed capture evaluator plus hand-authored envelope
// records, exactly as the existing B3E presentation tests do. The B3G-1
// summary is proven against the presentation layer only — no raw B3D
// envelope is handed to the summary directly.

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
    ],
    notAssessedReasons: [],
  };
}

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

// B3G fixtures are always full B3E presentations (the real safe boundary).
function fullPresentation(options?: {
  requested?: boolean;
  override?: boolean;
  runOverrides?: Record<string, unknown>;
  associationOverrides?: Record<string, unknown>;
}): TypeBDiagnosticRunPresentation {
  return presentTypeBDiagnosticRun({
    capture: options?.override ? realOverrideCaptured() : realCaptured(),
    envelope: buildEnvelope({
      requested: options?.requested ?? true,
      runOverrides: options?.runOverrides,
      associationOverrides: options?.associationOverrides,
    }),
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
  for (const phrase of FORBIDDEN_COPY) {
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

const EXPECTED_EMPTY: TypeBObservationSummary = {
  schema: "vibode-type-b-observation-summary/v0",
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

test("schema literal is stable and exported verbatim", () => {
  assert.equal(
    TYPE_B_OBSERVATION_SUMMARY_SCHEMA,
    "vibode-type-b-observation-summary/v0"
  );
  const summary = deriveTypeBObservationSummary(fullPresentation());
  assert.equal(summary.schema, "vibode-type-b-observation-summary/v0");
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
  const scanForNumbers = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(scanForNumbers);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(scanForNumbers);
    } else {
      assert.notEqual(
        typeof value,
        "number",
        "empty summary must contain no numeric fact"
      );
    }
  };
  scanForNumbers(summary);
  // No section claims evaluation or non-assessment when nothing existed.
  assert.equal(summary.status, "no_presentation");
  assert.equal(summary.capture.condition, "absent");
  assert.equal(summary.run.condition, "absent");
  assert.equal(summary.association.condition, "absent");
  assert.equal(summary.frameTruncation.condition, "absent");
  const serialized = JSON.stringify(summary).toLowerCase();
  for (const phrase of ["hypothes", "compatible", "evaluated", "count"]) {
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

// --- 3. Non-mutation -----------------------------------------------------------

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
  assert.equal(summary.run.condition, "assembled");
  if (summary.run.condition !== "assembled") return;
  assert.equal(summary.run.labTestOverrideActive, false);
  assert.equal(
    summary.run.actualTypeAContext,
    presentation.runManifest?.actualTypeAContext
  );
  assert.equal(
    summary.run.effectiveTypeAContext,
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
  assert.equal(summary.run.condition, "assembled");
  if (summary.run.condition !== "assembled") return;
  assert.equal(summary.run.labTestOverrideActive, true);
  assert.equal(summary.run.handoffKind, "lab_test_handoff_override");
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

test("refused-capture presentation yields the neutral refused condition with no manufactured detail", () => {
  const presentation = presentTypeBDiagnosticRun({
    capture: realRefusal(),
    envelope: null,
  });
  const summary = deriveTypeBObservationSummary(presentation);
  assert.equal(summary.status, "presentation_observed");
  assert.deepEqual(summary.capture, { condition: "refused" });
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
});

test("summary carries no numeric ordering or ranking-friendly field", () => {
  const summary = deriveTypeBObservationSummary(fullPresentation());
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
});
