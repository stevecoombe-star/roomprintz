import assert from "node:assert/strict";
import test from "node:test";

import { createAfcUi2aPackagesGetHandler } from "./route";

function handler(overrides: Record<string, unknown> = {}) {
  return createAfcUi2aPackagesGetHandler({
    getAuthenticatedAdminUser: async () => ({ id: "admin" }),
    discover: async () => ({
      status: "inventory", roomId: "room-a", packages: [], invalidCandidateCount: 0,
      safety: { readOnly: true, filesystemWrites: false, compositorCalls: false, geminiCalls: false, afcR2Runs: false, sceneMutations: false },
    }),
    nodeEnv: () => "development",
    isEnabled: () => true,
    ...overrides,
  } as never);
}

test("packages route enforces containment and a single room selector", async () => {
  let roomLabel: unknown = null;
  const handler = createAfcUi2aPackagesGetHandler({
    getAuthenticatedAdminUser: async () => ({ id: "admin" }),
    discover: async (room: unknown) => {
      roomLabel = room;
      return {
        status: "inventory", roomId: "room-a", packages: [], invalidCandidateCount: 0,
        safety: { readOnly: true, filesystemWrites: false, compositorCalls: false, geminiCalls: false, afcR2Runs: false, sceneMutations: false },
      };
    },
    nodeEnv: () => "development",
    isEnabled: () => true,
  } as never);
  assert.equal((await handler(new Request("http://test/packages"))).status, 400);
  const response = await handler(new Request("http://test/packages?roomLabel=room-a"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(roomLabel, "room-a");
  assert.equal((await response.text()).includes("/Users/"), false);
});
test("packages route preserves containment gates and rejects malformed query selectors", async () => {
  for (const [overrides, expected] of [
    [{ getAuthenticatedAdminUser: async () => null }, 403],
    [{ nodeEnv: () => "production" }, 404],
    [{ isEnabled: () => false }, 404],
  ] as const) {
    const response = await handler(overrides)(new Request("http://test/packages?roomLabel=room-a"));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  for (const url of ["http://test/packages", "http://test/packages?roomLabel=", "http://test/packages?roomLabel=room-a&roomLabel=room-b", "http://test/packages?roomLabel=room-a&extra=1"]) {
    assert.equal((await handler()(new Request(url))).status, 400, url);
  }
});
test("packages route safely returns valid inventories and service failures", async () => {
  const valid = await handler()(new Request("http://test/packages?roomLabel=room-a"));
  assert.equal(valid.status, 200);
  assert.equal((await valid.json() as { invalidCandidateCount: number }).invalidCandidateCount, 0);
  const failed = await handler({ discover: async () => ({ status: "failure", failureCode: "inventory_unavailable", message: "safe" }) })(new Request("http://test/packages?roomLabel=room-a"));
  assert.equal(failed.status, 200);
  assert.equal((await failed.text()).includes("/Users/"), false);
});
