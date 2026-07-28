import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AFC_PROPOSAL_OVERLAY_CONTROLS,
  canRenderAfcProposalOverlay,
  createAfcProposalOverlayRequestGuard,
  imageFailureTransition,
  polygonPoints,
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
