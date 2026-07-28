import assert from "node:assert/strict";
import test from "node:test";

import { createAfcUi2aRequestGuard, currentImageIdentity, sanitizeCurrentUrl } from "./afc-ui2a-runner-state";

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
