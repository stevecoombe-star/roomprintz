import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { deriveGeminiFloorBasisBinding, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY, parseGeminiFloorProposalResponse } from "./gemini-floor-proposal-contract";
import {
  discoverAfcProposalReceipts,
  deriveAfcProposalOperatorWarnings,
  replayAfcProposalOverlay,
  resolveAfcUi1FixedInputsRoot,
} from "./afc-proposal-overlay-view-model";

const repositoryRoot = process.cwd();
const captureRoot = path.join(repositoryRoot, ".local", "afc-r3c-captures");
const fixedInputsRoot = path.join(process.env.HOME ?? "/Users/stevecoombe", "Downloads", "vibode-afc-r3c-fixed-inputs");
const receiptFileName = "afc-r3c-run.room-a-empty-only-live3-20260728T015122Z.empty.receipt.json";
const live3Available = existsSync(path.join(captureRoot, receiptFileName)) && existsSync(fixedInputsRoot);
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh0QAAAABJRU5ErkJggg==", "base64");
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

type PortableFixture = {
  root: string;
  captureRoot: string;
  fixedRoot: string;
  roomRoot: string;
  receiptFileName: string;
  receiptPath: string;
  envelopePath: string;
  modelPath: string;
  originalPath: string;
  emptyPath: string;
  manifestPath: string;
};

async function createPortableFixture(): Promise<PortableFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui1-"));
  const captureRoot = path.join(root, "captures");
  const fixedRoot = path.join(root, "fixed-inputs");
  const roomRoot = path.join(fixedRoot, "room-a");
  const originalName = "original.png";
  const emptyName = "empty.png";
  const originalSha = sha256(PNG_1X1);
  const context = {
    ratioFovContractVersion: "ratio-fov-harness/v1",
    basisId: "portable-original",
    basisFingerprint: originalSha,
    decoderId: "sharp-metadata/v1",
    normalizationPolicyVersion: "source-normalized/v1",
    decodedWidth: 1,
    decodedHeight: 1,
    frameSize: { width: 1, height: 1 },
    orientationApplied: false,
    basisKind: "original",
    ratioDomain: { min: 0.5, max: 2, step: 0.05 },
    fovDomain: { minDeg: 20, maxDeg: 90, stepDeg: 1 },
    refinement: { enabled: true, ratioStep: 0.005, fovStepDeg: 0.1, basinFactor: 1.25, additivePxAllowance: 0.25 },
    referenceDepth: 1,
  } as const;
  const basis = deriveGeminiFloorBasisBinding(context as never, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY);
  const modelJson = {
    schema_version: "afc-r3-floor-hypotheses/v1",
    basis_binding: basis,
    status: "proposals",
    proposals: [{
      corners: {
        NL: { x: 0, y: 0.9, support: "direct_visible" },
        NR: { x: 1, y: 0.9, support: "direct_visible" },
        FR: { x: 0.7, y: 0.5, support: "direct_visible" },
        FL: { x: 0.3, y: 0.5, support: "direct_visible" },
      },
      edge_evidence: {
        near: { support: "direct_visible", note: "The near seam is fully visible." },
        right: { support: "direct_visible", note: "The right seam is fully visible." },
        far: { support: "direct_visible", note: "The far seam is fully visible." },
        left: { support: "direct_visible", note: "The left seam is fully visible." },
      },
    }],
  };
  const modelText = JSON.stringify(modelJson, null, 2);
  const modelSha = sha256(modelText);
  const r3b = parseGeminiFloorProposalResponse(modelText, {
    sharedComparisonContext: context as never,
    coordinateExtentPolicy: GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
    auditProvenance: { requestId: "portable.empty", contractVersion: "AFC-R3B/v1", promptVersion: "portable-prompt", providerId: "portable", modelId: "portable", responseReceivedAt: "2026-01-01T00:00:00.000Z", rawResponseSha256: modelSha },
  });
  assert.equal(r3b.status, "proposals");
  if (r3b.status !== "proposals") throw new Error("Portable R3B fixture must parse.");
  const envelope = {
    candidates: [{ content: { parts: [{ text: modelText }], role: "model" }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2, promptTokensDetails: [{ modality: "IMAGE", tokenCount: 1 }, { modality: "TEXT", tokenCount: 0 }], serviceTier: "standard" },
    modelVersion: "portable-model",
    responseId: "must-not-reach-browser",
  };
  const envelopeText = JSON.stringify(envelope, null, 2);
  const envelopeSha = sha256(envelopeText);
  const modelName = `model-output.${modelSha}.json`;
  const envelopeName = `provider-envelope.${envelopeSha}.json`;
  const receiptFileName = "afc-r3c-run.portable.empty.receipt.json";
  const receipt = {
    receiptContractVersion: "afc-r3c-proposal-run-receipt/v1",
    requestId: "portable.empty",
    createdAt: "2026-01-01T00:00:00.000Z",
    roomId: "room-a",
    studyMode: "empty_only",
    imageRole: "empty_room_boundary_specialist",
    inputImage: { fingerprint: originalSha, decodedWidth: 1, decodedHeight: 1, orientation: 1, mimeType: "image/png" },
    originalImageFingerprint: originalSha,
    emptyRoomAssistFingerprint: originalSha,
    compatibility: { tier: "exact_grid_compatible", relativeAspectErrorRaw: 0, relativeAspectError: 0 },
    prompt: { contractVersion: "portable/v1", version: "portable-prompt", sha256: "a".repeat(64) },
    provider: {
      providerId: "portable", modelId: "portable", generationConfig: { contractVersion: "afc-r3c-gemini-generation/v1", temperature: 0.1, maxOutputTokens: 1, responseMimeType: "application/json", thinkingLevel: "minimal", thinkingLevelApplied: true },
      providerEnvelopeSha256: envelopeSha, providerEnvelopeByteLength: Buffer.byteLength(envelopeText), modelOutputTextSha256: modelSha, modelOutputUtf8ByteLength: Buffer.byteLength(modelText), finishReason: "STOP", providerModelVersion: "portable-model",
      usageMetadata: envelope.usageMetadata, extractionPolicyVersion: "portable-extraction/v1",
    },
    afcR3b: { status: "proposals", failureReason: null, failurePath: null, candidateIds: r3b.candidates.map((candidate) => candidate.candidateId) },
    afcR3c: { compositionStatus: "proposals", candidateIds: r3b.candidates.map((candidate) => `afc-r3c:empty:${candidate.candidateId}`) },
    afcR2: { comparisonFingerprint: null, selectionState: "not_run" },
    capture: { providerEnvelopePath: envelopeName, modelOutputPath: modelName },
    safety: { researchOnly: true, applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true, noCompositorCall: true, noUserTokenAccounting: true },
  };
  const manifest = {
    contractVersion: "afc-r3c-image-manifest/v1", roomId: "room-a",
    original: { filePath: originalName, sha256: originalSha, byteCount: PNG_1X1.byteLength, decodedWidth: 1, decodedHeight: 1, orientation: 1, mimeType: "image/png" },
    emptyRoomAssist: { filePath: emptyName, sha256: originalSha, byteCount: PNG_1X1.byteLength, decodedWidth: 1, decodedHeight: 1, orientation: 1, mimeType: "image/png", generatedFromOriginalSha256: originalSha, generatorId: "portable", generatorModelId: "portable" },
    sharedComparisonContext: context,
  };
  await Promise.all([mkdir(captureRoot, { recursive: true }), mkdir(roomRoot, { recursive: true })]);
  const receiptPath = path.join(captureRoot, receiptFileName);
  const envelopePath = path.join(captureRoot, envelopeName);
  const modelPath = path.join(captureRoot, modelName);
  const originalPath = path.join(roomRoot, originalName);
  const emptyPath = path.join(roomRoot, emptyName);
  const manifestPath = path.join(roomRoot, "afc-r3c-room-a.image-manifest.v1.json");
  await Promise.all([writeFile(receiptPath, JSON.stringify(receipt, null, 2)), writeFile(envelopePath, envelopeText), writeFile(modelPath, modelText), writeFile(originalPath, PNG_1X1), writeFile(emptyPath, PNG_1X1), writeFile(manifestPath, JSON.stringify(manifest, null, 2))]);
  return { root, captureRoot, fixedRoot, roomRoot, receiptFileName, receiptPath, envelopePath, modelPath, originalPath, emptyPath, manifestPath };
}

async function withPortableFixture(run: (fixture: PortableFixture) => Promise<void>) {
  const fixture = await createPortableFixture();
  try { await run(fixture); } finally { await rm(fixture.root, { recursive: true, force: true }); }
}

async function portableReplay(fixture: PortableFixture) {
  return replayAfcProposalOverlay({ receiptFileName: fixture.receiptFileName, captureRoot: fixture.captureRoot, fixedInputsRoot: fixture.fixedRoot, resolveFixedInputsRoot: async () => realpath(fixture.fixedRoot) });
}

async function retiePortableModelArtifacts(fixture: PortableFixture, mutate: (model: Record<string, unknown>) => void) {
  const receipt = JSON.parse(await readFile(fixture.receiptPath, "utf8"));
  const model = JSON.parse(await readFile(fixture.modelPath, "utf8"));
  mutate(model);
  const modelText = JSON.stringify(model, null, 2);
  const modelSha = sha256(modelText);
  const envelope = JSON.parse(await readFile(fixture.envelopePath, "utf8"));
  envelope.candidates[0].content.parts[0].text = modelText;
  const envelopeText = JSON.stringify(envelope, null, 2);
  const envelopeSha = sha256(envelopeText);
  const modelName = `model-output.${modelSha}.json`;
  const envelopeName = `provider-envelope.${envelopeSha}.json`;
  receipt.provider.modelOutputTextSha256 = modelSha;
  receipt.provider.modelOutputUtf8ByteLength = Buffer.byteLength(modelText);
  receipt.provider.providerEnvelopeSha256 = envelopeSha;
  receipt.provider.providerEnvelopeByteLength = Buffer.byteLength(envelopeText);
  receipt.capture.modelOutputPath = modelName;
  receipt.capture.providerEnvelopePath = envelopeName;
  await Promise.all([
    writeFile(path.join(fixture.captureRoot, modelName), modelText),
    writeFile(path.join(fixture.captureRoot, envelopeName), envelopeText),
    writeFile(fixture.receiptPath, JSON.stringify(receipt, null, 2)),
  ]);
}

test("AFC-UI1 replays the immutable Room A live3 receipt", { skip: !live3Available }, async () => {
  const replay = await replayAfcProposalOverlay({ receiptFileName, captureRoot, fixedInputsRoot });
  assert.equal(replay.status, "valid", replay.status === "valid" ? "" : `${replay.reason} (${replay.path})`);
  if (replay.status !== "valid") return;
  const view = replay.viewModel;
  assert.equal(view.artifactIdentity.receiptSha256, "0a78dae004a8a22683ffbd1e3e48b510715cecb852d16de3a60525154e2d68ed");
  assert.equal(view.provenance.artifactHashes.providerEnvelopeSha256, "c7fdf7884e93ed61a715e282737b0ccfe22fe25e60416204e64259ce357711c1");
  assert.equal(view.provenance.artifactHashes.modelOutputSha256, "1dd7de954d60a590e88600bdf9c6bf19e0d8870b8123e8a22d661eafb4361268");
  assert.equal(view.candidate.r3bCandidateId, "afc-r3:fnv1a32:0b43131e#01");
  assert.equal(view.candidate.r3cCandidateId, "afc-r3c:empty:afc-r3:fnv1a32:0b43131e#01");
  assert.deepEqual(view.corners, {
    NL: { x: 0, y: 0.98, support: "direct_visible" },
    NR: { x: 1, y: 0.93, support: "direct_visible" },
    FR: { x: 0.69, y: 0.64, support: "direct_visible" },
    FL: { x: 0.36, y: 0.65, support: "direct_visible" },
  });
  assert.equal(view.edges.near.support, "direct_visible");
  assert.equal(view.edges.near.note, "The bottom edge of the image frame cuts across the visible floor surface.");
  assert.equal(view.provenance.afcR2.selectionState, "not_run");
  assert.deepEqual(view.safety, { researchOnly: true, applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true });
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.corners), true);
  assert.equal(Object.isFrozen(view.corners.NL), true);
  assert.equal((view.raw.receipt as { capture: { providerEnvelopePath: string } }).capture.providerEnvelopePath.startsWith("/"), false);
  assert.equal("providerEnvelope" in view.raw, false);
  assert.equal(JSON.stringify(view).includes("responseId"), false);
  assert.equal(JSON.stringify(view).includes("thoughtSignature"), false);
  assert.ok(view.warnings.some((warning) => warning.includes("Operator qualification — validated near-edge evidence")));
});

test("AFC-UI1 discovery lists only strict supported receipts", { skip: !live3Available }, async () => {
  const receipts = await discoverAfcProposalReceipts({ captureRoot });
  assert.ok(receipts.some((receipt) => receipt.receiptFileName === receiptFileName));
  assert.ok(receipts.every((receipt) => !receipt.receiptFileName.includes("/")));
});

test("AFC-UI1 fails closed for traversal, missing roots, and missing artifacts", async () => {
  assert.equal((await replayAfcProposalOverlay({ receiptFileName: "../escape.receipt.json", captureRoot, fixedInputsRoot })).status, "invalid");
  assert.equal((await replayAfcProposalOverlay({ receiptFileName, captureRoot, fixedInputsRoot: "" })).status, "invalid");
  assert.equal((await replayAfcProposalOverlay({ receiptFileName, captureRoot: path.join(repositoryRoot, ".local", "missing"), fixedInputsRoot })).status, "invalid");
  assert.equal(await resolveAfcUi1FixedInputsRoot("/tmp/vibode-afc-r3c-fixed-inputs"), null);
});

test("AFC-UI1 replay boundary does not import provider or writer modules", async () => {
  const source = await readFile(new URL("./afc-proposal-overlay-view-model.ts", import.meta.url), "utf8");
  for (const forbidden of ["gemini-floor-proposal-provider", "gemini-floor-proposal-runner", "afc-r3c-fixed-empty-room-capture", "writeAfcR3cImmutableCapture"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("AFC-UI1 frame-truncation qualifications are deterministic and preserve evidence", () => {
  const live3 = deriveAfcProposalOperatorWarnings({
    corners: {
      NL: { x: 0, y: 0.98, support: "direct_visible" },
      NR: { x: 1, y: 0.93, support: "direct_visible" },
      FR: { x: 0.69, y: 0.64, support: "direct_visible" },
      FL: { x: 0.36, y: 0.65, support: "direct_visible" },
    },
    near: { support: "direct_visible", note: "The bottom edge of the image frame cuts across the visible floor surface." },
  });
  const fullyVisible = deriveAfcProposalOperatorWarnings({
    corners: {
      NL: { x: 0, y: 0.8, support: "direct_visible" },
      NR: { x: 1, y: 0.8, support: "direct_visible" },
      FR: { x: 0.7, y: 0.5, support: "direct_visible" },
      FL: { x: 0.3, y: 0.5, support: "direct_visible" },
    },
    near: { support: "direct_visible", note: "The near wall-floor seam is fully visible." },
  });
  const outsideFrame = deriveAfcProposalOperatorWarnings({
    corners: {
      NL: { x: -0.1, y: 0.8, support: "outside_frame_inferred" },
      NR: { x: 1, y: 0.8, support: "direct_visible" },
      FR: { x: 0.7, y: 0.5, support: "direct_visible" },
      FL: { x: 0.3, y: 0.5, support: "direct_visible" },
    },
    near: { support: "direct_visible", note: "The near wall-floor seam is fully visible." },
  });
  assert.equal(live3.length, 1);
  assert.equal(fullyVisible.length, 0);
  assert.ok(outsideFrame.some((warning) => warning.includes("extend outside the visible image frame")));
});

test("AFC-UI1 portable replay validates the full browser-safe integrity chain", async () => {
  await withPortableFixture(async (fixture) => {
    const replay = await portableReplay(fixture);
    assert.equal(replay.status, "valid", replay.status === "valid" ? "" : `${replay.reason} (${replay.path})`);
    if (replay.status !== "valid") return;
    assert.equal("providerEnvelope" in replay.viewModel.raw, false);
    assert.equal(JSON.stringify(replay.viewModel).includes("must-not-reach-browser"), false);
    assert.equal(replay.viewModel.provenance.artifactHashes.providerEnvelopeSha256.length, 64);
    assert.equal(replay.viewModel.warnings.some((warning) => warning.includes("frame truncation")), false);
  });
});

test("AFC-UI1 fails closed for tampered immutable artifacts", async () => {
  const cases: ReadonlyArray<readonly [keyof PortableFixture, string]> = [
    ["modelPath", "model output"], ["envelopePath", "provider envelope"], ["originalPath", "Original image"], ["emptyPath", "Empty image"],
  ];
  for (const [field, label] of cases) {
    await withPortableFixture(async (fixture) => {
      await writeFile(fixture[field], Buffer.from(`tampered ${label}`));
      const replay = await portableReplay(fixture);
      assert.notEqual(replay.status, "valid", label);
    });
  }
});

test("AFC-UI1 enforces provider-envelope/model-output equality after hash verification", async () => {
  await withPortableFixture(async (fixture) => {
    const receipt = JSON.parse(await readFile(fixture.receiptPath, "utf8"));
    const envelope = JSON.parse(await readFile(fixture.envelopePath, "utf8"));
    envelope.candidates[0].content.parts[0].text = "{\"different\":true}";
    const envelopeText = JSON.stringify(envelope, null, 2);
    const envelopeSha = sha256(envelopeText);
    const envelopeName = `provider-envelope.${envelopeSha}.json`;
    receipt.provider.providerEnvelopeSha256 = envelopeSha;
    receipt.provider.providerEnvelopeByteLength = Buffer.byteLength(envelopeText);
    receipt.capture.providerEnvelopePath = envelopeName;
    await Promise.all([
      writeFile(path.join(fixture.captureRoot, envelopeName), envelopeText),
      writeFile(fixture.receiptPath, JSON.stringify(receipt, null, 2)),
    ]);
    assert.notEqual((await portableReplay(fixture)).status, "valid");
  });
});

test("AFC-UI1 fails closed for receipt binding and manifest integrity mismatches", async () => {
  const mutations: ReadonlyArray<readonly [string, (fixture: PortableFixture) => Promise<void>]> = [
    ["basis binding", async (fixture) => {
      await retiePortableModelArtifacts(fixture, (model) => {
        model.basis_binding = "afc-r3b:" + "0".repeat(64);
      });
    }],
    ["R3B candidate id", async (fixture) => {
      const receipt = JSON.parse(await readFile(fixture.receiptPath, "utf8"));
      receipt.afcR3b.candidateIds = ["afc-r3:wrong#01"];
      await writeFile(fixture.receiptPath, JSON.stringify(receipt));
    }],
    ["R3C candidate id", async (fixture) => {
      const receipt = JSON.parse(await readFile(fixture.receiptPath, "utf8"));
      receipt.afcR3c.candidateIds = ["afc-r3c:empty:wrong#01"];
      await writeFile(fixture.receiptPath, JSON.stringify(receipt));
    }],
    ["unsafe safety flag", async (fixture) => {
      const receipt = JSON.parse(await readFile(fixture.receiptPath, "utf8"));
      receipt.safety.applied = true;
      await writeFile(fixture.receiptPath, JSON.stringify(receipt));
    }],
    ["malformed manifest", async (fixture) => await writeFile(fixture.manifestPath, "{")],
    ["manifest room id", async (fixture) => {
      const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
      manifest.roomId = "room-b";
      await writeFile(fixture.manifestPath, JSON.stringify(manifest));
    }],
    ["image dimensions", async (fixture) => {
      const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
      manifest.original.decodedWidth = 2;
      await writeFile(fixture.manifestPath, JSON.stringify(manifest));
    }],
    ["image MIME", async (fixture) => {
      const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
      manifest.original.mimeType = "image/jpeg";
      await writeFile(fixture.manifestPath, JSON.stringify(manifest));
    }],
    ["empty lineage", async (fixture) => {
      const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
      manifest.emptyRoomAssist.generatedFromOriginalSha256 = "0".repeat(64);
      await writeFile(fixture.manifestPath, JSON.stringify(manifest));
    }],
  ];
  for (const [label, mutate] of mutations) {
    await withPortableFixture(async (fixture) => {
      await mutate(fixture);
      const replay = await portableReplay(fixture);
      assert.notEqual(replay.status, "valid", label);
      if (label === "basis binding") assert.equal(replay.status, "basis_mismatch");
    });
  }
});

test("AFC-UI1 actual filesystem resolver rejects symlinked artifacts and roots", async () => {
  const fields: ReadonlyArray<keyof Pick<PortableFixture, "receiptPath" | "modelPath" | "envelopePath" | "manifestPath" | "originalPath" | "emptyPath">> = [
    "receiptPath", "modelPath", "envelopePath", "manifestPath", "originalPath", "emptyPath",
  ];
  for (const field of fields) {
    await withPortableFixture(async (fixture) => {
      const target = fixture[field];
      const outside = path.join(fixture.root, `outside-${field}`);
      await writeFile(outside, await readFile(target));
      await rm(target);
      await symlink(outside, target);
      assert.notEqual((await portableReplay(fixture)).status, "valid", field);
    });
  }
  await withPortableFixture(async (fixture) => {
    const prefixCollision = `${fixture.fixedRoot}-evil`;
    await mkdir(prefixCollision, { recursive: true });
    try {
      assert.notEqual((await replayAfcProposalOverlay({
        receiptFileName: fixture.receiptFileName,
        captureRoot: fixture.captureRoot,
        fixedInputsRoot: prefixCollision,
        resolveFixedInputsRoot: async () => prefixCollision,
      })).status, "valid");
    } finally {
      await rm(prefixCollision, { recursive: true, force: true });
    }
  });
});
