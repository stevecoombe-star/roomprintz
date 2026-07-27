/**
 * AFC-R3C-B2 offline completion matrix. Every transport is injected and the
 * process-global fetch trap makes accidental network use fail immediately.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareAfcR3cCaptureDirectory,
  receiptFilename,
  sanitizeAfcR3cCaptureToken,
  writeAfcR3cImmutableCapture,
} from "./gemini-floor-proposal-capture";
import {
  GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
  deriveGeminiFloorBasisBinding,
} from "./gemini-floor-proposal-contract";
import { parseAfcR3cImageManifest } from "./gemini-floor-proposal-manifest";
import {
  buildAfcR3cGeminiEndpoint,
  buildAfcR3cGeminiRequestPayload,
  callAfcR3cGeminiProvider,
  extractAfcR3cModelOutputText,
  resolveAfcR3cGenerationConfig,
} from "./gemini-floor-proposal-provider";
import { buildAfcR3cGeminiFloorProposalPrompt } from "./gemini-floor-proposal-prompt";
import {
  runAfcR3cGeminiFloorProposalStudy,
  verifyAfcR3cManifestImage,
} from "./gemini-floor-proposal-runner";
import { runAfcR3cProposalRunnerCli } from "./gemini-floor-proposal-runner-cli";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64"
);
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const originalFetch = globalThis.fetch;
type ProviderPayload = {
  contents: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
  generationConfig: Record<string, unknown>;
};
// No test may make an un-injected network request.
globalThis.fetch = async () => {
  throw new Error("B2 offline test blocked an un-injected network request.");
};
test.after(() => { globalThis.fetch = originalFetch; });

function manifestRaw(imagePath = "original.png") {
  const digest = sha(PIXEL);
  return {
    contractVersion: "afc-r3c-image-manifest/v1",
    roomId: "synthetic-room-a",
    original: { filePath: imagePath, sha256: digest, byteCount: PIXEL.byteLength, decodedWidth: 1, decodedHeight: 1, orientation: 1, mimeType: "image/png" },
    emptyRoomAssist: {
      filePath: "empty.png", sha256: digest, byteCount: PIXEL.byteLength, decodedWidth: 1, decodedHeight: 1, orientation: 1, mimeType: "image/png",
      generatedFromOriginalSha256: digest, generatorId: "synthetic-generator", generatorModelId: "synthetic-v1",
    },
    sharedComparisonContext: {
      ratioFovContractVersion: "ratio-fov-harness/v1",
      basisId: "synthetic-basis",
      basisFingerprint: digest,
      decoderId: "synthetic/v1",
      normalizationPolicyVersion: "source-normalized/v1",
      decodedWidth: 1, decodedHeight: 1, frameSize: { width: 1, height: 1 },
      orientationApplied: false, basisKind: "original",
      ratioDomain: { min: 1, max: 1, step: 0.1 },
      fovDomain: { minDeg: 45, maxDeg: 45, stepDeg: 1 },
      refinement: { enabled: false, ratioStep: 0.1, fovStepDeg: 1, basinFactor: 1, additivePxAllowance: 0 },
      referenceDepth: 1,
    },
  };
}

function manifest() {
  const parsed = parseAfcR3cImageManifest(manifestRaw());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("fixture manifest must parse");
  return parsed.manifest;
}

function proposalText(input: ReturnType<typeof manifest>, x = 0.1): string {
  return JSON.stringify({
    schema_version: "afc-r3-floor-hypotheses/v1",
    basis_binding: deriveGeminiFloorBasisBinding(input.sharedComparisonContext, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY),
    status: "proposals",
    proposals: [{
      corners: {
        NL: { x, y: 0.1, support: "direct_visible" }, NR: { x: 0.9, y: 0.1, support: "direct_visible" },
        FR: { x: 0.9, y: 0.9, support: "direct_visible" }, FL: { x, y: 0.9, support: "direct_visible" },
      },
      edge_evidence: {
        near: { support: "direct_visible", note: "near" }, right: { support: "direct_visible", note: "right" },
        far: { support: "direct_visible", note: "far" }, left: { support: "direct_visible", note: "left" },
      },
    }],
  });
}

function insufficientText(input: ReturnType<typeof manifest>): string {
  return JSON.stringify({
    schema_version: "afc-r3-floor-hypotheses/v1",
    basis_binding: deriveGeminiFloorBasisBinding(input.sharedComparisonContext, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY),
    status: "insufficient_evidence", reason_code: "boundary_evidence_insufficient", note: "insufficient fixture",
  });
}

function envelope(text: string, extra: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
    modelVersion: "fixture-model-version", usageMetadata: { totalTokenCount: 12 }, ...extra,
  }), "utf8");
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-b2-completion-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function writeImage(dir: string) {
  await writeFile(path.join(dir, "original.png"), PIXEL);
  await writeFile(path.join(dir, "empty.png"), PIXEL);
}

function fakeQueue(bytes: readonly Buffer[], calls: unknown[]) {
  let index = 0;
  return async (_url: string, init: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(String(init.body)));
    return new Response(bytes[index++].toString("utf8"), { status: 200 });
  };
}

test("A manifest closed-validation matrix (cases 1–12)", () => {
  assert.equal(parseAfcR3cImageManifest(manifestRaw()).ok, true, "1 valid");
  const rows: Array<[string, (value: ReturnType<typeof manifestRaw>) => void]> = [
    ["2 unknown top level", (v) => { (v as Record<string, unknown>).unknown = true; }],
    ["3 unknown nested", (v) => { (v.original as Record<string, unknown>).unknown = true; }],
    ["4 version", (v) => { v.contractVersion = "bad"; }],
    ["5 room id", (v) => { v.roomId = "../escape"; }],
    ["6 sha", (v) => { v.original.sha256 = "A".repeat(64); }],
    ["7 dimensions", (v) => { v.original.decodedWidth = 0; }],
    ["8 MIME", (v) => { v.original.mimeType = "image/gif" as "image/png"; }],
    ["9 parent SHA", (v) => { v.emptyRoomAssist.generatedFromOriginalSha256 = "a".repeat(64); }],
    ["10 basis SHA", (v) => { v.sharedComparisonContext.basisFingerprint = "a".repeat(64); }],
    ["11 basis dimensions", (v) => { v.sharedComparisonContext.decodedWidth = 2; }],
    ["12 basis kind", (v) => { v.sharedComparisonContext.basisKind = "derivative" as "original"; }],
    ["12 normalization", (v) => { v.sharedComparisonContext.normalizationPolicyVersion = "bad" as "source-normalized/v1"; }],
    ["12 orientation", (v) => { v.sharedComparisonContext.orientationApplied = true as false; }],
    ["12 depth", (v) => { v.sharedComparisonContext.referenceDepth = 2 as 1; }],
    ["12 ratio", (v) => { v.sharedComparisonContext.ratioDomain.step = 0; }],
    ["12 fov", (v) => { v.sharedComparisonContext.fovDomain.maxDeg = 91; }],
    ["12 refinement", (v) => { v.sharedComparisonContext.refinement.basinFactor = 0; }],
  ];
  for (const [name, mutate] of rows) {
    const value = structuredClone(manifestRaw());
    mutate(value);
    assert.equal(parseAfcR3cImageManifest(value).ok, false, name);
  }
});

test("B exact-byte image verification matrix (cases 13–21)", async () => withTemp(async (dir) => {
  await writeImage(dir);
  const input = manifest();
  const success = await verifyAfcR3cManifestImage({ descriptor: input.original, manifestDirectory: dir });
  assert.equal(success.ok, true, "13 exact bytes");
  if (!success.ok) return;
  assert.equal(success.image.bytes.equals(PIXEL), true, "20/21 unchanged bytes");
  const rows: Array<[string, Partial<typeof input.original>, number | undefined, string]> = [
    ["14 hash", { sha256: "a".repeat(64) }, undefined, "image_hash_mismatch"],
    ["14 byte count", { byteCount: PIXEL.byteLength + 1 }, undefined, "image_byte_count_mismatch"],
    ["15 width", { decodedWidth: 2 }, undefined, "image_metadata_mismatch"],
    ["16 height", { decodedHeight: 2 }, undefined, "image_metadata_mismatch"],
    ["17 orientation", { orientation: 2 }, undefined, "image_metadata_mismatch"],
    ["18 MIME", { mimeType: "image/jpeg" }, undefined, "image_mime_mismatch"],
    ["19 oversized", {}, 1, "image_oversized"],
  ];
  for (const [name, override, maxBytes, code] of rows) {
    const result = await verifyAfcR3cManifestImage({
      descriptor: { ...input.original, ...override }, manifestDirectory: dir, maxBytes,
    });
    assert.equal(result.ok ? "ok" : result.code, code, name);
  }
}));

test("B2 runtime image verification rejects symlinks and containment escapes before admission", async () => withTemp(async (dir) => {
  await writeImage(dir);
  const input = manifest();
  const linkedPath = path.join(dir, "linked.png");
  await symlink("original.png", linkedPath);
  const linked = await verifyAfcR3cManifestImage({
    descriptor: { ...input.original, filePath: "linked.png" },
    manifestDirectory: dir,
  });
  assert.equal(linked.ok ? "ok" : linked.code, "image_read_failed");

  const outsidePath = path.join(path.dirname(dir), "afc-r3c-outside.png");
  const outputDir = path.join(dir, "must-not-exist");
  try {
    await writeFile(outsidePath, PIXEL);
    const escaped = await verifyAfcR3cManifestImage({
      descriptor: { ...input.original, filePath: "../afc-r3c-outside.png" },
      manifestDirectory: dir,
    });
    assert.equal(escaped.ok ? "ok" : escaped.code, "image_read_failed");
    if (!escaped.ok) assert.equal(escaped.reason, "Local image path is outside the manifest directory.");
    await assert.rejects(stat(outputDir));
  } finally {
    await rm(outsidePath, { force: true });
  }
}));

test("C request payload and transport matrix (cases 23–38)", async () => {
  const prompt = buildAfcR3cGeminiFloorProposalPrompt({ imageRole: "empty_room_boundary_specialist", basisBinding: "fixture-binding" });
  const config = resolveAfcR3cGenerationConfig("gemini-3.5-flash");
  const payload = buildAfcR3cGeminiRequestPayload({ prompt, imageBytes: PIXEL, mimeType: "image/png", generationConfig: config }) as unknown as ProviderPayload;
  assert.equal(payload.contents.length, 1, "23");
  assert.equal(payload.contents[0].parts.length, 2, "24/25");
  assert.equal(payload.contents[0].parts[0].text, prompt.promptText, "28");
  assert.deepEqual(Buffer.from(payload.contents[0].parts[1].inlineData!.data, "base64"), PIXEL, "26");
  assert.equal(payload.contents[0].parts[1].inlineData!.mimeType, "image/png", "27");
  assert.equal(payload.generationConfig.responseSchema !== undefined, true, "30");
  assert.deepEqual(payload.generationConfig.thinkingConfig, { thinkingLevel: "minimal" }, "32/33");
  assert.equal("AUTO_FLOOR_VISION_RESPONSE_SCHEMA" in payload, false, "34/35");
  assert.equal(buildAfcR3cGeminiEndpoint("models/gemini-3.5-flash", "secret").includes("models%2Fgemini-3.5-flash"), true, "31");
  const unsupported = buildAfcR3cGeminiRequestPayload({
    prompt, imageBytes: PIXEL, mimeType: "image/png", generationConfig: resolveAfcR3cGenerationConfig("gemini-fixture"),
  }) as unknown as ProviderPayload;
  assert.equal("thinkingConfig" in unsupported.generationConfig, false, "33 unsupported omission");
  const timeout = await callAfcR3cGeminiProvider({
    apiKey: "secret", model: "gemini-fixture", prompt, imageBytes: PIXEL, mimeType: "image/png", timeoutMs: 1,
    fetchImpl: async () => { throw new DOMException("aborted", "AbortError"); },
  });
  assert.equal(timeout.ok ? "ok" : timeout.failure.kind, "timeout", "37");
  assert.equal(JSON.stringify(timeout).includes("secret"), false, "38");
  const rawEnvelope = Buffer.from(' \n{"candidates":[]}\n', "utf8");
  const captured = await callAfcR3cGeminiProvider({
    apiKey: "secret", model: "gemini-fixture", prompt, imageBytes: PIXEL, mimeType: "image/png", timeoutMs: 10,
    fetchImpl: async () => new Response(rawEnvelope.toString("utf8"), { status: 200 }),
  });
  assert.equal(captured.ok, true, "39 exact response capture");
  if (captured.ok) {
    assert.equal(captured.response.providerEnvelopeSha256, sha(rawEnvelope), "39");
    assert.deepEqual(captured.response.envelopeBytes, rawEnvelope, "39");
  }
  const [providerSource, runnerSource] = await Promise.all([
    readFile(new URL("./gemini-floor-proposal-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("./gemini-floor-proposal-runner.ts", import.meta.url), "utf8"),
  ]);
  for (const forbidden of ["vibodeAutoFloorVisionDetect", "AUTO_FLOOR_VISION_RESPONSE_SCHEMA", "mapSourceNormalizedRawVisionResponseToDetectionResult"]) {
    assert.equal(`${providerSource}\n${runnerSource}`.includes(forbidden), false, `34–36 ${forbidden}`);
  }
});

test("D exact envelope and strict extraction matrix (cases 39–61)", () => {
  const text = " {\"x\":1} ";
  const first = envelope(text);
  const second = Buffer.from(` ${first.toString("utf8")}\n`, "utf8");
  assert.notEqual(sha(first), sha(second), "39/40");
  const good = extractAfcR3cModelOutputText(first);
  assert.equal(good.ok, true, "42");
  if (good.ok) {
    assert.equal(good.finishReason, "STOP", "58");
    assert.deepEqual(good.usageMetadata, { totalTokenCount: 12 }, "59");
    assert.equal(good.providerModelVersion, "fixture-model-version", "60");
  }
  const failures: Array<[string, unknown]> = [
    ["43 missing candidates", {}],
    ["44 empty candidates", { candidates: [] }],
    ["45 many candidates", { candidates: [{ content: { parts: [{ text: "x" }] } }, { content: { parts: [{ text: "x" }] } }] }],
    ["46 content", { candidates: [{}] }],
    ["47 parts", { candidates: [{ content: {} }] }],
    ["48 zero parts", { candidates: [{ content: { parts: [] } }] }],
    ["49 multi parts", { candidates: [{ content: { parts: [{ text: "x" }, { text: "y" }] } }] }],
    ["50 function call", { candidates: [{ content: { parts: [{ text: "x", functionCall: {} }] } }] }],
    ["51 other payload", { candidates: [{ content: { parts: [{ text: "x", inlineData: {} }] } }] }],
    ["52 non-string", { candidates: [{ content: { parts: [{ text: 1 }] } }] }],
    ["53 empty", { candidates: [{ content: { parts: [{ text: "" }] } }] }],
    ["54 whitespace", { candidates: [{ content: { parts: [{ text: " \t" }] } }] }],
    ["55 non-text", { candidates: [{ content: { parts: [{ functionCall: {} }] } }] }],
    ["56 blocked", { promptFeedback: { blockReason: "SAFETY" }, candidates: [] }],
  ];
  for (const [name, value] of failures) assert.equal(extractAfcR3cModelOutputText(Buffer.from(JSON.stringify(value))).ok, false, name);
  const unknown = extractAfcR3cModelOutputText(Buffer.from(JSON.stringify({
    unknown: { ignored: true }, candidates: [{ content: { parts: [{ text: "x" }] } }],
  })));
  assert.equal(unknown.ok, true, "61 unknown envelope data ignored");
});

test("E model-output digest and R3B binding matrix (cases 62–72)", async () => withTemp(async (dir) => {
  await writeImage(dir);
  const input = manifest();
  const text = ` \n${proposalText(input)}\n `;
  const bytes = envelope(text);
  const result = await runAfcR3cGeminiFloorProposalStudy({
    manifest: input, manifestDirectory: dir, studyMode: "original_only", outputDir: path.join(dir, "out"),
    apiKey: "secret", model: "gemini-fixture", executeLiveProviderCall: true, repositoryRoot: process.cwd(),
    fetchImpl: fakeQueue([bytes], []),
  });
  const arm = result.arms[0];
  assert.equal(arm.r3bResult?.status, "proposals", "68");
  assert.equal(arm.r3bResult?.auditProvenance.rawResponseSha256, sha(text), "62/63/64/65/69");
  assert.notEqual(sha(text), sha(bytes), "67/70");
  assert.equal((await readFile(arm.modelOutputPath!, "utf8")), text, "71");
  assert.notEqual(sha(text), sha(`${text} `), "66");
  const bad = await runAfcR3cGeminiFloorProposalStudy({
    manifest: input, manifestDirectory: dir, studyMode: "original_only", outputDir: path.join(dir, "bad"),
    apiKey: "secret", model: "gemini-fixture", executeLiveProviderCall: true, repositoryRoot: process.cwd(),
    fetchImpl: fakeQueue([envelope(JSON.stringify({ schema_version: "afc-r3-floor-hypotheses/v1", basis_binding: "wrong", status: "proposals", proposals: [] }))], []),
  });
  assert.equal(bad.failureCode, "r3b_contract_failure", "72");
}));

test("F capture filesystem and receipt safety matrix (cases 73–89)", async () => withTemp(async (dir) => {
  const repo = path.join(dir, "repo");
  await mkdir(repo);
  assert.equal((await prepareAfcR3cCaptureDirectory({ outputDir: path.join(repo, "public"), repositoryRoot: repo })).ok, false, "73");
  const approved = path.join(repo, ".local", "afc-r3c-captures");
  await mkdir(path.dirname(approved), { recursive: true });
  await mkdir(path.join(repo, "public"));
  await symlink(path.join(repo, "public"), approved);
  assert.equal((await prepareAfcR3cCaptureDirectory({ outputDir: path.join(approved, "x"), repositoryRoot: repo })).ok, false, "74");
  await rm(approved, { force: true });
  await writeFile(approved, "file");
  assert.equal((await prepareAfcR3cCaptureDirectory({ outputDir: approved, repositoryRoot: repo })).ok, false, "75/76");
  assert.equal(sanitizeAfcR3cCaptureToken("../bad") !== null, true, "81 safely sanitized");
  assert.equal(receiptFilename("../bad")?.includes("/"), false, "82");
  const output = path.join(dir, "outside");
  const prep = await prepareAfcR3cCaptureDirectory({ outputDir: output, repositoryRoot: repo });
  assert.equal(prep.ok, true, "77 preflight");
  if (!prep.ok) return;
  const written = await writeAfcR3cImmutableCapture({ outputDir: prep.outputDir, filename: "digest.json", bytes: Buffer.from("x") });
  assert.equal(written.ok, true, "78");
  assert.equal((await writeAfcR3cImmutableCapture({ outputDir: prep.outputDir, filename: "digest.json", bytes: Buffer.from("x") })).ok, true, "79");
  assert.equal((await writeAfcR3cImmutableCapture({ outputDir: prep.outputDir, filename: "digest.json", bytes: Buffer.from("y") })).ok, false, "80");
  await writeImage(dir);
  let providerCalls = 0;
  const preflightFailure = await runAfcR3cGeminiFloorProposalStudy({
    manifest: manifest(), manifestDirectory: dir, studyMode: "original_only", outputDir: approved,
    apiKey: "secret", model: "gemini-fixture", executeLiveProviderCall: true, repositoryRoot: repo,
    fetchImpl: async () => { providerCalls += 1; return new Response("{}", { status: 200 }); },
  });
  assert.equal(preflightFailure.failureCode, "capture_write_failed", "77");
  assert.equal(providerCalls, 0, "77 preflight before provider");
}));

test("G runner composition, receipts, and authority matrix (cases 22, 57, 88–108)", async () => withTemp(async (dir) => {
  await writeImage(dir);
  const input = manifest();
  const calls: unknown[] = [];
  const normal = await runAfcR3cGeminiFloorProposalStudy({
    manifest: input, manifestDirectory: dir, studyMode: "parallel_union", outputDir: path.join(dir, "out"),
    apiKey: "secret", model: "gemini-fixture", executeLiveProviderCall: true, repositoryRoot: process.cwd(), runAfcR2: true,
    fetchImpl: fakeQueue([envelope(proposalText(input)), envelope(proposalText(input))], calls),
  });
  assert.equal(calls.length, 2, "22/92/99");
  assert.equal(normal.composition?.candidates.length, 2, "100/101");
  assert.equal(normal.afcR2Result?.candidateFamilies.length, 1, "101/103");
  assert.deepEqual(normal.afcR2Result?.sharedContextSummary, input.sharedComparisonContext, "103 exact manifest context");
  assert.equal(Object.isFrozen(normal) && Object.isFrozen(normal.arms), true, "106");
  const receiptText = await readFile(normal.arms[0].receiptPath!, "utf8");
  const receipt = JSON.parse(receiptText) as {
    receiptContractVersion: string;
    requestId: string;
    roomId: string;
    inputImage: { fingerprint: string };
    provider: { modelId: string; providerEnvelopeSha256: string | null; modelOutputTextSha256: string | null };
    safety: { researchOnly: boolean };
  };
  assert.equal(receipt.receiptContractVersion, "afc-r3c-proposal-run-receipt/v1", "105 receipt contract");
  assert.equal(receipt.requestId, normal.arms[0].requestId, "105 request");
  assert.equal(receipt.roomId, input.roomId, "105 room");
  assert.equal(receipt.inputImage.fingerprint, input.emptyRoomAssist.sha256, "105 image");
  assert.equal(receipt.provider.modelId, "gemini-fixture", "105 model");
  assert.equal(receipt.provider.providerEnvelopeSha256, normal.arms[0].provider?.providerEnvelopeSha256, "105 envelope");
  assert.equal(receipt.provider.modelOutputTextSha256, normal.arms[0].extraction?.ok ? normal.arms[0].extraction.modelOutputTextSha256 : null, "105 output");
  assert.equal(receipt.safety.researchOnly, true, "105 safety");
  for (const forbidden of ["secret", "Authorization", PIXEL.toString("base64")]) assert.equal(receiptText.includes(forbidden), false, "83–86");
  const insufficient = await runAfcR3cGeminiFloorProposalStudy({
    manifest: input, manifestDirectory: dir, studyMode: "parallel_union", outputDir: path.join(dir, "insufficient"),
    apiKey: "secret", model: "gemini-fixture", executeLiveProviderCall: true, repositoryRoot: process.cwd(),
    fetchImpl: fakeQueue([envelope(proposalText(input)), envelope(insufficientText(input))], []),
  });
  assert.equal(insufficient.composition?.status, "proposals", "93/94");
  const bothInsufficient = await runAfcR3cGeminiFloorProposalStudy({
    manifest: input, manifestDirectory: dir, studyMode: "parallel_union", outputDir: path.join(dir, "both-insufficient"),
    apiKey: "secret", model: "gemini-fixture", executeLiveProviderCall: true, repositoryRoot: process.cwd(),
    fetchImpl: fakeQueue([envelope(insufficientText(input)), envelope(insufficientText(input))], []),
  });
  assert.equal(bothInsufficient.composition?.status, "insufficient_evidence", "95");
  const nonSuccess = Buffer.from('{"error":{"message":"fixture"}}');
  const capturedNonSuccess = await runAfcR3cGeminiFloorProposalStudy({
    manifest: input, manifestDirectory: dir, studyMode: "original_only", outputDir: path.join(dir, "non-ok"),
    apiKey: "secret", model: "gemini-fixture", executeLiveProviderCall: true, repositoryRoot: process.cwd(),
    fetchImpl: async () => new Response(nonSuccess.toString("utf8"), { status: 429 }),
  });
  assert.equal(capturedNonSuccess.failureCode, "provider_non_success", "57");
  assert.deepEqual(await readFile(capturedNonSuccess.arms[0].providerEnvelopePath!), nonSuccess, "41/57");
  let stoppedCalls = 0;
  const stopped = await runAfcR3cGeminiFloorProposalStudy({
    manifest: input, manifestDirectory: dir, studyMode: "parallel_union", outputDir: path.join(dir, "writer-failure"),
    apiKey: "secret", model: "gemini-fixture", executeLiveProviderCall: true, repositoryRoot: process.cwd(),
    fetchImpl: async () => { stoppedCalls += 1; return new Response(envelope(proposalText(input)).toString("utf8"), { status: 200 }); },
    captureWriter: async () => ({ ok: false, reason: "injected" }),
  });
  assert.equal(stopped.failureCode, "capture_write_failed", "88");
  assert.equal(stoppedCalls, 1, "89");
}));

test("G role modes, atomic failures, and containment rows (cases 90–108)", async () => withTemp(async (dir) => {
  await writeImage(dir);
  const input = manifest();
  const common = {
    manifest: input, manifestDirectory: dir, apiKey: "secret", model: "gemini-fixture",
    executeLiveProviderCall: true as const, repositoryRoot: process.cwd(),
  };
  const emptyOnly = await runAfcR3cGeminiFloorProposalStudy({
    ...common, studyMode: "empty_only", outputDir: path.join(dir, "empty"),
    fetchImpl: fakeQueue([envelope(proposalText(input))], []),
  });
  const originalOnly = await runAfcR3cGeminiFloorProposalStudy({
    ...common, studyMode: "original_only", outputDir: path.join(dir, "original"),
    fetchImpl: fakeQueue([envelope(proposalText(input))], []),
  });
  assert.equal(emptyOnly.status, "success", "90");
  assert.equal(originalOnly.status, "success", "91");
  const rawWithBadEmpty = manifestRaw();
  rawWithBadEmpty.emptyRoomAssist.sha256 = "a".repeat(64);
  const parsedBadEmpty = parseAfcR3cImageManifest(rawWithBadEmpty);
  assert.equal(parsedBadEmpty.ok, true);
  if (parsedBadEmpty.ok) {
    let preflightCalls = 0;
    const preflight = await runAfcR3cGeminiFloorProposalStudy({
      ...common, manifest: parsedBadEmpty.manifest, studyMode: "parallel_union", outputDir: path.join(dir, "preflight"),
      fetchImpl: async () => { preflightCalls += 1; return new Response("{}", { status: 200 }); },
    });
    assert.equal(preflight.failureCode, "image_hash_mismatch", "22");
    assert.equal(preflightCalls, 0, "22 both inputs checked before first call");
  }
  const malformed = await runAfcR3cGeminiFloorProposalStudy({
    ...common, studyMode: "original_only", outputDir: path.join(dir, "malformed"),
    fetchImpl: fakeQueue([Buffer.from('{"candidates":[]}')], []),
  });
  assert.equal(malformed.failureCode, "provider_envelope_invalid", "96 malformed envelope distinct");
  const emptyFailure = await runAfcR3cGeminiFloorProposalStudy({
    ...common, studyMode: "parallel_union", outputDir: path.join(dir, "empty-failure"),
    fetchImpl: fakeQueue([Buffer.from('{"candidates":[]}'), envelope(proposalText(input))], []),
  });
  const originalFailure = await runAfcR3cGeminiFloorProposalStudy({
    ...common, studyMode: "parallel_union", outputDir: path.join(dir, "original-failure"),
    fetchImpl: fakeQueue([envelope(proposalText(input)), Buffer.from('{"candidates":[]}')], []),
  });
  assert.equal(emptyFailure.status, "failure", "97");
  assert.equal(originalFailure.status, "failure", "98");
  const near = await runAfcR3cGeminiFloorProposalStudy({
    ...common, studyMode: "parallel_union", outputDir: path.join(dir, "near"), runAfcR2: true,
    fetchImpl: fakeQueue([envelope(proposalText(input, 0.1)), envelope(proposalText(input, 0.12))], []),
  });
  assert.equal(near.composition?.candidates.length, 2, "102 near candidates remain");
  const noR2 = await runAfcR3cGeminiFloorProposalStudy({
    ...common, studyMode: "original_only", outputDir: path.join(dir, "no-r2"),
    fetchImpl: fakeQueue([envelope(proposalText(input))], []),
  });
  assert.equal(noR2.afcR2Result, null, "104");
  const before = JSON.stringify(input);
  await runAfcR3cGeminiFloorProposalStudy({
    ...common, studyMode: "original_only", outputDir: path.join(dir, "immutable"),
    fetchImpl: fakeQueue([envelope(proposalText(input))], []),
  });
  assert.equal(JSON.stringify(input), before, "107");
  const runnerSource = await readFile(new URL("./gemini-floor-proposal-runner.ts", import.meta.url), "utf8");
  for (const forbidden of ["ThreeRoomLab", "Apply", "scene-state", "supabase"]) {
    assert.equal(new RegExp(`^import.*${forbidden}`, "m").test(runnerSource), false, `108 ${forbidden}`);
  }
}));

test("H runner and CLI acknowledgement/argument matrix (cases 109–121)", async () => withTemp(async (dir) => {
  await writeImage(dir);
  const input = manifest();
  let calls = 0;
  const rejected = await runAfcR3cGeminiFloorProposalStudy({
    manifest: input, manifestDirectory: dir, studyMode: "original_only", outputDir: path.join(dir, "out"),
    apiKey: "secret", model: "gemini-fixture", executeLiveProviderCall: false, repositoryRoot: process.cwd(),
    fetchImpl: async () => { calls += 1; return new Response("{}", { status: 200 }); },
  } as unknown as Parameters<typeof runAfcR3cGeminiFloorProposalStudy>[0]);
  assert.equal(rejected.failureCode, "invalid_arguments", "109–112");
  assert.equal(calls, 0, "111/112");
  const manifestPath = path.join(dir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifestRaw()));
  const base = ["--manifest", manifestPath, "--output-dir", path.join(dir, "cli"), "--study-mode", "original_only", "--model", "gemini-fixture"];
  assert.equal(await runAfcR3cProposalRunnerCli(base), 2, "113");
  assert.equal(await runAfcR3cProposalRunnerCli([...base, "--validate-only", "--execute-live-provider-call"]), 2, "114");
  assert.equal(await runAfcR3cProposalRunnerCli([...base, "--validate-only", "--unknown"]), 2, "115");
  assert.equal(await runAfcR3cProposalRunnerCli(["--validate-only"]), 2, "116");
  assert.equal(await runAfcR3cProposalRunnerCli([...base.slice(0, 4), "bad", ...base.slice(5), "--validate-only"]), 2, "117");
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
  try {
    assert.equal(await runAfcR3cProposalRunnerCli([...base, "--validate-only"]), 0, "118");
  } finally { console.log = originalLog; }
  assert.equal(logs.join("\n").includes("gemini-fixture"), true, "118");
  assert.equal(logs.join("\n").includes("secret"), false, "119/121");
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.equal(await runAfcR3cProposalRunnerCli([...base, "--execute-live-provider-call"]), 8, "120 missing-key exit code");
  } finally {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  }
}));

test("H exact primitive-true acknowledgement matrix rejects untyped truthy values", async () => withTemp(async (dir) => {
  await writeImage(dir);
  const input = manifest();
  const rejectedValues: Array<readonly [string, boolean, unknown]> = [
    ["absent", false, undefined],
    ["undefined", true, undefined],
    ["null", true, null],
    ["false", true, false],
    ["zero", true, 0],
    ["one", true, 1],
    ["empty string", true, ""],
    ["true string", true, "true"],
    ["yes string", true, "yes"],
    ["plain object", true, {}],
    ["array", true, []],
    ["boxed false", true, new Boolean(false)],
  ];
  for (const [label, includeProperty, acknowledgement] of rejectedValues) {
    let providerCalls = 0;
    let captureWrites = 0;
    const outputDir = path.join(dir, `rejected-${label.replaceAll(" ", "-")}`);
    const base: Record<string, unknown> = {
      manifest: input,
      manifestDirectory: dir,
      studyMode: "original_only",
      outputDir,
      apiKey: "present-api-key-must-not-authorize",
      model: "gemini-fixture",
      repositoryRoot: process.cwd(),
      fetchImpl: async () => {
        providerCalls += 1;
        return new Response("{}", { status: 200 });
      },
      captureWriter: async () => {
        captureWrites += 1;
        return { ok: true as const, filePath: path.join(outputDir, "unexpected"), reused: false };
      },
    };
    if (includeProperty) base.executeLiveProviderCall = acknowledgement;
    const result = await runAfcR3cGeminiFloorProposalStudy(
      base as unknown as Parameters<typeof runAfcR3cGeminiFloorProposalStudy>[0]
    );
    assert.equal(result.status, "failure", label);
    assert.equal(result.failureCode, "invalid_arguments", label);
    assert.equal(providerCalls, 0, label);
    assert.equal(captureWrites, 0, label);
    await assert.rejects(stat(outputDir), /ENOENT/, label);
  }

  let providerCalls = 0;
  let captureWrites = 0;
  const outputDir = path.join(dir, "primitive-true");
  const accepted = await runAfcR3cGeminiFloorProposalStudy({
    manifest: input,
    manifestDirectory: dir,
    studyMode: "original_only",
    outputDir,
    apiKey: "present-api-key",
    model: "gemini-fixture",
    executeLiveProviderCall: true,
    repositoryRoot: process.cwd(),
    fetchImpl: async () => {
      providerCalls += 1;
      return new Response(envelope(proposalText(input)).toString("utf8"), { status: 200 });
    },
    captureWriter: async (args) => {
      captureWrites += 1;
      return { ok: true, filePath: path.join(args.outputDir, args.filename), reused: false };
    },
  });
  assert.equal(accepted.status, "success");
  assert.equal(providerCalls, 1);
  assert.equal(captureWrites, 3);
}));
