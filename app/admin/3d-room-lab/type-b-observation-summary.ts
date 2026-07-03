// --- Phase B3G-2: Run-Level Literal Partitions and Refusal Preservation --------
// LAB-ONLY, DIAGNOSTIC-ONLY, READ-ONLY, DETERMINISTIC, NON-MUTATING,
// NON-AUTHORITATIVE. A pure, React-free derivation that condenses the B3E safe
// presentation boundary (`TypeBDiagnosticRunPresentation`) into a versioned,
// immutable observation-summary contract.
//
// B3G-2 extends the B3G-1 contract with run-level LITERAL facts only:
// verbatim refusal / non-assessment literals, literal tallies of
// already-projected literal discriminants (product-class statuses, pose-stage
// kinds, plausibility states, crop-compatibility states), and closed
// four-state partitions with explicit denominators. Every count is a plain
// tally of literal source records. It NEVER derives a percentage, ratio,
// success rate, quality level, score, rank, weight, confidence, composite,
// cross-dimension intersection, "passed all checks" fact, or any preference /
// selection / readiness signal. It never surfaces a pose, coordinate,
// rotation, residual, FOV value, root identifier, hypothesis identifier, or
// any solver / evaluation quantity.
//
// Controlled raw literals: `checkId` values (e.g. a raw
// `camera_above_floor`-style check identity), tuple-generation / pose-stage
// status strings, and refusal / non-assessment reason strings are preserved
// VERBATIM as opaque diagnostic vocabulary. They are copied, never renamed,
// normalized, translated, deduplicated, sorted, scored, or converted into a
// verdict, so they carry no authority: a failed raw observation stays a
// failed raw observation and never becomes a calibration / readiness /
// selection judgment.
//
// Structural containment: its ONLY import is a type-only alias of the B3E
// presentation contract. It has NO runtime dependency on the raw B3D modules
// (`type-b-diagnostic-run-assembly`, `type-b-p3p-diagnostic-evaluation`,
// `type-b-p3p-branch-association`, `type-b-frame-truncation-compatibility`,
// `type-b-tuple-generation`, `type-b-evaluator-contract`), on any solver /
// geometry code, or on `ThreeRoomLab.tsx`. It therefore has no access to
// poses, coordinates, residual magnitudes, solver math, or mutation paths.
//
// It uses no React, no hooks, no module-level mutable state, no `Date`, no
// randomness, no locale-sensitive formatting, and no side effects. It never
// sorts, reorders, or introduces a ranking-friendly ordering field: every list
// it emits preserves exact source order (partition check order is exact
// first-appearance source order). Its only runtime exports are the schema
// literal and `deriveTypeBObservationSummary`.

import type { TypeBDiagnosticRunPresentation } from "./type-b-diagnostic-run-presentation";

// --- 1. Schema ----------------------------------------------------------------

// B3G-2 adds material run-level fields to the committed B3G-1 `/v0` contract,
// so the schema version is minted forward. The `/v0` shape is never returned.
export const TYPE_B_OBSERVATION_SUMMARY_SCHEMA =
  "vibode-type-b-observation-summary/v1" as const;

export type TypeBObservationSummarySchema =
  typeof TYPE_B_OBSERVATION_SUMMARY_SCHEMA;

// --- 2. Contract --------------------------------------------------------------

// Top-level condition: whether a B3E presentation existed at all. It states
// nothing about capture, evaluation, or outcome quality.
export type TypeBObservationSummaryStatus =
  | "no_presentation"
  | "presentation_observed";

// Handoff provenance copied VERBATIM from the B3E capture presentation. It is
// never calculated, reinterpreted, aged, or converted into a freshness /
// staleness verdict. An active lab override is passed through literally and
// never rewritten as (or confused with) actual Type A qualification.
export type TypeBObservationHandoffProvenance = {
  readonly kind: string;
  readonly actualTypeAContext: string;
  readonly effectiveTypeAContext: string;
  readonly labTestOverrideActive: boolean;
  readonly overrideSchema: string | null;
};

// Capture section. B3G-2: a refusal now carries its literal refusal reasons
// VERBATIM (source order, original multiplicity, never collapsed to a count).
// A captured section carries only the verbatim provenance facts.
export type TypeBObservationCaptureSection =
  | { readonly condition: "absent" }
  | {
      readonly condition: "refused";
      readonly refusalLiterals: readonly string[];
    }
  | {
      readonly condition: "captured";
      readonly typeAHandoffProvenance: TypeBObservationHandoffProvenance;
    };

// A class-scoped refusal record. Scope-honest: a refusal tied to a product
// class keeps its owning class identity reference and never masquerades as a
// whole-run refusal. Records preserve exact source class order.
export type TypeBObservationClassRefusalRecord = {
  readonly classIdentityRef: string;
  readonly refusalLiterals: readonly string[];
};

// Run-level tuple-generation facts. Counts are literal tallies of the
// already-projected B3E `tupleClasses` records and their literal status
// discriminants (B3E does not project the stored B3C summary counts). No
// percentage, ratio, quality level, success rate, or completion score exists.
export type TypeBObservationTupleGenerationFacts = {
  readonly status: string;
  readonly requestedProductClassCount: number;
  readonly generatedProductClassCount: number;
  readonly refusedProductClassCount: number;
  readonly memberCount: number;
  readonly tupleCount: number;
  readonly refusalLiterals: readonly string[];
  readonly classRefusalRecords: readonly TypeBObservationClassRefusalRecord[];
};

// Run-level probe / hypothesis facts. Counts only: no FOV value, root
// identifier, hypothesis identifier, residual, pose quantity, or any
// "best / surviving / viable / passing solution" fact is ever derived.
// `authoredFovProbeCount` is null when no captured capture presentation
// exists (never a fabricated zero). Pose-stage refusal literals are copied
// verbatim in probe source order with original multiplicity.
export type TypeBObservationProbeFacts = {
  readonly authoredFovProbeCount: number | null;
  readonly poseProbeCount: number;
  readonly poseStageRefusalCount: number;
  readonly enumeratedHypothesisCount: number;
  readonly poseStageRefusalLiterals: readonly string[];
};

// Closed four-state tally over enumerated-hypothesis plausibility
// observations for one check.
export type TypeBObservationPlausibilityStates = {
  readonly passed: number;
  readonly failed: number;
  readonly not_evaluated: number;
  readonly not_applicable: number;
};

// A complete run-level partition for one already-projected plausibility check
// ID. `checkId` is the raw literal check identity (opaque vocabulary, not a
// verdict). `denominator` is the explicit count of observations recorded for
// that check across enumerated hypotheses. All four states are always
// present, including zero-count states. Checks appear in exact
// first-appearance source order — never sorted by count or favorability.
// There is deliberately NO combined all-checks result of any kind.
export type TypeBObservationPlausibilityPartition = {
  readonly checkId: string;
  readonly denominator: number;
  readonly states: TypeBObservationPlausibilityStates;
};

// Run section. `assembled` carries opaque schema references, the verbatim
// manifest provenance echo, and the B3G-2 run-level literal facts.
export type TypeBObservationRunSection =
  | { readonly condition: "absent" }
  | {
      readonly condition: "assembled";
      readonly assemblySchemaRef: string;
      readonly diagnosticSchemaRef: string;
      readonly labTestOverrideActive: boolean;
      readonly actualTypeAContext: string | null;
      readonly effectiveTypeAContext: string | null;
      readonly handoffKind: string | null;
      readonly tupleGeneration: TypeBObservationTupleGenerationFacts;
      readonly probeFacts: TypeBObservationProbeFacts;
      readonly plausibilityPartitions: readonly TypeBObservationPlausibilityPartition[];
      readonly refusalLiterals: readonly string[];
    };

// Closed association condition union. B3D-2's raw "associated" status is
// NEVER exposed as a summary condition; it maps to the neutral "evaluated"
// literal, which claims only that assessment took place. Association remains
// intentionally contained at B3G-2: no branch, component, annotation,
// matched / unmatched, or link fact is projected. A not-assessed section
// carries only its verbatim source reasons.
export type TypeBObservationAssociationCondition =
  | "not_requested"
  | "not_assessed"
  | "evaluated";

export type TypeBObservationAssociationSection =
  | { readonly condition: "absent" }
  | { readonly condition: "not_requested" }
  | {
      readonly condition: "not_assessed";
      readonly notAssessedLiterals: readonly string[];
    }
  | { readonly condition: "evaluated" };

export type TypeBObservationFrameTruncationCondition =
  | "not_assessed"
  | "evaluated";

// Closed four-state tally over frame-truncation record crop-compatibility
// literals. Independent of plausibility and association: never intersected,
// never a proportion, recommendation, readiness, or usable-camera signal.
export type TypeBObservationFrameTruncationStates = {
  readonly compatible: number;
  readonly incompatible: number;
  readonly not_evaluated: number;
  readonly not_applicable: number;
};

// Frame-truncation section. An evaluated section carries an explicit record
// denominator and a closed four-state partition (zero-count states included).
// A not-assessed section carries its verbatim source reasons and NO
// fabricated compatibility partition or zero counts.
export type TypeBObservationFrameTruncationSection =
  | { readonly condition: "absent" }
  | {
      readonly condition: "not_assessed";
      readonly notAssessedLiterals: readonly string[];
    }
  | {
      readonly condition: "evaluated";
      readonly recordCount: number;
      readonly states: TypeBObservationFrameTruncationStates;
    };

// Opaque source references for future linkage ONLY. They are never used to
// select, prefer, or order anything. `tupleClassIdentityRefs` preserves EXACT
// presentation source order (no sorting, no ordering field).
export type TypeBObservationSourceReferences = {
  readonly sourceImageIdentityRef: string | null;
  readonly sourceFrameKeyRef: string | null;
  readonly tupleClassIdentityRefs: readonly string[];
};

export type TypeBObservationSummary = {
  readonly schema: TypeBObservationSummarySchema;
  readonly status: TypeBObservationSummaryStatus;
  readonly capture: TypeBObservationCaptureSection;
  readonly run: TypeBObservationRunSection;
  readonly association: TypeBObservationAssociationSection;
  readonly frameTruncation: TypeBObservationFrameTruncationSection;
  readonly sourceReferences: TypeBObservationSourceReferences;
};

// --- 3. Pure, defensive read helpers ------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Copies literal string reasons VERBATIM: exact source order, original
// multiplicity, no renaming, no normalization, no deduplication, no sorting,
// no suppression. A non-array yields an empty list.
function copyStringLiterals(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
}

// Recursively freezes the freshly constructed summary output (never an input).
function deepFreeze<T>(value: T): T {
  if (isRecord(value) || Array.isArray(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry);
    }
    Object.freeze(value);
  }
  return value;
}

// --- 4. Stable empty / no-presentation summary --------------------------------

// The single stable no-presentation shape. It manufactures NO evaluated-looking
// fact: no totals, no state partitions, no "zero hypotheses" or "zero
// compatible" claims, and no numeric field of any kind. Frozen constant,
// never mutated. Identical (apart from the schema literal) to B3G-1.
const EMPTY_SUMMARY: TypeBObservationSummary = deepFreeze({
  schema: TYPE_B_OBSERVATION_SUMMARY_SCHEMA,
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
} as TypeBObservationSummary);

// --- 5. Section derivations ----------------------------------------------------

function summarizeCapture(value: unknown): TypeBObservationCaptureSection {
  if (!isRecord(value)) return { condition: "absent" };
  if (value.status === "refused") {
    // Literal refusal facts VERBATIM. Never collapsed to a count, never
    // renamed, never deduplicated, never sorted.
    return {
      condition: "refused",
      refusalLiterals: copyStringLiterals(value.refusalLiterals),
    };
  }
  if (value.status !== "captured") return { condition: "absent" };
  const provenance = asRecord(value.typeAHandoffProvenance);
  return {
    condition: "captured",
    typeAHandoffProvenance: {
      kind: String(provenance.kind),
      actualTypeAContext: String(provenance.actualTypeAContext),
      effectiveTypeAContext: String(provenance.effectiveTypeAContext),
      labTestOverrideActive: provenance.labTestOverrideActive === true,
      overrideSchema: asString(provenance.overrideSchema),
    },
  };
}

// Literal tallies of the already-projected B3E tuple-class records. B3E does
// not project the stored B3C summary counts, so every count here is a plain
// recount of presentation records and their literal status discriminants.
function deriveTupleGenerationFacts(
  runManifest: Record<string, unknown>,
  tupleClasses: unknown
): TypeBObservationTupleGenerationFacts {
  const classes = asArray(tupleClasses).map(asRecord);

  let generatedProductClassCount = 0;
  let refusedProductClassCount = 0;
  let memberCount = 0;
  let tupleCount = 0;
  const classRefusalRecords: TypeBObservationClassRefusalRecord[] = [];

  for (const cls of classes) {
    if (cls.status === "generated") generatedProductClassCount += 1;
    if (cls.status === "refused") refusedProductClassCount += 1;
    const members = asArray(cls.members).map(asRecord);
    memberCount += members.length;
    for (const member of members) {
      tupleCount += asArray(member.probeListDeg).length;
    }
    const refusalLiterals = copyStringLiterals(cls.refusalLiterals);
    if (refusalLiterals.length > 0) {
      // Scope-honest: the refusal keeps its owning class identity reference
      // and its exact source position among refusal records.
      classRefusalRecords.push({
        classIdentityRef: String(cls.primaryProductClassIdentity),
        refusalLiterals,
      });
    }
  }

  return {
    status: String(runManifest.tupleGenerationStatus),
    requestedProductClassCount: classes.length,
    generatedProductClassCount,
    refusedProductClassCount,
    memberCount,
    tupleCount,
    refusalLiterals: copyStringLiterals(
      runManifest.tupleGenerationRefusalLiterals
    ),
    classRefusalRecords,
  };
}

// Counts only. The authored FOV-probe count is a length of the already
// projected capture probe list; no FOV value is ever copied. Pose-stage
// refusals are tallied from the literal "refusal" stage-kind discriminant and
// their literal reasons are preserved verbatim; a refused stage contributes
// no hypotheses (nothing is fabricated).
function deriveProbeFacts(
  capture: unknown,
  poseProbeOutcomes: unknown
): TypeBObservationProbeFacts {
  let authoredFovProbeCount: number | null = null;
  if (
    isRecord(capture) &&
    capture.status === "captured" &&
    Array.isArray(capture.fovProbesDeg)
  ) {
    authoredFovProbeCount = capture.fovProbesDeg.length;
  }

  const probes = asArray(poseProbeOutcomes).map(asRecord);
  let poseStageRefusalCount = 0;
  let enumeratedHypothesisCount = 0;
  const poseStageRefusalLiterals: string[] = [];

  for (const probe of probes) {
    if (probe.poseStageKind === "refusal") poseStageRefusalCount += 1;
    for (const literal of copyStringLiterals(probe.stageRefusalLiterals)) {
      poseStageRefusalLiterals.push(literal);
    }
    enumeratedHypothesisCount += asArray(probe.hypotheses).length;
  }

  return {
    authoredFovProbeCount,
    poseProbeCount: probes.length,
    poseStageRefusalCount,
    enumeratedHypothesisCount,
    poseStageRefusalLiterals,
  };
}

// One complete four-state partition per already-projected plausibility check
// ID, in exact first-appearance source order (Map insertion order; nothing is
// ever sorted). Every partition always carries all four states, including
// zero-count states, plus its explicit observation denominator. No combined
// all-checks fact is ever derived.
function derivePlausibilityPartitions(
  poseProbeOutcomes: unknown
): TypeBObservationPlausibilityPartition[] {
  type MutablePartition = {
    checkId: string;
    denominator: number;
    states: {
      passed: number;
      failed: number;
      not_evaluated: number;
      not_applicable: number;
    };
  };
  const partitions = new Map<string, MutablePartition>();

  for (const probeEntry of asArray(poseProbeOutcomes)) {
    for (const hypothesisEntry of asArray(asRecord(probeEntry).hypotheses)) {
      const observations = asArray(
        asRecord(hypothesisEntry).plausibilityObservations
      );
      for (const observationEntry of observations) {
        const observation = asRecord(observationEntry);
        // B3E projects the raw checkId literal into `label`. It stays a raw
        // literal check identity here, never a verdict or authority key.
        const checkId = String(observation.label);
        let partition = partitions.get(checkId);
        if (!partition) {
          partition = {
            checkId,
            denominator: 0,
            states: {
              passed: 0,
              failed: 0,
              not_evaluated: 0,
              not_applicable: 0,
            },
          };
          partitions.set(checkId, partition);
        }
        partition.denominator += 1;
        const state = observation.state;
        if (
          state === "passed" ||
          state === "failed" ||
          state === "not_evaluated" ||
          state === "not_applicable"
        ) {
          partition.states[state] += 1;
        }
      }
    }
  }

  return [...partitions.values()];
}

function summarizeRun(
  runManifest: unknown,
  capture: unknown,
  tupleClasses: unknown,
  poseProbeOutcomes: unknown
): TypeBObservationRunSection {
  if (!isRecord(runManifest)) return { condition: "absent" };
  return {
    condition: "assembled",
    assemblySchemaRef: String(runManifest.assemblySchema),
    diagnosticSchemaRef: String(runManifest.diagnosticSchema),
    labTestOverrideActive: runManifest.labTestOverrideActive === true,
    actualTypeAContext: asString(runManifest.actualTypeAContext),
    effectiveTypeAContext: asString(runManifest.effectiveTypeAContext),
    handoffKind: asString(runManifest.handoffKind),
    tupleGeneration: deriveTupleGenerationFacts(runManifest, tupleClasses),
    probeFacts: deriveProbeFacts(capture, poseProbeOutcomes),
    plausibilityPartitions: derivePlausibilityPartitions(poseProbeOutcomes),
    refusalLiterals: copyStringLiterals(runManifest.runRefusalLiterals),
  };
}

function summarizeAssociation(
  runManifest: unknown,
  branchCorridors: unknown
): TypeBObservationAssociationSection {
  if (!isRecord(runManifest)) return { condition: "absent" };
  // B3E emits no branch-corridor section when association was not requested.
  if (!isRecord(branchCorridors)) return { condition: "not_requested" };
  // Neutral one-to-one condition mapping. Raw "associated" becomes the neutral
  // "evaluated"; any other status remains the non-claiming "not_assessed",
  // which is never a failure claim and carries only its verbatim source
  // reasons. No branch, component, annotation, or link fact is projected.
  if (branchCorridors.status === "associated") {
    return { condition: "evaluated" };
  }
  return {
    condition: "not_assessed",
    notAssessedLiterals: copyStringLiterals(branchCorridors.notAssessedLiterals),
  };
}

function summarizeFrameTruncation(
  runManifest: unknown,
  frameTruncation: unknown
): TypeBObservationFrameTruncationSection {
  if (!isRecord(runManifest)) return { condition: "absent" };
  if (!isRecord(frameTruncation)) return { condition: "absent" };

  if (frameTruncation.status !== "evaluated") {
    // Non-assessment is not a failure and fabricates no compatibility counts:
    // only the verbatim source reasons are preserved.
    return {
      condition: "not_assessed",
      notAssessedLiterals: copyStringLiterals(
        frameTruncation.notAssessedLiterals
      ),
    };
  }

  const records = asArray(frameTruncation.records).map(asRecord);
  const states = {
    compatible: 0,
    incompatible: 0,
    not_evaluated: 0,
    not_applicable: 0,
  };
  for (const record of records) {
    const state = record.cropCompatibility;
    if (
      state === "compatible" ||
      state === "incompatible" ||
      state === "not_evaluated" ||
      state === "not_applicable"
    ) {
      states[state] += 1;
    }
  }
  return {
    condition: "evaluated",
    recordCount: records.length,
    states,
  };
}

function summarizeSourceReferences(
  capture: unknown,
  tupleClasses: unknown
): TypeBObservationSourceReferences {
  let sourceImageIdentityRef: string | null = null;
  let sourceFrameKeyRef: string | null = null;
  if (isRecord(capture) && capture.status === "captured") {
    const basis = asRecord(capture.basis);
    sourceImageIdentityRef = asString(basis.sourceImageIdentity);
    sourceFrameKeyRef = asString(basis.sourceFrameKey);
  }
  // Exact source order, copied verbatim. Never sorted, never reordered, never
  // paired with a numeric ordering field.
  const tupleClassIdentityRefs = Array.isArray(tupleClasses)
    ? tupleClasses.map((entry) =>
        String(asRecord(entry).primaryProductClassIdentity)
      )
    : [];
  return { sourceImageIdentityRef, sourceFrameKeyRef, tupleClassIdentityRefs };
}

// --- 6. Main derivation ---------------------------------------------------------

/**
 * Pure, deterministic, non-mutating derivation of the B3G-2 observation
 * summary from the B3E safe presentation boundary. `null`, `undefined`, or a
 * malformed runtime value NEVER throws and yields the stable no-presentation
 * shape. Equal inputs produce deeply equal (frozen) output. It exposes ONLY
 * closed neutral condition literals, verbatim provenance / refusal /
 * non-assessment facts, literal tallies with explicit denominators, closed
 * four-state partitions, and opaque source references — never a percentage,
 * ratio, score, rank, composite, pose, coordinate, residual, FOV value,
 * ordering signal, or authority claim.
 */
export function deriveTypeBObservationSummary(
  presentation: TypeBDiagnosticRunPresentation | null | undefined
): TypeBObservationSummary {
  try {
    if (!isRecord(presentation)) return EMPTY_SUMMARY;
    const source = presentation as unknown as Record<string, unknown>;

    return deepFreeze({
      schema: TYPE_B_OBSERVATION_SUMMARY_SCHEMA,
      status: "presentation_observed",
      capture: summarizeCapture(source.capture),
      run: summarizeRun(
        source.runManifest,
        source.capture,
        source.tupleClasses,
        source.poseProbeOutcomes
      ),
      association: summarizeAssociation(
        source.runManifest,
        source.branchCorridors
      ),
      frameTruncation: summarizeFrameTruncation(
        source.runManifest,
        source.frameTruncation
      ),
      sourceReferences: summarizeSourceReferences(
        source.capture,
        source.tupleClasses
      ),
    } as TypeBObservationSummary);
  } catch {
    // Ultimate safety net: never throw for malformed runtime input.
    return EMPTY_SUMMARY;
  }
}
