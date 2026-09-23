import assert from "node:assert/strict";
import test from "node:test";

import { AFC_DIAGNOSTIC_NOTES_MAX_CHARS } from "./contracts";
import {
  AFC_DIAGNOSTIC_ADMIN_CAPTURE_ALLOWED_KEYS,
  AFC_DIAGNOSTIC_ADMIN_CAPTURE_FORBIDDEN_KEYS,
  isAfcDiagnosticAdminCaptureGenerationStatusEligible,
  normalizeAfcDiagnosticAdminCaptureIssueCodes,
  normalizeAfcDiagnosticAdminCaptureNotes,
  parseAfcDiagnosticAdminCaptureRequest,
} from "./admin-capture";

const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";

function parse(body: unknown) {
  return parseAfcDiagnosticAdminCaptureRequest(body);
}

test("generationId plus one issue parses and freezes the DTO", () => {
  const parsed = parse({
    generationId: GEN_1,
    issueCodes: ["perspective_off"],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, {
    generationId: GEN_1,
    issueCodes: ["perspective_off"],
    notes: null,
  });
  assert.equal(Object.isFrozen(parsed.value), true);
  assert.equal(Object.isFrozen(parsed.value.issueCodes), true);
});

test("multiple issues are accepted in first-seen order", () => {
  const parsed = parse({
    generationId: GEN_1,
    issueCodes: [
      "scale_incorrect",
      "other",
      "perspective_off",
      "wall_edges_unrecognized",
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.issueCodes, [
    "scale_incorrect",
    "other",
    "perspective_off",
    "wall_edges_unrecognized",
  ]);
});

test("duplicate issues are deduped while preserving first occurrence", () => {
  const parsed = parse({
    generationId: GEN_1,
    issueCodes: [
      "other",
      "perspective_off",
      "other",
      "scale_incorrect",
      "perspective_off",
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.issueCodes, [
    "other",
    "perspective_off",
    "scale_incorrect",
  ]);
  assert.deepEqual(
    normalizeAfcDiagnosticAdminCaptureIssueCodes([
      "wall_edges_unrecognized",
      "wall_edges_unrecognized",
      "other",
    ]),
    ["wall_edges_unrecognized", "other"],
  );
});

test("omitted notes, null notes, trim, and whitespace-only become null", () => {
  const omitted = parse({
    generationId: GEN_1,
    issueCodes: ["other"],
  });
  assert.equal(omitted.ok, true);
  if (omitted.ok) assert.equal(omitted.value.notes, null);

  const keptNull = parse({
    generationId: GEN_1,
    issueCodes: ["other"],
    notes: null,
  });
  assert.equal(keptNull.ok, true);
  if (keptNull.ok) assert.equal(keptNull.value.notes, null);

  const trimmed = parse({
    generationId: GEN_1,
    issueCodes: ["other"],
    notes: "  capture note  ",
  });
  assert.equal(trimmed.ok, true);
  if (trimmed.ok) assert.equal(trimmed.value.notes, "capture note");

  const whitespace = parse({
    generationId: GEN_1,
    issueCodes: ["other"],
    notes: " \n\t  ",
  });
  assert.equal(whitespace.ok, true);
  if (whitespace.ok) assert.equal(whitespace.value.notes, null);

  const empty = parse({
    generationId: GEN_1,
    issueCodes: ["other"],
    notes: "",
  });
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.value.notes, null);

  assert.equal(normalizeAfcDiagnosticAdminCaptureNotes(null), null);
  assert.equal(normalizeAfcDiagnosticAdminCaptureNotes(""), null);
  assert.equal(normalizeAfcDiagnosticAdminCaptureNotes("  "), null);
  assert.equal(normalizeAfcDiagnosticAdminCaptureNotes(" ok "), "ok");
});

test("exactly 2000 note chars is accepted and 2001 is rejected", () => {
  const exact = "a".repeat(AFC_DIAGNOSTIC_NOTES_MAX_CHARS);
  const parsed = parse({
    generationId: GEN_1,
    issueCodes: ["other"],
    notes: exact,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.notes, exact);

  const padded = parse({
    generationId: GEN_1,
    issueCodes: ["other"],
    notes: `  ${exact}  `,
  });
  assert.equal(padded.ok, true);
  if (padded.ok) assert.equal(padded.value.notes, exact);

  assert.equal(
    parse({
      generationId: GEN_1,
      issueCodes: ["other"],
      notes: "a".repeat(AFC_DIAGNOSTIC_NOTES_MAX_CHARS + 1),
    }).ok,
    false,
  );
  assert.equal(
    parse({
      generationId: GEN_1,
      issueCodes: ["other"],
      notes: " ".repeat(AFC_DIAGNOSTIC_NOTES_MAX_CHARS + 1),
    }).ok,
    true,
  );
});

test("other without notes remains valid", () => {
  const parsed = parse({
    generationId: GEN_1,
    issueCodes: ["other"],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.issueCodes, ["other"]);
  assert.equal(parsed.value.notes, null);
});

test("non-object and array bodies are rejected", () => {
  for (const body of [null, undefined, "capture", 1, true, ["generationId"], []]) {
    assert.equal(parse(body).ok, false);
  }
});

test("missing generationId or invalid UUID is rejected", () => {
  assert.equal(parse({ issueCodes: ["other"] }).ok, false);
  assert.equal(
    parse({ generationId: "not-a-uuid", issueCodes: ["other"] }).ok,
    false,
  );
  assert.equal(
    parse({ generationId: 1, issueCodes: ["other"] }).ok,
    false,
  );
});

test("missing, non-array, empty, and unknown issueCodes are rejected", () => {
  assert.equal(parse({ generationId: GEN_1 }).ok, false);
  assert.equal(
    parse({ generationId: GEN_1, issueCodes: "perspective_off" }).ok,
    false,
  );
  assert.equal(parse({ generationId: GEN_1, issueCodes: [] }).ok, false);
  assert.equal(
    parse({ generationId: GEN_1, issueCodes: ["perspective_off", "nope"] }).ok,
    false,
  );
  assert.equal(
    parse({ generationId: GEN_1, issueCodes: ["Perspective off"] }).ok,
    false,
  );
});

test("notes of the wrong type are rejected", () => {
  for (const notes of [1, true, { text: "x" }, ["note"]]) {
    assert.equal(
      parse({ generationId: GEN_1, issueCodes: ["other"], notes }).ok,
      false,
    );
  }
});

test("unknown keys are rejected", () => {
  assert.equal(
    parse({
      generationId: GEN_1,
      issueCodes: ["other"],
      extra: true,
    }).ok,
    false,
  );
  assert.deepEqual([...AFC_DIAGNOSTIC_ADMIN_CAPTURE_ALLOWED_KEYS], [
    "generationId",
    "issueCodes",
    "notes",
  ]);
});

test("client-supplied provenance and review keys are rejected", () => {
  for (const key of AFC_DIAGNOSTIC_ADMIN_CAPTURE_FORBIDDEN_KEYS) {
    assert.equal(
      parse({
        generationId: GEN_1,
        issueCodes: ["other"],
        [key]: "spoof",
      }).ok,
      false,
      key,
    );
  }
});

test("uppercase generation UUID is canonicalized", () => {
  const parsed = parse({
    generationId: GEN_1.toUpperCase(),
    issueCodes: ["scale_incorrect"],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.generationId, GEN_1);
});

test("eligible generation statuses are ready and failed only", () => {
  assert.equal(isAfcDiagnosticAdminCaptureGenerationStatusEligible("ready"), true);
  assert.equal(isAfcDiagnosticAdminCaptureGenerationStatusEligible("failed"), true);
  assert.equal(isAfcDiagnosticAdminCaptureGenerationStatusEligible("running"), false);
  assert.equal(isAfcDiagnosticAdminCaptureGenerationStatusEligible("queued"), false);
  assert.equal(isAfcDiagnosticAdminCaptureGenerationStatusEligible(null), false);
});
