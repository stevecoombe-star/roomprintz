import assert from "node:assert/strict";
import test from "node:test";

import { createAfcUi2aPreparePostHandler } from "./route";

const success = {
  status: "prepared" as const, preparationStage: "original_captured" as const, preparationId: "afc-ui2a-original:room-a:" + "a".repeat(64), roomId: "room-a",
  original: { fileName: "room-a.original." + "a".repeat(64) + ".jpg", sha256: "a".repeat(64), byteCount: 1, mimeType: "image/jpeg" as const, decodedWidth: 1, decodedHeight: 1, orientation: 1 as const },
  receipt: { fileName: "afc-ui2a-original-preparation.room-a." + "a".repeat(64) + ".receipt.json", sha256: "b".repeat(64) },
  reused: { original: false, receipt: false },
  safety: { emptyRoomGenerationCall: false as const, geminiFloorProposalCall: false as const, floorStateUnchanged: true as const, activeCameraUnchanged: true as const },
};
function handler(overrides: Partial<Parameters<typeof createAfcUi2aPreparePostHandler>[0]> = {}) {
  return createAfcUi2aPreparePostHandler({
    getAuthenticatedAdminUser: async () => ({ id: "admin" }),
    prepare: async () => success,
    nodeEnv: () => "development",
    isEnabled: () => true,
    ...overrides,
  } as Parameters<typeof createAfcUi2aPreparePostHandler>[0]);
}
test("UI2A preparation route preserves gate order", async () => {
  assert.equal((await handler({ getAuthenticatedAdminUser: async () => null })(new Request("http://test", { method: "POST" }))).status, 403);
  assert.equal((await handler({ nodeEnv: () => "production" })(new Request("http://test", { method: "POST" }))).status, 404);
  assert.equal((await handler({ isEnabled: () => false })(new Request("http://test", { method: "POST" }))).status, 404);
});
test("UI2A preparation route bounds and delegates valid JSON", async () => {
  const post = handler();
  assert.equal((await post(new Request("http://test", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await post(new Request("http://test", { method: "POST", body: JSON.stringify({ test: true }) }))).status, 200);
  assert.equal((await post(new Request("http://test", { method: "POST", headers: { "content-length": "999999" }, body: "{}" }))).status, 413);
});
