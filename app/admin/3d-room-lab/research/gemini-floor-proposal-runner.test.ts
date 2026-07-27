import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  digestAfcR3cCaptureBytes,
  writeAfcR3cImmutableCapture,
} from "./gemini-floor-proposal-capture";
import {
  GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
  deriveGeminiFloorBasisBinding,
} from "./gemini-floor-proposal-contract";
import { parseAfcR3cImageManifest } from "./gemini-floor-proposal-manifest";
import {
  buildAfcR3cGeminiRequestPayload,
  extractAfcR3cModelOutputText,
  resolveAfcR3cGenerationConfig,
} from "./gemini-floor-proposal-provider";
import { buildAfcR3cGeminiFloorProposalPrompt } from "./gemini-floor-proposal-prompt";
import { runAfcR3cGeminiFloorProposalStudy } from "./gemini-floor-proposal-runner";
import { runAfcR3cProposalRunnerCli } from "./gemini-floor-proposal-runner-cli";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64"
);
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function rawManifest(imagePath = "original.png", emptyImagePath = "empty.png") {
  const digest = sha(PIXEL);
  return {
    contractVersion: "afc-r3c-image-manifest/v1",
    roomId: "synthetic-room-a",
    original: { filePath: imagePath, sha256: digest, byteCount: PIXEL.byteLength, decodedWidth: 1, decodedHeight: 1, orientation: 1, mimeType: "image/png" },
    emptyRoomAssist: {
      filePath: emptyImagePath, sha256: digest, byteCount: PIXEL.byteLength, decodedWidth: 1, decodedHeight: 1, orientation: 1, mimeType: "image/png",
      generatedFromOriginalSha256: digest, generatorId: "synthetic-generator", generatorModelId: "synthetic-v1",
    },
    sharedComparisonContext: {
      ratioFovContractVersion: "ratio-fov-harness/v1",
      basisId: "synthetic-basis",
      basisFingerprint: digest,
      decoderId: "synthetic/v1",
      normalizationPolicyVersion: "source-normalized/v1",
      decodedWidth: 1,
      decodedHeight: 1,
      frameSize: { width: 1, height: 1 },
      orientationApplied: false,
      basisKind: "original",
      ratioDomain: { min: 1, max: 1, step: 0.1 },
      fovDomain: { minDeg: 45, maxDeg: 45, stepDeg: 1 },
      refinement: { enabled: false, ratioStep: 0.1, fovStepDeg: 1, basinFactor: 1, additivePxAllowance: 0 },
      referenceDepth: 1,
    },
  };
}

test("B2 manifest is closed and binds the original comparison basis", () => {
  const valid = parseAfcR3cImageManifest(rawManifest());
  assert.equal(valid.ok, true);
  const unknown = rawManifest() as Record<string, unknown>;
  unknown.unexpected = true;
  assert.equal(parseAfcR3cImageManifest(unknown).ok, false);
  const stale = rawManifest();
  stale.sharedComparisonContext.basisFingerprint = "a".repeat(64);
  assert.equal(parseAfcR3cImageManifest(stale).ok, false);
  const parent = rawManifest();
  parent.emptyRoomAssist.generatedFromOriginalSha256 = "b".repeat(64);
  assert.equal(parseAfcR3cImageManifest(parent).ok, false);
});

test("B2 provider payload remains one-image and strict extraction preserves exact authored text", () => {
  const prompt = buildAfcR3cGeminiFloorProposalPrompt({ imageRole: "original_contextual", basisBinding: "fixture-binding" });
  const payload = buildAfcR3cGeminiRequestPayload({
    prompt, imageBytes: PIXEL, mimeType: "image/png", generationConfig: resolveAfcR3cGenerationConfig("gemini-fixture"),
  }) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
  assert.equal(payload.contents.length, 1);
  assert.equal(payload.contents[0].parts.length, 2);
  assert.deepEqual((payload.contents[0].parts[1].inlineData as { data: string }).data, PIXEL.toString("base64"));
  const modelText = "\n{\"schema_version\":\"x\"}\n";
  const envelope = Buffer.from(JSON.stringify({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: modelText }] } }],
    modelVersion: "fixture-version",
    usageMetadata: { totalTokenCount: 3 },
  }), "utf8");
  const extracted = extractAfcR3cModelOutputText(envelope);
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.equal(extracted.modelOutputText, modelText);
  assert.equal(extracted.modelOutputTextSha256, sha(modelText));
  assert.notEqual(extracted.modelOutputTextSha256, sha(envelope));
  assert.equal(extractAfcR3cModelOutputText(Buffer.from(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }],
  }))).ok, false);
  assert.equal(extractAfcR3cModelOutputText(Buffer.from(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "a", functionCall: { name: "unsafe" } }] } }],
  }))).ok, false, "a mixed Gemini Part is not an unambiguous text part");
});

test("B2 runner captures exact envelope/text and binds R3B to model text", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-b2-"));
  try {
    await writeFile(path.join(dir, "original.png"), PIXEL);
    await writeFile(path.join(dir, "empty.png"), PIXEL);
    const parsed = parseAfcR3cImageManifest(rawManifest());
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const binding = deriveGeminiFloorBasisBinding(parsed.manifest.sharedComparisonContext, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY);
    const modelText = JSON.stringify({
      schema_version: "afc-r3-floor-hypotheses/v1",
      basis_binding: binding,
      status: "proposals",
      proposals: [{
        corners: {
          NL: { x: 0.1, y: 0.1, support: "direct_visible" },
          NR: { x: 0.9, y: 0.1, support: "direct_visible" },
          FR: { x: 0.9, y: 0.9, support: "direct_visible" },
          FL: { x: 0.1, y: 0.9, support: "direct_visible" },
        },
        edge_evidence: {
          near: { support: "direct_visible", note: "near" },
          right: { support: "direct_visible", note: "right" },
          far: { support: "direct_visible", note: "far" },
          left: { support: "direct_visible", note: "left" },
        },
      }],
    });
    const envelope = Buffer.from(` \n${JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: modelText }] } }],
      modelVersion: "fixture-model-version",
      usageMetadata: { totalTokenCount: 12 },
    })}\n`, "utf8");
    const seenBodies: unknown[] = [];
    const result = await runAfcR3cGeminiFloorProposalStudy({
      manifest: parsed.manifest, manifestDirectory: dir, studyMode: "parallel_union",
      outputDir: path.join(dir, "captures"), apiKey: "test-key", model: "gemini-fixture",
      executeLiveProviderCall: true, repositoryRoot: process.cwd(),
      requestIdPrefix: "trial-001",
      fetchImpl: async (_url, init) => {
        seenBodies.push(JSON.parse(String(init.body)));
        return new Response(envelope, { status: 200 });
      },
    });
    assert.equal(result.status, "success");
    assert.equal(seenBodies.length, 2, "parallel calls happen only after preflight");
    assert.equal(result.composition?.status, "proposals");
    for (const arm of result.arms) {
      assert.equal(arm.r3bResult?.auditProvenance.rawResponseSha256, sha(modelText));
      assert.notEqual(arm.r3bResult?.auditProvenance.rawResponseSha256, sha(envelope));
      assert.deepEqual(await readFile(arm.providerEnvelopePath!), envelope);
      assert.equal((await readFile(arm.modelOutputPath!)).toString("utf8"), modelText);
      const receipt = (await readFile(arm.receiptPath!, "utf8"));
      assert.equal(receipt.includes("test-key"), false);
      assert.equal(receipt.includes(PIXEL.toString("base64")), false);
    }
    const firstBody = seenBodies[0] as { contents: Array<{ parts: Array<{ inlineData?: { data: string } }> }> };
    assert.equal(firstBody.contents[0].parts[1].inlineData?.data, PIXEL.toString("base64"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("B2 immutable capture reuses exact bytes and fails closed on mismatch", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-capture-"));
  try {
    const first = await writeAfcR3cImmutableCapture({ outputDir: dir, filename: "provider-envelope.fixture.json", bytes: Buffer.from("a") });
    const second = await writeAfcR3cImmutableCapture({ outputDir: dir, filename: "provider-envelope.fixture.json", bytes: Buffer.from("a") });
    const mismatch = await writeAfcR3cImmutableCapture({ outputDir: dir, filename: "provider-envelope.fixture.json", bytes: Buffer.from("b") });
    assert.equal(first.ok, true);
    assert.equal(second.ok && second.reused, true);
    assert.equal(mismatch.ok, false);
    assert.equal(digestAfcR3cCaptureBytes(Buffer.from("a")), sha("a"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("B2 validate-only CLI cannot invoke provider or write captures", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-cli-"));
  try {
    await writeFile(path.join(dir, "original.png"), PIXEL);
    await writeFile(path.join(dir, "empty.png"), PIXEL);
    const manifestPath = path.join(dir, "room.manifest.json");
    const output = path.join(dir, "captures");
    await writeFile(manifestPath, JSON.stringify(rawManifest()));
    const exitCode = await runAfcR3cProposalRunnerCli([
      "--manifest", manifestPath, "--output-dir", output, "--study-mode", "original_only",
      "--model", "gemini-fixture", "--validate-only",
    ]);
    assert.equal(exitCode, 0);
    await assert.rejects(stat(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("B2 CLI requires an explicit live-call acknowledgement", async () => {
  const exitCode = await runAfcR3cProposalRunnerCli([
    "--manifest", "/nonexistent/room.manifest.json",
    "--output-dir", "/tmp/afc-r3c-captures",
    "--study-mode", "original_only",
    "--model", "gemini-fixture",
  ]);
  assert.equal(exitCode, 2);
});

test("B2 exported runner also enforces the live-call acknowledgement", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-runner-gate-"));
  try {
    await writeFile(path.join(dir, "original.png"), PIXEL);
    await writeFile(path.join(dir, "empty.png"), PIXEL);
    const parsed = parseAfcR3cImageManifest(rawManifest());
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    let calls = 0;
    const result = await runAfcR3cGeminiFloorProposalStudy({
      manifest: parsed.manifest, manifestDirectory: dir, studyMode: "original_only",
      outputDir: path.join(dir, "captures"), apiKey: "test-key", model: "gemini-fixture",
      executeLiveProviderCall: false, repositoryRoot: process.cwd(),
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      },
    } as unknown as Parameters<typeof runAfcR3cGeminiFloorProposalStudy>[0]);
    assert.equal(result.failureCode, "invalid_arguments");
    assert.equal(calls, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("C2 rejects invalid trusted context before provider calls or output preflight", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-context-order-"));
  try {
    await writeFile(path.join(dir, "original.png"), PIXEL);
    const parsed = parseAfcR3cImageManifest(rawManifest());
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const malformed = structuredClone(parsed.manifest) as Record<string, unknown>;
    malformed.sharedComparisonContext = { basisId: "x" };
    let providerCalls = 0;
    let captureWrites = 0;
    const outputDir = path.join(dir, "must-not-exist");
    const result = await runAfcR3cGeminiFloorProposalStudy({
      manifest: malformed,
      manifestDirectory: dir,
      studyMode: "original_only",
      outputDir,
      apiKey: "test-key",
      model: "gemini-fixture",
      executeLiveProviderCall: true,
      repositoryRoot: process.cwd(),
      fetchImpl: async () => {
        providerCalls += 1;
        return new Response("{}");
      },
      captureWriter: async () => {
        captureWrites += 1;
        return { ok: true, filePath: path.join(outputDir, "unexpected"), reused: false };
      },
    } as unknown as Parameters<typeof runAfcR3cGeminiFloorProposalStudy>[0]);
    assert.equal(result.failureCode, "comparison_context_invalid");
    assert.equal(providerCalls, 0);
    assert.equal(captureWrites, 0);
    await assert.rejects(stat(outputDir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
