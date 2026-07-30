import assert from "node:assert/strict";
import test from "node:test";

import {
  afcUi2bIdentity,
  buildAfcUi2bPackageInventoryUrl,
  buildAfcUi2bProposalRunRequest,
  buildAfcUi2bRunInventoryUrl,
  createAfcUi2bRequestGuard,
} from "./afc-ui2b-runner-state";

const selected = {
  packageId: `afc-ui2a-package:room-a:${"a".repeat(64)}`, roomId: "room-a",
  receipt: { fileName: "package.receipt.json", sha256: "b".repeat(64) },
  manifest: { fileName: "manifest.json", sha256: "c".repeat(64) },
  original: { sha256: "d".repeat(64) }, emptyRoomAssist: { sha256: "e".repeat(64) }, sharedContextDigest: "f".repeat(64),
};
test("UI2B state builders keep browser authority to selector, study mode and acknowledgements", () => {
  const validate = buildAfcUi2bProposalRunRequest("validate", selected, "original_only");
  const execute = buildAfcUi2bProposalRunRequest("execute", selected, "empty_only");
  assert.deepEqual(Object.keys(validate).sort(), ["contractVersion", "operation", "packageSelector", "roomLabel", "studyMode"]);
  assert.deepEqual(Object.keys(execute).sort(), ["contractVersion", "executeCapture", "executeLiveProviderCall", "operation", "packageSelector", "roomLabel", "studyMode"]);
  assert.deepEqual(Object.keys(validate.packageSelector).sort(), ["packageId", "receiptFileName", "receiptSha256"]);
  assert.equal("executeCapture" in validate, false);
  assert.equal(execute.executeCapture, true);
  assert.equal(execute.executeLiveProviderCall, true);
  assert.equal(typeof execute.executeCapture, "boolean");
  assert.equal(typeof execute.executeLiveProviderCall, "boolean");
  assert.equal(JSON.stringify(execute).includes("manifest.json"), false);
  assert.equal(buildAfcUi2bPackageInventoryUrl("room a"), "/api/admin/3d-room-lab/afc-ui2a/packages?roomLabel=room%20a");
  const runUrl = new URL(buildAfcUi2bRunInventoryUrl("room-a", selected, "original_only"), "https://example.invalid");
  assert.deepEqual([...runUrl.searchParams.keys()].sort(), ["packageId", "roomLabel", "studyMode"]);
  assert.equal(runUrl.searchParams.get("studyMode"), "original_only");
  assert.equal(buildAfcUi2bRunInventoryUrl("room-a", null, ""), "/api/admin/3d-room-lab/afc-ui2b/proposal-runs?roomLabel=room-a");
});
test("UI2B request guards invalidate stale responses and identity covers package receipt and mode", () => {
  const guard = createAfcUi2bRequestGuard();
  const first = guard.begin();
  guard.invalidate();
  assert.equal(guard.isCurrent(first), false);
  assert.notEqual(afcUi2bIdentity(selected, "original_only"), afcUi2bIdentity(selected, "empty_only"));
  assert.notEqual(afcUi2bIdentity(selected, "original_only"), afcUi2bIdentity({ ...selected, receipt: { ...selected.receipt, sha256: "1".repeat(64) } }, "original_only"));
});
