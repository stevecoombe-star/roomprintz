import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import fixture from "./fixtures/gemini-floor-proposal-prompt.v2.json";
import {
  AFC_R3C_EMPTY_BOUNDARY_PROMPT_VERSION,
  AFC_R3C_GEMINI_FLOOR_PROPOSAL_RESPONSE_SCHEMA,
  AFC_R3C_ORIGINAL_CONTEXT_PROMPT_VERSION,
  AFC_R3C_PROMPT_CONTRACT_VERSION,
  buildAfcR3cGeminiFloorProposalPrompt,
} from "./gemini-floor-proposal-prompt";
import {
  GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION,
  type GeminiFloorCornerSupportV1,
  type GeminiFloorEdgeSupportV1,
  type GeminiFloorInsufficientEvidenceReasonV1,
} from "./gemini-floor-proposal-contract";

function allFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== "object") return true;
  if (seen.has(value as object)) return true;
  seen.add(value as object);
  return Object.isFrozen(value) && Object.values(value as Record<string, unknown>).every((child) => allFrozen(child, seen));
}

function build(imageRole: "empty_room_boundary_specialist" | "original_contextual") {
  return buildAfcR3cGeminiFloorProposalPrompt({ imageRole, basisBinding: fixture.basisBinding });
}
function assertNoAffirmativeAuthorityRequest(text: string): void {
  const terms = ["confidence", "rank", "winner", "best candidate", "preferred candidate", "most likely", "top candidate", "choose", "score", "recommended candidate"];
  for (const line of text.split("\n")) {
    const lower = line.toLowerCase();
    for (const term of terms) {
      if (!lower.includes(term)) continue;
      assert.match(lower, /\b(do not|never|no)\b/, `Authority-bearing term "${term}" must only occur in a prohibition.`);
    }
  }
}

test("role-specific prompts are deterministic, versioned, SHA-attested, and immutable", () => {
  const empty = build("empty_room_boundary_specialist");
  const original = build("original_contextual");
  assert.deepEqual(empty, build("empty_room_boundary_specialist"));
  assert.deepEqual(original, build("original_contextual"));
  assert.equal(AFC_R3C_PROMPT_CONTRACT_VERSION, "AFC-R3C-B1/v2");
  assert.equal(AFC_R3C_EMPTY_BOUNDARY_PROMPT_VERSION, "afc-r3c-empty-boundary-prompt/v2");
  assert.equal(AFC_R3C_ORIGINAL_CONTEXT_PROMPT_VERSION, "afc-r3c-original-context-prompt/v2");
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
    assertNoAffirmativeAuthorityRequest(text);
    assert.match(text, /Do not return IDs, scoring, ordering, ratio, FOV, pose, physical dimensions/i);
    assert.equal(text.includes("current Floor polygon"), false);
    assert.equal(text.includes("approved"), false);
  }
});

test("both prompts require closed-interval support-coordinate consistency", () => {
  for (const result of [build("empty_room_boundary_specialist"), build("original_contextual")]) {
    const text = result.promptText;
    assert.match(text, /closed interval \[0,1\] on both axes/i);
    assert.match(text, /0 and 1 are inside the frame/i);
    assert.match(text, /strictly outside only when x < 0, x > 1, y < 0, or y > 1/i);
    assert.match(text, /outside_frame_inferred if and only if at least one corner coordinate is strictly outside \[0,1\]/i);
    assert.equal(
      text.includes('{"x":0.0,"y":1.0,"support":"outside_frame_inferred"} is invalid'),
      true,
      "boundary contradiction example"
    );
    assert.equal(
      text.includes('{"x":-0.05,"y":1.03,"support":"outside_frame_inferred"}'),
      true,
      "valid strictly outside example"
    );
    assert.match(text, /Before responding, perform an output preflight for every corner/i);
    assert.match(text, /Do not output this checklist or any reasoning transcript/i);
  }
});

test("each role carries only its specialized visual evidence instructions", () => {
  const empty = build("empty_room_boundary_specialist").promptText;
  assert.match(empty, /geometry-preserving Empty-Room Assist/i);
  assert.match(empty, /Floor-boundary specialist/i);
  assert.match(empty, /floor-wall seams/i);
  assert.match(empty, /same-plane continuation or a separate room/i);
  assert.match(empty, /largest reliable convex contained Floor calibration surface/i);
  for (const prohibited of ["secondary", "low-trust", "merely advisory"]) assert.equal(empty.toLowerCase().includes(prohibited), false);
  const original = build("original_contextual").promptText;
  assert.match(original, /occupied original room photograph/i);
  assert.match(original, /Furniture edges are not floor-wall edges/i);
  assert.match(original, /Rugs are not Floor boundaries/i);
  assert.match(original, /Object tops must not be interpreted as the Floor plane/i);
  assert.match(original, /Infer an obscured boundary only when architectural or perspective evidence supports it/i);
  assert.equal(original.includes("Empty-Room"), false);
  assert.equal(original.toLowerCase().includes("preferred proposal order"), false);
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

test("corner schema descriptions communicate the closed-frame support rule", () => {
  const corner = AFC_R3C_GEMINI_FLOOR_PROPOSAL_RESPONSE_SCHEMA.$defs.corner.properties;
  assert.equal(
    corner.x.description,
    "Normalized horizontal coordinate. 0 and 1 are inside the frame. Values strictly below 0 or above 1 are outside."
  );
  assert.equal(
    corner.y.description,
    "Normalized vertical coordinate. 0 and 1 are inside the frame. Values strictly below 0 or above 1 are outside."
  );
  assert.equal(
    corner.support.description,
    "outside_frame_inferred must be used if and only if x or y is strictly outside [0,1]. It is invalid when both coordinates lie within the closed interval [0,1], including endpoints."
  );
});

test("schema enum lists exactly match each committed AFC-R3B enum in stable order", () => {
  const schema = AFC_R3C_GEMINI_FLOOR_PROPOSAL_RESPONSE_SCHEMA;
  const defs = schema.$defs;
  const corners = defs.corner.properties.support.enum as readonly GeminiFloorCornerSupportV1[];
  const edges = defs.edge.properties.support.enum as readonly GeminiFloorEdgeSupportV1[];
  const insufficient = schema.oneOf[1].properties.reason_code.enum as readonly GeminiFloorInsufficientEvidenceReasonV1[];
  assert.deepEqual(corners, ["direct_visible", "inferred_from_visible_edges", "occluded_inferred", "outside_frame_inferred"]);
  assert.deepEqual(edges, ["direct_visible", "partially_visible", "inferred_continuation", "not_visible"]);
  assert.deepEqual(insufficient, ["image_unusable", "floor_region_not_visible", "boundary_evidence_insufficient", "semantic_labels_unresolvable"]);
  for (const values of [corners, edges, insufficient]) assert.equal(new Set(values).size, values.length);
});

test("invalid prompt arguments fail closed without mutating the input", () => {
  const input = { imageRole: "empty_room_boundary_specialist" as const, basisBinding: fixture.basisBinding };
  const before = structuredClone(input);
  assert.throws(() => buildAfcR3cGeminiFloorProposalPrompt({ ...input, imageRole: "other" as never }), /known input image role/);
  assert.throws(() => buildAfcR3cGeminiFloorProposalPrompt({ ...input, basisBinding: "space not allowed" }), /printable ASCII/);
  assert.deepEqual(input, before);
});
