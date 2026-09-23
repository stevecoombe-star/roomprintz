import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { stableReceiptBytes } from "./gemini-floor-proposal-capture";
import { AFC_UI2B_BINDING_RECEIPT_VERSION, afcUi2bProposalBindingReceiptFileName } from "./afc-ui2b-proposal-run";
import { replayAfcUi2bBindingReceipt } from "./afc-ui2b-binding-replay";

const packageDigest = "a".repeat(64);
const receiptSha = "b".repeat(64);
const manifestSha = "c".repeat(64);
const imageSha = "d".repeat(64);
const contextSha = "e".repeat(64);
function binding() {
  return {
    receiptContractVersion: AFC_UI2B_BINDING_RECEIPT_VERSION, roomId: "room-a",
    package: { packageId: `afc-ui2a-package:room-a:${packageDigest}`, receiptFileName: `afc-ui2a-prepared-input.room-a.${packageDigest}.receipt.json`, receiptSha256: "f".repeat(64) },
    manifest: { fileName: "afc-r3c-room-a.image-manifest.v1.json", sha256: manifestSha },
    studyMode: "original_only",
    selectedImage: { role: "original_photo_contextual_geometry", fileName: "room-a.original.png", sha256: imageSha },
    sharedContextDigest: contextSha,
    proposal: { receiptFileName: "afc-r3c-run.room-a.fixture.original.receipt.json", receiptSha256: receiptSha },
    providerCallCount: 1,
    runner: { contractVersion: "afc-r3c-proposal-run-receipt/v1", promptRole: "original_photo_contextual_geometry", modelId: "gemini-fixture" },
    safety: {
      authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true, floorStateUnchanged: true,
      supportStateUnchanged: true, databaseWrites: false, productionAssetWrites: false, productionTokenAccountingUsed: false,
      compositorCalls: false, emptyRoomGenerationCalls: false, geminiFloorProposalCalls: true, afcR2Runs: false, proposalReceiptWritten: true,
    },
  };
}
function dependencies() {
  return {
    replayPackage: async () => ({
      ok: true as const,
      evidence: {
        receipt: {
          manifest: { fileName: "afc-r3c-room-a.image-manifest.v1.json", sha256: manifestSha },
          sharedContextDigest: contextSha,
          original: { fileName: "room-a.original.png", sha256: imageSha },
          emptyRoomAssist: { fileName: "room-a.empty.png", sha256: "9".repeat(64) },
        },
      },
    }) as never,
    replayProposal: async () => ({
      status: "valid" as const,
      viewModel: {
        artifactIdentity: { receiptSha256: receiptSha, roomId: "room-a", studyMode: "original_only", imageRole: "original_contextual" },
        imageBasis: { original: { sha256: imageSha }, emptyRoom: { sha256: "9".repeat(64) } },
        provenance: { provider: { modelId: "gemini-fixture" }, afcR3c: { candidateIds: ["candidate-1"] } },
        warnings: [],
      },
    }) as never,
  };
}

test("UI2B strict companion replay validates every server authority edge", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2b-binding-replay-"));
  try {
    const filename = afcUi2bProposalBindingReceiptFileName(receiptSha);
    await writeFile(path.join(root, filename), stableReceiptBytes(binding()));
    const result = await replayAfcUi2bBindingReceipt({ roomLabel: "room-a", bindingFileName: filename }, { ...dependencies(), captureRoot: () => root });
    assert.equal(result.status, "valid");
    if (result.status !== "valid") return;
    assert.equal(result.summary.proposal.receiptSha256, receiptSha);
    assert.equal(result.summary.providerCallCount, 1);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.summary), true);
    assert.equal(JSON.stringify(result).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("UI2B strict companion replay rejects invalid selector and each bound authority mutation", async () => {
  let roots = 0;
  const invalid = await replayAfcUi2bBindingReceipt({ roomLabel: "../room-a", bindingFileName: "x" }, {
    captureRoot: () => "/unreachable",
    replayPackage: async () => { roots++; throw new Error("must not run"); },
  });
  assert.equal(invalid.status, "invalid");
  assert.equal(roots, 0);
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    (value) => { (value.package as Record<string, unknown>).packageId = `afc-ui2a-package:room-a:${"1".repeat(64)}`; },
    (value) => { (value.manifest as Record<string, unknown>).sha256 = "1".repeat(64); },
    (value) => { value.sharedContextDigest = "1".repeat(64); },
    (value) => { value.studyMode = "empty_only"; },
    (value) => { (value.selectedImage as Record<string, unknown>).sha256 = "1".repeat(64); },
    (value) => { (value.proposal as Record<string, unknown>).receiptSha256 = "1".repeat(64); },
    (value) => { (value.runner as Record<string, unknown>).modelId = "other"; },
    (value) => { value.providerCallCount = 0; },
    (value) => { (value.safety as Record<string, unknown>).proposalReceiptWritten = false; },
  ];
  for (const mutate of mutations) {
    const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2b-binding-mutation-"));
    try {
      const value = structuredClone(binding()) as Record<string, unknown>;
      mutate(value);
      await writeFile(path.join(root, afcUi2bProposalBindingReceiptFileName(receiptSha)), stableReceiptBytes(value));
      const result = await replayAfcUi2bBindingReceipt({ roomLabel: "room-a", bindingFileName: afcUi2bProposalBindingReceiptFileName(receiptSha) }, { ...dependencies(), captureRoot: () => root });
      assert.equal(result.status, "invalid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("UI2B strict companion replay rejects proposal image-role disagreement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2b-binding-role-"));
  try {
    const filename = afcUi2bProposalBindingReceiptFileName(receiptSha);
    await writeFile(path.join(root, filename), stableReceiptBytes(binding()));
    const base = dependencies();
    const result = await replayAfcUi2bBindingReceipt({ roomLabel: "room-a", bindingFileName: filename }, {
      ...base,
      captureRoot: () => root,
      replayProposal: async () => ({
        status: "valid" as const,
        viewModel: {
          artifactIdentity: {
            receiptSha256: receiptSha, roomId: "room-a", studyMode: "original_only",
            imageRole: "empty_room_boundary_specialist",
          },
          imageBasis: { original: { sha256: imageSha }, emptyRoom: { sha256: "9".repeat(64) } },
          provenance: { provider: { modelId: "gemini-fixture" }, afcR3c: { candidateIds: ["candidate-1"] } },
          warnings: [],
        },
      }) as never,
    });
    assert.equal(result.status, "invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("UI2B strict companion replay fails closed for unavailable roots and unsafe receipt files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2b-binding-files-"));
  const rootLink = `${root}-link`;
  const filename = afcUi2bProposalBindingReceiptFileName(receiptSha);
  try {
    const unavailable = await replayAfcUi2bBindingReceipt(
      { roomLabel: "room-a", bindingFileName: filename },
      { ...dependencies(), captureRoot: () => path.join(root, "missing") },
    );
    assert.equal(unavailable.status, "invalid");

    await symlink(root, rootLink);
    const symlinkedRoot = await replayAfcUi2bBindingReceipt(
      { roomLabel: "room-a", bindingFileName: filename },
      { ...dependencies(), captureRoot: () => rootLink },
    );
    assert.equal(symlinkedRoot.status, "invalid");

    const cases = [
      async () => undefined,
      async () => writeFile(path.join(root, filename), "{"),
      async () => symlink(path.join(root, "target.json"), path.join(root, filename)),
      async () => mkdir(path.join(root, filename)),
    ];
    for (const arrange of cases) {
      await rm(path.join(root, filename), { recursive: true, force: true });
      await arrange();
      const result = await replayAfcUi2bBindingReceipt(
        { roomLabel: "room-a", bindingFileName: filename },
        { ...dependencies(), captureRoot: () => root },
      );
      assert.equal(result.status, "invalid");
    }
  } finally {
    await rm(rootLink, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});
