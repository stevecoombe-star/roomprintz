// --- Phase B3D-4: Pure Type B Diagnostic Run Assembly -----------------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. A thin, pure, deterministic
// orchestration layer that executes the committed Type B diagnostic leaves in
// their established order and returns ONE immutable, traceable envelope:
//
//   B3C tuple-generation result
//     -> B3D-1 all-root P3P diagnostic evaluation
//     -> optional B3D-2 branch association + lattice-aware FOV corridors
//     -> B3D-3 frame-truncation compatibility
//
// It owns NO diagnostic policy of its own. It invokes B3D-1 exactly once, B3D-2
// zero or exactly once (only when association is requested), and B3D-3 exactly
// once. It never inspects roots, branches, crop outcomes, topology,
// plausibility, or refusals to make a decision; the ONLY decision it makes is
// whether B3D-2 is requested (a non-null association request). It treats the
// `diagnosticRun` echoed by B3D-3 as the canonical final run.
//
// ABSOLUTE SCOPE (Phase B3D-4). This module does NOT implement or perform any
// of: P3P / quartic solving; pose reconstruction / filtering; root
// deduplication; branch association logic; topology validation logic;
// frame-truncation projection logic; crop compatibility logic; endpoint-role
// resolution; tuple generation; snapshot capture; UI; preview; controlled load;
// Apply; calibration mutation; candidate / polygon / dimension / FOV /
// readiness / scene mutation; persistence; API; Type A routing; ranking; score;
// confidence; recommendation; selection; auto-load; auto-apply. It adds no
// mathematical inference, validation policy, root authority, or calibration
// authority. It is orchestration only.
//
// Runtime imports are restricted to the committed PUBLIC B3D-1 / B3D-2 / B3D-3
// leaf functions plus PURE Type B contract types required for typing. It has NO
// React, browser, Three.js, Type A, homography / camera-solver, calibration,
// persistence, API, or routing import and no external mathematics dependency.

import type { TypeBEvidenceSnapshot } from "./type-b-evaluator-contract";
import { evaluateTypeBP3pDiagnosticRun } from "./type-b-p3p-diagnostic-evaluation";
import type { TypeBP3pDiagnosticRunRecord } from "./type-b-p3p-diagnostic-contract";
import type { TypeBFovProbeTopologyDeclaration } from "./type-b-p3p-diagnostic-contract";
import { associateTypeBP3pBranchesAndBuildCorridors } from "./type-b-p3p-branch-association";
import type {
  TypeBBranchAssociationPolicy,
  TypeBBranchAssociationResult,
} from "./type-b-p3p-branch-association";
import { evaluateTypeBFrameTruncationCompatibility } from "./type-b-frame-truncation-compatibility";
import type { TypeBFrameTruncationCompatibilityResult } from "./type-b-frame-truncation-compatibility";
import type { TypeBTupleGenerationResult } from "./type-b-tuple-generation";

// --- 1. Required schema constant (one of the two runtime exports) -----------

// Versioned identity for this diagnostic-run assembly envelope. The `/v0`
// suffix makes a future shape change an explicit new identifier, never a silent
// redefinition.
export const TYPE_B_DIAGNOSTIC_RUN_ASSEMBLY_SCHEMA =
  "vibode-type-b-diagnostic-run-assembly/v0" as const;

// --- 2. Optional association request ----------------------------------------
// Atomic request: topology and policy are either BOTH supplied or NEITHER is
// supplied. B3D-4 supplies no defaults, validates neither object itself, and
// forwards both to B3D-2, which remains the sole authority for association-
// policy and topology assessment.
export type TypeBBranchAssociationAssemblyRequest = {
  readonly topology: TypeBFovProbeTopologyDeclaration;
  readonly policy: TypeBBranchAssociationPolicy;
};

// --- 3. Input ---------------------------------------------------------------

export type TypeBDiagnosticRunAssemblyInput = {
  readonly snapshot: TypeBEvidenceSnapshot;
  readonly tupleGeneration: TypeBTupleGenerationResult;

  /**
   * Null means B3D-2 is deliberately not requested.
   * A supplied request means B3D-2 is called exactly once,
   * even if B3D-1 returns an upstream refusal.
   */
  readonly branchAssociation: TypeBBranchAssociationAssemblyRequest | null;
};

// --- 4. Result --------------------------------------------------------------

export type TypeBDiagnosticRunAssemblyResult = {
  readonly schema: typeof TYPE_B_DIAGNOSTIC_RUN_ASSEMBLY_SCHEMA;

  /**
   * Direct output of one B3D-1 invocation.
   * This is preserved for inspection and never altered by B3D-4.
   */
  readonly p3pDiagnosticRun: TypeBP3pDiagnosticRunRecord;

  /**
   * Null only when association was not requested.
   * Otherwise this is the direct output of one B3D-2 invocation.
   */
  readonly branchAssociation: TypeBBranchAssociationResult | null;

  /**
   * Canonical assembled diagnostic run.
   *
   * This must be exactly the diagnosticRun echoed by the one B3D-3
   * invocation. It may therefore carry:
   * - B3D-1 only;
   * - successful B3D-2 topology and corridors;
   * - B3D-2 topology-only non-assessment facts;
   * - or upstream/linkage refusal facts unchanged.
   */
  readonly diagnosticRun: TypeBP3pDiagnosticRunRecord;

  /**
   * Direct output of one B3D-3 invocation.
   */
  readonly frameTruncationCompatibility: TypeBFrameTruncationCompatibilityResult;
};

// --- 5. Main assembly function ----------------------------------------------

// Pure, deterministic, non-mutating orchestration of the committed Type B
// diagnostic leaves. It never throws for malformed runtime input, holds no
// hidden defaults, invents no substitute diagnostic run, and delegates all
// malformed tuple / snapshot / topology / policy handling to the committed
// downstream leaves. It uses only public committed leaf interfaces and never
// mutates or reinterprets a leaf output.
export function assembleTypeBDiagnosticRun(
  input: TypeBDiagnosticRunAssemblyInput,
): TypeBDiagnosticRunAssemblyResult {
  // Defensive top-level read ONLY: a malformed (non-object) input never throws;
  // the individual snapshot / tuple / request values are forwarded verbatim to
  // the leaves, which own their own malformed-input semantics.
  const source =
    typeof input === "object" && input !== null
      ? (input as Partial<TypeBDiagnosticRunAssemblyInput>)
      : ({} as Partial<TypeBDiagnosticRunAssemblyInput>);
  const snapshot = source.snapshot as TypeBEvidenceSnapshot;
  const tupleGeneration = source.tupleGeneration as TypeBTupleGenerationResult;
  const branchAssociation = source.branchAssociation ?? null;

  // 1. B3D-1 exactly once. Its output is preserved verbatim.
  const p3pDiagnosticRun = evaluateTypeBP3pDiagnosticRun(
    snapshot,
    tupleGeneration,
  );

  // 2. B3D-2 zero times when association is not requested, otherwise exactly
  //    once. A non-null request is forwarded defensively (even if malformed);
  //    B3D-4 never silently converts a malformed non-null request into null.
  let branchAssociationResult: TypeBBranchAssociationResult | null = null;
  let runForCompatibility: TypeBP3pDiagnosticRunRecord = p3pDiagnosticRun;

  if (branchAssociation !== null) {
    branchAssociationResult = associateTypeBP3pBranchesAndBuildCorridors(
      snapshot,
      p3pDiagnosticRun,
      branchAssociation.topology,
      branchAssociation.policy,
    );
    // Whenever association was requested, the B3D-2 output diagnostic run is
    // passed to B3D-3 (even on a not_assessed / topology-only outcome).
    runForCompatibility = branchAssociationResult.diagnosticRun;
  }

  // 3. B3D-3 exactly once, against the B3D-2 run when association was requested,
  //    otherwise directly against the B3D-1 run.
  const frameTruncationCompatibility =
    evaluateTypeBFrameTruncationCompatibility(snapshot, runForCompatibility);

  // 4. The B3D-3-echoed diagnosticRun is the canonical final run. B3D-4 merges
  //    no fields and rebuilds no run of its own.
  return {
    schema: TYPE_B_DIAGNOSTIC_RUN_ASSEMBLY_SCHEMA,
    p3pDiagnosticRun,
    branchAssociation: branchAssociationResult,
    diagnosticRun: frameTruncationCompatibility.diagnosticRun,
    frameTruncationCompatibility,
  };
}
