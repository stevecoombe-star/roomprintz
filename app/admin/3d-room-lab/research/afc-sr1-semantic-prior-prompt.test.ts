import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_SR1_RESPONSE_CONTRACT_DOCUMENT_VERSION,
  AFC_SR1_SEMANTIC_PRIOR_PROMPT_TEXT_VERSION,
  buildAfcSr1ResponseContractDocument,
  buildAfcSr1SemanticPriorPrompt,
  digestAfcSr1ResponseContract,
  validateAfcSr1ResponseAgainstContract,
} from "./afc-sr1-semantic-prior-prompt";

const token = `sr1sbt1:${"a".repeat(64)}`;

test("P1 prompt freezes P0 vocabulary and advisory-only instructions", () => {
  const contract = buildAfcSr1ResponseContractDocument();
  const prompt = buildAfcSr1SemanticPriorPrompt({ seamBindingToken: token, responseContract: contract });
  assert.equal(prompt.promptVersion, AFC_SR1_SEMANTIC_PRIOR_PROMPT_TEXT_VERSION);
  for (const expected of [
    "none", "NL", "NR", "no_adjustment", "adjust_nl", "adjust_nr",
    "abstain", "unsupported_image_class", "insufficient_evidence",
    "seamT=0", "seamT=1", "bindingEcho", "polygons", "FOV", "camera",
  ]) assert.ok(prompt.promptText.includes(expected));
  for (const forbidden of ["4.6", "1.15", "79", "0.7063703325987577"]) {
    assert.equal(prompt.promptText.includes(forbidden), false);
  }
  assert.equal(prompt.responseContractDigest, digestAfcSr1ResponseContract(contract));
});

test("P1 response contract remains parser-aligned and rejects geometry fields", () => {
  const contract = buildAfcSr1ResponseContractDocument();
  assert.equal(contract.schemaVersion, AFC_SR1_RESPONSE_CONTRACT_DOCUMENT_VERSION);
  const valid = {
    schemaVersion: "afc-sr1-semantic-prior-response/v1",
    bindingEcho: token,
    decision: "adjust_nl",
    rankedHypotheses: [
      { hypothesis: "NL", score: 0.7 },
      { hypothesis: "none", score: 0.2 },
      { hypothesis: "NR", score: 0.1 },
    ],
    seamTPrior: { adjustableCorner: "NL", preferredSeamT: null, minSeamT: 0, maxSeamT: 1 },
    semanticLabels: ["left_side_appears_nearer", "back_wall_visible"],
  };
  assert.equal(validateAfcSr1ResponseAgainstContract(valid, contract), true);
  assert.equal(validateAfcSr1ResponseAgainstContract({ ...valid, polygon: [] }, contract), false);
  assert.equal(validateAfcSr1ResponseAgainstContract({
    ...valid, decision: "unsupported_image_class", rankedHypotheses: null, seamTPrior: null,
  }, contract), true);
  const changed = {
    ...contract,
    semanticLabels: [...contract.semanticLabels, "unknown"] as any,
  };
  assert.throws(() => digestAfcSr1ResponseContract(changed), /invalid/);
});
