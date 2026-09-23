import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import sharp from "sharp";

import type { AfcSr1ProviderFetch } from "./afc-sr1-provider-execution";
import {
  buildAfcSr1OriginalBasisPlacement,
  buildAfcSr1OverlayDescriptor,
  buildAfcSr1SemanticPriorBinding,
} from "./afc-sr1-semantic-prior";
import { buildAfcSr1RequestPackage } from "./afc-sr1-request-package";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hasReactServerCondition = process.execArgv.includes("--conditions=react-server");
const REACT_SERVER_REQUIRED = "requires --conditions=react-server";
type ExecutorModule = typeof import("./afc-sr1-provider-execution");

async function fixture() {
  const originalBytes = await sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).png().toBuffer();
  const basis = { fingerprint: hash(originalBytes), decodedWidth: 32, decodedHeight: 24, orientation: 1 as const };
  const binding = buildAfcSr1SemanticPriorBinding({
    replayEvidence: {
      schemaVersion: "afc-sr1-replay-evidence-identity/v1", receiptContractVersion: "afc-r3c-proposal-run-receipt/v1",
      receiptFileName: "execution-fixture.json", receiptSha256: "a".repeat(64), requestId: "execution-fixture",
      imageRole: "empty_room_boundary_specialist", r3bCandidateId: "afc-r3:execution",
      r3cCandidateId: "afc-r3c:empty:afc-r3:execution", inputImageFingerprint: basis.fingerprint,
      originalImageFingerprint: basis.fingerprint, emptyRoomAssistFingerprint: basis.fingerprint,
      replayVerificationVersion: "execution/v1", replayEvidenceFingerprint: "b".repeat(64),
    },
    placement: buildAfcSr1OriginalBasisPlacement({
      schemaVersion: "afc-sr1-original-basis-placement/v1", status: "placed_on_original_basis",
      method: "already_original_basis", sourceEmptyBasis: basis, targetOriginalBasis: basis,
      compatibilityTier: "exact_grid_compatible", transferRecordFingerprint: "c".repeat(64),
    }),
    rawSourcePolygon: [{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }, { x: 0.7, y: 0.35 }, { x: 0.3, y: 0.35 }],
    overlayGenerationId: "execution-overlay", requestGenerationId: "execution-request",
  });
  return buildAfcSr1RequestPackage({
    packageGenerationId: "execution-package", semanticPriorBinding: binding,
    overlayDescriptor: buildAfcSr1OverlayDescriptor({
      originalTargetBasis: basis, rawSourcePolygon: binding.rawSourcePolygon, overlayGenerationId: binding.overlayGenerationId,
    }),
    originalBytes,
  });
}

const profile = Object.freeze({
  schemaVersion: "afc-sr1-provider-execution-profile/v1" as const,
  provider: "google_gemini" as const,
  adapterVersion: "afc-sr1-gemini-adapter/v1" as const,
  model: "gemini-3.5-flash",
  candidateCount: 1 as const, temperature: 0 as const, maxOutputTokens: 2048 as const,
  responseMimeType: "application/json" as const,
  thinkingPolicy: "minimal_for_gemini_3_5_flash_only/v1" as const,
  retryPolicy: "single_attempt/v1" as const,
});

function response(token: string, decision: "adjust_nr" | "abstain" | "unsupported_image_class" = "adjust_nr") {
  return {
    schemaVersion: "afc-sr1-semantic-prior-response/v1",
    bindingEcho: token, decision,
    rankedHypotheses: decision === "adjust_nr"
      ? [{ hypothesis: "NR", score: 0.7 }, { hypothesis: "none", score: 0.2 }, { hypothesis: "NL", score: 0.1 }]
      : null,
    seamTPrior: decision === "adjust_nr"
      ? { adjustableCorner: "NR", preferredSeamT: 0.5, minSeamT: 0.2, maxSeamT: 0.8 }
      : null,
    semanticLabels: ["back_wall_visible"],
  };
}

function providerEnvelope(value: unknown) {
  return JSON.stringify({
    modelVersion: "fixture-model-version", usageMetadata: { totalTokenCount: 24 },
    candidates: [{ index: 0, finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(value) }] } }],
  });
}

async function run(executor: ExecutorModule, body: string, status = 200) {
  const pack = await fixture();
  return executor.runAfcSr1SemanticPriorResearch({
    requestPackage: pack.requestPackage, evidenceBytes: pack.evidenceBytes, profile, apiKey: "test-key-not-to-record",
    executeLiveProviderCall: true,
    fetchImpl: async () => new Response(body, { status }),
  });
}

test("P2 executes one mock attempt, captures raw bytes, and preserves all valid P0 semantic outcomes", {
  skip: hasReactServerCondition ? false : REACT_SERVER_REQUIRED,
}, async () => {
  const executor = await import("./afc-sr1-provider-execution");
  const pack = await fixture();
  for (const [decision, expected] of [
    ["adjust_nr", "usable"], ["abstain", "safe_abstention"], ["unsupported_image_class", "unsupported"],
  ] as const) {
    const result = await executor.runAfcSr1SemanticPriorResearch({
      requestPackage: pack.requestPackage, evidenceBytes: pack.evidenceBytes, profile, apiKey: "test-key-not-to-record",
      executeLiveProviderCall: true,
      fetchImpl: async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.contents[0].parts.length, 2);
        assert.equal(payload.contents[0].parts[0].text, pack.requestPackage.artifact.prompt.promptText);
        assert.deepEqual(Buffer.from(payload.contents[0].parts[1].inlineData.data, "base64"), Buffer.from(pack.evidenceBytes.compositePngBytes));
        return new Response(providerEnvelope(response(pack.requestPackage.artifact.seamBindingToken, decision)));
      },
    });
    assert.equal(result.status, "validated_advisory");
    if (result.status === "validated_advisory") {
      assert.equal(result.advisory.status, expected);
      assert.match(result.receipt.receiptDigest, /^sr1exec1:[0-9a-f]{64}$/);
      assert.equal(result.receipt.rawBodySha256, result.rawEvidence.rawResponse.rawBodySha256);
    }
  }
});

test("P2 transport failures are classified and preserve non-2xx raw bodies", {
  skip: hasReactServerCondition ? false : REACT_SERVER_REQUIRED,
}, async () => {
  const executor = await import("./afc-sr1-provider-execution");
  for (const status of [400, 401, 429, 500]) {
    const result = await run(executor, `status-${status}`, status);
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.failure.class, "http_error");
      assert.equal(result.failure.httpStatus, status);
      assert.equal(Buffer.from(result.rawEvidence!.rawResponseBytes).toString(), `status-${status}`);
    }
  }
  const networkPack = await fixture();
  const network = await executor.runAfcSr1SemanticPriorResearch({
    requestPackage: networkPack.requestPackage, evidenceBytes: networkPack.evidenceBytes, profile,
    apiKey: "test-key-not-to-record", executeLiveProviderCall: true,
    fetchImpl: async () => { throw new Error("network unavailable"); },
  });
  assert.equal(network.status, "failed");
  if (network.status === "failed") assert.equal(network.failure.class, "network_error");
  const pack = await fixture();
  const timeout = await executor.runAfcSr1SemanticPriorResearch({
    requestPackage: pack.requestPackage, evidenceBytes: pack.evidenceBytes, profile,
    apiKey: "test-key-not-to-record", executeLiveProviderCall: true, timeoutMs: 1,
    fetchImpl: ((_, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as AfcSr1ProviderFetch,
  });
  assert.equal(timeout.status, "failed");
  if (timeout.status === "failed") assert.equal(timeout.failure.class, "timeout");
});

test("P2 re-enters P0 without repair for hard-invalid and stale answers", {
  skip: hasReactServerCondition ? false : REACT_SERVER_REQUIRED,
}, async () => {
  const executor = await import("./afc-sr1-provider-execution");
  const pack = await fixture();
  const token = pack.requestPackage.artifact.seamBindingToken;
  const cases: readonly [string, Record<string, unknown>, "hard_invalid" | "stale"][] = [
    ["wrong binding", { ...response(`sr1sbt1:${"0".repeat(64)}`) }, "stale"],
    ["geometry injection", { ...response(token), polygon: [] }, "hard_invalid"],
    ["bad score", { ...response(token), rankedHypotheses: [
      { hypothesis: "NR", score: 0.9 }, { hypothesis: "none", score: 0.2 }, { hypothesis: "NL", score: 0.1 },
    ] }, "hard_invalid"],
    ["rank conflict", { ...response(token), rankedHypotheses: [
      { hypothesis: "NL", score: 0.7 }, { hypothesis: "none", score: 0.2 }, { hypothesis: "NR", score: 0.1 },
    ] }, "hard_invalid"],
    ["invalid seamT", { ...response(token), seamTPrior: {
      adjustableCorner: "NR", preferredSeamT: 0.9, minSeamT: 0.2, maxSeamT: 0.8,
    } }, "hard_invalid"],
  ];
  for (const [name, modelResponse, expected] of cases) {
    const result = await run(executor, providerEnvelope(modelResponse));
    assert.equal(result.status, "failed", name);
    if (result.status === "failed") assert.equal(result.failure.class, expected, name);
  }
});

test("P2 source stays server-only and contains no key-bearing error or authority coupling", () => {
  const source = readFileSync(new URL("./afc-sr1-provider-execution.ts", import.meta.url), "utf8");
  assert.equal(source.includes('import "server-only"'), true);
  for (const forbidden of [
    "ThreeRoomLab", "AfcProposalOverlay", "afc-verified-floor-apply", "afc-verified-camera-apply",
    "CP2A", "CP2B", "perspective-solve", "ratio-fov-harness", "gemini-floor-proposal", "console.",
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});
