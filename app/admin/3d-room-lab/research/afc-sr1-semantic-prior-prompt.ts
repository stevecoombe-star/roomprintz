import {
  AFC_SR1_ALLOWED_DECISIONS,
  AFC_SR1_HYPOTHESES,
  AFC_SR1_SCORE_TOTAL_TOLERANCE,
  AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION,
  AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION,
  parseAfcSr1SemanticPriorResponse,
  type AfcSr1SemanticReasonLabelV1,
} from "./afc-sr1-semantic-prior";
import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";

export const AFC_SR1_SEMANTIC_PRIOR_PROMPT_VERSION =
  "afc-sr1-semantic-prior-prompt/v1" as const;
export const AFC_SR1_SEMANTIC_PRIOR_PROMPT_TEXT_VERSION =
  "afc-sr1-semantic-prior-prompt-text/v1" as const;
export const AFC_SR1_RESPONSE_CONTRACT_DOCUMENT_VERSION =
  "afc-sr1-response-contract-document/v1" as const;

const SEMANTIC_LABELS: readonly AfcSr1SemanticReasonLabelV1[] = Object.freeze([
  "left_side_appears_nearer",
  "right_side_appears_nearer",
  "side_depth_ambiguous",
  "back_wall_visible",
  "both_side_walls_visible",
  "floor_wall_edges_partially_off_frame",
  "perspective_supports_opposite_near_corner_refinement",
  "no_refinement_evidence",
  "insufficient_side_wall_comparison",
  "unsupported_room_structure",
]);

export type AfcSr1ResponseContractDocumentV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_RESPONSE_CONTRACT_DOCUMENT_VERSION;
  responseSchemaVersion: typeof AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION;
  parserVersion: typeof AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION;
  allowedKeys: readonly string[];
  allowedDecisions: typeof AFC_SR1_ALLOWED_DECISIONS;
  hypotheses: typeof AFC_SR1_HYPOTHESES;
  semanticLabels: readonly AfcSr1SemanticReasonLabelV1[];
  rankingRules: Readonly<{
    exactHypothesisCount: 3;
    uniqueHypotheses: true;
    descendingScores: true;
    scoreMin: 0;
    scoreMax: 1;
    sumTarget: 1;
    sumTolerance: number;
  }>;
  seamTPriorRules: Readonly<{
    min: 0;
    max: 1;
    nullable: true;
  }>;
  unknownKeysRejected: true;
  geometryFieldsForbidden: true;
}>;

export type AfcSr1SemanticPriorPromptV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_SEMANTIC_PRIOR_PROMPT_VERSION;
  promptVersion: typeof AFC_SR1_SEMANTIC_PRIOR_PROMPT_TEXT_VERSION;
  promptText: string;
  promptSha256: string;
  expectedResponseSchemaVersion: typeof AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION;
  expectedParserVersion: typeof AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION;
  responseContractDigest: string;
}>;

function fail(reason: string): never {
  throw new Error(`AFC-SR1 semantic-prior prompt: ${reason}`);
}

export function buildAfcSr1ResponseContractDocument(): AfcSr1ResponseContractDocumentV1 {
  return Object.freeze({
    schemaVersion: AFC_SR1_RESPONSE_CONTRACT_DOCUMENT_VERSION,
    responseSchemaVersion: AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION,
    parserVersion: AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION,
    allowedKeys: Object.freeze([
      "schemaVersion",
      "bindingEcho",
      "decision",
      "rankedHypotheses",
      "seamTPrior",
      "semanticLabels",
    ]),
    allowedDecisions: AFC_SR1_ALLOWED_DECISIONS,
    hypotheses: AFC_SR1_HYPOTHESES,
    semanticLabels: SEMANTIC_LABELS,
    rankingRules: Object.freeze({
      exactHypothesisCount: 3,
      uniqueHypotheses: true,
      descendingScores: true,
      scoreMin: 0,
      scoreMax: 1,
      sumTarget: 1,
      sumTolerance: AFC_SR1_SCORE_TOTAL_TOLERANCE,
    }),
    seamTPriorRules: Object.freeze({ min: 0, max: 1, nullable: true }),
    unknownKeysRejected: true,
    geometryFieldsForbidden: true,
  });
}

export function digestAfcSr1ResponseContract(
  contract: AfcSr1ResponseContractDocumentV1
): string {
  validateAfcSr1ResponseContractDocument(contract);
  return sha256HexUtf8(canonicalizeRfc8785Jcs(contract));
}

export function validateAfcSr1ResponseContractDocument(
  contract: unknown
): asserts contract is AfcSr1ResponseContractDocumentV1 {
  if (!contract || typeof contract !== "object") fail("response_contract_shape_invalid");
  const value = contract as AfcSr1ResponseContractDocumentV1;
  const keys = [
    "schemaVersion", "responseSchemaVersion", "parserVersion", "allowedKeys",
    "allowedDecisions", "hypotheses", "semanticLabels", "rankingRules",
    "seamTPriorRules", "unknownKeysRejected", "geometryFieldsForbidden",
  ];
  if (Object.keys(value).sort().join("\u0000") !== keys.sort().join("\u0000") ||
      value.schemaVersion !== AFC_SR1_RESPONSE_CONTRACT_DOCUMENT_VERSION ||
      value.responseSchemaVersion !== AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION ||
      value.parserVersion !== AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION ||
      !Array.isArray(value.allowedKeys) ||
      value.allowedKeys.join("\u0000") !== [
        "schemaVersion", "bindingEcho", "decision", "rankedHypotheses", "seamTPrior", "semanticLabels",
      ].join("\u0000") ||
      value.allowedDecisions.join("\u0000") !== AFC_SR1_ALLOWED_DECISIONS.join("\u0000") ||
      value.hypotheses.join("\u0000") !== AFC_SR1_HYPOTHESES.join("\u0000") ||
      value.semanticLabels.join("\u0000") !== SEMANTIC_LABELS.join("\u0000") ||
      value.rankingRules.exactHypothesisCount !== 3 ||
      value.rankingRules.uniqueHypotheses !== true ||
      value.rankingRules.descendingScores !== true ||
      value.rankingRules.scoreMin !== 0 ||
      value.rankingRules.scoreMax !== 1 ||
      value.rankingRules.sumTarget !== 1 ||
      value.rankingRules.sumTolerance !== AFC_SR1_SCORE_TOTAL_TOLERANCE ||
      value.seamTPriorRules.min !== 0 ||
      value.seamTPriorRules.max !== 1 ||
      value.seamTPriorRules.nullable !== true ||
      value.unknownKeysRejected !== true ||
      value.geometryFieldsForbidden !== true) {
    fail("response_contract_invalid");
  }
}

export function validateAfcSr1ResponseAgainstContract(
  response: unknown,
  contract: AfcSr1ResponseContractDocumentV1 = buildAfcSr1ResponseContractDocument()
): boolean {
  try {
    validateAfcSr1ResponseContractDocument(contract);
  } catch {
    return false;
  }
  return parseAfcSr1SemanticPriorResponse(response).ok;
}

export function buildAfcSr1SemanticPriorPrompt(input: Readonly<{
  seamBindingToken: string;
  responseContract?: AfcSr1ResponseContractDocumentV1;
}>): AfcSr1SemanticPriorPromptV1 {
  if (!/^sr1sbt1:[0-9a-f]{64}$/.test(input.seamBindingToken)) {
    fail("seam_binding_token_invalid");
  }
  const responseContract = input.responseContract ?? buildAfcSr1ResponseContractDocument();
  const responseContractDigest = digestAfcSr1ResponseContract(responseContract);
  const promptText = [
    "You are providing an advisory-only semantic prior for one active Original room photograph.",
    "The attached image is the active Original room photograph. Its overlay geometry was fixed server-side.",
    "Do not change, infer replacements for, or return geometry. Both candidate seams are shown near-to-far.",
    `Rank exactly these hypotheses: ${AFC_SR1_HYPOTHESES.join(", ")}.`,
    `Use exactly one decision: ${AFC_SR1_ALLOWED_DECISIONS.join(", ")}.`,
    "A seamT prior is optional and advisory only: seamT=0 is the near corner and seamT=1 is the far corner.",
    "Do not assume width is visually or physically longer than depth. Ambiguous evidence must abstain.",
    "Unsupported room structure must use unsupported_image_class.",
    "Do not return polygons, corners, seam endpoints, dimensions, ratio, FOV, camera data, pose, homography, or Apply instructions.",
    `bindingEcho must exactly equal "${input.seamBindingToken}".`,
    `semanticLabels may contain only: ${SEMANTIC_LABELS.join(", ")}.`,
    "Return one exact JSON object with no extra keys, using this closed key set: schemaVersion, bindingEcho, decision, rankedHypotheses, seamTPrior, semanticLabels.",
  ].join("\n");
  return Object.freeze({
    schemaVersion: AFC_SR1_SEMANTIC_PRIOR_PROMPT_VERSION,
    promptVersion: AFC_SR1_SEMANTIC_PRIOR_PROMPT_TEXT_VERSION,
    promptText,
    promptSha256: sha256HexUtf8(promptText),
    expectedResponseSchemaVersion: AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION,
    expectedParserVersion: AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION,
    responseContractDigest,
  });
}

export function validateAfcSr1SemanticPriorPrompt(
  prompt: unknown,
  responseContract: AfcSr1ResponseContractDocumentV1
): asserts prompt is AfcSr1SemanticPriorPromptV1 {
  if (!prompt || typeof prompt !== "object") fail("prompt_shape_invalid");
  const value = prompt as AfcSr1SemanticPriorPromptV1;
  if (value.schemaVersion !== AFC_SR1_SEMANTIC_PRIOR_PROMPT_VERSION ||
      value.promptVersion !== AFC_SR1_SEMANTIC_PRIOR_PROMPT_TEXT_VERSION ||
      typeof value.promptText !== "string" || value.promptText.length === 0 ||
      value.promptSha256 !== sha256HexUtf8(value.promptText) ||
      value.expectedResponseSchemaVersion !== AFC_SR1_SEMANTIC_PRIOR_RESPONSE_VERSION ||
      value.expectedParserVersion !== AFC_SR1_VALIDATED_ADVISORY_PARSER_VERSION ||
      value.responseContractDigest !== digestAfcSr1ResponseContract(responseContract)) {
    fail("prompt_invalid");
  }
}
