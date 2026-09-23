/**
 * AFC-R3C-B1 — role-specific, provider-free Gemini Floor-proposal prompts.
 *
 * This module only constructs an immutable prompt/schema artifact. It neither
 * creates a provider request nor handles a model response.
 */
import { createHash } from "node:crypto";

import {
  GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION,
  type GeminiFloorCornerSupportV1,
  type GeminiFloorEdgeSupportV1,
  type GeminiFloorInsufficientEvidenceReasonV1,
} from "./gemini-floor-proposal-contract";

export const AFC_R3C_PROMPT_CONTRACT_VERSION = "AFC-R3C-B1/v2" as const;
export const AFC_R3C_EMPTY_BOUNDARY_PROMPT_VERSION = "afc-r3c-empty-boundary-prompt/v2" as const;
export const AFC_R3C_ORIGINAL_CONTEXT_PROMPT_VERSION = "afc-r3c-original-context-prompt/v2" as const;

export type AfcR3cInputImageRole =
  | "empty_room_boundary_specialist"
  | "original_contextual";
export type AfcR3cStudyMode = "empty_only" | "original_only" | "parallel_union";
export type AfcR3cPromptVersion =
  | typeof AFC_R3C_EMPTY_BOUNDARY_PROMPT_VERSION
  | typeof AFC_R3C_ORIGINAL_CONTEXT_PROMPT_VERSION;

export type AfcR3cPromptBuildInput = Readonly<{
  imageRole: AfcR3cInputImageRole;
  basisBinding: string;
}>;

export type AfcR3cPromptBuildResult = Readonly<{
  contractVersion: typeof AFC_R3C_PROMPT_CONTRACT_VERSION;
  promptVersion: AfcR3cPromptVersion;
  promptText: string;
  promptSha256: string;
  imageRole: AfcR3cInputImageRole;
  expectedR3bSchemaVersion: typeof GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION;
  basisBinding: string;
}>;

// `satisfies` makes a future AFC-R3B union expansion a compile-time failure
// until this prompt/schema enumeration is deliberately updated.
const CORNER_SUPPORT_MAP = {
  direct_visible: true,
  inferred_from_visible_edges: true,
  occluded_inferred: true,
  outside_frame_inferred: true,
} as const satisfies Record<GeminiFloorCornerSupportV1, true>;
const EDGE_SUPPORT_MAP = {
  direct_visible: true,
  partially_visible: true,
  inferred_continuation: true,
  not_visible: true,
} as const satisfies Record<GeminiFloorEdgeSupportV1, true>;
const INSUFFICIENT_REASON_MAP = {
  image_unusable: true,
  floor_region_not_visible: true,
  boundary_evidence_insufficient: true,
  semantic_labels_unresolvable: true,
} as const satisfies Record<GeminiFloorInsufficientEvidenceReasonV1, true>;
const CORNER_SUPPORTS = Object.freeze(Object.keys(CORNER_SUPPORT_MAP) as GeminiFloorCornerSupportV1[]);
const EDGE_SUPPORTS = Object.freeze(Object.keys(EDGE_SUPPORT_MAP) as GeminiFloorEdgeSupportV1[]);
const INSUFFICIENT_REASONS = Object.freeze(Object.keys(INSUFFICIENT_REASON_MAP) as GeminiFloorInsufficientEvidenceReasonV1[]);

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (visited.has(object)) return value;
    visited.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, visited);
    if (!Object.isFrozen(object)) Object.freeze(object);
  }
  return value;
}

function validRole(value: unknown): value is AfcR3cInputImageRole {
  return value === "empty_room_boundary_specialist" || value === "original_contextual";
}

/** Mirrors the printable-ASCII, maximum-128 binding wire constraint in AFC-R3B. */
export function isValidAfcR3cBasisBinding(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,128}$/.test(value);
}

const RESPONSE_FORMAT = `Return exactly one JSON object and no Markdown or prose outside it.
Use schema_version "${GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION}" and echo this exact opaque basis_binding: "{{BASIS_BINDING}}".
Return status "proposals" with 1–4 proposals, or status "insufficient_evidence".
Return only materially distinct plausible Floor interpretations. Never pad the proposal count. Keep materially different plausible interpretations separate. Do not make a selection between proposals.
Use no field outside this exact schema:
{"schema_version":"${GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION}","basis_binding":"{{BASIS_BINDING}}","status":"proposals","proposals":[{"corners":{"NL":{"x":0,"y":0,"support":"direct_visible"},"NR":{"x":0,"y":0,"support":"direct_visible"},"FR":{"x":0,"y":0,"support":"direct_visible"},"FL":{"x":0,"y":0,"support":"direct_visible"}},"edge_evidence":{"near":{"support":"direct_visible","note":"text"},"right":{"support":"direct_visible","note":"text"},"far":{"support":"direct_visible","note":"text"},"left":{"support":"direct_visible","note":"text"}}}]}
For insufficient evidence, use only schema_version, basis_binding, status, reason_code, and note. reason_code is one of ${INSUFFICIENT_REASONS.join(", ")}.
Corners are keyed semantic corners: NL, NR, FR, FL. The near edge is NL–NR and closer to the viewer; right is NR–FR; far is FR–FL and farther from the viewer; left is FL–NL.
Coordinates are normalized to the exact supplied image, with top-left origin, positive X right, and positive Y down.
The normalized image frame is the closed interval [0,1] on both axes: 0 and 1 are inside the frame. A coordinate is strictly outside only when x < 0, x > 1, y < 0, or y > 1.
Corner support values are exactly: ${CORNER_SUPPORTS.join(", ")}. Edge support values are exactly: ${EDGE_SUPPORTS.join(", ")}. Use outside_frame_inferred if and only if at least one corner coordinate is strictly outside [0,1]. Do not use outside_frame_inferred for an in-frame corner, including a boundary corner; use the appropriate in-frame corner label such as direct_visible, inferred_from_visible_edges, or occluded_inferred instead.
Invalid boundary example: {"x":0.0,"y":1.0,"support":"outside_frame_inferred"} is invalid because both coordinates are inside or on the frame boundary. Valid outside example: {"x":-0.05,"y":1.03,"support":"outside_frame_inferred"}.
Before responding, perform an output preflight for every corner: compare support against x/y coordinates, reject your own draft and correct it if support and frame inclusion disagree. Do not output this checklist or any reasoning transcript.
The Floor proposal is a convex calibration surface on the main-room Floor plane, not an irregular traced room outline. Do not trace doorway notches or other concave outlines into a quadrilateral. Return insufficient_evidence rather than inventing unsupported boundaries.
Do not return IDs, scoring, ordering, ratio, FOV, pose, physical dimensions, recommendations, selection instructions, or explanatory proposal rationale.`;

const EMPTY_ROLE_INSTRUCTIONS = `The supplied image is a geometry-preserving Empty-Room Assist. It is the Floor-boundary specialist and its purpose is to expose Floor boundaries.
Prioritize floor-wall seams, baseboards and wall intersections, far corners, openings, uninterrupted Floor surfaces, main-room topology, and plausible continuation behind removed contents.
For each materially distinct interpretation, propose the largest reliable convex contained Floor calibration surface. Do not trace irregular doorway notches. Do not casually extend into an adjacent room. When an opening could be same-plane continuation or a separate room, preserve that ambiguity with separate proposals. Do not invent edges merely because the image is clean.`;

const ORIGINAL_ROLE_INSTRUCTIONS = `The supplied image is the occupied original room photograph. It provides contextual room-geometry evidence and is the canonical AFC comparison and calibrated-camera image basis.
Use visible architectural lines, wall and baseboard alignments, object scale, verticals, perspective, depth, occlusion relationships, and plausible hidden Floor continuation.
Furniture edges are not floor-wall edges. Rugs are not Floor boundaries. Tables and sofas may hide the Floor. Object tops must not be interpreted as the Floor plane. Do not shrink the Floor quadrilateral merely to avoid occluded areas. Infer an obscured boundary only when architectural or perspective evidence supports it. Keep materially distinct supported interpretations separate.`;

function promptFor(role: AfcR3cInputImageRole): string {
  return `${role === "empty_room_boundary_specialist" ? EMPTY_ROLE_INSTRUCTIONS : ORIGINAL_ROLE_INSTRUCTIONS}

${RESPONSE_FORMAT}`;
}

export const AFC_R3C_GEMINI_FLOOR_PROPOSAL_RESPONSE_SCHEMA = deepFreeze({
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["schema_version", "basis_binding", "status", "proposals"],
      properties: {
        schema_version: { type: "string", const: GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION },
        basis_binding: { type: "string" },
        status: { type: "string", const: "proposals" },
        proposals: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["corners", "edge_evidence"],
            properties: {
              corners: {
                type: "object",
                additionalProperties: false,
                required: ["NL", "NR", "FR", "FL"],
                properties: {
                  NL: { $ref: "#/$defs/corner" },
                  NR: { $ref: "#/$defs/corner" },
                  FR: { $ref: "#/$defs/corner" },
                  FL: { $ref: "#/$defs/corner" },
                },
              },
              edge_evidence: {
                type: "object",
                additionalProperties: false,
                required: ["near", "right", "far", "left"],
                properties: {
                  near: { $ref: "#/$defs/edge" },
                  right: { $ref: "#/$defs/edge" },
                  far: { $ref: "#/$defs/edge" },
                  left: { $ref: "#/$defs/edge" },
                },
              },
            },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["schema_version", "basis_binding", "status", "reason_code", "note"],
      properties: {
        schema_version: { type: "string", const: GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION },
        basis_binding: { type: "string" },
        status: { type: "string", const: "insufficient_evidence" },
        reason_code: { type: "string", enum: INSUFFICIENT_REASONS },
        note: { type: "string" },
      },
    },
  ],
  $defs: {
    corner: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y", "support"],
      properties: {
        x: {
          type: "number",
          description: "Normalized horizontal coordinate. 0 and 1 are inside the frame. Values strictly below 0 or above 1 are outside.",
        },
        y: {
          type: "number",
          description: "Normalized vertical coordinate. 0 and 1 are inside the frame. Values strictly below 0 or above 1 are outside.",
        },
        support: {
          type: "string",
          enum: CORNER_SUPPORTS,
          description: "outside_frame_inferred must be used if and only if x or y is strictly outside [0,1]. It is invalid when both coordinates lie within the closed interval [0,1], including endpoints.",
        },
      },
    },
    edge: {
      type: "object",
      additionalProperties: false,
      required: ["support", "note"],
      properties: {
        support: { type: "string", enum: EDGE_SUPPORTS },
        note: { type: "string" },
      },
    },
  },
} as const);

export function buildAfcR3cGeminiFloorProposalPrompt(input: AfcR3cPromptBuildInput): AfcR3cPromptBuildResult {
  if (!input || !validRole(input.imageRole)) throw new TypeError("AFC-R3C requires a known input image role.");
  if (!isValidAfcR3cBasisBinding(input.basisBinding)) throw new TypeError("AFC-R3C basis_binding must be printable ASCII with length 1–128.");
  const promptText = promptFor(input.imageRole).replaceAll("{{BASIS_BINDING}}", input.basisBinding);
  return deepFreeze({
    contractVersion: AFC_R3C_PROMPT_CONTRACT_VERSION,
    promptVersion: input.imageRole === "empty_room_boundary_specialist"
      ? AFC_R3C_EMPTY_BOUNDARY_PROMPT_VERSION
      : AFC_R3C_ORIGINAL_CONTEXT_PROMPT_VERSION,
    promptText,
    promptSha256: createHash("sha256").update(promptText, "utf8").digest("hex"),
    imageRole: input.imageRole,
    expectedR3bSchemaVersion: GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION,
    basisBinding: input.basisBinding,
  });
}
