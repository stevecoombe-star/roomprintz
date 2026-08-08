import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import sharp from "sharp";

import {
  buildAfcSr1GeminiRequestPayload,
  compileAfcSr1GeminiResponseJsonSchema,
  digestAfcSr1ProviderExecutionProfile,
  digestAfcSr1ProviderRequest,
  extractAfcSr1GeminiCandidate,
  type AfcSr1ProviderExecutionProfileV1,
} from "./afc-sr1-gemini-adapter";
import {
  buildAfcSr1OriginalBasisPlacement,
  buildAfcSr1OverlayDescriptor,
  buildAfcSr1SemanticPriorBinding,
} from "./afc-sr1-semantic-prior";
import { buildAfcSr1RequestPackage } from "./afc-sr1-request-package";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const profile = (model = "gemini-3.5-flash"): AfcSr1ProviderExecutionProfileV1 => Object.freeze({
  schemaVersion: "afc-sr1-provider-execution-profile/v1",
  provider: "google_gemini",
  adapterVersion: "afc-sr1-gemini-adapter/v1",
  model,
  candidateCount: 1,
  temperature: 0,
  maxOutputTokens: 2048,
  responseMimeType: "application/json",
  thinkingPolicy: "minimal_for_gemini_3_5_flash_only/v1",
  retryPolicy: "single_attempt/v1",
});

export async function sr1PackageFixture() {
  const originalBytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 45, b: 60 } },
  }).png({ compressionLevel: 9, effort: 10, adaptiveFiltering: false, palette: false }).toBuffer();
  const basis = { fingerprint: hash(originalBytes), decodedWidth: 64, decodedHeight: 48, orientation: 1 as const };
  const binding = buildAfcSr1SemanticPriorBinding({
    replayEvidence: {
      schemaVersion: "afc-sr1-replay-evidence-identity/v1",
      receiptContractVersion: "afc-r3c-proposal-run-receipt/v1",
      receiptFileName: "p2-fixture.json", receiptSha256: "b".repeat(64),
      requestId: "p2-fixture-request", imageRole: "empty_room_boundary_specialist",
      r3bCandidateId: "afc-r3:p2-fixture", r3cCandidateId: "afc-r3c:empty:afc-r3:p2-fixture",
      inputImageFingerprint: basis.fingerprint, originalImageFingerprint: basis.fingerprint,
      emptyRoomAssistFingerprint: basis.fingerprint, replayVerificationVersion: "p2-fixture/v1",
      replayEvidenceFingerprint: "c".repeat(64),
    },
    placement: buildAfcSr1OriginalBasisPlacement({
      schemaVersion: "afc-sr1-original-basis-placement/v1", status: "placed_on_original_basis",
      method: "already_original_basis", sourceEmptyBasis: basis, targetOriginalBasis: basis,
      compatibilityTier: "exact_grid_compatible", transferRecordFingerprint: "d".repeat(64),
    }),
    rawSourcePolygon: [
      { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.86 }, { x: 0.68, y: 0.34 }, { x: 0.28, y: 0.42 },
    ],
    overlayGenerationId: "p2-fixture-overlay", requestGenerationId: "p2-fixture-request-generation",
  });
  return buildAfcSr1RequestPackage({
    packageGenerationId: "p2-fixture-package",
    semanticPriorBinding: binding,
    overlayDescriptor: buildAfcSr1OverlayDescriptor({
      originalTargetBasis: basis, rawSourcePolygon: binding.rawSourcePolygon, overlayGenerationId: binding.overlayGenerationId,
    }),
    originalBytes,
  });
}

function validResponse(token: string, decision = "adjust_nr") {
  return {
    schemaVersion: "afc-sr1-semantic-prior-response/v1",
    bindingEcho: token,
    decision,
    rankedHypotheses: decision === "abstain" || decision === "unsupported_image_class" ? null : [
      { hypothesis: "NR", score: 0.6 }, { hypothesis: "none", score: 0.3 }, { hypothesis: "NL", score: 0.1 },
    ],
    seamTPrior: decision === "abstain" || decision === "unsupported_image_class" ? null :
      { adjustableCorner: "NR", preferredSeamT: 0.5, minSeamT: 0.2, maxSeamT: 0.8 },
    semanticLabels: ["back_wall_visible"],
  };
}

function envelope(text: string, extra: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({
    modelVersion: "fixture-provider-model",
    usageMetadata: { totalTokenCount: 12 },
    candidates: [{ index: 0, finishReason: "STOP", content: { role: "model", parts: [{ text }] }, ...extra }],
  }));
}

test("P2 Gemini adapter preserves the certified prompt and exact composite bytes", async () => {
  const fixture = await sr1PackageFixture();
  const payload = buildAfcSr1GeminiRequestPayload({
    requestPackage: fixture.requestPackage, evidenceBytes: fixture.evidenceBytes, profile: profile(),
  });
  const parts = payload.contents[0].parts;
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text, fixture.requestPackage.artifact.prompt.promptText);
  assert.deepEqual(
    Buffer.from(parts[1].inlineData.data, "base64"),
    Buffer.from(fixture.evidenceBytes.compositePngBytes),
  );
  assert.equal(parts[1].inlineData.mimeType, "image/png");
  assert.equal("originalBytes" in (payload as object), false);
  assert.deepEqual(Object.keys(payload.generationConfig).sort(), [
    "candidateCount", "maxOutputTokens", "responseJsonSchema", "responseMimeType", "temperature", "thinkingConfig",
  ]);
  assert.equal(payload.generationConfig.candidateCount, 1);
  const schema = payload.generationConfig.responseJsonSchema as Record<string, any>;
  assert.deepEqual(schema.required, fixture.requestPackage.artifact.responseContract.allowedKeys);
  assert.equal(schema.additionalProperties, false);
  assert.equal(JSON.stringify(schema).includes("polygon"), false);
  assert.equal(JSON.stringify(schema).includes("camera"), false);
});

test("P2 profile and provider-request identities are mutation-sensitive without secrets", async () => {
  const fixture = await sr1PackageFixture();
  const schema = compileAfcSr1GeminiResponseJsonSchema(fixture.requestPackage.artifact.responseContract);
  const first = profile();
  const requestDigest = digestAfcSr1ProviderRequest({ requestPackage: fixture.requestPackage, profile: first, responseJsonSchema: schema });
  assert.match(digestAfcSr1ProviderExecutionProfile(first), /^sr1prof1:[0-9a-f]{64}$/);
  assert.match(requestDigest, /^sr1prvreq1:[0-9a-f]{64}$/);
  assert.notEqual(
    requestDigest,
    digestAfcSr1ProviderRequest({ requestPackage: fixture.requestPackage, profile: profile("gemini-3.5-flash-preview"), responseJsonSchema: schema }),
  );
  assert.equal(requestDigest.includes("secret-api-key"), false);
});

test("P2 candidate extraction is deterministic and fail-closed", async () => {
  const fixture = await sr1PackageFixture();
  const text = JSON.stringify(validResponse(fixture.requestPackage.artifact.seamBindingToken));
  for (const [name, bytes, expected] of [
    ["valid", envelope(text), "ok"],
    ["zero", Buffer.from(JSON.stringify({ candidates: [] })), "empty_candidates"],
    ["two", Buffer.from(JSON.stringify({ candidates: [{}, {}] })), "candidates_ambiguous"],
    ["malformed candidate", Buffer.from(JSON.stringify({
      candidates: [{ index: 0, finishReason: "STOP", content: null }],
    })), "malformed_envelope"],
    ["no text", envelope(text, { content: { role: "model", parts: [] } }), "no_text"],
    ["two text", envelope(text, { content: { role: "model", parts: [{ text }, { text }] } }), "multiple_text_parts"],
    ["thought", envelope(text, { content: { role: "model", parts: [{ text, thoughtSignature: "opaque" }] } }), "ok"],
    ["tool", envelope(text, { content: { role: "model", parts: [{ text, functionCall: {} }] } }), "text_part_ambiguous"],
    ["max", envelope(text, { finishReason: "MAX_TOKENS" }), "unsupported_finish_reason"],
    ["safety", envelope(text, { finishReason: "SAFETY" }), "blocked"],
    ["missing", envelope(text, { finishReason: undefined }), "unsupported_finish_reason"],
  ] as const) {
    const result = extractAfcSr1GeminiCandidate(bytes);
    assert.equal(result.ok ? "ok" : result.class, expected, name);
  }
});

test("P2 production source contains no authority or forbidden integration coupling", () => {
  const source = readFileSync(new URL("./afc-sr1-gemini-adapter.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "ThreeRoomLab", "AfcProposalOverlay", "afc-verified-floor-apply", "afc-verified-camera-apply",
    "CP2A", "CP2B", "perspective-solve", "ratio-fov-harness", "gemini-floor-proposal",
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});
