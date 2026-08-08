import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import sharp from "sharp";

import {
  compileAfcSr1GeminiResponseJsonSchema,
  digestAfcSr1ProviderRequest,
  extractAfcSr1GeminiCandidate,
  type AfcSr1ProviderExecutionProfileV1,
} from "./afc-sr1-gemini-adapter";
import {
  buildAfcSr1ExecutionReceipt,
  buildAfcSr1RawProviderEvidence,
  reenterAfcSr1P0,
  validateAfcSr1ProviderExecutionReplay,
} from "./afc-sr1-provider-replay";
import {
  buildAfcSr1OriginalBasisPlacement,
  buildAfcSr1OverlayDescriptor,
  buildAfcSr1SemanticPriorBinding,
} from "./afc-sr1-semantic-prior";
import { buildAfcSr1RequestPackage } from "./afc-sr1-request-package";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const profile: AfcSr1ProviderExecutionProfileV1 = Object.freeze({
  schemaVersion: "afc-sr1-provider-execution-profile/v1", provider: "google_gemini",
  adapterVersion: "afc-sr1-gemini-adapter/v1", model: "gemini-3.5-flash",
  candidateCount: 1, temperature: 0, maxOutputTokens: 2048, responseMimeType: "application/json",
  thinkingPolicy: "minimal_for_gemini_3_5_flash_only/v1", retryPolicy: "single_attempt/v1",
});

async function fixture() {
  const originalBytes = await sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 2, g: 4, b: 6 } },
  }).png().toBuffer();
  const basis = { fingerprint: hash(originalBytes), decodedWidth: 32, decodedHeight: 24, orientation: 1 as const };
  const binding = buildAfcSr1SemanticPriorBinding({
    replayEvidence: {
      schemaVersion: "afc-sr1-replay-evidence-identity/v1", receiptContractVersion: "afc-r3c-proposal-run-receipt/v1",
      receiptFileName: "replay-fixture.json", receiptSha256: "a".repeat(64), requestId: "replay-fixture",
      imageRole: "empty_room_boundary_specialist", r3bCandidateId: "afc-r3:replay",
      r3cCandidateId: "afc-r3c:empty:afc-r3:replay", inputImageFingerprint: basis.fingerprint,
      originalImageFingerprint: basis.fingerprint, emptyRoomAssistFingerprint: basis.fingerprint,
      replayVerificationVersion: "replay/v1", replayEvidenceFingerprint: "b".repeat(64),
    },
    placement: buildAfcSr1OriginalBasisPlacement({
      schemaVersion: "afc-sr1-original-basis-placement/v1", status: "placed_on_original_basis",
      method: "already_original_basis", sourceEmptyBasis: basis, targetOriginalBasis: basis,
      compatibilityTier: "exact_grid_compatible", transferRecordFingerprint: "c".repeat(64),
    }),
    rawSourcePolygon: [{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }, { x: 0.7, y: 0.35 }, { x: 0.3, y: 0.35 }],
    overlayGenerationId: "replay-overlay", requestGenerationId: "replay-request",
  });
  return buildAfcSr1RequestPackage({
    packageGenerationId: "replay-package", semanticPriorBinding: binding,
    overlayDescriptor: buildAfcSr1OverlayDescriptor({
      originalTargetBasis: basis, rawSourcePolygon: binding.rawSourcePolygon, overlayGenerationId: binding.overlayGenerationId,
    }),
    originalBytes,
  });
}

async function replayBundle() {
  const pack = await fixture();
  const token = pack.requestPackage.artifact.seamBindingToken;
  const text = JSON.stringify({
    schemaVersion: "afc-sr1-semantic-prior-response/v1", bindingEcho: token, decision: "adjust_nr",
    rankedHypotheses: [{ hypothesis: "NR", score: 0.7 }, { hypothesis: "none", score: 0.2 }, { hypothesis: "NL", score: 0.1 }],
    seamTPrior: { adjustableCorner: "NR", preferredSeamT: 0.5, minSeamT: 0.2, maxSeamT: 0.8 },
    semanticLabels: ["back_wall_visible"],
  });
  const rawResponseBytes = Buffer.from(JSON.stringify({
    modelVersion: "replay-model-version", usageMetadata: { totalTokenCount: 18 },
    candidates: [{ index: 0, finishReason: "STOP", content: { role: "model", parts: [{ text }] } }],
  }));
  const schema = compileAfcSr1GeminiResponseJsonSchema(pack.requestPackage.artifact.responseContract);
  const providerRequestDigest = digestAfcSr1ProviderRequest({ requestPackage: pack.requestPackage, profile, responseJsonSchema: schema });
  const rawEvidence = buildAfcSr1RawProviderEvidence({ httpStatus: 200, rawResponseBytes });
  const extraction = extractAfcSr1GeminiCandidate(rawResponseBytes);
  assert.equal(extraction.ok, true);
  if (!extraction.ok) throw new Error("fixture extraction failed");
  const p0 = reenterAfcSr1P0({ requestPackage: pack.requestPackage, candidateText: extraction.candidateText });
  assert.equal(p0.kind, "validated_advisory");
  const receipt = buildAfcSr1ExecutionReceipt({
    requestPackage: pack.requestPackage, profile, providerRequestDigest, rawEvidence, extraction, p0,
  });
  return { requestPackage: pack.requestPackage, packageEvidence: pack.evidenceBytes, profile, providerRequestDigest, rawResponseBytes, receipt };
}

test("P2 replay recomputes an advisory receipt from raw evidence without a network call", async () => {
  const bundle = await replayBundle();
  const result = await validateAfcSr1ProviderExecutionReplay(bundle);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.advisory?.status, "usable");
    assert.equal(result.receipt.receiptDigest, bundle.receipt.receiptDigest);
  }
});

test("P2 replay rejects package, profile, request, raw, and receipt mutations", async () => {
  const bundle = await replayBundle();
  const mutations: readonly [string, any][] = [
    ["profile", { ...bundle, profile: { ...bundle.profile, model: "gemini-3.5-flash-preview" } }],
    ["adapter version", { ...bundle, profile: { ...bundle.profile, adapterVersion: "afc-sr1-gemini-adapter/v0" } }],
    ["request digest", { ...bundle, providerRequestDigest: `sr1prvreq1:${"0".repeat(64)}` }],
    ["raw body", { ...bundle, rawResponseBytes: Buffer.from(bundle.rawResponseBytes).fill(0) }],
    ["receipt", { ...bundle, receipt: { ...bundle.receipt, candidateTextSha256: "0".repeat(64) } }],
    ["parsed response", { ...bundle, receipt: { ...bundle.receipt, parsedResponseDigest: "0".repeat(64) } }],
    ["P0 binding", (() => {
      const requestPackage: any = structuredClone(bundle.requestPackage);
      requestPackage.artifact.p0Request.seamBindingToken = `sr1sbt1:${"0".repeat(64)}`;
      return { ...bundle, requestPackage };
    })()],
  ];
  for (const [name, mutated] of mutations) {
    const result = await validateAfcSr1ProviderExecutionReplay(mutated);
    assert.equal(result.ok, false, name);
  }
});

test("P2 replay source has no transport, server-only, or UI dependency", () => {
  const source = readFileSync(new URL("./afc-sr1-provider-replay.ts", import.meta.url), "utf8");
  for (const forbidden of [
    'import "server-only"', "fetch(", "ThreeRoomLab", "AfcProposalOverlay",
    "afc-verified-floor-apply", "afc-verified-camera-apply", "CP2A", "CP2B",
    "perspective-solve", "ratio-fov-harness", "gemini-floor-proposal",
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});
