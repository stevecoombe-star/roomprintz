import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_AFC_PROPOSAL_OVERLAY_CONTROLS,
  EMPTY_AFC_PROPOSAL_RECEIPT_INVENTORY,
  canRenderAfcProposalOverlay,
  createAfcProposalOverlayRequestGuard,
  failedAfcProposalReceiptInventoryTransition,
  imageFailureTransition,
  loadedAfcProposalReceiptInventoryTransition,
  loadingAfcProposalReceiptInventoryTransition,
  polygonPoints,
  reconcileAfcProposalReceiptSelection,
  verifiedImageUrl,
} from "./afc-proposal-overlay-state";

const viewModel = {
  corners: {
    NL: { x: 0, y: 0.98, support: "direct_visible" },
    NR: { x: 1, y: 0.93, support: "direct_visible" },
    FR: { x: 0.69, y: 0.64, support: "direct_visible" },
    FL: { x: 0.36, y: 0.65, support: "direct_visible" },
  },
} as never;

test("AFC-UI1 preserves semantic polygon order and source-normalized values", () => {
  assert.equal(polygonPoints(viewModel), "0,98 100,93 69,64 36,65");
  assert.equal(DEFAULT_AFC_PROPOSAL_OVERLAY_CONTROLS.opacity, 0.32);
  assert.equal(Object.isFrozen(DEFAULT_AFC_PROPOSAL_OVERLAY_CONTROLS), true);
});

test("AFC-UI1 image failure removes the renderable image and polygon state", () => {
  const failed = imageFailureTransition("Browser delivery failed.");
  assert.deepEqual(failed, {
    status: "invalid",
    imageUrl: null,
    error: "Browser delivery failed. The proposal overlay is withheld until a verified image is loaded.",
  });
  assert.equal(canRenderAfcProposalOverlay(failed.status, failed.imageUrl), false);
  assert.equal(canRenderAfcProposalOverlay("valid", "/verified-image"), true);
});

test("AFC-UI1 request generations reject clear, superseded load, role-switch, and disposal races", () => {
  const guard = createAfcProposalOverlayRequestGuard();
  const loadA = guard.begin();
  const cleared = guard.invalidate();
  assert.equal(guard.isCurrent(loadA), false, "load then clear");
  assert.equal(guard.isCurrent(cleared), true);

  const loadB = guard.begin();
  assert.equal(guard.isCurrent(loadA), false, "late A cannot overwrite B");
  assert.equal(guard.isCurrent(loadB), true);

  const original = guard.begin();
  const empty = guard.begin();
  assert.equal(guard.isCurrent(original), false, "late Original cannot replace Empty");
  assert.equal(guard.isCurrent(empty), true);

  const disposal = guard.invalidate();
  assert.equal(guard.isCurrent(empty), false, "unmount/disposal invalidates late completion");
  assert.equal(guard.isCurrent(disposal), true);
});

test("AFC-UI1 verified image URLs bind image role to the loaded receipt digest", () => {
  const url = verifiedImageUrl("afc-r3c-run.safe.receipt.json", "a".repeat(64), "empty");
  assert.match(url, /receiptSha256=aaaaaaaa/);
  assert.match(url, /role=empty/);
});

test("AFC-UI1C inventory generations are independent from load and image generations", () => {
  const loadImageGuard = createAfcProposalOverlayRequestGuard();
  const inventoryGuard = createAfcProposalOverlayRequestGuard();
  const imageGeneration = loadImageGuard.begin();
  const inventoryGeneration = inventoryGuard.begin();
  inventoryGuard.invalidate();
  assert.equal(inventoryGuard.isCurrent(inventoryGeneration), false);
  assert.equal(loadImageGuard.isCurrent(imageGeneration), true);
  const failed = imageFailureTransition("Image failed after inventory refresh.");
  assert.equal(failed.status, "invalid");
  assert.equal(failed.imageUrl, null);
});

test("AFC-UI1C inventory transitions retain prior receipts on loading and failure", () => {
  const receipts = [{ receiptFileName: "afc-r3c-run.selected.receipt.json" }] as never;
  const loaded = loadedAfcProposalReceiptInventoryTransition(receipts, 2);
  const loading = loadingAfcProposalReceiptInventoryTransition(loaded);
  const failed = failedAfcProposalReceiptInventoryTransition(loading);
  assert.equal(loaded.status, "loaded");
  assert.equal(loading.status, "loading");
  assert.equal(failed.status, "failure");
  assert.equal(failed.receipts, receipts);
  assert.equal(failed.invalidCandidateCount, 2);
  assert.equal(EMPTY_AFC_PROPOSAL_RECEIPT_INVENTORY.status, "idle");
});

test("AFC-UI1C re-discovery retains selection only while its receipt remains present", () => {
  const selected = "afc-r3c-run.selected.receipt.json";
  const receipts = [
    { receiptFileName: selected },
    { receiptFileName: "afc-r3c-run.other.receipt.json" },
  ];
  assert.equal(reconcileAfcProposalReceiptSelection(selected, receipts as never), selected);
  assert.equal(reconcileAfcProposalReceiptSelection(selected, receipts.slice(1) as never), "");
  assert.equal(reconcileAfcProposalReceiptSelection("", receipts as never), "");
});

test("AFC-UI1C discovery is caught, claim-only, and does not touch loaded evidence state", async () => {
  const source = await readFile(new URL("./afc-proposal-overlay-state.ts", import.meta.url), "utf8");
  const refresh = source.slice(
    source.indexOf("const refreshReceipts"),
    source.indexOf("const clear")
  );
  assert.match(refresh, /try\s*\{/);
  assert.match(refresh, /catch\s*\{/);
  assert.doesNotMatch(refresh, /setViewModel|setImageUrl|setStatus\(|loadImageRequestGenerationRef/);
  assert.match(source, /loadImageRequestGenerationRef/);
  assert.match(source, /inventoryRequestGenerationRef/);
});
