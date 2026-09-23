import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { stableReceiptBytes } from "./gemini-floor-proposal-capture";
import {
  AFC_UI2B_BINDING_RECEIPT_VERSION,
  afcUi2bProposalBindingReceiptFileName,
} from "./afc-ui2b-proposal-run";
import { discoverAfcUi2bProposalRuns } from "./afc-ui2b-proposal-run-inventory";

const packageDigest = "a".repeat(64);
const manifestSha = "b".repeat(64);
const originalSha = "c".repeat(64);
const emptySha = "d".repeat(64);
const contextSha = "e".repeat(64);
function validBinding(mode: "original_only" | "empty_only", proposalSha: string) {
  const original = mode === "original_only";
  const role = original ? "original_photo_contextual_geometry" : "empty_room_boundary_specialist";
  return {
    receiptContractVersion: AFC_UI2B_BINDING_RECEIPT_VERSION,
    roomId: "room-a",
    package: {
      packageId: `afc-ui2a-package:room-a:${packageDigest}`,
      receiptFileName: `afc-ui2a-prepared-input.room-a.${packageDigest}.receipt.json`,
      receiptSha256: "f".repeat(64),
    },
    manifest: { fileName: "room-a.manifest.json", sha256: manifestSha },
    studyMode: mode,
    selectedImage: {
      role,
      fileName: original ? "room-a.original.png" : "room-a.empty.png",
      sha256: original ? originalSha : emptySha,
    },
    sharedContextDigest: contextSha,
    proposal: { receiptFileName: `afc-r3c-run.room-a.${mode}.receipt.json`, receiptSha256: proposalSha },
    providerCallCount: 1,
    runner: { contractVersion: "afc-r3c-proposal-run-receipt/v1", promptRole: role, modelId: "gemini-fixture" },
    safety: {
      authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true, floorStateUnchanged: true,
      supportStateUnchanged: true, databaseWrites: false, productionAssetWrites: false, productionTokenAccountingUsed: false,
      compositorCalls: false, emptyRoomGenerationCalls: false, geminiFloorProposalCalls: true, afcR2Runs: false,
      proposalReceiptWritten: true,
    },
  };
}
function replayDependencies() {
  return {
    replayPackage: async () => ({
      ok: true as const,
      evidence: {
        receipt: {
          manifest: { fileName: "room-a.manifest.json", sha256: manifestSha },
          sharedContextDigest: contextSha,
          original: { fileName: "room-a.original.png", sha256: originalSha },
          emptyRoomAssist: { fileName: "room-a.empty.png", sha256: emptySha },
        },
      },
    }) as never,
    replayProposal: async ({ receiptFileName }: { receiptFileName: string }) => {
      const mode = receiptFileName.includes("empty_only") ? "empty_only" as const : "original_only" as const;
      const proposalSha = mode === "original_only" ? "1".repeat(64) : "2".repeat(64);
      return {
        status: "valid" as const,
        viewModel: {
          artifactIdentity: {
            receiptSha256: proposalSha, roomId: "room-a", studyMode: mode,
            imageRole: mode === "original_only" ? "original_contextual" : "empty_room_boundary_specialist",
          },
          imageBasis: { original: { sha256: originalSha }, emptyRoom: { sha256: emptySha } },
          provenance: { provider: { modelId: "gemini-fixture" }, afcR3c: { candidateIds: [`candidate-${mode}`] } },
          warnings: [],
        },
      } as never;
    },
  };
}

test("UI2B inventory validates selectors before capture-root access", async () => {
  let roots = 0;
  for (const input of [
    { roomLabel: "" }, { roomLabel: "../room-a" }, { roomLabel: "room-a", studyMode: "parallel_union" },
    { roomLabel: "room-a", packageId: "not-a-package" },
  ]) {
    const result = await discoverAfcUi2bProposalRuns(input, { captureRoot: () => { roots++; return "/unreachable"; } });
    assert.equal(result.status, "failure");
    assert.equal(result.status === "failure" && result.failureCode, "invalid_input");
    assert.equal(Object.isFrozen(result), true);
  }
  assert.equal(roots, 0);
});

test("UI2B inventory is read-only across empty, unrelated, and invalid companion candidates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2b-inventory-"));
  try {
    const empty = await discoverAfcUi2bProposalRuns({ roomLabel: "room-a" }, { captureRoot: () => root });
    assert.deepEqual(empty, { status: "inventory", roomId: "room-a", runs: [], invalidCandidateCount: 0 });
    await Promise.all([
      writeFile(path.join(root, "unrelated.txt"), "ignored"),
      writeFile(path.join(root, `afc-ui2b-run.${"a".repeat(64)}.binding.json`), "{"),
      writeFile(path.join(root, "afc-ui2b-run.short.binding.json"), "{}"),
    ]);
    const before = await Promise.all(["unrelated.txt", `afc-ui2b-run.${"a".repeat(64)}.binding.json`, "afc-ui2b-run.short.binding.json"].map(async (name) => (await import("node:fs/promises")).readFile(path.join(root, name), "utf8")));
    const result = await discoverAfcUi2bProposalRuns({ roomLabel: "room-a" }, { captureRoot: () => root });
    const after = await Promise.all(["unrelated.txt", `afc-ui2b-run.${"a".repeat(64)}.binding.json`, "afc-ui2b-run.short.binding.json"].map(async (name) => (await import("node:fs/promises")).readFile(path.join(root, name), "utf8")));
    assert.equal(result.status, "inventory");
    assert.equal(result.status === "inventory" && result.runs.length, 0);
    assert.equal(result.status === "inventory" && result.invalidCandidateCount, 1);
    assert.deepEqual(after, before);
    assert.equal(Object.isFrozen(result), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("UI2B inventory fails closed for unavailable and symlinked capture roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2b-inventory-root-"));
  const link = `${root}-link`;
  try {
    const unavailable = await discoverAfcUi2bProposalRuns({ roomLabel: "room-a" }, { captureRoot: () => path.join(root, "missing") });
    assert.equal(unavailable.status, "failure");
    assert.equal(unavailable.status === "failure" && unavailable.failureCode, "inventory_unavailable");
    await mkdir(path.join(root, "target"));
    await symlink(path.join(root, "target"), link);
    const symlinked = await discoverAfcUi2bProposalRuns({ roomLabel: "room-a" }, { captureRoot: () => link });
    assert.equal(symlinked.status, "failure");
    assert.equal(symlinked.status === "failure" && symlinked.failureCode, "inventory_unavailable");
  } finally {
    await rm(link, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("UI2B inventory classifies, filters, sorts, deduplicates, and preserves valid runs read-only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-ui2b-inventory-valid-"));
  try {
    const originalSha = "1".repeat(64);
    const emptySha = "2".repeat(64);
    const originalName = afcUi2bProposalBindingReceiptFileName(originalSha);
    const emptyName = afcUi2bProposalBindingReceiptFileName(emptySha);
    const invalidName = afcUi2bProposalBindingReceiptFileName("3".repeat(64));
    await Promise.all([
      writeFile(path.join(root, emptyName), stableReceiptBytes(validBinding("empty_only", emptySha))),
      writeFile(path.join(root, originalName), stableReceiptBytes(validBinding("original_only", originalSha))),
      writeFile(path.join(root, invalidName), "{"),
      writeFile(path.join(root, "afc-ui2b-run.not-a-candidate.binding.json"), "{}"),
      writeFile(path.join(root, "unrelated.txt"), "unchanged"),
    ]);
    const snapshot = async () => Promise.all((await readdir(root)).sort().map(async (name) => [
      name, (await readFile(path.join(root, name))).toString("base64"),
    ] as const));
    const before = await snapshot();
    const dependencies = { ...replayDependencies(), captureRoot: () => root };
    const all = await discoverAfcUi2bProposalRuns({ roomLabel: "room-a" }, dependencies);
    assert.equal(all.status, "inventory");
    if (all.status !== "inventory") return;
    assert.equal(all.invalidCandidateCount, 1);
    assert.deepEqual(all.runs.map((run) => run.studyMode), ["empty_only", "original_only"]);
    assert.equal(new Set(all.runs.map((run) => run.proposal.receiptSha256)).size, all.runs.length);
    assert.equal(Object.isFrozen(all), true);
    assert.equal(Object.isFrozen(all.runs), true);
    assert.equal(Object.isFrozen(all.runs[0]?.proposal), true);
    assert.equal(JSON.stringify(all).includes(root), false);

    for (const mode of ["original_only", "empty_only"] as const) {
      const filtered = await discoverAfcUi2bProposalRuns({ roomLabel: "room-a", studyMode: mode }, dependencies);
      assert.equal(filtered.status, "inventory");
      assert.deepEqual(filtered.status === "inventory" ? filtered.runs.map((run) => run.studyMode) : [], [mode]);
      assert.equal(filtered.status === "inventory" && filtered.invalidCandidateCount, 1);
    }
    const packageFiltered = await discoverAfcUi2bProposalRuns({
      roomLabel: "room-a", packageId: `afc-ui2a-package:room-a:${packageDigest}`,
    }, dependencies);
    assert.equal(packageFiltered.status === "inventory" && packageFiltered.runs.length, 2);
    const otherPackage = await discoverAfcUi2bProposalRuns({
      roomLabel: "room-a", packageId: `afc-ui2a-package:room-a:${"9".repeat(64)}`,
    }, dependencies);
    assert.equal(otherPackage.status === "inventory" && otherPackage.runs.length, 0);
    const repeated = await discoverAfcUi2bProposalRuns({ roomLabel: "room-a" }, dependencies);
    assert.deepEqual(repeated, all);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
