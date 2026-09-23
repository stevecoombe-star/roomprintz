import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  nextVisualEvidenceRequest,
  selectCommittedVisualImage,
  selectCommittedVisualOverlay,
  visualEvidenceRequestKey,
  type VisualEvidenceRequest,
  type VisualImageCommit,
  type VisualOverlayCommit,
} from "./visual-evidence-request";

const VISUAL = path.join(
  process.cwd(),
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence.tsx",
);

const TUPLE_A = "case-a:generation-a:empty";
const TUPLE_B = "case-a:generation-a:tiled";
const REVOKED_A = "blob:revoked-a";
const FRESH_A = "blob:fresh-a";

const PRIOR_OVERLAY = { floor: "prior-a" };
const FRESH_OVERLAY = { floor: "fresh-a" };

function imageCommit(
  request: VisualEvidenceRequest,
  tupleKey: string,
  imageUrl: string,
): VisualImageCommit {
  return {
    epoch: request.epoch,
    key: tupleKey,
    phase: "ready",
    imageUrl,
    error: null,
    errorStatus: null,
  };
}

function overlayCommit(
  request: VisualEvidenceRequest,
  tupleKey: string,
  overlay: { floor: string },
): VisualOverlayCommit<{ floor: string }> {
  return {
    epoch: request.epoch,
    key: tupleKey,
    phase: "ready",
    overlay,
    error: null,
  };
}

test("returning to tuple A before the fresh request resolves does not render the revoked blob or prior overlay", () => {
  let imageRequest: VisualEvidenceRequest = {
    key: visualEvidenceRequestKey(TUPLE_A, 0),
    epoch: 1,
  };
  let overlayRequest: VisualEvidenceRequest = {
    key: visualEvidenceRequestKey(TUPLE_A, 0),
    epoch: 1,
  };
  const loadedImage = imageCommit(imageRequest, TUPLE_A, REVOKED_A);
  const loadedOverlay = overlayCommit(overlayRequest, TUPLE_A, PRIOR_OVERLAY);
  const readyA = selectCommittedVisualImage({
    tupleKey: TUPLE_A,
    request: imageRequest,
    commit: loadedImage,
  });
  assert.equal(readyA.phase, "ready");
  assert.equal(readyA.imageUrl, REVOKED_A);

  imageRequest = nextVisualEvidenceRequest(
    imageRequest,
    visualEvidenceRequestKey(TUPLE_B, 0),
  );
  overlayRequest = nextVisualEvidenceRequest(
    overlayRequest,
    visualEvidenceRequestKey(TUPLE_B, 0),
  );
  const duringB = selectCommittedVisualImage({
    tupleKey: TUPLE_B,
    request: imageRequest,
    commit: loadedImage,
  });
  assert.equal(duringB.phase, "loading");
  assert.equal(duringB.imageUrl, null);

  imageRequest = nextVisualEvidenceRequest(
    imageRequest,
    visualEvidenceRequestKey(TUPLE_A, 0),
  );
  overlayRequest = nextVisualEvidenceRequest(
    overlayRequest,
    visualEvidenceRequestKey(TUPLE_A, 0),
  );
  const returned = selectCommittedVisualImage({
    tupleKey: TUPLE_A,
    request: imageRequest,
    commit: loadedImage,
  });
  assert.equal(returned.isCommitted, false);
  assert.equal(returned.phase, "loading");
  assert.equal(returned.imageUrl, null);
  assert.notEqual(returned.imageUrl, REVOKED_A);
  const returnedOverlay = selectCommittedVisualOverlay({
    tupleKey: TUPLE_A,
    request: overlayRequest,
    commit: loadedOverlay,
  });
  assert.equal(returnedOverlay.isCommitted, false);
  assert.equal(returnedOverlay.phase, "loading");
  assert.equal(returnedOverlay.overlay, null);

  const freshImage = imageCommit(imageRequest, TUPLE_A, FRESH_A);
  const fresh = selectCommittedVisualImage({
    tupleKey: TUPLE_A,
    request: imageRequest,
    commit: freshImage,
  });
  assert.equal(fresh.phase, "ready");
  assert.equal(fresh.imageUrl, FRESH_A);
  const freshOverlay = selectCommittedVisualOverlay({
    tupleKey: TUPLE_A,
    request: overlayRequest,
    commit: overlayCommit(overlayRequest, TUPLE_A, FRESH_OVERLAY),
  });
  assert.equal(freshOverlay.phase, "ready");
  assert.deepEqual(freshOverlay.overlay, FRESH_OVERLAY);
});

test("a stale visual response cannot become ready for a newer request epoch", () => {
  const current = nextVisualEvidenceRequest(
    { key: visualEvidenceRequestKey(TUPLE_A, 0), epoch: 1 },
    visualEvidenceRequestKey(TUPLE_B, 0),
  );
  const stale = imageCommit(
    { key: visualEvidenceRequestKey(TUPLE_A, 0), epoch: 1 },
    TUPLE_A,
    REVOKED_A,
  );
  const view = selectCommittedVisualImage({
    tupleKey: TUPLE_A,
    request: current,
    commit: stale,
  });
  assert.equal(view.phase, "loading");
  assert.equal(view.imageUrl, null);
});

test("an image retry hides the previous payload until the new epoch commits", () => {
  const initial: VisualEvidenceRequest = {
    key: visualEvidenceRequestKey(TUPLE_A, 0),
    epoch: 1,
  };
  const loaded = imageCommit(initial, TUPLE_A, REVOKED_A);
  const retried = nextVisualEvidenceRequest(
    initial,
    visualEvidenceRequestKey(TUPLE_A, 1),
  );
  assert.notEqual(retried.epoch, initial.epoch);
  const view = selectCommittedVisualImage({
    tupleKey: TUPLE_A,
    request: retried,
    commit: loaded,
  });
  assert.equal(view.phase, "loading");
  assert.equal(view.imageUrl, null);
});

test("metadata-only identity keeps the same visual request", () => {
  const current: VisualEvidenceRequest = {
    key: visualEvidenceRequestKey(TUPLE_A, 0),
    epoch: 4,
  };
  assert.equal(
    nextVisualEvidenceRequest(current, visualEvidenceRequestKey(TUPLE_A, 0)),
    current,
  );
});

test("visual evidence renders a payload only for the request epoch that committed it", () => {
  const source = readFileSync(VISUAL, "utf8");
  assert.match(source, /selectCommittedVisualImage/);
  assert.match(source, /selectCommittedVisualOverlay/);
  assert.match(source, /epoch: requestEpoch/);
  assert.match(source, /\[caseId, generationId, kind, retryNonce\]/);
  assert.match(source, /\[caseId, generationId, kind, overlayRetryNonce\]/);
});
