// --- Phase B3G-1: Pure Type B Observation Summary Contract -------------------
// LAB-ONLY, DIAGNOSTIC-ONLY, READ-ONLY, DETERMINISTIC, NON-MUTATING,
// NON-AUTHORITATIVE. A pure, React-free derivation that condenses the B3E safe
// presentation boundary (`TypeBDiagnosticRunPresentation`) into a versioned,
// immutable, deliberately minimal observation-summary contract.
//
// It DERIVES NOTHING evaluative. It never counts, scores, ranks, weighs,
// prefers, chooses, advises, or claims authority. Every fact it emits is either
// a closed neutral condition literal mapped one-to-one from an already-present
// B3E status, or an opaque reference / provenance fact copied verbatim from
// the presentation. It never surfaces a pose, coordinate, rotation, residual,
// FOV value, root identifier, or any solver / evaluation quantity.
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
// it emits preserves exact source order. Its only runtime exports are the
// schema literal and `deriveTypeBObservationSummary`.

import type { TypeBDiagnosticRunPresentation } from "./type-b-diagnostic-run-presentation";

// --- 1. Schema ----------------------------------------------------------------

export const TYPE_B_OBSERVATION_SUMMARY_SCHEMA =
  "vibode-type-b-observation-summary/v0" as const;

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

// Capture section. Deliberately sparse at B3G-1: a refusal carries only its
// neutral condition literal (no manufactured detail); a captured section
// carries only the verbatim provenance facts. Later B3G phases may extend the
// captured arm; the discriminant stays fixed.
export type TypeBObservationCaptureSection =
  | { readonly condition: "absent" }
  | { readonly condition: "refused" }
  | {
      readonly condition: "captured";
      readonly typeAHandoffProvenance: TypeBObservationHandoffProvenance;
    };

// Run section. `assembled` carries only opaque schema references plus the
// verbatim manifest provenance echo. No counts, class summaries, or probe
// summaries exist at B3G-1.
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
    };

// Closed, future-ready association condition union. B3D-2's raw "associated"
// status is NEVER exposed as a summary condition; it maps to the neutral
// "evaluated" literal, which claims only that assessment took place.
export type TypeBObservationAssociationCondition =
  | "not_requested"
  | "not_assessed"
  | "evaluated";

export type TypeBObservationAssociationSection =
  | { readonly condition: "absent" }
  | { readonly condition: TypeBObservationAssociationCondition };

export type TypeBObservationFrameTruncationCondition =
  | "not_assessed"
  | "evaluated";

export type TypeBObservationFrameTruncationSection =
  | { readonly condition: "absent" }
  | { readonly condition: TypeBObservationFrameTruncationCondition };

// Opaque source references for future linkage ONLY. They are never used to
// select, prefer, or order anything. `tupleClassIdentityRefs` preserves EXACT
// presentation source order (no sorting, no ordering field). The capture
// fingerprints are intentionally NOT projected in v0: they structurally embed
// upstream schema field names, and the summary copy surface must stay free of
// any authority-adjacent vocabulary.
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
// compatible" claims. Frozen constant, never mutated.
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
  if (value.status === "refused") return { condition: "refused" };
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

function summarizeRun(value: unknown): TypeBObservationRunSection {
  if (!isRecord(value)) return { condition: "absent" };
  return {
    condition: "assembled",
    assemblySchemaRef: String(value.assemblySchema),
    diagnosticSchemaRef: String(value.diagnosticSchema),
    labTestOverrideActive: value.labTestOverrideActive === true,
    actualTypeAContext: asString(value.actualTypeAContext),
    effectiveTypeAContext: asString(value.effectiveTypeAContext),
    handoffKind: asString(value.handoffKind),
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
  // "evaluated"; any other status remains the non-claiming "not_assessed".
  return {
    condition:
      branchCorridors.status === "associated" ? "evaluated" : "not_assessed",
  };
}

function summarizeFrameTruncation(
  runManifest: unknown,
  frameTruncation: unknown
): TypeBObservationFrameTruncationSection {
  if (!isRecord(runManifest)) return { condition: "absent" };
  if (!isRecord(frameTruncation)) return { condition: "absent" };
  return {
    condition:
      frameTruncation.status === "evaluated" ? "evaluated" : "not_assessed",
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
 * Pure, deterministic, non-mutating derivation of the B3G-1 observation
 * summary from the B3E safe presentation boundary. `null`, `undefined`, or a
 * malformed runtime value NEVER throws and yields the stable no-presentation
 * shape. Equal inputs produce deeply equal (frozen) output. It exposes ONLY
 * closed neutral condition literals, verbatim provenance facts, and opaque
 * source references — never a count, total, pose, coordinate, residual,
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
      run: summarizeRun(source.runManifest),
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
