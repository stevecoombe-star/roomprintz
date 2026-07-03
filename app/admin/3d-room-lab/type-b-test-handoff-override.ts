// --- Phase B3F-O: Lab-Only Type B Test-Handoff Override ---------------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. A pure, React-free resolver for an
// explicit, session-only laboratory override that lets Type B capture and
// diagnostic testing proceed WITHOUT a genuine Type A exhausted-handoff state.
//
// It preserves a strict distinction:
//   - the ACTUAL Type A support / context is unchanged, read-only, truthful;
//   - the EFFECTIVE Type B handoff context becomes
//     `type_a_exhausted_handoff_candidate` ONLY while an explicit, valid lab
//     override is active.
//
// This is NOT a Type A policy change, NOT a Type A classification change, and
// NOT a calibration feature. It NEVER:
//   - mutates or promotes the actual Type A context;
//   - applies automatically, persists, or defaults to enabled;
//   - ranks, scores, recommends, selects, previews, loads, applies, or
//     calibrates anything.
//
// It is pure, deterministic, non-mutating, and NEVER throws for malformed
// runtime input (a malformed override behaves exactly as no override). Its ONLY
// import is the `import type` alias of the committed Type A -> Type B context
// union. It has NO React, browser, Three.js, Type A implementation, solver,
// calibration, persistence, API, routing, or external-math dependency. Its ONLY
// runtime exports are the override schema constant and the resolver.

import type { TypeATypeBContext } from "./type-b-evidence-types";

// --- 1. Required schema constant --------------------------------------------

// Versioned identity for the lab-only Type B test-handoff override. The `/v0`
// suffix makes any future shape change an explicit new identifier rather than a
// silent redefinition. A supplied override is honored ONLY when it carries this
// exact schema.
export const TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA =
  "vibode-type-b-test-handoff-override/v0" as const;

// --- 2. Contract types ------------------------------------------------------

// The explicit, session-only lab override. It is intentionally minimal: an
// exact schema plus `enabled: true`. A `null` override (or any value not
// matching this exact shape) is treated as no override.
export type TypeBTestHandoffOverride = {
  readonly schema: typeof TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA;
  readonly enabled: true;
};

// Provenance of the EFFECTIVE Type B handoff context. It makes it structurally
// impossible to confuse a genuine Type A exhausted handoff with a lab-only test
// override:
//   - `actual_type_a_exhausted_handoff`: the actual Type A context is genuinely
//     exhausted; no lab override is involved (`labTestOverrideActive: false`);
//   - `lab_test_handoff_override`: the actual Type A context is anything except
//     exhausted, and a valid explicit override made the effective context
//     exhausted (`labTestOverrideActive: true`, with the override schema).
export type TypeBTypeAHandoffProvenance =
  | {
      readonly kind: "actual_type_a_exhausted_handoff";
      readonly actualTypeAContext: "type_a_exhausted_handoff_candidate";
      readonly effectiveTypeAContext: "type_a_exhausted_handoff_candidate";
      readonly labTestOverrideActive: false;
    }
  | {
      readonly kind: "lab_test_handoff_override";
      readonly actualTypeAContext: Exclude<
        TypeATypeBContext,
        "type_a_exhausted_handoff_candidate"
      >;
      readonly effectiveTypeAContext: "type_a_exhausted_handoff_candidate";
      readonly labTestOverrideActive: true;
      readonly overrideSchema: typeof TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA;
    };

// Effective-context resolution. It always carries the actual and effective
// contexts, plus provenance (non-null ONLY when the effective context is a
// genuine exhausted handoff OR a valid lab override).
export type TypeBEffectiveHandoffContextResolution = {
  readonly actualTypeAContext: TypeATypeBContext;
  readonly effectiveTypeAContext: TypeATypeBContext;
  readonly provenance: TypeBTypeAHandoffProvenance | null;
};

// --- 3. Pure primitive guard ------------------------------------------------

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// True ONLY for an override object carrying the exact schema and `enabled: true`.
// Any other value (null, wrong schema, `enabled` not exactly `true`, non-object)
// is not a valid override.
function isValidTestHandoffOverride(
  override: TypeBTestHandoffOverride | null
): override is TypeBTestHandoffOverride {
  return (
    isObjectRecord(override) &&
    override.schema === TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA &&
    override.enabled === true
  );
}

// --- 4. Pure effective-context resolver -------------------------------------

/**
 * Pure, deterministic, non-mutating resolution of the EFFECTIVE Type B handoff
 * context from the ACTUAL read-only Type A context and an optional lab-only
 * test override.
 *
 * Rules (in strict precedence order):
 *   1. Real exhausted handoff always wins. If the actual context is
 *      `type_a_exhausted_handoff_candidate`, the effective context is the same
 *      and provenance is `actual_type_a_exhausted_handoff`. A supplied override
 *      never relabels this as a lab override.
 *   2. Valid explicit override. If the actual context is anything except
 *      exhausted handoff AND the override has the exact schema and
 *      `enabled: true`, the effective context becomes
 *      `type_a_exhausted_handoff_candidate` and provenance is
 *      `lab_test_handoff_override`.
 *   3. No valid override. The effective context equals the actual context and
 *      provenance is `null`.
 *   4. A malformed runtime override never throws, never promotes the actual
 *      context, and behaves exactly as no override.
 *
 * It NEVER mutates its inputs and NEVER throws for malformed runtime input.
 */
export function resolveTypeBEffectiveHandoffContext(
  actualTypeAContext: TypeATypeBContext,
  testOverride: TypeBTestHandoffOverride | null
): TypeBEffectiveHandoffContextResolution {
  try {
    // Rule 1: a genuine exhausted handoff always wins, override or not.
    if (actualTypeAContext === "type_a_exhausted_handoff_candidate") {
      return {
        actualTypeAContext,
        effectiveTypeAContext: "type_a_exhausted_handoff_candidate",
        provenance: {
          kind: "actual_type_a_exhausted_handoff",
          actualTypeAContext: "type_a_exhausted_handoff_candidate",
          effectiveTypeAContext: "type_a_exhausted_handoff_candidate",
          labTestOverrideActive: false,
        },
      };
    }

    // Rule 2: a valid explicit override promotes ONLY the effective context.
    // The early return above narrows `actualTypeAContext` to exclude the
    // exhausted literal, so it faithfully populates the lab-override provenance.
    if (isValidTestHandoffOverride(testOverride)) {
      return {
        actualTypeAContext,
        effectiveTypeAContext: "type_a_exhausted_handoff_candidate",
        provenance: {
          kind: "lab_test_handoff_override",
          actualTypeAContext,
          effectiveTypeAContext: "type_a_exhausted_handoff_candidate",
          labTestOverrideActive: true,
          overrideSchema: TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA,
        },
      };
    }

    // Rules 3 & 4: no valid override (or a malformed one) leaves the effective
    // context exactly equal to the actual context, with null provenance.
    return {
      actualTypeAContext,
      effectiveTypeAContext: actualTypeAContext,
      provenance: null,
    };
  } catch {
    // Ultimate safety net: never throw, never promote the actual context.
    return {
      actualTypeAContext,
      effectiveTypeAContext: actualTypeAContext,
      provenance: null,
    };
  }
}
