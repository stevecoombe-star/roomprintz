import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAfcUi2aCompleteRequest,
  buildAfcUi2aPackageInventoryUrl,
  createAfcUi2aInitialPackageClientState,
  createAfcUi2aRequestGuard,
  currentImageIdentity,
  sanitizeCurrentUrl,
} from "./afc-ui2a-runner-state";

test("UI2A request generations reject stale completions independently", () => {
  const prepare = createAfcUi2aRequestGuard();
  const status = createAfcUi2aRequestGuard();
  const first = prepare.begin();
  const second = prepare.begin();
  const refresh = status.begin();
  assert.equal(prepare.isCurrent(first), false);
  assert.equal(prepare.isCurrent(second), true);
  assert.equal(status.isCurrent(refresh), true);
  prepare.invalidate();
  assert.equal(prepare.isCurrent(second), false);
  assert.equal(status.isCurrent(refresh), true);
});
test("UI2A current image identity captures every qualification selector", () => {
  const image = { contractVersion: "afc-ui2a-current-image/v1" as const, imageUrl: "https://images.example/room.jpg", expectedFingerprint: "a".repeat(64), expectedWidth: 10, expectedHeight: 20, qualificationStatus: "qualified" };
  assert.notEqual(currentImageIdentity(image), currentImageIdentity({ ...image, expectedHeight: 21 }));
  assert.equal(currentImageIdentity(null), null);
  assert.equal(sanitizeCurrentUrl("https://user:secret@images.example/room.jpg?token=secret#fragment"), "https://images.example/room.jpg");
});
test("UI2A package client state starts inert and generation-unapproved", () => {
  const state = createAfcUi2aInitialPackageClientState();
  assert.deepEqual(state, { inventoryStatus: "idle", completionStatus: "idle", packages: [], invalidCandidateCount: 0, lastCompletion: null, completionFailure: null });
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.packages), true);
});
test("UI2A completion request builders separate safe completion from explicit generation", () => {
  const preparation = {
    roomId: "room-a", preparationId: `afc-ui2a-original:room-a:${"a".repeat(64)}`,
    receiptFileName: `afc-ui2a-original-preparation.room-a.${"a".repeat(64)}.receipt.json`, receiptSha256: "b".repeat(64),
  };
  const safe = buildAfcUi2aCompleteRequest("room-a", preparation, "c".repeat(64), false);
  const generated = buildAfcUi2aCompleteRequest("room-a", preparation, "c".repeat(64), true);
  assert.deepEqual(Object.keys(safe).sort(), ["contractVersion", "currentExpectedFingerprint", "executeCapture", "originalPreparation", "roomLabel"]);
  assert.equal("executeEmptyRoomGeneration" in safe, false);
  assert.equal(generated.executeEmptyRoomGeneration, true);
  assert.equal(Object.isFrozen(safe), true);
  assert.equal(JSON.stringify(safe).includes("outputDir"), false);
  assert.equal(buildAfcUi2aPackageInventoryUrl("room a"), "/api/admin/3d-room-lab/afc-ui2a/packages?roomLabel=room%20a");
});
test("UI2A operation guards keep prepare, status, completion, and inventory responses independent", () => {
  const prepare = createAfcUi2aRequestGuard();
  const status = createAfcUi2aRequestGuard();
  const completion = createAfcUi2aRequestGuard();
  const inventory = createAfcUi2aRequestGuard();
  const tokens = [prepare.begin(), status.begin(), completion.begin(), inventory.begin()];
  completion.invalidate();
  assert.equal(prepare.isCurrent(tokens[0]), true);
  assert.equal(status.isCurrent(tokens[1]), true);
  assert.equal(completion.isCurrent(tokens[2]), false);
  assert.equal(inventory.isCurrent(tokens[3]), true);
});
test("UI2A reset invalidation makes every pre-reset request stale and permits fresh tokens", () => {
  const prepare = createAfcUi2aRequestGuard();
  const status = createAfcUi2aRequestGuard();
  const packageInventory = createAfcUi2aRequestGuard();
  const completion = createAfcUi2aRequestGuard();
  const beforeReset = [prepare.begin(), status.begin(), packageInventory.begin(), completion.begin()];
  for (const guard of [prepare, status, packageInventory, completion]) guard.invalidate();
  assert.equal(prepare.isCurrent(beforeReset[0]), false);
  assert.equal(status.isCurrent(beforeReset[1]), false);
  assert.equal(packageInventory.isCurrent(beforeReset[2]), false);
  assert.equal(completion.isCurrent(beforeReset[3]), false);
  assert.equal(packageInventory.isCurrent(packageInventory.begin()), true);
  assert.equal(completion.isCurrent(completion.begin()), true);
});
