import assert from "node:assert/strict";
import test from "node:test";

import { runAfcUi2bControlledProposal } from "./afc-ui2b-proposal-run";

const digest = "a".repeat(64);
function execute(value: unknown, provider: unknown) {
  return {
    contractVersion: "afc-ui2b-proposal-run-request/v1",
    operation: "execute",
    roomLabel: "room-a",
    packageSelector: {
      packageId: `afc-ui2a-package:room-a:${digest}`,
      receiptFileName: `afc-ui2a-prepared-input.room-a.${digest}.receipt.json`,
      receiptSha256: "b".repeat(64),
    },
    studyMode: "original_only",
    ...(value !== undefined ? { executeCapture: value } : {}),
    ...(provider !== undefined ? { executeLiveProviderCall: provider } : {}),
  };
}
test("UI2B execute acknowledgment refusal matrix performs no replay or provider work", async () => {
  for (const value of [undefined, null, false, 0, 1, "", "true", "yes", {}, [], new Boolean(true), Object(true)]) {
    let replays = 0;
    const result = await runAfcUi2bControlledProposal(execute(value, true), {
      replayPackage: async () => { replays++; throw new Error("must not replay"); },
    });
    assert.equal(result.status, "failure");
    assert.equal(result.status === "failure" && result.failureCode, "capture_not_authorized");
    assert.equal(result.status === "failure" && result.providerCallCount, 0);
    assert.equal(replays, 0);
  }
});
test("UI2B separate provider acknowledgement gate precedes package replay", async () => {
  for (const value of [undefined, null, false, 0, 1, "", "true", "yes", {}, [], new Boolean(true), Object(true)]) {
    let replays = 0;
    const result = await runAfcUi2bControlledProposal(execute(true, value), {
      replayPackage: async () => { replays++; throw new Error("must not replay"); },
    });
    assert.equal(result.status, "failure");
    assert.equal(result.status === "failure" && result.failureCode, "provider_call_not_authorized");
    assert.equal(result.status === "failure" && result.geminiFloorProposalCall, false);
    assert.equal(replays, 0);
  }
});
test("UI2B validation cannot invoke a provider-capable dependency for invalid input", async () => {
  let runs = 0;
  const result = await runAfcUi2bControlledProposal({ operation: "validate" }, {
    runStudy: async () => { runs++; throw new Error("must not run"); },
  });
  assert.equal(result.status, "failure");
  assert.equal(result.status === "failure" && result.providerCallCount, 0);
  assert.equal(runs, 0);
});
