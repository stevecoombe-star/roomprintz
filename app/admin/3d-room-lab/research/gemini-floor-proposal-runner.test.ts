import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  digestAfcR3cCaptureBytes,
  writeAfcR3cImmutableCapture,
} from "./gemini-floor-proposal-capture";
import {
  GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
  deriveGeminiFloorBasisBinding,
} from "./gemini-floor-proposal-contract";
import { parseAfcR3cImageManifest, type AfcR3cImageManifestV1 } from "./gemini-floor-proposal-manifest";
import { replayAfcProposalOverlay } from "./afc-proposal-overlay-view-model";
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

async function roomBLikeManifest(directory: string) {
  const originalBytes = await sharp({
    create: { width: 5000, height: 3333, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).jpeg().toBuffer();
  const emptyBytes = await sharp({
    create: { width: 1264, height: 848, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer();
  await Promise.all([
    writeFile(path.join(directory, "original.jpg"), originalBytes),
    writeFile(path.join(directory, "empty.png"), emptyBytes),
  ]);
  const originalSha = sha(originalBytes);
  const emptySha = sha(emptyBytes);
  return {
    contractVersion: "afc-r3c-image-manifest/v1",
    roomId: "synthetic-room-b",
    original: {
      filePath: "original.jpg", sha256: originalSha, byteCount: originalBytes.byteLength,
      decodedWidth: 5000, decodedHeight: 3333, orientation: 1, mimeType: "image/jpeg",
    },
    emptyRoomAssist: {
      filePath: "empty.png", sha256: emptySha, byteCount: emptyBytes.byteLength,
      decodedWidth: 1264, decodedHeight: 848, orientation: 1, mimeType: "image/png",
      generatedFromOriginalSha256: originalSha, generatorId: "synthetic-generator", generatorModelId: "synthetic-v1",
    },
    sharedComparisonContext: {
      ratioFovContractVersion: "ratio-fov-harness/v1",
      basisId: "synthetic-room-b-original-source-normalized-v1",
      basisFingerprint: originalSha,
      decoderId: "synthetic/v1",
      normalizationPolicyVersion: "source-normalized/v1",
      decodedWidth: 5000,
      decodedHeight: 3333,
      frameSize: { width: 5000, height: 3333 },
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

test("original_only binds manifest-pair compatibility while preserving exact original-arm transfer", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-room-b-like-"));
  try {
    const raw = await roomBLikeManifest(dir);
    const parsed = parseAfcR3cImageManifest(raw);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const binding = deriveGeminiFloorBasisBinding(parsed.manifest.sharedComparisonContext, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY);
    const modelText = JSON.stringify({
      schema_version: "afc-r3-floor-hypotheses/v1", basis_binding: binding, status: "proposals",
      proposals: [{
        corners: {
          NL: { x: 0.1, y: 0.1, support: "direct_visible" }, NR: { x: 0.9, y: 0.1, support: "direct_visible" },
          FR: { x: 0.9, y: 0.9, support: "direct_visible" }, FL: { x: 0.1, y: 0.9, support: "direct_visible" },
        },
        edge_evidence: {
          near: { support: "direct_visible", note: "near" }, right: { support: "direct_visible", note: "right" },
          far: { support: "direct_visible", note: "far" }, left: { support: "direct_visible", note: "left" },
        },
      }],
    });
    const envelope = Buffer.from(JSON.stringify({
      candidates: [{ finishReason: "STOP", index: 0, content: { role: "model", parts: [{ text: modelText }] } }],
      modelVersion: "fixture-model-version",
      usageMetadata: {
        promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2,
        promptTokensDetails: [{ modality: "IMAGE", tokenCount: 1 }, { modality: "TEXT", tokenCount: 0 }],
        serviceTier: "standard",
      },
    }));
    let providerCalls = 0;
    let providerImage = "";
    const result = await runAfcR3cGeminiFloorProposalStudy({
      manifest: parsed.manifest, manifestDirectory: dir, studyMode: "original_only",
      outputDir: path.join(dir, "captures"), apiKey: "test-key", model: "gemini-fixture",
      executeLiveProviderCall: true, repositoryRoot: process.cwd(),
      fetchImpl: async (_url, init) => {
        providerCalls++;
        providerImage = JSON.parse(String(init.body)).contents[0].parts[1].inlineData.data;
        return new Response(envelope, { status: 200 });
      },
    });
    assert.equal(result.status, "success");
    assert.equal(providerCalls, 1);
    assert.equal(providerImage, (await readFile(path.join(dir, "original.jpg"))).toString("base64"));
    const arm = result.arms[0];
    const receipt = JSON.parse(await readFile(arm.receiptPath!, "utf8"));
    assert.deepEqual(receipt.compatibility, {
      tier: "aspect_compatible_rescaled",
      relativeAspectErrorRaw: 0.0063886792452830824,
      relativeAspectError: 0.0064,
    });
    assert.equal(arm.proposalRun?.transfer.compatibilityTier, "exact_grid_compatible");
    assert.equal(arm.proposalRun?.provenance.compatibilityTier, "exact_grid_compatible");
    const fixedRoot = path.join(dir, "fixed-inputs");
    const fixedRoomRoot = path.join(fixedRoot, raw.roomId);
    await mkdir(fixedRoomRoot, { recursive: true });
    await Promise.all([
      writeFile(path.join(fixedRoomRoot, "original.jpg"), await readFile(path.join(dir, "original.jpg"))),
      writeFile(path.join(fixedRoomRoot, "empty.png"), await readFile(path.join(dir, "empty.png"))),
      writeFile(path.join(fixedRoomRoot, `afc-r3c-${raw.roomId}.image-manifest.v1.json`), JSON.stringify(raw)),
    ]);
    const replay = await replayAfcProposalOverlay({
      receiptFileName: path.basename(arm.receiptPath!),
      captureRoot: path.join(dir, "captures"),
      fixedInputsRoot: fixedRoot,
      resolveFixedInputsRoot: async () => realpath(fixedRoot),
    });
    assert.equal(replay.status, "valid", replay.status === "valid" ? "" : `${replay.reason} (${replay.path})`);
    receipt.compatibility = { tier: "exact_grid_compatible", relativeAspectErrorRaw: 0, relativeAspectError: 0 };
    await writeFile(arm.receiptPath!, JSON.stringify(receipt));
    const invalidReplay = await replayAfcProposalOverlay({
      receiptFileName: path.basename(arm.receiptPath!),
      captureRoot: path.join(dir, "captures"),
      fixedInputsRoot: fixedRoot,
      resolveFixedInputsRoot: async () => realpath(fixedRoot),
    });
    assert.equal(invalidReplay.status, "basis_mismatch");
    if (invalidReplay.status === "basis_mismatch") assert.equal(invalidReplay.path, "$.compatibility");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty_only and parallel_union retain manifest-pair receipts with per-arm compatibility", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-room-b-modes-"));
  try {
    const raw = await roomBLikeManifest(dir);
    const parsed = parseAfcR3cImageManifest(raw);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const binding = deriveGeminiFloorBasisBinding(parsed.manifest.sharedComparisonContext, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY);
    const modelText = JSON.stringify({
      schema_version: "afc-r3-floor-hypotheses/v1", basis_binding: binding, status: "proposals",
      proposals: [{
        corners: {
          NL: { x: 0.1, y: 0.1, support: "direct_visible" }, NR: { x: 0.9, y: 0.1, support: "direct_visible" },
          FR: { x: 0.9, y: 0.9, support: "direct_visible" }, FL: { x: 0.1, y: 0.9, support: "direct_visible" },
        },
        edge_evidence: {
          near: { support: "direct_visible", note: "near" }, right: { support: "direct_visible", note: "right" },
          far: { support: "direct_visible", note: "far" }, left: { support: "direct_visible", note: "left" },
        },
      }],
    });
    const envelope = Buffer.from(JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: modelText }] } }],
      modelVersion: "fixture-model-version", usageMetadata: { totalTokenCount: 12 },
    }));
    const execute = async (studyMode: "empty_only" | "parallel_union") => {
      const inputs: string[] = [];
      const result = await runAfcR3cGeminiFloorProposalStudy({
        manifest: parsed.manifest, manifestDirectory: dir, studyMode,
        outputDir: path.join(dir, `captures-${studyMode}`), apiKey: "test-key", model: "gemini-fixture",
        executeLiveProviderCall: true, repositoryRoot: process.cwd(),
        fetchImpl: async (_url, init) => {
          inputs.push(JSON.parse(String(init.body)).contents[0].parts[1].inlineData.data);
          return new Response(envelope, { status: 200 });
        },
      });
      assert.equal(result.status, "success");
      return { result, inputs };
    };
    const emptyOnly = await execute("empty_only");
    assert.deepEqual(emptyOnly.inputs, [(await readFile(path.join(dir, "empty.png"))).toString("base64")]);
    assert.equal(JSON.parse(await readFile(emptyOnly.result.arms[0].receiptPath!, "utf8")).compatibility.tier, "aspect_compatible_rescaled");
    assert.equal(emptyOnly.result.arms[0].proposalRun?.transfer.compatibilityTier, "aspect_compatible_rescaled");
    assert.equal(emptyOnly.result.arms[0].proposalRun?.provenance.compatibilityTier, "aspect_compatible_rescaled");

    const parallel = await execute("parallel_union");
    assert.equal(parallel.inputs.length, 2);
    assert.equal(parallel.result.composition?.status, "proposals");
    assert.deepEqual(
      await Promise.all(parallel.result.arms.map(async (arm) => JSON.parse(await readFile(arm.receiptPath!, "utf8")).compatibility)),
      [
        { tier: "aspect_compatible_rescaled", relativeAspectErrorRaw: 0.0063886792452830824, relativeAspectError: 0.0064 },
        { tier: "aspect_compatible_rescaled", relativeAspectErrorRaw: 0.0063886792452830824, relativeAspectError: 0.0064 },
      ],
    );
    const emptyArm = parallel.result.arms.find((arm) => arm.role === "empty_room_boundary_specialist");
    const originalArm = parallel.result.arms.find((arm) => arm.role === "original_contextual");
    assert.equal(emptyArm?.proposalRun?.transfer.compatibilityTier, "aspect_compatible_rescaled");
    assert.equal(emptyArm?.proposalRun?.provenance.compatibilityTier, "aspect_compatible_rescaled");
    assert.equal(originalArm?.proposalRun?.transfer.compatibilityTier, "exact_grid_compatible");
    assert.equal(originalArm?.proposalRun?.provenance.compatibilityTier, "exact_grid_compatible");
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

test("B2 validate-only reports manifest-pair compatibility for original_only and rejects a missing Empty", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-cli-room-b-like-"));
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  try {
    const raw = await roomBLikeManifest(dir);
    const manifestPath = path.join(dir, "room.manifest.json");
    await writeFile(manifestPath, JSON.stringify(raw));
    console.log = (...values: unknown[]) => lines.push(values.join(" "));
    console.error = () => undefined;
    const output = path.join(dir, "captures");
    assert.equal(await runAfcR3cProposalRunnerCli([
      "--manifest", manifestPath, "--output-dir", output, "--study-mode", "original_only",
      "--model", "gemini-fixture", "--validate-only",
    ]), 0);
    const validated = JSON.parse(lines.find((line) => line.startsWith("{")) ?? "{}");
    assert.deepEqual(
      {
        tier: validated.compatibilityTier,
        raw: validated.relativeAspectErrorRaw,
        reported: validated.relativeAspectError,
        providerCall: validated.providerCall,
        captureWritten: validated.captureWritten,
      },
      { tier: "aspect_compatible_rescaled", raw: 0.0063886792452830824, reported: 0.0064, providerCall: false, captureWritten: false },
    );
    await rm(path.join(dir, "empty.png"));
    assert.equal(await runAfcR3cProposalRunnerCli([
      "--manifest", manifestPath, "--output-dir", output, "--study-mode", "original_only",
      "--model", "gemini-fixture", "--validate-only",
    ]), 4);
    await assert.rejects(stat(output));
  } finally {
    console.log = originalLog;
    console.error = originalError;
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
    await writeFile(path.join(dir, "empty.png"), PIXEL);
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

test("original_only fails closed when any manifest Empty verification fails", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-empty-preflight-"));
  try {
    await writeFile(path.join(dir, "original.png"), PIXEL);
    await writeFile(path.join(dir, "empty.png"), PIXEL);
    const cases: Array<{
      name: string;
      update: (manifest: ReturnType<typeof rawManifest>) => void;
      expected: string;
    }> = [
      { name: "missing", update: (manifest) => { manifest.emptyRoomAssist.filePath = "missing.png"; }, expected: "image_read_failed" },
      { name: "sha", update: (manifest) => { manifest.emptyRoomAssist.sha256 = "a".repeat(64); }, expected: "image_hash_mismatch" },
      { name: "byte count", update: (manifest) => { manifest.emptyRoomAssist.byteCount += 1; }, expected: "image_byte_count_mismatch" },
      { name: "MIME", update: (manifest) => { manifest.emptyRoomAssist.mimeType = "image/jpeg"; }, expected: "image_mime_mismatch" },
      { name: "dimensions", update: (manifest) => { manifest.emptyRoomAssist.decodedWidth = 2; }, expected: "image_metadata_mismatch" },
      { name: "orientation", update: (manifest) => { manifest.emptyRoomAssist.orientation = 2; }, expected: "image_metadata_mismatch" },
    ];
    for (const item of cases) {
      const manifest = structuredClone(rawManifest());
      item.update(manifest);
      let providerCalls = 0;
      let captureWrites = 0;
      const result = await runAfcR3cGeminiFloorProposalStudy({
        manifest: manifest as unknown as AfcR3cImageManifestV1,
        manifestDirectory: dir,
        studyMode: "original_only",
        outputDir: path.join(dir, `captures-${item.name}`),
        apiKey: "test-key",
        model: "gemini-fixture",
        executeLiveProviderCall: true,
        repositoryRoot: process.cwd(),
        fetchImpl: async () => {
          providerCalls++;
          return new Response("{}");
        },
        captureWriter: async () => {
          captureWrites++;
          return { ok: true, filePath: path.join(dir, "unexpected"), reused: false };
        },
      });
      assert.equal(result.failureCode, item.expected, item.name);
      assert.equal(providerCalls, 0, item.name);
      assert.equal(captureWrites, 0, item.name);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
