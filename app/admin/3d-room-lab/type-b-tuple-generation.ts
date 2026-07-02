// --- Phase B3C: Pure Bounded Type B Tuple Generation ------------------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. A pure, deterministic generator that
// enumerates FUTURE Type B diagnostic coverage from ONE frozen
// `TypeBEvidenceSnapshot` plus an explicitly caller-supplied coverage envelope.
//
// It implements the B3B-R identifiability contract structurally:
//
//   product class  = an identifiable pose-geometry hypothesis
//                    (latentDepthProduct = latentSideExtent × floorAspectRatio).
//   aspect member  = a possible crop-compatibility hypothesis WITHIN a class
//                    (latentSideExtent = latentDepthProduct / floorAspectRatio).
//
// Constant-product members share ONE latent-depth equivalence identity and, at a
// fixed FOV, ONE pose-probe equivalence identity. That shared identity indicates
// common pose geometry, NOT corroboration: this module NEVER counts multiple
// aspect members as multiple pose successes.
//
// ABSOLUTE SCOPE (Phase B3C). Nothing here may implement or perform any of:
//   - P3P / any pose solver, DLT / homography use, FOV scan execution;
//   - corridor generation, crop-compatibility inequality, branch association;
//   - snapshot capture, snapshot freshness checking against live state;
//   - UI, preview, controlled load, Apply, calibration mutation;
//   - candidate / polygon / dimension / FOV / readiness mutation;
//   - persistence, API, routing, production integration.
//
// It performs NO pose evaluation. No result may imply a pose, corridor, basin,
// recommendation, or calibration readiness, and no type/field/literal may
// express ranking, score, confidence, winner, selection, preview, load, or
// Apply. It reads NO live state and mutates NO input.
//
// Runtime imports are restricted to the committed PURE helpers and constants of
// `type-b-evaluator-contract.ts`; all snapshot/tuple shapes are type-only.

import {
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
  TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
  isTypeBLatentDepthProductConditioned,
  makeTypeBLatentDepthEquivalenceClassKey,
  makeTypeBPoseProbeEquivalenceKey,
} from "./type-b-evaluator-contract";
import type {
  TypeBCropCompatibilityState,
  TypeBDiagnosticTuple,
  TypeBEvidenceSnapshot,
  TypeBEvidenceSnapshotBasis,
  TypeBLatentDepthEquivalenceClass,
  TypeBLatentDepthProduct,
  TypeBPoseProbeEquivalence,
} from "./type-b-evaluator-contract";

// --- 1. Coverage-input contract ---------------------------------------------

// Versioned identity for this generation schema. The `/v0` suffix makes a future
// shape/formula change an explicit new identifier, never a silent redefinition.
export const TYPE_B_TUPLE_GENERATION_SCHEMA =
  "vibode-type-b-tuple-generation/v0" as const;

// Inclusive authorized FOV-probe bounds, matching the existing lab convention.
// Probe VALUES are never generated automatically: every probe is caller-supplied
// exactly (no auto-stepping, interpolation, rounding, bucketing, or insertion).
export const TYPE_B_FOV_PROBE_MIN_DEG = 20;
export const TYPE_B_FOV_PROBE_MAX_DEG = 90;

// One explicitly declared primary latent-depth product class. The identity is a
// caller-supplied EXACT token; it must NOT be derived through fuzzy float
// grouping. The product is the identifiable pose axis for this class.
export type TypeBPrimaryLatentDepthProductClassInput = {
  readonly primaryProductClassIdentity: string;
  readonly latentDepthProduct: TypeBLatentDepthProduct;
};

// The pure, caller-provided diagnostic coverage envelope. It carries the primary
// product classes to enumerate and the EXACT FOV probes to pair with permitted
// members. Nothing is auto-stepped, interpolated, rounded, bucketed, or inserted.
export type TypeBTupleGenerationCoverage = {
  readonly primaryProductClasses: readonly TypeBPrimaryLatentDepthProductClassInput[];
  readonly fovProbesDeg: readonly number[];
};

// --- 2. Generation-output contract ------------------------------------------

export type TypeBTupleGenerationStatus = "generated" | "refused";

// Refusal vocabulary. Some literals are run-level (coverage-wide) and some are
// class-level; `invalid_primary_product_class` is used at BOTH scopes (a blank
// caller identity is coverage-wide; an invalid product formula/value is
// class-level). No literal implies a pose, corridor, basin, ranking, or
// selection.
export type TypeBTupleGenerationRefusalReason =
  | "invalid_snapshot_contract"
  | "invalid_floor_assumptions"
  | "no_authorized_aspect_ratios"
  | "duplicate_authorized_aspect_ratio"
  | "no_primary_product_classes"
  | "duplicate_primary_product_class_identity"
  | "duplicate_primary_latent_depth_product"
  | "invalid_primary_product_class"
  | "latent_depth_product_not_conditioned"
  | "no_authorized_aspect_member_for_product_class"
  | "no_fov_probes"
  | "invalid_fov_probe"
  | "duplicate_fov_probe";

// One exact generated tuple record. It carries the four-field tuple plus the
// SHARED grouping identities: `latentDepthEquivalence` (the class this member
// belongs to) and `poseProbeEquivalence` (the per-probe pose-comparison
// identity). Shared identity is common pose geometry, NOT corroboration.
export type TypeBGeneratedTupleRecord = {
  readonly tuple: TypeBDiagnosticTuple;
  readonly latentDepthEquivalence: TypeBLatentDepthEquivalenceClass;
  readonly poseProbeEquivalence: TypeBPoseProbeEquivalence;
};

// One permitted aspect member of a product class. `latentSideExtent` is the
// EXACT `product / floorAspectRatio`. `cropCompatibility` is a DEFERRED state
// only (no crop test is run in B3C).
export type TypeBGeneratedAspectMember = {
  readonly floorAspectRatio: number;
  readonly latentSideExtent: number;
  readonly cropCompatibility: TypeBCropCompatibilityState;
  readonly tuples: readonly TypeBGeneratedTupleRecord[];
};

// One primary product-class record. This is a `status`-DISCRIMINATED union so
// that impossible states are unrepresentable: a generated class always carries a
// non-null equivalence identity, empty refusal reasons, and at least one member;
// a refused class always carries at least one refusal reason and no members.
export type TypeBGeneratedProductClassRecord =
  | TypeBGeneratedProductClassRecordGenerated
  | TypeBGeneratedProductClassRecordRefused;

// A generated class: non-null equivalence identity, no refusal reasons, and a
// non-empty member list (proven at the type level via a head + rest tuple).
export type TypeBGeneratedProductClassRecordGenerated = {
  readonly primaryProductClassIdentity: string;
  readonly latentDepthEquivalence: TypeBLatentDepthEquivalenceClass;
  readonly status: "generated";
  readonly refusalReasons: readonly [];
  readonly members: readonly [
    TypeBGeneratedAspectMember,
    ...TypeBGeneratedAspectMember[]
  ];
};

// A refused class: at least one refusal reason and no members. Its
// `latentDepthEquivalence` is nullable and is `null` ONLY when the class product
// formula/value was invalid (so no honest equivalence identity could be built).
// A below-threshold-but-valid class and a valid-but-no-member class both remain
// refused WITH a non-null equivalence identity. A class-level `status: "refused"`
// is itself an auditable diagnostic fact and does NOT refuse the run.
export type TypeBGeneratedProductClassRecordRefused = {
  readonly primaryProductClassIdentity: string;
  readonly latentDepthEquivalence: TypeBLatentDepthEquivalenceClass | null;
  readonly status: "refused";
  readonly refusalReasons: readonly [
    TypeBTupleGenerationRefusalReason,
    ...TypeBTupleGenerationRefusalReason[]
  ];
  readonly members: readonly [];
};

// The run-level generation result. It echoes the source snapshot basis and the
// exact caller coverage, records each product class (generated or refused), and
// reports exact coverage-fact counts. It has NO best/selected/ranked/scored/
// pose/corridor/basin/preview/load/Apply field by contract.
export type TypeBTupleGenerationResult = {
  readonly schema: typeof TYPE_B_TUPLE_GENERATION_SCHEMA;
  readonly snapshotBasis: TypeBEvidenceSnapshotBasis;
  readonly status: TypeBTupleGenerationStatus;
  readonly refusalReasons: readonly TypeBTupleGenerationRefusalReason[];
  readonly coverage: TypeBTupleGenerationCoverage;
  readonly productClasses: readonly TypeBGeneratedProductClassRecord[];
  readonly summary: {
    readonly requestedPrimaryProductClassCount: number;
    readonly generatedPrimaryProductClassCount: number;
    readonly refusedPrimaryProductClassCount: number;
    readonly generatedAspectMemberCount: number;
    readonly generatedTupleCount: number;
  };
};

// --- 3. Pure internal helpers -----------------------------------------------

// True when a finite, positive number appears more than once by EXACT numeric
// equality (`===`, so NaN never matches and is left for a dedicated invalid
// check). No rounding, tolerance, or bucketing is applied.
function hasExactDuplicateNumber(values: readonly number[]): boolean {
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i] === values[j]) return true;
    }
  }
  return false;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Narrowing type guard: proves a member list is non-empty so a generated class
// record can satisfy its head + rest tuple contract WITHOUT a cast.
function isNonEmptyMemberList(
  members: readonly TypeBGeneratedAspectMember[]
): members is readonly [TypeBGeneratedAspectMember, ...TypeBGeneratedAspectMember[]] {
  return members.length > 0;
}

// --- 4. Main pure generator -------------------------------------------------

// Pure, deterministic bounded Type B tuple generation. Consumes one frozen
// snapshot and one caller coverage envelope; returns a run result. It never
// mutates inputs, never reads live state, never throws for malformed runtime
// input, performs NO pose evaluation, and preserves exact declared ordering
// (primary product-class order, then snapshot `authorizedAspectRatios` order,
// then exact `fovProbesDeg` order). It sorts nothing and ranks nothing.
export function generateTypeBBoundedDiagnosticTuples(
  snapshot: TypeBEvidenceSnapshot,
  coverage: TypeBTupleGenerationCoverage
): TypeBTupleGenerationResult {
  const snapshotBasis = (snapshot?.basis ?? null) as TypeBEvidenceSnapshotBasis;

  const primaryProductClasses = Array.isArray(coverage?.primaryProductClasses)
    ? coverage.primaryProductClasses
    : [];
  const fovProbesDeg = Array.isArray(coverage?.fovProbesDeg)
    ? coverage.fovProbesDeg
    : [];
  const requestedPrimaryProductClassCount = primaryProductClasses.length;

  const runRefusals: TypeBTupleGenerationRefusalReason[] = [];

  // --- Snapshot contract validation (defensive; NOT B1/B3 eligibility) ------
  // The full Type B family contract is checked: schema, the committed evidence
  // family ("rear_seam_plus_strong_side_seam"), and the evaluator family. The
  // evidence-family literal is inlined because the B1 contract exports it as a
  // TYPE only (TypeBEvidenceFamily), never a runtime constant.
  const snapshotContractOk =
    !!snapshot &&
    snapshot.schema === TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA &&
    snapshot.evidenceFamily === "rear_seam_plus_strong_side_seam" &&
    snapshot.evaluatorFamily === TYPE_B_EVALUATOR_FAMILY;
  const latentConditionOk =
    !!snapshot &&
    (snapshot.latentNearCornerCondition === "frame_truncated" ||
      snapshot.latentNearCornerCondition === "occluded");
  if (!snapshotContractOk || !latentConditionOk) {
    runRefusals.push("invalid_snapshot_contract");
  }

  const floorAssumptions = snapshot?.floorAssumptions;
  const authorizedAspectRatios = Array.isArray(
    floorAssumptions?.authorizedAspectRatios
  )
    ? floorAssumptions.authorizedAspectRatios
    : [];

  let floorAssumptionsInvalid = !isFinitePositive(floorAssumptions?.worldWidth);
  for (const aspect of authorizedAspectRatios) {
    if (!isFinitePositive(aspect)) floorAssumptionsInvalid = true;
  }
  if (floorAssumptionsInvalid) runRefusals.push("invalid_floor_assumptions");

  if (authorizedAspectRatios.length === 0) {
    runRefusals.push("no_authorized_aspect_ratios");
  } else if (hasExactDuplicateNumber(authorizedAspectRatios)) {
    runRefusals.push("duplicate_authorized_aspect_ratio");
  }

  // --- Coverage-wide validation (primary classes) ---------------------------
  if (primaryProductClasses.length === 0) {
    runRefusals.push("no_primary_product_classes");
  }

  const identities = primaryProductClasses.map(
    (entry) => entry?.primaryProductClassIdentity
  );
  const validIdentities = identities.filter(isNonBlankString);
  if (hasExactDuplicateString(validIdentities)) {
    runRefusals.push("duplicate_primary_product_class_identity");
  }

  const finiteProductValues = primaryProductClasses
    .map((entry) => entry?.latentDepthProduct?.value)
    .filter(isFinitePositive);
  if (hasExactDuplicateNumber(finiteProductValues)) {
    runRefusals.push("duplicate_primary_latent_depth_product");
  }

  const anyBlankIdentity = identities.some(
    (identity) => !isNonBlankString(identity)
  );
  if (primaryProductClasses.length > 0 && anyBlankIdentity) {
    runRefusals.push("invalid_primary_product_class");
  }

  // --- Coverage-wide validation (FOV probes) --------------------------------
  if (fovProbesDeg.length === 0) {
    runRefusals.push("no_fov_probes");
  } else {
    let invalidProbe = false;
    for (const probe of fovProbesDeg) {
      if (
        !Number.isFinite(probe) ||
        probe < TYPE_B_FOV_PROBE_MIN_DEG ||
        probe > TYPE_B_FOV_PROBE_MAX_DEG
      ) {
        invalidProbe = true;
      }
    }
    if (invalidProbe) runRefusals.push("invalid_fov_probe");
    if (hasExactDuplicateNumber(fovProbesDeg)) {
      runRefusals.push("duplicate_fov_probe");
    }
  }

  if (runRefusals.length > 0) {
    return {
      schema: TYPE_B_TUPLE_GENERATION_SCHEMA,
      snapshotBasis,
      status: "refused",
      refusalReasons: runRefusals,
      coverage,
      productClasses: [],
      summary: {
        requestedPrimaryProductClassCount,
        generatedPrimaryProductClassCount: 0,
        refusedPrimaryProductClassCount: 0,
        generatedAspectMemberCount: 0,
        generatedTupleCount: 0,
      },
    };
  }

  // --- Product-class-first, then aspect-member, then exact-FOV generation ----
  const cropCompatibility: TypeBCropCompatibilityState =
    snapshot.latentNearCornerCondition === "frame_truncated"
      ? "not_evaluated"
      : "not_applicable";

  const productClasses: TypeBGeneratedProductClassRecord[] = [];
  let generatedPrimaryProductClassCount = 0;
  let refusedPrimaryProductClassCount = 0;
  let generatedAspectMemberCount = 0;
  let generatedTupleCount = 0;

  for (const entry of primaryProductClasses) {
    const identity = entry.primaryProductClassIdentity;
    const rawValue = entry?.latentDepthProduct?.value;
    const formulaOk =
      entry?.latentDepthProduct?.formulaId ===
      TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA;
    const classKey = makeTypeBLatentDepthEquivalenceClassKey(identity);

    // Class-level: invalid product formula/value (or unbuildable class key).
    if (!formulaOk || !isFinitePositive(rawValue) || classKey === null) {
      productClasses.push({
        primaryProductClassIdentity: identity,
        latentDepthEquivalence: null,
        status: "refused",
        refusalReasons: ["invalid_primary_product_class"],
        members: [],
      });
      refusedPrimaryProductClassCount += 1;
      continue;
    }

    const product: TypeBLatentDepthProduct = {
      formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
      value: rawValue,
    };
    const latentDepthEquivalence: TypeBLatentDepthEquivalenceClass = {
      formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
      latentDepthProduct: product,
      equivalenceClassKey: classKey,
      poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
    };

    // Class-level: product below the provisional conditioning threshold.
    if (!isTypeBLatentDepthProductConditioned(product)) {
      productClasses.push({
        primaryProductClassIdentity: identity,
        latentDepthEquivalence,
        status: "refused",
        refusalReasons: ["latent_depth_product_not_conditioned"],
        members: [],
      });
      refusedPrimaryProductClassCount += 1;
      continue;
    }

    // One shared per-probe pose-probe equivalence per class (aspect members at
    // the same FOV share ONE identity — common pose geometry, not corroboration).
    const poseProbeEquivalences: TypeBPoseProbeEquivalence[] = fovProbesDeg.map(
      (probe) => ({
        latentDepthEquivalenceClassKey: classKey,
        fovProbeDeg: probe,
        poseProbeEquivalenceKey:
          makeTypeBPoseProbeEquivalenceKey(classKey, probe) ?? "",
      })
    );

    const members: TypeBGeneratedAspectMember[] = [];
    for (const floorAspectRatio of authorizedAspectRatios) {
      const latentSideExtent = product.value / floorAspectRatio;
      if (!(latentSideExtent > 0 && latentSideExtent <= 1)) continue;

      const tuples: TypeBGeneratedTupleRecord[] = fovProbesDeg.map(
        (probe, probeIndex) => ({
          tuple: {
            evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
            latentSideExtent,
            floorAspectRatio,
            fovProbeDeg: probe,
          },
          latentDepthEquivalence,
          poseProbeEquivalence: poseProbeEquivalences[probeIndex],
        })
      );

      members.push({
        floorAspectRatio,
        latentSideExtent,
        cropCompatibility,
        tuples,
      });
    }

    // Class-level: conditioned class with no permitted authorized aspect member.
    if (!isNonEmptyMemberList(members)) {
      productClasses.push({
        primaryProductClassIdentity: identity,
        latentDepthEquivalence,
        status: "refused",
        refusalReasons: ["no_authorized_aspect_member_for_product_class"],
        members: [],
      });
      refusedPrimaryProductClassCount += 1;
      continue;
    }

    productClasses.push({
      primaryProductClassIdentity: identity,
      latentDepthEquivalence,
      status: "generated",
      refusalReasons: [],
      members,
    });
    generatedPrimaryProductClassCount += 1;
    generatedAspectMemberCount += members.length;
    for (const member of members) generatedTupleCount += member.tuples.length;
  }

  return {
    schema: TYPE_B_TUPLE_GENERATION_SCHEMA,
    snapshotBasis,
    status: "generated",
    refusalReasons: [],
    coverage,
    productClasses,
    summary: {
      requestedPrimaryProductClassCount,
      generatedPrimaryProductClassCount,
      refusedPrimaryProductClassCount,
      generatedAspectMemberCount,
      generatedTupleCount,
    },
  };
}

// Local exact-string duplicate check (declared after use; hoisted). Uses `===`
// so only genuinely equal non-blank identities collide. No normalization.
function hasExactDuplicateString(values: readonly string[]): boolean {
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i] === values[j]) return true;
    }
  }
  return false;
}
