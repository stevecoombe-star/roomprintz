import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import fixture from "./fixtures/gemini-floor-proposal-prompt.v1.json";
import {
  AFC_R3C_EMPTY_BOUNDARY_PROMPT_VERSION,
  AFC_R3C_GEMINI_FLOOR_PROPOSAL_RESPONSE_SCHEMA,
  AFC_R3C_ORIGINAL_CONTEXT_PROMPT_VERSION,
  buildAfcR3cGeminiFloorProposalPrompt,
} from "./gemini-floor-proposal-prompt";
import { GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION } from "./gemini-floor-proposal-contract";

function allFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== "object") return true;
  if (seen.has(value as object)) return true;
  seen.add(value as object);
  return Object.isFrozen(value) && Object.values(value as Record<string, unknown>).every((child) => allFrozen(child, seen));
}

function build(imageRole: "empty_room_boundary_specialist" | "original_contextual") {
  return buildAfcR3cGeminiFloorProposalPrompt({ imageRole, basisBinding: fixture.basisBinding });
}

test("role-specific prompts are deterministic, versioned, SHA-attested, and immutable", () => {
  const empty = build("empty_room_boundary_specialist");
  const original = build("original_contextual");
  assert.deepEqual(empty, build("empty_room_boundary_specialist"));
  assert.deepEqual(original, build("original_contextual"));
  assert.equal(empty.promptVersion, AFC_R3C_EMPTY_BOUNDARY_PROMPT_VERSION);
  assert.equal(original.promptVersion, AFC_R3C_ORIGINAL_CONTEXT_PROMPT_VERSION);
  assert.equal(empty.promptVersion, fixture.empty.promptVersion);
  assert.equal(original.promptVersion, fixture.original.promptVersion);
  assert.equal(empty.promptSha256, fixture.empty.promptSha256);
  assert.equal(original.promptSha256, fixture.original.promptSha256);
  assert.equal(empty.promptSha256, createHash("sha256").update(empty.promptText, "utf8").digest("hex"));
  assert.equal(original.promptSha256, createHash("sha256").update(original.promptText, "utf8").digest("hex"));
  assert.notEqual(empty.promptSha256, original.promptSha256);
  assert.equal(allFrozen(empty), true);
  assert.equal(allFrozen(original), true);
});

test("both prompts bind exactly to R3B, require strict JSON, distinct ambiguity, and semantic coordinates", () => {
  for (const result of [build("empty_room_boundary_specialist"), build("original_contextual")]) {
    const text = result.promptText;
    assert.equal(result.basisBinding, fixture.basisBinding);
    assert.equal(text.split(fixture.basisBinding).length - 1, 2);
    assert.match(text, /exactly one JSON object/i);
    assert.match(text, /no Markdown or prose outside/i);
    assert.match(text, /1–4 proposals/);
    assert.match(text, /Never pad/i);
    assert.match(text, /materially different plausible interpretations separate/i);
    assert.match(text, /NL, NR, FR, FL/);
    assert.match(text, /near edge is NL–NR/i);
    assert.match(text, /top-left origin, positive X right, and positive Y down/i);
    assert.match(text, /direct_visible, inferred_from_visible_edges, occluded_inferred, outside_frame_inferred/);
    assert.match(text, /direct_visible, partially_visible, inferred_continuation, not_visible/);
    assert.match(text, new RegExp(GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION));
    for (const prohibitedRequest of ["confidence", "rank", "winner", "best candidate"]) {
      assert.equal(text.toLowerCase().includes(prohibitedRequest), false);
    }
    assert.match(text, /Do not return IDs, scoring, ordering, ratio, FOV, pose, physical dimensions/i);
    assert.equal(text.includes("current Floor polygon"), false);
    assert.equal(text.includes("approved"), false);
  }
});

test("each role carries only its specialized visual evidence instructions", () => {
  const empty = build("empty_room_boundary_specialist").promptText;
  assert.match(empty, /geometry-preserving Empty-Room Assist/i);
  assert.match(empty, /Floor-boundary specialist/i);
  assert.match(empty, /floor-wall seams/i);
  assert.match(empty, /same-plane continuation or a separate room/i);
  assert.match(empty, /largest reliable convex contained Floor calibration surface/i);
  const original = build("original_contextual").promptText;
  assert.match(original, /occupied original room photograph/i);
  assert.match(original, /Furniture edges are not floor-wall edges/i);
  assert.match(original, /Rugs are not Floor boundaries/i);
  assert.match(original, /Object tops must not be interpreted as the Floor plane/i);
  assert.match(original, /Infer an obscured boundary only when architectural or perspective evidence supports it/i);
});

test("runtime response schema is closed to the committed R3B model-authored fields", () => {
  const serial = JSON.stringify(AFC_R3C_GEMINI_FLOOR_PROPOSAL_RESPONSE_SCHEMA);
  assert.equal(allFrozen(AFC_R3C_GEMINI_FLOOR_PROPOSAL_RESPONSE_SCHEMA), true);
  for (const field of ["schema_version", "basis_binding", "status", "proposals", "reason_code", "note", "corners", "edge_evidence", "x", "y", "support"]) {
    assert.equal(serial.includes(`"${field}"`), true);
  }
  for (const prohibited of ["confidence", "candidateId", "label", "intent", "rank", "recommendation", "ratio", "fov", "pose", "dimensions", "apply", "rationale", "model provenance"]) {
    assert.equal(serial.toLowerCase().includes(`"${prohibited.toLowerCase()}"`), false);
  }
  assert.equal(serial.includes(GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION), true);
});

test("invalid prompt arguments fail closed without mutating the input", () => {
  const input = { imageRole: "empty_room_boundary_specialist" as const, basisBinding: fixture.basisBinding };
  const before = structuredClone(input);
  assert.throws(() => buildAfcR3cGeminiFloorProposalPrompt({ ...input, imageRole: "other" as never }), /known input image role/);
  assert.throws(() => buildAfcR3cGeminiFloorProposalPrompt({ ...input, basisBinding: "space not allowed" }), /printable ASCII/);
  assert.deepEqual(input, before);
});
