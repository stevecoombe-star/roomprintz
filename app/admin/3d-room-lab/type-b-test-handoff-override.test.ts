// --- Phase B3F-O: Lab-Only Type B Test-Handoff Override tests ---------------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST effective-
// context resolver. Fixtures are LOCAL, minimal, and hand-authored. The module
// resolves an EFFECTIVE Type B handoff context from an ACTUAL read-only Type A
// context plus an optional session-only test override. It runs NO solver, NO
// UI, NO calibration, NO ranking, and mutates NOTHING. It also asserts (by
// source inspection) that the ThreeRoomLab UI integration keeps actual Type A
// truthful and routes only the EFFECTIVE context into Type B qualification /
// capture, with no persistence / API / calibration authority.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { TypeATypeBContext } from "./type-b-evidence-types";

import * as overrideModule from "./type-b-test-handoff-override";
import {
  TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA,
  resolveTypeBEffectiveHandoffContext,
  type TypeBTestHandoffOverride,
} from "./type-b-test-handoff-override";

// --- Local fixtures ---------------------------------------------------------

const NON_EXHAUSTED_CONTEXTS: readonly Exclude<
  TypeATypeBContext,
  "type_a_exhausted_handoff_candidate"
>[] = [
  "type_a_not_run_or_unknown",
  "type_a_strong_support",
  "type_a_weak_support",
  "type_a_investigation_case",
];

function validOverride(): TypeBTestHandoffOverride {
  return { schema: TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA, enabled: true };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(HERE, "type-b-test-handoff-override.ts");
const MODULE_SOURCE = readFileSync(MODULE_PATH, "utf8");
const UI_PATH = path.join(HERE, "ThreeRoomLab.tsx");
const UI_SOURCE = readFileSync(UI_PATH, "utf8");

// --- 1. Runtime export surface ----------------------------------------------

test("runtime module exports only the schema constant and the resolver", () => {
  const keys = Object.keys(overrideModule).sort();
  assert.deepEqual(keys, [
    "TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA",
    "resolveTypeBEffectiveHandoffContext",
  ]);
  assert.equal(
    TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA,
    "vibode-type-b-test-handoff-override/v0"
  );
  assert.equal(typeof resolveTypeBEffectiveHandoffContext, "function");
});

// --- 2. Genuine exhausted handoff always wins -------------------------------

test("a genuine exhausted handoff produces actual provenance, even when an override is supplied", () => {
  for (const override of [null, validOverride()]) {
    const result = resolveTypeBEffectiveHandoffContext(
      "type_a_exhausted_handoff_candidate",
      override
    );
    assert.equal(result.actualTypeAContext, "type_a_exhausted_handoff_candidate");
    assert.equal(
      result.effectiveTypeAContext,
      "type_a_exhausted_handoff_candidate"
    );
    assert.deepEqual(result.provenance, {
      kind: "actual_type_a_exhausted_handoff",
      actualTypeAContext: "type_a_exhausted_handoff_candidate",
      effectiveTypeAContext: "type_a_exhausted_handoff_candidate",
      labTestOverrideActive: false,
    });
  }
});

// --- 3. Valid override on any non-exhausted actual context ------------------

test("a valid override on any non-exhausted actual context yields lab-override provenance and effective exhausted context", () => {
  for (const ctx of NON_EXHAUSTED_CONTEXTS) {
    const result = resolveTypeBEffectiveHandoffContext(ctx, validOverride());
    assert.equal(result.actualTypeAContext, ctx);
    assert.equal(
      result.effectiveTypeAContext,
      "type_a_exhausted_handoff_candidate"
    );
    assert.deepEqual(result.provenance, {
      kind: "lab_test_handoff_override",
      actualTypeAContext: ctx,
      effectiveTypeAContext: "type_a_exhausted_handoff_candidate",
      labTestOverrideActive: true,
      overrideSchema: TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA,
    });
  }
});

// --- 4. No override preserves the actual context ----------------------------

test("no override preserves the actual context with null provenance unless it is genuinely exhausted", () => {
  for (const ctx of NON_EXHAUSTED_CONTEXTS) {
    const result = resolveTypeBEffectiveHandoffContext(ctx, null);
    assert.equal(result.actualTypeAContext, ctx);
    assert.equal(result.effectiveTypeAContext, ctx);
    assert.equal(result.provenance, null);
  }
});

// --- 5. Malformed override never promotes and never throws ------------------

test("a malformed runtime override never promotes context and never throws", () => {
  const malformed: unknown[] = [
    { schema: "wrong-schema", enabled: true },
    { schema: TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA, enabled: false },
    { schema: TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA, enabled: 1 },
    { schema: TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA },
    { enabled: true },
    {},
    "on",
    5,
    true,
    [],
    () => {},
  ];
  for (const bad of malformed) {
    const result = resolveTypeBEffectiveHandoffContext(
      "type_a_strong_support",
      bad as never
    );
    assert.equal(result.effectiveTypeAContext, "type_a_strong_support");
    assert.equal(result.provenance, null);
  }
  // A completely wild actual-context argument still never throws.
  assert.doesNotThrow(() =>
    resolveTypeBEffectiveHandoffContext(undefined as never, null)
  );
});

// --- 6. Determinism + non-mutation ------------------------------------------

test("repeat invocation is deeply equal and leaves inputs unchanged", () => {
  const override = validOverride();
  const overrideBefore = structuredClone(override);
  const a = resolveTypeBEffectiveHandoffContext("type_a_weak_support", override);
  const b = resolveTypeBEffectiveHandoffContext("type_a_weak_support", override);
  assert.deepEqual(a, b);
  assert.deepEqual(override, overrideBefore);
});

// --- 7. Import boundary / no forbidden dependency ---------------------------

test("module imports only the pure Type A -> Type B context type and no forbidden dependency", () => {
  const importLines = MODULE_SOURCE.split("\n").filter((line) =>
    /^\s*import\b/.test(line)
  );
  const specifierRegex = /from\s+"([^"]+)"/;
  const specifiers = new Set<string>();
  for (const line of importLines) {
    const match = specifierRegex.exec(line);
    if (match) specifiers.add(match[1]);
  }
  // The only import specifier is the committed evidence-types module.
  assert.deepEqual([...specifiers], ["./type-b-evidence-types"]);
  // It is a type-only import (no runtime dependency at all).
  for (const line of importLines) {
    assert.ok(/^\s*import\s+type\b/.test(line), `import must be type-only: ${line}`);
  }
  // Forbidden dependency fragments never appear.
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
    "konva",
    "zustand",
  ]) {
    assert.ok(
      !MODULE_SOURCE.toLowerCase().includes(`"${forbidden}`),
      `forbidden import fragment present: ${forbidden}`
    );
  }
});

// --- 8. No authority / ranking / selection / calibration vocabulary ---------

test("contracts and outputs contain no authority/ranking/selection/calibration field", () => {
  // The resolved objects expose ONLY the declared fields; no authority /
  // ranking / selection / calibration field name is ever emitted. (Doc-comment
  // prose in the module intentionally states what the module does NOT do, so
  // the field-name scan below is over emitted keys, never comment text.)
  const forbiddenFieldNames = [
    "score",
    "rank",
    "confidence",
    "winner",
    "recommendation",
    "recommended",
    "selected",
    "selection",
    "preview",
    "apply",
    "calibration",
    "pose",
    "root",
    "branch",
  ];
  const collectKeys = (value: unknown, keys: Set<string>): Set<string> => {
    if (Array.isArray(value)) {
      value.forEach((entry) => collectKeys(entry, keys));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        keys.add(k.toLowerCase());
        collectKeys(v, keys);
      }
    }
    return keys;
  };
  const withProvenance = resolveTypeBEffectiveHandoffContext(
    "type_a_weak_support",
    validOverride()
  );
  const noProvenance = resolveTypeBEffectiveHandoffContext(
    "type_a_strong_support",
    null
  );
  const emittedKeys = collectKeys(
    { withProvenance, noProvenance },
    new Set<string>()
  );
  for (const token of forbiddenFieldNames) {
    for (const key of emittedKeys) {
      assert.ok(
        !key.includes(token),
        `emitted field "${key}" must not contain "${token}"`
      );
    }
  }
  assert.deepEqual(Object.keys(withProvenance).sort(), [
    "actualTypeAContext",
    "effectiveTypeAContext",
    "provenance",
  ]);
  assert.ok(withProvenance.provenance);
  assert.deepEqual(Object.keys(withProvenance.provenance).sort(), [
    "actualTypeAContext",
    "effectiveTypeAContext",
    "kind",
    "labTestOverrideActive",
    "overrideSchema",
  ]);
});

// --- 9. UI containment (source inspection) ----------------------------------

test("ThreeRoomLab wires the pure resolver, defaults the override off, and never persists it", () => {
  // The UI imports and calls the pure resolver + schema constant.
  assert.ok(
    /resolveTypeBEffectiveHandoffContext/.test(UI_SOURCE),
    "UI must call the pure effective-context resolver"
  );
  assert.ok(
    /TYPE_B_TEST_HANDOFF_OVERRIDE_SCHEMA/.test(UI_SOURCE),
    "UI must reference the override schema constant"
  );
  // Session-only override state defaults to false.
  assert.ok(
    /const\s*\[\s*isTypeBTestHandoffOverrideEnabled\s*,\s*setIsTypeBTestHandoffOverrideEnabled\s*\]\s*=\s*useState\(\s*false\s*\)/.test(
      UI_SOURCE
    ),
    "override state must be a local useState defaulting to false"
  );
  // The override is never persisted / serialized / routed.
  assert.ok(
    !/isTypeBTestHandoffOverrideEnabled[^\n]*localStorage/.test(UI_SOURCE),
    "override must not be persisted to localStorage"
  );
});

test("ThreeRoomLab routes only the EFFECTIVE context into Type B qualification/capture and keeps the ACTUAL context truthful", () => {
  // Type B qualification consumes the EFFECTIVE context.
  assert.ok(
    /typeAContext:\s*effectiveTypeBTypeAContext/.test(UI_SOURCE),
    "Type B qualification must consume the effective context"
  );
  // Capture passes the ACTUAL context plus the override, never the effective.
  assert.ok(
    /actualTypeAContext:\s*actualTypeBTypeAContext/.test(UI_SOURCE),
    "capture input must pass the actual Type A context"
  );
  assert.ok(
    /testHandoffOverride:\s*typeBTestHandoffOverride/.test(UI_SOURCE),
    "capture input must pass the test override"
  );
  // The actual read-only context remains available for Type A display/logic.
  assert.ok(
    /actualTypeBTypeAContext/.test(UI_SOURCE),
    "the actual Type A -> Type B context must remain named for display"
  );
  // A dedicated lifecycle helper disables the override and clears results.
  assert.ok(
    /clearTypeBTestHandoffOverrideCaptureAndDiagnostic/.test(UI_SOURCE),
    "UI must expose the dedicated override-clearing lifecycle helper"
  );
});

// --- 10. B3F-O1 actual Type A provenance-freshness invalidation -------------

// Isolate the provenance-freshness lifecycle effect body: from the B3F-O1
// marker comment through the effect's dependency array. This lets the
// assertions below reason about the exact effect, not the whole file.
const PROVENANCE_FRESHNESS_EFFECT = (() => {
  const match =
    /Phase B3F-O1[\s\S]*?\}, \[\s*actualTypeBTypeAContext,\s*typeBCaptureResult,\s*typeBDiagnosticEnvelope,?\s*\]\);/.exec(
      UI_SOURCE
    );
  return match ? match[0] : "";
})();

test("ThreeRoomLab invalidates a stored capture/run when its recorded actual Type A context diverges from the live actual context", () => {
  assert.ok(
    PROVENANCE_FRESHNESS_EFFECT.length > 0,
    "a B3F-O1 provenance-freshness effect keyed to the live actual context and stored capture state must exist"
  );
  // 1. It compares the STORED recorded actual Type A context against the LIVE
  //    actual Type A context.
  assert.ok(
    /typeAHandoffProvenance\.actualTypeAContext\s*!==\s*[\s\S]*?actualTypeBTypeAContext/.test(
      PROVENANCE_FRESHNESS_EFFECT
    ),
    "the effect must compare stored typeAHandoffProvenance.actualTypeAContext against the live actualTypeBTypeAContext"
  );
  // 2. On mismatch it clears BOTH the capture result and the diagnostic
  //    envelope.
  assert.ok(
    /setTypeBCaptureResult\(null\)/.test(PROVENANCE_FRESHNESS_EFFECT),
    "the effect must clear the stored capture result on mismatch"
  );
  assert.ok(
    /setTypeBDiagnosticEnvelope\(null\)/.test(PROVENANCE_FRESHNESS_EFFECT),
    "the effect must clear the stored diagnostic envelope on mismatch"
  );
  // 3. It is keyed to the live actual context AND the stored capture state (the
  //    dependency array names all three watched values).
  assert.ok(
    /\}, \[\s*actualTypeBTypeAContext,\s*typeBCaptureResult,\s*typeBDiagnosticEnvelope,?\s*\]\);/.test(
      PROVENANCE_FRESHNESS_EFFECT
    ),
    "the effect must be keyed to actualTypeBTypeAContext, typeBCaptureResult, and typeBDiagnosticEnvelope"
  );
  // 4. The provenance-mismatch path must NOT toggle the session-only override
  //    off: the override's active state is independent of a past capture's
  //    validity.
  assert.ok(
    !/setIsTypeBTestHandoffOverrideEnabled/.test(PROVENANCE_FRESHNESS_EFFECT),
    "the provenance-mismatch path must not disable the session-only override"
  );
});

test("ThreeRoomLab retains existing explicit enable/disable and geometry/evidence invalidation behavior", () => {
  // Explicit enable/disable handlers remain present.
  assert.ok(
    /enableTypeBTestHandoffOverride/.test(UI_SOURCE),
    "explicit override enable handler must remain present"
  );
  assert.ok(
    /disableTypeBTestHandoffOverride/.test(UI_SOURCE),
    "explicit override disable handler must remain present"
  );
  // Geometry/evidence invalidation still routes through the dedicated helper
  // that disables the override and clears capture/envelope.
  assert.ok(
    /setIsTypeBTestHandoffOverrideEnabled\(false\)/.test(UI_SOURCE),
    "geometry/evidence invalidation must still disable the override"
  );
  assert.ok(
    /clearTypeBTestHandoffOverrideCaptureAndDiagnostic/.test(UI_SOURCE),
    "the geometry/evidence override-clearing lifecycle helper must remain present"
  );
});
