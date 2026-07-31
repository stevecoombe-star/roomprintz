import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { replayAfcProposalOverlay } from "./afc-proposal-overlay-view-model";
import { classifyAfcR3cImagePairCompatibility } from "./afc-r3c-image-pair-compatibility";
import { discoverAfcUi2aDurableEmptyEvidence, AFC_UI2A_EMPTY_GENERATOR_ID } from "./afc-ui2a-empty-evidence-replay";
import { prepareAfcUi2aOriginal } from "./afc-ui2a-prepare-original";
import { materializeAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package";
import { replayAfcUi2aOriginalPreparation } from "./afc-ui2a-original-preparation-replay";
import { replayAfcUi2aPreparedPackage } from "./afc-ui2a-prepared-package-replay";
import { stableAfcUi2aReceiptBytes } from "./afc-ui2a-original-preparation-contract";
import { replayAfcUi2bBindingReceipt } from "./afc-ui2b-binding-replay";
import { discoverAfcUi2bProposalRuns } from "./afc-ui2b-proposal-run-inventory";
import {
  afcUi2bProposalBindingReceiptFileName,
  parseAfcUi2bBindingReceipt,
  runAfcUi2bControlledProposal,
} from "./afc-ui2b-proposal-run";
import { stableReceiptBytes, writeAfcR3cImmutableCapture } from "./gemini-floor-proposal-capture";
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

const ROOM_B_LIKE = {
  roomId: "room-b-like",
  original: { width: 5000, height: 3333 },
  empty: { width: 1264, height: 848 },
  compatibility: {
    version: "afc-r3c-image-pair-compatibility/v1",
    tier: "aspect_compatible_rescaled",
    relativeAspectErrorRaw: 0.0063886792452830824,
    relativeAspectError: 0.0064,
  },
} as const;

async function captureSnapshot(directory: string) {
  return Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async (name) => {
    const bytes = await readFile(path.join(directory, name));
    return [name, { sha256: sha(bytes), byteCount: bytes.byteLength }] as const;
  })));
}

function deeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return true;
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((child) => deeplyFrozen(child, seen));
}

async function aspectCompatibleFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2b-room-b-like-"));
  const canonicalRoot = await realpath(root);
  const originalBytes = await sharp({
    create: { width: ROOM_B_LIKE.original.width, height: ROOM_B_LIKE.original.height, channels: 3, background: { r: 24, g: 42, b: 64 } },
  }).jpeg().toBuffer();
  const emptyBytes = await sharp({
    create: { width: ROOM_B_LIKE.empty.width, height: ROOM_B_LIKE.empty.height, channels: 3, background: { r: 236, g: 232, b: 224 } },
  }).png().toBuffer();
  const originalSha256 = sha(originalBytes);
  const preparedOriginal = await prepareAfcUi2aOriginal({
    contractVersion: "afc-ui2a-prepare-original-request/v1",
    currentImage: {
      contractVersion: "afc-ui2a-current-image/v1",
      imageUrl: "https://images.example/room-b-like.jpg?test-secret=redacted",
      expectedFingerprint: originalSha256,
      expectedWidth: ROOM_B_LIKE.original.width,
      expectedHeight: ROOM_B_LIKE.original.height,
    },
    roomLabel: ROOM_B_LIKE.roomId,
    executeCapture: true,
  }, {
    fetchImage: async () => ({
      ok: true as const,
      base64: originalBytes.toString("base64"),
      buffer: originalBytes,
      mime: "image/jpeg",
      byteCount: originalBytes.byteLength,
      host: "images.example",
    }),
    resolveFixedInputsRoot: async () => ({ ok: true as const, root: canonicalRoot }),
    immutableWriter: writeAfcR3cImmutableCapture,
    maxImageBytes: 25 * 1024 * 1024,
  });
  assert.equal(preparedOriginal.status, "prepared", JSON.stringify(preparedOriginal));
  if (preparedOriginal.status !== "prepared") throw new Error("Original preparation failed.");
  assert.deepEqual(
    { width: preparedOriginal.original.decodedWidth, height: preparedOriginal.original.decodedHeight },
    ROOM_B_LIKE.original,
  );

  const originalPreparation = {
    preparationId: preparedOriginal.preparationId,
    receiptFileName: preparedOriginal.receipt.fileName,
    receiptSha256: preparedOriginal.receipt.sha256,
  };
  const replayOriginal = (args: Parameters<typeof replayAfcUi2aOriginalPreparation>[0]) =>
    replayAfcUi2aOriginalPreparation(args, {
      resolveFixedInputsRoot: async () => ({ ok: true as const, root: canonicalRoot }),
    });
  const originalReplay = await replayOriginal({ roomLabel: ROOM_B_LIKE.roomId, selector: originalPreparation });
  assert.equal(originalReplay.ok, true, originalReplay.ok ? "" : originalReplay.failureCode);
  if (!originalReplay.ok) throw new Error("Original strict replay failed.");
  const originalEvidence = originalReplay.evidence;
  const roomDirectory = originalEvidence.roomDirectory;

  const emptySha256 = sha(emptyBytes);
  const emptyFileName = `${ROOM_B_LIKE.roomId}.empty-room.${emptySha256}.png`;
  const emptyPath = path.join(roomDirectory, emptyFileName);
  const emptyWrite = await writeAfcR3cImmutableCapture({
    outputDir: roomDirectory,
    filename: emptyFileName,
    bytes: emptyBytes,
  });
  assert.equal(emptyWrite.ok, true);
  const fixedEmptyReceiptFileName = "afc-r3c-fixed-empty-room.room-b-like-ui2b.receipt.json";
  const fixedEmptyReceipt = {
    receiptContractVersion: "afc-r3c-fixed-empty-room-capture-receipt/v1",
    roomId: ROOM_B_LIKE.roomId,
    requestId: "room-b-like-ui2b",
    createdAt: "2026-07-30T00:00:00.000Z",
    captureSource: "cache_hit",
    original: {
      sourceFilePath: originalEvidence.originalFilePath,
      capturedFilePath: originalEvidence.originalFilePath,
      sha256: originalEvidence.original.sha256,
      byteCount: originalEvidence.original.byteCount,
      decodedWidth: originalEvidence.original.decodedWidth,
      decodedHeight: originalEvidence.original.decodedHeight,
      orientation: 1,
      mimeType: originalEvidence.original.mimeType,
    },
    emptyRoomAssist: {
      capturedFilePath: emptyPath,
      sha256: emptySha256,
      byteCount: emptyBytes.byteLength,
      decodedWidth: ROOM_B_LIKE.empty.width,
      decodedHeight: ROOM_B_LIKE.empty.height,
      orientation: 1,
      mimeType: "image/png",
      generatedFromOriginalSha256: originalEvidence.original.sha256,
    },
    generation: {
      cacheStatus: "hit",
      generatorId: AFC_UI2A_EMPTY_GENERATOR_ID,
      requestedModelId: "NBP",
      resolvedModelId: null,
      resolvedModelStatus: "not_reported_by_compositor",
      appliedAspectRatio: null,
      imageTransport: "data_url",
      generatedAt: "2026-07-30T00:00:00.000Z",
    },
    safety: {
      applied: false,
      authoritative: false,
      persisted: false,
      activeCameraUnchanged: true,
      sceneStateUnchanged: true,
      databaseWrites: false,
      productionAssetWrites: false,
      productionTokenAccountingUsed: false,
      emptyRoomGenerationCall: false,
      geminiFloorProposalCall: false,
      localResearchCaptureWritten: true,
    },
  };
  const emptyReceiptWrite = await writeAfcR3cImmutableCapture({
    outputDir: roomDirectory,
    filename: fixedEmptyReceiptFileName,
    bytes: stableReceiptBytes(fixedEmptyReceipt),
  });
  assert.equal(emptyReceiptWrite.ok, true);
  const durableEmpty = await discoverAfcUi2aDurableEmptyEvidence(originalEvidence);
  assert.equal(durableEmpty.status, "selected", JSON.stringify(durableEmpty));
  if (durableEmpty.status !== "selected") throw new Error("Empty evidence strict replay failed.");
  assert.equal(durableEmpty.evidence.canonicalReceiptFileName, fixedEmptyReceiptFileName);
  assert.deepEqual(
    { width: durableEmpty.evidence.emptyRoomAssist.decodedWidth, height: durableEmpty.evidence.emptyRoomAssist.decodedHeight },
    ROOM_B_LIKE.empty,
  );

  const classified = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: originalEvidence.original.sha256,
      decodedWidth: originalEvidence.original.decodedWidth,
      decodedHeight: originalEvidence.original.decodedHeight,
      orientation: originalEvidence.original.orientation,
    },
    {
      fingerprint: durableEmpty.evidence.emptyRoomAssist.sha256,
      decodedWidth: durableEmpty.evidence.emptyRoomAssist.decodedWidth,
      decodedHeight: durableEmpty.evidence.emptyRoomAssist.decodedHeight,
      orientation: durableEmpty.evidence.emptyRoomAssist.orientation,
    },
  );
  assert.deepEqual(
    {
      version: classified.version,
      tier: classified.tier,
      relativeAspectErrorRaw: classified.relativeAspectErrorRaw,
      relativeAspectError: classified.relativeAspectError,
    },
    ROOM_B_LIKE.compatibility,
  );

  const replayPackage = (input: Parameters<typeof replayAfcUi2aPreparedPackage>[0]) =>
    replayAfcUi2aPreparedPackage(input, {
      resolveFixedInputsRoot: async () => ({ ok: true as const, root: canonicalRoot }),
      replayOriginal,
    });
  const materialize = () => materializeAfcUi2aPreparedPackage({
    originalPreparation,
    originalEvidence,
    emptyEvidence: durableEmpty.evidence,
    executeCapture: true,
  }, { replayPackage });
  const materialized = await materialize();
  assert.equal(materialized.status, "package_materialized", JSON.stringify(materialized));
  if (materialized.status !== "package_materialized") throw new Error("Prepared package materialization failed.");
  assert.deepEqual(materialized.compatibility, ROOM_B_LIKE.compatibility);
  assert.equal(materialized.sharedContextDigest.length, 64);
  assert.equal(materialized.original.sha256, originalEvidence.original.sha256);
  assert.equal(materialized.emptyRoomAssist.sha256, durableEmpty.evidence.emptyRoomAssist.sha256);
  const repeatedMaterialization = await materialize();
  assert.equal(repeatedMaterialization.status, "package_materialized");
  if (repeatedMaterialization.status !== "package_materialized") throw new Error("Repeated materialization failed.");
  assert.equal(repeatedMaterialization.packageId, materialized.packageId);
  assert.equal(repeatedMaterialization.manifest.sha256, materialized.manifest.sha256);
  assert.equal(repeatedMaterialization.receipt.sha256, materialized.receipt.sha256);
  assert.equal(repeatedMaterialization.receipt.reused, true);

  const strictPackageReplay = await replayPackage({
    roomLabel: ROOM_B_LIKE.roomId,
    packageId: materialized.packageId,
    receiptFileName: materialized.receipt.fileName,
    receiptSha256: materialized.receipt.sha256,
  });
  assert.equal(strictPackageReplay.ok, true, strictPackageReplay.ok ? "" : strictPackageReplay.failureCode);
  if (!strictPackageReplay.ok) throw new Error("Prepared package strict replay failed.");
  assert.equal(strictPackageReplay.evidence.receipt.sharedComparisonContext.basisKind, "original");
  assert.equal(strictPackageReplay.evidence.receipt.sharedComparisonContext.basisFingerprint, originalEvidence.original.sha256);
  assert.deepEqual(strictPackageReplay.evidence.receipt.compatibility, ROOM_B_LIKE.compatibility);

  const captureRoot = path.join(root, ".local", "afc-r3c-captures");
  const replayProposal = (input: { receiptFileName: string; captureRoot?: string }) => replayAfcProposalOverlay({
    receiptFileName: input.receiptFileName,
    captureRoot: input.captureRoot,
    fixedInputsRoot: canonicalRoot,
    resolveFixedInputsRoot: async () => canonicalRoot,
  });
  return {
    root,
    canonicalRoot,
    captureRoot,
    roomDirectory,
    originalBytes,
    emptyBytes,
    originalEvidence,
    emptyEvidence: durableEmpty.evidence,
    classified,
    materialized,
    strictPackageReplay,
    replayPackage,
    replayProposal,
  };
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
    roomLabel: prepared.roomId,
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
      assert.deepEqual(result.compatibility, {
        version: "afc-r3c-image-pair-compatibility/v1",
        tier: "exact_grid_compatible",
        relativeAspectErrorRaw: 0,
        relativeAspectError: 0,
      });
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
      const proposalReceipt = JSON.parse(await readFile(proposalPath, "utf8"));
      assert.deepEqual(proposalReceipt.compatibility, {
        tier: "exact_grid_compatible",
        relativeAspectErrorRaw: 0,
        relativeAspectError: 0,
      });
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

test("UI2B aspect-compatible original_only preserves manifest-pair authority end to end", async () => {
  const value = await aspectCompatibleFixture();
  try {
    assert.equal(value.materialized.manifest.disposition, "written");
    assert.deepEqual(value.materialized.compatibility, ROOM_B_LIKE.compatibility);
    assert.equal(value.strictPackageReplay.ok, true);
    assert.equal(value.classified.tier, "aspect_compatible_rescaled");
    assert.equal(value.classified.relativeAspectErrorRaw, ROOM_B_LIKE.compatibility.relativeAspectErrorRaw);
    assert.equal(value.classified.relativeAspectError, ROOM_B_LIKE.compatibility.relativeAspectError);
    await assert.rejects(access(value.captureRoot));

    const executeRequest = request(value.materialized, "original_only");
    const validateRequest = {
      ...executeRequest,
      operation: "validate" as const,
    };
    let validationFetches = 0;
    let validationRuns = 0;
    let validationCaptureRootCalls = 0;
    let validationApiKeyCalls = 0;
    const validation = await runAfcUi2bControlledProposal(validateRequest, {
      replayPackage: value.replayPackage,
      resolveModel: () => "gemini-3.5-flash",
      resolveApiKey: () => {
        validationApiKeyCalls++;
        return "must-not-resolve";
      },
      captureRoot: () => {
        validationCaptureRootCalls++;
        return value.captureRoot;
      },
      fetchImpl: async () => {
        validationFetches++;
        throw new Error("validation must not call the provider");
      },
      runStudy: async () => {
        validationRuns++;
        throw new Error("validation must not invoke the runner");
      },
    });
    assert.equal(validation.status, "run_validated", JSON.stringify(validation));
    if (validation.status !== "run_validated") return;
    assert.equal(validation.studyMode, "original_only");
    assert.equal(validation.selectedImage.role, "original_photo_contextual_geometry");
    assert.equal(validation.selectedImage.sha256, value.originalEvidence.original.sha256);
    assert.deepEqual(
      { width: validation.selectedImage.decodedWidth, height: validation.selectedImage.decodedHeight },
      ROOM_B_LIKE.original,
    );
    assert.deepEqual(validation.compatibility, ROOM_B_LIKE.compatibility);
    assert.equal(validation.runner.runnerContractVersion, "afc-r3c-proposal-run-receipt/v1");
    assert.equal(validation.runner.promptRole, "original_photo_contextual_geometry");
    assert.equal(validation.runner.providerCallCount, 0);
    assert.equal(validation.runner.providerCall, false);
    assert.equal(validation.runner.captureWrite, false);
    assert.equal(validation.safety.proposalReceiptWritten, false);
    assert.equal(validationFetches, 0);
    assert.equal(validationRuns, 0);
    assert.equal(validationCaptureRootCalls, 0);
    assert.equal(validationApiKeyCalls, 0);
    await assert.rejects(access(value.captureRoot));

    const basis = deriveGeminiFloorBasisBinding(
      value.strictPackageReplay.evidence.receipt.sharedComparisonContext,
      GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
    );
    let providerCalls = 0;
    let providerImageData = "";
    let providerPartCount = 0;
    let runnerCalls = 0;
    let packageReplays = 0;
    let proposalReplays = 0;
    let studyResult: Awaited<ReturnType<typeof runAfcR3cGeminiFloorProposalStudy>> | null = null;
    const execution = await runAfcUi2bControlledProposal(executeRequest, {
      replayPackage: async (input) => {
        packageReplays++;
        return value.replayPackage(input);
      },
      replayProposal: async (input) => {
        proposalReplays++;
        return value.replayProposal(input);
      },
      captureRoot: () => value.captureRoot,
      repositoryRoot: () => value.root,
      resolveApiKey: () => "fake-key",
      resolveModel: () => "gemini-3.5-flash",
      runStudy: async (args) => {
        runnerCalls++;
        studyResult = await runAfcR3cGeminiFloorProposalStudy(args);
        return studyResult;
      },
      fetchImpl: async (_url, init) => {
        providerCalls++;
        const body = JSON.parse(String(init?.body)) as {
          contents: Array<{ parts: Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> }>;
        };
        providerPartCount = body.contents[0].parts.length;
        providerImageData = body.contents[0].parts[1].inlineData?.data ?? "";
        assert.equal(body.contents[0].parts[1].inlineData?.mimeType, value.originalEvidence.original.mimeType);
        return new Response(fakeEnvelope(basis), { status: 200 });
      },
    });
    assert.equal(execution.status, "run_completed", JSON.stringify(execution));
    if (execution.status !== "run_completed") return;
    assert.equal(runnerCalls, 1);
    assert.equal(packageReplays, 2, "admission and companion replay both use strict package authority");
    assert.equal(proposalReplays, 2, "controlled completion and companion replay both delegate to strict UI1 replay");
    assert.equal(providerCalls, 1);
    assert.equal(providerPartCount, 2);
    assert.equal(providerImageData, value.originalBytes.toString("base64"));
    assert.notEqual(providerImageData, value.emptyBytes.toString("base64"));
    assert.equal(execution.studyMode, "original_only");
    assert.equal(execution.selectedImage.role, "original_photo_contextual_geometry");
    assert.equal(execution.selectedImage.sha256, value.originalEvidence.original.sha256);
    assert.deepEqual(
      { width: execution.selectedImage.decodedWidth, height: execution.selectedImage.decodedHeight },
      ROOM_B_LIKE.original,
    );
    assert.deepEqual(execution.compatibility, ROOM_B_LIKE.compatibility);
    assert.equal(execution.runner.providerCallCount, 1);
    assert.equal(execution.runner.captureWrite, true);
    assert.equal(execution.runner.companionReceiptWritten, true);
    assert.equal(execution.proposal.armCount, 1);
    assert.equal(execution.proposal.candidateCount, 1);
    assert.equal(execution.proposal.strictReplayVerified, true);
    assert.equal(execution.safety.compositorCalls, false);
    assert.equal(execution.safety.emptyRoomGenerationCalls, false);
    assert.equal(execution.safety.afcR2Runs, false);

    const captureNames = (await readdir(value.captureRoot)).sort();
    assert.equal(captureNames.filter((name) => name.startsWith("provider-envelope.")).length, 1);
    assert.equal(captureNames.filter((name) => name.startsWith("model-output.")).length, 1);
    assert.equal(captureNames.filter((name) => /^afc-r3c-run\..*\.receipt\.json$/.test(name)).length, 1);
    assert.equal(captureNames.filter((name) => /^afc-ui2b-run\..*\.binding\.json$/.test(name)).length, 1);
    assert.equal(captureNames.some((name) => name.endsWith(".reservation")), false);

    const proposalReceiptPath = path.join(value.captureRoot, execution.proposal.receiptFileName);
    const proposalReceiptBytes = await readFile(proposalReceiptPath);
    const proposalReceipt = JSON.parse(proposalReceiptBytes.toString("utf8"));
    assert.equal(sha(proposalReceiptBytes), execution.proposal.receiptSha256);
    assert.equal(proposalReceipt.receiptContractVersion, "afc-r3c-proposal-run-receipt/v1");
    assert.equal(proposalReceipt.studyMode, "original_only");
    assert.equal(proposalReceipt.imageRole, "original_contextual");
    assert.deepEqual(proposalReceipt.inputImage, {
      fingerprint: value.originalEvidence.original.sha256,
      decodedWidth: ROOM_B_LIKE.original.width,
      decodedHeight: ROOM_B_LIKE.original.height,
      orientation: 1,
      mimeType: value.originalEvidence.original.mimeType,
    });
    assert.equal(proposalReceipt.originalImageFingerprint, value.originalEvidence.original.sha256);
    assert.equal(proposalReceipt.emptyRoomAssistFingerprint, value.emptyEvidence.emptyRoomAssist.sha256);
    assert.deepEqual(proposalReceipt.compatibility, {
      tier: ROOM_B_LIKE.compatibility.tier,
      relativeAspectErrorRaw: ROOM_B_LIKE.compatibility.relativeAspectErrorRaw,
      relativeAspectError: ROOM_B_LIKE.compatibility.relativeAspectError,
    });

    const completedStudy = studyResult as Awaited<ReturnType<typeof runAfcR3cGeminiFloorProposalStudy>> | null;
    if (!completedStudy) throw new Error("The real AFC-R3C runner result was not captured.");
    const armRun = completedStudy.arms[0]?.proposalRun;
    assert.ok(armRun);
    if (!armRun) throw new Error("The real AFC-R3C proposal run was not captured.");
    assert.equal(armRun.transfer.compatibilityTier, "exact_grid_compatible");
    assert.equal(armRun.transfer.relativeAspectErrorRaw, 0);
    assert.equal(armRun.transfer.relativeAspectError, 0);
    assert.equal(armRun.provenance.compatibilityTier, "exact_grid_compatible");
    assert.equal(armRun.provenance.relativeAspectErrorRaw, 0);
    assert.equal(armRun.provenance.relativeAspectError, 0);
    assert.notEqual(armRun.transfer.compatibilityTier, proposalReceipt.compatibility.tier);
    assert.notEqual(armRun.provenance.compatibilityTier, proposalReceipt.compatibility.tier);

    const proposalReplay = await value.replayProposal({
      receiptFileName: execution.proposal.receiptFileName,
      captureRoot: value.captureRoot,
    });
    assert.equal(proposalReplay.status, "valid", proposalReplay.status === "valid" ? "" : `${proposalReplay.reason} (${proposalReplay.path})`);
    if (proposalReplay.status !== "valid") return;
    assert.equal(proposalReplay.viewModel.artifactIdentity.receiptSha256, execution.proposal.receiptSha256);
    assert.equal(proposalReplay.viewModel.artifactIdentity.studyMode, "original_only");
    assert.equal(proposalReplay.viewModel.artifactIdentity.imageRole, "original_contextual");
    assert.equal(proposalReplay.viewModel.imageBasis.basisBinding, basis);
    assert.equal(proposalReplay.viewModel.imageBasis.manifestVersion, "afc-r3c-image-manifest/v1");
    assert.deepEqual(
      {
        sha256: proposalReplay.viewModel.imageBasis.original.sha256,
        width: proposalReplay.viewModel.imageBasis.original.width,
        height: proposalReplay.viewModel.imageBasis.original.height,
      },
      {
        sha256: value.originalEvidence.original.sha256,
        width: ROOM_B_LIKE.original.width,
        height: ROOM_B_LIKE.original.height,
      },
    );
    assert.deepEqual(
      {
        sha256: proposalReplay.viewModel.imageBasis.emptyRoom.sha256,
        width: proposalReplay.viewModel.imageBasis.emptyRoom.width,
        height: proposalReplay.viewModel.imageBasis.emptyRoom.height,
        generatedFromOriginalSha256: proposalReplay.viewModel.imageBasis.emptyRoom.generatedFromOriginalSha256,
      },
      {
        sha256: value.emptyEvidence.emptyRoomAssist.sha256,
        width: ROOM_B_LIKE.empty.width,
        height: ROOM_B_LIKE.empty.height,
        generatedFromOriginalSha256: value.originalEvidence.original.sha256,
      },
    );
    assert.equal(proposalReplay.images.original.sha256, value.originalEvidence.original.sha256);
    assert.equal(proposalReplay.images.empty.sha256, value.emptyEvidence.emptyRoomAssist.sha256);
    assert.equal(proposalReplay.images.original.bytes.equals(value.originalBytes), true);
    assert.equal(proposalReplay.images.empty.bytes.equals(value.emptyBytes), true);
    assert.deepEqual(proposalReplay.viewModel.provenance.prompt, proposalReceipt.prompt);
    assert.deepEqual(proposalReplay.viewModel.provenance.afcR3b.candidateIds, proposalReceipt.afcR3b.candidateIds);
    assert.deepEqual(proposalReplay.viewModel.provenance.afcR3c.candidateIds, proposalReceipt.afcR3c.candidateIds);
    assert.deepEqual(proposalReplay.viewModel.provenance.afcR3c.candidateIds, execution.proposal.acceptedCandidateIds);
    assert.equal(proposalReplay.viewModel.provenance.artifactHashes.receiptSha256, execution.proposal.receiptSha256);
    assert.equal(proposalReplay.viewModel.provenance.artifactHashes.providerEnvelopeSha256, proposalReceipt.provider.providerEnvelopeSha256);
    assert.equal(proposalReplay.viewModel.provenance.artifactHashes.modelOutputSha256, proposalReceipt.provider.modelOutputTextSha256);
    const providerEnvelopeBytes = await readFile(path.join(value.captureRoot, path.basename(proposalReceipt.capture.providerEnvelopePath)));
    const modelOutputBytes = await readFile(path.join(value.captureRoot, path.basename(proposalReceipt.capture.modelOutputPath)));
    assert.equal(sha(providerEnvelopeBytes), proposalReceipt.provider.providerEnvelopeSha256);
    assert.equal(providerEnvelopeBytes.byteLength, proposalReceipt.provider.providerEnvelopeByteLength);
    assert.equal(sha(modelOutputBytes), proposalReceipt.provider.modelOutputTextSha256);
    assert.equal(modelOutputBytes.byteLength, proposalReceipt.provider.modelOutputUtf8ByteLength);
    const manifestBytes = await readFile(path.join(value.roomDirectory, value.materialized.manifest.fileName));
    assert.equal(sha(manifestBytes), value.materialized.manifest.sha256);
    assert.equal(value.strictPackageReplay.evidence.receipt.manifest.sha256, value.materialized.manifest.sha256);
    const recomputedCompatibility = classifyAfcR3cImagePairCompatibility(
      {
        fingerprint: proposalReplay.images.original.sha256,
        decodedWidth: proposalReplay.images.original.width,
        decodedHeight: proposalReplay.images.original.height,
        orientation: 1,
      },
      {
        fingerprint: proposalReplay.images.empty.sha256,
        decodedWidth: proposalReplay.images.empty.width,
        decodedHeight: proposalReplay.images.empty.height,
        orientation: 1,
      },
    );
    assert.deepEqual(proposalReceipt.compatibility, {
      tier: recomputedCompatibility.tier,
      relativeAspectErrorRaw: recomputedCompatibility.relativeAspectErrorRaw,
      relativeAspectError: recomputedCompatibility.relativeAspectError,
    });

    const companionFileName = afcUi2bProposalBindingReceiptFileName(execution.proposal.receiptSha256);
    const companionBytes = await readFile(path.join(value.captureRoot, companionFileName));
    const companionSha256 = sha(companionBytes);
    const companionRaw = JSON.parse(companionBytes.toString("utf8"));
    const parsedCompanion = parseAfcUi2bBindingReceipt(companionRaw);
    assert.equal(parsedCompanion.ok, true);
    if (!parsedCompanion.ok) return;
    assert.equal(companionFileName, `afc-ui2b-run.${execution.proposal.receiptSha256}.binding.json`);
    assert.equal(sha(stableReceiptBytes(parsedCompanion.receipt)), companionSha256);
    assert.equal(parsedCompanion.receipt.package.packageId, value.materialized.packageId);
    assert.equal(parsedCompanion.receipt.package.receiptSha256, value.materialized.receipt.sha256);
    assert.equal(parsedCompanion.receipt.proposal.receiptFileName, execution.proposal.receiptFileName);
    assert.equal(parsedCompanion.receipt.proposal.receiptSha256, execution.proposal.receiptSha256);
    assert.equal(parsedCompanion.receipt.manifest.sha256, value.materialized.manifest.sha256);
    assert.equal(Object.hasOwn(companionRaw, "compatibility"), false);
    const companionReplay = await replayAfcUi2bBindingReceipt({
      roomLabel: ROOM_B_LIKE.roomId,
      bindingFileName: companionFileName,
    }, {
      captureRoot: () => value.captureRoot,
      replayPackage: value.replayPackage,
      replayProposal: value.replayProposal,
    });
    assert.equal(companionReplay.status, "valid");
    if (companionReplay.status !== "valid") return;
    assert.equal(companionReplay.summary.packageId, value.materialized.packageId);
    assert.equal(companionReplay.summary.proposal.receiptSha256, execution.proposal.receiptSha256);
    assert.equal(companionReplay.summary.proposal.strictReplayVerified, true);

    const inventory = await discoverAfcUi2bProposalRuns({
      roomLabel: ROOM_B_LIKE.roomId,
      packageId: value.materialized.packageId,
      studyMode: "original_only",
    }, {
      captureRoot: () => value.captureRoot,
      replayPackage: value.replayPackage,
      replayProposal: value.replayProposal,
    });
    assert.equal(inventory.status, "inventory");
    if (inventory.status !== "inventory") return;
    assert.equal(inventory.roomId, ROOM_B_LIKE.roomId);
    assert.equal(inventory.runs.length, 1);
    assert.equal(inventory.invalidCandidateCount, 0);
    assert.deepEqual(inventory.runs[0], companionReplay.summary);
    assert.equal(inventory.runs[0].studyMode, "original_only");
    assert.equal(inventory.runs[0].proposal.receiptSha256, execution.proposal.receiptSha256);
    assert.equal(inventory.runs[0].proposal.candidateCount, 1);
    assert.deepEqual(inventory.runs[0].proposal.acceptedCandidateIds, execution.proposal.acceptedCandidateIds);
    assert.equal(inventory.runs[0].proposal.strictReplayVerified, true);
    assert.equal(JSON.stringify(inventory).includes(value.root), false);
    assert.equal(JSON.stringify(inventory).includes(value.roomDirectory), false);
    assert.equal(deeplyFrozen(inventory), true);

    const immutableSnapshot = await captureSnapshot(value.captureRoot);
    const repeatedProposalReplay = await value.replayProposal({
      receiptFileName: execution.proposal.receiptFileName,
      captureRoot: value.captureRoot,
    });
    const repeatedCompanionReplay = await replayAfcUi2bBindingReceipt({
      roomLabel: ROOM_B_LIKE.roomId,
      bindingFileName: companionFileName,
    }, {
      captureRoot: () => value.captureRoot,
      replayPackage: value.replayPackage,
      replayProposal: value.replayProposal,
    });
    const repeatedInventory = await discoverAfcUi2bProposalRuns({ roomLabel: ROOM_B_LIKE.roomId }, {
      captureRoot: () => value.captureRoot,
      replayPackage: value.replayPackage,
      replayProposal: value.replayProposal,
    });
    assert.deepEqual(repeatedProposalReplay, proposalReplay);
    assert.deepEqual(repeatedCompanionReplay, companionReplay);
    assert.deepEqual(repeatedInventory, inventory);
    assert.deepEqual(await captureSnapshot(value.captureRoot), immutableSnapshot);
    assert.equal(providerCalls, 1);
    assert.equal((await readdir(value.captureRoot)).filter((name) => name.startsWith("provider-envelope.")).length, 1);
    assert.equal((await readdir(value.captureRoot)).filter((name) => name.startsWith("model-output.")).length, 1);
    assert.equal((await readdir(value.captureRoot)).filter((name) => /^afc-r3c-run\..*\.receipt\.json$/.test(name)).length, 1);
    assert.equal((await readdir(value.captureRoot)).filter((name) => /^afc-ui2b-run\..*\.binding\.json$/.test(name)).length, 1);
    assert.equal(value.materialized.packageId, value.strictPackageReplay.evidence.packageId);
    assert.equal(sha(await readFile(proposalReceiptPath)), execution.proposal.receiptSha256);
    assert.equal(sha(await readFile(path.join(value.captureRoot, companionFileName))), companionSha256);

    const tamperedReceipt = JSON.parse(proposalReceiptBytes.toString("utf8"));
    tamperedReceipt.compatibility = {
      tier: "exact_grid_compatible",
      relativeAspectErrorRaw: 0,
      relativeAspectError: 0,
    };
    const tamperedReceiptFileName = execution.proposal.receiptFileName.replace(
      /\.receipt\.json$/,
      ".tampered-compatibility.receipt.json",
    );
    const tamperedReceiptBytes = stableReceiptBytes(tamperedReceipt);
    const tamperedWrite = await writeAfcR3cImmutableCapture({
      outputDir: value.captureRoot,
      filename: tamperedReceiptFileName,
      bytes: tamperedReceiptBytes,
    });
    assert.equal(tamperedWrite.ok, true);
    const tamperedReceiptSha256 = sha(tamperedReceiptBytes);
    const tamperedCompanionFileName = afcUi2bProposalBindingReceiptFileName(tamperedReceiptSha256);
    await assert.rejects(access(path.join(value.captureRoot, tamperedCompanionFileName)));
    const negativeReplay = await value.replayProposal({
      receiptFileName: tamperedReceiptFileName,
      captureRoot: value.captureRoot,
    });
    assert.equal(negativeReplay.status, "basis_mismatch");
    if (negativeReplay.status === "basis_mismatch") assert.equal(negativeReplay.path, "$.compatibility");
    await assert.rejects(access(path.join(value.captureRoot, tamperedCompanionFileName)));
    assert.equal((await readdir(value.captureRoot)).filter((name) => /^afc-ui2b-run\..*\.binding\.json$/.test(name)).length, 1);
    const inventoryAfterTamper = await discoverAfcUi2bProposalRuns({ roomLabel: ROOM_B_LIKE.roomId }, {
      captureRoot: () => value.captureRoot,
      replayPackage: value.replayPackage,
      replayProposal: value.replayProposal,
    });
    assert.equal(inventoryAfterTamper.status, "inventory");
    if (inventoryAfterTamper.status === "inventory") {
      assert.equal(inventoryAfterTamper.runs.length, 1);
      assert.equal(inventoryAfterTamper.invalidCandidateCount, 0);
      assert.equal(inventoryAfterTamper.runs[0].proposal.receiptSha256, execution.proposal.receiptSha256);
      assert.notEqual(inventoryAfterTamper.runs[0].proposal.receiptSha256, tamperedReceiptSha256);
    }
    assert.equal(providerCalls, 1, "negative replay never reaches the provider");
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

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
