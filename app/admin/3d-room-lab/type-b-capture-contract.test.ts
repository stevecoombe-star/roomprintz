// --- Phase B3D-5A: Type B Capture Contract tests ----------------------------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST Type B capture
// contract module. Fixtures are LOCAL, minimal, and hand-authored: NO snapshot
// capture from live state, NO B3C/B3D execution, NO P3P solve, NO UI, NO
// calibration, NO ranking. This module resolves frozen endpoint roles and emits
// structural fingerprints only.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  type TypeBEvidenceSnapshot,
} from "./type-b-evaluator-contract";
import type { TypeBDeclaredLineEvidence } from "./type-b-evidence-types";
import type { TypeBTupleGenerationCoverage } from "./type-b-tuple-generation";
import { TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA } from "./type-b-evaluator-contract";
import { TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA } from "./type-b-p3p-diagnostic-contract";
import type { TypeBFovProbeTopologyDeclaration } from "./type-b-p3p-diagnostic-contract";
import { TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA } from "./type-b-p3p-branch-association";
import type { TypeBBranchAssociationPolicy } from "./type-b-p3p-branch-association";

import * as captureModule from "./type-b-capture-contract";
import {
  TYPE_B_ASSOCIATION_FINGERPRINT_SCHEMA,
  TYPE_B_CAPTURE_SCHEMA,
  TYPE_B_COVERAGE_FINGERPRINT_SCHEMA,
  TYPE_B_EVIDENCE_FINGERPRINT_SCHEMA,
  makeTypeBAssociationFingerprint,
  makeTypeBCoverageFingerprint,
  makeTypeBEvidenceFingerprint,
  resolveTypeBCapturedEndpointRoles,
  type TypeBEndpointRoleResolutionInput,
} from "./type-b-capture-contract";

// --- Local fixtures ---------------------------------------------------------

type SeamOptions = Partial<TypeBDeclaredLineEvidence>;

function seam(base: TypeBDeclaredLineEvidence, opts: SeamOptions = {}): TypeBDeclaredLineEvidence {
  return { ...base, ...opts };
}

// A frame with min dimension 800 -> tolerance clamp(0.02*800=16, 8, 24) = 16 px.
const FRAME = { width: 1000, height: 800 } as const;

// Rear seam: start far, end at the shared junction. In source px on FRAME:
//   start -> (100, 400); end -> (500, 400).
const REAR_BASE: TypeBDeclaredLineEvidence = {
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

// Side seam: start at the shared junction (coincident with rear end), end is the
// latent terminus. In source px on FRAME:
//   start -> (500, 400); end -> (500, 720).
const SIDE_BASE: TypeBDeclaredLineEvidence = {
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

function baseInput(
  overrides: Partial<TypeBEndpointRoleResolutionInput> = {}
): TypeBEndpointRoleResolutionInput {
  return {
    sourceFrame: { ...FRAME },
    rearSeam: seam(REAR_BASE),
    strongSideSeam: seam(SIDE_BASE),
    latentNearCornerCondition: "frame_truncated",
    ...overrides,
  };
}

function buildSnapshot(): TypeBEvidenceSnapshot {
  return {
    schema: TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    evidenceFamily: "rear_seam_plus_strong_side_seam",
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    basis: {
      sourceImageIdentity: "room.jpg",
      sourceFrameKey: "1000x800",
      sourceFrame: { width: 1000, height: 800 },
      candidateIdentity: "cand-1",
      floorPolygonKey: "poly-1",
    },
    rearSeam: {
      role: "rear_floor_wall_seam",
      startNorm: { x: 0.1, y: 0.5 },
      endNorm: { x: 0.5, y: 0.5 },
      startEndpointStatus: "visible",
      endEndpointStatus: "visible",
      startFrameContact: "no_frame_contact",
      endFrameContact: "no_frame_contact",
      occlusionStatus: "none_observed",
    },
    strongSideSeam: {
      role: "side_wall_floor_seam",
      startNorm: { x: 0.5, y: 0.5 },
      endNorm: { x: 0.5, y: 0.9 },
      startEndpointStatus: "visible",
      endEndpointStatus: "frame_truncated",
      startFrameContact: "no_frame_contact",
      endFrameContact: "contacts_frame",
      occlusionStatus: "none_observed",
    },
    latentNearCornerCondition: "frame_truncated",
    floorAssumptions: {
      worldWidth: 3.2,
      authorizedAspectRatios: [1.0, 1.5, 2.0],
    },
    typeAContext: "type_a_exhausted_handoff_candidate",
    b1Qualification: {
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
    },
    junction: {
      distanceSourcePx: 0,
      toleranceFormulaId: TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
      resolvedToleranceSourcePx: 16,
      established: true,
    },
    endpointRoles: {
      resolutionRuleId: TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
      junctionRearEndpoint: "end",
      junctionSideEndpoint: "start",
    },
    capturedAtIso: "2026-07-01T00:00:00.000Z",
  };
}

function buildCoverage(): TypeBTupleGenerationCoverage {
  return {
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

function buildTopology(): TypeBFovProbeTopologyDeclaration {
  return {
    schema: TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA,
    orderedProbesDeg: [40, 50, 60],
    stepDeg: 10,
  };
}

function buildPolicy(): TypeBBranchAssociationPolicy {
  return {
    schema: TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA,
    maxNormalizedCameraPositionDelta: 0.1,
    maxRotationDeltaDeg: 5,
    tieMarginNormalizedCameraPosition: 0.01,
    tieMarginRotationDeg: 0.5,
    nearCoincidentNormalizedCameraPositionDelta: 0.02,
    nearCoincidentRotationDeltaDeg: 1,
  };
}

const MODULE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "type-b-capture-contract.ts"
);
const MODULE_SOURCE = readFileSync(MODULE_PATH, "utf8");

// --- 1. Runtime export surface ----------------------------------------------

test("runtime module exports exactly four schema constants and four functions", () => {
  const keys = Object.keys(captureModule).sort();
  assert.deepEqual(keys, [
    "TYPE_B_ASSOCIATION_FINGERPRINT_SCHEMA",
    "TYPE_B_CAPTURE_SCHEMA",
    "TYPE_B_COVERAGE_FINGERPRINT_SCHEMA",
    "TYPE_B_EVIDENCE_FINGERPRINT_SCHEMA",
    "makeTypeBAssociationFingerprint",
    "makeTypeBCoverageFingerprint",
    "makeTypeBEvidenceFingerprint",
    "resolveTypeBCapturedEndpointRoles",
  ]);
  assert.equal(TYPE_B_CAPTURE_SCHEMA, "vibode-type-b-capture/v0");
  assert.equal(
    TYPE_B_EVIDENCE_FINGERPRINT_SCHEMA,
    "vibode-type-b-evidence-fingerprint/v0"
  );
  assert.equal(
    TYPE_B_COVERAGE_FINGERPRINT_SCHEMA,
    "vibode-type-b-coverage-fingerprint/v0"
  );
  assert.equal(
    TYPE_B_ASSOCIATION_FINGERPRINT_SCHEMA,
    "vibode-type-b-association-fingerprint/v0"
  );
  assert.equal(typeof resolveTypeBCapturedEndpointRoles, "function");
  assert.equal(typeof makeTypeBEvidenceFingerprint, "function");
  assert.equal(typeof makeTypeBCoverageFingerprint, "function");
  assert.equal(typeof makeTypeBAssociationFingerprint, "function");
});

// --- 2. Valid unique closest pair resolves ----------------------------------

test("valid unique closest pair resolves exact frozen roles and junction", () => {
  const result = resolveTypeBCapturedEndpointRoles(baseInput());
  assert.equal(result.status, "resolved");
  if (result.status !== "resolved") return;
  assert.deepEqual(result.refusalReasons, []);
  assert.deepEqual(result.endpointRoles, {
    resolutionRuleId: TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
    junctionRearEndpoint: "end",
    junctionSideEndpoint: "start",
  });
  assert.deepEqual(result.junction, {
    distanceSourcePx: 0,
    toleranceFormulaId: TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
    resolvedToleranceSourcePx: 16,
    established: true,
  });
});

// --- 3. Exactly four declared pairs; no created/averaged point ---------------

test("junction distance equals an exact declared endpoint-pair distance, never a midpoint/intersection", () => {
  // Move the side start slightly off the rear end so the winning distance is a
  // concrete, verifiable declared-endpoint distance.
  const input = baseInput({
    strongSideSeam: seam(SIDE_BASE, { startNorm: { x: 0.5, y: 0.51 } }),
  });
  const result = resolveTypeBCapturedEndpointRoles(input);
  assert.equal(result.status, "resolved");
  if (result.status !== "resolved") return;

  // Recompute the four exact endpoint-pair distances the resolver considers.
  const toPx = (p: { x: number; y: number }) => ({
    x: p.x * FRAME.width,
    y: p.y * FRAME.height,
  });
  const rear = input.rearSeam;
  const side = input.strongSideSeam;
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const dists = [
    d(toPx(rear.startNorm), toPx(side.startNorm)),
    d(toPx(rear.startNorm), toPx(side.endNorm)),
    d(toPx(rear.endNorm), toPx(side.startNorm)),
    d(toPx(rear.endNorm), toPx(side.endNorm)),
  ];
  const expectedMin = Math.min(...dists);
  // The reported distance is EXACTLY one of the four declared pair distances.
  assert.ok(dists.includes(result.junction.distanceSourcePx));
  assert.equal(result.junction.distanceSourcePx, expectedMin);
  // rear.end <-> side.start is the closest declared pair (8 px), not a midpoint.
  assert.equal(result.endpointRoles.junctionRearEndpoint, "end");
  assert.equal(result.endpointRoles.junctionSideEndpoint, "start");
  assert.equal(result.junction.distanceSourcePx, 8);
});

// --- 4. Exact tie ------------------------------------------------------------

test("exact equal minimum pair distances produce junction_endpoint_pair_tied and no role map", () => {
  // rear px: start (500,400), end (600,400). side px: start (500,400), end
  // (600,400). Pairs (start,start)=0 and (end,end)=0 tie exactly.
  const input = baseInput({
    rearSeam: seam(REAR_BASE, {
      startNorm: { x: 0.5, y: 0.5 },
      endNorm: { x: 0.6, y: 0.5 },
    }),
    strongSideSeam: seam(SIDE_BASE, {
      startNorm: { x: 0.5, y: 0.5 },
      endNorm: { x: 0.6, y: 0.5 },
    }),
  });
  const result = resolveTypeBCapturedEndpointRoles(input);
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.deepEqual(result.refusalReasons, ["junction_endpoint_pair_tied"]);
  assert.equal((result as { endpointRoles?: unknown }).endpointRoles, undefined);
  assert.equal((result as { junction?: unknown }).junction, undefined);
});

// --- 5. Beyond tolerance -----------------------------------------------------

test("winning pair beyond committed tolerance produces shared_junction_not_visibly_established", () => {
  // rear end px (500,400); side start px (500,440) => 40 px > tolerance 16 and is
  // the unique minimum.
  const input = baseInput({
    strongSideSeam: seam(SIDE_BASE, {
      startNorm: { x: 0.5, y: 0.55 },
      endNorm: { x: 0.5, y: 0.95 },
    }),
  });
  const result = resolveTypeBCapturedEndpointRoles(input);
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.deepEqual(result.refusalReasons, [
    "shared_junction_not_visibly_established",
  ]);
});

// --- 6. Invalid source frame -------------------------------------------------

test("invalid source-frame runtime shape refuses safely without throwing", () => {
  const badFrames: unknown[] = [
    { width: 0, height: 800 },
    { width: 1000, height: -1 },
    { width: Number.NaN, height: 800 },
    null,
    "nope",
    42,
    {},
  ];
  for (const frame of badFrames) {
    const result = resolveTypeBCapturedEndpointRoles(
      baseInput({ sourceFrame: frame as never })
    );
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.ok(result.refusalReasons.includes("invalid_snapshot_basis"));
    assert.ok(
      result.refusalReasons.includes("shared_junction_not_visibly_established")
    );
  }
  // Completely non-object input never throws either.
  const wild = resolveTypeBCapturedEndpointRoles(undefined as never);
  assert.equal(wild.status, "refused");
});

// --- 7. Junction endpoint certainty -----------------------------------------

test("junction endpoint certainty failure produces junction_endpoint_not_position_certain", () => {
  const input = baseInput({
    strongSideSeam: seam(SIDE_BASE, { startEndpointStatus: "occluded" }),
  });
  const result = resolveTypeBCapturedEndpointRoles(input);
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.ok(
    result.refusalReasons.includes("junction_endpoint_not_position_certain")
  );
});

// --- 8. Non-junction rear certainty -----------------------------------------

test("non-junction rear certainty failure produces non_junction_rear_endpoint_not_position_certain", () => {
  const input = baseInput({
    rearSeam: seam(REAR_BASE, { startEndpointStatus: "unresolved" }),
  });
  const result = resolveTypeBCapturedEndpointRoles(input);
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.ok(
    result.refusalReasons.includes(
      "non_junction_rear_endpoint_not_position_certain"
    )
  );
});

// --- 9. Non-latent terminus --------------------------------------------------

test("a non-latent side terminus produces side_terminus_not_latent", () => {
  const input = baseInput({
    strongSideSeam: seam(SIDE_BASE, { endEndpointStatus: "visible" }),
  });
  const result = resolveTypeBCapturedEndpointRoles(input);
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.ok(result.refusalReasons.includes("side_terminus_not_latent"));
  assert.ok(
    !result.refusalReasons.includes(
      "latent_condition_side_terminus_status_mismatch"
    )
  );
});

// --- 10 & 11. Latent condition mismatch -------------------------------------

test("frame_truncated condition + occluded terminus => latent_condition_side_terminus_status_mismatch", () => {
  const input = baseInput({
    latentNearCornerCondition: "frame_truncated",
    strongSideSeam: seam(SIDE_BASE, {
      endEndpointStatus: "occluded",
      endFrameContact: "no_frame_contact",
    }),
  });
  const result = resolveTypeBCapturedEndpointRoles(input);
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.deepEqual(result.refusalReasons, [
    "latent_condition_side_terminus_status_mismatch",
  ]);
});

test("occluded condition + frame_truncated terminus => latent_condition_side_terminus_status_mismatch", () => {
  const input = baseInput({
    latentNearCornerCondition: "occluded",
    strongSideSeam: seam(SIDE_BASE, {
      endEndpointStatus: "frame_truncated",
      endFrameContact: "contacts_frame",
    }),
  });
  const result = resolveTypeBCapturedEndpointRoles(input);
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.deepEqual(result.refusalReasons, [
    "latent_condition_side_terminus_status_mismatch",
  ]);
});

// --- 12. frame_truncated needs contacts_frame -------------------------------

test("frame_truncated terminus without exact contacts_frame => frame_truncated_side_terminus_not_contacts_frame", () => {
  for (const contact of [
    "no_frame_contact",
    "frame_contact_ambiguous",
    "unknown",
  ] as const) {
    const input = baseInput({
      latentNearCornerCondition: "frame_truncated",
      strongSideSeam: seam(SIDE_BASE, {
        endEndpointStatus: "frame_truncated",
        endFrameContact: contact,
      }),
    });
    const result = resolveTypeBCapturedEndpointRoles(input);
    assert.equal(result.status, "refused");
    if (result.status !== "refused") continue;
    assert.deepEqual(result.refusalReasons, [
      "frame_truncated_side_terminus_not_contacts_frame",
    ]);
  }
});

// --- 13. occluded needs no frame-contact ------------------------------------

test("occluded terminus needs no frame-contact condition", () => {
  for (const contact of [
    "no_frame_contact",
    "contacts_frame",
    "frame_contact_ambiguous",
    "unknown",
  ] as const) {
    const input = baseInput({
      latentNearCornerCondition: "occluded",
      strongSideSeam: seam(SIDE_BASE, {
        endEndpointStatus: "occluded",
        endFrameContact: contact,
      }),
    });
    const result = resolveTypeBCapturedEndpointRoles(input);
    assert.equal(result.status, "resolved", `contact=${contact}`);
  }
});

// --- 14. All simultaneously evaluable reasons in stable order ----------------

test("all simultaneously evaluable refusal reasons are returned once each in declared stable order", () => {
  // Established unique junction, but every role/latent check fails at once.
  const input = baseInput({
    latentNearCornerCondition: "frame_truncated",
    rearSeam: seam(REAR_BASE, {
      startEndpointStatus: "occluded", // non-junction rear not certain
      endEndpointStatus: "occluded", // junction rear not certain
    }),
    strongSideSeam: seam(SIDE_BASE, {
      startEndpointStatus: "occluded", // junction side not certain
      endEndpointStatus: "occluded", // terminus latent but mismatched vs frame_truncated
      endFrameContact: "no_frame_contact",
    }),
  });
  const result = resolveTypeBCapturedEndpointRoles(input);
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.deepEqual(result.refusalReasons, [
    "junction_endpoint_not_position_certain",
    "non_junction_rear_endpoint_not_position_certain",
    "latent_condition_side_terminus_status_mismatch",
  ]);
  // Each appears exactly once.
  const unique = new Set(result.refusalReasons);
  assert.equal(unique.size, result.refusalReasons.length);
});

test("a tie may be accompanied only by honest global facts (unauthorized condition), never invented role facts", () => {
  const input = baseInput({
    latentNearCornerCondition: "unresolved" as never,
    rearSeam: seam(REAR_BASE, {
      startNorm: { x: 0.5, y: 0.5 },
      endNorm: { x: 0.6, y: 0.5 },
    }),
    strongSideSeam: seam(SIDE_BASE, {
      startNorm: { x: 0.5, y: 0.5 },
      endNorm: { x: 0.6, y: 0.5 },
    }),
  });
  const result = resolveTypeBCapturedEndpointRoles(input);
  assert.equal(result.status, "refused");
  if (result.status !== "refused") return;
  assert.deepEqual(result.refusalReasons, [
    "latent_condition_not_authorized",
    "junction_endpoint_pair_tied",
  ]);
});

// --- 15. Determinism + non-mutation -----------------------------------------

test("resolver is deeply deterministic and leaves inputs unchanged", () => {
  const input = baseInput();
  const snapshotBefore = structuredClone(input);
  const a = resolveTypeBCapturedEndpointRoles(input);
  const b = resolveTypeBCapturedEndpointRoles(input);
  assert.deepEqual(a, b);
  assert.deepEqual(input, snapshotBefore);
});

// --- 16 & 17. Evidence fingerprint sensitivity ------------------------------

test("evidence fingerprint is deterministic and schema-prefixed", () => {
  const snap = buildSnapshot();
  const fp = makeTypeBEvidenceFingerprint(snap);
  assert.equal(fp, makeTypeBEvidenceFingerprint(buildSnapshot()));
  assert.ok(fp.startsWith(`${TYPE_B_EVIDENCE_FINGERPRINT_SCHEMA}|`));
  // Non-mutating.
  const before = structuredClone(snap);
  makeTypeBEvidenceFingerprint(snap);
  assert.deepEqual(snap, before);
});

test("evidence fingerprint changes when each semantic category changes", () => {
  const base = makeTypeBEvidenceFingerprint(buildSnapshot());
  const mutate = (fn: (s: TypeBEvidenceSnapshot) => void): string => {
    const s = buildSnapshot();
    fn(s);
    return makeTypeBEvidenceFingerprint(s);
  };
  const cases: Array<(s: TypeBEvidenceSnapshot) => void> = [
    // basis
    (s) => ((s.basis as { sourceImageIdentity: string }).sourceImageIdentity = "other.jpg"),
    (s) => ((s.basis as { sourceFrame: { width: number } }).sourceFrame.width = 1001),
    // seam coordinate
    (s) => ((s.rearSeam as { startNorm: { x: number } }).startNorm.x = 0.11),
    // endpoint status
    (s) => ((s.strongSideSeam as { startEndpointStatus: string }).startEndpointStatus = "near_frame"),
    // frame contact
    (s) => ((s.strongSideSeam as { endFrameContact: string }).endFrameContact = "unknown"),
    // occlusion
    (s) => ((s.rearSeam as { occlusionStatus: string }).occlusionStatus = "partial_obstruction"),
    // declared role
    (s) => ((s.rearSeam as { role: string }).role = "side_floor_boundary"),
    // latent condition
    (s) => ((s as { latentNearCornerCondition: string }).latentNearCornerCondition = "occluded"),
    // B1 qualification field
    (s) => ((s.b1Qualification as unknown as { advisoryReasons: string[] }).advisoryReasons = []),
    (s) => ((s.b1Qualification.evidenceSummary as unknown as { cropInterpretationUsable: boolean | null }).cropInterpretationUsable = true),
    // junction
    (s) => ((s.junction as { distanceSourcePx: number }).distanceSourcePx = 1),
    // endpoint map
    (s) => ((s.endpointRoles as { junctionSideEndpoint: string }).junctionSideEndpoint = "end"),
    // world width
    (s) => ((s.floorAssumptions as { worldWidth: number }).worldWidth = 4),
    // authorized-aspect order
    (s) => ((s.floorAssumptions as unknown as { authorizedAspectRatios: number[] }).authorizedAspectRatios = [1.5, 1.0, 2.0]),
  ];
  const seen = new Set<string>([base]);
  for (const fn of cases) {
    const fp = mutate(fn);
    assert.notEqual(fp, base);
    seen.add(fp);
  }
  // Every mutation produced a distinct fingerprint.
  assert.equal(seen.size, cases.length + 1);
});

test("evidence fingerprint ignores timestamp-only and notes-only changes", () => {
  const base = makeTypeBEvidenceFingerprint(buildSnapshot());

  const tsChanged = buildSnapshot();
  (tsChanged as { capturedAtIso: string }).capturedAtIso = "2099-01-01T00:00:00.000Z";
  assert.equal(makeTypeBEvidenceFingerprint(tsChanged), base);

  const notesChanged = buildSnapshot();
  (notesChanged.rearSeam as { notes?: string }).notes = "operator note";
  (notesChanged.strongSideSeam as { notes?: string }).notes = "another note";
  assert.equal(makeTypeBEvidenceFingerprint(notesChanged), base);
});

// --- 18. Coverage fingerprint order sensitivity -----------------------------

test("coverage fingerprint preserves authored aspect/class/FOV order", () => {
  const snap = buildSnapshot();
  const cov = buildCoverage();
  const base = makeTypeBCoverageFingerprint(snap, cov);
  assert.equal(base, makeTypeBCoverageFingerprint(buildSnapshot(), buildCoverage()));
  assert.ok(base.startsWith(`${TYPE_B_COVERAGE_FINGERPRINT_SCHEMA}|`));

  // Swap authorized aspect order.
  const snapAspect = buildSnapshot();
  (snapAspect as unknown as {
    floorAssumptions: { worldWidth: number; authorizedAspectRatios: number[] };
  }).floorAssumptions = {
    worldWidth: snapAspect.floorAssumptions.worldWidth,
    authorizedAspectRatios: [2.0, 1.0, 1.5],
  };
  assert.notEqual(makeTypeBCoverageFingerprint(snapAspect, cov), base);

  // Swap product-class order.
  const covClass = buildCoverage();
  (covClass as unknown as {
    primaryProductClasses: TypeBTupleGenerationCoverage["primaryProductClasses"];
  }).primaryProductClasses = [
    buildCoverage().primaryProductClasses[1],
    buildCoverage().primaryProductClasses[0],
  ];
  assert.notEqual(makeTypeBCoverageFingerprint(snap, covClass), base);

  // Swap FOV probe order.
  const covFov = buildCoverage();
  (covFov as unknown as { fovProbesDeg: number[] }).fovProbesDeg = [60, 50, 40];
  assert.notEqual(makeTypeBCoverageFingerprint(snap, covFov), base);

  // Non-mutating.
  const before = structuredClone(cov);
  makeTypeBCoverageFingerprint(snap, cov);
  assert.deepEqual(cov, before);
});

// --- 19. Association fingerprint field sensitivity --------------------------

test("association fingerprint preserves topology/policy fields and ordered probes", () => {
  const request = { topology: buildTopology(), policy: buildPolicy() };
  const base = makeTypeBAssociationFingerprint(request);
  assert.equal(
    base,
    makeTypeBAssociationFingerprint({ topology: buildTopology(), policy: buildPolicy() })
  );
  assert.ok(base.startsWith(`${TYPE_B_ASSOCIATION_FINGERPRINT_SCHEMA}|`));

  // Probe order change.
  const t2 = buildTopology();
  (t2 as unknown as { orderedProbesDeg: number[] }).orderedProbesDeg = [60, 50, 40];
  assert.notEqual(
    makeTypeBAssociationFingerprint({ topology: t2, policy: buildPolicy() }),
    base
  );

  // Step change.
  const t3 = buildTopology();
  (t3 as unknown as { stepDeg: number }).stepDeg = 5;
  assert.notEqual(
    makeTypeBAssociationFingerprint({ topology: t3, policy: buildPolicy() }),
    base
  );

  // Each of the six policy fields individually changes the fingerprint.
  const policyKeys: Array<keyof TypeBBranchAssociationPolicy> = [
    "maxNormalizedCameraPositionDelta",
    "maxRotationDeltaDeg",
    "tieMarginNormalizedCameraPosition",
    "tieMarginRotationDeg",
    "nearCoincidentNormalizedCameraPositionDelta",
    "nearCoincidentRotationDeltaDeg",
  ];
  const seen = new Set<string>([base]);
  for (const key of policyKeys) {
    const p = buildPolicy();
    (p as unknown as Record<string, number>)[key] =
      (p as unknown as Record<string, number>)[key] + 0.123;
    const fp = makeTypeBAssociationFingerprint({ topology: buildTopology(), policy: p });
    assert.notEqual(fp, base, `policy field ${key} should change fingerprint`);
    seen.add(fp);
  }
  assert.equal(seen.size, policyKeys.length + 1);
});

// --- 20. Malformed fingerprint inputs ---------------------------------------

test("malformed fingerprint inputs are deterministic, schema-prefixed, non-throwing, non-mutating", () => {
  const evMalformed = `${TYPE_B_EVIDENCE_FINGERPRINT_SCHEMA}|<malformed-input>`;
  for (const bad of [null, undefined, 5, "x", true]) {
    assert.equal(makeTypeBEvidenceFingerprint(bad as never), evMalformed);
  }

  const covMalformed = `${TYPE_B_COVERAGE_FINGERPRINT_SCHEMA}|<malformed-input>`;
  assert.equal(makeTypeBCoverageFingerprint(null as never, null as never), covMalformed);
  assert.equal(
    makeTypeBCoverageFingerprint(buildSnapshot(), null as never),
    covMalformed
  );

  const assocMalformed = `${TYPE_B_ASSOCIATION_FINGERPRINT_SCHEMA}|<malformed-input>`;
  assert.equal(makeTypeBAssociationFingerprint(null as never), assocMalformed);
  assert.equal(
    makeTypeBAssociationFingerprint({ topology: null as never, policy: buildPolicy() }),
    assocMalformed
  );
  assert.equal(
    makeTypeBAssociationFingerprint({ topology: buildTopology(), policy: null as never }),
    assocMalformed
  );

  // A well-formed-object-but-partially-missing input is best-effort, still
  // deterministic and schema-prefixed, and never mutates the input.
  const partial = { schema: "x" } as unknown as TypeBEvidenceSnapshot;
  const before = structuredClone(partial);
  const fpA = makeTypeBEvidenceFingerprint(partial);
  const fpB = makeTypeBEvidenceFingerprint(partial);
  assert.equal(fpA, fpB);
  assert.ok(fpA.startsWith(`${TYPE_B_EVIDENCE_FINGERPRINT_SCHEMA}|`));
  assert.deepEqual(partial, before);
});

// --- 21. Capture-result contract structure ----------------------------------

test("capture-result contract structurally forbids illegal shapes and calibration fields", () => {
  // These assignments must COMPILE (they exercise the exported types), and the
  // commented-out ones would NOT compile (documented, not executed).
  const success: captureModule.TypeBCaptureSuccess = {
    schema: TYPE_B_CAPTURE_SCHEMA,
    status: "captured",
    snapshot: buildSnapshot(),
    coverage: buildCoverage(),
    identity: {
      evidenceFingerprint: makeTypeBEvidenceFingerprint(buildSnapshot()),
      coverageFingerprint: makeTypeBCoverageFingerprint(buildSnapshot(), buildCoverage()),
    },
    refusalReasons: [],
  };
  const refusal: captureModule.TypeBCaptureRefusal = {
    schema: TYPE_B_CAPTURE_SCHEMA,
    status: "refused",
    refusalReasons: ["invalid_snapshot_basis"],
  };
  const result: captureModule.TypeBCaptureResult = success;
  assert.equal(result.status, "captured");
  assert.equal(refusal.status, "refused");

  // The refusal object has no snapshot/coverage/identity keys at runtime.
  assert.equal((refusal as { snapshot?: unknown }).snapshot, undefined);
  assert.equal((refusal as { coverage?: unknown }).coverage, undefined);
  // The success object carries no calibration/ranking-style fields.
  for (const forbidden of [
    "root",
    "branch",
    "rank",
    "confidence",
    "selected",
    "preview",
    "load",
    "apply",
    "calibration",
    "diagnosticResult",
  ]) {
    assert.equal((success as Record<string, unknown>)[forbidden], undefined);
  }

  // Identity intentionally has no association fingerprint field.
  assert.equal(
    (success.identity as { associationFingerprint?: unknown }).associationFingerprint,
    undefined
  );
});

// --- 22 & 23 & 24. Import boundary + no Type A + untouched schemas -----------

test("capture module imports only approved pure Type B contracts", () => {
  const importLines = MODULE_SOURCE.split("\n").filter((line) =>
    /^\s*import\b/.test(line)
  );
  // Every import specifier must be one of the approved local Type B modules.
  const allowedSpecifiers = new Set([
    "./type-b-evaluator-contract",
    "./type-b-evidence-types",
    "./type-b-tuple-generation",
    "./type-b-p3p-diagnostic-contract",
    "./type-b-p3p-branch-association",
  ]);
  const specifierRegex = /from\s+"([^"]+)"/;
  const specifiers = new Set<string>();
  for (const line of importLines) {
    const match = specifierRegex.exec(line);
    if (match) specifiers.add(match[1]);
  }
  for (const spec of specifiers) {
    assert.ok(
      allowedSpecifiers.has(spec),
      `unexpected import specifier: ${spec}`
    );
  }

  // Forbidden dependencies never appear.
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
  ]) {
    assert.ok(
      !MODULE_SOURCE.toLowerCase().includes(`"${forbidden}`),
      `forbidden import fragment present: ${forbidden}`
    );
  }
});

test("data-shape imports are import type only", () => {
  // The only VALUE (runtime) imports are the three approved evaluator-contract
  // helpers/constants. All other imports must be `import type`.
  const runtimeImportBlock =
    /import\s*\{\s*\n\s*TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,\s*\n\s*TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,\s*\n\s*resolveTypeBEvaluatorJunctionTolerancePx,\s*\n\s*\}\s*from\s*"\.\/type-b-evaluator-contract";/;
  assert.ok(
    runtimeImportBlock.test(MODULE_SOURCE),
    "expected the single approved runtime import block"
  );
  // Count non-type value imports: exactly one `import {` that is not `import type {`.
  const valueImports = MODULE_SOURCE.split("\n").filter(
    (line) => /^\s*import\s*\{/.test(line) && !/^\s*import\s+type/.test(line)
  );
  assert.equal(valueImports.length, 1);
});

// --- B3D-5A2: capture eligibility refusal completion ------------------------

// Parses the module-private TYPE_B_CAPTURE_REFUSAL_ORDER literal array from the
// module source (the array is intentionally NOT exported). Comments in the block
// carry no double-quoted tokens, so only the literal entries are captured.
function parseCaptureRefusalOrder(): string[] {
  const start = MODULE_SOURCE.indexOf("const TYPE_B_CAPTURE_REFUSAL_ORDER = [");
  assert.ok(start >= 0, "ordering array declaration not found");
  const end = MODULE_SOURCE.indexOf("] as const", start);
  assert.ok(end > start, "ordering array terminator not found");
  const body = MODULE_SOURCE.slice(start, end);
  const matches = body.match(/"([a-z_]+)"/g) ?? [];
  return matches.map((token) => token.slice(1, -1));
}

// The full expected TypeBCaptureRefusalReason membership (kept in test-declared
// order for readability; membership, not order, is asserted here).
const EXPECTED_CAPTURE_REFUSAL_MEMBERS = [
  "invalid_snapshot_basis",
  "latent_condition_not_authorized",
  "type_a_context_not_exhausted_handoff",
  "type_b_not_qualified",
  "junction_endpoint_pair_tied",
  "shared_junction_not_visibly_established",
  "junction_endpoint_not_position_certain",
  "non_junction_rear_endpoint_not_position_certain",
  "side_terminus_not_latent",
  "latent_condition_side_terminus_status_mismatch",
  "frame_truncated_side_terminus_not_contacts_frame",
  "no_authorized_aspect_ratios",
  "duplicate_authorized_aspect_ratio",
  "no_primary_product_classes",
  "duplicate_primary_product_class_identity",
  "duplicate_primary_latent_depth_product",
  "invalid_primary_product_class",
  "no_fov_probes",
  "invalid_fov_probe",
  "duplicate_fov_probe",
] as const;

test("TypeBCaptureRefusalReason includes both new capture-eligibility literals", () => {
  // Compile-time membership: these assignments only compile if the literals are
  // members of the union.
  const a: captureModule.TypeBCaptureRefusalReason = "type_b_not_qualified";
  const b: captureModule.TypeBCaptureRefusalReason =
    "type_a_context_not_exhausted_handoff";
  assert.equal(a, "type_b_not_qualified");
  assert.equal(b, "type_a_context_not_exhausted_handoff");
});

test("module-private ordering contains both new literals exactly once", () => {
  const order = parseCaptureRefusalOrder();
  for (const literal of [
    "type_b_not_qualified",
    "type_a_context_not_exhausted_handoff",
  ]) {
    const count = order.filter((entry) => entry === literal).length;
    assert.equal(count, 1, `${literal} should appear exactly once`);
  }
});

test("module-private ordering is exhaustive for the full capture union with no duplicates", () => {
  const order = parseCaptureRefusalOrder();
  // No duplicate entries.
  assert.equal(new Set(order).size, order.length);
  // Exhaustive: exactly the expected membership (order-independent).
  assert.deepEqual(
    [...order].sort(),
    [...EXPECTED_CAPTURE_REFUSAL_MEMBERS].sort()
  );
});

test("both new literals precede junction/role/latent/coverage facts in the stable order", () => {
  const order = parseCaptureRefusalOrder();
  const idxTypeA = order.indexOf("type_a_context_not_exhausted_handoff");
  const idxTypeB = order.indexOf("type_b_not_qualified");
  // Type A handoff context precedes B1 qualification.
  assert.ok(idxTypeA >= 0 && idxTypeB >= 0);
  assert.ok(idxTypeA < idxTypeB);
  // Both precede the first junction, role, latent, and coverage facts.
  const laterFacts = [
    "junction_endpoint_pair_tied",
    "shared_junction_not_visibly_established",
    "junction_endpoint_not_position_certain",
    "non_junction_rear_endpoint_not_position_certain",
    "side_terminus_not_latent",
    "latent_condition_side_terminus_status_mismatch",
    "frame_truncated_side_terminus_not_contacts_frame",
    "no_authorized_aspect_ratios",
    "duplicate_authorized_aspect_ratio",
    "no_primary_product_classes",
    "duplicate_primary_product_class_identity",
    "duplicate_primary_latent_depth_product",
    "invalid_primary_product_class",
    "no_fov_probes",
    "invalid_fov_probe",
    "duplicate_fov_probe",
  ];
  for (const fact of laterFacts) {
    const idx = order.indexOf(fact);
    assert.ok(idx >= 0, `${fact} missing from order`);
    assert.ok(idxTypeA < idx, `type_a should precede ${fact}`);
    assert.ok(idxTypeB < idx, `type_b should precede ${fact}`);
  }
});

test("resolver results are unchanged by the vocabulary extension", () => {
  // Valid resolve.
  const valid = resolveTypeBCapturedEndpointRoles(baseInput());
  assert.equal(valid.status, "resolved");

  // Tie.
  const tie = resolveTypeBCapturedEndpointRoles(
    baseInput({
      rearSeam: seam(REAR_BASE, {
        startNorm: { x: 0.5, y: 0.5 },
        endNorm: { x: 0.6, y: 0.5 },
      }),
      strongSideSeam: seam(SIDE_BASE, {
        startNorm: { x: 0.5, y: 0.5 },
        endNorm: { x: 0.6, y: 0.5 },
      }),
    })
  );
  assert.equal(tie.status, "refused");
  if (tie.status === "refused") {
    assert.deepEqual(tie.refusalReasons, ["junction_endpoint_pair_tied"]);
  }

  // Beyond tolerance.
  const far = resolveTypeBCapturedEndpointRoles(
    baseInput({
      strongSideSeam: seam(SIDE_BASE, {
        startNorm: { x: 0.5, y: 0.55 },
        endNorm: { x: 0.5, y: 0.95 },
      }),
    })
  );
  assert.equal(far.status, "refused");
  if (far.status === "refused") {
    assert.deepEqual(far.refusalReasons, [
      "shared_junction_not_visibly_established",
    ]);
  }

  // Certainty + latent multi-reason ordering unchanged (no new literal appears).
  const multi = resolveTypeBCapturedEndpointRoles(
    baseInput({
      rearSeam: seam(REAR_BASE, {
        startEndpointStatus: "occluded",
        endEndpointStatus: "occluded",
      }),
      strongSideSeam: seam(SIDE_BASE, {
        startEndpointStatus: "occluded",
        endEndpointStatus: "occluded",
        endFrameContact: "no_frame_contact",
      }),
    })
  );
  assert.equal(multi.status, "refused");
  if (multi.status === "refused") {
    assert.deepEqual(multi.refusalReasons, [
      "junction_endpoint_not_position_certain",
      "non_junction_rear_endpoint_not_position_certain",
      "latent_condition_side_terminus_status_mismatch",
    ]);
    // The resolver never fabricates the capture-eligibility literals.
    assert.ok(!multi.refusalReasons.includes("type_b_not_qualified" as never));
    assert.ok(
      !multi.refusalReasons.includes(
        "type_a_context_not_exhausted_handoff" as never
      )
    );
  }
});

test("committed B3A/B3C/B3D schema strings remain untouched", () => {
  // Reading the upstream constants proves the exact literals are unchanged.
  assert.equal(TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA, "vibode-type-b-evidence-snapshot/v1");
  assert.equal(TYPE_B_EVALUATOR_FAMILY, "rear_points_side_line_one_latent");
  assert.equal(
    TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
    "closest_declared_endpoint_pair_non_tied/v0"
  );
  assert.equal(
    TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
    "min_dim_ratio_clamped/v0"
  );
  assert.equal(
    TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
    "latent_side_extent_times_floor_aspect_ratio/v0"
  );
  assert.equal(
    TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA,
    "vibode-type-b-fov-probe-topology/v0"
  );
  assert.equal(
    TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA,
    "vibode-type-b-branch-association-policy/v0"
  );
});
