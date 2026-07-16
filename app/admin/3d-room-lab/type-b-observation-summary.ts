// --- Phase B3G-4: Per-Class, Per-Probe, and Per-Component Observation Records ----
// LAB-ONLY, DIAGNOSTIC-ONLY, READ-ONLY, DETERMINISTIC, NON-MUTATING,
// NON-AUTHORITATIVE. A pure, React-free derivation that condenses the B3E safe
// presentation boundary (`TypeBDiagnosticRunPresentation`) into a versioned,
// immutable observation-summary contract.
//
// B3G-2 extended the B3G-1 contract with run-level LITERAL facts only:
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
// B3G-3 adds run-level literal ASSOCIATION facts to the evaluated association
// arm only: a component-aggregate reconciliation (each B3E-presented branch
// corridor is one anonymous diagnostic component) and a closed five-state
// annotation observation matrix in fixed vocabulary order. The raw annotation
// state literals ("associated", "tied_ambiguous", "unmatched_terminated",
// "unmatched_born", "near_coincident_unresolved") are permitted ONLY inside
// `annotationStateCounts[].state`. They never become a condition, headline,
// verdict, recommendation, ordering principle, or selection affordance. No
// component identifier, branch index, root reference, probe identity,
// component size, span, topology, or policy value is emitted, and association
// facts are never intersected with plausibility, frame-truncation, tuple, Type
// A, or override facts.
//
// Controlled raw literals: `checkId` values (e.g. a raw
// `camera_above_floor`-style check identity), tuple-generation / pose-stage
// status strings, refusal / non-assessment reason strings, and the closed
// five-state association annotation vocabulary are preserved VERBATIM as
// opaque diagnostic vocabulary. They are copied, never renamed, normalized,
// translated, deduplicated, sorted, scored, or converted into a verdict, so
// they carry no authority: a failed raw observation stays a failed raw
// observation and never becomes a calibration / readiness / selection
// judgment, and an "associated" annotation stays a raw matrix tally and never
// becomes a matched / validated / preferred-branch claim.
//
// B3G-4 organizes the SAME already-projected literal facts at three additional
// observation levels, without creating any new dimension, verdict, or
// authority:
//   * `run.classObservations` — one source-ordered record per projected tuple
//     / product class (opaque `classIdentityRef` only; a refused class keeps
//     its verbatim refusal literals and fabricates NO member / tuple / probe /
//     hypothesis / compatibility fact);
//   * `run.probeObservations` — one source-ordered record per projected pose
//     probe (a refused stage keeps its verbatim literals and fabricates NO
//     census / hypothesis / partition fact; an enumerated stage carries the
//     four independent raw root-census counts VERBATIM — a monotonic
//     mathematical census that is never summed or read as quality);
//   * `association.componentObservations` — one source-ordered anonymous
//     record per evaluated branch component (literal `referenceCount` /
//     `annotationCount` plus the closed five-state matrix; never an identity,
//     index, label, root reference, endpoint, FOV, topology, policy, span, or
//     size fact, and never a sort / promotion input).
// Class-scoped frame-truncation observations exist ONLY when the global
// frame-truncation condition is genuinely `evaluated` (safe linkage via the
// already-projected opaque class identity). B3E projects NO probe linkage for
// frame-truncation records (they carry only a raw pose-probe equivalence key
// that the probe presentation does not expose), so NO probe-scoped
// compatibility observation is fabricated. No record at any level carries a
// cross-dimension composite, ordinal, rank, or "best / usable / ready" fact.
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

// B3G-4 materially expands the committed B3G-3 `/v2` contract (the assembled
// run arm gains `classObservations` / `probeObservations` and the evaluated
// association arm gains `componentObservations`), so the schema version is
// minted forward. No `/v0`, `/v1`, or `/v2` shape is ever returned.
// Repository search confirms no non-test consumer exists, so no compatibility
// adapter is needed.
export const TYPE_B_OBSERVATION_SUMMARY_SCHEMA =
  "vibode-type-b-observation-summary/v3" as const;

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

// B3G-4 scoped frame-truncation observation. It exists ONLY where the GLOBAL
// frame-truncation condition is genuinely "evaluated" and safe linkage is
// projected by B3E (the opaque class identity). `recordCount` is the explicit
// scoped denominator; all four compatibility states are always present,
// including zero-count states. An unknown future compatibility state stays in
// the denominator but in no known count, so reconciliation fails loudly. It
// is never intersected with plausibility, association, or any other
// dimension, and it is never a proportion, recommendation, or readiness
// signal.
export type TypeBObservationScopedFrameTruncationObservation = {
  readonly recordCount: number;
  readonly states: TypeBObservationFrameTruncationStates;
};

// B3G-4 per-class observation record. `classIdentityRef` is an OPAQUE
// identity reference only (never a sort, rank, or selection input). A refused
// class stays represented with its verbatim, source-ordered,
// duplicate-preserving refusal literals and STRUCTURALLY cannot carry any
// member / tuple / probe / hypothesis / partition / compatibility fact. A
// generated class carries literal counts of already-projected records only.
// Class-level compatibility (`frameTruncationObservation`, null unless the
// GLOBAL frame-truncation condition is "evaluated") is independent of
// class-level plausibility; no combined "viable / valid / best / usable /
// ready" verdict exists. A class whose projected status is an unknown future
// literal appears in NO record here while remaining inside the
// `requestedProductClassCount` denominator, so reconciliation fails loudly.
export type TypeBObservationClassObservation =
  | {
      readonly classIdentityRef: string;
      readonly condition: "refused";
      readonly refusalLiterals: readonly string[];
    }
  | {
      readonly classIdentityRef: string;
      readonly condition: "generated";
      readonly refusalLiterals: readonly string[];
      readonly memberCount: number;
      readonly tupleCount: number;
      readonly poseProbeCount: number;
      readonly enumeratedHypothesisCount: number;
      readonly plausibilityPartitions: readonly TypeBObservationPlausibilityPartition[];
      readonly frameTruncationObservation: TypeBObservationScopedFrameTruncationObservation | null;
    };

// The four independent raw root-census counts, copied VERBATIM where B3E
// provides them. They are a monotonic mathematical census of one probe's
// polynomial root pipeline — NOT partitions of one denominator. They are
// never summed, never combined, and never presented as a quality signal.
export type TypeBObservationProbeRootCensusObservation = {
  readonly algebraicCandidateCount: number;
  readonly realRootCount: number;
  readonly positiveDistanceRootCount: number;
  readonly deduplicatedRootCount: number;
};

// B3G-4 per-probe observation record. Deliberately ANONYMOUS: no FOV value,
// pose-probe equivalence key, root ID, hypothesis ID, camera value, pose,
// rotation, residual, branch link, topology, ordinal, rank, or priority is
// ever emitted — the list itself preserves exact B3E source order. A refused
// pose stage keeps its verbatim literal reasons and STRUCTURALLY cannot carry
// a census, hypothesis count, or plausibility partition. B3E projects no safe
// probe linkage for frame-truncation records, so no probe-scoped
// compatibility observation exists. A probe whose projected stage kind is an
// unknown future literal appears in NO record here while remaining inside the
// `poseProbeCount` denominator, so reconciliation fails loudly.
export type TypeBObservationProbeObservation =
  | {
      readonly poseStageCondition: "refused";
      readonly stageRefusalLiterals: readonly string[];
    }
  | {
      readonly poseStageCondition: "enumerated";
      readonly rootCensus: TypeBObservationProbeRootCensusObservation | null;
      readonly enumeratedHypothesisCount: number;
      readonly plausibilityPartitions: readonly TypeBObservationPlausibilityPartition[];
    };

// Run section. `assembled` carries opaque schema references, the verbatim
// manifest provenance echo, the B3G-2 run-level literal facts, and the B3G-4
// per-class / per-probe observation records (exact source order, no sorting,
// no ranking field).
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
      readonly classObservations: readonly TypeBObservationClassObservation[];
      readonly probeObservations: readonly TypeBObservationProbeObservation[];
      readonly refusalLiterals: readonly string[];
    };

// Closed association condition union. B3D-2's raw "associated" status is
// NEVER exposed as a summary condition; it maps to the neutral "evaluated"
// literal, which claims only that assessment took place. A not-assessed
// section carries only its verbatim source reasons and NO fabricated matrix
// or zero-state partition.
export type TypeBObservationAssociationCondition =
  | "not_requested"
  | "not_assessed"
  | "evaluated";

// The closed five-state raw association annotation vocabulary, in the ONLY
// order it is ever emitted. These raw literals are controlled diagnostic
// state values permitted exclusively inside `annotationStateCounts[].state`;
// they never become a condition, headline, verdict, recommendation, ordering
// principle, or selection affordance. The "unmatched_*" literals stay raw
// diagnostic states and never produce any "matched" claim.
export type TypeBObservationAssociationAnnotationState =
  | "associated"
  | "tied_ambiguous"
  | "unmatched_terminated"
  | "unmatched_born"
  | "near_coincident_unresolved";

// One literal tally entry of the closed five-state matrix. All five states
// are always present (zero counts included) in fixed vocabulary order — never
// sorted by count, apparent favorability, component length, or source
// position.
export type TypeBObservationAssociationAnnotationStateCount = {
  readonly state: TypeBObservationAssociationAnnotationState;
  readonly count: number;
};

// Literal presence observation over raw "associated" annotations. It is a
// descriptive observation only, never a verdict, match claim, or readiness
// signal.
export type TypeBObservationAssociatedAnnotationObservation =
  | "none_observed"
  | "one_or_more_observed";

// B3G-4 per-component observation record. Each B3E-presented branch corridor
// is one ANONYMOUS diagnostic component in exact source order: no branch
// index, branch label, enumeration number, root reference, endpoint
// reference, FOV, topology, policy, span, length, or component-size ranking
// signal is ever emitted. `referenceCount` is a literal diagnostic count only
// — never a "longest / strongest / primary / best" fact or a sort criterion.
// The five-state matrix keeps its fixed vocabulary order with zero-count
// states included, and the component's `annotationCount` is the literal
// source total (unknown future states INCLUDED, so reconciliation fails
// loudly). `one_or_more_observed` arises ONLY from at least one exact raw
// "associated" annotation on THIS component.
export type TypeBObservationComponentObservation = {
  readonly referenceCount: number;
  readonly annotationCount: number;
  readonly associatedAnnotationObservation: TypeBObservationAssociatedAnnotationObservation;
  readonly annotationStateCounts: readonly TypeBObservationAssociationAnnotationStateCount[];
};

// B3G-3 evaluated-association observation matrix, extended by the B3G-4
// per-component records. Each B3E-presented branch corridor is one ANONYMOUS
// diagnostic component: no component identifier, branch index, root
// reference, probe identity, component size, span, topology, or policy value
// is ever emitted. A component counts as "with associated annotations" only
// when at least one of its annotations carries the exact raw literal state
// "associated"; ambiguity / unresolved annotations never make a component
// associated. `annotationCount` is the literal total of source annotations
// (unknown future states INCLUDED, so a foreign state surfaces as a loud
// reconciliation mismatch against the five-state sum instead of silently
// vanishing or being coerced). `componentObservations` exists ONLY on this
// evaluated arm — never for absent, not_requested, or not_assessed
// association.
export type TypeBObservationAssociationSection =
  | { readonly condition: "absent" }
  | { readonly condition: "not_requested" }
  | {
      readonly condition: "not_assessed";
      readonly notAssessedLiterals: readonly string[];
    }
  | {
      readonly condition: "evaluated";
      readonly componentCount: number;
      readonly componentsWithAssociatedAnnotations: number;
      readonly componentsWithoutAssociatedAnnotations: number;
      readonly annotationCount: number;
      readonly associatedAnnotationObservation: TypeBObservationAssociatedAnnotationObservation;
      readonly annotationStateCounts: readonly TypeBObservationAssociationAnnotationStateCount[];
      readonly componentObservations: readonly TypeBObservationComponentObservation[];
    };

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

// Closed four-state tally over literal crop-compatibility discriminants. An
// unknown future state gains no known count (its record still counts in the
// caller's explicit denominator, so reconciliation fails loudly).
function tallyCropCompatibilityStates(
  records: readonly Record<string, unknown>[]
): TypeBObservationFrameTruncationStates {
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
  return states;
}

// Class-scoped frame-truncation observation via the ONLY safe linkage B3E
// projects: the opaque class identity carried verbatim on each record. It is
// null (never a fabricated zero partition) unless the GLOBAL frame-truncation
// condition is genuinely "evaluated"; global non-assessment literals stay at
// the global level and never become a class-scoped failure.
function deriveScopedFrameTruncationObservation(
  classIdentityRef: string,
  frameTruncation: unknown
): TypeBObservationScopedFrameTruncationObservation | null {
  if (!isRecord(frameTruncation)) return null;
  if (frameTruncation.status !== "evaluated") return null;
  const scopedRecords = asArray(frameTruncation.records)
    .map(asRecord)
    .filter(
      (record) =>
        String(record.primaryProductClassIdentity) === classIdentityRef
    );
  return {
    recordCount: scopedRecords.length,
    states: tallyCropCompatibilityStates(scopedRecords),
  };
}

// One source-ordered observation record per already-projected tuple class.
// Class → probe linkage uses ONLY the already-projected product equivalence
// key, which is never emitted itself. A class with an unknown future status
// literal is represented by NO record (it stays inside the
// requestedProductClassCount denominator so reconciliation fails loudly, and
// it is never coerced into "generated" or "refused").
function deriveClassObservations(
  tupleClasses: unknown,
  poseProbeOutcomes: unknown,
  frameTruncation: unknown
): TypeBObservationClassObservation[] {
  const observations: TypeBObservationClassObservation[] = [];
  const probes = asArray(poseProbeOutcomes).map(asRecord);

  for (const classEntry of asArray(tupleClasses)) {
    const cls = asRecord(classEntry);
    const classIdentityRef = String(cls.primaryProductClassIdentity);

    if (cls.status === "refused") {
      // Refusal facts VERBATIM only. No member, tuple, probe, hypothesis,
      // partition, or compatibility fact is fabricated for a refused class.
      observations.push({
        classIdentityRef,
        condition: "refused",
        refusalLiterals: copyStringLiterals(cls.refusalLiterals),
      });
      continue;
    }
    if (cls.status !== "generated") continue;

    const members = asArray(cls.members).map(asRecord);
    let tupleCount = 0;
    for (const member of members) {
      tupleCount += asArray(member.probeListDeg).length;
    }
    const equivalenceKey = asString(cls.productEquivalenceKey);
    const classProbes =
      equivalenceKey === null
        ? []
        : probes.filter(
            (probe) => probe.productEquivalenceKey === equivalenceKey
          );
    let enumeratedHypothesisCount = 0;
    for (const probe of classProbes) {
      enumeratedHypothesisCount += asArray(probe.hypotheses).length;
    }

    observations.push({
      classIdentityRef,
      condition: "generated",
      refusalLiterals: copyStringLiterals(cls.refusalLiterals),
      memberCount: members.length,
      tupleCount,
      poseProbeCount: classProbes.length,
      enumeratedHypothesisCount,
      plausibilityPartitions: derivePlausibilityPartitions(classProbes),
      frameTruncationObservation: deriveScopedFrameTruncationObservation(
        classIdentityRef,
        frameTruncation
      ),
    });
  }
  return observations;
}

// One source-ordered, ANONYMOUS observation record per already-projected pose
// probe. No FOV value, equivalence key, root ID, hypothesis ID, camera value,
// pose, rotation, residual, branch link, topology, ordinal, or rank is ever
// copied. A probe with an unknown future stage-kind literal is represented by
// NO record (it stays inside the poseProbeCount denominator so reconciliation
// fails loudly). B3E projects no safe probe linkage for frame-truncation
// records, so no probe-scoped compatibility observation exists.
function deriveProbeObservations(
  poseProbeOutcomes: unknown
): TypeBObservationProbeObservation[] {
  const observations: TypeBObservationProbeObservation[] = [];

  for (const probeEntry of asArray(poseProbeOutcomes)) {
    const probe = asRecord(probeEntry);
    if (probe.poseStageKind === "refusal") {
      // Refusal facts VERBATIM only. No census, hypothesis count, or
      // plausibility partition is fabricated for a refused pose stage.
      observations.push({
        poseStageCondition: "refused",
        stageRefusalLiterals: copyStringLiterals(probe.stageRefusalLiterals),
      });
      continue;
    }
    if (probe.poseStageKind !== "pose_hypotheses") continue;

    // The four raw census counts are copied VERBATIM where B3E provides them
    // (null otherwise, never a fabricated zero census). They are independent
    // monotonic census facts, never summed or combined.
    const census = isRecord(probe.rootCensus) ? probe.rootCensus : null;
    observations.push({
      poseStageCondition: "enumerated",
      rootCensus: census
        ? {
            algebraicCandidateCount: census.algebraicCandidateCount as number,
            realRootCount: census.realRootCount as number,
            positiveDistanceRootCount:
              census.positiveDistanceRootCount as number,
            deduplicatedRootCount: census.deduplicatedRootCount as number,
          }
        : null,
      enumeratedHypothesisCount: asArray(probe.hypotheses).length,
      plausibilityPartitions: derivePlausibilityPartitions([probe]),
    });
  }
  return observations;
}

function summarizeRun(
  runManifest: unknown,
  capture: unknown,
  tupleClasses: unknown,
  poseProbeOutcomes: unknown,
  frameTruncation: unknown
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
    classObservations: deriveClassObservations(
      tupleClasses,
      poseProbeOutcomes,
      frameTruncation
    ),
    probeObservations: deriveProbeObservations(poseProbeOutcomes),
    refusalLiterals: copyStringLiterals(runManifest.runRefusalLiterals),
  };
}

// The single fixed emission order of the closed five-state vocabulary. Never
// reordered, never sorted by count, favorability, component length, or source
// position.
const ASSOCIATION_ANNOTATION_STATE_VOCABULARY = [
  "associated",
  "tied_ambiguous",
  "unmatched_terminated",
  "unmatched_born",
  "near_coincident_unresolved",
] as const;

function summarizeAssociation(
  runManifest: unknown,
  branchCorridors: unknown
): TypeBObservationAssociationSection {
  if (!isRecord(runManifest)) return { condition: "absent" };
  // B3E emits no branch-corridor section when association was not requested.
  if (!isRecord(branchCorridors)) return { condition: "not_requested" };
  // Neutral one-to-one condition mapping. Raw "associated" becomes the neutral
  // "evaluated"; any other status remains the non-claiming "not_assessed",
  // which is never a failure claim, carries only its verbatim source reasons,
  // and fabricates NO matrix, component count, annotation count, or zero-state
  // partition.
  if (branchCorridors.status !== "associated") {
    return {
      condition: "not_assessed",
      notAssessedLiterals: copyStringLiterals(
        branchCorridors.notAssessedLiterals
      ),
    };
  }

  // B3G-3 literal observation matrix plus B3G-4 per-component records. Each
  // B3E-presented branch corridor is one anonymous diagnostic component in
  // exact source order; aggregate tallies are plain sums of the per-component
  // tallies.
  const stateCounts = {
    associated: 0,
    tied_ambiguous: 0,
    unmatched_terminated: 0,
    unmatched_born: 0,
    near_coincident_unresolved: 0,
  };
  let componentCount = 0;
  let componentsWithAssociatedAnnotations = 0;
  // Literal total of source annotations. An unknown future state is INCLUDED
  // in this denominator (globally and per component) but tallied under no
  // known state, so it surfaces as a loud reconciliation mismatch against the
  // five-state sum instead of being silently coerced or dropped — and it
  // never collapses a valid displayed run into a fabricated no-presentation
  // result.
  let annotationCount = 0;
  const componentObservations: TypeBObservationComponentObservation[] = [];

  for (const branchEntry of asArray(branchCorridors.branches)) {
    componentCount += 1;
    const branch = asRecord(branchEntry);
    const componentStateCounts = {
      associated: 0,
      tied_ambiguous: 0,
      unmatched_terminated: 0,
      unmatched_born: 0,
      near_coincident_unresolved: 0,
    };
    let componentAnnotationCount = 0;
    for (const annotationEntry of asArray(branch.annotations)) {
      componentAnnotationCount += 1;
      const state = asRecord(annotationEntry).state;
      // Exact raw literal comparison only: no renaming, no normalization, no
      // coercion of an unknown state into a known one.
      if (state === "associated") {
        componentStateCounts.associated += 1;
      } else if (state === "tied_ambiguous") {
        componentStateCounts.tied_ambiguous += 1;
      } else if (state === "unmatched_terminated") {
        componentStateCounts.unmatched_terminated += 1;
      } else if (state === "unmatched_born") {
        componentStateCounts.unmatched_born += 1;
      } else if (state === "near_coincident_unresolved") {
        componentStateCounts.near_coincident_unresolved += 1;
      }
    }
    annotationCount += componentAnnotationCount;
    for (const state of ASSOCIATION_ANNOTATION_STATE_VOCABULARY) {
      stateCounts[state] += componentStateCounts[state];
    }
    // Only an exact raw "associated" annotation on THIS component yields the
    // descriptive one_or_more_observed observation; ambiguity / unresolved /
    // unmatched states alone never do.
    if (componentStateCounts.associated > 0) {
      componentsWithAssociatedAnnotations += 1;
    }
    // Anonymous per-component record: a literal reference count, a literal
    // annotation denominator, and the closed five-state matrix in fixed
    // vocabulary order. No identity, index, label, root reference, endpoint,
    // FOV, topology, policy, span, or ordering field of any kind.
    componentObservations.push({
      referenceCount: asArray(branch.rootReferences).length,
      annotationCount: componentAnnotationCount,
      associatedAnnotationObservation:
        componentStateCounts.associated > 0
          ? "one_or_more_observed"
          : "none_observed",
      annotationStateCounts: ASSOCIATION_ANNOTATION_STATE_VOCABULARY.map(
        (state) => ({ state, count: componentStateCounts[state] })
      ),
    });
  }

  return {
    condition: "evaluated",
    componentCount,
    componentsWithAssociatedAnnotations,
    componentsWithoutAssociatedAnnotations:
      componentCount - componentsWithAssociatedAnnotations,
    annotationCount,
    associatedAnnotationObservation:
      stateCounts.associated > 0 ? "one_or_more_observed" : "none_observed",
    annotationStateCounts: ASSOCIATION_ANNOTATION_STATE_VOCABULARY.map(
      (state) => ({ state, count: stateCounts[state] })
    ),
    componentObservations,
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
  return {
    condition: "evaluated",
    recordCount: records.length,
    states: tallyCropCompatibilityStates(records),
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
 * Pure, deterministic, non-mutating derivation of the B3G-4 observation
 * summary from the B3E safe presentation boundary. `null`, `undefined`, or a
 * malformed runtime value NEVER throws and yields the stable no-presentation
 * shape. Equal inputs produce deeply equal (frozen) output. It exposes ONLY
 * closed neutral condition literals, verbatim provenance / refusal /
 * non-assessment facts, literal tallies with explicit denominators, closed
 * four-state partitions, the closed five-state association annotation matrix
 * (evaluated arm only), source-ordered per-class / per-probe / per-component
 * observation records built from the same already-projected facts, and
 * opaque source references — never a percentage, ratio, score, rank,
 * composite, pose, coordinate, residual, FOV value, root identifier,
 * hypothesis identifier, ordering signal, match / validation verdict, or
 * authority claim.
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
        source.poseProbeOutcomes,
        source.frameTruncation
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
