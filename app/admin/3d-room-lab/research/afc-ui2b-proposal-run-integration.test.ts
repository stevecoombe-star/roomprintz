import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { replayAfcProposalOverlay } from "./afc-proposal-overlay-view-model";
import { materializeAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package";
import { replayAfcUi2aOriginalPreparation } from "./afc-ui2a-original-preparation-replay";
import { replayAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package-replay";
import { stableAfcUi2aReceiptBytes } from "./afc-ui2a-original-preparation-contract";
import { replayAfcUi2bBindingReceipt } from "./afc-ui2b-binding-replay";
import { discoverAfcUi2bProposalRuns } from "./afc-ui2b-proposal-run-inventory";
import { parseAfcUi2bBindingReceipt, runAfcUi2bControlledProposal } from "./afc-ui2b-proposal-run";
import { deriveGeminiFloorBasisBinding, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY } from "./gemini-floor-proposal-contract";
import { resolveAfcR3cGenerationConfig } from "./gemini-floor-proposal-provider";
import { runAfcR3cGeminiFloorProposalStudy } from "./gemini-floor-proposal-runner";

const ORIGINAL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==", "base64");
const EMPTY = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh0QAAAABJRU5ErkJggg==", "base64");
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2b-integration-"));
  const roomDirectory = path.join(root, "room-a");
  const original = { fileName: `room-a.original.${sha(ORIGINAL)}.png`, sha256: sha(ORIGINAL), byteCount: ORIGINAL.byteLength, mimeType: "image/png" as const, decodedWidth: 1, decodedHeight: 1, orientation: 1 as const };
  const emptyRoomAssist = {
    fileName: `room-a.empty-room.${sha(EMPTY)}.png`, sha256: sha(EMPTY), byteCount: EMPTY.byteLength, mimeType: "image/png" as const,
    decodedWidth: 1, decodedHeight: 1, orientation: 1 as const, generatedFromOriginalSha256: original.sha256,
    generatorId: "vibode-empty-room-assist/stage1-empty-room/v1", requestedModelId: "NBP" as const,
    resolvedModelId: null, resolvedModelStatus: "not_reported_by_compositor" as const,
  };
  const originalPreparation = {
    preparationId: `afc-ui2a-original:room-a:${original.sha256}`,
    receiptFileName: `afc-ui2a-original-preparation.room-a.${original.sha256}.receipt.json`,
    receiptSha256: "",
  };
  const originalReceipt = {
    receiptContractVersion: "afc-ui2a-original-preparation-receipt/v1" as const, preparationStage: "original_captured" as const,
    preparationId: originalPreparation.preparationId, roomId: "room-a",
    source: { sanitizedImageUrl: "https://example.invalid/original.png", expectedQualifiedFingerprint: original.sha256, expectedDecodedWidth: 1, expectedDecodedHeight: 1 },
    original,
    safety: {
      authoritative: false as const, applied: false as const, persistedToScene: false as const, activeCameraUnchanged: true as const,
      floorStateUnchanged: true as const, supportStateUnchanged: true as const, databaseWrites: false as const,
      productionAssetWrites: false as const, productionTokenAccountingUsed: false as const, emptyRoomGenerationCall: false as const,
      geminiFloorProposalCall: false as const, localResearchCaptureWritten: true as const,
    },
  };
  const originalReceiptBytes = stableAfcUi2aReceiptBytes(originalReceipt);
  originalPreparation.receiptSha256 = sha(originalReceiptBytes);
  await mkdir(roomDirectory, { recursive: true });
  await writeFile(path.join(roomDirectory, original.fileName), ORIGINAL);
  await Promise.all([
    writeFile(path.join(roomDirectory, emptyRoomAssist.fileName), EMPTY),
    writeFile(path.join(roomDirectory, originalPreparation.receiptFileName), originalReceiptBytes),
  ]);
  const materialized = await materializeAfcUi2aPreparedPackage({
    originalPreparation,
    originalEvidence: { roomId: "room-a", preparationId: originalPreparation.preparationId, receipt: originalReceipt, original, roomDirectory, originalFilePath: path.join(roomDirectory, original.fileName), sanitizedImageUrl: "https://example.invalid/original.png" },
    emptyEvidence: { canonicalReceiptFileName: "empty.receipt.json", emptyRoomAssist },
    executeCapture: true,
  }, { replayPackage: async () => ({ ok: true as const, evidence: {} as never }) });
  assert.equal(materialized.status, "package_materialized");
  if (materialized.status !== "package_materialized") throw new Error("materialization failed");
  await access(roomDirectory);
  await access(path.join(roomDirectory, materialized.manifest.fileName));
  const canonicalRoot = await realpath(root);
  const captureRoot = path.join(root, ".local", "afc-r3c-captures");
  const replayPackage = (input: Parameters<typeof replayAfcUi2aPreparedPackage>[0]) => replayAfcUi2aPreparedPackage(input, {
    resolveFixedInputsRoot: async () => ({ ok: true as const, root: canonicalRoot }),
    replayOriginal: (args) => replayAfcUi2aOriginalPreparation(args, { resolveFixedInputsRoot: async () => ({ ok: true as const, root: canonicalRoot }) }),
  });
  const replayProposal = (input: { receiptFileName: string; captureRoot?: string }) => replayAfcProposalOverlay({
    receiptFileName: input.receiptFileName, captureRoot: input.captureRoot, fixedInputsRoot: canonicalRoot,
    resolveFixedInputsRoot: async () => canonicalRoot,
  });
  return { root, captureRoot, materialized, replayPackage, replayProposal, original, emptyRoomAssist };
}

function request(
  prepared: Extract<Awaited<ReturnType<typeof fixture>>["materialized"], { status: "package_materialized" }>,
  studyMode: "original_only" | "empty_only",
  packageDigestOverride?: string,
) {
  const packageId = packageDigestOverride ? `afc-ui2a-package:room-a:${packageDigestOverride}` : prepared.packageId;
  const receiptFileName = packageDigestOverride
    ? `afc-ui2a-prepared-input.room-a.${packageDigestOverride}.receipt.json`
    : prepared.receipt.fileName;
  return {
    contractVersion: "afc-ui2b-proposal-run-request/v1",
    operation: "execute",
    roomLabel: "room-a",
    packageSelector: { packageId, receiptFileName, receiptSha256: prepared.receipt.sha256 },
    studyMode, executeCapture: true, executeLiveProviderCall: true,
  };
}
function fakeEnvelope(basisBinding: string) {
  const text = JSON.stringify({
    schema_version: "afc-r3-floor-hypotheses/v1", basis_binding: basisBinding, status: "proposals",
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
  return JSON.stringify({
    candidates: [{ index: 0, content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    modelVersion: "gemini-fixture",
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2, promptTokensDetails: [], serviceTier: "standard" },
  });
}

async function runnerDependencies(value: Awaited<ReturnType<typeof fixture>>, response: () => Promise<Response>) {
  const replay = await value.replayPackage({
    roomLabel: "room-a", packageId: value.materialized.packageId,
    receiptFileName: value.materialized.receipt.fileName, receiptSha256: value.materialized.receipt.sha256,
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) throw new Error("fixture replay");
  const basis = deriveGeminiFloorBasisBinding(replay.evidence.receipt.sharedComparisonContext, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY);
  return {
    replayPackage: value.replayPackage, replayProposal: value.replayProposal,
    captureRoot: () => value.captureRoot, repositoryRoot: () => value.root,
    resolveApiKey: () => "fake-key", resolveModel: () => "gemini-3.5-flash",
    fetchImpl: async () => response(),
    basis,
  };
}

for (const studyMode of ["original_only", "empty_only"] as const) {
  test(`UI2B real ${studyMode} validation is strict and zero-call`, async () => {
    const value = await fixture();
    try {
      let packageReplays = 0;
      let fetchCalls = 0;
      let captureRootCalls = 0;
      let reservations = 0;
      const executeRequest = request(value.materialized, studyMode);
      const validateRequest = {
        contractVersion: executeRequest.contractVersion, operation: "validate" as const, roomLabel: executeRequest.roomLabel,
        packageSelector: executeRequest.packageSelector, studyMode: executeRequest.studyMode,
        executeCapture: true, executeLiveProviderCall: true,
      };
      const result = await runAfcUi2bControlledProposal({
        ...validateRequest, operation: "validate",
      }, {
        replayPackage: async (input) => { packageReplays++; return value.replayPackage(input); },
        fetchImpl: async () => { fetchCalls++; throw new Error("validation must not fetch"); },
        captureRoot: () => { captureRootCalls++; return value.captureRoot; },
        acquireReservation: async () => { reservations++; return { ok: false as const }; },
        resolveModel: () => "gemini-3.5-flash",
      });
      assert.equal(result.status, "run_validated", JSON.stringify(result));
      if (result.status !== "run_validated") return;
      assert.equal(packageReplays, 1);
      assert.equal(fetchCalls, 0);
      assert.equal(captureRootCalls, 0);
      assert.equal(reservations, 0);
      assert.equal(result.runner.providerCallCount, 0);
      assert.equal(result.runner.captureWrite, false);
      assert.equal(result.selectedImage.role, studyMode === "original_only" ? "original_photo_contextual_geometry" : "empty_room_boundary_specialist");
      assert.equal(result.selectedImage.sha256, studyMode === "original_only" ? value.original.sha256 : value.emptyRoomAssist.sha256);
      assert.equal(Object.isFrozen(result), true);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test(`UI2B real ${studyMode} single-arm fake-provider integration`, async () => {
    const value = await fixture();
    try {
      let packageReplays = 0;
      let fetchCalls = 0;
      let selectedImageData = "";
      let requestPrompt = "";
      let generationConfig: unknown;
      let runAfcR2: boolean | null = null;
      let replayFailure = "";
      const result = await runAfcUi2bControlledProposal(request(value.materialized, studyMode), {
        replayPackage: async (input) => { packageReplays++; return value.replayPackage(input); },
        replayProposal: async (input) => {
          const replay = await value.replayProposal(input);
          if (replay.status !== "valid") replayFailure = JSON.stringify(replay);
          return replay;
        },
        captureRoot: () => value.captureRoot, repositoryRoot: () => value.root,
        resolveApiKey: () => "fake-key", resolveModel: () => "gemini-3.5-flash",
        runStudy: async (args) => {
          runAfcR2 = args.runAfcR2 ?? null;
          return runAfcR3cGeminiFloorProposalStudy(args);
        },
        fetchImpl: async (_url, init) => {
          fetchCalls++;
          const body = JSON.parse(String(init?.body)) as {
            contents: Array<{ parts: Array<{ text?: string; inlineData?: { data?: string } }> }>;
            generationConfig: unknown;
          };
          requestPrompt = body.contents[0].parts[0].text ?? "";
          selectedImageData = body.contents[0].parts[1].inlineData?.data ?? "";
          generationConfig = body.generationConfig;
          const replay = await value.replayPackage({
            roomLabel: "room-a", packageId: value.materialized.packageId,
            receiptFileName: value.materialized.receipt.fileName, receiptSha256: value.materialized.receipt.sha256,
          });
          assert.equal(replay.ok, true);
          if (!replay.ok) throw new Error("replay");
          const context = replay.evidence.receipt.sharedComparisonContext;
          const { deriveGeminiFloorBasisBinding, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY } = await import("./gemini-floor-proposal-contract");
          return new Response(fakeEnvelope(deriveGeminiFloorBasisBinding(context, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY)), { status: 200 });
        },
      });
      assert.equal(result.status, "run_completed", `${JSON.stringify(result)} ${replayFailure}`);
      if (result.status !== "run_completed") return;
      assert.equal(packageReplays, 2, "execute replays the package for admission and strict companion authority");
      assert.equal(fetchCalls, 1);
      assert.equal(result.runner.providerCallCount, 1);
      assert.equal(result.proposal.armCount, 1);
      assert.equal(runAfcR2, false);
      const resolvedGeneration = resolveAfcR3cGenerationConfig("gemini-3.5-flash");
      assert.deepEqual(Object.keys(generationConfig as Record<string, unknown>).sort(), [
        "maxOutputTokens", "responseJsonSchema", "responseMimeType", "temperature", "thinkingConfig",
      ]);
      assert.equal((generationConfig as Record<string, unknown>).temperature, resolvedGeneration.temperature);
      assert.equal((generationConfig as Record<string, unknown>).maxOutputTokens, resolvedGeneration.maxOutputTokens);
      assert.equal((generationConfig as Record<string, unknown>).responseMimeType, resolvedGeneration.responseMimeType);
      assert.deepEqual((generationConfig as Record<string, unknown>).thinkingConfig, { thinkingLevel: resolvedGeneration.thinkingLevel });
      assert.equal(typeof (generationConfig as Record<string, unknown>).responseJsonSchema, "object");
      assert.equal(result.studyMode, studyMode);
      assert.equal(result.runner.promptRole, studyMode === "original_only" ? "original_photo_contextual_geometry" : "empty_room_boundary_specialist");
      assert.equal(requestPrompt.includes(studyMode === "original_only"
        ? "occupied original room photograph"
        : "geometry-preserving Empty-Room Assist"), true);
      assert.equal(selectedImageData, (studyMode === "original_only" ? ORIGINAL : EMPTY).toString("base64"));
      const proposalPath = path.join(value.captureRoot, result.proposal.receiptFileName);
      await access(proposalPath);
      const proposalReplay = await value.replayProposal({ receiptFileName: result.proposal.receiptFileName, captureRoot: value.captureRoot });
      assert.equal(proposalReplay.status, "valid");
      if (proposalReplay.status !== "valid") return;
      assert.equal(sha(await readFile(proposalPath)), result.proposal.receiptSha256);
      assert.equal(proposalReplay.viewModel.artifactIdentity.receiptSha256, result.proposal.receiptSha256);
      assert.equal(proposalReplay.viewModel.artifactIdentity.imageRole, studyMode === "original_only" ? "original_contextual" : "empty_room_boundary_specialist");
      await access(path.join(value.captureRoot, `provider-envelope.${proposalReplay.viewModel.provenance.artifactHashes.providerEnvelopeSha256}.json`));
      await access(path.join(value.captureRoot, `model-output.${proposalReplay.viewModel.provenance.artifactHashes.modelOutputSha256}.json`));
      const bindingName = `afc-ui2b-run.${result.proposal.receiptSha256}.binding.json`;
      const binding = JSON.parse(await readFile(path.join(value.captureRoot, bindingName), "utf8"));
      assert.equal(parseAfcUi2bBindingReceipt(binding).ok, true);
      const companionReplay = await replayAfcUi2bBindingReceipt({
        roomLabel: "room-a", bindingFileName: bindingName,
      }, {
        captureRoot: () => value.captureRoot, replayPackage: value.replayPackage, replayProposal: value.replayProposal,
      });
      assert.equal(companionReplay.status, "valid");
      const inventory = await discoverAfcUi2bProposalRuns({ roomLabel: "room-a" }, {
        captureRoot: () => value.captureRoot, replayPackage: value.replayPackage, replayProposal: value.replayProposal,
      });
      assert.equal(inventory.status, "inventory");
      assert.equal(inventory.status === "inventory" && inventory.runs.length, 1);
      if (inventory.status === "inventory" && companionReplay.status === "valid") {
        assert.deepEqual(inventory.runs[0], companionReplay.summary);
      }
      const repeated = await discoverAfcUi2bProposalRuns({ roomLabel: "room-a" }, {
        captureRoot: () => value.captureRoot, replayPackage: value.replayPackage, replayProposal: value.replayProposal,
      });
      assert.deepEqual(repeated, inventory);
      assert.equal(JSON.stringify(result).includes(value.root), false);
      assert.equal(JSON.stringify(result).includes("fake-key"), false);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(result.proposal), true);
      assert.equal(result.safety.compositorCalls, false);
      assert.equal(result.safety.emptyRoomGenerationCalls, false);
      assert.equal(result.safety.afcR2Runs, false);
      assert.equal(result.safety.persistedToScene, false);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
}

test("UI2B counted fetch preserves one provider attempt through provider failures", async () => {
  const cases: ReadonlyArray<readonly [string, string, () => Promise<Response>]> = [
    ["transport", "provider_non_success", async () => { throw new Error("transport"); }],
    ...[400, 401, 403, 429, 500, 503].map((status) => [
      `http_${status}`, "provider_non_success", async () => new Response("bad", { status }),
    ] as const),
    ["invalid_envelope", "provider_response_invalid", async () => new Response("{", { status: 200 })],
    ["zero_candidates", "provider_response_invalid", async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })],
    ["multiple_candidates", "provider_response_invalid", async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }, { content: { parts: [{ text: "{}" }] } }] }), { status: 200 })],
    ["candidate_without_content", "provider_response_invalid", async () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP" }] }), { status: 200 })],
    ["zero_text_parts", "provider_response_invalid", async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }), { status: 200 })],
    ["multiple_text_parts", "provider_response_invalid", async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }, { text: "{}" }] }, finishReason: "STOP" }] }), { status: 200 })],
    ["non_string_text", "provider_response_invalid", async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 1 }] }, finishReason: "STOP" }] }), { status: 200 })],
    ["whitespace_text", "provider_response_invalid", async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "  " }] }, finishReason: "STOP" }] }), { status: 200 })],
  ];
  for (const [name, failureCode, provider] of cases) {
    const value = await fixture();
    try {
      const dependencies = await runnerDependencies(value, provider);
      const result = await runAfcUi2bControlledProposal(request(value.materialized, "original_only"), dependencies);
      assert.equal(result.status, "failure", name);
      assert.equal(result.status === "failure" && result.failureCode, failureCode, name);
      assert.equal(result.status === "failure" && result.providerCallCount, 1);
      assert.equal(result.status === "failure" && result.geminiFloorProposalCall, true);
      assert.equal(result.status === "failure" && result.proposalReceiptWritten, false);
      assert.equal(JSON.stringify(result).includes(value.root), false);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  }
});

test("UI2B capture failure after counted fetch retains one provider attempt", async () => {
  const value = await fixture();
  try {
    const seeded = await runnerDependencies(value, async () => new Response("unused", { status: 500 }));
    const { basis, ...dependencies } = seeded;
    const result = await runAfcUi2bControlledProposal(request(value.materialized, "empty_only"), {
      ...dependencies,
      fetchImpl: async () => new Response(fakeEnvelope(basis), { status: 200 }),
      runStudy: async (args) => runAfcR3cGeminiFloorProposalStudy({
        ...args,
        captureWriter: async () => ({ ok: false as const, reason: "test_capture_failure" }),
      }),
    });
    assert.equal(result.status, "failure");
    assert.equal(result.status === "failure" && result.failureCode, "proposal_capture_failed");
    assert.equal(result.status === "failure" && result.providerCallCount, 1);
    assert.equal(result.status === "failure" && result.proposalReceiptWritten, false);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("UI2B counted fetch preserves one attempt through malformed R3B model text", async () => {
  const modelTexts = [
    "not-json",
    "[]",
    JSON.stringify({ schema_version: "wrong", basis_binding: "wrong", status: "proposals", proposals: [] }),
    JSON.stringify({ schema_version: "afc-r3-floor-hypotheses/v1", basis_binding: "wrong", status: "proposals", proposals: [] }),
    JSON.stringify({ schema_version: "afc-r3-floor-hypotheses/v1", basis_binding: "wrong", status: "no_candidate", proposals: [{}] }),
  ];
  for (const text of modelTexts) {
    const value = await fixture();
    try {
      const seeded = await runnerDependencies(value, async () => new Response("unused", { status: 500 }));
      const { basis, ...dependencies } = seeded;
      const envelope = JSON.parse(fakeEnvelope(basis)) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
      envelope.candidates[0].content.parts[0].text = text;
      const result = await runAfcUi2bControlledProposal(request(value.materialized, "original_only"), {
        ...dependencies,
        fetchImpl: async () => new Response(JSON.stringify(envelope), { status: 200 }),
      });
      assert.equal(result.status, "failure");
      assert.equal(result.status === "failure" && result.failureCode, "proposal_contract_invalid");
      assert.equal(result.status === "failure" && result.providerCallCount, 1);
      assert.equal(result.status === "failure" && result.geminiFloorProposalCall, true);
      assert.equal(result.status === "failure" && result.companionReceiptWritten, false);
      assert.equal(JSON.stringify(result).includes(text), false);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  }
});

for (const studyMode of ["original_only", "empty_only"] as const) {
  test(`UI2B ${studyMode} counted fetch refuses a second delegated provider call`, async () => {
    const value = await fixture();
    try {
      let delegatedCalls = 0;
      const result = await runAfcUi2bControlledProposal(request(value.materialized, studyMode), {
        replayPackage: value.replayPackage,
        captureRoot: () => value.captureRoot,
        repositoryRoot: () => value.root,
        resolveApiKey: () => "fake-key",
        resolveModel: () => "gemini-3.5-flash",
        fetchImpl: async () => {
          delegatedCalls++;
          return new Response("first", { status: 200 });
        },
        runStudy: async (args) => {
          await args.fetchImpl?.("https://example.invalid/first", {});
          await assert.rejects(async () => args.fetchImpl?.("https://example.invalid/second", {}));
          return { status: "failure", failureCode: "provider_transport_failed", arms: [{ receiptPath: null }] } as never;
        },
      });
      assert.equal(result.status, "failure");
      assert.equal(result.status === "failure" && result.providerCallCount, 1);
      assert.equal(result.status === "failure" && result.geminiFloorProposalCall, true);
      assert.equal(result.status === "failure" && result.companionReceiptWritten, false);
      assert.equal(delegatedCalls, 1);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
}

test("UI2B same package and mode reservation permits only one concurrent provider attempt", async () => {
  const value = await fixture();
  try {
    const seeded = await runnerDependencies(value, async () => new Response("unused", { status: 500 }));
    const { basis, ...dependencies } = seeded;
    let providerCalls = 0;
    let releaseProvider!: () => void;
    let providerEntered!: () => void;
    const entered = new Promise<void>((resolve) => { providerEntered = resolve; });
    const release = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const shared = {
      ...dependencies,
      fetchImpl: async () => {
        providerCalls++;
        providerEntered();
        await release;
        return new Response(fakeEnvelope(basis), { status: 200 });
      },
    };
    const first = runAfcUi2bControlledProposal(request(value.materialized, "original_only"), shared);
    await entered;
    const second = await runAfcUi2bControlledProposal(request(value.materialized, "original_only"), shared);
    releaseProvider();
    const firstResult = await first;
    assert.equal(second.status, "failure");
    assert.equal(second.status === "failure" && second.failureCode, "run_in_progress");
    assert.equal(second.status === "failure" && second.providerCallCount, 0);
    assert.equal(firstResult.status, "run_completed");
    assert.equal(providerCalls, 1);
    const afterRelease = await runAfcUi2bControlledProposal(request(value.materialized, "empty_only"), shared);
    assert.equal(afterRelease.status, "run_completed");
    assert.equal(providerCalls, 2);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("UI2B real reservation files isolate modes and packages and release after terminal failure", async () => {
  const value = await fixture();
  try {
    const realReplay = value.replayPackage;
    const replayPackage: typeof realReplay = async (input) => {
      const replay = await realReplay({
        roomLabel: "room-a",
        packageId: value.materialized.packageId,
        receiptFileName: value.materialized.receipt.fileName,
        receiptSha256: value.materialized.receipt.sha256,
      });
      return replay.ok
        ? { ...replay, evidence: { ...replay.evidence, packageId: typeof input.packageId === "string" ? input.packageId : "" } }
        : replay;
    };
    let providerCalls = 0;
    let allEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { allEntered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const dependencies = {
      replayPackage,
      captureRoot: () => value.captureRoot,
      repositoryRoot: () => value.root,
      resolveApiKey: () => "fake-key",
      resolveModel: () => "gemini-3.5-flash",
      fetchImpl: async () => {
        providerCalls++;
        if (providerCalls === 3) allEntered();
        await hold;
        return new Response("refused", { status: 503 });
      },
    };
    const runs = [
      runAfcUi2bControlledProposal(request(value.materialized, "original_only"), dependencies),
      runAfcUi2bControlledProposal(request(value.materialized, "empty_only"), dependencies),
      runAfcUi2bControlledProposal(request(value.materialized, "original_only", "8".repeat(64)), dependencies),
    ];
    await entered;
    const activeReservations = (await readdir(value.captureRoot)).filter((name) => name.endsWith(".reservation"));
    assert.equal(activeReservations.length, 3);
    release();
    const results = await Promise.all(runs);
    assert.equal(providerCalls, 3);
    for (const result of results) {
      assert.equal(result.status, "failure");
      assert.equal(result.status === "failure" && result.providerCallCount, 1);
    }
    assert.deepEqual((await readdir(value.captureRoot)).filter((name) => name.endsWith(".reservation")), []);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("UI2B pre-provider configuration refusal does not reserve or fetch", async () => {
  const value = await fixture();
  try {
    let reservations = 0;
    let fetches = 0;
    const result = await runAfcUi2bControlledProposal(request(value.materialized, "original_only"), {
      replayPackage: value.replayPackage,
      captureRoot: () => value.captureRoot,
      resolveModel: () => "gemini-3.5-flash",
      resolveApiKey: () => null,
      acquireReservation: async () => { reservations++; return { ok: false as const }; },
      fetchImpl: async () => { fetches++; throw new Error("must not fetch"); },
    });
    assert.equal(result.status, "failure");
    assert.equal(result.status === "failure" && result.failureCode, "provider_configuration_unavailable");
    assert.equal(result.status === "failure" && result.providerCallCount, 0);
    assert.equal(reservations, 0);
    assert.equal(fetches, 0);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("UI2B pre-fetch refusal matrix preserves zero provider and artifact truth", async () => {
  const cases = [
    {
      name: "package replay",
      failureCode: "package_not_found",
      override: async () => ({ replayPackage: async () => ({ ok: false, failureCode: "package_not_found" }) as never }),
    },
    {
      name: "selected image",
      failureCode: "selected_image_invalid",
      override: async () => ({ verifyImage: async () => ({ ok: false }) as never }),
    },
    {
      name: "model configuration",
      failureCode: "provider_configuration_unavailable",
      override: async () => ({ resolveModel: () => null }),
    },
    {
      name: "api configuration",
      failureCode: "provider_configuration_unavailable",
      override: async () => ({ resolveApiKey: () => null }),
    },
    {
      name: "capture preflight",
      failureCode: "runner_validation_failed",
      override: async (value: Awaited<ReturnType<typeof fixture>>) => {
        const file = path.join(value.root, "not-a-directory");
        await writeFile(file, "file");
        return { captureRoot: () => file };
      },
    },
    {
      name: "active reservation",
      failureCode: "run_in_progress",
      override: async () => ({ acquireReservation: async () => ({ ok: false as const }) }),
    },
  ];
  for (const item of cases) {
    const value = await fixture();
    try {
      let fetches = 0;
      let reservations = 0;
      const result = await runAfcUi2bControlledProposal(request(value.materialized, "original_only"), {
        replayPackage: value.replayPackage,
        captureRoot: () => value.captureRoot,
        resolveApiKey: () => "fake-key",
        resolveModel: () => "gemini-3.5-flash",
        acquireReservation: async (args) => {
          reservations++;
          const filename = `.afc-ui2b-proposal-run.${sha(`${args.packageId}\n${args.studyMode}`)}.reservation`;
          await mkdir(args.captureRoot, { recursive: true });
          await writeFile(path.join(args.captureRoot, filename), "");
          return { ok: true as const, filePath: path.join(args.captureRoot, filename) };
        },
        fetchImpl: async () => { fetches++; throw new Error("must not fetch"); },
        ...await item.override(value),
      });
      assert.equal(result.status, "failure", item.name);
      if (result.status !== "failure") continue;
      assert.equal(result.failureCode, item.failureCode, item.name);
      assert.equal(result.providerCallCount, 0, item.name);
      assert.equal(result.geminiFloorProposalCall, false, item.name);
      assert.equal(result.proposalReceiptWritten, false, item.name);
      assert.equal(result.companionReceiptWritten, false, item.name);
      assert.equal(fetches, 0, item.name);
      if (item.name !== "active reservation") assert.equal(reservations, 0, item.name);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  }
});

test("UI2B post-fetch replay and companion failures preserve truth and release reservations", async () => {
  const cases = [
    "unexpected_failure", "proposal_receipt_missing", "ui1a_replay", "companion_write", "companion_hash", "companion_replay",
  ] as const;
  const expectedFailureCodes = {
    unexpected_failure: "unexpected_failure",
    proposal_receipt_missing: "proposal_receipt_validation_failed",
    ui1a_replay: "proposal_replay_failed",
    companion_write: "proposal_capture_failed",
    companion_hash: "proposal_capture_failed",
    companion_replay: "proposal_capture_failed",
  } as const;
  for (const failure of cases) {
    const value = await fixture();
    try {
      const seeded = await runnerDependencies(value, async () => new Response("unused", { status: 500 }));
      const { basis, ...base } = seeded;
      let fetches = 0;
      let proposalReplays = 0;
      const overrides = failure === "unexpected_failure"
        ? {
            runStudy: async (args: Parameters<typeof runAfcR3cGeminiFloorProposalStudy>[0]) => {
              await args.fetchImpl?.("https://example.invalid/provider", {});
              throw new Error("/Users/private raw provider failure");
            },
          }
        : failure === "proposal_receipt_missing"
        ? {
            runStudy: async (args: Parameters<typeof runAfcR3cGeminiFloorProposalStudy>[0]) => {
              await args.fetchImpl?.("https://example.invalid/provider", {});
              return { status: "success", failureCode: null, arms: [{ requestId: "missing-receipt" }] } as never;
            },
          }
        : failure === "ui1a_replay"
          ? { replayProposal: async () => ({ status: "invalid" as const }) as never }
          : failure === "companion_write"
            ? { writeCapture: async () => ({ ok: false as const, reason: "injected" }) }
            : failure === "companion_hash"
              ? {
                  writeCapture: async (args: { outputDir: string; filename: string; bytes: Buffer }) => {
                    await writeFile(path.join(args.outputDir, args.filename), Buffer.concat([args.bytes, Buffer.from("\n")]));
                    return { ok: true as const, filePath: path.join(args.outputDir, args.filename), reused: false };
                  },
                }
              : {
                  replayProposal: async (input: { receiptFileName: string; captureRoot?: string }) => {
                    proposalReplays++;
                    return proposalReplays === 1 ? value.replayProposal(input) : { status: "invalid" as const } as never;
                  },
                };
      const dependencies = {
        ...base,
        fetchImpl: async () => {
          fetches++;
          return new Response(fakeEnvelope(basis), { status: 200 });
        },
        ...overrides,
      };
      const result = await runAfcUi2bControlledProposal(request(value.materialized, "original_only"), dependencies);
      assert.equal(result.status, "failure", failure);
      if (result.status !== "failure") continue;
      assert.equal(result.failureCode, expectedFailureCodes[failure], failure);
      assert.equal(fetches, 1, failure);
      assert.equal(result.providerCallCount, 1, failure);
      assert.equal(result.geminiFloorProposalCall, true, failure);
      assert.equal(result.proposalReceiptWritten, !["unexpected_failure", "proposal_receipt_missing"].includes(failure), failure);
      assert.equal(result.companionReceiptWritten, false, failure);
      assert.equal(JSON.stringify(result).includes(value.root), false, failure);
      assert.equal(JSON.stringify(result).includes("private raw provider failure"), false, failure);
      assert.deepEqual((await readdir(value.captureRoot)).filter((name) => name.endsWith(".reservation")), [], failure);

      const retry = await runAfcUi2bControlledProposal(request(value.materialized, "empty_only"), {
        ...base,
        fetchImpl: async () => new Response(fakeEnvelope(basis), { status: 200 }),
      });
      assert.notEqual(retry.status === "failure" && retry.failureCode, "run_in_progress", failure);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  }
});

test("UI2B symlinked capture root fails before the provider boundary", async () => {
  const value = await fixture();
  const target = path.join(value.root, "capture-target");
  const link = path.join(value.root, "capture-link");
  try {
    await mkdir(target);
    await symlink(target, link);
    let fetches = 0;
    const result = await runAfcUi2bControlledProposal(request(value.materialized, "original_only"), {
      replayPackage: value.replayPackage,
      captureRoot: () => link,
      resolveApiKey: () => "fake-key",
      resolveModel: () => "gemini-3.5-flash",
      fetchImpl: async () => { fetches++; throw new Error("must not fetch"); },
    });
    assert.equal(result.status, "failure");
    assert.equal(result.status === "failure" && result.failureCode, "runner_validation_failed");
    assert.equal(result.status === "failure" && result.providerCallCount, 0);
    assert.equal(fetches, 0);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("UI2B stale reservation files fail closed before the provider boundary", async () => {
  const value = await fixture();
  try {
    const captureRoot = value.captureRoot;
    await mkdir(captureRoot, { recursive: true });
    const reservation = `.afc-ui2b-proposal-run.${sha(`${value.materialized.packageId}\noriginal_only`)}.reservation`;
    await writeFile(path.join(captureRoot, reservation), "");
    let fetches = 0;
    const result = await runAfcUi2bControlledProposal(request(value.materialized, "original_only"), {
      replayPackage: value.replayPackage,
      captureRoot: () => captureRoot,
      resolveApiKey: () => "fake-key",
      resolveModel: () => "gemini-3.5-flash",
      fetchImpl: async () => { fetches++; throw new Error("must not fetch"); },
    });
    assert.equal(result.status, "failure");
    assert.equal(result.status === "failure" && result.failureCode, "run_in_progress");
    assert.equal(result.status === "failure" && result.providerCallCount, 0);
    assert.equal(fetches, 0);
    await access(path.join(captureRoot, reservation));
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
