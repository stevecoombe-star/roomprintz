// --- Phase B3D-5B: Pure Snapshot and Coverage Capture Evaluator -------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. The first PURE Type B capture
// evaluator. It atomically:
//   1. validates explicit Type B capture facts;
//   2. freezes a valid `TypeBEvidenceSnapshot`;
//   3. freezes valid B3C caller coverage;
//   4. uses B3D-5A's endpoint-role resolver VERBATIM;
//   5. computes the evidence and coverage fingerprints;
//   6. returns either a complete captured pair or an ordered refusal result.
//
// It creates CAPTURE INPUTS ONLY. It NEVER runs B3C tuple generation, B3D-1 P3P,
// quartic solving, homography, projection, crop compatibility, branch
// association, topology / branch-policy validation, diagnostic-run assembly,
// root filtering, ranking, confidence, recommendation, selection, preview,
// load, Apply, or calibration mutation. It reads NO live state, mutates NO
// input, and NEVER throws for malformed runtime input.
//
// ABSOLUTE SCOPE: no Type A dimension, aspect grid, FOV range/step, corridor,
// confidence, or calibration-state reuse enters capture inputs or seeds a
// successful output. No UI, React, browser, Three.js, solver / homography /
// camera, calibration, persistence, API, routing, or external mathematics
// dependency exists.
//
// Runtime imports are restricted to: B3D-5A public capture-contract runtime
// functions/constants; pure evaluator-contract constants needed to build the
// exact snapshot shape; and B3C's committed FOV-bound constants needed to
// faithfully mirror its RUN-LEVEL coverage preflight. All data-shape imports are
// `import type`. It NEVER imports B3C's tuple-generation function or any B3D-1/2/
// 3/4 function.

import {
  TYPE_B_CAPTURE_SCHEMA,
  makeTypeBCoverageFingerprint,
  makeTypeBEvidenceFingerprint,
  orderTypeBCaptureRefusalReasons,
  resolveTypeBCapturedEndpointRoles,
} from "./type-b-capture-contract";
import type {
  TypeBCaptureIdentity,
  TypeBCaptureRefusalReason,
  TypeBCaptureResult,
  TypeBExplicitCaptureInputs,
} from "./type-b-capture-contract";
import {
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
} from "./type-b-evaluator-contract";
import type {
  TypeBEvidenceSnapshot,
  TypeBEvidenceSnapshotBasis,
  TypeBFrozenB1QualificationFingerprint,
  TypeBFrozenDeclaredLineEvidence,
  TypeBLatentDepthProduct,
} from "./type-b-evaluator-contract";
import type {
  TypeATypeBContext,
  TypeBDeclaredLineEvidence,
  TypeBLatentNearCornerCondition,
  TypeBSourceFrame,
} from "./type-b-evidence-types";
import {
  TYPE_B_FOV_PROBE_MAX_DEG,
  TYPE_B_FOV_PROBE_MIN_DEG,
} from "./type-b-tuple-generation";
import type { TypeBTupleGenerationCoverage } from "./type-b-tuple-generation";
import { resolveTypeBEffectiveHandoffContext } from "./type-b-test-handoff-override";
import type { TypeBTestHandoffOverride } from "./type-b-test-handoff-override";

// --- 1. Pure capture-input contract -----------------------------------------

// The pure input to the capture evaluator. It carries live basis facts, the two
// live declared seams, the live review latent condition, the live Type A
// context, the frozen B1 qualification fingerprint source, the explicit Type
// B-only operator-authored coverage, and a caller-supplied capture timestamp. It
// carries NO Type A dimension, aspect grid, FOV range/step, corridor, confidence,
// or calibration-state field.
export type TypeBSnapshotAndCoverageCaptureInput = {
  // Live basis facts already derived by the lab. Becomes `snapshot.basis`
  // exactly on success; no repair or fallback.
  readonly basis: TypeBEvidenceSnapshot["basis"];

  // Frozen COPIES are made only on successful capture.
  readonly rearSeam: TypeBDeclaredLineEvidence;
  readonly strongSideSeam: TypeBDeclaredLineEvidence;

  // Deliberately wide enough for live review state. The evaluator accepts only
  // `frame_truncated` / `occluded`.
  readonly latentNearCornerCondition: TypeBLatentNearCornerCondition;

  // The ACTUAL read-only Type A -> Type B context (truthful; never mutated).
  // Capture eligibility is validated against the EFFECTIVE context resolved
  // from this plus the optional lab-only test override (below).
  readonly actualTypeAContext: TypeATypeBContext;

  // Optional lab-only Type B test-handoff override. When it is a valid explicit
  // override AND the actual context is not a genuine exhausted handoff, the
  // EFFECTIVE context becomes `type_a_exhausted_handoff_candidate` for Type B
  // capture eligibility ONLY. `null` (or a malformed value) means no override.
  readonly testHandoffOverride: TypeBTestHandoffOverride | null;

  // The frozen B1 qualification fingerprint source. Capture succeeds only when
  // it is exactly diagnostic eligible with no blocking reasons.
  readonly b1Qualification: TypeBEvidenceSnapshot["b1Qualification"];

  // Explicit Type B-only operator-authored coverage values.
  readonly explicitInputs: TypeBExplicitCaptureInputs;

  // Supplied by the caller. No Date construction in this module. Becomes
  // `snapshot.capturedAtIso` verbatim on success.
  readonly capturedAtIso: string;
};

// --- 2. Pure primitive guards (self-contained; no cross-module coupling) ----

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isObjectRecord(value) ? value : {};
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// True when a value appears more than once by EXACT equality (`===`). No
// rounding, tolerance, bucketing, or normalization is applied, mirroring B3C.
function hasExactDuplicate(values: readonly unknown[]): boolean {
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i] === values[j]) return true;
    }
  }
  return false;
}

// --- 3. Pure frozen-copy constructors (only used on the success path) -------

function freezeSeam(
  seam: TypeBDeclaredLineEvidence
): TypeBFrozenDeclaredLineEvidence {
  // Notes are RETAINED in the frozen seam copy (even though they are excluded
  // from evidence fingerprint identity). Every other field is copied by value.
  return {
    role: seam.role,
    startNorm: { x: seam.startNorm.x, y: seam.startNorm.y },
    endNorm: { x: seam.endNorm.x, y: seam.endNorm.y },
    startEndpointStatus: seam.startEndpointStatus,
    endEndpointStatus: seam.endEndpointStatus,
    startFrameContact: seam.startFrameContact,
    endFrameContact: seam.endFrameContact,
    occlusionStatus: seam.occlusionStatus,
    ...(typeof seam.notes === "string" ? { notes: seam.notes } : {}),
  };
}

function freezeBasis(
  basis: TypeBEvidenceSnapshotBasis
): TypeBEvidenceSnapshotBasis {
  return {
    sourceImageIdentity: basis.sourceImageIdentity,
    sourceFrameKey: basis.sourceFrameKey,
    sourceFrame: {
      width: basis.sourceFrame.width,
      height: basis.sourceFrame.height,
    },
    candidateIdentity: basis.candidateIdentity,
    floorPolygonKey: basis.floorPolygonKey,
  };
}

function freezeB1Qualification(
  b1: TypeBFrozenB1QualificationFingerprint
): TypeBFrozenB1QualificationFingerprint {
  return {
    status: "type_b_diagnostic_eligible",
    blockingReasons: [],
    advisoryReasons: [...b1.advisoryReasons],
    evidenceSummary: {
      rearSeamUsable: b1.evidenceSummary.rearSeamUsable,
      strongSideSeamUsable: b1.evidenceSummary.strongSideSeamUsable,
      rearSideRelationshipUsable: b1.evidenceSummary.rearSideRelationshipUsable,
      latentNearCornerBounded: b1.evidenceSummary.latentNearCornerBounded,
      cropInterpretationUsable: b1.evidenceSummary.cropInterpretationUsable,
    },
  };
}

// Builds a fresh B3C coverage from the authored product classes and FOV probes,
// preserving their EXACT caller order. It sorts, deduplicates, interpolates,
// generates, and repairs NOTHING; each product/probe value is copied verbatim.
function freezeCoverage(
  primaryProductClasses: readonly unknown[],
  fovProbesDeg: readonly unknown[]
): TypeBTupleGenerationCoverage {
  return {
    primaryProductClasses: primaryProductClasses.map((entry) => {
      const e = asRecord(entry);
      const product = asRecord(e.latentDepthProduct);
      return {
        primaryProductClassIdentity: e.primaryProductClassIdentity as string,
        latentDepthProduct: {
          formulaId: product.formulaId as TypeBLatentDepthProduct["formulaId"],
          value: product.value as number,
        },
      };
    }),
    fovProbesDeg: fovProbesDeg.map((value) => value as number),
  };
}

// --- 4. The pure capture evaluator ------------------------------------------

function refuse(
  reasons: readonly TypeBCaptureRefusalReason[]
): TypeBCaptureResult {
  const ordered = orderTypeBCaptureRefusalReasons(new Set(reasons));
  const [head, ...rest] =
    ordered.length > 0 ? ordered : (["invalid_snapshot_basis"] as const);
  return {
    schema: TYPE_B_CAPTURE_SCHEMA,
    status: "refused",
    refusalReasons: [head, ...rest],
  };
}

/**
 * Pure, deterministic, all-or-nothing capture of a frozen Type B evidence
 * snapshot plus its authored B3C coverage. On success it returns a complete
 * `TypeBCaptureSuccess` (frozen snapshot, frozen coverage, evidence + coverage
 * fingerprints, empty refusal list). On ANY refusal it returns a
 * `TypeBCaptureRefusal` with the non-empty canonical ordered refusal tuple and
 * NO snapshot, coverage, or identity.
 *
 * It NEVER runs B3C or any B3D leaf, NEVER computes fingerprints on refusal,
 * NEVER mutates its input, and NEVER throws for malformed runtime input.
 */
export function captureTypeBSnapshotAndCoverage(
  input: TypeBSnapshotAndCoverageCaptureInput
): TypeBCaptureResult {
  try {
    const reasons = new Set<TypeBCaptureRefusalReason>();

    const safeInput = asRecord(input) as Partial<
      Record<keyof TypeBSnapshotAndCoverageCaptureInput, unknown>
    >;
    const basis = safeInput.basis;
    const rearSeam = safeInput.rearSeam;
    const strongSideSeam = safeInput.strongSideSeam;
    const condition = safeInput.latentNearCornerCondition;
    const actualTypeAContext = safeInput.actualTypeAContext;
    const testHandoffOverride = safeInput.testHandoffOverride;
    const b1Qualification = safeInput.b1Qualification;

    // --- B3F-O. Resolve the EFFECTIVE Type B handoff context from the ACTUAL
    // Type A context plus the optional lab-only test override. The resolver is
    // pure and never throws or promotes the actual context for a malformed
    // override. Capture eligibility below is validated against the EFFECTIVE
    // context; the ACTUAL context is preserved only in the returned provenance.
    const handoffResolution = resolveTypeBEffectiveHandoffContext(
      actualTypeAContext as TypeATypeBContext,
      (testHandoffOverride ?? null) as TypeBTestHandoffOverride | null
    );
    const explicitInputs = safeInput.explicitInputs;
    const capturedAtIso = safeInput.capturedAtIso;

    // --- A. General basis validation (conservative; no repair / fallback) ----
    const basisRec = asRecord(basis);
    const frameRec = asRecord(basisRec.sourceFrame);
    const basisValid =
      isObjectRecord(basis) &&
      isNonBlankString(basisRec.sourceImageIdentity) &&
      isNonBlankString(basisRec.sourceFrameKey) &&
      isFinitePositive(frameRec.width) &&
      isFinitePositive(frameRec.height) &&
      isNonBlankString(basisRec.candidateIdentity) &&
      isNonBlankString(basisRec.floorPolygonKey) &&
      isNonBlankString(capturedAtIso);
    if (!basisValid) reasons.add("invalid_snapshot_basis");

    // --- E-world-width. Explicit Type B world-width validity ONLY. A missing /
    // non-finite / zero / negative `worldWidth` refuses with `invalid_world_
    // width`; this literal never stands in for an aspect fault.
    const explicitRec = asRecord(explicitInputs);
    const worldWidth = explicitRec.worldWidth;
    const authorizedAspectRatios = Array.isArray(
      explicitRec.authorizedAspectRatios
    )
      ? explicitRec.authorizedAspectRatios
      : [];
    if (!isFinitePositive(worldWidth)) reasons.add("invalid_world_width");

    // --- E-aspect-validity. Authorized-aspect member validity. A non-finite /
    // zero / negative aspect member reuses B3C's exact run-level
    // `invalid_floor_assumptions` literal (never collapsed into
    // `invalid_world_width`, and never a new invalid-aspect literal). Emptiness
    // and duplication are separate coverage-shape facts (below).
    let anyAspectInvalid = false;
    for (const aspect of authorizedAspectRatios) {
      if (!isFinitePositive(aspect)) anyAspectInvalid = true;
    }
    if (anyAspectInvalid) reasons.add("invalid_floor_assumptions");

    // --- E-aspect. Authorized-aspect coverage shape (mirrors B3C run-level:
    // empty precludes the duplicate check via `else if`).
    if (authorizedAspectRatios.length === 0) {
      reasons.add("no_authorized_aspect_ratios");
    } else if (hasExactDuplicate(authorizedAspectRatios)) {
      reasons.add("duplicate_authorized_aspect_ratio");
    }

    // --- C. Latent condition authorization. Only `frame_truncated` /
    // `occluded` are capture-authorized; `unresolved` / `not_needed_visible`
    // are never coerced.
    const conditionAuthorized =
      condition === "frame_truncated" || condition === "occluded";
    if (!conditionAuthorized) reasons.add("latent_condition_not_authorized");

    // --- B. Type A handoff context, validated against the EFFECTIVE context.
    // A valid active lab override makes the effective context exhausted even
    // when the actual context is not; with no valid override the effective
    // context equals the actual, so this remains the ordinary refusal.
    if (
      handoffResolution.effectiveTypeAContext !==
      "type_a_exhausted_handoff_candidate"
    ) {
      reasons.add("type_a_context_not_exhausted_handoff");
    }

    // --- B. B1 eligibility. Exactly eligible with no blocking reasons; any
    // malformed or non-eligible qualification refuses. B1 is NEVER re-run.
    const b1Rec = asRecord(b1Qualification);
    const b1Eligible =
      isObjectRecord(b1Qualification) &&
      b1Rec.status === "type_b_diagnostic_eligible" &&
      Array.isArray(b1Rec.blockingReasons) &&
      b1Rec.blockingReasons.length === 0 &&
      Array.isArray(b1Rec.advisoryReasons) &&
      isObjectRecord(b1Rec.evidenceSummary);
    if (!b1Eligible) reasons.add("type_b_not_qualified");

    // --- D. Endpoint roles + frozen junction, via B3D-5A VERBATIM. The
    // resolver is pure and never throws, so it is always safe to call; it
    // validates the source frame + seam geometry itself. Every resolver refusal
    // literal is merged into the capture refusal set. On success its endpoint
    // roles and junction are used unchanged.
    const resolution = resolveTypeBCapturedEndpointRoles({
      sourceFrame: basisRec.sourceFrame as TypeBSourceFrame,
      rearSeam: rearSeam as TypeBDeclaredLineEvidence,
      strongSideSeam: strongSideSeam as TypeBDeclaredLineEvidence,
      latentNearCornerCondition: condition as "frame_truncated" | "occluded",
    });
    if (resolution.status === "refused") {
      for (const reason of resolution.refusalReasons) reasons.add(reason);
    }

    // --- E-classes. Primary product classes (mirrors B3C RUN-LEVEL rules only;
    // class-level conditions such as an invalid product formula/value, a below-
    // threshold product, or no permitted aspect member are NOT rejected here and
    // remain capturable).
    const primaryProductClasses = Array.isArray(explicitRec.primaryProductClasses)
      ? explicitRec.primaryProductClasses
      : [];
    if (primaryProductClasses.length === 0) {
      reasons.add("no_primary_product_classes");
    }
    const identities = primaryProductClasses.map(
      (entry) => asRecord(entry).primaryProductClassIdentity
    );
    const validIdentities = identities.filter(isNonBlankString);
    if (hasExactDuplicate(validIdentities)) {
      reasons.add("duplicate_primary_product_class_identity");
    }
    const finiteProductValues = primaryProductClasses
      .map((entry) => asRecord(asRecord(entry).latentDepthProduct).value)
      .filter(isFinitePositive);
    if (hasExactDuplicate(finiteProductValues)) {
      reasons.add("duplicate_primary_latent_depth_product");
    }
    const anyBlankIdentity = identities.some(
      (identity) => !isNonBlankString(identity)
    );
    if (primaryProductClasses.length > 0 && anyBlankIdentity) {
      reasons.add("invalid_primary_product_class");
    }

    // --- E-probes. FOV probes (mirrors B3C run-level: empty precludes the
    // invalid / duplicate checks via `else`). Probes are never sorted,
    // deduplicated, interpolated, generated, scanned, or inferred.
    const fovProbesDeg = Array.isArray(explicitRec.fovProbesDeg)
      ? explicitRec.fovProbesDeg
      : [];
    if (fovProbesDeg.length === 0) {
      reasons.add("no_fov_probes");
    } else {
      let invalidProbe = false;
      for (const probe of fovProbesDeg) {
        const value = probe as number;
        if (
          !Number.isFinite(value) ||
          value < TYPE_B_FOV_PROBE_MIN_DEG ||
          value > TYPE_B_FOV_PROBE_MAX_DEG
        ) {
          invalidProbe = true;
        }
      }
      if (invalidProbe) reasons.add("invalid_fov_probe");
      if (hasExactDuplicate(fovProbesDeg)) {
        reasons.add("duplicate_fov_probe");
      }
    }

    // --- F. Atomicity + canonical refusal order. If ANY refusal exists, return
    // a refusal with NO snapshot / coverage / identity and NO fingerprints.
    const ordered = orderTypeBCaptureRefusalReasons(reasons);
    if (ordered.length > 0) {
      const [head, ...rest] = ordered;
      return {
        schema: TYPE_B_CAPTURE_SCHEMA,
        status: "refused",
        refusalReasons: [head, ...rest],
      };
    }

    // Defensive contradiction guard (unreachable in practice): zero refusals
    // implies a resolved resolution, since a refused resolution merged reasons.
    if (resolution.status !== "resolved") {
      return refuse(["invalid_snapshot_basis"]);
    }

    // Defensive contradiction guard (unreachable in practice): zero refusals
    // implies the effective context passed the exhausted-handoff gate, which
    // only happens with non-null provenance (genuine handoff OR valid override).
    if (handoffResolution.provenance === null) {
      return refuse(["invalid_snapshot_basis"]);
    }

    // --- G. Successful snapshot + coverage construction. Only reached with zero
    // refusals. Basis, seams, qualification, floor assumptions, and timestamp are
    // deep-copied; the resolver's frozen endpoint roles and junction are used
    // unchanged; coverage is freshly built preserving exact authored order.
    const snapshot: TypeBEvidenceSnapshot = {
      schema: TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
      evidenceFamily: "rear_seam_plus_strong_side_seam",
      evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
      basis: freezeBasis(basis as TypeBEvidenceSnapshotBasis),
      rearSeam: freezeSeam(rearSeam as TypeBDeclaredLineEvidence),
      strongSideSeam: freezeSeam(strongSideSeam as TypeBDeclaredLineEvidence),
      latentNearCornerCondition: condition as "frame_truncated" | "occluded",
      floorAssumptions: {
        worldWidth: worldWidth as number,
        authorizedAspectRatios: authorizedAspectRatios.map(
          (aspect) => aspect as number
        ),
      },
      typeAContext: "type_a_exhausted_handoff_candidate",
      b1Qualification: freezeB1Qualification(
        b1Qualification as TypeBFrozenB1QualificationFingerprint
      ),
      junction: resolution.junction,
      endpointRoles: resolution.endpointRoles,
      capturedAtIso: capturedAtIso as string,
    };

    const coverage = freezeCoverage(primaryProductClasses, fovProbesDeg);

    const identity: TypeBCaptureIdentity = {
      evidenceFingerprint: makeTypeBEvidenceFingerprint(snapshot),
      coverageFingerprint: makeTypeBCoverageFingerprint(snapshot, coverage),
    };

    return {
      schema: TYPE_B_CAPTURE_SCHEMA,
      status: "captured",
      snapshot,
      coverage,
      identity,
      // The verbatim provenance: whether the EFFECTIVE exhausted context was a
      // genuine Type A handoff or a lab-only Type B test override. The snapshot
      // `typeAContext` remains the effective handoff literal for B3C/B3D.
      typeAHandoffProvenance: handoffResolution.provenance,
      refusalReasons: [],
    };
  } catch {
    // Ultimate safety net: never throw for malformed runtime input.
    return refuse(["invalid_snapshot_basis"]);
  }
}
