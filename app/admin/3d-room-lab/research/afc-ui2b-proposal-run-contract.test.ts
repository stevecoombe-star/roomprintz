import assert from "node:assert/strict";
import test from "node:test";

import { parseAfcUi2bProposalRunRequest } from "./afc-ui2b-proposal-run-contract";

const roomId = "room-a";
const packageDigest = "a".repeat(64);
const receiptDigest = "b".repeat(64);
function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "afc-ui2b-proposal-run-request/v1",
    operation: "validate",
    roomLabel: roomId,
    packageSelector: {
      packageId: `afc-ui2a-package:${roomId}:${packageDigest}`,
      receiptFileName: `afc-ui2a-prepared-input.${roomId}.${packageDigest}.receipt.json`,
      receiptSha256: receiptDigest,
    },
    studyMode: "original_only",
    ...overrides,
  };
}
test("UI2B request parser accepts only strict validate and execute selectors", () => {
  const validated = parseAfcUi2bProposalRunRequest(request());
  assert.equal(validated.ok, true);
  const executed = parseAfcUi2bProposalRunRequest(request({ operation: "execute", executeCapture: true, executeLiveProviderCall: true }));
  assert.equal(executed.ok, true);
  if (executed.ok) {
    assert.equal(Object.isFrozen(executed.request), true);
    assert.equal(Object.isFrozen(executed.request.packageSelector), true);
  }
});
test("UI2B request parser rejects widened, unsafe, mismatched and unsupported input", () => {
  const cases = [
    request({ outputDir: "/tmp" }),
    request({ packageSelector: { ...request().packageSelector, localPath: "/tmp" } }),
    request({ packageSelector: { ...request().packageSelector, packageId: "bad" } }),
    request({ roomLabel: "room-b" }),
    request({ packageSelector: { ...request().packageSelector, receiptFileName: "../unsafe.json" } }),
    request({ packageSelector: { ...request().packageSelector, receiptSha256: "A".repeat(64) } }),
    request({ studyMode: "parallel" }),
    request({ studyMode: "parallel_union" }),
    request({ studyMode: "union" }),
    request({ studyMode: "automatic" }),
    request({ executeCapture: true }),
  ];
  for (const value of cases) assert.equal(parseAfcUi2bProposalRunRequest(value).ok, false);
});
test("UI2B validate preserves non-authorizing acknowledgement values and execute requires primitive true later", () => {
  for (const value of [undefined, null, false, 0, 1, "", "true", "yes", {}, [], new Boolean(true), Object(true)]) {
    const parsed = parseAfcUi2bProposalRunRequest(request({ executeCapture: value, executeLiveProviderCall: value }));
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.request.executeCapture, value);
  }
});
test("UI2B validation remains non-live when both acknowledgement fields are primitive true", () => {
  const parsed = parseAfcUi2bProposalRunRequest(request({ executeCapture: true, executeLiveProviderCall: true }));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.request.operation, "validate");
});
