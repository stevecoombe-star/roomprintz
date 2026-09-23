import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { stableReceiptBytes, writeAfcR3cImmutableCapture } from "./gemini-floor-proposal-capture";
import { AFC_UI2B_BINDING_RECEIPT_VERSION, afcUi2bProposalBindingReceiptFileName, parseAfcUi2bBindingReceipt } from "./afc-ui2b-proposal-run";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const packageDigest = "a".repeat(64);
const proposalDigest = "b".repeat(64);
function receipt(mode: "original_only" | "empty_only" = "original_only") {
  const role = mode === "original_only" ? "original_photo_contextual_geometry" : "empty_room_boundary_specialist";
  return {
    receiptContractVersion: AFC_UI2B_BINDING_RECEIPT_VERSION,
    roomId: "room-a",
    package: {
      packageId: `afc-ui2a-package:room-a:${packageDigest}`,
      receiptFileName: `afc-ui2a-prepared-input.room-a.${packageDigest}.receipt.json`,
      receiptSha256: "c".repeat(64),
    },
    manifest: { fileName: "afc-r3c-room-a.image-manifest.v1.json", sha256: "d".repeat(64) },
    studyMode: mode,
    selectedImage: { role, fileName: `room-a.${mode}.png`, sha256: "e".repeat(64) },
    sharedContextDigest: "f".repeat(64),
    proposal: { receiptFileName: "afc-r3c-run.room-a-fixture.original.receipt.json", receiptSha256: proposalDigest },
    providerCallCount: 1,
    runner: { contractVersion: "afc-r3c-proposal-run-receipt/v1", promptRole: role, modelId: "gemini-fixture" },
    safety: {
      authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true, floorStateUnchanged: true,
      supportStateUnchanged: true, databaseWrites: false, productionAssetWrites: false, productionTokenAccountingUsed: false,
      compositorCalls: false, emptyRoomGenerationCalls: false, geminiFloorProposalCalls: true, afcR2Runs: false, proposalReceiptWritten: true,
    },
  };
}

test("UI2B companion receipt parser accepts exact frozen original and empty bindings", () => {
  for (const mode of ["original_only", "empty_only"] as const) {
    const parsed = parseAfcUi2bBindingReceipt(receipt(mode));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    assert.equal(parsed.receipt.studyMode, mode);
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.receipt), true);
    assert.deepEqual(Object.keys(parsed.receipt).sort(), [
      "manifest", "package", "proposal", "providerCallCount", "receiptContractVersion", "roomId", "runner", "safety",
      "selectedImage", "sharedContextDigest", "studyMode",
    ]);
    assert.deepEqual(Object.keys(parsed.receipt.package).sort(), ["packageId", "receiptFileName", "receiptSha256"]);
    assert.deepEqual(Object.keys(parsed.receipt.manifest).sort(), ["fileName", "sha256"]);
    assert.deepEqual(Object.keys(parsed.receipt.selectedImage).sort(), ["fileName", "role", "sha256"]);
    assert.deepEqual(Object.keys(parsed.receipt.proposal).sort(), ["receiptFileName", "receiptSha256"]);
    assert.deepEqual(Object.keys(parsed.receipt.runner).sort(), ["contractVersion", "modelId", "promptRole"]);
    for (const nested of [
      parsed.receipt.package, parsed.receipt.manifest, parsed.receipt.selectedImage,
      parsed.receipt.proposal, parsed.receipt.runner, parsed.receipt.safety,
    ]) assert.equal(Object.isFrozen(nested), true);
  }
});

test("UI2B companion receipt parser rejects widened, mismatched, and unsafe authority", () => {
  const valid = receipt();
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    (value) => { value.extra = true; },
    (value) => { delete value.roomId; },
    (value) => { value.receiptContractVersion = "wrong"; },
    (value) => { value.roomId = "Room A"; },
    (value) => { (value.package as Record<string, unknown>).extra = true; },
    (value) => { delete (value.package as Record<string, unknown>).packageId; },
    (value) => { (value.package as Record<string, unknown>).packageId = `afc-ui2a-package:room-b:${packageDigest}`; },
    (value) => { (value.package as Record<string, unknown>).receiptFileName = "bad.json"; },
    (value) => { (value.package as Record<string, unknown>).receiptSha256 = "bad"; },
    (value) => { (value.manifest as Record<string, unknown>).extra = true; },
    (value) => { delete (value.manifest as Record<string, unknown>).fileName; },
    (value) => { (value.manifest as Record<string, unknown>).fileName = "../manifest.json"; },
    (value) => { (value.manifest as Record<string, unknown>).sha256 = "bad"; },
    (value) => { value.studyMode = "parallel_union"; },
    (value) => { (value.selectedImage as Record<string, unknown>).extra = true; },
    (value) => { delete (value.selectedImage as Record<string, unknown>).fileName; },
    (value) => { (value.selectedImage as Record<string, unknown>).role = "empty_room_boundary_specialist"; },
    (value) => { (value.selectedImage as Record<string, unknown>).fileName = "../image.png"; },
    (value) => { (value.selectedImage as Record<string, unknown>).sha256 = "bad"; },
    (value) => { value.sharedContextDigest = "bad"; },
    (value) => { (value.proposal as Record<string, unknown>).extra = true; },
    (value) => { delete (value.proposal as Record<string, unknown>).receiptSha256; },
    (value) => { (value.proposal as Record<string, unknown>).receiptFileName = "../unsafe.json"; },
    (value) => { (value.proposal as Record<string, unknown>).receiptSha256 = "bad"; },
    (value) => { value.providerCallCount = 0; },
    (value) => { value.providerCallCount = 2; },
    (value) => { (value.runner as Record<string, unknown>).extra = true; },
    (value) => { delete (value.runner as Record<string, unknown>).modelId; },
    (value) => { (value.runner as Record<string, unknown>).modelId = ""; },
    (value) => { (value.runner as Record<string, unknown>).contractVersion = "wrong"; },
    (value) => { (value.runner as Record<string, unknown>).promptRole = "empty_room_boundary_specialist"; },
    (value) => { (value.safety as Record<string, unknown>).extra = true; },
    (value) => { delete (value.safety as Record<string, unknown>).authoritative; },
    (value) => { (value.safety as Record<string, unknown>).afcR2Runs = true; },
    ...[
      "authoritative", "applied", "persistedToScene", "databaseWrites", "productionAssetWrites",
      "productionTokenAccountingUsed", "compositorCalls", "emptyRoomGenerationCalls",
    ].map((key) => (value: Record<string, unknown>) => { (value.safety as Record<string, unknown>)[key] = true; }),
    ...[
      "activeCameraUnchanged", "floorStateUnchanged", "supportStateUnchanged", "geminiFloorProposalCalls",
      "proposalReceiptWritten",
    ].map((key) => (value: Record<string, unknown>) => { (value.safety as Record<string, unknown>)[key] = false; }),
    (value) => { value.outputDir = "/tmp"; },
    (value) => { value.providerEnvelope = "raw"; },
    (value) => { value.modelOutput = "raw"; },
    (value) => { value.captureRoot = "/tmp"; },
    (value) => { value.apiKey = "secret"; },
    (value) => { value.requestId = "browser"; },
    (value) => { value.package = null; },
    (value) => { value.safety = []; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(valid) as Record<string, unknown>;
    mutate(value);
    assert.equal(parseAfcUi2bBindingReceipt(value).ok, false);
  }
});

test("UI2B companion bytes are stable and immutable writer refuses conflicting reuse", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2b-binding-"));
  try {
    const value = receipt();
    const bytes = stableReceiptBytes(value);
    assert.deepEqual(bytes, stableReceiptBytes(value));
    const filename = afcUi2bProposalBindingReceiptFileName(proposalDigest);
    const first = await writeAfcR3cImmutableCapture({ outputDir: root, filename, bytes });
    const second = await writeAfcR3cImmutableCapture({ outputDir: root, filename, bytes });
    const conflict = await writeAfcR3cImmutableCapture({ outputDir: root, filename, bytes: Buffer.from("{}") });
    assert.equal(first.ok, true);
    assert.equal(second.ok && second.reused, true);
    assert.equal(conflict.ok, false);
    assert.equal(digest((await readFile(path.join(root, filename))).toString("utf8")), digest(bytes.toString("utf8")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
