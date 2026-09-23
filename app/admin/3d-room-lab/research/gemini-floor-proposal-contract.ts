/**
 * AFC-R3B — pure Gemini Floor-hypothesis proposal contract.
 *
 * This adapter is deliberately a sealed intake boundary. It parses an
 * untrusted response into semantic Floor hypotheses only; AFC-R2 and AFC-R1H2
 * retain all geometry-comparison and selection authority. Native JSON.parse
 * cannot distinguish duplicate object keys, so duplicate keys remain a
 * documented residual wire-format limitation.
 */
import { createHash } from "node:crypto";

import { validateOrderedFloorCorners } from "../perspective-solve";
import {
  candidateCanonicalPolygon,
  compareCanonicalStrings,
  stableSerialize,
  type FloorCandidateInput,
  type SharedCandidateComparisonContext,
} from "./candidate-discrimination-harness";
import {
  validateSharedCandidateComparisonContext,
  type ValidSharedCandidateComparisonContext,
} from "./gemini-floor-proposal-manifest";

export const GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION = "AFC-R3B/v1" as const;
export const GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION = "afc-r3-floor-hypotheses/v1" as const;
export const GEMINI_FLOOR_COORDINATE_EXTENT_VERSION = "afc-r3-coordinate-extent/v1" as const;
export const GEMINI_FLOOR_MAX_RAW_RESPONSE_BYTES = 65_536;

export type GeminiFloorCoordinateExtentPolicyV1 = Readonly<{
  version: typeof GEMINI_FLOOR_COORDINATE_EXTENT_VERSION;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}>;

export const GEMINI_FLOOR_COORDINATE_EXTENT_POLICY: GeminiFloorCoordinateExtentPolicyV1 = Object.freeze({
  version: GEMINI_FLOOR_COORDINATE_EXTENT_VERSION,
  minX: -0.25,
  maxX: 1.25,
  minY: -0.25,
  maxY: 1.25,
});

export type GeminiFloorCornerSupportV1 =
  | "direct_visible"
  | "inferred_from_visible_edges"
  | "occluded_inferred"
  | "outside_frame_inferred";
export type GeminiFloorEdgeSupportV1 =
  | "direct_visible"
  | "partially_visible"
  | "inferred_continuation"
  | "not_visible";
export type GeminiFloorInsufficientEvidenceReasonV1 =
  | "image_unusable"
  | "floor_region_not_visible"
  | "boundary_evidence_insufficient"
  | "semantic_labels_unresolvable";

export type GeminiFloorCornerV1 = Readonly<{
  x: number;
  y: number;
  support: GeminiFloorCornerSupportV1;
}>;
export type GeminiFloorEdgeEvidenceV1 = Readonly<{
  support: GeminiFloorEdgeSupportV1;
  note: string;
}>;
export type GeminiFloorProposalV1 = Readonly<{
  corners: Readonly<{ NL: GeminiFloorCornerV1; NR: GeminiFloorCornerV1; FR: GeminiFloorCornerV1; FL: GeminiFloorCornerV1 }>;
  edge_evidence: Readonly<{ near: GeminiFloorEdgeEvidenceV1; right: GeminiFloorEdgeEvidenceV1; far: GeminiFloorEdgeEvidenceV1; left: GeminiFloorEdgeEvidenceV1 }>;
}>;
export type GeminiFloorHypothesisResponseV1 =
  | Readonly<{
      schema_version: typeof GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION;
      basis_binding: string;
      status: "proposals";
      proposals: readonly GeminiFloorProposalV1[];
    }>
  | Readonly<{
      schema_version: typeof GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION;
      basis_binding: string;
      status: "insufficient_evidence";
      reason_code: GeminiFloorInsufficientEvidenceReasonV1;
      note: string;
    }>;

export type GeminiFloorProposalAuditProvenanceV1 = Readonly<{
  requestId: string;
  contractVersion: string;
  promptVersion: string;
  providerId: string;
  modelId: string;
  responseReceivedAt: string;
  rawResponseSha256: string;
}>;
export type VerifiedGeminiFloorProposalAuditProvenanceV1 = GeminiFloorProposalAuditProvenanceV1 & Readonly<{
  /** Set only by this parser after comparing the digest to exact UTF-8 text. */
  rawResponseSha256Verified: true;
}>;

export type GeminiFloorProposalTrustedContextV1 = Readonly<{
  sharedComparisonContext: SharedCandidateComparisonContext;
  coordinateExtentPolicy: GeminiFloorCoordinateExtentPolicyV1;
  auditProvenance: GeminiFloorProposalAuditProvenanceV1;
}>;

export type GeminiFloorReviewEvidenceV1 = Readonly<{
  rawSourceOrdinal: number;
  corners: Readonly<{ NL: GeminiFloorCornerSupportV1; NR: GeminiFloorCornerSupportV1; FR: GeminiFloorCornerSupportV1; FL: GeminiFloorCornerSupportV1 }>;
  edges: Readonly<{
    near: GeminiFloorEdgeEvidenceV1;
    right: GeminiFloorEdgeEvidenceV1;
    far: GeminiFloorEdgeEvidenceV1;
    left: GeminiFloorEdgeEvidenceV1;
  }>;
}>;

export type GeminiFloorProposalFailureReason =
  | "comparison_context_invalid"
  | "r3_response_too_large"
  | "r3_invalid_json"
  | "r3_not_object"
  | "r3_unknown_schema_version"
  | "r3_raw_response_hash_mismatch"
  | "r3_basis_binding_invalid"
  | "r3_basis_binding_mismatch"
  | "r3_unknown_field"
  | "r3_missing_field"
  | "r3_status_conflict"
  | "r3_unknown_reason_code"
  | "r3_proposal_count_out_of_range"
  | "r3_corner_missing"
  | "r3_corner_unknown"
  | "r3_non_finite_coordinate"
  | "r3_coordinate_outside_permitted_extent"
  | "r3_polygon_invalid"
  | "r3_support_contradiction"
  | "r3_unknown_support_value"
  | "r3_text_invalid"
  | "r3_text_too_long"
  | "r3_candidate_id_hash_collision"
  | "r3_invalid_type";

export type GeminiFloorProposalSafety = Readonly<{
  applied: false;
  authoritative: false;
  persisted: false;
  activeCameraUnchanged: true;
}>;

export type GeminiFloorProposalSuccess = Readonly<{
  status: "proposals";
  contractVersion: typeof GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION;
  schemaVersion: typeof GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION;
  safety: GeminiFloorProposalSafety;
  candidates: readonly FloorCandidateInput[];
  reviewEvidenceByCandidateId: Readonly<Record<string, GeminiFloorReviewEvidenceV1>>;
  auditProvenance: VerifiedGeminiFloorProposalAuditProvenanceV1;
}>;
export type GeminiFloorInsufficientEvidence = Readonly<{
  status: "insufficient_evidence";
  contractVersion: typeof GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION;
  schemaVersion: typeof GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION;
  safety: GeminiFloorProposalSafety;
  reasonCode: GeminiFloorInsufficientEvidenceReasonV1;
  note: string;
  auditProvenance: VerifiedGeminiFloorProposalAuditProvenanceV1;
}>;
export type GeminiFloorProposalContractFailure = Readonly<{
  status: "contract_failure";
  contractVersion: typeof GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION;
  safety: GeminiFloorProposalSafety;
  reason: GeminiFloorProposalFailureReason;
  path: string;
  detail: string;
  auditProvenance: Readonly<{
    requestId: string | null;
    contractVersion: string | null;
    promptVersion: string | null;
    providerId: string | null;
    modelId: string | null;
    responseReceivedAt: string | null;
    rawResponseSha256: string | null;
    rawResponseSha256Verified: false | null;
  }>;
}>;
export type GeminiFloorProposalParseResult =
  | GeminiFloorProposalSuccess
  | GeminiFloorInsufficientEvidence
  | GeminiFloorProposalContractFailure;

const SAFETY: GeminiFloorProposalSafety = Object.freeze({
  applied: false,
  authoritative: false,
  persisted: false,
  activeCameraUnchanged: true,
});
const CORNER_NAMES = ["NL", "NR", "FR", "FL"] as const;
const EDGE_NAMES = ["near", "right", "far", "left"] as const;
const CORNER_SUPPORTS = ["direct_visible", "inferred_from_visible_edges", "occluded_inferred", "outside_frame_inferred"] as const;
const EDGE_SUPPORTS = ["direct_visible", "partially_visible", "inferred_continuation", "not_visible"] as const;
const INSUFFICIENT_REASONS = ["image_unusable", "floor_region_not_visible", "boundary_evidence_insufficient", "semantic_labels_unresolvable"] as const;

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function safeFailureProvenance(value: unknown): GeminiFloorProposalContractFailure["auditProvenance"] {
  const source = isPlainObject(value) ? value : {};
  const text = (key: string) => typeof source[key] === "string" ? source[key] : null;
  return {
    requestId: text("requestId"),
    contractVersion: text("contractVersion"),
    promptVersion: text("promptVersion"),
    providerId: text("providerId"),
    modelId: text("modelId"),
    responseReceivedAt: text("responseReceivedAt"),
    rawResponseSha256: text("rawResponseSha256"),
    rawResponseSha256Verified: false,
  };
}

function failure(reason: GeminiFloorProposalFailureReason, path: string, detail: string): GeminiFloorProposalContractFailure {
  return deepFreeze({
    status: "contract_failure",
    contractVersion: GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
    safety: SAFETY,
    reason,
    path,
    detail,
    auditProvenance: safeFailureProvenance(null),
  });
}

function withFailureProvenance(
  result: GeminiFloorProposalParseResult,
  trustedContext: unknown
): GeminiFloorProposalParseResult {
  if (result.status !== "contract_failure") return result;
  const provenance = isPlainObject(trustedContext) ? trustedContext.auditProvenance : null;
  return deepFreeze({ ...result, auditProvenance: safeFailureProvenance(provenance) });
}

function validCoordinateExtentPolicy(
  value: unknown
): value is GeminiFloorCoordinateExtentPolicyV1 {
  return isPlainObject(value) &&
    value.version === GEMINI_FLOOR_COORDINATE_EXTENT_VERSION &&
    Number.isFinite(value.minX) &&
    Number.isFinite(value.maxX) &&
    Number.isFinite(value.minY) &&
    Number.isFinite(value.maxY) &&
    value.minX === -0.25 &&
    value.maxX === 1.25 &&
    value.minY === -0.25 &&
    value.maxY === 1.25 &&
    value.minX < value.maxX &&
    value.minY < value.maxY;
}

/**
 * Opaque request/response binding for one trusted AFC comparison context.
 * It is audit-only and never enters candidate geometry or AFC-R2 ranking.
 */
export function deriveGeminiFloorBasisBinding(
  sharedComparisonContext: ValidSharedCandidateComparisonContext,
  coordinateExtentPolicy: GeminiFloorCoordinateExtentPolicyV1
): string {
  const canonical = stableSerialize({
    contractVersion: GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
    sharedComparisonContext,
    coordinateExtentPolicy,
  });
  return `afc-r3b:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function ensureExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  unknownReason: GeminiFloorProposalFailureReason = "r3_unknown_field",
  missingReason: GeminiFloorProposalFailureReason = "r3_missing_field"
): GeminiFloorProposalContractFailure | null {
  for (const key of Object.keys(value).sort(compareCanonicalStrings)) {
    if (!required.includes(key)) return failure(unknownReason, `${path}.${key}`, `Unknown field at ${path}.${key}.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) return failure(missingReason, `${path}.${key}`, `Missing required field at ${path}.${key}.`);
  }
  return null;
}

function normalizeText(value: unknown, path: string): string | GeminiFloorProposalContractFailure {
  if (typeof value !== "string") return failure("r3_text_invalid", path, "Review text must be a string.");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    return failure("r3_text_invalid", path, "Review text contains a disallowed control character.");
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) return failure("r3_text_invalid", path, "Review text must contain non-whitespace content.");
  if (Array.from(normalized).length > 200) return failure("r3_text_too_long", path, "Review text exceeds 200 Unicode code points after normalization.");
  return normalized;
}

function normalizedCoordinate(value: unknown, path: string): number | GeminiFloorProposalContractFailure {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return failure("r3_non_finite_coordinate", path, "Coordinate must be a finite JSON number.");
  }
  return Object.is(value, -0) ? 0 : value;
}

function parseCorner(
  value: unknown,
  path: string,
  extentPolicy: typeof GEMINI_FLOOR_COORDINATE_EXTENT_POLICY
): GeminiFloorCornerV1 | GeminiFloorProposalContractFailure {
  if (!isPlainObject(value)) return failure("r3_invalid_type", path, "Corner must be an object.");
  const keyFailure = ensureExactKeys(value, ["x", "y", "support"], path);
  if (keyFailure) return keyFailure;
  const x = normalizedCoordinate(value.x, `${path}.x`);
  if (typeof x !== "number") return x;
  const y = normalizedCoordinate(value.y, `${path}.y`);
  if (typeof y !== "number") return y;
  if (x < extentPolicy.minX || x > extentPolicy.maxX || y < extentPolicy.minY || y > extentPolicy.maxY) {
    return failure("r3_coordinate_outside_permitted_extent", path, "Coordinate is outside afc-r3-coordinate-extent/v1.");
  }
  if (!CORNER_SUPPORTS.includes(value.support as GeminiFloorCornerSupportV1)) {
    return failure("r3_unknown_support_value", `${path}.support`, "Unknown corner support value.");
  }
  const outOfFrame = x < 0 || x > 1 || y < 0 || y > 1;
  if ((outOfFrame && value.support !== "outside_frame_inferred") || (!outOfFrame && value.support === "outside_frame_inferred")) {
    return failure("r3_support_contradiction", `${path}.support`, "outside_frame_inferred must exactly agree with [0,1] coordinate inclusion.");
  }
  return { x, y, support: value.support as GeminiFloorCornerSupportV1 };
}

function parseEdge(value: unknown, path: string): GeminiFloorEdgeEvidenceV1 | GeminiFloorProposalContractFailure {
  if (!isPlainObject(value)) return failure("r3_invalid_type", path, "Edge evidence must be an object.");
  const keyFailure = ensureExactKeys(value, ["support", "note"], path);
  if (keyFailure) return keyFailure;
  if (!EDGE_SUPPORTS.includes(value.support as GeminiFloorEdgeSupportV1)) {
    return failure("r3_unknown_support_value", `${path}.support`, "Unknown edge support value.");
  }
  const note = normalizeText(value.note, `${path}.note`);
  if (typeof note !== "string") return note;
  return { support: value.support as GeminiFloorEdgeSupportV1, note };
}

type ParsedProposal = Readonly<{
  ordinal: number;
  candidate: Omit<FloorCandidateInput, "candidateId">;
  canonicalPolygon: string;
  reviewEvidence: Omit<GeminiFloorReviewEvidenceV1, "rawSourceOrdinal">;
  reviewCanonical: string;
}>;

function parseProposal(
  value: unknown,
  ordinal: number,
  extentPolicy: typeof GEMINI_FLOOR_COORDINATE_EXTENT_POLICY
): ParsedProposal | GeminiFloorProposalContractFailure {
  const proposalPath = `$.proposals[${ordinal}]`;
  if (!isPlainObject(value)) return failure("r3_invalid_type", proposalPath, "Proposal must be an object.");
  const proposalKeys = ensureExactKeys(value, ["corners", "edge_evidence"], proposalPath);
  if (proposalKeys) return proposalKeys;
  if (!isPlainObject(value.corners)) return failure("r3_invalid_type", `${proposalPath}.corners`, "corners must be an object.");
  const cornerKeys = ensureExactKeys(value.corners, CORNER_NAMES, `${proposalPath}.corners`, "r3_corner_unknown", "r3_corner_missing");
  if (cornerKeys) return cornerKeys;
  const corners = {} as Record<(typeof CORNER_NAMES)[number], GeminiFloorCornerV1>;
  for (const name of CORNER_NAMES) {
    const parsed = parseCorner(value.corners[name], `${proposalPath}.corners.${name}`, extentPolicy);
    if ("reason" in parsed) return parsed;
    corners[name] = parsed;
  }
  if (!isPlainObject(value.edge_evidence)) return failure("r3_invalid_type", `${proposalPath}.edge_evidence`, "edge_evidence must be an object.");
  const edgeKeys = ensureExactKeys(value.edge_evidence, EDGE_NAMES, `${proposalPath}.edge_evidence`);
  if (edgeKeys) return edgeKeys;
  const edges = {} as Record<(typeof EDGE_NAMES)[number], GeminiFloorEdgeEvidenceV1>;
  for (const name of EDGE_NAMES) {
    const parsed = parseEdge(value.edge_evidence[name], `${proposalPath}.edge_evidence.${name}`);
    if ("reason" in parsed) return parsed;
    edges[name] = parsed;
  }
  const sourceFloorPolygon = [
    { x: corners.NL.x, y: corners.NL.y },
    { x: corners.NR.x, y: corners.NR.y },
    { x: corners.FR.x, y: corners.FR.y },
    { x: corners.FL.x, y: corners.FL.y },
  ] as const;
  const geometry = validateOrderedFloorCorners([...sourceFloorPolygon]);
  if (!geometry.ok) return failure("r3_polygon_invalid", `${proposalPath}.corners`, geometry.reason);
  const candidate: Omit<FloorCandidateInput, "candidateId"> = {
    candidateSource: "gemini-proposal",
    coordinateSpace: "source-normalized/v1",
    semanticOrder: ["NL", "NR", "FR", "FL"],
    sourceFloorPolygon,
  };
  const reviewEvidence = {
    corners: { NL: corners.NL.support, NR: corners.NR.support, FR: corners.FR.support, FL: corners.FL.support },
    edges: {
      near: { ...edges.near },
      right: { ...edges.right },
      far: { ...edges.far },
      left: { ...edges.left },
    },
  };
  return {
    ordinal,
    candidate,
    canonicalPolygon: candidateCanonicalPolygon({ candidateId: "r3-canonical-only", ...candidate }),
    reviewEvidence,
    reviewCanonical: stableSerialize(reviewEvidence),
  };
}

function copyProvenance(source: GeminiFloorProposalAuditProvenanceV1): VerifiedGeminiFloorProposalAuditProvenanceV1 {
  return {
    requestId: source.requestId,
    contractVersion: source.contractVersion,
    promptVersion: source.promptVersion,
    providerId: source.providerId,
    modelId: source.modelId,
    responseReceivedAt: source.responseReceivedAt,
    rawResponseSha256: source.rawResponseSha256,
    rawResponseSha256Verified: true,
  };
}

function proposalsSuccess(proposals: readonly ParsedProposal[], context: GeminiFloorProposalTrustedContextV1): GeminiFloorProposalSuccess | GeminiFloorProposalContractFailure {
  const geometryByHash = new Map<string, string>();
  for (const proposal of proposals) {
    const hash = fnv1a32(proposal.canonicalPolygon);
    const existing = geometryByHash.get(hash);
    if (existing && existing !== proposal.canonicalPolygon) {
      return failure("r3_candidate_id_hash_collision", "$.proposals", `FNV-1a32 collision for distinct canonical polygons (${hash}).`);
    }
    geometryByHash.set(hash, proposal.canonicalPolygon);
  }
  const ordered = [...proposals].sort((left, right) =>
    compareCanonicalStrings(left.canonicalPolygon, right.canonicalPolygon) ||
    compareCanonicalStrings(left.reviewCanonical, right.reviewCanonical) ||
    left.ordinal - right.ordinal
  );
  const occurrences = new Map<string, number>();
  const candidates: FloorCandidateInput[] = [];
  const reviewEvidenceByCandidateId: Record<string, GeminiFloorReviewEvidenceV1> = {};
  for (const proposal of ordered) {
    const base = `afc-r3:${fnv1a32(proposal.canonicalPolygon)}`;
    const occurrence = (occurrences.get(proposal.canonicalPolygon) ?? 0) + 1;
    occurrences.set(proposal.canonicalPolygon, occurrence);
    const candidateId = `${base}#${String(occurrence).padStart(2, "0")}`;
    candidates.push({
      candidateId,
      candidateSource: "gemini-proposal",
      coordinateSpace: "source-normalized/v1",
      semanticOrder: ["NL", "NR", "FR", "FL"],
      sourceFloorPolygon: [
        { ...proposal.candidate.sourceFloorPolygon[0] },
        { ...proposal.candidate.sourceFloorPolygon[1] },
        { ...proposal.candidate.sourceFloorPolygon[2] },
        { ...proposal.candidate.sourceFloorPolygon[3] },
      ],
    });
    reviewEvidenceByCandidateId[candidateId] = {
      rawSourceOrdinal: proposal.ordinal,
      corners: { ...proposal.reviewEvidence.corners },
      edges: {
        near: { ...proposal.reviewEvidence.edges.near },
        right: { ...proposal.reviewEvidence.edges.right },
        far: { ...proposal.reviewEvidence.edges.far },
        left: { ...proposal.reviewEvidence.edges.left },
      },
    };
  }
  return deepFreeze({
    status: "proposals",
    contractVersion: GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
    schemaVersion: GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION,
    safety: SAFETY,
    candidates,
    reviewEvidenceByCandidateId,
    auditProvenance: copyProvenance(context.auditProvenance),
  });
}

/**
 * Strict, raw-text AFC-R3B parser. It intentionally does not invoke a model,
 * persist data, compare candidates, or produce a selection.
 */
export function parseGeminiFloorProposalResponse(
  rawResponse: string,
  trustedContext: GeminiFloorProposalTrustedContextV1
): GeminiFloorProposalParseResult {
  const finish = (result: GeminiFloorProposalParseResult) => withFailureProvenance(result, trustedContext);
  if (typeof rawResponse !== "string") return finish(failure("r3_invalid_type", "$", "Raw response must be a string."));
  const validatedSharedContext = validateSharedCandidateComparisonContext(trustedContext?.sharedComparisonContext);
  if (!validatedSharedContext.ok) {
    return finish(failure("comparison_context_invalid", "$.trustedContext.sharedComparisonContext", "Trusted comparison context is invalid."));
  }
  const extentPolicy = trustedContext?.coordinateExtentPolicy;
  if (!validCoordinateExtentPolicy(extentPolicy)) {
    return finish(failure("comparison_context_invalid", "$.trustedContext.coordinateExtentPolicy", "Trusted comparison context is invalid."));
  }
  const audit = trustedContext?.auditProvenance;
  if (!audit || audit.contractVersion !== GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION) {
    return finish(failure("comparison_context_invalid", "$.trustedContext.auditProvenance", "Trusted comparison context is invalid."));
  }
  if (typeof audit.rawResponseSha256 !== "string" || !/^[a-f0-9]{64}$/.test(audit.rawResponseSha256)) {
    return finish(failure("comparison_context_invalid", "$.trustedContext.auditProvenance", "Trusted comparison context is invalid."));
  }
  if (Buffer.byteLength(rawResponse, "utf8") > GEMINI_FLOOR_MAX_RAW_RESPONSE_BYTES) {
    return finish(failure("r3_response_too_large", "$", "Raw response exceeds 65,536 UTF-8 bytes."));
  }
  const rawResponseSha256 = createHash("sha256").update(rawResponse, "utf8").digest("hex");
  if (rawResponseSha256 !== audit.rawResponseSha256) {
    return finish(failure("r3_raw_response_hash_mismatch", "$.trustedContext.auditProvenance.rawResponseSha256", "Trusted raw-response SHA-256 does not match the exact UTF-8 raw response."));
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawResponse);
  } catch {
    return finish(failure("r3_invalid_json", "$", "Response must be exactly one JSON object without surrounding prose or Markdown fences."));
  }
  if (!isPlainObject(decoded)) return finish(failure("r3_not_object", "$", "Response must be a JSON object."));
  for (const key of ["schema_version", "basis_binding", "status"]) {
    if (!Object.hasOwn(decoded, key)) return finish(failure("r3_missing_field", `$.${key}`, `Missing required field at $.${key}.`));
  }
  if (decoded.schema_version !== GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION) {
    return finish(failure("r3_unknown_schema_version", "$.schema_version", "Unsupported floor-hypothesis schema version."));
  }
  if (typeof decoded.basis_binding !== "string" || !/^[\x21-\x7e]{1,128}$/.test(decoded.basis_binding)) {
    return finish(failure("r3_basis_binding_invalid", "$.basis_binding", "basis_binding must be a printable-ASCII token of at most 128 characters."));
  }
  const expectedBasisBinding = deriveGeminiFloorBasisBinding(
    validatedSharedContext.value,
    extentPolicy
  );
  if (decoded.basis_binding !== expectedBasisBinding) {
    return finish(failure("r3_basis_binding_mismatch", "$.basis_binding", "Model basis_binding does not match the trusted-context-derived binding."));
  }
  if (decoded.status === "insufficient_evidence") {
    const keys = ensureExactKeys(decoded, ["schema_version", "basis_binding", "status", "reason_code", "note"], "$");
    if (keys) {
      return finish(keys.reason === "r3_unknown_field" && keys.path === "$.proposals"
        ? failure("r3_status_conflict", keys.path, "insufficient_evidence status cannot carry proposal fields.")
        : keys);
    }
    if (!INSUFFICIENT_REASONS.includes(decoded.reason_code as GeminiFloorInsufficientEvidenceReasonV1)) {
      return finish(failure("r3_unknown_reason_code", "$.reason_code", "Unknown insufficient-evidence reason code."));
    }
    const note = normalizeText(decoded.note, "$.note");
    if (typeof note !== "string") return finish(note);
    return deepFreeze({
      status: "insufficient_evidence",
      contractVersion: GEMINI_FLOOR_PROPOSAL_CONTRACT_VERSION,
      schemaVersion: GEMINI_FLOOR_HYPOTHESES_SCHEMA_VERSION,
      safety: SAFETY,
      reasonCode: decoded.reason_code as GeminiFloorInsufficientEvidenceReasonV1,
      note,
      auditProvenance: copyProvenance(trustedContext.auditProvenance),
    });
  }
  if (decoded.status !== "proposals") return finish(failure("r3_status_conflict", "$.status", "status must be proposals or insufficient_evidence."));
  const keys = ensureExactKeys(decoded, ["schema_version", "basis_binding", "status", "proposals"], "$");
  if (keys) {
    const crossBranchField = keys.path === "$.reason_code" || keys.path === "$.note";
    return finish(keys.reason === "r3_unknown_field" && crossBranchField
      ? failure("r3_status_conflict", keys.path, "proposals status cannot carry insufficient-evidence fields.")
      : keys);
  }
  if (!Array.isArray(decoded.proposals) || decoded.proposals.length < 1 || decoded.proposals.length > 4) {
    return finish(failure("r3_proposal_count_out_of_range", "$.proposals", "proposals must contain between 1 and 4 entries."));
  }
  const proposals: ParsedProposal[] = [];
  for (let ordinal = 0; ordinal < decoded.proposals.length; ordinal += 1) {
    const parsed = parseProposal(decoded.proposals[ordinal], ordinal, extentPolicy);
    if ("reason" in parsed) return finish(parsed);
    proposals.push(parsed);
  }
  return finish(proposalsSuccess(proposals, trustedContext));
}
