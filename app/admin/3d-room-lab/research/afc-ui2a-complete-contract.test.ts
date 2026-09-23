import assert from "node:assert/strict";
import test from "node:test";

import { parseAfcUi2aCompleteRequest } from "./afc-ui2a-complete-contract";

const selector = {
  preparationId: `afc-ui2a-original:room-a:${"a".repeat(64)}`,
  receiptFileName: `afc-ui2a-original-preparation.room-a.${"a".repeat(64)}.receipt.json`,
  receiptSha256: "b".repeat(64),
};
function request(extra: Record<string, unknown> = {}) {
  return {
    contractVersion: "afc-ui2a-complete-request/v1",
    roomLabel: "Room A",
    originalPreparation: selector,
    executeCapture: true,
    ...extra,
  };
}

test("complete request parser is closed, selector-only, and deeply frozen", () => {
  const parsed = parseAfcUi2aCompleteRequest(request());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(Object.isFrozen(parsed.request), true);
  assert.equal(Object.isFrozen(parsed.request.originalPreparation), true);
  assert.equal(parsed.request.executeCapture, true);
});
test("complete request rejects unknown keys, invalid rooms, and malformed selectors", () => {
  assert.equal(parseAfcUi2aCompleteRequest(request({ outputDir: "/tmp" })).ok, false);
  assert.equal(parseAfcUi2aCompleteRequest(request({ roomLabel: "../room-a" })).ok, false);
  assert.equal(parseAfcUi2aCompleteRequest(request({ originalPreparation: { ...selector, receiptFileName: "../receipt.json" } })).ok, false);
});
test("acknowledgements remain unknown until the orchestrator runtime gate", () => {
  const parsed = parseAfcUi2aCompleteRequest(request({ executeCapture: "true", executeEmptyRoomGeneration: 1 }));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.request.executeCapture, "true");
    assert.equal(parsed.request.executeEmptyRoomGeneration, 1);
  }
});
